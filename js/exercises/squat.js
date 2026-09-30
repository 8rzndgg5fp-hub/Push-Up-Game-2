/* ==================================================================
   squat.js — распознавание приседаний.

   Ракурс определяется автоматически каждый кадр:
     лицом к камере — ширина плеч заметна относительно высоты корпуса;
     боком          — плечи почти сливаются в одну точку.

   Глубина d:
     боком — по углу колена (таз–колено–лодыжка): d=1 при 100°;
     лицом — по отношению (колено.Y − таз.Y) / (лодыжка.Y − колено.Y):
             стоя ≈ 1, бедро параллельно полу ≈ 0.35.

   Ошибки:
     depth   — недостаточная глубина (оба ракурса)
     valgus  — колени внутрь (лицом): колени уже лодыжек
     toes    — колени за носками (боком): колено далеко впереди носка
     lean    — наклон корпуса (боком): корпус > 55° от вертикали
     lockout — неполный подъём (оба ракурса)
     tempo   — повтор быстрее 1 секунды (оба ракурса)
   ================================================================== */
'use strict';

class SquatAnalyzer {
  constructor() {
    this.id = 'squat';
    this.TOP = 165; this.DEPTH = 100;
    this.VALGUS = 0.75; this.TOES = 0.25; this.LEAN = 55; this.MIN_MS = 1000;
    this.fsm = new RepFSM({ start: 0.25, reverse: 0.15, top: 0.1 });
    this.reset();
  }

  reset() { this.fsm.reset(); this.d = null; this.front = null; this.worst = this._fresh(); }
  _fresh() { return { valgus: 9, toes: -9, lean: 0, views: { side: 0, front: 0 } }; }

