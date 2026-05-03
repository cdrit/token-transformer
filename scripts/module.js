async function swapToReplacementForm(tokenDoc) {
  const originalActor = getTokenWorldBaseActor(tokenDoc);

  if (!originalActor) {
    throw new Error("This token does not have a world Actor base.");
  }

  const replacementUuid = originalActor.getFlag(MODULE_ID, FLAGS.REPLACEMENT_UUID);

  if (!replacementUuid) {
    throw new Error(`${originalActor.name} does not have a transform Actor UUID set.`);
  }

  const replacementActor = await resolveActorUuid(replacementUuid);

  const currentDamage = getAcksDamageFromActor(tokenDoc.actor);
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

  const update = isWorldActor(replacementActor)
    ? {
        actorId: replacementActor.id,
        actorLink: false,
        delta: buildReplacementDelta(replacementActor, currentDamage, false),
        ...replacementAppearance,
        [`flags.${MODULE_ID}.${FLAGS.SWAP_STATE}`]: state
      }
    : {
        actorId: originalActor.id,
        actorLink: false,
        delta: buildReplacementDelta(replacementActor, currentDamage, true),
        ...replacementAppearance,
        [`flags.${MODULE_ID}.${FLAGS.SWAP_STATE}`]: state
      };

  await tokenDoc.update(update);

  ui.notifications.info(`${tokenDoc.name} transformed into ${replacementActor.name}.`);
}

async function restoreOriginalForm(tokenDoc, state) {
  const originalActor = await resolveActorUuid(state.originalActorUuid);

  if (!isWorldActor(originalActor)) {
    throw new Error("The original Actor is no longer a world Actor.");
  }

  const currentDamage = getAcksDamageFromActor(tokenDoc.actor);

  const appearance =
    state.originalAppearance && Object.keys(state.originalAppearance).length
      ? duplicateData(state.originalAppearance)
      : await getActorPrototypeAppearance(originalActor);

  if (state.originalActorLink) {
    await applyDamageOnlyToWorldActor(originalActor, currentDamage);

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
      currentDamage
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

  ui.notifications.info(`${tokenDoc.name} restored to ${originalActor.name}.`);
}

function buildReplacementDelta(actor, damage, fullProfile) {
  const actorData = actor.toObject();

  const delta = fullProfile
    ? {
        name: actorData.name,
        img: actorData.img,
        type: actorData.type,
        flags: duplicateData(actorData.flags ?? {}),
        system: duplicateData(actorData.system ?? {}),
        items: duplicateData(actorData.items ?? []),
        effects: duplicateData(actorData.effects ?? [])
      }
    : {
        type: actor.type,
        flags: duplicateData(actorData.flags ?? {}),
        system: duplicateData(actorData.system ?? {}),
        items: duplicateData(actorData.items ?? []),
        effects: duplicateData(actorData.effects ?? [])
      };

  if (delta.flags?.[MODULE_ID]) delete delta.flags[MODULE_ID];

  applyAcksDamageToData(delta, actor, damage);

  return scrubActorDelta(delta);
}

function buildRestoredOriginalDelta(originalActor, originalDelta, damage) {
  const delta = duplicateData(originalDelta ?? {});

  delta.type ??= originalActor.type;
  delta.flags ??= {};
  delta.system ??= {};

  applyAcksDamageToData(delta, originalActor, damage);

  return scrubActorDelta(delta);
}

async function applyDamageOnlyToWorldActor(actor, damage) {
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
}
