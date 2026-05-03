const MODULE_ID = "token-transformer";

const FLAGS = {
  REPLACEMENT_UUID: "replacementActorUuid",
  SWAP_STATE: "swapState",
  CACHE_SOURCE_UUID: "cacheSourceUuid",
  IS_CACHE_FOLDER: "isCacheFolder",
  HIDDEN_CACHE_ACTOR: "hiddenCacheActor",
  TRANSFER_SETTINGS: "transferSettings",
  CACHE_VISIBLE: "cacheVisible"
};

const SETTINGS_MENU = "transferDefaults";

const SETTINGS = {
  TRANSFER_NAME_IMAGE: "transferNameImage",
  TRANSFER_SYSTEM: "transferSystem",
  TRANSFER_ITEMS: "transferItems",
  TRANSFER_ABILITY_ITEMS: "transferAbilityItems",
  TRANSFER_EFFECTS: "transferEffects",
  TRANSFER_TOKEN_APPEARANCE: "transferTokenAppearance",
  CARRY_ACTIVE_EFFECTS: "carryActiveEffects",
  CACHE_VISIBLE: "cacheVisible"
};

const HP_MAX_PATH = "system.hp.max";
const HP_VALUE_PATH = "system.hp.value";
const ACKS_MINIMUM_HP = -99;
const CACHE_FOLDER_NAME = "Token Transformer Cache";

const TOKEN_APPEARANCE_FIELDS = [
  "name", "texture", "width", "height", "scale", "mirrorX", "mirrorY",
  "alpha", "bar1", "bar2", "displayBars", "displayName", "disposition",
  "sight", "detectionModes", "light", "occludable", "ring",
  "lockRotation", "rotation"
];

const BaseFormApplication =
  globalThis.FormApplication ??
  foundry?.appv1?.api?.FormApplication;

Hooks.once("init", () => {
  registerSettings();
  injectStyles();
});

Hooks.once("ready", async () => {
  if (game.user.isGM) await cleanCache();
});

Hooks.on("renderApplicationV2", injectActorSheetButton);
Hooks.on("renderActorSheet", injectActorSheetButton);
Hooks.on("renderActorSheetV2", injectActorSheetButton);
Hooks.on("renderACKSActorSheetV2", injectActorSheetButton);
Hooks.on("renderACKSCharacterSheetV2", injectActorSheetButton);
Hooks.on("renderACKSMonsterSheetV2", injectActorSheetButton);

Hooks.on("renderTokenHUD", injectTokenHudButton);
Hooks.on("renderActorDirectory", hideHiddenCacheFromActorDirectory);

Hooks.on("deleteToken", () => {
  if (game.user.isGM) cleanCache();
});

Hooks.on("deleteScene", () => {
  if (game.user.isGM) cleanCache();
});

/* ------------------------------------------------------------------------- */
/* GLOBAL DEFAULT SETTINGS                                                    */
/* ------------------------------------------------------------------------- */

class TokenTransformerDefaultsMenu extends BaseFormApplication {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "token-transformer-defaults-shim",
      title: "Token Transformer Defaults",
      template: "templates/blank.hbs",
      width: 1,
      height: 1,
      closeOnSubmit: true
    });
  }

  async render(force, options) {
    await openGlobalDefaultsDialog();
    return this;
  }
}

function registerSettings() {
  game.settings.registerMenu(MODULE_ID, SETTINGS_MENU, {
    name: "Token Transformer",
    label: "Configure Global Defaults",
    hint: "Default transfer behaviour used by actors and tokens that do not have their own Token Transformer settings.",
    icon: "fa-solid fa-people-arrows",
    type: TokenTransformerDefaultsMenu,
    restricted: true
  });

  registerBooleanSetting(SETTINGS.TRANSFER_NAME_IMAGE, true);
  registerBooleanSetting(SETTINGS.TRANSFER_SYSTEM, true);
  registerBooleanSetting(SETTINGS.TRANSFER_ITEMS, true);
  registerBooleanSetting(SETTINGS.TRANSFER_ABILITY_ITEMS, true);
  registerBooleanSetting(SETTINGS.TRANSFER_EFFECTS, true);
  registerBooleanSetting(SETTINGS.TRANSFER_TOKEN_APPEARANCE, true);
  registerBooleanSetting(SETTINGS.CARRY_ACTIVE_EFFECTS, true);
  registerBooleanSetting(SETTINGS.CACHE_VISIBLE, false);
}

function registerBooleanSetting(key, defaultValue) {
  game.settings.register(MODULE_ID, key, {
    scope: "world",
    config: false,
    type: Boolean,
    default: defaultValue
  });
}

