// ========================
// Token Transformer Module
// ========================

Hooks.once('init', () => {
  console.log("Token Transformer | Initialized");

  // === Your requested change ===
  CONFIG.ActiveEffect.expiryAction = "delete";
  console.log("Token Transformer | Default Active Effect expiry set to DELETE");
});

// Header button on Actor Sheets
Hooks.on("getApplicationHeaderButtons", (app, buttons) => {
  if (!(app instanceof ActorSheet)) return;

  buttons.unshift({
    label: "Set Transform Target",
    class: "token-transformer-btn",
    icon: "fas fa-exchange-alt",
    onclick: () => selectTargetActor(app.actor)
  });
});

// Context menu on Tokens
Hooks.on("getTokenContextOptions", (html, options) => {
  options.push({
    name: "Transform into Target Actor",
    icon: '<i class="fas fa-exchange-alt"></i>',
    condition: (li) => {
      const token = game.canvas.tokens.get(li.data("token-id"));
      return token?.actor?.getFlag("token-transformer", "targetUuid");
    },
    callback: (li) => {
      const token = game.canvas.tokens.get(li.data("token-id"));
      if (token) performTransform(token);
    }
  });
});

async function selectTargetActor(actor) {
  let content = `<p>Drag an actor from the sidebar or paste its UUID:</p>`;
  content += `<input type="text" id="target-uuid" style="width:100%" placeholder="Actor UUID">`;

  new Dialog({
    title: "Set Transform Target",
    content: content,
    buttons: {
      set: {
        label: "Set Target",
        callback: async (html) => {
          let uuid = html.find("#target-uuid").val().trim();
          if (uuid) {
            try {
              const target = await fromUuid(uuid);
              if (target) {
                await actor.setFlag("token-transformer", "targetUuid", uuid);
                ui.notifications.info(`Transform target set to: ${target.name}`);
              }
            } catch(e) {
              ui.notifications.error("Invalid Actor UUID");
            }
          }
        }
      }
    }
  }).render(true);
}

async function performTransform(token) {
  const uuid = token.actor.getFlag("token-transformer", "targetUuid");
  if (!uuid) return;

  const targetActor = await fromUuid(uuid);
  if (!targetActor) {
    ui.notifications.error("Target actor not found");
    return;
  }

  const scene = token.parent;
  const td = {
    x: token.x,
    y: token.y,
    elevation: token.elevation,
    rotation: token.rotation,
    actorId: targetActor.id,
    actorLink: token.actorLink
  };

  await token.delete();
  await TokenDocument.create(td, {parent: scene});
}
