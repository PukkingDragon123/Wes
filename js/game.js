/* =============================================================================
   game.js — the glue. Main loop, state machine, HUD, cutscenes, dynamic
   night lighting, screen juice (shake/flash/hitstop), checkpoints, and the
   Cedric helicopter rescue. Boots itself on load.
   ========================================================================== */
(function (global) {
  "use strict";
  const RC = global.RC;
  const M = RC.M, P = RC.PAL;
  const VIEW_W = RC.VIEW_W, VIEW_H = RC.VIEW_H;
  const Input = RC.Input, Audio = RC.Audio, Pt = RC.Particles, Font = RC.Font, S = RC.Sprites, L = RC.Level;

  const INTRO_LINES = [
    ["HOME", "Your den behind the noodle shop. Cold tonight."],
    ["HOME", "Your wife's long gone. Three kits, three empty bellies."],
    ["THE KITS", "Each one's got a craving. You can see it in their eyes."],
    ["THE PLAN", "Head out. Dive the dumpsters — brush the trash, find the food."],
    ["THE PLAN", "Dodge the guards and the dog. Bring the ingredients home."],
    ["THE PLAN", "Then cook. Feed every last one of them before sunrise."],
  ];

  const Game = {
    canvas: null, ctx: null,
    state: "title",
    last: 0, time: 0,
    started: false,
    // entities
    player: null, guards: [], loot: [], throwables: [], spots: [], hints: [], kids: [], pad: null, checkpoints: [],
    stove: null, inv: {}, dishesMade: 0,
    // stats
    cash: 0, food: 0, deaths: 0, runStart: 0, runTime: 0,
    checkpoint: null,
    // fx
    flash: 0, flashColor: "255,255,255", hitstop: 0, fade: 1, fadeDir: -1,
    // cutscene
    introI: 0, introT: 0, caughtT: 0, winT: 0, winPhase: 0, msg: "", msgT: 0,
    heli: { x: 0, y: 0, rot: 0 },
    detectShown: 0,

    init() {
      this.canvas = document.getElementById("game");
      this.ctx = this.canvas.getContext("2d");
      this.ctx.imageSmoothingEnabled = false;
      Input.init();
      Input.initTouch();
      // tap the game area to advance menus / cutscenes on touch
      this.canvas.addEventListener("pointerdown", () => {
        Audio.resume();
        const s = this.state;
        if (s === "title" || s === "intro" || (s === "win" && (this.winPhase === 1 || this.winPhase === 3))) Input.pulse("KeyZ", 130);
      });
      L.build();
      this._resize();
      global.addEventListener("resize", () => this._resize());
      this._spawnAll();
      this.titleCritter = new RC.Critter("raccoon");
      this.portraitCritter = new RC.Critter("raccoon");
      this.winDad = new RC.Critter("raccoon");
      this.checkpoint = { x: L.spawn.x, y: L.spawn.y };
      L.focusCamera(this.player.cx(), this.player.cy());
      this.state = "title";
      this.fade = 1; this.fadeDir = -1;
      this.last = RC.now();
      requestAnimationFrame((t) => this._loop(t));
    },

    _resize() {
      const s = Math.min(global.innerWidth / VIEW_W, global.innerHeight / VIEW_H);
      const scale = s >= 1 ? Math.floor(s) : s;
      this.canvas.style.width = Math.round(VIEW_W * scale) + "px";
      this.canvas.style.height = Math.round(VIEW_H * scale) + "px";
      const rot = document.getElementById("rotate");
      if (rot) rot.style.display = (global.innerWidth < global.innerHeight && global.innerWidth < 480) ? "flex" : "none";
    },

    _spawnAll() {
      this.guards = []; this.loot = []; this.throwables = []; this.spots = []; this.hints = []; this.kids = []; this.checkpoints = [];
      this.inv = {}; this.dishesMade = 0; this.stove = null; this.pad = null;
      Pt.reset();
      for (const sp of L.spawns) {
        switch (sp.type) {
          case "player": this.player = new RC.Player(sp.x, sp.y, this); break;
          case "kid": this.kids.push(new RC.Ent.Kid(sp)); break;
          case "hint": break;   // near-zero text: tutorial signs replaced by icon prompts
          case "dumpster": this.spots.push(new RC.Ent.HideSpot({ kind: "dumpster", x: sp.x, y: sp.y, ingredients: sp.ingredients || [] })); break;
          case "crate": this.spots.push(new RC.Ent.HideSpot({ kind: "crate", x: sp.x, y: sp.y, size: sp.size })); break;
          case "ing": this.loot.push(new RC.Ent.Loot({ type: sp.ing, x: sp.x, y: sp.y })); break;
          case "coin": this.loot.push(new RC.Ent.Loot({ type: "coin", x: sp.x, y: sp.y })); break;
          case "can": this.loot.push(new RC.Ent.Loot({ type: "can", x: sp.x, y: sp.y })); break;
          case "stove": this.stove = { cx: sp.x, topY: sp.y, t: 0 }; break;
          case "checkpoint": this.checkpoints.push({ x: sp.x, y: sp.y, taken: false }); break;
        }
      }
      for (const gd of L.guardsDef) {
        this.guards.push(gd.type === "dog" ? new RC.Ent.Dog(gd)
          : gd.type === "searchlight" ? new RC.Ent.Searchlight(gd)
            : gd.type === "robot" ? new RC.Ent.Robot(gd)
              : new RC.Ent.Guard(gd));
      }
      // assign each kit a dish to crave
      const wants = ["burger", "sushi", "omelette", "grilled", "stew"];
      this.kids.forEach((k, i) => { k.recipe = RC.Food.recipe(wants[i % wants.length]); k.fed = false; k.celebrate = 0; });
      // city-map districts (fast-travel nodes across the one connected level)
      const T = RC.TILE;
      this.districts = [
        { name: "THE DEN", x: 6 * T + 8, y: 24 * T, unlocked: true },
        { name: "ROOFTOPS", x: 41 * T + 8, y: 14 * T, unlocked: false },
        { name: "THE MARKET", x: 75 * T + 8, y: 24 * T, unlocked: false },
        { name: "SCRAPYARD", x: 124 * T + 8, y: 8 * T, unlocked: false },
      ];
      this.mapSel = 0;
    },

    // ---- callbacks used by entities -----------------------------------
    addCash(n) { this.cash += n; },
    addFood(n) { this.food += n; },
    addIngredient(id) { this.inv[id] = (this.inv[id] || 0) + 1; },
    startDive(spot) { this.diveSpot = spot; this.state = "dive"; RC.Dive.start(spot, this); },
    startCook(recipe, kid) { this.cookKid = kid; this.state = "cook"; RC.Cook.start(recipe, kid, this); },
    cookableKid() { return this.kids.find((k) => !k.fed && k.recipe && RC.Food.have(this.inv, k.recipe)); },
    alertNear(x, y) {
      for (const g of this.guards) if (!g.dead && Math.abs(g.x - x) < 170) { g.alert = Math.max(g.alert, 0.65); g.lastX = x; g.grace = 1.2; g.state = "investigate"; }
      Audio.play("suspect");
    },
    makeNoise(x, y, r) { for (const g of this.guards) g.hearNoise(x, y, r); Pt.ring(x, y, "#ffd27a", r); },
    spawnLoot(x, y, type) { this.loot.push(new RC.Ent.Loot({ type, x, y })); },
    spawnThrowable(it) { this.throwables.push(new RC.Ent.Throwable(it)); },
    onSpotted() { /* combat: enemies now chase and deal contact damage instead of instant-fail */ },

    _toast(t) { this.msg = t; this.msgT = 3; },

    // ---- main loop ----------------------------------------------------
    _loop(ts) {
      requestAnimationFrame((t) => this._loop(t));
      let dt = (ts - this.last) / 1000; this.last = ts;
      if (dt > 0.05) dt = 0.05;
      this.time += dt;
      Input.poll();
      this._globalKeys();
      if (this.hitstop > 0) { this.hitstop -= dt; }
      else { this._update(dt); }
      this._render(dt);
    },

    _globalKeys() {
      if (Input.anyPressed) Audio.resume();
      if (Input.pressed("mute")) Audio.toggle();
      if (Input.pressed("pause")) {
        if (this.state === "play") { this.state = "pause"; Audio.play("select"); }
        else if (this.state === "pause") { this.state = "play"; Audio.play("select"); }
      }
    },

    _update(dt) {
      // fade
      this.fade = M.clamp(this.fade + this.fadeDir * dt * 2.2, 0, 1);
      if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 2.6);
      if (this.msgT > 0) this.msgT -= dt;

      switch (this.state) {
        case "title": this._updTitle(dt); break;
        case "intro": this._updIntro(dt); break;
        case "play": this._updPlay(dt); break;
        case "pause": break;
        case "caught": this._updCaught(dt); break;
        case "dive": this._updDive(dt); break;
        case "cook": this._updCook(dt); break;
        case "map": this._updMap(dt); break;
        case "won": this._updWon(dt); break;
        case "win": this._updWin(dt); break;
      }
    },

    _updDive(dt) {
      RC.Dive.update(dt, Input); Pt.update(dt);
      if (RC.Dive.done) { this.state = "play"; if (this.diveSpot) this.diveSpot.active = false; }
    },
    _updCook(dt) {
      RC.Cook.update(dt, Input); Pt.update(dt);
      if (!RC.Cook.done) return;
      const r = RC.Cook.result;
      if (r && r.fed) {
        RC.Food.consume(this.inv, RC.Cook.recipe);
        if (this.cookKid) { this.cookKid.fed = true; this.cookKid.celebrate = 3; }
        this.dishesMade++;
        if (this.cookKid) Pt.confetti(this.cookKid.x, this.cookKid.y - 14, 24);
        Audio.play("checkpoint");
      }
      if (this.kids.length && this.kids.every((k) => k.fed)) this._beginWon();
      else this.state = "play";
    },

    _updTitle(dt) {
      this.titleCritter.update(dt, { grounded: true, vx: 0, state: "idle", dir: 1, expr: "sad", look: { x: 0.15, y: -0.7 } });
      if (Input.pressed("confirm")) {
        Audio.resume(); Audio.play("confirm");
        this.state = "intro"; this.introI = 0; this.introT = 0;
        L.focusCamera(this.player.cx(), this.player.cy() - 10);
      }
    },

    _updIntro(dt) {
      this.introT += dt;
      // idle-animate the kids & player in the alley
      for (const k of this.kids) k.update(dt);
      this.player.animT += dt;
      this.portraitCritter.update(dt, { grounded: true, vx: 0, state: "idle", dir: 1, expr: this.introI < 2 ? "sad" : "determined", look: { x: 0.3, y: 0 } });
      if (Input.pressed("confirm") || Input.pressed("jump")) {
        Audio.play("select");
        this.introI++;
        this.introT = 0;
        if (this.introI >= 3) this._beginPlay();
      }
      if (Input.pressed("pause")) this._beginPlay();  // skip
    },

    _beginPlay() {
      this.state = "play";
      this.runStart = this.time;
      this.fade = 1; this.fadeDir = -1;
      Audio.startMusic();
    },

    _updPlay(dt) {
      const pl = this.player;
      pl.update(dt, Input);

      // --- melee: player's slash hits enemies ---
      if (pl.atk > 0) {
        const box = pl.getSlashBox();
        for (let i = 0; i < this.guards.length; i++) {
          const g = this.guards[i];
          if (g.dead || pl.atkHit[i] || !g.aabb) continue;
          const a = g.aabb();
          if (M.aabb(box.x, box.y, box.w, box.h, a.x, a.y, a.w, a.h)) {
            pl.atkHit[i] = true;
            if (g.hit) g.hit(1, pl.cx());
            pl.soul = Math.min(pl.soulMax, pl.soul + RC.PlayerConfig.SOUL_PER_HIT);
            this.hitstop = Math.max(this.hitstop, 0.05);
            Pt.spark(box.x + box.w / 2, box.y + box.h / 2, 6, "#e6ecff");
            if (pl.atkDir === "down") { pl.vy = -300; pl.atk = 0; }   // pogo bounce
            else pl.vx += (pl.cx() < g.x ? -1 : 1) * 64;              // recoil
          }
        }
      }
      // --- contact damage: touching a live enemy hurts ---
      if (!pl.dead && !pl.hidden && pl.iframes <= 0) {
        for (const g of this.guards) {
          if (g.dead || g.hitStun > 0 || !g.aabb) continue;
          const a = g.aabb();
          if (M.aabb(pl.x, pl.y, pl.w, pl.h, a.x, a.y, a.w, a.h)) { if (pl.hurt(g.dmg || 1, g.x)) break; }
        }
      }
      // --- knocked out? ---
      if (pl.hp <= 0 && !pl.dead) {
        pl.dead = true; this.state = "caught"; this.caughtT = 0;
        this.flash = 1; this.flashColor = "255,70,90"; this.hitstop = 0.16;
        L.shake(5, 0.5); Audio.play("caught"); Audio.setIntensity(0);
        return;
      }

      // interactions --------------------------------------------------
      if (pl.hidden) {
        if (Input.pressed("jump") || Input.pressed("up") || Input.axisX() !== 0) {
          const spot = this.spots.find((s) => s.active);
          if (spot) spot.leave(pl);
        }
      } else {
        // hide / dive
        if (Input.pressed("down") && pl.grounded) {
          const spot = this.spots.find((s) => s.near(pl));
          if (spot) spot.interact(pl, this);
        }
        // throw
        if (Input.pressed("throw") && pl.carry) {
          const it = pl.doThrow();
          if (it) this.spawnThrowable(it);
        }
        // cook at the home stove
        if (this.stove && Math.abs(pl.cx() - this.stove.cx) < 20 && pl.grounded &&
          (Input.pressed("action") || (Input.pressed("throw") && !pl.carry))) {
          const k = this.cookableKid();
          if (k) this.startCook(k.recipe, k);
          else Audio.play("bad");
        }
      }
      if (this.stove) this.stove.t += dt;

      // pounce takedown: land on a guard's head from above (gore)
      if (!pl.hidden && !pl.dead && pl.vy > 40) {
        for (const g of this.guards) {
          if (g.dead) continue;
          if (Math.abs(pl.cx() - g.x) < 11 && pl.feetY() > g.y - 22 && pl.feetY() < g.y - 4) {
            if (g.hit) g.hit(3, pl.cx()); else g.die(pl.cx() < g.x ? -1 : 1);
            pl.vy = -260; pl.sx = 1.3; pl.sy = 0.7;
            this.hitstop = 0.08; this.flash = 0.4; this.flashColor = "200,40,55";
            break;
          }
        }
      }

      // update world --------------------------------------------------
      for (const s of this.spots) s.update(dt);
      for (const g of this.guards) { g.update(dt, pl, this); if (this.state !== "play") break; }
      for (let i = this.throwables.length - 1; i >= 0; i--) { const t = this.throwables[i]; t.update(dt, this); if (t.dead) this.throwables.splice(i, 1); }
      for (let i = this.loot.length - 1; i >= 0; i--) { const l = this.loot[i]; l.update(dt, this, pl); if (l.dead) this.loot.splice(i, 1); }
      for (const h of this.hints) h.update(dt, pl);
      for (const k of this.kids) k.update(dt);
      if (this.pad) this.pad.update(dt);
      Pt.update(dt);

      // music tension from the most alert guard
      let maxAlert = 0; for (const g of this.guards) if (g.alert > maxAlert) maxAlert = g.alert;
      this.detectShown = M.damp(this.detectShown, maxAlert, 12, dt);
      Audio.setIntensity(maxAlert);

      // fell into the void? (shouldn't happen — floor is solid) safety
      if (pl.y > L.worldH + 40) this._respawn();

      // discover districts on foot; open the city map with Tab/Q
      for (const d of this.districts) {
        if (!d.unlocked && Math.abs(pl.cx() - d.x) < 64 && Math.abs(pl.feetY() - d.y) < 44) {
          d.unlocked = true; Audio.play("checkpoint"); Pt.spark(pl.cx(), pl.cy() - 12, 12, P.good); Pt.ring(pl.cx(), pl.cy() - 8, P.good, 30);
        }
      }
      if (Input.pressed("map")) { this.state = "map"; Audio.play("select"); return; }

      // checkpoints
      for (const cp of this.checkpoints) {
        if (!cp.taken && pl.grounded && !pl.hidden && pl.cx() > cp.x - 4 && Math.abs(pl.feetY() - cp.y) < 22) {
          cp.taken = true; this.checkpoint = { x: cp.x, y: cp.y };
          Audio.play("checkpoint"); Pt.spark(cp.x, cp.y - 16, 14, P.good);
        }
      }

      // (extraction pad is now just scenery — the goal is feeding the kits)

      // camera
      const look = M.clamp(pl.vx / 100, -1, 1);
      L.updateCamera(pl.cx(), pl.cy(), look, dt);
    },

    _respawn() {
      const pl = this.player;
      pl.x = this.checkpoint.x - pl.w / 2; pl.y = this.checkpoint.y - pl.h;
      pl.vx = pl.vy = 0; pl.dead = false; pl.hidden = false; pl.carry = null; pl.stam = RC.PlayerConfig.STAM_MAX;
      pl.hp = pl.maxHp; pl.iframes = 1.3; pl.atk = 0;
      for (const g of this.guards) g.reset();
      for (const s of this.spots) s.active = false;
      this.throwables.length = 0;
      Audio.setIntensity(0);
      L.focusCamera(pl.cx(), pl.cy());
    },

    _updCaught(dt) {
      this.caughtT += dt;
      Pt.update(dt);
      L.updateCamera(this.player.cx(), this.player.cy(), 0, dt);
      if (this.caughtT > 0.9 && this.fadeDir >= 0 && this.fade < 1) { /* fading out */ }
      if (this.caughtT > 0.8 && this.fadeDir !== 1) { this.fadeDir = 1; }
      if (this.fade >= 1 && this.caughtT > 1.0) {
        this.deaths++;
        this._respawn();
        this.state = "play";
        this.fadeDir = -1;
      }
    },

    _updMap(dt) {
      if (Input.pressed("map") || Input.pressed("pause")) { this.state = "play"; return; }
      if (Input.pressed("left")) { this.mapSel = (this.mapSel + this.districts.length - 1) % this.districts.length; Audio.play("select"); }
      if (Input.pressed("right")) { this.mapSel = (this.mapSel + 1) % this.districts.length; Audio.play("select"); }
      if (Input.pressed("confirm") || Input.pressed("action")) {
        const d = this.districts[this.mapSel];
        if (d.unlocked) {
          const pl = this.player; pl.x = d.x - pl.w / 2; pl.y = d.y - pl.h; pl.vx = pl.vy = 0; pl.hidden = false;
          for (const g of this.guards) g.reset(); this.throwables.length = 0;
          L.focusCamera(pl.cx(), pl.cy()); Audio.play("confirm"); Pt.spark(pl.cx(), pl.cy() - 10, 14, P.good); this.state = "play";
        } else Audio.play("bad");
      }
    },
    // wobbly hand-drawn helpers (deterministic jitter by seed)
    _ink(ctx, ax, ay, bx, by, seed) {
      const seg = 6, jit = 1.1; ctx.beginPath(); ctx.moveTo(ax, ay);
      for (let i = 1; i <= seg; i++) { const t = i / seg; const jx = Math.sin(seed + i * 2.3) * jit, jy = Math.cos(seed + i * 1.7) * jit; ctx.lineTo(ax + (bx - ax) * t + jx, ay + (by - ay) * t + jy); }
      ctx.stroke();
    },
    _inkCircle(ctx, cx, cy, r, seed) {
      const seg = 14; ctx.beginPath();
      for (let i = 0; i <= seg; i++) { const a = (i / seg) * Math.PI * 2; const rr = r + Math.sin(seed + i * 1.9) * 0.9; const px = cx + Math.cos(a) * rr, py = cy + Math.sin(a) * rr; if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); }
      ctx.stroke();
    },
    _mapIcon(ctx, i, X, y, c) {
      ctx.strokeStyle = c; ctx.fillStyle = c; ctx.lineWidth = 1;
      if (i === 0) { // den: little tent/house + heart
        ctx.beginPath(); ctx.moveTo(X - 6, y + 5); ctx.lineTo(X, y - 5); ctx.lineTo(X + 6, y + 5); ctx.closePath(); ctx.stroke();
        ctx.fillStyle = "#c0433c"; ctx.fillRect(X - 1, y, 2, 2);
      } else if (i === 1) { // rooftops: skyline zigzag
        ctx.beginPath(); ctx.moveTo(X - 7, y + 5); ctx.lineTo(X - 7, y - 1); ctx.lineTo(X - 3, y - 1); ctx.lineTo(X - 3, y - 5); ctx.lineTo(X + 1, y - 5); ctx.lineTo(X + 1, y + 1); ctx.lineTo(X + 5, y + 1); ctx.lineTo(X + 5, y - 3); ctx.lineTo(X + 7, y - 3); ctx.lineTo(X + 7, y + 5); ctx.stroke();
      } else if (i === 2) { // market: stall w/ awning
        ctx.strokeRect(X - 5, y - 1, 10, 6); ctx.beginPath(); ctx.moveTo(X - 7, y - 1); ctx.lineTo(X - 4, y - 5); ctx.lineTo(X + 4, y - 5); ctx.lineTo(X + 7, y - 1); ctx.stroke();
      } else { // scrapyard: gear
        this._inkCircle(ctx, X, y, 4, i * 5); for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2; ctx.fillRect(Math.round(X + Math.cos(a) * 6) - 1, Math.round(y + Math.sin(a) * 6) - 1, 2, 2); }
      }
    },
    _drawMap(ctx) {
      ctx.fillStyle = "rgba(8,7,16,0.9)"; ctx.fillRect(0, 0, VIEW_W, VIEW_H);
      const px = 44, py = 40, pw = VIEW_W - 88, ph = VIEW_H - 80;
      ctx.fillStyle = "#181630"; ctx.fillRect(px, py, pw, ph);
      ctx.fillStyle = "#20203c"; ctx.fillRect(px + 3, py + 3, pw - 6, ph - 6);
      ctx.strokeStyle = "#8b90c8"; ctx.lineWidth = 1;
      this._ink(ctx, px + 7, py + 7, px + pw - 7, py + 7, 1); this._ink(ctx, px + pw - 7, py + 7, px + pw - 7, py + ph - 7, 2);
      this._ink(ctx, px + pw - 7, py + ph - 7, px + 7, py + ph - 7, 3); this._ink(ctx, px + 7, py + ph - 7, px + 7, py + 7, 4);
      // ink speckle
      const rng = RC.makeRng(7); ctx.fillStyle = "rgba(139,144,200,0.16)";
      for (let i = 0; i < 46; i++) ctx.fillRect(px + rng.int(8, pw - 8), py + rng.int(8, ph - 8), 1, 1);
      // a hand-drawn raccoon-mask compass in the corner
      ctx.strokeStyle = "#5b6191"; this._inkCircle(ctx, px + pw - 22, py + 22, 8, 20);
      ctx.fillStyle = "#e2e4f4"; ctx.fillRect(px + pw - 27, py + 20, 4, 3); ctx.fillRect(px + pw - 20, py + 20, 4, 3);
      // route + node landmarks (no labels)
      const n = this.districts.length, y = py + ph * 0.56, x0 = px + 46, x1 = px + pw - 46;
      const nx = (i) => Math.round(x0 + (x1 - x0) * (i / (n - 1)));
      ctx.strokeStyle = "#5b6191"; ctx.lineWidth = 1;
      for (let i = 0; i < n - 1; i++) this._ink(ctx, nx(i), y, nx(i + 1), y, 10 + i * 13);
      for (let i = 0; i < n; i++) {
        const d = this.districts[i], X = nx(i), sel = i === this.mapSel;
        ctx.strokeStyle = d.unlocked ? "#8b90c8" : "#3a3f5e";
        this._inkCircle(ctx, X, y, 12, i * 7);
        if (d.unlocked) this._mapIcon(ctx, i, X, y, sel ? "#f2d27a" : "#aeb3dc");
        else { ctx.strokeStyle = "#3a3f5e"; this._ink(ctx, X - 3, y - 3, X + 3, y + 3, i); this._ink(ctx, X + 3, y - 3, X - 3, y + 3, i + 1); } // scribble-out
        if (sel) { ctx.strokeStyle = "#f2d27a"; this._inkCircle(ctx, X, y, 15 + Math.sin(this.time * 6), 100 + ((this.time * 4) | 0)); }
      }
      // textless controls hint: ‹  ◇  › glyphs, faint
      ctx.strokeStyle = "#5b6191";
      ctx.beginPath(); ctx.moveTo(VIEW_W / 2 - 34, VIEW_H - 30); ctx.lineTo(VIEW_W / 2 - 40, VIEW_H - 26); ctx.lineTo(VIEW_W / 2 - 34, VIEW_H - 22); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(VIEW_W / 2 + 34, VIEW_H - 30); ctx.lineTo(VIEW_W / 2 + 40, VIEW_H - 26); ctx.lineTo(VIEW_W / 2 + 34, VIEW_H - 22); ctx.stroke();
      ctx.fillStyle = "#8b90c8"; ctx.fillRect(VIEW_W / 2 - 2, VIEW_H - 28, 4, 4);
    },

    _beginWon() {
      this.state = "won"; this.wonT = 0; this.runTime = this.time - this.runStart;
      L.focusCamera(this.player.cx(), this.player.cy());
      Audio.setIntensity(0); Audio.stopMusic(1.2); Audio.play("win");
      Pt.confetti(this.player.cx(), this.player.cy() - 12, 44);
    },
    _updWon(dt) {
      this.wonT = (this.wonT || 0) + dt;
      for (const k of this.kids) k.update(dt);
      this.player.animT += dt;
      this.player.critter.update(dt, { grounded: true, vx: 0, state: "idle", dir: 1, expr: "happy", look: { x: -0.2, y: 0 } });
      Pt.update(dt);
      if ((this.wonT * 60 | 0) % 16 === 0) Pt.confetti(this.player.cx() + (RC.rng() - 0.5) * 90, this.player.cy() - 34, 5);
      L.updateCamera(this.player.cx(), this.player.cy(), 0, dt);
      if (this.wonT > 1 && Input.pressed("confirm")) this._toTitle();
    },
    // wordless ending — a row of full hearts + the dishes cooked, then a glyph
    _drawWon(ctx) {
      ctx.fillStyle = "rgba(10,8,20,0.66)"; ctx.fillRect(0, 0, VIEW_W, VIEW_H);
      const cx = VIEW_W / 2;
      // three big hearts (the fed kits), gently beating
      for (let i = 0; i < this.kids.length; i++) {
        const hx = cx + (i - (this.kids.length - 1) / 2) * 34, beat = 1 + Math.sin(this.time * 4 + i) * 0.12;
        ctx.save(); ctx.translate(hx, 60); ctx.scale(beat, beat);
        S.heart(ctx, -3, -3, true); ctx.restore();
      }
      // the dishes cooked, on little plates
      for (let i = 0; i < this.dishesMade; i++) {
        const dx = cx + (i - (this.dishesMade - 1) / 2) * 40;
        const rec = this.kids[i] && this.kids[i].recipe; if (rec) RC.Food.drawDish(ctx, dx, 120, rec, 1);
      }
      // grade as pips (stars); fewer busts = more
      const stars = this.deaths === 0 ? 3 : this.deaths < 3 ? 2 : 1;
      for (let i = 0; i < 3; i++) {
        ctx.fillStyle = i < stars ? P.gold : "#3a3f5e";
        const sx = cx + (i - 1) * 14;
        ctx.beginPath();
        for (let k = 0; k < 5; k++) { const a = -Math.PI / 2 + k * (Math.PI * 2 / 5); const r = 4; const px = sx + Math.cos(a) * r, py = 150 + Math.sin(a) * r; k ? ctx.lineTo(px, py) : ctx.moveTo(px, py); const a2 = a + Math.PI / 5; ctx.lineTo(sx + Math.cos(a2) * 1.7, 150 + Math.sin(a2) * 1.7); }
        ctx.closePath(); ctx.fill();
      }
      // continue glyph
      if ((this.time % 1) < 0.6) { ctx.strokeStyle = "#e6e8f6"; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(cx, VIEW_H - 26, 7, 0, Math.PI * 2); ctx.stroke(); ctx.fillStyle = "#e6e8f6"; ctx.beginPath(); ctx.arc(cx, VIEW_H - 26, 2, 0, Math.PI * 2); ctx.fill(); }
    },

    _beginWin() {
      this.state = "win"; this.winT = 0; this.winPhase = 0;
      this.runTime = this.time - this.runStart;
      this.player.exiting = true; this.player.vx = 0; this.player.vy = 0;
      this.heli.x = this.pad.cx + 160; this.heli.y = this.pad.topY - 150;
      Audio.setIntensity(0); Audio.stopMusic(1.5); Audio.startHeli();
      this._winKids = [
        new RC.Ent.Kid({ x: this.pad.cx - 16, y: this.pad.topY, dir: 1 }),
        new RC.Ent.Kid({ x: this.pad.cx - 24, y: this.pad.topY, dir: 1 }),
        new RC.Ent.Kid({ x: this.pad.cx + 14, y: this.pad.topY, dir: -1 }),
      ];
    },

    _updWin(dt) {
      this.winT += dt;
      const pad = this.pad;
      this.heli.rot += dt * 46;
      for (const k of (this._winKids || [])) k.update(dt);
      this.winDad.update(dt, { grounded: true, vx: 0, state: "idle", dir: 1, expr: "happy", look: { x: -0.3, y: -0.2 } });
      Pt.update(dt);

      // phases: 0 approach/descend, 1 hover + dialogue, 2 board+lift, 3 results
      if (this.winPhase === 0) {
        this.heli.x = M.damp(this.heli.x, pad.cx + 26, 2.5, dt);
        this.heli.y = M.damp(this.heli.y, pad.topY - 34, 2.2, dt);
        Audio.setHeliLevel(0.8);
        L.shake(0.6, 0.2);
        if (this.winT > 3.2) { this.winPhase = 1; this.winT = 0; }
      } else if (this.winPhase === 1) {
        this.heli.y = pad.topY - 34 + Math.sin(this.winT * 2) * 1.5;
        if (this.winT > 3.0 || Input.pressed("confirm")) { this.winPhase = 2; this.winT = 0; Audio.play("win"); }
      } else if (this.winPhase === 2) {
        this.heli.y = M.damp(this.heli.y, pad.topY - 200, 1.6, dt);
        this.heli.x = M.damp(this.heli.x, pad.cx + 200, 1.2, dt);
        Audio.setHeliLevel(M.sat(1 - this.winT / 3));
        if ((this.winT * 60 | 0) % 6 === 0) Pt.confetti(pad.cx, pad.topY - 20, 6);
        if (this.winT > 2.6) { this.winPhase = 3; this.winT = 0; Audio.stopHeli(); }
      } else if (this.winPhase === 3) {
        if (this.winT > 0.6 && Input.pressed("confirm")) this._toTitle();
      }
      // keep camera on the pad
      L.updateCamera(pad.cx, pad.topY - 10, 0, dt);
    },

    _toTitle() {
      Audio.stopHeli(); Audio.stopMusic(0.5);
      this.cash = 0; this.food = 0; this.deaths = 0;
      L.build(); this._spawnAll();
      this.checkpoint = { x: L.spawn.x, y: L.spawn.y };
      this.player.exiting = false;
      L.focusCamera(this.player.cx(), this.player.cy());
      this.state = "title"; this.fade = 1; this.fadeDir = -1;
    },

    // ---- rendering ----------------------------------------------------
    _render(dt) {
      const ctx = this.ctx;
      ctx.imageSmoothingEnabled = false;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, VIEW_W, VIEW_H);

      L.drawBackground(ctx, this.time);

      if (this.state === "title") { this._drawTitle(ctx); this._drawFade(ctx); return; }

      // world
      const cam = { x: L.camX(), y: L.camY() };
      L.drawTiles(ctx);
      L.drawPoles(ctx);
      S.den(ctx, Math.round(6 * RC.TILE + 8 - cam.x), Math.round(24 * RC.TILE - cam.y), this.time);  // home
      Pt.drawDecals(ctx, cam);      // blood splats sit on the ground

      // hide spots (behind actors), then loot, actors, particles
      for (const s of this.spots) s.draw(ctx, cam);
      if (this.state !== "win") for (const k of this.kids) k.draw(ctx, cam);
      for (const l of this.loot) l.draw(ctx, cam);
      if (this.stove) S.stove(ctx, Math.round(this.stove.cx - cam.x), Math.round(this.stove.topY - cam.y), this.stove.t, !!this.cookableKid());
      // checkpoint flags
      for (const cp of this.checkpoints) {
        const x = Math.round(cp.x - cam.x), y = Math.round(cp.y - cam.y);
        ctx.fillStyle = "#2a2735"; ctx.fillRect(x - 1, y - 22, 2, 22);
        const col = cp.taken ? P.good : P.textDim, f = cp.taken ? Math.sin(this.time * 6) * 2 : 0;
        ctx.fillStyle = col;
        ctx.beginPath(); ctx.moveTo(x + 1, y - 22); ctx.lineTo(x + 10 + f, y - 19); ctx.lineTo(x + 1, y - 15); ctx.closePath(); ctx.fill();
      }
      // guard vision cones (under actors, over ground)
      for (const g of this.guards) g.drawCone(ctx, cam);
      for (const t of this.throwables) t.draw(ctx, cam);
      for (const g of this.guards) g.draw(ctx, cam);

      if (this.state === "win") this._drawWinActors(ctx, cam);
      else this.player.draw(ctx, cam);

      for (const h of this.hints) h.draw(ctx, cam);
      Pt.draw(ctx, cam);

      // dynamic night lighting
      this._drawLighting(ctx);
      L.drawRain(ctx, dt);

      // state overlays / HUD
      if (this.state === "play" || this.state === "pause") this._drawHUD(ctx);
      if (this.state === "intro") this._drawIntro(ctx);
      if (this.state === "pause") this._drawPause(ctx);
      if (this.state === "caught") this._drawCaught(ctx);
      if (this.state === "dive") RC.Dive.draw(ctx);
      if (this.state === "cook") RC.Cook.draw(ctx);
      if (this.state === "map") this._drawMap(ctx);
      if (this.state === "won") this._drawWon(ctx);
      if (this.state === "win") this._drawWin(ctx);

      // flash + fade
      if (this.flash > 0) { ctx.fillStyle = `rgba(${this.flashColor},${this.flash * 0.6})`; ctx.fillRect(0, 0, VIEW_W, VIEW_H); }
      this._drawFade(ctx);
    },

    _drawLighting(ctx) {
      // night veil to deepen shadows, then additive lamp pools punch through
      ctx.save();
      ctx.fillStyle = "rgba(8,8,24,0.34)";
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
      ctx.globalCompositeOperation = "lighter";
      L.drawLights(ctx);
      // faint aura around the raccoon so it never fully disappears
      if (this.player && !this.player.hidden && this.state !== "title") {
        const px = this.player.cx() - L.camX(), py = this.player.cy() - L.camY();
        const g = ctx.createRadialGradient(px, py, 2, px, py, 26);
        g.addColorStop(0, "rgba(120,130,170,0.16)");
        g.addColorStop(1, "rgba(120,130,170,0)");
        ctx.fillStyle = g; ctx.fillRect(px - 26, py - 26, 52, 52);
      }
      ctx.restore();
    },

    // ---- HUD ----------------------------------------------------------
    _check(ctx, x, y, c) { ctx.strokeStyle = c; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, y + 1); ctx.lineTo(x + 2, y + 3); ctx.lineTo(x + 5, y - 2); ctx.stroke(); },

    _drawHUD(ctx) {
      // kits' wanted dishes — dish plate + ingredient icons + a check when fed
      for (let i = 0; i < this.kids.length; i++) {
        const k = this.kids[i], bx = 5 + i * 50, by = 5, bw = 46, bh = 26;
        ctx.fillStyle = "rgba(10,10,22,0.55)"; ctx.fillRect(bx, by, bw, bh);
        ctx.fillStyle = k.fed ? "rgba(103,224,163,0.95)" : "rgba(120,126,180,0.45)"; ctx.fillRect(bx, by, bw, 1);
        if (k.recipe) for (let j = 0; j < k.recipe.ing.length; j++) {
          const id = k.recipe.ing[j], gx = bx + 9 + j * 12, gy = by + 13;
          RC.Food.drawIngredient(ctx, gx, gy, id, 1);
          if (!k.fed && (this.inv[id] || 0) === 0) { ctx.fillStyle = "rgba(12,8,16,0.6)"; ctx.fillRect(gx - 4, gy - 4, 8, 8); }
        }
        if (k.fed) this._check(ctx, bx + bw - 8, by + 4, P.good);
      }
      // health masks + soul orb (top-right)
      for (let i = 0; i < this.player.maxHp; i++) S.heart(ctx, VIEW_W - 11 - i * 10, 8, i < this.player.hp);
      const ox = VIEW_W - 15, oy = 26, orr = 6, sf = this.player.soul / this.player.soulMax;
      ctx.fillStyle = "#0e0c1c"; ctx.beginPath(); ctx.arc(ox, oy, orr + 1.5, 0, Math.PI * 2); ctx.fill();
      ctx.save(); ctx.beginPath(); ctx.arc(ox, oy, orr, 0, Math.PI * 2); ctx.clip();
      ctx.fillStyle = "#dfe6ff"; ctx.fillRect(ox - orr, oy + orr - 2 * orr * sf, orr * 2, 2 * orr * sf);
      ctx.restore();
      ctx.strokeStyle = this.player.soul >= RC.PlayerConfig.FOCUS_COST ? "#eaf0ff" : "#5a5f86"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(ox, oy, orr, 0, Math.PI * 2); ctx.stroke();

      // inventory bag (bottom-left) — a satchel icon then ingredient icons + counts
      let ix = 8; const iy = VIEW_H - 12;
      ctx.fillStyle = "#6b4e2e"; ctx.fillRect(ix, iy - 4, 10, 9); ctx.fillStyle = "#8a6a44"; ctx.fillRect(ix, iy - 4, 10, 2); ctx.fillStyle = "#4a341c"; ctx.fillRect(ix + 4, iy - 6, 2, 3);
      ix += 16;
      for (const id of RC.Food.ids) {
        const n = this.inv[id] || 0; if (n <= 0) continue;
        RC.Food.drawIngredient(ctx, ix + 4, iy + 1, id, 1);
        if (n > 1) Font.draw(ctx, "" + n, ix + 9, iy, { color: P.text, scale: 1 });
        ix += 16;
      }

      // detection — an eye icon that opens & reddens (no words)
      if (this.detectShown > 0.02) {
        const d = M.sat(this.detectShown), ex = VIEW_W / 2, ey = 12;
        const col = d >= 0.85 ? P.bad : d >= 0.33 ? P.detect : P.vis;
        const w = 8 + d * 6, h = 3 + d * 4;
        ctx.strokeStyle = col; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.ellipse(ex, ey, w, h, 0, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = col; ctx.beginPath(); ctx.arc(ex, ey, 1.5 + d * 1.5, 0, Math.PI * 2); ctx.fill();
        if (d > 0.5) {
          ctx.save(); ctx.globalAlpha = (d - 0.5) * 0.5;
          const g = ctx.createRadialGradient(VIEW_W / 2, VIEW_H / 2, VIEW_H * 0.45, VIEW_W / 2, VIEW_H / 2, VIEW_H * 0.8);
          g.addColorStop(0, "rgba(255,60,80,0)"); g.addColorStop(1, "rgba(255,40,60,0.6)");
          ctx.fillStyle = g; ctx.fillRect(0, 0, VIEW_W, VIEW_H); ctx.restore();
        }
      }

      // hide/dive prompt — a bouncing down-chevron over the spot (no words)
      if (!this.player.hidden) {
        const s = this.spots.find((sp) => sp.near(this.player));
        if (s) {
          const bob = Math.sin(this.time * 6) * 1.5, gx = s.cx - L.camX(), gy = s.topY - L.camY() - 12 + bob;
          ctx.fillStyle = s.hasLoot ? P.gold : "#aeb3dc";
          ctx.beginPath(); ctx.moveTo(gx - 4, gy); ctx.lineTo(gx + 4, gy); ctx.lineTo(gx, gy + 5); ctx.fill();
        }
      }
      // stove cook prompt — a pot icon, steaming when a dish is ready
      if (this.stove && !this.player.hidden && Math.abs(this.player.cx() - this.stove.cx) < 20 && this.player.grounded) {
        const ready = !!this.cookableKid(), gx = this.stove.cx - L.camX(), gy = this.stove.topY - L.camY() - 20;
        ctx.fillStyle = ready ? P.gold : "#5a5f86";
        ctx.fillRect(gx - 5, gy, 10, 5); ctx.fillRect(gx - 6, gy, 12, 1);
        if (ready) { ctx.fillStyle = "rgba(230,236,255,0.6)"; const s2 = Math.sin(this.time * 5); ctx.fillRect(gx - 2 + s2, gy - 4, 1, 3); ctx.fillRect(gx + 1 - s2, gy - 5, 1, 3); }
      }

      // toast (kept for the rare essential beat)
      if (this.msgT > 0) {
        ctx.globalAlpha = M.sat(this.msgT);
        Font.draw(ctx, this.msg, VIEW_W / 2, VIEW_H - 26, { align: "center", color: P.text, scale: 1, shadow: true });
        ctx.globalAlpha = 1;
      }
    },

    // ---- title: the raccoon in the rain, watching a family he can't have -
    _drawTitle(ctx) {
      // a dark building facade on the right with one warm lit window
      const bx = VIEW_W * 0.52, by = 84;
      ctx.fillStyle = "#141126"; ctx.fillRect(bx - 8, 0, VIEW_W, VIEW_H);
      // brick texture hint
      ctx.fillStyle = "#181430";
      for (let yy = 0; yy < VIEW_H; yy += 8) ctx.fillRect(bx - 8, yy, VIEW_W, 1);
      // the window
      const ww = 96, wh = 62, wx = bx + 30, wy = by;
      ctx.fillStyle = "#0a0812"; ctx.fillRect(wx - 4, wy - 4, ww + 8, wh + 8);      // frame outer
      ctx.fillStyle = "#2a2038"; ctx.fillRect(wx - 3, wy - 3, ww + 6, wh + 6);
      S.familyDinner(ctx, wx, wy, ww, wh, this.time);
      // muntin bars + sill
      ctx.fillStyle = "#20182c";
      ctx.fillRect(wx + ww / 2 - 1, wy, 2, wh);
      ctx.fillRect(wx, wy + wh / 2 - 1, ww, 2);
      ctx.fillStyle = "#3a2e4c"; ctx.fillRect(wx - 4, wy + wh, ww + 8, 3);
      // warm light spilling down the wall onto the street
      const spill = ctx.createLinearGradient(0, wy, 0, VIEW_H);
      spill.addColorStop(0, "rgba(255,210,140,0.16)"); spill.addColorStop(1, "rgba(255,190,110,0)");
      ctx.fillStyle = spill; ctx.fillRect(wx - 20, wy, ww + 40, VIEW_H - wy);

      // street + the raccoon dad standing below, looking up longingly
      const groundY = VIEW_H - 26;
      ctx.fillStyle = "#20222f"; ctx.fillRect(0, groundY, VIEW_W, VIEW_H - groundY);
      ctx.fillStyle = "#2c2e40"; ctx.fillRect(0, groundY, VIEW_W, 2);
      const rx = wx + 6;
      S.shadow(ctx, rx, groundY + 2, 22, 0.28);
      this.titleCritter.draw(ctx, rx, groundY, { zoom: 1.5 });
      // a puddle reflection of the window glow
      ctx.globalAlpha = 0.12; ctx.fillStyle = "#ffcf7a";
      ctx.fillRect(rx + 14, groundY + 3, 30, 2); ctx.globalAlpha = 1;

      // title logo (the game's name — the only lasting text)
      const bob = Math.sin(this.time * 1.5) * 1;
      Font.draw(ctx, "BROKE @$$", 20, 24 + bob, { align: "left", color: P.gold, scale: 3, tracking: 2, shadow: true, shadowColor: "rgba(0,0,0,0.8)" });
      Font.draw(ctx, "RACCOON", 20, 54 + bob, { align: "left", color: P.goldHi, scale: 3, tracking: 3, shadow: true, shadowColor: "rgba(0,0,0,0.8)" });
      // pulsing "press / tap" button glyph — no words
      const gy = VIEW_H - 34, pr = 8 + Math.sin(this.time * 4) * 1.5;
      ctx.save(); ctx.globalAlpha = 0.45 + 0.45 * Math.sin(this.time * 4);
      ctx.strokeStyle = "#e6e8f6"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(VIEW_W / 2, gy, pr, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = "#e6e8f6"; ctx.beginPath(); ctx.arc(VIEW_W / 2, gy, 2.5, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      L.drawRain(ctx, 1 / 60);
    },

    // ---- intro --------------------------------------------------------
    // wordless intro — a thought bubble over the den cycles through icon beats
    _drawIntro(ctx) {
      ctx.fillStyle = "rgba(6,6,18,0.4)"; ctx.fillRect(0, 0, VIEW_W, VIEW_H);
      const bx = Math.round(this.player.cx() - L.camX()), by = Math.round(this.player.feetY() - L.camY() - 46);
      // bubble
      ctx.fillStyle = "rgba(238,240,255,0.96)"; ctx.fillRect(bx - 18, by - 16, 36, 26);
      ctx.fillRect(bx - 16, by - 18, 32, 30);
      ctx.beginPath(); ctx.moveTo(bx - 6, by + 8); ctx.lineTo(bx + 4, by + 8); ctx.lineTo(bx - 3, by + 16); ctx.fill();
      const b = this.introI, cx = bx, cy = by - 3;
      ctx.save();
      if (b === 0) {           // hungry kits: empty bowl + a frown
        ctx.strokeStyle = "#3a2a44"; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(cx, cy, 7, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();      // bowl
        ctx.fillStyle = "#c0433c"; ctx.beginPath(); ctx.arc(cx, cy - 2, 2, Math.PI, 0); ctx.fill(); // sad
        ctx.strokeStyle = "#3a2a44"; ctx.beginPath(); ctx.moveTo(cx - 3, cy + 3); ctx.lineTo(cx + 3, cy + 3); ctx.stroke();
      } else if (b === 1) {    // go dig: a green dumpster + up-arrow of food
        ctx.fillStyle = "#3f6b4a"; ctx.fillRect(cx - 7, cy - 1, 14, 8); ctx.fillStyle = "#2c4c36"; ctx.fillRect(cx - 8, cy - 3, 16, 2);
        RC.Food.drawIngredient(ctx, cx, cy - 8, "fish", 1);
        ctx.fillStyle = "#f2d27a"; ctx.beginPath(); ctx.moveTo(cx - 3, cy - 12); ctx.lineTo(cx + 3, cy - 12); ctx.lineTo(cx, cy - 15); ctx.fill();
      } else {                 // cook & love: a pot + a heart
        ctx.fillStyle = "#4a4a55"; ctx.fillRect(cx - 7, cy, 14, 5); ctx.fillStyle = "#6a6a7a"; ctx.fillRect(cx - 8, cy - 1, 16, 1);
        S.heart(ctx, cx - 2, cy - 8, true);
      }
      ctx.restore();
      // advance glyph
      if ((this.time % 1) < 0.6) { ctx.fillStyle = "#3a2a44"; ctx.beginPath(); ctx.arc(bx + 12, by + 6, 1.6, 0, Math.PI * 2); ctx.fill(); }
    },

    _dialogue(ctx, who, text, prompt) {
      const bx = 20, by = VIEW_H - 58, bw = VIEW_W - 40, bh = 42;
      ctx.fillStyle = "rgba(8,8,20,0.9)"; ctx.fillRect(bx, by, bw, bh);
      ctx.fillStyle = "rgba(120,126,180,0.6)"; ctx.fillRect(bx, by, bw, 1); ctx.fillRect(bx, by + bh - 1, bw, 1);
      // speaker portrait
      if (who.indexOf("CEDRIC") === 0) S.hedgehog(ctx, bx + 20, by + bh - 6, { dir: 1, wave: true, animT: this.time });
      else this.portraitCritter.draw(ctx, bx + 20, by + bh - 6, { zoom: 1.25 });
      Font.draw(ctx, who, bx + 40, by + 8, { color: P.gold, scale: 1 });
      // typewriter reveal
      const shown = Math.min(text.length, Math.floor(this.introT * 42));
      Font.draw(ctx, text.slice(0, shown), bx + 40, by + 20, { color: P.text, scale: 1 });
      if ((this.time % 1) < 0.6) Font.draw(ctx, prompt, bx + bw - 8, by + bh - 10, { align: "right", color: P.textDim, scale: 1 });
    },

    _drawPause(ctx) {
      ctx.fillStyle = "rgba(6,6,16,0.72)"; ctx.fillRect(0, 0, VIEW_W, VIEW_H);
      // a big pause glyph (two bars) — no words
      const cx = VIEW_W / 2, cy = VIEW_H / 2;
      ctx.fillStyle = P.text; ctx.fillRect(cx - 10, cy - 14, 6, 28); ctx.fillRect(cx + 4, cy - 14, 6, 28);
    },

    _drawCaught(ctx) {
      const a = M.sat(this.caughtT * 2), cx = VIEW_W / 2, cy = VIEW_H / 2;
      ctx.save(); ctx.globalAlpha = a;
      // a big shattered mask (no words)
      ctx.strokeStyle = P.bad; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(cx, cy, 22, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx - 3, cy - 22); ctx.lineTo(cx + 4, cy - 6); ctx.lineTo(cx - 4, cy + 3); ctx.lineTo(cx + 3, cy + 22); ctx.stroke(); // crack
      // X eyes
      ctx.lineWidth = 1.5;
      for (const s of [-1, 1]) { const ex = cx + s * 8; ctx.beginPath(); ctx.moveTo(ex - 3, cy - 5); ctx.lineTo(ex + 3, cy + 1); ctx.moveTo(ex + 3, cy - 5); ctx.lineTo(ex - 3, cy + 1); ctx.stroke(); }
      ctx.restore();
    },

    _drawWinActors(ctx, cam) {
      // helicopter + Cedric, kids boarding, dad
      const h = this.heli;
      S.helicopter(ctx, h.x - cam.x, h.y - cam.y, { dir: -1, rotor: h.rot });
      // Cedric leaning out the door
      S.hedgehog(ctx, h.x - cam.x - 4, h.y - cam.y + 8, { dir: -1, wave: this.winPhase >= 1, animT: this.time });
      // dad + kids on the pad (until lift-off phase)
      if (this.winPhase < 2) {
        this.player.hidden = false; this.player.dead = false;
        S.shadow(ctx, this.pad.cx - cam.x, this.pad.topY - cam.y + 1, 16, 0.3);
        this.winDad.draw(ctx, this.pad.cx - cam.x, this.pad.topY - cam.y, {});
        for (const k of (this._winKids || [])) k.draw(ctx, cam);
      }
    },

    _drawWin(ctx) {
      if (this.winPhase === 1) {
        this._dialogue(ctx, "CEDRIC THE HEDGEHOG", "Rough night, pop? Load up the kits — breakfast's on me.", "PRESS Z");
      } else if (this.winPhase === 3) {
        ctx.fillStyle = "rgba(6,6,16,0.82)"; ctx.fillRect(0, 0, VIEW_W, VIEW_H);
        Font.draw(ctx, "YOU MADE IT HOME", VIEW_W / 2, 44, { align: "center", color: P.gold, scale: 2, tracking: 2, shadow: true });
        Font.draw(ctx, "THE KITS EAT GOOD TONIGHT.", VIEW_W / 2, 66, { align: "center", color: P.text, scale: 1 });
        const mins = Math.floor(this.runTime / 60), secs = (this.runTime % 60) | 0;
        const rows = [
          ["CASH GRABBED", "$" + this.cash],
          ["FOOD FOR THE KITS", "" + this.food],
          ["TIMES BUSTED", "" + this.deaths],
          ["TIME", (mins + "").padStart(2, "0") + ":" + (secs + "").padStart(2, "0")],
        ];
        for (let i = 0; i < rows.length; i++) {
          const y = 92 + i * 14;
          Font.draw(ctx, rows[i][0], VIEW_W / 2 - 70, y, { color: P.textDim, scale: 1 });
          Font.draw(ctx, rows[i][1], VIEW_W / 2 + 70, y, { align: "right", color: P.goldHi, scale: 1 });
        }
        const grade = this.deaths === 0 ? "MASTER RACCOON" : this.deaths < 3 ? "SLICK TRASH PANDA" : "SCRAPPY SURVIVOR";
        Font.draw(ctx, grade, VIEW_W / 2, 158, { align: "center", color: P.good, scale: 1, tracking: 1 });
        if ((this.time % 1) < 0.6) Font.draw(ctx, "PRESS Z — ANOTHER NIGHT", VIEW_W / 2, VIEW_H - 20, { align: "center", color: P.text, scale: 1 });
      }
    },

    _drawFade(ctx) {
      if (this.fade > 0.001) { ctx.fillStyle = `rgba(3,3,9,${this.fade})`; ctx.fillRect(0, 0, VIEW_W, VIEW_H); }
    },
  };

  RC.Game = Game;
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => Game.init());
  else Game.init();

})(window);
