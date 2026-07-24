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
      out: "#2a2c40", dark: "#474b66", fur: "#666b88", lite: "#8b90b2", belly: "#c2c6e2",
      mask: "#191b2b", ring: "#3c3f57", tail1: "#7a7f9c", tail2: "#33364c", tip: "#c8cce6",
      ear: "#c58ba0", eye: "#f4f6ff", pup: "#141726", nose: "#3a2030", brow: "#20222f", face: "#cdd0ec",
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

    // head lag
    const hTx = this.lean.x * 0.6 - vx * 0.006 * this.dir + (m.headTilt || 0);
    const hTy = -19 + (m.crouchY || (state === "crouch" ? 3 : 0)) + M.clamp(vy * 0.004, -2, 3) + this.bob.x * 0.4;
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

  Critter.prototype._raccoon = function (ctx) {
    const P = this.pal, g = this._mk(ctx);
    const bob = this.bob.x, lean = this.lean.x;

    // ---------- TAIL (part 5) drawn behind everything ----------
    for (let i = this.tail.length - 1; i >= 0; i--) {
      const s = this.tail[i], r = 3.5 - i * 0.32;
      g.B(s.x, s.y, r + 0.5, P.out);
    }
    for (let i = this.tail.length - 1; i >= 0; i--) {
      const s = this.tail[i], r = 3.0 - i * 0.3;
      g.B(s.x, s.y, r, (i % 2 === 0) ? P.tail1 : P.tail2);
    }
    const tip = this.tail[this.tail.length - 1];
    g.B(tip.x, tip.y, 1.7, P.tail2);   // dark fluffy tip

    // ---------- BACK LEG + BACK ARM ----------
    const lp = this.legPhase, moving = this.grounded && Math.abs(this.vx) > 12;
    const sw = moving ? Math.sin(lp) : 0, sw2 = moving ? Math.sin(lp + Math.PI) : 0;
    this._leg(g, P, -2.4 + sw2 * 3, moving ? Math.max(0, -sw2) * 2 : 0, true);
    this._arm(g, P, this.head.y, -this.arm.x, true, null);

    // ---------- TORSO (part 2) ----------
    const bx = lean * 0.5;
    // outline then fur capsule then belly
    this._capsule(g, bx, -13 + bob, bx * 0.4, -5, 5.4, P.out);
    this._capsule(g, bx, -13 + bob, bx * 0.4, -5, 4.6, P.fur);
    this._capsule(g, bx + 1.2, -12 + bob, bx * 0.4 + 0.6, -5.5, 3.0, P.lite); // front light
    this._capsule(g, bx + 0.4, -11 + bob, bx * 0.4, -5.5, 2.4, P.belly);      // belly

    // ---------- FRONT LEG + FRONT ARM ----------
    this._leg(g, P, 2.2 + sw * 3, moving ? Math.max(0, -sw) * 2 : 0, false);
    this._arm(g, P, this.head.y, this.arm.x, false, this.carry);

    // ---------- HEAD (part 1) + FACE ----------
    this._head(g, P);
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
    // ---- ears (behind head) ----
    for (const side of [-1, 1]) {
      const ang = (side < 0 ? this.earL.x : this.earR.x);
      const ex = hsx + side * 4.2, ey = hy - 4.9 + ang * 0.3;
      g.Bs(ex, ey, 2.5, P.out);
      g.Bs(ex, ey - 0.2, 1.9, P.fur);
      g.Bs(ex, ey + 0.5, 0.95, P.ear);
    }
    // ---- head ball ----
    g.Bs(hsx, hy, 6.8, P.out);
    g.Bs(hsx, hy, 6.1, P.fur);
    // ---- cream face pattern (lower face + thin bridge stripe) ----
    g.Bs(hsx, hy + 2.6, 4.2, P.face);
    g.Rs(Math.round(hsx) - 0.5, hy - 1, 1, 4, P.face);        // thin nose bridge
    // ---- clean bandit mask band across the eyes ----
    g.Rs(hsx - 4.4, eyeY - 1.5, 8.8, 3.2, P.mask);
    g.Bs(hsx - 4.4, eyeY, 1.6, P.mask); g.Bs(hsx + 4.4, eyeY, 1.6, P.mask);  // rounded ends
    // ---- cream brow tufts above the mask ----
    for (const side of [-1, 1]) g.Rs(Math.round(hsx + side * eyeDX) - 1, Math.round(eyeY) - 3, 3, 1, P.face);
    // ---- eyes (big, lots of white, tracking pupil, shine) ----
    const open = this.blink ? 0.15 : 1;
    for (const side of [-1, 1]) {
      const ex = hsx + side * eyeDX;
      if (open > 0.5) {
        g.Bs(ex, eyeY, 1.5, P.eye);                           // white
        const px = ex + this.look.x * 0.8, py = eyeY + this.look.y * 0.7 + 0.1;
        g.Bs(px, py, 0.82, P.pup);                            // pupil
        g.Rs(Math.round(px), Math.round(py) - 1, 1, 1, "#ffffff");   // shine
      } else {
        g.Rs(Math.round(ex) - 2, Math.round(eyeY), 4, 1, P.eye);
      }
    }
    // ---- expression brows + nose + mouth ----
    this._brows(g, P, hsx, eyeY, eyeDX);
    g.Bs(hsx, hy + 2.4, 1.1, P.nose);
    g.Rs(Math.round(hsx), Math.round(hy) + 1, 1, 1, "#6a4a5a");   // nose shine
    this._mouth(g, P, hsx, hy + 4.4);
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
