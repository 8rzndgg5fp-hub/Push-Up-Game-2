/* ==================================================================
   gestures.js — третий жест: «обе руки над головой».
   Удержание 0,8 с → срабатывание (старт подхода / пропуск отдыха /
   готовность к дуэли). После срабатывания нужно опустить руки.

   Режим ошибки жеста:
     oneHand — одна рука над головой дольше 0,7 с → «Подними и вторую руку»
     low     — обе кисти выше плеч, но ниже головы → «Выше — кисти над головой»
   ================================================================== */
'use strict';

class HandsUpGesture {
  constructor() { this.reset(); }

  reset() {
    // armed = false: после сброса жест сработает, только если руки сначала опущены.
    // Так вис на турнике (руки уже вверху) не запускает подход и не пропускает отдых сам по себе.
    this.holdStart = null; this.armed = false; this.cooldownUntil = 0;
    this.badState = null; this.badSince = 0; this.lastErrorAt = -Infinity;
  }

  /**
   * @returns {{state:'none'|'one'|'low'|'both', progress:number, fired:boolean, error:string|null}}
   */
  update(pose, t) {
    const res = { state: 'none', progress: 0, fired: false, error: null };
    if (!pose || !Geo.visible(pose, [0, 11, 12], 0.4)) { this.holdStart = null; return res; }

    const nose = pose[0];
    const shY = (pose[11].Y + pose[12].Y) / 2;
    const wr = [pose[15], pose[16]].map(w => (w && w.v >= 0.3 ? w : null));
    const above = wr.map(w => !!w && w.Y < nose.Y);
    const overShoulder = wr.map(w => !!w && w.Y < shY);

    if (above[0] && above[1]) res.state = 'both';
    else if (above[0] !== above[1]) res.state = 'one';
    else if (overShoulder[0] && overShoulder[1]) res.state = 'low';

    // Руки опущены — жест снова можно использовать
    if (res.state === 'none') this.armed = true;

    // Удержание обеих рук
    if (res.state === 'both' && this.armed && t >= this.cooldownUntil) {
      this.holdStart = this.holdStart ?? t;
      res.progress = U.clamp((t - this.holdStart) / CONFIG.GESTURE.holdMs, 0, 1);
      if (res.progress >= 1) {
        res.fired = true;
        this.armed = false;
        this.holdStart = null;
        this.cooldownUntil = t + CONFIG.GESTURE.cooldownMs;
      }
    } else {
      this.holdStart = null;
    }

    // Ошибки жеста: состояние должно держаться, чтобы не ругаться на промежуточные кадры
    const bad = res.state === 'one' ? 'oneHand' : res.state === 'low' ? 'low' : null;
    if (bad !== this.badState) { this.badState = bad; this.badSince = t; }
    if (bad && t - this.badSince > CONFIG.GESTURE.errorAfterMs && t - this.lastErrorAt > CONFIG.GESTURE.errorRepeatMs) {
      res.error = bad;
      this.lastErrorAt = t;
    }
    return res;
  }
}
