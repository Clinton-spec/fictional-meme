/* ================================================================
   PSYCHIC WINNER — MANUAL PRO  |  v3.1
   Chart-first manual terminal for 5-tick Rise/Fall.
   Entry tools (all computed on the TICK stream the contract settles on):
     EMA 21 cross · supply/demand zones · Stochastic RSI timing · Supertrend side
     + 5m/1m trend, volatility band, chop filter  → one 0-100 entry score.
   Login: Deriv OAuth 2.0 (Authorization Code + PKCE) so users show under
   "Connected applications" and your commission/markup flow applies.
   Speed: RISE + FALL quotes are pre-armed as live streams, so a click is
   one BUY round-trip (pointerdown, no click latency).
================================================================ */
"use strict";

/* ---------- CONFIG (sellers edit this block) ---------- */
const CFG = {
    APP_ID: "353LRdVIFF0qscPSnu5uM",                       // your registered Deriv App ID (= OAuth client_id). Empty = the login card asks for it.
    REDIRECT_URI: "https://clinton-spec.github.io/fictional-meme/",                 // "" = this page's own URL. Must match the URL registered with Deriv EXACTLY.
    SCOPE: "trade",                   // space-separated; only scopes your app is registered for
    AUTH_URL: "https://auth.deriv.com/oauth2/auth",
    TOKEN_URL: "https://auth.deriv.com/oauth2/token",
    TOKEN_PROXY: "https://pw-token.clintonpanashejochore.workers.dev/",                  // optional backend that forwards the code exchange (see token-proxy.js)
    REST: "https://api.derivws.com"
};

/* ---------- CONSTANTS ---------- */
const NAMES = {
    R_10: "Volatility 10", R_25: "Volatility 25", R_50: "Volatility 50", R_75: "Volatility 75", R_100: "Volatility 100",
    "1HZ10V": "Volatility 10 (1s)", "1HZ15V": "Volatility 15 (1s)", "1HZ25V": "Volatility 25 (1s)", "1HZ30V": "Volatility 30 (1s)",
    "1HZ50V": "Volatility 50 (1s)", "1HZ75V": "Volatility 75 (1s)", "1HZ90V": "Volatility 90 (1s)", "1HZ100V": "Volatility 100 (1s)"
};
const DEC = { R_10: 3, R_25: 3, R_50: 4, R_75: 4, R_100: 2, "1HZ10V": 2, "1HZ15V": 3, "1HZ25V": 2, "1HZ30V": 3, "1HZ50V": 2, "1HZ75V": 2, "1HZ90V": 3, "1HZ100V": 2 };
const SYMS = Object.keys(NAMES);
const NET = { hbMs: 8000, healthMs: 5000, deadMs: 20000, reconMs: 3000, reconMax: 30000 };
const MAX_TICKS = 5200, QUOTE_TTL = 4500, SLIP = 0.03;
const TFS = { TICK: 0, "5S": 5, "15S": 15, "30S": 30, "1M": 60, "5M": 300 };
const SPAN = { TICK: 120, "5S": 420, "15S": 1200, "30S": 2400, "1M": 4800, "5M": 12000 };
let RF = { RISE: "CALL", FALL: "PUT" };   // verified against the proposal longcode and auto-corrected

const FACT = [["t5", "5M"], ["t1", "1M"], ["cross", "EMA"], ["srsi", "SRSI"], ["st", "ST"], ["xc", "X-CROSS"], ["zone", "ZONE"], ["zt", "Z-TRIG"], ["vol", "VOL"], ["chop", "CHOP"]];
const FACT_NAME = { t5: "5-minute trend", t1: "1-minute confirms", cross: "EMA cross", srsi: "StochRSI turn", st: "Supertrend agrees", xc: "EMA + ST double cross", zt: "Zone trigger", zone: "Zone room", vol: "Volatility band", chop: "Not choppy" };

