# Token Transformer

Token Transformer is a Foundry VTT module for the **Adventurer Conqueror King System (ACKS)** game system. It lets a GM configure an actor so its tokens can temporarily transform into another actor from a token HUD button, then transform back later without losing key token state.

## What it does

Token Transformer adds a small people-arrows button to ACKS actor sheets and eligible token HUDs.

- **Actor sheet button:** choose the replacement actor UUID for that actor and configure what data should transfer during transformations.
- **Token HUD button:** transform the selected token into the configured replacement actor, or restore it to its original form if it is already transformed.
- **Damage preservation:** ACKS hit point damage is carried between forms, so a wounded token remains wounded after transforming or restoring.
- **Effect preservation:** active effects on the current token can be carried across forms, depending on the module settings.
- **Per-actor and per-token control:** global defaults can be overridden on individual actors and unlinked tokens.
- **Cached transform actors:** replacement actors are materialized into hidden cached world actors so scene tokens can point at stable actors while transformed. Unused cached actors are cleaned up automatically by the GM client.

This is useful for ACKS creatures, characters, or NPCs that need a reversible alternate form, such as shapeshifters, polymorph effects, summoned forms, monster transformations, or any token that should temporarily use another actor's statistics and appearance.

## Installation

Install the module in Foundry VTT using this manifest URL:

```text
https://github.com/cdrit/token-transformer/releases/latest/download/module.json
```

After installation, enable **Token Transformer** in your ACKS world's module settings.

## Basic workflow

1. Open the ACKS actor sheet for the actor that should be able to transform.
2. Click the Token Transformer button in the sheet header.
3. Enter the UUID of the actor to transform into. The UUID can point to a world actor or an actor in a compendium.
4. Choose which data should transfer from the replacement actor.
5. Save the settings.
6. Select a token for the configured actor on a scene.
7. Click the Token Transformer button in the token HUD to transform it.
8. Click the same HUD button again to restore the token to its original actor.

## Transfer settings

Token Transformer has world-level defaults plus actor and token overrides. The following options control what the cached transformed actor receives from the replacement actor:

- **Transfer name and portrait image**
- **Transfer full ACKS system data**
- **Transfer all items**
- **Transfer ability items only** when full item transfer is disabled
- **Transfer active effects from the replacement actor**
- **Transfer prototype token appearance**
- **Carry current token active effects across forms**
- **Show transformed cache actor in the Actor Directory**

ACKS HP damage is always carried regardless of these settings.

## Cache behavior

When a token transforms, the module creates or updates a cached world actor in a folder named **Token Transformer Cache**. These cached actors are hidden from the Actor Directory by default so they do not clutter the world.

The cache is cleaned automatically by the GM client when Foundry is ready, when tokens are deleted, and when scenes are deleted. The global defaults dialog also includes a **Clear Cache** button that removes only unused cached actors; cached actors still referenced by scene tokens are kept.

## Development note

This module is entirely vibe-coded. Contributions and improvements from real coders are welcome.
