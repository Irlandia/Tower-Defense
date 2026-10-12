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
export const SONGS = {
  spring: { bpm: 92, wave: 'triangle', chords: [[60, 64, 67, 72], [57, 60, 64, 69], [65, 69, 72, 77], [67, 71, 74, 79]], amb: 'birds' },
  summer: { bpm: 100, wave: 'square', chords: [[55, 59, 62, 67], [52, 55, 59, 64], [48, 52, 55, 60], [50, 54, 57, 62]], amb: 'crickets' },
  autumn: { bpm: 76, wave: 'triangle', chords: [[57, 60, 64, 69], [53, 57, 60, 65], [55, 59, 62, 67], [52, 56, 59, 64]], amb: 'wind' },
  winter: { bpm: 64, wave: 'sine', chords: [[62, 65, 69, 74], [58, 62, 65, 70], [60, 64, 67, 72], [57, 61, 64, 69]], amb: 'bells' },
  // Campaign: one theme per mission, matching its map and mood.
  // drums: 8 steps per bar (k kick, s snare, h hat, . rest); arp: 'up' climbs the chord, 'bounce' root/top, default random.
  m1: { bpm: 96, wave: 'triangle', arp: 'up', drums: 'k...h...', amb: 'birds', // first sprouts: gentle C major
    chords: [[60, 64, 67, 72], [55, 59, 62, 67], [57, 60, 64, 69], [53, 57, 60, 65]] },
  m2: { bpm: 88, wave: 'sine', amb: 'water', // the ford: flowing F major by the river
    chords: [[53, 57, 60, 65], [60, 64, 67, 72], [62, 65, 69, 74], [58, 62, 65, 70]] },
  m3: { bpm: 128, wave: 'square', arp: 'bounce', drums: 'k.h.s.hh', amb: 'crickets', // goblin bazaar: cheeky dorian
    chords: [[57, 60, 64, 69], [62, 66, 69, 74], [57, 60, 64, 69], [64, 68, 71, 76]] },
  m4: { bpm: 112, wave: 'square', drums: 'k..sk.s.', amb: 'rain', // storm over the hills: tense minor
    chords: [[62, 65, 69, 74], [58, 62, 65, 70], [60, 64, 67, 72], [57, 61, 64, 69]] },
  m5: { bpm: 104, wave: 'triangle', arp: 'up', drums: 'k.h.k.h.', amb: 'crickets', // the cycle: a progression that goes round
    chords: [[64, 67, 71, 76], [60, 64, 67, 72], [55, 59, 62, 67], [62, 66, 69, 74]] },
  m6: { bpm: 70, wave: 'sine', drums: 'k.......', amb: 'owl', // night of slime: dark C minor
    chords: [[60, 63, 67, 72], [56, 60, 63, 68], [53, 56, 60, 65], [55, 59, 62, 67]] },
  m7: { bpm: 120, wave: 'square', arp: 'bounce', drums: 'k.s.k.s.', amb: 'crowd', // autumn fair: a polka
    chords: [[55, 59, 62, 67], [62, 66, 69, 74], [55, 59, 62, 67], [60, 64, 67, 72], [62, 66, 69, 74], [55, 59, 62, 67]] },
  m8: { bpm: 96, wave: 'square', drums: 'k.ksk.s.', amb: 'wind', // iron legion: a heavy march
    chords: [[52, 55, 59, 64], [52, 55, 59, 64], [48, 52, 55, 60], [47, 51, 54, 59]] },
  m9: { bpm: 60, wave: 'sine', amb: 'bells', // eternal winter: the sad twist
    chords: [[57, 60, 64, 69], [53, 57, 60, 65], [50, 53, 57, 62], [52, 56, 59, 64]] },
  m10: { bpm: 132, wave: 'square', arp: 'up', drums: 'k.skk.s.', amb: 'wind', // the last tide: epic finale
    chords: [[62, 65, 69, 74], [58, 62, 65, 70], [53, 57, 60, 65], [60, 64, 67, 72], [55, 58, 62, 67], [57, 61, 64, 69]] },
};
/** Which theme a run plays: its campaign mission's own, otherwise its season's. */
export function songFor(s) {
  return s && s.mission && SONGS['m' + s.mission.id] ? 'm' + s.mission.id : (s && s.season) || 'summer';
}

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

  // the theme for a run: its campaign mission, otherwise its season
  playFor(s) { this.play(songFor(s)); }

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
      // arpeggio: climbing / bouncing for the mission themes, otherwise sparse and a little random
      const arpVol = S.wave === 'square' ? 0.012 : 0.03;
      if (S.arp === 'up') this.note(midi(chord[pos % chord.length] + (pos >= 4 ? 12 : 0)), this.next, eighth * 1.4, arpVol, S.wave, 0.01);
      else if (S.arp === 'bounce') this.note(midi(pos % 2 ? chord[3] : chord[0] + (pos % 4 === 2 ? 7 : 0)), this.next, eighth * 0.9, arpVol, S.wave, 0.005);
      else if (Math.random() < (pos % 2 ? 0.35 : 0.7)) {
        const n = chord[Math.floor(Math.random() * chord.length)] + (Math.random() < 0.3 ? 12 : 0);
        this.note(midi(n), this.next, eighth * 1.6, arpVol, S.wave, 0.01);
      }
      if (S.drums) this.drum(S.drums[pos], this.next);
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

  // soft 8-bit percussion: k kick (falling sine), s snare and h hat (filtered noise bursts)
  drum(kind, t) {
    if (kind === 'k') {
      const o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(130, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.09, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      o.connect(g).connect(this.out); o.start(t); o.stop(t + 0.18);
    } else if ((kind === 's' || kind === 'h') && this.sfx.noiseBuf) this.noise(t, kind === 's' ? 0.1 : 0.03, kind === 's' ? 1800 : 7000, kind === 's' ? 0.03 : 0.012, 'highpass');
  }

  noise(t, dur, freq, vol, type = 'bandpass') {
    const src = this.ctx.createBufferSource(), f = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
    src.buffer = this.sfx.noiseBuf; src.loop = true;
    f.type = type; f.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.01, dur / 3)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.out); src.start(t); src.stop(t + dur + 0.02);
  }

  ambience(kind, t, eighth) {
    const r = Math.random();
    if (kind === 'water' && r < 0.18) { // bubbling stream: little rising blips
      const o = this.ctx.createOscillator(), g = this.ctx.createGain(), f = 500 + Math.random() * 500;
      o.type = 'sine'; o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 1.8, t + 0.05);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.01, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
      o.connect(g).connect(this.out); o.start(t); o.stop(t + 0.07);
    }
    if (kind === 'rain' && this.sfx.noiseBuf) {
      if (r < 0.5) this.noise(t, eighth * 1.2, 5000, 0.01, 'highpass'); // steady hiss of rain
      if (r > 0.995) this.noise(t, 2.5, 120, 0.12, 'lowpass'); // distant thunder
    }
    if (kind === 'owl' && r < 0.012) for (let i = 0; i < 2; i++) this.note(midi(64 - i * 3), t + i * 0.35, 0.3, 0.02, 'sine', 0.05); // hoo-hoo
    if (kind === 'owl' && r > 0.8) for (let i = 0; i < 2; i++) this.note(3800 + Math.random() * 300, t + i * 0.04, 0.02, 0.003, 'square', 0.002); // crickets
    if (kind === 'crowd' && this.sfx.noiseBuf && r < 0.08) this.noise(t, 0.6 + Math.random() * 0.6, 500 + Math.random() * 500, 0.012); // fair chatter
    if (kind === 'crowd' && r > 0.985) this.note(midi(79 + [0, 4, 7][Math.floor(Math.random() * 3)]), t, eighth * 2, 0.012, 'square', 0.003); // a stall's bell
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
