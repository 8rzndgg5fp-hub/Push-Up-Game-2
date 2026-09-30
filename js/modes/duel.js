/* ==================================================================
   modes/duel.js — дуэль 60 секунд: ТЫ против виртуального бота.

   Фазы: LOBBY ──🙌 руки над головой / кнопка──► COUNTDOWN ──► FIGHT (60 с) ──► DONE
   • Бот (bot.js) двигается и распознаётся тем же анализатором, что и
     игрок: в реальном времени видно его статус, ошибки и счёт.
   • При смене лидера — голосовая подсказка («Бот обгоняет!»).
   • Обязательный отдых после перегрузки блокирует дуэль.
   • Эло пересчитывается с учётом рейтинга бота (elo.js → applyVsBot).
   ================================================================== */
'use strict';

class DuelMode {
  constructor(profile, botCfg, ex) {
    this.kind = 'duel';
    this.ex = ex;
    this.botCfg = botCfg;
    this.player = new Player(profile, ex, 'solo');
    this.players = [this.player];
    this.bot = new BotOpponent(botCfg, ex, U.$('bot-canvas'), (type, code) => this.onBotEvent(type, code));
    this.phase = 'lobby';
    this.timeLeft = CONFIG.DUEL_TIME;
    this.preview = Elo.preview(profile, { elo: botCfg.elo, duels: 99 });
    this.fightStart = 0;
    this.leader = 0;              // 1 — игрок впереди, -1 — бот, 0 — ровно
  }

  elapsed() { return this.fightStart ? (Date.now() - this.fightStart) / 1000 : null; }
  locked() { return Fatigue.isLocked(this.player.profile); }

  begin() {
    Demo.setExercise(0, this.ex);
    App.renderDemoControls();
    UI.setExercise(this.ex);
    UI.renderErrors(this.players);
    this.bot.startLoop();
    this.renderLobby();
    App.setPrimaryAction('▶️ Начать дуэль', () => this.startCountdown());
    UI.setIdle('Лобби дуэли', 'Подними обе руки над головой или нажми «Начать дуэль».');
    UI.feedback('idle', 'Лобби дуэли', 'Подними обе руки над головой или нажми «Начать дуэль».', { ms: 0 });
    Voice.say(`Соперник: ${this.botCfg.name}. Подними руки над головой, чтобы начать.`, { key: 'lobby' });
    this.renderHUD();
  }

  renderLobby() {
    const ex = EXERCISES[this.ex], b = this.botCfg;
    const lock = this.locked();
    UI.strip(`<b>⚔️ Ты vs ${b.icon} ${U.esc(b.name)} · ${ex.icon} ${ex.name} · 60 секунд</b>
      <span>${lock
        ? `<span class="text-amber-300">⏸️ Обязательный отдых ещё ${U.fmt(Fatigue.lockLeft(this.player.profile))} — дуэль заблокирована.</span>`
        : `🙌 Подними обе руки над головой — старт. Бот уже готов. ${U.esc(ex.setup)}`}</span>`);
  }

  startCountdown() {
    if (this.phase !== 'lobby') return;
    if (this.locked()) {
      UI.feedback('warn', '⏸️ Дуэль заблокирована', `Обязательный отдых ещё ${U.fmt(Fatigue.lockLeft(this.player.profile))}.`, { banner: true });
      return;
    }
    this.phase = 'countdown';
    UI.strip(null); UI.gesture(0);
    App.setPrimaryAction(null);
    const session = App.session;
    UI.countdown(() => App.session === session, () => {
      this.phase = 'fight';
      this.fightStart = Date.now();
      this.player.analyzer.reset();
      this.bot.start();
      Voice.say('Бой!', { key: 'fight' });
      UI.setIdle('⚔️ Дуэль идёт', 'Считаются только чистые повторы — у тебя и у бота.');
      UI.feedback('idle', '⚔️ Дуэль идёт', 'Считаются только чистые повторы — у тебя и у бота.', { ms: 0 });
      UI.log('info', `Дуэль с ботом «${this.botCfg.name}» началась`, 0);
    });
  }

  onPoses(poses, t) {
    const pose = poses.length ? poses.reduce((a, b) => (Geo.bbox(b).area > Geo.bbox(a).area ? b : a)) : null;
    const p = this.player;
    if (!pose) { p.analyze(null, t); UI.status('Не вижу тебя — отойди на 2–3 м'); UI.gesture(0); UI.metric(null); return; }

    if (this.phase === 'lobby') {
      const g = p.gesture.update(pose, t);
      UI.gesture(g.progress, 'Старт');
      if (g.error) App.gestureError(p, g.error, t);
      if (g.fired) this.startCountdown();
    }

    const r = p.analyze(pose, t);
    UI.metric(r); UI.status(r.status);

    if (r.rep) {
      if (this.phase === 'fight') {
        App.processRep(p, r.rep, t, 40, this.elapsed());
        this.checkLead();
      } else if (this.phase === 'lobby') {
        UI.feedback('warn', '⏳ Дуэль ещё не началась', 'Повтор не засчитан — подними руки для старта.', { ms: 1400 });
      }
    }
    this.renderHUD();
  }

