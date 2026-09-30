/* ==================================================================
   figures.js — генераторы «виртуального бойца».
   Строят позу в том же формате, что и MediaPipe, поэтому симуляция и
   окно техники проходят через ТОТ ЖЕ код анализа и отрисовки, что и камера.
   Это честный тест конечных автоматов и детекторов ошибок без камеры.

   Кадр 1280×720. ox — центр фигуры по X, s — масштаб, floorY — линия пола.
   Ближняя сторона тела — нечётные индексы (11, 13 …), дальняя — чётные
   с небольшим смещением и пониженной видимостью.
   ================================================================== */
'use strict';

const Figures = {
  W: 1280, H: 720,

  /** Собрать позу из словаря {индекс: {X, Y, v}} */
  make(points, W = this.W, H = this.H, headR = 28) {
    const pose = [];
    for (let i = 0; i < 33; i++) {
      const p = points[i];
      pose.push(p ? { X: p.X, Y: p.Y, x: p.X / W, y: p.Y / H, v: p.v ?? 1 } : { X: 0, Y: 0, x: 0, y: 0, v: 0 });
    }
    pose.W = W; pose.H = H; pose.synthetic = true; pose.headR = headR;
    return pose;
  },

  /** Дальняя сторона: копия ближней со сдвигом и низкой видимостью */
  _far(pts, pairs, dx, dy) {
    pairs.forEach(([near, far]) => { const p = pts[near]; if (p) pts[far] = { X: p.X + dx, Y: p.Y + dy, v: 0.35 }; });
  },
  _rot(u, deg) {
    const r = deg * Math.PI / 180;
    return { X: u.X * Math.cos(r) - u.Y * Math.sin(r), Y: u.X * Math.sin(r) + u.Y * Math.cos(r) };
  },

  /**
   * Отжимание, вид сбоку (голова слева).
   * elbow — угол в локте; hip — смещение таза в px (+ провис, − задран)
   */
  pushupSide({ ox = 640, floorY = 600, s = 1, elbow = 162, hip = 0 } = {}) {
    const L = 115 * s;
    const th = elbow * Math.PI / 180, phi = (Math.PI - th) / 2;
    const W = { X: ox - 270 * s, Y: floorY };
    const E = { X: W.X + L * Math.sin(phi), Y: W.Y - L * Math.cos(phi) };
    const u = { X: (W.X - E.X) / L, Y: (W.Y - E.Y) / L };
    const v = this._rot(u, elbow);
    const S = { X: E.X + L * v.X, Y: E.Y + L * v.Y };
    const F = { X: ox + 270 * s, Y: floorY - 6 * s };
    const Hb = { X: U.lerp(S.X, F.X, 0.45), Y: U.lerp(S.Y, F.Y, 0.45) + hip * s };
    const K = { X: U.lerp(Hb.X, F.X, 0.5), Y: U.lerp(Hb.Y, F.Y, 0.5) };
    const pts = {
      0: { X: S.X - 60 * s, Y: S.Y - 6 * s },
      11: S, 13: E, 15: W, 23: Hb, 25: K, 27: F,
      31: { X: F.X - 4 * s, Y: floorY + 4 * s }
    };
    this._far(pts, [[11, 12], [13, 14], [15, 16], [23, 24], [25, 26], [27, 28], [31, 32]], 12 * s, -6 * s);
    return this.make(pts, this.W, this.H, 26 * s);
  },

  /**
   * Присед, вид сбоку (носки влево).
   * knee — угол колена; lean — доп. наклон корпуса; kneeFwd — доп. вынос колена
   */
  squatSide({ ox = 640, floorY = 620, s = 1, knee = 170, lean = 0, kneeFwd = 0 } = {}) {
    const shin = 150 * s, thigh = 155 * s, torso = 190 * s;
    const A = { X: ox + 10 * s, Y: floorY - 10 * s };
    const T = { X: A.X - 50 * s, Y: floorY - 2 * s };
    const a = ((180 - knee) * 0.25 + kneeFwd) * Math.PI / 180;
    const K = { X: A.X - shin * Math.sin(a), Y: A.Y - shin * Math.cos(a) };
    const u = { X: (A.X - K.X) / shin, Y: (A.Y - K.Y) / shin };
    const c1 = this._rot(u, knee), c2 = this._rot(u, -knee);
    const v = c1.X > c2.X ? c1 : c2;                        // таз уходит назад
    const H = { X: K.X + thigh * v.X, Y: K.Y + thigh * v.Y };
    const b = ((180 - knee) * 0.45 + lean) * Math.PI / 180;
    const dir = { X: -Math.sin(b), Y: -Math.cos(b) };
    const S = { X: H.X + torso * dir.X, Y: H.Y + torso * dir.Y };
    const pts = {
      0: { X: S.X + dir.X * 55 * s - 16 * s, Y: S.Y + dir.Y * 55 * s },
      11: S, 13: { X: S.X - 75 * s, Y: S.Y + 15 * s }, 15: { X: S.X - 150 * s, Y: S.Y + 10 * s },
      23: H, 25: K, 27: A, 31: T
    };
    this._far(pts, [[11, 12], [13, 14], [15, 16], [23, 24], [25, 26], [27, 28], [31, 32]], 10 * s, -5 * s);
    return this.make(pts, this.W, this.H, 26 * s);
  },

  /**
   * Подтягивания, вид спереди: вис на перекладине на высоте barY.
   * elbow — угол в локте (168 — полный вис, ~32 — подбородок над перекладиной),
   * sway — раскачивание таза и ног в px, kneeLift 0..1 — подтягивание коленей (кипинг).
   * Локоть находится решением двухзвенника «плечо–локоть–кисть»,
   * поэтому 2D-угол в локте в точности равен elbow.
   */
  pullupFront({ ox = 640, barY = 120, s = 0.75, elbow = 168, sway = 0, kneeLift = 0 } = {}) {
    const L1 = 105 * s, L2 = 100 * s, dx = 50 * s;
    const th = elbow * Math.PI / 180;
    const D = Math.sqrt(L1 * L1 + L2 * L2 - 2 * L1 * L2 * Math.cos(th));
    const vy = Math.sqrt(Math.max(D * D - dx * dx, 0));
    const pts = {};
    [[-1, 11, 13, 15, 23, 25, 27, 31], [1, 12, 14, 16, 24, 26, 28, 32]].forEach(([sign, iS, iE, iW, iH, iK, iA, iT]) => {
      const W = { X: ox + sign * 120 * s, Y: barY };
      const S = { X: ox + sign * 70 * s, Y: barY + vy };
      // Пересечение окружностей (S, L1) и (W, L2); локоть — снаружи
      const ddx = W.X - S.X, ddy = W.Y - S.Y, d = Math.hypot(ddx, ddy) || 1;
      const a = (L1 * L1 - L2 * L2 + d * d) / (2 * d), h = Math.sqrt(Math.max(L1 * L1 - a * a, 0));
      const mx = S.X + a * ddx / d, my = S.Y + a * ddy / d;
      const e1 = { X: mx + h * ddy / d, Y: my - h * ddx / d }, e2 = { X: mx - h * ddy / d, Y: my + h * ddx / d };
      const E = (e1.X - ox) * sign > (e2.X - ox) * sign ? e1 : e2;
      const H = { X: ox + sign * 45 * s + sway * s * 0.8, Y: S.Y + 190 * s };
      const K = { X: H.X + sign * 5 * s + sway * s * 0.3, Y: H.Y + 160 * s * (1 - 0.75 * kneeLift) };
      const A = { X: K.X + sway * s * 0.3, Y: K.Y + 150 * s };
      Object.assign(pts, { [iS]: S, [iE]: E, [iW]: W, [iH]: H, [iK]: K, [iA]: A, [iT]: { X: A.X + sign * 10 * s, Y: A.Y + 12 * s } });
    });
    const shY = (pts[11].Y + pts[12].Y) / 2;
    pts[0] = { X: ox, Y: shY - 85 * s };
    pts[9] = { X: ox - 12 * s, Y: shY - 65 * s };
    pts[10] = { X: ox + 12 * s, Y: shY - 65 * s };
    const pose = this.make(pts, this.W, this.H, 30 * s);
    pose.barY = barY;
    return pose;
  },

  /**
   * Вид спереди: стойка и присед. depth 0..1.1; valgus — колени внутрь.
   * arms: 'forward' | 'down' | 'up' | 'one' | 'low'
   */
  front({ ox = 640, floorY = 620, s = 1, depth = 0, valgus = false, arms = 'forward' } = {}) {
    const pts = {};
    const side = (sign, iS, iE, iW, iH, iK, iA, iT) => {
      const kneeSpread = valgus ? 60 - 45 * depth : 60 + 25 * depth;
      const A = { X: ox + sign * 55 * s, Y: floorY - 10 * s };
      const K = { X: ox + sign * kneeSpread * s, Y: floorY - (150 - 15 * depth) * s };
      const H = { X: ox + sign * 45 * s, Y: floorY - (300 - 130 * depth) * s };
      const S = { X: ox + sign * 70 * s, Y: H.Y - 190 * s * (1 - 0.1 * depth) };
      const up = arms === 'up' || (arms === 'one' && sign < 0);
      let E, W;
      if (up)                 { E = { X: S.X + sign * 20 * s, Y: S.Y - 85 * s }; W = { X: S.X + sign * 25 * s, Y: S.Y - 175 * s }; }
      else if (arms === 'low') { E = { X: S.X + sign * 80 * s, Y: S.Y - 10 * s }; W = { X: S.X + sign * 70 * s, Y: S.Y - 45 * s }; }
      else if (arms === 'forward') { E = { X: S.X - sign * 5 * s, Y: S.Y + 50 * s }; W = { X: ox + sign * 30 * s, Y: S.Y + 40 * s }; }
      else                    { E = { X: S.X + sign * 15 * s, Y: S.Y + 90 * s }; W = { X: S.X + sign * 20 * s, Y: S.Y + 175 * s }; }
      Object.assign(pts, { [iS]: S, [iE]: E, [iW]: W, [iH]: H, [iK]: K, [iA]: A, [iT]: { X: A.X + sign * 10 * s, Y: floorY + 2 * s } });
      return S;
    };
    const sl = side(-1, 11, 13, 15, 23, 25, 27, 31);
    side(1, 12, 14, 16, 24, 26, 28, 32);
    pts[0] = { X: ox, Y: sl.Y - 62 * s };
    return this.make(pts, this.W, this.H, 30 * s);
  }
};
