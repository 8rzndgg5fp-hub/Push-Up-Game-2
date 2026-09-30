/* ==================================================================
   audio.js — звук без файлов (Web Audio API) и голосовые подсказки
   (Web Speech API, русский голос, если он есть в системе).
   ================================================================== */
'use strict';

const Sound = {
  ctx: null, master: null, enabled: true,

  /** Создаём AudioContext только после клика — требование браузеров */
  init() {
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.7;
        const comp = this.ctx.createDynamicsCompressor();
        this.master.connect(comp); comp.connect(this.ctx.destination);
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
    } catch (e) { console.warn('Web Audio:', e); }
  },

  tone({ freq, to, dur = 0.2, type = 'sine', vol = 0.3, at = 0, lp }) {
    if (!this.enabled || !this.ctx) return;
    const t = this.ctx.currentTime + at;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node = o;
    if (lp) { const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp; o.connect(f); node = f; }
    node.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.05);
  },

  noise(dur = 0.07, vol = 0.5, lp = 2400) {
    if (!this.enabled || !this.ctx) return;
    const len = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const s = this.ctx.createBufferSource(); s.buffer = buf;
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp;
    const g = this.ctx.createGain(); g.gain.value = vol;
    s.connect(f); f.connect(g); g.connect(this.master); s.start();
  },

  hit()   { this.tone({ freq: 180, to: 38, dur: 0.38, vol: 0.95 }); this.tone({ freq: 90, to: 45, dur: 0.3, type: 'triangle', vol: 0.5 }); this.noise(); },
  error() { [0, 0.14].forEach(at => { this.tone({ freq: 880, to: 620, dur: 0.12, type: 'square', vol: 0.2, at, lp: 3000 }); this.tone({ freq: 932, to: 650, dur: 0.12, type: 'sawtooth', vol: 0.14, at, lp: 3000 }); }); },
  victory() {
    [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => this.tone({ freq: f, dur: 0.28, type: 'triangle', vol: 0.3, at: i * 0.11 }));
    [523.25, 659.25, 783.99, 1046.5].forEach(f => this.tone({ freq: f, dur: 1.2, vol: 0.18, at: 0.6 }));
    this.tone({ freq: 130.8, to: 65, dur: 0.6, vol: 0.7, at: 0.6 });
  },
  defeat() { [392, 349.2, 311.1, 261.6].forEach((f, i) => this.tone({ freq: f, dur: 0.4, type: 'sawtooth', vol: 0.15, at: i * 0.22, lp: 1200 })); },
  beep(high = false) { this.tone({ freq: high ? 1320 : 660, dur: high ? 0.35 : 0.15, type: 'square', vol: 0.16, lp: 2500 }); },
  warn()  { [0, 0.25, 0.5].forEach(at => this.tone({ freq: 440, to: 330, dur: 0.2, type: 'triangle', vol: 0.3, at })); },
  botRep() { this.tone({ freq: 520, to: 420, dur: 0.12, type: 'triangle', vol: 0.12 }); },
  ready() { this.tone({ freq: 784, dur: 0.12, type: 'triangle', vol: 0.25 }); this.tone({ freq: 1175, dur: 0.2, type: 'triangle', vol: 0.25, at: 0.1 }); }
};

const Voice = {
  enabled: true, voice: null, last: {},

  init() {
    if (!('speechSynthesis' in window)) return;
    const pick = () => {
      const list = speechSynthesis.getVoices();
      this.voice = list.find(v => v.lang?.toLowerCase().startsWith('ru')) || null;
    };
    pick();
    speechSynthesis.onvoiceschanged = pick;
  },

  /**
   * Сказать фразу. key + cooldown не дают повторять одно и то же подряд;
   * новая фраза прерывает старую, чтобы подсказка не отставала от движения.
   */
  say(text, { key = text, cooldown = 2500 } = {}) {
    if (!this.enabled || !('speechSynthesis' in window) || !text) return;
    const now = Date.now();
    if (this.last[key] && now - this.last[key] < cooldown) return;
    this.last[key] = now;
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'ru-RU'; u.rate = 1.1; u.pitch = 1;
      if (this.voice) u.voice = this.voice;
      speechSynthesis.speak(u);
    } catch (e) { console.warn('Speech:', e); }
  },
  stop() { try { speechSynthesis.cancel(); } catch {} }
};
