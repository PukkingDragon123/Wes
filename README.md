# 🦝 BROKE @$$ RACCOON

A polished 2D pixel-art **stealth platformer with cooking**. You're a broke raccoon
dad — your wife left, and three hungry kits are counting on you. Each night: leave
the den, sneak through the night-town rooftops and alleys, **dive dumpsters** to dig
up ingredients, dodge the guards (and their dog, and the searchlights), haul the
food **home**, and **cook** each kit the dish they're craving before sunrise.

Everything is hand-built and **100% self-contained** — no engine, no assets, no
network. All pixel art is drawn in code and all music/SFX are synthesized live with
the Web Audio API.

## ▶️ Play

Just open **`index.html`** in any modern browser (Chrome, Firefox, Edge, Safari).
No build step, no server, no dependencies.

Or serve it locally if you prefer:

```bash
python3 -m http.server 8000
# then visit http://localhost:8000
```

## 🎮 Controls

| Action | Keys |
| --- | --- |
| Move | `←` `→` / `A` `D` |
| Jump (hold for higher) | `Z` / `Space` |
| Grab & climb walls | hold `X` / `Shift` |
| Throw / pick up can | `C` |
| Dive dumpster / hide / drop | `↓` (and `↓`+`Z` to drop through platforms) |
| **Attack (claw)** | `X` / `K` — hold `↑` for up-slash, `↓` in the air to **pogo** |
| **Dash** (brief invuln) | double-tap `←`/`→`, or `V` |
| **Focus / heal** | hold `Shift` on the ground — spends SOUL to refill a mask |
| Climb walls | hold `Shift` against a wall |
| Take down an enemy | stomp from above, slash them, or bean them with a thrown can |
| Open the **city map** / fast-travel | `Tab` / `Q` |
| Dive a dumpster / hide | `↓` |
| Cook at the home stove | `C` / `E` (when a dish is ready) |
| Mini-games | move to aim · `Z` to dig / drop · `X` to leave |
| Pause | `Esc` / `P` |
| Toggle sound | `M` |

**On phones/tablets:** on-screen touch controls appear automatically — a d-pad on
the left, and CLIMB / THROW / JUMP on the right. Tap the screen to advance menus.

## 🍜 The night's loop

1. **Home (the den).** Your three kits each crave a dish (from a book of 5 recipes:
   burger, sushi, omelette, grilled cheese, fish stew). The HUD shows what each one
   wants and which ingredients you still need.
2. **Dumpster diving (mini-game).** Press ↓ at a dumpster to climb in and rummage —
   move the cursor and **fling trash out** to uncover the food buried underneath.
   Mind the NOISE meter, or the guards come running.
3. **Cook (mini-game).** Back at the stove with the right ingredients, press the cook
   button to **stack the dish together** — a slide-and-drop timing game. Nail the
   center for a PERFECT plate, then serve your kit.
4. **Win** when every kit is fed and fast asleep.

## ⚔️ Combat (Hollow-Knight style)

The raccoon — redrawn as an inky, high-contrast little vagabond with a pale masked
face, big eyes, and a flowing cloak-tail — is a **4-legged animal** that gallops on
all fours and **rears up on its hind legs to climb and swipe**. Combat is claw-first:
slash forward, up, or **pogo** off an enemy's head with a down-slash while airborne;
**dash** through danger with a burst of invulnerability. Landing hits fills a **SOUL**
orb, which you spend by **holding Focus** to channel and refill a **health mask**.
Touching a live enemy costs a mask (brief i-frames + knockback); at zero masks you're
knocked out and shake it off at a checkpoint. Hitstop, knockback, sparks, and gore
throughout.

The whole interface is **near-wordless** — a hand-drawn ink city map with landmark
icons, icon health masks + soul orb, dish/ingredient icons, and glyph prompts instead
of text.

## 🗺️ The city (map + fast travel)

Explore one connected night-city. Reach a district on foot to **discover** it, then
open the **city map** (`Tab`) to **fast-travel** between THE DEN, ROOFTOPS, THE
MARKET, and the SCRAPYARD — a quick way back home to cook.

## 👮 Enemies

- **Guards** — patrol with raycast vision cones; they chase and hurt on contact.
- **Guard dog** — smells you by **scent radius** in any direction (hiding masks it),
  barks to summon the guards, and it's *fast*.
- **Searchlight** — a mounted lamp sweeping a bright beam.
- **Robots** (the Scrapyard's security, tougher, HP-based):
  - **Walker** — armored ground bot with a scanning visor that chases and rams.
  - **Drone** — flying bot that hovers, then dives at you.

## ✨ Features

- **Physics-driven characters** — spring-animated bodies with a floppy multi-segment
  tail and expressive faces (big tracking eyes, blinks, mouth expressions). The
  raccoon is a 4-legged animal that rears up to fight; the guards have full detailed
  bodies (uniform, cap, belt, gloves, boots).
- **A story it wears on its sleeve** — the title screen is the raccoon dad out in
  the rain, watching a happy human family eat dinner through a warm lit window.
- **Take guards down** — stomp a guard from above or bean one with a thrown can for
  a stylized pixel-gore takedown (blood spray, ragdoll, splats that stay on the
  ground). Or just avoid them — your call.
- **Plays on phones** — automatic on-screen touch controls, tap-to-advance menus.
- **Bouncy, Celeste-style movement** — variable-height jumps, coyote time, jump
  buffering, wall-slide, wall-jump, and stamina-based wall climbing, with squash &
  stretch and dust on every landing.
- **Stealth** — guards patrol with raycast **vision cones** that are blocked by
  walls, a fair line-of-sight detection meter, and alert states (patrol → suspicious
  → chase). Stay in the shadows; you're safest out of the light.
- **Dumpster diving** — dive dumpsters for cash and food for the kits, and hide
  inside dumpsters and crates (with peeking eyes!) to break line of sight.
- **Distractions** — throw cans to make noise and lure guards away from your path.
- **Dynamic night lighting** — streetlight pools, moon glow, parallax skyline, rain,
  and a moody dark veil that makes light and shadow matter to the stealth.
- **Full arc** — animated title, story intro, checkpoints, a "Busted!" retry loop,
  and a scripted **helicopter rescue** finale with Cedric, the kits, and a results
  screen that grades your run.
- **Live procedural audio** — a lo-fi night music loop that tightens when guards get
  suspicious, plus synthesized SFX and a helicopter rotor.

## 🗂️ Project layout

```
index.html        canvas + pixel-perfect scaling, loads the modules in order
js/core.js        namespace, config, math, seeded RNG, input, bitmap pixel font
js/audio.js       Web Audio music scheduler + SFX + helicopter rotor
js/sprites.js     static pixel-art: props, den, stove, chopper, human family scene
js/critter.js     spring-physics characters (raccoon + guard) with expressive faces
js/food.js        ingredients, 5 recipes, and their pixel icons
js/minigames.js   the dumpster-dive and cooking mini-games
js/particles.js   dust, sparks, noise rings, floating loot text, confetti
js/level.js       tile grid + collision, camera, parallax city, lighting, layout
js/player.js      the raccoon — momentum movement, wall mechanics, squash/stretch
js/entities.js    guard stealth AI, throwables, loot, hide-spots, pad, kids
js/game.js        main loop, state machine, HUD, cutscenes, screen juice
```

Built as a single cohesive codebase; all modules share the global `RC` namespace.
