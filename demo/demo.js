// Demo mode for GitHub Pages: an in-memory backend for the dashboard, so it runs in the browser
// with no server and no scale. scripts/build_demo.py loads this file (after body.js) before the
// main script of app/static/index.html, which stays unchanged:
// - fetch("/api/...") is answered from memory (profiles, measurements, settings, photos);
// - WebSocket is replaced by a fake socket that plays weigh-ins with the same "live" and
//   "measurement" messages the server sends for a real scale;
// - the weekly AI analysis is simulated: fixed texts filled in with the demo's own numbers,
//   streamed over the fake socket like the server streams a real model's answer;
// - the service worker is not registered (the demo lives under a subpath).
// Everything resets when the page reloads.
(function () {
  "use strict";
  const { compute } = window.MiscaleBody;
  const REPO = "https://github.com/BrOrlandi/miscale-dashboard";

  // ---------- Seed data: two fictional people and ~90 days of weigh-ins, relative to today ----------
  const PEOPLE = [
    // name, height, birth, male, start weight, end weight, impedance start, end, photo
    ["Alex", 178, "1991-04-13", true, 86.4, 81.6, 520, 478, "demo/alex.jpg"],
    ["Sam", 166, "1994-09-02", false, 64.8, 62.1, 590, 560, null],
  ];

  function random(seed) {   // mulberry32: the same history on every visit
    return () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  }
  const gauss = (rnd, sigma) => sigma * Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());

  // Local time without a time zone, like the server's datetime.isoformat(timespec="seconds").
  const pad = (n) => String(n).padStart(2, "0");
  const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  const clone = (x) => JSON.parse(JSON.stringify(x));

  const db = { profiles: [], measurements: [], analyses: [], settings: { tolerance_kg: 5.0, unit: "kg" },
    nextId: 1, nextPid: 1, nextAid: 1 };
  // What the server reports about the weekly analysis: on, every Saturday at 9:00.
  const AI = { ai_enabled: true, ai_weekday: 5, ai_hour: 9 };
  const LB = 0.45359237;
  const photos = {};   // profile id -> image URL (the bundled photo or an uploaded blob)

  const profile = (pid) => db.profiles.find((p) => p.id === pid) || null;
  const get = (mid) => db.measurements.find((m) => m.id === mid) || null;
  const list = (pid) => db.measurements.filter((m) => !pid || m.profile_id === pid)
    .sort((a, b) => (a.measured_at < b.measured_at ? 1 : a.measured_at > b.measured_at ? -1 : b.id - a.id));
  const last = (pid) => list(pid)[0] || null;

  function metricsFor(pid, weight, impedance, when) {
    const p = profile(pid);
    if (!p || !p.height_cm || !p.birth) return {};
    return compute(weight, impedance, +p.height_cm, p.birth, p.male, when.slice(0, 10));
  }

  function insert(m) {
    const row = { id: db.nextId++, scale_time: null, raw: null, address: "DEMO", ...m };
    db.measurements.push(row);
    return row;
  }

  function saveProfile(p, pid) {
    const fields = { name: p.name, height_cm: p.height_cm ?? null, birth: p.birth || null, male: p.male !== false,
      ref_weight: p.ref_weight ?? null, color: p.color ?? null };
    const old = pid && profile(pid);
    if (old) return Object.assign(old, fields);
    const row = { id: db.nextPid++, ...fields, photo: null };
    db.profiles.push(row);
    return row;
  }

  // The profile whose last weight (or reference weight) is closest, within the tolerance.
  function guessProfile(weight) {
    let best = null, bestDiff = null;
    for (const p of db.profiles) {
      const l = last(p.id);
      const ref = l ? l.weight_kg : p.ref_weight;
      if (ref == null) continue;
      const diff = Math.abs(ref - weight);
      if (diff <= db.settings.tolerance_kg && (bestDiff == null || diff < bestDiff)) { best = p.id; bestDiff = diff; }
    }
    if (best == null && db.profiles.length === 1 && !last(db.profiles[0].id) && !db.profiles[0].ref_weight) best = db.profiles[0].id;
    return best;
  }

  function seed() {
    const rnd = random(7);
    const now = new Date();
    now.setSeconds(0, 0);
    const days = 90;
    const stamp = Math.floor(Date.now() / 1000);
    for (const [name, height, birth, male, w0, w1, i0, i1, photo] of PEOPLE) {
      const p = saveProfile({ name, height_cm: height, birth, male, ref_weight: w0 });
      if (photo) { photos[p.id] = photo; p.photo = `${p.id}.jpg?v=${stamp}`; }
      for (let d = days; d > 0; d--) {
        if (rnd() < 0.18) continue;   // skipped days
        const k = 1 - d / days;
        const when = new Date(now);
        when.setDate(now.getDate() - d);
        when.setHours(7, Math.floor(rnd() * 51), 0, 0);
        const weight = Math.round((w0 + (w1 - w0) * k + gauss(rnd, 0.35)) * 100) / 100;
        const impedance = Math.round(i0 + (i1 - i0) * k + gauss(rnd, 12));
        const at = iso(when);
        insert({ measured_at: at, weight_kg: weight, impedance, profile_id: p.id, metrics: metricsFor(p.id, weight, impedance, at) });
      }
    }
    // Last Saturday's weekly analysis for Alex. Its text follows the page's language.
    const sat = new Date(now);
    sat.setDate(sat.getDate() - 1);
    sat.setDate(sat.getDate() - ((sat.getDay() + 1) % 7));
    const end = iso(sat).slice(0, 10);
    sat.setHours(9, 0, 14);
    db.analyses.push({ id: db.nextAid++, profile_id: 1, week_start: addDays(end, -6), week_end: end, kind: "weekly",
      created_at: iso(sat), model: MODEL, lang: null, text: null });
  }

  // ---------- Weekly analysis: fixed texts, filled in with the demo's own numbers ----------
  const MODEL = "demo (simulated)";
  const addDays = (day, n) => { const d = new Date(day + "T12:00"); d.setDate(d.getDate() + n); return iso(d).slice(0, 10); };
  const pageLang = () => (typeof lang !== "undefined" && lang === "pt-BR" ? "pt-BR" : "en");   /* global lang */

  function weekOf(pid, end) {   // weigh-ins in the 7 days that end on `end` (YYYY-MM-DD)
    const start = addDays(end, -6);
    return list(pid).filter((m) => m.measured_at.slice(0, 10) >= start && m.measured_at.slice(0, 10) <= end);
  }

  function weekStats(pid, end) {
    const ms = weekOf(pid, end);
    const mean = (f) => { const v = ms.map(f).filter((x) => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
    const w = ms.map((m) => m.weight_kg);
    return { n: ms.length, weight: mean((m) => m.weight_kg), fat: mean((m) => m.metrics?.body_fat),
      fatMass: mean((m) => m.metrics?.fat_mass), muscle: mean((m) => m.metrics?.muscle_mass),
      visceral: mean((m) => m.metrics?.visceral_fat), swing: w.length > 1 ? Math.max(...w) - Math.min(...w) : 0 };
  }

  const TEXTS = {
    en: {
      first: (s) => `${s.name}, this is the first week with data, so take these numbers as your starting point: ${s.w} on average${s.f ? `, with body fat at ${s.f}` : ""}.`,
      down: (s) => `${s.name}, your weight averaged ${s.w} this week, ${s.dw} less than the week before`,
      up: (s) => `${s.name}, your weight averaged ${s.w} this week, ${s.dw} more than the week before`,
      flat: (s) => `${s.name}, your weight averaged ${s.w} this week, about the same as the week before`,
      fatDown: (s) => `, and body fat eased from ${s.pf} to ${s.f}.`, fatUp: (s) => `, while body fat went from ${s.pf} to ${s.f}.`,
      fatFlat: (s) => `, with body fat steady at ${s.f}.`, noFat: () => ".",
      monthDown: (s) => ` Over the last four weeks you are ${s.d4} lighter, a steady pace that is easy to keep.`,
      monthUp: (s) => ` Over the last four weeks you are ${s.d4} heavier.`, monthFlat: () => " Over four weeks your weight has held steady.",
      improved: "What improved", attention: "What needs attention", next: "For next week",
      iWeight: (s) => `Average weight down ${s.dw} on the previous week.`,
      iFat: (s) => `Body fat down ${s.df} points${s.fm ? `, with fat mass at ${s.fm}` : ""}.`,
      iMuscle: (s) => `Muscle mass held at ${s.m}, so what you lost was mostly fat.`,
      iMuscleUp: (s) => `Muscle mass up ${s.dm}, to ${s.m}.`,
      iRoutine: (s) => `${s.n} weigh-ins this week: a reliable average.`,
      iKeep: () => "You kept weighing in, which is what makes a trend visible.",
      aSwing: (s) => `Daily readings still moved by up to ${s.swing}: that is water and meals, not fat, so go by the weekly average.`,
      aWeight: (s) => `Weight up ${s.dw} on the week. One week is not a trend, but keep an eye on it.`,
      aFat: (s) => `Body fat up ${s.df} points on the previous week.`,
      aMuscle: (s) => `Muscle mass down ${s.dm}; enough protein and some strength work help keep it.`,
      aFew: (s) => `Only ${s.n} weigh-ins this week, so the averages are rough.`,
      aVisceral: (s) => `Visceral fat is at ${s.v}. It comes down slowly, so give it a few more weeks.`,
      aNone: () => "Nothing stands out. Keep the same routine.",
      nWeigh: "Weigh in every morning, before eating and barefoot, so the averages stay comparable.",
      nProtein: "Have some protein at every meal and a couple of strength sessions to protect muscle while you lose fat.",
      nSleep: "Keep sleep and water regular: both make the readings steadier.",
    },
    "pt-BR": {
      first: (s) => `${s.name}, esta é a primeira semana com dados, então use estes números como ponto de partida: ${s.w} de média${s.f ? `, com gordura em ${s.f}` : ""}.`,
      down: (s) => `${s.name}, seu peso ficou em ${s.w} de média nesta semana, ${s.dw} a menos que na semana anterior`,
      up: (s) => `${s.name}, seu peso ficou em ${s.w} de média nesta semana, ${s.dw} a mais que na semana anterior`,
      flat: (s) => `${s.name}, seu peso ficou em ${s.w} de média nesta semana, praticamente igual à semana anterior`,
      fatDown: (s) => `, e a gordura caiu de ${s.pf} para ${s.f}.`, fatUp: (s) => `, enquanto a gordura foi de ${s.pf} para ${s.f}.`,
      fatFlat: (s) => `, com a gordura estável em ${s.f}.`, noFat: () => ".",
      monthDown: (s) => ` Nas últimas quatro semanas você está ${s.d4} mais leve, num ritmo constante e fácil de manter.`,
      monthUp: (s) => ` Nas últimas quatro semanas você está ${s.d4} mais pesado.`, monthFlat: () => " Em quatro semanas o peso ficou estável.",
      improved: "O que melhorou", attention: "O que pede atenção", next: "Para a próxima semana",
      iWeight: (s) => `Peso médio ${s.dw} abaixo da semana anterior.`,
      iFat: (s) => `Gordura ${s.df} ponto${s.df === "1,0" ? "" : "s"} abaixo${s.fm ? `, com ${s.fm} de massa gorda` : ""}.`,
      iMuscle: (s) => `Massa muscular mantida em ${s.m}: o que você perdeu foi principalmente gordura.`,
      iMuscleUp: (s) => `Massa muscular subiu ${s.dm}, para ${s.m}.`,
      iRoutine: (s) => `${s.n} pesagens na semana: uma média confiável.`,
      iKeep: () => "Você continuou se pesando, e é isso que deixa a tendência visível.",
      aSwing: (s) => `As pesagens do dia a dia ainda variaram até ${s.swing}: isso é água e refeição, não gordura, então guie-se pela média da semana.`,
      aWeight: (s) => `Peso ${s.dw} acima na semana. Uma semana não é tendência, mas vale acompanhar.`,
      aFat: (s) => `Gordura ${s.df} ponto${s.df === "1,0" ? "" : "s"} acima da semana anterior.`,
      aMuscle: (s) => `Massa muscular ${s.dm} abaixo; proteína suficiente e um pouco de musculação ajudam a manter.`,
      aFew: (s) => `Só ${s.n} pesagens na semana, então as médias são aproximadas.`,
      aVisceral: (s) => `A gordura visceral está em ${s.v}. Ela cai devagar, então dê mais algumas semanas.`,
      aNone: () => "Nada chama atenção. Mantenha a mesma rotina.",
      nWeigh: "Pese-se toda manhã, em jejum e descalço, para as médias continuarem comparáveis.",
      nProtein: "Inclua proteína em todas as refeições e duas sessões de musculação para proteger o músculo enquanto perde gordura.",
      nSleep: "Mantenha sono e água regulares: os dois deixam as leituras mais estáveis.",
    },
  };

  // The analysis of the 7 days ending on `end`, in plain text like the server's model writes it.
  function writeAnalysis(pid, end, language) {
    const T = TEXTS[language] || TEXTS.en;
    const loc = language === "pt-BR" ? "pt-BR" : "en-US", lb = db.settings.unit === "lb";
    const num = (v, d = 1) => Math.abs(v).toLocaleString(loc, { minimumFractionDigits: d, maximumFractionDigits: d });
    const kg = (v, d = 1) => `${num(lb ? v / LB : v, d)} ${lb ? "lb" : "kg"}`;
    const w = weekStats(pid, end), prev = weekStats(pid, addDays(end, -7)), month = weekStats(pid, addDays(end, -28));
    const has = (a, b) => a != null && b != null;
    const dw = has(w.weight, prev.weight) ? w.weight - prev.weight : 0, df = has(w.fat, prev.fat) ? w.fat - prev.fat : 0;
    const dm = has(w.muscle, prev.muscle) ? w.muscle - prev.muscle : 0;
    const d4 = has(w.weight, month.weight) ? w.weight - month.weight : null;
    const s = { name: profile(pid).name, n: w.n, w: kg(w.weight), dw: kg(dw), d4: d4 == null ? "" : kg(d4),
      f: w.fat != null ? num(w.fat) + "%" : "", pf: prev.fat != null ? num(prev.fat) + "%" : "", df: num(df),
      fm: w.fatMass != null ? kg(w.fatMass) : "", m: w.muscle != null ? kg(w.muscle) : "", dm: kg(dm),
      v: w.visceral != null ? num(w.visceral, 0) : "", swing: kg(w.swing) };
    let summary;
    if (!prev.n) summary = T.first(s);
    else {
      summary = T[dw <= -0.1 ? "down" : dw >= 0.1 ? "up" : "flat"](s) +
        (w.fat == null || prev.fat == null ? T.noFat(s) : T[df <= -0.1 ? "fatDown" : df >= 0.1 ? "fatUp" : "fatFlat"](s));
      if (d4 != null && month.n) summary += T[d4 <= -0.3 ? "monthDown" : d4 >= 0.3 ? "monthUp" : "monthFlat"](s);
    }
    const good = [], watch = [];
    if (prev.n) {
      if (dw <= -0.1) good.push(T.iWeight(s));
      if (df <= -0.1) good.push(T.iFat(s));
      if (w.muscle != null && prev.muscle != null) {
        if (dm >= 0.2) good.push(T.iMuscleUp(s));
        else if (dm > -0.2 && dw <= -0.1) good.push(T.iMuscle(s));
        else if (dm <= -0.2) watch.push(T.aMuscle(s));
      }
      if (dw >= 0.1) watch.push(T.aWeight(s));
      if (df >= 0.1) watch.push(T.aFat(s));
    }
    if (w.n >= 6) good.push(T.iRoutine(s));
    if (w.n < 4) watch.push(T.aFew(s));
    if (w.swing >= 0.5) watch.push(T.aSwing(s));
    if (w.visceral != null && w.visceral >= 13) watch.push(T.aVisceral(s));
    const items = (xs, empty) => (xs.length ? xs : [empty]).slice(0, 3).map((x) => "• " + x).join("\n");
    return [summary, T.improved + "\n" + items(good, T.iKeep(s)), T.attention + "\n" + items(watch, T.aNone(s)),
      T.next + "\n" + [T.nWeigh, T.nProtein, T.nSleep].map((x) => "• " + x).join("\n")].join("\n\n");
  }

  const analysisRow = (a) => ({ ...clone(a), text: a.text ?? writeAnalysis(a.profile_id, a.week_end, pageLang()),
    lang: a.lang ?? pageLang() });

  // "Generate now": the text goes out a few characters at a time over the socket, as a real
  // model's stream does, and the request answers once it is all written.
  let writingFor = null;
  async function writeNow(pid) {
    if (!profile(pid)) return json({ detail: "profile not found" }, 404);
    const end = iso(new Date()).slice(0, 10);
    if (!weekOf(pid, end).length) return json({ detail: "no weigh-in in the last 7 days" }, 409);
    if (writingFor != null) return json({ detail: "an analysis for this profile is already being written" }, 409);
    writingFor = pid;
    try {
      const language = pageLang();
      const text = writeAnalysis(pid, end, language);
      broadcast({ type: "analysis_start", profile_id: pid });
      await sleep(900);   // the model reading the numbers
      for (let i = 0; i < text.length;) {
        const k = 2 + Math.floor(Math.random() * 5);
        broadcast({ type: "analysis_delta", profile_id: pid, text: text.slice(i, i + k), reset: i === 0 });
        i += k;
        await sleep(text.slice(i - k, i).includes("\n") ? 160 : 16 + Math.random() * 22);
      }
      const a = { id: db.nextAid++, profile_id: pid, week_start: addDays(end, -6), week_end: end, kind: "manual",
        created_at: iso(new Date()), model: MODEL, lang: language, text };
      db.analyses.push(a);
      broadcast({ type: "analysis", profile_id: pid, analysis: clone(a) });
      return json(clone(a));
    } finally {
      writingFor = null;
    }
  }

  seed();

  // ---------- fetch("/api/...") ----------
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const notFound = () => json({ detail: "Not Found" }, 404);
  const realFetch = window.fetch.bind(window);

  function profileBody(b) {
    if (!b || typeof b.name !== "string" || !b.name.trim() || b.name.length > 60)
      return [null, json({ detail: [{ loc: ["body", "name"], msg: "Name is required (up to 60 characters)" }] }, 422)];
    return [b, null];
  }

  async function api(method, path, query, body) {
    let m;
    if (path === "ping") return json({ ok: true });
    if (path === "status") return json(status());
    if (path === "measurements" && method === "GET") {
      const pid = query.get("profile_id");
      return json(clone(list(pid ? +pid : null).slice(0, +(query.get("limit") || 1000))));
    }
    if ((m = path.match(/^measurements\/(-?\d+)$/))) {
      const row = get(+m[1]);
      if (method === "DELETE") { db.measurements = db.measurements.filter((x) => x !== row); return json({ ok: true }); }
      if (method === "PATCH") {
        if (!row) return notFound();
        const pid = body?.profile_id ?? null;
        if (pid != null && !profile(pid)) return json({ detail: "profile not found" }, 404);
        row.profile_id = pid;
        row.metrics = metricsFor(pid, row.weight_kg, row.impedance, row.measured_at);
        return json(clone(row));
      }
    }
    if (path === "profiles") {
      if (method === "GET") return json(clone(db.profiles));
      if (method === "POST") {
        const [b, err] = profileBody(body);
        return err || json(clone(saveProfile(b)));
      }
    }
    if ((m = path.match(/^profiles\/(\d+)$/))) {
      const pid = +m[1];
      if (!profile(pid)) return notFound();
      if (method === "PUT") {
        const [b, err] = profileBody(body);
        if (err) return err;
        saveProfile(b, pid);
        for (const row of list(pid)) row.metrics = metricsFor(pid, row.weight_kg, row.impedance, row.measured_at);
        return json(clone(profile(pid)));
      }
      if (method === "DELETE") {
        dropPhoto(pid);
        db.measurements.forEach((row) => { if (row.profile_id === pid) row.profile_id = null; });
        db.analyses = db.analyses.filter((a) => a.profile_id !== pid);
        db.profiles = db.profiles.filter((p) => p.id !== pid);
        return json({ ok: true });
      }
    }
    if ((m = path.match(/^profiles\/(\d+)\/photo$/))) {
      const p = profile(+m[1]);
      if (!p) return notFound();
      if (method === "GET") return photos[p.id] ? realFetch(photos[p.id]) : notFound();
      if (method === "DELETE") { dropPhoto(p.id); p.photo = null; return json(clone(p)); }
      if (method === "PUT") {
        if (!(body instanceof Blob) || !body.size) return json({ detail: "empty photo" }, 413);
        dropPhoto(p.id);
        photos[p.id] = URL.createObjectURL(body);
        p.photo = `${p.id}.jpg?v=${Math.floor(Date.now() / 1000)}`;
        return json(clone(p));
      }
    }
    if (path === "settings") {
      if (method === "PUT") {
        for (const [k, v] of Object.entries(body || {})) if (v != null && k in db.settings) db.settings[k] = v;
      }
      return json({ ...clone(db.settings), ...AI });
    }
    if (path === "analyses" && method === "GET") {
      const pid = +query.get("profile_id") || null;
      const rows = db.analyses.filter((a) => !pid || a.profile_id === pid)
        .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : b.id - a.id));
      return json(rows.slice(0, +(query.get("limit") || 20)).map(analysisRow));
    }
    if (path === "analyses/run" && method === "POST") return writeNow(+query.get("profile_id"));
    if (path === "debug/simulate" && method === "POST") {
      weighIn(+(query.get("weight") || 75), +(query.get("impedance") || 500));
      return json({ ok: true });
    }
    if (path === "debug/devices" || path === "debug/packets") return json([]);
    return notFound();
  }

  function dropPhoto(pid) {
    if (photos[pid]?.startsWith("blob:")) URL.revokeObjectURL(photos[pid]);
    delete photos[pid];
  }

  window.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url, location.href);
    if (url.origin !== location.origin || !url.pathname.startsWith("/api/")) return realFetch(input, init);
    const method = (init.method || (typeof input === "string" ? "GET" : input.method)).toUpperCase();
    let body = init.body;
    if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = null; } }
    await new Promise((r) => setTimeout(r, 20));   // a network round trip
    return api(method, url.pathname.slice(5), url.searchParams, body);
  };

  // The dashboard asks for profile photos by URL (<img src>); scripts/build_demo.py points it here.
  window.demoPhotoUrl = (p) => photos[p.id] || null;

  // ---------- WebSocket ----------
  const sockets = new Set();
  const status = () => ({ scanner: true, scanner_error: null, last_seen: iso(new Date()) });

  class DemoSocket extends EventTarget {
    constructor(url) {
      super();
      this.url = String(url);
      this.readyState = 0;
      this.onopen = this.onmessage = this.onclose = this.onerror = null;
      setTimeout(() => {
        this.readyState = 1;
        sockets.add(this);
        this._emit(new Event("open"));
        this._push({ type: "status", ...status() });
      }, 150);
    }
    _emit(e) { this.dispatchEvent(e); this["on" + e.type]?.(e); }
    _push(msg) { if (this.readyState === 1) this._emit(new MessageEvent("message", { data: JSON.stringify(msg) })); }
    send() {}
    close() {
      if (this.readyState >= 2) return;
      this.readyState = 3;
      sockets.delete(this);
      this._emit(new CloseEvent("close", { code: 1000 }));
    }
  }
  Object.assign(DemoSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
  window.WebSocket = DemoSocket;
  const broadcast = (msg) => sockets.forEach((s) => s._push(msg));

  // ---------- A weigh-in, packet by packet, as the server reports a real scale ----------
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let playing = false;

  async function weighIn(weight, impedance) {
    if (playing) return;
    playing = true;
    syncButton();
    const live = (w, imp = null, stabilized = false, removed = false) => broadcast({ type: "live", at: iso(new Date()),
      weight_kg: Math.round(w * 100) / 100, impedance: imp, stabilized, removed, rssi: -58, raw: null });
    try {
      // Settling weight.
      for (const f of [0.3, 0.7, 0.95, 1.01, 0.995, 1.002, 1.0]) { live(weight * f); await sleep(500); }
      // Stable weight: saved right away, without the impedance yet.
      live(weight, null, true);
      const pid = guessProfile(weight);
      const when = iso(new Date());
      const m = insert({ measured_at: when, weight_kg: weight, impedance: null, profile_id: pid, metrics: metricsFor(pid, weight, null, when) });
      broadcast({ type: "measurement", event: "saved", measurement: clone(m) });
      await sleep(3000);
      // The same packet again, now with the impedance: the body composition is filled in.
      live(weight, impedance, true);
      m.impedance = impedance;
      m.metrics = metricsFor(pid, weight, impedance, when);
      broadcast({ type: "measurement", event: "updated", measurement: clone(m) });
      await sleep(3000);
      // Stepped off.
      live(weight, impedance, true, true);
      await sleep(10000);   // the result screen closes on its own
    } finally {
      playing = false;
      syncButton();
    }
  }

  // Alex steps on the scale a little lighter than last time. The tour ends with Alex's weekly
  // analysis being written in the card, as if an AI model were typing it.
  async function playAlex() {
    if (playing) return;
    const alex = db.profiles.find((p) => p.name === "Alex") || db.profiles[0];
    const l = alex && last(alex.id);
    const weight = l ? Math.round((l.weight_kg - 0.25 - Math.random() * 0.3) * 100) / 100 : 81.4;
    const impedance = l?.impedance ? l.impedance - 2 - Math.floor(Math.random() * 4) : 478;
    await weighIn(weight, impedance);
    /* global current, runAnalysis */
    const scan = document.getElementById("scan");
    for (let i = 0; i < 120 && scan.classList.contains("open"); i++) await sleep(500);   // tapped to keep it open
    await sleep(900);
    if (!alex || current !== alex.id || writingFor != null) return;
    const card = document.getElementById("anCard");
    if (card.getBoundingClientRect().top > innerHeight * 0.55) {
      card.scrollIntoView({ block: "start", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    }
    runAnalysis();
  }

  // ---------- Banner and "Play demo" button ----------
  function syncButton() {
    const b = document.getElementById("demoPlay");
    if (b) b.disabled = playing;
  }

  document.addEventListener("DOMContentLoaded", () => {
    /* global STRINGS, applyStrings */
    Object.assign(STRINGS.en, {
      demoBanner: "Live demo with made-up data: no scale or server needed.",
      demoRepo: "Source code on GitHub",
      playDemo: "▶ Play demo",
      playDemoHint: "Plays a weigh-in of Alex on the scale",
    });
    Object.assign(STRINGS["pt-BR"], {
      demoBanner: "Demonstração com dados fictícios: não precisa de balança nem servidor.",
      demoRepo: "Código-fonte no GitHub",
      playDemo: "▶ Iniciar demo",
      playDemoHint: "Simula uma pesagem do Alex na balança",
    });
    const style = document.createElement("style");
    style.textContent = `
      .demo-banner { background: var(--accent-soft); color: var(--ink); border-bottom: 1px solid var(--line);
        text-align: center; font-size: 13px; padding: 8px 16px; }
      .demo-banner a { color: var(--accent); font-weight: 600; margin-left: 6px; white-space: nowrap; }
      #demoPlay { margin-top: 16px; font-size: 16px; font-weight: 600; padding: 10px 22px; border-radius: 999px; }
      #demoPlay:disabled { opacity: .55; cursor: default; }`;
    document.head.append(style);
    const banner = document.createElement("div");
    banner.className = "demo-banner";
    banner.setAttribute("role", "note");
    banner.innerHTML = `<span data-t="demoBanner"></span><a href="${REPO}" target="_blank" rel="noopener" data-t="demoRepo"></a>`;
    document.body.prepend(banner);
    const play = document.createElement("button");
    play.id = "demoPlay";
    play.className = "primary";
    play.dataset.t = "playDemo";
    play.dataset.tTitle = "playDemoHint";
    play.addEventListener("click", playAlex);
    document.getElementById("live").append(play);
    applyStrings();
    // applyStrings fills data-t-title with an aria-label; keep the visible text as the button's name.
    play.removeAttribute("aria-label");
    syncButton();
  });

  // ---------- No service worker: GitHub Pages serves the demo under /miscale-dashboard/ ----------
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register = () => Promise.reject(new Error("no service worker in the demo"));
  }
})();