function getGlobalTransferDefaults() {
  return {
    transferNameImage: game.settings.get(MODULE_ID, SETTINGS.TRANSFER_NAME_IMAGE),
    transferSystem: game.settings.get(MODULE_ID, SETTINGS.TRANSFER_SYSTEM),
    transferItems: game.settings.get(MODULE_ID, SETTINGS.TRANSFER_ITEMS),
    transferAbilityItems: game.settings.get(MODULE_ID, SETTINGS.TRANSFER_ABILITY_ITEMS),
    transferEffects: game.settings.get(MODULE_ID, SETTINGS.TRANSFER_EFFECTS),
    transferTokenAppearance: game.settings.get(MODULE_ID, SETTINGS.TRANSFER_TOKEN_APPEARANCE),
    carryActiveEffects: game.settings.get(MODULE_ID, SETTINGS.CARRY_ACTIVE_EFFECTS),
    cacheVisible: game.settings.get(MODULE_ID, SETTINGS.CACHE_VISIBLE)
  };
}

async function openGlobalDefaultsDialog() {
  const settings = getGlobalTransferDefaults();

  const content = `
    <form class="token-transformer-settings-form">
      <p class="notes">
        These are global defaults. Actor-specific settings override these.
        ACKS HP damage is always carried.
      </p>

      ${settingCheckbox("transferNameImage", "Transfer name and portrait image", settings.transferNameImage)}
      ${settingCheckbox("transferSystem", "Transfer full ACKS system data", settings.transferSystem)}
      ${settingCheckbox("transferItems", "Transfer all items", settings.transferItems)}
      ${settingCheckbox("transferAbilityItems", "Transfer ability items", settings.transferAbilityItems)}
      ${settingCheckbox("transferEffects", "Transfer active effects from UUID Actor", settings.transferEffects)}
      ${settingCheckbox("transferTokenAppearance", "Transfer prototype token appearance", settings.transferTokenAppearance)}
      ${settingCheckbox("carryActiveEffects", "Carry current token active effects across forms", settings.carryActiveEffects)}
      ${settingCheckbox("cacheVisible", "Show transformed cache actor in Actor Directory", settings.cacheVisible)}

      <hr>

      <p class="notes">
        Clear Cache deletes only unused cached transform actors. Cached actors still referenced by scene tokens are kept.
      </p>
    </form>
  `;

  return dialogV2({
    title: "Token Transformer Defaults",
    content,
    buttons: [
      {
        action: "clear-cache",
        label: "Clear Cache",
        icon: "fa-solid fa-broom",
        callback: async () => {
          const deleted = await cleanCache({ notify: false });
          ui.notifications.info(`Token Transformer cache cleaned. Deleted ${deleted} unused cached actor(s).`);
          return false;
        }
      },
      {
        action: "save",
        label: "Save",
        icon: "fa-solid fa-save",
        default: true,
        callback: async (_event, button) => {
          const form = button.form;
          await game.settings.set(MODULE_ID, SETTINGS.TRANSFER_NAME_IMAGE, Boolean(form.elements.transferNameImage?.checked));
          await game.settings.set(MODULE_ID, SETTINGS.TRANSFER_SYSTEM, Boolean(form.elements.transferSystem?.checked));
          await game.settings.set(MODULE_ID, SETTINGS.TRANSFER_ITEMS, Boolean(form.elements.transferItems?.checked));
          await game.settings.set(MODULE_ID, SETTINGS.TRANSFER_ABILITY_ITEMS, Boolean(form.elements.transferAbilityItems?.checked));
          await game.settings.set(MODULE_ID, SETTINGS.TRANSFER_EFFECTS, Boolean(form.elements.transferEffects?.checked));
          await game.settings.set(MODULE_ID, SETTINGS.TRANSFER_TOKEN_APPEARANCE, Boolean(form.elements.transferTokenAppearance?.checked));
          await game.settings.set(MODULE_ID, SETTINGS.CARRY_ACTIVE_EFFECTS, Boolean(form.elements.carryActiveEffects?.checked));
          await game.settings.set(MODULE_ID, SETTINGS.CACHE_VISIBLE, Boolean(form.elements.cacheVisible?.checked));
          ui.notifications.info("Token Transformer defaults saved.");
          return true;
        }
      },
      {
        action: "cancel",
        label: "Cancel",
        icon: "fa-solid fa-xmark"
      }
    ]
  });
}

/* ------------------------------------------------------------------------- */
/* ACTOR SETTINGS                                                             */
/* ------------------------------------------------------------------------- */

function getResolvedTransferSettings(tokenDoc = null, actor = null) {
  const defaults = getGlobalTransferDefaults();
  const baseActor = actor ?? getTokenWorldBaseActor(tokenDoc);

  const prototypeSettings =
    getProperty(baseActor, `prototypeToken.flags.${MODULE_ID}.${FLAGS.TRANSFER_SETTINGS}`) ?? {};

  const actorSettings =
    baseActor?.getFlag?.(MODULE_ID, FLAGS.TRANSFER_SETTINGS) ?? {};

  const tokenSettings =
    tokenDoc?.getFlag?.(MODULE_ID, FLAGS.TRANSFER_SETTINGS) ?? {};

  const prototypeCacheVisible =
    getProperty(baseActor, `prototypeToken.flags.${MODULE_ID}.${FLAGS.CACHE_VISIBLE}`);

  const actorCacheVisible =
    baseActor?.getFlag?.(MODULE_ID, FLAGS.CACHE_VISIBLE);

  const tokenCacheVisible =
    tokenDoc?.getFlag?.(MODULE_ID, FLAGS.CACHE_VISIBLE);

  return {
    ...defaults,
    ...prototypeSettings,
    ...actorSettings,
    ...tokenSettings,
    cacheVisible:
      tokenCacheVisible ??
      actorCacheVisible ??
      prototypeCacheVisible ??
      defaults.cacheVisible
  };
}

