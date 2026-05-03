Hooks.once('init', () => {
  console.log("✅ Token Transformer | Loaded for ACKS");
  CONFIG.ActiveEffect.expiryAction = "delete";
});

// ACKS-specific header button
Hooks.on("renderActorSheet", (app, html, data) => {
  // Prevent multiple buttons
  if (html.find(".token-transformer-btn").length > 0) return;

  const button = $(`
    <a class="token-transformer-btn" title="Set Transform Target" style="margin-left: 8px;">
      <i class="fas fa-exchange-alt"></i> Transform
    </a>
  `);

  button.on("click", (ev) => {
    ev.preventDefault();
    selectTargetActor(app.actor);
  });

  // Try different header locations common in ACKS / custom sheets
  const header = html.find('.window-header');
  if (header.length) {
    header.append(button);
  } else {
    html.find('.window-title').after(button);
  }
});

Hooks.on("getTokenContextOptions", (html, options) => {
  options.push({
    name: "🔄 Transform Token",
    icon: '<i class="fas fa-exchange-alt"></i>',
    condition: (li) => {
      const token = game.canvas.tokens.get(li.data("token-id"));
      return token?.actor?.getFlag("token-transformer", "targetUuid");
    },
    callback: (li) => {
      const token = game.canvas.tokens.get(li.data("token-id"));
      if (token) toggleTransform(token);
    }
  });
});

// ================== Functions ==================

async function selectTargetActor(actor) {
  const current = actor.getFlag("token-transformer", "targetUuid") || "";
  
  new Dialog({
    title: `Set Transform Target for ${actor.name}`,
    content: `
      <p>Paste the UUID of the target actor:</p>
      <input type="text" id="target-uuid" value="${current}" style="width: 100%;" placeholder="Actor UUID">
      <p style="font-size: 0.8em; color: #aaa;">You can drag an actor from the sidebar onto this field.</p>
    `,
    buttons: {
      save: {
        label: "Save Target",
        callback: async (html) => {
          const uuid = html.find("#target-uuid").val().trim();
          if (uuid) {
            await actor.setFlag("token-transformer", "targetUuid", uuid);
            ui.notifications.info(`Transform target set for ${actor.name}`);
          }
        }
      }
    }
  }).render(true);
}

async function toggleTransform(token) {
  const uuid = token.actor.getFlag("token-transformer", "targetUuid");
  if (!uuid) return ui.notifications.warn("No transform target set on this actor.");

  const targetActor = await fromUuid(uuid);
  if (!targetActor) return ui.notifications.error("Target actor not found.");

  const scene = token.parent;
  
  const newData = {
    x: token.x,
    y: token.y,
    elevation: token.elevation || 0,
    rotation: token.rotation || 0,
    actorId: targetActor.id,
    actorLink: token.actorLink
  };

  await token.delete();
  await TokenDocument.create(newData, { parent: scene });
  
  ui.notifications.info(`Token transformed into ${targetActor.name}`);
}
