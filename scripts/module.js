const MODULE_ID = "token-transformer";
const FLAG_TARGET_UUID = "targetUuid";
const FLAG_ORIGINAL_ACTOR_UUID = "originalActorUuid";

Hooks.once("init", () => {
  console.log("🚀 Token Transformer | Module is LOADING");
});

Hooks.once("ready", () => {
  console.log("🚀 Token Transformer | Ready - Module Active");
  ui.notifications.info("Token Transformer module loaded successfully!", { type: "info" });
});

Hooks.on("renderActorSheet", (app, html) => {
  if (html.find(".token-transformer-btn").length > 0) return;

  const button = $(`
    <a class="token-transformer-btn" style="margin-left: 8px; color: #ffaa00; font-weight: bold;">
      <i class="fas fa-exchange-alt"></i> Transform UUID
    </a>
  `);

  button.on("click", (ev) => {
    ev.preventDefault();
    openUuidDialog(app.actor);
  });

  html.find(".window-header").append(button);
  html.find("header").append(button);
  html.find(".window-title").after(button);
});

Hooks.on("getTokenContextOptions", (html, options) => {
  options.push({
    name: "🔄 Transform / Revert Token",
    icon: '<i class="fas fa-exchange-alt"></i>',
    condition: () => true,
    callback: async (li) => {
      const token = canvas.tokens.get(li.data("token-id"));
      if (token) await toggleTransform(token);
    }
  });
});

async function openUuidDialog(actor) {
  const current = actor.getFlag(MODULE_ID, FLAG_TARGET_UUID) ?? "";

  const DialogClass = foundry?.applications?.api?.DialogV2;
  if (DialogClass) {
    await DialogClass.prompt({
      window: { title: `Transform Target UUID - ${actor.name}` },
      content: `
        <div class="form-group">
          <label>Target Actor UUID</label>
          <input type="text" name="uuid" value="${current}" style="width:100%" />
        </div>
      `,
      ok: {
        label: "Save",
        callback: async (event, button, dialog) => {
          const uuid = dialog.element.querySelector('input[name="uuid"]')?.value?.trim();
          if (!uuid) return;
          await actor.setFlag(MODULE_ID, FLAG_TARGET_UUID, uuid);
          ui.notifications.info(`Saved transform UUID for ${actor.name}.`);
        }
      },
      cancel: { label: "Cancel" }
    });
    return;
  }

  new Dialog({
    title: `Transform Target UUID - ${actor.name}`,
    content: `<p>Target Actor UUID:</p><input type="text" id="uuid-input" value="${current}" style="width:100%">`,
    buttons: {
      save: {
        label: "Save",
        callback: (dialogHtml) => {
          const uuid = dialogHtml.find("#uuid-input").val()?.trim();
          if (uuid) actor.setFlag(MODULE_ID, FLAG_TARGET_UUID, uuid);
        }
      }
    }
  }).render(true);
}

async function toggleTransform(token) {
  const tokenDoc = token.document;
  const originalActorUuid = tokenDoc.getFlag(MODULE_ID, FLAG_ORIGINAL_ACTOR_UUID);

  const sourceActor = token.actor;
  const hpTransfer = getHpState(sourceActor);
  const effectsTransfer = cloneActiveEffects(sourceActor);

  const targetUuid = originalActorUuid || sourceActor.getFlag(MODULE_ID, FLAG_TARGET_UUID);
  if (!targetUuid) return ui.notifications.warn("No transform UUID is set for this actor.");

  const targetActor = await fromUuid(targetUuid);
  if (!targetActor) return ui.notifications.error(`Target actor not found for UUID: ${targetUuid}`);

  const baseData = tokenDoc.toObject();
  delete baseData._id;

  const createData = foundry.utils.mergeObject(baseData, {
    actorId: targetActor.id,
    actorLink: false,
    flags: {
      [MODULE_ID]: {
        [FLAG_ORIGINAL_ACTOR_UUID]: originalActorUuid || sourceActor.uuid
      }
    }
  }, { inplace: false, overwrite: true });

  const [newDoc] = await tokenDoc.parent.createEmbeddedDocuments("Token", [createData]);
  await tokenDoc.delete();

  const newToken = canvas.tokens.get(newDoc.id);
  if (!newToken?.actor) return;

  await applyHpState(newToken.actor, hpTransfer);
  await applyActiveEffects(newToken.actor, effectsTransfer);

  const isReverting = Boolean(originalActorUuid);
  ui.notifications.info(isReverting ? "Token reverted." : "Token transformed.");
}

function getHpState(actor) {
  const candidates = [
    ["system", "hp"],
    ["system", "attributes", "hp"],
    ["system", "health"],
    ["system", "hitPoints"]
  ];

  for (const path of candidates) {
    const value = foundry.utils.getProperty(actor, path.join("."));
    if (value && typeof value.value === "number" && typeof value.max === "number") {
      return { damage: Math.max(0, value.max - value.value) };
    }
  }

  return null;
}

async function applyHpState(actor, hpState) {
  if (!hpState) return;

  const candidates = [
    "system.hp",
    "system.attributes.hp",
    "system.health",
    "system.hitPoints"
  ];

  for (const path of candidates) {
    const hp = foundry.utils.getProperty(actor, path);
    if (hp && typeof hp.value === "number" && typeof hp.max === "number") {
      const next = Math.clamp(hp.max - hpState.damage, 0, hp.max);
      await actor.update({ [`${path}.value`]: next });
      return;
    }
  }
}

function cloneActiveEffects(actor) {
  return actor.effects
    .filter((e) => !e.disabled)
    .map((e) => {
      const data = e.toObject();
      delete data._id;
      return data;
    });
}

async function applyActiveEffects(actor, effects) {
  if (!effects?.length) return;

  const existingNames = new Set(actor.effects.map((e) => e.name));
  const toCreate = effects.filter((e) => !existingNames.has(e.name));
  if (toCreate.length) await actor.createEmbeddedDocuments("ActiveEffect", toCreate);
}
