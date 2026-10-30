/**
 * Build the FIST compendium packs (LevelDB) from the JSON sources in src/.
 *
 *   node tools/build-packs.mjs [path-to-foundry-install]
 *
 * Uses classic-level from the project (npm install) or, failing that, the copy shipped with a Foundry install.
 * Also writes module/codenames.mjs from src/codenames.json.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FOUNDRY = process.argv[2] || process.env.FOUNDRY_PATH || "E:/foundry";
function loadClassicLevel() {
  for ( const base of [path.join(ROOT, "package.json"), path.join(FOUNDRY, "package.json")] ) {
    try {
      return createRequire(base)("classic-level");
    } catch {}
  }
  throw new Error("classic-level not found: run `npm install` or pass the path to a Foundry install.");
}
const { ClassicLevel } = loadClassicLevel();

const read = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, "src", f), "utf8"));
const SYSTEM_VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, "system.json"), "utf8")).version;
const STATS = { coreVersion: "13.351", systemId: "fist", systemVersion: SYSTEM_VERSION, createdTime: Date.now(), modifiedTime: Date.now(), lastModifiedBy: null };
const ICON = {
  trait: "systems/fist/assets/trait.svg",
  role: "systems/fist/assets/role.svg",
  tag: "systems/fist/assets/tag.svg",
  weapon: "icons/svg/sword.svg",
  armor: "icons/svg/shield.svg",
  gear: "icons/svg/item-bag.svg",
  ability: "icons/svg/lightning.svg",
  merc: "systems/fist/assets/operative.svg",
  npc: "systems/fist/assets/hostile.svg",
  vehicle: "systems/fist/assets/vehicle.svg",
  table: "icons/svg/d20-black.svg",
  journal: "icons/svg/book.svg"
};

/** Deterministic 16-char ids so rebuilding keeps UUIDs stable. */
function id(...parts) {
  const hash = crypto.createHash("sha1").update(parts.join("|")).digest();
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for ( let i = 0; i < 16; i++ ) out += chars[hash[i] % chars.length];
  return out;
}

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const p = (s) => s ? `<p>${esc(s)}</p>` : "";
const titleCase = (s) => s.toLowerCase().replace(/(^|[\s\-/(])([a-z])/g, (m, a, b) => a + b.toUpperCase());
const WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
const ATTR = { FORCEFUL: "frc", TACTICAL: "tac", CREATIVE: "cre", REFLEXIVE: "rfx", FRC: "frc", TAC: "tac", CRE: "cre", RFX: "rfx" };
const RANGED = /\b(gun|pistol|rifle|revolver|launcher|bow|smg|smgs|cannon|shotgun|blaster|crossbow|sling|slingshot|carbine|harpoon|thrower|flamethrower|grenade|grenades|dart|darts|needle gun|blowgun|railgun|laser|ray|musket|minigun|uzi|ak-47|m16|m1911|beretta|colt|magnum|bomb|mine|throwing|caltrops|net)\b/i;

/* -------------------------------------------- */
/*  Item text parsing ("Name (details)")         */
/* -------------------------------------------- */

/**
 * Turn an item string from the book into Item data.
 * e.g. "Hand cannon (1D6+1 DAMAGE)", "Power armor (2 ARMOR, cannot be unequipped)", "Coffee thermos (+1D6 HP, one use)"
 */
function parseItem(text, { key = "", flags = {} } = {}) {
  text = text.trim().replace(/\s+/g, " ");
  let prefix = "";
  const chance = text.match(/^(\d-in-1D6|Worst-of-2D6|Best-of-2D6|\d+D6|\d+):\s*/i);
  if ( chance && /in-1D6|of-2D6/i.test(chance[1]) ) {
    prefix = chance[1];
    text = text.slice(chance[0].length);
  }
  const open = text.indexOf("(");
  let name = open > 0 ? text.slice(0, open).trim() : text;
  const details = open > 0 ? text.slice(open + 1, text.lastIndexOf(")") > open ? text.lastIndexOf(")") : undefined).trim() : "";
  const all = `${name} ${details}`;
  const system = { description: "" };
  let type = "gear";

  const dmg = details.match(/(\d*D6(?:\s*[+-]\s*\d+)?(?:\+(?:FRC|TAC|CRE|RFX))?|\d+)\s+DAMAGE/i);
  const arm = details.match(/(\d+)\s+ARMOR/i);
  if ( dmg && !/negative DAMAGE/i.test(details) ) {
    type = "weapon";
    let f = dmg[1].toLowerCase().replace(/\s+/g, "").replace(/^d6/, "1d6");
    f = f.replace(/\+(frc|tac|cre|rfx)/, "+@$1");
    system.damage = f;
    system.ranged = RANGED.test(name);
    if ( /does not count as equipped|not count as equipped/i.test(details) ) system.freeSlot = true;
  } else if ( arm ) {
    type = "armor";
    system.armor = Number(arm[1]);
    if ( /accessory/i.test(details) ) system.accessory = true;
    if ( /equip as weapon/i.test(details) ) system.equipAsWeapon = true;
    if ( /cannot be unequipped|can't be removed|cannot remove/i.test(details) ) { system.locked = true; system.equipped = true; }
  } else if ( /\baccessory\b/i.test(details) ) {
    type = "armor";
    system.armor = 0;
    system.accessory = true;
  }

  const uses = details.match(/\b(one|two|three|four|five|six|\d+)\s+uses?\b/i);
  if ( uses ) {
    const n = WORDS[uses[1].toLowerCase()] ?? Number(uses[1]);
    system.uses = { value: n, max: n };
  }
  if ( /\bconsumable\b/i.test(details) ) system.consumable = true;
  const heal = details.match(/(?:\+|heals?\s+)(\d*D6(?:\s*\+\s*(?:\d+|TAC|CRE|FRC|RFX))?|\d+)\s+HP/i);
  if ( heal && !/MAX HP/i.test(details) ) {
    if ( type === "gear" ) system.heal = heal[1].toLowerCase().replace(/\s+/g, "").replace(/^d6/, "1d6").replace(/\+(frc|tac|cre|rfx)/, "+@$1");
  }

  if ( prefix ) name = `${name} [${prefix}]`;
  system.description = `<p>${esc(details || text)}</p>`;
  return {
    _id: id("item", key, text),
    name: name.charAt(0).toUpperCase() + name.slice(1),
    type,
    img: ICON[type],
    system,
    flags: { fist: { sourceText: text, ...flags } }
  };
}

/* -------------------------------------------- */
/*  Traits                                       */
/* -------------------------------------------- */

function parseStat(stat) {
  const mods = { frc: 0, tac: 0, cre: 0, rfx: 0, maxHp: 0, armor: 0, warDicePerMission: 0, warDieBonus: 0 };
  const out = { mods, maxHpFormula: "", chosenBonus: 0, conditional: "" };
  let m;
  if ( (m = stat.match(/^([+-]\d+) (FORCEFUL|TACTICAL|CREATIVE|REFLEXIVE)$/)) ) mods[ATTR[m[2]]] = Number(m[1]);
  else if ( (m = stat.match(/^([+-]\d+) MAX HP$/)) ) mods.maxHp = Number(m[1]);
  else if ( (m = stat.match(/^\+(\d*D6) MAX HP$/i)) ) out.maxHpFormula = m[1].toLowerCase().replace(/^d/, "1d");
  else if ( (m = stat.match(/^([+-]\d+) ARMOR at all times$/)) ) mods.armor = Number(m[1]);
  else if ( (m = stat.match(/^([+-]\d+) WAR DI(?:E|CE) per mission$/)) ) mods.warDicePerMission = Number(m[1]);
  else if ( (m = stat.match(/^([+-]\d+) to chosen attribute$/)) ) out.chosenBonus = Number(m[1]);
  else if ( (m = stat.match(/^([+-]\d+) when you roll WAR DICE$/)) ) mods.warDieBonus = Number(m[1]);
  else out.conditional = stat;
  return out;
}

function buildTraits() {
  return read("traits.json").map(t => {
    const stat = parseStat(t.stat || "");
    const _id = id("trait", t.number, t.name);
    const grant = t.item ? parseItem(t.item, { key: `trait-${t.number}`, flags: { traitItem: true } }) : null;
    if ( grant ) delete grant._id;
    return {
      _id,
      name: t.name,
      type: "trait",
      img: ICON.trait,
      system: {
        number: t.number,
        effect: p(t.effect),
        itemText: t.item || "",
        statText: t.stat || "",
        ...stat,
        rolledHp: 0,
        chosenAttribute: "",
        grants: grant ? [grant] : []
      },
      flags: { fist: { source: "FIST: Ultra Edition, Traits index" } }
    };
  });
}

/* -------------------------------------------- */
/*  Roles                                        */
/* -------------------------------------------- */

function buildRoles() {
  return read("roles.json").map(r => {
    const idx = r.text.search(/\bAdvance\b/);
    const describe = idx >= 0 ? r.text.slice(0, idx).trim() : r.text;
    const advance = idx >= 0 ? r.text.slice(idx).replace(/^Advance\s+/, "").replace(/^\(/, "(") : "";
    return {
      _id: id("role", r.number, r.name),
      name: r.name,
      type: "role",
      img: ICON.role,
      system: { number: r.number, describe, advance: advance.charAt(0).toUpperCase() + advance.slice(1), answer: "" },
      flags: { fist: { source: "FIST: Ultra Edition, Roles index" } }
    };
  });
}

/* -------------------------------------------- */
/*  Gear tables (p. 83-88)                       */
/* -------------------------------------------- */

const D66 = [11, 12, 13, 14, 15, 16, 21, 22, 23, 24, 25, 26, 31, 32, 33, 34, 35, 36, 41, 42, 43, 44, 45, 46, 51, 52, 53, 54, 55, 56, 61, 62, 63, 64, 65, 66];

const WEAPONS = [
  ["Small blunt", "baton, cane, etc.", "3"], ["Large blunt", "bat, crowbar, etc.", "1d6"], ["Small blade", "pocketknife, hatchet, etc.", "3"],
  ["Large blade", "combat knife, axe, etc.", "1d6"], ["Light hand", "wraps, thick gloves, etc.", "3"], ["Heavy hand", "knuckle dusters, etc.", "1d6"],
  ["Small ranged", "slingshot, BB gun, etc.", "3", true], ["Whip", "", "1d6"], ["Bow", "", "1d6", true], ["Pistol", "", "1d6", true],
  ["Machine pistol", "", "1d6", true], ["Submachine gun", "", "1d6", true], ["Carbine", "", "1d6", true], ["Hand cannon", "", "1d6+1", true],
  ["Bolt-action rifle", "", "1d6+1", true], ["Semi-automatic rifle", "", "1d6+1", true], ["Assault rifle", "", "1d6+1", true],
  ["Break-action shotgun", "", "1d6+1", true], ["Pump-action shotgun", "", "1d6+1", true], ["Light machine gun", "", "1d6+1", true],
  ["Sword", "", "1d6+1"], ["Spear", "", "1d6+1"], ["Large axe", "", "1d6+1"], ["Large hammer", "", "1d6+1"], ["Sniper rifle", "", "1d6+2", true],
  ["Rocket launcher", "", "1d6+2", true], ["Heavy machine gun", "", "1d6+2", true], ["Heavy misc.", "e.g. railgun, laser", "1d6+2", true],
  ["Energy blade", "e.g. beam, magic", "1d6+2"], ["Concussion grenade", "", "1d6", true, true], ["Frag grenade", "", "1d6+1", true, true],
  ["Small bomb", "e.g. landmine, pipe", "1d6+2", false, true], ["Large bomb", "e.g. C4 setup", "2d6", false, true], ["Anomalous weapon", "", "2d6"],
  ["Ultra-shotgun", "", "2d6", true], ["FUBAR blaster", "", "3d6", true]
];

const ARMOR = [
  [2, "Combat shield", 0, { accessory: true }], [3, "Riot shield", 1, { equipAsWeapon: true }], [4, "Heavy riot shield", 2, { equipAsWeapon: true }],
  [5, "Helmet", 1, { accessory: true }], [6, "Civilian clothing", 0, {}], [7, "Standard fatigues", 0, {}], [8, "Tactical clothing", 1, {}],
  [9, "Bulletproof vest", 1, {}], [10, "Exoskeleton frame", 1, {}], [11, "Ceramic plate", 2, {}], [12, "Power armor", 2, {}]
];

const VEHICLE_WEAPONS = [
  [2, "Auto-targeting prototype cannon", "2d6", ""], [3, "Side hazards", "3", "e.g. spikes, laser jets"], [4, "Homing missiles", "1d6+2", "1D6 missiles"],
  [5, "Mounted gun", "1d6+1", ""], [6, "Gunner seats", "0", "1D6 seats"], [7, "Front-mounted ram", "0", "No crash self-damage"],
  [8, "Mounted heavy weapon", "1d6+2", ""], [9, "Integrated weapons", "1d6", "1D6 weapons"], [10, "Mounted grenade launcher", "1d6", ""],
  [11, "Mine dropper", "2d6", "1D6 mines"], [12, "Chemical weapon system", "2d6", "2D6 DAMAGE to area"]
];

const TAGS = [
  ["ACCURATE", "Scoped, sighted, or well-balanced; this weapon grants one automatic success when attacking per mission."],
  ["ANTI-MATERIEL", "Deals double DAMAGE to vehicles and structures; cumbersome to carry around."],
  ["ALT-FIRE", "This weapon has a secondary component or form which also deals damage, (e.g. bayonet, launcher attachment, sword that becomes a whip)."],
  ["ARMOR-PIERCING", "Attacks with this weapon ignore ARMOR bonuses granted by physical means."],
  ["BANE", "Forged from (or fires) a magically useful material of your choice (silver, salt, etc.) Deals double DAMAGE to those affected."],
  ["COLLAPSIBLE", "Easily concealed, no matter the size; will never be detected during pat-downs."],
  ["CURSED", "Requires powerful magic to remove once equipped. The wielder may permanently spend 1D6 MAX HP to guarantee a successful attack."],
  ["CUSTOMIZED", "Deals an additional 1 DAMAGE and has a weapon skin (p. 141); coveted by enemies.", { damageBonus: 1 }],
  ["DUMMY", "Appears to be a weapon, but is actually another mundane item of your choice (e.g. gun lighter, fake sword with a hidden compartment)."],
  ["ELECTRIFIED", "Deals double DAMAGE to robots and other complex machines. Shorts out running electronics and briefly electrifies bodies of water."],
  ["EXPERIMENTAL", "When each mission begins, roll D66 on this table for the weapon's effect (if you get EXPERIMENTAL, create a new one with the ref)."],
  ["FLASHY", "If you describe a unique and bombastic attack with this weapon, you can roll +CREATIVE to hit."],
  ["GRIP", "Custom materials and ergonomic design; the referee can never state that you drop this weapon."],
  ["HEAVY", "This thing is too big to be called a weapon. Once per mission, take +3 on a FORCEFUL roll that involves this weapon."],
  ["HUD", "Scans hostiles. When you kill something new, the referee will tell you a useful fact about it."],
  ["ICE", "Makes surfaces slick and deals double DAMAGE to anything that requires warmth to function."],
  ["INCENDIARY", "When damage is dealt, this weapon also deals 2 DAMAGE to anything within fire-spreading range. Deals double DAMAGE to plants."],
  ["INDESTRUCTIBLE", "Impervious to everything; can withstand any amount of pressure or corrosion."],
  ["LIGHT", "Weighs almost nothing. Grants +1 on REFLEXIVE rolls that involve this weapon."],
  ["LOUD", "Attacks with this weapon draw the undivided attention of enemies within earshot (and instantly reveal your position)."],
  ["LUCKY", "Rolling an ultra success while attacking with this weapon grants the user one WAR DIE."],
  ["MEDICAL", "Once per mission, you may use this weapon to deal negative DAMAGE, healing the target."],
  ["MESSY", "Enemies explode into gore/goo/scrap etc. on ultra successes (in addition to the usual bonus). No identifiers will remain—not even teeth."],
  ["MENACING", "Enemies who see a comrade slain by this weapon have a 1-in-1D6 chance to flee."],
  ["NON-LETHAL", "Does not deal DAMAGE; has a 3-in-1D6 chance to knock unconscious on a success."],
  ["POISONED", "When you would roll for damage for this weapon, wait and mark your target as poisoned instead. Next time they're hurt, roll your DAMAGE and add it to the total amount they take."],
  ["PROTOTYPE", "Wielding this next-generation weapon grants +1 TACTICAL; roll +TAC to attack with it.", { attribute: "tac", attributeBonus: 1 }],
  ["QUICK-DRAW", "Attacks that target enemies drawing their weapons will always succeed."],
  ["REMOTE", "Projectiles (or the weapon itself) can be remotely steered through chutes and around walls."],
  ["RITUAL", "Shatters to protect you from death once, negating lethal damage. Disintegrates afterward."],
  ["SAPIENT", "Communicates with its wielder by thought; roll 1D6 for disposition: bloodthirsty, caring, craven, excitable, morose, stoic."],
  ["SHREDDER", "Deals double DAMAGE to exposed flesh. On critical hits, decreases the target's ARMOR by 1."],
  ["STUN", "Those damaged by this weapon cannot move or act until their current HP changes."],
  ["TRANQUILIZER", "As NON-LETHAL, but chance is increased to 5-in-1D6 if a vulnerable area is specifically targeted (e.g. head, neck, exposed membrane, etc.)"],
  ["UNSTABLE", "Can be set to overload to deal triple DAMAGE once; explodes for 3D6 damage to everyone nearby seconds later."],
  ["VALUABLE", "Utterly unique in history or make. Can be used as a bargaining chip in almost any situation."]
];

const COMMON_ITEMS = ["1D6 crates", "10 foot chain", "5 gallon bucket", "50 foot rope", "Analgesic", "Bag of chips", "Ballpoint pen", "Beer bottle",
  "Can of soda", "Car keys", "Cassette player", "Cassette tape", "Chewing gum", "Cigarettes", "Cigars", "Cosmetics kit", "Coupon book", "Crowbar",
  "Duffel bag", "Fertilizer", "Flashlight", "Flip lighter", "Gas can", "Glass pipe", "Hand mirror", "Handbag", "House keys", "ID card", "Keychain",
  "Laxative", "Metal file", "Superglue", "Thermos", "Wallet (1D6 × $10 inside)", "Wristwatch", "Zip ties"];

const CRATES = [
  [2, "Artifacts (1D6 pieces, roll on Artifacts, p. 119)"], [3, "Chemicals (1D6 types, e.g. tear gas, cleaner, etc.)"], [4, "Armor (1D6 pieces, roll on Armor, p. 83)"],
  [5, "Uniforms (Standard, or 1-in-1D6: High-ranking)"], [6, "Rations (2D6 MREs, +1D6 HP)"], [7, "Ammunition (1D6 types, e.g. bullets, rockets, etc.)"],
  [8, "Medical supplies (1D6 medkits, +1D6+TAC HP)"], [9, "Weapons (1D6 weapons, roll on Weapons, p. 83)"], [10, "Machine parts (2D6 usable parts)"],
  [11, "Explosives (2D6 small or 1D6 large, p. 83)"], [12, "Documents (classified, answer 1D6 questions)"]
];

const VEHICLES = [
  ["Bike", 3, 0], ["Hang glider", 3, 0], ["Jet ski", 3, 1], ["ATV/snowmobile", 3, 2], ["Small boat (e.g. fishing, patrol)", 6, 1], ["Motorcycle", 6, 1],
  ["Dirtbike", 6, 2], ["Sandrail", 8, 0], ["Civilian car", 8, 1], ["Civilian truck/technical", 8, 2], ["Armored car", 8, 3], ["Race car (e.g. sports, stock)", 10, 0],
  ["Civilian plane", 10, 0], ["Civilian van", 10, 1], ["Covered truck", 10, 2], ["Amphibious vehicle", 10, 2], ["Light utility vehicle (e.g. Jeep, UAZ)", 12, 1],
  ["Civilian carrier (e.g. semi, bus)", 12, 1], ["Gun truck", 12, 3], ["Fighter aircraft", 12, 1], ["Helicopter", 16, 1], ["Work vehicle (e.g. tractor, crane)", 16, 2],
  ["Large boat (e.g. barge, yacht)", 16, 2], ["Self-propelled artillery", 16, 3], ["Heavy aircraft", 18, 2], ["Mech frame", 18, 2], ["Starfighter", 18, 2],
  ["Submarine", 18, 3], ["Aircraft carrier", 18, 3], ["Airship (balloon, zeppelin, etc.)", 20, 0], ["Commercial jet", 20, 2], ["Tank", 20, 4], ["Battleship", 30, 3],
  ["Nuclear icebreaker", 30, 4], ["Spaceship", 40, 3], ["Battle mech", 40, 4]
];

const STANDARD_ISSUE = [
  ["Balaclava", "gear", { description: "<p>Hides identity.</p>" }],
  ["Flashlight", "gear", { description: "<p>Can be used as a weapon attachment.</p>" }],
  ["Knife", "weapon", { damage: "1d6", description: "<p>Standard issue.</p>" }],
  ["MRE field rations", "gear", { heal: "1d6", uses: { value: 1, max: 1 }, description: "<p>+1D6 HP, one use.</p>" }],
  ["Pistol", "weapon", { damage: "1d6", ranged: true, description: "<p>Standard issue.</p>" }],
  ["Riot shield", "armor", { armor: 1, equipAsWeapon: true, description: "<p>1 ARMOR, equip as weapon.</p>" }]
];

function buildWeapons() {
  const docs = WEAPONS.map(([name, examples, damage, ranged = false, consumable = false], i) => ({
    _id: id("weapon", name), name, type: "weapon", img: ICON.weapon, sort: i * 10,
    system: { damage, ranged, consumable, uses: consumable ? { value: 1, max: 1 } : { value: 0, max: 0 }, description: p(`Weapons table ${D66[i]}.${examples ? ` ${examples}` : ""}`) }
  }));
  ARMOR.forEach(([n, name, armor, extra], i) => docs.push({
    _id: id("armor", name), name, type: "armor", img: ICON.armor, sort: 1000 + i * 10,
    system: { armor, ...extra, description: p(`Armor table ${n}.${extra.accessory ? " Accessory: can be shattered to ignore damage once." : ""}${extra.equipAsWeapon ? " Must be equipped as a weapon." : ""}`) }
  }));
  VEHICLE_WEAPONS.forEach(([n, name, damage, note], i) => docs.push({
    _id: id("vweapon", name), name: `${name} (vehicle)`, type: "weapon", img: ICON.weapon, sort: 2000 + i * 10,
    system: { damage, ranged: true, description: p(`Vehicle weapons table ${n}.${note ? ` ${note}` : ""}`) }
  }));
  return docs;
}

function buildTags() {
  return TAGS.map(([name, text, extra = {}], i) => ({
    _id: id("tag", name), name, type: "tag", img: ICON.tag, sort: i * 10,
    system: { number: D66[i], description: p(text), damageBonus: extra.damageBonus ?? 0, attribute: extra.attribute ?? "", attributeBonus: extra.attributeBonus ?? 0 }
  }));
}

function buildGear(book) {
  const docs = [];
  STANDARD_ISSUE.forEach(([name, type, system], i) => docs.push({
    _id: id("std", name), name: `${name} (standard issue)`, type, img: ICON[type], sort: i * 10,
    system, flags: { fist: { standardIssue: true } }
  }));
  COMMON_ITEMS.forEach((name, i) => {
    const it = parseItem(name, { key: "common" });
    docs.push({ ...it, _id: id("common", name), sort: 100 + i * 10, system: { ...it.system, description: p(`Common items table ${D66[i]}.`) } });
  });
  docs.push({ _id: id("gear", "medkit"), name: "Medkit", type: "gear", img: ICON.gear, sort: 500, system: { heal: "1d6+@tac", uses: { value: 1, max: 1 }, description: p("Medical supplies: +1D6+TAC HP.") } });
  docs.push({ _id: id("gear", "mre"), name: "MRE", type: "gear", img: ICON.gear, sort: 510, system: { heal: "1d6", consumable: true, description: p("Rations: +1D6 HP.") } });
  for ( const g of book.gadgets ) {
    docs.push({
      _id: id("gadget", g.name), name: `CYCLOPS: ${g.name}`, type: "gear", img: "icons/svg/eye.svg", sort: 1000 + g.number * 10,
      system: { description: p(g.text) + p("All CYCLOPS gadgets carry microscopic geo-tracking transmitters."), consumable: /self-destructs|false death|syringe/i.test(g.text) },
      flags: { fist: { cyclops: true } }
    });
  }
  return docs;
}

/* -------------------------------------------- */
/*  Actors                                       */
/* -------------------------------------------- */

function crashFor(hp) {
  if ( hp <= 3 ) return "3";
  if ( hp <= 10 ) return "1d6";
  if ( hp <= 18 ) return "2d6";
  return "3d6";
}

function buildVehicles() {
  return VEHICLES.map(([name, hp, armor], i) => ({
    _id: id("vehicle", name), name, type: "vehicle", img: ICON.vehicle, sort: i * 10,
    system: {
      hp: { value: hp, max: hp }, armor, crash: crashFor(hp), occupants: "",
      usesFuel: !/bike|glider|airship|sandrail/i.test(name) || /motor|dirt/i.test(name),
      description: p(`Vehicles table ${D66[i]}. Crashing deals ${crashFor(hp).toUpperCase()} DAMAGE to the target and to itself.`)
    },
    items: [],
    prototypeToken: { name, actorLink: false, disposition: 0, bar1: { attribute: "hp" } }
  }));
}

function threatFromHp(hp, armor) {
  if ( hp >= 18 ) return 6;
  if ( hp >= 12 ) return 5;
  if ( hp >= 9 ) return 4;
  if ( hp >= 6 ) return 3;
  return armor >= 1 ? 2 : 1;
}

const THREATS = [
  ["Easy (civilian, animal, federal agent)", 3, 0, "3"], ["Medium (soldier, cop, security guard)", 3, 1, "1d6"], ["Hard (combat android, elite soldier)", 6, 1, "1d6+1"],
  ["Extreme (evil spirit, alien monster)", 9, 2, "1d6+2"], ["Impossible (cyborg agent, demigod)", 12, 2, "2d6"], ["Nightmare (mutant hulk, arch-demon)", 18, 3, "3d6"]
];

function buildEnemies() {
  const docs = THREATS.map(([name, hp, armor, damage], i) => ({
    _id: id("threat", i), name: `Threat ${i + 1}: ${name}`, type: "npc", img: ICON.npc, sort: i * 10,
    system: { threat: i + 1, hp: { value: hp, max: hp }, armor, damage, description: p("Generic enemy built from the threat guidelines (p. 72).") },
    items: [], prototypeToken: { name: name.split(" (")[0], disposition: -1, bar1: { attribute: "hp" } }
  }));
  const { enemies, npcs } = read("npcs.json");
  [...enemies, ...npcs].forEach((e, i) => {
    const actorId = id("npc", e.kind, e.name);
    const name = titleCase(e.name).replace(/\bCyclops\b/g, "CYCLOPS").replace(/\bAi\b/g, "AI").replace(/\bAtf\b/g, "ATF").replace(/\bCqc\b/g, "CQC").replace(/\bK-9\b/i, "K-9").replace(/\bArpanet\b/g, "ARPANET");
    const hp = Number(e.stats.match(/(\d+) HP/)?.[1] ?? 0);
    const appear = e.stats.match(/((?:\d+D6|\d+(?:-\d+)?|\d+ or \d+)) appear/i)?.[1] ?? "";
    const choke = e.stats.match(/CHOKE (\d):\s*(.*)$/);
    const items = [];
    const flavor = [];
    e.items.forEach((text, j) => {
      const hasDetails = /\(/.test(text);
      if ( !hasDetails && !/DAMAGE|ARMOR/.test(text) ) { flavor.push(text); return; }
      const it = parseItem(text, { key: `${actorId}-${j}` });
      it._id = id("npcitem", actorId, j);
      if ( it.type === "armor" && !it.system.equipAsWeapon ) it.system.equipped = true;
      it.sort = j * 10;
      items.push(it);
    });
    e.abilities.forEach(([abName, text], j) => items.push({
      _id: id("ability", actorId, j), name: titleCase(abName).replace("(Boss Move)", "(BOSS MOVE)"), type: "ability", img: ICON.ability, sort: 1000 + j * 10,
      system: { description: p(text) }
    }));
    const weapons = items.filter(it => it.type === "weapon");
    const damage = weapons[0]?.system.damage ?? "3";
    const armorItems = items.filter(it => it.type === "armor");
    const body = Math.max(0, ...armorItems.filter(a => !a.system.accessory && !a.system.equipAsWeapon).map(a => a.system.armor));
    const statArmor = Number(e.stats.match(/(\d+) ARMOR/)?.[1] ?? 0);
    const armor = Math.max(body, statArmor);
    const hpText = /HP not applicable/i.test(e.stats) ? "HP not applicable." : "";
    docs.push({
      _id: actorId, name, type: "npc", img: ICON.npc, sort: 100 + i * 10,
      system: {
        threat: threatFromHp(hp, armor), hp: { value: hp, max: hp }, armor, damage, appear,
        choke: { value: choke ? Number(choke[1]) : 0, behavior: choke ? choke[2].trim() : "" },
        boss: !!e.boss,
        description: p(`${e.kind === "enemy" ? "Pre-made enemy" : "Pre-made NPC"} (${e.stats}). ${hpText}`) + (flavor.length ? p(flavor.join(" · ")) : "")
      },
      items,
      prototypeToken: { name, disposition: e.kind === "enemy" ? -1 : 0, bar1: { attribute: "hp" } },
      flags: { fist: { source: e.kind === "enemy" ? "Premade enemies (p. 125)" : "Premade NPCs (p. 133)" } }
    });
  });
  return docs;
}

/** The four example operatives (p. 3-4). */
function buildMercs(traits, roles, book) {
  const T = (n) => traits.find(t => t.name === n);
  const R = (n) => roles.find(r => r.name === n);
  const defs = [
    { name: "GATE", traits: ["CHEF", "SUMMONER"], role: "HEALER", answer: "Food is medicine — a family tradition.", maxHp: 6, warDice: 4, extra: [] },
    { name: "WHIPLASH", traits: ["ACE", "XENO"], role: "WILDCARD", answer: "Drive fast cars, live for cheap thrills.", maxHp: 11, warDice: 2, extra: [] },
    { name: "ZERO", traits: ["INTERROGATION", "VETERAN"], role: "CRUSADER", answer: "Kill the right people for the right reasons.", maxHp: 6, warDice: 0, extra: ["Balaclava (hides identity)"] },
    { name: "SPLICE", traits: ["DUELIST", "MUTANT"], role: "PUNK", answer: "Smash the Anglo-European establishment.", maxHp: 8, warDice: 0, extra: [] }
  ];
  return defs.map((d, i) => {
    const actorId = id("merc", d.name);
    const items = [];
    let traitHp = 0;
    for ( const tn of d.traits ) {
      const t = structuredClone(T(tn));
      if ( !t ) { console.warn("Missing trait", tn); continue; }
      traitHp += t.system.mods.maxHp;
      if ( t.system.maxHpFormula ) t.system.rolledHp = 0;
      t._id = id("merctrait", d.name, tn);
      items.push(t);
      t.system.grants.forEach((g, j) => {
        const gi = structuredClone(g);
        gi._id = id("mercgrant", d.name, tn, j);
        gi.flags = { fist: { ...(gi.flags?.fist ?? {}), grantedBy: t._id, traitItem: true } };
        if ( (gi.type === "weapon") && !items.some(x => x.type === "weapon" && x.system.equipped) ) gi.system.equipped = true;
        if ( (gi.type === "armor") ) gi.system.equipped = true;
        items.push(gi);
      });
    }
    d.extra.forEach((text, j) => {
      const it = parseItem(text, { key: `merc-${d.name}-${j}` });
      it._id = id("mercextra", d.name, j);
      items.push(it);
    });
    const role = structuredClone(R(d.role));
    role._id = id("mercrole", d.name);
    role.system.answer = p(d.answer);
    items.push(role);
    const bio = book.bios[d.name] ?? {};
    return {
      _id: actorId, name: d.name, type: "merc", img: ICON.merc, sort: i * 10,
      system: {
        codename: d.name,
        hp: { value: d.maxHp, base: 6, bonus: Math.max(d.maxHp - 6 - traitHp, 0) },
        warDice: { value: d.warDice },
        info: p(bio.bio) + (bio.interview ? `<blockquote>${esc(bio.interview)}</blockquote>` : ""),
        creation: { complete: true, step: 4, bonus: "done", bonusResult: "" }
      },
      items,
      prototypeToken: { name: d.name, actorLink: true, disposition: 1, bar1: { attribute: "hp" } },
      flags: { fist: { source: "Example characters (p. 3-4)" } }
    };
  });
}

/* -------------------------------------------- */
/*  Roll tables                                  */
/* -------------------------------------------- */

function table(name, formula, rows, description = "") {
  const tableId = id("table", name);
  const results = rows.map((r, i) => {
    const res = {
      _id: id("result", name, i),
      type: r.uuid ? "document" : "text",
      name: r.name ?? "",
      img: r.img ?? null,
      description: r.text ? `<p>${esc(r.text)}</p>` : "",
      weight: 1,
      range: r.range,
      drawn: false,
      flags: {}
    };
    if ( r.uuid ) res.documentUuid = r.uuid;
    return res;
  });
  return { _id: tableId, name, img: ICON.table, description: p(description), formula, replacement: true, displayRoll: true, results };
}

const d66Range = (i) => [i + 1, i + 1];

/** "Yes, but..." partial successes (FIST bookmark), in D66 order. */
const PARTIAL_SUCCESSES = [
  ["COMBAT", ["The enemy doubles down", "The enemy flanks you", "You deal half DAMAGE", "You hurt a teammate too", "You trade DAMAGE", "Your weapon stops working"]],
  ["GENERAL", ["You can't move right now", "You cannot finish it alone", "You deplete a resource", "You ignore something else", "You need more time", "You'll need to rest a moment"]],
  ["MENTAL", ["Approximate calculations only", "More research is required", "Some information is lost", "You can't remember exactly", "You don't know why you're right", "You failed to account for..."]],
  ["MOVEMENT", ["You drop an important item", "You go partially off-course", "You hurt yourself a little", "You must take a longer route", "You're now in harm's way", "You're stopped halfway"]],
  ["SOCIAL", ["Disarm yourself immediately", "That won't work again", "You must prove yourself", "You must provide compensation", "You need to make a hard sell", "You'll be watched constantly"]],
  ["WEIRD", ["A trait behaves erratically", "Turn on your teammates", "You begin losing your grip", "You get a bad nosebleed", "You slowly develop a new trait", "You're struck by lightning"]]
];

function buildTables(packs) {
  const uuid = (pack, doc) => `Compendium.fist.${pack}.${pack === "mercs" || pack === "enemies" || pack === "vehicles" ? "Actor" : "Item"}.${doc._id}`;
  const tables = [];
  tables.push(table("Traits index (D666)", "1d216", packs.traits.map((t, i) => ({ range: [i + 1, i + 1], name: `${t.system.number}. ${t.name}`, uuid: uuid("traits", t), img: t.img })),
    "Equivalent to rolling D666 on the traits index: 216 entries in order."));
  tables.push(table("Roles index (D66)", "1d36", packs.roles.map((r, i) => ({ range: d66Range(i), name: `${r.system.number}. ${r.name}`, uuid: uuid("roles", r), img: r.img })),
    "Equivalent to rolling D66 on the roles index."));
  const weapons = packs.weapons.filter(w => w.type === "weapon" && !w.name.endsWith("(vehicle)"));
  tables.push(table("Weapons (D66)", "1d36", weapons.map((w, i) => ({ range: d66Range(i), name: `${D66[i]}. ${w.name} — ${w.system.damage.toUpperCase()} DAMAGE`, uuid: uuid("weapons", w), img: w.img }))));
  const armor = packs.weapons.filter(w => w.type === "armor");
  tables.push(table("Armor (2D6)", "2d6", armor.map((a, i) => ({ range: [i + 2, i + 2], name: `${i + 2}. ${a.name} — ${a.system.armor} ARMOR`, uuid: uuid("weapons", a), img: a.img }))));
  tables.push(table("Weapon tags (D66)", "1d36", packs.tags.map((t, i) => ({ range: d66Range(i), name: `${t.system.number}. ${t.name}`, uuid: uuid("tags", t), img: t.img }))));
  const common = packs.gear.filter(g => g._id && COMMON_ITEMS.some(c => g.flags?.fist?.sourceText === c));
  tables.push(table("Common items (D66)", "1d36", COMMON_ITEMS.map((c, i) => {
    const doc = common.find(g => g.flags.fist.sourceText === c);
    return { range: d66Range(i), name: `${D66[i]}. ${c}`, uuid: doc ? uuid("gear", doc) : null };
  })));
  tables.push(table("Crate contents (2D6)", "2d6", CRATES.map(([n, text]) => ({ range: [n, n], name: `${n}. ${text}` }))));
  const gadgets = packs.gear.filter(g => g.flags?.fist?.cyclops);
  tables.push(table("CYCLOPS gadgets (2D6)", "2d6", gadgets.map((g, i) => ({ range: [i + 2, i + 2], name: `${i + 2}. ${g.name.replace("CYCLOPS: ", "")}`, uuid: uuid("gear", g), img: g.img }))));
  tables.push(table("Vehicles (D66)", "1d36", packs.vehicles.map((v, i) => ({ range: d66Range(i), name: `${D66[i]}. ${v.name} — ${v.system.hp.max} HP, ${v.system.armor} ARMOR`, uuid: uuid("vehicles", v), img: v.img }))));
  const vweap = packs.weapons.filter(w => w.name.endsWith("(vehicle)"));
  tables.push(table("Vehicle weapons (2D6)", "2d6", vweap.map((w, i) => ({ range: [i + 2, i + 2], name: `${i + 2}. ${w.name.replace(" (vehicle)", "")} — ${w.system.damage.toUpperCase()} DAMAGE`, uuid: uuid("weapons", w), img: w.img }))));
  const std = packs.gear.filter(g => g.flags?.fist?.standardIssue);
  tables.push(table("Standard issue items (1D6)", "1d6", std.map((g, i) => ({ range: [i + 1, i + 1], name: `${i + 1}. ${g.name.replace(" (standard issue)", "")}`, uuid: uuid("gear", g), img: g.img }))));
  tables.push(table("Emergency insertion (2D6)", "2d6", [
    { range: [2, 6], name: "6 or less: deployment goes wrong somehow." },
    { range: [7, 9], name: "7-9: deploy normally." },
    { range: [10, 11], name: "10 or above: deploy with an extra standard issue item." },
    { range: [12, 12], name: "Double sixes: deploy with an extra standard issue item, and +3 to your first roll." }
  ]));
  tables.push(table("Partial successes: Yes, but... (D66)", "1d36", PARTIAL_SUCCESSES.flatMap(([category, entries], c) =>
    entries.map((text, i) => ({ range: d66Range((c * 6) + i), name: `${D66[(c * 6) + i]}. ${category}: ${text}` }))),
    "Complications for a 7-9 partial success (FIST bookmark). Roll D66, roll 1D6 inside the category that fits, or pick one."));
  tables.push(table("Enemy threat level (1D6)", "1d6", THREATS.map(([name, hp, armor, dmg], i) => ({ range: [i + 1, i + 1], name: `${i + 1}. ${name}: ${hp} HP, ${armor} ARMOR, ${dmg.toUpperCase()} DAMAGE` }))));
  tables.push(table("Codenames", `1d${read("codenames.json").length}`, read("codenames.json").map((c, i) => ({ range: [i + 1, i + 1], name: c })),
    "Codename pool from the FIST REF random merc generator."));
  return tables;
}

/* -------------------------------------------- */
/*  Journal                                      */
/* -------------------------------------------- */

function buildJournal(book) {
  const summary = book.summary.map(s => `<h2>${esc(s.heading)}</h2>` + s.paragraphs.map(x => x.startsWith("•") ? `<p class="bullet">${esc(x)}</p>` : p(x)).join("")).join("");
  const guideEn = `
<h1>Using the FIST system</h1>
<h2>Making a merc</h2>
<p>Create an Actor of type <strong>Operative</strong>. Its sheet opens on the <strong>Builder</strong> tab, which walks through the five steps of making a merc. Drag two traits from <em>Traits Index</em> (or roll D666), take a starting bonus, drag or roll a role, then pick a codename. <strong>Random merc</strong> does it all at once, like the FIST REF generator.</p>
<h2>Drag and drop</h2>
<ul>
<li><strong>Traits</strong> add their attribute, MAX HP, ARMOR or WAR DICE modifiers automatically and create their item, already equipped. Deleting the trait removes the item.</li>
<li>Traits that say "+1 to chosen attribute" ask which attribute; "+1D6 MAX HP" rolls once.</li>
<li><strong>Roles</strong> replace the previous role. The sheet warns if another operative already holds it.</li>
<li><strong>Weapon tags</strong> attach to a weapon: drop on the weapon row, or pick one from the prompt. CUSTOMIZED adds +1 DAMAGE; PROTOTYPE gives +1 TAC and rolls attacks with TAC.</li>
<li>Only one weapon (or large shield) and one body armor can be equipped; accessories stack and can be shattered to ignore one hit.</li>
</ul>
<h2>Rolling</h2>
<p>Click an attribute box to roll 2D6 + attribute. The dialog covers advantage/disadvantage, assists, 3D6 best/worst two, and WAR DICE to spend. Every roll card has a <strong>+1D6 War die</strong> button any player can press to spend one of their own WAR DICE on it. Damage cards apply damage to selected tokens with or without ARMOR.</p>
<h2>Between missions</h2>
<p><strong>New mission</strong> restores HP, uses and AMMO and grants per-mission WAR DICE. <strong>Rendezvous</strong> offers REST, RESTOCK or INTEL. <strong>Advance</strong> grants a trait, +1D6 MAX HP or +1D6 WAR DICE. <strong>Insertion</strong> rolls emergency insertion.</p>
<h2>Referee tools</h2>
<p>The <strong>FIST R.E.F.</strong> button in the Actors tab opens the random generator terminal and the Intelligence Matrix tables. Enemy files have threat-level presets, CHOKE rolls and "how many appear" rolls.</p>
<p>On a 7-9 partial success the roll card shows the referee a <strong>Yes, but...</strong> button (also in the Actors tab). It opens the partial success table from the FIST bookmark: roll D66 on the whole table, roll 1D6 in the category that fits the scene (combat, general, mental, movement, social, weird), or click a complication to pick it. The result can be whispered to the referee only.</p>`;
  const guidePt = `
<h1>Como usar o sistema FIST</h1>
<h2>Criando um merc</h2>
<p>Crie um Ator do tipo <strong>Operativo</strong>. A ficha abre na aba <strong>Criação</strong>, um passo a passo das cinco etapas do livro: arraste dois traits do <em>Traits Index</em> (ou role D666), escolha o bônus inicial, arraste ou role um role e defina o codinome. <strong>Merc aleatório</strong> faz tudo de uma vez, como o gerador do FIST REF.</p>
<h2>Arrastar e soltar</h2>
<ul>
<li><strong>Traits</strong> aplicam sozinhos os modificadores de atributo, MAX HP, ARMOR ou WAR DICE e criam o item concedido, já equipado. Apagar o trait remove o item.</li>
<li>Traits com "+1 to chosen attribute" perguntam o atributo; "+1D6 MAX HP" rola uma vez.</li>
<li><strong>Roles</strong> substituem o role anterior. A ficha avisa se outro operativo já tem aquele role.</li>
<li><strong>Tags de arma</strong> são presas a uma arma: solte sobre a linha da arma ou escolha no diálogo. CUSTOMIZED dá +1 de dano; PROTOTYPE dá +1 TAC e ataca com TAC.</li>
<li>Só uma arma (ou escudo grande) e uma armadura de corpo podem ficar equipadas; acessórios se somam e podem ser quebrados para ignorar um golpe.</li>
</ul>
<h2>Rolagens</h2>
<p>Clique na caixa de um atributo para rolar 2D6 + atributo. O diálogo inclui vantagem/desvantagem, ajuda, 3D6 melhores/piores dois e WAR DICE. Todo cartão de rolagem tem o botão <strong>+1D6 War die</strong>, que qualquer jogador pode usar para gastar um WAR DIE próprio. Cartões de dano aplicam o dano nos tokens selecionados, com ou sem ARMOR.</p>
<h2>Entre missões</h2>
<p><strong>Nova missão</strong> restaura HP, usos e AMMO e dá os WAR DICE por missão. <strong>Rendezvous</strong> oferece REST, RESTOCK ou INTEL. <strong>Avançar</strong> dá um trait, +1D6 MAX HP ou +1D6 WAR DICE. <strong>Inserção</strong> rola a inserção de emergência.</p>
<h2>Ferramentas do referee</h2>
<p>O botão <strong>FIST R.E.F.</strong> na aba de Atores abre o terminal gerador e as tabelas da Intelligence Matrix. As fichas de inimigo têm presets de nível de ameaça, rolagem de CHOKE e "quantos aparecem".</p>
<p>Num sucesso parcial (7-9) o cartão de rolagem mostra ao referee o botão <strong>Sim, mas...</strong> (também na aba de Atores). Ele abre a tabela de sucessos parciais do marcador de página do FIST: role D66 na tabela inteira, role 1D6 na categoria que combina com a cena (combate, geral, mental, movimento, social, estranho) ou clique numa complicação para escolhê-la. O resultado pode ser sussurrado só para o referee.</p>`;
  const license = `<h1>Credits &amp; license</h1>
<p><strong>FIST: Ultra Edition</strong> is a paranormal mercenary roleplaying game by CLAYMORE (B. Everett Dutton, Ripley Caldwell, T.H. Cochlin, Back-Alley Coalition, Max Danley). The text of FIST: Ultra Edition is licensed <a href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</a>; the rules text in these compendiums is adapted from it and shared under the same license.</p>
<p>Book illustrations are not included. Codename list and structured trait data courtesy of <a href="https://fistref.com">FIST REF</a>.</p>
<p>This is an unofficial system and is not affiliated with CLAYMORE.</p>`;
  const jid = id("journal", "manual");
  const page = (name, content, sort) => ({ _id: id("page", name), name, type: "text", title: { show: true, level: 1 }, text: { content, format: 1 }, sort });
  return [{
    _id: jid, name: "FIST Field Manual", img: ICON.journal,
    pages: [page("Como usar (pt-BR)", guidePt, 0), page("How to use (en)", guideEn, 100), page("Rules summary", summary, 200), page("Credits & license", license, 300)]
  }];
}

/* -------------------------------------------- */
/*  LevelDB writer                               */
/* -------------------------------------------- */

const EMBEDDED = {
  Actor: { items: "actors.items" },
  RollTable: { results: "tables.results" },
  JournalEntry: { pages: "journal.pages" }
};
const COLLECTION = { Item: "items", Actor: "actors", RollTable: "tables", JournalEntry: "journal" };

function finalize(doc, type) {
  doc._stats = { ...STATS };
  doc.flags ??= {};
  doc.folder ??= null;
  doc.sort ??= 0;
  doc.ownership ??= { default: 0 };
  return doc;
}

async function writePack(name, type, docs) {
  const dir = path.join(ROOT, "packs", name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const db = new ClassicLevel(dir, { keyEncoding: "utf8", valueEncoding: "json" });
  await db.open();
  const batch = db.batch();
  const coll = COLLECTION[type];
  for ( const raw of docs ) {
    const doc = finalize(structuredClone(raw), type);
    for ( const [field, embeddedColl] of Object.entries(EMBEDDED[type] ?? {}) ) {
      const children = doc[field] ?? [];
      doc[field] = children.map(c => c._id);
      for ( const child of children ) {
        child._stats = { ...STATS };
        child.flags ??= {};
        if ( type === "Actor" ) { child.folder ??= null; child.sort ??= 0; child.ownership ??= { default: 0 }; child.effects ??= []; }
        if ( type === "JournalEntry" ) child.ownership ??= { default: -1 };
        batch.put(`!${embeddedColl}!${doc._id}.${child._id}`, child);
      }
    }
    if ( type === "Actor" || type === "Item" ) doc.effects = [];
    batch.put(`!${coll}!${doc._id}`, doc);
  }
  await batch.write();
  await db.close();
  console.log(`  ${name.padEnd(9)} ${docs.length} documents`);
}

/* -------------------------------------------- */

const book = read("book.json");
const packs = {};
packs.traits = buildTraits();
packs.roles = buildRoles();
packs.weapons = buildWeapons();
packs.tags = buildTags();
packs.gear = buildGear(book);
packs.vehicles = buildVehicles();
packs.enemies = buildEnemies();
packs.mercs = buildMercs(packs.traits, packs.roles, book);
packs.tables = buildTables(packs);
packs.rules = buildJournal(book);

// Sanity checks
const ids = new Set();
for ( const [k, docs] of Object.entries(packs) ) for ( const d of docs ) {
  if ( ids.has(d._id) ) throw new Error(`Duplicate id ${d._id} in ${k} (${d.name})`);
  ids.add(d._id);
}

console.log("FIST | building packs");
await writePack("traits", "Item", packs.traits);
await writePack("roles", "Item", packs.roles);
await writePack("weapons", "Item", packs.weapons);
await writePack("tags", "Item", packs.tags);
await writePack("gear", "Item", packs.gear);
await writePack("vehicles", "Actor", packs.vehicles);
await writePack("enemies", "Actor", packs.enemies);
await writePack("mercs", "Actor", packs.mercs);
await writePack("tables", "RollTable", packs.tables);
await writePack("rules", "JournalEntry", packs.rules);

// Codenames module
const codenames = read("codenames.json");
fs.writeFileSync(path.join(ROOT, "module", "codenames.mjs"),
  `// Codename pool used by the FIST REF random merc generator (fistref.com). Generated by tools/build-packs.mjs.\nexport const CODENAMES = ${JSON.stringify(codenames)};\n`);

// Parse report
const grantTypes = {};
for ( const t of packs.traits ) for ( const g of t.system.grants ) grantTypes[g.type] = (grantTypes[g.type] ?? 0) + 1;
console.log("Trait grants by type:", grantTypes);
console.log("Conditional (non-automated) stats:", packs.traits.filter(t => t.system.conditional).map(t => `${t.name}: ${t.system.conditional}`).join("; "));
