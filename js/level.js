/* =============================================================================
   level.js — world grid + collision, camera, parallax night-city background,
   deterministic tile decoration, streetlight lighting, rain, and the full
   multi-zone level layout for "Broke @$$ Raccoon".
   ========================================================================== */
(function (global) {
  "use strict";
  const RC = global.RC;
  const P = RC.PAL;
  const M = RC.M;
  const T = RC.TILE;

  const AIR = 0, SOLID = 1, ONEWAY = 2;

  const Level = RC.Level = {
    W: 160, H: 28,
    AIR, SOLID, ONEWAY,
    solidGrid: null, tiles: null,
    solidRects: [],   // extra solid AABBs from props (crates, dumpsters)
    spawns: [], guardsDef: [], lights: [],
    spawn: { x: 100, y: 360 },
    worldW: 0, worldH: 0,
    groundTop: 24,
    _bgGrad: null, _skyline: null,
    cam: { x: 0, y: 0, shakeT: 0, shakeAmt: 0, ox: 0, oy: 0, _lx: 0, _ly: 0 },

    idx(tx, ty) { return ty * this.W + tx; },

    // -------------------------------------------------------------------
    // Collision queries
    // -------------------------------------------------------------------
    solid(tx, ty) {
      if (ty < 0) return false;         // open sky
      if (ty >= this.H) return true;    // solid floor safety
      if (tx < 0 || tx >= this.W) return true; // boundary walls
      return this.tiles[this.idx(tx, ty)] === SOLID;
    },
    oneway(tx, ty) {
      if (tx < 0 || tx >= this.W || ty < 0 || ty >= this.H) return false;
      return this.tiles[this.idx(tx, ty)] === ONEWAY;
    },
    // any solid tile (or registered prop rect) overlapping a world-space AABB?
    rectSolid(x, y, w, h) {
      const x0 = Math.floor(x / T), x1 = Math.floor((x + w - 1) / T);
      const y0 = Math.floor(y / T), y1 = Math.floor((y + h - 1) / T);
      for (let ty = y0; ty <= y1; ty++)
        for (let tx = x0; tx <= x1; tx++)
          if (this.solid(tx, ty)) return true;
      const R = this.solidRects;
      for (let i = 0; i < R.length; i++) {
        const r = R[i];
        if (x < r.x + r.w && x + w > r.x && y < r.y + r.h && y + h > r.y) return true;
      }
      return false;
    },
    addSolidRect(x, y, w, h) { this.solidRects.push({ x, y, w, h }); },
    // is there solid ground just below world point (px,py)?
    solidBelow(px, py) { return this.rectSolid(px - 1, py + 0.5, 2, 3); },

    // -------------------------------------------------------------------
    // Build the world
    // -------------------------------------------------------------------
    build() {
      const W = this.W, H = this.H;
      this.tiles = new Uint8Array(W * H);
      this.spawns = []; this.guardsDef = []; this.lights = []; this.solidRects = [];
      this.worldW = W * T; this.worldH = H * T;
      const g = this.groundTop;

      const set = (tx, ty, v) => { if (tx >= 0 && tx < W && ty >= 0 && ty < H) this.tiles[this.idx(tx, ty)] = v; };
      const fill = (x0, y0, x1, y1, v) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, v); };
      const building = (x0, x1, roofY) => fill(x0, roofY, x1, H - 1, SOLID);
      const plat = (x0, x1, y) => { for (let x = x0; x <= x1; x++) set(x, y, ONEWAY); };

      // continuous street/ground across the level (forgiving — falling is safe)
      fill(0, g, W - 1, H - 1, SOLID);
      // boundary walls
      fill(0, 0, 0, H - 1, SOLID);
      fill(W - 1, 0, W - 1, H - 1, SOLID);

      // px helpers: center-x of a tile, surface-y (top) of a tile row
      const cx = (tx) => tx * T + T / 2;
      const surf = (ty) => ty * T;

      const light = (tx, ty, hh) => { this.lights.push({ x: cx(tx), y: surf(ty), h: hh }); this.spawns.push({ type: "light", x: cx(tx), y: surf(ty), h: hh }); };

      // ============ ZONE A — open tutorial street (safe) ================
      this.spawns.push({ type: "player", x: cx(5), y: surf(g) });
      this.spawns.push({ type: "kid", x: cx(2), y: surf(g) });
      this.spawns.push({ type: "kid", x: cx(3) + 4, y: surf(g) });
      this.spawns.push({ type: "kid", x: cx(7), y: surf(g) });
      light(9, g, 44);
      this.spawns.push({ type: "hint", x: cx(6), y: surf(g) - 30, text: "ARROWS MOVE   Z JUMP" });
      this.spawns.push({ type: "stove", x: cx(10), y: surf(g) });
      this.spawns.push({ type: "hint", x: cx(10), y: surf(g) - 42, text: "COOK HERE (C) WHEN A DISH IS READY" });
      this.spawns.push({ type: "dumpster", x: cx(14), y: surf(g), ingredients: ["bread", "cheese"] });
      this.spawns.push({ type: "hint", x: cx(14), y: surf(g) - 34, text: "PRESS DOWN: DIVE FOR FOOD" });
      this.spawns.push({ type: "crate", x: cx(18), y: surf(g), size: 16 });
      this.spawns.push({ type: "coin", x: cx(18), y: surf(g) - 22 });
      this.spawns.push({ type: "can", x: cx(21), y: surf(g) - 4 });

      // ---- ascent: fire-escape staircase up to the rooftops ----
      plat(24, 26, 21); plat(27, 29, 18); plat(30, 32, 15);
      this.spawns.push({ type: "hint", x: cx(27), y: surf(15) - 12, text: "HOP THE FIRE ESCAPES UP" });
      this.spawns.push({ type: "coin", x: cx(28), y: surf(18) - 6 });

      // ============ ZONE B — rooftop R1 (first guard) ===================
      building(33, 47, 14);
      this.spawns.push({ type: "hint", x: cx(35), y: surf(14) - 14, text: "KEEP OUT OF THE LIGHT CONES" });
      this.spawns.push({ type: "crate", x: cx(37), y: surf(14), size: 16 });
      this.spawns.push({ type: "coin", x: cx(43), y: surf(14) - 6 });
      this.spawns.push({ type: "ing", ing: "apple", x: cx(45), y: surf(14) - 6 });
      this.guardsDef.push({ x: cx(41), y: surf(14), min: cx(35), max: cx(46), dir: 1, range: 92, fov: 0.5 });

      // alley A1 (dumpster below), bridged so you can run across or drop in
      plat(48, 50, 14);
      light(49, g, 40);
      this.spawns.push({ type: "dumpster", x: cx(49), y: surf(g), ingredients: ["meat", "fish"] });
      this.spawns.push({ type: "hint", x: cx(49), y: surf(14) - 12, text: "DOWN+JUMP DROPS THROUGH" });

      // ---- rooftop R2 ----
      building(51, 64, 13);
      this.spawns.push({ type: "can", x: cx(54), y: surf(13) - 4 });
      this.spawns.push({ type: "crate", x: cx(60), y: surf(13), size: 16 });
      this.spawns.push({ type: "coin", x: cx(62), y: surf(13) - 6 });
      this.guardsDef.push({ x: cx(57), y: surf(13), min: cx(52), max: cx(63), dir: -1, range: 100, fov: 0.55 });

      // ============ ZONE C — lit courtyard (stealth sandbox) ============
      building(85, 99, 13);                       // right frame of the courtyard
      this.spawns.push({ type: "checkpoint", x: cx(67), y: surf(g) });
      light(70, g, 46); light(80, g, 46);
      this.spawns.push({ type: "dumpster", x: cx(72), y: surf(g), ingredients: ["tomato", "noodle", "cheese"] });
      this.spawns.push({ type: "dumpster", x: cx(82), y: surf(g), ingredients: ["egg", "cheese"] });
      this.spawns.push({ type: "crate", x: cx(77), y: surf(g), size: 16 });
      this.spawns.push({ type: "crate", x: cx(77), y: surf(g) - 16, size: 16 });
      this.spawns.push({ type: "can", x: cx(68), y: surf(g) - 4 });
      this.spawns.push({ type: "coin", x: cx(75), y: surf(g) - 4 });
      this.spawns.push({ type: "ing", ing: "egg", x: cx(83), y: surf(g) - 4 });
      this.spawns.push({ type: "hint", x: cx(69), y: surf(g) - 30, text: "THROW CANS (C) TO DISTRACT GUARDS" });
      plat(81, 84, 20); plat(81, 84, 16); plat(81, 84, 13);  // fire-escape stair out to R3 (flush to roof)
      this.guardsDef.push({ x: cx(74), y: surf(g), min: cx(67), max: cx(83), dir: 1, range: 108, fov: 0.55 });
      this.guardsDef.push({ x: cx(80), y: surf(g), min: cx(72), max: cx(84), dir: -1, range: 104, fov: 0.55 });
      this.guardsDef.push({ type: "dog", x: cx(78), y: surf(g), min: cx(67), max: cx(84), dir: -1, scent: 44, range: 66 });

      // ---- rooftop R3 ----
      this.spawns.push({ type: "coin", x: cx(88), y: surf(13) - 6 });
      this.spawns.push({ type: "crate", x: cx(90), y: surf(13), size: 16 });
      this.spawns.push({ type: "ing", ing: "fish", x: cx(96), y: surf(13) - 6 });
      this.guardsDef.push({ x: cx(92), y: surf(13), min: cx(86), max: cx(98), dir: 1, range: 100, fov: 0.5 });
      this.guardsDef.push({ type: "searchlight", x: cx(92), y: surf(2), range: 200, center: Math.PI / 2, amp: 0.62, speed: 1.05, width: 0.22 });

      // alley A2
      plat(100, 102, 13);
      light(101, g, 40);
      this.spawns.push({ type: "dumpster", x: cx(101), y: surf(g), ingredients: ["meat", "tomato", "noodle"] });

      // ---- rooftop R4 ----
      building(103, 116, 12);
      this.spawns.push({ type: "can", x: cx(106), y: surf(12) - 4 });
      this.spawns.push({ type: "crate", x: cx(108), y: surf(12), size: 16 });
      this.spawns.push({ type: "coin", x: cx(113), y: surf(12) - 6 });
      this.guardsDef.push({ x: cx(110), y: surf(12), min: cx(104), max: cx(115), dir: -1, range: 100, fov: 0.55 });

      // ============ ZONE E — extraction tower ===========================
      building(117, 132, 8);
      plat(114, 117, 10); plat(114, 117, 8);       // footholds flush onto the tower roof
      this.spawns.push({ type: "hint", x: cx(118), y: surf(8) - 14, text: "SPARE FOOD UP TOP" });
      this.spawns.push({ type: "coin", x: cx(121), y: surf(8) - 6 });
      this.spawns.push({ type: "ing", ing: "tomato", x: cx(126), y: surf(8) - 6 });
      this.spawns.push({ type: "ing", ing: "meat", x: cx(129), y: surf(8) - 6 });
      light(131, 8, 30);
      this.spawns.push({ type: "hint", x: cx(124), y: surf(8) - 20, text: "GOT WHAT YOU NEED? HEAD HOME TO COOK" });
      // a couple of decorative shorter roofs trailing off to the right edge
      building(136, 143, 16); building(147, 156, 18);

      // find player spawn
      const ps = this.spawns.find((s) => s.type === "player");
      if (ps) this.spawn = { x: ps.x, y: ps.y };

      this._buildBackground();
      return this;
    },

    // deterministic distant skyline + gradient
    _buildBackground() {
      const rng = RC.makeRng(1234);
      const layers = [];
      for (let L = 0; L < 3; L++) {
        const b = [];
        let x = -20;
        const baseY = 120 + L * 26;
        while (x < this.worldW * (0.5 + L * 0.2) + 400) {
          const w = rng.int(14, 40);
          const h = rng.int(30 + L * 10, 90 + L * 20);
          b.push({ x, w, h, y: baseY - h, lit: [] });
          const wins = rng.int(2, 8);
          for (let k = 0; k < wins; k++) {
            if (rng.chance(0.3 + L * 0.1)) b[b.length - 1].lit.push({
              wx: rng.int(2, w - 3), wy: rng.int(2, h - 4)
            });
          }
          x += w + rng.int(2, 8);
        }
        layers.push(b);
      }
      this._skyline = layers;
    },

    // -------------------------------------------------------------------
    // Ambient brightness at a world point (for stealth). 0 dark .. 1 lit.
    // -------------------------------------------------------------------
    brightAt(x, y) {
      let b = 0.14;   // moonlit base
      for (const l of this.lights) {
        const d = M.dist(x, y - 6, l.x, l.y - l.h + 4);
        const r = l.h + 34;
        if (d < r) b += (1 - d / r) * 0.9;
      }
      return M.sat(b);
    },

    // -------------------------------------------------------------------
    // Camera
    // -------------------------------------------------------------------
    focusCamera(x, y) {
      this.cam.x = M.clamp(x - RC.VIEW_W / 2, 0, this.worldW - RC.VIEW_W);
      this.cam.y = M.clamp(y - RC.VIEW_H / 2, 0, this.worldH - RC.VIEW_H);
      this.cam._lx = this.cam.x; this.cam._ly = this.cam.y;
    },
    updateCamera(tx, ty, look, dt) {
      const c = this.cam;
      const desiredX = tx - RC.VIEW_W / 2 + look * 40;
      const desiredY = ty - RC.VIEW_H / 2 - 12;
      c._lx = M.damp(c._lx, desiredX, 7, dt);
      c._ly = M.damp(c._ly, desiredY, 6, dt);
      c.x = M.clamp(c._lx, 0, Math.max(0, this.worldW - RC.VIEW_W));
      c.y = M.clamp(c._ly, 0, Math.max(0, this.worldH - RC.VIEW_H));
      // shake
      if (c.shakeT > 0) {
        c.shakeT -= dt;
        const a = c.shakeAmt * (c.shakeT > 0 ? c.shakeT / c.shakeDur : 0);
        c.ox = (RC.rng() - 0.5) * a * 2;
        c.oy = (RC.rng() - 0.5) * a * 2;
      } else { c.ox = 0; c.oy = 0; }
    },
    shake(amt, dur) {
      const c = this.cam;
      if (amt >= c.shakeAmt || c.shakeT <= 0) { c.shakeAmt = amt; c.shakeDur = dur || 0.3; c.shakeT = c.shakeDur; }
    },
    camX() { return Math.round(this.cam.x + this.cam.ox); },
    camY() { return Math.round(this.cam.y + this.cam.oy); },

    // -------------------------------------------------------------------
    // Rendering
    // -------------------------------------------------------------------
    drawBackground(ctx, t) {
      const cx = this.cam.x, cy = this.cam.y;
      // sky gradient
      if (!this._bgGrad) {
        const gr = ctx.createLinearGradient(0, 0, 0, RC.VIEW_H);
        gr.addColorStop(0, "#0d0c24");
        gr.addColorStop(0.45, "#181642");
        gr.addColorStop(0.8, "#241f52");
        gr.addColorStop(1, "#2c2550");
        this._bgGrad = gr;
      }
      ctx.fillStyle = this._bgGrad;
      ctx.fillRect(0, 0, RC.VIEW_W, RC.VIEW_H);

      // stars (parallax 0.15)
      const srng = RC.makeRng(99);
      ctx.fillStyle = P.star;
      for (let i = 0; i < 90; i++) {
        const sx = srng.int(0, this.worldW);
        const sy = srng.int(0, 120);
        const px = Math.round(sx - cx * 0.15) % (RC.VIEW_W + 40);
        const py = Math.round(sy - cy * 0.1);
        if (py < 0 || py > RC.VIEW_H) continue;
        const tw = 0.4 + 0.6 * Math.abs(Math.sin(t * 1.5 + i));
        ctx.globalAlpha = tw * 0.9;
        ctx.fillRect((px + RC.VIEW_W + 40) % (RC.VIEW_W + 40) - 20, py, 1, 1);
      }
      ctx.globalAlpha = 1;

      // moon with glow (parallax 0.08)
      const mx = 300 - cx * 0.08, my = 44 - cy * 0.06;
      const gl = ctx.createRadialGradient(mx, my, 4, mx, my, 46);
      gl.addColorStop(0, "rgba(180,180,220,0.35)");
      gl.addColorStop(1, "rgba(180,180,220,0)");
      ctx.fillStyle = gl; ctx.fillRect(mx - 46, my - 46, 92, 92);
      ctx.fillStyle = P.moon;
      ctx.beginPath(); ctx.arc(mx, my, 12, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#dcd8c0";
      ctx.beginPath(); ctx.arc(mx + 4, my - 3, 2.5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(mx - 3, my + 4, 1.8, 0, Math.PI * 2); ctx.fill();

      // distant skyline layers
      const parX = [0.2, 0.38, 0.6], parY = [0.12, 0.2, 0.32];
      const tint = ["#151338", "#1c1943", "#241f52"];
      for (let L = 0; L < this._skyline.length; L++) {
        const layer = this._skyline[L];
        ctx.fillStyle = tint[L];
        for (const b of layer) {
          const bx = Math.round(b.x - cx * parX[L]);
          if (bx > RC.VIEW_W || bx + b.w < 0) continue;
          const by = Math.round(b.y + cy * (1 - 1) - cy * parY[L] + cy * 0);
          const yy = Math.round(b.y - cy * parY[L] + 30);
          ctx.fillRect(bx, yy, b.w, b.h + 60);
          // lit windows
          ctx.fillStyle = L === 2 ? "#5b4f8a" : "#3a3466";
          for (const w of b.lit) ctx.fillRect(bx + w.wx, yy + w.wy, 2, 2);
          ctx.fillStyle = tint[L];
        }
      }
    },

    // main tile pass with deterministic decoration
    drawTiles(ctx) {
      const cx = this.camX(), cy = this.camY();
      const x0 = Math.max(0, Math.floor(cx / T));
      const x1 = Math.min(this.W - 1, Math.floor((cx + RC.VIEW_W) / T) + 1);
      const y0 = Math.max(0, Math.floor(cy / T));
      const y1 = Math.min(this.H - 1, Math.floor((cy + RC.VIEW_H) / T) + 1);

      for (let ty = y0; ty <= y1; ty++) {
        for (let tx = x0; tx <= x1; tx++) {
          const v = this.tiles[this.idx(tx, ty)];
          if (v === AIR) continue;
          const px = tx * T - cx, py = ty * T - cy;
          if (v === ONEWAY) { this._drawOneway(ctx, px, py); continue; }
          // solid
          const isGround = ty >= this.groundTop;
          const openAbove = !this.solid(tx, ty - 1);
          if (isGround) this._drawStreet(ctx, px, py, tx, ty, openAbove);
          else this._drawBrick(ctx, px, py, tx, ty, openAbove);
        }
      }
    },

    _hash(tx, ty) { let h = (tx * 73856093) ^ (ty * 19349663); h = (h ^ (h >>> 13)) >>> 0; return h; },

    _drawBrick(ctx, px, py, tx, ty, openAbove) {
      const h = this._hash(tx, ty);
      ctx.fillStyle = (h & 3) === 0 ? P.brick1 : P.brick0;
      ctx.fillRect(px, py, T, T);
      // mortar lines
      ctx.fillStyle = P.brickLine;
      ctx.fillRect(px, py + 7, T, 1);
      ctx.fillRect(px, py + 15, T, 1);
      ctx.fillRect(px + ((tx + ty) % 2 ? 0 : 8), py, 1, 8);
      ctx.fillRect(px + ((tx + ty) % 2 ? 8 : 0), py + 8, 1, 8);
      // window every couple tiles
      if (tx % 2 === 0 && ty % 3 === 1) {
        const lit = (h % 5) < 2;
        ctx.fillStyle = lit ? P.lamp : "#191634";
        ctx.fillRect(px + 4, py + 3, 8, 9);
        ctx.fillStyle = lit ? P.lampCore : "#221d40";
        ctx.fillRect(px + 5, py + 4, 6, 3);
        ctx.fillStyle = "#0d0b1f";
        ctx.fillRect(px + 7, py + 3, 2, 9); // frame
        ctx.fillRect(px + 4, py + 7, 8, 1);
        if (lit) { // faint sill glow
          ctx.globalAlpha = 0.25; ctx.fillStyle = P.lamp;
          ctx.fillRect(px + 3, py + 12, 10, 2); ctx.globalAlpha = 1;
        }
      }
      if (openAbove) { // roof cap / ledge highlight
        ctx.fillStyle = P.brick2; ctx.fillRect(px, py, T, 2);
        ctx.fillStyle = "#4a3f6e"; ctx.fillRect(px, py, T, 1);
        ctx.fillStyle = P.brickLine; ctx.fillRect(px, py + 2, T, 1);
      }
    },

    _drawStreet(ctx, px, py, tx, ty, openAbove) {
      const h = this._hash(tx, ty);
      ctx.fillStyle = ty === this.groundTop ? P.concrete1 : P.concrete0;
      ctx.fillRect(px, py, T, T);
      if (openAbove) {
        // sidewalk top with seams + grime
        ctx.fillStyle = "#565a76"; ctx.fillRect(px, py, T, 2);
        ctx.fillStyle = "#2c2e42"; ctx.fillRect(px, py + 2, T, 1);
        if (tx % 3 === 0) { ctx.fillStyle = "#33364c"; ctx.fillRect(px, py, 1, T); }
        if ((h & 7) === 0) { ctx.fillStyle = "#2a2c40"; ctx.fillRect(px + (h % 10), py + 4, 2, 1); }
      } else {
        ctx.fillStyle = "#2f3145";
        if ((h & 3) === 0) ctx.fillRect(px + (h % 12), py + (h % 9), 2, 2);
      }
    },

    _drawOneway(ctx, px, py) {
      // grated fire-escape platform
      ctx.fillStyle = P.metal0; ctx.fillRect(px, py, T, 3);
      ctx.fillStyle = P.metal1; ctx.fillRect(px, py, T, 1);
      ctx.fillStyle = "#28323a";
      for (let i = 0; i < T; i += 3) ctx.fillRect(px + i, py + 1, 1, 2);
    },

    // streetlight poles (drawn in world space, before props/actors)
    drawPoles(ctx) {
      const cx = this.camX(), cy = this.camY();
      for (const l of this.lights) {
        const x = l.x - cx;
        if (x < -20 || x > RC.VIEW_W + 20) continue;
        RC.Sprites.streetlight(ctx, x, l.y - cy, { h: l.h });
      }
    },

    // additive light glows (call with composite already set by game)
    drawLights(ctx) {
      const cx = this.camX(), cy = this.camY();
      for (const l of this.lights) {
        const lx = l.x - cx, ly = l.y - l.h - cy + 2;
        if (lx < -80 || lx > RC.VIEW_W + 80) continue;
        const r = l.h + 30;
        const gr = ctx.createRadialGradient(lx, ly, 2, lx, ly, r);
        gr.addColorStop(0, "rgba(255,205,120,0.42)");
        gr.addColorStop(0.4, "rgba(255,190,96,0.14)");
        gr.addColorStop(1, "rgba(255,190,96,0)");
        ctx.fillStyle = gr;
        ctx.beginPath(); ctx.moveTo(lx, ly);
        ctx.arc(lx, ly, r, 0, Math.PI * 2); ctx.fill();
        // bright core
        ctx.fillStyle = "rgba(255,240,200,0.5)";
        ctx.fillRect(lx - 1, ly - 1, 3, 3);
      }
    },

    // foreground rain, drawn last for depth
    _rain: null,
    drawRain(ctx, dt) {
      if (!this._rain) {
        this._rain = [];
        for (let i = 0; i < 70; i++)
          this._rain.push({ x: RC.rng() * (RC.VIEW_W + 40), y: RC.rng() * RC.VIEW_H,
            len: 4 + RC.rng() * 6, sp: 220 + RC.rng() * 160, w: RC.rng() < 0.3 ? 2 : 1 });
      }
      ctx.strokeStyle = "rgba(150,160,210,0.28)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      const skew = 2;
      for (const d of this._rain) {
        d.y += d.sp * dt; d.x -= d.sp * 0.12 * dt;
        if (d.y > RC.VIEW_H) { d.y = -d.len; d.x = RC.rng() * (RC.VIEW_W + 60); }
        if (d.x < -10) d.x = RC.VIEW_W + 10;
        ctx.moveTo(d.x, d.y);
        ctx.lineTo(d.x - skew, d.y + d.len);
      }
      ctx.stroke();
    },
  };

})(window);
