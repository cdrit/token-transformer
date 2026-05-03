/*
 * module.js
 *
 * Foundry VTT v13/v14
 * ACKS II Core compatible actor/token form swapper.
 *
 * Target system:
 *   https://github.com/AutarchLLC/foundryvtt-acks-core
 *
 * Behaviour:
 * - Adds an actor sheet header/window button.
 * - Button opens a UUID text input.
 * - Stores the replacement Actor UUID on the original Actor.
 * - Adds a Token HUD/context button when a token can be swapped.
 * - Swaps the token into the replacement Actor form.
 * - Supports world Actor UUIDs and compendium Actor UUIDs.
 * - Transfers ACKS damage as:
 *
 *      damage = system.hp.max - system.hp.value
 *
 * - Applies damage to the new form as:
 *
 *      new system.hp.value = new system.hp.max - damage
 *
 * - Preserves ACKS negative HP down to -99, matching ACKS actor damage logic.
 * - Transfers active effects both ways.
 */

const MODULE_ID = "token-transformer";

const ACKS_SYSTEM_ID = "acks";

const FLAGS = {
  REPLACEMENT_UUID: "replacementActorUuid",
  SWAP_STATE: "swapState",
  FORM_BASE_EFFECT: "formBaseEffect"
};

const ACTIONS = {
  CONFIGURE_REPLACEMENT: `${MODULE_ID}.configureReplacement`,
  TOGGLE_TOKEN_FORM: `${MODULE_ID}.toggleTokenForm`
};

const CSS = {
  SHEET_BUTTON: `${MODULE_ID}-sheet-button`,
  HUD_BUTTON: `${MODULE_ID}-hud-button`
};

const HP_MAX_PATH = "system.hp.max";
const HP_VALUE_PATH = "system.hp.value";
const ACKS_MINIMUM_HP = -99;

const TOKEN_APPEARANCE_FIELDS = [
  "name",
  "texture",
  "width",
  "height",
  "scale",
  "mirrorX",
  "mirrorY",
  "alpha",
  "bar1",
  "bar2",
  "displayBars",
  "displayName",
  "disposition",
  "sight",
  "detectionModes",
  "light",
  "occludable",
  "ring",
  "lockRotation",
  "rotation"
];

/* ------------------------------------------------------------------------- */
/* Init                                                                      */
/* ------------------------------------------------------------------------- */

Hooks.once("init", () => {
  injectHudStyles();
  patchApplicationV2ActionHandler();
});

Hooks.once("ready", () => {
  if (game.system?.id !== ACKS_SYSTEM_ID) {
    console.warn(
      `${MODULE_ID} | This module was written for ACKS Core. Current system is "${game.system?.id}".`
    );
  }
});

/* ------------------------------------------------------------------------- */
/* Actor sheet header/window button                                           */
/* ------------------------------------------------------------------------- */

Hooks.on("getApplicationV1HeaderButtons", addV1ActorSheetButton);
Hooks.on("getActorSheetHeaderButtons", addV1ActorSheetButton);
Hooks.on("getApplicationHeaderButtons", addV1ActorSheetButton);

Hooks.on("getHeaderControlsApplicationV2", addV2ActorSheetControl);
Hooks.on("getHeaderControlsActorSheetV2", addV2ActorSheetControl);

function addV1ActorSheetButton(app, buttons) {
  const actor = getSheetActor(app);
  const worldActor = getPersistentWorldActor(actor);

  if (!worldActor || !canUpdateDocument(worldActor)) return;
  if (buttons.some(button => button.class === CSS.SHEET_BUTTON)) return;

  buttons.unshift({
    label: "Token Form",
    class: CSS.SHEET_BUTTON,
    icon: "fa-solid fa-people-arrows",
    onclick: event => {
      event.preventDefault();
      event.stopPropagation();
      configureReplacementActor(app);
    }
  });
}

function addV2ActorSheetControl(app, controls) {
  const actor = getSheetActor(app);
  const worldActor = getPersistentWorldActor(actor);

  if (!worldActor || !canUpdateDocument(worldActor)) return;
  if (controls.some(control => control.action === ACTIONS.CONFIGURE_REPLACEMENT)) return;

  controls.unshift({
    action: ACTIONS.CONFIGURE_REPLACEMENT,
    icon: "fa-solid fa-people-arrows",
    label: "Token Form",
    ownership: "OWNER",
    visible: true
  });
}

