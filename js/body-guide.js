/* ==================================================================
   body-guide.js — гайд зоны захвата.

   Каждый кадр проверяет, какие части тела видны ВНУТРИ кадра, и даёт
   понятную подсказку: «Отойди на 1–2 шага назад», «Подойди ближе»,
   «Наклони камеру вверх». Если тело не помещается, рисует рамку-цель.

   Набор частей зависит от упражнения:
     отжимания / приседания — голова, плечи, таз, колени, стопы
     подтягивания           — кисти, голова, плечи, локти, таз
                              (ноги могут быть обрезаны — это нормально)

   DOM обновляется только при изменении состояния, подсказка меняется
   не чаще раза в 600 мс — ничего не мигает и не дёргается.
   ================================================================== */
'use strict';

const BodyGuide = {
  enabled: true,
  PARTS: {
    body: [
      { key: 'head',      label: 'Голова', ids: [0] },
      { key: 'shoulders', label: 'Плечи',  ids: [11, 12] },
      { key: 'hips',      label: 'Таз',    ids: [23, 24] },
      { key: 'knees',     label: 'Колени', ids: [25, 26] },
      { key: 'feet',      label: 'Стопы',  ids: [27, 28, 31, 32] }
    ],
    pullup: [
      { key: 'hands',     label: 'Кисти',  ids: [15, 16] },
      { key: 'head',      label: 'Голова', ids: [0] },
      { key: 'shoulders', label: 'Плечи',  ids: [11, 12] },
      { key: 'elbows',    label: 'Локти',  ids: [13, 14] },
      { key: 'hips',      label: 'Таз',    ids: [23, 24] }
    ]
  },
  shown: null, pending: null, pendingSince: 0, lastKey: '', chipsFor: null,

  partsFor(ex) { return ex === 'pullup' ? this.PARTS.pullup : this.PARTS.body; },
  _inFrame(p) { return p && p.v >= 0.5 && p.x > 0.01 && p.x < 0.99 && p.y > 0.01 && p.y < 0.99; },

  /** Оценка кадра → { tone: ok|warn|bad, hint, parts, zone } */
  evaluate(pose, ex) {
    if (!pose) return { tone: 'bad', hint: '🚶 Не вижу тебя — встань в кадр целиком, в 2–3 м от камеры', parts: {}, zone: true };

    const list = this.partsFor(ex);
    const parts = {};
    list.forEach(pt => { parts[pt.key] = pt.ids.some(i => this._inFrame(pose[i])); });
    const missing = list.filter(pt => !parts[pt.key]).map(pt => pt.label.toLowerCase());

    let x0 = 1, x1 = 0, y0 = 1, y1 = 0;
    pose.forEach(p => { if (this._inFrame(p)) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); } });
    const h = y1 - y0, w = x1 - x0;

    if (ex === 'pullup') {
      if (!parts.hands) return { tone: 'bad', parts, zone: true, hint: '🙌 Кисти не в кадре — отойди назад или наклони камеру вверх, чтобы была видна перекладина.' };
      if (missing.length >= 3) return { tone: 'bad', parts, zone: true, hint: `🚶 Отойди назад — не видно: ${missing.join(', ')}.` };
      if (!parts.hips) return { tone: 'warn', parts, zone: true, hint: '↕️ Не видно таз — отойди на шаг, иначе раскачивание не проверить.' };
      if (missing.length) return { tone: 'warn', parts, zone: false, hint: `📐 Не видно: ${missing.join(', ')}.` };
      if (y0 < 0.03) return { tone: 'warn', parts, zone: false, hint: '↕️ Кисти у самого края кадра — наклони камеру чуть вверх.' };
      return { tone: 'ok', parts, zone: false, hint: '✅ Кисти, голова и корпус в кадре' };
    }

    const lowerMissing = !parts.hips || !parts.knees || !parts.feet;
    if (lowerMissing && parts.head) {
      return { tone: 'bad', parts, zone: true, hint: `🚶 Отойди на 1–2 шага назад — не видно: ${missing.join(', ')}. Или наклони камеру чуть вниз.` };
    }
    if (!parts.head && !lowerMissing) {
      return { tone: 'warn', parts, zone: true, hint: '📐 Голова не в кадре — наклони камеру чуть вверх или отойди назад.' };
    }
    if (missing.length >= 3) {
      return { tone: 'bad', parts, zone: true, hint: `🚶 Отойди назад — в кадре только часть тела (не видно: ${missing.join(', ')}).` };
    }
    if ((ex === 'squat' && h < 0.35) || (ex === 'pushup' && w < 0.35)) {
      return { tone: 'warn', parts, zone: false, hint: '🔍 Ты далеко — подойди на шаг ближе, точность будет выше.' };
    }
    if (y0 < 0.04 || y1 > 0.96) {
      return { tone: 'warn', parts, zone: false, hint: '↕️ Почти упираешься в край кадра — отступи на полшага.' };
    }
    return { tone: 'ok', parts, zone: false, hint: '✅ Всё тело в кадре' };
  },

  /** Чипы частей тела под текущее упражнение (создаются один раз при смене) */
  _chips(ex) {
    const key = ex === 'pullup' ? 'pullup' : 'body';
    if (this.chipsFor === key) return;
    this.chipsFor = key;
    this.lastKey = '';
    U.$('bg-parts').innerHTML = this.partsFor(ex).map(pt => `<span id="bg-${pt.key}" class="bg-part">${pt.label}</span>`).join('');
  },

  render(res, t, ex) {
    const box = U.$('body-guide');
    if (!this.enabled) { box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    this._chips(ex);

    const list = this.partsFor(ex);
    const key = list.map(pt => (res.parts[pt.key] ? 1 : 0)).join('');
    if (key !== this.lastKey) {
      this.lastKey = key;
      list.forEach(pt => U.$('bg-' + pt.key).classList.toggle('on', !!res.parts[pt.key]));
    }

    const sig = res.tone + res.hint;
    if (sig !== this.pending) { this.pending = sig; this.pendingSince = t; }
    if (sig !== this.shown && (t - this.pendingSince > 600 || this.shown == null)) {
      this.shown = sig;
      box.dataset.tone = res.tone;
      U.$('bg-hint').textContent = res.hint;
    }
  },

  reset() { this.shown = null; this.pending = null; this.lastKey = ''; this.chipsFor = null; },

  /** Рамка-цель на видео: куда встать, чтобы поместиться целиком */
  drawZone(ctx, W, H, ex, t) {
    const pulse = 0.55 + 0.45 * Math.sin(t / 260);
    const r = ex === 'pushup' ? { x: 0.08, y: 0.42, w: 0.84, h: 0.52 }
            : ex === 'pullup' ? { x: 0.25, y: 0.06, w: 0.5, h: 0.84 }
            : { x: 0.32, y: 0.05, w: 0.36, h: 0.9 };
    ctx.save();
    ctx.setLineDash([18, 14]);
    ctx.lineWidth = Math.max(3, W / 320);
    ctx.strokeStyle = `rgba(34,211,238,${pulse})`;
    Renderer._round(ctx, r.x * W, r.y * H, r.w * W, r.h * H, 24);
    ctx.stroke();
    ctx.restore();
    Renderer.tag(ctx, W / 2, (r.y + r.h) * H - Math.max(22, H / 30),
      ex === 'pullup' ? 'Кисти, голова и таз — в рамке' : 'Помести всё тело в рамку',
      { color: '#67e8f9', size: Math.max(16, W / 60) });
  }
};
