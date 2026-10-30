import { FIST } from "../config.mjs";
import { promptCheck, rollCheck, rollDamage, rollSimple } from "../dice/rolls.mjs";

const { DialogV2 } = foundry.applications.api;
const { renderTemplate } = foundry.applications.handlebars;

export class FistActor extends Actor {

  /** @override */
  async _preCreate(data, options, user) {
    if ( (await super._preCreate(data, options, user)) === false ) return false;
    const token = {};
    if ( this.type === "merc" ) Object.assign(token, { actorLink: true, disposition: CONST.TOKEN_DISPOSITIONS.FRIENDLY });
    if ( this.type === "npc" ) Object.assign(token, { disposition: CONST.TOKEN_DISPOSITIONS.HOSTILE });
    token.bar1 = { attribute: "hp" };
    this.updateSource({ prototypeToken: foundry.utils.mergeObject(token, data.prototypeToken ?? {}) });
  }

  /* -------------------------------------------- */
  /*  Accessors                                   */
  /* -------------------------------------------- */

  get traits() {
    return this.items.filter(i => i.type === "trait");
  }

  get role() {
    return this.items.find(i => i.type === "role") ?? null;
  }

  get equippedWeapon() {
    return this.items.find(i => (i.type === "weapon") && i.system.equipped && !i.system.freeSlot) ?? null;
  }

  /* -------------------------------------------- */
  /*  Rolls                                       */
  /* -------------------------------------------- */

  /**
   * Roll a risky action. Shows the roll dialog unless skipDialog is set.
   */
  async rollAttribute(attribute = "frc", { label = "", item = null, skipDialog = false } = {}) {
    let options = { attribute };
    if ( !skipDialog ) {
      options = await promptCheck(this, { attribute, label, item });
      if ( !options ) return null;
    }
    return rollCheck(this, { ...options, label, item });
  }

  /** Attack with no weapon: worst-of-2D6 damage. */
  async rollUnarmed() {
    return rollDamage(this, { formula: FIST.unarmedDamage, label: game.i18n.localize("FIST.Weapon.Unarmed") });
  }

  /** NPC/vehicle damage roll. */
  async rollNpcDamage() {
    const formula = this.type === "vehicle" ? this.system.crash : this.system.damage;
    const label = this.type === "vehicle" ? game.i18n.localize("FIST.Vehicle.Crash") : game.i18n.localize("FIST.Damage.Label");
    return rollDamage(this, { formula, label });
  }

  /** NPC CHOKE check: roll 1D6, on a result equal to or higher than the score the NPC chokes. */
  async rollChoke() {
    const { value, behavior } = this.system.choke ?? {};
    if ( !value ) return ui.notifications.warn("FIST.Warn.NoChoke", { localize: true });
    const roll = await new Roll("1d6").evaluate();
    const choked = roll.total >= value;
    const text = choked
      ? game.i18n.format("FIST.Choke.Choked", { behavior: behavior || "?" })
      : game.i18n.localize("FIST.Choke.Holds");
    const content = await renderTemplate("systems/fist/templates/chat/simple-card.hbs", {
      label: `CHOKE ${value}`, text, faces: [{ value: roll.total, kind: "base" }], total: roll.total,
      formula: "1D6", banner: choked ? "failure" : "success"
    });
    return ChatMessage.implementation.create({
      speaker: ChatMessage.implementation.getSpeaker({ actor: this }), content, rolls: [roll],
      whisper: game.users.filter(u => u.isGM).map(u => u.id)
    });
  }

  /** Roll how many of this enemy appear. */
  async rollAppear() {
    const formula = (this.system.appear || "").match(/\d*d\d+(\s*[+-]\s*\d+)?/i)?.[0];
    if ( !formula ) return;
    return rollSimple(this, { formula, label: game.i18n.format("FIST.Npc.AppearRoll", { name: this.name }) });
  }

  /** Vehicle explosion: X-in-1D6 chance to explode for XD6, where X is ARMOR. */
  async rollExplosion() {
    const x = this.system.armor;
    if ( !x ) return rollSimple(this, { formula: "1d6", label: game.i18n.localize("FIST.Vehicle.Explosion"), text: game.i18n.localize("FIST.Vehicle.NoExplosion") });
    const roll = await rollSimple(this, { formula: "1d6", label: game.i18n.localize("FIST.Vehicle.Explosion"),
      text: game.i18n.format("FIST.Vehicle.ExplosionChance", { x }) });
    if ( roll.total <= x ) return rollDamage(this, { formula: `${x}d6`, label: game.i18n.localize("FIST.Vehicle.Explodes") });
  }

