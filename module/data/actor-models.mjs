const { fields } = foundry.data;

const int = (initial = 0, opts = {}) => new fields.NumberField({ required: true, nullable: false, integer: true, initial, ...opts });
const html = () => new fields.HTMLField({ required: true, blank: true });
const str = (initial = "") => new fields.StringField({ required: true, blank: true, initial });

const attributeField = () => new fields.SchemaField({ base: int(0) });

/* -------------------------------------------- */

/**
 * A FIST operative. Attributes, MAX HP, ARMOR and per-mission WAR DICE are derived from
 * the embedded traits and equipped gear, so dropping a trait updates the profile at once.
 */
export class MercData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      codename: str(),
      realName: str(),
      pronouns: str(),
      attributes: new fields.SchemaField({
        frc: attributeField(), tac: attributeField(), cre: attributeField(), rfx: attributeField()
      }),
      hp: new fields.SchemaField({
        value: int(6, { min: 0 }),
        base: int(6),
        bonus: int(0)
      }),
      armorBonus: int(0),
      warDice: new fields.SchemaField({ value: int(0, { min: 0 }) }),
      xp: int(0, { min: 0 }),
      advancements: int(0, { min: 0 }),
      missions: int(0, { min: 0 }),
      chopperChatter: new fields.BooleanField({ initial: false }),
      info: html(),
      notes: html(),
      creation: new fields.SchemaField({
        complete: new fields.BooleanField({ initial: false }),
        step: int(0, { min: 0, max: 4 }),
        bonus: str(),
        bonusResult: str()
      })
    };
  }

  prepareDerivedData() {
    const actor = this.parent;
    const traits = actor.items.filter(i => i.type === "trait");
    const equipped = actor.items.filter(i => ["weapon", "armor"].includes(i.type) && i.system.equipped);

    // Attributes
    for ( const [key, attr] of Object.entries(this.attributes) ) {
      attr.mod = 0;
      attr.sources = [];
    }
    for ( const trait of traits ) {
      for ( const [key, value] of Object.entries(trait.system.attributeMods) ) {
        if ( !value ) continue;
        this.attributes[key].mod += value;
        this.attributes[key].sources.push(`${trait.name} ${value > 0 ? "+" : ""}${value}`);
      }
    }
    for ( const weapon of equipped.filter(i => i.type === "weapon") ) {
      for ( const tag of weapon.system.tags ) {
        if ( tag.attribute && tag.attributeBonus && (tag.attribute in this.attributes) ) {
          this.attributes[tag.attribute].mod += tag.attributeBonus;
          this.attributes[tag.attribute].sources.push(`${tag.name} +${tag.attributeBonus}`);
        }
      }
    }
    for ( const attr of Object.values(this.attributes) ) attr.value = attr.base + attr.mod;

    // Hit points
    const traitHp = traits.reduce((t, i) => t + i.system.mods.maxHp + i.system.rolledHp, 0);
    this.hp.traitBonus = traitHp;
    this.hp.max = Math.max(this.hp.base + this.hp.bonus + traitHp, 1);
    this.hp.pct = Math.clamp(Math.round((this.hp.value / this.hp.max) * 100), 0, 100);

    // Armor: one body armor, any number of accessories, plus trait bonuses
    const armors = equipped.filter(i => i.type === "armor");
    const body = armors.filter(i => !i.system.accessory).reduce((m, i) => Math.max(m, i.system.armor), 0);
    const accessories = armors.filter(i => i.system.accessory).reduce((t, i) => t + i.system.armor, 0);
    const traitArmor = traits.reduce((t, i) => t + i.system.mods.armor, 0);
    this.armor = { value: Math.max(body + accessories + traitArmor + this.armorBonus, 0), body, accessories, traits: traitArmor };

    // War dice
    this.warDice.perMission = traits.reduce((t, i) => t + i.system.mods.warDicePerMission, 0);
    this.warDice.bonus = traits.reduce((t, i) => t + i.system.mods.warDieBonus, 0);

    this.isDead = this.hp.value <= 0;
  }

  /** Data exposed to roll formulas (@frc, @tac, ...). */
  getRollData() {
    const data = {};
    for ( const [k, v] of Object.entries(this.attributes) ) data[k] = v.value;
    return data;
  }
}

/* -------------------------------------------- */

/** An enemy or NPC controlled by the referee. */
export class NpcData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      threat: int(2, { min: 0, max: 6 }),
      hp: new fields.SchemaField({ value: int(3, { min: 0 }), max: int(3, { min: 0 }) }),
      armor: int(0, { min: 0 }),
      damage: str("1d6"),
      appear: str(),
      choke: new fields.SchemaField({ value: int(0, { min: 0, max: 6 }), behavior: str() }),
      boss: new fields.BooleanField({ initial: false }),
      attributes: new fields.SchemaField({
        frc: attributeField(), tac: attributeField(), cre: attributeField(), rfx: attributeField()
      }),
      description: html()
    };
  }

  prepareDerivedData() {
    for ( const attr of Object.values(this.attributes) ) attr.value = attr.base;
    this.hp.pct = this.hp.max ? Math.clamp(Math.round((this.hp.value / this.hp.max) * 100), 0, 100) : 100;
  }

  getRollData() {
    const data = {};
    for ( const [k, v] of Object.entries(this.attributes) ) data[k] = v.value;
    return data;
  }
}

/* -------------------------------------------- */

/** A vehicle: a special item-like actor with its own HP, ARMOR and weapons. */
export class VehicleData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      hp: new fields.SchemaField({ value: int(8, { min: 0 }), max: int(8, { min: 0 }) }),
      armor: int(1, { min: 0 }),
      crash: str("1d6"),
      occupants: str(),
      usesFuel: new fields.BooleanField({ initial: true }),
      description: html()
    };
  }

  prepareDerivedData() {
    this.hp.pct = this.hp.max ? Math.clamp(Math.round((this.hp.value / this.hp.max) * 100), 0, 100) : 100;
  }

  getRollData() {
    return { armor: this.armor };
  }
}
