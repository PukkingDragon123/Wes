/* =============================================================================
   minigames.js — the two satisfying mini-games:
     RC.Dive : dumpster diving — brush aside & fling trash to uncover food
     RC.Cook : cooking — a slide-and-drop stack that pieces the dish together
   Each is a self-contained state machine driven by game.js (states dive/cook).
   ========================================================================== */
(function (global) {
  "use strict";
  const RC = global.RC;
  const M = RC.M, P = RC.PAL, Font = RC.Font, Food = RC.Food;
  const A = () => RC.Audio, Pt = () => RC.Particles, L = () => RC.Level;
  const VW = RC.VIEW_W, VH = RC.VIEW_H;

  function panel(ctx, x, y, w, h, title, accent) {
    ctx.fillStyle = "rgba(6,6,16,0.82)"; ctx.fillRect(0, 0, VW, VH);
    ctx.fillStyle = "#141126"; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = accent || "#3a3466"; ctx.fillRect(x, y, w, 2); ctx.fillRect(x, y + h - 2, w, 2);
    ctx.fillStyle = "rgba(120,126,180,0.5)"; ctx.fillRect(x, y + 12, w, 1);
    if (title) Font.draw(ctx, title, x + w / 2, y + 4, { align: "center", color: accent || P.gold, scale: 1, tracking: 1 });
  }

  /* ======================================================================
     DUMPSTER DIVE
  ====================================================================== */
  const Dive = RC.Dive = {
    cols: 5, rows: 3,
    px: 78, py: 34, pw: 228, ph: 150,

    start(spot, game) {
      this.px = Math.round((VW - this.pw) / 2); this.py = Math.round((VH - this.ph) / 2) + 6;
      this.game = game; this.spot = spot; this.done = false; this.result = null;
      this.exiting = 0; this.t = 0; this.msg = ""; this.msgT = 0; this.moveCd = 0;
      this.cursor = this.cols + 2; this.noise = 0; this.flyers = []; this.found = [];
      const rng = RC.makeRng(((spot.cx * 13) | 0) ^ 0x51ed3a);
      this.cells = [];
      for (let i = 0; i < this.cols * this.rows; i++) this.cells.push({ trash: rng.int(1, 3), ing: null, seed: rng.int(0, 9999) });
      this.remaining = (spot.ingredients || []).slice();
      const idx = this.cells.map((_, i) => i);
      for (let i = idx.length - 1; i > 0; i--) { const j = rng.int(0, i); const t = idx[i]; idx[i] = idx[j]; idx[j] = t; }
      this.remaining.forEach((id, k) => { const c = this.cells[idx[k]]; c.ing = id; c.trash = Math.max(2, c.trash); });
      this.total = this.remaining.length;
      A().play("hide");
    },

    _cellRect(i) {
      const c = i % this.cols, r = (i / this.cols) | 0;
      const gx = this.px + 12, gy = this.py + 22, gw = this.pw - 24, gh = this.ph - 52;
      const cw = gw / this.cols, ch = gh / this.rows;
      return { x: gx + c * cw, y: gy + r * ch, w: cw, h: ch, cx: gx + c * cw + cw / 2, cy: gy + r * ch + ch / 2 };
    },

    update(dt, input) {
      this.t += dt; if (this.msgT > 0) this.msgT -= dt;
      for (const f of this.flyers) { f.vy += 620 * dt; f.x += f.vx * dt; f.y += f.vy * dt; f.rot += f.vr * dt; f.life -= dt; }
      this.flyers = this.flyers.filter((f) => f.life > 0);

      if (this.exiting > 0) { this.exiting -= dt; if (this.exiting <= 0) { this.done = true; this.result = { found: this.found.length }; } return; }

      // leave
      if (input.pressed("grab") || input.pressed("pause")) { this.done = true; this.result = { found: this.found.length }; return; }

      // cursor
      this.moveCd -= dt;
      const ax = input.axisX(), ay = input.axisY();
      if (this.moveCd <= 0 && (ax || ay)) {
        let c = this.cursor % this.cols, r = (this.cursor / this.cols) | 0;
        c = M.clamp(c + ax, 0, this.cols - 1); r = M.clamp(r + ay, 0, this.rows - 1);
        this.cursor = r * this.cols + c; this.moveCd = 0.13; A().play("select");
      }
      if (!ax && !ay) this.moveCd = 0;

      // dig
      if (input.pressed("jump") || input.pressed("throw") || input.pressed("action")) {
        const cell = this.cells[this.cursor], rc = this._cellRect(this.cursor);
        if (cell.trash > 0) {
          cell.trash--; this.noise = Math.min(100, this.noise + 8);
          const dir = rc.cx < VW / 2 ? -1 : 1;
          this.flyers.push({ x: rc.cx, y: rc.cy, vx: dir * (60 + RC.rng() * 90), vy: -150 - RC.rng() * 90, rot: 0, vr: (RC.rng() - 0.5) * 16, life: 1.3, type: (cell.seed + cell.trash) % 4 });
          A().play("thunk"); L().shake(0.6, 0.06);
          Pt().dust(rc.cx, rc.cy, 3, dir);
          if (cell.trash === 0 && cell.ing) {
            const id = cell.ing; cell.ing = null; this.found.push(id);
            this.game.addIngredient(id);
            Pt().spark(rc.cx, rc.cy, 12, P.goldHi); A().play("loot");
            this.msg = "FOUND " + Food.name(id) + "!"; this.msgT = 1.6;
            const ri = this.remaining.indexOf(id); if (ri >= 0) this.remaining.splice(ri, 1);
            const si = this.spot.ingredients.indexOf(id); if (si >= 0) this.spot.ingredients.splice(si, 1);
            if (this.remaining.length === 0) { this.msg = "CLEANED OUT!"; this.msgT = 2; this.exiting = 1.5; }
          }
        } else { A().play("step"); }
      }

      if (this.noise >= 100 && this.exiting <= 0) {
        this.msg = "TOO LOUD — SCRAM!"; this.msgT = 2; this.exiting = 1.1;
        if (this.game.alertNear) this.game.alertNear(this.spot.cx, this.spot.baseY);
      }
    },

    draw(ctx) {
      panel(ctx, this.px, this.py, this.pw, this.ph, null, "#67e0a3");
      // a little green dumpster as the "title"
      const tx = this.px + this.pw / 2, ty = this.py + 6;
      ctx.fillStyle = "#3f6b4a"; ctx.fillRect(tx - 8, ty, 16, 5); ctx.fillStyle = "#2c4c36"; ctx.fillRect(tx - 9, ty - 2, 18, 2);
      // cells
      for (let i = 0; i < this.cells.length; i++) {
        const cell = this.cells[i], rc = this._cellRect(i);
        // cell floor
        ctx.fillStyle = "#0f1a12"; ctx.fillRect(rc.x + 1, rc.y + 1, rc.w - 2, rc.h - 2);
        ctx.fillStyle = "#182a1c"; ctx.fillRect(rc.x + 1, rc.y + 1, rc.w - 2, 1);
        // revealed ingredient (glowing)
        if (cell.trash === 0 && cell.ing) {
          const gl = ctx.createRadialGradient(rc.cx, rc.cy, 1, rc.cx, rc.cy, 12);
          gl.addColorStop(0, "rgba(255,225,140,0.5)"); gl.addColorStop(1, "rgba(255,225,140,0)");
          ctx.fillStyle = gl; ctx.fillRect(rc.cx - 12, rc.cy - 12, 24, 24);
          Food.drawIngredient(ctx, rc.cx, rc.cy + Math.sin(this.t * 4) * 1, cell.ing, 2);
        }
        // trash pile (stack height)
        for (let tI = 0; tI < cell.trash; tI++) this._trash(ctx, rc.cx, rc.cy + 4 - tI * 4, (cell.seed + tI * 7) % 4);
        // cursor
        if (i === this.cursor) {
          const b = 0.5 + 0.5 * Math.sin(this.t * 8);
          ctx.strokeStyle = "rgba(120,224,163," + (0.6 + b * 0.4) + ")"; ctx.lineWidth = 1;
          ctx.strokeRect(Math.round(rc.x) + 1.5, Math.round(rc.y) + 1.5, Math.round(rc.w) - 3, Math.round(rc.h) - 3);
        }
      }
      // flying trash
      for (const f of this.flyers) {
        ctx.save(); ctx.translate(Math.round(f.x), Math.round(f.y)); ctx.rotate(f.rot);
        this._trash(ctx, 0, 0, f.type); ctx.restore();
      }
      // noise bar with a little ear/soundwave icon (no words)
      const bx = this.px + 20, by = this.py + this.ph - 20, bw = this.pw - 32;
      ctx.strokeStyle = "#8b90c8"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(this.px + 11, by + 2, 2.5, -0.6, 0.6); ctx.arc(this.px + 11, by + 2, 4, -0.7, 0.7); ctx.stroke();
      ctx.fillStyle = "#26243a"; ctx.fillRect(bx, by, bw, 5);
      const nc = this.noise > 70 ? P.bad : this.noise > 40 ? P.detect : P.good;
      ctx.fillStyle = nc; ctx.fillRect(bx, by, bw * this.noise / 100, 5);
      // remaining food shown as ingredient icons
      for (let i = 0; i < this.remaining.length; i++) Food.drawIngredient(ctx, this.px + this.pw - 8 - i * 10, this.py + 7, this.remaining[i], 1);
    },

    _trash(ctx, x, y, type) {
      x = Math.round(x); y = Math.round(y);
      if (type === 0) { ctx.fillStyle = "#7a5a3a"; ctx.fillRect(x - 3, y - 2, 6, 4); ctx.fillStyle = "#9a744a"; ctx.fillRect(x - 3, y - 2, 6, 1); } // cardboard
      else if (type === 1) { ctx.fillStyle = "#526673"; ctx.fillRect(x - 2, y - 3, 4, 6); ctx.fillStyle = "#cfd6ff"; ctx.fillRect(x - 2, y - 3, 4, 1); ctx.fillStyle = "#3b4a55"; ctx.fillRect(x - 1, y - 2, 1, 4); } // can
      else if (type === 2) { ctx.fillStyle = "#c9c3a0"; ctx.fillRect(x - 3, y - 2, 6, 3); ctx.fillStyle = "#e6e0c0"; ctx.fillRect(x - 2, y - 3, 3, 2); } // paper
      else { ctx.fillStyle = "#5a8c4a"; ctx.fillRect(x - 3, y - 1, 6, 2); ctx.fillStyle = "#3a6b2a"; ctx.fillRect(x - 3, y - 1, 2, 2); ctx.fillStyle = "#7fae5a"; ctx.fillRect(x + 1, y - 2, 2, 2); } // peel
    },
  };

  /* ======================================================================
     COOKING — slide the piece, drop it, stack the dish
  ====================================================================== */
  const Cook = RC.Cook = {
    px: 92, py: 30, pw: 200, ph: 156,

    start(recipe, kid, game) {
      this.px = Math.round((VW - this.pw) / 2); this.py = Math.round((VH - this.ph) / 2);
      this.game = game; this.recipe = recipe; this.kid = kid; this.done = false; this.result = null;
      this.pieces = recipe.ing.slice(); this.idx = 0; this.placed = [];
      this.dir = 1; this.cursorX = 0; this.speed = 82; this.range = 66;
      this.qualitySum = 0; this.mode = "play"; this.endT = 0; this.grade = ""; this.t = 0;
      this.plateX = this.px + this.pw / 2; this.plateY = this.py + this.ph - 30;
    },

    update(dt, input) {
      this.t += dt;
      if (this.mode === "serve") {
        this.endT -= dt;
        if (this.endT <= 0) { this.done = true; this.result = { fed: true, grade: this.grade }; }
        return;
      }
      if (input.pressed("pause") || input.pressed("grab")) { this.done = true; this.result = { cancelled: true }; return; }

      this.cursorX += this.dir * this.speed * dt;
      if (this.cursorX > this.range) { this.cursorX = this.range; this.dir = -1; }
      if (this.cursorX < -this.range) { this.cursorX = -this.range; this.dir = 1; }

      if (input.pressed("jump") || input.pressed("throw") || input.pressed("action")) {
        const prev = this.placed.length ? this.placed[this.placed.length - 1].x : 0;
        const off = this.cursorX;
        const err = Math.abs(off - prev);
        this.placed.push({ id: this.pieces[this.idx], x: off });
        this.qualitySum += Math.max(0, 1 - err / 55);
        if (err < 8) { A().play("loot"); Pt().spark(this.plateX + off, this.plateY - this.placed.length * 6, 8, P.goldHi); }
        else { A().play("pickup"); }
        L().shake(0.8, 0.08);
        this.idx++; this.speed += 14;
        if (this.idx >= this.pieces.length) {
          const q = this.qualitySum / this.pieces.length;
          this.grade = q > 0.85 ? "PERFECT!" : q > 0.6 ? "TASTY!" : "EDIBLE";
          this.gradeStars = q > 0.85 ? 3 : q > 0.6 ? 2 : 1;
          this.mode = "serve"; this.endT = 2.4; A().play("win");
          if (this.kid) this.kid.celebrate = 2.4;
        }
      }
    },

    draw(ctx) {
      panel(ctx, this.px, this.py, this.pw, this.ph, null, P.gold);
      // dish icon as the "title"
      Food.drawDish(ctx, this.px + this.pw / 2, this.py + 5, this.recipe, 1);
      // the kid watching, hungry -> happy
      if (this.kid) this.kid.critter.draw(ctx, this.px + 22, this.py + this.ph - 8, { zoom: 1.1 });
      // recipe ingredients (right column, icons only)
      for (let i = 0; i < this.recipe.ing.length; i++)
        Food.drawIngredient(ctx, this.px + this.pw - 30, this.py + 26 + i * 12, this.recipe.ing[i], 1);

      // plate + stack
      ctx.fillStyle = "#cfd2e2"; ctx.fillRect(this.plateX - 16, this.plateY, 32, 3);
      ctx.fillStyle = "#eef0fb"; ctx.fillRect(this.plateX - 16, this.plateY, 32, 1);
      for (let i = 0; i < this.placed.length; i++) {
        const pc = this.placed[i];
        Food.drawIngredient(ctx, this.plateX + pc.x, this.plateY - 4 - i * 6, pc.id, 2);
      }
      // target guide line
      ctx.fillStyle = "rgba(120,126,180,0.4)"; ctx.fillRect(this.plateX - 1, this.py + 20, 2, this.ph - 54);

      if (this.mode === "play") {
        // current sliding piece up top
        const y = this.py + 24;
        Food.drawIngredient(ctx, this.plateX + this.cursorX, y, this.pieces[this.idx], 2);
        // drop trail
        ctx.fillStyle = "rgba(255,255,255,0.12)"; ctx.fillRect(this.plateX + this.cursorX - 1, y + 6, 2, this.plateY - y - 8);
        // stack progress as pips (no words)
        for (let i = 0; i < this.pieces.length; i++) {
          ctx.fillStyle = i < this.idx ? P.gold : "#3a3f5e";
          ctx.fillRect(this.plateX - this.pieces.length * 4 + i * 8, this.py + 16, 5, 3);
        }
      } else {
        // served! dish + star rating + a heart (no words)
        Food.drawDish(ctx, this.plateX, this.plateY - 2, this.recipe, 2);
        for (let i = 0; i < 3; i++) {
          ctx.fillStyle = i < (this.gradeStars || 1) ? P.gold : "#3a3f5e";
          const sx = VW / 2 + (i - 1) * 12, sy = this.py + 30;
          ctx.beginPath();
          for (let k = 0; k < 5; k++) { const a = -Math.PI / 2 + k * (Math.PI * 2 / 5); k ? ctx.lineTo(sx + Math.cos(a) * 4, sy + Math.sin(a) * 4) : ctx.moveTo(sx + Math.cos(a) * 4, sy + Math.sin(a) * 4); const a2 = a + Math.PI / 5; ctx.lineTo(sx + Math.cos(a2) * 1.7, sy + Math.sin(a2) * 1.7); }
          ctx.closePath(); ctx.fill();
        }
        if ((this.t * 6 | 0) % 3 === 0) Pt().emit({ kind: "spark", x: this.px + 22 + (Math.random() - 0.5) * 10, y: this.py + this.ph - 20, vy: -30, life: 0.7, color: P.bad, size: 1 });
      }
    },
  };

})(window);
