/* =============================================================================
   audio.js — 100% procedural Web Audio. Lo-fi night music + all SFX.
   No files: everything is synthesized. Must be resumed from a user gesture.
   ========================================================================== */
(function (global) {
  "use strict";
  const RC = global.RC;

  const Audio = RC.Audio = {
    ctx: null,
    master: null, musicBus: null, sfxBus: null,
    enabled: true,
    ready: false,
    intensity: 0,          // 0 calm .. 1 alert (drives music tension)
    _targetIntensity: 0,
    _heli: null,
    _sched: null,
    _step: 0,
    _nextTime: 0,
    _bpm: 74,

    init() {
      if (this.ctx) return;
      const AC = global.AudioContext || global.webkitAudioContext;
      if (!AC) { this.enabled = false; return; }
      const ctx = this.ctx = new AC();
      this.master = ctx.createGain();
      this.master.gain.value = 0.9;
      this.master.connect(ctx.destination);

      this.musicBus = ctx.createGain(); this.musicBus.gain.value = 0.0;
      this.sfxBus = ctx.createGain();   this.sfxBus.gain.value = 0.95;

      // gentle master lowpass so nothing is harsh
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass"; lp.frequency.value = 8200; lp.Q.value = 0.3;
      this.musicBus.connect(lp); this.sfxBus.connect(lp); lp.connect(this.master);

      this.ready = true;
    },

    resume() {
      if (!this.ctx) this.init();
      if (this.ctx && this.ctx.state === "suspended") this.ctx.resume();
    },

    setEnabled(on) {
      this.enabled = on;
      if (this.master) this.master.gain.value = on ? 0.9 : 0.0;
    },
    toggle() { this.setEnabled(!this.enabled); return this.enabled; },

    // ---- low-level voice helpers ---------------------------------------
    _midi(n) { return 440 * Math.pow(2, (n - 69) / 12); },

    _blip(freq, t, dur, type, peak, dest, glideTo) {
      const c = this.ctx; if (!c) return;
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = type || "square";
      o.frequency.setValueAtTime(freq, t);
      if (glideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, glideTo), t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(dest || this.sfxBus);
      o.start(t); o.stop(t + dur + 0.02);
    },

    _noise(t, dur, peak, dest, cutoff, type) {
      const c = this.ctx; if (!c) return;
      const n = Math.max(1, Math.floor(c.sampleRate * dur));
      const buf = c.createBuffer(1, n, c.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1);
      const src = c.createBufferSource(); src.buffer = buf;
      const f = c.createBiquadFilter(); f.type = type || "lowpass"; f.frequency.value = cutoff || 1800;
      const g = c.createGain();
      g.gain.setValueAtTime(peak, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(f); f.connect(g); g.connect(dest || this.sfxBus);
      src.start(t); src.stop(t + dur + 0.02);
      return { src, f, g };
    },

    // ---- named SFX ------------------------------------------------------
    play(name, opt) {
      if (!this.enabled || !this.ready) return;
      const c = this.ctx; const t = c.currentTime + 0.001;
      switch (name) {
        case "jump":
          this._blip(360, t, 0.16, "square", 0.16, this.sfxBus, 620); break;
        case "doublejump":
          this._blip(520, t, 0.16, "triangle", 0.15, this.sfxBus, 880); break;
        case "land":
          this._noise(t, 0.10, 0.28, this.sfxBus, 900);
          this._blip(120, t, 0.10, "sine", 0.18, this.sfxBus, 70); break;
        case "step":
          this._noise(t, 0.045, 0.06, this.sfxBus, 2600, "bandpass"); break;
        case "climb":
          this._noise(t, 0.06, 0.05, this.sfxBus, 1500); break;
        case "wallgrab":
          this._noise(t, 0.07, 0.09, this.sfxBus, 1200); break;
        case "loot": {
          this._blip(880, t, 0.09, "square", 0.13, this.sfxBus);
          this._blip(1320, t + 0.06, 0.14, "square", 0.12, this.sfxBus);
          break; }
        case "food":
          this._blip(300, t, 0.14, "triangle", 0.15, this.sfxBus, 520); break;
        case "pickup":
          this._blip(240, t, 0.09, "square", 0.12, this.sfxBus, 360); break;
        case "throw":
          this._noise(t, 0.22, 0.14, this.sfxBus, 3200, "bandpass");
          this._blip(700, t, 0.2, "sawtooth", 0.05, this.sfxBus, 180); break;
        case "thunk":
          this._noise(t, 0.14, 0.3, this.sfxBus, 700);
          this._blip(90, t, 0.16, "sine", 0.22, this.sfxBus, 55);
          this._blip(300, t + 0.01, 0.12, "square", 0.06, this.sfxBus, 200); break;
        case "hide":
          this._noise(t, 0.20, 0.13, this.sfxBus, 900, "lowpass");
          this._blip(220, t, 0.18, "sine", 0.08, this.sfxBus, 120); break;
        case "unhide":
          this._blip(160, t, 0.16, "sine", 0.08, this.sfxBus, 260); break;
        case "suspect":
          this._blip(660, t, 0.12, "triangle", 0.12, this.sfxBus, 760);
          this._blip(760, t + 0.1, 0.14, "triangle", 0.12, this.sfxBus); break;
        case "spotted":
          this._blip(880, t, 0.16, "sawtooth", 0.18, this.sfxBus, 840);
          this._blip(587, t + 0.02, 0.28, "square", 0.16, this.sfxBus);
          this._blip(415, t + 0.02, 0.30, "square", 0.14, this.sfxBus); break;
        case "caught":
          this._blip(220, t, 0.5, "sawtooth", 0.2, this.sfxBus, 70);
          this._noise(t, 0.4, 0.2, this.sfxBus, 600); break;
        case "bad":
          this._blip(150, t, 0.18, "square", 0.14, this.sfxBus, 90); break;
        case "splat":
          this._noise(t, 0.14, 0.34, this.sfxBus, 1400, "lowpass");
          this._blip(140, t, 0.12, "sawtooth", 0.16, this.sfxBus, 60);
          this._noise(t + 0.02, 0.2, 0.16, this.sfxBus, 700); break;
        case "select":
          this._blip(520, t, 0.06, "square", 0.09, this.sfxBus); break;
        case "confirm":
          this._blip(520, t, 0.08, "square", 0.12, this.sfxBus);
          this._blip(780, t + 0.06, 0.12, "square", 0.12, this.sfxBus); break;
        case "checkpoint": {
          [659, 784, 988, 1319].forEach((f, i) =>
            this._blip(f, t + i * 0.07, 0.22, "triangle", 0.12, this.sfxBus));
          break; }
        case "win": {
          [523, 659, 784, 1047, 1319].forEach((f, i) =>
            this._blip(f, t + i * 0.10, 0.5, "triangle", 0.16, this.sfxBus));
          break; }
        default: break;
      }
    },

    // ---- music scheduler ------------------------------------------------
    // A minor lo-fi loop: 4 bars, chords Am - F - C - G. 16 steps/bar.
    startMusic() {
      if (!this.enabled || !this.ready || this._sched) return;
      this.musicBus.gain.cancelScheduledValues(this.ctx.currentTime);
      this.musicBus.gain.setValueAtTime(0.0001, this.ctx.currentTime);
      this.musicBus.gain.exponentialRampToValueAtTime(0.5, this.ctx.currentTime + 2.5);
      this._step = 0;
      this._nextTime = this.ctx.currentTime + 0.1;
      this._sched = setInterval(() => this._scheduler(), 40);
    },

    stopMusic(fade) {
      if (!this._sched) return;
      const g = this.musicBus.gain, t = this.ctx.currentTime;
      g.cancelScheduledValues(t);
      g.setValueAtTime(g.value, t);
      g.exponentialRampToValueAtTime(0.0001, t + (fade || 1.2));
      clearInterval(this._sched); this._sched = null;
    },

    setIntensity(v) { this._targetIntensity = RC.M.sat(v); },

    _scheduler() {
      const c = this.ctx; if (!c) return;
      const spb = 60 / this._bpm;         // seconds per beat
      const stepDur = spb / 4;            // 16th note
      this.intensity += (this._targetIntensity - this.intensity) * 0.08;
      while (this._nextTime < c.currentTime + 0.22) {
        this._emitStep(this._step, this._nextTime, stepDur);
        this._nextTime += stepDur;
        this._step = (this._step + 1) % 64;
      }
    },

    // chords per bar (root midi), plus scale tones for arp
    _emitStep(step, t, dur) {
      const bar = Math.floor(step / 16);
      const s = step % 16;
      const roots = [57, 53, 48, 55];          // A2, F2, C2, G2
      const chordTones = [
        [57, 60, 64, 69],   // Am
        [53, 57, 60, 65],   // F
        [48, 52, 55, 60],   // C
        [55, 59, 62, 67],   // G
      ];
      const root = roots[bar];
      const chord = chordTones[bar];
      const inten = this.intensity;
      const bus = this.musicBus;

      // --- pad: sustained chord at the top of each bar
      if (s === 0) {
        const dur2 = (60 / this._bpm) * 4 * 0.98;
        chord.forEach((m, i) => {
          const o = this.ctx.createOscillator();
          const g = this.ctx.createGain();
          const f = this.ctx.createBiquadFilter();
          o.type = i === 0 ? "triangle" : "sine";
          o.frequency.value = this._midi(m + 12);
          o.detune.value = (i - 1) * 4;
          f.type = "lowpass"; f.frequency.value = 900 + inten * 1400;
          const peak = 0.05 - i * 0.006;
          g.gain.setValueAtTime(0.0001, t);
          g.gain.linearRampToValueAtTime(peak, t + 0.5);
          g.gain.linearRampToValueAtTime(0.0001, t + dur2);
          o.connect(f); f.connect(g); g.connect(bus);
          o.start(t); o.stop(t + dur2 + 0.05);
        });
      }

      // --- bass: root on beats, walking fifth when tense
      if (s === 0 || s === 8 || (inten > 0.4 && (s === 4 || s === 12))) {
        const bn = (s === 8) ? root + 7 : root;
        this._blip(this._midi(bn - 12), t, 0.34, "triangle", 0.16 + inten * 0.06, bus, this._midi(bn - 12));
      }

      // --- soft arp: sparse when calm, busier when tense
      const arpOn = (s % 4 === 2) || (inten > 0.35 && s % 2 === 1);
      if (arpOn) {
        const m = chord[(Math.floor(step / 2) + bar) % chord.length] + 12;
        const o = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        o.type = "triangle";
        o.frequency.value = this._midi(m);
        const peak = 0.03 + inten * 0.02;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(peak, t + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
        o.connect(g); g.connect(bus);
        o.start(t); o.stop(t + 0.26);
      }

      // --- hat: quiet noise ticks; doubles up under tension
      if (s % 2 === 1 || (inten > 0.5 && s % 1 === 0 && s % 4 === 0)) {
        this._noise(t, 0.03, 0.02 + inten * 0.02, bus, 6000, "highpass");
      }

      // --- tension drone when alert
      if (inten > 0.55 && s === 0) {
        this._blip(this._midi(root + 1), t, 2.0, "sawtooth", 0.02 * inten, bus);
      }
    },

    // ---- helicopter rotor loop -----------------------------------------
    startHeli() {
      if (!this.enabled || !this.ready || this._heli) return;
      const c = this.ctx;
      const src = c.createBufferSource();
      const n = Math.floor(c.sampleRate * 1.0);
      const buf = c.createBuffer(1, n, c.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      src.buffer = buf; src.loop = true;
      const f = c.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 700;
      const amp = c.createGain(); amp.gain.value = 0.0;
      // rotor thump via LFO on amplitude
      const lfo = c.createOscillator(); lfo.type = "sawtooth"; lfo.frequency.value = 15;
      const lfoGain = c.createGain(); lfoGain.gain.value = 0.11;
      const base = c.createGain(); base.gain.value = 0.12;
      lfo.connect(lfoGain); lfoGain.connect(amp.gain); base.connect(amp.gain);
      src.connect(f); f.connect(amp); amp.connect(this.sfxBus);
      src.start(); lfo.start();
      amp.gain.setValueAtTime(0.0001, c.currentTime);
      this._heli = { src, lfo, amp, base, lfoGain, f };
    },
    setHeliLevel(v) {
      if (!this._heli) return;
      this._heli.base.gain.value = 0.12 * v;
      this._heli.lfoGain.gain.value = 0.11 * v;
      this._heli.f.frequency.value = 500 + 500 * v;
    },
    stopHeli() {
      if (!this._heli) return;
      try { this._heli.src.stop(); this._heli.lfo.stop(); } catch (e) {}
      this._heli = null;
    },
  };

})(window);
