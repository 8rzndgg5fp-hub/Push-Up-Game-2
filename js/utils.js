/* ==================================================================
   utils.js — общие помощники (U) и геометрия позы (Geo).

   Формат позы во всём приложении:
     pose = массив из 33 точек { x, y, X, Y, v }
       x, y — нормализованные координаты ЭКРАНА (0..1), уже зеркальные
       X, Y — те же координаты в пикселях кадра (углы считаем по ним,
              иначе соотношение сторон исказит градусы)
       v    — видимость 0..1
     pose.synthetic = true — поза из симуляции (рисуем голову кружком)
   ================================================================== */
'use strict';

const U = {
  $: (id) => document.getElementById(id),
  clamp: (v, a, b) => Math.max(a, Math.min(b, v)),
  lerp: (a, b, t) => a + (b - a) * t,
  fmt(sec) { sec = Math.max(0, Math.round(sec)); return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`; },
  esc: (s) => String(s ?? '').replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c])),
  restart(node, cls) { if (!node) return; node.classList.remove(cls); void node.offsetWidth; node.classList.add(cls); },
  uid: () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
  err(name, message) { const e = new Error(message); e.name = name; return e; },
  pct: (a, b) => (b ? Math.round(a / b * 100) : 0),
  date: (ts) => new Date(ts).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
};

const Geo = {
  /** Угол ABC в градусах, B — вершина */
  angle(a, b, c) {
    const r = Math.atan2(c.Y - b.Y, c.X - b.X) - Math.atan2(a.Y - b.Y, a.X - b.X);
    const d = Math.abs(r * 180 / Math.PI);
    return d > 180 ? 360 - d : d;
  },
  dist: (a, b) => Math.hypot(a.X - b.X, a.Y - b.Y),
  mid: (a, b) => ({ X: (a.X + b.X) / 2, Y: (a.Y + b.Y) / 2, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, v: Math.min(a.v, b.v) }),

  /** Все ли точки видны достаточно уверенно */
  visible(pose, idx, thr = CONFIG.VIS) { return idx.every(i => pose[i] && pose[i].v >= thr); },

  /** Сторона тела, которую камера видит лучше: 'L' (нечётные индексы) или 'R' */
  bestSide(pose, left, right) {
    const s = (ids) => ids.reduce((acc, i) => acc + (pose[i]?.v || 0), 0);
    return s(left) >= s(right) ? 'L' : 'R';
  },

  /** Угол вектора a→b от вертикали, 0..180° */
  fromVertical(a, b) {
    return Math.abs(Math.atan2(b.X - a.X, -(b.Y - a.Y)) * 180 / Math.PI);
  },

  /** Угол вектора a→b от горизонтали, 0..90° */
  fromHorizontal(a, b) {
    const deg = Math.abs(Math.atan2(b.Y - a.Y, b.X - a.X) * 180 / Math.PI);
    return deg > 90 ? 180 - deg : deg;
  },

  /**
   * Отклонение точки p от прямой a→b, нормированное на длину отрезка.
   * Положительное — p ниже прямой (на экране), отрицательное — выше.
   */
  lineDev(a, p, b) {
    const len = Geo.dist(a, b) || 1;
    if (Math.abs(b.X - a.X) < 1e-3) return 0;
    const lineY = a.Y + (b.Y - a.Y) * (p.X - a.X) / (b.X - a.X);
    return (p.Y - lineY) / len;
  },

  /** Габариты позы по видимым точкам (для выбора «главного» человека) */
  bbox(pose) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    pose.forEach(p => { if (p && p.v > 0.3) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); } });
    return { x0, y0, x1, y1, cx: (x0 + x1) / 2, area: Math.max(0, x1 - x0) * Math.max(0, y1 - y0) };
  },

  /**
   * Сырые точки MediaPipe → формат приложения.
   * mirror = true: камера показывается зеркально, поэтому x → 1 - x.
   * Если модель не отдала visibility (бывает в Tasks Vision), считаем
   * видимыми точки внутри кадра.
   */
  fromRaw(raw, W, H, mirror = true) {
    const hasVis = raw.some(p => (p.visibility || 0) > 0.01);
    const pose = raw.map(p => {
      const x = mirror ? 1 - p.x : p.x, y = p.y;
      const inFrame = x > -0.05 && x < 1.05 && y > -0.05 && y < 1.05;
      const v = hasVis ? (p.visibility ?? 0) : (inFrame ? 0.9 : 0);
      return { x, y, X: x * W, Y: y * H, v };
    });
    pose.W = W; pose.H = H;
    return pose;
  }
};
