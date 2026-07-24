/* =============================================================================
   player.js — the raccoon. Momentum-based, "bouncy" Celeste-like movement:
   variable jump height, coyote time, jump buffering, wall slide, wall jump,
   stamina-based wall climbing, squash & stretch, and dust juice.
   Interactions (loot / hide / throw) are driven by game.js which sets flags
   and calls the small API at the bottom.
   ========================================================================== */
(function (global) {
  "use strict";
  const RC = global.RC;
  const M = RC.M, T = RC.TILE, L = () => RC.Level, Pt = () => RC.Particles, A = () => RC.Audio;

  // --- tuned constants (pixels & seconds) --------------------------------
  const C = {
    W: 12, H: 14,
    MAXHP: 4, IFRAMES: 1.05, ATK_DUR: 0.16, ATK_CD: 0.28,
    DASH_SPEED: 305, DASH_DUR: 0.15, DASH_CD: 0.42,
    SOUL_MAX: 99, FOCUS_COST: 33, FOCUS_TIME: 0.8, SOUL_PER_HIT: 26,
    GRAV: 900, GRAV_HOLD: 560, MAX_FALL: 330, FAST_FALL: 470,
    RUN: 108, ACCEL_G: 950, ACCEL_A: 680, FRIC_G: 1150, FRIC_A: 300,
    JUMP_VY: -292, JUMP_CUT: 0.42,
    COYOTE: 0.09, BUFFER: 0.11,
    WALL_SLIDE: 52, WALL_SLIDE_FAST: 140,
    WJ_VX: 158, WJ_VY: -286, WJ_LOCK: 0.16,
    CLIMB_UP: 66, CLIMB_DOWN: 94,
    STAM_MAX: 1.95, ST_STILL: 0.30, ST_UP: 1.05, ST_DOWN: 0.55, ST_SLIDE: 0.32, ST_WJ: 0.22,
  };

  function Player(x, y, game) {
    this.game = game;
    this.w = C.W; this.h = C.H;
    this.x = x - this.w / 2;
    this.y = y - this.h;
    this.vx = 0; this.vy = 0;
    this.dir = 1;
    this.grounded = true; this.wasGrounded = true;
    this.wallDir = 0;             // -1 wall on left, +1 right, 0 none
    this.grabbing = false;
    this.stam = C.STAM_MAX;
    this.coyote = 0; this.buffer = 0; this.lock = 0; this.dropTimer = 0;
    this.sx = 1; this.sy = 1;
    this.animT = 0; this.state = "idle";
    this.stepAcc = 0; this.slideAcc = 0; this.blinkT = RC.rng() * 4;
    this.blink = false;
    this.hidden = false; this.hideSpot = null;
    this.carry = null; this.throwT = 1;
    this.dead = false; this.exiting = false;
    this.faceLockT = 0;
    this.jumpHeld = false;
    this.expr = "neutral";
    this.hp = C.MAXHP; this.maxHp = C.MAXHP;
    this.iframes = 0; this.atk = 0; this.atkT = 0; this.atkDir = "side"; this.atkHit = null;
    this.soul = 0; this.soulMax = C.SOUL_MAX;
    this.dashT = 0; this.dashCd = 0; this.dashDir = 1;
    this.focusT = 0; this.focusing = false; this._tapL = 9; this._tapR = 9;
    this.critter = new RC.Critter("raccoon");
  }

  Player.prototype.center = function () { return { x: this.x + this.w / 2, y: this.y + this.h / 2 }; };
  Player.prototype.cx = function () { return this.x + this.w / 2; };
  Player.prototype.cy = function () { return this.y + this.h / 2; };
  Player.prototype.feetY = function () { return this.y + this.h; };

  // --- collision helpers -------------------------------------------------
  Player.prototype._solidAt = function (nx, ny) { return L().rectSolid(nx, ny, this.w, this.h); };

  Player.prototype._moveX = function (dx) {
    this.x += dx;
    if (this._solidAt(this.x, this.y)) {
      const st = dx > 0 ? -1 : 1;
      let guard = 0;
      while (this._solidAt(this.x, this.y) && guard++ < 64) this.x += st;
      this.vx = 0;
      return true;
    }
    return false;
  };

  Player.prototype._moveY = function (dy) {
    const prevBottom = this.y + this.h;
    this.y += dy;
    // one-way platforms: only when moving down and not dropping through
    if (dy > 0 && this.dropTimer <= 0) {
      const newBottom = this.y + this.h;
      const tyA = Math.floor(prevBottom / T), tyB = Math.floor((newBottom - 0.001) / T);
      const x0 = Math.floor(this.x / T), x1 = Math.floor((this.x + this.w - 1) / T);
      for (let ty = tyA; ty <= tyB; ty++) {
        const top = ty * T;
        if (top + 0.001 >= prevBottom && top <= newBottom) {
          let hit = false;
          for (let tx = x0; tx <= x1; tx++) if (L().oneway(tx, ty)) { hit = true; break; }
          if (hit) { this.y = top - this.h; this.vy = 0; return true; }
        }
      }
    }
    if (this._solidAt(this.x, this.y)) {
      const st = dy > 0 ? -1 : 1;
      let guard = 0;
      while (this._solidAt(this.x, this.y) && guard++ < 64) this.y += st;
      this.vy = 0;
      return true;
    }
    return false;
  };

  Player.prototype._detectContacts = function () {
    // grounded (solid or resting on one-way)
    let g = this._solidAt(this.x, this.y + 1);
    if (!g) {
      const fb = this.y + this.h, ty = Math.floor(fb / T);
      if (Math.abs(ty * T - fb) < 1.6) {
        const x0 = Math.floor(this.x / T), x1 = Math.floor((this.x + this.w - 1) / T);
        for (let tx = x0; tx <= x1; tx++) if (L().oneway(tx, ty)) { g = true; break; }
      }
    }
    this.grounded = g;
    // wall (shrunk vertical span so floors/ceilings don't register)
    const left = L().rectSolid(this.x - 1, this.y + 3, this.w, this.h - 6);
    const right = L().rectSolid(this.x + 1, this.y + 3, this.w, this.h - 6);
    if (left && !right) this.wallDir = -1;
    else if (right && !left) this.wallDir = 1;
    else if (left && right) this.wallDir = this.dir; // pinched: keep facing
    else this.wallDir = 0;
  };

  // --- main update -------------------------------------------------------
  Player.prototype.update = function (dt, input) {
    this.animT += dt;
    this.throwT = Math.min(1, this.throwT + dt * 6);
    if (this.faceLockT > 0) this.faceLockT -= dt;
    if (this.iframes > 0) this.iframes -= dt;
    if (this.atk > 0) this.atk -= dt;
    if (this.atkT > 0) this.atkT -= dt;

    // blink timer
    this.blinkT -= dt;
    if (this.blinkT <= 0) { this.blink = true; if (this.blinkT < -0.11) { this.blink = false; this.blinkT = 2 + RC.rng() * 3; } }

    if (this.hidden || this.dead || this.exiting) {
      this._easeScale(dt);
      this._updateCritter(dt);
      return;
    }

    const ax = input.axisX();
    const ay = input.axisY();

    // attack
    if (input.pressed("attack") && this.atkT <= 0 && !this.grabbing) this._startAttack(input);

    // dash (double-tap a direction, or the dash key)
    if (this.dashCd > 0) this.dashCd -= dt;
    this._tapL += dt; this._tapR += dt;
    if (input.pressed("left")) { if (this._tapL < 0.26) this._dash(-1); this._tapL = 0; }
    if (input.pressed("right")) { if (this._tapR < 0.26) this._dash(1); this._tapR = 0; }
    if (input.pressed("dash")) this._dash(this.dir);

    // active dash overrides normal movement
    if (this.dashT > 0) {
      this.dashT -= dt; this.vx = this.dashDir * C.DASH_SPEED; this.vy = 0;
      this.iframes = Math.max(this.iframes, this.dashT + 0.02);
      Pt().emit({ kind: "dust", x: this.cx() - this.dashDir * 4, y: this.cy(), vx: -this.dashDir * 20, vy: 0, g: 0, drag: 0.85, life: 0.22, size: 2, color: "#8b90c8" });
      this._moveX(this.vx * dt);
      this._detectContacts();
      if (this.grounded && this.vy > 0) this.vy = 0;
      this._easeScale(dt); this._pickState(ax, ay); this._updateCritter(dt);
      return;
    }

    // focus / heal — hold GRAB while grounded, still, away from a wall
    this.focusing = false;
    if (input.is("grab") && this.grounded && this.wallDir === 0 && this.atk <= 0 &&
      Math.abs(this.vx) < 34 && this.soul >= C.FOCUS_COST && this.hp < this.maxHp && !input.pressed("jump")) {
      this.focusing = true; this.focusT += dt; this.vx = M.approach(this.vx, 0, 1400 * dt);
      if (Math.random() < 0.5) Pt().emit({ kind: "dust", x: this.cx() + (Math.random() - 0.5) * 10, y: this.feetY() - 2, vx: 0, vy: -34, g: -10, drag: 0.98, life: 0.5, size: 1, color: "#eaf0ff" });
      if (this.focusT >= C.FOCUS_TIME) {
        this.hp = Math.min(this.maxHp, this.hp + 1); this.soul -= C.FOCUS_COST; this.focusT = 0;
        this.iframes = Math.max(this.iframes, 0.5); RC.Audio.play("heal");
        Pt().ring(this.cx(), this.cy(), "#eaf0ff", 34); Pt().spark(this.cx(), this.cy(), 12, "#eaf0ff");
      }
    }
    if (!this.focusing) this.focusT = 0;

    // timers
    this.coyote = this.grounded ? C.COYOTE : Math.max(0, this.coyote - dt);
    if (input.pressed("jump")) this.buffer = C.BUFFER; else this.buffer = Math.max(0, this.buffer - dt);
    if (this.lock > 0) this.lock -= dt;
    if (this.dropTimer > 0) this.dropTimer -= dt;

    // drop through one-way: down + jump while grounded on one-way
    if (this.grounded && ay > 0 && input.pressed("jump")) { this.dropTimer = 0.12; this.buffer = 0; }

    // ---- wall grab / climb ----
    const grabHeld = input.is("grab");
    const canGrab = grabHeld && !this.grounded && this.wallDir !== 0 && this.stam > 0
      && ((this.wallDir < 0 && ax <= 0) || (this.wallDir > 0 && ax >= 0) || true);
    this.grabbing = false;
    if (canGrab) {
      this.grabbing = true;
      this.dir = this.wallDir;      // face the wall
      this.faceLockT = 0.05;
      this.vx = 0;
      if (ay < 0) { this.vy = -C.CLIMB_UP; this.stam -= C.ST_UP * dt; }
      else if (ay > 0) { this.vy = C.CLIMB_DOWN; this.stam -= C.ST_DOWN * dt; }
      else { this.vy = 0; this.stam -= C.ST_STILL * dt; }
      // climb dust + tick
      this.slideAcc += dt;
      if (ay !== 0 && this.slideAcc > 0.14) { this.slideAcc = 0; A().play("climb"); Pt().trail(this.cx() + this.wallDir * 5, this.cy(), "#c9c3e6"); }
      if (this.stam < 0) this.stam = 0;
    }

    // ---- horizontal movement (unless wall-locked or grabbing) ----
    if (!this.grabbing && this.lock <= 0 && !this.focusing) {
      const accel = this.grounded ? C.ACCEL_G : C.ACCEL_A;
      const fric = this.grounded ? C.FRIC_G : C.FRIC_A;
      if (ax !== 0) {
        this.vx = M.approach(this.vx, ax * C.RUN, accel * dt);
        if (this.faceLockT <= 0) this.dir = ax;
      } else {
        this.vx = M.approach(this.vx, 0, fric * dt);
      }
    }

    // ---- gravity / wall slide ----
    if (!this.grabbing) {
      const rising = this.vy < 0;
      const gravNow = (rising && input.is("jump")) ? C.GRAV_HOLD : C.GRAV;
      this.vy += gravNow * dt;
      // wall slide when pressing into a wall in the air
      const pressingWall = this.wallDir !== 0 && ((this.wallDir < 0 && ax < 0) || (this.wallDir > 0 && ax > 0));
      if (!this.grounded && pressingWall && this.vy > 0) {
        const cap = ay > 0 ? C.WALL_SLIDE_FAST : C.WALL_SLIDE;
        if (this.vy > cap) this.vy = M.approach(this.vy, cap, 900 * dt);
        this.slideAcc += dt;
        if (this.slideAcc > 0.08) { this.slideAcc = 0; Pt().trail(this.cx() + this.wallDir * 5, this.cy() + 4, "#b7b1d6"); }
      }
      const maxFall = ay > 0 ? C.FAST_FALL : C.MAX_FALL;
      if (this.vy > maxFall) this.vy = maxFall;
    }

    // ---- jump / wall jump ----
    if (this.buffer > 0) {
      if (this.grounded || this.coyote > 0) {
        this._jump(); this.buffer = 0; this.coyote = 0;
      } else if (this.wallDir !== 0) {
        this._wallJump(); this.buffer = 0;
      }
    }
    // variable height: releasing jump while rising cuts velocity
    if (input.released("jump") && this.vy < 0) this.vy *= C.JUMP_CUT;

    // ---- integrate + collide ----
    this.wasGrounded = this.grounded;
    const prevVy = this.vy;
    this._moveX(this.vx * dt);
    const hitY = this._moveY(this.vy * dt);
    this._detectContacts();
    if (this.grounded && this.vy > 0) this.vy = 0;

    // landing
    if (this.grounded && !this.wasGrounded && prevVy > 60) {
      const power = M.sat((prevVy - 60) / 300);
      this.sx = 1 + power * 0.5; this.sy = 1 - power * 0.4;
      Pt().landDust(this.cx(), this.feetY(), power);
      A().play("land");
      if (power > 0.5) L().shake(2.5 * power, 0.18);
    }
    if (this.grounded) this.stam = C.STAM_MAX;

    // new wall grab sfx
    if (this.grabbing && !this._wasGrabbing) A().play("wallgrab");
    this._wasGrabbing = this.grabbing;

    // running dust + footsteps
    if (this.grounded && Math.abs(this.vx) > 30) {
      this.stepAcc += Math.abs(this.vx) * dt;
      if (this.stepAcc > 26) {
        this.stepAcc = 0;
        Pt().dust(this.cx() - this.dir * 4, this.feetY(), 2, -this.dir);
        A().play("step");
      }
    }

    this._easeScale(dt);
    this._pickState(ax, ay);
    this._updateCritter(dt);
  };

  Player.prototype._updateCritter = function (dt) {
    const st = this.dead ? "hurt" : (this.atk > 0 ? "attack" : this.state);
    let expr = this.atk > 0 ? "determined" : (this.iframes > 0.55 ? "scared" : this.expr);
    if (!this.dead && this.atk <= 0 && (this.state === "climb" || this.state === "wall")) expr = "determined";
    const lookY = this.vy > 80 ? 0.5 : (this.vy < -80 ? -0.4 : 0);
    this.critter.update(dt, {
      vx: this.vx, vy: this.vy, grounded: this.grounded, dir: this.dir,
      state: st, atkDir: this.atkDir, carry: this.carry, throwT: this.throwT,
      expr: expr, look: { x: this.dir * 0.4, y: lookY }, blink: this.blink,
    });
  };

  Player.prototype._jump = function () {
    this.vy = C.JUMP_VY;
    this.sx = 0.72; this.sy = 1.34;
    Pt().dust(this.cx(), this.feetY(), 5, 0);
    A().play("jump");
  };

  Player.prototype._wallJump = function () {
    const away = -this.wallDir;
    this.vx = away * C.WJ_VX;
    this.vy = C.WJ_VY;
    this.dir = away; this.faceLockT = C.WJ_LOCK + 0.02;
    this.lock = C.WJ_LOCK;
    this.stam = Math.max(0, this.stam - C.ST_WJ);
    this.sx = 0.8; this.sy = 1.28;
    Pt().dust(this.cx() + this.wallDir * 4, this.cy() + 4, 6, away);
    A().play("jump");
    L().shake(1.4, 0.12);
  };

  Player.prototype._startAttack = function (input) {
    this.atk = C.ATK_DUR; this.atkT = C.ATK_CD; this.atkHit = {};
    if (input.is("up")) this.atkDir = "up";
    else if (input.is("down") && !this.grounded) this.atkDir = "down";
    else this.atkDir = "side";
    if (this.atkDir === "side") { const a = input.axisX(); if (a) this.dir = a; this.faceLockT = 0.12; this.vx += this.dir * 46; this.sx = 1.25; this.sy = 0.85; }
    else { this.sy = 1.25; this.sx = 0.85; }
    RC.Audio.play("slash");
    Pt().spark(this.cx() + (this.atkDir === "side" ? this.dir * 12 : 0), this.cy() + (this.atkDir === "down" ? 12 : this.atkDir === "up" ? -12 : 0), 3, "#e6ecff");
  };

  Player.prototype._dash = function (d) {
    if (this.dashCd > 0 || this.dashT > 0 || this.hidden || this.dead || this.focusing) return;
    this.dashT = C.DASH_DUR; this.dashCd = C.DASH_CD; this.dashDir = d; this.dir = d; this.faceLockT = C.DASH_DUR + 0.02;
    this.vx = d * C.DASH_SPEED; this.vy = 0; this.sx = 1.45; this.sy = 0.66;
    this.iframes = Math.max(this.iframes, C.DASH_DUR + 0.03);
    RC.Audio.play("dash");
  };

  Player.prototype.getSlashBox = function () {
    const cx = this.cx(), cy = this.cy();
    if (this.atkDir === "up") return { x: cx - 11, y: this.y - 20, w: 22, h: 22 };
    if (this.atkDir === "down") return { x: cx - 11, y: this.y + this.h, w: 22, h: 22 };
    return { x: this.dir > 0 ? this.x + this.w - 3 : this.x - 24, y: cy - 10, w: 27, h: 20 };
  };

  Player.prototype.hurt = function (dmg, fromX) {
    if (this.iframes > 0 || this.dead || this.hidden || this.exiting) return false;
    this.hp -= dmg; this.iframes = C.IFRAMES;
    const away = fromX == null ? -this.dir : (this.cx() < fromX ? -1 : 1);
    this.vx = away * 205; this.vy = -172; this.lock = 0.26; this.grabbing = false;
    this.sx = 1.35; this.sy = 0.68;
    RC.Audio.play("hurt"); Pt().spark(this.cx(), this.cy(), 9, "#ff5d6c"); Pt().blood(this.cx(), this.cy(), away, 6);
    RC.Level.shake(3.8, 0.32);
    return true;
  };

  Player.prototype._easeScale = function (dt) {
    this.sx = M.damp(this.sx, 1, 16, dt);
    this.sy = M.damp(this.sy, 1, 16, dt);
  };

  Player.prototype._pickState = function (ax, ay) {
    if (this.hidden) { this.state = "hide"; return; }
    if (this.carry && this.grounded && Math.abs(this.vx) < 20) { this.state = "carry"; return; }
    if (this.grabbing) { this.state = (ay !== 0) ? "climb" : "wall"; return; }
    if (!this.grounded) {
      const pressingWall = this.wallDir !== 0 && ((this.wallDir < 0 && ax < 0) || (this.wallDir > 0 && ax > 0));
      if (pressingWall && this.vy > 0) { this.state = "wall"; return; }
      this.state = this.vy < 0 ? "jump" : "fall"; return;
    }
    if (ay > 0 && Math.abs(this.vx) < 20) { this.state = "crouch"; return; }
    this.state = Math.abs(this.vx) > 24 ? "run" : "idle";
  };

  // --- interaction API (called by game.js) ------------------------------
  Player.prototype.enterHide = function (spot) {
    this.hidden = true; this.hideSpot = spot;
    this.vx = 0; this.vy = 0;
    if (spot) { this.x = spot.x - this.w / 2; this.y = spot.y - this.h; }
    A().play("hide");
  };
  Player.prototype.exitHide = function () {
    if (!this.hidden) return;
    this.hidden = false; this.hideSpot = null;
    this.vy = -120; this.sx = 0.8; this.sy = 1.25;
    A().play("unhide");
    Pt().poof(this.cx(), this.cy());
  };
  Player.prototype.doThrow = function () {
    if (!this.carry) return null;
    const type = this.carry; this.carry = null;
    this.throwT = 0; this.state = "throw";
    A().play("throw");
    const item = { type, x: this.cx() + this.dir * 8, y: this.cy() - 4, vx: this.dir * 190, vy: -150 };
    return item;
  };

  // --- draw --------------------------------------------------------------
  Player.prototype.draw = function (ctx, cam) {
    if (this.hidden) return;             // the hide-spot wobble is drawn instead
    const x = this.cx() - cam.x;
    const y = this.feetY() - cam.y;
    if (!this.dead) RC.Sprites.shadow(ctx, x, this.feetY() - cam.y + 1, this.w + 6, this.grounded ? 0.3 : 0.16);
    // focus-heal glow
    if (this.focusing) {
      const t = this.focusT / C.FOCUS_TIME, cy2 = this.cy() - cam.y;
      ctx.save(); ctx.globalCompositeOperation = "lighter";
      const gr = ctx.createRadialGradient(x, cy2, 1, x, cy2, 15 + t * 7);
      gr.addColorStop(0, "rgba(230,236,255," + (0.25 + t * 0.4) + ")"); gr.addColorStop(1, "rgba(230,236,255,0)");
      ctx.fillStyle = gr; ctx.fillRect(x - 24, cy2 - 24, 48, 48); ctx.restore();
    }
    // i-frame flicker
    if (!(this.iframes > 0 && Math.floor(this.iframes * 22) % 2 === 0)) {
      this.critter.draw(ctx, x, y, { sx: this.sx, sy: this.sy });
    }
    // slash arc VFX
    if (this.atk > 0) {
      const a = Math.max(0, this.atk / C.ATK_DUR);
      ctx.save(); ctx.globalAlpha = a * 0.85; ctx.strokeStyle = "#e6ecff"; ctx.lineWidth = 2;
      ctx.beginPath();
      if (this.atkDir === "up") ctx.arc(x, this.y - cam.y, 16, Math.PI * 1.18, Math.PI * 1.82);
      else if (this.atkDir === "down") ctx.arc(x, this.feetY() - cam.y, 16, Math.PI * 0.18, Math.PI * 0.82);
      else ctx.arc(x, this.cy() - cam.y, 18, this.dir > 0 ? -0.95 : Math.PI - 0.95, this.dir > 0 ? 0.95 : Math.PI + 0.95);
      ctx.stroke(); ctx.globalAlpha = 1; ctx.restore();
    }
  };

  RC.Player = Player;
  RC.PlayerConfig = C;

})(window);
