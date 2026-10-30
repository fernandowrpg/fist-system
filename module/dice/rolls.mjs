import { FIST } from "../config.mjs";

const { renderTemplate } = foundry.applications.handlebars;
const { DialogV2 } = foundry.applications.api;

/* -------------------------------------------- */
/*  Helpers                                     */
/* -------------------------------------------- */

/** Classify a total into an outcome key. */
export function outcomeFor(total, ultra = false) {
  if ( ultra ) return "ultra";
  if ( total >= 10 ) return "success";
  if ( total >= 7 ) return "partial";
  return "failure";
}

/** Collect the dice of a roll as simple objects for chat display. */
function diceFaces(roll) {
  const faces = [];
  for ( const term of roll.dice ) {
    const kind = term.flavor === "war" ? "war" : "base";
    for ( const r of term.results ) {
      faces.push({ value: r.result, kind, dropped: r.active === false || r.discarded, exploded: !!r.exploded });
    }
  }
  return faces;
}

/** Signed number label. */
export function signed(n) {
  n = Number(n) || 0;
  return n >= 0 ? `+${n}` : `${n}`;
}

/** Whether the explosion dice of an exploding war die roll include a 1 (the roll becomes 0). */
function warDiceBust(roll, count) {
  const term = roll.dice.find(d => d.flavor === "war");
  if ( !term ) return false;
  return term.results.slice(count).some(r => r.result === 1);
}

/** Resolve the actor a user acts as: their assigned character, else a controlled owned token. */
export function userActor() {
  const controlled = canvas?.tokens?.controlled.map(t => t.actor).filter(a => a?.isOwner) ?? [];
  if ( controlled.length === 1 ) return controlled[0];
  return game.user.character ?? controlled[0] ?? null;
}

/* -------------------------------------------- */
/*  Risky rolls                                 */
/* -------------------------------------------- */

/**
 * Prompt for the details of a risky roll.
 * @returns {Promise<object|null>}
 */
export async function promptCheck(actor, { attribute = "frc", label = "", item = null } = {}) {
  const warDice = actor.system.warDice?.value ?? 0;
  const content = await renderTemplate("systems/fist/templates/apps/roll-dialog.hbs", {
    attributes: Object.entries(FIST.attributes).map(([k, v]) => ({
      key: k, abbr: v.abbr, label: game.i18n.localize(v.label), value: actor.system.attributes?.[k]?.value ?? 0,
      checked: k === attribute
    })),
    modes: Object.entries(FIST.rollModes).map(([k, v]) => ({ key: k, label: game.i18n.localize(v.label), checked: k === "normal" })),
    warDice,
    hasWarDice: actor.type === "merc",
    label
  });
  const result = await DialogV2.wait({
    window: { title: label || game.i18n.localize("FIST.Roll.Risky"), icon: "fa-solid fa-dice" },
    classes: ["fist", "fist-dialog"],
    position: { width: 440 },
    content,
    buttons: [{
      action: "roll",
      label: "FIST.Roll.Roll",
      icon: "fa-solid fa-dice-six",
      default: true,
      callback: (event, button) => {
        const f = button.form.elements;
        return {
          attribute: f.attribute.value,
          mode: f.mode.value,
          situational: Number(f.situational.value) || 0,
          assist: Number(f.assist.value) || 0,
          warDice: Math.clamp(Number(f.warDice?.value) || 0, 0, warDice)
        };
      }
    }],
    rejectClose: false
  });
  return result ?? null;
}

/**
 * Perform a risky 2D6 + attribute roll and post it to chat.
 * @param {Actor} actor
 * @param {object} options
 */
