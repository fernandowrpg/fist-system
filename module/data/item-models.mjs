const { fields } = foundry.data;

const int = (initial = 0, opts = {}) => new fields.NumberField({ required: true, nullable: false, integer: true, initial, ...opts });
const html = () => new fields.HTMLField({ required: true, blank: true });
const str = (initial = "") => new fields.StringField({ required: true, blank: true, initial });
const bool = (initial = false) => new fields.BooleanField({ required: true, initial });

const usesField = () => new fields.SchemaField({
  value: int(0, { min: 0 }),
  max: int(0, { min: 0 })
});

/* -------------------------------------------- */

/**
 * A trait: a special rule, a granted item and a stat modification.
 * The modifiers are summed into the operative's derived data, and the granted items are
 * created alongside the trait when it is dropped on an actor.
 */
export class TraitData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      number: int(0),
      effect: html(),
      itemText: str(),
      statText: str(),
      mods: new fields.SchemaField({
        frc: int(0), tac: int(0), cre: int(0), rfx: int(0),
        maxHp: int(0),
        armor: int(0),
        warDicePerMission: int(0),
        warDieBonus: int(0)
      }),
      // Formula rolled once when the trait is gained (e.g. "1d6" MAX HP)
      maxHpFormula: str(),
      rolledHp: int(0),
      // Bonus to an attribute picked by the player when the trait is gained
      chosenBonus: int(0),
      chosenAttribute: new fields.StringField({ required: true, blank: true, initial: "", choices: () => ({ "": "—", frc: "FRC", tac: "TAC", cre: "CRE", rfx: "RFX" }) }),
      // Situational modifier that cannot be automated (e.g. "+1 DAMAGE vs. fleeing targets")
      conditional: str(),
      grants: new fields.ArrayField(new fields.ObjectField())
    };
  }

  /** Total attribute modifiers granted by this trait. */
  get attributeMods() {
    const mods = { frc: this.mods.frc, tac: this.mods.tac, cre: this.mods.cre, rfx: this.mods.rfx };
    if ( this.chosenAttribute && this.chosenBonus ) mods[this.chosenAttribute] += this.chosenBonus;
    return mods;
  }

  get statSummary() {
    return this.statText || "";
  }
}

/* -------------------------------------------- */

/** A role: the narrative motive the operative advances by fulfilling. */
export class RoleData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      number: int(0),
      describe: str(),
      advance: str(),
      answer: html()
    };
  }
}

/* -------------------------------------------- */

/** Base schema shared by inventory items. */
class InventoryData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      description: html(),
      uses: usesField(),
      consumable: bool(false),
      quantity: int(1, { min: 0 })
    };
  }

  get hasUses() {
    return this.uses.max > 0;
  }

  get depleted() {
    return this.hasUses && (this.uses.value <= 0);
  }
}

/* -------------------------------------------- */

export class WeaponData extends InventoryData {
  static defineSchema() {
    return {
      ...super.defineSchema(),
      damage: str("1d6"),
      ranged: bool(false),
      equipped: bool(false),
      // Wrist blades and similar: usable without occupying the weapon slot
      freeSlot: bool(false),
      attribute: new fields.StringField({ required: true, blank: true, initial: "", choices: () => ({ "": "—", frc: "FRC", tac: "TAC", cre: "CRE", rfx: "RFX" }) }),
      ammo: new fields.SchemaField({ value: int(6, { min: 0, max: 6 }) }),
      tags: new fields.ArrayField(new fields.SchemaField({
        name: str(),
        description: str(),
        damageBonus: int(0),
        attribute: str(),
        attributeBonus: int(0)
      }))
    };
  }

  /** Damage bonus granted by tags such as CUSTOMIZED. */
  get tagDamageBonus() {
    return this.tags.reduce((t, tag) => t + (tag.damageBonus || 0), 0);
  }

  get damageFormula() {
    const bonus = this.tagDamageBonus;
    let formula = (this.damage || "0").trim();
    if ( bonus ) formula += ` + ${bonus}`;
    return formula;
  }

  get damageLabel() {
    const bonus = this.tagDamageBonus;
    return (this.damage || "0").toUpperCase() + (bonus ? `+${bonus}` : "");
  }
}

/* -------------------------------------------- */

export class ArmorData extends InventoryData {
  static defineSchema() {
    return {
      ...super.defineSchema(),
      armor: int(1),
      accessory: bool(false),
      equipAsWeapon: bool(false),
      locked: bool(false),
      equipped: bool(false)
    };
  }
}

/* -------------------------------------------- */

export class GearData extends InventoryData {
  static defineSchema() {
    return {
      ...super.defineSchema(),
      heal: str(),
      warDice: int(0)
    };
  }
}

/* -------------------------------------------- */

/** A weapon tag that can be dropped onto a weapon. */
export class TagData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      number: int(0),
      description: html(),
      damageBonus: int(0),
      attribute: str(),
      attributeBonus: int(0)
    };
  }
}

/* -------------------------------------------- */

/** A named special mechanic for enemies, NPCs and vehicles. */
export class AbilityData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      description: html()
    };
  }
}
