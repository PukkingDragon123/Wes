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
| Take down a guard | pounce on their head, or bean them with a thrown can |
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

## 👮 Enemies

- **Guards** — patrol with raycast vision cones (blocked by walls); walk into a beam
  and a detection meter fills. Take them out from above or with a thrown can.
- **Guard dog** — smells you by **scent radius** in any direction (hiding masks it),
  then barks to summon the guards, and it's *fast*.
- **Searchlight** — a mounted lamp sweeping a bright beam; get caught in it and
  you're spotted in a blink.

## ✨ Features

- **Physics-driven characters** — every raccoon and guard is built from five
  spring-animated body parts (head, torso, arms, legs, and a floppy multi-segment
  tail) with cute, expressive faces: big tracking eyes, blinks, and mouth
  expressions that shift with the action.
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