function normalizeTransferSettingsFromForm(form) {
  return {
    transferNameImage: Boolean(form.elements.transferNameImage?.checked),
    transferSystem: Boolean(form.elements.transferSystem?.checked),
    transferItems: Boolean(form.elements.transferItems?.checked),
    transferAbilityItems: Boolean(form.elements.transferAbilityItems?.checked),
    transferEffects: Boolean(form.elements.transferEffects?.checked),
    transferTokenAppearance: Boolean(form.elements.transferTokenAppearance?.checked),
    carryActiveEffects: Boolean(form.elements.carryActiveEffects?.checked),
    cacheVisible: Boolean(form.elements.cacheVisible?.checked)
  };
}

function settingCheckbox(name, label, checked) {
  return `
    <div class="form-group">
      <label>${escapeHtml(label)}</label>
      <input type="checkbox" name="${name}" ${checked ? "checked" : ""}>
    </div>
  `;
}

function transferSettingsFields(settings) {
  return `
    ${settingCheckbox("transferNameImage", "Transfer name and portrait image", settings.transferNameImage)}
    ${settingCheckbox("transferSystem", "Transfer full ACKS system data", settings.transferSystem)}
    ${settingCheckbox("transferItems", "Transfer all items", settings.transferItems)}
    ${settingCheckbox("transferAbilityItems", "Transfer ability items", settings.transferAbilityItems)}
    ${settingCheckbox("transferEffects", "Transfer active effects from UUID Actor", settings.transferEffects)}
    ${settingCheckbox("transferTokenAppearance", "Transfer prototype token appearance", settings.transferTokenAppearance)}
    ${settingCheckbox("carryActiveEffects", "Carry current token active effects across forms", settings.carryActiveEffects)}
    ${settingCheckbox("cacheVisible", "Show transformed cache actor in Actor Directory", settings.cacheVisible)}
  `;
}

/* ------------------------------------------------------------------------- */
/* ACTOR SHEET BUTTON                                                         */
/* ------------------------------------------------------------------------- */

function injectActorSheetButton(app, element) {
  const actor = getSheetActor(app);
  if (!isActorDocument(actor)) return;
  if (!canUpdateDocument(actor)) return;

  const root = getElement(element) ?? getElement(app.element);
  if (!root || root.querySelector(".token-transformer-sheet-button")) return;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "token-transformer-sheet-button";
  button.title = "Configure Token Transformer for this Actor";
  button.innerHTML = `<i class="fa-solid fa-people-arrows"></i>`;

  button.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    configureActorTransformer(actor);
  });

  const headerControls =
    root.querySelector(".window-header .window-controls") ??
    root.querySelector(".window-header .header-actions") ??
    root.querySelector(".window-header");

  if (headerControls) {
    const firstControl =
      headerControls.querySelector(".header-control") ??
      headerControls.querySelector("button") ??
      headerControls.firstElementChild;

    if (firstControl) headerControls.insertBefore(button, firstControl);
    else headerControls.prepend(button);
    return;
  }

  const sheetHeader = root.querySelector(".sheet-header") ?? root.querySelector("header") ?? root;
  sheetHeader.prepend(button);
}