export async function rollCheck(actor, { attribute = "frc", mode = "normal", situational = 0, assist = 0, warDice = 0,
  label = "", item = null } = {}) {
  const attrValue = actor.system.attributes?.[attribute]?.value ?? 0;
  const exploding = game.settings.get("fist", "explodingWarDice");
  const parts = [FIST.rollModes[mode]?.formula ?? "2d6"];
  if ( attrValue ) parts.push(String(attrValue));
  if ( situational ) parts.push(String(situational));
  if ( assist ) parts.push(String(assist));
  if ( warDice > 0 ) parts.push(`${warDice}d6${exploding ? "x6" : ""}[war]`);
  const warBonus = warDice > 0 ? (actor.system.warDice?.bonus ?? 0) * warDice : 0;
  if ( warBonus ) parts.push(String(warBonus));
  const roll = await new Roll(parts.join(" + ").replace(/\+ -/g, "- ")).evaluate();

  // Spend the war dice
  if ( (warDice > 0) && (actor.type === "merc") ) {
    await actor.update({ "system.warDice.value": Math.max(actor.system.warDice.value - warDice, 0) });
  }

  const base = roll.dice[0];
  const kept = base.results.filter(r => r.active !== false && !r.discarded).map(r => r.result);
  const ultra = kept.length === 2 && kept.every(v => v === 6);
  const snakeEyes = kept.length === 2 && kept.every(v => v === 1);
  const bust = exploding && warDice > 0 && warDiceBust(roll, warDice);
  const total = bust ? 0 : roll.total;
  const outcome = outcomeFor(total, ultra);

  const attrLabel = FIST.attributes[attribute] ? game.i18n.localize(FIST.attributes[attribute].label) : "";
  const context = {
    actor, item, label: label || game.i18n.format("FIST.Roll.AttrRoll", { attr: attrLabel }),
    attrLabel, attrValue: signed(attrValue),
    modeLabel: mode !== "normal" ? game.i18n.localize(FIST.rollModes[mode].label) : "",
    situational: situational ? signed(situational) : "",
    assist: assist ? signed(assist) : "",
    warDice, warBonus,
    faces: diceFaces(roll),
    total, bust,
    outcome,
    outcomeLabel: game.i18n.localize(FIST.outcomes[outcome].label),
    outcomeText: game.i18n.localize(FIST.outcomes[outcome].text),
    snakeEyes: snakeEyes && game.settings.get("fist", "suddenDeath"),
    canDamage: item?.type === "weapon" && ["partial", "success", "ultra"].includes(outcome),
    itemUuid: item?.uuid ?? "",
    flags: { kind: "check", total, ultra }
  };
  return postCard("systems/fist/templates/chat/check-card.hbs", context, { actor, rolls: [roll], flags: context.flags });
}

/* -------------------------------------------- */
/*  Damage                                      */
/* -------------------------------------------- */

/**
 * Roll damage and post a card with buttons to apply it.
 */
export async function rollDamage(actor, { formula, label = "", item = null, flavor = "" } = {}) {
  const roll = await new Roll(formula || "0", actor?.getRollData?.() ?? {}).evaluate();
  const context = {
    actor, item, label: label || item?.name || game.i18n.localize("FIST.Damage.Label"),
    flavor,
    formula: roll.formula.toUpperCase(),
    faces: diceFaces(roll),
    total: roll.total,
    flags: { kind: "damage", total: roll.total }
  };
  return postCard("systems/fist/templates/chat/damage-card.hbs", context, { actor, rolls: [roll], flags: context.flags });
}

/* -------------------------------------------- */
/*  Generic dice (D66, X-in-1D6, emergency insertion)  */
/* -------------------------------------------- */

export async function rollSimple(actor, { formula, label, text = "", flavor = "" }) {
  const roll = await new Roll(formula).evaluate();
  const context = {
    actor, label, text, flavor,
    formula: roll.formula.toUpperCase(),
    faces: diceFaces(roll),
    total: roll.total,
    flags: { kind: "simple", total: roll.total }
  };
  await postCard("systems/fist/templates/chat/simple-card.hbs", context, { actor, rolls: [roll], flags: context.flags });
  return roll;
}

/** Roll D66 (two ordered dice read as digits). */
export async function rollD66(label = "D66") {
  const roll = await new Roll("2d6").evaluate();
  const [a, b] = roll.dice[0].results.map(r => r.result);
  return { roll, value: (a * 10) + b, index: ((a - 1) * 6) + (b - 1) };
}

/** Roll D666 (three ordered dice read as digits). */
export async function rollD666() {
  const roll = await new Roll("3d6").evaluate();
  const [a, b, c] = roll.dice[0].results.map(r => r.result);
  return { roll, value: (a * 100) + (b * 10) + c };
}

/* -------------------------------------------- */
/*  War dice spent on any roll                  */
/* -------------------------------------------- */

/**
 * Spend one WAR DIE from the user's operative to add +1D6 to an existing roll message.
 * Posts a follow-up card with the new total (players cannot edit each other's messages).
 */
