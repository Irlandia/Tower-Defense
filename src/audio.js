// Tiny 8-bit synth on WebAudio. No asset files needed.
const PRESETS = {
  arrow: { type: 'square', f0: 900, f1: 500, d: 0.04, v: 0.02 },
  cannon: { type: 'triangle', f0: 160, f1: 50, d: 0.15, v: 0.08 },
  frost: { type: 'sine', f0: 1400, f1: 900, d: 0.06, v: 0.03 },
  fire: { type: 'sawtooth', f0: 220, f1: 120, d: 0.06, v: 0.015 },
  zap: { type: 'sawtooth', f0: 1600, f1: 300, d: 0.08, v: 0.03 },
  hit: { type: 'square', f0: 220, f1: 180, d: 0.02, v: 0.015 },
  death: { type: 'square', f0: 400, f1: 80, d: 0.12, v: 0.04 },
  build: { type: 'square', f0: 330, f1: 660, d: 0.08, v: 0.05 },
  sell: { type: 'square', f0: 880, f1: 1320, d: 0.08, v: 0.04 },
  leak: { type: 'square', f0: 180, f1: 60, d: 0.35, v: 0.08 },
  click: { type: 'square', f0: 600, f1: 600, d: 0.03, v: 0.03 },
};

export class Sfx {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.last = {};
  }

  unlock() {
    if (this.ctx) return;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      const len = this.ctx.sampleRate * 0.5;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    } catch {
      this.ctx = null;
    }
  }

  play(name) {
    if (!this.ctx || this.muted) return;
    const now = this.ctx.currentTime;
    if (this.last[name] && now - this.last[name] < 0.05) return; // throttle spam
    this.last[name] = now;
    if (name === 'stomp') return this.noise(0.18, 0.12, 180);
    if (name === 'stompBig') return this.noise(0.28, 0.2, 140);
    if (name === 'rumble') return this.noise(1.8, 0.22, 260);
    if (name === 'explode' || name === 'meteor') return this.noise(name === 'meteor' ? 0.6 : 0.25, name === 'meteor' ? 0.25 : 0.1);
    if (name === 'wave') return [330, 440, 660].forEach((f, i) => this.tone({ type: 'square', f0: f, f1: f, d: 0.1, v: 0.04 }, i * 0.1));
    if (name === 'card') return [523, 659, 784, 1046].forEach((f, i) => this.tone({ type: 'square', f0: f, f1: f, d: 0.08, v: 0.04 }, i * 0.07));
    if (name === 'gameover') return [392, 330, 262, 196].forEach((f, i) => this.tone({ type: 'square', f0: f, f1: f * 0.98, d: 0.2, v: 0.05 }, i * 0.2));
    const p = PRESETS[name];
    if (p) this.tone(p, 0);
  }

  tone(p, delay) {
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const gn = this.ctx.createGain();
    o.type = p.type;
    o.frequency.setValueAtTime(p.f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, p.f1), t + p.d);
    gn.gain.setValueAtTime(p.v, t);
    gn.gain.exponentialRampToValueAtTime(0.0001, t + p.d);
    o.connect(gn).connect(this.ctx.destination);
    o.start(t);
    o.stop(t + p.d + 0.02);
  }

  noise(d, v, f0 = 1200) {
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true; // buffer is 0.5 s; long rumbles loop it
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(80, t + d);
    const gn = this.ctx.createGain();
    gn.gain.setValueAtTime(v, t);
    gn.gain.exponentialRampToValueAtTime(0.0001, t + d);
    src.connect(f).connect(gn).connect(this.ctx.destination);
    src.start(t);
    src.stop(t + d);
  }
}

// ---------- generative ambient music per season (no files: WebAudio synth) ----------
// A slow chord loop: soft pad + bass on the downbeat + a gentle random arpeggio from the chord,
// plus a seasonal ambience layer (birds, crickets, wind, sleigh-bell twinkles).
const midi = (n) => 440 * 2 ** ((n - 69) / 12);
const SONGS = {
  spring: { bpm: 92, wave: 'triangle', chords: [[60, 64, 67, 72], [57, 60, 64, 69], [65, 69, 72, 77], [67, 71, 74, 79]], amb: 'birds' },
  summer: { bpm: 100, wave: 'square', chords: [[55, 59, 62, 67], [52, 55, 59, 64], [48, 52, 55, 60], [50, 54, 57, 62]], amb: 'crickets' },
  autumn: { bpm: 76, wave: 'triangle', chords: [[57, 60, 64, 69], [53, 57, 60, 65], [55, 59, 62, 67], [52, 56, 59, 64]], amb: 'wind' },
  winter: { bpm: 64, wave: 'sine', chords: [[62, 65, 69, 74], [58, 62, 65, 70], [60, 64, 67, 72], [57, 61, 64, 69]], amb: 'bells' },
};

