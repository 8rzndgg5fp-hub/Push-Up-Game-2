/* ==================================================================
   app.js — главный контроллер.
   Связывает экраны, профили, планы, дуэль, источник поз
   (камера или симуляция) и режимы игры.

   Конвейер кадра (одинаковый для камеры и симуляции):
     Vision / Demo → App.onPoses(poses) → mode.onPoses → Player.analyze
       → анализатор упражнения (конечный автомат + детекторы ошибок)
       → App.processRep (засчитать / ошибка / отдых) → отрисовка скелета
   ================================================================== */
'use strict';

const App = {
  session: 0, mode: null, demo: false, primary: null, tickId: null, lastConfig: null,

  init() {
    this.video = U.$('video');
    this.canvas = U.$('canvas');
    this.ctx = this.canvas.getContext('2d');

    const s = Store.settings();
    UI.applyTheme(s.theme);
    Sound.enabled = s.sound; Voice.enabled = s.voice; Technique.enabled = s.techModal;
    U.$('btn-sound').textContent = s.sound ? '🔊' : '🔇';
    U.$('btn-voice').textContent = s.voice ? '🗣️' : '🤐';
    Voice.init();
    Technique.init();
    BodyGuide.enabled = s.guide !== false;
    this.botId = s.botId || BOTS[1].id;

    this.bind();
    this.applyFit(s.fit || 'contain');
    U.$('btn-guide').setAttribute('aria-pressed', BodyGuide.enabled);
    this.refreshHome();
    this.checkCamera();
    UI.showScreen('screen-home');
  },

  /* ================================================================
     ПРОФИЛИ И ГЛАВНЫЙ ЭКРАН
     ================================================================ */
  profile() {
    let p = Store.getProfile(Store.settings().profileId);
    if (!p) { p = Store.profiles()[0] || Store.ensureProfile('Игрок'); Store.setSetting('profileId', p.id); }
    return p;
  },

  refreshHome() {
    const p = this.profile(), s = Store.settings();
    U.$('profile-select').innerHTML = Store.profiles()
      .map(x => `<option value="${x.id}" ${x.id === p.id ? 'selected' : ''}>${U.esc(x.name)} — ${UI.rankHTML(x.elo)}</option>`).join('');
    this.renderProfileCard(p);

    const plans = Store.allPlans();
    const planId = plans.some(x => x.id === s.planId) ? s.planId : plans[0].id;
    U.$('plan-select').innerHTML = plans.map(x => `<option value="${x.id}" ${x.id === planId ? 'selected' : ''}>${x.preset ? '⭐' : '🛠️'} ${U.esc(x.name)}</option>`).join('');
    this.renderPlanPreview(Store.getPlan(planId));

    U.$('opt-demo').checked = s.demo;
    U.$('opt-tech').checked = s.techModal;
    U.$('hdr-profile').textContent = `${Elo.rank(p.elo).icon} ${p.name}`;
  },

  renderProfileCard(p) {
    const r = Elo.rank(p.elo), rec = p.records, load = Math.round(Fatigue.load(p)), locked = Fatigue.isLocked(p);
    U.$('profile-card').innerHTML = `
      <div class="flex items-center gap-4">
        <div class="avatar avatar-lg">${U.esc(p.name[0].toUpperCase())}</div>
        <div class="min-w-0 flex-1">
          <div class="font-display text-2xl truncate">${U.esc(p.name)}</div>
          <div class="text-sm text-slate-600 dark:text-slate-300">${r.icon} ${r.name} · <b>${p.elo}</b> Эло · дуэли ${p.wins}/${p.draws}/${p.losses}</div>
          <div class="rank-track mt-2"><div class="rank-fill" style="width:${Math.round(r.progress * 100)}%"></div></div>
          <div class="text-xs text-slate-500 dark:text-slate-400 mt-1">${r.next ? `До ранга «${r.next.icon} ${r.next.name}»: ${r.next.min - p.elo} Эло` : 'Максимальный ранг'}</div>
        </div>
      </div>
      <div class="grid grid-cols-4 gap-2 mt-4 text-center">
        <div class="stat-mini"><span>💪 подход</span><b>${rec.pushupSet || 0}</b></div>
        <div class="stat-mini"><span>🦵 подход</span><b>${rec.squatSet || 0}</b></div>
        <div class="stat-mini"><span>🧗 подход</span><b>${rec.pullupSet || 0}</b></div>
        <div class="stat-mini"><span>⚔️ дуэль</span><b>${rec.duelBest}</b></div>
      </div>
      <div class="mt-4">
        <div class="flex justify-between text-xs font-semibold mb-1"><span>Нагрузка</span><span>${locked ? '⏸️ отдых ' + U.fmt(Fatigue.lockLeft(p)) : load + '%'}</span></div>
        <div class="load-track"><div class="load-fill ${locked ? 'lock' : load >= 80 ? 'hot' : load >= 50 ? 'warm' : 'ok'}" style="width:${locked ? 100 : load}%"></div></div>
      </div>`;
  },

  renderPlanPreview(plan) {
    const reps = plan.sets.reduce((a, s) => a + s.reps, 0);
    U.$('plan-preview').innerHTML = `
      <div class="text-sm text-slate-600 dark:text-slate-400 mb-2">${U.esc(plan.desc || 'Свой план')} · отдых ${plan.rest} с · всего ${reps} повторов (HP Голиафа)</div>
      <div class="flex flex-wrap gap-2">${plan.sets.map((s, i) => `<span class="set-chip">${i + 1}. ${EXERCISES[s.ex].icon} ${s.reps}</span>`).join('')}</div>`;
  },

  async checkCamera() {
    const st = await Vision.permissionStatus();
    const box = U.$('cam-status');
    box.dataset.tone = st.tone; box.textContent = st.text;
  },

  /* ================================================================
     ПЛАНЫ И КОНСТРУКТОР
     ================================================================ */
  renderPlans() {
    const cur = Store.settings().planId;
    U.$('plans-list').innerHTML = Store.allPlans().map(p => {
      const reps = p.sets.reduce((a, s) => a + s.reps, 0);
      return `<div class="panel p-5 flex flex-col gap-3 ${p.id === cur ? 'plan-active' : ''}">
        <div class="flex items-start justify-between gap-2">
          <div><div class="font-display text-lg">${p.preset ? '⭐' : '🛠️'} ${U.esc(p.name)}</div>
          <div class="text-sm text-slate-600 dark:text-slate-400">${U.esc(p.desc || 'Свой план')}</div></div>
          ${p.preset ? '<span class="tag">Готовый</span>' : '<span class="tag tag-own">Свой</span>'}
        </div>
        <div class="flex flex-wrap gap-2">${p.sets.map((s, i) => `<span class="set-chip">${i + 1}. ${EXERCISES[s.ex].icon} ${EXERCISES[s.ex].name} × ${s.reps}</span>`).join('')}</div>
        <div class="text-xs text-slate-500 dark:text-slate-400">${p.sets.length} подх. · отдых ${p.rest} с · ${reps} повторов</div>
        <div class="flex gap-2 mt-auto">
          <button class="btn-secondary btn-sm flex-1" data-plan-pick="${p.id}">${p.id === cur ? '✓ Выбран' : 'Выбрать'}</button>
          ${p.preset ? '' : `<button class="btn-secondary btn-sm" data-plan-del="${p.id}" aria-label="Удалить план">🗑️</button>`}
        </div></div>`;
    }).join('');
    if (!U.$('builder-rows').children.length) { this.addBuilderRow('pushup', 10); this.addBuilderRow('squat', 12); this.addBuilderRow('pullup', 5); }
  },

  addBuilderRow(ex = 'pushup', reps = 10) {
    const row = document.createElement('div');
    row.className = 'builder-row';
    row.innerHTML = `
      <span class="builder-num"></span>
      <select class="text-input input-sm" aria-label="Упражнение">
        ${Object.values(EXERCISES).map(e => `<option value="${e.id}" ${ex === e.id ? 'selected' : ''}>${e.icon} ${e.name}</option>`).join('')}
      </select>
      <input type="number" class="text-input input-sm w-24" min="1" max="100" value="${reps}" aria-label="Повторы">
      <button class="icon-btn" data-row-del aria-label="Удалить подход">✕</button>`;
    U.$('builder-rows').appendChild(row);
    this.renumberRows();
  },
  renumberRows() { [...U.$('builder-rows').children].forEach((r, i) => { r.querySelector('.builder-num').textContent = i + 1; }); },

  savePlan() {
    const name = U.$('builder-name').value.trim();
    const rest = U.clamp(parseInt(U.$('builder-rest').value, 10) || 45, 10, 300);
    const sets = [...U.$('builder-rows').children].map(r => ({
      ex: r.querySelector('select').value,
      reps: U.clamp(parseInt(r.querySelector('input').value, 10) || 0, 0, 100)
    })).filter(s => s.reps > 0);
    const msg = U.$('builder-msg');
    if (!name) { msg.textContent = 'Дай плану название.'; msg.dataset.tone = 'bad'; return; }
    if (!sets.length) { msg.textContent = 'Добавь хотя бы один подход с повторами больше нуля.'; msg.dataset.tone = 'bad'; return; }
    const plan = { id: 'custom-' + U.uid(), name: name.slice(0, 30), rest, sets, desc: `Свой план · ${sets.length} подх.` };
    Store.savePlan(plan);
    Store.setSetting('planId', plan.id);
    msg.textContent = `План «${plan.name}» сохранён и выбран.`; msg.dataset.tone = 'ok';
    U.$('builder-name').value = '';
    this.renderPlans(); this.refreshHome();
    UI.toast('План сохранён', 'ok');
  },

  /* ================================================================
     НАСТРОЙКА ДУЭЛИ: шансы и ставки Эло до матча
     ================================================================ */
  botId: BOTS[1].id,
  getBot() { return BOTS.find(b => b.id === this.botId) || BOTS[1]; },

  refreshDuelSetup() {
    const me = this.profile();
    U.$('duel-player').innerHTML = Store.profiles()
      .map(x => `<option value="${x.id}" ${x.id === me.id ? 'selected' : ''}>${U.esc(x.name)} — ${UI.rankHTML(x.elo)} · ${x.elo}</option>`).join('');

    U.$('duel-bots').innerHTML = BOTS.map(b => `
      <button type="button" class="bot-option ${b.id === this.botId ? 'active' : ''}" data-bot="${b.id}" aria-pressed="${b.id === this.botId}">
        <span class="text-3xl">${b.icon}</span>
        <span class="min-w-0 text-left"><b class="block">${U.esc(b.name)}</b>
          <span class="block text-xs text-slate-500 dark:text-slate-400">${U.esc(b.desc)} · ${b.elo} Эло</span></span>
      </button>`).join('');

    const curEx = U.$('duel-ex').value || 'pushup';
    U.$('duel-ex-cards').innerHTML = Object.values(EXERCISES).map(e => `
      <button type="button" class="ex-card ${e.id === curEx ? 'active' : ''}" data-ex="${e.id}" aria-pressed="${e.id === curEx}">
        <span class="ex-card-icon">${e.icon}</span><b>${e.name}</b></button>`).join('');

    const bot = this.getBot();
    const pv = Elo.preview(me, { elo: bot.elo, duels: 99 });
    const pa = Math.round(pv.chanceA * 100);
    const lock = Fatigue.isLocked(me);
    const sign = (n) => (n >= 0 ? '+' : '') + n;
    U.$('duel-odds').innerHTML = `
      <div class="flex justify-between text-sm font-semibold mb-1"><span>Твой шанс: ${pa}%</span><span>${bot.icon} Бот: ${100 - pa}%</span></div>
      <div class="odds-bar"><div class="odds-a" style="width:${pa}%"></div><div class="odds-b" style="width:${100 - pa}%"></div></div>
      <div class="grid sm:grid-cols-2 gap-4 mt-4">
        <div class="odds-side">
          <div class="font-display text-lg truncate">Ты: ${U.esc(me.name)}</div>
          <div class="text-sm text-slate-600 dark:text-slate-400">${UI.rankHTML(me.elo)} · ${me.elo} Эло · K=${Elo.k(me)}</div>
          <div class="stakes"><span class="win">Победа ${sign(pv.a.win)}</span><span>Ничья ${sign(pv.a.draw)}</span><span class="loss">Поражение ${pv.a.loss}</span></div>
          ${lock ? `<div class="text-sm font-semibold text-amber-500 mt-1">⏸️ Обязательный отдых ещё ${U.fmt(Fatigue.lockLeft(me))}</div>` : ''}
        </div>
        <div class="odds-side">
          <div class="font-display text-lg truncate">${bot.icon} ${U.esc(bot.name)}</div>
          <div class="text-sm text-slate-600 dark:text-slate-400">Бот · ${bot.elo} Эло · ${Math.round(60 / bot.pace[U.$('duel-ex').value])} повт./мин</div>
          <div class="text-sm text-slate-600 dark:text-slate-400 mt-2">Ошибается примерно в ${Math.round(bot.errorRate * 100)}% повторов</div>
        </div>
      </div>`;
    U.$('btn-start-duel').disabled = lock;
    U.$('duel-block-msg').textContent = lock ? 'Дуэль заблокирована: обязательный отдых после перегрузки.' : '';
  },

  /* ================================================================
     АРЕНА
     ================================================================ */
  startWorkout(demo = Store.settings().demo) {
    Sound.init();
    const plan = Store.getPlan(U.$('plan-select').value);
    this.lastConfig = { type: 'workout', planId: plan.id, demo };
    this.enterArena(new WorkoutMode(this.profile(), plan), demo);
  },

  /** Быстрый старт: 3 подхода одного упражнения без выбора плана */
  startQuick(ex, demo = Store.settings().demo) {
    Sound.init();
    const e = EXERCISES[ex];
    const plan = { id: 'quick-' + ex, name: `Быстрый старт: ${e.name}`, rest: ex === 'pullup' ? 90 : 60,
      desc: `3 подхода по ${e.quick}`, sets: [0, 1, 2].map(() => ({ ex, reps: e.quick })) };
    this.lastConfig = { type: 'quick', ex, demo };
    this.enterArena(new WorkoutMode(this.profile(), plan), demo);
  },

  startDuel(demo = Store.settings().demo) {
    Sound.init();
    const me = this.profile();
    if (Fatigue.isLocked(me)) return UI.toast('Дуэль заблокирована: обязательный отдых', 'warn');
    const bot = this.getBot(), ex = U.$('duel-ex').value;
    this.lastConfig = { type: 'duel', botId: bot.id, ex, demo };
    this.enterArena(new DuelMode(me, bot, ex), demo);
  },

  replay() {
    const c = this.lastConfig;
    if (!c) return UI.showScreen('screen-home');
    if (c.type === 'quick') return this.startQuick(c.ex, c.demo);
    if (c.type === 'workout') { U.$('plan-select').value = c.planId; this.startWorkout(c.demo); }
    else { this.botId = c.botId; U.$('duel-ex').value = c.ex; this.startDuel(c.demo); }
  },

  enterArena(mode, demo) {
    this.leaveArena();
    const session = ++this.session;
    this.mode = mode;
    this.demo = false;

    const duel = mode.kind === 'duel';
    UI.show('hud-workout', !duel);
    UI.show('hud-duel', duel);
    UI.clearLog();
    BodyGuide.reset();
    U.$('body-guide').classList.add('hidden');
    UI.setText('stage-score', '');
    UI.renderErrors(mode.players);
    UI.renderLoad(mode.players);
    UI.status('Ждём позу…'); UI.metric(null); UI.gesture(0);
    ['rest-overlay', 'lock-overlay', 'countdown-overlay'].forEach(id => UI.show(id, false));
    U.$('demo-controls').classList.add('hidden');
    UI.showScreen('screen-arena');

    mode.begin();
    this.updateLock();
    this.tickId = setInterval(() => this.tick(), 1000);

    if (demo) this.startDemo(session);
    else this.connectCamera(session);
  },

  async connectCamera(session) {
    try {
      this.video.classList.remove('hidden');
      UI.camLoading('Включаем камеру…', 'Разреши доступ к камере во всплывающем окне браузера.');
      await Vision.startCamera(this.video);
      if (session !== this.session) return;
      UI.camLoading('Загружаем нейросеть…', 'MediaPipe Pose Landmarker (до 2 человек в кадре), 5–15 секунд при первом запуске.');
      await Vision.loadModel();
      if (session !== this.session) return;
      UI.camHide();
      UI.log('info', 'Камера и нейросеть готовы');
      UI.setText('cam-res', `📷 ${this.video.videoWidth}×${this.video.videoHeight}`);
      Vision.startLoop((poses, t, frame) => this.onPoses(poses, t, frame));
    } catch (err) {
      console.warn('Камера/модель:', err);
      if (session !== this.session) return;
      Vision.stopCamera();
      const info = Vision.describeError(err);
      UI.camError(info, () => this.startDemo(session), () => this.connectCamera(session));
      UI.feedback('warn', 'Камера недоступна', 'Разреши доступ или запусти симуляцию — игра работает и без камеры.', { ms: 0 });
      UI.log('warn', `Камера: ${info.title}`);
    }
  },

  startDemo(session) {
    if (session !== this.session || !this.mode) return;
    this.demo = true;
    Vision.stopCamera();
    UI.camHide();
    this.video.classList.add('hidden');
    Demo.start(this.mode.players.length, (poses, t, frame) => this.onPoses(poses, t, frame));
    this.mode.players.forEach((p, i) => Demo.setExercise(i, p.exercise));
    this.renderDemoControls();
    UI.setText('cam-res', '🎮 Симуляция');
    UI.log('info', 'Включена симуляция: движения проходят через те же алгоритмы, что и камера');
  },

  leaveArena() {
    this.session++;
    clearInterval(this.tickId); this.tickId = null;
    Demo.stop();
    Vision.stopCamera();
    Voice.stop();
    UI.camHide();
    Technique.hide && Technique.box && Technique.hide();
    UI.strip(null);
    if (this.mode?.bot) this.mode.bot.destroy();
    if (document.fullscreenElement || document.webkitFullscreenElement) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    if (U.$('stage').classList.contains('pseudo-full')) this.setPseudoFull(false);
    this.mode = null;
    this.demo = false;
  },

  /** Главный обработчик кадра: анализ + отрисовка */
  onPoses(poses, t, frame) {
    const mode = this.mode;
    if (!mode) return;
    const { canvas, ctx } = this;
    if (canvas.width !== frame.W || canvas.height !== frame.H) {
      canvas.width = frame.W; canvas.height = frame.H;
      // Сцена принимает пропорции реального кадра камеры — без полос и обрезки
      U.$('stage').style.setProperty('--stage-ratio', `${frame.W} / ${frame.H}`);
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (frame.demo) Renderer.gym(ctx, frame.W, frame.H, 640);

    if (mode.phase !== 'done') mode.onPoses(poses, t);

    const p = mode.players[0];
    // Гайд зоны захвата: чек-лист частей тела + рамка-цель, если тело не помещается
    const guide = BodyGuide.evaluate(p.pose, p.exercise);
    BodyGuide.render(guide, t, p.exercise);
    if (BodyGuide.enabled && guide.zone) BodyGuide.drawZone(ctx, frame.W, frame.H, p.exercise, t);
    // Подтягивания: воображаемая перекладина по линии кистей + маркер подбородка
    if (p.exercise === 'pullup' && p.result?.bar) Renderer.pullBar(ctx, frame.W, p.result.bar, { solid: frame.demo });

    const sc = Math.max(frame.W, frame.H) / 1280;
    mode.players.forEach(pl => {
      if (!pl.pose) return;
      Renderer.drawPose(ctx, pl.pose, { bad: pl.highlight(t), flash: pl.flashNow(t) });
      const m = pl.result?.metric;
      if (m?.at && m.d != null) {
        const col = m.d >= 1 ? '#34d399' : m.d <= 0.1 ? '#67e8f9' : '#facc15';
        Renderer.tag(ctx, m.at.X, m.at.Y - 34 * sc, m.value, { color: col, size: 22 * sc });
      }
    });
  },

  /* ---------- Масштаб и полный экран ---------- */
  applyFit(fit) {
    const st = U.$('stage');
    st.classList.toggle('fit-cover', fit === 'cover');
    U.$('btn-fit').innerHTML = fit === 'cover' ? '🔍 <span>Крупно</span>' : '🔍 <span>Весь кадр</span>';
    U.$('btn-fit').title = fit === 'cover' ? 'Сейчас: крупно (края кадра обрезаны). Нажми, чтобы видеть весь кадр' : 'Сейчас: весь кадр без обрезки. Нажми, чтобы увеличить';
  },

  isFull() { return !!(document.fullscreenElement || document.webkitFullscreenElement) || U.$('stage').classList.contains('pseudo-full'); },

  toggleFullscreen() {
    const st = U.$('stage');
    if (document.fullscreenElement || document.webkitFullscreenElement) {
      (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      return;
    }
    if (st.classList.contains('pseudo-full')) { this.setPseudoFull(false); return; }
    const req = st.requestFullscreen || st.webkitRequestFullscreen;
    try {
      const r = req ? req.call(st) : null;
      if (!req) this.setPseudoFull(true);
      else if (r && r.catch) r.catch(() => this.setPseudoFull(true));
    } catch { this.setPseudoFull(true); }
  },

  /** Запасной вариант для iPhone: сцена растягивается на всё окно средствами CSS */
  setPseudoFull(on) {
    U.$('stage').classList.toggle('pseudo-full', on);
    document.body.classList.toggle('no-scroll', on);
    this.onFullChange();
  },

  onFullChange() {
    const full = this.isFull();
    U.$('stage').classList.toggle('is-full', full);
    U.$('btn-fullscreen').innerHTML = full ? '✕ <span>Выйти из полного экрана</span>' : '⛶ <span>Во весь экран</span>';
  },

  /**
   * Засчитать повтор или показать ошибку.
   * @returns 'ok' | 'error' | 'locked'
   */
  processRep(pl, rep, t, xPct, elapsed) {
    const prof = pl.profile, ex = pl.exercise;
    const prefix = pl.slot === 'solo' ? '' : pl.slot + ': ';

    if (Fatigue.isLocked(prof)) {
      UI.feedback('warn', `⏸️ ${prefix}Обязательный отдых`, `Повтор не засчитан. Осталось ${U.fmt(Fatigue.lockLeft(prof))}.`, { banner: true, ms: 1800 });
      UI.log('warn', `${prefix}повтор во время отдыха — не засчитан`, elapsed);
      return 'locked';
    }

    pl.record(rep);
    let f;
    if (rep.ok) {
      f = Fatigue.add(prof, CONFIG.FATIGUE.perRep[ex]);
      Sound.hit();
      UI.frame('good');
      pl.flash('#10b981', t, 450);
      UI.float(this.mode.kind === 'workout' ? '-1 HP 💥' : 'Ты +1', 'good', xPct);
      UI.feedback('good', `✅ ${prefix}Чисто!`, `${EXERCISES[ex].name}: ${rep.value}`);
      UI.log('good', `${prefix}${EXERCISES[ex].name} · ${rep.value}`, elapsed);
      if (pl.stats.streak > 0 && pl.stats.streak % 5 === 0) UI.banner('good', `🔥 ${prefix}Серия ${pl.stats.streak}!`, 'Чистая техника подряд', 1600);
    } else {
      f = Fatigue.add(prof, CONFIG.FATIGUE.perError);
      const main = rep.errors[0], info = ERRORS[ex][main];
      const joints = [...new Set(rep.errors.flatMap(c => ERRORS[ex][c].joints))];
      pl.flagError(joints, t);
      Sound.error(); UI.aura(); UI.frame('bad');
      UI.float(pl.slot === 'solo' ? '✗' : `${pl.slot} ✗`, 'bad', xPct);
      const extra = rep.errors.slice(1).map(c => ERRORS[ex][c].title);
      const text = [rep.detail[main], info.tip, extra.length ? `Ещё: ${extra.join(', ')}.` : ''].filter(Boolean).join(' ');
      UI.feedback('error', `⚠️ ${prefix}${info.title}`, text, { ms: 2800, banner: true });
      Voice.say(pl.slot === 'solo' ? info.voice : `${pl.slot}. ${info.voice}`, { key: 'err', cooldown: 1200 });
      Technique.show(ex, main);
      UI.log('error', `${prefix}${rep.errors.map(c => ERRORS[ex][c].title).join(', ')}`, elapsed);
    }
    if (f.lockedNow) this.onLock(pl);
    UI.renderErrors(this.mode.players);
    UI.renderLoad(this.mode.players);
    return rep.ok ? 'ok' : 'error';
  },

  gestureError(pl, code, t) {
    const info = GESTURE_ERRORS[code], prefix = pl.slot === 'solo' ? '' : pl.slot + ': ';
    pl.flagError([13, 14, 15, 16], t);
    UI.feedback('warn', `🙌 ${prefix}${info.title}`, 'Обе кисти выше головы — держи секунду.', { banner: true, ms: 2000 });
    Voice.say(info.voice, { key: 'g-' + code, cooldown: 3000 });
    UI.log('warn', `${prefix}жест: ${info.title}`);
  },

  onLock(pl) {
    const prefix = pl.slot === 'solo' ? '' : pl.slot + ': ';
    Sound.warn();
    Voice.say('Перегрузка! Обязательный отдых две минуты.', { key: 'lock', cooldown: 5000 });
    UI.feedback('warn', '🛑 Перегрузка 100%', `${prefix}обязательный отдых 2 минуты — повторы не засчитываются, дуэли заблокированы.`, { banner: true, ms: 4000 });
    UI.log('warn', `${prefix}перегрузка → отдых 2:00`);
    this.updateLock();
  },

  updateLock() {
    if (!this.mode) return;
    const locked = this.mode.players.filter(p => Fatigue.isLocked(p.profile));
    UI.show('lock-overlay', locked.length > 0);
    if (!locked.length) return;
    const left = Math.max(...locked.map(p => Fatigue.lockLeft(p.profile)));
    U.$('lock-sec').textContent = U.fmt(left);
    U.$('lock-ring').style.strokeDashoffset = 326.7 * (1 - left / CONFIG.FATIGUE.lockSec);
    U.$('lock-who').textContent = locked.map(p => p.slot === 'solo' ? p.profile.name : p.label).join(', ');
  },

  damageBoss(hp, total) {
    ['hw-boss-bar', 'hw-boss-avatar'].forEach(id => { const n = U.$(id); n.classList.remove('shake', 'hp-flash'); void n.offsetWidth; n.classList.add('shake', 'hp-flash'); });
    const av = U.$('hw-boss-avatar');
    av.textContent = '😖';
    setTimeout(() => { av.textContent = hp === 0 ? '💀' : hp <= total * 0.3 ? '🥵' : '🗿'; }, 450);
  },

  setPrimaryAction(label, fn) {
    const b = U.$('btn-primary-action');
    this.primary = fn;
    b.classList.toggle('hidden', !label);
    if (label) b.textContent = label;
  },

  /** Кнопки симуляции под текущее упражнение (одинаковые для тренировки и дуэли) */
  renderDemoControls() {
    const box = U.$('demo-controls');
    if (!this.demo || !this.mode) { box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    const btn = (data, cls, html) => `<button class="demo-btn ${cls}" data-demo="${data}">${html}</button>`;
    const ex = this.mode.players[0].exercise;
    box.innerHTML = `
      <div class="text-sm font-semibold mb-2">🎮 Симуляция · ${EXERCISES[ex].icon} ${EXERCISES[ex].name}</div>
      <div class="grid grid-cols-2 gap-2">
        ${btn('0:clean', 'demo-btn-good', '✅ Чистый повтор<br><kbd>Пробел</kbd>')}
        ${btn('0:error', 'demo-btn-bad', '🎲 Случайная ошибка<br><kbd>E</kbd>')}
      </div>
      <div class="text-xs text-slate-500 dark:text-slate-400 mt-3 mb-1">Показать конкретную ошибку:</div>
      <div class="flex flex-wrap gap-1.5">${Object.entries(ERRORS[ex]).map(([c, i]) => `<button class="mini-chip" data-demo="0:${c}">${i.title}</button>`).join('')}</div>
      <div class="grid grid-cols-3 gap-2 mt-3">
        ${btn('0:hands', 'demo-btn-neutral', '🙌 Руки<br><kbd>H</kbd>')}
        ${btn('0:one', 'demo-btn-neutral', '✋ Одна<br><kbd>J</kbd>')}
        ${btn('0:low', 'demo-btn-neutral', '🙆 Низко<br><kbd>K</kbd>')}
      </div>`;
  },

  tick() {
    if (!this.mode) return;
    this.mode.tick();
    if (!this.mode) return;                      // tick мог завершить сессию
    UI.renderLoad(this.mode.players);
    this.updateLock();
  },

  /** Конец тренировки/дуэли: пауза с большим словом, затем экран результатов */
  finishSession(data, celebrate) {
    const session = this.session;
    if (!data) { this.leaveArena(); UI.showScreen('screen-home'); this.refreshHome(); return; }
    const win = data.type === 'workout' ? data.completed : data.scoreA !== 0.5;
    UI.bigWord(data.type === 'workout' ? (data.bossDefeated ? 'K.O.!' : data.completed ? 'ГОТОВО!' : 'СТОП') : 'ВРЕМЯ!');
    (celebrate && win) ? Sound.victory() : Sound.defeat();
    Voice.say(data.type === 'duel'
      ? (data.scoreA === 1 ? `Победил ${data.a.name}` : data.scoreA === 0 ? `Победил ${data.b.name}` : 'Ничья')
      : data.completed ? 'Тренировка завершена. Отличная работа!' : 'Тренировка остановлена.', { key: 'end', cooldown: 0 });
    setTimeout(() => {
      if (session !== this.session) return;
      this.leaveArena();
      this.showResult(data);
      UI.showScreen('screen-result');
    }, 1500);
  },

  /* ================================================================
     РЕЗУЛЬТАТЫ
     ================================================================ */
  showResult(d) {
    const box = U.$('result-content');
    const stat = (label, value, cls = '') => `<div class="panel p-5 text-center"><div class="text-sm text-slate-500 dark:text-slate-400">${label}</div><div class="font-display text-4xl tabular-nums mt-1 ${cls}">${value}</div></div>`;
    const errorsList = (byCode) => {
      const rows = Object.entries(byCode).sort((a, b) => b[1] - a[1]);
      if (!rows.length) return '<p class="text-sm text-slate-500">Ни одной ошибки техники 👌</p>';
      return `<ul class="space-y-2">${rows.map(([k, n]) => { const [ex, c] = k.split(':'); const i = ERRORS[ex][c];
        return `<li class="err-row"><div><b>${EXERCISES[ex].icon} ${i.title}</b> × ${n}<div class="text-sm text-slate-600 dark:text-slate-400">${i.tip}</div></div></li>`; }).join('')}</ul>`;
    };

    if (d.type === 'workout') {
      const title = !d.completed ? 'Тренировка прервана' : d.bossDefeated ? 'Голиаф повержен!' : 'Тренировка завершена';
      box.innerHTML = `
        <div class="text-center mb-8">
          <div class="text-6xl mb-2">${!d.completed ? '⏹️' : d.bossDefeated ? '🏆' : '✅'}</div>
          <h2 class="font-display text-4xl md:text-5xl result-title" data-outcome="${d.completed ? 'win' : 'lose'}">${title}</h2>
          <p class="mt-3 text-slate-600 dark:text-slate-400">${U.esc(d.name)} · план «${U.esc(d.plan)}»</p>
        </div>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          ${stat('Чистые повторы', d.reps, 'text-emerald-500')}${stat('Ошибки', d.errors, 'text-rose-500')}
          ${stat('Точность', d.accuracy + '%', 'text-cyan-500')}${stat('Время', U.fmt(d.duration))}
        </div>
        ${d.records.length ? `<div class="panel p-4 mb-6 text-center font-semibold">🏅 Новые рекорды: ${d.records.map(U.esc).join(' · ')}</div>` : ''}
        <div class="grid lg:grid-cols-2 gap-6">
          <div class="panel p-5"><h3 class="font-display text-xl mb-3">Подходы</h3>
            <table class="w-full text-sm"><thead class="text-left text-slate-500"><tr><th class="py-1">#</th><th>Упражнение</th><th class="text-right">Чисто</th><th class="text-right">Ошибки</th></tr></thead>
            <tbody>${d.perSet.map((s, i) => `<tr class="border-t border-slate-200 dark:border-slate-700"><td class="py-2">${i + 1}</td><td>${EXERCISES[s.ex].icon} ${EXERCISES[s.ex].name}</td>
              <td class="text-right tabular-nums ${s.reps >= s.target ? 'text-emerald-500 font-bold' : ''}">${s.reps}/${s.target}</td><td class="text-right tabular-nums">${s.errors}</td></tr>`).join('')}</tbody></table></div>
          <div class="panel p-5"><h3 class="font-display text-xl mb-3">Над чем поработать</h3>${errorsList(d.byCode)}</div>
        </div>`;
    } else {
      const { a, b } = d;
      const title = d.scoreA === 0.5 ? 'Ничья!' : d.vsBot ? (d.scoreA === 1 ? 'Ты победил бота!' : `Победил ${b.name}`) : `Победа: ${d.scoreA === 1 ? a.name : b.name}`;
      const col = (p, pfx, won) => `
        <div class="panel p-5 ${won ? 'winner' : ''}">
          <div class="flex items-center justify-between"><div class="font-display text-2xl">${p.bot ? `${p.icon} ${U.esc(p.name)}` : `${pfx}: ${U.esc(p.name)}`}</div>${won ? '<span class="text-3xl">👑</span>' : ''}</div>
          <div class="grid grid-cols-3 gap-2 mt-4 text-center">
            <div class="stat-mini"><span>Чисто</span><b class="text-emerald-500">${p.reps}</b></div>
            <div class="stat-mini"><span>Ошибки</span><b class="text-rose-500">${p.errors}</b></div>
            <div class="stat-mini"><span>Точность</span><b>${p.accuracy}%</b></div>
          </div>
          ${p.bot ? `<div class="mt-4 text-center text-sm text-slate-500 dark:text-slate-400">Виртуальный соперник · ${p.elo} Эло</div>` : `<div class="mt-4 text-center">
            <div class="font-display text-3xl ${p.delta >= 0 ? 'text-emerald-500' : 'text-rose-500'}">${p.delta >= 0 ? '+' : ''}${p.delta} Эло</div>
            <div class="text-sm text-slate-500 dark:text-slate-400">${p.eloBefore} → ${p.eloAfter}</div>
            <div class="text-sm font-semibold mt-1">${p.rankBefore === p.rankAfter ? `Ранг: ${p.rankAfter}` : `Ранг: ${p.rankBefore} → ${p.rankAfter}`}</div>
          </div>`}
          <div class="mt-4">${errorsList(p.byCode)}</div>
        </div>`;
      box.innerHTML = `
        <div class="text-center mb-8">
          <div class="text-6xl mb-2">${d.scoreA === 0.5 ? '🤝' : d.scoreA === 1 ? '🏆' : '🤖'}</div>
          <h2 class="font-display text-4xl md:text-5xl result-title" data-outcome="${d.scoreA === 0.5 ? 'draw' : d.scoreA === 1 ? 'win' : 'lose'}">${U.esc(title)}</h2>
          <p class="mt-3 text-slate-600 dark:text-slate-400">${EXERCISES[d.exercise].icon} ${EXERCISES[d.exercise].name} · ${a.reps} : ${b.reps} · твой шанс до матча был ${d.chanceA}%</p>
        </div>
        <div class="grid md:grid-cols-2 gap-6">${col(a, d.vsBot ? 'Ты' : 'A', d.scoreA === 1)}${col(b, 'B', d.scoreA === 0)}</div>`;
    }
  },

  /* ================================================================
     РЕЙТИНГ И ИСТОРИЯ
     ================================================================ */
  renderRating() {
    const me = this.profile().id;
    const list = Store.profiles().sort((a, b) => b.elo - a.elo);
    U.$('ranks-legend').innerHTML = RANKS.map((r, i) => `<div class="rank-pill"><span class="text-2xl">${r.icon}</span><div><b>${r.name}</b><div class="text-xs text-slate-500 dark:text-slate-400">${i === 0 ? `до ${RANKS[1].min - 1}` : `от ${r.min}`}</div></div></div>`).join('');
    U.$('rating-body').innerHTML = list.length ? list.map((p, i) => `
      <tr class="border-t border-slate-200 dark:border-slate-700 ${p.id === me ? 'lb-me' : ''}">
        <td class="py-2.5 pr-3">${['🥇', '🥈', '🥉'][i] || i + 1}</td><td class="py-2.5 pr-3">${U.esc(p.name)}</td>
        <td class="py-2.5 pr-3 whitespace-nowrap">${UI.rankHTML(p.elo)}</td><td class="py-2.5 pr-3 text-right tabular-nums font-bold">${p.elo}</td>
        <td class="py-2.5 pr-3 text-right tabular-nums whitespace-nowrap">${p.wins}/${p.draws}/${p.losses}</td>
        <td class="py-2.5 pr-3 text-right tabular-nums">${p.records.pushupSet || 0}</td><td class="py-2.5 pr-3 text-right tabular-nums">${p.records.squatSet || 0}</td><td class="py-2.5 text-right tabular-nums">${p.records.pullupSet || 0}</td></tr>`).join('')
      : '<tr><td colspan="8" class="py-4 text-center text-slate-500">Пока никого — создай профиль и сыграй.</td></tr>';
  },

  renderHistory() {
    const sel = U.$('hist-profile');
    const cur = sel.value || 'all';
    sel.innerHTML = `<option value="all">Все игроки</option>` + Store.profiles().map(p => `<option value="${p.id}">${U.esc(p.name)}</option>`).join('');
    sel.value = [...sel.options].some(o => o.value === cur) ? cur : 'all';

    const pid = sel.value;
    const p = pid !== 'all' ? Store.getProfile(pid) : null;
    U.$('records-box').innerHTML = p ? `
      <h3 class="font-display text-xl mb-3">🏅 Рекорды: ${U.esc(p.name)}</h3>
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
        <div class="stat-mini"><span>💪 лучший подход</span><b>${p.records.pushupSet}</b></div>
        <div class="stat-mini"><span>🦵 лучший подход</span><b>${p.records.squatSet}</b></div>
        <div class="stat-mini"><span>💪 всего</span><b>${p.records.pushupTotal}</b></div>
        <div class="stat-mini"><span>🦵 всего</span><b>${p.records.squatTotal}</b></div>
        <div class="stat-mini"><span>🧗 лучший подход</span><b>${p.records.pullupSet || 0}</b></div>
        <div class="stat-mini"><span>🧗 всего</span><b>${p.records.pullupTotal || 0}</b></div>
        <div class="stat-mini"><span>⚔️ лучшая дуэль</span><b>${p.records.duelBest}</b></div>
        <div class="stat-mini"><span>🎯 точность</span><b>${p.records.bestAccuracy}%</b></div>
        <div class="stat-mini"><span>🏋️ тренировок</span><b>${p.records.workouts || 0}</b></div>
        <div class="stat-mini"><span>📈 Эло</span><b>${p.elo}</b></div>
      </div>` : '<p class="text-sm text-slate-500 dark:text-slate-400">Выбери игрока, чтобы увидеть его рекорды.</p>';

    const items = Store.history().filter(h => pid === 'all' || h.profileId === pid || h.a?.id === pid || h.b?.id === pid);
    U.$('hist-list').innerHTML = items.length ? items.map(h => h.type === 'workout' ? `
      <li class="hist-item"><div class="text-2xl">${h.completed ? '🏋️' : '⏹️'}</div><div class="flex-1 min-w-0">
        <div class="font-semibold">${U.esc(h.name)} · «${U.esc(h.plan)}» ${h.bossDefeated ? '· 🗿 K.O.' : ''}</div>
        <div class="text-sm text-slate-600 dark:text-slate-400">Чисто ${h.reps} · ошибок ${h.errors} · точность ${h.accuracy}% · ${U.fmt(h.duration)}</div></div>
        <div class="text-xs text-slate-500 whitespace-nowrap">${U.date(h.date)}</div></li>` : `
      <li class="hist-item"><div class="text-2xl">${h.b.bot ? h.b.icon || '🤖' : '⚔️'}</div><div class="flex-1 min-w-0">
        <div class="font-semibold">${U.esc(h.a.name)} ${h.a.reps} : ${h.b.reps} ${U.esc(h.b.name)} · ${EXERCISES[h.exercise].icon}</div>
        <div class="text-sm text-slate-600 dark:text-slate-400">${h.b.bot ? `Против бота · Эло ${U.esc(h.a.name)}: ${h.a.delta >= 0 ? '+' : ''}${h.a.delta}` : `Эло: ${U.esc(h.a.name)} ${h.a.delta >= 0 ? '+' : ''}${h.a.delta}, ${U.esc(h.b.name)} ${h.b.delta >= 0 ? '+' : ''}${h.b.delta}`}</div></div>
        <div class="text-xs text-slate-500 whitespace-nowrap">${U.date(h.date)}</div></li>`).join('')
      : '<li class="text-sm text-slate-500 py-4 text-center">История пуста — начни первую тренировку.</li>';
  },

  /* ================================================================
     ОБРАБОТЧИКИ
     ================================================================ */
  go(screen) {
    if (this.mode) {
      if (this.mode.phase && this.mode.phase !== 'done' && !confirm('Выйти с арены? Текущая сессия будет остановлена.')) return;
      if (this.mode) this.mode.quit();
      this.leaveArena();
    }
    if (screen === 'screen-home') { this.refreshHome(); this.checkCamera(); }
    if (screen === 'screen-plans') this.renderPlans();
    if (screen === 'screen-duel') this.refreshDuelSetup();
    if (screen === 'screen-rating') this.renderRating();
    if (screen === 'screen-history') this.renderHistory();
    UI.showScreen(screen);
  },

  bind() {
    // Навигация
    document.querySelectorAll('[data-nav]').forEach(b => b.addEventListener('click', () => this.go(b.dataset.nav)));

    // Шапка: тема, звук, голос
    U.$('btn-theme').onclick = () => {
      const theme = document.documentElement.classList.contains('dark') ? 'light' : 'dark';
      UI.applyTheme(theme); Store.setSetting('theme', theme);
    };
    U.$('btn-sound').onclick = () => { Sound.enabled = !Sound.enabled; Store.setSetting('sound', Sound.enabled); U.$('btn-sound').textContent = Sound.enabled ? '🔊' : '🔇'; };
    U.$('btn-voice').onclick = () => {
      Voice.enabled = !Voice.enabled; Store.setSetting('voice', Voice.enabled);
      U.$('btn-voice').textContent = Voice.enabled ? '🗣️' : '🤐';
      if (Voice.enabled) Voice.say('Голосовые подсказки включены', { cooldown: 0 });
    };

    // Главная
    U.$('profile-select').onchange = (e) => { Store.setSetting('profileId', e.target.value); this.refreshHome(); };
    U.$('btn-create-profile').onclick = () => {
      const name = U.$('new-profile-name').value.trim();
      if (!name) return UI.toast('Введи имя игрока', 'warn');
      const existed = Store.findByName(name);
      const p = Store.ensureProfile(name);
      Store.setSetting('profileId', p.id);
      U.$('new-profile-name').value = '';
      this.refreshHome();
      UI.toast(existed ? `Выбран профиль ${p.name}` : `Профиль ${p.name} создан`, 'ok');
    };
    U.$('new-profile-name').addEventListener('keydown', e => { if (e.key === 'Enter') U.$('btn-create-profile').click(); });
    U.$('plan-select').onchange = (e) => { Store.setSetting('planId', e.target.value); this.renderPlanPreview(Store.getPlan(e.target.value)); };
    U.$('opt-demo').onchange = (e) => Store.setSetting('demo', e.target.checked);
    U.$('opt-tech').onchange = (e) => { Technique.enabled = e.target.checked; Store.setSetting('techModal', e.target.checked); };
    U.$('btn-start-workout').onclick = () => this.startWorkout();
    U.$('btn-open-duel').onclick = () => this.go('screen-duel');

    // Планы
    U.$('plans-list').addEventListener('click', (e) => {
      const pick = e.target.closest('[data-plan-pick]'), del = e.target.closest('[data-plan-del]');
      if (pick) { Store.setSetting('planId', pick.dataset.planPick); this.renderPlans(); this.refreshHome(); UI.toast('План выбран', 'ok'); }
      if (del && confirm('Удалить этот план?')) { Store.deletePlan(del.dataset.planDel); this.renderPlans(); this.refreshHome(); }
    });
    U.$('btn-add-row').onclick = () => this.addBuilderRow();
    U.$('builder-rows').addEventListener('click', (e) => {
      if (e.target.closest('[data-row-del]')) { e.target.closest('.builder-row').remove(); this.renumberRows(); }
    });
    U.$('btn-save-plan').onclick = () => this.savePlan();

    // Дуэль
    U.$('duel-player').onchange = (e) => { Store.setSetting('profileId', e.target.value); this.refreshDuelSetup(); this.refreshHome(); };
    U.$('duel-ex-cards').addEventListener('click', (e) => {
      const b = e.target.closest('[data-ex]');
      if (b) { U.$('duel-ex').value = b.dataset.ex; this.refreshDuelSetup(); }
    });
    // Быстрый старт на главной: три карточки упражнений
    U.$('quick-cards').addEventListener('click', (e) => {
      const b = e.target.closest('[data-quick]');
      if (b) this.startQuick(b.dataset.quick);
    });
    U.$('duel-bots').addEventListener('click', (e) => {
      const b = e.target.closest('[data-bot]');
      if (b) { this.botId = b.dataset.bot; Store.setSetting('botId', this.botId); this.refreshDuelSetup(); }
    });
    U.$('btn-start-duel').onclick = () => this.startDuel();

    // Арена
    U.$('btn-primary-action').onclick = () => this.primary && this.primary();

    // Панель сцены: масштаб, гайд, полный экран
    U.$('btn-fit').onclick = () => {
      const fit = Store.settings().fit === 'cover' ? 'contain' : 'cover';
      Store.setSetting('fit', fit); this.applyFit(fit);
    };
    U.$('btn-guide').onclick = () => {
      BodyGuide.enabled = !BodyGuide.enabled;
      Store.setSetting('guide', BodyGuide.enabled);
      U.$('btn-guide').setAttribute('aria-pressed', BodyGuide.enabled);
      BodyGuide.reset();
    };
    U.$('btn-fullscreen').onclick = () => this.toggleFullscreen();
    document.addEventListener('fullscreenchange', () => this.onFullChange());
    document.addEventListener('webkitfullscreenchange', () => this.onFullChange());
    U.$('btn-quit').onclick = () => { if (this.mode) this.mode.quit(); else this.go('screen-home'); };
    U.$('demo-controls').addEventListener('click', (e) => {
      const b = e.target.closest('[data-demo]');
      if (!b) return;
      const [i, action] = b.dataset.demo.split(':');
      Demo.act(+i, action);
    });

    // Результаты, история
    U.$('btn-again').onclick = () => this.replay();
    U.$('btn-home').onclick = () => this.go('screen-home');
    U.$('hist-profile').onchange = () => this.renderHistory();
    U.$('btn-reset').onclick = () => {
      if (!confirm('Удалить все профили, историю, планы и настройки?')) return;
      Store.resetAll(); this.refreshHome(); this.renderHistory(); UI.toast('Данные очищены', 'ok');
    };

    // Клавиатура на арене (e.code не зависит от раскладки)
    document.addEventListener('keydown', (e) => {
      if (U.$('screen-arena').classList.contains('hidden') || !this.mode) return;
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
      if (e.code === 'Escape' && U.$('stage').classList.contains('pseudo-full')) { this.setPseudoFull(false); return; }
      if (e.code === 'KeyF') { e.preventDefault(); this.toggleFullscreen(); return; }
      if (e.code === 'Enter' && this.primary) { e.preventDefault(); this.primary(); return; }
      if (!this.demo) return;
      const map = { Space: [0, 'clean'], KeyE: [0, 'error'], KeyH: [0, 'hands'], KeyJ: [0, 'one'], KeyK: [0, 'low'] };
      const act = map[e.code];
      if (act) { e.preventDefault(); Demo.act(act[0], act[1]); }
    });

    window.addEventListener('pagehide', () => Vision.stopCamera());
  }
};

document.addEventListener('DOMContentLoaded', () => App.init());
