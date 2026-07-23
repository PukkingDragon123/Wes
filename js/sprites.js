/* =============================================================================
   sprites.js — hand-crafted pixel-art, drawn parametrically on an integer grid.
   A tiny "Painter" snaps everything to whole buffer pixels and mirrors by
   facing direction, so art stays crisp and animation stays cheap.
   ========================================================================== */
(function (global) {
  "use strict";
  const RC = global.RC;
  const P = RC.PAL;

  /* Integer-grid painter. Origin (ox,oy) with local +x right / -y up.
     dir<0 mirrors every rect around local x=0 so we author facing-right only. */
  function Painter(ctx, ox, oy, dir) {
    this.ctx = ctx; this.ox = ox; this.oy = oy; this.dir = dir < 0 ? -1 : 1;
  }
  Painter.prototype.r = function (x, y, w, h, c) {
    if (c == null) return;
    let sx = this.dir > 0 ? this.ox + x : this.ox - x - w;
    this.ctx.fillStyle = c;
    this.ctx.fillRect(Math.round(sx), Math.round(this.oy + y), Math.round(w), Math.round(h));
  };
  Painter.prototype.px = function (x, y, c) { this.r(x, y, 1, 1, c); };
  // shape: rows of [dx, w] starting at (x0, y0), one per array entry going down
  Painter.prototype.rows = function (x0, y0, rows, c) {
    for (let i = 0; i < rows.length; i++) {
      const s = rows[i]; if (!s) continue;
      this.r(x0 + s[0], y0 + i, s[1], 1, c);
    }
  };

  function withXform(ctx, x, y, sx, sy, fn) {
    ctx.save();
    ctx.translate(Math.round(x), Math.round(y));
    if (sx !== 1 || sy !== 1) ctx.scale(sx, sy);
    fn();
    ctx.restore();
  }

  const S = RC.Sprites = {
    Painter,

    // ---- soft ground shadow -------------------------------------------
    shadow(ctx, x, y, w, alpha) {
      ctx.save();
      ctx.globalAlpha = alpha == null ? 0.28 : alpha;
      ctx.fillStyle = "#000";
      const hw = w / 2;
      ctx.beginPath();
      ctx.ellipse(Math.round(x), Math.round(y), hw, Math.max(1.5, hw * 0.32), 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    },

    /* =====================================================================
       RACCOON — the star. Fully parametric poses & cycles.
       o = { dir, state, animT, sx, sy, blink, carry, alpha, tint }
       state: idle run jump fall wall climb crouch throw carry hurt sleep
    ===================================================================== */
    raccoon(ctx, x, yFeet, o) {
      o = o || {};
      const dir = o.dir < 0 ? -1 : 1;
      const t = o.animT || 0;
      const sx = o.sx || 1, sy = o.sy || 1;
      const scale = o.scale || 1;   // 1 = adult, ~0.62 = kid
      if (o.alpha != null) { ctx.save(); ctx.globalAlpha = o.alpha; }

      withXform(ctx, x, yFeet, sx * scale, sy * scale, () => {
        const p = new Painter(ctx, 0, 0, dir);
        this._raccoonBody(p, o.state || "idle", t, o);
      });
      if (o.alpha != null) ctx.restore();
    },

    _raccoonBody(p, state, t, o) {
      const F = P;
      // pose params ------------------------------------------------------
      let lean = 0, bob = 0, legPose = 0, armFront = 0, armBack = 0, headY = 0, tailA = 0;
      const walkPhase = t * 9;
      switch (state) {
        case "run":
          lean = 2; bob = Math.abs(Math.sin(walkPhase)) * -1;
          legPose = Math.sin(walkPhase); armFront = Math.sin(walkPhase) * 2;
          armBack = -armFront; tailA = -2 + Math.sin(walkPhase) * 1; break;
        case "jump":
          lean = 1; bob = -1; legPose = 0.6; armFront = -3; armBack = -2; tailA = -3; break;
        case "fall":
          lean = 0; bob = 0; legPose = -0.5; armFront = -2; armBack = 2; tailA = 2; break;
        case "wall":
          lean = -1; legPose = 0.3; armFront = -3; armBack = 1; tailA = 3; break;
        case "climb":
          legPose = Math.sin(t * 7) * 1.2; armFront = -3 - Math.sin(t * 7) * 1.5;
          armBack = -3 + Math.sin(t * 7) * 1.5; tailA = 1; break;
        case "crouch":
          headY = 3; legPose = 0; lean = 1; tailA = 1; break;
        case "throw":
          lean = 1; armFront = RC.M.lerp(-4, 3, RC.M.sat(o.throwT || 0)); tailA = -1; break;
        case "carry":
          lean = 1; armFront = -4; armBack = -3; tailA = -1; break;
        case "hurt":
          lean = -2; bob = 1; tailA = 3; break;
        case "sleep":
          headY = 4; tailA = 4; break;
        default: // idle
          bob = Math.sin(t * 2.4) * 0.5; tailA = Math.sin(t * 1.7) * 1.5;
      }
      const crouch = state === "crouch";
      const bodyTop = crouch ? -11 : -14;
      const baseY = bob;

      // TAIL (behind) — big ringed tail, sways with tailA -----------------
      this._tail(p, baseY, tailA, state);

      // BACK LEG / FRONT LEG ---------------------------------------------
      this._legs(p, baseY, legPose, crouch, state);

      // BACK ARM ---------------------------------------------------------
      this._arm(p, baseY + bodyTop + 3, armBack, F.fur0, F.furDark, false, null);

      // TORSO ------------------------------------------------------------
      const bx = lean;
      // body silhouette rows (from bodyTop down to legs)
      const bodyRows = crouch
        ? [[-4,8],[-5,10],[-5,10],[-5,10],[-4,9],[-4,8]]
        : [[-3,7],[-4,9],[-5,10],[-5,10],[-5,10],[-5,10],[-4,9],[-4,8]];
      p.rows(bx, baseY + bodyTop, bodyRows, F.fur0);
      // shading down the back + belly highlight
      for (let i = 0; i < bodyRows.length; i++) {
        const rr = bodyRows[i];
        p.r(bx + rr[0], baseY + bodyTop + i, 2, 1, F.furDark);           // back shade
        p.r(bx + rr[0] + rr[1] - 3, baseY + bodyTop + i, 2, 1, F.fur1);  // front light
      }
      // belly patch
      const bellyTop = baseY + bodyTop + (crouch ? 2 : 3);
      p.rows(bx - 1, bellyTop, [[0,5],[-1,6],[-1,6],[0,5]], F.fur2);

      // FRONT ARM (or carrying/throwing) ---------------------------------
      const shoulderY = baseY + bodyTop + 3;
      if (o.carry && (state === "carry" || state === "throw")) {
        this._arm(p, shoulderY, armFront, F.fur1, F.fur0, true, o.carry);
      } else {
        this._arm(p, shoulderY, armFront, F.fur1, F.fur0, true, null);
      }

      // HEAD + FACE ------------------------------------------------------
      this._head(p, bx, baseY + bodyTop - 6 + headY, o, state, t);
    },

    _tail(p, baseY, ang, state) {
      const F = P;
      // tail curls back-and-up; ang shifts the tip. Rings alternate.
      const segs = [
        { x: -6, y: -3, w: 4, h: 4 },
        { x: -8, y: -5, w: 4, h: 4 },
        { x: -9, y: -8 + Math.round(ang * -0.4), w: 4, h: 4 },
        { x: -9, y: -11 + Math.round(ang * -0.7), w: 5, h: 4 },
        { x: -8, y: -14 + Math.round(ang * -1), w: 5, h: 4 },
      ];
      for (let i = 0; i < segs.length; i++) {
        const s = segs[i];
        p.r(s.x, baseY + s.y, s.w, s.h, (i % 2 === 0) ? F.fur0 : F.furDark);
      }
      // light tip
      const tip = segs[segs.length - 1];
      p.r(tip.x, baseY + tip.y - 1, 4, 2, F.fur2);
    },

    _legs(p, baseY, pose, crouch, state) {
      const F = P;
      const legH = crouch ? 2 : 4;
      const top = baseY - legH;
      let backX, frontX;
      if (state === "run") {
        backX = -3 - Math.round(pose * 2);
        frontX = 1 + Math.round(pose * 2);
      } else if (state === "jump") { backX = -3; frontX = 2; }
      else if (state === "fall")  { backX = -4; frontX = 3; }
      else { backX = -3; frontX = 1; }
      // back leg (darker)
      p.r(backX, top, 3, legH, F.furDark);
      p.r(backX, baseY - 1, 4, 1, F.mask);       // foot
      // front leg
      p.r(frontX, top, 3, legH, F.fur0);
      p.r(frontX, baseY - 1, 4, 1, F.mask);      // foot
    },

    _arm(p, shoulderY, ext, cMain, cShade, front, carry) {
      const F = P;
      // ext > 0 reaches forward/up, < 0 back. Simple 3px arm + paw.
      const dx = Math.round(ext);
      const ax = front ? 3 : -5;
      const reach = front ? dx : -Math.abs(dx);
      p.r(ax, shoulderY, 3, 4, cMain);
      p.r(ax + Math.sign(reach || 1) * 1 + reach, shoulderY + 2, 3, 3, cMain);
      p.r(ax + Math.sign(reach || 1) * 1 + reach, shoulderY + 4, 3, 1, F.mask); // paw
      if (carry) {
        // held item sits in the paw
        S.throwableIcon(p, ax + reach + 1, shoulderY - 1, carry);
      }
    },

    _head(p, bx, headTop, o, state, t) {
      const F = P;
      const hx = bx + 1;
      // head silhouette
      const headRows = [[-4,8],[-5,10],[-5,11],[-5,11],[-5,11],[-4,10],[-3,8]];
      p.rows(hx - 1, headTop, headRows, F.fur1);
      // top light
      p.r(hx - 1, headTop, 8, 1, F.fur2);
      // ears
      p.r(hx - 4, headTop - 2, 3, 3, F.fur0); p.r(hx - 4, headTop - 2, 3, 1, F.furDark);
      p.r(hx + 4, headTop - 2, 3, 3, F.fur0); p.r(hx + 4, headTop - 1, 3, 1, F.fur2);
      p.r(hx - 3, headTop - 1, 1, 1, F.mask); p.r(hx + 5, headTop - 1, 1, 1, F.mask);

      // muzzle (light) lower front
      p.rows(hx + 1, headTop + 3, [[0,5],[0,6],[-1,6]], F.fur2);
      // dark bandit mask across the eyes
      p.r(hx - 4, headTop + 2, 10, 3, F.mask);
      p.r(hx - 4, headTop + 2, 10, 1, F.furDark);
      // eyes (blink shrinks them)
      const blink = o.blink ? 1 : 0;
      if (!blink) {
        p.r(hx - 2, headTop + 3, 2, 2, F.maskLite);
        p.r(hx + 3, headTop + 3, 2, 2, F.maskLite);
        p.r(hx - 1, headTop + 4, 1, 1, F.ink);   // pupils look forward
        p.r(hx + 4, headTop + 4, 1, 1, F.ink);
      } else {
        p.r(hx - 2, headTop + 4, 2, 1, F.ink);
        p.r(hx + 3, headTop + 4, 2, 1, F.ink);
      }
      // brow accents above mask
      p.r(hx - 3, headTop + 1, 2, 1, F.fur2);
      p.r(hx + 4, headTop + 1, 2, 1, F.fur2);
      // nose
      p.r(hx + 4, headTop + 5, 2, 2, F.nose);
      p.r(hx + 4, headTop + 5, 1, 1, F.fur2);
    },

    // A miniature raccoon for the three kids
    kid(ctx, x, yFeet, o) {
      o = Object.assign({ scale: 0.6 }, o || {});
      this.raccoon(ctx, x, yFeet, o);
    },

    /* =====================================================================
       GUARD — security patrol. Holds a flashlight (cone origin).
       o = { dir, state, animT, alert }  state: patrol idle alert look
    ===================================================================== */
    guard(ctx, x, yFeet, o) {
      o = o || {};
      const dir = o.dir < 0 ? -1 : 1;
      const t = o.animT || 0;
      withXform(ctx, x, yFeet, 1, 1, () => {
        const p = new Painter(ctx, 0, 0, dir);
        const F = P;
        const moving = o.state === "patrol" || o.state === "alert";
        const speed = o.state === "alert" ? 15 : 8;
        const ph = t * speed;
        const legS = moving ? Math.sin(ph) : 0;
        const bob = moving ? Math.abs(Math.cos(ph)) * -1 : 0;
        const y = bob;
        // legs
        p.r(-3 - Math.round(legS * 2), y - 5, 3, 5, F.guard0);
        p.r(1 + Math.round(legS * 2), y - 5, 3, 5, F.guard0);
        p.r(-4 - Math.round(legS * 2), y - 1, 4, 1, F.ink);
        p.r(1 + Math.round(legS * 2), y - 1, 4, 1, F.ink);
        // torso (uniform)
        p.rows(-4, y - 14, [[0,8],[-1,9],[-1,9],[-1,9],[0,8],[0,8],[0,7],[1,6]], F.guard1);
        p.r(-1, y - 13, 2, 8, F.guard0);            // jacket seam shade
        p.r(4, y - 13, 1, 8, F.guardHi);            // front light
        // belt + badge
        p.r(-4, y - 7, 9, 1, F.ink);
        p.r(3, y - 12, 2, 2, F.vis);                // shiny badge
        // arm holding flashlight forward
        p.r(3, y - 12, 3, 3, F.guard1);
        p.r(5, y - 11, 4, 2, F.metal1);             // flashlight body
        p.r(9, y - 11, 1, 2, F.lampCore);           // lens
        // head + cap
        p.rows(-3, y - 20, [[0,6],[-1,7],[-1,7],[-1,7]], F.guardHi);
        p.r(-4, y - 21, 9, 2, F.guard0);            // cap
        p.r(-4, y - 20, 3, 1, F.ink);               // cap brim (front)
        // eyes
        p.r(1, y - 18, 2, 1, F.ink);
        if (o.state === "alert") { p.r(0, y - 22, 1, 2, F.bad); } // little alert tick
      });
    },

    /* =====================================================================
       CEDRIC the hedgehog — friendly pilot. Round, spiky, goggles, scarf.
    ===================================================================== */
    hedgehog(ctx, x, yFeet, o) {
      o = o || {};
      const dir = o.dir < 0 ? -1 : 1;
      const t = o.animT || 0;
      withXform(ctx, x, yFeet, 1, 1, () => {
        const p = new Painter(ctx, 0, 0, dir);
        const F = P;
        const wave = o.wave ? Math.sin(t * 8) * 3 : 0;
        // spiky back
        for (let i = 0; i < 7; i++) {
          const sx = -6 + i * 2;
          p.r(sx, -13 - (i % 2), 2, 4, "#6a5330");
          p.r(sx, -13 - (i % 2), 2, 2, "#8a6d42");
        }
        // body (round, warm brown)
        p.rows(-5, -12, [[0,10],[-1,11],[-1,11],[-1,11],[0,10],[0,9]], "#b98b52");
        p.rows(-2, -8, [[0,5],[0,5]], "#e2c184"); // belly
        // feet
        p.r(-4, -2, 3, 2, "#5a4326"); p.r(1, -2, 3, 2, "#5a4326");
        // head area (front)
        p.r(2, -12, 5, 6, "#c99a5f");
        // snout + nose
        p.r(6, -9, 2, 2, "#e2c184"); p.r(7, -8, 1, 1, F.nose);
        // goggles on forehead
        p.r(2, -13, 6, 2, "#3b4a55");
        p.r(3, -12, 2, 1, F.lampCore); p.r(5, -12, 2, 1, F.lampCore);
        // eye
        p.r(4, -10, 1, 1, F.ink);
        // red scarf
        p.r(0, -7, 5, 2, F.bad);
        p.r(-1, -6, 2, 3, F.bad);
        // waving arm
        p.r(5, -8 + Math.round(-wave), 3, 2, "#b98b52");
      });
    },

    /* =====================================================================
       HELICOPTER — Cedric's rescue chopper. rotorAngle animates blades.
    ===================================================================== */
    helicopter(ctx, x, y, o) {
      o = o || {};
      const dir = o.dir < 0 ? -1 : 1;
      const ra = o.rotor || 0;
      withXform(ctx, x, y, 1, 1, () => {
        const p = new Painter(ctx, 0, 0, dir);
        const F = P;
        // tail boom
        p.r(-30, -4, 22, 4, "#3a3550");
        p.r(-30, -4, 22, 1, "#4a4568");
        // tail fin + rotor
        p.r(-32, -8, 4, 8, "#2e2a44");
        // body
        p.rows(-10, -14, [[2,14],[0,18],[-1,20],[-1,20],[-1,20],[0,18],[2,14]], "#4a4568");
        p.r(-9, -13, 18, 1, "#6a6494");         // top light
        p.r(-9, -2, 18, 1, "#2a2740");          // bottom shade
        // cockpit glass
        p.rows(2, -12, [[0,7],[0,8],[-1,8],[-1,7]], "#8fd6ff");
        p.r(3, -12, 4, 1, "#d8f3ff");           // glass glint
        // door window
        p.r(-6, -11, 5, 5, "#2a3a5a");
        p.r(-6, -11, 5, 1, "#4a5a7a");
        // skids
        p.r(-9, 0, 18, 1, "#2a2740");
        p.r(-7, -1, 1, 2, "#2a2740"); p.r(6, -1, 1, 2, "#2a2740");
        // main rotor mast + spinning blades
        p.r(-1, -17, 2, 3, "#2a2740");
        const c = Math.cos(ra), s = Math.sin(ra);
        ctx.save();
        ctx.globalAlpha = 0.5;
        ctx.strokeStyle = "#cfd6ff"; ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(Math.round(-26 * c), Math.round(-16 - 6 * s * 0.15));
        ctx.lineTo(Math.round(26 * c), Math.round(-16 + 6 * s * 0.15));
        ctx.stroke();
        ctx.restore();
        // hub
        p.r(-2, -18, 4, 2, "#1f1c30");
      });
    },

    /* =====================================================================
       DUMPSTER — dive for loot, hide inside. lidOpen 0..1, shake for wobble.
    ===================================================================== */
    dumpster(ctx, x, yBottom, o) {
      o = o || {};
      const shake = o.shake ? Math.round(Math.sin(o.shake * 40) * 1) : 0;
      withXform(ctx, x + shake, yBottom, 1, 1, () => {
        const p = new Painter(ctx, 0, 0, 1);
        const F = P;
        const w = 34, h = 20;
        const x0 = -w / 2;
        // wheels
        p.r(x0 + 3, -2, 3, 2, F.ink); p.r(x0 + w - 6, -2, 3, 2, F.ink);
        // body (slightly trapezoid)
        p.rows(x0, -h, [
          [1,w-2],[0,w],[0,w],[0,w],[0,w],[0,w],[0,w],[0,w],
          [0,w],[0,w],[0,w],[0,w],[0,w],[0,w],[0,w],[1,w-2],[2,w-4],[3,w-6]
        ], "#3f6b4a");
        // panel shading
        p.r(x0 + 1, -h + 2, w - 2, 1, "#5a8c66");
        p.r(x0 + 1, -3, w - 2, 2, "#2c4c36");
        for (let i = 1; i < 4; i++) p.r(x0 + i * (w / 4), -h + 3, 1, h - 5, "#345c40");
        // grime + rust
        p.r(x0 + 4, -8, 3, 4, "#2c4c36");
        p.r(x0 + w - 8, -12, 2, 6, F.rust);
        // lid
        const lidLift = Math.round((o.lidOpen || 0) * 8);
        p.r(x0 - 1, -h - 2 - lidLift, w + 2, 3, "#2c4c36");
        p.r(x0 - 1, -h - 2 - lidLift, w + 2, 1, "#5a8c66");
        // when open, dark interior + a loot glint
        if ((o.lidOpen || 0) > 0.4) {
          p.r(x0 + 2, -h + 1, w - 4, 3, "#101d16");
          if (o.hasLoot) { p.r(x0 + 8, -h + 1, 2, 2, F.gold); p.r(x0 + 20, -h + 2, 2, 1, F.food); }
        }
      });
    },

    // wooden crate — hide spot / platform
    crate(ctx, x, yBottom, o) {
      o = o || {};
      withXform(ctx, x, yBottom, 1, 1, () => {
        const p = new Painter(ctx, 0, 0, 1);
        const s = o.size || 16, h = s, x0 = -s / 2;
        p.r(x0, -h, s, h, "#6b4e2e");
        p.r(x0, -h, s, 1, "#8a6a44");
        p.r(x0, -1, s, 1, "#4a341c");
        p.r(x0, -h, 1, h, "#8a6a44"); p.r(x0 + s - 1, -h, 1, h, "#4a341c");
        // planks + X brace
        p.r(x0, -h + Math.round(h / 3), s, 1, "#4a341c");
        p.r(x0, -h + Math.round(2 * h / 3), s, 1, "#4a341c");
        for (let i = 0; i < s; i++) {
          p.px(x0 + i, -h + Math.round(i * h / s), "#8a6a44");
          p.px(x0 + s - 1 - i, -h + Math.round(i * h / s), "#8a6a44");
        }
        if (o.shake) { /* wobble handled by caller offset */ }
      });
    },

    // streetlight pole (glow is drawn by the level lighting pass)
    streetlight(ctx, x, yBottom, o) {
      o = o || {};
      const h = o.h || 46;
      withXform(ctx, x, yBottom, 1, 1, () => {
        const p = new Painter(ctx, 0, 0, o.dir || 1);
        const F = P;
        p.r(-1, -h, 2, h, "#23202f");
        p.r(-1, -h, 1, h, "#33303f");
        p.r(0, -h, 10, 2, "#23202f");            // arm
        p.r(8, -h, 4, 3, "#2a2735");             // lamp housing
        p.r(9, -h + 2, 2, 2, F.lampCore);        // bulb
        p.r(-3, -1, 6, 1, "#1b1826");            // base
      });
    },

    // small loot / throwable icons used both in world and in paws --------
    throwableIcon(p, x, y, type) {
      const F = P;
      if (type === "can") {
        p.r(x, y, 4, 5, F.metal1); p.r(x, y, 4, 1, "#cfd6ff"); p.r(x, y + 4, 4, 1, F.metal0);
        p.r(x + 1, y + 1, 1, 3, "#7fa0b0");
      } else if (type === "bottle") {
        p.r(x + 1, y - 1, 2, 2, F.food); p.r(x, y + 1, 4, 4, "#3a6b4a"); p.r(x + 1, y + 1, 1, 3, F.good);
      } else if (type === "bin") {
        p.r(x, y, 6, 6, F.metal0); p.r(x - 1, y - 1, 8, 2, F.metal1); p.r(x + 1, y + 1, 1, 4, F.metal1);
      } else { // generic trash lump
        p.r(x, y, 4, 4, F.metal1);
      }
    },

    // world pickups (loot). type: coin food can bottle
    loot(ctx, x, y, type, t) {
      const F = P;
      const bobF = Math.sin((t || 0) * 3 + x) * 1.5;
      withXform(ctx, x, y + bobF, 1, 1, () => {
        const p = new Painter(ctx, 0, 0, 1);
        if (type === "coin") {
          const w = 4 + Math.round(Math.abs(Math.cos((t || 0) * 4)) * 2); // spin
          p.r(-w / 2, -6, w, 6, F.gold);
          p.r(-w / 2, -6, w, 1, F.goldHi);
          p.r(-1, -5, 1, 4, F.goldHi);
        } else if (type === "food") {
          p.r(-3, -5, 6, 4, F.food); p.r(-3, -5, 6, 1, "#b6f28a");
          p.r(-4, -3, 1, 1, "#e2c184"); p.r(3, -4, 1, 1, "#e2c184"); // little bits
          p.r(-1, -4, 1, 1, "#3a6b2a");
        } else {
          S.throwableIcon(p, -3, -6, type === "bin" ? "bin" : "can");
        }
      });
      // sparkle
      if (((t || 0) * 2 + x) % 3 < 0.06) { /* handled by particles usually */ }
    },

    // crisp pixel disc
    _disc(ctx, cx, cy, r, color) {
      ctx.fillStyle = color;
      for (let dy = -Math.ceil(r); dy <= Math.ceil(r); dy++) {
        const w = Math.round(Math.sqrt(Math.max(0, r * r - dy * dy)));
        ctx.fillRect(Math.round(cx - w), Math.round(cy + dy), 2 * w + 1, 1);
      }
    },

    // a single cartoony seated human (upper body behind a table)
    _diner(ctx, cx, baseY, o) {
      const w = o.big ? 8 : 6, hr = o.big ? 3.6 : 2.9;
      const raise = (Math.sin(o.t * 2.2 + o.ph) > 0.55) ? -2 : 0;
      // torso
      ctx.fillStyle = o.shirt; ctx.fillRect(Math.round(cx - w / 2), baseY - 7, w, 7);
      ctx.fillStyle = "rgba(255,255,255,0.14)"; ctx.fillRect(Math.round(cx - w / 2), baseY - 7, w, 1);
      // arms (one lifts a forkful to the mouth)
      ctx.fillStyle = o.skin;
      ctx.fillRect(Math.round(cx - w / 2 - 1), baseY - 6, 2, 4);
      ctx.fillRect(Math.round(cx + w / 2 - 1), baseY - 6 + raise, 2, 4 - raise);
      // head
      const hy = baseY - 8 - hr;
      this._disc(ctx, cx, hy, hr, o.skin);
      // hair
      ctx.fillStyle = o.hair;
      ctx.fillRect(Math.round(cx - hr - 0.5), Math.round(hy - hr), Math.round(hr * 2 + 1), Math.round(hr));
      if (o.big) ctx.fillRect(Math.round(cx - hr - 0.5), Math.round(hy - hr), 1, Math.round(hr + 1));
      // happy face
      ctx.fillStyle = "#2a1710";
      ctx.fillRect(Math.round(cx - 1.6), Math.round(hy - 0.2), 1, 1);
      ctx.fillRect(Math.round(cx + 0.9), Math.round(hy - 0.2), 1, 1);
      ctx.fillRect(Math.round(cx - 1), Math.round(hy + 1.4), 2, 1);   // smile
      ctx.fillRect(Math.round(cx - 2), Math.round(hy + 1), 1, 1);
      ctx.fillRect(Math.round(cx + 1), Math.round(hy + 1), 1, 1);
    },

    // the whole warm family-dinner tableau, drawn inside a window rect
    familyDinner(ctx, x, y, w, h, t) {
      ctx.save();
      ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
      // warm back wall
      const gr = ctx.createLinearGradient(0, y, 0, y + h);
      gr.addColorStop(0, "#6a4a30"); gr.addColorStop(1, "#3a2818");
      ctx.fillStyle = gr; ctx.fillRect(x, y, w, h);
      // framed picture on the wall
      ctx.fillStyle = "#7a5638"; ctx.fillRect(x + 8, y + 8, 10, 8);
      ctx.fillStyle = "#9fd0e0"; ctx.fillRect(x + 9, y + 9, 8, 6);
      // pendant lamp + warm pool
      const lx = Math.round(x + w / 2), ly = y + 7;
      ctx.strokeStyle = "#2a1e12"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(lx + 0.5, y); ctx.lineTo(lx + 0.5, ly); ctx.stroke();
      const lg = ctx.createRadialGradient(lx, ly + 5, 2, lx, ly + 5, w * 0.62);
      lg.addColorStop(0, "rgba(255,224,150,0.6)"); lg.addColorStop(1, "rgba(255,205,120,0)");
      ctx.fillStyle = lg; ctx.fillRect(x, y, w, h);
      ctx.fillStyle = "#3a2a18"; ctx.fillRect(lx - 3, ly - 1, 6, 2);
      ctx.fillStyle = "#ffe6a0"; ctx.fillRect(lx - 2, ly + 1, 4, 3);
      ctx.fillStyle = "#fff6d0"; ctx.fillRect(lx - 1, ly + 2, 2, 2);
      // table
      const ty = y + h - 9;
      ctx.fillStyle = "#4a3120"; ctx.fillRect(x + 5, ty, w - 10, 9);
      ctx.fillStyle = "#5e4028"; ctx.fillRect(x + 5, ty, w - 10, 1);
      // seated family
      const sY = ty + 3;
      this._diner(ctx, x + w * 0.30, sY, { skin: "#d99a72", shirt: "#9a4a4a", hair: "#33241a", big: true, t, ph: 0.0 });
      this._diner(ctx, x + w * 0.70, sY, { skin: "#f0c19c", shirt: "#4a6f95", hair: "#7a4e28", big: true, t, ph: 1.4 });
      this._diner(ctx, x + w * 0.46, sY + 2, { skin: "#e7b189", shirt: "#6f9a4a", hair: "#241a12", big: false, t, ph: 2.2 });
      this._diner(ctx, x + w * 0.60, sY + 2, { skin: "#f2c8a4", shirt: "#b98a3a", hair: "#4a2e18", big: false, t, ph: 0.8 });
      // plates + steam
      ctx.fillStyle = "#e6e0ce";
      [0.34, 0.66, 0.5].forEach((f) => ctx.fillRect(Math.round(x + w * f - 3), ty - 1, 6, 1));
      ctx.fillStyle = "rgba(255,240,210,0.35)";
      const s1 = Math.sin(t * 3) * 1;
      ctx.fillRect(Math.round(x + w * 0.5 + s1), ty - 4, 1, 2);
      ctx.fillRect(Math.round(x + w * 0.34 - s1), ty - 3, 1, 2);
      ctx.restore();
    },

    // a small heart/kid icon for HUD
    heart(ctx, x, y, full) {
      const p = new Painter(ctx, x, y, 1);
      const c = full ? P.bad : "#3a2a3a";
      p.rows(0, 0, [[1,2],[0,4],[0,4],[1,2],[2,0]], c);
      p.r(0, 0, 1, 1, c); p.r(3, 0, 1, 1, c);
      if (full) { p.px(1, 1, "#ff9aa5"); }
    },
  };

})(window);
