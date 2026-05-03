Hooks.once('init', () => {
  console.log("✅ Token Transformer | Initialized for ACKS");
  CONFIG.ActiveEffect.expiryAction = "delete";
});

// Very aggressive button injection
Hooks.on("renderActorSheet", (app, html) => {
  setTimeout(() => addTransformButton(app, html), 100);
});

function addTransformButton(app, html) {
  if (html.find(".token-transformer-btn").length > 0) return;

  const button = $(`
    <a class="token-transformer-btn" title="Set Transform Target" style="margin: 0 8px; color: #ffaa00;">
      <i class="fas fa-exchange-alt"></i> Transform
    </a>
  `);

  button.on("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    selectTargetActor(app.actor);
  });

  // Multiple possible locations
  const header = html.find('.window-header, header, .sheet-header, .header');
  if (header.length) {
    header.append(button);
  } else {
    html.find('.window-title').after(button);
    html.find('header').append(button);
  }

  console.log(`✅ Token Transformer | Button added to ${app.actor.name}`);
}

// Token Context Menu
Hooks.on("getTokenContextOptions", (html, options) => {
  options.push({
    name: "🔄 Transform / Swap Token",
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

// ================== Core Functions ==================

async function selectTargetActor(actor) {
  const current = actor.getFlag("token-transformer", "targetUuid") || "";
  
  new Dialog({
    title: `Set Transform Target - ${actor.name}`,
    content: `
      <p>Target Actor UUID:</p>
      <input type="text" id="target-uuid" value="${current}" style="width:100%" placeholder="Paste UUID or drag actor">
    `,
    buttons: {
      save: {
        label: "Save",
        callback: async (html) => {
          const uuid = html.find("#target-uuid").val().trim();
          if (uuid) {
            await actor.setFlag("token-transformer", "targetUuid", uuid);
            ui.notifications.info("✅ Transform target saved");
          }
        }
      }
    }
  }).render(true);
}

async function toggleTransform(token) {
  const sourceActor = token.actor;
  const targetUuid = sourceActor.getFlag("token-transformer", "targetUuid");
  if (!targetUuid) return;

  const targetActor = await fromUuid(targetUuid);
  if (!targetActor) return ui.notifications.error("Target actor not found");

  const scene = token.parent;

  // === Preserve Damage / Resources ===
  const hpKey = Object.keys(sourceActor.system?.attributes || {}).find(k => 
    k.toLowerCase().includes('hp') || k.toLowerCase().includes('health')
  ) || 'attributes.hp';

  const currentHp = foundry.utils.getProperty(sourceActor.system, hpKey?.value || hpKey) || 
                   foundry.utils.getProperty(sourceActor.system, 'hp.value') || 
                   sourceActor.system?.hp?.value;

  const newData = {
    x: token.x,
    y: token.y,
    elevation: token.elevation,
    rotation: token.rotation,
    actorId: targetActor.id,
    actorLink: token.actorLink
  };

  const newToken = await TokenDocument.create(newData, { parent: scene });
  
  // Try to transfer HP to new token
  if (currentHp !== undefined && newToken.actor) {
    try {
      const newHpPath = Object.keys(newToken.actor.system?.attributes || {}).find(k => 
        k.toLowerCase().includes('hp') || k.toLowerCase().includes('health')
      );
      if (newHpPath) {
        await newToken.actor.update({ [`system.${newHpPath}.value`]: currentHp });
      }
    } catch(e) {}
  }

  await token.delete();
  ui.notifications.info(`✅ Transformed into ${targetActor.name}`);
}
