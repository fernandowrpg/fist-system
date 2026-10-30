import { FIST } from "../config.mjs";
import { FistActorSheet } from "./base-actor-sheet.mjs";

const TextEditor = foundry.applications.ux.TextEditor.implementation;

/**
 * Threat file for enemies and NPCs.
 */
export class NpcSheet extends FistActorSheet {

  static DEFAULT_OPTIONS = {
    classes: ["npc"],
    position: { width: 640, height: 720 },
    actions: {
      npcDamage: NpcSheet.#onDamage,
      choke: NpcSheet.#onChoke,
      appear: NpcSheet.#onAppear,
      threat: NpcSheet.#onThreat,
      adjust: NpcSheet.#onAdjust,
      roll: NpcSheet.#onRoll
    }
  };

  static PARTS = {
    sheet: { template: "systems/fist/templates/actor/npc-sheet.hbs", scrollable: [".sheet-scroll"] }
  };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const items = this.actor.items.contents.sort((a, b) => (a.sort || 0) - (b.sort || 0));
    context.abilities = await Promise.all(items.filter(i => i.type === "ability").map(i => this._prepareItem(i)));
    context.inventory = await Promise.all(items.filter(i => ["weapon", "armor", "gear"].includes(i.type)).map(i => this._prepareItem(i)));
    context.threats = Object.entries(FIST.threats).map(([k, v]) => ({
      level: Number(k), label: game.i18n.localize(v.label), hp: v.hp, armor: v.armor, damage: v.damage.toUpperCase(),
      active: Number(k) === this.actor.system.threat
    }));
    context.attributes = Object.entries(FIST.attributes).map(([key, cfg]) => ({
      key, abbr: cfg.abbr, label: game.i18n.localize(cfg.label), base: this.actor.system.attributes[key].base
    }));
    context.enrichedDescription = await TextEditor.enrichHTML(this.actor.system.description, { relativeTo: this.actor, secrets: this.actor.isOwner });
    context.hpSegments = Array.from({ length: Math.min(this.actor.system.hp.max, 40) }, (_, i) => ({ filled: i < this.actor.system.hp.value }));
    return context;
  }

  _canAcceptItem(item) {
    return ["weapon", "armor", "gear", "ability", "trait"].includes(item.type);
  }

  static #onDamage() {
    return this.actor.rollNpcDamage();
  }

  static #onChoke() {
    return this.actor.rollChoke();
  }

  static #onAppear() {
    return this.actor.rollAppear();
  }

  static #onThreat(event, target) {
    return this.actor.applyThreat(Number(target.dataset.level));
  }

  static #onRoll(event, target) {
    return this.actor.rollAttribute(target.dataset.attribute);
  }

  static #onAdjust(event, target) {
    const delta = Number(target.dataset.delta) || 0;
    const value = Math.clamp(this.actor.system.hp.value + delta, 0, Math.max(this.actor.system.hp.max, this.actor.system.hp.value + delta));
    return this.actor.update({ "system.hp.value": value });
  }
}

/* -------------------------------------------- */

/**
 * Vehicle sheet.
 */
export class VehicleSheet extends FistActorSheet {

  static DEFAULT_OPTIONS = {
    classes: ["vehicle"],
    position: { width: 600, height: 640 },
    actions: {
      crash: VehicleSheet.#onCrash,
      explode: VehicleSheet.#onExplode,
      adjust: VehicleSheet.#onAdjust
    }
  };

  static PARTS = {
    sheet: { template: "systems/fist/templates/actor/vehicle-sheet.hbs", scrollable: [".sheet-scroll"] }
  };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const items = this.actor.items.contents.sort((a, b) => (a.sort || 0) - (b.sort || 0));
    context.weapons = await Promise.all(items.filter(i => i.type === "weapon").map(i => this._prepareItem(i)));
    context.other = await Promise.all(items.filter(i => i.type !== "weapon").map(i => this._prepareItem(i)));
    context.enrichedDescription = await TextEditor.enrichHTML(this.actor.system.description, { relativeTo: this.actor });
    context.hpSegments = Array.from({ length: Math.min(this.actor.system.hp.max, 40) }, (_, i) => ({ filled: i < this.actor.system.hp.value }));
    return context;
  }

  _canAcceptItem(item) {
    return ["weapon", "armor", "gear", "ability"].includes(item.type);
  }

  static #onCrash() {
    return this.actor.rollNpcDamage();
  }

  static #onExplode() {
    return this.actor.rollExplosion();
  }

  static #onAdjust(event, target) {
    const delta = Number(target.dataset.delta) || 0;
    const value = Math.clamp(this.actor.system.hp.value + delta, 0, this.actor.system.hp.max);
    return this.actor.update({ "system.hp.value": value });
  }
}
