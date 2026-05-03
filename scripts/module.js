Hooks.once('init', () => {
  console.log("🚀 Token Transformer | Module is LOADING");
  ui.notifications.info("Token Transformer module loaded!", {type: "info"});
});

Hooks.once('ready', () => {
  console.log("🚀 Token Transformer | Ready hook fired");
});

// Try every possible way to add the button
Hooks.on("renderActorSheet", (app, html) => {
  console.log(`Render hook fired for ${app.actor?.name}`);
  
  const btn = $(`<a class="token-transformer-btn" style="color:red; font-weight:bold; margin-left:10px;">🔄 TEST BUTTON</a>`);
  btn.on('click', () => ui.notifications.info("Button clicked!"));

  html.find('.window-header').append(btn);
  html.find('header').append(btn);
  html.find('.header').append(btn);
  html.find('.window-title').after(btn);
});