/* ---------- PERSISTENCE ---------- */
const ls = {
    get(k, f) { try { const v = localStorage.getItem(k); return v == null ? f : JSON.parse(v); } catch { return f; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { } },
    del(k) { try { localStorage.removeItem(k); } catch { } }
};
const clone = o => JSON.parse(JSON.stringify(o));

/* ---------- INDICATOR PARAMS + SIGNAL PRESETS ---------- */
const P0 = { emaOn: true, ema: 21, zOn: true, zoneW: 1.5, zoneImp: 4, srOn: true, rsi: 14, stoch: 14, k: 3, d: 3, stOn: true, atr: 20, mul: 4, marks: true };
const P = Object.assign({}, P0, ls.get("pw3-p", {}));
const PRESETS = {
    SAFE: { req: { t5: 1, t1: 1, cross: 1, srsi: 1, st: 1, zone: 1, vol: 1, chop: 1 }, z5Min: 1.2, z1Min: 0.6, holdMin: 3, crossMin: 0.2, crossWin: 2, maxFlips: 2, volCap: 1.6, volMin: 0.5, zoneRoom: 1, srLow: 30, minQ: 70 },
    BALANCED: { req: { t5: 1, t1: 1, cross: 1, srsi: 0, st: 0, zone: 1, vol: 1, chop: 1 }, z5Min: 1, z1Min: 0.5, holdMin: 3, crossMin: 0.15, crossWin: 2, maxFlips: 3, volCap: 1.8, volMin: 0.5, zoneRoom: 1, srLow: 30, minQ: 55 },
    FAST: { req: { t5: 1, t1: 0, cross: 1, srsi: 0, st: 0, zone: 0, vol: 1, chop: 0 }, z5Min: 0.8, z1Min: 0.3, holdMin: 2, crossMin: 0.1, crossWin: 3, maxFlips: 4, volCap: 2.2, volMin: 0.4, zoneRoom: 0.8, srLow: 35, minQ: 0 }
};
Object.values(PRESETS).forEach(p => { p.req.xc = 0; p.req.zt = 0; });
const SIGKEYS = ["xWin", "z5Min", "z1Min", "holdMin", "crossMin", "crossWin", "maxFlips", "volCap", "volMin", "zoneRoom", "srLow", "minQ"];
const SG = Object.assign({ preset: "BALANCED", ...clone(PRESETS.BALANCED), auto: false, sound: true, trig: "CONF", rev: false, xWin: 12, zMode: "BOTH", cooldown: 10, maxTrades: 0, takeProfit: 20, maxLoss: -20, minPayout: 1.8, maxStakePct: 2, maxStakeAbs: 0 }, ls.get("pw3-sg", {}));
SG.req = Object.assign({}, PRESETS.BALANCED.req, SG.req); SG.auto = false;      // auto always starts OFF

/* ---------- STATE ---------- */
let A = ls.get("pw3-auth", null);            // { tok, exp }
const S = {
    ws: null, authed: false, connecting: false, byUser: false, attempt: 0, reconTimer: null, hb: null, health: null, lastMsg: 0,
    exec: ls.get("pw3-exec", "PAPER"), accounts: [], accountId: ls.get("pw3-acct", ""), acctType: "demo", cur: "USD", bal: 0, pending: new Map(), rid: 0,
    sym: null, ticks: [], subTick: null, gen: 0, pgen: 0,
    pp: { RISE: null, FALL: null }, ppSub: {}, armKey: "", armTimer: null, armLock: Promise.resolve(), armFails: 0, rfFixed: false,
    contract: null, paper: null, subCon: null, unconfirmedUntil: 0,
    rank: [], rankAt: 0, scanning: false, switching: false, want: null, busy: false, cool: 0, lastTick: 0, staleHits: 0,
    stake: Math.max(0.35, Number(ls.get("pw3-stake", 0.35)) || 0.35), dur: Math.min(10, Math.max(5, Number(ls.get("pw3-dur", 5)) || 5)),
    pl: 0, wins: 0, losses: 0, trades: 0, autoTrades: 0, ratio: 1.9, marks: [], hist: [], res: null, zones: [], zN: 0, sigOk: false, sigCool: 0, execMs: null, specs: {}, barUp: "", barDn: "", barBlock: 0, quoteBlock: 0, badTypeAt: 0, hlLegacy: false, cfFull: undefined, pip: {}, bar: 0, barKey: "", barMap: {}, cs: [], tn: 0, zmem: [], zev: null, amNext: 0, amBusy: false, amOut: 0
};
const V = { tf: "TICK", span: SPAN.TICK, off: 0, ys: 1, cx: null, ema: true, zones: true, sr: true, st: true };   // chart view
const D = { tool: "cursor", items: ls.get("pw3-draw", {}), tmp: null };                                           // drawings
let G = null, raf = 0, toastT = 0, flashT = 0, AC = null, rankTimer = 0;

/* ---------- HELPERS ---------- */
const $ = id => document.getElementById(id);
const set = (id, t) => { const e = $(id); if (e) e.textContent = t; };
const num = (v, f = 0) => { const n = Number(v); return Number.isFinite(n) ? n : f; };
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const round2 = v => Math.round(num(v) * 100) / 100;
const money = v => `${num(v) < 0 ? "-" : ""}$${Math.abs(num(v)).toFixed(2)}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const dec = () => S.pip?.[S.sym] ?? DEC[S.sym] ?? 2;
const wsOpen = () => Boolean(S.ws && S.ws.readyState === WebSocket.OPEN);
const ready = () => S.authed && wsOpen();
const inTrade = () => Boolean(S.contract || S.paper);
const stake = () => Math.max(0.35, round2(S.stake));
const dur = () => { const [a, b] = durLimits(O.mode, DM().u); return clamp(Math.floor(num(DM().v, a)), a, b); };
const std = a => {
    if (a.length < 2) return 0;
    const m = a.reduce((s, x) => s + x, 0) / a.length;
    return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
};
const deltas = T => T.slice(1).map((t, i) => t.q - T[i].q);
const lb = (T, e) => { let a = 0, b = T.length; while (a < b) { const m = (a + b) >> 1; if (T[m].e < e) a = m + 1; else b = m; } return a; };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function log(msg, lvl = "info") {
    console.log(`[PW ${lvl}]`, msg);
    const box = $("logBox"); if (!box) return;
    const row = document.createElement("div"); row.className = lvl;
    const t = document.createElement("span"); t.className = "t"; t.textContent = new Date().toLocaleTimeString([], { hour12: false });
    const m = document.createElement("span"); m.textContent = msg;
    row.append(t, m); box.appendChild(row);
    while (box.childElementCount > 400) box.removeChild(box.firstChild);
    box.scrollTop = box.scrollHeight;
}
function toast(msg, ms = 2600, cls = "") {
    const e = $("toast"); if (!e) return;
    e.textContent = msg; e.className = `toast show ${cls}`; clearTimeout(toastT);
    if (ms > 0) toastT = setTimeout(() => e.classList.remove("show"), ms);
}
function flash(txt, cls) {
    const e = $("flash"); e.textContent = txt; e.className = `flash show ${cls}`; clearTimeout(flashT);
    flashT = setTimeout(() => e.classList.remove("show"), 2200);
}
function beep(f = 880) {
    if (!SG.sound) return;
    try {
        AC = AC || new (window.AudioContext || window.webkitAudioContext)();
        const o = AC.createOscillator(), g = AC.createGain(); o.frequency.value = f; g.gain.value = 0.05;
        o.connect(g); g.connect(AC.destination); o.start(); o.stop(AC.currentTime + 0.12);
    } catch { }
}

/* ================================================================
   OAUTH 2.0  (Authorization Code + PKCE)
================================================================ */
const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const appId = () => String(CFG.APP_ID || ls.get("pw3-appid", "") || "").trim();
const redirectUri = () => CFG.REDIRECT_URI || (location.origin + location.pathname);
const tokenUrl = () => CFG.TOKEN_PROXY || String(ls.get("pw3-proxy", "") || "").trim() || CFG.TOKEN_URL;
const authValid = () => Boolean(A && A.tok && A.exp > Date.now() + 30000);

function loginMsg(t, ok = false) { const e = $("liMsg"); e.textContent = t || ""; e.className = `li-msg${ok ? " ok" : ""}`; }
function showLogin(msg) {
    $("loginCard").hidden = false;
    $("liAppWrap").hidden = Boolean(CFG.APP_ID);
    $("liApp").value = ls.get("pw3-appid", "") || "";
    $("liProxy").value = ls.get("pw3-proxy", "") || "";
    $("liRedirect").textContent = redirectUri();
    $("liFile").hidden = location.protocol !== "file:";
    $("logoutBtn").hidden = true;
    loginMsg(msg || "");
}
function hideLogin() { $("loginCard").hidden = true; $("logoutBtn").hidden = false; }
async function oauthLogin() {
    const typed = $("liApp").value.trim(); if (!CFG.APP_ID && typed) ls.set("pw3-appid", typed);
    const px = $("liProxy").value.trim(); if (px) ls.set("pw3-proxy", px); else ls.del("pw3-proxy");
    const id = appId();
    if (!id) return loginMsg("Enter your Deriv App ID first.");
    if (location.protocol === "file:") return loginMsg("OAuth needs this page served over http(s) — see the note below.");
    if (!window.crypto?.subtle) return loginMsg("Secure context required (https or localhost) for PKCE.");
    try {
        const v = b64u(crypto.getRandomValues(new Uint8Array(32)));
        const c = b64u(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v)));
        const st = b64u(crypto.getRandomValues(new Uint8Array(16)));
        sessionStorage.setItem("pw3-pkce", JSON.stringify({ v, st, ru: redirectUri() }));
        const u = new URL(CFG.AUTH_URL);
        Object.entries({ response_type: "code", client_id: id, redirect_uri: redirectUri(), scope: CFG.SCOPE, state: st, code_challenge: c, code_challenge_method: "S256" })
            .forEach(([k, x]) => u.searchParams.set(k, x));
        location.assign(u.toString());
    } catch (e) { loginMsg(`Could not start login → ${e.message}`); }
}
async function oauthCallback() {
    const q = new URLSearchParams(location.search);
    if (!q.has("code") && !q.has("error")) return false;
    const code = q.get("code"), st = q.get("state"), err = q.get("error");
    history.replaceState(null, "", location.pathname + location.hash);
    let saved = null; try { saved = JSON.parse(sessionStorage.getItem("pw3-pkce") || "null"); } catch { }
    sessionStorage.removeItem("pw3-pkce");
    try {
        if (err) throw new Error(q.get("error_description") || err);
        if (!saved || saved.st !== st) throw new Error("Login state mismatch — please try again.");
        showLogin("Finishing sign-in…"); loginMsg("Finishing sign-in…", true);
        const body = new URLSearchParams({ grant_type: "authorization_code", client_id: appId(), code, redirect_uri: saved.ru, code_verifier: saved.v });
        let r;
        try { r = await fetch(tokenUrl(), { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body }); }
        catch (e) { throw new Error("The browser blocked the token request (CORS). Deriv expects this exchange on a backend — run token-proxy.js and put its URL under Advanced."); }
        const d = await r.json().catch(() => ({}));
        if (!r.ok || !d.access_token) throw new Error(d.error_description || d.error || `Token exchange failed (${r.status}).`);
        A = { tok: d.access_token, exp: Date.now() + num(d.expires_in, 3600) * 1000 }; ls.set("pw3-auth", A);
        log("Signed in with Deriv OAuth.", "win");
        return true;
    } catch (e) { showLogin(e.message); return false; }
}
function logout() {
    A = null; ls.del("pw3-auth"); closeSocket(); S.accounts = []; buildAcctSel();
    showLogin("Signed out."); log("Signed out.");
}

/* ================================================================
   INDICATORS (per tick, incremental)
================================================================ */
function calcInd(T, i) {
    const t = T[i], p = i ? T[i - 1] : null, q = t.q, kE = 2 / (Math.max(2, P.ema) + 1);
    t.m = p ? p.m + kE * (q - p.m) : q;                                                             // EMA
    const ch = p ? q - p.q : 0, g = ch > 0 ? ch : 0, l = ch < 0 ? -ch : 0, rl = Math.max(2, P.rsi);   // Wilder RSI
    if (!p) { t.ag = 0; t.al = 0; }
    else if (i < rl) { t.ag = (p.ag * (i - 1) + g) / i; t.al = (p.al * (i - 1) + l) / i; }
    else { t.ag = (p.ag * (rl - 1) + g) / rl; t.al = (p.al * (rl - 1) + l) / rl; }
    t.rsi = !p ? 50 : t.al === 0 ? (t.ag === 0 ? 50 : 100) : 100 - 100 / (1 + t.ag / t.al);
    let lo = t.rsi, hi = t.rsi;                                                                      // Stochastic of RSI
    for (let j = Math.max(0, i - Math.max(2, P.stoch) + 1); j < i; j++) { const v = T[j].rsi; if (v < lo) lo = v; if (v > hi) hi = v; }
    t.raw = hi > lo ? (t.rsi - lo) / (hi - lo) * 100 : 50;
    let s = 0, c = 0;
    for (let j = Math.max(0, i - Math.max(1, P.k) + 1); j <= i; j++) { s += T[j].raw; c++; }
    t.k = s / c; s = 0; c = 0;
    for (let j = Math.max(0, i - Math.max(1, P.d) + 1); j <= i; j++) { s += T[j].k; c++; }
    t.dd = s / c;
    const tr = p ? Math.abs(q - p.q) : 0, al = Math.max(2, P.atr);                                    // Supertrend (ATR of tick moves)
    t.atr = !p ? 0 : i < al ? (p.atr * (i - 1) + tr) / i : (p.atr * (al - 1) + tr) / al;
    const ub = q + P.mul * t.atr, lw = q - P.mul * t.atr;
    if (!p) { t.fub = ub; t.flb = lw; t.sdir = 1; }
    else {
        t.fub = (ub < p.fub || p.q > p.fub) ? ub : p.fub;
        t.flb = (lw > p.flb || p.q < p.flb) ? lw : p.flb;
        t.sdir = p.sdir === 1 ? (q < t.flb ? -1 : 1) : (q > t.fub ? 1 : -1);
    }
    t.st = t.sdir === 1 ? t.flb : t.fub;
}
const buildInd = T => { for (let i = 0; i < T.length; i++) calcInd(T, i); };

/* ================================================================
   ANALYSIS  (trend · EMA cross · StochRSI · Supertrend · zones · vol · chop)
================================================================ */
// z = net move / (tick-σ · √ticks): how statistically significant the drift is
function frameStats(T, sec) {
    if (T.length < 10) return null;
    const f = T.slice(lb(T, T[T.length - 1].e - sec));
    if (f.length < 10) return null;
    const d = deltas(f), s = std(d);
    if (!s) return null;
    const net = f[f.length - 1].q - f[0].q;
    return { z: net / (s * Math.sqrt(d.length)), net, sigma: s };
}
/* Supply / demand: confirmed swing highs/lows followed by a sharp impulse away and never broken since */
function findZones(T) {
    const W = 8, N = T.length;
    if (N < W * 4) return [];
    const Ar = T.slice(Math.max(0, N - 1500)), n = Ar.length, sig = std(deltas(Ar.slice(-300)));
    if (!sig) return [];
    const imp = P.zoneImp * sig, wid = P.zoneW * sig, out = [];
    for (let i = W; i < n - W; i++) {
        const q = Ar[i].q; let hi = true, lo = true;
        for (let j = i - W; j <= i + W; j++) {
            if (j === i) continue;
            const v = Ar[j].q;
            if (v > q || (j < i && v === q)) hi = false;
            if (v < q || (j < i && v === q)) lo = false;
            if (!hi && !lo) break;
        }
        if (!hi && !lo) continue;
        const end = Math.min(n, i + W * 3); let ext = q, brk = false;
        if (hi) {
            for (let j = i + 1; j < end; j++) ext = Math.min(ext, Ar[j].q);
            for (let j = i + 1; j < n; j++) if (Ar[j].q > q + 0.25 * sig) { brk = true; break; }
            if (!brk && q - ext >= imp) out.push({ t: "S", hi: q, lo: q - wid, e0: Ar[i].e });
        } else {
            for (let j = i + 1; j < end; j++) ext = Math.max(ext, Ar[j].q);
            for (let j = i + 1; j < n; j++) if (Ar[j].q < q - 0.25 * sig) { brk = true; break; }
            if (!brk && ext - q >= imp) out.push({ t: "D", hi: q + wid, lo: q, e0: Ar[i].e });
        }
    }
    const px = Ar[n - 1].q;
    const pick = t => {
        const kept = [];
        out.filter(z => z.t === t).sort((a, b) => b.e0 - a.e0).forEach(z => { if (!kept.some(k => Math.abs(k.hi - z.hi) < wid)) kept.push(z); });
        return kept.sort((a, b) => Math.abs((a.t === "S" ? a.lo : a.hi) - px) - Math.abs((b.t === "S" ? b.lo : b.hi) - px)).slice(0, 3);
    };
    return [...pick("S"), ...pick("D")];
}
function zoneCheck(Z, dir, p, sig) {
    const need = sig * Math.sqrt(durTicks()) * SG.zoneRoom;
    const inDem = Z.some(z => z.t === "D" && p >= z.lo && p <= z.hi), inSup = Z.some(z => z.t === "S" && p >= z.lo && p <= z.hi);
    const side = dir > 0 ? "S" : "D";
    if (dir > 0 ? inSup : inDem) return { ok: false, txt: dir > 0 ? "in supply" : "in demand", d: 0 };
    let d = Infinity;
    for (const z of Z) if (z.t === side) { const x = dir > 0 ? z.lo - p : p - z.hi; if (x > 0) d = Math.min(d, x); }
    if (d < need) return { ok: false, txt: `${side === "S" ? "supply" : "demand"} ${(d / sig).toFixed(1)}σ`, d };
    const bonus = dir > 0 ? inDem : inSup;
    return { ok: true, bonus, txt: bonus ? (dir > 0 ? "in demand ✓" : "in supply ✓") : d === Infinity ? "clear" : `room ${(d / sig).toFixed(0)}σ`, d };
}
function dualCross(C, win) {            // price crosses EMA *and* Supertrend the same way within `win` bars
    const L = C.length - 1; if (L < win + 3) return null;
    let ce = -1, cd = 0, cs = -1, sd = 0;
    for (let i = 0; i <= win && i + 1 <= L; i++) {
        const a = C[L - i], b = C[L - i - 1];
        if (ce < 0 && (a.q > a.m) !== (b.q > b.m)) { ce = i; cd = a.q > a.m ? 1 : -1; }
        if (cs < 0 && a.sdir !== b.sdir) { cs = i; sd = a.sdir; }
    }
    if (ce < 0 || cs < 0 || cd !== sd) return null;
    const c = C[L]; if ((c.q > c.m ? 1 : -1) !== cd || c.sdir !== cd) return null;
    return { dir: cd, age: Math.max(ce, cs) };
}
function memZones(zs) {
    zs.forEach(z => {
        const k = z.t + z.e0, m = S.zmem.find(x => x.k === k);
        if (m) { m.hi = z.hi; m.lo = z.lo; m.seen = S.tn; } else S.zmem.push({ k, t: z.t, hi: z.hi, lo: z.lo, seen: S.tn, cool: 0, dead: false });
    });
    S.zmem = S.zmem.filter(z => S.tn - z.seen < 400).slice(-16);
}
function zoneScan(pq, q) {             // fresh zone events: TOUCH (enter a zone) / BREAK (pierce it)
    if (!P.zOn || SG.zMode === "OFF" || !S.zmem.length) return;
    const tch = SG.zMode === "TOUCH" || SG.zMode === "BOTH", brk = SG.zMode === "BREAK" || SG.zMode === "BOTH";
    for (const z of S.zmem) {
        if (z.dead || S.tn < z.cool) continue;
        let ev = null;
        if (z.t === "D") {
            if (brk && pq >= z.lo && q < z.lo) ev = { dir: -1, k: "break demand" };
            else if (tch && pq > z.hi && q <= z.hi) ev = { dir: 1, k: "touch demand" };
        } else {
            if (brk && pq <= z.hi && q > z.hi) ev = { dir: 1, k: "break supply" };
            else if (tch && pq < z.lo && q >= z.lo) ev = { dir: -1, k: "touch supply" };
        }
        if (ev) { S.zev = { dir: ev.dir, k: ev.k, n: S.tn }; z.cool = S.tn + 15; if (ev.k.startsWith("break")) z.dead = true; }
    }
}
function analyze(T, Z, C = T, live = true) {
    const n = T.length; if (n < 70) return null;
    const f5 = frameStats(T, 300), f1 = frameStats(T, 60); if (!f5 || !f1) return null;
    const Dl = deltas(T.slice(-130)), sig = std(Dl.slice(-60)); if (!sig) return null;
    const vol = std(Dl.slice(-20)) / (std(Dl) || 1);
    const cw = C === T || C.length >= 30, L = C.length - 1;               // cw: enough bars on the viewed timeframe
    const sigC = C === T ? sig : (std(deltas(C.slice(-60))) || sig);
    const xc = cw ? dualCross(C, SG.xWin) : null;
    const zev = live && S.zev && S.tn - S.zev.n <= 3 ? S.zev : null;
    const a5 = f5.z >= 0 ? 1 : -1, dir = SG.trig === "XCROSS" && xc ? xc.dir : a5;
    const q = i => C[L - i].q, m = i => C[L - i].m, side = i => dir * (q(i) - m(i)), K = i => C[L - i].k, Dd = i => C[L - i].dd;
    let age = -1;
    for (let i = 0; i < SG.crossWin && i + 1 <= L; i++) if (side(i) > 0 && side(i + 1) <= 0) { age = i; break; }
    let hold = 0; if (age >= 0) for (let i = age + 1; i <= age + 12 && i <= L; i++) { if (side(i) <= 0) hold++; else break; }
    const strength = side(0), slope = dir * (m(0) - m(Math.min(5, L))), crossed = age >= 0 && side(0) > 0;
    let flips = 0; for (let i = 0; i < 30 && i + 1 <= L; i++) if ((q(i) > m(i)) !== (q(i + 1) > m(i + 1))) flips++;
    let ext = dir > 0 ? 100 : 0, turn = false;
    for (let i = 0; i <= 10 && i <= L; i++) ext = dir > 0 ? Math.min(ext, K(i)) : Math.max(ext, K(i));
    for (let i = 0; i < 4 && i + 1 <= L; i++) if (dir * (K(i) - Dd(i)) > 0 && dir * (K(i + 1) - Dd(i + 1)) <= 0) { turn = true; break; }
    const inZone = dir > 0 ? ext <= SG.srLow : ext >= 100 - SG.srLow, srOk = cw && turn && inZone;
    const stOk = cw && C[L].sdir === dir;
    const zc = P.zOn ? zoneCheck(Z, dir, T[n - 1].q, sig) : { ok: true, txt: "off" };
    const volOk = vol <= SG.volCap && vol >= SG.volMin;
    const z5 = Math.abs(f5.z), t1ok = Math.sign(f1.z) === dir, xOk = Boolean(xc && xc.dir === dir), zOk = Boolean(zev && zev.dir === dir);
    const rows = [
        { id: "t5", pass: a5 === dir && z5 >= SG.z5Min, val: `${f5.z >= 0 ? "▲" : "▼"} z ${f5.z.toFixed(2)}`, w: 0.22, c: a5 === dir ? Math.min(z5 / 2.5, 1) : 0 },
        { id: "t1", pass: t1ok && Math.abs(f1.z) >= SG.z1Min, val: `z ${f1.z.toFixed(2)}`, w: 0.12, c: t1ok ? Math.min(Math.abs(f1.z) / 1.5, 1) : 0 },
        {
            id: "cross", pass: cw && crossed && hold >= SG.holdMin && strength >= SG.crossMin * sigC && slope >= 0,
            val: crossed ? `${age}b ago · ${hold}b ${dir > 0 ? "below" : "above"}` : side(0) > 0 ? "riding EMA" : "pullback", w: 0.18,
            c: crossed ? Math.min(1, 0.6 + strength / (sigC * 0.8) * 0.4) : side(0) > 0 ? 0.45 : side(0) > -3 * sigC ? 0.55 : 0.2
        },
        { id: "srsi", off: !P.srOn, pass: !P.srOn || srOk, val: P.srOn ? `K ${K(0).toFixed(0)}` : "off", w: 0.12, c: srOk ? 1 : inZone ? 0.55 : 0.25 },
        { id: "st", off: !P.stOn, pass: !P.stOn || stOk, val: P.stOn ? (C[L].sdir > 0 ? "▲ up" : "▼ down") : "off", w: 0.08, c: stOk ? 1 : 0 },
        { id: "xc", off: !(SG.req.xc || SG.trig === "XCROSS"), pass: xOk, val: xc ? `${xc.dir > 0 ? "▲" : "▼"} ${xc.age}b ago` : "none", w: 0.12, c: xOk ? 1 : 0 },
        { id: "zone", off: !P.zOn, pass: zc.ok, val: zc.txt, w: 0.12, c: zc.ok ? (zc.bonus ? 1 : 0.7) : 0 },
        { id: "zt", off: !P.zOn || !(SG.req.zt || SG.trig === "ZONE"), pass: zOk, val: zev ? zev.k : "none", w: 0.12, c: zOk ? 1 : 0 },
        { id: "vol", pass: volOk, val: vol.toFixed(2), w: 0.08, c: volOk ? (vol >= 0.7 && vol <= 1.4 ? 1 : 0.6) : 0 },
        { id: "chop", pass: flips <= SG.maxFlips, val: `${flips} flips`, w: 0.08, c: flips <= 1 ? 1 : flips <= SG.maxFlips ? 0.6 : 0 }
    ];
    let sw = 0, sc = 0; rows.forEach(r => { if (!r.off) { sw += r.w; sc += r.w * r.c; } });
    const score = Math.round(100 * sc / (sw || 1)), act = rows.filter(r => !r.off);
    const need = r => SG.req[r.id] || (r.id === "xc" && SG.trig === "XCROSS") || (r.id === "zt" && SG.trig === "ZONE");
    const ok = !(SG.trig === "ZONE" && !P.zOn) && act.every(r => !need(r) || r.pass) && score >= SG.minQ;
    return { dir, f5, f1, sig, vol, rows, score, ok, passed: act.filter(r => r.pass).length, total: act.length, crossed, flips, k: K(0), dd: Dd(0), sdir: C[L].sdir, zoneTxt: zc.txt, zoneOk: zc.ok, xc, zev };
}

/* ================================================================
   WEBSOCKET CORE
================================================================ */
function sendWS(payload, { timeout = 10000, type = "request" } = {}) {
    if (!wsOpen()) return Promise.reject(new Error("WebSocket unavailable."));
    S.rid = S.rid >= 2147483000 ? 1 : S.rid + 1;
    const id = (payload.req_id = S.rid);
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { if (S.pending.delete(id)) reject(new Error(`${type} timed out.`)); }, timeout);
        S.pending.set(id, { resolve, reject, timer });
        try { S.ws.send(JSON.stringify(payload)); } catch (e) { clearTimeout(timer); S.pending.delete(id); reject(e); }
    });
}
function rejectAll(reason) { for (const p of S.pending.values()) { clearTimeout(p.timer); p.reject(new Error(reason)); } S.pending.clear(); }
function onMsg(raw) {
    S.lastMsg = Date.now();
    let m; try { m = JSON.parse(raw); } catch { return; }
    const p = S.pending.get(m.req_id);        // settle BEFORE routing: subscribe replies are also stream messages
    if (p) {
        clearTimeout(p.timer); S.pending.delete(m.req_id);
        m.error ? p.reject(Object.assign(new Error(m.error.message || "Deriv request failed."), { code: m.error.code })) : p.resolve(m);
    }
    if (m.error) return void log(`Deriv error [${m.error.code || "?"}] ${m.error.message || ""}`, "error");
    ({ tick: onTick, proposal: onProposal, proposal_open_contract: onContract, balance: onBalance })[m.msg_type]?.(m);
}
async function forget(id) { if (id && wsOpen()) try { await sendWS({ forget: id }, { timeout: 5000, type: "forget" }); } catch { } }
async function dropTick() { const id = S.subTick; S.subTick = null; await forget(id); }
function onBalance(m) {
    const b = num(m.balance?.balance, NaN);
    if (Number.isFinite(b)) S.bal = b;
    if (m.balance?.currency) S.cur = m.balance.currency;
    ui();
}

/* ================================================================
   MARKET DATA
================================================================ */
async function fetchHistory(sym, tries = 3, count = 600) {
    for (let i = 0; i < tries; i++) {
        try {
            const r = await sendWS({ ticks_history: sym, count, end: "latest", style: "ticks" }, { timeout: 15000, type: `history ${sym}` });
            const p = r.history?.prices || [], t = r.history?.times || [];
            return p.map((x, k) => ({ q: Number(x), e: Number(t[k]) })).filter(x => Number.isFinite(x.q) && Number.isFinite(x.e));
        } catch (e) { if (i === tries - 1 || !wsOpen()) throw e; await sleep(400 * (i + 1)); }
    }
}
/* Serialised market switching: ONE switch at a time, latest request wins — chart, ranking and reconnects never clash */
async function useMarket(sym, force = false) {
    if (!sym || !ready() || inTrade() || S.busy) return false;
    if (S.switching) { S.want = { sym, force }; return false; }
    S.switching = true; manualUI();
    let ok = false;
    try { let job = { sym, force }; while (job) { S.want = null; ok = await loadMarket(job.sym, job.force); job = S.want; } }
    finally { S.switching = false; manualUI(); armSoon(); }
    return ok;
}
async function loadMarket(sym, force) {
    if (!force && sym === S.sym && S.subTick) return true;
    const g = ++S.gen; S.lastTick = Date.now();
    S.quoteBlock = 0; await disarm(); await dropTick();
    let T = [];
    try { T = await fetchHistory(sym, 3, 5000); } catch (e) { log(`History ${sym} failed → ${e.message}`, "warn"); }
    if (g !== S.gen) return false;
    buildInd(T);
    S.ticks = T; S.sym = sym; S.marks = []; S.res = null; S.zN = 0; S.sigOk = false; D.tmp = null; V.off = 0;
    S.zones = P.zOn ? findZones(T) : [];
    S.zmem = []; S.zev = null; rebuildCS(); memZones(S.zones); S.res = analyze(T, S.zones, TFS[V.tf] ? S.cs : undefined);
    ls.set("pw3-sym", sym);
    set("symName", `${sym} · ${NAMES[sym]}`);
    try {
        const r = await sendWS({ ticks: sym, subscribe: 1 }, { timeout: 7000, type: `ticks ${sym}` });
        const id = r?.subscription?.id || null;
        if (g !== S.gen) { await forget(id); return false; }
        S.subTick = id; log(`Streaming ${sym} (${T.length} ticks loaded)`);
        loadSpecs(sym).then(() => { if (S.sym === sym) { renderOpt(); armSoon(); } }).catch(() => { });
        renderRank(); renderHud(); redraw();
        return true;
    } catch (e) { log(`Tick subscription failed → ${e.message}`, "error"); return false; }
}
function onTick(m) {
    const t = m.tick;
    if (!t || t.symbol !== S.sym) return;
    const q = Number(t.quote), e = Number(t.epoch);
    if (t.pip_size != null) { const pz = Number(t.pip_size); if (Number.isFinite(pz) && pz > 0) S.pip[t.symbol] = pz >= 1 ? Math.round(pz) : Math.round(-Math.log10(pz)); }
    if (!Number.isFinite(q) || !Number.isFinite(e)) return;
    const T = S.ticks, last = T[T.length - 1];
    if (last && e <= last.e) return;
    const pq = last ? last.q : q; T.push({ q, e }); calcInd(T, T.length - 1); S.tn++; updateCS(T[T.length - 1]);
    if (T.length > MAX_TICKS) T.shift();
    S.lastTick = Date.now(); S.staleHits = 0;
    if (P.zOn && ++S.zN % 5 === 1) { S.zones = findZones(T); memZones(S.zones); }
    zoneScan(pq, q);
    S.res = analyze(T.length > 900 ? T.slice(-900) : T, S.zones, TFS[V.tf] ? S.cs : undefined);
    if (S.paper) paperTick(q, e);
    checkSignal(S.res);
    renderHud(); redraw();
}

/* ---------- scan + ranking ---------- */
async function scan(reason = "manual") {
    if (!ready() || S.scanning) return null;
    S.scanning = true; $("scanBtn").textContent = "SCANNING…"; $("scanBtn").disabled = true;
    try {
        log(`Scanning ${SYMS.length} markets (${reason})…`);
        const out = []; let i = 0;
        await Promise.all([0, 1, 2].map(async () => {
            while (i < SYMS.length) {
                const s = SYMS[i++];
                try {
                    const T = await fetchHistory(s, 2, 600); buildInd(T);
                    const a = analyze(T, P.zOn ? findZones(T) : [], undefined, false);
                    if (a) out.push({ sym: s, bias: a.dir > 0 ? "RISE" : "FALL", z5: a.f5.z, z1: a.f1.z, vol: a.vol, flips: a.flips, sdir: a.sdir, k: a.k, zone: a.zoneTxt, zoneOk: a.zoneOk, score: a.score, sigma: a.sig });
                } catch (e) { log(`${s} history failed → ${e.message}`, "warn"); }
            }
        }));
        out.sort((a, b) => b.score - a.score);
        S.rank = out; S.rankAt = Date.now(); renderRank();
        if (out[0]) log(`Best market → ${out[0].sym} ${out[0].bias} (score ${out[0].score})`);
        return out[0] || null;
    } finally { S.scanning = false; $("scanBtn").textContent = "SCAN"; $("scanBtn").disabled = false; }
}
function renderRank() {
    const b = $("rankRows"); if (!b) return;
    b.innerHTML = "";
    set("rankTime", S.rankAt ? new Date(S.rankAt).toLocaleTimeString([], { hour12: false }) : "not scanned");
    const ranked = new Set(S.rank.map(r => r.sym)), cell = (tr, v, cls = "") => { const td = document.createElement("td"); td.textContent = v; if (cls) td.className = cls; tr.appendChild(td); return td; };
    const rows = [...S.rank, ...SYMS.filter(s => !ranked.has(s)).map(s => ({ sym: s, none: true }))];
    rows.forEach((r, i) => {
        const tr = document.createElement("tr"); if (r.sym === S.sym) tr.className = "sel";
        cell(tr, r.none ? "·" : i + 1, "mut");
        const td = cell(tr, r.sym); const sm = document.createElement("small"); sm.textContent = NAMES[r.sym].replace("Volatility ", "V"); td.appendChild(sm);
        if (r.none) { for (let k = 0; k < 8; k++) cell(tr, "—", "mut"); }
        else {
            cell(tr, r.bias === "RISE" ? "▲ RISE" : "▼ FALL", r.bias === "RISE" ? "up" : "dn");
            cell(tr, r.z5.toFixed(2)); cell(tr, r.z1.toFixed(2));
            cell(tr, r.vol.toFixed(2), r.vol <= SG.volCap && r.vol >= SG.volMin ? "" : "am");
            cell(tr, String(r.flips), r.flips <= SG.maxFlips ? "" : "am");
            cell(tr, r.sdir > 0 ? "▲" : "▼", r.sdir > 0 ? "up" : "dn");
            cell(tr, r.k.toFixed(0));
            cell(tr, r.zone, r.zoneOk ? "" : "am");
            const sc = document.createElement("td"), w = document.createElement("div"); w.className = "sc";
            const bar = document.createElement("i"); bar.style.width = `${r.score * 0.7}px`; const v = document.createElement("b"); v.textContent = r.score;
            w.append(bar, v); sc.appendChild(w); tr.appendChild(sc);
        }
        tr.onclick = () => pickSymbol(r.sym);
        b.appendChild(tr);
    });
}
async function pickSymbol(sym) {
    if (inTrade() || S.busy) return void toast("Market is locked while a trade is running.", 2200, "bad");
    if (!ready()) return void toast("Connect first.", 2000, "bad");
    $("rankP").hidden = true; clearInterval(rankTimer);
    const ok = await useMarket(sym);
    if (!ok && S.sym !== sym) log("Market switch queued / refused — try again if it did not change.", "warn");
}
function openRank() {
    const p = $("rankP"); p.hidden = !p.hidden; clearInterval(rankTimer);
    if (p.hidden) return;
    renderRank();
    if (ready() && Date.now() - S.rankAt > 60000) scan("ranking opened");
    rankTimer = setInterval(() => { if ($("rankAuto").checked && !p.hidden && ready() && !S.scanning) scan("refresh"); }, 60000);
}

/* ================================================================
   QUOTES (pre-armed for speed)
================================================================ */
function sideMatches(longcode, dir) {
    const L = String(longcode || "").toLowerCase(), up = /higher|rise|above/.test(L), dn = /lower|fall|below/.test(L);
    return up === dn ? null : dir === "RISE" ? up : dn;
}
function fixRF() {
    if (S.rfFixed) return;
    S.rfFixed = true; RF = { RISE: RF.FALL, FALL: RF.RISE };
    log(`Rise/Fall mapping corrected → RISE=${RF.RISE}, FALL=${RF.FALL}`, "warn"); armSoon();
}
function onProposal(m) {
    const p = m.proposal, pt = m.echo_req?.passthrough;
    if (!p || !pt || pt.g !== S.pgen) return;
    const side = pt.side;
    if (side !== "RISE" && side !== "FALL") return;
    if ((O.mode === "RF" || O.mode === "HL") && sideMatches(p.longcode, side) === false) { if (O.mode === "RF") fixRF(); return; }
    const ask = Number(p.ask_price), payout = Number(p.payout);
    if (!p.id || !(ask > 0) || ((O.mode === "RF" || O.mode === "HL") && !(payout > 0))) return;
    S.pp[side] = { id: String(p.id), ask, payout: payout > 0 ? payout : 0, ratio: payout > 0 ? payout / ask : NaN, at: Date.now(), stake: num(m.echo_req.amount), dir: side };
    manualUI();
}
const fresh = (dir, st) => { const p = S.pp[dir]; return p && Math.abs(p.stake - st) < 0.001 && Date.now() - p.at < QUOTE_TTL ? p : null; };
function armSoon(ms = 120) { clearTimeout(S.armTimer); S.armTimer = setTimeout(() => { S.armLock = S.armLock.then(syncArm).catch(() => { }); }, ms); }
async function disarm() {
    S.pgen++; const subs = Object.values(S.ppSub);
    S.ppSub = {}; S.pp = { RISE: null, FALL: null }; S.armKey = "";
    await Promise.all(subs.map(forget));
}
async function syncArm() {
    const can = () => ready() && S.sym && S.subTick && !inTrade() && !S.busy && !S.switching;
    if (!can()) { if (S.armKey || Object.keys(S.ppSub).length) await disarm(); manualUI(); return; }
    const st = stake();
    if (Date.now() < S.quoteBlock) return;
    if (O.mode === "MU") fixMult();
    if (O.mode === "HL") {
        if (Date.now() < S.barBlock) return; try { await ensureBar(st); S.armFails = 0; }
        catch (e) { S.barBlock = Date.now() + 15000; if (S.armFails++ < 3) { log(`Barrier solve failed → ${e.message}`, "warn"); toast(`Barrier: ${e.message}`, 3000, "bad"); } manualUI(); return; }
        if (!can()) return;
    }
    const key = qKey(st);
    if (key === S.armKey) return;
    await disarm();
    S.armKey = key; const g = ++S.pgen;
    await Promise.all(["RISE", "FALL"].map(async side => {
        let rq = null;
        try {
            const r = await sendWS(Object.assign(rq = propReq(side, st), { subscribe: 1, passthrough: { side, g } }), { timeout: 7000, type: "quote" });
            const id = r.subscription?.id || null;
            if (g !== S.pgen) return void (await forget(id));
            S.ppSub[side] = id; S.armFails = 0;
        } catch (e) {
            if (g === S.pgen) quoteFail(side, e, rq);
        }
    }));
    manualUI();
}
async function oneShot(dir, st, retry = true) {          // fallback: single quote when no fresh pre-armed one exists
    if (O.mode === "HL") await ensureBar(st);
    const r = await sendWS(Object.assign(propReq(dir, st), { subscribe: 1, passthrough: { side: dir, g: -1 } }), { timeout: 5000, type: "quote" });   // new API: only streaming proposal ids can be bought
    if (r.subscription?.id) setTimeout(() => forget(r.subscription.id), 8000);
    const p = r.proposal;
    if (!p?.id) throw new Error("Proposal ID missing.");
    const rfhl = O.mode === "RF" || O.mode === "HL";
    if (rfhl && sideMatches(p.longcode, dir) === false) {              // safety: never trade the opposite side
        if (!retry || O.mode !== "RF") throw new Error("Contract side does not match the signal.");
        S.rfFixed = true; RF = { RISE: RF.FALL, FALL: RF.RISE };
        log(`Rise/Fall mapping corrected → RISE=${RF.RISE}, FALL=${RF.FALL}`, "warn");
        return oneShot(dir, st, false);
    }
    const ask = Number(p.ask_price), payout = Number(p.payout);
    if (!(ask > 0) || (rfhl && !(payout > 0))) throw new Error("Invalid proposal price.");
    return { id: String(p.id), ask, payout: payout > 0 ? payout : 0, ratio: payout > 0 ? payout / ask : NaN, at: Date.now(), stake: st, dir };
}

/* ================================================================
   EXECUTION  (manual click and auto entry share ONE gate)
================================================================ */
async function execute(dir, src, res) {
    if (S.busy || inTrade() || S.switching || !ready() || !S.sym) return false;
    S.busy = true;
    const t0 = performance.now(), st = stake(), last = S.ticks[S.ticks.length - 1];
    manualUI();
    log(src === "auto" ? `AUTO ${dir} · ${S.sym} · Q ${res.score} · 5m z ${res.f5.z.toFixed(2)} · 1m z ${res.f1.z.toFixed(2)}` : `MANUAL ${dir} · ${S.sym}`, "trade");
    try {
        if (S.exec === "LIVE" && st > riskCap() + 0.001) throw new Error(`Stake ${money(st)} is above your risk cap ${money(riskCap())} (Signals → Max stake). Lower the stake or raise the cap.`);
        if (S.exec === "PAPER" && O.mode === "VN") throw new Error("Vanillas cannot be paper-simulated — use LIVE on a demo account.");
        const p = fresh(dir, st) || await oneShot(dir, st);
        if (S.exec === "LIVE" && p.ask > riskCap() * 1.05 + 0.01) throw new Error(`Buy price ${money(p.ask)} (stake + commission) exceeds your risk cap ${money(riskCap())}.`);
        if (src === "auto" && minPayFail(p)) {
            log(`Payout ${p.ratio.toFixed(2)}x below minimum — skipped.`, "warn");
            S.busy = false; S.cool = Date.now() + 3000; manualUI(); return false;
        }
        if (last) S.marks.push({ k: "buy", e: last.e, q: last.q, dir });
        if (S.exec === "PAPER") { startPaper(dir, p, src); disarm(); }
        else {
            try { await buy(p, src); }
            catch (e) {
                if (S.unconfirmedUntil || /timed out|closed|unavailable/i.test(e.message)) throw e;
                log("Quote moved — retrying once on a fresh quote.", "warn");
                await buy(await oneShot(dir, st), src);
            }
            disarm();
        }
        S.execMs = Math.round(performance.now() - t0); log(`Executed in ${S.execMs} ms`); ui();
        return true;
    } catch (e) {
        log(`Execution failed → ${e.message}`, "error"); toast(`Not executed: ${e.message}`, 3000, "bad");
        if (!inTrade() && !S.unconfirmedUntil) { S.busy = false; S.cool = Date.now() + 2000; }
        armSoon(); manualUI();
        return false;
    }
}
async function buy(p, src) {
    log(`BUY ${p.dir} · ${S.sym} · ${money(p.ask)}`, "trade");
    let r;
    try { r = await sendWS({ buy: p.id, price: Math.ceil(p.ask * (1 + SLIP) * 100) / 100, subscribe: 1 }, { timeout: 7000, type: "buy" }); }
    catch (e) {
        if (/timed out|closed|unavailable/i.test(e.message)) { S.unconfirmedUntil = Date.now() + 30000; log("BUY unconfirmed — trading paused 30s; check your Deriv statement.", "warn"); }
        throw e;
    }
    const id = Number(r.buy?.contract_id);
    if (!Number.isInteger(id) || id <= 0) throw new Error(`Invalid contract_id: ${r.buy?.contract_id}`);
    S.contract = { id, dir: p.dir, src, stake: num(r.buy.buy_price, p.ask), payout: num(r.buy.payout, p.payout), entry: NaN, ee: NaN, profit: 0, ticks: 0, status: "open", done: false, mode: O.mode, tk: O.mode !== "MU" && DM().u === "t" ? dur() : 0, secs: durSec(), mult: O.mult, ds: NaN, de: NaN, closing: false };
    S.subCon = r.subscription?.id || null;        // contract stream requested inside the BUY itself
    if (S.contract.payout > 0) S.ratio = S.contract.payout / S.contract.stake; S.trades++;
    log(`BUY ACCEPTED → contract ${id}`, "trade");
    contractUI(); ui();
}
async function subscribeContract() {
    const c = S.contract; if (!c) return;
    const r = await sendWS({ proposal_open_contract: 1, contract_id: c.id, subscribe: 1 }, { timeout: 7000, type: "contract" });
    const id = r?.subscription?.id || null;
    if (!S.contract) await forget(id); else S.subCon = id;
}
function onContract(m) {
    const k = m.proposal_open_contract, c = S.contract;
    if (!k || !c || Number(k.contract_id) !== c.id) return;
    const f = (v, d) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? d : Number(v));
    c.entry = f(k.entry_spot, c.entry); c.ee = f(k.entry_tick_time, c.ee); c.payout = f(k.payout, c.payout); c.stake = f(k.buy_price, c.stake);
    c.profit = f(k.profit, c.profit); c.status = k.status || c.status;
    c.ticks = Array.isArray(k.tick_stream) ? k.tick_stream.length : f(k.tick_count, c.ticks);
    c.ds = f(k.date_start, c.ds); c.de = f(k.date_expiry, c.de);
    contractUI(); redraw();
    const fin = Number(k.is_expired) === 1 || Number(k.is_sold) === 1 || ["won", "lost", "sold", "cancelled"].includes(String(k.status || "").toLowerCase());
    if (fin && !c.done) {
        c.done = true;
        const profit = f(k.profit, f(k.sell_price, 0) - f(k.buy_price, c.stake)), sub = S.subCon;
        S.subCon = null; S.contract = null; forget(sub);
        finish(profit, `CONTRACT ${c.id}`, c);
    }
}
function startPaper(dir, p, src) {
    S.paper = { dir, src, stake: p.ask, payout: p.payout, entry: null, ee: NaN, n: 0, pl: 0, mode: O.mode, secs: durSec(), tk: O.mode !== "MU" && DM().u === "t" ? dur() : 0, bar: Math.abs(parseFloat(dir === "RISE" ? S.barUp : S.barDn)) || S.bar, mult: O.mult, tp: O.tp, sl: O.sl };
    if (p.payout > 0) S.ratio = p.payout / p.ask; S.trades++;
    log(`PAPER ${dir} · ${O.mode} · stake ${money(p.ask)}${p.payout > 0 ? ` · payout ${money(p.payout)}` : ` · ×${O.mult}`}`, "trade");
    contractUI(); ui();
}
function paperTick(q, e) {
    const p = S.paper; if (!p) return;
    if (p.entry === null) { p.entry = q; p.ee = e; p.n = 0; contractUI(); return; }      // entry spot = first tick AFTER purchase
    p.n++;
    const up = p.dir === "RISE";
    if (p.mode === "MU") {
        p.pl = p.stake * p.mult * (q - p.entry) / p.entry * (up ? 1 : -1);
        const lim = Math.min(p.sl > 0 ? p.sl : p.stake, p.stake); let out = null;
        if (p.tp > 0 && p.pl >= p.tp) out = p.tp; else if (p.pl <= -lim) out = -lim;
        contractUI();
        if (out !== null) { const x = p; S.paper = null; finish(round2(out), "PAPER", x); }
        return;
    }
    contractUI();
    if (!(p.tk ? p.n >= p.tk : e >= p.ee + p.secs)) return;
    const off = p.mode === "HL" ? p.bar : 0, win = up ? q > p.entry + off : q < p.entry - off;      // ties lose
    const x = p; S.paper = null;
    finish(win ? x.payout - x.stake : -x.stake, "PAPER", x);
}
async function sellNow() {
    if (S.paper && S.paper.mode === "MU") { const x = S.paper; S.paper = null; return void finish(round2(x.pl), "PAPER", x); }
    const c = S.contract; if (!c || c.closing || c.mode !== "MU") return;
    c.closing = true;
    try { await sendWS({ sell: c.id, price: 0 }, { timeout: 7000, type: "sell" }); log("Close requested.", "trade"); }
    catch (e) { c.closing = false; toast(`Close failed: ${e.message}`, 3000, "bad"); }
}
function finish(profit, label, x) {
    S.pl += profit;
    const won = profit > 0, lost = profit < 0, src = x.src || "manual";
    log(`${label} ${x.dir} ${won ? "WIN" : lost ? "LOSS" : "FLAT"} · ${money(profit)}`, won ? "win" : lost ? "warn" : "info");
    if (won) S.wins++; if (lost) S.losses++;
    if (src === "auto") S.autoTrades++;
    const lt = S.ticks[S.ticks.length - 1]; if (lt) S.marks.push({ k: "res", e: lt.e, q: lt.q, res: won ? "W" : lost ? "L" : "=" });
    if (S.marks.length > 80) S.marks.splice(0, S.marks.length - 80);
    S.hist.unshift({ t: Date.now(), sym: S.sym, dir: x.dir, stake: x.stake, profit, src }); if (S.hist.length > 100) S.hist.pop();
    flash(`${won ? "WIN" : lost ? "LOSS" : "FLAT"} ${profit >= 0 ? "+" : ""}${money(profit)}`, won ? "win" : "loss"); beep(won ? 988 : 330);
    S.cool = Date.now() + Math.max(0, SG.cooldown) * 1000; S.sigOk = false;
    S.busy = false; contractUI(true); ui(); renderTrades(); armSoon();
    if (AM.on) S.amNext = Date.now() + 2000;
    if (SG.auto) {
        if (S.pl <= SG.maxLoss) autoOff("MAX LOSS");
        else if (S.pl >= SG.takeProfit) autoOff("TAKE PROFIT");
        else if (SG.maxTrades > 0 && S.autoTrades >= SG.maxTrades) autoOff("MAX AUTO TRADES");
    }
}
function resetSession() {
    if (inTrade()) return void log("Cannot reset during an open trade.", "warn");
    Object.assign(S, { pl: 0, wins: 0, losses: 0, trades: 0, autoTrades: 0, hist: [] });
    log("Session reset."); ui(); renderTrades();
}

/* ================================================================
   SIGNALS + AUTO ENTRY
================================================================ */
function checkSignal(res) {
    const ok = Boolean(res?.ok), blocked = SG.auto && (inTrade() || S.busy || S.switching || Date.now() < S.cool);
    if (ok && blocked) { S.sigOk = false; return; }          // auto can't act now: keep the edge so it fires when free
    const fire = ok && !S.sigOk && Date.now() > S.sigCool;
    S.sigOk = ok;
    if (!fire) return;
    const dir = (res.dir > 0) !== SG.rev ? "RISE" : "FALL", last = S.ticks[S.ticks.length - 1];
    S.sigCool = Date.now() + 3000;
    S.marks.push({ k: "sig", e: last.e, q: last.q, dir });
    beep(dir === "RISE" ? 880 : 660); toast(`${dir}${SG.rev ? " (reversed)" : ""} signal · Q ${res.score}`, 2200, dir === "RISE" ? "ok" : "bad");
    log(`SIGNAL ${res.dir > 0 ? "RISE" : "FALL"}${SG.rev ? ` → REVERSED to ${dir}` : ""} · ${S.sym} · Q ${res.score} · ${V.tf}`, "trade");
    if (SG.auto && ready() && !inTrade() && !S.busy && !S.switching && Date.now() > S.cool) execute(dir, "auto", res);
}
function setAuto(on) {
    if (on && S.exec === "LIVE" && S.acctType === "real" && !confirm("AUTO ENTRY on a REAL account with LIVE execution: signals will place real trades. Enable?")) { syncPSig(); return; }
    if (on) S.autoTrades = 0;
    SG.auto = on; ls.set("pw3-sg", SG); syncPSig(); ui();
    log(`Auto entry ${on ? "ON" : "OFF"}`, on ? "trade" : "info"); toast(`Auto entry ${on ? "ON" : "OFF"}`, 1800, on ? "ok" : "");
}
function autoOff(why) { SG.auto = false; ls.set("pw3-sg", SG); syncPSig(); ui(); log(`Auto entry stopped · ${why}`, "warn"); toast(`Auto stopped: ${why}`, 3500, "bad"); }
function sgChanged(custom = true) {
    if (custom) SG.preset = "CUSTOM";
    ls.set("pw3-sg", SG); syncPSig(); reeval();
}
function applyPreset(name) {
    if (PRESETS[name]) { Object.assign(SG, clone(PRESETS[name])); SG.preset = name; } else SG.preset = "CUSTOM";
    sgChanged(false);
}
function reeval() { if (S.ticks.length) S.res = analyze(S.ticks.length > 900 ? S.ticks.slice(-900) : S.ticks, S.zones, TFS[V.tf] ? S.cs : undefined); S.sigOk = Boolean(S.res?.ok); renderHud(); renderRank(); redraw(); }
function applyParams() {
    ls.set("pw3-p", P);
    if (S.ticks.length) { buildInd(S.ticks); rebuildCS(); S.zones = P.zOn ? findZones(S.ticks) : []; }
    V.ema = P.emaOn; V.zones = P.zOn; V.sr = P.srOn; V.st = P.stOn;
    syncPInd(); reeval();
}

/* ================================================================
   CONNECTION
================================================================ */
const restErr = (d, f) => (Array.isArray(d?.errors) && d.errors.length ? d.errors.map(e => e.message).join("; ") : d?.error?.message || d?.message || f);
async function rest(path, method) {
    const r = await fetch(CFG.REST + path, { method, headers: { Authorization: `Bearer ${A.tok}`, Accept: "application/json" } });
    const d = await r.json().catch(() => ({}));
    if (r.status === 401) { const e = new Error("Session expired — please sign in again."); e.auth = true; throw e; }
    if (!r.ok) throw new Error(restErr(d, `Request failed (${r.status}).`));
    return d;
}
function link(state) {
    S.authed = state === "on";
    $("connDot").className = `dot ${state}`;
    set("connText", state === "on" ? "LIVE" : state === "mid" ? "…" : "OFFLINE");
    manualUI();
}
function buildAcctSel() {
    const s = $("acctSel"); s.innerHTML = "";
    S.accounts.forEach(a => { const o = document.createElement("option"); o.value = a.id; o.textContent = `${a.type.toUpperCase()} · ${a.id}`; s.appendChild(o); });
    if (S.accountId) s.value = S.accountId;
}
function openSocket(url) {
    return new Promise((resolve, reject) => {
        let done = false;
        const ws = new WebSocket(url); S.ws = ws;
        const timer = setTimeout(() => { if (!done) { done = true; try { ws.close(); } catch { } reject(new Error("WebSocket timed out.")); } }, 12000);
        ws.onopen = () => {
            if (done) return; done = true; clearTimeout(timer);
            S.lastMsg = Date.now(); S.attempt = 0; link("on"); log("Authenticated WebSocket connected.");
            clearInterval(S.hb); clearInterval(S.health);
            S.hb = setInterval(() => { if (wsOpen()) try { ws.send('{"ping":1}'); } catch { } }, NET.hbMs);
            S.health = setInterval(health, NET.healthMs);
            resolve(ws);
        };
        ws.onmessage = e => onMsg(e.data);
        ws.onerror = () => { if (!done) { done = true; clearTimeout(timer); reject(new Error("WebSocket error.")); } };
        ws.onclose = () => {
            clearTimeout(timer);
            if (ws !== S.ws) return;
            clearInterval(S.hb); clearInterval(S.health); rejectAll("WebSocket closed.");
            S.subTick = S.subCon = null; S.ppSub = {}; S.pp = { RISE: null, FALL: null }; S.armKey = ""; link("off");
            if (S.byUser) return void log("Disconnected.");
            log("Link lost — reconnecting.", "error"); scheduleReconnect();
        };
    });
}
function health() {
    if (!S.authed) return;
    if (Date.now() - S.lastMsg > NET.deadMs) { log("No data from server — dropping dead socket.", "warn"); try { S.ws.close(); } catch { } return; }
    if (S.unconfirmedUntil && Date.now() > S.unconfirmedUntil && !inTrade()) { S.unconfirmedUntil = 0; S.busy = false; S.cool = 0; log("Trading resumed."); armSoon(); manualUI(); }
    if (S.contract && !S.subCon) subscribeContract().catch(() => { });
    if (!S.armKey && !inTrade() && !S.busy && !S.switching && S.subTick) armSoon();
    if (S.sym && !S.busy && !inTrade() && !S.switching && Date.now() - S.lastTick > 10000) {           // stale stream → resubscribe
        S.staleHits++; log(`Tick stream stale (${S.staleHits}) — resubscribing.`, "warn"); S.lastTick = Date.now();
        useMarket(S.sym, true);
    }
}
async function connect() {
    if (S.connecting || wsOpen()) return;
    if (!authValid()) return showLogin("Please sign in with Deriv.");
    S.connecting = true; S.byUser = false; link("mid"); hideLogin();
    try {
        log("Loading accounts…");
        let list = (await rest("/trading/v1/options/accounts", "GET")).data;
        list = (Array.isArray(list) ? list : list ? [list] : []).map(i => ({
            id: i.account_id || i.id || "", type: String(i.account_type || i.type || "demo").toLowerCase(), cur: i.currency || "USD", bal: num(i.balance)
        })).filter(i => i.id);
        if (!list.length) throw new Error("No Options accounts found on this login.");
        S.accounts = list;
        const a = list.find(i => i.id === S.accountId) || list.find(i => i.type === "demo") || list[0];
        Object.assign(S, { accountId: a.id, acctType: a.type, cur: a.cur, bal: a.bal }); ls.set("pw3-acct", a.id); buildAcctSel(); ui();
        const otp = await rest(`/trading/v1/options/accounts/${encodeURIComponent(a.id)}/otp`, "POST");
        if (!otp?.data?.url) throw new Error("WebSocket URL missing from OTP response.");
        await openSocket(otp.data.url);          // OTP is single-use: connect immediately
        S.connecting = false;
        try { await sendWS({ balance: 1, subscribe: 1 }, { timeout: 7000, type: "balance" }); } catch { }
        if (S.contract) await subscribeContract().catch(() => { });
        const first = S.sym || ls.get("pw3-sym", "") || "R_100";
        if (!inTrade()) await useMarket(NAMES[first] ? first : "R_100", true);
        armSoon(0);
        if (!S.rank.length) scan("startup");
    } catch (e) {
        link("off"); log(`Connection failed → ${e.message}`, "error");
        if (e.auth) { A = null; ls.del("pw3-auth"); showLogin(e.message); }
        else { toast(`Connection failed: ${e.message}`, 4000, "bad"); scheduleReconnect(); }
    } finally { S.connecting = false; }
}
function scheduleReconnect() {
    if (S.byUser || S.reconTimer || S.connecting) return;
    S.attempt++;
    const d = Math.round(Math.min(NET.reconMax, NET.reconMs * 2 ** (S.attempt - 1)) * (0.8 + Math.random() * 0.4));
    log(`Reconnecting in ${Math.round(d / 1000)}s…`, "warn");
    S.reconTimer = setTimeout(() => { S.reconTimer = null; if (!S.byUser) connect(); }, d);
}
function closeSocket() {
    S.byUser = true; S.gen++; S.pgen++;
    clearTimeout(S.reconTimer); S.reconTimer = null;
    clearInterval(S.hb); clearInterval(S.health); rejectAll("Disconnected.");
    try { S.ws?.close(); } catch { }
    S.ws = null; S.subTick = S.subCon = null; S.ppSub = {}; S.pp = { RISE: null, FALL: null }; S.armKey = ""; S.sym = null; S.ticks = []; S.res = null;
    link("off"); renderHud(); redraw();
}
async function switchAccount(id) {
    const a = S.accounts.find(x => x.id === id); if (!a || id === S.accountId) return;
    if (inTrade() || S.busy) { $("acctSel").value = S.accountId; return void toast("Finish the open trade first.", 2200, "bad"); }
    if (a.type === "real" && S.exec === "LIVE" && !confirm("Switch to a REAL account while LIVE execution is on?")) { $("acctSel").value = S.accountId; return; }
    SG.auto && autoOff("ACCOUNT CHANGED");
    S.accountId = id; ls.set("pw3-acct", id);
    closeSocket(); S.byUser = false; await connect();
}
function setExec(v) {
    if (inTrade() || S.busy) return void toast("Locked while a trade is active.", 2000, "bad");
    if (v === "LIVE" && S.acctType === "real" && !confirm("LIVE execution on a REAL account: trades will use real money. Enable?")) return;
    S.exec = v; ls.set("pw3-exec", v); if (v === "PAPER" && SG.auto) { /* paper auto is fine */ }
    ui(); log(`Execution → ${v}`); armSoon();
}

/* ================================================================
   UI
================================================================ */
function ui() {
    set("acctBal", S.bal > 0 ? money(S.bal) : "—");
    $("execBtns").querySelectorAll("button").forEach(b => b.classList.toggle("on", b.id === (S.exec === "LIVE" ? "liveBtn" : "paperBtn")));
    document.querySelector(".acct").classList.toggle("real", S.acctType === "real" && S.exec === "LIVE");
    const pl = $("kPL"); pl.textContent = money(S.pl); pl.className = S.pl > 0 ? "pos" : S.pl < 0 ? "neg" : "";
    set("kWL", `${S.wins} / ${S.losses}`); set("kTrades", String(S.trades));
    const n = S.wins + S.losses;
    set("kWR", n ? `${(S.wins / n * 100).toFixed(1)}%` : "—"); set("kBE", O.mode === "RF" || O.mode === "HL" ? `breakeven ${(100 / S.ratio).toFixed(1)}%` : "");
    set("kFill", S.execMs != null ? `${S.execMs} ms` : "—");
    $("autoTag").hidden = !SG.auto;
    const ac = $("autoChip"); ac.textContent = SG.auto ? "AUTO ON" : "AUTO OFF"; ac.classList.toggle("on", SG.auto);
    const mc = $("amChip"); mc.textContent = AM.on ? `MKT AUTO · ${AMCAT[AM.cat].n}` : "MKT AUTO OFF"; mc.classList.toggle("on", AM.on);
    $("dStake").value !== String(S.stake) && document.activeElement !== $("dStake") && ($("dStake").value = S.stake);
    
    manualUI();
}
function manualUI() {
    const can = ready() && !inTrade() && !S.busy && !S.switching && Boolean(S.sym && S.subTick);
    [["RISE", "mRise", 0], ["FALL", "mFall", 1]].forEach(([d, id, i]) => {
        const b = $(id); if (!b) return;
        const p = fresh(d, stake()); b.disabled = !can;
        const sp = b.querySelector("span"); if (sp) sp.textContent = MLAB[O.mode][i];
        const em = b.querySelector("em"); if (em) em.textContent = p ? (p.ratio > 0 ? `${p.ratio.toFixed(2)}x · ${money(p.payout)}` : O.mode === "MU" ? `×${O.mult} · ${money(p.ask)}` : money(p.ask)) : "—";
    });
    set("mStatus", !ready() ? "Connect to trade" : inTrade() ? "Trade running…" : S.switching ? "Switching market…" : S.busy ? "Executing…"
        : `${S.exec}${S.exec === "LIVE" ? ` · ${S.acctType.toUpperCase()}` : ""} · ${optDesc()} · ${S.sym || "—"}${SG.rev ? " · ↺ reverse" : ""}`);
}
function renderHud() {
    const T = S.ticks, n = T.length, r = S.res;
    if (n > 1) {
        const d = T[n - 1].q - T[n - 2].q;
        set("symPx", T[n - 1].q.toFixed(dec()));
        const e = $("symDx"); e.textContent = `${d >= 0 ? "▲" : "▼"} ${Math.abs(d).toFixed(dec())}`; e.style.color = d >= 0 ? "var(--up)" : "var(--dn)";
    } else { set("symPx", "—"); set("symDx", ""); }
    if (!V.cx) setRead(n ? n - 1 : -1);
    document.querySelectorAll("#meter .mc").forEach(b => {
        const id = b.dataset.f, row = r?.rows.find(x => x.id === id);
        b.className = `mc ${!row ? "" : row.off ? "off" : row.pass ? "ok" : "no"}${SG.req[id] ? " req" : ""}`;
        b.title = `${FACT_NAME[id]}${row ? ` — ${row.val}` : ""}\nclick: ${SG.req[id] ? "stop requiring" : "require"} for signals`;
    });
    if (r) {
        $("qBar").style.width = `${r.score}%`; set("qVal", `Q ${r.score}`);
        const h = $("hBias"); h.textContent = `${r.dir > 0 ? "▲ RISE" : "▼ FALL"} BIAS`; h.className = `chip ${r.dir > 0 ? "up" : "dn"}`;
        const b = $("sigBadge");
        if (r.ok) { const d = (r.dir > 0) !== SG.rev; b.className = `badge ${d ? "rise" : "fall"}`; b.textContent = `${d ? "RISE" : "FALL"} READY${SG.rev ? " ↺" : ""}`; }
        else { const near = r.passed >= r.total - 2; b.className = `badge${near ? " watch" : ""}`; b.textContent = near ? `FORMING ${r.passed}/${r.total}` : "WAITING"; }
    } else {
        $("qBar").style.width = "0"; set("qVal", "Q —"); $("hBias").textContent = "BIAS —"; $("hBias").className = "chip mut"; $("sigBadge").className = "badge"; $("sigBadge").textContent = "WAITING";
    }
}
function setRead(i) {
    const T = S.ticks, e = $("hRead");
    if (i < 0 || i >= T.length) { e.textContent = "—"; return; }
    const t = T[i], d = new Date(t.e * 1000).toLocaleTimeString([], { hour12: false });
    let s = `${d}  ${t.q.toFixed(dec())}`;
    if (P.emaOn) s += `  ·  EMA${P.ema} ${t.m.toFixed(dec())}`;
    if (P.srOn) s += `  ·  K ${t.k.toFixed(0)} D ${t.dd.toFixed(0)}`;
    if (P.stOn) s += `  ·  ST ${t.sdir > 0 ? "▲" : "▼"}`;
    const tfs = TFS[V.tf];
    if (tfs && G) { const b = Math.floor(t.e / tfs) * tfs, c = buildCandles(T, tfs, b, b + tfs - 1)[0]; if (c) s += `  ·  O ${c.o.toFixed(dec())} H ${c.h.toFixed(dec())} L ${c.l.toFixed(dec())} C ${c.c.toFixed(dec())}`; }
    e.textContent = s;
}
function contractUI(clear = false) {
    const c = S.contract, p = S.paper, x = c || p, card = $("tradeCard");
    if (!x) { card.hidden = true; return; }
    const mu = x.mode === "MU", lastE = S.ticks[S.ticks.length - 1]?.e || 0;
    card.hidden = false; set("tcSide", `${x.dir === "RISE" ? "▲" : "▼"} ${mu ? (x.dir === "RISE" ? "UP" : "DOWN") : x.dir}`);
    let frac = 0, txt = "";
    if (mu) txt = `OPEN ×${x.mult}`;
    else if (x.tk) { const n = c ? c.ticks : p.n; frac = n / x.tk; txt = `${Math.min(n, x.tk)} / ${x.tk}t`; }
    else {
        const s0 = c ? c.ds : p.ee, tot = (c && c.de > c.ds ? c.de - c.ds : x.secs) || 1, el = Number.isFinite(s0) ? Math.max(0, lastE - s0) : 0;
        frac = el / tot; txt = `${Math.min(Math.round(el), Math.round(tot))} / ${Math.round(tot)}s`;
    }
    set("tcN", txt);
    const el = $("tcPL");
    if (c) { el.textContent = money(c.profit); el.className = c.profit >= 0 ? "pos" : "neg"; }
    else if (mu) { el.textContent = money(p.pl); el.className = p.pl >= 0 ? "pos" : "neg"; }
    else {
        const q = S.ticks[S.ticks.length - 1]?.q, en = p.entry;
        if (en !== null && q !== undefined) { const off = p.mode === "HL" ? p.bar : 0, w = p.dir === "RISE" ? q > en + off : q < en - off; el.textContent = w ? `+${money(p.payout - p.stake)}` : money(-p.stake); el.className = w ? "pos" : "neg"; }
        else { el.textContent = "entering…"; el.className = ""; }
    }
    $("tcBar").style.width = `${clamp(frac * 100, 0, 100)}%`; $("tcBar").parentElement.hidden = mu; $("tcClose").hidden = !mu;
    $("tcSide").className = x.dir === "RISE" ? "pos" : "neg";
}
function renderTrades() {
    const b = $("tradeRows"); if (!b) return; b.innerHTML = "";
    S.hist.forEach(h => {
        const tr = document.createElement("tr"); tr.style.cursor = "default";
        [[new Date(h.t).toLocaleTimeString([], { hour12: false }), ""], [h.sym, ""], [`${h.dir === "RISE" ? "▲" : "▼"}${h.src === "auto" ? " A" : ""}`, h.dir === "RISE" ? "up" : "dn"], [money(h.stake), ""], [`${h.profit >= 0 ? "+" : ""}${money(h.profit)}`, h.profit > 0 ? "up" : h.profit < 0 ? "dn" : ""]]
            .forEach(([v, c]) => { const td = document.createElement("td"); td.textContent = v; if (c) td.className = c; tr.appendChild(td); });
        b.appendChild(tr);
    });
}
function setStake(v) {
    S.stake = Math.max(0.35, round2(num(v, S.stake))); ls.set("pw3-stake", S.stake);
    $("dStake").value = S.stake; ui(); armSoon(250);
}
function manualTrade(dir) { execute(dir, "manual"); }

/* ---------- drawer panels (generated from schemas) ---------- */
const PSCHEMA = [
    { g: "EMA LINE", on: "emaOn", f: [["ema", "Period", 3, 200, 1]] },
    { g: "SUPPLY / DEMAND ZONES", on: "zOn", f: [["zoneW", "Zone width σ", 0.3, 6, 0.1], ["zoneImp", "Impulse σ", 1, 12, 0.5]] },
    { g: "STOCHASTIC RSI", on: "srOn", f: [["rsi", "RSI length", 2, 50, 1], ["stoch", "Stoch length", 2, 50, 1], ["k", "%K smooth", 1, 10, 1], ["d", "%D smooth", 1, 10, 1]] },
    { g: "SUPERTREND", on: "stOn", f: [["atr", "ATR length", 3, 100, 1], ["mul", "Multiplier", 1, 10, 0.5]] }
];
const SSCHEMA = [["z5Min", "5m trend z ≥", 0.2, 4, 0.1], ["z1Min", "1m trend z ≥", 0, 3, 0.1], ["holdMin", "Ticks held before cross", 1, 10, 1], ["crossMin", "Cross strength σ", 0, 2, 0.05],
["crossWin", "Cross window (ticks)", 1, 6, 1], ["maxFlips", "Max chop flips", 0, 12, 1], ["volCap", "Volatility ceiling", 1, 4, 0.1], ["volMin", "Volatility floor", 0.1, 1.5, 0.05],
["zoneRoom", "Zone room ×", 0, 4, 0.1], ["srLow", "StochRSI zone", 10, 45, 5], ["minQ", "Min score Q", 0, 100, 5], ["xWin", "Double-cross window (bars)", 2, 40, 1]];
const AFIELDS = [["cooldown", "Cooldown (s)", 0, 600, 1], ["maxTrades", "Max auto trades (0=∞)", 0, 999, 1], ["takeProfit", "Session take profit $", 1, 99999, 1], ["maxLoss", "Session max loss $", -99999, -1, 1], ["minPayout", "Min payout ×", 1, 3, 0.01], ["maxStakePct", "Max stake % of balance", 0, 100, 0.1], ["maxStakeAbs", "Max stake $ (0=off)", 0, 99999, 1]];
const nf = (attr, f) => `<label>${f[1]}<input type="number" data-${attr}="${f[0]}" min="${f[2]}" max="${f[3]}" step="${f[4]}"></label>`;
function buildPanes() {
    let h = `<p class="note">Indicators run on the <b>tick stream</b> — what the contract settles on — whichever candle timeframe you view.</p>`;
    PSCHEMA.forEach(s => { h += `<div class="ig"><label class="switch"><input type="checkbox" data-p="${s.on}"><span></span> ${s.g}</label><div class="grid2">${s.f.map(f => nf("p", f)).join("")}</div></div>`; });
    h += `<label class="switch"><input type="checkbox" data-p="marks"><span></span> Show signal / entry markers</label><button id="pReset" class="btn full">RESET INDICATORS</button>`;
    $("paneInd").innerHTML = h;
    $("paneInd").addEventListener("change", ev => {
        const e = ev.target, k = e.dataset.p; if (!k) return;
        P[k] = e.type === "checkbox" ? e.checked : clamp(num(e.value, P0[k]), num(e.min, -1e9), num(e.max, 1e9));
        applyParams();
    });
    $("pReset").onclick = () => { Object.assign(P, P0); applyParams(); };
    h = `<label>Preset<select id="sgPreset"><option>SAFE</option><option>BALANCED</option><option>FAST</option><option>CUSTOM</option></select></label>
      <p class="note">A signal fires when every <b>required</b> confirmation passes and the score reaches the minimum. Tap the chips on the chart to require / unrequire them too.</p>
      <div class="sub">ENTRY TRIGGER <small style="display:inline">· runs on the chart timeframe you are viewing</small></div>
      <label>Trigger<select id="sgTrig"><option value="CONF">Confluence (score + required boxes)</option><option value="XCROSS">EMA + Supertrend double-cross</option><option value="ZONE">Supply / demand zone trigger</option></select></label>
      <label>Zone trigger<select id="sgZMode"><option value="OFF">Off</option><option value="TOUCH">Touch (enter zone with bias)</option><option value="BREAK">Break (pierce zone with bias)</option><option value="BOTH">Touch + Break</option></select></label>
      <label class="switch"><input type="checkbox" data-sg="rev"><span></span> Reverse signal (RISE signal opens FALL)</label>
      <div class="sub">REQUIRED CONFIRMATIONS</div><div class="reqs">${FACT.map(([id]) => `<label class="chk"><input type="checkbox" data-req="${id}"> ${FACT_NAME[id]}</label>`).join("")}</div>
      <div class="sub">THRESHOLDS</div><div class="grid2">${SSCHEMA.map(f => nf("sg", f)).join("")}</div>
      <div class="sub">MARKET AUTO-SELECT</div>
      <label class="switch"><input type="checkbox" id="amOn"><span></span> Auto-select a market by score band</label>
      <label>Category<select id="amCat"><option value="VHIGH">Very high · 75%+</option><option value="HIGH">High · 56–74%</option><option value="MED">Medium · 50–55%</option><option value="LOW">Low · 25–49%</option><option value="VLOW">Very low · below 25%</option></select></label>
      <label>Rescan every (s)<input type="number" id="amEvery" min="20" max="900" step="5"></label>
      <p class="note">Scans on the timer (never mid-trade), after every trade, and when the current market leaves the band. Your trade option below the chart is kept.</p>
      <div class="sub">AUTO ENTRY</div>
      <label class="switch"><input type="checkbox" id="sgAuto"><span></span> Auto-enter when a signal fires</label>
      <label class="switch"><input type="checkbox" data-sg="sound"><span></span> Sound alerts</label>
      <div class="grid2">${AFIELDS.map(f => nf("sg", f)).join("")}</div>
      <p class="note">Auto uses the stake and duration set under the chart and stops itself at your take-profit, max-loss or trade limit.</p>`;
    $("paneSig").innerHTML = h;
    $("paneSig").addEventListener("change", ev => {
        const e = ev.target;
        if (e.id === "sgPreset") return applyPreset(e.value);
        if (e.id === "sgTrig") return applyTrig(e.value);
        if (e.id === "sgZMode") { SG.zMode = e.value; return sgChanged(false); }
        if (e.id === "amOn") return setAM(e.checked);
        if (e.id === "amCat") { AM.cat = e.value; saveAM(); S.amNext = 0; return ui(); }
        if (e.id === "amEvery") { AM.every = clamp(num(e.value, 60), 20, 900); return saveAM(); }
        if (e.id === "sgAuto") return setAuto(e.checked);
        if (e.dataset.req) { SG.req[e.dataset.req] = e.checked ? 1 : 0; return sgChanged(); }
        const k = e.dataset.sg; if (!k) return;
        SG[k] = e.type === "checkbox" ? e.checked : clamp(num(e.value, SG[k]), num(e.min, -1e9), num(e.max, 1e9));
        sgChanged(SIGKEYS.includes(k));
    });
    syncPInd(); syncPSig();
}
function syncPInd() {
    document.querySelectorAll("#paneInd [data-p]").forEach(e => { const v = P[e.dataset.p]; if (e.type === "checkbox") e.checked = Boolean(v); else e.value = v; });
    [["tgEma", "emaOn"], ["tgZones", "zOn"], ["tgSr", "srOn"], ["tgSt", "stOn"]].forEach(([id, k]) => $(id).classList.toggle("on", Boolean(P[k])));
    V.ema = P.emaOn; V.zones = P.zOn; V.sr = P.srOn; V.st = P.stOn;
}
function syncPSig() {
    $("sgPreset").value = SG.preset; $("sgAuto").checked = SG.auto; $("sgTrig").value = SG.trig; $("sgZMode").value = SG.zMode; $("amOn").checked = AM.on; $("amCat").value = AM.cat; $("amEvery").value = AM.every;
    document.querySelectorAll("#paneSig [data-req]").forEach(e => { e.checked = Boolean(SG.req[e.dataset.req]); });
    document.querySelectorAll("#paneSig [data-sg]").forEach(e => { const v = SG[e.dataset.sg]; if (e.type === "checkbox") e.checked = Boolean(v); else e.value = v; });
    $("autoTag").hidden = !SG.auto;
}
function openDrawer(tab) {
    const d = $("drawer"), cur = d.dataset.tab;
    if (!d.hidden && cur === tab) { d.hidden = true; }
    else { d.hidden = false; d.dataset.tab = tab; }
    document.querySelectorAll("#drTabs [data-tab]").forEach(b => b.classList.toggle("on", !d.hidden && b.dataset.tab === tab));
    document.querySelectorAll(".pane").forEach(p => p.classList.toggle("on", !d.hidden && p.id === `pane${{ ind: "Ind", sig: "Sig", log: "Log", trades: "Trades" }[tab]}`));
    document.querySelectorAll("#panBtns [data-pan]").forEach(b => b.classList.toggle("on", !d.hidden && b.dataset.pan === tab));
    if (!d.hidden) $("rankP").hidden = true;
    setTimeout(redraw, 30);
}
function buildMeter() {
    const m = $("meter"); m.innerHTML = "";
    FACT.forEach(([id, lab]) => { const b = document.createElement("button"); b.className = "mc"; b.dataset.f = id; b.innerHTML = `<i></i><span>${lab}</span>`; m.appendChild(b); });
    m.addEventListener("click", ev => { const b = ev.target.closest(".mc"); if (!b) return; const f = b.dataset.f; SG.req[f] = SG.req[f] ? 0 : 1; sgChanged(); });
}

/* ================================================================
   CHART
================================================================ */
function redraw() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; draw(); }); }
function buildCandles(T, tf, tL, tR) {
    const out = [], i0 = lb(T, Math.floor(tL / tf) * tf), i1 = Math.min(T.length, lb(T, tR + 1));
    let cur = null;
    for (let i = i0; i < i1; i++) {
        const t = T[i], b = Math.floor(t.e / tf) * tf;
        if (!cur || cur.t !== b) { if (cur) out.push(cur); cur = { t: b, o: t.q, h: t.q, l: t.q, c: t.q }; }
        else { if (t.q > cur.h) cur.h = t.q; if (t.q < cur.l) cur.l = t.q; cur.c = t.q; }
    }
    if (cur) out.push(cur);
    return out;
}
const NICE = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200];
function draw() {
    const cv = $("chart"); if (!cv) return;
    const rc = cv.getBoundingClientRect(); if (rc.width < 10 || rc.height < 10) return;
    const dpr = window.devicePixelRatio || 1, pw = Math.round(rc.width * dpr), ph = Math.round(rc.height * dpr);
    if (cv.width !== pw || cv.height !== ph) { cv.width = pw; cv.height = ph; }
    const g = cv.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const W = rc.width, H = rc.height; g.clearRect(0, 0, W, H);
    g.font = "600 11px ui-monospace,Menlo,Consolas,monospace";
    const T = S.ticks;
    if (T.length < 3) { g.fillStyle = "#8696b8"; g.fillText(ready() ? "Loading ticks…" : "Sign in / connect to stream a market.", 60, H / 2); G = null; return; }

    const L = 46, R = 74, Tp = W < 760 ? 78 : 50, B = 22, subOn = P.srOn && V.sr, subH = subOn ? Math.round((H - Tp - B) * 0.2) : 0, gap = subOn ? 8 : 0;
    const PW = W - L - R, PH = H - Tp - B - subH - gap, subTop = Tp + PH + gap;
    const last = T[T.length - 1].e, span = V.span, maxOff = Math.max(0, last - T[0].e - span * 0.25);
    V.off = clamp(V.off, 0, maxOff);
    const tR = last + span * 0.08 - V.off, tL = tR - span, tfs = TFS[V.tf];
    const X = e => L + PW * (e - tL) / span;
    const i0 = Math.max(0, lb(T, tL) - 1), i1 = Math.min(T.length, lb(T, tR) + 1), step = Math.max(1, Math.ceil((i1 - i0) / (PW * 1.2)));
    const IND = tfs ? S.cs : T, j0 = Math.max(0, lb(IND, tL) - 1), j1 = Math.min(IND.length, lb(IND, tR) + 1), jstep = Math.max(1, Math.ceil((j1 - j0) / (PW * 1.2))), ox = tfs ? tfs / 2 : 0;
    let lo = Infinity, hi = -Infinity, cds = null;
    if (tfs) { cds = buildCandles(T, tfs, tL, tR); cds.forEach(c => { if (c.l < lo) lo = c.l; if (c.h > hi) hi = c.h; }); }
    for (let i = i0; i < i1; i++) {
        const t = T[i];
        if (!tfs) { if (t.q < lo) lo = t.q; if (t.q > hi) hi = t.q; }
        if (V.ema && !tfs) { if (t.m < lo) lo = t.m; if (t.m > hi) hi = t.m; }
    }
    if (tfs && V.ema) for (let j = j0; j < j1; j++) { const t = IND[j]; if (t.m < lo) lo = t.m; if (t.m > hi) hi = t.m; }
    const ent = S.contract?.entry ?? S.paper?.entry;
    if (Number.isFinite(ent)) { lo = Math.min(lo, ent); hi = Math.max(hi, ent); }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) { lo = T[T.length - 1].q - 1; hi = lo + 2; }
    const pad = (hi - lo) * 0.14 || 1; lo -= pad; hi += pad;
    if (V.ys !== 1) { const mid = (lo + hi) / 2, half = (hi - lo) / 2 * V.ys; lo = mid - half; hi = mid + half; }
    const Y = p => Tp + PH * (1 - (p - lo) / (hi - lo));
    G = { L, R, Tp, B, W, H, PW, PH, subTop, subH, tL, tR, lo, hi, span, X, Y, ex: x => tL + (x - L) / PW * span, py: y => lo + (1 - (y - Tp) / PH) * (hi - lo) };

    // grid + axes
    g.lineWidth = 1; g.strokeStyle = "rgba(120,150,210,.09)"; g.fillStyle = "#8696b8";
    for (let k = 0; k <= 5; k++) { const v = lo + (hi - lo) * k / 5, y = Y(v); g.beginPath(); g.moveTo(L, y); g.lineTo(W - R, y); g.stroke(); g.fillText(v.toFixed(dec()), W - R + 6, y + 4); }
    const stp = NICE.find(s => s >= span / 7) || 7200, fmt = { hour12: false, hour: "2-digit", minute: "2-digit", second: stp < 60 ? "2-digit" : undefined };
    for (let t = Math.ceil(tL / stp) * stp; t < tR; t += stp) {
        const x = X(t); if (x < L || x > W - R) continue;
        g.beginPath(); g.moveTo(x, Tp); g.lineTo(x, subTop + subH); g.stroke();
        g.fillText(new Date(t * 1000).toLocaleTimeString([], fmt), x - 16, H - 6);
    }

    g.save(); g.beginPath(); g.rect(L, Tp, PW, PH); g.clip();
    // supply / demand zones
    if (V.zones && P.zOn) S.zones.forEach(z => {
        const x0 = Math.max(L, X(z.e0)); if (x0 >= W - R) return;
        const y1 = Y(z.hi), y2 = Y(z.lo); if (y2 < Tp || y1 > Tp + PH) return;
        const sup = z.t === "S", c = sup ? "255,77,109" : "34,227,161";
        g.fillStyle = `rgba(${c},.13)`; g.fillRect(x0, y1, W - R - x0, y2 - y1);
        g.strokeStyle = `rgba(${c},.6)`; g.beginPath(); const ye = sup ? y1 : y2; g.moveTo(x0, ye); g.lineTo(W - R, ye); g.stroke();
        g.fillStyle = `rgba(${c},.95)`; g.fillText(sup ? "SUPPLY" : "DEMAND", x0 + 4, sup ? y1 + 11 : y2 - 4);
    });
    // trade tint + entry line
    const x = S.contract || S.paper;
    if (x && Number.isFinite(ent)) {
        const ye = Y(ent), xe = Number.isFinite(x.ee) ? clamp(X(x.ee), L, W - R) : L, rise = x.dir === "RISE";
        g.fillStyle = "rgba(34,227,161,.07)"; rise ? g.fillRect(xe, Tp, W - R - xe, ye - Tp) : g.fillRect(xe, ye, W - R - xe, Tp + PH - ye);
        g.fillStyle = "rgba(255,77,109,.07)"; rise ? g.fillRect(xe, ye, W - R - xe, Tp + PH - ye) : g.fillRect(xe, Tp, W - R - xe, ye - Tp);
        g.setLineDash([8, 5]); g.strokeStyle = "#22d3ee"; g.lineWidth = 1.2; g.beginPath(); g.moveTo(L, ye); g.lineTo(W - R, ye); g.stroke(); g.setLineDash([]);
        g.fillStyle = "#22d3ee"; g.fillText(`ENTRY · ${x.dir}`, L + 6, ye - 5);
    }
    // price series
    if (!tfs) {
        const cnt = i1 - i0;
        const grad = g.createLinearGradient(0, Tp, 0, Tp + PH); grad.addColorStop(0, "rgba(34,211,238,.26)"); grad.addColorStop(1, "rgba(34,211,238,0)");
        g.beginPath(); g.moveTo(X(T[i0].e), Tp + PH);
        for (let i = i0; i < i1; i += step) g.lineTo(X(T[i].e), Y(T[i].q));
        g.lineTo(X(T[i1 - 1].e), Y(T[i1 - 1].q)); g.lineTo(X(T[i1 - 1].e), Tp + PH); g.closePath(); g.fillStyle = grad; g.fill();
        g.lineWidth = 2.2; g.lineJoin = "round";
        if (cnt > 500) { g.strokeStyle = "#22d3ee"; g.beginPath(); for (let i = i0; i < i1; i += step) (i === i0 ? g.moveTo(X(T[i].e), Y(T[i].q)) : g.lineTo(X(T[i].e), Y(T[i].q))); g.stroke(); }
        else for (let i = i0 + 1; i < i1; i++) { g.strokeStyle = T[i].q >= T[i - 1].q ? "#22e3a1" : "#ff4d6d"; g.beginPath(); g.moveTo(X(T[i - 1].e), Y(T[i - 1].q)); g.lineTo(X(T[i].e), Y(T[i].q)); g.stroke(); }
    } else {
        const cw = Math.max(1, PW * tfs / span * 0.7);
        cds.forEach(c => {
            const cx = X(c.t + tfs / 2), col = c.c >= c.o ? "#22e3a1" : "#ff4d6d";
            g.strokeStyle = g.fillStyle = col; g.lineWidth = 1;
            g.beginPath(); g.moveTo(cx, Y(c.h)); g.lineTo(cx, Y(c.l)); g.stroke();
            const yo = Y(c.o), yc = Y(c.c); g.fillRect(cx - cw / 2, Math.min(yo, yc), cw, Math.max(1, Math.abs(yo - yc)));
        });
    }
    // Supertrend (runs coloured by direction)
    if (V.st && P.stOn) {
        g.lineWidth = 1.6; let run = null;
        const flush = () => { if (run) { g.stroke(); run = null; } };
        for (let i = j0; i < j1; i += jstep) {
            const t = IND[i], px = X(t.e + ox), py = Y(t.st);
            if (!run || run.d !== t.sdir) { flush(); g.strokeStyle = t.sdir > 0 ? "rgba(34,227,161,.75)" : "rgba(255,77,109,.75)"; g.beginPath(); g.moveTo(px, py); run = { d: t.sdir }; }
            else g.lineTo(px, py);
        }
        flush();
    }
    // EMA (the exact line the strategy trades)
    if (V.ema && P.emaOn) {
        g.strokeStyle = "#c4b5fd"; g.lineWidth = 1.8; g.beginPath();
        for (let i = j0; i < j1; i += jstep) (i === j0 ? g.moveTo(X(IND[i].e + ox), Y(IND[i].m)) : g.lineTo(X(IND[i].e + ox), Y(IND[i].m)));
        g.stroke();
    }
    // drawings
    (D.items[S.sym] || []).forEach(d => drawItem(g, d, false));
    if (D.tmp) { const t = D.tmp, cur = t.cur || { x: X(t.e1), y: Y(t.p1) }; drawItem(g, { t: t.t, e1: t.e1, p1: t.p1, e2: G.ex(cur.x), p2: G.py(cur.y) }, true); }
    // markers
    if (P.marks) S.marks.forEach(m => {
        const mx = X(m.e), my = Y(m.q); if (mx < L - 10 || mx > W - R + 10) return;
        if (m.k === "sig" || m.k === "buy") {
            const up = m.dir === "RISE", s = m.k === "buy" ? 1 : 0.8; g.fillStyle = g.strokeStyle = up ? "#22e3a1" : "#ff4d6d"; g.lineWidth = 1.6;
            g.beginPath(); g.moveTo(mx, up ? my + 5 : my - 5); g.lineTo(mx - 7 * s, up ? my + 17 : my - 17); g.lineTo(mx + 7 * s, up ? my + 17 : my - 17); g.closePath();
            m.k === "buy" ? g.fill() : g.stroke();
        } else {
            g.fillStyle = m.res === "W" ? "#22e3a1" : m.res === "L" ? "#ff4d6d" : "#8696b8";
            g.beginPath(); g.arc(mx, my, 8, 0, 7); g.fill(); g.fillStyle = "#04101f"; g.fillText(m.res, mx - 4, my + 4);
        }
    });
    g.restore();

    // StochRSI sub-panel
    if (subOn) {
        const Y2 = v => subTop + subH * (1 - v / 100);
        g.fillStyle = "rgba(120,150,210,.05)"; g.fillRect(L, Y2(80), PW, Y2(20) - Y2(80));
        g.strokeStyle = "rgba(120,150,210,.18)"; g.setLineDash([3, 4]);
        [20, 50, 80].forEach(v => { g.beginPath(); g.moveTo(L, Y2(v)); g.lineTo(W - R, Y2(v)); g.stroke(); g.fillStyle = "#8696b8"; g.fillText(String(v), W - R + 6, Y2(v) + 4); });
        g.setLineDash([]); g.strokeStyle = "rgba(120,150,210,.25)"; g.strokeRect(L, subTop, PW, subH);
        g.save(); g.beginPath(); g.rect(L, subTop, PW, subH); g.clip(); g.lineWidth = 1.4;
        [["dd", "#fbbf24"], ["k", "#22d3ee"]].forEach(([key, col]) => {
            g.strokeStyle = col; g.beginPath();
            for (let i = j0; i < j1; i += jstep) (i === j0 ? g.moveTo(X(IND[i].e + ox), Y2(IND[i][key])) : g.lineTo(X(IND[i].e + ox), Y2(IND[i][key])));
            g.stroke();
        });
        g.restore(); g.fillStyle = "#8696b8"; g.fillText(`StochRSI ${P.rsi}·${P.stoch}·${P.k}·${P.d}`, L + 6, subTop + 12);
    }

    // live price line + tag + glow
    const lq = T[T.length - 1].q, ly = Y(lq), up = lq >= T[T.length - 2].q;
    if (ly >= Tp && ly <= Tp + PH) {
        g.setLineDash([2, 4]); g.strokeStyle = up ? "rgba(34,227,161,.7)" : "rgba(255,77,109,.7)"; g.beginPath(); g.moveTo(L, ly); g.lineTo(W - R, ly); g.stroke(); g.setLineDash([]);
        g.fillStyle = up ? "#22e3a1" : "#ff4d6d"; g.fillRect(W - R + 1, ly - 9, R - 2, 18);
        g.fillStyle = "#04101f"; g.fillText(lq.toFixed(dec()), W - R + 5, ly + 4);
        if (!tfs && X(T[T.length - 1].e) <= W - R) {
            g.shadowColor = "#22d3ee"; g.shadowBlur = 14; g.fillStyle = "#fff"; g.beginPath(); g.arc(X(T[T.length - 1].e), ly, 4.5, 0, 7); g.fill(); g.shadowBlur = 0;
        }
    }
    // crosshair
    if (V.cx && V.cx.x >= L && V.cx.x <= W - R && V.cx.y >= Tp && V.cx.y <= Tp + PH) {
        const { x: cx, y: cy } = V.cx; g.strokeStyle = "rgba(230,236,255,.35)"; g.setLineDash([4, 4]);
        g.beginPath(); g.moveTo(cx, Tp); g.lineTo(cx, subTop + subH); g.moveTo(L, cy); g.lineTo(W - R, cy); g.stroke(); g.setLineDash([]);
        g.fillStyle = "#e6ecff"; g.fillRect(W - R + 1, cy - 9, R - 2, 18); g.fillStyle = "#04101f"; g.fillText(G.py(cy).toFixed(dec()), W - R + 5, cy + 4);
        const et = G.ex(cx); g.fillStyle = "#e6ecff"; g.fillRect(cx - 28, H - B + 1, 56, 16); g.fillStyle = "#04101f";
        g.fillText(new Date(et * 1000).toLocaleTimeString([], { hour12: false }), cx - 25, H - 9);
    }
    if (V.off > 0) { g.fillStyle = "rgba(251,191,36,.95)"; g.fillText("◀ history — double-click or LIVE ▸ to return", L + 8, Tp + 14); }
    if (D.tool !== "cursor") { g.fillStyle = "rgba(34,211,238,.95)"; g.fillText(`DRAW: ${{ h: "horizontal line", l: "trend ray (2 clicks)", r: "box (2 clicks)", x: "eraser" }[D.tool]} · Esc to cancel`, L + 8, Tp + PH - 8); }
}
function rayEnd(x1, y1, x2, y2) {
    if (!G || x2 === x1) return [x2, y2];
    const xe = G.W - G.R, k = (y2 - y1) / (x2 - x1);
    return x2 > x1 ? [xe, y1 + k * (xe - x1)] : [x2, y2];
}
function drawItem(g, d, prev) {
    const { X, Y, L, W, R } = G;
    g.lineWidth = 1.5; g.setLineDash(prev ? [4, 4] : []);
    if (d.t === "h") {
        const y = Y(d.p); g.strokeStyle = "#fbbf24"; g.beginPath(); g.moveTo(L, y); g.lineTo(W - R, y); g.stroke();
        g.fillStyle = "#fbbf24"; g.fillText(d.p.toFixed(dec()), L + 6, y - 4);
    } else if (d.t === "l") {
        const x1 = X(d.e1), y1 = Y(d.p1), x2 = X(d.e2), y2 = Y(d.p2), [xe, ye] = rayEnd(x1, y1, x2, y2);
        g.strokeStyle = "#f0abfc"; g.beginPath(); g.moveTo(x1, y1); g.lineTo(xe, ye); g.stroke();
    } else if (d.t === "r") {
        const x1 = X(d.e1), y1 = Y(d.p1), x2 = X(d.e2), y2 = Y(d.p2);
        g.fillStyle = "rgba(34,211,238,.12)"; g.strokeStyle = "rgba(34,211,238,.7)";
        g.fillRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1)); g.strokeRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
    }
    g.setLineDash([]);
}
function segDist(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1, l = dx * dx + dy * dy || 1, t = clamp(((px - x1) * dx + (py - y1) * dy) / l, 0, 1);
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}
function hitItem(p) {
    const arr = D.items[S.sym] || [];
    for (let i = arr.length - 1; i >= 0; i--) {
        const d = arr[i];
        if (d.t === "h") { if (Math.abs(G.Y(d.p) - p.y) < 8) return i; continue; }
        const x1 = G.X(d.e1), y1 = G.Y(d.p1), x2 = G.X(d.e2), y2 = G.Y(d.p2);
        if (d.t === "r") { if (p.x >= Math.min(x1, x2) - 6 && p.x <= Math.max(x1, x2) + 6 && p.y >= Math.min(y1, y2) - 6 && p.y <= Math.max(y1, y2) + 6) return i; }
        else { const [xe, ye] = rayEnd(x1, y1, x2, y2); if (segDist(p.x, p.y, x1, y1, xe, ye) < 8) return i; }
    }
    return -1;
}
const saveDraw = () => ls.set("pw3-draw", D.items);
function setTool(t) {
    D.tool = t; D.tmp = null;
    document.querySelectorAll("#toolBtns [data-tool]").forEach(b => b.classList.toggle("on", b.dataset.tool === t));
    $("chart").style.cursor = t === "cursor" ? "crosshair" : t === "x" ? "not-allowed" : "copy";
    redraw();
}
function toolClick(p) {
    if (!G || !S.sym || p.y > G.Tp + G.PH || p.x < G.L || p.x > G.W - G.R) return;
    const e = G.ex(p.x), pr = G.py(p.y), arr = (D.items[S.sym] = D.items[S.sym] || []);
    if (D.tool === "x") { const i = hitItem(p); if (i >= 0) { arr.splice(i, 1); saveDraw(); } }
    else if (D.tool === "h") { arr.push({ t: "h", p: pr }); saveDraw(); setTool("cursor"); }
    else if (!D.tmp) D.tmp = { t: D.tool, e1: e, p1: pr, cur: p };
    else { arr.push({ t: D.tool, e1: D.tmp.e1, p1: D.tmp.p1, e2: e, p2: pr }); saveDraw(); setTool("cursor"); }
    redraw();
}
function wireChart() {
    const cv = $("chart"), ptr = new Map(); let pan = null, pinch = null, axis = null;
    const pos = ev => { const rc = cv.getBoundingClientRect(); return { x: ev.clientX - rc.left, y: ev.clientY - rc.top }; };
    cv.addEventListener("pointerdown", ev => {
        const p = pos(ev); try { cv.setPointerCapture(ev.pointerId); } catch { } ptr.set(ev.pointerId, p);
        if (D.tool !== "cursor") { if (ptr.size === 1) toolClick(p); return; }
        if (G && p.x > G.W - G.R && p.y < G.Tp + G.PH) { axis = { y: p.y, ys: V.ys }; return; }
        if (ptr.size === 2) { const [a, b] = [...ptr.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, span: V.span }; pan = null; }
        else pan = { x: p.x, off: V.off };
    });
    cv.addEventListener("pointermove", ev => {
        const p = pos(ev); if (ptr.has(ev.pointerId)) ptr.set(ev.pointerId, p);
        if (ev.pointerType === "mouse") {
            V.cx = p;
            if (G && p.x >= G.L && p.x <= G.W - G.R) { const T = S.ticks, i = clamp(lb(T, G.ex(p.x)), 0, T.length - 1); setRead(i); }
        }
        if (D.tmp) D.tmp.cur = p;
        if (axis) V.ys = clamp(axis.ys * Math.exp((axis.y - p.y) / 200), 0.3, 6);
        else if (D.tool === "cursor") {
            if (pinch && ptr.size >= 2) { const [a, b] = [...ptr.values()]; V.span = clamp(pinch.span * pinch.d / (Math.hypot(a.x - b.x, a.y - b.y) || 1), 20, 60000); }
            else if (pan && G && ptr.size === 1) V.off = Math.max(0, pan.off + (p.x - pan.x) * V.span / G.PW);
        }
        redraw();
    });
    const up = ev => {
        ptr.delete(ev.pointerId); if (ptr.size < 2) pinch = null; axis = null;
        if (!ptr.size) pan = null; else if (ptr.size === 1) { const p = [...ptr.values()][0]; pan = { x: p.x, off: V.off }; }
    };
    cv.addEventListener("pointerup", up); cv.addEventListener("pointercancel", up);
    cv.addEventListener("pointerleave", ev => { if (ev.pointerType === "mouse") { V.cx = null; setRead(S.ticks.length - 1); redraw(); } });
    cv.addEventListener("wheel", ev => {
        ev.preventDefault(); const p = pos(ev), f = ev.deltaY > 0 ? 1.12 : 0.89;
        if (G && p.x > G.W - G.R) V.ys = clamp(V.ys * f, 0.3, 6); else V.span = clamp(V.span * f, 20, 60000);
        redraw();
    }, { passive: false });
    cv.addEventListener("dblclick", ev => {
        if (D.tool !== "cursor") return;
        if (G && pos(ev).x > G.W - G.R) V.ys = 1; else { V.off = 0; V.span = SPAN[V.tf]; V.ys = 1; }
        redraw();
    });
    if (window.ResizeObserver) new ResizeObserver(() => redraw()).observe(cv.parentElement);
}
function toggleFS(force) {
    const box = $("chartBox"), on = force ?? !box.classList.contains("fs");
    box.classList.toggle("fs", on); document.body.classList.toggle("noscroll", on);
    $("fsBtn").textContent = on ? "✕ EXIT" : "⛶ FULL";
    if (on) { try { box.requestFullscreen?.()?.catch(() => { }); } catch { } }
    else if (document.fullscreenElement) { try { document.exitFullscreen?.()?.catch(() => { }); } catch { } }
    setTimeout(redraw, 60); setTimeout(redraw, 300);
}

/* ================================================================
   EVENTS / INIT
================================================================ */
function wire() {
    const on = (id, fn, ev = "click") => $(id)?.addEventListener(ev, fn);
    wireOpt();
    buildMeter(); buildPanes();
    // login / account
    on("liGo", oauthLogin); on("logoutBtn", logout);
    on("liCopy", () => { try { navigator.clipboard.writeText(redirectUri()); loginMsg("Redirect URL copied.", true); } catch { loginMsg("Copy failed — select the URL manually."); } });
    on("acctSel", () => switchAccount($("acctSel").value), "change");
    on("paperBtn", () => setExec("PAPER")); on("liveBtn", () => setExec("LIVE"));
    // market ranking
    on("symBtn", ev => { ev.stopPropagation(); openRank(); });
    on("rankClose", () => { $("rankP").hidden = true; clearInterval(rankTimer); });
    on("scanBtn", () => scan("manual"));
    document.addEventListener("pointerdown", ev => { const p = $("rankP"); if (!p.hidden && !p.contains(ev.target) && !$("symBtn").contains(ev.target)) { p.hidden = true; clearInterval(rankTimer); } });
    // drawer
    document.querySelectorAll("#panBtns [data-pan]").forEach(b => b.addEventListener("click", () => openDrawer(b.dataset.pan)));
    document.querySelectorAll("#drTabs [data-tab]").forEach(b => b.addEventListener("click", () => { $("drawer").dataset.tab = ""; openDrawer(b.dataset.tab); }));
    on("drClose", () => { const d = $("drawer"); d.hidden = true; document.querySelectorAll("#panBtns [data-pan]").forEach(b => b.classList.remove("on")); setTimeout(redraw, 30); });
    on("clearLog", () => { $("logBox").innerHTML = ""; });
    on("exportLog", () => {
        const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([$("logBox").innerText], { type: "text/plain" }));
        a.download = `PW-ManualPro-log-${Date.now()}.txt`; a.click(); URL.revokeObjectURL(a.href);
    });
    on("resetBtn", resetSession);
    on("autoChip", () => setAuto(!SG.auto));
    // indicator quick toggles
    [["tgEma", "emaOn"], ["tgZones", "zOn"], ["tgSr", "srOn"], ["tgSt", "stOn"]].forEach(([id, k]) => on(id, () => { P[k] = !P[k]; applyParams(); }));
    // dock
    ["mRise", "mFall"].forEach(id => $(id).addEventListener("pointerdown", ev => { ev.preventDefault(); if (!$(id).disabled) manualTrade(id === "mRise" ? "RISE" : "FALL"); }));
    on("dStake", () => { const v = num($("dStake").value, 0); if (v >= 0.35) { S.stake = round2(v); armSoon(300); manualUI(); } }, "input");
    on("dStake", () => setStake($("dStake").value), "change");
    on("mMinus", () => setStake(S.stake <= 1 ? S.stake - 0.05 : S.stake - 0.5)); on("mPlus", () => setStake(S.stake < 1 ? S.stake + 0.05 : S.stake + 0.5));
    on("mHalf", () => setStake(S.stake / 2)); on("mDouble", () => setStake(S.stake * 2));
    
    // chart toolbar
    $("tfBtns").addEventListener("click", ev => {
        const b = ev.target.closest("[data-tf]"); if (!b) return;
        V.tf = b.dataset.tf; V.span = SPAN[V.tf]; V.off = 0; V.ys = 1;
        document.querySelectorAll("#tfBtns [data-tf]").forEach(x => x.classList.toggle("on", x === b)); rebuildCS(); S.sigOk = false; reeval();
    });
    $("toolBtns").addEventListener("click", ev => {
        if (ev.target.id === "clrDraw") { if (S.sym && (D.items[S.sym] || []).length && confirm("Clear all drawings on this market?")) { D.items[S.sym] = []; saveDraw(); redraw(); } return; }
        const b = ev.target.closest("[data-tool]"); if (b) setTool(D.tool === b.dataset.tool && b.dataset.tool !== "cursor" ? "cursor" : b.dataset.tool);
    });
    on("zoomIn", () => { V.span = clamp(V.span * 0.8, 20, 60000); redraw(); });
    on("zoomOut", () => { V.span = clamp(V.span * 1.25, 20, 60000); redraw(); });
    on("goLive", () => { V.off = 0; redraw(); });
    on("fsBtn", () => toggleFS());
    document.addEventListener("fullscreenchange", () => { if (!document.fullscreenElement && $("chartBox").classList.contains("fs")) toggleFS(false); redraw(); });
    document.addEventListener("pointerdown", () => { try { AC = AC || new (window.AudioContext || window.webkitAudioContext)(); AC.resume?.(); } catch { } }, { once: true });
    document.addEventListener("keydown", ev => {
        if (/^(INPUT|SELECT|TEXTAREA)$/.test(ev.target.tagName) || ev.ctrlKey || ev.metaKey || ev.altKey) return;
        const k = ev.key;
        if (k === "Escape") {
            if (D.tmp || D.tool !== "cursor") setTool("cursor");
            else if (!$("rankP").hidden) $("rankP").hidden = true;
            else if (!$("drawer").hidden) $("drClose").click();
            else if ($("chartBox").classList.contains("fs")) toggleFS(false);
        }
        else if (k === "ArrowUp" || k === "r" || k === "R") { ev.preventDefault(); if (!$("mRise").disabled) manualTrade("RISE"); }
        else if (k === "ArrowDown" || k === "f" || k === "F") { ev.preventDefault(); if (!$("mFall").disabled) manualTrade("FALL"); }
        else if (k === "m" || k === "M") toggleFS();
    });
    window.addEventListener("resize", redraw);
    window.addEventListener("offline", () => log("Network offline.", "warn"));
    window.addEventListener("online", () => { log("Network back online."); if (!S.byUser && !S.authed && !S.connecting && authValid()) { clearTimeout(S.reconTimer); S.reconTimer = null; S.attempt = 0; connect(); } });
    window.addEventListener("unhandledrejection", e => {
        const m = e.reason?.message || String(e.reason);
        if (!/closed|timed out|Disconnected/i.test(m)) log(`Unhandled error → ${m}`, "error");
    });
    wireChart(); setTool("cursor");
}
/* ================================================================
   v3.1  ·  TRADE OPTIONS (Rise/Fall · Higher/Lower · Multipliers · Vanillas)
         ·  CHART-TIMEFRAME SIGNALS  ·  MARKET AUTO-SELECT
================================================================ */
const O = Object.assign({ mode: "RF", dm: { RF: { u: "t", v: 5 }, HL: { u: "m", v: 2 }, VN: { u: "m", v: 5 } }, hlMode: "payout", hlPay: 2.5, hlOff: 0.5, mult: 100, tp: 0, sl: 0, vnBar: "" }, ls.get("pw3-opt", {}));
const saveO = () => ls.set("pw3-opt", O);
const AM = Object.assign({ on: false, cat: "VHIGH", every: 60 }, ls.get("pw3-am", {})); AM.on = false;
const saveAM = () => ls.set("pw3-am", AM);
const AMCAT = { VHIGH: { n: "V.HIGH", r: [75, 100] }, HIGH: { n: "HIGH", r: [56, 74] }, MED: { n: "MED", r: [50, 55] }, LOW: { n: "LOW", r: [25, 49] }, VLOW: { n: "V.LOW", r: [0, 24] } };
const UNITS = { RF: ["t", "s", "m", "h"], HL: ["s", "m", "h"], VN: ["m", "h", "d"] };
const UL = { t: "ticks", s: "seconds", m: "minutes", h: "hours", d: "days" };
const U_SEC = { t: 0, s: 1, m: 60, h: 3600, d: 86400 };
const CHIPS = { t: [5, 6, 7, 8, 9, 10], s: [15, 30, 45, 60, 90, 120], m: [1, 2, 3, 5, 10, 15], h: [1, 2, 4, 6, 12, 24], d: [1, 2, 3, 5, 7, 14] };
const DEFLIM = { RF: { t: [5, 10], s: [15, 86400], m: [1, 1440], h: [1, 24] }, HL: { s: [15, 86400], m: [1, 1440], h: [1, 24] }, VN: { m: [1, 1440], h: [1, 24], d: [1, 365] } };
const MLAB = { RF: ["▲ RISE", "▼ FALL"], HL: ["▲ HIGHER", "▼ LOWER"], MU: ["▲ UP", "▼ DOWN"], VN: ["▲ CALL", "▼ PUT"] };
const DM = () => O.dm[O.mode] || O.dm.RF;
const unit = () => DM().u;
const tickSec = () => /^1HZ/.test(S.sym || "") ? 1 : 2;
const durSec = () => O.mode === "MU" ? 0 : unit() === "t" ? dur() * tickSec() : dur() * U_SEC[unit()];
const durTicks = () => O.mode === "MU" ? 10 : Math.max(1, Math.round(durSec() / tickSec()));
function durLimits(mode, u) { const m = mode === "MU" ? "RF" : mode; return S.specs[S.sym]?.[m]?.[u] || DEFLIM[m]?.[u] || [1, 1000]; }
function optDesc() {
    if (O.mode === "MU") return `MULT ×${O.mult}${O.tp > 0 ? ` TP ${money(O.tp)}` : ""}${O.sl > 0 ? ` SL ${money(O.sl)}` : ""}`;
    const d = `${dur()}${unit()}`;
    return O.mode === "HL" ? `HL ${d}${S.bar ? ` ±${S.bar.toFixed(dec())}` : ""}` : O.mode === "VN" ? `VANILLA ${d}` : `RF ${d}`;
}

/* ---- contract specs (best effort: falls back to safe defaults, the server validates every quote) ---- */
async function loadSpecs(sym) {
    if (S.specs[sym]?.done) return;
    const sp = S.specs[sym] = { done: true, mult: null, vnBars: null, RF: {}, HL: {}, VN: {}, has: {}, seen: 0, types: new Set() };
    try {
        const r = await specReq(sym);
        const parse = s => { const m = /^(\d+)([tsmhd])$/.exec(String(s || "")); return m ? { v: +m[1], u: m[2] } : null; };
        const toSec = x => x.u === "t" ? x.v * tickSec() : x.v * U_SEC[x.u];
        (r.contracts_for?.available || []).forEach(c => {
            const cat = c.contract_category, ct = String(c.contract_type || "");
            sp.seen++; sp.types.add(ct);
            if (cat === "multiplier" || /^MULT/.test(ct)) { sp.has.MU = true; if (Array.isArray(c.multiplier_range)) sp.mult = c.multiplier_range.map(Number); return; }
            const hasBar = Number(c.barriers) >= 1 || /non_atm|euro_non/.test(c.barrier_category || "");
            const key = /^VANILLA/.test(ct) ? "VN" : (ct === "HIGHER" || ct === "LOWER") ? "HL" : ((ct === "CALL" || ct === "PUT") && (cat === "callput" || !cat)) ? (hasBar ? "HL" : "RF") : null;
            if (!key) return;
            sp.has[key] = true;
            if (key === "VN" && Array.isArray(c.barrier_choices)) sp.vnBars = c.barrier_choices.map(String);
            const a = parse(c.min_contract_duration), b = parse(c.max_contract_duration), rg = sp[key]; if (!a || !b) return;
            if (a.u === "t") { if (b.u === "t" && key === "RF") rg.t = [Math.min(rg.t?.[0] ?? 1e9, a.v), Math.max(rg.t?.[1] ?? 0, b.v)]; return; }
            const s0 = toSec(a), s1 = toSec(b);
            ["s", "m", "h", "d"].forEach(u => { const lo = Math.max(1, Math.ceil(s0 / U_SEC[u])), hi = Math.floor(s1 / U_SEC[u]); if (hi >= lo) rg[u] = [Math.min(rg[u]?.[0] ?? 1e9, lo), Math.max(rg[u]?.[1] ?? 0, hi)]; });
        });
        log(`Contract specs ${sym}: modes ${Object.keys(sp.has).join("/") || "?"} · types ${[...sp.types].join(",")}`);
    } catch (e) { sp.done = false; log(`contracts_for ${sym} unavailable → defaults in use (${e.message})`, "warn"); setTimeout(() => { if (S.specs[sym] && !S.specs[sym].done) delete S.specs[sym]; }, 30000); }
}

/* ---- v3.2: new-API helpers ---- */
async function specReq(sym) {          // contracts_for: this gateway validates currency + product_type; fall back to the bare form if it ever stops
    const full = { contracts_for: sym, currency: S.cur || "USD", product_type: "basic" }, plain = { contracts_for: sym };
    const order = S.cfFull === false ? [plain, full] : [full, plain]; let err;
    for (const q of order) {
        try { const r = await sendWS(Object.assign({}, q), { timeout: 8000, type: "contracts" }); S.cfFull = "product_type" in q; return r; }
        catch (e) { err = e; if (!/validation|currency|product_type|additional|invalid/i.test(e.message)) throw e; }
    }
    throw err;
}
const hlType = side => S.hlLegacy ? (side === "RISE" ? "CALL" : "PUT") : (side === "RISE" ? "HIGHER" : "LOWER");
function riskCap() {
    const a = SG.maxStakePct > 0 && S.bal > 0 ? S.bal * SG.maxStakePct / 100 : Infinity, b = SG.maxStakeAbs > 0 ? SG.maxStakeAbs : Infinity;
    return Math.min(a, b, S.bal > 0 ? S.bal * 0.95 : Infinity);
}
function quoteFail(side, e, rq) {
    S.armKey = ""; const msg = String(e.message || ""); S.armFails++;
    const d = rq ? `${rq.contract_type}${rq.barrier ? " " + rq.barrier : ""} ${rq.duration ? rq.duration + rq.duration_unit : "x" + (rq.multiplier || "")} stake ${rq.amount}` : "";
    if (S.armFails <= 4) log(`Quote ${side} [${d}] → ${msg}`, "warn");
    S.quoteBlock = Date.now() + Math.min(30000, 2000 * 2 ** Math.min(S.armFails, 4));       // back-off: never hammer the server
    const mx = /lower than ([\d.]+)/i.exec(msg), mn = /(?:higher|greater) than ([\d.]+)/i.exec(msg);
    if (/amount|stake/i.test(msg) && mx) { const v = Math.floor(Number(mx[1]) * 100) / 100; if (v >= 0.35 && v < S.stake) { toast(`Server max stake is ${mx[1]} — stake lowered.`, 4000, "bad"); S.quoteBlock = 0; return void setStake(v); } }
    if (/amount|stake/i.test(msg) && mn) { const v = Math.ceil(Number(mn[1]) * 100) / 100; if (v > S.stake) { toast(`Server min stake is ${mn[1]} — stake raised.`, 4000, "bad"); S.quoteBlock = 0; return void setStake(v); } }
    const list = barList(msg);
    if (list && (O.mode === "HL" || O.mode === "VN")) {
        const dg = (/\.(\d+)/.exec(list[0]) || [])[1]; if (dg) S.pip[S.sym] = dg.length;
        if (O.mode === "VN") { (S.specs[S.sym] = S.specs[S.sym] || { done: false, RF: {}, HL: {}, VN: {}, has: {}, seen: 0, types: new Set() }).vnBars = list; renderOpt(); }
        else { S.barMap = {}; S.barKey = ""; S.barUp = S.barDn = ""; }
        log(`Learned server barriers: ${list.join(" ")}`); S.quoteBlock = Date.now() + 1500; return;
    }
    if (/invalid contract type/i.test(msg) && Date.now() - S.badTypeAt > 2000) {
        S.badTypeAt = Date.now();
        if (O.mode === "HL" && !S.hlLegacy) { S.hlLegacy = true; S.quoteBlock = 0; log("HIGHER/LOWER rejected → retrying with CALL/PUT + barrier.", "warn"); return void armSoon(); }
        if (O.mode === "HL") S.hlLegacy = false;
        toast(`${rq?.contract_type || "This contract"} is not offered on ${S.sym} — pick another market or mode.`, 5000, "bad"); S.quoteBlock = Date.now() + 60000;
    }
}
function multFallback(sym) {
    const v = Number((/\d+/.exec(String(sym || "").replace(/^1HZ/, "")) || [100])[0]);
    const M = { 10: [400, 1000, 2000, 3000, 4000], 25: [160, 400, 800, 1200, 1600], 50: [80, 200, 400, 600, 800], 75: [50, 100, 200, 300, 400], 100: [40, 100, 200, 300, 400] };
    return M[v] || M[100];
}
const multList = () => S.specs[S.sym]?.mult || multFallback(S.sym);
function fixMult() { const l = gggggggg ggggggggggggggggggggggggggggggggggggggggggggggg multList(); if (!l.includes(O.mult)) { O.mult = l[Math.floor(l.length / 2)]; saveO(); renderOpt(); } }
function vnBarrier() {
    const l = S.specs[S.sym]?.vnBars; if (!l || !l.length) return O.vnBar || "+0.00";
    if (l.includes(O.vnBar)) return O.vnBar;
    return l.slice().sort((a, b) => Math.abs(parseFloat(a)) - Math.abs(parseFloat(b)))[0];
}

/* ---- one place that builds every proposal ---- */
function propReq(side, st) {
    const up = side === "RISE", b = { proposal: 1, amount: st, basis: "stake", currency: S.cur, underlying_symbol: S.sym };
    if (O.mode === "MU") {
        const lo = {}; if (O.tp > 0) lo.take_profit = round2(O.tp); if (O.sl > 0) lo.stop_loss = round2(O.sl);
        return Object.assign(b, { contract_type: up ? "MULTUP" : "MULTDOWN", multiplier: O.mult }, Object.keys(lo).length ? { limit_order: lo } : {});
    }
    Object.assign(b, { duration: dur(), duration_unit: unit() });
    if (O.mode === "HL") return Object.assign(b, { contract_type: hlType(side), barrier: (up ? S.barUp : S.barDn) || (up ? "+0" : "-0") });
    if (O.mode === "VN") return Object.assign(b, { contract_type: up ? "VANILLALONGCALL" : "VANILLALONGPUT", barrier: vnBarrier() });
    return Object.assign(b, { contract_type: RF[side] });
}
const qKey = st => `${S.sym}|${st}|${S.cur}|${O.mode}|${O.mode === "MU" ? `${O.mult}|${O.tp}|${O.sl}` : `${unit()}${dur()}|${O.mode === "HL" ? S.barUp + S.barDn : O.mode === "VN" ? vnBarrier() : ""}`}|${RF.RISE}|${S.hlLegacy ? 1 : 0}`;
function minPayFail(p) {
    if (O.mode === "RF") return p.ratio < SG.minPayout - 0.005;
    if (O.mode === "HL" && O.hlMode === "payout") return p.ratio < O.hlPay * 0.9;
    return false;
}

/* ---- Higher/Lower barrier from the payout you asked for ---- */
const barList = msg => { const m = /barriers? available (?:are|is)[:\s]+(.+)/i.exec(msg || ""), l = m ? m[1].match(/[+-]?\d+(?:\.\d+)?/g) : null; return l && l.length ? l.map(s => /^[+-]/.test(s) ? s : "+" + s) : null; };
async function probe(side, barrier, st) {
    const r = await sendWS(Object.assign(propReq(side, st), { barrier }), { timeout: 5000, type: "barrier probe" });
    const ask = Number(r.proposal?.ask_price), pay = Number(r.proposal?.payout);
    if (!(ask > 0) || !(pay > 0)) throw new Error("probe quote invalid");
    return pay / ask;
}
/* Barrier discovery: probe once; if the server answers with its own barrier list ("Barriers available are …") use that,
   otherwise walk a ladder of offsets. Every candidate is quoted and the one closest to your target payout wins. */
async function solveBar(st) {
    const mode = O.hlMode, tg = O.hlPay, ck = `${S.sym}|${unit()}${dur()}|${mode === "payout" ? tg : O.hlOff}`, hit = S.barMap[ck];
    if (hit && Date.now() - hit.at < 300000) return hit;
    const sig = std(deltas(S.ticks.slice(-300))) || 0.01, steps = Math.max(1, durSec() / tickSec()), minB = Math.pow(10, -dec());
    const seed = mode === "offset" ? Math.max(minB, O.hlOff) : Math.max(minB, sig * Math.sqrt(steps) * 0.6);
    const fmt = (sg, v) => sg + Math.max(minB, v).toFixed(dec());
    let list = null, cur = null, lastErr = null;
    for (const k of [1, 0.5, 2, 0.25, 4, 1.37]) {
        const off = Math.max(minB, Number((seed * k).toFixed(dec())));
        try { cur = { off, r: await probe("RISE", fmt("+", off), st) }; break; }
        catch (e) { lastErr = e; if ((list = barList(e.message))) break; if (!/barrier|minimum|maximum|too |exceed|at least|at most/i.test(e.message)) throw e; }
    }
    if (!list && !cur) throw lastErr || new Error("no barrier accepted");
    let up, dn, r = 0;
    if (!list) {
        let best = cur, lo = null, hi = null;
        for (let i = 0; i < 6 && mode === "payout" && Math.abs(cur.r - tg) / tg >= 0.03; i++) {
            if (cur.r < tg) lo = cur; else hi = cur;
            let nx;
            if (lo && hi && hi.off > lo.off) { const f = (Math.log(tg) - Math.log(lo.r)) / ((Math.log(hi.r) - Math.log(lo.r)) || 1); nx = lo.off + (hi.off - lo.off) * clamp(f, 0.1, 0.9); }
            else nx = cur.off * clamp(Math.pow(tg / cur.r, 1.4), 0.4, 2.5);
            nx = Math.max(minB, Number(nx.toFixed(dec()))); if (nx === cur.off) break;
            try { const rr = await probe("RISE", fmt("+", nx), st); cur = { off: nx, r: rr }; if (Math.abs(rr - tg) < Math.abs(best.r - tg)) best = cur; }
            catch (e) { list = barList(e.message); break; }
        }
        if (!list) {
            up = fmt("+", best.off); dn = fmt("-", best.off); r = best.r;
            try { await probe("FALL", dn, st); } catch (e) { if (!(list = barList(e.message))) throw e; }   // the LOWER side must be valid too
        }
    }
    if (list) {
        const dg = (/\.(\d+)/.exec(list[0]) || [])[1]; if (dg) S.pip[S.sym] = dg.length;
        const ups = list.filter(x => parseFloat(x) > 0), dns = list.filter(x => parseFloat(x) < 0);
        if (!ups.length || !dns.length) throw new Error("server offered no usable barriers");
        if (mode === "offset") {
            const near = a => a.slice().sort((x, y) => Math.abs(Math.abs(parseFloat(x)) - O.hlOff) - Math.abs(Math.abs(parseFloat(y)) - O.hlOff))[0];
            up = near(ups); dn = near(dns); r = 0;
        } else {
            const pick = async (arr, side) => {
                const rs = (await Promise.all(arr.map(b => probe(side, b, st).then(x => ({ b, r: x }), () => null)))).filter(Boolean);
                if (!rs.length) throw new Error("no quotable barrier");
                return rs.sort((x, y) => Math.abs(x.r - tg) - Math.abs(y.r - tg))[0];
            };
            const [u, d] = await Promise.all([pick(ups, "RISE"), pick(dns, "FALL")]);
            up = u.b; dn = d.b; r = (u.r + d.r) / 2;
        }
    }
    const out = { up, dn, r, at: Date.now() }; S.barMap[ck] = out;
    log(`Barriers ${S.sym}: ${out.up} / ${out.dn}${out.r ? ` → ≈${out.r.toFixed(2)}x (target ${tg}x)` : ""}`);
    return out;
}
async function ensureBar(st) {
    if (O.mode !== "HL") return;
    const key = `${S.sym}|${unit()}${dur()}|${O.hlMode}|${O.hlPay}|${O.hlOff}`;
    if (S.barKey !== key || !S.barUp) { const b = await solveBar(st); S.barUp = b.up; S.barDn = b.dn; S.bar = Math.abs(parseFloat(b.up)); S.barKey = key; }
    set("oBarRead", `${S.barUp} / ${S.barDn}`);
}

/* ---- timeframe candles carrying their own EMA / Supertrend / StochRSI ---- */
function rebuildCS() {
    const tf = TFS[V.tf]; S.cs = []; if (!tf || !S.ticks.length) return;
    let cur = null;
    for (const t of S.ticks) {
        const b = Math.floor(t.e / tf) * tf;
        if (!cur || cur.e !== b) { cur = { e: b, q: t.q, o: t.q, h: t.q, l: t.q }; S.cs.push(cur); }
        else { cur.q = t.q; if (t.q > cur.h) cur.h = t.q; if (t.q < cur.l) cur.l = t.q; }
    }
    buildInd(S.cs);
}
function updateCS(t) {
    const tf = TFS[V.tf]; if (!tf) return;
    const C = S.cs, b = Math.floor(t.e / tf) * tf, last = C[C.length - 1];
    if (last && last.e === b) { last.q = t.q; if (t.q > last.h) last.h = t.q; if (t.q < last.l) last.l = t.q; }
    else { C.push({ e: b, q: t.q, o: t.q, h: t.q, l: t.q }); if (C.length > MAX_TICKS) C.shift(); }
    calcInd(C, C.length - 1);
}

/* ---- trade-option panel (under the chart) ---- */
function renderOpt() {
    const el = $("optRow"); if (!el) return;
    document.querySelectorAll("#modeBtns [data-m]").forEach(b => b.classList.toggle("on", b.dataset.m === O.mode));
    const u = unit(), [a, b] = durLimits(O.mode, u), d = dur();
    const seg = `<div class="useg">${(UNITS[O.mode] || []).map(x => `<button data-u="${x}" class="${x === u ? "on" : ""}" title="${UL[x]}">${x}</button>`).join("")}</div>`;
    const chips = `<div class="chips">${CHIPS[u].filter(v => v >= a && v <= b).map(v => `<button data-d="${v}" class="${v === d ? "on" : ""}">${v}</button>`).join("")}<input type="number" id="oDur" min="${a}" max="${b}" value="${d}" title="Duration in ${UL[u]}"></div>`;
    let h = "";
    if (O.mode === "RF") h = seg + chips;
    else if (O.mode === "HL") {
        h = seg + chips + `<label>Barrier<select id="oHlMode"><option value="payout"${O.hlMode === "payout" ? " selected" : ""}>by payout</option><option value="offset"${O.hlMode === "offset" ? " selected" : ""}>fixed offset</option></select></label>`
          + (O.hlMode === "payout" ? `<label>Payout ×<input type="number" id="oHlPay" min="1.1" max="50" step="0.1" value="${O.hlPay}"></label>` : `<label>Offset<input type="number" id="oHlOff" min="0" step="any" value="${O.hlOff}"></label>`)
          + `<span class="tag" id="oBarRead">${S.barUp ? `${S.barUp} / ${S.barDn}` : "—"}</span>`;
    } else if (O.mode === "MU") {
        const l = multList();
        h = `<label>Multiplier<select id="oMult">${l.map(v => `<option value="${v}"${v === O.mult ? " selected" : ""}>×${v}</option>`).join("")}</select></label>`
          + `<label>TP $<input type="number" id="oTp" min="0" step="0.01" placeholder="off" value="${O.tp || ""}"></label><label>SL $<input type="number" id="oSl" min="0" step="0.01" placeholder="off" value="${O.sl || ""}"></label>`;
    } else {
        const l = S.specs[S.sym]?.vnBars || [], cur = vnBarrier();
        h = seg + chips + (l.length ? `<label>Strike<select id="oVn">${l.map(v => `<option${v === cur ? " selected" : ""}>${v}</option>`).join("")}</select></label>` : `<span class="tag">strike: auto</span>`);
    }
    el.innerHTML = h;
}
function optChanged() { S.barKey = ""; S.barBlock = 0; S.quoteBlock = 0; saveO(); disarm(); renderOpt(); ui(); armSoon(150); reeval(); }
function setDur(v) { const [a, b] = durLimits(O.mode, unit()); DM().v = clamp(Math.floor(num(v, a)), a, b); optChanged(); }
function setUnit(u) { const [a, b] = durLimits(O.mode, u); DM().u = u; DM().v = CHIPS[u].find(v => v >= a && v <= b) || a; optChanged(); }
function setMode(m) {
    if (m === O.mode) return;
    if (inTrade() || S.busy) return void toast("Locked while a trade is active.", 2000, "bad");
    if (SG.auto) autoOff("TRADE OPTION CHANGED — set its values, then re-enable AUTO");
    O.mode = m; S.bar = 0; optChanged();
    if (m === "VN" && S.exec === "PAPER") toast("Vanillas have no paper mode — use LIVE on a demo account.", 3500, "bad");
}
function wireOpt() {
    $("modeBtns").addEventListener("click", ev => { const b = ev.target.closest("[data-m]"); if (b) setMode(b.dataset.m); });
    const oe = $("optRow");
    oe.addEventListener("click", ev => {
        const u = ev.target.closest("[data-u]"); if (u) return setUnit(u.dataset.u);
        const d = ev.target.closest("[data-d]"); if (d) setDur(Number(d.dataset.d));
    });
    oe.addEventListener("change", ev => {
        const e = ev.target;
        switch (e.id) {
            case "oDur": return setDur(e.value);
            case "oHlMode": O.hlMode = e.value; break;
            case "oHlPay": O.hlPay = clamp(num(e.value, 2.5), 1.1, 50); break;
            case "oHlOff": O.hlOff = Math.max(0, num(e.value, 0.5)); break;
            case "oMult": O.mult = Number(e.value); break;
            case "oTp": O.tp = Math.max(0, num(e.value, 0)); break;
            case "oSl": O.sl = Math.max(0, num(e.value, 0)); break;
            case "oVn": O.vnBar = e.value; break;
            default: return;
        }
        optChanged();
    });
    $("amChip").addEventListener("click", () => setAM(!AM.on));
    $("tcClose").addEventListener("click", sellNow);
    renderOpt();
}

/* ---- entry trigger presets ---- */
function applyTrig(v) {
    SG.trig = v; const R = SG.req;
    if (v === "XCROSS") { Object.assign(R, { t5: 0, t1: 0, cross: 0, srsi: 0, st: 0, xc: 1, zone: 0, zt: 0, vol: 1, chop: 0 }); SG.minQ = 0; }
    else if (v === "ZONE") {
        if (!P.zOn) { P.zOn = true; applyParams(); }
        if (SG.zMode === "OFF") SG.zMode = "BOTH";
        Object.assign(R, { t5: 1, t1: 0, cross: 0, srsi: 0, st: 0, xc: 0, zone: 0, zt: 1, vol: 1, chop: 0 }); SG.minQ = 0;
    } else return applyPreset(PRESETS[SG.preset] ? SG.preset : "BALANCED");
    SG.preset = "CUSTOM"; sgChanged(false);
}

/* ---- market auto-select ---- */
function setAM(on) {
    AM.on = on; saveAM(); S.amNext = 0; S.amOut = 0; ui(); syncPSig();
    log(`Market auto-select ${on ? `ON · ${AMCAT[AM.cat].n} ${AMCAT[AM.cat].r.join("–")}%` : "OFF"}`, on ? "trade" : "info");
    toast(`Market auto-select ${on ? "ON" : "OFF"}`, 1800, on ? "ok" : "");
}
async function autoSelect(why) {
    if (!AM.on || !ready() || inTrade() || S.busy || S.switching || S.scanning || S.amBusy) return;
    S.amBusy = true;
    try {
        await scan(`auto-select · ${why}`);
        if (!AM.on || inTrade() || S.busy) return;
        const [a, b] = AMCAT[AM.cat].r, pool = S.rank.filter(r => r.score >= a && r.score <= b);
        S.amNext = Date.now() + AM.every * 1000;
        if (!pool.length) { log(`Auto-select: nothing in ${AMCAT[AM.cat].n} (${a}–${b}%) — staying on ${S.sym}.`, "warn"); return; }
        const pick = pool.find(r => r.sym === S.sym) || pool[0];
        if (pick.sym !== S.sym) { log(`Auto-select → ${pick.sym} (score ${pick.score})`, "trade"); toast(`Market → ${pick.sym} · Q ${pick.score}`, 2200, "ok"); await useMarket(pick.sym); }
    } finally { S.amBusy = false; }
}
function amTick() {
    if (!AM.on || !ready() || inTrade() || S.busy || S.switching || S.scanning || S.amBusy || S.unconfirmedUntil) return;
    const now = Date.now();
    if (now >= S.amNext) return void autoSelect("timer");
    const sc = S.res?.score, [a, b] = AMCAT[AM.cat].r;
    if (sc != null && (sc < a || sc > b)) { S.amOut = S.amOut || now; if (now - S.amOut > 30000 && now - S.rankAt > 45000) { S.amOut = 0; autoSelect("conditions changed"); } }
    else S.amOut = 0;
}

async function boot() {
    wire(); ui(); contractUI(true); renderTrades(); renderHud(); link("off"); redraw();
    set("ver", "v3.2"); setInterval(amTick, 4000);
    log("PSYCHIC WINNER Manual Pro ready. PAPER by default — switch to LIVE when you are ready.");
    log("Keys: R / ↑ = RISE · F / ↓ = FALL · M = full screen · Esc = cancel / close.");
    await oauthCallback();
    if (authValid()) connect();
    else if ($("loginCard").hidden) showLogin();
}
boot();