async function configureActorTransformer(actor) {
  const currentUuid =
    actor.getFlag(MODULE_ID, FLAGS.REPLACEMENT_UUID) ??
    getProperty(actor, `prototypeToken.flags.${MODULE_ID}.${FLAGS.REPLACEMENT_UUID}`) ??
    "";

  const settings = getResolvedTransferSettings(null, actor);

  const content = `
    <form class="token-transformer-settings-form">
      <div class="form-group stacked">
        <label>Replacement Actor UUID</label>
        <input
          type="text"
          name="uuid"
          value="${escapeHtml(currentUuid)}"
          placeholder="Actor.xxxxx or Compendium.package.pack.Actor.xxxxx"
          style="width: 100%;"
          autofocus
        />
        <p class="notes">
          Saved to both the Actor and its prototype token, so imported tokens can inherit it.
          Leave blank to clear.
        </p>
      </div>

      <hr>

      <p class="notes">
        These settings apply to this Actor and its prototype token.
      </p>

      ${transferSettingsFields(settings)}
    </form>
  `;

  await dialogV2({
    title: `Token Transformer: ${actor.name}`,
    content,
    buttons: [
      {
        action: "save",
        label: "Save",
        icon: "fa-solid fa-save",
        default: true,
        callback: async (_event, button) => {
          const form = button.form;
          const uuid = form.elements.uuid?.value?.trim() ?? "";
          const transferSettings = normalizeTransferSettingsFromForm(form);

          if (uuid) {
            const replacementActor = await resolveActorUuid(uuid);

            await actor.update({
              [`flags.${MODULE_ID}.${FLAGS.REPLACEMENT_UUID}`]: replacementActor.uuid,
              [`flags.${MODULE_ID}.${FLAGS.TRANSFER_SETTINGS}`]: transferSettings,
              [`flags.${MODULE_ID}.${FLAGS.CACHE_VISIBLE}`]: transferSettings.cacheVisible,

              [`prototypeToken.flags.${MODULE_ID}.${FLAGS.REPLACEMENT_UUID}`]: replacementActor.uuid,
              [`prototypeToken.flags.${MODULE_ID}.${FLAGS.TRANSFER_SETTINGS}`]: transferSettings,
              [`prototypeToken.flags.${MODULE_ID}.${FLAGS.CACHE_VISIBLE}`]: transferSettings.cacheVisible
            });

            ui.notifications.info(`${actor.name}: transform Actor set to ${replacementActor.name}.`);
          } else {
            await actor.update({
              [`flags.${MODULE_ID}.${FLAGS.REPLACEMENT_UUID}`]: null,
              [`flags.${MODULE_ID}.${FLAGS.TRANSFER_SETTINGS}`]: transferSettings,
              [`flags.${MODULE_ID}.${FLAGS.CACHE_VISIBLE}`]: transferSettings.cacheVisible,

              [`prototypeToken.flags.${MODULE_ID}.${FLAGS.REPLACEMENT_UUID}`]: null,
              [`prototypeToken.flags.${MODULE_ID}.${FLAGS.TRANSFER_SETTINGS}`]: transferSettings,
              [`prototypeToken.flags.${MODULE_ID}.${FLAGS.CACHE_VISIBLE}`]: transferSettings.cacheVisible
            });

            ui.notifications.info(`${actor.name}: transform Actor UUID cleared; transfer settings saved.`);
          }

          return true;
        }
      },
      {
        action: "cancel",
        label: "Cancel",
        icon: "fa-solid fa-xmark"
      }
    ]
  });
}

/* ------------------------------------------------------------------------- */
/* TOKEN HUD TRANSFORM BUTTON ONLY                                            */
/* ------------------------------------------------------------------------- */

function injectTokenHudButton(hud, element) {
  const tokenDoc = hud.object?.document;
  if (!tokenDoc || !canUpdateDocument(tokenDoc)) return;
  if (!tokenHasSwapAvailable(tokenDoc)) return;

  const root = getElement(element) ?? getElement(hud.element);
  if (!root) return;
  if (root.querySelector(".token-transformer-hud-button")) return;

  const parent = root.querySelector(".col.right") ?? root.querySelector(".right") ?? root;
  const isSwapped = getSwapState(tokenDoc)?.isSwapped === true;

  const button = document.createElement("div");
  button.className = "control-icon token-transformer-hud-button";
  button.title = isSwapped ? "Restore original form" : "Transform token";
  button.innerHTML = `<i class="fa-solid fa-people-arrows"></i>`;

  button.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    toggleTokenForm(tokenDoc);
  });

  parent.appendChild(button);
}

async function toggleTokenForm(tokenDoc) {
  try {
    const state = getSwapState(tokenDoc);

    if (state?.isSwapped) await restoreOriginalForm(tokenDoc, state);
    else await swapToReplacementForm(tokenDoc);

    if (game.user.isGM) await cleanCache();

    canvas?.hud?.token?.clear?.();
  } catch (error) {
    console.error(`${MODULE_ID} | Token transform failed`, error);
    ui.notifications.error(error.message ?? "Token transform failed.");
  }
}

/* ------------------------------------------------------------------------- */
/* SWAPPING                                                                   */
/* ------------------------------------------------------------------------- */

