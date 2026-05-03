const MODULE_ID = "token-transformer";

const FLAGS = {
  REPLACEMENT_UUID: "replacementActorUuid",
  SWAP_STATE: "swapState",
  FORM_BASE_EFFECT: "formBaseEffect"
};

const HP_MAX_PATH = "system.hp.max";
const HP_VALUE_PATH = "system.hp.value";
const ACKS_MINIMUM_HP = -99;

const TOKEN_APPEARANCE_FIELDS = [
  "name", "texture", "width", "height", "scale", "mirrorX", "mirrorY",
  "alpha", "bar1", "bar2", "displayBars", "displayName", "disposition",
  "sight", "detectionModes", "light", "occludable", "ring",
  "lockRotation", "rotation"
];

Hooks.once("init", () => injectStyles());

Hooks.on("renderApplicationV2", injectActorSheetButton);
Hooks.on("renderActorSheet", injectActorSheetButton);
Hooks.on("renderActorSheetV2", injectActorSheetButton);
Hooks.on("renderACKSActorSheetV2", injectActorSheetButton);
Hooks.on("renderACKSCharacterSheetV2", injectActorSheetButton);
Hooks.on("renderACKSMonsterSheetV2", injectActorSheetButton);
Hooks.on("renderTokenHUD", injectTokenHudButton);

function injectActorSheetButton(app, element) {
  const actor = getSheetActor(app);
  const worldActor = getPersistentWorldActor(actor);
  if (!worldActor || !canUpdateDocument(worldActor)) return;

  const root = getElement(element) ?? getElement(app.element);
  if (!root || root.querySelector(".token-transformer-sheet-button")) return;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "token-transformer-sheet-button";
  button.title = "Set token transform Actor UUID";
  button.innerHTML = `<i class="fa-solid fa-people-arrows"></i> <span>Transform</span>`;
  button.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    configureReplacementActor(worldActor);
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

async function configureReplacementActor(actor) {
  const currentUuid = actor.getFlag(MODULE_ID, FLAGS.REPLACEMENT_UUID) ?? "";

  const uuid = await textInputDialog({
    title: "Set Token Transform Actor UUID",
    label: "Replacement Actor UUID",
    value: currentUuid,
    placeholder: "Actor.xxxxx or Compendium.package.pack.Actor.xxxxx"
  });

  if (uuid === null) return;

  if (!uuid) {
    await actor.unsetFlag(MODULE_ID, FLAGS.REPLACEMENT_UUID);
    ui.notifications.info(`${actor.name}: transform Actor UUID cleared.`);
    return;
  }

  const replacementActor = await resolveActorUuid(uuid);
  await actor.setFlag(MODULE_ID, FLAGS.REPLACEMENT_UUID, replacementActor.uuid);
  ui.notifications.info(`${actor.name}: transform Actor set to ${replacementActor.name}.`);
}

function injectTokenHudButton(hud, element) {
  const tokenDoc = hud.object?.document;
  if (!tokenDoc || !canUpdateDocument(tokenDoc) || !tokenHasSwapAvailable(tokenDoc)) return;

  const root = getElement(element) ?? getElement(hud.element);
  if (!root || root.querySelector(".token-transformer-hud-button")) return;

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

  const parent = root.querySelector(".col.right") ?? root.querySelector(".right") ?? root;
  parent.appendChild(button);
}

async function toggleTokenForm(tokenDoc) {
  try {
    const state = getSwapState(tokenDoc);
    if (state?.isSwapped) await restoreOriginalForm(tokenDoc, state);
    else await swapToReplacementForm(tokenDoc);
    canvas?.hud?.token?.clear?.();
  } catch (error) {
    console.error(`${MODULE_ID} | Token transform failed`, error);
    ui.notifications.error(error.message ?? "Token transform failed.");
  }
}

async function swapToReplacementForm(tokenDoc) {
  const originalActor = getTokenWorldBaseActor(tokenDoc);
  if (!originalActor) throw new Error("This token does not have a world Actor base.");

  const replacementUuid = originalActor.getFlag(MODULE_ID, FLAGS.REPLACEMENT_UUID);
  if (!replacementUuid) throw new Error(`${originalActor.name} does not have a transform Actor UUID set.`);

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
    replacementActorUuid: replacementActor.uuid
  };

  const replacementAppearance = await getActorPrototypeAppearance(replacementActor);

  const update = {
    actorId: isWorldActor(replacementActor) ? replacementActor.id : originalActor.id,
    actorLink: false,
    delta: buildFullActorProfileDelta(replacementActor, currentDamage, carriedEffects),
    ...replacementAppearance,
    [`flags.${MODULE_ID}.${FLAGS.SWAP_STATE}`]: state
  };

  await tokenDoc.update(update);
  ui.notifications.info(`${tokenDoc.name} transformed into ${replacementActor.name}.`);
}

