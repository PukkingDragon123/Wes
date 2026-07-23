/* =============================================================================
   particles.js — gameplay VFX: dust, sparks, noise rings, floating text, etc.
   World-space; the game passes a camera to draw().
   ========================================================================== */
(function (global) {
  "use strict";
  const RC = global.RC;
  const M = RC.M;

  function Particle() { this.dead = true; }

  const Particles = RC.Particles = {
    pool: [],
    max: 600,
    decals: [],          // persistent ground splats (blood, etc.)
    maxDecals: 160,

    reset() { this.pool.length = 0; this.decals.length = 0; },

    _get() {
      for (let i = 0; i < this.pool.length; i++) if (this.pool[i].dead) return this.pool[i];
      if (this.pool.length >= this.max) return this.pool[0];
      const p = new Particle(); this.pool.push(p); return p;
    },

    emit(cfg) {
      const p = this._get();
      p.dead = false;
      p.kind = cfg.kind || "dust";
      p.x = cfg.x; p.y = cfg.y;
      p.vx = cfg.vx || 0; p.vy = cfg.vy || 0;
      p.g = cfg.g || 0; p.drag = cfg.drag == null ? 1 : cfg.drag;
      p.life = 0; p.max = cfg.life || 0.5;
      p.size = cfg.size || 1;
      p.color = cfg.color || RC.PAL.dust;
      p.color2 = cfg.color2 || null;
      p.text = cfg.text || null;
      p.rot = cfg.rot || 0; p.vr = cfg.vr || 0;
      p.grow = cfg.grow || 0;
      p.fade = cfg.fade == null ? true : cfg.fade;
      p.z = cfg.z || 0;
      return p;
    },

    // ---- convenience emitters -----------------------------------------
    dust(x, y, n, dir) {
      dir = dir || 0;
      for (let i = 0; i < n; i++) {
        this.emit({
          kind: "dust", x, y,
          vx: (RC.rng() - 0.5) * 30 + dir * 20, vy: -RC.rng() * 24 - 4,
          g: 60, drag: 0.86, life: 0.35 + RC.rng() * 0.3,
          size: 1 + (RC.rng() < 0.4 ? 1 : 0), color: RC.rng() < 0.5 ? RC.PAL.dust : "#a9a3c6",
        });
      }
    },
    landDust(x, y, power) {
      const n = 6 + (power * 4 | 0);
      for (let i = 0; i < n; i++) {
        const s = (i / n) * 2 - 1;
        this.emit({
          kind: "dust", x: x + s * 6, y,
          vx: s * (30 + power * 40), vy: -RC.rng() * 20 - 6,
          g: 90, drag: 0.85, life: 0.4 + RC.rng() * 0.3, size: 1 + (RC.rng() < 0.5 ? 1 : 0),
          color: RC.rng() < 0.5 ? RC.PAL.dust : "#b7b1d6",
        });
      }
    },
    spark(x, y, n, color) {
      for (let i = 0; i < n; i++) {
        const a = RC.rng() * Math.PI * 2, sp = 40 + RC.rng() * 90;
        this.emit({
          kind: "spark", x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 20,
          g: 120, drag: 0.9, life: 0.3 + RC.rng() * 0.3, size: 1,
          color: color || RC.PAL.goldHi,
        });
      }
    },
    lootPop(x, y, text, color) {
      this.spark(x, y, 8, color || RC.PAL.goldHi);
      this.emit({ kind: "text", x, y: y - 4, vy: -26, drag: 0.96, life: 0.9, text: text || "+1",
        color: color || RC.PAL.goldHi });
    },
    ring(x, y, color, maxR) {
      this.emit({ kind: "ring", x, y, life: 0.6, size: 3, grow: (maxR || 40) / 0.6,
        color: color || RC.PAL.detect });
    },
    poof(x, y) {
      for (let i = 0; i < 10; i++) {
        const a = RC.rng() * Math.PI * 2, sp = 20 + RC.rng() * 40;
        this.emit({ kind: "dust", x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 10,
          g: 30, drag: 0.88, life: 0.5, size: 1 + (RC.rng() < 0.5 ? 1 : 0), color: "#c9c3e6" });
      }
    },
    confetti(x, y, n) {
      const cols = [RC.PAL.gold, RC.PAL.good, RC.PAL.bad, RC.PAL.star, "#8fd6ff", "#ff9aa5"];
      for (let i = 0; i < (n || 30); i++) {
        this.emit({ kind: "confetti", x, y,
          vx: (RC.rng() - 0.5) * 160, vy: -RC.rng() * 160 - 40,
          g: 180, drag: 0.98, life: 1.4 + RC.rng(), size: 2,
          color: RC.rng.pick ? RC.rng.pick(cols) : cols[i % cols.length],
          vr: (RC.rng() - 0.5) * 12, rot: RC.rng() * 6.28 });
      }
    },
    trail(x, y, color) {
      this.emit({ kind: "dust", x, y, vx: (RC.rng() - 0.5) * 8, vy: (RC.rng() - 0.5) * 8,
        g: 0, drag: 0.9, life: 0.25, size: 1, color: color || "#9aa0bd" });
    },

    // stylized pixel gore: a spray of red droplets that fling out and fall
    blood(x, y, dir, amount) {
      const n = amount || 16;
      const reds = ["#c81e2a", "#8f1420", "#e64350", "#6e0e18"];
      for (let i = 0; i < n; i++) {
        const a = (dir ? (dir > 0 ? -0.2 : Math.PI + 0.2) : -Math.PI / 2) + (RC.rng() - 0.5) * 2.2;
        const sp = 40 + RC.rng() * 150;
        this.emit({
          kind: "blood", x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40,
          g: 340, drag: 0.99, life: 0.5 + RC.rng() * 0.5, size: 1 + (RC.rng() < 0.45 ? 1 : 0),
          color: reds[(RC.rng() * reds.length) | 0], fade: false,
        });
      }
      // a quick puff of dark mist
      for (let i = 0; i < 5; i++)
        this.emit({ kind: "dust", x, y: y - 2, vx: (RC.rng() - 0.5) * 40, vy: -RC.rng() * 40,
          g: 60, drag: 0.9, life: 0.4, size: 2, color: "#5a0e16" });
    },

    // a lasting splat on the ground
    decal(x, y, size, color) {
      this.decals.push({ x, y, size: size || 3, color: color || "#7a1019", a: 0.85 });
      if (this.decals.length > this.maxDecals) this.decals.shift();
    },
    bloodPool(x, y) {
      const reds = ["#7a1019", "#5e0c14", "#8f1420"];
      for (let i = 0; i < 5; i++)
        this.decal(x + (RC.rng() - 0.5) * 14, y - RC.rng() * 2, 2 + RC.rng() * 3, reds[(RC.rng() * reds.length) | 0]);
    },

    drawDecals(ctx, cam) {
      for (let i = 0; i < this.decals.length; i++) {
        const d = this.decals[i];
        ctx.globalAlpha = d.a;
        ctx.fillStyle = d.color;
        const s = Math.round(d.size);
        ctx.fillRect(Math.round(d.x - cam.x - s / 2), Math.round(d.y - cam.y - 1), s, 2);
        if (s > 3) ctx.fillRect(Math.round(d.x - cam.x - 1), Math.round(d.y - cam.y - 2), 2, 3);
      }
      ctx.globalAlpha = 1;
    },

    update(dt) {
      const pool = this.pool;
      for (let i = 0; i < pool.length; i++) {
        const p = pool[i]; if (p.dead) continue;
        p.life += dt;
        if (p.life >= p.max) { p.dead = true; continue; }
        p.vy += p.g * dt;
        p.vx *= Math.pow(p.drag, dt * 60);
        p.vy *= Math.pow(p.drag, dt * 60);
        p.x += p.vx * dt; p.y += p.vy * dt;
        p.rot += p.vr * dt;
        p.size += p.grow * dt;
      }
    },

    draw(ctx, cam) {
      const pool = this.pool;
      for (let i = 0; i < pool.length; i++) {
        const p = pool[i]; if (p.dead) continue;
        const t = p.life / p.max;
        const a = p.fade ? (1 - t) : 1;
        const x = Math.round(p.x - cam.x), y = Math.round(p.y - cam.y);
        ctx.globalAlpha = a;
        switch (p.kind) {
          case "ring": {
            ctx.globalAlpha = a * 0.8;
            ctx.strokeStyle = p.color; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.arc(x, y, Math.max(1, p.size), 0, Math.PI * 2); ctx.stroke();
            break;
          }
          case "text": {
            RC.Font.draw(ctx, p.text, x, y, { align: "center", color: p.color, shadow: true, scale: 1 });
            break;
          }
          case "confetti": {
            ctx.save(); ctx.translate(x, y); ctx.rotate(p.rot);
            ctx.fillStyle = p.color; ctx.fillRect(-p.size, -p.size / 2, p.size * 2, p.size);
            ctx.restore();
            break;
          }
          case "spark": {
            ctx.fillStyle = p.color;
            ctx.fillRect(x, y, p.size + (t < 0.5 ? 1 : 0), p.size + (t < 0.5 ? 1 : 0));
            break;
          }
          case "blood": {
            ctx.globalAlpha = t > 0.8 ? (1 - t) / 0.2 : 1;
            ctx.fillStyle = p.color;
            ctx.fillRect(x, y, p.size, p.size);
            break;
          }
          default: { // dust
            ctx.fillStyle = p.color;
            const s = Math.max(1, Math.round(p.size * (1 - t * 0.4)));
            ctx.fillRect(x, y, s, s);
          }
        }
      }
      ctx.globalAlpha = 1;
    },
  };

})(window);
