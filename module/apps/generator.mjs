import { FIST } from "../config.mjs";
import { CODENAMES } from "../codenames.mjs";
import { rollD66, rollD666 } from "../dice/rolls.mjs";

const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;
const TextEditor = foundry.applications.ux.TextEditor.implementation;

/* -------------------------------------------- */
/*  Random draws (fistref.com style)            */
/* -------------------------------------------- */

async function packDocuments(key) {
  const pack = game.packs.get(key);
  if ( !pack ) {
    ui.notifications.error(`FIST | Compendium ${key} not found.`);
    return [];
  }
  return pack.getDocuments();
}

/** Find the operative (other than the given actor) that already holds a role. */
export function roleHolder(roleName, actor = null) {
  return game.actors.find(a => (a.type === "merc") && (a !== actor) && a.items.some(i => (i.type === "role") && (i.name === roleName))) ?? null;
}

/**
 * Draw a random trait by rolling D666 against the traits index (rerolling numbers not present or excluded).
 * @returns {Promise<Item|null>}
 */
export async function randomTrait({ exclude = [] } = {}) {
  const traits = (await packDocuments(FIST.compendiums.traits)).filter(t => !exclude.includes(t.name));
  if ( !traits.length ) return null;
  const byNumber = new Map(traits.map(t => [t.system.number, t]));
  for ( let i = 0; i < 50; i++ ) {
    const { value } = await rollD666();
    if ( byNumber.has(value) ) return byNumber.get(value);
  }
  return traits[Math.floor(Math.random() * traits.length)];
}

/**
 * Draw a random role by rolling D66, skipping roles already held by other operatives.
 * @returns {Promise<Item|null>}
 */
export async function randomRole({ excludeTaken = true, actor = null } = {}) {
  let roles = await packDocuments(FIST.compendiums.roles);
  if ( excludeTaken ) roles = roles.filter(r => !roleHolder(r.name, actor) && (actor?.role?.name !== r.name));
  if ( !roles.length ) return null;
  const byNumber = new Map(roles.map(r => [r.system.number, r]));
  for ( let i = 0; i < 50; i++ ) {
    const { value } = await rollD66();
    if ( byNumber.has(value) ) return byNumber.get(value);
  }
  return roles[Math.floor(Math.random() * roles.length)];
}

export function randomCodename() {
  return CODENAMES[Math.floor(Math.random() * CODENAMES.length)];
}

/**
 * Fill an operative with a random codename, role and two traits (like the FIST REF random merc).
 * Existing traits and role are replaced.
 */
export async function randomizeMerc(actor) {
  const old = actor.items.filter(i => ["trait", "role"].includes(i.type)).map(i => i.id);
  if ( old.length ) await actor.deleteEmbeddedDocuments("Item", old);
  const first = await randomTrait();
  const second = await randomTrait({ exclude: [first?.name] });
  const role = await randomRole({ actor });
  const codename = randomCodename();
  await actor.update({ name: codename, "system.codename": codename });
  for ( const doc of [first, second, role].filter(d => d) ) {
    await actor.createEmbeddedDocuments("Item", [doc.toObject()]);
  }
  const step = actor.system.creation.bonus ? 4 : 2;
  await actor.update({ "system.creation.step": step });
  return actor;
}

/* -------------------------------------------- */
/*  FIST REF terminal                           */
/* -------------------------------------------- */

/**
 * A field terminal with the random merc / trait / role / codename generators.
 */
export class FistTerminal extends HandlebarsApplicationMixin(ApplicationV2) {

  static DEFAULT_OPTIONS = {
    id: "fist-terminal",
    classes: ["fist", "fist-terminal"],
    window: { title: "FIST.Terminal.Title", icon: "fa-solid fa-terminal", resizable: true },
    position: { width: 640, height: 720 },
    actions: {
      rerollAll: FistTerminal.#rerollAll,
      rerollTrait: FistTerminal.#rerollTrait,
      rerollRole: FistTerminal.#rerollRole,
      rerollCodename: FistTerminal.#rerollCodename,
      createMerc: FistTerminal.#createMerc,
      openDoc: FistTerminal.#openDoc,
      rollTable: FistTerminal.#rollTable
    }
  };

  static PARTS = {
    main: { template: "systems/fist/templates/apps/terminal.hbs", scrollable: [".terminal-body"] }
  };

  /** Current draw. */
  merc = null;

  async _prepareContext(options) {
    if ( !this.merc ) await this.#drawAll();
    const traits = await Promise.all(this.merc.traits.map(async t => ({
      uuid: t.uuid, name: t.name, number: t.system.number, item: t.system.itemText, stat: t.system.statText,
      effect: await TextEditor.enrichHTML(t.system.effect)
    })));
    const role = this.merc.role;
    const tables = (await game.packs.get(FIST.compendiums.tables)?.getIndex()) ?? [];
    const attrs = { frc: 0, tac: 0, cre: 0, rfx: 0 };
    for ( const t of this.merc.traits ) for ( const k of Object.keys(attrs) ) attrs[k] += t.system.mods[k];
    return {
      codename: this.merc.codename,
      role: role ? { uuid: role.uuid, name: role.name, number: role.system.number, describe: role.system.describe, advance: role.system.advance } : null,
      traits,
      attributes: Object.entries(attrs).map(([k, v]) => ({ abbr: FIST.attributes[k].abbr, label: game.i18n.localize(FIST.attributes[k].label), value: (v >= 0 ? "+" : "") + v })),
      tables: tables.contents?.map(t => ({ uuid: t.uuid, name: t.name })).sort((a, b) => a.name.localeCompare(b.name)) ?? [],
      canCreate: game.user.can("ACTOR_CREATE")
    };
  }

  async #drawAll() {
    const first = await randomTrait();
    const second = await randomTrait({ exclude: [first?.name] });
    this.merc = { codename: randomCodename(), traits: [first, second].filter(t => t), role: await randomRole() };
  }

  static async #rerollAll() {
    await this.#drawAll();
    this.render();
  }

  static async #rerollTrait(event, target) {
    const index = Number(target.dataset.index);
    this.merc.traits[index] = await randomTrait({ exclude: this.merc.traits.map(t => t.name) });
    this.render();
  }

  static async #rerollRole() {
    this.merc.role = await randomRole();
    this.render();
  }

  static #rerollCodename() {
    this.merc.codename = randomCodename();
    this.render();
  }

  static async #createMerc() {
    const actor = await Actor.implementation.create({
      name: this.merc.codename, type: "merc",
      system: { codename: this.merc.codename, creation: { step: 2 } }
    });
    if ( !actor ) return;
    for ( const doc of [...this.merc.traits, this.merc.role].filter(d => d) ) {
      await actor.createEmbeddedDocuments("Item", [doc.toObject()]);
    }
    actor.sheet.render(true);
  }

  static async #openDoc(event, target) {
    const doc = await fromUuid(target.dataset.uuid);
    doc?.sheet.render(true);
  }

  static async #rollTable(event, target) {
    const table = await fromUuid(target.dataset.uuid);
    return table?.draw();
  }
}
