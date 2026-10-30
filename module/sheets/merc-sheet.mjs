import { FIST } from "../config.mjs";
import { FistActorSheet } from "./base-actor-sheet.mjs";
import { rollSimple } from "../dice/rolls.mjs";
import * as Generator from "../apps/generator.mjs";

const TextEditor = foundry.applications.ux.TextEditor.implementation;
const { DialogV2 } = foundry.applications.api;

/**
 * The Operative Profile: the player character sheet, with the step-by-step builder.
 */
export class MercSheet extends FistActorSheet {

  static DEFAULT_OPTIONS = {
    classes: ["merc"],
    position: { width: 900, height: 820 },
    actions: {
      roll: MercSheet.#onRoll,
      unarmed: MercSheet.#onUnarmed,
      spendWarDie: MercSheet.#onSpendWarDie,
      adjust: MercSheet.#onAdjust,
      startMission: MercSheet.#onStartMission,
      rendezvous: MercSheet.#onRendezvous,
      advance: MercSheet.#onAdvance,
      insertion: MercSheet.#onInsertion,
      builderStep: MercSheet.#onBuilderStep,
      builderNext: MercSheet.#onBuilderNext,
      builderPrev: MercSheet.#onBuilderPrev,
      randomTrait: MercSheet.#onRandomTrait,
      randomRole: MercSheet.#onRandomRole,
      randomCodename: MercSheet.#onRandomCodename,
      randomMerc: MercSheet.#onRandomMerc,
      chooseBonus: MercSheet.#onChooseBonus,
      standardIssue: MercSheet.#onStandardIssue,
      finishBuilder: MercSheet.#onFinishBuilder,
      reopenBuilder: MercSheet.#onReopenBuilder,
      toggleRealName: MercSheet.#onToggleRealName
    }
  };

  static PARTS = {
    sheet: { template: "systems/fist/templates/actor/merc-sheet.hbs", scrollable: [".tab-body"] }
  };

  static TABS = {
    primary: {
      tabs: [
        { id: "builder", icon: "fa-solid fa-list-check", label: "FIST.Tab.builder" },
        { id: "dossier", icon: "fa-solid fa-dna", label: "FIST.Tab.dossier" },
        { id: "arsenal", icon: "fa-solid fa-person-rifle", label: "FIST.Tab.arsenal" },
        { id: "file", icon: "fa-solid fa-folder-open", label: "FIST.Tab.file" }
      ],
      initial: "dossier"
    }
  };

  /** Whether the real name is unmasked in this session. */
  _showRealName = false;

  /* -------------------------------------------- */

  _prepareTabs(group) {
    // Open on the builder until the operative is complete
    if ( (group === "primary") && !this._tabInitialized ) {
      this.tabGroups.primary = this.actor.system.creation.complete ? "dossier" : "builder";
      this._tabInitialized = true;
    }
    const tabs = super._prepareTabs(group);
    if ( this.actor.system.creation.complete && tabs.builder ) tabs.builder.cssClass = [tabs.builder.cssClass, "builder-done"].filterJoin(" ");
    return tabs;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const system = this.actor.system;
    const items = this.actor.items.contents.sort((a, b) => (a.sort || 0) - (b.sort || 0));

    context.attributes = Object.entries(FIST.attributes).map(([key, cfg]) => ({
      key, ...cfg,
      label: game.i18n.localize(cfg.label),
      hint: game.i18n.localize(cfg.hint),
      value: system.attributes[key].value,
      signed: (system.attributes[key].value >= 0 ? "+" : "") + system.attributes[key].value,
      base: system.attributes[key].base,
      sources: system.attributes[key].sources.join(", ")
    }));

    context.traits = await Promise.all(items.filter(i => i.type === "trait").map(i => this._prepareItem(i)));
    const role = this.actor.role;
    context.role = role ? await this._prepareItem(role) : null;
    context.roleAnswer = role ? await TextEditor.enrichHTML(role.system.answer, { relativeTo: role }) : "";
    context.weapons = await Promise.all(items.filter(i => i.type === "weapon").map(i => this._prepareItem(i)));
    context.armors = await Promise.all(items.filter(i => i.type === "armor").map(i => this._prepareItem(i)));
    context.gear = await Promise.all(items.filter(i => i.type === "gear").map(i => this._prepareItem(i)));
    context.abilities = await Promise.all(items.filter(i => i.type === "ability").map(i => this._prepareItem(i)));
    context.equippedWeapon = this.actor.equippedWeapon;
    context.inventoryCount = context.weapons.length + context.armors.length + context.gear.length;
    context.ammoTracking = game.settings.get("fist", "ammoTracking");
    context.encumbrance = game.settings.get("fist", "encumbrance") ? {
      count: context.inventoryCount,
      limit: system.hp.max + Math.max(system.attributes.frc.value, system.attributes.rfx.value)
    } : null;
    context.hpSegments = Array.from({ length: Math.min(system.hp.max, 40) }, (_, i) => ({ filled: i < system.hp.value }));
    context.isDead = system.isDead;

    context.enrichedInfo = await TextEditor.enrichHTML(system.info, { relativeTo: this.actor, secrets: this.actor.isOwner });
    context.enrichedNotes = await TextEditor.enrichHTML(system.notes, { relativeTo: this.actor, secrets: this.actor.isOwner });
    context.showRealName = this._showRealName;
    context.canSeeRealName = this.actor.isOwner;

    context.builder = this._prepareBuilder(context);
    context.fileNumber = this.actor.id.slice(0, 8).toUpperCase();
    return context;
  }

