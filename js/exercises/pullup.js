/* ==================================================================
   pullup.js — распознавание подтягиваний (лицом или спиной к камере).

   Точки: нос 0, рот 9/10, плечи 11/12, локти 13/14, кисти 15/16,
          таз 23/24, колени 25/26.

   Воображаемая перекладина — линия на уровне кистей (руки держат турник).
   Подбородок ≈ рот + половина расстояния «нос → рот» вниз.
   Все расстояния нормируются на длину корпуса (плечи → таз), поэтому
   не зависят от роста человека и расстояния до камеры.

   Фаза повтора — по углу в локте (среднее по видимым рукам):
     d = (160° − угол) / 90°  → 0 в полном висе, ≈1 при согнутых руках.
   Направление «вниз» конечного автомата = подъём тела к перекладине.

   Ошибки (повтор не засчитывается):
     depth   — подбородок так и не поднялся выше перекладины
     lockout — внизу руки не разогнулись до ~155° (неполный вис)
     swing   — таз гуляет по горизонтали относительно перекладины
               больше чем на 35% длины корпуса за повтор
     kip     — колени подтянуты к тазу (рывок ногами, кипинг)
     drop    — спуск быстрее 0,35 с (бросил тело вниз)

   Без турника можно делать «подтягивания в воздухе»: руки вверх,
   тянуть локти вниз, пока кисти не окажутся на уровне подбородка.
   Правила те же, потому что всё считается относительно кистей.
   ================================================================== */
'use strict';

class PullupAnalyzer {
  constructor() {
    this.id = 'pullup';
    this.TOP = 160; this.DEPTH = 70;
    this.SWING = 0.35; this.KIP = 0.45; this.DROP_MS = 350;
    this.fsm = new RepFSM({ start: 0.25, reverse: 0.15, top: 0.08 });
    this.reset();
  }

  reset() { this.fsm.reset(); this.d = null; this.worst = this._fresh(); }
  _fresh() { return { chin: 9, offMin: 9, offMax: -9, knee: 9 }; }

  update(pose, t) {
    const out = { status: '', metric: { label: 'Угол локтя', value: '—', d: null }, live: [], liveJoints: [], rep: null, ready: false, bar: null };
    const V = CONFIG.VIS;

    const arms = [[11, 13, 15], [12, 14, 16]].filter(ids => Geo.visible(pose, ids, V));
    if (!pose[0] || pose[0].v < V || !arms.length) {
      out.status = 'Нужны голова, плечи, локти и кисти в кадре — отойди назад или наклони камеру вверх';
      this.fsm.reset();
      return out;
    }

    // Перекладина = линия кистей
    const wrists = [pose[15], pose[16]].filter(w => w && w.v >= V);
    const barY = wrists.reduce((a, w) => a + w.Y, 0) / wrists.length;
    const barX = wrists.reduce((a, w) => a + w.X, 0) / wrists.length;
    const shoulders = [pose[11], pose[12]].filter(p => p && p.v >= V);
    const shY = shoulders.reduce((a, p) => a + p.Y, 0) / shoulders.length;

    if (barY > shY) {
      out.status = '🙌 Возьмись за перекладину — руки над головой';
      this.fsm.reset();
      return out;
    }
    out.ready = true;

    // Длина корпуса — масштаб для всех проверок
    const hipsOk = Geo.visible(pose, [23, 24], V) || Geo.visible(pose, [23], V) || Geo.visible(pose, [24], V);
    const hipPts = [pose[23], pose[24]].filter(p => p && p.v >= V);
    const hip = hipPts.length ? { X: hipPts.reduce((a, p) => a + p.X, 0) / hipPts.length, Y: hipPts.reduce((a, p) => a + p.Y, 0) / hipPts.length } : null;
    const shW = shoulders.length === 2 ? Math.abs(shoulders[0].X - shoulders[1].X) : 0;
    const torso = hip ? Math.max(1, hip.Y - shY) : Math.max(1, shW * 1.3, 60);

    // Подбородок
    const nose = pose[0];
    const mouth = [pose[9], pose[10]].filter(p => p && p.v >= 0.3);
    const mouthY = mouth.length ? mouth.reduce((a, p) => a + p.Y, 0) / mouth.length : nose.Y + torso * 0.1;
    const chinY = mouthY + 0.5 * Math.max(0, mouthY - nose.Y);
    const chinRel = (chinY - barY) / torso;                         // > 0 — подбородок ниже перекладины
    const xs = wrists.map(w => w.X);
    out.bar = { y: barY, x0: Math.min(...xs), x1: Math.max(...xs), chinX: nose.X, chinY, over: chinRel <= 0 };

    // Угол локтя — среднее по видимым рукам
    const elbow = arms.reduce((a, [S, E, W]) => a + Geo.angle(pose[S], pose[E], pose[W]), 0) / arms.length;
    const dRaw = (this.TOP - elbow) / (this.TOP - this.DEPTH);
    this.d = this.d == null ? dRaw : this.d * 0.5 + dRaw * 0.5;
    out.metric = { label: 'Угол локтя', value: `${Math.round(elbow)}°`, d: U.clamp(this.d, 0, 1.2), at: pose[arms[0][1]] };

    // Раскачивание и кипинг
    const off = hip ? (hip.X - barX) / torso : null;
    const knees = [pose[25], pose[26]].filter(p => p && p.v >= V);
    const kneeRel = hip && knees.length ? (knees.reduce((a, p) => a + p.Y, 0) / knees.length - hip.Y) / torso : null;

    if (this.fsm.inRep) {
      const w = this.worst;
      w.chin = Math.min(w.chin, chinRel);
      if (off != null) { w.offMin = Math.min(w.offMin, off); w.offMax = Math.max(w.offMax, off); }
      if (kneeRel != null) w.knee = Math.min(w.knee, kneeRel);
      if (off != null && w.offMax - w.offMin > this.SWING) { out.live.push('swing'); out.liveJoints.push(23, 24); }
    }
    if (kneeRel != null && kneeRel < this.KIP) { out.live.push('kip'); out.liveJoints.push(25, 26); }

    const rep = this.fsm.update(this.d, t);
    if (rep) {
      const w = this.worst, errors = [], detail = {};
      if (w.chin > 0) { errors.push('depth'); detail.depth = 'Подбородок не дошёл до линии кистей.'; }
      if (!rep.lockout) errors.push('lockout');
      if (hipsOk && w.offMax - w.offMin > this.SWING) { errors.push('swing'); detail.swing = `Таз сместился на ${Math.round((w.offMax - w.offMin) * 100)}% длины корпуса.`; }
      if (w.knee < this.KIP) errors.push('kip');
      if (rep.lockout && rep.turnAt && rep.end - rep.turnAt < this.DROP_MS) {
        errors.push('drop'); detail.drop = `Спуск за ${((rep.end - rep.turnAt) / 1000).toFixed(2)} с.`;
      }
      out.rep = { ok: errors.length === 0, errors, detail, value: w.chin <= 0 ? 'подбородок над перекладиной' : `${Math.round(elbow)}°` };
      this.worst = this._fresh();
    }
    if (this.fsm.phase === 'top' || this.fsm.phase === 'stall') this.worst = this._fresh();

    out.status = this.fsm.phase === 'top' ? '🧗 Вис — подтягивайся'
      : this.fsm.phase === 'down' ? (chinRel <= 0 ? '✅ Подбородок над перекладиной — опускайся' : '⬆️ Выше, подбородок к перекладине…')
      : this.fsm.phase === 'up' ? '⬇️ Опускайся под контролем до прямых рук'
      : '⚠️ Выпрями руки внизу';
    return out;
  }
}
