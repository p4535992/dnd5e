import SystemDataModel from "../abstract.mjs";
import { MappingField } from "../fields.mjs";
import ActionTemplate from "./templates/action.mjs";
import ActivatedEffectTemplate from "./templates/activated-effect.mjs";
import EquippableItemTemplate from "./templates/equippable-item.mjs";
import ItemDescriptionTemplate from "./templates/item-description.mjs";
import PhysicalItemTemplate from "./templates/physical-item.mjs";
import MountableTemplate from "./templates/mountable.mjs";

/**
 * Data definition for Weapon items.
 * @mixes ItemDescriptionTemplate
 * @mixes PhysicalItemTemplate
 * @mixes EquippableItemTemplate
 * @mixes ActivatedEffectTemplate
 * @mixes ActionTemplate
 * @mixes MountableTemplate
 *
 * @property {string} weaponType   Weapon category as defined in `DND5E.weaponTypes`.
 * @property {string} baseItem     Base weapon as defined in `DND5E.weaponIds` for determining proficiency.
 * @property {object} properties   Mapping of various weapon property booleans.
 * @property {number} proficient   Does the weapon's owner have proficiency?
 * @property {string} resourceLink Linked resources to the item.
 */
export default class WeaponData extends SystemDataModel.mixin(
  ItemDescriptionTemplate, PhysicalItemTemplate, EquippableItemTemplate,
  ActivatedEffectTemplate, ActionTemplate, MountableTemplate
) {
  /** @inheritdoc */
  static defineSchema() {
    return this.mergeSchema(super.defineSchema(), {
      weaponType: new foundry.data.fields.StringField({
        required: true, initial: "simpleM", label: "DND5E.ItemWeaponType"
      }),
      baseItem: new foundry.data.fields.StringField({required: true, blank: true, label: "DND5E.ItemWeaponBase"}),
      properties: new MappingField(new foundry.data.fields.BooleanField(), {
        required: true, initialKeys: CONFIG.DND5E.weaponProperties, label: "DND5E.ItemWeaponProperties"
      }),
      proficient: new foundry.data.fields.NumberField({
        required: true, min: 0, max: 1, integer: true, initial: null, label: "DND5E.ProficiencyLevel"
      }),
      resourceLink: new foundry.data.fields.StringField({
        required: false, initial: "", label: "DND5E.resourceLink"
      })
    });
  }

  /* -------------------------------------------- */
  /*  Migrations                                  */
  /* -------------------------------------------- */

  /** @inheritdoc */
  static migrateData(source) {
    super.migrateData(source);
    WeaponData.#migratePropertiesData(source);
    WeaponData.#migrateProficient(source);
    WeaponData.#migrateWeaponType(source);
  }

  /* -------------------------------------------- */

  /**
   * Migrate the weapons's properties object to remove any old, non-boolean values.
   * @param {object} source  The candidate source data from which the model will be constructed.
   */
  static #migratePropertiesData(source) {
    if ( !source.properties ) return;
    for ( const [key, value] of Object.entries(source.properties) ) {
      if ( typeof value !== "boolean" ) delete source.properties[key];
    }
  }

  /* -------------------------------------------- */

  /**
   * Migrate the proficient field to convert boolean values.
   * @param {object} source  The candidate source data from which the model will be constructed.
   */
  static #migrateProficient(source) {
    if ( typeof source.proficient === "boolean" ) source.proficient = Number(source.proficient);
  }

  /* -------------------------------------------- */

  /**
   * Migrate the weapon type.
   * @param {object} source  The candidate source data from which the model will be constructed.
   */
  static #migrateWeaponType(source) {
    if ( source.weaponType === null ) source.weaponType = "simpleM";
  }

  /* -------------------------------------------- */
  /*  Getters                                     */
  /* -------------------------------------------- */

  /**
   * Properties displayed in chat.
   * @type {string[]}
   */
  get chatProperties() {
    return [CONFIG.DND5E.weaponTypes[this.weaponType]];
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  get _typeAbilityMod() {
    if ( ["simpleR", "martialR"].includes(this.weaponType) ) return "dex";

    const abilities = this.parent?.actor?.system.abilities;
    if ( this.properties.fin && abilities ) {
      return (abilities.dex?.mod ?? 0) >= (abilities.str?.mod ?? 0) ? "dex" : "str";
    }

    return null;
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  get _typeCriticalThreshold() {
    return this.parent?.actor?.flags.dnd5e?.weaponCriticalThreshold ?? Infinity;
  }

  /* -------------------------------------------- */

  /**
   * Is this item a separate large object like a siege engine or vehicle component that is
   * usually mounted on fixtures rather than equipped, and has its own AC and HP?
   * @type {boolean}
   */
  get isMountable() {
    return this.weaponType === "siege";
  }

  /* -------------------------------------------- */

  /**
   * The proficiency multiplier for this item.
   * @returns {number}
   */
  get proficiencyMultiplier() {
    if ( Number.isFinite(this.proficient) ) return this.proficient;
    const actor = this.parent.actor;
    if ( !actor ) return 0;
    if ( actor.type === "npc" ) return 1; // NPCs are always considered proficient with any weapon in their stat block.
    const config = CONFIG.DND5E.weaponProficienciesMap;
    const itemProf = config[this.weaponType];
    const actorProfs = actor.system.traits?.weaponProf?.value ?? new Set();
    const natural = this.weaponType === "natural";
    const improvised = (this.weaponType === "improv") && !!actor.getFlag("dnd5e", "tavernBrawlerFeat");
    const isProficient = natural || improvised || actorProfs.has(itemProf) || actorProfs.has(this.baseItem);
    return Number(isProficient);
  }
}