function patchApplicationV2ActionHandler() {
  const ApplicationV2 = foundry?.applications?.api?.ApplicationV2;
  if (!ApplicationV2?.prototype?._onClickAction) return;
  if (ApplicationV2.prototype[`_${MODULE_ID}Patched`]) return;

  const original = ApplicationV2.prototype._onClickAction;

  ApplicationV2.prototype._onClickAction = function patchedTokenFormAction(event, target) {
    const action =
      target?.dataset?.action ??
      event?.target?.closest?.("[data-action]")?.dataset?.action;

    if (action === ACTIONS.CONFIGURE_REPLACEMENT && getSheetActor(this)) {
      event.preventDefault();
      event.stopPropagation();
      configureReplacementActor(this);
      return;
    }

    return original.call(this, event, target);
  };

  ApplicationV2.prototype[`_${MODULE_ID}Patched`] = true;
}

async function configureReplacementActor(app) {
  const actor = getPersistentWorldActor(getSheetActor(app));

  if (!actor) {
    ui.notifications.warn("No editable world Actor found for this sheet.");
    return;
  }

  if (!canUpdateDocument(actor)) {
    ui.notifications.warn("You do not have permission to update this Actor.");
    return;
  }

  const currentUuid = actor.getFlag(MODULE_ID, FLAGS.REPLACEMENT_UUID) ?? "";

  const uuid = await textInputDialog({
    title: "Set Token Form Actor UUID",
    label: "Replacement Actor UUID",
    value: currentUuid,
    placeholder: "Actor.xxxxx or Compendium.package.pack.Actor.xxxxx"
  });

  if (uuid === null) return;

  if (!uuid) {
    await actor.unsetFlag(MODULE_ID, FLAGS.REPLACEMENT_UUID);
    ui.notifications.info(`${actor.name}: replacement Actor UUID cleared.`);
    return;
  }

  let replacementActor;

  try {
    replacementActor = await resolveActorUuid(uuid);
  } catch (error) {
    ui.notifications.error(error.message);
    return;
  }

  await actor.setFlag(MODULE_ID, FLAGS.REPLACEMENT_UUID, replacementActor.uuid);
  ui.notifications.info(`${actor.name}: replacement Actor set to ${replacementActor.name}.`);
}

/* ------------------------------------------------------------------------- */
/* Token HUD/context button                                                   */
/* ------------------------------------------------------------------------- */

Hooks.on("renderTokenHUD", injectTokenHudButton);

function injectTokenHudButton(hud, htmlOrElement) {
  const token = getHudToken(hud);
  const tokenDoc = token?.document ?? hud?.document;

  if (!tokenDoc || !canUpdateDocument(tokenDoc)) return;
  if (!tokenHasSwapAvailable(tokenDoc)) return;

  const inject = () => {
    const root = getRenderedElement(hud?.element) ?? getRenderedElement(htmlOrElement);
    if (!root) return;
    if (root.querySelector(`.${CSS.HUD_BUTTON}`)) return;

    const state = getSwapState(tokenDoc);
    const isSwapped = state?.isSwapped === true;

    const button = document.createElement("button");
    button.type = "button";
    button.classList.add("control-icon", CSS.HUD_BUTTON);
    button.dataset.action = ACTIONS.TOGGLE_TOKEN_FORM;
    button.title = isSwapped ? "Restore original ACKS form" : "Swap ACKS token form";
    button.innerHTML = `<i class="fa-solid fa-people-arrows"></i>`;

    button.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      toggleTokenForm(tokenDoc);
    });

    const parent =
      root.querySelector(".col.right") ??
      root.querySelector(".right") ??
      root.querySelector(".palette") ??
      root;

    parent.appendChild(button);
  };

  if (typeof requestAnimationFrame === "function") requestAnimationFrame(inject);
  else setTimeout(inject, 0);
}

async function toggleTokenForm(tokenDoc) {
  try {
    if (!canUpdateDocument(tokenDoc)) {
      ui.notifications.warn("You do not have permission to update this token.");
      return;
    }

    const state = getSwapState(tokenDoc);

    if (state?.isSwapped) {
      await restoreOriginalForm(tokenDoc, state);
    } else {
      await swapToReplacementForm(tokenDoc);
    }

    canvas?.hud?.token?.clear?.();
  } catch (error) {
    console.error(`${MODULE_ID} | Token form toggle failed`, error);
    ui.notifications.error(error.message ?? "Token form toggle failed.");
  }
}

/* ------------------------------------------------------------------------- */
/* Swap logic                                                                 */
/* ------------------------------------------------------------------------- */

