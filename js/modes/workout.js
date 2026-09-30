/* ==================================================================
   modes/workout.js — тренировка по плану.

   Фазы:  READY ──🙌 жест / кнопка──► SET ──цель достигнута──► REST
            ▲                                                   │
            └──── таймер отдыха истёк ◄───── 🙌 жест: пропустить отдых и сразу SET
   Повторы засчитываются ТОЛЬКО в фазе SET. Во время READY и REST
   движение распознаётся, но повтор не считается (с подсказкой).
   Каждый чистый повтор бьёт Голиафа: HP = сумма повторов плана.
   ================================================================== */
'use strict';

class WorkoutMode {
  constructor(profile, plan) {
    this.kind = 'workout';
    this.plan = plan;
    this.player = new Player(profile, plan.sets[0].ex, 'solo');
    this.players = [this.player];
    this.setIndex = 0; this.setReps = 0;
    this.phase = 'ready';
    this.perSet = plan.sets.map(s => ({ ex: s.ex, target: s.reps, reps: 0, errors: 0 }));
    this.total = plan.sets.reduce((a, s) => a + s.reps, 0);
    this.bossHP = this.total;
    this.startedAt = Date.now();
    this.restLeft = 0;
  }

  get cur() { return this.plan.sets[this.setIndex]; }
  elapsed() { return (Date.now() - this.startedAt) / 1000; }

  begin() { this.enterReady(); }

  /* ---------- Фазы ---------- */
  enterReady() {
    this.phase = 'ready';
    this.setReps = 0;
    const s = this.cur, ex = EXERCISES[s.ex];
    this.player.setExercise(s.ex);
    this.player.analyzer.reset();
    this.player.gesture.reset();
    Demo.setExercise(0, s.ex);
    App.renderDemoControls();
    UI.setExercise(s.ex);
    UI.renderErrors(this.players);

    UI.strip(`<b>Подход ${this.setIndex + 1}/${this.plan.sets.length}: ${ex.icon} ${ex.name} × ${s.reps}</b>
      <span>🙌 Подними обе руки над головой — старт. ${U.esc(ex.setup)}</span>`);
    UI.setIdle('Жду старта', 'Подними обе руки над головой или нажми «Начать подход».');
    UI.feedback('idle', 'Жду старта', 'Подними обе руки над головой или нажми «Начать подход».', { ms: 0 });
    App.setPrimaryAction('▶️ Начать подход', () => this.startSet());
    Voice.say(`Подход ${this.setIndex + 1}. ${ex.name}, ${s.reps}. Подними руки, чтобы начать.`, { key: 'ready' });
    this.renderHUD();
  }

  startSet() {
    if (this.phase !== 'ready') return;
    if (Fatigue.isLocked(this.player.profile)) {
      UI.feedback('warn', '⏸️ Обязательный отдых', `Подход можно начать через ${U.fmt(Fatigue.lockLeft(this.player.profile))}.`, { banner: true });
      return;
    }
    this.phase = 'set';
    UI.strip(null);
    this.player.analyzer.reset();
    Sound.ready();
    Voice.say('Поехали!', { key: 'go' });
    UI.setIdle(`${EXERCISES[this.cur.ex].icon} Подход ${this.setIndex + 1}`, `Цель: ${this.cur.reps} чистых повторов.`);
    UI.feedback('info', '▶️ Подход начался', `Цель: ${this.cur.reps} чистых повторов.`);
    UI.log('info', `Старт подхода ${this.setIndex + 1}: ${EXERCISES[this.cur.ex].name}`, this.elapsed());
    App.setPrimaryAction('⏹️ Завершить подход', () => this.finishSet());
    this.renderHUD();
  }

  finishSet() {
    if (this.phase !== 'set') return;
    UI.log('info', `Подход ${this.setIndex + 1}: ${this.setReps}/${this.cur.reps}`, this.elapsed());
    if (this.setIndex >= this.plan.sets.length - 1) return this.finish('done');

    this.phase = 'rest';
    this.setIndex++;
    this.restLeft = this.plan.rest;
    this.player.gesture.reset();
    Demo.setExercise(0, this.cur.ex);
    App.renderDemoControls();
    UI.show('rest-overlay', true);
    this.renderRest();
    Sound.beep(true);
    Voice.say(`Подход завершён. Отдых ${this.plan.rest} секунд.`, { key: 'rest' });
    UI.setIdle('😮‍💨 Отдых', 'Повторы во время отдыха не считаются. 🙌 Руки вверх — пропустить.');
    UI.feedback('idle', '😮‍💨 Отдых', 'Повторы во время отдыха не считаются. 🙌 Руки вверх — пропустить.', { ms: 0 });
    App.setPrimaryAction('⏭️ Пропустить отдых', () => this.skipRest());
    this.renderHUD();
  }

  /** Жест или кнопка во время отдыха: сразу следующий подход */
  skipRest() {
    if (this.phase !== 'rest') return;
    UI.show('rest-overlay', false);
    UI.log('info', 'Отдых пропущен', this.elapsed());
    this.enterReady();
    this.startSet();
  }

  endRest() {
    UI.show('rest-overlay', false);
    Voice.say('Отдых окончен.', { key: 'restend' });
    this.enterReady();
  }

  renderRest() {
    const s = this.cur, ex = EXERCISES[s.ex];
    U.$('rest-sec').textContent = U.fmt(this.restLeft);
    U.$('rest-ring').style.strokeDashoffset = 326.7 * (1 - this.restLeft / this.plan.rest);
    U.$('rest-next').textContent = `Дальше: ${ex.icon} ${ex.name} × ${s.reps}`;
  }