export class Music {
  constructor(sfx) {
    this.sfx = sfx; // shares the AudioContext and its noise buffer
    this.on = true;
    try { this.on = localStorage.getItem('pixeltd-music') !== 'off'; } catch { /* storage unavailable */ }
    this.song = null;
    this.timer = null;
    this.out = null;
  }

  get ctx() { return this.sfx.ctx; }

  setOn(on) {
    this.on = on;
    try { localStorage.setItem('pixeltd-music', on ? 'on' : 'off'); } catch { /* storage unavailable */ }
    if (!on) this.stop();
    else if (this.season) this.play(this.season);
  }

  play(season) {
    this.season = season;
    if (!this.on || !this.ctx || this.sfx.muted) return;
    if (this.song === season && this.timer) return;
    this.stop();
    this.song = season;
    this.out = this.ctx.createGain();
    this.out.gain.setValueAtTime(0.0001, this.ctx.currentTime);
    this.out.gain.exponentialRampToValueAtTime(0.5, this.ctx.currentTime + 2); // fade in
    this.out.connect(this.ctx.destination);
    this.step = 0;
    this.next = this.ctx.currentTime + 0.1;
    this.timer = setInterval(() => this.schedule(), 100);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.song = null;
    if (this.out && this.ctx) {
      const o = this.out;
      o.gain.cancelScheduledValues(this.ctx.currentTime);
      o.gain.setValueAtTime(Math.max(0.0001, o.gain.value), this.ctx.currentTime);
      o.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + 0.8);
      setTimeout(() => o.disconnect(), 1000);
    }
    this.out = null;
  }

  // look ahead ~0.3 s and schedule eighth-note steps
  schedule() {
    if (!this.out || document.hidden) { if (this.ctx) this.next = this.ctx.currentTime + 0.1; return; }
    const S = SONGS[this.song] || SONGS.summer;
    const eighth = 60 / S.bpm / 2;
    while (this.next < this.ctx.currentTime + 0.3) {
      const bar = Math.floor(this.step / 8) % S.chords.length;
      const chord = S.chords[bar];
      const pos = this.step % 8;
      if (pos === 0) {
        for (const n of chord.slice(0, 3)) this.note(midi(n - 12), this.next, eighth * 8, 0.035, 'triangle', 0.6); // pad
        this.note(midi(chord[0] - 24), this.next, eighth * 4, 0.06, 'triangle', 0.02); // bass
      }
      if (pos === 4) this.note(midi(chord[0] - 24 + 7), this.next, eighth * 3, 0.04, 'triangle', 0.02);
      // sparse arpeggio: not every step, a little randomness so it never loops exactly
      if (Math.random() < (pos % 2 ? 0.35 : 0.7)) {
        const n = chord[Math.floor(Math.random() * chord.length)] + (Math.random() < 0.3 ? 12 : 0);
        this.note(midi(n), this.next, eighth * 1.6, S.wave === 'square' ? 0.012 : 0.03, S.wave, 0.01);
      }
      this.ambience(S.amb, this.next, eighth);
      this.next += eighth;
      this.step++;
    }
  }

  note(freq, t, dur, vol, type, attack) {
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.out);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  ambience(kind, t, eighth) {
    const r = Math.random();
    if (kind === 'birds' && r < 0.06) {
      // two quick chirps sliding up
      for (let i = 0; i < 2; i++) {
        const o = this.ctx.createOscillator(), g = this.ctx.createGain(), f = 2200 + Math.random() * 1200, tt = t + i * 0.09;
        o.type = 'sine';
        o.frequency.setValueAtTime(f, tt); o.frequency.exponentialRampToValueAtTime(f * 1.4, tt + 0.06);
        g.gain.setValueAtTime(0.0001, tt); g.gain.exponentialRampToValueAtTime(0.012, tt + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, tt + 0.07);
        o.connect(g).connect(this.out); o.start(tt); o.stop(tt + 0.08);
      }
    }
    if (kind === 'crickets' && r < 0.25) {
      for (let i = 0; i < 3; i++) this.note(4200 + Math.random() * 300, t + i * 0.03, 0.02, 0.004, 'square', 0.002);
    }
    if ((kind === 'wind' || kind === 'bells') && r < 0.03 && this.sfx.noiseBuf) {
      // a slow gust of filtered noise
      const src = this.ctx.createBufferSource(), f = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
      src.buffer = this.sfx.noiseBuf; src.loop = true;
      f.type = 'bandpass'; f.frequency.setValueAtTime(kind === 'bells' ? 900 : 400, t); f.frequency.linearRampToValueAtTime(kind === 'bells' ? 1500 : 700, t + 2);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.03, t + 1.2); g.gain.exponentialRampToValueAtTime(0.0001, t + 3);
      src.connect(f).connect(g).connect(this.out); src.start(t); src.stop(t + 3.1);
    }
    if (kind === 'bells' && r > 0.94) this.note(midi(84 + [0, 3, 7, 10][Math.floor(Math.random() * 4)]), t, eighth * 6, 0.02, 'sine', 0.003); // twinkle
  }
}
