import SystemDataModel from "../abstract.mjs";
import { MappingField } from "../fields.mjs";
import ActionTemplate from "./templates/action.mjs";
import ActivatedEffectTemplate from "./templates/activated-effect.mjs";
import EquippableItemTemplate from "./templates/equippable-item.mjs";
import ItemDescriptionTemplate from "./templates/item-description.mjs";
import PhysicalItemTemplate from "./templates/physical-item.mjs";

/**
 * Data definition for Consumable items.
 * @mixes ItemDescriptionTemplate
 * @mixes PhysicalItemTemplate
 * @mixes EquippableItemTemplate
 * @mixes ActivatedEffectTemplate
 * @mixes ActionTemplate
 *
 * @property {string} consumableType     Type of consumable as defined in `DND5E.consumableTypes`.
 * @property {string} resourceLink Linked resources to the item.
 * @property {object} uses
 * @property {boolean} uses.autoDestroy  Should this item be destroyed when it runs out of uses.
 */
export default class ConsumableData extends SystemDataModel.mixin(
  ItemDescriptionTemplate, PhysicalItemTemplate, EquippableItemTemplate, ActivatedEffectTemplate, ActionTemplate
) {
  /** @inheritdoc */
  static defineSchema() {
    return this.mergeSchema(super.defineSchema(), {
      consumableType: new foundry.data.fields.StringField({
        required: true, initial: "potion", label: "DND5E.ItemConsumableType"
      }),
      properties: new MappingField(new foundry.data.fields.BooleanField(), {
        required: false, label: "DND5E.ItemAmmoProperties"
      }),
      uses: new ActivatedEffectTemplate.ItemUsesField({
        autoDestroy: new foundry.data.fields.BooleanField({required: true, label: "DND5E.ItemDestroyEmpty"})
      }, {label: "DND5E.LimitedUses"}),
      resourceLink: new foundry.data.fields.StringField({
        required: false, initial: "", label: "DND5E.resourceLink"
      })
    });
  }

  /* -------------------------------------------- */
  /*  Getters                                     */
  /* -------------------------------------------- */

  /**
   * Properties displayed in chat.
   * @type {string[]}
   */
  get chatProperties() {
    return [
      CONFIG.DND5E.consumableTypes[this.consumableType],
      this.hasLimitedUses ? `${this.uses.value}/${this.uses.max} ${game.i18n.localize("DND5E.Charges")}` : null
    ];
  }

  /* -------------------------------------------- */

  /** @inheritdoc */
  get _typeAbilityMod() {
    if ( this.consumableType !== "scroll" ) return null;
    return this.parent?.actor?.system.attributes.spellcasting || "int";
  }

  /* -------------------------------------------- */

  /**
   * The proficiency multiplier for this item.
   * @returns {number}
   */
  get proficiencyMultiplier() {
    const isProficient = this.parent?.actor?.getFlag("dnd5e", "tavernBrawlerFeat");
    return isProficient ? 1 : 0;
  }
}
