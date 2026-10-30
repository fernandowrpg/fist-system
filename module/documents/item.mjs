import { FIST } from "../config.mjs";
import { rollDamage, rollSimple } from "../dice/rolls.mjs";

const { DialogV2 } = foundry.applications.api;

export class FistItem extends Item {

  /** @override */
  async _preCreate(data, options, user) {
    if ( (await super._preCreate(data, options, user)) === false ) return false;
    if ( !data.img || data.img === Item.DEFAULT_ICON ) this.updateSource({ img: FIST.defaultIcons[this.type] ?? Item.DEFAULT_ICON });
    const actor = this.parent;
    if ( !(actor instanceof Actor) ) return;

    // Weapon tags are attached to weapons, never carried as items
    if ( this.type === "tag" ) return false;

    // Fresh traits roll their own variable bonuses later; reset the stored result
    if ( this.type === "trait" && !options.fistKeepRolls ) this.updateSource({ "system.rolledHp": 0 });
  }

  /** @override */
  async _onCreate(data, options, userId) {
    super._onCreate(data, options, userId);
    if ( (game.user.id !== userId) || !(this.parent instanceof Actor) || options.fistSkipAutomation ) return;
    if ( this.type === "trait" ) await this.#onTraitGained();
    if ( this.type === "role" ) await this.#onRoleGained();
  }

  /** @override */
  async _onDelete(options, userId) {
    super._onDelete(options, userId);
    if ( (game.user.id !== userId) || !(this.parent instanceof Actor) ) return;
    if ( this.type === "trait" ) {
      const granted = this.parent.items.filter(i => i.getFlag("fist", "grantedBy") === this.id).map(i => i.id);
      if ( granted.length ) await this.parent.deleteEmbeddedDocuments("Item", granted);
    }
  }

  /* -------------------------------------------- */
  /*  Trait & role automation                     */
  /* -------------------------------------------- */

  async #onTraitGained() {
    const actor = this.parent;
    const updates = {};

    // Attribute of the player's choice
    if ( this.system.chosenBonus && !this.system.chosenAttribute ) {
      const attr = await DialogV2.wait({
        window: { title: game.i18n.format("FIST.Trait.ChooseAttribute", { name: this.name }), icon: "fa-solid fa-dna" },
        classes: ["fist", "fist-dialog"],
        content: `<p>${game.i18n.format("FIST.Trait.ChooseAttributeHint", { bonus: this.system.chosenBonus })}</p>`,
        buttons: Object.entries(FIST.attributes).map(([action, v]) => ({ action, label: v.label })),
        rejectClose: false
      });
      if ( attr ) updates["system.chosenAttribute"] = attr;
    }

    // Variable MAX HP rolled once
    if ( this.system.maxHpFormula && !this.system.rolledHp ) {
      const roll = await rollSimple(actor, { formula: this.system.maxHpFormula, label: `${this.name}: MAX HP` });
      updates["system.rolledHp"] = roll.total;
    }
    if ( !foundry.utils.isEmpty(updates) ) await this.update(updates);

    // Granted items
    // Equip granted gear when its slot is free
    let weaponSlot = !!actor.equippedWeapon;
    let bodySlot = actor.items.some(i => (i.type === "armor") && i.system.equipped && !i.system.accessory && !i.system.equipAsWeapon);
    const grants = (this.system.grants ?? []).map(g => {
      const data = foundry.utils.deepClone(g);
      delete data._id;
      foundry.utils.setProperty(data, "flags.fist.grantedBy", this.id);
      foundry.utils.setProperty(data, "flags.fist.traitItem", true);
      const sys = data.system ?? {};
      if ( (data.type === "weapon" && !sys.freeSlot) || (data.type === "armor" && sys.equipAsWeapon) ) {
        if ( !weaponSlot ) { foundry.utils.setProperty(data, "system.equipped", true); weaponSlot = true; }
      }
      else if ( data.type === "armor" && sys.accessory ) foundry.utils.setProperty(data, "system.equipped", true);
      else if ( data.type === "armor" && (!bodySlot || sys.locked) ) { foundry.utils.setProperty(data, "system.equipped", true); bodySlot = true; }
      return data;
    });
    if ( grants.length ) await actor.createEmbeddedDocuments("Item", grants);

