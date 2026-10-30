const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;
const TextEditor = foundry.applications.ux.TextEditor.implementation;

/**
 * Shared behavior for FIST actor sheets: item controls, inline editing and drops.
 */
export class FistActorSheet extends HandlebarsApplicationMixin(ActorSheetV2) {

  static DEFAULT_OPTIONS = {
    classes: ["fist", "fist-sheet"],
    form: { submitOnChange: true },
    window: { resizable: true },
    actions: {
      itemEdit: FistActorSheet.#onItemEdit,
      itemDelete: FistActorSheet.#onItemDelete,
      itemChat: FistActorSheet.#onItemChat,
      itemEquip: FistActorSheet.#onItemEquip,
      itemUse: FistActorSheet.#onItemUse,
      itemAttack: FistActorSheet.#onItemAttack,
      itemDamage: FistActorSheet.#onItemDamage,
      itemShatter: FistActorSheet.#onItemShatter,
      itemToggle: FistActorSheet.#onItemToggle,
      removeTag: FistActorSheet.#onRemoveTag,
      itemCreate: FistActorSheet.#onItemCreate,
      openPack: FistActorSheet.#onOpenPack,
      editImage: FistActorSheet.#onEditImage
    }
  };

  /** Item ids whose details are expanded. */
  _expanded = new Set();