async function swapToReplacementForm(tokenDoc) {
  const originalActor = getTokenWorldBaseActor(tokenDoc);

  if (!originalActor) {
    throw new Error("This token does not have a world Actor base. It cannot be used as the original form.");
  }

  const replacementUuid = originalActor.getFlag(MODULE_ID, FLAGS.REPLACEMENT_UUID);

  if (!replacementUuid) {
    throw new Error(`${originalActor.name} does not have a replacement Actor UUID set.`);
  }

  const replacementActor = await resolveActorUuid(replacementUuid);

  const currentDamage = getAcksDamageFromActor(tokenDoc.actor);
  const carriedEffects = getCarriedEffectData(tokenDoc.actor);
  const tokenSource = tokenDoc.toObject();

  const state = {
    isSwapped: true,
    originalActorUuid: originalActor.uuid,
    originalActorId: originalActor.id,
    originalActorLink: isTokenLinked(tokenDoc),
    originalDelta: duplicateData(tokenSource.delta ?? {}),
    originalAppearance: pickTokenAppearance(tokenSource),
    replacementActorUuid: replacementActor.uuid,
    replacementWasWorldActor: isWorldActor(replacementActor)
  };

  const replacementAppearance = await getActorPrototypeAppearance(replacementActor);
  const replacementBaseEffects = getBaseFormEffectData(replacementActor);

  let update;

  if (isWorldActor(replacementActor)) {
    update = {
      actorId: replacementActor.id,
      actorLink: false,
      delta: buildDeltaAgainstWorldActor(
        replacementActor,
        currentDamage,
        replacementBaseEffects,
        carriedEffects
      ),
      ...replacementAppearance,
      [`flags.${MODULE_ID}.${FLAGS.SWAP_STATE}`]: state
    };
  } else {
    update = {
      /*
       * Scene tokens cannot directly use a compendium Actor id as actorId.
       * So for compendium forms, keep the original world actorId and place the
       * replacement Actor's full profile into the synthetic ActorDelta.
       */
      actorId: originalActor.id,
      actorLink: false,
      delta: buildFullActorProfileDelta(
        replacementActor,
        currentDamage,
        replacementBaseEffects,
        carriedEffects
      ),
      ...replacementAppearance,
      [`flags.${MODULE_ID}.${FLAGS.SWAP_STATE}`]: state
    };
  }

  await tokenDoc.update(update);

  const damageLabel = Number.isFinite(currentDamage) ? ` Damage carried: ${currentDamage}.` : "";
  ui.notifications.info(`${tokenDoc.name} swapped to ${replacementActor.name}.${damageLabel}`);
}

async function restoreOriginalForm(tokenDoc, state) {
  const originalActor = await resolveActorUuid(state.originalActorUuid);

  if (!isWorldActor(originalActor)) {
    throw new Error("The original Actor is no longer a world Actor.");
  }

  const currentDamage = getAcksDamageFromActor(tokenDoc.actor);
  const carriedEffects = getCarriedEffectData(tokenDoc.actor);

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
      [`flags.${MODULE_ID}.${FLAGS.SWAP_STATE}`]: {
        ...state,
        isSwapped: false
      }
    });
  } else {
    const restoredDelta = buildRestoredOriginalDelta(
      originalActor,
      state.originalDelta,
      currentDamage,
      carriedEffects
    );

    await tokenDoc.update({
      actorId: originalActor.id,
      actorLink: false,
      delta: restoredDelta,
      ...appearance,
      [`flags.${MODULE_ID}.${FLAGS.SWAP_STATE}`]: {
        ...state,
        isSwapped: false
      }
    });
  }

  const damageLabel = Number.isFinite(currentDamage) ? ` Damage carried: ${currentDamage}.` : "";
  ui.notifications.info(`${tokenDoc.name} restored to ${originalActor.name}.${damageLabel}`);
}

/* ------------------------------------------------------------------------- */
/* ActorDelta builders                                                        */
/* ------------------------------------------------------------------------- */

function buildDeltaAgainstWorldActor(actor, damage, baseEffects, carriedEffects) {
  const delta = {
    type: actor.type,
    flags: {},
    system: {},
    effects: mergeEffectData(baseEffects, carriedEffects)
  };

  applyAcksDamageToData(delta, actor, damage);

  return scrubActorDelta(delta);
}

function buildFullActorProfileDelta(actor, damage, baseEffects, carriedEffects) {
  const actorData = actor.toObject();

  const delta = {
    name: actorData.name,
    img: actorData.img,
    type: actorData.type,
    flags: duplicateData(actorData.flags ?? {}),
    system: duplicateData(actorData.system ?? {}),
    items: duplicateData(actorData.items ?? []),
    effects: mergeEffectData(baseEffects, carriedEffects)
  };

  if (delta.flags?.[MODULE_ID]) delete delta.flags[MODULE_ID];

  applyAcksDamageToData(delta, actor, damage);

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
/* ACKS damage and active effects                                             */
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

  if (!Number.isFinite(max)) {
    max = Number(getProperty(fallbackActor, HP_MAX_PATH));
  }

  if (!Number.isFinite(max)) return false;

  const newValue = clampNumber(max - damage, ACKS_MINIMUM_HP, max);
  setProperty(data, HP_VALUE_PATH, newValue);

  return true;
}

