/* ==================================================================
   ui.js — всё, что меняет DOM: экраны, тема, подсказки (панель +
   крупный баннер поверх видео), оверлеи сцены, журнал, шкалы нагрузки.
   Логика игры сюда не входит — только отображение.
   ================================================================== */
'use strict';

const UI = {
  /* ---------- Экраны и навигация ---------- */
  showScreen(id) {
    const target = U.$(id);
    const current = [...document.querySelectorAll('.screen')].find(s => !s.classList.contains('hidden') && s !== target);
    const reveal = () => {
      target.classList.remove('hidden');
      requestAnimationFrame(() => requestAnimationFrame(() => target.classList.remove('is-hidden')));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    };
    document.querySelectorAll('[data-nav]').forEach(b => b.setAttribute('aria-current', b.dataset.nav === id ? 'page' : 'false'));
    if (current) { current.classList.add('is-hidden'); setTimeout(() => { current.classList.add('hidden'); reveal(); }, 300); }
    else reveal();
  },

  applyTheme(theme) {
    const dark = theme !== 'light';
    document.documentElement.classList.toggle('dark', dark);
    U.$('theme-icon').textContent = dark ? '🌙' : '☀️';
    U.$('theme-label').textContent = dark ? 'Тёмная' : 'Светлая';
  },

  toast(text, tone = 'info') {
    const t = document.createElement('div');
    t.className = `toast toast-${tone}`;
    t.textContent = text;
    U.$('toasts').appendChild(t);
    setTimeout(() => t.classList.add('out'), 2600);
    setTimeout(() => t.remove(), 3000);
  },

  rankHTML(elo) { const r = Elo.rank(elo); return `${r.icon} ${r.name}`; },

  /* ---------- Подсказки ---------- */
  _fbTimer: null, _bnTimer: null,

  /**
   * Подсказка в панели справа; banner=true — ещё и крупно поверх видео.
   * type: good | error | warn | info | idle. ms=0 — не скрывать.
   */
  feedback(type, title, text = '', { ms = 1800, banner = false } = {}) {
    const f = U.$('feedback');
    f.dataset.state = type;
    U.$('feedback-title').textContent = title;
    U.$('feedback-text').textContent = text;
    U.restart(f, 'fb-pulse');   // только подсветка рамки — размер блока не меняется
    clearTimeout(this._fbTimer);
    if (ms > 0) this._fbTimer = setTimeout(() => { f.dataset.state = 'idle'; U.$('feedback-title').textContent = this.idleTitle; U.$('feedback-text').textContent = this.idleText; }, ms);
    if (banner) this.banner(type, title, text, ms || 2600);
  },
  idleTitle: 'Готовься', idleText: '',
  setIdle(title, text) {
    this.idleTitle = title; this.idleText = text;
    const f = U.$('feedback');
    if (f.dataset.state === 'idle') { U.$('feedback-title').textContent = title; U.$('feedback-text').textContent = text; }
  },

  banner(type, title, text, ms = 2400) {
    const b = U.$('stage-banner');
    b.dataset.state = type;
    U.$('banner-title').textContent = title;
    U.$('banner-text').textContent = text;
    b.classList.remove('hide');
    U.restart(b, 'bump');
    clearTimeout(this._bnTimer);
    this._bnTimer = setTimeout(() => b.classList.add('hide'), ms);
  },

  /* ---------- Эффекты сцены ---------- */
  float(text, kind, xPct = 50) {
    const el = document.createElement('div');
    el.className = `float-dmg ${kind}`;
    el.style.left = `${U.clamp(xPct + (Math.random() * 16 - 8), 8, 92)}%`;
    el.style.top = `${38 + Math.random() * 14}%`;
    el.textContent = text;
    U.$('fx-layer').appendChild(el);
    setTimeout(() => el.remove(), 1250);
  },
  frame(kind) {
    const f = U.$('frame');
    f.classList.remove('good', 'bad'); void f.offsetWidth; f.classList.add(kind);
    setTimeout(() => f.classList.remove(kind), kind === 'good' ? 600 : 1000);
  },
  aura() { const a = U.$('aura'); a.classList.add('on'); setTimeout(() => a.classList.remove('on'), 1100); },

  /* ---------- Стабильный вывод текста (без дёрганья) ---------- */
  _txt: {},
  /** Меняет textContent, только если текст реально изменился */
  setText(id, text) {
    text = String(text);
    if (this._txt[id] === text) return;
    this._txt[id] = text;
    const el = U.$(id);
    if (el) el.textContent = text;
  },
  resetTextCache() { this._txt = {}; },

  /* ---------- Датчик и статус ---------- */
  _metricAt: 0,
  /**
   * Значение угла обновляется не чаще 8 раз в секунду (цифры не мельтешат),
   * маркер шкалы двигается плавно каждый кадр через transform.
   */
  metric(res, prefix = '') {
    if (!res || res.metric.d == null) { this.setText('metric-value', '—'); return; }
    const now = performance.now();
    U.$('gauge-marker').style.transform = `translateX(${(U.clamp(res.metric.d, 0, 1.2) / 1.2 * 98.5).toFixed(1)}%)`;
    if (now - this._metricAt < 120) return;
    this._metricAt = now;
    this.setText('metric-label', prefix + res.metric.label);
    this.setText('metric-value', res.metric.value);
  },
  _statusAt: 0,
  status(text) {
    const now = performance.now();
    if (now - this._statusAt < 150 && this._txt['status-chip'] !== undefined) return;
    this._statusAt = now;
    this.setText('status-chip', text);
  },

  /** Кольцо удержания жеста (поверх сцены, маленькое, в углу) */
  gesture(progress, label = '') {
    const g = U.$('gesture-ring');
    g.classList.toggle('hidden', progress <= 0);
    U.$('gesture-arc').style.strokeDashoffset = 150.8 * (1 - progress);
    U.$('gesture-label').textContent = label;
  },

  /** Полоса-инструкция внизу сцены (не закрывает игрока) */
  strip(html) {
    const s = U.$('stage-strip');
    if (!html) { s.classList.add('hidden'); return; }
    s.innerHTML = html; s.classList.remove('hidden');
  },

  show(id, on) { U.$(id).classList.toggle('hidden', !on); },

  /** Отсчёт 3-2-1; прерывается, если сессия сменилась */
  countdown(isAlive, done) {
    const ov = U.$('countdown-overlay'), txt = U.$('countdown-text');
    const steps = ['3', '2', '1', 'СТАРТ!'];
    let i = 0;
    ov.classList.remove('hidden');
    const tick = () => {
      if (!isAlive()) { ov.classList.add('hidden'); return; }
      if (i >= steps.length) { ov.classList.add('hidden'); done(); return; }
      txt.textContent = steps[i]; U.restart(txt, 'count-anim');
      Sound.beep(i === steps.length - 1);
      i++; setTimeout(tick, 850);
    };
    tick();
  },
  bigWord(word, ms = 1400) {
    const ov = U.$('countdown-overlay'), txt = U.$('countdown-text');
    ov.classList.remove('hidden'); txt.textContent = word; U.restart(txt, 'count-anim');
    setTimeout(() => ov.classList.add('hidden'), ms);
  },

  /* ---------- Журнал ---------- */
  log(type, text, elapsedSec = null) {
    const list = U.$('event-log');
    const li = document.createElement('li');
    li.className = type;
    li.innerHTML = `<span class="t">${elapsedSec == null ? '—' : U.fmt(elapsedSec)}</span><span>${U.esc(text)}</span>`;
    list.prepend(li);
    while (list.children.length > 40) list.lastChild.remove();
  },
  clearLog() { U.$('event-log').innerHTML = ''; this._errHTML = ''; this.resetTextCache(); U.$('load-list').dataset.key = ''; },

  /* ---------- Нагрузка ---------- */
  /** Строки создаются один раз, дальше меняются только ширина и текст */
  renderLoad(players) {
    const box = U.$('load-list');
    const key = players.map(p => p.profile.id).join('|');
    if (box.dataset.key !== key) {
      box.dataset.key = key;
      box.innerHTML = players.map((p, i) => `<div class="load-row">
        <div class="load-head"><span class="truncate">${U.esc(p.slot === 'solo' ? p.profile.name : p.label)}</span><span id="load-val-${i}" class="load-val">0%</span></div>
        <div class="load-track"><div id="load-fill-${i}" class="load-fill ok" style="width:0%"></div></div></div>`).join('');
      players.forEach((_, i) => { delete this._txt['load-val-' + i]; });
    }
    players.forEach((p, i) => {
      const locked = Fatigue.isLocked(p.profile);
      const load = locked ? 100 : Math.round(Fatigue.load(p.profile));
      const tone = locked ? 'lock' : load >= 80 ? 'hot' : load >= 50 ? 'warm' : 'ok';
      const fill = U.$('load-fill-' + i);
      fill.style.width = load + '%';
      if (!fill.classList.contains(tone)) fill.className = 'load-fill ' + tone;
      this.setText('load-val-' + i, locked ? '⏸️ ' + U.fmt(Fatigue.lockLeft(p.profile)) : load + '%');
    });
  },

  /**
   * Проверки техники для ТЕКУЩЕГО упражнения: все возможные ошибки сразу,
   * со счётчиками (0 — серый ✓, больше 0 — красный). Набор строк фиксирован,
   * поэтому панель не прыгает. DOM меняется, только если изменились цифры.
   * Ошибки других упражнений этой сессии — отдельной строкой «Ранее».
   */
  _errHTML: '',
  renderErrors(players) {
    const p0 = players[0];
    const ex = p0.exercise;
    const rows = Object.entries(ERRORS[ex]).map(([code, info]) => {
      const n = players.reduce((a, p) => a + (p.stats.byCode[ex + ':' + code] || 0), 0);
      return `<li class="${n ? 'has' : 'zero'}" title="${U.esc(info.tip)}"><span class="truncate">${n ? '⚠️' : '✓'} ${U.esc(info.title)}</span><b>${n}</b></li>`;
    });
    let other = 0;
    players.forEach(p => Object.entries(p.stats.byCode).forEach(([k, n]) => { if (!k.startsWith(ex + ':')) other += n; }));
    const html = rows.join('') + (other ? `<li class="other"><span>Ранее, другие упражнения</span><b>${other}</b></li>` : '');
    if (html === this._errHTML) return;
    this._errHTML = html;
    U.$('err-list').innerHTML = html;
  },

  /** Правая панель под выбранное упражнение: заголовки, шкала, подсказка по установке */
  setExercise(ex) {
    const e = EXERCISES[ex];
    // Подтягивания: важное (кисти, перекладина, голова) вверху кадра — подсказки уходят вниз
    U.$('stage').classList.toggle('ex-pullup', ex === 'pullup');
    this.setText('err-title', `Проверки техники · ${e.icon} ${e.name}`);
    this.setText('gauge-lo', e.gauge[0]);
    this.setText('gauge-hi', e.gauge[1]);
    this.setText('ex-setup', e.setup);
    this.setText('metric-label', ex === 'squat' ? 'Угол колена' : 'Угол локтя');
    this.setText('metric-value', '—');
    this._errHTML = '';
  },

  /* ---------- Панель камеры ---------- */
  camLoading(title, text) {
    const p = U.$('cam-panel');
    p.classList.remove('hidden');
    p.innerHTML = `<div class="text-center"><div class="spinner"></div>
      <div class="font-display text-xl">${U.esc(title)}</div>
      <div class="text-sm text-slate-300 mt-2 max-w-sm mx-auto">${U.esc(text)}</div></div>`;
  },
  camError(info, onDemo, onRetry) {
    const p = U.$('cam-panel');
    p.classList.remove('hidden');
    p.innerHTML = `<div class="cam-card">
      <div class="text-4xl mb-2">${info.icon}</div><h3>${info.title}</h3>
      <p class="text-sm text-slate-300 mt-1">${info.text}</p>
      <ol class="cam-steps">${info.steps.map(s => `<li>${s}</li>`).join('')}</ol>
      <div class="cam-actions">
        <button id="btn-cam-demo" class="btn-primary">🎮 Запустить симуляцию / Демо-режим</button>
        <button id="btn-cam-retry" class="btn-secondary">🔄 Попробовать снова</button>
      </div>
      <div class="cam-error-code">Код ошибки: ${U.esc(info.code)}</div></div>`;
    U.$('btn-cam-demo').onclick = onDemo;
    U.$('btn-cam-retry').onclick = onRetry;
  },
  camHide() { const p = U.$('cam-panel'); p.classList.add('hidden'); p.innerHTML = ''; }
};
