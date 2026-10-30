import { FIST } from "../config.mjs";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ItemSheetV2 } = foundry.applications.sheets;
const TextEditor = foundry.applications.ux.TextEditor.implementation;

/**
 * One sheet for every FIST item type, styled as a classified file card.
 */
export class FistItemSheet extends HandlebarsApplicationMixin(ItemSheetV2) {

  static DEFAULT_OPTIONS = {
    classes: ["fist", "fist-sheet", "fist-item"],
    position: { width: 560, height: "auto" },
    form: { submitOnChange: true },
    window: { resizable: true },
    actions: {
      editImage: FistItemSheet.#onEditImage,
      removeTag: FistItemSheet.#onRemoveTag,
      addGrant: FistItemSheet.#onAddGrant,
      removeGrant: FistItemSheet.#onRemoveGrant,
      toChat: FistItemSheet.#onToChat
    }
  };

  static PARTS = {
    sheet: { template: "systems/fist/templates/item/item-sheet.hbs", scrollable: [".sheet-scroll"] }
  };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const item = this.item;
    const system = item.system;
    const htmlField = item.type === "trait" ? "effect" : (item.type === "role" ? "answer" : "description");
    Object.assign(context, {
      item,
      system,
      source: system._source,
      fields: system.schema.fields,
      editable: this.isEditable,
      type: item.type,
      typeLabel: game.i18n.localize(`TYPES.Item.${item.type}`),
      isType: { [item.type]: true },
      htmlField,
      htmlValue: system[htmlField],
      enriched: await TextEditor.enrichHTML(system[htmlField] ?? "", { relativeTo: item, secrets: item.isOwner }),
      attributeChoices: { "": "—", frc: "FORCEFUL", tac: "TACTICAL", cre: "CREATIVE", rfx: "REFLEXIVE" },
      grants: (system.grants ?? []).map((g, i) => ({ index: i, name: g.name, type: game.i18n.localize(`TYPES.Item.${g.type}`), img: g.img })),
      grantedBy: item.parent?.items.get(item.getFlag("fist", "grantedBy"))?.name ?? ""
    });
    return context;
  }

  _onRender(context, options) {
    super._onRender(context, options);
    // Accept tags (on weapons) and items (on traits, as granted items)
    new foundry.applications.ux.DragDrop.implementation({
      dropSelector: ".fist-item-drop",
      permissions: { drop: () => this.isEditable },
      callbacks: { drop: this.#onDrop.bind(this) }
    }).bind(this.element);
  }

  async #onDrop(event) {
    const data = TextEditor.getDragEventData(event);
    if ( data.type !== "Item" ) return;
    const dropped = await Item.implementation.fromDropData(data);
    if ( !dropped ) return;
    if ( (this.item.type === "weapon") && (dropped.type === "tag") ) return this.item.addTag(dropped);
    if ( (this.item.type === "trait") && ["weapon", "armor", "gear"].includes(dropped.type) ) {
      const grants = foundry.utils.deepClone(this.item.system.toObject().grants);
      const obj = dropped.toObject();
      delete obj._id;
      grants.push(obj);
      return this.item.update({ "system.grants": grants });
    }
  }

  static async #onEditImage(event, target) {
    if ( !this.isEditable ) return;
    const FilePicker = foundry.applications.apps.FilePicker.implementation;
    return new FilePicker({ type: "image", current: this.item.img, callback: path => this.item.update({ img: path }) }).browse();
  }

  static #onRemoveTag(event, target) {
    return this.item.removeTag(Number(target.dataset.index));
  }

  static async #onAddGrant(event, target) {
    const grants = foundry.utils.deepClone(this.item.system.toObject().grants);
    grants.push({ name: game.i18n.localize("FIST.Trait.NewGrant"), type: target.dataset.type || "gear", img: FIST.defaultIcons[target.dataset.type || "gear"], system: {} });
    return this.item.update({ "system.grants": grants });
  }

  static #onRemoveGrant(event, target) {
    const grants = foundry.utils.deepClone(this.item.system.toObject().grants);
    grants.splice(Number(target.dataset.index), 1);
    return this.item.update({ "system.grants": grants });
  }

  static #onToChat() {
    return this.item.toChat();
  }
}
