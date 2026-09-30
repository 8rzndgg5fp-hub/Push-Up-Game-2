/* ==================================================================
   demo.js — симуляция без камеры.
   Виртуальные бойцы двигаются с заданной ошибкой (или без неё) и
   отдают позы в тот же конвейер, что и камера: App.onPoses →
   анализаторы → конечные автоматы → детекторы ошибок.
   Так жюри видит реальную работу алгоритмов, а не «нажал — засчиталось».
   ================================================================== */
'use strict';

const ease = (x) => 0.5 - 0.5 * Math.cos(Math.PI * U.clamp(x, 0, 1));

class DemoActor {
  constructor(ox, s) {
    this.ox = ox; this.s = s;
    this.exercise = 'pushup';
    this.anim = null;           // текущее движение
    this.stuckUntil = 0;        // «застрял» внизу после неполного выпрямления
    this.lastFront = false;
  }

  /** Повтор: fault = null (чистый) или код ошибки из ERRORS */
  rep(fault = null) {
    const dur = this.exercise === 'pushup' ? 1400 : this.exercise === 'pullup' ? 1800 : fault === 'tempo' ? 650 : 2000;
    // Если боец «застыл» после неполного выпрямления — следующий повтор начнётся после паузы,
    // иначе мгновенное выпрямление засчитало бы прошлый повтор как чистый
    this.anim = { type: 'rep', fault, start: Math.max(performance.now(), this.stuckUntil), dur };
  }

  /** Жест: 'up' — обе руки, 'one' — одна, 'low' — невысоко */
  hands(kind) { this.anim = { type: 'hands', kind, start: performance.now(), dur: 2000 }; }

  pose(t) {
    const a = this.anim;
    if (a && t - a.start > a.dur) {
      if (a.type === 'rep' && a.fault === 'lockout') this.stuckUntil = t + 2200;
      this.anim = null;
    }
    const s = this.s, ox = this.ox, floorY = s < 0.8 ? 600 : 640;
    const breath = Math.sin(t / 600);
    const cur = this.anim && t >= this.anim.start ? this.anim : null;

    // Жест: сначала руки опущены (жест «взводится»), затем поднимаются
    if (cur?.type === 'hands') {
      const ph = (t - cur.start) / cur.dur;
      return Figures.front({ ox, floorY, s, arms: ph < 0.3 ? 'down' : cur.kind });
    }

    const p = cur ? U.clamp((t - cur.start) / cur.dur, 0, 1) : 0;
    const f = cur?.fault;
    const stuck = t < this.stuckUntil;

    if (this.exercise === 'pullup') {
      const hang = 168, sp = s * 0.88;
      let elbow = stuck ? 135 : hang + breath, sway = 0, kneeLift = 0;
      if (cur) {
        const top = f === 'depth' ? 90 : 32;
        const end = f === 'lockout' ? 135 : hang;
        const q = f === 'drop' ? (p - 0.5) / 0.12 : (p - 0.5) * 2;       // резкий спуск за 12% времени
        elbow = p < 0.5 ? U.lerp(hang, top, ease(p * 2)) : U.lerp(top, end, ease(q));
        if (f === 'swing') sway = 95 * Math.sin(Math.PI * 3 * p);
        if (f === 'kip') kneeLift = Math.sin(Math.PI * U.clamp(p * 1.4, 0, 1));
      }
      return Figures.pullupFront({ ox, barY: s < 0.8 ? 130 : 120, s: sp, elbow, sway, kneeLift });
    }

    if (this.exercise === 'pushup') {
      const top = 163;
      let elbow = stuck ? 142 : top + breath, hip = 0;
      if (cur) {
        const bottom = f === 'depth' ? 122 : 82;
        const end = f === 'lockout' ? 142 : top;
        elbow = p < 0.5 ? U.lerp(top, bottom, ease(p * 2)) : U.lerp(bottom, end, ease((p - 0.5) * 2));
        if (f === 'sag') hip = 60 * Math.sin(Math.PI * p);
        if (f === 'pike') hip = -75 * Math.sin(Math.PI * p);
      }
      return Figures.pushupSide({ ox, floorY, s, elbow, hip });
    }

    // Приседания
    const top = 170;
    let knee = stuck ? 138 : top + breath, lean = 0, kneeFwd = 0;
    if (cur) {
      const bottom = f === 'depth' ? 125 : 85;
      const end = f === 'lockout' ? 138 : top;
      knee = p < 0.5 ? U.lerp(top, bottom, ease(p * 2)) : U.lerp(bottom, end, ease((p - 0.5) * 2));
      if (f === 'lean') lean = 28 * Math.sin(Math.PI * p);
      if (f === 'toes') kneeFwd = 22 * Math.sin(Math.PI * p);
      if (f === 'valgus') {
        const depth = U.clamp((top - knee) / (top - 85), 0, 1.1);
        return Figures.front({ ox, floorY, s, depth, valgus: true });
      }
    }
    return Figures.squatSide({ ox, floorY, s, knee, lean, kneeFwd });
  }
}

const Demo = {
  active: false, actors: [], onPoses: null,

  /** count: 1 — тренировка, 2 — дуэль (A слева, B справа) */
  start(count, onPoses) {
    this.stop();
    this.actors = count === 2 ? [new DemoActor(330, 0.62), new DemoActor(950, 0.62)] : [new DemoActor(640, 0.85)];
    this.onPoses = onPoses;
    this.active = true;
    requestAnimationFrame(this._loop);
  },

  stop() { this.active = false; this.actors = []; },

  _loop: (t) => {
    if (!Demo.active) return;
    const poses = Demo.actors.map(a => a.pose(t));
    Demo.onPoses(poses, t, { W: Figures.W, H: Figures.H, demo: true });
    requestAnimationFrame(Demo._loop);
  },

  setExercise(i, ex) { if (this.actors[i]) this.actors[i].exercise = ex; },

  /**
   * Действие симуляции для бойца i:
   * 'clean' | 'error' (случайная ошибка) | код ошибки | 'hands' | 'one' | 'low'
   */
  act(i, action) {
    const a = this.actors[i];
    if (!a) return;
    if (action === 'hands') return a.hands('up');
    if (action === 'one' || action === 'low') return a.hands(action);
    if (action === 'clean') return a.rep(null);
    if (action === 'error') {
      const codes = Object.keys(ERRORS[a.exercise]);
      return a.rep(codes[Math.floor(Math.random() * codes.length)]);
    }
    a.rep(action);
  }
};