    // Keep current HP in step with the new maximum
    const hpGain = (this.system.mods.maxHp || 0) + (updates["system.rolledHp"] || 0);
    if ( hpGain > 0 && actor.type === "merc" ) await actor.update({ "system.hp.value": actor.system.hp.value + hpGain });
    if ( hpGain < 0 && actor.type === "merc" ) await actor.update({ "system.hp.value": Math.min(actor.system.hp.value, actor.system.hp.max) });

    ui.notifications.info(game.i18n.format("FIST.Trait.Gained", { name: this.name, actor: actor.name }));
  }

  async #onRoleGained() {
    const others = this.parent.items.filter(i => (i.type === "role") && (i.id !== this.id)).map(i => i.id);
    if ( others.length ) await this.parent.deleteEmbeddedDocuments("Item", others);
  }

  /* -------------------------------------------- */
  /*  Inventory actions                           */
  /* -------------------------------------------- */

  /** Equip or unequip, enforcing one weapon and one body armor. */
  async toggleEquip() {
    const actor = this.parent;
    if ( !actor ) return;
    if ( this.system.locked && this.system.equipped ) return ui.notifications.warn("FIST.Warn.Locked", { localize: true });
    const equip = !this.system.equipped;
    const updates = [{ _id: this.id, "system.equipped": equip }];
    if ( equip ) {
      const occupiesWeaponSlot = (i) => ((i.type === "weapon") && !i.system.freeSlot) || ((i.type === "armor") && i.system.equipAsWeapon);
      const isBodyArmor = (i) => (i.type === "armor") && !i.system.accessory && !i.system.equipAsWeapon;
      for ( const other of actor.items ) {
        if ( (other.id === this.id) || !other.system.equipped || other.system.locked ) continue;
        if ( occupiesWeaponSlot(this) && occupiesWeaponSlot(other) ) updates.push({ _id: other.id, "system.equipped": false });
        if ( isBodyArmor(this) && isBodyArmor(other) ) updates.push({ _id: other.id, "system.equipped": false });
      }
    }
    return actor.updateEmbeddedDocuments("Item", updates);
  }

  /** Attack with a weapon: a risky roll using its preferred attribute. */
  async attack() {
    const actor = this.parent;
    if ( !actor ) return;
    if ( this.system.depleted ) return ui.notifications.warn("FIST.Warn.Depleted", { localize: true });
    if ( this.system.ranged && game.settings.get("fist", "ammoTracking") && this.system.ammo.value <= 0 ) {
      return ui.notifications.warn("FIST.Warn.NoAmmo", { localize: true });
    }
    const tagAttr = this.system.tags.find(t => t.attribute)?.attribute;
    const attribute = this.system.attribute || tagAttr || (this.system.ranged ? "rfx" : "frc");
    return actor.rollAttribute(attribute, { label: game.i18n.format("FIST.Weapon.AttackWith", { name: this.name }), item: this });
  }

  /** Roll this weapon's damage, then handle ammo and limited uses. */
  async rollDamage() {
    const actor = this.parent;
    const msg = await rollDamage(actor, { formula: this.system.damageFormula, label: this.name, item: this });
    if ( this.system.ranged && game.settings.get("fist", "ammoTracking") ) await this.#ammoCheck();
    if ( this.system.hasUses ) await this.#spendUse();
    return msg;
  }

  /** Abstract ammo tracking (optional rule, p. 73). */
  async #ammoCheck() {
    const ammo = this.system.ammo.value;
    const roll = await new Roll("1d6").evaluate();
    let value = ammo;
    if ( roll.total < ammo ) value = ammo - 1;
    else if ( roll.total > ammo ) value = 0;
    await this.update({ "system.ammo.value": value });
    const key = value === 0 ? "FIST.Ammo.Empty" : (value < ammo ? "FIST.Ammo.Lower" : "FIST.Ammo.Same");
    ChatMessage.implementation.create({
      speaker: ChatMessage.implementation.getSpeaker({ actor: this.parent }),
      content: `<div class="fist-note ammo">${game.i18n.format(key, { name: this.name, roll: roll.total, ammo: value })}</div>`
    });
  }

  async #spendUse() {
    const value = Math.max(this.system.uses.value - 1, 0);
    if ( this.system.consumable && value <= 0 ) return this.delete();
    return this.update({ "system.uses.value": value });
  }

  /** Use a gear item: heal, grant war dice, then spend a use or consume it. */
  async use() {
    const actor = this.parent;
    if ( !actor ) return;
    if ( this.system.depleted ) return ui.notifications.warn("FIST.Warn.Depleted", { localize: true });
    if ( this.system.heal ) {
      const roll = await rollSimple(actor, { formula: this.system.heal, label: this.name, text: game.i18n.localize("FIST.Gear.Heals") });
      await actor.applyHealing(roll.total);
    } else {
      ChatMessage.implementation.create({
        speaker: ChatMessage.implementation.getSpeaker({ actor }),
        content: `<div class="fist-note item"><strong>${this.name}</strong>${this.system.description}</div>`
      });
    }
    if ( this.system.warDice && actor.type === "merc" ) await actor.update({ "system.warDice.value": actor.system.warDice.value + this.system.warDice });
    if ( this.system.hasUses ) return this.#spendUse();
    if ( this.system.consumable ) return this.delete();
  }

  /** Shatter an accessory to negate DAMAGE once. */
  async shatter() {
    const confirmed = await DialogV2.confirm({
      window: { title: "FIST.Armor.Shatter" },
      classes: ["fist", "fist-dialog"],
      content: `<p>${game.i18n.format("FIST.Armor.ShatterHint", { name: this.name })}</p>`
    });
    if ( !confirmed ) return;
    ChatMessage.implementation.create({
      speaker: ChatMessage.implementation.getSpeaker({ actor: this.parent }),
      content: `<div class="fist-note shatter">${game.i18n.format("FIST.Armor.Shattered", { name: this.name })}</div>`
    });
    return this.delete();
  }

  /** Post the item to chat. */
  async toChat() {
    const enrich = foundry.applications.ux.TextEditor.implementation.enrichHTML;
    const body = this.system.effect ?? this.system.description ?? "";
    const content = await foundry.applications.handlebars.renderTemplate("systems/fist/templates/chat/item-card.hbs", {
      item: this, body: await enrich(body), number: this.system.number
    });
    return ChatMessage.implementation.create({ speaker: ChatMessage.implementation.getSpeaker({ actor: this.parent }), content });
  }

  /**
   * Attach a weapon tag to this weapon.
   * @param {Item} tag
   */
  async addTag(tag) {
    if ( this.type !== "weapon" ) return;
    const tags = foundry.utils.deepClone(this.system.toObject().tags);
    if ( tags.some(t => t.name === tag.name) ) return ui.notifications.warn("FIST.Warn.TagExists", { localize: true });
    const plain = foundry.applications.ux.TextEditor.implementation.decodeHTML?.(tag.system.description.replace(/<[^>]+>/g, "")) ?? tag.system.description.replace(/<[^>]+>/g, "");
    tags.push({ name: tag.name, description: plain, damageBonus: tag.system.damageBonus, attribute: tag.system.attribute, attributeBonus: tag.system.attributeBonus });
    await this.update({ "system.tags": tags });
    ui.notifications.info(game.i18n.format("FIST.Tag.Added", { tag: tag.name, weapon: this.name }));
  }

  async removeTag(index) {
    const tags = foundry.utils.deepClone(this.system.toObject().tags);
    tags.splice(index, 1);
    return this.update({ "system.tags": tags });
  }
}
