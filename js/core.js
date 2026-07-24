/* =============================================================================
   BROKE @$$ RACCOON — core.js
   Global namespace, config, math utils, seeded RNG, input, and pixel font.
   Everything hangs off window.RC so the other classic scripts can share it.
   ========================================================================== */
(function (global) {
  "use strict";

  const RC = global.RC || (global.RC = {});

  /* ----------------------------------------------------------------------- */
  /* Config                                                                  */
  /* ----------------------------------------------------------------------- */
  RC.VIEW_W = 480;          // internal render buffer width  (4x -> 1920)
  RC.VIEW_H = 270;          // internal render buffer height (4x -> 1080)
  RC.TILE   = 16;           // tile size in world pixels
  RC.FIXED_DT = 1 / 60;     // physics runs on a fixed 60hz step

  /* A cohesive moody-night palette (dusk purples, sodium-lamp ambers). */
  RC.PAL = {
    ink:        "#0b0b17",
    night0:     "#101030",
    night1:     "#1a1740",
    night2:     "#241f52",
    haze:       "#39306e",
    star:       "#cfd6ff",
    moon:       "#f4f0d8",
    moonGlow:   "#3a3a6e",
    lamp:       "#ffd27a",
    lampCore:   "#fff2c8",
    lampGlow:   "rgba(255,196,92,0.16)",
    brick0:     "#2a2340",
    brick1:     "#342a4e",
    brick2:     "#3f3560",
    brickLine:  "#211b34",
    concrete0:  "#3a3d52",
    concrete1:  "#4a4d66",
    metal0:     "#3b4a55",
    metal1:     "#526673",
    rust:       "#7a5a3a",
    // raccoon
    fur0:       "#5a5f74",
    fur1:       "#787e97",
    fur2:       "#9aa0bd",
    furDark:    "#3d4155",
    mask:       "#141726",
    maskLite:   "#eef1ff",
    nose:       "#20222f",
    // guards
    guard0:     "#3b2f5a",
    guard1:     "#54427e",
    guardHi:    "#7d64b0",
    vis:        "#ffe08a",
    // ui / fx
    white:      "#f4f6ff",
    dust:       "#c9c3e6",
    gold:       "#ffcf5c",
    goldHi:     "#fff0b0",
    food:       "#8fd66a",
    good:       "#67e0a3",
    bad:        "#ff5d6c",
    detect:     "#ff7a45",
    text:       "#e6e8f6",
    textDim:    "#8a8fb8",
    shadow:     "rgba(0,0,0,0.35)",
  };

  /* ----------------------------------------------------------------------- */
  /* Math / misc utilities                                                   */
  /* ----------------------------------------------------------------------- */
  const M = RC.M = {
    clamp(v, a, b) { return v < a ? a : (v > b ? b : v); },
    lerp(a, b, t) { return a + (b - a) * t; },
    // frame-rate independent smoothing (t per-second toward target)
    damp(a, b, lambda, dt) { return M.lerp(a, b, 1 - Math.exp(-lambda * dt)); },
    // move `a` toward `b` by at most `step`
    approach(a, b, step) {
      if (a < b) return Math.min(a + step, b);
      if (a > b) return Math.max(a - step, b);
      return a;
    },
    sign(v) { return v < 0 ? -1 : (v > 0 ? 1 : 0); },
    sat(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); },
    smoothstep(t) { t = M.sat(t); return t * t * (3 - 2 * t); },
    dist2(ax, ay, bx, by) { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; },
    dist(ax, ay, bx, by) { return Math.sqrt(M.dist2(ax, ay, bx, by)); },
    aabb(ax, ay, aw, ah, bx, by, bw, bh) {
      return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
    },
    angleLerp(a, b, t) {
      let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
      if (d < -Math.PI) d += Math.PI * 2;
      return a + d * t;
    },
    round(v) { return Math.round(v); },
  };

  /* Seeded RNG (mulberry32) — deterministic where we want repeatable fx. */
  RC.makeRng = function (seed) {
    let s = (seed >>> 0) || 1;
    const r = function () {
      s |= 0; s = (s + 0x6D2B79F5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    r.range = (a, b) => a + (b - a) * r();
    r.int = (a, b) => Math.floor(r.range(a, b + 1));
    r.pick = (arr) => arr[Math.floor(r() * arr.length)];
    r.sign = () => (r() < 0.5 ? -1 : 1);
    r.chance = (p) => r() < p;
    return r;
  };
  // a general-purpose non-deterministic-ish rng for cosmetic fx
  RC.rng = RC.makeRng(0x9e3779b9 ^ 1337);

  /* ----------------------------------------------------------------------- */
  /* Input — logical actions mapped from keyboard, with edge detection.      */
  /* ----------------------------------------------------------------------- */
  const ACTIONS = {
    left:    ["ArrowLeft", "KeyA"],
    right:   ["ArrowRight", "KeyD"],
    up:      ["ArrowUp", "KeyW"],
    down:    ["ArrowDown", "KeyS"],
    jump:    ["KeyZ", "Space"],
    attack:  ["KeyX", "KeyK", "KeyF"],
    dash:    ["KeyV", "KeyN"],
    grab:    ["ShiftLeft", "ShiftRight", "KeyL"],
    throw:   ["KeyC", "KeyJ"],
    action:  ["KeyE", "Enter"],
    pause:   ["Escape", "KeyP"],
    restart: ["KeyR"],
    mute:    ["KeyM"],
    map:     ["Tab", "KeyQ"],
    confirm: ["Enter", "KeyZ", "Space"],
  };

  const Input = RC.Input = {
    raw: Object.create(null),
    down: Object.create(null),
    prev: Object.create(null),
    anyPressed: false,
    _anyRaw: false,
    _prevAnyRaw: false,

    init() {
      const onKey = (e, isDown) => {
        // Prevent the page from scrolling / scrubbing on the game keys.
        if (e.code === "Space" || e.code === "Tab" || e.code.startsWith("Arrow")) e.preventDefault();
        this.raw[e.code] = isDown;
        if (isDown) this._anyRaw = true;
      };
      global.addEventListener("keydown", (e) => { if (!e.repeat) onKey(e, true); }, { passive: false });
      global.addEventListener("keyup", (e) => onKey(e, false), { passive: false });
      // If the tab loses focus, drop all keys so we don't get stuck moving.
      global.addEventListener("blur", () => { this.raw = Object.create(null); });
      this.poll(); this.poll();
    },

    // on-screen buttons for touch devices
    initTouch() {
      const isTouch = ("ontouchstart" in global) || (navigator && navigator.maxTouchPoints > 0) || global.innerWidth < 820;
      if (isTouch) document.body.classList.add("touch");
      const pad = document.getElementById("touch");
      if (!pad) return;
      const self = this;
      pad.querySelectorAll("[data-k]").forEach((b) => {
        const code = b.getAttribute("data-k");
        const on = (e) => { e.preventDefault(); self.raw[code] = true; self._anyRaw = true; b.classList.add("act"); };
        const off = (e) => { if (e) e.preventDefault(); self.raw[code] = false; b.classList.remove("act"); };
        b.addEventListener("pointerdown", on);
        b.addEventListener("pointerup", off);
        b.addEventListener("pointercancel", off);
        b.addEventListener("pointerleave", off);
        b.addEventListener("lostpointercapture", off);
      });
    },
    // briefly assert a key (used for tap-to-advance menus)
    pulse(code, ms) {
      this.raw[code] = true; this._anyRaw = true;
      setTimeout(() => { this.raw[code] = false; }, ms || 120);
    },

    _anyOf(codes) { for (let i = 0; i < codes.length; i++) if (this.raw[codes[i]]) return true; return false; },

    // Called once per rendered frame, before update logic.
    poll() {
      this.prev = this.down;
      const d = Object.create(null);
      for (const a in ACTIONS) d[a] = this._anyOf(ACTIONS[a]);
      this.down = d;
      this._prevAnyRaw = this._curAnyRaw || false;
      this._curAnyRaw = this._anyRaw;
      this.anyPressed = this._curAnyRaw && !this._prevAnyRaw;
      this._anyRaw = false;
      // keep raw "any" alive while a key is physically held
      for (const k in this.raw) if (this.raw[k]) { this._anyRaw = true; break; }
    },

    is(a)       { return !!this.down[a]; },
    pressed(a)  { return !!this.down[a] && !this.prev[a]; },
    released(a) { return !this.down[a] && !!this.prev[a]; },
    // -1 / 0 / +1 horizontal & vertical
    axisX() { return (this.down.right ? 1 : 0) - (this.down.left ? 1 : 0); },
    axisY() { return (this.down.down ? 1 : 0) - (this.down.up ? 1 : 0); },
  };

  /* ----------------------------------------------------------------------- */
  /* Pixel font — rasterize system glyphs to a 1-bit grid once, then draw    */
  /* them as crisp blocks. Gives real pixel-font text without hand-encoding. */
  /* ----------------------------------------------------------------------- */
  const Font = RC.Font = {
    CW: 6, CH: 8,          // glyph cell (source grid)
    cache: Object.create(null),
    _ctx: null,

    _raster(ch) {
      if (this.cache[ch]) return this.cache[ch];
      if (!this._ctx) {
        const c = document.createElement("canvas");
        c.width = this.CW; c.height = this.CH;
        this._ctx = c.getContext("2d", { willReadFrequently: true });
      }
      const g = this._ctx;
      g.clearRect(0, 0, this.CW, this.CH);
      g.fillStyle = "#fff";
      g.textBaseline = "middle";
      g.textAlign = "center";
      // bold condensed monospace fills the cell nicely at this size
      g.font = "700 8px ui-monospace, Menlo, Consolas, monospace";
      g.fillText(ch, this.CW / 2, this.CH / 2 + 0.5);
      const data = g.getImageData(0, 0, this.CW, this.CH).data;
      const grid = [];
      for (let y = 0; y < this.CH; y++) {
        let row = 0;
        for (let x = 0; x < this.CW; x++) {
          const a = data[(y * this.CW + x) * 4 + 3];
          if (a > 90) row |= (1 << x);
        }
        grid.push(row);
      }
      return (this.cache[ch] = grid);
    },

    // width of a string in buffer px at given scale & letter spacing
    measure(text, scale = 1, tracking = 1) {
      scale = scale | 0 || 1;
      return text.length * (this.CW + tracking) * scale - tracking * scale;
    },

    // draw text; align: "left" | "center" | "right"
    draw(ctx, text, x, y, opts = {}) {
      const scale = (opts.scale | 0) || 1;
      const tracking = opts.tracking == null ? 1 : opts.tracking;
      const color = opts.color || RC.PAL.text;
      const align = opts.align || "left";
      text = String(text).toUpperCase();
      let w = this.measure(text, scale, tracking);
      let sx = x;
      if (align === "center") sx = Math.round(x - w / 2);
      else if (align === "right") sx = Math.round(x - w);
      sx = Math.round(sx); y = Math.round(y);

      if (opts.shadow) {
        this._blit(ctx, text, sx + scale, y + scale, scale, tracking, opts.shadowColor || "rgba(0,0,0,0.55)");
      }
      this._blit(ctx, text, sx, y, scale, tracking, color);
      return w;
    },

    _blit(ctx, text, sx, y, scale, tracking, color) {
      ctx.fillStyle = color;
      const step = (this.CW + tracking) * scale;
      for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (ch === " ") continue;
        const grid = this._raster(ch);
        const gx = sx + i * step;
        for (let ry = 0; ry < this.CH; ry++) {
          const row = grid[ry];
          if (!row) continue;
          for (let rx = 0; rx < this.CW; rx++) {
            if (row & (1 << rx)) ctx.fillRect(gx + rx * scale, y + ry * scale, scale, scale);
          }
        }
      }
    },
  };

  /* ----------------------------------------------------------------------- */
  /* Tiny event/util helpers used across modules                            */
  /* ----------------------------------------------------------------------- */
  RC.now = () => (global.performance && performance.now ? performance.now() : Date.now());

})(window);
