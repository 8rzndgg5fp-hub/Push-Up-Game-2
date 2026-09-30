/* ==================================================================
   fatigue.js — передышка при перегрузке.
   Каждый повтор добавляет % нагрузки, со временем она спадает.
   При 100% — обязательный отдых 2 минуты: повторы не засчитываются,
   дуэли для этого игрока заблокированы.
   Нагрузка хранится в профиле, поэтому перезагрузка страницы не обходит блок.
   ================================================================== */
'use strict';

const Fatigue = {
  /** Актуальное состояние с учётом спада за прошедшее время */
  read(profile, now = Date.now()) {
    const f = profile.fatigue || (profile.fatigue = { load: 0, t: now, lockUntil: 0 });
    const dt = Math.max(0, (now - f.t) / 1000);
    f.t = now;
    if (f.lockUntil && now >= f.lockUntil) {      // отдых закончился
      f.lockUntil = 0;
      f.load = Math.min(f.load, CONFIG.FATIGUE.afterLock);
    } else if (!f.lockUntil) {
      f.load = Math.max(0, f.load - dt * CONFIG.FATIGUE.decayPerSec);
    }
    return f;
  },

  isLocked(profile) { return this.read(profile).lockUntil > Date.now(); },
  lockLeft(profile) { return Math.max(0, Math.ceil((this.read(profile).lockUntil - Date.now()) / 1000)); },
  load(profile) { return this.read(profile).lockUntil > Date.now() ? 100 : this.read(profile).load; },

  /** Добавить нагрузку. Возвращает { lockedNow } при достижении 100% */
  add(profile, amount) {
    const f = this.read(profile);
    if (f.lockUntil > Date.now()) return { locked: true };
    f.load += amount;
    let lockedNow = false;
    if (f.load >= 100) {
      f.load = 100;
      f.lockUntil = Date.now() + CONFIG.FATIGUE.lockSec * 1000;
      lockedNow = true;
    }
    Store.saveProfile(profile);
    return { lockedNow };
  }
};