async function swapToReplacementForm(tokenDoc) {
  const originalActor = getTokenWorldBaseActor(tokenDoc);
  if (!originalActor) throw new Error("This token does not have a world Actor base.");

  const replacementUuid = getReplacementUuidForToken(tokenDoc);
  if (!replacementUuid) throw new Error(`${originalActor.name} does not have a transform Actor UUID set.`);

  const replacementSourceActor = await resolveActorUuid(replacementUuid);
  const settings = getResolvedTransferSettings(tokenDoc);

  const currentDamage = getAcksDamageFromActor(tokenDoc.actor);
  const carriedEffects = settings.carryActiveEffects ? getCarriedEffectData(tokenDoc.actor) : [];
  const tokenSource = tokenDoc.toObject();

  const state = {
    isSwapped: true,
    originalActorUuid: originalActor.uuid,
    originalActorId: originalActor.id,
    originalActorLink: isTokenLinked(tokenDoc),
    originalDelta: duplicateData(tokenSource.delta ?? {}),
    originalAppearance: pickTokenAppearance(tokenSource),
    replacementActorUuid: replacementSourceActor.uuid
  };

  const materializedActor = await materializeTransformActor(replacementSourceActor, settings);
  const replacementAppearance = settings.transferTokenAppearance
    ? await getActorPrototypeAppearance(replacementSourceActor)
    : {};

  const update = {
    actorId: materializedActor.id,
    actorLink: false,
    delta: buildTransformDelta(materializedActor, currentDamage, carriedEffects, settings),
    ...replacementAppearance,
    [`flags.${MODULE_ID}.${FLAGS.SWAP_STATE}`]: state
  };

  await tokenDoc.update(update);
  ui.notifications.info(`${tokenDoc.name} transformed into ${replacementSourceActor.name}.`);
}

async function restoreOriginalForm(tokenDoc, state) {
  const originalActor = await resolveActorUuid(state.originalActorUuid);
  if (!isWorldActor(originalActor)) throw new Error("The original Actor is no longer a world Actor.");

  const settings = getResolvedTransferSettings(tokenDoc);
  const currentDamage = getAcksDamageFromActor(tokenDoc.actor);
  const carriedEffects = settings.carryActiveEffects ? getCarriedEffectData(tokenDoc.actor) : [];

  const appearance =
    state.originalAppearance && Object.keys(state.originalAppearance).length
      ? duplicateData(state.originalAppearance)
      : await getActorPrototypeAppearance(originalActor);

  if (state.originalActorLink) {
    await applyDamageAndEffectsToWorldActor(originalActor, currentDamage, carriedEffects);

    await tokenDoc.update({
      actorId: originalActor.id,
      actorLink: true,
      delta: {},
      ...appearance,
      [`flags.${MODULE_ID}.${FLAGS.SWAP_STATE}`]: { ...state, isSwapped: false }
    });
  } else {
    await tokenDoc.update({
      actorId: originalActor.id,
      actorLink: false,
      delta: buildRestoredOriginalDelta(originalActor, state.originalDelta, currentDamage, carriedEffects),
      ...appearance,
      [`flags.${MODULE_ID}.${FLAGS.SWAP_STATE}`]: { ...state, isSwapped: false }
    });
  }

  ui.notifications.info(`${tokenDoc.name} restored to ${originalActor.name}.`);
}

/* ------------------------------------------------------------------------- */
/* MATERIALIZED ACTOR CACHE                                                   */
/* ------------------------------------------------------------------------- */

async function materializeTransformActor(sourceActor, settings) {
  const sourceUuid = sourceActor.uuid;
  const sourceData = sourceActor.toObject();
  const folder = await getOrCreateCacheFolder();

  let cached = game.actors.find(actor => actor.getFlag(MODULE_ID, FLAGS.CACHE_SOURCE_UUID) === sourceUuid);

  if (cached && cached.type !== sourceActor.type) {
    await cached.delete();
    cached = null;
  }

  const actorData = buildMaterializedActorData(sourceData, sourceUuid, settings, folder?.id);

  if (!cached) {
    cached = await Actor.implementation.create(actorData);
    return cached;
  }

  await cached.update({
    name: actorData.name,
    img: actorData.img,
    system: actorData.system,
    prototypeToken: actorData.prototypeToken,
    flags: actorData.flags,
    folder: actorData.folder
  });

  await replaceEmbeddedCollection(cached, "Item", actorData.items ?? []);
  await replaceEmbeddedCollection(cached, "ActiveEffect", actorData.effects ?? []);

  return cached;
}

function buildMaterializedActorData(sourceData, sourceUuid, settings, folderId) {
  const data = {
    name: settings.transferNameImage ? sourceData.name : `Transformed ${sourceData.name}`,
    type: sourceData.type,
    img: sourceData.img,
    system: settings.transferSystem ? duplicateData(sourceData.system ?? {}) : {},
    prototypeToken: duplicateData(sourceData.prototypeToken ?? {}),
    items: selectSourceItems(sourceData.items ?? [], settings),
    effects: settings.transferEffects ? duplicateData(sourceData.effects ?? []) : [],
    flags: duplicateData(sourceData.flags ?? {})
  };

  delete data._id;
  delete data.ownership;
  delete data.sort;

  if (folderId) data.folder = folderId;

  data.flags[MODULE_ID] ??= {};
  data.flags[MODULE_ID][FLAGS.CACHE_SOURCE_UUID] = sourceUuid;
  data.flags[MODULE_ID][FLAGS.HIDDEN_CACHE_ACTOR] = !settings.cacheVisible;
  data.flags[MODULE_ID][FLAGS.CACHE_VISIBLE] = settings.cacheVisible;

  delete data.flags[MODULE_ID][FLAGS.REPLACEMENT_UUID];

  if (data.prototypeToken) {
    data.prototypeToken.actorLink = false;
    data.prototypeToken.flags ??= {};
    data.prototypeToken.flags[MODULE_ID] ??= {};
    delete data.prototypeToken.flags[MODULE_ID][FLAGS.REPLACEMENT_UUID];
  }

  return data;
}