  /* -------------------------------------------- */
  /*  Damage & healing                            */
  /* -------------------------------------------- */

  async applyDamage(amount, { ignoreArmor = false, double = false } = {}) {
    const armor = ignoreArmor ? 0 : (this.system.armor?.value ?? this.system.armor ?? 0);
    let dealt = Math.max(Number(amount) - armor, 0);
    if ( double ) dealt *= 2;
    const hp = this.system.hp.value;
    const value = Math.max(hp - dealt, 0);
    await this.update({ "system.hp.value": value });
    const key = value <= 0 ? "FIST.Damage.Killed" : "FIST.Damage.Taken";
    ChatMessage.implementation.create({
      speaker: ChatMessage.implementation.getSpeaker({ actor: this }),
      content: `<div class="fist-note ${value <= 0 ? "dead" : ""}">${game.i18n.format(key, { name: this.name, dealt, armor, hp: value })}</div>`
    });
    return dealt;
  }

  async applyHealing(amount) {
    const max = this.system.hp.max;
    const value = Math.min(this.system.hp.value + Number(amount), max);
    await this.update({ "system.hp.value": value });
    ChatMessage.implementation.create({
      speaker: ChatMessage.implementation.getSpeaker({ actor: this }),
      content: `<div class="fist-note heal">${game.i18n.format("FIST.Damage.Healed", { name: this.name, amount, hp: value })}</div>`
    });
  }

  /* -------------------------------------------- */
  /*  Mission flow                                */
  /* -------------------------------------------- */

  /**
   * Start a new mission: full HP, limited-use items refilled, ammo reset and per-mission WAR DICE.
   */
  async startMission() {
    if ( this.type !== "merc" ) return;
    const confirmed = await DialogV2.confirm({
      window: { title: "FIST.Mission.Start", icon: "fa-solid fa-helicopter" },
      classes: ["fist", "fist-dialog"],
      content: `<p>${game.i18n.localize("FIST.Mission.StartHint")}</p>`
    });
    if ( !confirmed ) return;
    const updates = this.items.filter(i => i.system.uses?.max > 0 || i.type === "weapon").map(i => ({
      _id: i.id, "system.uses.value": i.system.uses?.max ?? 0, ...(i.type === "weapon" ? { "system.ammo.value": 6 } : {})
    }));
    if ( updates.length ) await this.updateEmbeddedDocuments("Item", updates);
    const perMission = this.system.warDice.perMission;
    await this.update({
      "system.hp.value": this.system.hp.max,
      "system.warDice.value": this.system.warDice.value + perMission,
      "system.missions": this.system.missions + 1
    });
    ChatMessage.implementation.create({
      speaker: ChatMessage.implementation.getSpeaker({ actor: this }),
      content: `<div class="fist-note mission">${game.i18n.format("FIST.Mission.Started", { name: this.name, wd: perMission })}</div>`
    });
  }

  /** Rendezvous point: REST, RESTOCK or INTEL. */
  async rendezvous() {
    const restockable = this.items.filter(i => (i.system.uses?.max > 0 && i.system.uses.value < i.system.uses.max)
      || (i.type === "weapon" && i.system.ranged && i.system.ammo.value < 6));
    const choice = await DialogV2.wait({
      window: { title: "FIST.Rendezvous.Title", icon: "fa-solid fa-campground" },
      classes: ["fist", "fist-dialog"],
      content: `<p>${game.i18n.localize("FIST.Rendezvous.Hint")}</p>`,
      buttons: Object.entries(FIST.rendezvous).map(([action, v]) => ({ action, label: v.label })),
      rejectClose: false
    });
    if ( !choice ) return;
    if ( choice === "rest" ) {
      const roll = await rollSimple(this, { formula: "1d6", label: game.i18n.localize("FIST.Rendezvous.rest") });
      return this.applyHealing(roll.total);
    }
    if ( choice === "restock" ) {
      if ( !restockable.length ) return ui.notifications.info("FIST.Rendezvous.NothingToRestock", { localize: true });
      const id = await DialogV2.wait({
        window: { title: "FIST.Rendezvous.restock" },
        classes: ["fist", "fist-dialog"],
        content: `<p>${game.i18n.localize("FIST.Rendezvous.restockHint")}</p>`,
        buttons: restockable.map(i => ({ action: i.id, label: i.name })),
        rejectClose: false
      });
      const item = this.items.get(id);
      if ( !item ) return;
      const update = item.system.uses?.max > 0 ? { "system.uses.value": item.system.uses.max } : { "system.ammo.value": 6 };
      await item.update(update);
      return ChatMessage.implementation.create({
        speaker: ChatMessage.implementation.getSpeaker({ actor: this }),
        content: `<div class="fist-note">${game.i18n.format("FIST.Rendezvous.Restocked", { name: this.name, item: item.name })}</div>`
      });
    }
    return ChatMessage.implementation.create({
      speaker: ChatMessage.implementation.getSpeaker({ actor: this }),
      content: `<div class="fist-note intel">${game.i18n.format("FIST.Rendezvous.IntelRequest", { name: this.name })}</div>`
    });
  }