  /** События бота: засчитанный повтор или ошибка техники */
  onBotEvent(type, code) {
    if (this.phase !== 'fight') return;
    const b = this.botCfg;
    if (type === 'ok') {
      Sound.botRep();
      UI.float(`${b.icon} +1`, 'bot', 82);
      UI.log('bot', `${b.icon} ${b.name}: чистый повтор (${this.bot.reps})`, this.elapsed());
    } else {
      UI.float(`${b.icon} ✗`, 'bad', 82);
      UI.log('bot', `${b.icon} ${b.name}: ${ERRORS[this.ex][code].title} — не засчитано`, this.elapsed());
    }
    this.checkLead();
    this.renderHUD();
  }

  /** Смена лидера — голос и всплывающая надпись */
  checkLead() {
    const diff = this.player.stats.reps - this.bot.reps;
    const lead = Math.sign(diff);
    if (lead === this.leader || lead === 0) { if (lead === 0) this.leader = 0; return; }
    this.leader = lead;
    if (lead > 0) { Voice.say('Ты впереди!', { key: 'lead', cooldown: 5000 }); UI.float('Ты впереди! 🔥', 'good', 50); }
    else { Voice.say('Бот обгоняет!', { key: 'lead', cooldown: 5000 }); UI.float('Бот обгоняет! ⚡', 'bot', 50); }
  }

  tick() {
    if (this.phase === 'lobby') this.renderLobby();
    if (this.phase !== 'fight') return;
    this.timeLeft--;
    this.bot.timeLeft = this.timeLeft;
    if (this.timeLeft <= 5 && this.timeLeft > 0) Sound.beep();
    if (this.timeLeft === 30) Voice.say('Половина времени', { key: 'half' });
    if (this.timeLeft === 10) Voice.say('Десять секунд! Бот ускоряется', { key: 'ten' });
    if (this.timeLeft <= 0) this.finish('time');
    this.renderHUD();
  }

  renderHUD() {
    const p = this.player, prof = p.profile, bot = this.bot, b = this.botCfg;
    const T = UI.setText.bind(UI);
    T('hd-a-name', prof.name);
    T('hd-a-rank', `${UI.rankHTML(prof.elo)} · ${prof.elo}`);
    T('hd-a-reps', p.stats.reps);
    T('hd-a-err', `ошибок: ${p.stats.errors} · шанс ${Math.round(this.preview.chanceA * 100)}%`);
    T('hd-b-name', `${b.icon} ${b.name}`);
    T('hd-b-rank', `Бот · ${b.elo} Эло`);
    T('hd-b-reps', bot.reps);
    T('hd-b-status', bot.status);
    T('hd-b-err', `ошибок: ${bot.errors} · шанс ${Math.round(this.preview.chanceB * 100)}%`);
    U.$('hd-b-status').dataset.state = bot.status.startsWith('⚠️') ? 'error' : 'ok';
    T('hd-timer', U.fmt(this.timeLeft));
    U.$('hd-timer').classList.toggle('is-urgent', this.timeLeft <= 10 && this.phase === 'fight');
    T('hd-ex', `${EXERCISES[this.ex].icon} ${EXERCISES[this.ex].name}`);
    const max = Math.max(10, p.stats.reps, bot.reps);
    U.$('hd-a-bar').style.width = `${p.stats.reps / max * 100}%`;
    U.$('hd-b-bar').style.width = `${bot.reps / max * 100}%`;
    T('stage-score', `Ты ${p.stats.reps} : ${bot.reps} ${b.icon} · ${U.fmt(this.timeLeft)}`);
  }

  finish(reason) {
    if (this.phase === 'done') return;
    const wasFight = this.phase === 'fight';
    this.phase = 'done';
    this.bot.stop();
    const P = this.player, bot = this.bot, prof = P.profile, b = this.botCfg;

    if (reason === 'quit' || !wasFight) {
      this.bot.destroy();
      UI.toast('Дуэль отменена — рейтинг не изменился', 'warn');
      App.finishSession(null, false);
      return;
    }

    const scoreA = P.stats.reps > bot.reps ? 1 : P.stats.reps === bot.reps ? 0.5 : 0;
    const eloBefore = prof.elo, rankBefore = Elo.rank(prof.elo).name;
    const delta = Elo.applyVsBot(prof, b.elo, scoreA);
    prof.records.duelBest = Math.max(prof.records.duelBest || 0, P.stats.reps);
    Store.saveProfile(prof);

    const data = {
      type: 'duel', vsBot: true, exercise: this.ex, scoreA,
      chanceA: Math.round(this.preview.chanceA * 100),
      a: { id: prof.id, name: prof.name, reps: P.stats.reps, errors: P.stats.errors, accuracy: Math.round(P.accuracy * 100),
           eloBefore, eloAfter: prof.elo, delta, rankBefore, rankAfter: Elo.rank(prof.elo).name, byCode: P.stats.byCode },
      b: { id: null, bot: true, icon: b.icon, name: b.name, elo: b.elo, reps: bot.reps, errors: bot.errors,
           accuracy: Math.round(bot.accuracy * 100), delta: 0, byCode: bot.byCode }
    };
    Store.addHistory(data);
    setTimeout(() => this.bot.destroy(), 1600);
    App.finishSession(data, true);
  }

  quit() { this.finish('quit'); }
}