async function applyDamageAndEffectsToWorldActor(actor, damage, effects) {
  if (!canUpdateDocument(actor)) {
    throw new Error(`You do not have permission to update ${actor.name}.`);
  }

  const update = {};

  if (Number.isFinite(damage)) {
    const max = Number(getProperty(actor, HP_MAX_PATH));

    if (Number.isFinite(max)) {
      update[HP_VALUE_PATH] = clampNumber(max - damage, ACKS_MINIMUM_HP, max);
    }
  }

  if (Object.keys(update).length) {
    await actor.update(update);
  }

  await replaceActorEffects(actor, effects);
}

function getBaseFormEffectData(actor) {
  if (!actor?.effects) return [];

  return Array.from(actor.effects).map(effect => {
    const data = scrubEffectData(effect.toObject());
    data.flags ??= {};
    data.flags[MODULE_ID] ??= {};
    data.flags[MODULE_ID][FLAGS.FORM_BASE_EFFECT] = true;
    return data;
  });
}

function getCarriedEffectData(actor) {
  if (!actor?.effects) return [];

  return Array.from(actor.effects)
    .map(effect => scrubEffectData(effect.toObject()))
    .filter(effectData => {
      return effectData?.flags?.[MODULE_ID]?.[FLAGS.FORM_BASE_EFFECT] !== true;
    });
}

function mergeEffectData(baseEffects, carriedEffects) {
  return [
    ...duplicateData(baseEffects ?? []),
    ...duplicateData(carriedEffects ?? [])
  ];
}

function scrubEffectData(effectData) {
  const clean = duplicateData(effectData ?? {});

  delete clean.parent;
  delete clean.pack;

  return clean;
}

async function replaceActorEffects(actor, effects) {
  const existingIds = Array.from(actor.effects ?? []).map(effect => effect.id);

  if (existingIds.length) {
    await actor.deleteEmbeddedDocuments("ActiveEffect", existingIds);
  }

  if (effects?.length) {
    const newEffects = effects.map(effect => {
      const clean = scrubEffectData(effect);
      delete clean._id;
      return clean;
    });

    await actor.createEmbeddedDocuments("ActiveEffect", newEffects);
  }
}

/* ------------------------------------------------------------------------- */
/* Token appearance                                                           */
/* ------------------------------------------------------------------------- */

async function getActorPrototypeAppearance(actor) {
  const tokenDoc = await actor.getTokenDocument();
  return pickTokenAppearance(tokenDoc.toObject());
}

function pickTokenAppearance(source) {
  const appearance = {};

  for (const field of TOKEN_APPEARANCE_FIELDS) {
    if (source[field] !== undefined) {
      appearance[field] = duplicateData(source[field]);
    }
  }

  return appearance;
}

/* ------------------------------------------------------------------------- */
/* Actor and token helpers                                                    */
/* ------------------------------------------------------------------------- */

function tokenHasSwapAvailable(tokenDoc) {
  const state = getSwapState(tokenDoc);

  if (state?.isSwapped && state?.originalActorUuid) return true;

  const baseActor = getTokenWorldBaseActor(tokenDoc);

  return Boolean(baseActor?.getFlag?.(MODULE_ID, FLAGS.REPLACEMENT_UUID));
}

function getSwapState(tokenDoc) {
  return tokenDoc.getFlag(MODULE_ID, FLAGS.SWAP_STATE) ?? {};
}

function getTokenWorldBaseActor(tokenDoc) {
  if (!tokenDoc) return null;

  if (tokenDoc.actorId && game.actors?.get(tokenDoc.actorId)) {
    return game.actors.get(tokenDoc.actorId);
  }

  const actor = tokenDoc.actor;

  if (isWorldActor(actor)) return actor;

  const baseActor =
    actor?.baseActor ??
    actor?.token?.baseActor ??
    actor?.token?.actor?.baseActor;

  if (isWorldActor(baseActor)) return baseActor;

  return null;
}

function getSheetActor(app) {
  const doc = app?.document ?? app?.actor ?? app?.object;

  if (isActorDocument(doc)) return doc;
  if (isActorDocument(app?.object?.actor)) return app.object.actor;

  return null;
}