  /* ---------- Кадр ---------- */
  onPoses(poses, t) {
    const pose = poses.length ? poses.reduce((a, b) => (Geo.bbox(b).area > Geo.bbox(a).area ? b : a)) : null;
    const p = this.player;
    if (!pose) { p.analyze(null, t); UI.status('Не вижу тебя — отойди на 2–3 м'); UI.gesture(0); UI.metric(null); return; }

    // Жест работает только когда ждём старта или отдыхаем
    if (this.phase === 'ready' || this.phase === 'rest') {
      const g = p.gesture.update(pose, t);
      UI.gesture(g.progress, this.phase === 'ready' ? 'Старт' : 'Пропуск');
      if (g.error) App.gestureError(p, g.error, t);
      if (g.fired) this.phase === 'ready' ? this.startSet() : this.skipRest();
    } else UI.gesture(0);

    const r = p.analyze(pose, t);
    UI.metric(r); UI.status(r.status);

    if (r.rep) {
      if (this.phase !== 'set') {
        const rest = this.phase === 'rest';
        UI.feedback('warn', rest ? '⏸️ Идёт отдых' : '⏳ Подход не начат',
          rest ? 'Повторы во время отдыха не считаются.' : 'Подними руки над головой, чтобы начать.', { ms: 1600 });
        UI.log('warn', 'Повтор вне подхода — не засчитан', this.elapsed());
        return;
      }
      const out = App.processRep(p, r.rep, t, 50, this.elapsed());
      if (out === 'ok') {
        this.setReps++; this.perSet[this.setIndex].reps++;
        this.bossHP = Math.max(0, this.bossHP - 1);
        App.damageBoss(this.bossHP, this.total);
        Voice.say(String(this.setReps), { key: 'count', cooldown: 0 });
        if (this.setReps >= this.cur.reps) this.finishSet();
      } else if (out === 'error') {
        this.perSet[this.setIndex].errors++;
      }
      this.renderHUD();
    }
  }

  tick() {
    if (this.phase === 'rest') {
      this.restLeft--;
      if (this.restLeft <= 3 && this.restLeft > 0) Sound.beep();
      if (this.restLeft <= 0) this.endRest(); else this.renderRest();
    }
    U.$('hw-time').textContent = U.fmt(this.elapsed());
  }

  /* ---------- HUD ---------- */
  renderHUD() {
    const p = this.player.profile, s = this.cur, ex = EXERCISES[s.ex];
    U.$('hw-avatar').textContent = p.name[0].toUpperCase();
    U.$('hw-name').textContent = p.name;
    U.$('hw-rank').textContent = `${UI.rankHTML(p.elo)} · ${p.elo} Эло`;
    U.$('hw-set').textContent = `Подход ${this.setIndex + 1}/${this.plan.sets.length} · ${this.plan.name}`;
    U.$('hw-ex').textContent = `${ex.icon} ${ex.name}`;
    U.$('hw-set-reps').textContent = `${this.setReps}/${s.reps}`;
    U.$('hw-set-bar').style.width = `${U.pct(this.setReps, s.reps)}%`;
    U.$('hw-boss-text').textContent = `${this.bossHP} / ${this.total} HP`;
    U.$('hw-boss-fill').style.width = `${U.pct(this.bossHP, this.total)}%`;
    U.$('hw-boss-ghost').style.width = `${U.pct(this.bossHP, this.total)}%`;
    U.$('hw-reps').textContent = this.player.stats.reps;
    UI.setText('stage-score', `✅ ${this.player.stats.reps} · Подход ${this.setIndex + 1}: ${this.setReps}/${s.reps} · 🗿 ${this.bossHP} HP`);
  }

  /* ---------- Финал ---------- */
  finish(reason) {
    if (this.phase === 'done') return;
    this.phase = 'done';
    const pl = this.player, prof = pl.profile, st = pl.stats;
    const records = [];

    // Рекорды: лучший подход по каждому упражнению, суммарные повторы, точность
    Object.keys(EXERCISES).forEach(ex => {
      const best = Math.max(0, ...this.perSet.filter(s => s.ex === ex).map(s => s.reps));
      const key = ex + 'Set';
      if (best > (prof.records[key] || 0)) { prof.records[key] = best; records.push(`${EXERCISES[ex].icon} Лучший подход: ${best}`); }
      prof.records[ex + 'Total'] = (prof.records[ex + 'Total'] || 0) + st.byEx[ex].reps;
    });
    const acc = Math.round(pl.accuracy * 100);
    if (st.reps >= 10 && acc > (prof.records.bestAccuracy || 0)) { prof.records.bestAccuracy = acc; records.push(`🎯 Точность: ${acc}%`); }
    prof.records.workouts = (prof.records.workouts || 0) + 1;
    Store.saveProfile(prof);

    const data = {
      type: 'workout', profileId: prof.id, name: prof.name, plan: this.plan.name,
      completed: reason === 'done', bossDefeated: this.bossHP === 0,
      reps: st.reps, errors: st.errors, accuracy: acc, duration: Math.round(this.elapsed()),
      perSet: this.perSet, byCode: st.byCode, records
    };
    Store.addHistory(data);
    App.finishSession(data, reason === 'done');
  }

  quit() { this.finish('quit'); }
}
