Hooks.once('init', () => {
  console.log("✅ Token Transformer | Loaded");
  CONFIG.ActiveEffect.expiryAction = "delete";
});

// More reliable way to add header button
Hooks.on("renderActorSheet", (app, html, data) => {
  if (html.find(".token-transformer-btn").length > 0) return; // prevent duplicates

  const button = $(`
    <a class="token-transformer-btn" title="Set Transform Target">
      <i class="fas fa-exchange-alt"></i>
    </a>
  `);

  button.on("click", () => selectTargetActor(app.actor));

  // Add to header (most systems)
  html.find('.window-header .window-title').after(button);
  // Alternative locations in case the above doesn't work
  html.find('.window-header').append(button);
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

async function selectTargetActor(actor) {
  const current = actor.getFlag("token-transformer", "targetUuid") || "";
  
  new Dialog({
    title: "Set Transform Target",
    content: `
      <p>Enter the UUID of the target actor:</p>
      <input type="text" id="target-uuid" value="${current}" style="width: 100%;" placeholder="Paste UUID here">
    `,
    buttons: {
      save: {
        label: "Save",
        callback: async (html) => {
          const uuid = html.find("#target-uuid").val().trim();
          if (uuid) {
            await actor.setFlag("token-transformer", "targetUuid", uuid);
            ui.notifications.info("Transform target saved!");
          }
        }
      }
    }
  }).render(true);
}

async function toggleTransform(token) {
  const uuid = token.actor.getFlag("token-transformer", "targetUuid");
  if (!uuid) return ui.notifications.warn("No transform target set");

  const targetActor = await fromUuid(uuid);
  if (!targetActor) return ui.notifications.error("Target actor not found");

  const scene = token.parent;
  
  const newData = {
    x: token.x,
    y: token.y,
    elevation: token.elevation,
    rotation: token.rotation,
    actorId: targetActor.id,
    actorLink: token.actorLink
  };

  await token.delete();
  await TokenDocument.create(newData, { parent: scene });
}
