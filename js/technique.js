/* ==================================================================
   technique.js — окно «Как правильно» с анимацией техники.
   Открывается после повтора с ошибкой, не блокирует игру, закрывается
   само через 7 с. Одна и та же ошибка — не чаще раза в 15 с.
   Анимация строится теми же генераторами (figures.js), нужные суставы
   подсвечены зелёным, для ряда ошибок рисуется линия-ориентир.
   ================================================================== */
'use strict';

const Technique = {
  enabled: true, lastShown: {}, raf: null, closeTimer: null, ex: null, code: null, openedAt: 0,

  init() {
    this.box = U.$('tech-modal');
    this.canvas = U.$('tech-canvas');
    this.ctx = this.canvas.getContext('2d');
    U.$('tech-close').onclick = () => this.hide();
  },

  show(ex, code) {
    if (!this.enabled || !ERRORS[ex]?.[code]) return;
    const key = ex + ':' + code, now = Date.now();
    if (this.lastShown[key] && now - this.lastShown[key] < CONFIG.TECH_MODAL_COOLDOWN) return;
    this.lastShown[key] = now;

    const info = ERRORS[ex][code];
    this.ex = ex; this.code = code; this.openedAt = performance.now();
    U.$('tech-error').textContent = `${EXERCISES[ex].icon} ${info.title}`;
    U.$('tech-tip').textContent = info.tip;
    this.box.classList.remove('hidden');
    requestAnimationFrame(() => this.box.classList.add('open'));
    U.restart(U.$('tech-progress'), 'run');

    cancelAnimationFrame(this.raf);
    const loop = (t) => { this._frame(t); if (!this.box.classList.contains('hidden')) this.raf = requestAnimationFrame(loop); };
    this.raf = requestAnimationFrame(loop);

    clearTimeout(this.closeTimer);
    this.closeTimer = setTimeout(() => this.hide(), CONFIG.TECH_MODAL_AUTOCLOSE);
  },

  hide() {
    clearTimeout(this.closeTimer);
    this.box.classList.remove('open');
    setTimeout(() => { this.box.classList.add('hidden'); cancelAnimationFrame(this.raf); }, 250);
  },

  /** Один кадр эталонного движения */
  _frame(t) {
    const { ctx, canvas } = this;
    const k = canvas.width / Figures.W;
    const info = ERRORS[this.ex][this.code];
    const cycle = this.ex === 'pushup' ? 2200 : this.ex === 'pullup' ? 3000 : 2800;
    const p = ((t - this.openedAt) % cycle) / cycle;
    const wave = Math.sin(Math.PI * p);                   // 0 → 1 → 0

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(k, 0, 0, k, 0, 0);
    Renderer.gym(ctx, Figures.W, Figures.H, 640);

    let pose;
    if (this.ex === 'pullup') {
      pose = Figures.pullupFront({ ox: 640, barY: 110, s: 0.8, elbow: U.lerp(168, 32, wave) });
      const chinY = pose[9].Y + 0.5 * (pose[9].Y - pose[0].Y);
      Renderer.pullBar(ctx, Figures.W, { y: 110, x0: pose[15].X, x1: pose[16].X, chinX: 640, chinY, over: chinY <= 110 }, { solid: true });
    }
    else if (this.ex === 'pushup') pose = Figures.pushupSide({ ox: 640, floorY: 640, s: 1.1, elbow: U.lerp(163, 82, wave) });
    else if (info.view === 'front') pose = Figures.front({ ox: 640, floorY: 640, s: 0.95, depth: wave * 1.05 });
    else pose = Figures.squatSide({ ox: 640, floorY: 640, s: 0.95, knee: U.lerp(170, 85, wave) });

    this._guides(ctx, pose);
    Renderer.drawPose(ctx, pose, { good: new Set(info.joints), scale: 1.6 });

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const PH = {
      pushup: ['⬇️ Опускайся под контролем', '⬆️ Выжимай до прямых рук'],
      squat:  ['⬇️ Таз назад и вниз', '⬆️ Вставай до конца'],
      pullup: ['⬆️ Подбородок над перекладиной', '⬇️ Медленно до полного виса']
    }[this.ex];
    const phase = p < 0.5 ? PH[0] : PH[1];
    Renderer.tag(ctx, canvas.width / 2, 22, phase, { size: 15, color: '#e2e8f0' });
  },

  /** Линии-ориентиры для конкретной ошибки */
  _guides(ctx, pose) {
    const line = (a, b, color = 'rgba(52,211,153,.7)') => {
      ctx.save(); ctx.setLineDash([16, 12]); ctx.strokeStyle = color; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(a.X, a.Y); ctx.lineTo(b.X, b.Y); ctx.stroke(); ctx.restore();
    };
    const c = this.code;
    if (this.ex === 'pushup' && (c === 'sag' || c === 'pike')) line(pose[11], pose[27]);
    if (this.ex === 'squat' && c === 'toes') line({ X: pose[31].X, Y: pose[31].Y }, { X: pose[31].X, Y: pose[31].Y - 360 });
    if (this.ex === 'squat' && c === 'valgus') {
      [27, 28].forEach(i => line(pose[i], { X: pose[i].X, Y: pose[i].Y - 330 }));
    }
    // Подтягивания: отвес от перекладины — корпус и ноги не уходят с него
    if (this.ex === 'pullup' && (c === 'swing' || c === 'kip')) line({ X: 640, Y: 130 }, { X: 640, Y: 700 });
    if (this.ex === 'squat' && c === 'lean') line(pose[23], { X: pose[23].X, Y: pose[23].Y - 300 }, 'rgba(250,204,21,.6)');
  }
};
