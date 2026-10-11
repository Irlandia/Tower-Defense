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
