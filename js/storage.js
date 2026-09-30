/* ==================================================================
   storage.js — всё, что хранится в localStorage:
   профили (Эло, рекорды, нагрузка), история, свои планы, настройки.
   Любое обращение в try/catch: в приватном режиме хранилище может падать.
   ================================================================== */
'use strict';

const Store = {
  K: { profiles: 'pua3_profiles', history: 'pua3_history', plans: 'pua3_plans', settings: 'pua3_settings' },

  _get(key, def) { try { const v = JSON.parse(localStorage.getItem(key)); return v ?? def; } catch { return def; } },
  _set(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { console.warn('localStorage:', e); } },

  /* ---------- Профили ---------- */
  newProfile(name) {
    return {
      id: U.uid(), name: name.trim().slice(0, 18) || 'Игрок', createdAt: Date.now(),
      elo: CONFIG.ELO.start, duels: 0, wins: 0, draws: 0, losses: 0,
      records: { pushupSet: 0, squatSet: 0, pullupSet: 0, pushupTotal: 0, squatTotal: 0, pullupTotal: 0, duelBest: 0, bestAccuracy: 0, workouts: 0 },
      fatigue: { load: 0, t: Date.now(), lockUntil: 0 }
    };
  },
  profiles() { return this._get(this.K.profiles, []); },
  getProfile(id) { return this.profiles().find(p => p.id === id) || null; },
  findByName(name) { const n = name.trim().toLowerCase(); return this.profiles().find(p => p.name.toLowerCase() === n) || null; },

  /** Найти по имени или создать новый профиль */
  ensureProfile(name) {
    const clean = (name || '').trim().slice(0, 18) || 'Игрок';
    return this.findByName(clean) || this.saveProfile(this.newProfile(clean));
  },
  saveProfile(p) {
    const list = this.profiles();
    const i = list.findIndex(x => x.id === p.id);
    if (i >= 0) list[i] = p; else list.push(p);
    this._set(this.K.profiles, list);
    return p;
  },
  deleteProfile(id) { this._set(this.K.profiles, this.profiles().filter(p => p.id !== id)); },

  /* ---------- История ---------- */
  history() { return this._get(this.K.history, []); },
  addHistory(entry) {
    const list = this.history();
    list.unshift({ id: U.uid(), date: Date.now(), ...entry });
    this._set(this.K.history, list.slice(0, 150));
  },

  /* ---------- Планы ---------- */
  customPlans() { return this._get(this.K.plans, []); },
  allPlans() { return [...PRESET_PLANS, ...this.customPlans()]; },
  getPlan(id) { return this.allPlans().find(p => p.id === id) || PRESET_PLANS[0]; },
  savePlan(plan) {
    const list = this.customPlans().filter(p => p.id !== plan.id);
    list.push(plan);
    this._set(this.K.plans, list);
  },
  deletePlan(id) { this._set(this.K.plans, this.customPlans().filter(p => p.id !== id)); },

  /* ---------- Настройки ---------- */
  settings() {
    return Object.assign({ theme: 'dark', sound: true, voice: true, techModal: true, demo: false, profileId: null, planId: PRESET_PLANS[0].id },
      this._get(this.K.settings, {}));
  },
  setSetting(key, value) { const s = this.settings(); s[key] = value; this._set(this.K.settings, s); },

  resetAll() { Object.values(this.K).forEach(k => { try { localStorage.removeItem(k); } catch {} }); }
};