async function restoreOriginalForm(tokenDoc, state) {
  const originalActor = await resolveActorUuid(state.originalActorUuid);
  if (!isWorldActor(originalActor)) throw new Error("The original Actor is no longer a world Actor.");

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

function buildFullActorProfileDelta(actor, damage, carriedEffects) {
  const actorData = actor.toObject();

  const delta = {
    name: actorData.name,
    img: actorData.img,
    type: actorData.type,
    flags: duplicateData(actorData.flags ?? {}),
    system: duplicateData(actorData.system ?? {}),
    items: duplicateData(actorData.items ?? []),
    effects: mergeEffectData(actorData.effects ?? [], carriedEffects)
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

  return Array.from(actor.effects)
    .map(effect => scrubEffectData(effect.toObject()))
    .filter(effectData => effectData?.flags?.[MODULE_ID]?.[FLAGS.FORM_BASE_EFFECT] !== true);
}

function mergeEffectData(destinationEffects, carriedEffects) {
  return [
    ...duplicateData(destinationEffects ?? []),
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
  if (existingIds.length) await actor.deleteEmbeddedDocuments("ActiveEffect", existingIds);

  if (effects?.length) {
    const newEffects = effects.map(effect => {
      const clean = scrubEffectData(effect);
      delete clean._id;
      return clean;
    });
    await actor.createEmbeddedDocuments("ActiveEffect", newEffects);
  }
}

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

function getPersistentWorldActor(actor) {
  if (!isActorDocument(actor)) return null;
  if (isWorldActor(actor)) return actor;

  const baseActor = actor?.baseActor ?? actor?.token?.baseActor ?? actor?.token?.actor?.baseActor;
  if (isWorldActor(baseActor)) return baseActor;

  return null;
}

async function resolveActorUuid(uuid) {
  const cleanUuid = String(uuid ?? "").trim();
  if (!cleanUuid) throw new Error("No Actor UUID was provided.");

  const doc = foundry?.utils?.fromUuid
    ? await foundry.utils.fromUuid(cleanUuid)
    : await fromUuid(cleanUuid);

  if (!doc || !isActorDocument(doc)) throw new Error(`The UUID "${cleanUuid}" did not resolve to an Actor.`);
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

async function textInputDialog({ title, label, value = "", placeholder = "" }) {
  const content = `
    <form>
      <div class="form-group stacked">
        <label>${escapeHtml(label)}</label>
        <input type="text" name="uuid" value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}" style="width: 100%;" />
        <p class="notes">Use a world Actor UUID or compendium Actor UUID. Leave blank and Save to clear.</p>
      </div>
    </form>
  `;

  return Dialog.prompt({
    title,
    content,
    label: "Save",
    rejectClose: false,
    callback: html => {
      const root = getElement(html);
      return root?.querySelector?.('input[name="uuid"]')?.value?.trim() ?? "";
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
      gap: 0.35rem;
      height: 28px;
      margin-right: 4px;
      padding: 0 8px;
      border: 1px solid var(--color-border-light-primary, #777);
      border-radius: 4px;
      background: var(--color-bg-option, rgba(0, 0, 0, 0.15));
      color: var(--color-text-light-highlight, inherit);
      cursor: pointer;
      pointer-events: auto;
      font-size: 12px;
    }

    .token-transformer-sheet-button:hover {
      text-shadow: 0 0 6px var(--color-shadow-primary, red);
    }

    .token-transformer-hud-button {
      cursor: pointer;
      pointer-events: auto;
    }

    .token-transformer-hud-button i {
      pointer-events: none;
    }
  `;

  document.head.appendChild(style);
}

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