function selectSourceItems(items, settings) {
  if (settings.transferItems) return duplicateData(items);
  if (settings.transferAbilityItems) return duplicateData(items.filter(item => item.type === "ability"));
  return [];
}

async function getOrCreateCacheFolder() {
  let folder = game.folders.find(f =>
    f.type === "Actor" &&
    f.getFlag(MODULE_ID, FLAGS.IS_CACHE_FOLDER)
  );

  if (folder) return folder;

  folder = game.folders.find(f =>
    f.type === "Actor" &&
    f.name === CACHE_FOLDER_NAME
  );

  if (folder) {
    await folder.setFlag(MODULE_ID, FLAGS.IS_CACHE_FOLDER, true);
    return folder;
  }

  return Folder.create({
    name: CACHE_FOLDER_NAME,
    type: "Actor",
    sorting: "a",
    flags: {
      [MODULE_ID]: {
        [FLAGS.IS_CACHE_FOLDER]: true
      }
    }
  });
}

async function replaceEmbeddedCollection(parent, embeddedName, documents) {
  const existingIds = Array.from(parent.getEmbeddedCollection(embeddedName) ?? []).map(document => document.id);
  if (existingIds.length) await parent.deleteEmbeddedDocuments(embeddedName, existingIds);

  if (documents?.length) {
    const cleanDocs = duplicateData(documents).map(document => {
      delete document._id;
      return document;
    });

    await parent.createEmbeddedDocuments(embeddedName, cleanDocs);
  }
}

async function cleanCache({ notify = false } = {}) {
  if (!game.user.isGM) return 0;

  const usedActorIds = new Set();

  for (const scene of game.scenes) {
    for (const token of scene.tokens) {
      if (token.actorId) usedActorIds.add(token.actorId);
    }
  }

  const cachedActors = game.actors.filter(actor =>
    actor.getFlag(MODULE_ID, FLAGS.CACHE_SOURCE_UUID)
  );

  let deleted = 0;

  for (const actor of cachedActors) {
    if (!usedActorIds.has(actor.id)) {
      await actor.delete();
      deleted += 1;
    }
  }

  await deleteEmptyCacheFolders();

  if (notify) {
    ui.notifications.info(`Token Transformer cache cleaned. Deleted ${deleted} unused cached actor(s).`);
  }

  return deleted;
}

async function deleteEmptyCacheFolders() {
  const folders = game.folders.filter(folder =>
    folder.type === "Actor" &&
    folder.getFlag(MODULE_ID, FLAGS.IS_CACHE_FOLDER)
  );

  for (const folder of folders) {
    const hasCachedActors = game.actors.some(actor => actor.folder?.id === folder.id);
    if (!hasCachedActors) await folder.delete();
  }
}

function hideHiddenCacheFromActorDirectory(_app, html) {
  const root = getElement(html);
  if (!root) return;

  const hiddenActors = game.actors.filter(actor =>
    actor.getFlag(MODULE_ID, FLAGS.HIDDEN_CACHE_ACTOR)
  );

  for (const actor of hiddenActors) {
    root.querySelector(`[data-document-id="${actor.id}"]`)?.closest(".directory-item")?.remove();
    root.querySelector(`[data-entry-id="${actor.id}"]`)?.closest(".directory-item")?.remove();
    root.querySelector(`[data-document-id="${actor.id}"]`)?.remove();
    root.querySelector(`[data-entry-id="${actor.id}"]`)?.remove();
  }

  const folders = game.folders.filter(folder =>
    folder.type === "Actor" &&
    folder.getFlag(MODULE_ID, FLAGS.IS_CACHE_FOLDER)
  );

  for (const folder of folders) {
    const visibleCacheActors = game.actors.filter(actor =>
      actor.folder?.id === folder.id &&
      actor.getFlag(MODULE_ID, FLAGS.HIDDEN_CACHE_ACTOR) !== true
    );

    if (visibleCacheActors.length > 0) continue;

    root.querySelector(`[data-folder-id="${folder.id}"]`)?.closest(".folder")?.remove();
    root.querySelector(`[data-folder-id="${folder.id}"]`)?.remove();
  }
}

/* ------------------------------------------------------------------------- */
/* DELTAS                                                                     */
/* ------------------------------------------------------------------------- */

function buildTransformDelta(actor, damage, carriedEffects, settings) {
  const delta = {
    type: actor.type,
    system: {},
    effects: []
  };

  applyAcksDamageToData(delta, actor, damage);

  if (settings.carryActiveEffects && carriedEffects.length) {
    delta.effects = duplicateData(carriedEffects).map(effect => {
      delete effect._id;
      return effect;
    });
  }

  return scrubActorDelta(delta);
}

