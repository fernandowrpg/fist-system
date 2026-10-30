/**
 * FIST: Ultra Edition — unofficial Foundry VTT system.
 * Rules text from FIST: Ultra Edition by CLAYMORE, CC BY-SA 4.0.
 */
import { FIST } from "./module/config.mjs";
import { MercData, NpcData, VehicleData } from "./module/data/actor-models.mjs";
import { TraitData, RoleData, WeaponData, ArmorData, GearData, TagData, AbilityData } from "./module/data/item-models.mjs";
import { FistActor } from "./module/documents/actor.mjs";
import { FistItem } from "./module/documents/item.mjs";
import { MercSheet } from "./module/sheets/merc-sheet.mjs";
import { NpcSheet, VehicleSheet } from "./module/sheets/npc-sheets.mjs";
import { FistItemSheet } from "./module/sheets/item-sheet.mjs";
import { FistTerminal } from "./module/apps/generator.mjs";
import * as Generator from "./module/apps/generator.mjs";
import * as Rolls from "./module/dice/rolls.mjs";
import * as Partial from "./module/apps/partial.mjs";

Hooks.once("init", () => {
  console.log("FIST | Freelance Infantry Strike Team online.");
  CONFIG.FIST = FIST;

  CONFIG.Actor.documentClass = FistActor;
  CONFIG.Item.documentClass = FistItem;
  Object.assign(CONFIG.Actor.dataModels, { merc: MercData, npc: NpcData, vehicle: VehicleData });
  Object.assign(CONFIG.Item.dataModels, {
    trait: TraitData, role: RoleData, weapon: WeaponData, armor: ArmorData, gear: GearData, tag: TagData, ability: AbilityData
  });
  CONFIG.Actor.trackableAttributes = {
    merc: { bar: ["hp"], value: ["warDice.value", "armor.value"] },
    npc: { bar: ["hp"], value: ["armor"] },
    vehicle: { bar: ["hp"], value: ["armor"] }
  };

  const DSC = foundry.applications.apps.DocumentSheetConfig;
  DSC.registerSheet(Actor, "fist", MercSheet, { types: ["merc"], makeDefault: true, label: "FIST.Sheet.Merc" });
  DSC.registerSheet(Actor, "fist", NpcSheet, { types: ["npc"], makeDefault: true, label: "FIST.Sheet.Npc" });
  DSC.registerSheet(Actor, "fist", VehicleSheet, { types: ["vehicle"], makeDefault: true, label: "FIST.Sheet.Vehicle" });
  DSC.registerSheet(Item, "fist", FistItemSheet, { makeDefault: true, label: "FIST.Sheet.Item" });

  registerSettings();
  registerHelpers();

  foundry.applications.handlebars.loadTemplates([
    "systems/fist/templates/parts/item-row.hbs",
    "systems/fist/templates/parts/dice.hbs",
    "systems/fist/templates/actor/parts/merc-builder.hbs"
  ]);

  game.fist = {
    FIST, Rolls, Generator, Partial,
    terminal: () => new FistTerminal().render(true),
    partialSuccess: (options = {}) => new Partial.PartialSuccessPicker(options).render(true)
  };
});

/* -------------------------------------------- */

function registerSettings() {
  const rule = (key, def = false) => game.settings.register("fist", key, {
    name: `FIST.Setting.${key}.name`,
    hint: `FIST.Setting.${key}.hint`,
    scope: "world",
    config: true,
    type: Boolean,
    default: def
  });
  rule("ammoTracking");
  rule("explodingWarDice");
  rule("suddenDeath");
  rule("encumbrance");
}

function registerHelpers() {
  Handlebars.registerHelper("fistSigned", n => {
    n = Number(n) || 0;
    return n >= 0 ? `+${n}` : `${n}`;
  });
  Handlebars.registerHelper("fistUpper", s => String(s ?? "").toUpperCase());
  Handlebars.registerHelper("fistPad", (n, len) => String(n ?? 0).padStart(Number(len) || 3, "0"));
}

/* -------------------------------------------- */

Hooks.once("ready", () => Rolls.registerSocket());
Hooks.on("renderChatMessageHTML", (message, html) => Rolls.onRenderChatMessage(message, html));

/** Add the FIST REF terminal button to the actors directory. */
Hooks.on("renderActorDirectory", (app, html) => {
  const element = html instanceof HTMLElement ? html : html[0];
  if ( !element || element.querySelector(".fist-terminal-button") ) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "fist-terminal-button";
  button.innerHTML = `<i class="fa-solid fa-terminal"></i> ${game.i18n.localize("FIST.Terminal.Open")}`;
  button.addEventListener("click", () => game.fist.terminal());
  const target = element.querySelector(".header-actions") ?? element.querySelector(".directory-header");
  target?.append(button);
  if ( game.user.isGM ) {
    const partial = document.createElement("button");
    partial.type = "button";
    partial.className = "fist-terminal-button fist-partial-button";
    partial.innerHTML = `<i class="fa-solid fa-scale-unbalanced"></i> ${game.i18n.localize("FIST.Partial.Open")}`;
    partial.dataset.tooltip = game.i18n.localize("FIST.Partial.Hint");
    partial.addEventListener("click", () => game.fist.partialSuccess());
    target?.append(partial);
  }
});

/** New operatives start in the builder; new NPCs use the MEDIUM threat guideline. */
Hooks.on("preCreateActor", (actor, data) => {
  if ( (actor.type === "merc") && !data.img ) actor.updateSource({ img: "systems/fist/assets/operative.svg" });
  if ( (actor.type === "npc") && !data.img ) actor.updateSource({ img: "systems/fist/assets/hostile.svg" });
  if ( (actor.type === "vehicle") && !data.img ) actor.updateSource({ img: "systems/fist/assets/vehicle.svg" });
});

/** Mark the character graveyard: notify when an operative dies. */
Hooks.on("updateActor", (actor, changes, options, userId) => {
  if ( (game.user.id !== userId) || (actor.type !== "merc") ) return;
  const hp = foundry.utils.getProperty(changes, "system.hp.value");
  if ( (hp === 0) ) {
    ChatMessage.implementation.create({
      speaker: ChatMessage.implementation.getSpeaker({ actor }),
      content: `<div class="fist-note dead kia"><strong>KIA</strong> ${game.i18n.format("FIST.Death.Message", { name: actor.name })}</div>`
    });
  }
});
