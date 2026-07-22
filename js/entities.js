/* =============================================================================
   entities.js — guards (stealth AI), throwables, loot, hide-spots (dumpster
   dive), hint signs, the extraction pad, kids, and the rescue helicopter.
   ========================================================================== */
(function (global) {
  "use strict";
  const RC = global.RC;
  const M = RC.M, T = RC.TILE;
  const L = () => RC.Level, Pt = () => RC.Particles, A = () => RC.Audio, S = () => RC.Sprites;
  const P = RC.PAL;

  function angDiff(a, b) {
    let d = ((a - b + Math.PI) % (Math.PI * 2)) - Math.PI;
    if (d < -Math.PI) d += Math.PI * 2;
    return d;
  }

  const Ent = RC.Ent = {};

  /* ======================================================================
     GUARD
  ====================================================================== */
  const SUSP = 0.33, SPOT_BUBBLE = 0.85;
  function Guard(def) {
    this.homeX = def.x; this.x = def.x; this.y = def.y;   // y = feet on surface
    this.min = def.min; this.max = def.max;
    this.dir = def.dir || 1;
    this.range = def.range || 100;
    this.fov = def.fov || 0.5;
    this.reset();
  }
  Guard.prototype.reset = function () {
    this.x = this.homeX; this.alert = 0; this.grace = 0; this.seeing = false;
    this.state = "patrol"; this.turnT = 0; this.searchT = 0; this.lookT = 0;
    this.animT = 0; this.moving = false; this.lastX = this.homeX; this.lastY = this.y;
  };
  Guard.prototype.eyeX = function () { return this.x + this.dir * 5; };
  Guard.prototype.eyeY = function () { return this.y - 13; };
  Guard.prototype.faceAngle = function () { return Math.atan2(0.14, this.dir); };

  Guard.prototype._los = function (ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay, dist = Math.hypot(dx, dy);
    const steps = Math.ceil(dist / 4);
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (L().rectSolid(ax + dx * t, ay + dy * t, 1, 1)) return false;
    }
    return true;
  };

  Guard.prototype.canSee = function (pl) {
    if (pl.hidden || pl.dead) return 0;
    const ex = this.eyeX(), ey = this.eyeY();
    const px = pl.cx(), py = pl.cy();
    const dx = px - ex, dy = py - ey, dist = Math.hypot(dx, dy);
    const bright = L().brightAt(px, py);
    const R = this.range;                       // cone length == true danger range (fair)
    if (dist < 20 && this._los(ex, ey, px, py)) return 0.85;   // right next to them
    if (dist > R) return 0;
    const d = Math.abs(angDiff(Math.atan2(dy, dx), this.faceAngle()));
    if (d > this.fov) return 0;
    if (!this._los(ex, ey, px, py)) return 0;
    const distF = 1 - dist / R, angF = 1 - d / this.fov;
    return (0.35 + 0.65 * bright) * (0.4 + 0.6 * distF) * (0.5 + 0.5 * angF);
  };

  Guard.prototype.hearNoise = function (x, y, r) {
    const d = Math.hypot(x - this.x, y - this.y);
    if (d > r) return;
    this.lastX = x; this.lastY = y;
    this.alert = Math.max(this.alert, 0.55);
    this.grace = 0.9; this.searchT = 0;
    this.dir = x < this.x ? -1 : 1;
    if (this.state === "patrol") A().play("suspect");
    this.state = "investigate";
  };

  Guard.prototype._walk = function (dir, speed, dt, patrol) {
    const bw = 8, bh = 22;
    const nx = this.x + dir * speed * dt;
    const wall = L().rectSolid(nx - bw / 2, this.y - bh + 1, bw, bh - 3);
    const frontX = nx + dir * (bw / 2 + 1);
    const edge = !L().solidBelow(frontX, this.y + 1);
    if (patrol && (nx < this.min || nx > this.max)) { this.dir = -dir; this.turnT = 0.55; return false; }
    if (wall || edge) { if (patrol) { this.dir = -dir; this.turnT = 0.55; } return false; }
    this.x = nx; return true;
  };

  Guard.prototype.update = function (dt, pl, game) {
    this.animT += dt;
    const prevAlert = this.alert;

    const s = this.canSee(pl);
    if (s > 0) {
      this.alert = M.sat(this.alert + 1.7 * s * dt);
      this.lastX = pl.cx(); this.lastY = pl.feetY(); this.grace = 0.7; this.seeing = true;
      this.dir = pl.cx() < this.x ? -1 : 1;
      if (this.alert >= 1) { game.onSpotted(this); return; }
    } else {
      this.seeing = false;
      if (this.grace > 0) this.grace -= dt; else this.alert = Math.max(0, this.alert - 0.85 * dt);
    }
    if (prevAlert < SUSP && this.alert >= SUSP && s > 0) A().play("suspect");

    this.moving = false;
    if (this.alert >= SUSP) {
      // investigate the last-known / noise position
      this.state = this.alert >= SPOT_BUBBLE ? "alert" : "investigate";
      const speed = this.alert >= SPOT_BUBBLE ? 78 : 52;
      if (this.turnT > 0) { this.turnT -= dt; }
      else if (Math.abs(this.x - this.lastX) > 6) {
        this.dir = this.lastX < this.x ? -1 : 1;
        this.moving = this._walk(this.dir, speed, dt, false);
      } else {
        // reached spot, look around
        this.searchT += dt; this.lookT += dt;
        if (this.lookT > 0.7) { this.lookT = 0; this.dir = -this.dir; }
      }
    } else {
      // normal patrol
      this.state = "patrol";
      if (this.turnT > 0) { this.turnT -= dt; }
      else { this.moving = this._walk(this.dir, 34, dt, true); }
      this.searchT = 0;
    }
  };

  Guard.prototype.drawCone = function (ctx, cam) {
    const ex = this.eyeX() - cam.x, ey = this.eyeY() - cam.y;
    const fa = this.faceAngle();
    const R = this.range;
    const N = 18;
    const col = this.alert >= SPOT_BUBBLE ? [255, 90, 108]
      : this.alert >= SUSP ? [255, 176, 90] : [255, 224, 138];
    const a = 0.10 + this.alert * 0.14;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(ex, ey);
    for (let i = 0; i <= N; i++) {
      const ang = fa - this.fov + (2 * this.fov) * (i / N);
      const dx = Math.cos(ang), dy = Math.sin(ang);
      let dd = R;
      for (let d = 6; d <= R; d += 4) {
        if (L().rectSolid(this.eyeX() + dx * d, this.eyeY() + dy * d, 1, 1)) { dd = d - 4; break; }
      }
      ctx.lineTo(ex + dx * dd, ey + dy * dd);
    }
    ctx.closePath();
    const g = ctx.createRadialGradient(ex, ey, 2, ex, ey, R);
    g.addColorStop(0, `rgba(${col[0]},${col[1]},${col[2]},${a + 0.06})`);
    g.addColorStop(1, `rgba(${col[0]},${col[1]},${col[2]},0)`);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.restore();
  };

  Guard.prototype.draw = function (ctx, cam) {
    const x = Math.round(this.x - cam.x), y = Math.round(this.y - cam.y);
    S().shadow(ctx, x, y + 1, 12, 0.28);
    const st = this.state === "alert" ? "alert" : (this.moving ? "patrol" : "idle");
    S().guard(ctx, x, y, { dir: this.dir, state: st, animT: this.animT });
    // alert bubble
    if (this.alert >= SPOT_BUBBLE) this._bubble(ctx, x, y - 30, "!", P.bad);
    else if (this.alert >= SUSP) this._bubble(ctx, x, y - 30, "?", P.detect);
  };
  Guard.prototype._bubble = function (ctx, x, y, ch, color) {
    const bob = Math.sin(this.animT * 8) * 1;
    ctx.fillStyle = "rgba(10,10,20,0.65)";
    ctx.fillRect(x - 4, y - 1 + bob, 9, 11);
    RC.Font.draw(ctx, ch, x, y + bob, { align: "center", color, scale: 1 });
  };

  /* ======================================================================
     THROWABLE (in-flight distraction object)
  ====================================================================== */
  function Throwable(o) {
    this.type = o.type || "can"; this.x = o.x; this.y = o.y;
    this.vx = o.vx; this.vy = o.vy; this.rot = 0; this.dead = false; this.landed = false;
  }
  Throwable.prototype.update = function (dt, game) {
    this.vy += 900 * dt;
    this.rot += this.vx * dt * 0.4;
    // move with simple collision (5x5 box)
    const w = 5, h = 5;
    this.x += this.vx * dt;
    if (L().rectSolid(this.x - w / 2, this.y - h / 2, w, h)) { this.x -= this.vx * dt; this.vx *= -0.35; this._land(game); }
    this.y += this.vy * dt;
    if (L().rectSolid(this.x - w / 2, this.y - h / 2, w, h)) {
      const st = this.vy > 0 ? -1 : 1;
      let guard = 0;
      while (L().rectSolid(this.x - w / 2, this.y - h / 2, w, h) && guard++ < 40) this.y += st;
      this._land(game);
    }
    Pt().trail(this.x, this.y, "#9aa0bd");
  };
  Throwable.prototype._land = function (game) {
    if (this.landed) return;
    this.landed = true; this.dead = true;
    A().play("thunk");
    Pt().ring(this.x, this.y, P.detect, 74);
    Pt().dust(this.x, this.y, 6, 0);
    L().shake(1.6, 0.14);
    game.makeNoise(this.x, this.y, 78);
    game.spawnLoot(this.x, this.y - 3, "can");   // it can be picked up again
  };
  Throwable.prototype.draw = function (ctx, cam) {
    ctx.save();
    ctx.translate(Math.round(this.x - cam.x), Math.round(this.y - cam.y));
    ctx.rotate(this.rot);
    const p = new (S().Painter)(ctx, 0, 0, 1);
    S().throwableIcon(p, -2, -3, "can");
    ctx.restore();
  };

  /* ======================================================================
     LOOT pickup
  ====================================================================== */
  function Loot(o) { this.type = o.type; this.x = o.x; this.y = o.y; this.dead = false; this.t = RC.rng() * 6; }
  Loot.prototype.update = function (dt, game, pl) {
    this.t += dt;
    if (pl.hidden || pl.dead) return;
    if (M.aabb(this.x - 6, this.y - 10, 12, 12, pl.x, pl.y, pl.w, pl.h)) {
      if (this.type === "coin") { game.addCash(1); Pt().lootPop(this.x, this.y - 8, "+$1", P.goldHi); A().play("loot"); this.dead = true; }
      else if (this.type === "food") { game.addFood(1); Pt().lootPop(this.x, this.y - 8, "+FOOD", P.food); A().play("food"); this.dead = true; }
      else if (this.type === "can") { if (!pl.carry) { pl.carry = "can"; A().play("pickup"); Pt().spark(this.x, this.y - 4, 4, "#cfd6ff"); this.dead = true; } }
    }
  };
  Loot.prototype.draw = function (ctx, cam) {
    S().loot(ctx, Math.round(this.x - cam.x), Math.round(this.y - cam.y), this.type, this.t);
  };

  /* ======================================================================
     HIDE SPOT — dumpster (dive + hide) or crate (hide)
  ====================================================================== */
  function HideSpot(o) {
    this.kind = o.kind;                 // 'dumpster' | 'crate'
    this.cx = o.x; this.baseY = o.y;    // baseY = ground surface (bottom)
    this.loot = o.loot || 0; this.hasLoot = this.loot > 0;
    this.food = o.food || 0;
    this.size = o.size || 16;
    if (this.kind === "dumpster") { this.w = 32; this.hgt = 20; }
    else { this.w = this.size; this.hgt = this.size; }
    this.topY = this.baseY - this.hgt;
    this.active = false; this.animT = 0; this.shake = 0; this.lidOpen = 0.15; this.wobble = 0;
    L().addSolidRect(this.cx - this.w / 2, this.topY, this.w, this.hgt);
  }
  HideSpot.prototype.near = function (pl) {
    // valid whether the raccoon stands beside the spot (feet at base) or on top
    return Math.abs(pl.cx() - this.cx) < this.w / 2 + 10 &&
      pl.feetY() >= this.topY - 5 && pl.feetY() <= this.baseY + 5;
  };
  HideSpot.prototype.interact = function (pl, game) {
    if (this.hasLoot && this.kind === "dumpster") {
      // dive for loot
      let cash = this.loot, food = Math.max(0, this.food || Math.floor(this.loot / 2));
      for (let i = 0; i < cash; i++) game.addCash(1);
      for (let i = 0; i < food; i++) game.addFood(1);
      Pt().lootPop(this.cx, this.topY - 4, "+$" + cash + (food ? "  +" + food + "F" : ""), P.goldHi);
      Pt().spark(this.cx, this.topY - 2, 12, P.gold);
      A().play("loot");
      this.hasLoot = false; this.loot = 0;
    }
    this.active = true; this.wobble = 0.5;
    pl.enterHide({ x: this.cx, y: this.topY });
  };
  HideSpot.prototype.leave = function (pl) { this.active = false; pl.exitHide(); };
  HideSpot.prototype.update = function (dt) {
    this.animT += dt;
    if (this.wobble > 0) this.wobble -= dt;
    this.lidOpen = M.damp(this.lidOpen, this.active ? 0 : (this.hasLoot ? 0.4 : 0.12), 8, dt);
  };
  HideSpot.prototype.draw = function (ctx, cam) {
    const x = Math.round(this.cx - cam.x), y = Math.round(this.baseY - cam.y);
    const sh = this.wobble > 0 ? this.wobble : 0;
    if (this.kind === "dumpster") {
      S().dumpster(ctx, x, y, { lidOpen: this.lidOpen, hasLoot: this.hasLoot, shake: sh });
      if (this.active) { // peeking eyes
        const ex = x - 4, ey = y - this.hgt + 3 + Math.round(Math.sin(this.animT * 3));
        ctx.fillStyle = P.maskLite; ctx.fillRect(ex, ey, 2, 2); ctx.fillRect(ex + 6, ey, 2, 2);
        ctx.fillStyle = P.ink; ctx.fillRect(ex + 1, ey + 1, 1, 1); ctx.fillRect(ex + 7, ey + 1, 1, 1);
      }
    } else {
      const wob = this.active ? Math.round(Math.sin(this.animT * 30) * 1) : 0;
      S().crate(ctx, x + wob, y, { size: this.size });
      if (this.active) {
        const ex = x - 3 + wob, ey = y - this.hgt + 4;
        ctx.fillStyle = P.maskLite; ctx.fillRect(ex, ey, 2, 2); ctx.fillRect(ex + 5, ey, 2, 2);
        ctx.fillStyle = P.ink; ctx.fillRect(ex + 1, ey + 1, 1, 1); ctx.fillRect(ex + 6, ey + 1, 1, 1);
      }
    }
  };

  /* ======================================================================
     HINT sign — floating tutorial text when the player is near
  ====================================================================== */
  function Hint(o) { this.x = o.x; this.y = o.y; this.text = o.text; this.a = 0; }
  Hint.prototype.update = function (dt, pl) {
    const near = Math.abs(pl.cx() - this.x) < 46 && Math.abs(pl.cy() - this.y) < 60 && !pl.hidden;
    this.a = M.damp(this.a, near ? 1 : 0, 10, dt);
  };
  Hint.prototype.draw = function (ctx, cam) {
    if (this.a < 0.02) return;
    const x = Math.round(this.x - cam.x), y = Math.round(this.y - cam.y);
    const w = RC.Font.measure(this.text.toUpperCase(), 1, 1) + 8;
    ctx.globalAlpha = this.a;
    ctx.fillStyle = "rgba(10,10,22,0.8)";
    ctx.fillRect(x - w / 2, y - 6, w, 11);
    ctx.fillStyle = "rgba(120,126,180,0.5)";
    ctx.fillRect(x - w / 2, y - 6, w, 1);
    RC.Font.draw(ctx, this.text, x, y - 4, { align: "center", color: P.text, scale: 1 });
    ctx.globalAlpha = 1;
  };

  /* ======================================================================
     PICKUP PAD — extraction point (helipad)
  ====================================================================== */
  function PickupPad(o) { this.cx = o.x; this.topY = o.y; this.t = 0; }
  PickupPad.prototype.update = function (dt) { this.t += dt; };
  PickupPad.prototype.reached = function (pl) {
    return Math.abs(pl.cx() - this.cx) < 20 && Math.abs(pl.feetY() - this.topY) < 10 && pl.grounded;
  };
  PickupPad.prototype.draw = function (ctx, cam) {
    const x = Math.round(this.cx - cam.x), y = Math.round(this.topY - cam.y);
    // painted pad
    ctx.fillStyle = "#22203a"; ctx.fillRect(x - 18, y - 1, 36, 2);
    ctx.fillStyle = P.gold;
    for (let i = -3; i <= 3; i++) ctx.fillRect(x + i * 5 - 1, y - 1, 3, 1);
    // big H
    RC.Font.draw(ctx, "H", x, y - 12, { align: "center", color: P.gold, scale: 1, shadow: true });
    // pulsing beacon
    const p = 0.5 + 0.5 * Math.sin(this.t * 5);
    ctx.globalAlpha = 0.4 + p * 0.5;
    ctx.fillStyle = P.bad; ctx.fillRect(x - 1, y - 16, 2, 2);
    const g = ctx.createRadialGradient(x, y - 15, 1, x, y - 15, 10 + p * 6);
    g.addColorStop(0, "rgba(255,93,108,0.5)"); g.addColorStop(1, "rgba(255,93,108,0)");
    ctx.fillStyle = g; ctx.fillRect(x - 16, y - 30, 32, 30);
    ctx.globalAlpha = 1;
    // upward arrows
    ctx.globalAlpha = 0.3 + 0.3 * Math.sin(this.t * 3);
    RC.Font.draw(ctx, "^", x, y - 24, { align: "center", color: P.good, scale: 1 });
    ctx.globalAlpha = 1;
  };

  /* ======================================================================
     KID — a little raccoon (motivation + ending)
  ====================================================================== */
  function Kid(o) { this.x = o.x; this.y = o.y; this.dir = o.dir || 1; this.animT = RC.rng() * 3; this.hop = 0; this.wait = RC.rng() * 2; }
  Kid.prototype.update = function (dt) {
    this.animT += dt; this.wait -= dt;
    if (this.wait <= 0) { this.hop = 0.4; this.wait = 1.5 + RC.rng() * 2.5; }
    if (this.hop > 0) this.hop -= dt;
  };
  Kid.prototype.draw = function (ctx, cam) {
    const x = Math.round(this.x - cam.x);
    const yoff = this.hop > 0 ? -Math.sin((0.4 - this.hop) / 0.4 * Math.PI) * 5 : 0;
    const y = Math.round(this.y - cam.y + yoff);
    S().shadow(ctx, x, Math.round(this.y - cam.y + 1), 9, 0.25);
    S().kid(ctx, x, y, { dir: this.dir, state: this.hop > 0 ? "jump" : "idle", animT: this.animT, blink: (this.animT % 4) < 0.12 });
  };

  Ent.Guard = Guard;
  Ent.Throwable = Throwable;
  Ent.Loot = Loot;
  Ent.HideSpot = HideSpot;
  Ent.Hint = Hint;
  Ent.PickupPad = PickupPad;
  Ent.Kid = Kid;

})(window);
