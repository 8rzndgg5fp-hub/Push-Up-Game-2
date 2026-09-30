/* ==================================================================
   pushup.js — распознавание отжиманий (вид сбоку).

   Точки: плечо 11/12, локоть 13/14, запястье 15/16, таз 23/24,
          колено 25/26, лодыжка 27/28.
   Глубина d = (160° − угол локтя) / 60°  → d=1 при 100°.

   Ошибки (повтор не засчитывается):
     depth   — угол локтя не опустился до 100°
     sag     — таз ниже линии «плечо–лодыжка» (провис)
     pike    — таз выше этой линии (задран)
     lockout — наверху рука не выпрямилась (> 155°)
   ================================================================== */
'use strict';

class PushupAnalyzer {
  constructor() {
    this.id = 'pushup';
    this.TOP = 160; this.DEPTH = 100;
    this.SAG = 0.07; this.PIKE = -0.09;
    this.fsm = new RepFSM({ start: 0.25, reverse: 0.15, top: 0.08 });
    this.reset();
  }

  reset() { this.fsm.reset(); this.d = null; this.worst = { sag: 0, pike: 0 }; }

  update(pose, t) {
    const out = { status: '', metric: { label: 'Угол локтя', value: '—', d: null }, live: [], liveJoints: [], rep: null, ready: false };

    const side = Geo.bestSide(pose, [11, 13, 15, 23, 27], [12, 14, 16, 24, 28]);
    const [S, E, W, H, K, A] = (side === 'L' ? [11, 13, 15, 23, 25, 27] : [12, 14, 16, 24, 26, 28]).map(i => pose[i]);
    const foot = A && A.v >= CONFIG.VIS ? A : K;          // лодыжка может быть обрезана кадром — берём колено

    if (!Geo.visible(pose, side === 'L' ? [11, 13, 15, 23] : [12, 14, 16, 24]) || !foot || foot.v < CONFIG.VIS) {
      out.status = 'Встань боком: нужны плечо, локоть, запястье, таз и стопы';
      this.fsm.reset();
      return out;
    }

    // Тело должно быть примерно горизонтально — иначе это не упор лёжа
    if (Geo.fromHorizontal(S, foot) > 40) {
      out.status = 'Прими упор лёжа боком к камере';
      this.fsm.reset();
      return out;
    }
    out.ready = true;

    const elbow = Geo.angle(S, E, W);
    const dRaw = (this.TOP - elbow) / (this.TOP - this.DEPTH);
    this.d = this.d == null ? dRaw : this.d * 0.5 + dRaw * 0.5;   // сглаживание дрожания
    out.metric = { label: 'Угол локтя', value: `${Math.round(elbow)}°`, d: this.d, angle: elbow, at: E };

    // Линия тела: отклонение таза
    const dev = Geo.lineDev(S, H, foot);
    if (dev > this.SAG)  { out.live.push('sag');  out.liveJoints.push(23, 24); }
    if (dev < this.PIKE) { out.live.push('pike'); out.liveJoints.push(23, 24); }

    if (this.fsm.inRep) {
      this.worst.sag = Math.max(this.worst.sag, dev);
      this.worst.pike = Math.min(this.worst.pike, dev);
    }

    const rep = this.fsm.update(this.d, t);
    if (rep) {
      const errors = [], detail = {};
      const minElbow = Math.round(this.TOP - rep.maxD * (this.TOP - this.DEPTH));
      if (rep.maxD < 1) { errors.push('depth'); detail.depth = `Угол локтя ${minElbow}° > 90°`; }
      if (this.worst.sag > this.SAG) errors.push('sag');
      if (this.worst.pike < this.PIKE) errors.push('pike');
      if (!rep.lockout) errors.push('lockout');
      out.rep = { ok: errors.length === 0, errors, detail, value: `${minElbow}°` };
      this.worst = { sag: 0, pike: 0 };
    }
    if (!this.fsm.inRep && this.fsm.phase !== 'up') this.worst = { sag: 0, pike: 0 };

    out.status = this.fsm.phase === 'top' ? '⬆️ Верх — опускайся'
      : this.fsm.phase === 'down' ? (this.d >= 1 ? '✅ Глубина есть — выжимай!' : '⬇️ Ниже…')
      : this.fsm.phase === 'up' ? '⬆️ Выжимай до прямых рук'
      : '⚠️ Выпрями руки';
    return out;
  }
}
