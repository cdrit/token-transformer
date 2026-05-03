Hooks.once('init', () => {
  console.log("🚀 Token Transformer | Module is LOADING");
});

Hooks.once('ready', () => {
  console.log("🚀 Token Transformer | Ready - Module Active");
  ui.notifications.info("Token Transformer module loaded successfully!", {type: "info"});
});

// Add button to Actor Sheets
Hooks.on("renderActorSheet", (app, html) => {
  if (html.find(".token-transformer-btn").length > 0) return;

  const button = $(`
    <a class="token-transformer-btn" style="margin-left: 8px; color: #ffaa00; font-weight: bold;">
      <i class="fas fa-exchange-alt"></i> Transform
    </a>
  `);

  button.on("click", (ev) => {
    ev.preventDefault();
    selectTargetActor(app.actor);
  });

  // Aggressive placement
  html.find('.window-header').append(button);
  html.find('header').append(button);
  html.find('.window-title').after(button);
});

Hooks.on("getTokenContextOptions", (html, options) => {
  options.push({
    name: "🔄 Transform Token",
    icon: '<i class="fas fa-exchange-alt"></i>',
    condition: (li) => game.user.isGM || true,
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
    title: `Transform Target - ${actor.name}`,
    content: `<p>Target Actor UUID:</p><input type="text" id="uuid-input" value="${current}" style="width:100%">`,
    buttons: {
      save: {
        label: "Save",
        callback: (html) => {
          const uuid = html.find("#uuid-input").val().trim();
          if (uuid) actor.setFlag("token-transformer", "targetUuid", uuid);
        }
      }
    }
  }).render(true);
}

async function toggleTransform(token) {
  const uuid = token.actor.getFlag("token-transformer", "targetUuid");
  if (!uuid) return ui.notifications.warn("No target set on this actor");

  const target = await fromUuid(uuid);
  if (!target) return ui.notifications.error("Target not found");

  const scene = token.parent;

  const newTokenData = {
    x: token.x,
    y: token.y,
    elevation: token.elevation,
    rotation: token.rotation,
    actorId: target.id,
    actorLink: token.actorLink
  };

  await token.delete();
  await TokenDocument.create(newTokenData, {parent: scene});
}
