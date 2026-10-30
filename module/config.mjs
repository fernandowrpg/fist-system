/**
 * Static rules data for FIST: Ultra Edition.
 */
export const FIST = {};

FIST.attributes = {
  frc: { label: "FIST.Attr.frc", abbr: "FRC", hint: "FIST.Attr.frcHint" },
  tac: { label: "FIST.Attr.tac", abbr: "TAC", hint: "FIST.Attr.tacHint" },
  cre: { label: "FIST.Attr.cre", abbr: "CRE", hint: "FIST.Attr.creHint" },
  rfx: { label: "FIST.Attr.rfx", abbr: "RFX", hint: "FIST.Attr.rfxHint" }
};

/** Map of full attribute names used in the book to their keys. */
FIST.attributeNames = { FORCEFUL: "frc", TACTICAL: "tac", CREATIVE: "cre", REFLEXIVE: "rfx" };

/** Dice modes for risky rolls (some traits roll 3D6 and keep the best or worst two). */
FIST.rollModes = {
  normal: { label: "FIST.Roll.Mode.normal", formula: "2d6" },
  best: { label: "FIST.Roll.Mode.best", formula: "3d6kh2" },
  worst: { label: "FIST.Roll.Mode.worst", formula: "3d6kl2" }
};

/** Outcome bands for a 2D6 + attribute roll. */
FIST.outcomes = {
  failure: { label: "FIST.Outcome.failure", text: "FIST.Outcome.failureText" },
  partial: { label: "FIST.Outcome.partial", text: "FIST.Outcome.partialText" },
  success: { label: "FIST.Outcome.success", text: "FIST.Outcome.successText" },
  ultra: { label: "FIST.Outcome.ultra", text: "FIST.Outcome.ultraText" }
};

/** Unarmed or non-weapon attacks deal the worst of 2D6. */
FIST.unarmedDamage = "2d6kl1";

/** Standard issue items (p. 2). Each is created on the actor when chosen in the builder. */
FIST.standardIssue = [
  { name: "Balaclava", type: "gear", system: { description: "<p>Hides identity.</p>" } },
  { name: "Flashlight", type: "gear", system: { description: "<p>Can be used as a weapon attachment.</p>" } },
  { name: "Knife", type: "weapon", system: { damage: "1d6", description: "<p>Standard issue.</p>" } },
  { name: "MRE field rations", type: "gear", system: { heal: "1d6", uses: { value: 1, max: 1 }, description: "<p>+1D6 HP, one use.</p>" } },
  { name: "Pistol", type: "weapon", system: { damage: "1d6", ranged: true, description: "<p>Standard issue.</p>" } },
  { name: "Riot shield", type: "armor", system: { armor: 1, equipAsWeapon: true, description: "<p>1 ARMOR, equip as weapon.</p>" } }
];

/** Emergency insertion table (p. 2), rolled on 2D6. */
FIST.insertion = [
  { max: 6, label: "FIST.Insertion.wrong" },
  { max: 9, label: "FIST.Insertion.normal" },
  { max: 99, label: "FIST.Insertion.extra" }
];

/** Enemy and NPC threat guidelines (p. 72). */
FIST.threats = {
  1: { label: "FIST.Threat.1", hp: 3, armor: 0, damage: "3" },
  2: { label: "FIST.Threat.2", hp: 3, armor: 1, damage: "1d6" },
  3: { label: "FIST.Threat.3", hp: 6, armor: 1, damage: "1d6+1" },
  4: { label: "FIST.Threat.4", hp: 9, armor: 2, damage: "1d6+2" },
  5: { label: "FIST.Threat.5", hp: 12, armor: 2, damage: "2d6" },
  6: { label: "FIST.Threat.6", hp: 18, armor: 3, damage: "3d6" }
};

/** Rendezvous options (p. 6). */
FIST.rendezvous = {
  rest: { label: "FIST.Rendezvous.rest", hint: "FIST.Rendezvous.restHint" },
  restock: { label: "FIST.Rendezvous.restock", hint: "FIST.Rendezvous.restockHint" },
  intel: { label: "FIST.Rendezvous.intel", hint: "FIST.Rendezvous.intelHint" }
};

/** Advancement and starting bonus rewards. */
FIST.rewards = {
  item: { label: "FIST.Reward.item", icon: "fa-solid fa-box-open" },
  trait: { label: "FIST.Reward.trait", icon: "fa-solid fa-dna" },
  hp: { label: "FIST.Reward.hp", icon: "fa-solid fa-heart-pulse" },
  warDice: { label: "FIST.Reward.warDice", icon: "fa-solid fa-dice-d6" }
};

/** Steps of the operative builder. */
FIST.creationSteps = [
  { id: "sheet", label: "FIST.Builder.Step.sheet", icon: "fa-solid fa-file-lines" },
  { id: "traits", label: "FIST.Builder.Step.traits", icon: "fa-solid fa-dna" },
  { id: "bonus", label: "FIST.Builder.Step.bonus", icon: "fa-solid fa-box-open" },
  { id: "role", label: "FIST.Builder.Step.role", icon: "fa-solid fa-mask" },
  { id: "codename", label: "FIST.Builder.Step.codename", icon: "fa-solid fa-id-badge" }
];

FIST.compendiums = {
  traits: "fist.traits",
  roles: "fist.roles",
  weapons: "fist.weapons",
  tags: "fist.tags",
  gear: "fist.gear",
  tables: "fist.tables"
};

FIST.defaultIcons = {
  trait: "systems/fist/assets/trait.svg",
  role: "systems/fist/assets/role.svg",
  weapon: "icons/svg/sword.svg",
  armor: "icons/svg/shield.svg",
  gear: "icons/svg/item-bag.svg",
  tag: "systems/fist/assets/tag.svg",
  ability: "icons/svg/lightning.svg"
};