function getPersistentWorldActor(actor) {
  if (!isActorDocument(actor)) return null;

  if (isWorldActor(actor)) return actor;

  const baseActor =
    actor?.baseActor ??
    actor?.token?.baseActor ??
    actor?.token?.actor?.baseActor;

  if (isWorldActor(baseActor)) return baseActor;

  return null;
}

async function resolveActorUuid(uuid) {
  const cleanUuid = String(uuid ?? "").trim();

  if (!cleanUuid) {
    throw new Error("No Actor UUID was provided.");
  }

  const doc = await fromUuidCompat(cleanUuid);

  if (!doc || !isActorDocument(doc)) {
    throw new Error(`The UUID "${cleanUuid}" did not resolve to an Actor.`);
  }

  return doc;
}

async function fromUuidCompat(uuid) {
  if (foundry?.utils?.fromUuid) return foundry.utils.fromUuid(uuid);
  if (globalThis.fromUuid) return globalThis.fromUuid(uuid);
  return null;
}

function isActorDocument(doc) {
  if (!doc) return false;
  if (doc.documentName === "Actor") return true;

  const ActorClass = CONFIG?.Actor?.documentClass;
  return Boolean(ActorClass && doc instanceof ActorClass);
}

function isWorldActor(actor) {
  return Boolean(
    actor &&
    isActorDocument(actor) &&
    !actor.pack &&
    actor.id &&
    game.actors?.get(actor.id)
  );
}

function isTokenLinked(tokenDoc) {
  return tokenDoc?.actorLink === true || tokenDoc?.isLinked === true;
}

function getHudToken(hud) {
  return (
    hud?.object ??
    hud?.token ??
    hud?.document?.object ??
    canvas?.tokens?.controlled?.[0] ??
    null
  );
}

function canUpdateDocument(document) {
  if (!document) return false;
  if (game.user?.isGM) return true;
  if (document.canUserModify) return document.canUserModify(game.user, "update");
  return Boolean(document.isOwner);
}

/* ------------------------------------------------------------------------- */
/* UI helpers                                                                 */
/* ------------------------------------------------------------------------- */

async function textInputDialog({ title, label, value = "", placeholder = "" }) {
  const escapedLabel = escapeHtml(label);
  const escapedValue = escapeHtml(value);
  const escapedPlaceholder = escapeHtml(placeholder);

  const content = `
    <form>
      <div class="form-group stacked">
        <label>${escapedLabel}</label>
        <input
          type="text"
          name="uuid"
          value="${escapedValue}"
          placeholder="${escapedPlaceholder}"
          style="width: 100%;"
        />
        <p class="notes">
          Use a world Actor UUID or compendium Actor UUID. Leave blank and Save to clear.
        </p>
      </div>
    </form>
  `;

  if (globalThis.Dialog?.prompt) {
    return Dialog.prompt({
      title,
      content,
      label: "Save",
      rejectClose: false,
      callback: html => {
        const root = getRenderedElement(html);
        return root?.querySelector?.('input[name="uuid"]')?.value?.trim() ?? "";
      }
    });
  }

  const result = window.prompt(label, value);
  return result === null ? null : result.trim();
}

function getRenderedElement(htmlOrElement) {
  if (!htmlOrElement) return null;

  if (htmlOrElement instanceof HTMLElement) return htmlOrElement;

  if (htmlOrElement.jquery) {
    return htmlOrElement[0] ?? null;
  }

  if (htmlOrElement[0] instanceof HTMLElement) {
    return htmlOrElement[0];
  }

  return null;
}

function injectHudStyles() {
  if (document.getElementById(`${MODULE_ID}-styles`)) return;

  const style = document.createElement("style");
  style.id = `${MODULE_ID}-styles`;
  style.textContent = `
    .${CSS.HUD_BUTTON} {
      cursor: pointer;
      pointer-events: auto;
    }

    .${CSS.HUD_BUTTON} i {
      pointer-events: none;
    }
  `;

  document.head.appendChild(style);
}

/* ------------------------------------------------------------------------- */
/* Data helpers                                                               */
/* ------------------------------------------------------------------------- */

function getProperty(object, path) {
  if (foundry?.utils?.getProperty) return foundry.utils.getProperty(object, path);

  return path.split(".").reduce((value, key) => {
    if (value == null) return undefined;
    return value[key];
  }, object);
}

function setProperty(object, path, value) {
  if (foundry?.utils?.setProperty) return foundry.utils.setProperty(object, path, value);

  const parts = path.split(".");
  let target = object;

  while (parts.length > 1) {
    const part = parts.shift();

    if (!target[part] || typeof target[part] !== "object") {
      target[part] = {};
    }

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
