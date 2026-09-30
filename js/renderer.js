/* ==================================================================
   renderer.js — отрисовка скелета на canvas.
   Кости белые, рабочие суставы жёлтые, ПРОБЛЕМНЫЕ суставы и кости,
   которые к ним идут, — красные с пульсирующим кольцом.
   Функции принимают ctx, чтобы тем же кодом рисовать окно техники.
   ================================================================== */
'use strict';

const Renderer = {
  BONES: [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24],
          [23, 25], [25, 27], [24, 26], [26, 28], [27, 31], [28, 32]],
  JOINTS: [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28, 31, 32],

  /**
   * @param ctx   CanvasRenderingContext2D
   * @param pose  поза (формат utils.js)
   * @param o.bad      Set индексов проблемных суставов (красные)
   * @param o.good     Set индексов, которые подсветить зелёным (окно техники)
   * @param o.flash    цвет вспышки всего скелета после повтора
   * @param o.scale    масштаб линий
   */
  drawPose(ctx, pose, o = {}) {
    const bad = o.bad || new Set(), good = o.good || new Set();
    const sc = o.scale || Math.max(pose.W || 1280, pose.H || 720) / 1280;
    const t = performance.now();
    const pulse = 0.5 + 0.5 * Math.sin(t / 120);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';

    // Голова у синтетической фигуры
    if (pose.synthetic && pose[0].v > 0) {
      ctx.strokeStyle = o.flash || 'rgba(255,255,255,.9)';
      ctx.lineWidth = 5 * sc;
      ctx.beginPath(); ctx.arc(pose[0].X, pose[0].Y, pose.headR || 28, 0, Math.PI * 2); ctx.stroke();
    }

    // Кости
    this.BONES.forEach(([a, b]) => {
      const pa = pose[a], pb = pose[b];
      if (!pa || !pb || pa.v < 0.3 || pb.v < 0.3) return;
      const faint = Math.min(pa.v, pb.v) < 0.5;
      const isBad = bad.has(a) || bad.has(b), isGood = good.has(a) || good.has(b);
      ctx.strokeStyle = isBad ? '#f43f5e' : isGood ? '#34d399' : (o.flash || (faint ? 'rgba(255,255,255,.35)' : 'rgba(255,255,255,.9)'));
      ctx.lineWidth = (isBad || isGood ? 9 : faint ? 4 : 6) * sc;
      if (isBad || isGood) { ctx.shadowColor = ctx.strokeStyle; ctx.shadowBlur = 14; }
      ctx.beginPath(); ctx.moveTo(pa.X, pa.Y); ctx.lineTo(pb.X, pb.Y); ctx.stroke();
      ctx.shadowBlur = 0;
    });

    // Суставы (нос рисуем, только если он в проблемных/эталонных — для подтягиваний)
    const joints = bad.has(0) || good.has(0) ? [0, ...this.JOINTS] : this.JOINTS;
    joints.forEach(i => {
      const p = pose[i];
      if (!p || p.v < 0.3) return;
      const isBad = bad.has(i), isGood = good.has(i);
      ctx.fillStyle = isBad ? '#e11d48' : isGood ? '#10b981' : '#facc15';
      ctx.beginPath(); ctx.arc(p.X, p.Y, (isBad || isGood ? 10 : p.v < 0.5 ? 5 : 7) * sc, 0, Math.PI * 2); ctx.fill();
      if (isBad) {
        ctx.strokeStyle = `rgba(244,63,94,${0.4 + 0.6 * pulse})`;
        ctx.lineWidth = 3 * sc;
        ctx.beginPath(); ctx.arc(p.X, p.Y, (16 + 8 * pulse) * sc, 0, Math.PI * 2); ctx.stroke();
      }
      if (isGood) {
        ctx.strokeStyle = 'rgba(16,185,129,.8)'; ctx.lineWidth = 3 * sc;
        ctx.beginPath(); ctx.arc(p.X, p.Y, 18 * sc, 0, Math.PI * 2); ctx.stroke();
      }
    });
  },

  /** Подпись-плашка (угол у сустава, имя игрока над головой) */
  tag(ctx, x, y, text, { color = '#fff', bg = 'rgba(15,23,42,.8)', size = 24 } = {}) {
    ctx.font = `800 ${size}px Manrope, system-ui, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const w = ctx.measureText(text).width + size * 0.8, h = size * 1.5;
    ctx.fillStyle = bg;
    this._round(ctx, x - w / 2, y - h / 2, w, h, h / 2); ctx.fill();
    ctx.fillStyle = color; ctx.fillText(text, x, y + 1);
  },

  _round(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  },

  /**
   * Перекладина для подтягиваний: линия на уровне кистей и маркер подбородка.
   * bar = { y, x0, x1, chinX, chinY, over } из анализатора.
   */
  pullBar(ctx, W, bar, { solid = false } = {}) {
    if (!bar) return;
    const sc = W / 1280;
    ctx.save();
    // Сама перекладина: в симуляции — «железная», на видео — пунктир во всю ширину
    if (solid) {
      ctx.strokeStyle = '#94a3b8'; ctx.lineWidth = 12 * sc; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(bar.x0 - 160 * sc, bar.y); ctx.lineTo(bar.x1 + 160 * sc, bar.y); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 3 * sc;
      ctx.beginPath(); ctx.moveTo(bar.x0 - 160 * sc, bar.y - 3 * sc); ctx.lineTo(bar.x1 + 160 * sc, bar.y - 3 * sc); ctx.stroke();
    } else {
      ctx.setLineDash([22 * sc, 14 * sc]);
      ctx.strokeStyle = 'rgba(250,204,21,.85)'; ctx.lineWidth = 5 * sc;
      ctx.beginPath(); ctx.moveTo(0, bar.y); ctx.lineTo(W, bar.y); ctx.stroke();
      ctx.setLineDash([]);
    }
    // Подбородок
    ctx.strokeStyle = bar.over ? '#34d399' : '#f59e0b';
    ctx.lineWidth = 5 * sc;
    ctx.beginPath(); ctx.moveTo(bar.chinX - 40 * sc, bar.chinY); ctx.lineTo(bar.chinX + 40 * sc, bar.chinY); ctx.stroke();
    ctx.restore();
    this.tag(ctx, Math.min(W - 120 * sc, bar.x1 + 120 * sc), bar.y - 26 * sc, bar.over ? '✓ над перекладиной' : 'перекладина',
      { color: bar.over ? '#6ee7b7' : '#fde68a', size: 18 * sc });
  },

  /** Фон «виртуального зала» для симуляции */
  gym(ctx, W, H, floorY = 620) {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#0b1220'); g.addColorStop(1, '#131e38');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(34,211,238,.07)'; ctx.lineWidth = 1;
    for (let x = 0; x < W; x += 64) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    for (let y = 0; y < H; y += 64) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
    ctx.strokeStyle = 'rgba(34,211,238,.45)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(0, floorY + 6); ctx.lineTo(W, floorY + 6); ctx.stroke();
  },

  /** Пунктир посередине в дуэли + подписи зон */
  duelDivider(ctx, W, H) {
    ctx.save();
    ctx.setLineDash([14, 12]); ctx.strokeStyle = 'rgba(232,121,249,.55)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H); ctx.stroke();
    ctx.restore();
    const size = Math.max(18, W / 55);
    this.tag(ctx, W * 0.08, size * 1.2, 'A', { color: '#67e8f9', size });
    this.tag(ctx, W * 0.92, size * 1.2, 'B', { color: '#f0abfc', size });
  }
};