export async function spendWarDieOn(message) {
  const actor = userActor();
  if ( !actor || actor.type !== "merc" ) return ui.notifications.warn("FIST.Warn.NoOperative", { localize: true });
  if ( actor.system.warDice.value <= 0 ) return ui.notifications.warn("FIST.Warn.NoWarDice", { localize: true });
  const data = message.flags.fist ?? {};
  const exploding = game.settings.get("fist", "explodingWarDice");
  const bonus = actor.system.warDice.bonus ?? 0;
  const roll = await new Roll(`1d6${exploding ? "x6" : ""}[war]${bonus ? ` + ${bonus}` : ""}`).evaluate();
  await actor.update({ "system.warDice.value": actor.system.warDice.value - 1 });
  const bust = exploding && warDiceBust(roll, 1);
  const total = bust ? 0 : (data.total ?? 0) + roll.total;
  const kind = data.kind ?? "simple";
  const outcome = kind === "check" ? outcomeFor(total, data.ultra) : null;
  const context = {
    actor, kind,
    label: game.i18n.format("FIST.WarDie.SpentOn", { name: actor.name, target: message.speaker?.alias ?? message.alias ?? "" }),
    faces: diceFaces(roll),
    previous: data.total ?? 0,
    added: roll.total,
    total, bust,
    outcome,
    outcomeLabel: outcome ? game.i18n.localize(FIST.outcomes[outcome].label) : "",
    outcomeText: outcome ? game.i18n.localize(FIST.outcomes[outcome].text) : "",
    canDamage: kind === "check" && ["partial", "success", "ultra"].includes(outcome) && !!data.itemUuid,
    itemUuid: data.itemUuid ?? "",
    isDamage: kind === "damage",
    flags: { ...data, total, kind }
  };
  return postCard("systems/fist/templates/chat/war-die-card.hbs", context, { actor, rolls: [roll], flags: context.flags });
}

/* -------------------------------------------- */

async function postCard(template, context, { actor, rolls = [], flags = {} }) {
  if ( context.itemUuid ) flags.itemUuid = context.itemUuid;
  const content = await renderTemplate(template, context);
  return ChatMessage.implementation.create({
    speaker: ChatMessage.implementation.getSpeaker({ actor }),
    content,
    rolls,
    sound: CONFIG.sounds.dice,
    flags: { fist: flags }
  });
}

/* -------------------------------------------- */
/*  Chat card interactivity                     */
/* -------------------------------------------- */

/**
 * Bind button handlers on FIST chat cards.
 * @param {ChatMessage} message
 * @param {HTMLElement} html
 */
export function onRenderChatMessage(message, html) {
  for ( const button of html.querySelectorAll("[data-fist-action]") ) {
    button.addEventListener("click", event => onChatAction(event, message));
  }
}

async function onChatAction(event, message) {
  event.preventDefault();
  const button = event.currentTarget;
  const action = button.dataset.fistAction;
  const total = Number(button.dataset.total ?? message.flags.fist?.total ?? 0);
  switch ( action ) {
    case "warDie":
      return spendWarDieOn(message);
    case "damage": {
      const item = await fromUuid(button.dataset.itemUuid || message.flags.fist?.itemUuid);
      if ( !item ) return;
      return item.rollDamage();
    }
    case "apply":
    case "applyRaw":
    case "applyDouble":
    case "heal":
      return applyToTargets(action, total);
  }
}

/** Apply damage or healing to controlled tokens (or targets if none are controlled). */
async function applyToTargets(action, amount) {
  let actors = canvas?.tokens?.controlled.map(t => t.actor) ?? [];
  if ( !actors.length ) actors = Array.from(game.user.targets).map(t => t.actor);
  actors = actors.filter(a => a);
  if ( !actors.length ) return ui.notifications.warn("FIST.Warn.NoTokens", { localize: true });
  for ( const actor of actors ) {
    if ( !actor.isOwner ) {
      ui.notifications.warn(game.i18n.format("FIST.Warn.NotOwner", { name: actor.name }));
      continue;
    }
    if ( action === "heal" ) await actor.applyHealing(amount);
    else await actor.applyDamage(amount, { ignoreArmor: action !== "apply", double: action === "applyDouble" });
  }
}