function buildRestoredOriginalDelta(originalActor, originalDelta, damage, carriedEffects) {
  const delta = duplicateData(originalDelta ?? {});
  delta.type ??= originalActor.type;
  delta.flags ??= {};
  delta.system ??= {};
  delta.effects = duplicateData(carriedEffects ?? []);
  applyAcksDamageToData(delta, originalActor, damage);
  return scrubActorDelta(delta);
}

function scrubActorDelta(delta) {
  const clean = duplicateData(delta ?? {});
  delete clean._id;
  delete clean.folder;
  delete clean.sort;
  delete clean.ownership;
  delete clean.prototypeToken;
  return clean;
}

/* ------------------------------------------------------------------------- */
/* ACKS HP AND EFFECTS                                                        */
/* ------------------------------------------------------------------------- */

function getAcksDamageFromActor(actor) {
  if (!actor) return null;

  const max = Number(getProperty(actor, HP_MAX_PATH));
  const value = Number(getProperty(actor, HP_VALUE_PATH));

  if (!Number.isFinite(max) || !Number.isFinite(value)) return null;

  return max - value;
}

function applyAcksDamageToData(data, fallbackActor, damage) {
  if (!Number.isFinite(damage)) return false;

  let max = Number(getProperty(data, HP_MAX_PATH));
  if (!Number.isFinite(max)) max = Number(getProperty(fallbackActor, HP_MAX_PATH));
  if (!Number.isFinite(max)) return false;

  setProperty(data, HP_VALUE_PATH, clampNumber(max - damage, ACKS_MINIMUM_HP, max));
  return true;
}

async function applyDamageAndEffectsToWorldActor(actor, damage, effects) {
  const update = {};

  if (Number.isFinite(damage)) {
    const max = Number(getProperty(actor, HP_MAX_PATH));
    if (Number.isFinite(max)) update[HP_VALUE_PATH] = clampNumber(max - damage, ACKS_MINIMUM_HP, max);
  }

  if (Object.keys(update).length) await actor.update(update);
  await replaceActorEffects(actor, effects);
}

function getCarriedEffectData(actor) {
  if (!actor?.effects) return [];
  return Array.from(actor.effects).map(effect => scrubEffectData(effect.toObject()));
}

function scrubEffectData(effectData) {
  const clean = duplicateData(effectData ?? {});
  delete clean.parent;
  delete clean.pack;
  return clean;
}

async function replaceActorEffects(actor, effects) {
  await replaceEmbeddedCollection(actor, "ActiveEffect", effects ?? []);
}

/* ------------------------------------------------------------------------- */
/* TOKEN APPEARANCE                                                           */
/* ------------------------------------------------------------------------- */

async function getActorPrototypeAppearance(actor) {
  const tokenDoc = await actor.getTokenDocument();
  return pickTokenAppearance(tokenDoc.toObject());
}

function pickTokenAppearance(source) {
  const appearance = {};
  for (const field of TOKEN_APPEARANCE_FIELDS) {
    if (source[field] !== undefined) appearance[field] = duplicateData(source[field]);
  }
  return appearance;
}

/* ------------------------------------------------------------------------- */
/* ACTOR / TOKEN HELPERS                                                      */
/* ------------------------------------------------------------------------- */

function tokenHasSwapAvailable(tokenDoc) {
  const state = getSwapState(tokenDoc);
  if (state?.isSwapped && state?.originalActorUuid) return true;
  return Boolean(getReplacementUuidForToken(tokenDoc));
}

function getReplacementUuidForToken(tokenDoc) {
  const baseActor = getTokenWorldBaseActor(tokenDoc);

  return (
    tokenDoc?.getFlag?.(MODULE_ID, FLAGS.REPLACEMENT_UUID) ??
    getProperty(tokenDoc, `flags.${MODULE_ID}.${FLAGS.REPLACEMENT_UUID}`) ??
    tokenDoc?.actor?.getFlag?.(MODULE_ID, FLAGS.REPLACEMENT_UUID) ??
    getProperty(tokenDoc?.actor, `prototypeToken.flags.${MODULE_ID}.${FLAGS.REPLACEMENT_UUID}`) ??
    getProperty(baseActor, `prototypeToken.flags.${MODULE_ID}.${FLAGS.REPLACEMENT_UUID}`) ??
    baseActor?.getFlag?.(MODULE_ID, FLAGS.REPLACEMENT_UUID) ??
    null
  );
}

function getSwapState(tokenDoc) {
  return tokenDoc.getFlag(MODULE_ID, FLAGS.SWAP_STATE) ?? {};
}

function getTokenWorldBaseActor(tokenDoc) {
  if (!tokenDoc) return null;
  if (tokenDoc.actorId && game.actors?.get(tokenDoc.actorId)) return game.actors.get(tokenDoc.actorId);

  const actor = tokenDoc.actor;
  if (isWorldActor(actor)) return actor;

  const baseActor = actor?.baseActor ?? actor?.token?.baseActor ?? actor?.token?.actor?.baseActor;
  if (isWorldActor(baseActor)) return baseActor;

  return null;
}

