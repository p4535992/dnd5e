import ActorSheet5e from "./base-sheet.mjs";
import AdvancementConfirmationDialog from "../advancement/advancement-confirmation-dialog.mjs";
import AdvancementManager from "../advancement/advancement-manager.mjs";

/**
 * An Actor sheet for player character type actors.
 */
export default class ActorSheet5eCharacter extends ActorSheet5e {

  /** @inheritDoc */
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["dnd5e", "sheet", "actor", "character"]
    });
  }

  /* -------------------------------------------- */
  /*  Context Preparation                         */
  /* -------------------------------------------- */

  /** @inheritDoc */
  async getData(options={}) {
    const context = await super.getData(options);

    // Resources
    context.resources = Object.keys(CONFIG.DND5E.resourceOptions).reduce((arr, r) => {
      const res = context.actor.system.resources[r] || {};
      res.name = r;
      res.placeholder = game.i18n.localize(`DND5E.Resource${r.titleCase()}`);
      if (res && res.value === 0) delete res.value;
      if (res && res.max === 0) delete res.max;
      return arr.concat([res]);
    }, []);

    const classes = this.actor.itemTypes.class;
    return foundry.utils.mergeObject(context, {
      disableExperience: game.settings.get("dnd5e", "disableExperienceTracking"),
      classLabels: classes.map(c => c.name).join(", "),
      multiclassLabels: classes.map(c => [c.subclass?.name ?? "", c.name, c.system.levels].filterJoin(" ")).join(", "),
      weightUnit: game.i18n.localize(`DND5E.Abbreviation${
        game.settings.get("dnd5e", "metricWeightUnits") ? "Kg" : "Lbs"}`),
      encumbrance: context.system.attributes.encumbrance
    });
  }

  /* -------------------------------------------- */

  /** @override */
  _prepareItems(context) {

    // Categorize items as inventory, spellbook, features, and classes
    const inventory = {};
    for ( const type of ["weapon", "equipment", "consumable", "tool", "backpack", "loot"] ) {
      inventory[type] = {label: `${CONFIG.Item.typeLabels[type]}Pl`, items: [], dataset: {type}};
    }

    // Partition items by category
    let {items, spells, feats, backgrounds, classes, subclasses} = context.items.reduce((obj, item) => {
      const {quantity, uses, recharge, target} = item.system;

      // Item details
      const ctx = context.itemContext[item.id] ??= {};
      ctx.isStack = Number.isNumeric(quantity) && (quantity !== 1);
      ctx.attunement = {
        [CONFIG.DND5E.attunementTypes.REQUIRED]: {
          icon: "fa-sun",
          cls: "not-attuned",
          title: "DND5E.AttunementRequired"
        },
        [CONFIG.DND5E.attunementTypes.ATTUNED]: {
          icon: "fa-sun",
          cls: "attuned",
          title: "DND5E.AttunementAttuned"
        }
      }[item.system.attunement];

      // Prepare data needed to display expanded sections
      ctx.isExpanded = this._expanded.has(item.id);

      // Item usage
      ctx.hasUses = uses && (uses.max > 0);
      ctx.isOnCooldown = recharge && !!recharge.value && (recharge.charged === false);
      ctx.isDepleted = ctx.isOnCooldown && (uses.per && (uses.value > 0));
      ctx.hasTarget = !!target && !(["none", ""].includes(target.type));

      // Item toggle state
      this._prepareItemToggleState(item, ctx);

      // Classify items into types
      if ( item.type === "spell" ) obj.spells.push(item);
      else if ( item.type === "feat" ) obj.feats.push(item);
      else if ( item.type === "background" ) obj.backgrounds.push(item);
      else if ( item.type === "class" ) obj.classes.push(item);
      else if ( item.type === "subclass" ) obj.subclasses.push(item);
      else if ( Object.keys(inventory).includes(item.type) ) obj.items.push(item);
      return obj;
    }, { items: [], spells: [], feats: [], backgrounds: [], classes: [], subclasses: [] });

    // Apply active item filters
    items = this._filterItems(items, this._filters.inventory);
    spells = this._filterItems(spells, this._filters.spellbook);
    feats = this._filterItems(feats, this._filters.features);

    // Organize items
    for ( let i of items ) {
      const ctx = context.itemContext[i.id] ??= {};
      ctx.totalWeight = (i.system.quantity * i.system.weight).toNearest(0.1);
      inventory[i.type].items.push(i);
    }

    // Organize Spellbook and count the number of prepared spells (excluding always, at will, etc...)
    const spellbook = this._prepareSpellbook(context, spells);
    const nPrepared = spells.filter(spell => {
      const prep = spell.system.preparation;
      return (spell.system.level > 0) && (prep.mode === "prepared") && prep.prepared;
    }).length;

    // Sort classes and interleave matching subclasses, put unmatched subclasses into features so they don't disappear
    classes.sort((a, b) => b.system.levels - a.system.levels);
    const maxLevelDelta = CONFIG.DND5E.maxLevel - this.actor.system.details.level;
    classes = classes.reduce((arr, cls) => {
      const ctx = context.itemContext[cls.id] ??= {};
      ctx.availableLevels = Array.fromRange(CONFIG.DND5E.maxLevel + 1).slice(1).map(level => {
        const delta = level - cls.system.levels;
        return { level, delta, disabled: delta > maxLevelDelta };
      });
      arr.push(cls);
      const identifier = cls.system.identifier || cls.name.slugify({strict: true});
      const subclass = subclasses.findSplice(s => s.system.classIdentifier === identifier);
      if ( subclass ) arr.push(subclass);
      return arr;
    }, []);
    for ( const subclass of subclasses ) {
      feats.push(subclass);
      const message = game.i18n.format("DND5E.SubclassMismatchWarn", {
        name: subclass.name, class: subclass.system.classIdentifier
      });
      context.warnings.push({ message, type: "warning" });
    }

    // Organize Features
    const features = {
      background: {
        label: CONFIG.Item.typeLabels.background, items: backgrounds,
        hasActions: false, dataset: {type: "background"} },
      classes: {
        label: `${CONFIG.Item.typeLabels.class}Pl`, items: classes,
        hasActions: false, dataset: {type: "class"}, isClass: true },
      active: {
        label: "DND5E.FeatureActive", items: [],
        hasActions: true, dataset: {type: "feat", "activation.type": "action"} },
      passive: {
        label: "DND5E.FeaturePassive", items: [],
        hasActions: false, dataset: {type: "feat"} }
    };
    for ( const feat of feats ) {
      if ( feat.system.activation?.type ) features.active.items.push(feat);
      else features.passive.items.push(feat);
    }

    // Assign and return
    context.inventoryFilters = true;
    context.inventory = Object.values(inventory);
    context.spellbook = spellbook;
    context.preparedSpells = nPrepared;
    context.features = Object.values(features);
    context.labels.background = backgrounds[0]?.name;
  }

  /* -------------------------------------------- */

  /**
   * A helper method to establish the displayed preparation state for an item.
   * @param {Item5e} item     Item being prepared for display.
   * @param {object} context  Context data for display.
   * @protected
   */
  _prepareItemToggleState(item, context) {
    if ( item.type === "spell" ) {
      const prep = item.system.preparation || {};
      const isAlways = prep.mode === "always";
      const isPrepared = !!prep.prepared;
      context.toggleClass = isPrepared ? "active" : "";
      if ( isAlways ) context.toggleClass = "fixed";
      if ( isAlways ) context.toggleTitle = CONFIG.DND5E.spellPreparationModes.always;
      else if ( isPrepared ) context.toggleTitle = CONFIG.DND5E.spellPreparationModes.prepared;
      else context.toggleTitle = game.i18n.localize("DND5E.SpellUnprepared");
    }
    else {
      const isActive = !!item.system.equipped;
      context.toggleClass = isActive ? "active" : "";
      context.toggleTitle = game.i18n.localize(isActive ? "DND5E.Equipped" : "DND5E.Unequipped");
      context.canToggle = "equipped" in item.system;
    }
  }

  /* -------------------------------------------- */
  /*  Event Listeners and Handlers
  /* -------------------------------------------- */

  /** @inheritDoc */
  activateListeners(html) {
    super.activateListeners(html);
    if ( !this.isEditable ) return;
    html.find(".level-selector").change(this._onLevelChange.bind(this));
    html.find(".item-toggle").click(this._onToggleItem.bind(this));
    html.find(".short-rest").click(this._onShortRest.bind(this));
    html.find(".long-rest").click(this._onLongRest.bind(this));
    html.find(".rollable[data-action]").click(this._onSheetAction.bind(this));

    // Feature: Resource Link
    const { resourceOverrides } = this.actor._getResourceOverrides();
    const sheetResources = Object.keys(CONFIG.DND5E.resourceOptions);

    //  Disables all inputs in an overriden resource fieldset except `value`.
    const indexesToDisable = Object.keys(resourceOverrides).map(resourceName => {
      return {
        index: sheetResources.indexOf(resourceName),
        itemId: resourceOverrides[resourceName]
      };
    });
    const resourceElements = html.find(".resource");

    // Get the resources which have overrides to disable inputs
    for (const indexToDisable of Object.values(indexesToDisable)) {
      const index = indexToDisable.index;
      const itemId = indexToDisable.itemId;
      const element = $(resourceElements[index]);

      // Disable every input except the `value` input
      element.find("[name]").filter((index, el) => !el.name.includes("value"))
        .prop("disabled", true)
        .prop("title", game.i18n.localize("DND5E.resourceLinkDisabledResourceHelperText"));

      // For cases where this isn't showing charges, delete the separator and max
      if (!this.actor.items.get(itemId).hasLimitedUses) {
        element.find(".sep").remove();
        element.find("[name*='max']").remove();
      }
    }

    // Disables the Item Uses inputs on the inventory level for items which override resource.
    // This is necessary to avoid a double-update which results in no actual change.
    const itemIdsToDisable = Object.values(resourceOverrides);

    // Get the resources which have overrides to disable inputs
    for (const itemId of itemIdsToDisable) {
      html.find(`[data-item-id=${itemId}] .item-uses input, [data-item-id=${itemId}] .item-charges input`)
        .prop("disabled", true)
        .prop("title", game.i18n.localize("DND5E.resourceLinkDisabledItemHelperText"));

      // For cases where this isn't showing charges, delete the separator and max
      if (!this.actor.items.get(itemId).hasLimitedUses) {
        html.find(`[data-item-id=${itemId}] .item-quantity input`)
          .prop("disabled", true)
          .prop("title", game.i18n.localize("DND5E.resourceLinkDisabledItemHelperText"));
      }
    }

    const boxAddResource = html[0].querySelector("form > .sheet-body > .tab.attributes.flexrow > .center-pane.flexcol > .attributes.flexrow");
    const divAddResource = document.createElement("DIV");
    const data = Object.entries(this.object.system.resources ?? {});
    for (const [id, vals] of data) {
      const inner = this._addResource(id, vals);
      if (!inner) {
        continue;
      }
      divAddResource.innerHTML = inner;
      const res = boxAddResource.appendChild(divAddResource.firstElementChild);
      res.querySelector("[data-id]").addEventListener("click", async (event) => {
        if(Object.keys(CONFIG.DND5E.resourceOptions).includes(event.currentTarget.dataset.id)){
            // Can't delete original resources
            return;
        }
        delete this.object.system.resources[event.currentTarget.dataset.id];
      });
    }

    divAddResource.innerHTML = `<a class="addar add-resource" data-tooltip="DND5E.addResource"><i class="fa-solid fa-plus"></i></a>`;
    const addResource = boxAddResource.appendChild(divAddResource.firstElementChild);
    addResource.addEventListener("click", async (event) => {
       this.object.system.resources[foundry.utils.randomID()] = {};
    });
  }

  _addResource(key, data) {
    if (!key) {
        return false;
    }

    const name = this.system.resources[key];
    const newName = name ? name : game.i18n.localize("DND5E.resource");

    const props = {
      label: foundry.utils.getProperty(data, "label") ?? "",
      sr: !!foundry.utils.getProperty(data, "sr"),
      lr: !!foundry.utils.getProperty(data, "lr"),
      value: foundry.utils.getProperty(data, "value") ?? "",
      max: foundry.utils.getProperty(data, "max") ?? "",
      name: newName,
      id: key
    };

    const template = "systems/dnd5e/templates/actors/actor-add-new-resource.hbs";
    return renderTemplate(template, props);
  }

  /* -------------------------------------------- */

  /**
   * Handle mouse click events for character sheet actions.
   * @param {MouseEvent} event  The originating click event.
   * @returns {Promise}         Dialog or roll result.
   * @private
   */
  _onSheetAction(event) {
    event.preventDefault();
    const button = event.currentTarget;
    switch ( button.dataset.action ) {
      case "convertCurrency":
        return Dialog.confirm({
          title: `${game.i18n.localize("DND5E.CurrencyConvert")}`,
          content: `<p>${game.i18n.localize("DND5E.CurrencyConvertHint")}</p>`,
          yes: () => this.actor.convertCurrency()
        });
      case "rollDeathSave":
        return this.actor.rollDeathSave({event: event});
      case "rollInitiative":
        return this.actor.rollInitiativeDialog({event});
    }
  }

  /* -------------------------------------------- */

  /**
   * Respond to a new level being selected from the level selector.
   * @param {Event} event                           The originating change.
   * @returns {Promise<AdvancementManager|Item5e>}  Manager if advancements needed, otherwise updated class item.
   * @private
   */
  async _onLevelChange(event) {
    event.preventDefault();
    const delta = Number(event.target.value);
    const classId = event.target.closest(".item")?.dataset.itemId;
    if ( !delta || !classId ) return;
    const classItem = this.actor.items.get(classId);
    if ( !game.settings.get("dnd5e", "disableAdvancements") ) {
      const manager = AdvancementManager.forLevelChange(this.actor, classId, delta);
      if ( manager.steps.length ) {
        if ( delta > 0 ) return manager.render(true);
        try {
          const shouldRemoveAdvancements = await AdvancementConfirmationDialog.forLevelDown(classItem);
          if ( shouldRemoveAdvancements ) return manager.render(true);
        }
        catch(err) {
          return;
        }
      }
    }
    return classItem.update({"system.levels": classItem.system.levels + delta});
  }

  /* -------------------------------------------- */

  /**
   * Handle toggling the state of an Owned Item within the Actor.
   * @param {Event} event        The triggering click event.
   * @returns {Promise<Item5e>}  Item with the updates applied.
   * @private
   */
  _onToggleItem(event) {
    event.preventDefault();
    const itemId = event.currentTarget.closest(".item").dataset.itemId;
    const item = this.actor.items.get(itemId);
    const attr = item.type === "spell" ? "system.preparation.prepared" : "system.equipped";
    return item.update({[attr]: !foundry.utils.getProperty(item, attr)});
  }

  /* -------------------------------------------- */

  /**
   * Take a short rest, calling the relevant function on the Actor instance.
   * @param {Event} event             The triggering click event.
   * @returns {Promise<RestResult>}  Result of the rest action.
   * @private
   */
  async _onShortRest(event) {
    event.preventDefault();
    await this._onSubmit(event);
    return this.actor.shortRest();
  }

  /* -------------------------------------------- */

  /**
   * Take a long rest, calling the relevant function on the Actor instance.
   * @param {Event} event             The triggering click event.
   * @returns {Promise<RestResult>}  Result of the rest action.
   * @private
   */
  async _onLongRest(event) {
    event.preventDefault();
    await this._onSubmit(event);
    return this.actor.longRest();
  }

  /* -------------------------------------------- */

  /** @override */
  async _onDropSingleItem(itemData) {

    // Increment the number of class levels a character instead of creating a new item
    if ( itemData.type === "class" ) {
      const charLevel = this.actor.system.details.level;
      itemData.system.levels = Math.min(itemData.system.levels, CONFIG.DND5E.maxLevel - charLevel);
      if ( itemData.system.levels <= 0 ) {
        const err = game.i18n.format("DND5E.MaxCharacterLevelExceededWarn", { max: CONFIG.DND5E.maxLevel });
        ui.notifications.error(err);
        return false;
      }

      const cls = this.actor.itemTypes.class.find(c => c.identifier === itemData.system.identifier);
      if ( cls ) {
        const priorLevel = cls.system.levels;
        if ( !game.settings.get("dnd5e", "disableAdvancements") ) {
          const manager = AdvancementManager.forLevelChange(this.actor, cls.id, itemData.system.levels);
          if ( manager.steps.length ) {
            manager.render(true);
            return false;
          }
        }
        cls.update({"system.levels": priorLevel + itemData.system.levels});
        return false;
      }
    }

    // If a subclass is dropped, ensure it doesn't match another subclass with the same identifier
    else if ( itemData.type === "subclass" ) {
      const other = this.actor.itemTypes.subclass.find(i => i.identifier === itemData.system.identifier);
      if ( other ) {
        const err = game.i18n.format("DND5E.SubclassDuplicateError", {identifier: other.identifier});
        ui.notifications.error(err);
        return false;
      }
      const cls = this.actor.itemTypes.class.find(i => i.identifier === itemData.system.classIdentifier);
      if ( cls && cls.subclass ) {
        const err = game.i18n.format("DND5E.SubclassAssignmentError", {class: cls.name, subclass: cls.subclass.name});
        ui.notifications.error(err);
        return false;
      }
    }
    return super._onDropSingleItem(itemData);
  }
}
