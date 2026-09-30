/* ==================================================================
   bot.js — виртуальный соперник для дуэли.

   Бот — это виртуальный боец из симуляции (DemoActor), чьи движения
   проходят через ТОТ ЖЕ анализатор, что и движения игрока.
   Поэтому его статус («опускается», «встаёт»), ошибки техники и
   счёт — настоящий результат распознавания, а не случайные цифры.

   Характер бота:
     • темп — BOTS[].pace секунд между повторами ± 20%;
     • ошибки — с вероятностью BOTS[].errorRate (случайный тип);
     • иногда «переводит дух» на 1,5–3 с;
     • в последние 10 секунд ускоряется — финишный рывок.
   ================================================================== */
'use strict';

class BotOpponent {
  /**
   * @param cfg     элемент BOTS
   * @param ex      'pushup' | 'squat' | 'pullup'
   * @param canvas  canvas для анимации бота
   * @param onEvent (type: 'ok'|'error', code?) → void
   */
  constructor(cfg, ex, canvas, onEvent) {
    this.cfg = cfg; this.ex = ex; this.onEvent = onEvent;
    this.canvas = canvas; this.ctx = canvas.getContext('2d');
    this.actor = new DemoActor(640, 0.85);
    this.actor.exercise = ex;
    this.analyzer = createAnalyzer(ex);
    this.reps = 0; this.errors = 0; this.byCode = {};
    this.running = false; this.alive = false;
    this.nextAt = 0; this.pauseUntil = 0; this.timeLeft = CONFIG.DUEL_TIME;
    this.status = 'Разминается'; this.lastError = null; this.lastErrorAt = 0;
    this.badJoints = new Set(); this.badUntil = 0; this.flashUntil = 0; this.flashColor = null;
  }

  get accuracy() { const n = this.reps + this.errors; return n ? this.reps / n : 0; }

  /** Запустить анимацию (бот «дышит» в лобби) */
  startLoop() {
    if (this.alive) return;
    this.alive = true;
    const loop = (t) => { if (!this.alive) return; this._frame(t); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }

  /** Старт боя: бот начинает делать повторы */
  start() { this.running = true; this.nextAt = performance.now() + 500 + Math.random() * 700; }

  stop() { this.running = false; }
  destroy() { this.running = false; this.alive = false; }

  _animMs(fault) { return this.ex === 'pushup' ? 1400 : this.ex === 'pullup' ? 1800 : fault === 'tempo' ? 650 : 2000; }

  /** Решить, когда и как бот делает следующий повтор */
  _plan(t) {
    const a = this.actor;
    if (!this.running || a.anim || t < a.stuckUntil || t < this.nextAt) return;
    const codes = Object.keys(ERRORS[this.ex]);
    const fault = Math.random() < this.cfg.errorRate ? codes[Math.floor(Math.random() * codes.length)] : null;
    a.rep(fault);

    let gap = this.cfg.pace[this.ex] * 1000 * (0.8 + Math.random() * 0.4);
    if (this.timeLeft <= 10) gap *= 0.85;                       // финишный рывок
    if (Math.random() < 0.08 && this.timeLeft > 12) {           // передышка
      const pause = 1500 + Math.random() * 1500;
      gap += pause;
      this.pauseUntil = t + this._animMs(fault) + pause;
    }
    this.nextAt = t + Math.max(gap, this._animMs(fault) + 250);
  }

  _frame(t) {
    this._plan(t);
    const pose = this.actor.pose(t);
    const r = this.analyzer.update(pose, t);

    if (r.rep && this.running) {
      if (r.rep.ok) {
        this.reps++;
        this.flashUntil = t + 400; this.flashColor = '#10b981';
        this.onEvent('ok');
      } else {
        this.errors++;
        const code = r.rep.errors[0];
        r.rep.errors.forEach(c => { const k = this.ex + ':' + c; this.byCode[k] = (this.byCode[k] || 0) + 1; });
        this.lastError = ERRORS[this.ex][code].title; this.lastErrorAt = t;
        this.badJoints = new Set(r.rep.errors.flatMap(c => ERRORS[this.ex][c].joints));
        this.badUntil = t + 1500; this.flashUntil = t + 400; this.flashColor = '#e11d48';
        this.onEvent('error', code);
      }
    }

    // Статус в реальном времени
    if (!this.running) this.status = this.reps || this.errors ? 'Финиш' : '🙌 Готов к бою';
    else if (t < this.pauseUntil && !this.actor.anim) this.status = '😮‍💨 Переводит дух';
    else if (t - this.lastErrorAt < 1600) this.status = `⚠️ ${this.lastError}`;
    else if (!this.actor.anim) this.status = '⏳ Готовится';
    else {
      const p = (t - this.actor.anim.start) / this.actor.anim.dur;
      this.status = this.ex === 'pullup'
        ? (p < 0.5 ? '⬆️ Тянется к перекладине' : '⬇️ Опускается в вис')
        : (p < 0.5 ? '⬇️ Опускается' : '⬆️ Поднимается');
    }

    this._draw(pose, t);
  }

  _draw(pose, t) {
    const { ctx, canvas } = this;
    const k = canvas.width / Figures.W;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(k, 0, 0, k, 0, 0);
    Renderer.gym(ctx, Figures.W, Figures.H, 640);
    if (this.ex === 'pullup' && pose.barY) {
      const chinY = pose[9].Y + 0.5 * (pose[9].Y - pose[0].Y);
      Renderer.pullBar(ctx, Figures.W, { y: pose.barY, x0: pose[15].X, x1: pose[16].X, chinX: pose[0].X, chinY, over: chinY <= pose.barY }, { solid: true });
    }
    const bad = t < this.badUntil ? this.badJoints : new Set();
    Renderer.drawPose(ctx, pose, { bad, flash: t < this.flashUntil ? this.flashColor : null, scale: 1.8 });
  }
}