  /** Context for the step-by-step builder. */
  _prepareBuilder(context) {
    const system = this.actor.system;
    const c = system.creation;
    const traitCount = context.traits.length;
    const done = {
      sheet: c.step > 0 || c.complete,
      traits: traitCount >= 2,
      bonus: !!c.bonus,
      role: !!context.role,
      codename: !!system.codename
    };
    const steps = FIST.creationSteps.map((s, i) => ({
      ...s, index: i, number: i + 1, active: c.step === i, done: done[s.id]
    }));
    const current = steps[c.step];
    return {
      steps,
      step: c.step,
      current,
      isFirst: c.step === 0,
      isLast: c.step === steps.length - 1,
      traitCount,
      traitsNeeded: Math.max(2 - traitCount, 0),
      bonus: c.bonus,
      bonusResult: c.bonusResult,
      standardIssue: FIST.standardIssue.map((s, i) => ({ ...s, index: i, number: i + 1 })),
      allDone: Object.values(done).every(v => v),
      progress: Math.round((Object.values(done).filter(v => v).length / steps.length) * 100),
      complete: c.complete,
      done
    };
  }

  /* -------------------------------------------- */
  /*  Item acceptance                             */
  /* -------------------------------------------- */

  _canAcceptItem(item) {
    return ["trait", "role", "weapon", "armor", "gear", "ability"].includes(item.type);
  }

  async _onDropItem(event, item) {
    // Roles are unique per team
    if ( item.type === "role" && !item.parent ) {
      const holder = Generator.roleHolder(item.name, this.actor);
      if ( holder ) {
        const ok = await DialogV2.confirm({
          window: { title: "FIST.Role.Taken" },
          classes: ["fist", "fist-dialog"],
          content: `<p>${game.i18n.format("FIST.Role.TakenHint", { role: item.name, name: holder.name })}</p>`
        });
        if ( !ok ) return null;
      }
    }
    const result = await super._onDropItem(event, item);
    // Advance the builder when a step is fulfilled
    if ( result && !this.actor.system.creation.complete ) {
      const step = this.actor.system.creation.step;
      if ( (step === 1) && (this.actor.traits.length >= 2) ) await this.actor.update({ "system.creation.step": 2 });
      if ( (step === 3) && (item.type === "role") ) await this.actor.update({ "system.creation.step": 4 });
    }
    return result;
  }

  /* -------------------------------------------- */
  /*  Actions                                     */
  /* -------------------------------------------- */

