// Demo mode for GitHub Pages: an in-memory backend for the dashboard, so it runs in the browser
// with no server and no scale. scripts/build_demo.py loads this file (after body.js) before the
// main script of app/static/index.html, which stays unchanged:
// - fetch("/api/...") is answered from memory (profiles, measurements, settings, photos);
// - WebSocket is replaced by a fake socket that plays weigh-ins with the same "live" and
//   "measurement" messages the server sends for a real scale;
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

  const db = { profiles: [], measurements: [], settings: { tolerance_kg: 5.0, unit: "kg" }, nextId: 1, nextPid: 1 };
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
      return json(clone(db.settings));
    }
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

  // Alex steps on the scale a little lighter than last time.
  function playAlex() {
    const alex = db.profiles.find((p) => p.name === "Alex") || db.profiles[0];
    const l = alex && last(alex.id);
    const weight = l ? Math.round((l.weight_kg - 0.25 - Math.random() * 0.3) * 100) / 100 : 81.4;
    const impedance = l?.impedance ? l.impedance - 2 - Math.floor(Math.random() * 4) : 478;
    weighIn(weight, impedance);
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
