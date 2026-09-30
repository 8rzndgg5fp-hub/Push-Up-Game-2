/* ==================================================================
   rep-fsm.js — универсальный конечный автомат повторения.

   Вход: «глубина» d (0 = исходное положение, 1 = нужная глубина).
   Каждое упражнение само переводит свои углы в d.

        ┌──────── d ≤ top ────────┐
        ▼                         │
     [TOP] ── d > start ──► [DOWN] ── d падает на reverse ──► [UP]
                               ▲                               │
                               └── d снова растёт (без выпрямления) ◄┘
     [UP] ── d зависло stallMs ──► [STALL] (повтор завершён без выпрямления)

   Возвращаемый объект повтора:
     maxD     — самая глубокая точка (для проверки глубины)
     lockout  — дошёл ли до полного выпрямления наверху
     duration — длительность повтора, мс (для проверки темпа)
     turnAt   — момент разворота из фазы «вниз» в «вверх» (для скорости обратной фазы)
   ================================================================== */
'use strict';

class RepFSM {
  constructor(opts = {}) {
    this.o = Object.assign({ start: 0.25, reverse: 0.15, top: 0.08, stallMs: 1500, minAttempt: 0.4 }, opts);
    this.reset();
  }

  reset() { this.phase = 'top'; this.rep = null; this.stallD = 0; }

  _begin(d, t) { this.phase = 'down'; this.rep = { start: t, maxD: d, minUp: d, lastProg: t }; }

  _finish(t, lockout) {
    const r = this.rep;
    this.rep = null;
    r.end = t; r.lockout = lockout; r.duration = t - r.start;
    // Слишком мелкое движение — не попытка, а шум
    return r.maxD >= this.o.minAttempt ? r : null;
  }

  update(d, t) {
    const o = this.o, r = this.rep;
    switch (this.phase) {
      case 'top':
        if (d > o.start) this._begin(d, t);
        return null;

      case 'down':
        if (d > r.maxD) r.maxD = d;
        else if (d < r.maxD - o.reverse) { this.phase = 'up'; r.minUp = d; r.lastProg = t; r.turnAt = t; }
        return null;

      case 'up': {
        if (d < r.minUp - 0.01) { r.minUp = d; r.lastProg = t; }
        if (d <= o.top) { this.phase = 'top'; return this._finish(t, true); }
        if (d > r.minUp + o.reverse) {                 // пошёл вниз, не выпрямившись
          const done = this._finish(t, false);
          this._begin(d, t);
          return done;
        }
        if (t - r.lastProg > o.stallMs) {              // застыл, не выпрямившись
          this.phase = 'stall'; this.stallD = r.minUp;
          return this._finish(t, false);
        }
        return null;
      }

      case 'stall':
        if (d <= o.top) this.phase = 'top';
        else if (d > this.stallD + o.reverse) this._begin(d, t);
        return null;
    }
    return null;
  }

  get inRep() { return this.phase === 'down' || this.phase === 'up'; }
}
