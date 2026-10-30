import { FIST } from "../config.mjs";

const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;
const { renderTemplate } = foundry.applications.handlebars;

/* -------------------------------------------- */
/*  "Yes, but..." partial success complications */
/* -------------------------------------------- */

/**
 * Post a partial success complication to chat.
 * @param {object} options
 * @param {string} options.category  Key of FIST.partialSuccesses
 * @param {number} options.index     Entry index (0-5)
 * @param {Roll} [options.roll]      The roll that drew it, if any
 * @param {string} [options.target]  Name of who rolled the partial success
 * @param {boolean} [options.whisper] Show the result to the referee only
 */
export async function postPartialSuccess({ category, index, roll = null, target = "", whisper = false }) {
  const cat = FIST.partialSuccesses[category];
  const keys = Object.keys(FIST.partialSuccesses);
  const code = `${keys.indexOf(category) + 1}${index + 1}`;
  const faces = roll?.dice[0]?.results.map(r => ({ value: r.result, kind: "base" })) ?? [];
  const content = await renderTemplate("systems/fist/templates/chat/partial-card.hbs", {
    code, faces,
    formula: roll ? (faces.length > 1 ? "D66" : "1D6") : "",
    target: target ? game.i18n.format("FIST.Partial.For", { name: target }) : "",
    categoryLabel: game.i18n.localize(cat.label),
    icon: cat.icon,
    text: game.i18n.localize(cat.entries[index])
  });
  const messageData = {
    speaker: ChatMessage.implementation.getSpeaker({ alias: game.i18n.localize("FIST.Partial.Title") }),
    content,
    rolls: roll ? [roll] : [],
    flags: { fist: { kind: "partial", category, index } }
  };
  if ( roll ) messageData.sound = CONFIG.sounds.dice;
  if ( whisper ) messageData.whisper = ChatMessage.implementation.getWhisperRecipients("GM").map(u => u.id);
  return ChatMessage.implementation.create(messageData);
}

/** Roll D66 on the whole table: the tens die picks the category, the units die the entry. */
export async function rollPartialSuccess(options = {}) {
  const roll = await new Roll("2d6").evaluate();
  const [a, b] = roll.dice[0].results.map(r => r.result);
  const category = Object.keys(FIST.partialSuccesses)[a - 1];
  return postPartialSuccess({ ...options, category, index: b - 1, roll });
}

/** Roll 1D6 inside one category. */
export async function rollPartialCategory(category, options = {}) {
  const roll = await new Roll("1d6").evaluate();
  return postPartialSuccess({ ...options, category, index: roll.total - 1, roll });
}

/**
 * Referee window to roll or pick a "Yes, but..." complication.
 */
export class PartialSuccessPicker extends HandlebarsApplicationMixin(ApplicationV2) {

  constructor({ target = "", ...options } = {}) {
    super(options);
    this.target = target;
  }

  static DEFAULT_OPTIONS = {
    classes: ["fist", "fist-partial"],
    window: { title: "FIST.Partial.Title", icon: "fa-solid fa-scale-unbalanced", resizable: true },
    position: { width: 620, height: "auto" },
    actions: {
      rollAll: PartialSuccessPicker.#rollAll,
      rollCategory: PartialSuccessPicker.#rollCategory,
      choose: PartialSuccessPicker.#choose
    }
  };

  static PARTS = {
    main: { template: "systems/fist/templates/apps/partial-picker.hbs", scrollable: [".partial-grid"] }
  };

  async _prepareContext(options) {
    return {
      target: this.target ? game.i18n.format("FIST.Partial.For", { name: this.target }) : "",
      categories: Object.entries(FIST.partialSuccesses).map(([key, cat], c) => ({
        key, icon: cat.icon, number: c + 1,
        label: game.i18n.localize(cat.label),
        entries: cat.entries.map((e, i) => ({ index: i, code: `${c + 1}${i + 1}`, text: game.i18n.localize(e) }))
      }))
    };
  }

  /** Options shared by every draw from this window. */
  get #drawOptions() {
    return { target: this.target, whisper: !!this.element.querySelector("[name=whisper]")?.checked };
  }

  static async #rollAll() {
    await rollPartialSuccess(this.#drawOptions);
    this.close();
  }

  static async #rollCategory(event, target) {
    await rollPartialCategory(target.dataset.category, this.#drawOptions);
    this.close();
  }

  static async #choose(event, target) {
    await postPartialSuccess({ ...this.#drawOptions, category: target.dataset.category, index: Number(target.dataset.index) });
    this.close();
  }
}