function getSheetActor(app) {
  const doc = app?.document ?? app?.actor ?? app?.object;
  if (isActorDocument(doc)) return doc;
  if (isActorDocument(app?.object?.actor)) return app.object.actor;
  return null;
}

async function resolveActorUuid(uuid) {
  const cleanUuid = String(uuid ?? "").trim();
  if (!cleanUuid) throw new Error("No Actor UUID was provided.");

  const doc = foundry?.utils?.fromUuid
    ? await foundry.utils.fromUuid(cleanUuid)
    : await fromUuid(cleanUuid);

  if (!doc || !isActorDocument(doc)) {
    throw new Error(`The UUID "${cleanUuid}" did not resolve to an Actor.`);
  }

  return doc;
}

function isActorDocument(doc) {
  if (!doc) return false;
  if (doc.documentName === "Actor") return true;

  const ActorClass = CONFIG?.Actor?.documentClass;
  return Boolean(ActorClass && doc instanceof ActorClass);
}

function isWorldActor(actor) {
  return Boolean(actor && isActorDocument(actor) && !actor.pack && actor.id && game.actors?.get(actor.id));
}

function isTokenLinked(tokenDoc) {
  return tokenDoc?.actorLink === true || tokenDoc?.isLinked === true;
}

function canUpdateDocument(document) {
  if (!document) return false;
  if (game.user?.isGM) return true;
  if (document.canUserModify) return document.canUserModify(game.user, "update");
  return Boolean(document.isOwner);
}

/* ------------------------------------------------------------------------- */
/* DIALOGS / UI                                                               */
/* ------------------------------------------------------------------------- */

async function dialogV2({ title, content, buttons }) {
  const DialogV2 = foundry?.applications?.api?.DialogV2;

  if (DialogV2?.wait) {
    return DialogV2.wait({
      window: { title },
      content,
      modal: true,
      buttons,
      rejectClose: false
    });
  }

  const defaultButton = buttons.find(button => button.default) ?? buttons[0];

  return Dialog.prompt({
    title,
    content,
    label: defaultButton.label,
    rejectClose: false,
    callback: async html => {
      const root = getElement(html);
      const fakeButton = { form: root?.querySelector("form") };
      return defaultButton.callback?.(null, fakeButton);
    }
  });
}

function injectStyles() {
  if (document.getElementById(`${MODULE_ID}-styles`)) return;

  const style = document.createElement("style");
  style.id = `${MODULE_ID}-styles`;
  style.textContent = `
    .token-transformer-sheet-button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      margin-right: 4px;
      padding: 0;
      border: none;
      outline: none;
      box-shadow: none;
      background: transparent;
      color: inherit;
      cursor: pointer;
      pointer-events: auto;
      font-size: 13px;
    }

    .token-transformer-sheet-button:hover {
      text-shadow: 0 0 6px var(--color-shadow-primary, red);
      background: transparent;
      border: none;
      outline: none;
      box-shadow: none;
    }

    .token-transformer-hud-button {
      cursor: pointer;
      pointer-events: auto;
    }

    .token-transformer-hud-button i,
    .token-transformer-sheet-button i {
      pointer-events: none;
    }

    .token-transformer-settings-form .form-group {
      align-items: center;
    }

    .token-transformer-settings-form input[type="checkbox"] {
      flex: 0 0 20px;
    }
  `;

  document.head.appendChild(style);
}

/* ------------------------------------------------------------------------- */
/* DATA HELPERS                                                               */
/* ------------------------------------------------------------------------- */

function getElement(value) {
  if (!value) return null;
  if (value instanceof HTMLElement) return value;
  if (value instanceof DocumentFragment) return value;
  if (value.jquery) return value[0] ?? null;
  if (value[0] instanceof HTMLElement) return value[0];
  return null;
}

function getProperty(object, path) {
  if (foundry?.utils?.getProperty) return foundry.utils.getProperty(object, path);
  return path.split(".").reduce((value, key) => value?.[key], object);
}

function setProperty(object, path, value) {
  if (foundry?.utils?.setProperty) return foundry.utils.setProperty(object, path, value);

  const parts = path.split(".");
  let target = object;

  while (parts.length > 1) {
    const part = parts.shift();
    if (!target[part] || typeof target[part] !== "object") target[part] = {};
    target = target[part];
  }

  target[parts[0]] = value;
  return true;
}

function duplicateData(data) {
  if (data === undefined || data === null) return data;
  if (foundry?.utils?.deepClone) return foundry.utils.deepClone(data);
  if (foundry?.utils?.duplicate) return foundry.utils.duplicate(data);
  if (globalThis.structuredClone) return structuredClone(data);
  return JSON.parse(JSON.stringify(data));
}

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = String(value ?? "");
  return div.innerHTML;
}

function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