  static #onRoll(event, target) {
    return this.actor.rollAttribute(target.dataset.attribute, { skipDialog: event.shiftKey });
  }

  static #onUnarmed() {
    return this.actor.rollUnarmed();
  }

  static async #onSpendWarDie() {
    const wd = this.actor.system.warDice.value;
    if ( wd <= 0 ) return ui.notifications.warn("FIST.Warn.NoWarDice", { localize: true });
    const bonus = this.actor.system.warDice.bonus;
    await this.actor.update({ "system.warDice.value": wd - 1 });
    return rollSimple(this.actor, { formula: `1d6${bonus ? ` + ${bonus}` : ""}`, label: game.i18n.localize("FIST.WarDie.Spend"),
      text: game.i18n.localize("FIST.WarDie.SpendHint") });
  }

  static #onAdjust(event, target) {
    const path = target.dataset.path;
    const delta = Number(target.dataset.delta) || 0;
    const current = foundry.utils.getProperty(this.actor, path) ?? 0;
    let value = current + delta;
    if ( path === "system.hp.value" ) value = Math.clamp(value, 0, this.actor.system.hp.max);
    else value = Math.max(value, path.includes("attributes") ? -9 : 0);
    return this.actor.update({ [path]: value });
  }

  static #onStartMission() {
    return this.actor.startMission();
  }

  static #onRendezvous() {
    return this.actor.rendezvous();
  }

  static #onAdvance() {
    return this.actor.advance();
  }

  static #onInsertion() {
    return this.actor.rollInsertion();
  }

  /* ---- Builder ---- */

  static #onBuilderStep(event, target) {
    return this.actor.update({ "system.creation.step": Number(target.dataset.step) });
  }

  static #onBuilderNext() {
    const step = Math.min(this.actor.system.creation.step + 1, FIST.creationSteps.length - 1);
    return this.actor.update({ "system.creation.step": step });
  }

  static #onBuilderPrev() {
    const step = Math.max(this.actor.system.creation.step - 1, 0);
    return this.actor.update({ "system.creation.step": step });
  }

  static async #onRandomTrait() {
    const trait = await Generator.randomTrait({ exclude: this.actor.traits.map(t => t.name) });
    if ( !trait ) return;
    await this.actor.createEmbeddedDocuments("Item", [trait.toObject()]);
    if ( !this.actor.system.creation.complete && this.actor.traits.length >= 2 && this.actor.system.creation.step === 1 ) {
      await this.actor.update({ "system.creation.step": 2 });
    }
  }

  static async #onRandomRole() {
    const role = await Generator.randomRole({ excludeTaken: true, actor: this.actor });
    if ( !role ) return;
    await this.actor.createEmbeddedDocuments("Item", [role.toObject()]);
    if ( !this.actor.system.creation.complete && this.actor.system.creation.step === 3 ) {
      await this.actor.update({ "system.creation.step": 4 });
    }
  }

  static async #onRandomCodename() {
    const codename = Generator.randomCodename();
    return this.actor.update({ "system.codename": codename, name: codename });
  }

  static async #onRandomMerc() {
    const ok = await DialogV2.confirm({
      window: { title: "FIST.Builder.RandomMerc", icon: "fa-solid fa-shuffle" },
      classes: ["fist", "fist-dialog"],
      content: `<p>${game.i18n.localize("FIST.Builder.RandomMercHint")}</p>`
    });
    if ( !ok ) return;
    await Generator.randomizeMerc(this.actor);
  }

  static async #onChooseBonus(event, target) {
    if ( this.actor.system.creation.bonus ) return;
    const choice = target.dataset.choice;
    if ( choice === "item" ) return; // handled by the standard issue buttons
    const result = await this.actor.grantReward(choice, { reason: game.i18n.localize("FIST.Builder.Step.bonus") });
    await this.actor.update({ "system.creation.bonus": choice, "system.creation.bonusResult": result, "system.creation.step": 3 });
  }

  static async #onStandardIssue(event, target) {
    if ( this.actor.system.creation.bonus ) return;
    let index = Number(target.dataset.index);
    if ( target.dataset.index === "roll" ) {
      const roll = await rollSimple(this.actor, { formula: "1d6", label: game.i18n.localize("FIST.Builder.StandardIssue") });
      index = roll.total - 1;
    }
    const data = foundry.utils.deepClone(FIST.standardIssue[index]);
    foundry.utils.setProperty(data, "flags.fist.standardIssue", true);
    await this.actor.createEmbeddedDocuments("Item", [data]);
    await this.actor.update({ "system.creation.bonus": "item", "system.creation.bonusResult": data.name, "system.creation.step": 3 });
  }

  static async #onFinishBuilder() {
    const system = this.actor.system;
    const updates = { "system.creation.complete": true };
    if ( system.codename && (this.actor.name !== system.codename) ) updates.name = system.codename;
    updates["system.hp.value"] = system.hp.max;
    this.tabGroups.primary = "dossier";
    await this.actor.update(updates);
    ChatMessage.implementation.create({
      speaker: ChatMessage.implementation.getSpeaker({ actor: this.actor }),
      content: `<div class="fist-note mission">${game.i18n.format("FIST.Builder.Deployed", { name: this.actor.name })}</div>`
    });
  }

  static async #onReopenBuilder() {
    this.tabGroups.primary = "builder";
    await this.actor.update({ "system.creation.complete": false });
  }

  static #onToggleRealName() {
    this._showRealName = !this._showRealName;
    this.render();
  }

  /** Keep the actor name and codename in sync. */
  async _processSubmitData(event, form, submitData, options) {
    const codename = foundry.utils.getProperty(submitData, "system.codename");
    if ( codename && (codename !== this.actor.system.codename) && !("name" in submitData) ) submitData.name = codename;
    return super._processSubmitData(event, form, submitData, options);
  }
}
