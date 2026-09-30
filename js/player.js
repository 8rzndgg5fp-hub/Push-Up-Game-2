/* ==================================================================
   player.js — один игрок на арене: профиль, текущее упражнение,
   анализатор, жест, статистика и подсветка проблемных суставов.
   В тренировке игрок один, в дуэли — два (A и B).
   ================================================================== */
'use strict';

class Player {
  constructor(profile, exercise, slot) {
    this.profile = profile;
    this.slot = slot;                         // 'solo' | 'A' | 'B'
    this.gesture = new HandsUpGesture();
    this.stats = {
      reps: 0, errors: 0, byCode: {}, streak: 0, bestStreak: 0,
      byEx: Object.fromEntries(Object.keys(EXERCISES).map(k => [k, { reps: 0, errors: 0 }]))
    };
    this.badJoints = new Set(); this.badUntil = 0;
    this.flashColor = null; this.flashUntil = 0;
    this.pose = null; this.result = null;
    this.setExercise(exercise);
  }

  get label() { return this.slot === 'solo' ? this.profile.name : `${this.slot}: ${this.profile.name}`; }
  get accuracy() { const n = this.stats.reps + this.stats.errors; return n ? this.stats.reps / n : 0; }

  setExercise(ex) {
    if (this.exercise === ex && this.analyzer) return;
    this.exercise = ex;
    this.analyzer = createAnalyzer(ex);
  }

  /** Прогнать позу через анализатор упражнения */
  analyze(pose, t) {
    this.pose = pose;
    this.result = pose ? this.analyzer.update(pose, t) : null;
    return this.result;
  }

  /** Какие суставы красить красным сейчас: живые ошибки + после неудачного повтора */
  highlight(t) {
    const s = new Set(this.result?.liveJoints || []);
    if (t < this.badUntil) this.badJoints.forEach(j => s.add(j));
    return s;
  }

  flagError(joints, t) {
    this.badJoints = new Set(joints);
    this.badUntil = t + 1800;
    this.flash('#e11d48', t, 500);
  }

  flash(color, t, ms) { this.flashColor = color; this.flashUntil = t + ms; }
  flashNow(t) { return t < this.flashUntil ? this.flashColor : null; }

  /** Учёт повтора в статистике */
  record(rep) {
    const s = this.stats, ex = this.exercise;
    if (rep.ok) {
      s.reps++; s.byEx[ex].reps++;
      s.streak++; s.bestStreak = Math.max(s.bestStreak, s.streak);
    } else {
      s.errors++; s.byEx[ex].errors++; s.streak = 0;
      rep.errors.forEach(c => { const k = ex + ':' + c; s.byCode[k] = (s.byCode[k] || 0) + 1; });
    }
  }
}
