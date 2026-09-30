/* ==================================================================
   elo.js — рейтинг Эло и 6 рангов.
   Ожидаемый результат: E = 1 / (1 + 10^((Rб − Rа) / 400))
   Изменение:           Δ = K × (S − E), S: 1 победа, 0.5 ничья, 0 поражение
   Разница рейтингов учитывается через E: побеждать сильного выгоднее,
   проигрывать слабому — больнее. K выше у новичков (рейтинг быстрее находит
   своё место) и ниже у сильных игроков (рейтинг стабильнее).
   ================================================================== */
'use strict';

const Elo = {
  rank(elo) {
    let idx = 0;
    RANKS.forEach((r, i) => { if (elo >= r.min) idx = i; });
    const cur = RANKS[idx], next = RANKS[idx + 1] || null;
    const from = idx === 0 ? CONFIG.ELO.start - 100 : cur.min;
    const progress = next ? U.clamp((elo - from) / (next.min - from), 0, 1) : 1;
    return { ...cur, index: idx, next, progress };
  },

  expected(ra, rb) { return 1 / (1 + Math.pow(10, (rb - ra) / 400)); },

  k(profile) {
    const e = CONFIG.ELO;
    if (profile.duels < e.newbieDuels) return e.kNew;
    if (profile.elo >= e.proElo) return e.kPro;
    return e.kMid;
  },

  /** Шансы и ставки до матча: сколько Эло можно выиграть / потерять */
  preview(a, b) {
    const ea = this.expected(a.elo, b.elo), eb = 1 - ea;
    const ka = this.k(a), kb = this.k(b);
    const d = (k, s, e) => Math.round(k * (s - e));
    return {
      chanceA: ea, chanceB: eb,
      a: { win: d(ka, 1, ea), draw: d(ka, 0.5, ea), loss: d(ka, 0, ea) },
      b: { win: d(kb, 1, eb), draw: d(kb, 0.5, eb), loss: d(kb, 0, eb) }
    };
  },

  /** Дуэль с ботом: меняется только рейтинг игрока. Возвращает дельту */
  applyVsBot(p, botElo, score) {
    const e = this.expected(p.elo, botElo);
    const d = Math.round(this.k(p) * (score - e));
    p.elo = Math.max(100, p.elo + d);
    p.duels++;
    if (score === 1) p.wins++; else if (score === 0) p.losses++; else p.draws++;
    return d;
  },

  /** Применить результат (scoreA: 1 / 0.5 / 0). Мутирует профили, возвращает дельты */
  apply(a, b, scoreA) {
    const ea = this.expected(a.elo, b.elo);
    const da = Math.round(this.k(a) * (scoreA - ea));
    const db = Math.round(this.k(b) * ((1 - scoreA) - (1 - ea)));
    a.elo = Math.max(100, a.elo + da);
    b.elo = Math.max(100, b.elo + db);
    a.duels++; b.duels++;
    if (scoreA === 1) { a.wins++; b.losses++; }
    else if (scoreA === 0) { a.losses++; b.wins++; }
    else { a.draws++; b.draws++; }
    return { da, db };
  }
};