  /* -------------------------------------------- */

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    Object.assign(context, {
      actor: this.actor,
      system: this.actor.system,
      source: this.actor.system._source,
      fields: this.actor.system.schema.fields,
      editable: this.isEditable,
      owner: this.actor.isOwner,
      isGM: game.user.isGM,
      config: CONFIG.FIST
    });
    return context;
  }

  /** Prepare an item for display with enriched text. */
  async _prepareItem(item) {
    const body = item.system.effect ?? item.system.description ?? "";
    return {
      item,
      id: item.id,
      name: item.name,
      img: item.img,
      type: item.type,
      system: item.system,
      expanded: this._expanded.has(item.id),
      enriched: await TextEditor.enrichHTML(body, { relativeTo: item, secrets: item.isOwner }),
      granted: !!item.getFlag("fist", "grantedBy"),
      grantedBy: this.actor.items.get(item.getFlag("fist", "grantedBy"))?.name ?? "",
      usesPips: item.system.uses?.max > 0 && item.system.uses.max <= 10
        ? Array.from({ length: item.system.uses.max }, (_, i) => ({ filled: i < item.system.uses.value, index: i + 1 }))
        : null
    };
  }

  /* -------------------------------------------- */

  _onRender(context, options) {
    super._onRender(context, options);
    // Inline edits of embedded item fields: <input data-item-field="system.uses.value">
    for ( const input of this.element.querySelectorAll("[data-item-field]") ) {
      input.addEventListener("change", this.#onItemFieldChange.bind(this));
    }
    // Actor fields duplicated outside the main form fields: <input data-actor-field="system.codename">
    for ( const input of this.element.querySelectorAll("[data-actor-field]") ) {
      input.addEventListener("change", this.#onActorFieldChange.bind(this));
    }
    // Drag highlight for drop zones
    for ( const zone of this.element.querySelectorAll(".drop-zone") ) {
      zone.addEventListener("dragenter", () => zone.classList.add("drag-over"));
      zone.addEventListener("dragleave", () => zone.classList.remove("drag-over"));
      zone.addEventListener("drop", () => zone.classList.remove("drag-over"));
    }
  }

  async #onItemFieldChange(event) {
    event.stopPropagation();
    const input = event.currentTarget;
    const item = this.actor.items.get(input.closest("[data-item-id]")?.dataset.itemId);
    if ( !item ) return;
    let value = input.type === "checkbox" ? input.checked : input.value;
    if ( input.dataset.dtype === "Number" ) value = Number(value) || 0;
    await item.update({ [input.dataset.itemField]: value });
  }

  async #onActorFieldChange(event) {
    event.stopPropagation();
    const input = event.currentTarget;
    const path = input.dataset.actorField;
    const update = { [path]: input.value };
    if ( path === "system.codename" && input.value ) update.name = input.value;
    await this.actor.update(update);
  }

  /* -------------------------------------------- */
  /*  Drag & drop                                 */
  /* -------------------------------------------- */

  /** @override */
  async _onDropItem(event, item) {
    if ( !this.actor.isOwner ) return null;

    // Weapon tags attach to a weapon instead of being carried
    if ( item.type === "tag" ) return this._onDropTag(event, item);
    if ( !this._canAcceptItem(item) ) {
      ui.notifications.warn(game.i18n.format("FIST.Warn.CannotHold", { type: game.i18n.localize(`TYPES.Item.${item.type}`) }));
      return null;
    }
    return super._onDropItem(event, item);
  }

  /** Which item types this actor accepts. */
  _canAcceptItem(item) {
    return true;
  }

  async _onDropTag(event, tag) {
    const weapons = this.actor.items.filter(i => i.type === "weapon");
    if ( !weapons.length ) return ui.notifications.warn("FIST.Warn.NoWeapon", { localize: true });
    const targetId = event.target.closest("[data-item-id]")?.dataset.itemId;
    let weapon = weapons.find(w => w.id === targetId);
    if ( !weapon && weapons.length === 1 ) weapon = weapons[0];
    if ( !weapon ) {
      const id = await foundry.applications.api.DialogV2.wait({
        window: { title: game.i18n.format("FIST.Tag.Choose", { tag: tag.name }), icon: "fa-solid fa-screwdriver-wrench" },
        classes: ["fist", "fist-dialog"],
        content: `<p>${game.i18n.localize("FIST.Tag.ChooseHint")}</p>`,
        buttons: weapons.map(w => ({ action: w.id, label: w.name })),
        rejectClose: false
      });
      weapon = this.actor.items.get(id);
    }
    if ( weapon ) await weapon.addTag(tag);
    return weapon ?? null;
  }

  /** Make item rows draggable. */
  async _onDragStart(event) {
    const row = event.currentTarget.closest("[data-item-id]");
    if ( row && !event.currentTarget.dataset.itemId ) event.currentTarget.dataset.itemId = row.dataset.itemId;
    return super._onDragStart(event);
  }

  /* -------------------------------------------- */
  /*  Actions                                     */
  /* -------------------------------------------- */

  _getItem(target) {
    return this.actor.items.get(target.closest("[data-item-id]")?.dataset.itemId);
  }

  static #onItemEdit(event, target) {
    this._getItem(target)?.sheet.render(true);
  }

  static async #onItemDelete(event, target) {
    const item = this._getItem(target);
    if ( !item ) return;
    if ( item.getFlag("fist", "grantedBy") && !event.shiftKey ) {
      const ok = await foundry.applications.api.DialogV2.confirm({
        window: { title: "FIST.Item.DeleteGranted" },
        classes: ["fist", "fist-dialog"],
        content: `<p>${game.i18n.format("FIST.Item.DeleteGrantedHint", { name: item.name })}</p>`
      });
      if ( !ok ) return;
    }
    return item.delete();
  }

  static #onItemChat(event, target) {
    this._getItem(target)?.toChat();
  }

  static #onItemEquip(event, target) {
    this._getItem(target)?.toggleEquip();
  }

  static #onItemUse(event, target) {
    this._getItem(target)?.use();
  }

  static #onItemAttack(event, target) {
    this._getItem(target)?.attack();
  }

  static #onItemDamage(event, target) {
    this._getItem(target)?.rollDamage();
  }

  static #onItemShatter(event, target) {
    this._getItem(target)?.shatter();
  }

  static #onItemToggle(event, target) {
    const id = target.closest("[data-item-id]")?.dataset.itemId;
    if ( !id ) return;
    if ( this._expanded.has(id) ) this._expanded.delete(id);
    else this._expanded.add(id);
    target.closest("[data-item-id]").classList.toggle("expanded", this._expanded.has(id));
  }

  static #onRemoveTag(event, target) {
    const item = this._getItem(target);
    item?.removeTag(Number(target.dataset.index));
  }

  static async #onItemCreate(event, target) {
    const type = target.dataset.type;
    const name = game.i18n.format("DOCUMENT.New", { type: game.i18n.localize(`TYPES.Item.${type}`) });
    const [item] = await this.actor.createEmbeddedDocuments("Item", [{ name, type }]);
    item?.sheet.render(true);
  }

  static #onOpenPack(event, target) {
    game.packs.get(target.dataset.pack)?.render(true);
  }

  static async #onEditImage(event, target) {
    if ( !this.isEditable ) return;
    const FilePicker = foundry.applications.apps.FilePicker.implementation;
    const fp = new FilePicker({
      type: "image",
      current: this.actor.img,
      callback: path => this.actor.update({ img: path })
    });
    return fp.browse();
  }
}
