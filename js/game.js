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
    ["THE ALLEY", "The city never sleeps. Neither do the bills."],
    ["THE ALLEY", "Your wife took the car, the couch, and the good silverware."],
    ["THE ALLEY", "Three hungry kits are counting on you tonight, pop."],
    ["THE PLAN", "Dive the dumpsters. Pocket the cash. Feed the kids."],
    ["THE PLAN", "Slip past the rent-a-cops. Stay in the dark. Use distractions."],
    ["THE PLAN", "At dawn, Cedric brings the chopper. Reach the rooftop pad."],
  ];

  const Game = {
    canvas: null, ctx: null,
    state: "title",
    last: 0, time: 0,
    started: false,
    // entities
    player: null, guards: [], loot: [], throwables: [], spots: [], hints: [], kids: [], pad: null, checkpoints: [],
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
      L.build();
      this._resize();
      global.addEventListener("resize", () => this._resize());
      this._spawnAll();
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
      Pt.reset();
      for (const sp of L.spawns) {
        switch (sp.type) {
          case "player": this.player = new RC.Player(sp.x, sp.y, this); break;
          case "kid": this.kids.push(new RC.Ent.Kid(sp)); break;
          case "hint": this.hints.push(new RC.Ent.Hint(sp)); break;
          case "dumpster": this.spots.push(new RC.Ent.HideSpot({ kind: "dumpster", x: sp.x, y: sp.y, loot: sp.loot, food: Math.ceil((sp.loot || 0) / 2) })); break;
          case "crate": this.spots.push(new RC.Ent.HideSpot({ kind: "crate", x: sp.x, y: sp.y, size: sp.size })); break;
          case "coin": this.loot.push(new RC.Ent.Loot({ type: "coin", x: sp.x, y: sp.y })); break;
          case "food": this.loot.push(new RC.Ent.Loot({ type: "food", x: sp.x, y: sp.y })); break;
          case "can": this.loot.push(new RC.Ent.Loot({ type: "can", x: sp.x, y: sp.y })); break;
          case "pickup": this.pad = new RC.Ent.PickupPad(sp); break;
          case "checkpoint": this.checkpoints.push({ x: sp.x, y: sp.y, taken: false }); break;
        }
      }
      for (const gd of L.guardsDef) this.guards.push(new RC.Ent.Guard(gd));
    },

    // ---- callbacks used by entities -----------------------------------
    addCash(n) { this.cash += n; },
    addFood(n) { this.food += n; },
    makeNoise(x, y, r) { for (const g of this.guards) g.hearNoise(x, y, r); Pt.ring(x, y, "#ffd27a", r); },
    spawnLoot(x, y, type) { this.loot.push(new RC.Ent.Loot({ type, x, y })); },
    spawnThrowable(it) { this.throwables.push(new RC.Ent.Throwable(it)); },
    onSpotted(guard) {
      if (this.state !== "play") return;
      this.state = "caught"; this.caughtT = 0;
      this.player.dead = true;
      this.flash = 1; this.flashColor = "255,70,90";
      this.hitstop = 0.14;
      L.shake(5, 0.5);
      Audio.play("spotted"); Audio.play("caught");
      Audio.setIntensity(1);
    },

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
      if (Input.pressed("mute")) { const on = Audio.toggle(); this._toast(on ? "SOUND ON" : "SOUND OFF"); }
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
        case "win": this._updWin(dt); break;
      }
    },

    _updTitle(dt) {
      L.cam.x = M.damp(L.cam.x, 40 + Math.sin(this.time * 0.2) * 20, 1, dt);
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
      if (Input.pressed("confirm") || Input.pressed("jump")) {
        Audio.play("select");
        this.introI++;
        this.introT = 0;
        if (this.introI >= INTRO_LINES.length) this._beginPlay();
      }
      if (Input.pressed("pause")) this._beginPlay();  // skip
    },

    _beginPlay() {
      this.state = "play";
      this.runStart = this.time;
      this.fade = 1; this.fadeDir = -1;
      Audio.startMusic();
      this._toast("FEED THE KIDS — REACH THE ROOF");
    },

    _updPlay(dt) {
      const pl = this.player;
      pl.update(dt, Input);

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

      // checkpoints
      for (const cp of this.checkpoints) {
        if (!cp.taken && pl.grounded && !pl.hidden && pl.cx() > cp.x - 4 && Math.abs(pl.feetY() - cp.y) < 22) {
          cp.taken = true; this.checkpoint = { x: cp.x, y: cp.y };
          this._toast("CHECKPOINT"); Audio.play("checkpoint");
          Pt.spark(cp.x, cp.y - 16, 14, P.good);
        }
      }

      // reached extraction?
      if (this.pad && this.pad.reached(pl) && !pl.hidden) this._beginWin();

      // camera
      const look = M.clamp(pl.vx / 100, -1, 1);
      L.updateCamera(pl.cx(), pl.cy(), look, dt);
    },

    _respawn() {
      const pl = this.player;
      pl.x = this.checkpoint.x - pl.w / 2; pl.y = this.checkpoint.y - pl.h;
      pl.vx = pl.vy = 0; pl.dead = false; pl.hidden = false; pl.carry = null; pl.stam = RC.PlayerConfig.STAM_MAX;
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

      // hide spots (behind actors), then loot, actors, particles
      for (const s of this.spots) s.draw(ctx, cam);
      if (this.state !== "win") for (const k of this.kids) k.draw(ctx, cam);
      for (const l of this.loot) l.draw(ctx, cam);
      if (this.pad) this.pad.draw(ctx, cam);
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
    _drawHUD(ctx) {
      // top-left stats panel
      ctx.fillStyle = "rgba(10,10,22,0.55)";
      ctx.fillRect(4, 4, 96, 24);
      // cash
      S.loot(ctx, 12, 15, "coin", this.time);
      Font.draw(ctx, "$" + this.cash, 20, 8, { color: P.goldHi, scale: 1 });
      // food
      S.loot(ctx, 50, 15, "food", this.time + 1);
      Font.draw(ctx, "" + this.food, 58, 8, { color: P.food, scale: 1 });
      // kids hearts
      for (let i = 0; i < 3; i++) S.heart(ctx, 10 + i * 8, 18, true);
      Font.draw(ctx, "KITS", 36, 19, { color: P.textDim, scale: 1 });

      // detection meter (top center) when something is watching
      if (this.detectShown > 0.02) {
        const bw = 90, bx = VIEW_W / 2 - bw / 2, by = 8;
        ctx.fillStyle = "rgba(10,10,22,0.6)"; ctx.fillRect(bx - 2, by - 2, bw + 4, 9);
        ctx.fillStyle = "#26243a"; ctx.fillRect(bx, by, bw, 5);
        const d = M.sat(this.detectShown);
        const col = d >= 0.85 ? P.bad : d >= 0.33 ? P.detect : P.vis;
        ctx.fillStyle = col; ctx.fillRect(bx, by, bw * d, 5);
        Font.draw(ctx, d >= 0.85 ? "SPOTTED!" : "DETECTION", VIEW_W / 2, by + 8, { align: "center", color: col, scale: 1 });
        // red edge pulse when high
        if (d > 0.5) {
          ctx.save(); ctx.globalAlpha = (d - 0.5) * 0.8;
          const g = ctx.createRadialGradient(VIEW_W / 2, VIEW_H / 2, VIEW_H * 0.4, VIEW_W / 2, VIEW_H / 2, VIEW_H * 0.75);
          g.addColorStop(0, "rgba(255,60,80,0)"); g.addColorStop(1, "rgba(255,40,60,0.7)");
          ctx.fillStyle = g; ctx.fillRect(0, 0, VIEW_W, VIEW_H); ctx.restore();
        }
      }

      // hide-spot prompt when standing next to a dumpster/crate
      if (!this.player.hidden) {
        const s = this.spots.find((sp) => sp.near(this.player));
        if (s) {
          const bob = Math.sin(this.time * 6) * 1;
          Font.draw(ctx, s.hasLoot ? "v DIVE" : "v HIDE", s.cx - L.camX(), s.topY - L.camY() - 12 + bob, { align: "center", color: P.gold, scale: 1, shadow: true });
        }
      }

      // carry indicator
      if (this.player.carry) Font.draw(ctx, "C: THROW " + this.player.carry.toUpperCase(), VIEW_W - 6, VIEW_H - 12, { align: "right", color: P.text, scale: 1, shadow: true });

      // off-screen exit arrow
      if (this.pad) {
        const dx = this.pad.cx - this.player.cx();
        if (Math.abs(dx) > VIEW_W / 2) {
          const ax = dx > 0 ? VIEW_W - 10 : 10;
          Font.draw(ctx, dx > 0 ? ">" : "<", ax, 40, { align: "center", color: P.gold, scale: 1 });
          Font.draw(ctx, "EXIT", ax, 48, { align: "center", color: P.textDim, scale: 1 });
        }
      }

      // toast
      if (this.msgT > 0) {
        ctx.globalAlpha = M.sat(this.msgT);
        Font.draw(ctx, this.msg, VIEW_W / 2, VIEW_H - 26, { align: "center", color: P.text, scale: 1, shadow: true });
        ctx.globalAlpha = 1;
      }
    },

    // ---- title --------------------------------------------------------
    _drawTitle(ctx) {
      // hero raccoon
      const hx = VIEW_W / 2, hy = VIEW_H * 0.72;
      S.shadow(ctx, hx, hy + 2, 30, 0.3);
      S.raccoon(ctx, hx, hy, { dir: 1, state: "idle", animT: this.time, scale: 2.2, blink: (this.time % 4) < 0.12 });
      // title
      ctx.save();
      const bob = Math.sin(this.time * 1.5) * 1;
      Font.draw(ctx, "BROKE @$$", VIEW_W / 2, 40 + bob, { align: "center", color: P.gold, scale: 3, tracking: 2, shadow: true, shadowColor: "rgba(0,0,0,0.7)" });
      Font.draw(ctx, "RACCOON", VIEW_W / 2, 70 + bob, { align: "center", color: P.goldHi, scale: 3, tracking: 3, shadow: true, shadowColor: "rgba(0,0,0,0.7)" });
      Font.draw(ctx, "A NIGHT-TOWN DUMPSTER HEIST", VIEW_W / 2, 96, { align: "center", color: P.textDim, scale: 1, tracking: 1 });
      ctx.restore();
      // blinking prompt
      if ((this.time % 1) < 0.6) Font.draw(ctx, "PRESS  Z  TO START", VIEW_W / 2, VIEW_H - 40, { align: "center", color: P.text, scale: 1, shadow: true });
      Font.draw(ctx, "MOVE < >   JUMP Z   CLIMB X   THROW C   HIDE v", VIEW_W / 2, VIEW_H - 20, { align: "center", color: P.textDim, scale: 1 });
      // rain
      L.drawRain(ctx, 1 / 60);
    },

    // ---- intro --------------------------------------------------------
    _drawIntro(ctx) {
      // darken scene a touch
      ctx.fillStyle = "rgba(6,6,18,0.35)"; ctx.fillRect(0, 0, VIEW_W, VIEW_H);
      const line = INTRO_LINES[Math.min(this.introI, INTRO_LINES.length - 1)];
      this._dialogue(ctx, line[0], line[1], "PRESS Z");
    },

    _dialogue(ctx, who, text, prompt) {
      const bx = 20, by = VIEW_H - 58, bw = VIEW_W - 40, bh = 42;
      ctx.fillStyle = "rgba(8,8,20,0.9)"; ctx.fillRect(bx, by, bw, bh);
      ctx.fillStyle = "rgba(120,126,180,0.6)"; ctx.fillRect(bx, by, bw, 1); ctx.fillRect(bx, by + bh - 1, bw, 1);
      // little raccoon portrait
      S.raccoon(ctx, bx + 20, by + bh - 6, { dir: 1, state: "idle", animT: this.time, scale: 1.4 });
      Font.draw(ctx, who, bx + 40, by + 8, { color: P.gold, scale: 1 });
      // typewriter reveal
      const shown = Math.min(text.length, Math.floor(this.introT * 42));
      Font.draw(ctx, text.slice(0, shown), bx + 40, by + 20, { color: P.text, scale: 1 });
      if ((this.time % 1) < 0.6) Font.draw(ctx, prompt, bx + bw - 8, by + bh - 10, { align: "right", color: P.textDim, scale: 1 });
    },

    _drawPause(ctx) {
      ctx.fillStyle = "rgba(6,6,16,0.7)"; ctx.fillRect(0, 0, VIEW_W, VIEW_H);
      Font.draw(ctx, "PAUSED", VIEW_W / 2, VIEW_H / 2 - 20, { align: "center", color: P.text, scale: 3, tracking: 2, shadow: true });
      Font.draw(ctx, "ESC: RESUME    M: SOUND " + (Audio.enabled ? "ON" : "OFF"), VIEW_W / 2, VIEW_H / 2 + 12, { align: "center", color: P.textDim, scale: 1 });
      Font.draw(ctx, "$" + this.cash + "   FOOD " + this.food + "   BUSTS " + this.deaths, VIEW_W / 2, VIEW_H / 2 + 26, { align: "center", color: P.textDim, scale: 1 });
    },

    _drawCaught(ctx) {
      const a = M.sat(this.caughtT * 2);
      ctx.globalAlpha = a;
      Font.draw(ctx, "BUSTED!", VIEW_W / 2, VIEW_H / 2 - 8, { align: "center", color: P.bad, scale: 3, tracking: 2, shadow: true });
      Font.draw(ctx, "SLIP BACK INTO THE SHADOWS...", VIEW_W / 2, VIEW_H / 2 + 16, { align: "center", color: P.text, scale: 1 });
      ctx.globalAlpha = 1;
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
        S.shadow(ctx, this.pad.cx - cam.x, this.pad.topY - cam.y + 1, 14, 0.3);
        S.raccoon(ctx, this.pad.cx - cam.x, this.pad.topY - cam.y, { dir: 1, state: "idle", animT: this.time });
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
