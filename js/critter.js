/* =============================================================================
   critter.js — physics-driven characters with 5 spring-animated body parts
   (head, torso, arms, legs, tail) and expressive cartoony faces.
   Each Player / Guard / Kid owns a persistent Critter; update() advances the
   springs from the owner's motion, draw() renders it. Front-facing cute faces
   (big eyes, tracking pupils, blinks, mouth expressions) on side-on bodies.
   ========================================================================== */
(function (global) {
  "use strict";
  const RC = global.RC, M = RC.M;

  // ---- spring integrators (semi-implicit, dt-clamped for stability) -------
  function sp() { return { x: 0, y: 0, vx: 0, vy: 0 }; }
  function sc() { return { x: 0, v: 0 }; }
  function stepP(s, tx, ty, k, d, dt) {
    const h = dt > 1 / 30 ? 1 / 30 : dt;
    s.vx += ((tx - s.x) * k - s.vx * d) * h; s.vy += ((ty - s.y) * k - s.vy * d) * h;
    s.x += s.vx * h; s.y += s.vy * h;
  }
  function stepS(s, t, k, d, dt) {
    const h = dt > 1 / 30 ? 1 / 30 : dt;
    s.v += ((t - s.x) * k - s.v * d) * h; s.x += s.v * h;
  }

  // ---- per-kind look --------------------------------------------------
  const SKIN = {
    raccoon: {
      out: "#0e1020", dark: "#2b2e4c", fur: "#3a3e66", lite: "#5b6193", belly: "#4a4f7c",
      mask: "#141626", tail1: "#cfd3ee", tail2: "#20233f", tip: "#e6e8fb",
      ear: "#c0687e", eye: "#f7f8ff", pup: "#141726", nose: "#1a1c2a", brow: "#0e1020",
      face: "#e2e4f4", faceShade: "#b3b6d4", scarf: "#c0433c", scarfHi: "#e0655c",
    },
    guard: {
      out: "#231d38", dark: "#3a2f5a", uni: "#54427e", lite: "#7d64b0", skin: "#d8a07a",
      skinD: "#b57e5c", cap: "#2a2246", eye: "#0d0b1f", badge: "#ffe08a", boot: "#181428",
    },
  };

  function Critter(kind, opts) {
    opts = opts || {};
    this.kind = kind;
    this.pal = SKIN[kind] || SKIN.raccoon;
    this.scale = opts.scale || 1;
    this.dir = 1;
    this.t = RC.rng() * 6;
    this.legPhase = 0;
    this.lean = sc(); this.bob = sc(); this.arm = sc(); this.tailAng = sc();
    this.head = sp(); this.earL = sc(); this.earR = sc();
    this.tail = [sp(), sp(), sp(), sp(), sp(), sp()];
    this.blinkT = RC.rng() * 4; this.blink = 0;
    this.look = { x: 0, y: 0 }; this.expr = "neutral";
    this._init = false;
  }

  const REST = -2.4, CURL = 0.29, SEG = 2.9;

  Critter.prototype.update = function (dt, m) {
    m = m || {};
    this.t += dt;
    if (m.dir) this.dir = m.dir < 0 ? -1 : 1;
    const vx = m.vx || 0, vy = m.vy || 0, grounded = m.grounded !== false && m.grounded !== 0;
    const state = m.state || "idle";
    const moving = grounded && Math.abs(vx) > 12;
    // rear-up factor: 0 = on all fours, 1 = up on hind legs (attack/climb/carry)
    if (!this.rear) this.rear = sc();
    this.atkDir = m.atkDir || "side";
    let rearT = (state === "attack" || state === "climb" || state === "wall" || state === "carry" || state === "throw") ? 1
      : (state === "jump" || state === "fall") ? 0.55 : 0;
    stepS(this.rear, rearT, state === "attack" ? 300 : 95, 17, dt);

    // blink clock (unless owner forces it)
    if (m.blink != null) this.blink = m.blink ? 1 : 0;
    else { this.blinkT -= dt; if (this.blinkT < 0) { this.blink = this.blinkT > -0.1 ? 1 : 0; if (this.blinkT < -0.1) this.blinkT = 2 + RC.rng() * 3; } }

    this.expr = m.expr || "neutral";
    const lookT = m.look || { x: this.dir * 0.35, y: 0 };
    this.look.x += (lookT.x - this.look.x) * Math.min(1, dt * 10);
    this.look.y += (lookT.y - this.look.y) * Math.min(1, dt * 10);

    // legs
    this.legPhase += moving ? Math.abs(vx) * dt * 0.075 : (state === "climb" ? dt * 6 : 0);

    // lean into motion / wall
    let leanT = M.clamp(vx * 0.02, -2.6, 2.6);
    if (state === "wall") leanT = -this.dir * 1.4;
    if (state === "crouch") leanT = this.dir * 1.2;
    stepS(this.lean, leanT, 120, 14, dt);

    // body bob (breathing + step bounce)
    let bobT = Math.sin(this.t * 2.3) * 0.35;
    if (moving) bobT = -Math.abs(Math.sin(this.legPhase)) * 1.4;
    if (!grounded) bobT = 0;
    stepS(this.bob, bobT, 170, 12, dt);

    // head lag — forward-low on all fours, up when reared
    const rr = this.rear.x;
    const hTx = M.lerp(6.6, 3.6 + this.lean.x * 0.5, rr) - vx * 0.006 * this.dir + (m.headTilt || 0);
    const hTy = M.lerp(-8.5, -16, rr) + (state === "crouch" ? 3 : 0) + M.clamp(vy * 0.004, -2, 3) + this.bob.x * 0.4;
    if (!this._init) { this.head.x = hTx; this.head.y = hTy; }
    stepP(this.head, hTx, hTy, 220, 22, dt);

    // ears flop from vertical motion
    const earT = M.clamp(-vy * 0.01, -2, 3) + Math.sin(this.t * 3.1) * 0.3;
    stepS(this.earL, earT, 120, 9, dt); stepS(this.earR, earT * 0.9 + 0.3, 120, 9, dt);

    // arm swing (opposes legs; flails in air)
    let armT = 0;
    if (moving) armT = Math.sin(this.legPhase + Math.PI) * 7;
    else if (state === "fall") armT = -14;
    else if (state === "jump") armT = -8;
    stepS(this.arm, armT, 150, 15, dt);

    // tail base angle: idle sway + trail + air droop/flick
    let angT = REST + Math.sin(this.t * 2) * 0.14;
    angT -= M.clamp(vx * this.dir, -150, 150) * 0.0018;   // trails behind forward motion
    if (!grounded) angT += (vy > 0 ? 0.55 : -0.55);
    if (state === "wall") angT += 0.5;
    stepS(this.tailAng, angT, 80, 11, dt);

    // tail chain (each seg springs toward an ideal built off the springy prev)
    let bx = -5 + this.lean.x * 0.3, by = -6 + this.bob.x * 0.5, a = this.tailAng.x;
    for (let i = 0; i < this.tail.length; i++) {
      a += CURL;
      const ix = bx + Math.cos(a) * SEG, iy = by + Math.sin(a) * SEG;
      if (!this._init) { this.tail[i].x = ix; this.tail[i].y = iy; }
      stepP(this.tail[i], ix, iy, 240 - i * 22, 17, dt);
      bx = this.tail[i].x; by = this.tail[i].y;
    }
    this._init = true;
    this.state = state; this.grounded = grounded; this.vx = vx; this.vy = vy;
    this.carry = m.carry; this.throwT = m.throwT == null ? 1 : m.throwT;
  };

  // snap all springs to rest (for freshly-placed cutscene critters)
  Critter.prototype.settle = function (dir, expr, look) {
    this.dir = dir || 1; this.expr = expr || "neutral"; if (look) this.look = look;
    for (let i = 0; i < 30; i++) this.update(1 / 60, { dir: this.dir, grounded: true, state: "idle", expr: this.expr, look: look });
  };

  Critter.prototype.draw = function (ctx, x, yFeet, opts) {
    opts = opts || {};
    ctx.save();
    if (opts.alpha != null) ctx.globalAlpha = opts.alpha;
    ctx.translate(Math.round(x), Math.round(yFeet));
    const s = this.scale * (opts.zoom || 1);
    const sx = (opts.sx || 1) * s, sy = (opts.sy || 1) * s;
    ctx.scale(sx, sy);
    if (opts.rot) ctx.rotate(opts.rot);
    if (this.kind === "guard") this._guard(ctx);
    else this._raccoon(ctx);
    ctx.restore();
  };

  // mirrored + screen-space primitives share one translated context
  Critter.prototype._mk = function (ctx) {
    const dir = this.dir;
    return {
      // mirrored (body/limbs/tail authored facing-right)
      R: (x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(dir > 0 ? x : -x - w, y, w, h); },
      B: (cx, cy, r, c) => { ctx.fillStyle = c; const m = dir > 0 ? cx : -cx; for (let dy = -Math.ceil(r); dy <= Math.ceil(r); dy++) { const w = Math.round(Math.sqrt(Math.max(0, r * r - dy * dy))); if (w >= 0) ctx.fillRect(m - w, cy + dy, 2 * w + 1, 1); } },
      // screen space (symmetric front face); +x is screen-right
      Rs: (x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); },
      Bs: (cx, cy, r, c) => { ctx.fillStyle = c; for (let dy = -Math.ceil(r); dy <= Math.ceil(r); dy++) { const w = Math.round(Math.sqrt(Math.max(0, r * r - dy * dy))); ctx.fillRect(cx - w, cy + dy, 2 * w + 1, 1); } },
      dir,
    };
  };

  // A 4-legged raccoon "vagabond" — inked high-contrast silhouette, pale masked
  // face, flowing ringed cloak-tail, a little red bandana. Rears up to fight/climb.
  Critter.prototype._raccoon = function (ctx) {
    const P = this.pal, g = this._mk(ctx);
    const bob = this.bob.x, r = this.rear ? this.rear.x : 0;
    const moving = this.grounded && Math.abs(this.vx) > 12;
    const lp = this.legPhase;
    const gg = moving ? (1 - r) : 0;
    const sBack = Math.sin(lp * 2) * 3 * gg, sFore = Math.sin(lp * 2 + 2.2) * 3 * gg;
    const lift = moving ? Math.max(0, Math.sin(lp * 2 + 1)) * 2 * gg : 0;

    const pivot = this.dir > 0 ? -5 : 5;
    ctx.save();
    ctx.translate(pivot, 0); ctx.rotate(-this.dir * 1.1 * r); ctx.translate(-pivot, 0);

    // ---- cloak-TAIL (behind): inked, tapering, pale ring-tips ----
    for (let i = this.tail.length - 1; i >= 0; i--) g.B(this.tail[i].x, this.tail[i].y, (3.7 - i * 0.34) + 0.6, P.out);
    for (let i = this.tail.length - 1; i >= 0; i--) {
      const s = this.tail[i], rad = 3.2 - i * 0.32;
      g.B(s.x, s.y, rad, P.tail2);
      if (i % 2 === 1) g.B(s.x, s.y - rad * 0.3, rad * 0.62, P.tail1);   // pale ring band
    }
    const tip = this.tail[this.tail.length - 1]; g.B(tip.x, tip.y, 1.7, P.tip);

    // ---- hind legs (pivot) ----
    this._legQuad(g, P, -6, sBack, 0, true, null);
    this._legQuad(g, P, -3.4, sBack * 0.6, lift * 0.5, true, null);

    // ---- fore legs / paws ----
    const fFootY = M.lerp(0, -8, r), fFootX = M.lerp(5.5, 3.2, r);
    this._legQuad(g, P, fFootX, sFore, fFootY < -1 ? 0 : lift, false, fFootY);
    this._legQuad(g, P, fFootX - 2.2, sFore * 0.6, fFootY < -1 ? 0 : lift * 0.5, false, fFootY);
    if (this.carry) { g.R(fFootX + 1, fFootY - 4, 4, 6, "#546a86"); g.R(fFootX + 1, fFootY - 4, 4, 1, "#cfe0f6"); }

    // ---- torso: strong inked silhouette + rim light ----
    const bX = -5.5, bY = -6 + bob * 0.5, fX = 5.5, fY = -7 + bob * 0.5;
    this._capsule(g, bX, bY, fX, fY, 5.0, P.out);         // thick outline
    this._capsule(g, bX, bY, fX, fY, 4.2, P.dark);        // dark body
    this._capsule(g, bX - 0.5, bY - 2.0, fX - 1, fY - 2.0, 2.3, P.lite);  // top rim light
    this._capsule(g, bX + 0.7, bY + 1.8, fX - 0.7, fY + 1.8, 2.1, P.belly); // pale underside

    // ---- little red bandana at the neck ----
    const nkx = M.lerp(3.5, 1.5, r), nky = M.lerp(-7, -12, r);
    g.R(nkx - 2, nky, 5, 2, P.scarf); g.R(nkx - 2, nky, 5, 1, P.scarfHi);
    g.R(nkx + 2, nky + 1, 2, 3, P.scarf);   // trailing end

    // ---- head + face ----
    this._head(g, P);

    // ---- claw swipe when attacking ----
    if (this.state === "attack") {
      const hx = this.head.x, hy = this.head.y;
      let px = hx + 5, py = hy + 3;
      if (this.atkDir === "up") { px = hx + 1; py = hy - 8; }
      else if (this.atkDir === "down") { px = hx; py = hy + 10; }
      g.B(px, py, 2.2, P.out); g.B(px, py, 1.5, P.lite);
      for (let c = -1; c <= 1; c++) g.R(px + 1 + c, py - 1, 1, 2, "#f2f4ff");   // claws
    }

    ctx.restore();
  };

  Critter.prototype._legQuad = function (g, P, footX, swing, lift, back, footY) {
    const c = back ? P.out : P.dark;
    const fx = footX + swing;
    const fy = (footY == null ? 0 : footY) - lift;
    const hipY = -4.5, y0 = Math.min(hipY, fy), h = Math.abs(fy - hipY) + 1.2;
    g.R(fx - 1.4, y0, 2.8, h, P.out);         // outline
    g.R(fx - 1.0, y0, 2.0, h, c);
    g.R(fx - 1.8, fy - 1, 3.6, 2, P.out);     // paw
    g.R(fx - 1.3, fy - 0.7, 2.6, 1, "#1a1d33");
  };

  Critter.prototype._capsule = function (g, x0, y0, x1, y1, r, c) {
    g.B(x0, y0, r, c); g.B(x1, y1, r, c);
    // connect with a trapezoid of horizontal rects
    const steps = Math.max(1, Math.round(Math.abs(y1 - y0)));
    for (let i = 0; i <= steps; i++) {
      const tt = i / steps, cx = x0 + (x1 - x0) * tt, cy = y0 + (y1 - y0) * tt;
      const rr = r; g.R(cx - rr, cy, rr * 2, 1, c);
    }
  };

  Critter.prototype._leg = function (g, P, footX, lift, back) {
    const c = back ? P.dark : P.fur, y = -lift;
    g.R(footX - 1.5, -5, 3, 5 - lift, c);
    g.R(footX - 2, y - 1, 4, 2, P.out);   // paw
    g.R(footX - 1.5, y - 1, 3, 1, P.mask);
  };

  Critter.prototype._arm = function (g, P, shoulderYRaw, ext, back, carry) {
    const c = back ? P.dark : P.fur;
    const sy = -12, sxp = back ? -3.5 : 3.5;
    const dx = M.clamp(ext, -6, 8);
    if (carry) {
      // reach forward holding an item
      g.R(sxp, sy, 3, 3, c);
      g.R(sxp + 2, sy + 1, 4, 2, c);
      g.R(sxp + 4, sy + 1, 2, 1, P.mask);           // paw
      // the held can/bin
      g.R(sxp + 5, sy - 3, 4, 6, "#526673");
      g.R(sxp + 5, sy - 3, 4, 1, "#cfd6ff");
      g.R(sxp + 6, sy - 2, 1, 4, "#7fa0b0");
    } else {
      g.R(sxp - 1, sy, 3, 3 + Math.max(0, dx * 0.3), c);
      g.R(sxp - 1 + (back ? -dx * 0.2 : dx * 0.2), sy + 3, 3, 2, c);
      g.R(sxp - 1 + (back ? -dx * 0.2 : dx * 0.2), sy + 4, 3, 1, P.mask); // paw
    }
  };

  Critter.prototype._head = function (g, P) {
    const hx = this.head.x, hy = this.head.y;
    const hsx = (this.dir > 0 ? hx : -hx);   // head centre in screen space
    const eyeDX = 2.7, eyeY = hy - 0.4;
    // ---- ears (behind head): inked, dark, pink inner ----
    for (const side of [-1, 1]) {
      const ang = (side < 0 ? this.earL.x : this.earR.x);
      const ex = hsx + side * 4.4, ey = hy - 5.2 + ang * 0.3;
      g.Bs(ex, ey, 2.7, P.out);
      g.Bs(ex, ey - 0.2, 1.9, P.dark);
      g.Bs(ex, ey + 0.6, 0.9, P.ear);
    }
    // ---- head: thick outline, dark crown, top rim light ----
    g.Bs(hsx, hy, 7.4, P.out);
    g.Bs(hsx, hy, 6.6, P.dark);
    g.Bs(hsx, hy - 2.6, 5.2, P.lite);          // rim-lit crown
    // ---- pale face plate (the raccoon's light face) ----
    g.Bs(hsx, hy + 1.6, 5.4, P.out);
    g.Bs(hsx, hy + 1.7, 4.7, P.face);
    g.Bs(hsx, hy + 3.4, 3.4, P.faceShade);     // muzzle shade
    // ---- dark bandit mask across the eyes ----
    g.Rs(hsx - 4.6, eyeY - 1.8, 9.2, 3.6, P.mask);
    g.Bs(hsx - 4.4, eyeY, 1.9, P.mask); g.Bs(hsx + 4.4, eyeY, 1.9, P.mask);
    // ---- big Hollow-Knight eyes on the mask ----
    const open = this.blink ? 0.12 : 1;
    for (const side of [-1, 1]) {
      const ex = hsx + side * eyeDX;
      if (open > 0.5) {
        g.Bs(ex, eyeY, 1.9, P.eye);
        const px = ex + this.look.x * 0.9, py = eyeY + this.look.y * 0.8 + 0.15;
        g.Bs(px, py, 0.95, P.pup);
        g.Rs(Math.round(px), Math.round(py) - 1, 1, 1, "#ffffff");
      } else { g.Rs(Math.round(ex) - 2, Math.round(eyeY), 4, 1, "#0c0d18"); }
    }
    // ---- expression brow + nose + mouth ----
    this._brows(g, P, hsx, eyeY, eyeDX);
    g.Bs(hsx, hy + 3.0, 1.1, P.nose);
    this._mouth(g, P, hsx, hy + 4.8);
  };

  Critter.prototype._brows = function (g, P, hsx, eyeY, dx) {
    const e = this.expr;
    for (const side of [-1, 1]) {
      const x = hsx + side * dx;
      if (e === "sad") g.Rs(x - 1 + side, eyeY - 3, 2, 1, P.brow);           // inner-up
      else if (e === "determined" || e === "scared") g.Rs(x - 1 - side, eyeY - 3, 2, 1, P.brow); // inner-down (angry)
      else g.Rs(x - 1, eyeY - 3.2, 2, 1, P.brow);
    }
  };

  Critter.prototype._mouth = function (g, P, x, y) {
    const e = this.expr, c = "#241019";
    if (e === "happy") { g.Rs(x - 2, y, 4, 1, c); g.Rs(x - 3, y - 1, 1, 1, c); g.Rs(x + 2, y - 1, 1, 1, c); }
    else if (e === "sad") { g.Rs(x - 2, y + 1, 4, 1, c); g.Rs(x - 3, y, 1, 1, c); g.Rs(x + 2, y, 1, 1, c); }
    else if (e === "scared" || e === "open") { g.Bs(x, y + 0.5, 1.6, c); g.Bs(x, y + 0.5, 0.8, "#c04b57"); }
    else if (e === "determined") { g.Rs(x - 2, y, 4, 1, c); }
    else { g.Rs(x - 1, y, 2, 1, c); g.Rs(x - 2, y - 1, 1, 1, c); g.Rs(x + 1, y - 1, 1, 1, c); } // faint smile
  };

  // ------------------------------------------------------------------ GUARD
  Critter.prototype._guard = function (ctx) {
    const P = this.pal, g = this._mk(ctx);
    const bob = this.bob.x, moving = this.grounded && Math.abs(this.vx) > 12;
    const lp = this.legPhase, sw = moving ? Math.sin(lp) : 0, sw2 = moving ? Math.sin(lp + Math.PI) : 0;
    const glove = "#241d38";
    // ---- legs + boots ----
    const bl = -3.6 + sw2 * 2.6, fl = 1.0 + sw * 2.6;
    g.R(bl, -6.5, 3, 7, P.dark); g.R(fl, -6.5, 3, 7, "#463a6e");
    g.R(bl - 1, -1.5, 4, 2, P.boot); g.R(fl - 1, -1.5, 4, 2, P.boot);
    g.R(bl - 1, -1.5, 4, 1, "#2a2340"); g.R(fl - 1, -1.5, 4, 1, "#2a2340");
    // ---- back arm (behind torso) ----
    g.R(-6, -15 + bob, 2.6, 7, P.dark); g.R(-6, -9 + bob, 2.6, 2.4, glove);
    // ---- torso: broad uniform ----
    this._capsule(g, 0, -15.5 + bob, 0, -6, 5.7, P.out);
    this._capsule(g, 0, -15.5 + bob, 0, -6, 5.0, P.uni);
    g.R(3.6, -14.5 + bob, 1.6, 8.5, P.lite);            // front light seam
    g.R(-5.2, -14.5 + bob, 2, 8, P.dark);               // back shade
    g.R(-0.5, -14 + bob, 1, 8, "#3a2f5a");              // zipper
    g.R(-4, -12.5 + bob, 3, 3, "#3a2f5a"); g.R(-4, -12.5 + bob, 3, 1, P.lite); // chest pocket
    // ---- belt + buckle, epaulettes, badge ----
    g.R(-5.2, -7.8, 10.4, 2, P.boot); g.R(-1, -7.8, 2, 2, P.badge);
    g.R(-6, -15.5 + bob, 2.4, 1.6, P.lite); g.R(3.6, -15.5 + bob, 2.4, 1.6, P.lite);
    g.R(2.6, -12.5 + bob, 2, 2, P.badge); g.R(2.6, -12.5 + bob, 1, 1, "#fff2c8");
    // ---- front arm + flashlight ----
    g.R(3.4, -14 + bob, 2.6, 4, P.uni); g.R(5, -12 + bob, 2.6, 5, P.uni);
    g.R(5.6, -7.5 + bob, 2.6, 2.2, glove);
    g.R(6.8, -12.5 + bob, 4.6, 2.6, "#4a5a66"); g.R(6.8, -12.5 + bob, 4.6, 1, "#6a7a86");
    g.R(11, -12.5 + bob, 1.4, 2.6, "#fff2c8");          // lens
    // ---- head + peaked cap + stern face ----
    const hy = -19.5 + bob, hsx = 1.3 * this.dir;
    g.Bs(hsx, hy, 4.4, P.out); g.Bs(hsx, hy, 3.7, P.skin);
    g.Bs(hsx, hy + 1.7, 2.8, P.skinD);
    g.Rs(Math.round(hsx) + (this.dir > 0 ? 2 : -3), hy - 0.5, 1, 1, P.skinD); // nose
    g.Rs(hsx - 4.8, hy - 3.8, 9.6, 2.8, P.cap);
    g.Rs(hsx - 5.6, hy - 1.4, 5.8, 1.2, "#0d0b1f");     // brim
    g.Rs(Math.round(hsx) - 1, hy - 3.4, 2, 1, P.badge); // cap badge
    g.Rs(hsx - 2, hy - 1.7, 4, 1, "#3a2f4a");           // brow
    g.Rs(hsx + (this.dir > 0 ? 0.5 : -1.5), hy - 0.6, 1.6, 1.4, P.eye);
    if (this.expr === "alert") g.Rs(hsx - 1, hy - 6.6, 2, 2, "#ff5d6c");
  };

  RC.Critter = Critter;

})(window);