  update(pose, t) {
    const out = { status: '', metric: { label: 'Глубина', value: '—', d: null }, live: [], liveJoints: [], rep: null, ready: false };

    // Боком дальняя нога перекрыта — достаточно одной стороны; лицом нужны обе
    const leftOk = Geo.visible(pose, [23, 25, 27], 0.4), rightOk = Geo.visible(pose, [24, 26, 28], 0.4);
    if (!leftOk && !rightOk) {
      out.status = 'Нужны таз, колени и стопы в кадре — отойди дальше';
      this.fsm.reset();
      return out;
    }

    const sh = Geo.mid(pose[11], pose[12]), hip = Geo.mid(pose[23], pose[24]);
    const torsoH = Math.abs(sh.Y - hip.Y) || 1;
    // Ракурс с гистерезисом: не прыгает «лицом/боком» на пограничных кадрах
    const ratio = leftOk && rightOk && Geo.visible(pose, [11, 12], 0.4) ? Math.abs(pose[11].X - pose[12].X) / torsoH : 0;
    if (this.front == null) this.front = ratio > 0.4;
    else if (ratio > 0.5) this.front = true;
    else if (ratio < 0.3) this.front = false;
    const front = this.front;

    // Стоит ли человек: таз выше коленей, колени выше стоп (по видимой стороне)
    const [iH, iK, iA] = leftOk ? [23, 25, 27] : [24, 26, 28];
    if (!(pose[iH].Y < pose[iA].Y && pose[iK].Y < pose[iA].Y) || Geo.fromVertical(pose[iH], sh) > 80) {
      out.status = 'Встань прямо — от головы до стоп в кадре';
      this.fsm.reset();
      return out;
    }
    out.ready = true;

    let dRaw, metricValue, at;
    const m = {};
    if (front) {
      const r = ((pose[25].Y - pose[23].Y) / Math.max(1, pose[27].Y - pose[25].Y) +
                 (pose[26].Y - pose[24].Y) / Math.max(1, pose[28].Y - pose[26].Y)) / 2;
      dRaw = (1 - r) / (1 - 0.35);
      m.valgus = Math.abs(pose[25].X - pose[26].X) / Math.max(1, Math.abs(pose[27].X - pose[28].X));
      metricValue = `${Math.round(U.clamp(dRaw, 0, 1.3) * 100)}%`;
      at = Geo.mid(pose[25], pose[26]);
    } else {
      const side = Geo.bestSide(pose, [23, 25, 27], [24, 26, 28]);
      const [S, H, K, A, T] = (side === 'L' ? [11, 23, 25, 27, 31] : [12, 24, 26, 28, 32]).map(i => pose[i]);
      const knee = Geo.angle(H, K, A);
      dRaw = (this.TOP - knee) / (this.TOP - this.DEPTH);
      m.lean = Geo.fromVertical(H, S);
      if (T && T.v >= 0.4) {
        const shin = Geo.dist(K, A) || 1;
        const dir = Math.sign(T.X - A.X) || 1;              // куда смотрят носки
        m.toes = (K.X - T.X) * dir / shin;                  // > 0 — колено впереди носка
      }
      metricValue = `${Math.round(knee)}°`;
      at = K;
    }

    this.d = this.d == null ? dRaw : this.d * 0.5 + dRaw * 0.5;
    out.metric = { label: front ? 'Глубина (лицом)' : 'Угол колена', value: metricValue, d: this.d, at };

    // Живые подсказки в нижней части движения — подсветка суставов сразу
    if (this.d > 0.55) {
      if (front && m.valgus < this.VALGUS)            { out.live.push('valgus'); out.liveJoints.push(25, 26); }
      if (!front && m.toes != null && m.toes > this.TOES) { out.live.push('toes'); out.liveJoints.push(25, 26); }
      if (!front && m.lean > this.LEAN)               { out.live.push('lean'); out.liveJoints.push(11, 12, 23, 24); }
    }

    // Худшие значения за повтор (только когда глубоко)
    if (this.fsm.inRep) {
      const w = this.worst;
      w.views[front ? 'front' : 'side']++;
      if (this.d > 0.55) {
        if (m.valgus != null) w.valgus = Math.min(w.valgus, m.valgus);
        if (m.toes != null) w.toes = Math.max(w.toes, m.toes);
        if (m.lean != null) w.lean = Math.max(w.lean, m.lean);
      }
    }

    const rep = this.fsm.update(this.d, t);
    if (rep) {
      const w = this.worst, errors = [], detail = {};
      if (rep.maxD < 1) { errors.push('depth'); detail.depth = `Не хватает ${Math.round((1 - rep.maxD) * 100)}% до параллели`; }
      if (w.valgus < this.VALGUS) errors.push('valgus');
      if (w.toes > this.TOES) errors.push('toes');
      if (w.lean > this.LEAN) { errors.push('lean'); detail.lean = `Наклон ${Math.round(w.lean)}° > ${this.LEAN}°`; }
      if (!rep.lockout) errors.push('lockout');
      if (rep.duration < this.MIN_MS) { errors.push('tempo'); detail.tempo = `Повтор за ${(rep.duration / 1000).toFixed(1)} с`; }
      out.rep = { ok: errors.length === 0, errors, detail, value: metricValue, view: w.views.front > w.views.side ? 'front' : 'side' };
      this.worst = this._fresh();
    }
    if (this.fsm.phase === 'top' || this.fsm.phase === 'stall') this.worst = this._fresh();

    out.status = (front ? '👤 Лицом · ' : '🧍 Боком · ') + (
      this.fsm.phase === 'top' ? 'Приседай' :
      this.fsm.phase === 'down' ? (this.d >= 1 ? '✅ Глубина есть — вставай!' : '⬇️ Ниже…') :
      this.fsm.phase === 'up' ? '⬆️ Вставай до конца' : '⚠️ Выпрямись полностью');
    return out;
  }
}

/** Фабрика анализаторов */
function createAnalyzer(ex) {
  if (ex === 'squat') return new SquatAnalyzer();
  if (ex === 'pullup') return new PullupAnalyzer();
  return new PushupAnalyzer();
}