  /**
   * Advancement reward: a new trait, +1D6 MAX HP or +1D6 WAR DICE.
   */
  async advance() {
    const choice = await DialogV2.wait({
      window: { title: "FIST.Advance.Title", icon: "fa-solid fa-angles-up" },
      classes: ["fist", "fist-dialog"],
      content: `<p>${game.i18n.localize("FIST.Advance.Hint")}</p>`,
      buttons: ["trait", "hp", "warDice"].map(action => ({ action, label: FIST.rewards[action].label, icon: FIST.rewards[action].icon })),
      rejectClose: false
    });
    if ( !choice ) return;
    await this.update({ "system.advancements": this.system.advancements + 1 });
    return this.grantReward(choice, { reason: game.i18n.localize("FIST.Advance.Title") });
  }

  /**
   * Apply a reward (used by advancement and by the builder's starting bonus).
   * @returns {Promise<string>} A short description of the result.
   */
  async grantReward(choice, { reason = "" } = {}) {
    if ( choice === "hp" ) {
      const roll = await rollSimple(this, { formula: "1d6", label: `${reason}: ${game.i18n.localize("FIST.Reward.hp")}` });
      await this.update({ "system.hp.bonus": this.system.hp.bonus + roll.total, "system.hp.value": this.system.hp.value + roll.total });
      return `+${roll.total} MAX HP`;
    }
    if ( choice === "warDice" ) {
      const roll = await rollSimple(this, { formula: "1d6", label: `${reason}: ${game.i18n.localize("FIST.Reward.warDice")}` });
      await this.update({ "system.warDice.value": this.system.warDice.value + roll.total });
      return `+${roll.total} WAR DICE`;
    }
    if ( choice === "trait" ) {
      game.packs.get(FIST.compendiums.traits)?.render(true);
      ui.notifications.info("FIST.Advance.DropTrait", { localize: true });
      return game.i18n.localize("FIST.Reward.trait");
    }
    return "";
  }

  /** Emergency insertion roll (2D6). */
  async rollInsertion() {
    const roll = await new Roll("2d6").evaluate();
    const dice = roll.dice[0].results.map(r => r.result);
    const sixes = dice.every(d => d === 6);
    const row = FIST.insertion.find(r => roll.total <= r.max);
    const text = game.i18n.localize(sixes ? "FIST.Insertion.sixes" : row.label);
    const banner = roll.total <= 6 ? "failure" : (roll.total <= 9 ? "partial" : (sixes ? "ultra" : "success"));
    const content = await renderTemplate("systems/fist/templates/chat/simple-card.hbs", {
      label: game.i18n.localize("FIST.Insertion.Title"), text, banner,
      faces: dice.map(value => ({ value, kind: "base" })), total: roll.total, formula: "2D6"
    });
    return ChatMessage.implementation.create({ speaker: ChatMessage.implementation.getSpeaker({ actor: this }), content, rolls: [roll] });
  }

  /** Apply the stat guideline of a threat level to an NPC. */
  async applyThreat(level) {
    const t = FIST.threats[level];
    if ( !t ) return;
    return this.update({ "system.threat": Number(level), "system.hp.max": t.hp, "system.hp.value": t.hp, "system.armor": t.armor, "system.damage": t.damage });
  }
}
