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

const MAX_BARS = 1500;
const FACT = [["t5", "TRD"], ["t1", "SHT"], ["cross", "EMA"], ["x2", "EMA+ST"], ["zp", "ZONE▸"], ["srsi", "SRSI"], ["st", "ST"], ["zone", "ROOM"], ["vol", "VOL"], ["chop", "CHOP"]];
const FACT_LAB = Object.fromEntries(FACT), TRIGS = ["cross", "x2", "zp"];
const FACT_NAME = { t5: "Main trend agrees", t1: "Short trend agrees", cross: "EMA cross (price × EMA)", x2: "EMA + ST cross together", zp: "Zone play (break / entry)", srsi: "StochRSI turn", st: "Supertrend side agrees", zone: "Zone room (S/D clear ahead)", vol: "Volatility band", chop: "Not choppy" };

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
    SAFE: { req: { t5: 1, t1: 1, cross: 1, srsi: 1, st: 1, zone: 1, vol: 1, chop: 1, x2: 0, zp: 0 }, z5Min: 1.2, z1Min: 0.6, holdMin: 3, crossMin: 0.2, crossWin: 2, maxFlips: 2, volCap: 1.6, volMin: 0.5, zoneRoom: 1, srLow: 30, minQ: 70 },
    BALANCED: { req: { t5: 1, t1: 1, cross: 1, srsi: 0, st: 0, zone: 1, vol: 1, chop: 1, x2: 0, zp: 0 }, z5Min: 1, z1Min: 0.5, holdMin: 3, crossMin: 0.15, crossWin: 2, maxFlips: 3, volCap: 1.8, volMin: 0.5, zoneRoom: 1, srLow: 30, minQ: 55 },
    FAST: { req: { t5: 1, t1: 0, cross: 1, srsi: 0, st: 0, zone: 0, vol: 1, chop: 0, x2: 0, zp: 0 }, z5Min: 0.8, z1Min: 0.3, holdMin: 2, crossMin: 0.1, crossWin: 3, maxFlips: 4, volCap: 2.2, volMin: 0.4, zoneRoom: 0.8, srLow: 35, minQ: 0 }
};
const SIGKEYS = ["z5Min", "z1Min", "holdMin", "crossMin", "crossWin", "dualWin", "zWin", "maxFlips", "volCap", "volMin", "zoneRoom", "srLow", "minQ"];
const SG = Object.assign({ preset: "BALANCED", ...clone(PRESETS.BALANCED), auto: false, sound: true, cooldown: 10, maxTrades: 0, takeProfit: 20, maxLoss: -20, minPayout: 1.8, rev: false, trigMode: "ALL", zpMode: "BOTH", dualWin: 10, zWin: 6 }, ls.get("pw3-sg", {}));
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
    B: [], bgen: 0, qErr: "", bar: null, barP: null, hlLegacy: false, lastPL: null, multFix: "", pl: 0, wins: 0, losses: 0, trades: 0, autoTrades: 0, ratio: 1.9, marks: [], hist: [], res: null, zones: [], zN: 0, sigOk: false, sigCool: 0, execMs: null
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
const dec = () => DEC[S.sym] ?? 2;
const wsOpen = () => Boolean(S.ws && S.ws.readyState === WebSocket.OPEN);
const ready = () => S.authed && wsOpen();
const inTrade = () => Boolean(S.contract || S.paper);
const stake = () => Math.max(0.35, round2(S.stake));
const dur = () => clamp(Math.floor(S.dur), 5, 10);
const std = a => {
    if (a.length < 2) return 0;
    const m = a.reduce((s, x) => s + x, 0) / a.length;
    return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
};
const deltas = T => T.slice(1).map((t, i) => t.q - T[i].q);
const lb = (T, e) => { let a = 0, b = T.length; while (a < b) { const m = (a + b) >> 1; if (T[m].e < e) a = m + 1; else b = m; } return a; };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/* ---------- TRADE OPTION: Rise/Fall (Call/Put) · Higher/Lower · Multiplier ---------- */
const KD = { type: "RF", unit: "t", dv: 5, eq: false, mult: 100, tp: 0, sl: 0, hl: { mode: "manual", barrier: 0.5, target: 1.9 } };
const K = Object.assign({}, KD, ls.get("pw3-k", {})); K.hl = Object.assign({}, KD.hl, K.hl);
if (ls.get("pw3-k", null) === null) K.dv = clamp(Math.floor(num(ls.get("pw3-dur", 5), 5)), 1, 10);
const AS = Object.assign({ cat: "high" }, ls.get("pw3-as", {}), { on: false, t: 0, bad: 0, last: 0, busy: false });   // auto-select market (always starts OFF)
const CATS = {
    vhigh: ["VERY HIGH · 75+", s => s >= 75], high: ["HIGH · 56–74", s => s >= 56 && s < 75], med: ["MEDIUM · 50–55", s => s >= 50 && s < 56],
    low: ["LOW · 25–49", s => s >= 25 && s < 50], vlow: ["VERY LOW · under 25", s => s < 25]
};
const inCat = (s, c) => Boolean(CATS[c]?.[1](s));
const SIDES = { RF: ["RISE", "FALL"], HL: ["HIGHER", "LOWER"], MULT: ["UP", "DOWN"] };
const KSHORT = { RF: "R/F", HL: "H/L", MULT: "MULT" };
const sideOf = (type, d) => SIDES[type || K.type][d === "RISE" ? 0 : 1];
const tickSec = () => (/^1HZ/.test(S.sym || "") ? 1 : 2);
const DLIM = { t: [1, 10], s: [15, 3599], m: [1, 1439], h: [1, 23] };
const DPRE = { t: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], s: [15, 30, 45, 60, 90, 120], m: [1, 2, 3, 5, 10, 15, 30, 60], h: [1, 2, 3, 4, 6, 8, 12] };
const UNAME = { t: "Ticks", s: "Seconds", m: "Minutes", h: "Hours" };
const durSecs = (k = K) => (k.unit === "t" ? k.dv * tickSec() : k.unit === "s" ? k.dv : k.unit === "m" ? k.dv * 60 : k.dv * 3600);
const durText = (k = K) => (k.unit === "t" ? `${k.dv} tick${k.dv > 1 ? "s" : ""}` : `${k.dv}${k.unit}`);
// how many chart steps (ticks or candles) the contract spans: scales the zone-room test to the chart timeframe in use
const durSteps = () => { const tf = TFS[V.tf]; return K.type === "MULT" ? 10 : Math.max(1, durSecs() / (tf || tickSec())); };
const kLabel = () => (K.type === "MULT" ? `Multiplier ×${K.mult}` : `${K.type === "HL" ? "Higher/Lower" : K.eq ? "Call/Put (=)" : "Rise/Fall"} · ${durText()}`);
const optSnap = () => ({ type: K.type, unit: K.unit, dv: K.dv, mult: K.mult, tp: K.tp, sl: K.sl, eq: K.eq });
const MULTS = { 10: [400, 1000, 2000, 3000, 4000], 25: [160, 400, 800, 1200, 1600], 50: [80, 200, 400, 600, 800], 75: [50, 100, 200, 300, 500], 100: [40, 100, 200, 300, 500] };
function multList(sym) {
    const n = Number((/(\d+)/.exec(String(sym || "R_100").replace("1HZ", "")) || [])[1]) || 100;
    const k = Object.keys(MULTS).map(Number).reduce((a, b) => (Math.abs(b - n) < Math.abs(a - n) ? b : a));
    return MULTS[k];
}
function snapMult() {
    const L = multList(S.sym); if (L.includes(K.mult)) return;
    K.mult = L.reduce((a, b) => (Math.abs(b - K.mult) < Math.abs(a - K.mult) ? b : a)); ls.set("pw3-k", K);
}
const HLT = () => (S.hlLegacy ? { up: "CALL", dn: "PUT" } : { up: "HIGHER", dn: "LOWER" });
const barStr = (up, o) => { const v = up ? o : -o; return `${v < 0 ? "-" : "+"}${Math.abs(v).toFixed(dec())}`; };
const barKey = () => `${S.sym}|${stake()}|${K.unit}${K.dv}|${K.hl.target}|${S.hlLegacy ? "L" : "H"}`;
const curBar = () => (K.hl.mode === "payout" ? (S.bar && S.bar.key === barKey() ? S.bar.o : null) : num(K.hl.barrier, 0.5));
// ONE place that builds every proposal, for every contract family
function quoteReq(side, st, bar) {
    const up = side === "RISE", r = { proposal: 1, amount: st, basis: "stake", currency: S.cur, underlying_symbol: S.sym };
    if (K.type === "MULT") {
        r.contract_type = up ? "MULTUP" : "MULTDOWN"; r.multiplier = K.mult;
        const lo = {}; if (K.tp > 0) lo.take_profit = K.tp; if (K.sl > 0) lo.stop_loss = K.sl;
        if (Object.keys(lo).length) r.limit_order = lo;
    } else {
        r.duration = K.dv; r.duration_unit = K.unit;
        if (K.type === "HL") { r.contract_type = up ? HLT().up : HLT().dn; r.barrier = barStr(up, bar ?? curBar() ?? 0.5); }
        else r.contract_type = RF[side] + (K.eq ? "E" : "");
    }
    return r;
}
const specKey = () => [S.sym, stake(), S.cur, K.type,
    K.type === "MULT" ? `${K.mult}|${K.tp}|${K.sl}` : `${K.unit}${K.dv}`,
    K.type === "HL" ? `${K.hl.mode === "manual" ? "m" + K.hl.barrier : "p" + K.hl.target}${S.hlLegacy ? "L" : ""}` : K.type === "RF" ? `${K.eq ? 1 : 0}${RF.RISE}` : ""].join("|");

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
function frameStats(T, sec, minN = 10) {
    if (T.length < minN) return null;
    const f = T.slice(lb(T, T[T.length - 1].e - sec));
    if (f.length < minN) return null;
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
    const need = sig * Math.sqrt(durSteps()) * SG.zoneRoom;
    const inDem = Z.some(z => z.t === "D" && p >= z.lo && p <= z.hi), inSup = Z.some(z => z.t === "S" && p >= z.lo && p <= z.hi);
    const side = dir > 0 ? "S" : "D";
    if (dir > 0 ? inSup : inDem) return { ok: false, txt: dir > 0 ? "in supply" : "in demand", d: 0 };
    let d = Infinity;
    for (const z of Z) if (z.t === side) { const x = dir > 0 ? z.lo - p : p - z.hi; if (x > 0) d = Math.min(d, x); }
    if (d < need) return { ok: false, txt: `${side === "S" ? "supply" : "demand"} ${(d / sig).toFixed(1)}σ`, d };
    const bonus = dir > 0 ? inDem : inSup;
    return { ok: true, bonus, txt: bonus ? (dir > 0 ? "in demand ✓" : "in supply ✓") : d === Infinity ? "clear" : `room ${(d / sig).toFixed(0)}σ`, d };
}
/* Zone play. Breaks: price closes through a zone (directly, or by a retest-bounce of the broken edge).
   Entries: price drops into a DEMAND zone (→ BUY) / rallies into a SUPPLY zone (→ SELL) the moment it is inside.
   Returns { 1: "why"|null, -1: "why"|null } (1 = buy side, -1 = sell side). */
function zonePlay(T, Z, sig) {
    const out = { 1: null, "-1": null }, n = T.length, W = SG.zWin, md = SG.zpMode; if (n < 50 || !Z.length) return out;
    const q = i => T[n - 1 - i].q;
    const crossUp = (lv, w) => { if (q(0) <= lv) return false; for (let i = 0; i < w && i + 1 < n; i++) if (q(i) > lv && q(i + 1) <= lv) return true; return false; };
    const crossDn = (lv, w) => { if (q(0) >= lv) return false; for (let i = 0; i < w && i + 1 < n; i++) if (q(i) < lv && q(i + 1) >= lv) return true; return false; };
    const lowest = w => { let m = Infinity; for (let i = 0; i < w; i++) m = Math.min(m, q(i)); return m; };
    const highest = w => { let m = -Infinity; for (let i = 0; i < w; i++) m = Math.max(m, q(i)); return m; };
    for (const z of Z) {
        const inz = q(0) >= z.lo && q(0) <= z.hi;
        if (z.t === "S") {
            if (md !== "ENTRY") {                                           // supply broken upward → BUY
                if (crossUp(z.hi, W)) out[1] = out[1] || "supply break ↑";
                else if (q(0) > z.hi + 0.1 * sig && q(0) > q(1) && crossUp(z.hi, 40) && lowest(W) <= z.hi + 0.4 * sig) out[1] = out[1] || "supply retest ↑";
            }
            if (md !== "BREAK" && inz) { for (let i = 1; i < 5 && i < n; i++) if (q(i) < z.lo) { out[-1] = out[-1] || "into supply ▼"; break; } }
        } else {
            if (md !== "ENTRY") {                                           // demand broken downward → SELL
                if (crossDn(z.lo, W)) out[-1] = out[-1] || "demand break ↓";
                else if (q(0) < z.lo - 0.1 * sig && q(0) < q(1) && crossDn(z.lo, 40) && highest(W) >= z.lo - 0.4 * sig) out[-1] = out[-1] || "demand retest ↓";
            }
            if (md !== "BREAK" && inz) { for (let i = 1; i < 5 && i < n; i++) if (q(i) > z.hi) { out[1] = out[1] || "into demand ▲"; break; } }
        }
    }
    return out;
}
/* Price crossed the EMA AND the Supertrend line the same way within `win` steps (the ST flips colour when price crosses it) */
function dualCross(T, dir, win) {
    const L = T.length - 1; let e = -1, s = -1;
    for (let i = 0; i < win && i + 1 <= L; i++) {
        const a = T[L - i], b = T[L - i - 1];
        if (e < 0 && dir * (a.q - a.m) > 0 && dir * (b.q - b.m) <= 0) e = i;
        if (s < 0 && a.sdir === dir && b.sdir === -dir) s = i;
    }
    return e >= 0 && s >= 0 && T[L].sdir === dir && dir * (T[L].q - T[L].m) > 0 ? { age: Math.max(e, s) } : null;
}
/* tfs = seconds per candle of the displayed timeframe (0 = tick chart). Everything below runs on THAT series. */
function analyze(T, Z, tfs = 0) {
    const n = T.length; if (n < 70) return null;
    const mn = tfs ? 6 : 10, f5 = frameStats(T, Math.max(300, 40 * tfs), mn), f1 = frameStats(T, Math.max(60, 10 * tfs), mn); if (!f5 || !f1) return null;
    const Dl = deltas(T.slice(-130)), sig = std(Dl.slice(-60)); if (!sig) return null;
    const vol = std(Dl.slice(-20)) / (std(Dl) || 1), trend = f5.z >= 0 ? 1 : -1, L = n - 1;
    const q = i => T[L - i].q, m = i => T[L - i].m, K_ = i => T[L - i].k, Dd = i => T[L - i].dd;
    const zpl = P.zOn ? zonePlay(T, Z, sig) : { 1: null, "-1": null };
    const volOk = vol <= SG.volCap && vol >= SG.volMin;
    let flips = 0; for (let i = 0; i < 30 && i + 1 <= L; i++) if ((q(i) > m(i)) !== (q(i + 1) > m(i + 1))) flips++;
    const evalDir = dir => {
        const side = i => dir * (q(i) - m(i));
        let age = -1;                                                         // EMA cross in this direction within the last crossWin steps
        for (let i = 0; i < SG.crossWin && i + 1 <= L; i++) if (side(i) > 0 && side(i + 1) <= 0) { age = i; break; }
        let hold = 0; if (age >= 0) for (let i = age + 1; i <= age + 12 && i <= L; i++) { if (side(i) <= 0) hold++; else break; }
        const strength = side(0), slope = dir * (m(0) - m(Math.min(5, L))), crossed = age >= 0 && side(0) > 0;
        let ext = dir > 0 ? 100 : 0, turn = false;                            // Stochastic RSI turn after a pullback into the low/high band
        for (let i = 0; i <= 10 && i <= L; i++) ext = dir > 0 ? Math.min(ext, K_(i)) : Math.max(ext, K_(i));
        for (let i = 0; i < 4 && i + 1 <= L; i++) if (dir * (K_(i) - Dd(i)) > 0 && dir * (K_(i + 1) - Dd(i + 1)) <= 0) { turn = true; break; }
        const inZone = dir > 0 ? ext <= SG.srLow : ext >= 100 - SG.srLow, srOk = turn && inZone;
        const stOk = T[L].sdir === dir;
        const zc = P.zOn ? zoneCheck(Z, dir, q(0), sig) : { ok: true, txt: "off" };
        const z5 = Math.abs(f5.z), t5ok = Math.sign(f5.z) === dir, t1ok = Math.sign(f1.z) === dir;
        const dc = dualCross(T, dir, SG.dualWin), zv = zpl[dir];
        const rows = [
            { id: "t5", pass: t5ok && z5 >= SG.z5Min, val: `${f5.z >= 0 ? "▲" : "▼"} z ${f5.z.toFixed(2)}`, w: 0.2, c: t5ok ? Math.min(z5 / 2.5, 1) : 0 },
            { id: "t1", pass: t1ok && Math.abs(f1.z) >= SG.z1Min, val: `z ${f1.z.toFixed(2)}`, w: 0.1, c: t1ok ? Math.min(Math.abs(f1.z) / 1.5, 1) : 0 },
            {
                id: "cross", pass: crossed && hold >= SG.holdMin && strength >= SG.crossMin * sig && slope >= 0,
                val: crossed ? `${age}t ago · ${hold}t ${dir > 0 ? "below" : "above"}` : side(0) > 0 ? "riding EMA" : "pullback", w: 0.16,
                c: crossed ? Math.min(1, 0.6 + strength / (sig * 0.8) * 0.4) : side(0) > 0 ? 0.45 : side(0) > -3 * sig ? 0.55 : 0.2
            },
            { id: "x2", off: !SG.req.x2, pass: Boolean(dc), val: dc ? `${dc.age} ago` : stOk ? "ST agrees" : "no cross", w: 0.14, c: dc ? 1 : stOk ? 0.4 : 0.1 },
            { id: "zp", off: !SG.req.zp || !P.zOn, pass: Boolean(zv), val: zv || "—", w: 0.14, c: zv ? 1 : 0.2 },
            { id: "srsi", off: !P.srOn, pass: !P.srOn || srOk, val: P.srOn ? `K ${K_(0).toFixed(0)}` : "off", w: 0.12, c: srOk ? 1 : inZone ? 0.55 : 0.25 },
            { id: "st", off: !P.stOn, pass: !P.stOn || stOk, val: P.stOn ? (T[L].sdir > 0 ? "▲ up" : "▼ down") : "off", w: 0.08, c: stOk ? 1 : 0 },
            { id: "zone", off: !P.zOn, pass: zc.ok, val: zc.txt, w: 0.1, c: zc.ok ? (zc.bonus ? 1 : 0.7) : 0 },
            { id: "vol", pass: volOk, val: vol.toFixed(2), w: 0.08, c: volOk ? (vol >= 0.7 && vol <= 1.4 ? 1 : 0.6) : 0 },
            { id: "chop", pass: flips <= SG.maxFlips, val: `${flips} flips`, w: 0.08, c: flips <= 1 ? 1 : flips <= SG.maxFlips ? 0.6 : 0 }
        ];
        let sw = 0, sc = 0; rows.forEach(r => { if (!r.off) { sw += r.w; sc += r.w * r.c; } });
        const score = Math.round(100 * sc / (sw || 1)), act = rows.filter(r => !r.off);
        const tr = rows.filter(r => TRIGS.includes(r.id) && SG.req[r.id]);     // triggers = the entry EVENTS you ticked
        const trigOk = !tr.length || (SG.trigMode === "ANY" ? tr.some(r => r.pass) : tr.every(r => r.pass));
        const confOk = rows.every(r => TRIGS.includes(r.id) || r.off || !SG.req[r.id] || r.pass);
        const ok = trigOk && confOk && score >= SG.minQ;
        return {
            dir, f5, f1, sig, vol, rows, score, ok, passed: act.filter(r => r.pass).length, total: act.length, crossed, flips, k: K_(0), dd: Dd(0), sdir: T[L].sdir,
            zoneTxt: zc.txt, zoneOk: zc.ok, trig: rows.filter(r => TRIGS.includes(r.id) && !r.off && r.pass).map(r => r.id)
        };
    };
    const a = evalDir(trend), b = evalDir(-trend);
    return a.ok ? a : b.ok ? b : a;       // an event in either direction can fire; otherwise show the trend side
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
/* ---------- chart series: ticks, or candles of the displayed timeframe (signals run on whichever is displayed) ---------- */
const series = () => (TFS[V.tf] ? S.B : S.ticks);
function barsFromTicks(T, tf) {
    const out = []; let cur = null;
    for (const t of T) {
        const b = Math.floor(t.e / tf) * tf;
        if (!cur || cur.e !== b) { if (cur) out.push(cur); cur = { e: b, o: t.q, h: t.q, l: t.q, c: t.q, q: t.q }; }
        else { if (t.q > cur.h) cur.h = t.q; if (t.q < cur.l) cur.l = t.q; cur.c = cur.q = t.q; }
    }
    if (cur) out.push(cur);
    return out;
}
async function prepBars() {
    const tf = TFS[V.tf], g = ++S.bgen, sym = S.sym;
    if (!tf) { S.B = []; return; }
    if (tf >= 60 && sym && wsOpen()) {                                       // Deriv serves 1m / 5m candles natively: deep history
        try {
            const r = await sendWS({ ticks_history: sym, end: "latest", count: 900, style: "candles", granularity: tf }, { timeout: 12000, type: `candles ${sym}` });
            if (g !== S.bgen || sym !== S.sym) return;
            const B = (r.candles || []).map(c => ({ e: Number(c.epoch), o: Number(c.open), h: Number(c.high), l: Number(c.low), c: Number(c.close), q: Number(c.close) })).filter(b => Number.isFinite(b.q) && Number.isFinite(b.e));
            if (B.length > 80) { buildInd(B); S.B = B; return; }
        } catch (e) { log(`Candle history failed → ${e.message} (building from ticks)`, "warn"); }
    }
    if (g !== S.bgen) return;
    S.B = barsFromTicks(S.ticks, tf); buildInd(S.B);
}
function updateBars(q, e) {
    const tf = TFS[V.tf], B = S.B; if (!tf || !B.length) return;
    const b = Math.floor(e / tf) * tf, last = B[B.length - 1];
    if (last.e === b) { if (q > last.h) last.h = q; if (q < last.l) last.l = q; last.c = last.q = q; calcInd(B, B.length - 1); }
    else if (b > last.e) { B.push({ e: b, o: q, h: q, l: q, c: q, q }); calcInd(B, B.length - 1); if (B.length > MAX_BARS) B.shift(); }
}
const analyzeNow = () => { const A = series(); return A.length >= 70 ? analyze(A.length > 900 ? A.slice(-900) : A, S.zones, TFS[V.tf]) : null; };
async function setTF(tf) {
    V.tf = tf; V.span = SPAN[tf]; V.off = 0; V.ys = 1;
    document.querySelectorAll("#tfBtns [data-tf]").forEach(x => x.classList.toggle("on", x.dataset.tf === tf));
    set("tfNote", tf === "TICK" ? "signals: ticks" : `signals: ${tf} candles`);
    S.B = []; redraw();
    await prepBars();
    S.zones = P.zOn ? findZones(series()) : []; S.zN = 0; reeval();
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
    await disarm(); await dropTick();
    let T = [];
    try { T = await fetchHistory(sym, 3, 5000); } catch (e) { log(`History ${sym} failed → ${e.message}`, "warn"); }
    if (g !== S.gen) return false;
    buildInd(T);
    S.ticks = T; S.sym = sym; S.marks = []; S.res = null; S.zN = 0; S.sigOk = false; D.tmp = null; V.off = 0; S.bar = null; S.qErr = "";
    if (TFS[V.tf]) { await prepBars(); if (g !== S.gen) return false; }
    S.zones = P.zOn ? findZones(series()) : [];
    S.res = analyzeNow();
    ls.set("pw3-sym", sym);
    set("symName", `${sym} · ${NAMES[sym]}`);
    if (K.type === "MULT") { snapMult(); renderDock(); }
    try {
        const r = await sendWS({ ticks: sym, subscribe: 1 }, { timeout: 7000, type: `ticks ${sym}` });
        const id = r?.subscription?.id || null;
        if (g !== S.gen) { await forget(id); return false; }
        S.subTick = id; log(`Streaming ${sym} (${T.length} ticks loaded)`);
        renderRank(); renderHud(); redraw();
        return true;
    } catch (e) { log(`Tick subscription failed → ${e.message}`, "error"); return false; }
}
function onTick(m) {
    const t = m.tick;
    if (!t || t.symbol !== S.sym) return;
    const q = Number(t.quote), e = Number(t.epoch);
    if (!Number.isFinite(q) || !Number.isFinite(e)) return;
    const T = S.ticks, last = T[T.length - 1];
    if (last && e <= last.e) return;
    T.push({ q, e }); calcInd(T, T.length - 1);
    if (T.length > MAX_TICKS) T.shift();
    updateBars(q, e);
    S.lastTick = Date.now(); S.staleHits = 0;
    if (P.zOn && ++S.zN % 5 === 1) S.zones = findZones(series());
    S.res = analyzeNow();
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
                    const a = analyze(T, P.zOn ? findZones(T) : []);
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
function qErr(msg) { if (S.qErr !== msg) { S.qErr = msg; manualUI(); } }
function onProposal(m) {
    const p = m.proposal, pt = m.echo_req?.passthrough;
    if (!p || !pt || pt.g !== S.pgen) return;
    const side = pt.side;
    if (side !== "RISE" && side !== "FALL") return;
    if (K.type !== "MULT") {
        const sm = sideMatches(p.longcode, side);
        if (sm === false) { if (K.type === "RF") return void fixRF(); return void qErr("Quote side mismatch — not trading it"); }
    }
    const ask = Number(p.ask_price), payout = Number(p.payout);
    if (!p.id || !(ask > 0)) return;
    if (K.type !== "MULT" && !(payout > 0)) return;                    // multipliers have no fixed payout
    S.pp[side] = { id: String(p.id), ask, payout: payout > 0 ? payout : 0, ratio: payout > 0 ? payout / ask : 0, at: Date.now(), stake: num(m.echo_req.amount), dir: side, key: S.armKey };
    S.armFails = 0; S.qErr = ""; manualUI();
}
const fresh = (dir, st) => { const p = S.pp[dir]; return p && p.key === S.armKey && p.key === specKey() && Math.abs(p.stake - st) < 0.001 && Date.now() - p.at < (K.type === "MULT" ? 20000 : QUOTE_TTL) ? p : null; };
function armSoon(ms = 120) { clearTimeout(S.armTimer); S.armTimer = setTimeout(() => { S.armLock = S.armLock.then(syncArm).catch(() => { }); }, ms); }
async function disarm() {
    S.pgen++; const subs = Object.values(S.ppSub);
    S.ppSub = {}; S.pp = { RISE: null, FALL: null }; S.armKey = "";
    await Promise.all(subs.map(forget));
}
// quotes stay armed DURING a trade too, so the next entry after settlement is already one BUY round-trip away
const canArm = () => ready() && S.sym && S.subTick && !S.switching && !(S.busy && !inTrade());

/* Higher/Lower barrier from a TARGET PAYOUT: parallel probes bracket the payout curve, then a fine round interpolates it.
   Barrier distance is in price points (relative barrier), mirrored for the LOWER side. */
async function solveBar(st) {
    const sg = std(deltas(S.ticks.slice(-300))) || 0.5, steps = Math.max(1, durSecs() / tickSec()), base = sg * Math.sqrt(steps), T = K.hl.target;
    const rnd = v => +v.toFixed(Math.min(dec(), 4)); let firstErr = "";
    const run = async ms => (await Promise.all(ms.map(async mm => {
        const o = rnd(mm * base);
        try { const r = await sendWS(quoteReq("RISE", st, o), { timeout: 6000, type: "probe" }), a = Number(r.proposal?.ask_price), pay = Number(r.proposal?.payout); return a > 0 && pay > 0 ? { o, ratio: pay / a } : null; }
        catch (e) { firstErr = firstErr || e.message; return null; }
    }))).filter(Boolean).sort((a, b) => a.o - b.o);
    const interp = pts => {
        if (!pts.length) return null;
        if (T <= pts[0].ratio) return pts[0].o; if (T >= pts[pts.length - 1].ratio) return pts[pts.length - 1].o;
        for (let i = 1; i < pts.length; i++) if (T <= pts[i].ratio) { const a = pts[i - 1], b = pts[i], f = b.ratio === a.ratio ? 0 : (T - a.ratio) / (b.ratio - a.ratio); return a.o + f * (b.o - a.o); }
        return null;
    };
    const p1 = await run([-1.2, -0.5, -0.15, 0.15, 0.5, 1, 1.8, 3.2]);
    let o = interp(p1); if (o === null) throw new Error(firstErr || "no barrier quotes");
    const m1 = o / base, spread = Math.max(0.3, Math.abs(m1)), p2 = await run([-0.12, -0.06, 0.06, 0.12].map(k => m1 + k * spread));
    const o2 = interp([...p1, ...p2].sort((a, b) => a.o - b.o)); if (o2 !== null) o = o2;
    o = rnd(o); log(`Barrier for ${T.toFixed(2)}× payout on ${S.sym} → ${barStr(true, o)} / ${barStr(false, o)}`, "info");
    return o;
}
function ensureBar(st) {
    const key = barKey();
    if (S.bar && S.bar.key === key && Date.now() - S.bar.at < 120000) return Promise.resolve(S.bar.o);
    if (S.barP && S.barP.key === key) return S.barP.p;
    const p = solveBar(st).then(o => { S.bar = { key, o, at: Date.now() }; manualUI(); return o; }).finally(() => { if (S.barP && S.barP.key === key) S.barP = null; });
    S.barP = { key, p }; return p;
}
function quoteError(e) {
    const msg = String(e.message || "");
    if (K.type === "HL" && !S.hlLegacy && /contract.?type|not offered|invalid.*(type|contract)/i.test(msg)) { S.hlLegacy = true; S.bar = null; log("Higher/Lower via CALL/PUT + barrier (compat mode).", "warn"); return armSoon(60); }
    if (K.type === "MULT" && /multiplier/i.test(msg) && S.multFix !== msg) {          // Deriv lists the accepted multipliers in its error → snap to the nearest
        const nums = (msg.match(/\d{2,5}/g) || []).map(Number).filter(v => v !== K.mult);
        if (nums.length >= 2) { S.multFix = msg; K.mult = nums.reduce((a, b) => (Math.abs(b - K.mult) < Math.abs(a - K.mult) ? b : a)); ls.set("pw3-k", K); log(`Multiplier adjusted → ×${K.mult}`, "warn"); renderDock(); armSoon(60); }
    }
}
async function syncArm() {
    if (!canArm()) { if (S.armKey || Object.keys(S.ppSub).length) await disarm(); manualUI(); return; }
    const st = stake(), key = specKey();
    if (key === S.armKey) return;
    await disarm();
    S.armKey = key; const g = ++S.pgen; let bar;
    if (K.type === "HL" && K.hl.mode === "payout") {
        manualUI();
        try { bar = await ensureBar(st); } catch (e) { if (g === S.pgen) { S.armKey = ""; qErr(`Barrier: ${e.message}`); if (S.armFails++ < 3) log(`Barrier solve failed → ${e.message}`, "warn"); quoteError(e); } return; }
        if (g !== S.pgen) return;
    }
    await Promise.all(["RISE", "FALL"].map(async side => {
        try {
            const r = await sendWS({ ...quoteReq(side, st, bar), subscribe: 1, passthrough: { side, g } }, { timeout: 7000, type: "quote" });
            const id = r.subscription?.id || null;
            if (g !== S.pgen) return void (await forget(id));
            S.ppSub[side] = id;
        } catch (e) {
            if (g === S.pgen) { S.armKey = ""; qErr(e.message); if (S.armFails++ < 3) log(`Quote ${side} unavailable → ${e.message}`, "warn"); quoteError(e); }
        }
    }));
    manualUI();
}
async function oneShot(dir, st, retry = true) {          // fallback: single quote when no fresh pre-armed one exists
    let bar; if (K.type === "HL" && K.hl.mode === "payout") bar = await ensureBar(st);
    const r = await sendWS(quoteReq(dir, st, bar), { timeout: 5000, type: "quote" });
    const p = r.proposal;
    if (!p?.id) throw new Error("Proposal ID missing.");
    if (K.type !== "MULT" && sideMatches(p.longcode, dir) === false) {     // safety: never trade the opposite side
        if (!retry || K.type !== "RF") throw new Error("Contract side does not match the signal.");
        S.rfFixed = true; RF = { RISE: RF.FALL, FALL: RF.RISE };
        log(`Rise/Fall mapping corrected → RISE=${RF.RISE}, FALL=${RF.FALL}`, "warn");
        return oneShot(dir, st, false);
    }
    const ask = Number(p.ask_price), payout = Number(p.payout);
    if (!(ask > 0)) throw new Error("Invalid proposal price.");
    if (K.type !== "MULT" && !(payout > 0)) throw new Error("Invalid proposal payout.");
    return { id: String(p.id), ask, payout: payout > 0 ? payout : 0, ratio: payout > 0 ? payout / ask : 0, at: Date.now(), stake: st, dir };
}

/* ================================================================
   EXECUTION  (manual click and auto entry share ONE gate; same path for every contract family)
================================================================ */
async function execute(dir, src, res) {
    if (S.busy || inTrade() || S.switching || !ready() || !S.sym) return false;
    S.busy = true;
    const t0 = performance.now(), st = stake(), last = S.ticks[S.ticks.length - 1], opt = optSnap();
    manualUI();
    log(src === "auto" ? `AUTO ${sideOf(opt.type, dir)} · ${kLabel()} · ${S.sym} · Q ${res.score}${SG.rev ? " · REVERSED" : ""}` : `MANUAL ${sideOf(opt.type, dir)} · ${kLabel()} · ${S.sym}`, "trade");
    try {
        if (st > S.bal * 0.95 && S.exec === "LIVE") throw new Error("Stake exceeds balance protection.");
        const p = fresh(dir, st) || await oneShot(dir, st);
        S.pp[dir] = null;                                  // that quote id is consumed — the stream refills it within a second
        if (src === "auto" && opt.type !== "MULT" && p.ratio < SG.minPayout - 0.005) {
            log(`Payout ${p.ratio.toFixed(2)}x below minimum — skipped.`, "warn");
            S.busy = false; S.cool = Date.now() + 3000; manualUI(); return false;
        }
        if (last) S.marks.push({ k: "buy", e: last.e, q: last.q, dir });
        if (S.exec === "PAPER") startPaper(dir, p, src, opt);
        else {
            try { await buy(p, src, opt); }
            catch (e) {
                if (S.unconfirmedUntil || /timed out|closed|unavailable/i.test(e.message)) throw e;
                log("Quote moved — retrying once on a fresh quote.", "warn");
                await buy(await oneShot(dir, st), src, opt);
            }
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
async function buy(p, src, opt) {
    log(`BUY ${sideOf(opt.type, p.dir)} · ${S.sym} · ${money(p.ask)}`, "trade");
    let r;
    try { r = await sendWS({ buy: p.id, price: Math.ceil(p.ask * (1 + SLIP) * 100) / 100, subscribe: 1 }, { timeout: 7000, type: "buy" }); }
    catch (e) {
        if (/timed out|closed|unavailable/i.test(e.message)) { S.unconfirmedUntil = Date.now() + 30000; log("BUY unconfirmed — trading paused 30s; check your Deriv statement.", "warn"); }
        throw e;
    }
    const id = Number(r.buy?.contract_id);
    if (!Number.isInteger(id) || id <= 0) throw new Error(`Invalid contract_id: ${r.buy?.contract_id}`);
    const t0 = num(r.buy.start_time) * 1000 || Date.now(), secs = opt.type === "MULT" ? 0 : durSecs(opt);
    S.contract = {
        id, dir: p.dir, opt, src, stake: num(r.buy.buy_price, p.ask), payout: num(r.buy.payout, p.payout), entry: NaN, ee: NaN, profit: 0, ticks: 0, status: "open", done: false,
        tstart: t0, secs, exp: secs ? t0 + secs * 1000 : NaN, sym: S.sym
    };
    S.subCon = r.subscription?.id || null;        // contract stream requested inside the BUY itself
    S.ratio = S.contract.payout > 0 ? S.contract.payout / S.contract.stake : 0; S.trades++;
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
    c.profit = f(k.profit, c.profit); c.status = k.status || c.status; c.bid = f(k.bid_price, c.bid);
    if (k.date_expiry) c.exp = Number(k.date_expiry) * 1000;
    if (k.date_start) c.tstart = Number(k.date_start) * 1000;
    c.ticks = Array.isArray(k.tick_stream) ? k.tick_stream.length : f(k.tick_count, c.ticks);
    contractUI(); redraw();
    const fin = Number(k.is_expired) === 1 || Number(k.is_sold) === 1 || ["won", "lost", "sold", "cancelled"].includes(String(k.status || "").toLowerCase());
    if (fin && !c.done) {
        c.done = true;
        const profit = f(k.profit, f(k.sell_price, 0) - f(k.buy_price, c.stake)), sub = S.subCon;
        S.subCon = null; S.contract = null; forget(sub);
        finish(profit, `CONTRACT ${c.id}`, c);
    }
}
/* close an open multiplier early (live: SELL at market · paper: settle at the current price) */
async function closeTrade() {
    const c = S.contract, p = S.paper;
    if (p) { if (p.opt.type === "MULT" && p.entry !== null) paperEnd(p.profit, "PAPER CLOSE"); return; }
    if (!c || c.closing || c.done) return;
    c.closing = true; $("tcClose").disabled = true;
    try {
        const r = await sendWS({ sell: c.id, price: 0 }, { timeout: 6000, type: "sell" });
        const sf = num(r.sell?.sold_for, NaN); log(`SELL requested → ${money(sf)}`, "trade");
        setTimeout(() => {                                   // normally the contract stream reports is_sold first; this is the safety net
            if (S.contract === c && !c.done) {
                c.done = true; const sub = S.subCon; S.subCon = null; S.contract = null; forget(sub);
                finish(Number.isFinite(sf) ? sf - c.stake : c.profit, `CONTRACT ${c.id}`, c);
            }
        }, 2500);
    } catch (e) { c.closing = false; $("tcClose").disabled = false; toast(`Close failed: ${e.message}`, 3000, "bad"); log(`SELL failed → ${e.message}`, "error"); }
}
function startPaper(dir, p, src, opt) {
    const ob = opt.type === "HL" ? (curBar() ?? 0.5) : 0;
    S.paper = { dir, src, opt, stake: p.ask, payout: p.payout, entry: null, ee: NaN, n: 0, secs: opt.type === "MULT" ? 0 : durSecs(opt), b: dir === "RISE" ? ob : -ob, profit: 0, t0: Date.now() };
    S.ratio = p.payout > 0 ? p.payout / p.ask : 0; S.trades++;
    log(`PAPER ${sideOf(opt.type, dir)} · ${kLabel()} · stake ${money(p.ask)}${p.payout ? ` · payout ${money(p.payout)}` : ""}`, "trade");
    contractUI(); ui();
}
function paperEnd(profit, label) {
    const x = S.paper; if (!x) return; S.paper = null;
    finish(round2(profit), label, x);
}
function paperTick(q, e) {
    const p = S.paper; if (!p) return;
    if (p.entry === null) { p.entry = q; p.ee = e; p.n = 0; contractUI(); return; }      // entry spot = first tick AFTER purchase
    p.n++;
    if (p.opt.type === "MULT") {
        const pr = p.stake * p.opt.mult * (q - p.entry) / p.entry * (p.dir === "RISE" ? 1 : -1), tp = p.opt.tp, sl = p.opt.sl;
        p.profit = Math.max(pr, -p.stake);
        if (p.profit <= -p.stake + 1e-9) return paperEnd(-p.stake, "PAPER STOP-OUT");
        if (sl > 0 && p.profit <= -sl) return paperEnd(-sl, "PAPER STOP-LOSS");
        if (tp > 0 && p.profit >= tp) return paperEnd(tp, "PAPER TAKE-PROFIT");
        return void contractUI();
    }
    contractUI();
    if (!(p.opt.unit === "t" ? p.n >= p.opt.dv : e >= p.ee + p.secs)) return;
    const win = p.dir === "RISE" ? q > p.entry + p.b : q < p.entry + p.b;                  // ties lose (barrier is relative to entry; 0 for Rise/Fall)
    paperEnd(win ? p.payout - p.stake : -p.stake, "PAPER");
}
function finish(profit, label, x) {
    S.pl += profit; S.lastPL = profit;
    const won = profit > 0, lost = profit < 0, src = x.src || "manual", kind = x.opt?.type || "RF";
    log(`${label} ${sideOf(kind, x.dir)} ${won ? "WIN" : lost ? "LOSS" : "FLAT"} · ${money(profit)}`, won ? "win" : lost ? "warn" : "info");
    if (won) S.wins++; if (lost) S.losses++;
    if (src === "auto") S.autoTrades++;
    const lt = S.ticks[S.ticks.length - 1]; if (lt) S.marks.push({ k: "res", e: lt.e, q: lt.q, res: won ? "W" : lost ? "L" : "=" });
    if (S.marks.length > 80) S.marks.splice(0, S.marks.length - 80);
    S.hist.unshift({ t: Date.now(), sym: x.sym || S.sym, dir: x.dir, kind, stake: x.stake, profit, src }); if (S.hist.length > 100) S.hist.pop();
    flash(`${won ? "WIN" : lost ? "LOSS" : "FLAT"} ${profit >= 0 ? "+" : ""}${money(profit)}`, won ? "win" : "loss"); beep(won ? 988 : 330);
    S.cool = Date.now() + Math.max(0, SG.cooldown) * 1000; S.sigOk = false;
    S.busy = false; contractUI(true); ui(); renderTrades(); armSoon();
    if (SG.auto) {
        if (S.pl <= SG.maxLoss) autoOff("SESSION MAX LOSS");
        else if (S.pl >= SG.takeProfit) autoOff("SESSION TAKE PROFIT");
        else if (SG.maxTrades > 0 && S.autoTrades >= SG.maxTrades) autoOff("MAX AUTO TRADES");
    }
    if (AS.on) setTimeout(() => autoSelect("after trade"), 1200);
}
function resetSession() {
    if (inTrade()) return void log("Cannot reset during an open trade.", "warn");
    Object.assign(S, { pl: 0, wins: 0, losses: 0, trades: 0, autoTrades: 0, hist: [], lastPL: null });
    log("Session reset."); ui(); renderTrades();
}

/* ================================================================
   SIGNALS + AUTO ENTRY + AUTO-SELECT MARKET
================================================================ */
function checkSignal(res) {
    const ok = Boolean(res?.ok), blocked = SG.auto && (inTrade() || S.busy || S.switching || Date.now() < S.cool);
    if (ok && blocked) { S.sigOk = false; return; }          // auto can't act now: keep the edge so it fires when free
    const fire = ok && !S.sigOk && Date.now() > S.sigCool;
    S.sigOk = ok;
    if (!fire) return;
    const sig = res.dir > 0 ? "RISE" : "FALL", dir = SG.rev ? (sig === "RISE" ? "FALL" : "RISE") : sig, last = S.ticks[S.ticks.length - 1];
    S.sigCool = Date.now() + 3000;
    S.marks.push({ k: "sig", e: last.e, q: last.q, dir });
    const why = res.trig.length ? ` · ${res.trig.map(t => FACT_LAB[t]).join("+")}` : "";
    beep(dir === "RISE" ? 880 : 660);
    toast(`${sideOf(K.type, sig)} signal${SG.rev ? ` ⇄ ${sideOf(K.type, dir)}` : ""} · Q ${res.score}`, 2400, dir === "RISE" ? "ok" : "bad");
    log(`SIGNAL ${sideOf(K.type, sig)}${SG.rev ? ` → REVERSED → ${sideOf(K.type, dir)}` : ""} · ${S.sym} · ${V.tf} · Q ${res.score}${why}`, "trade");
    if (SG.auto && ready() && !inTrade() && !S.busy && !S.switching && Date.now() > S.cool) execute(dir, "auto", res);
}
function setAuto(on) {
    if (on && S.exec === "LIVE" && S.acctType === "real" && !confirm(`AUTO ENTRY on a REAL account with LIVE execution (${kLabel()}): signals will place real trades. Enable?`)) { syncPSig(); return; }
    if (on) S.autoTrades = 0;
    SG.auto = on; ls.set("pw3-sg", SG); syncPSig(); ui();
    log(`Auto entry ${on ? "ON" : "OFF"}${on ? ` · ${kLabel()}` : ""}`, on ? "trade" : "info"); toast(`Auto entry ${on ? "ON" : "OFF"}`, 1800, on ? "ok" : "");
}
function autoOff(why) { SG.auto = false; ls.set("pw3-sg", SG); syncPSig(); ui(); log(`Auto entry stopped · ${why}`, "warn"); toast(`Auto stopped: ${why}`, 3500, "bad"); }
function sgChanged(custom = true) {
    if (custom) SG.preset = "CUSTOM";
    ls.set("pw3-sg", SG); syncPSig(); reeval();
}
function applyPreset(name) {
    if (PRESETS[name]) { const rq = SG.req; Object.assign(SG, clone(PRESETS[name])); SG.req = Object.assign({}, rq, SG.req); SG.preset = name; } else SG.preset = "CUSTOM";
    sgChanged(false);
}
function reeval() { S.res = analyzeNow(); S.sigOk = Boolean(S.res?.ok); renderHud(); renderRank(); redraw(); }
function applyParams() {
    ls.set("pw3-p", P);
    if (S.ticks.length) { buildInd(S.ticks); if (S.B.length) buildInd(S.B); S.zones = P.zOn ? findZones(series()) : []; }
    V.ema = P.emaOn; V.zones = P.zOn; V.sr = P.srOn; V.st = P.stOn;
    syncPInd(); reeval();
}
/* Auto-select: scan → keep/choose a market whose score is inside the chosen band. Never while a trade is open. */
async function autoSelect(reason) {
    clearTimeout(AS.t);
    if (!AS.on) return;
    const sched = ms => { clearTimeout(AS.t); AS.t = setTimeout(() => autoSelect("timer"), ms); };
    if (!ready() || inTrade() || S.busy || S.switching) return sched(8000);
    if (S.scanning || AS.busy) return sched(8000);
    AS.busy = true; AS.last = Date.now(); set("asState", "scanning…");
    try {
        await scan(`auto-select · ${reason}`);
        if (!AS.on || inTrade() || S.busy) return;
        const band = S.rank.filter(r => inCat(r.score, AS.cat)), cur = band.find(r => r.sym === S.sym);
        const pick = reason === "timer" && cur ? cur : band[0];            // the 60 s timer keeps a market that is still in band; after a trade / change we take the best
        if (!pick) { log(`Auto-select: no market in ${CATS[AS.cat][0]} right now.`, "warn"); set("asState", "none in band"); }
        else if (pick.sym !== S.sym) {
            log(`Auto-select → ${pick.sym} (score ${pick.score}, ${CATS[AS.cat][0]})`, "trade");
            if (await useMarket(pick.sym)) toast(`Market → ${pick.sym} · score ${pick.score}`, 2200, "ok");
        } else set("asState", `${S.sym} ✓ ${pick.score}`);
    } finally { AS.busy = false; AS.bad = 0; if (AS.on) sched(60000); syncAS(); }
}
function setAS(on) {
    AS.on = on; ls.set("pw3-as", { cat: AS.cat }); clearTimeout(AS.t); syncAS();
    log(`Auto-select market ${on ? `ON · ${CATS[AS.cat][0]}` : "OFF"}`, on ? "trade" : "info");
    if (on) autoSelect("enabled");
}
function watchConditions() {                       // market conditions changed → current market left the chosen band
    if (!AS.on || !ready() || inTrade() || S.busy || S.switching || S.scanning || AS.busy || !S.sym || S.ticks.length < 120) return;
    const a = analyze(S.ticks.slice(-900), P.zOn ? findZones(S.ticks) : [], 0);
    if (!a) return;
    if (inCat(a.score, AS.cat)) { AS.bad = 0; return; }
    if (++AS.bad >= 3 && Date.now() - AS.last > 15000) { log(`Auto-select: ${S.sym} score ${a.score} left ${CATS[AS.cat][0]} — rescanning.`, "info"); AS.bad = 0; autoSelect("conditions changed"); }
}
function syncAS() {
    if ($("asOn")) $("asOn").checked = AS.on;
    if ($("asCat")) $("asCat").value = AS.cat;
    const c = $("asChip"); if (c) { c.textContent = AS.on ? `SELECT ${CATS[AS.cat][0].split(" · ")[0]}` : "SELECT OFF"; c.classList.toggle("on", AS.on); }
    if (!AS.on) set("asState", "");
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
    if (!S.armKey && canArm()) armSoon();
    if (K.type === "HL" && K.hl.mode === "payout" && S.bar && Date.now() - S.bar.at > 100000 && S.armKey && !S.busy) { S.armKey = ""; armSoon(); }   // keep the payout-derived barrier fresh
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
    set("kWR", n ? `${(S.wins / n * 100).toFixed(1)}%` : "—"); set("kBE", S.ratio > 0 ? `breakeven ${(100 / S.ratio).toFixed(1)}%` : "multiplier: TP/SL driven");
    set("kFill", S.execMs != null ? `${S.execMs} ms` : "—");
    showTradePL();
    $("autoTag").hidden = !SG.auto;
    const ac = $("autoChip"); ac.textContent = SG.auto ? "AUTO ON" : "AUTO OFF"; ac.classList.toggle("on", SG.auto);
    const rv = $("revChip"); rv.textContent = SG.rev ? "⇄ REVERSE ON" : "⇄ REVERSE OFF"; rv.classList.toggle("on", SG.rev);
    $("dStake").value !== String(S.stake) && document.activeElement !== $("dStake") && ($("dStake").value = S.stake);
    const db = $("durBtn"); if (db) db.innerHTML = `⏱ <b>${durText()}</b> ▾`;
    manualUI();
}
function tradePL() {
    const c = S.contract, p = S.paper;
    if (c) return c.profit;
    if (!p) return null;
    if (p.opt.type === "MULT") return p.entry === null ? 0 : p.profit;
    const q = S.ticks[S.ticks.length - 1]?.q;
    if (p.entry === null || q === undefined) return null;
    const w = p.dir === "RISE" ? q > p.entry + p.b : q < p.entry + p.b;
    return w ? p.payout - p.stake : -p.stake;
}
function showTradePL() {                        // TRADE P/L (this trade, live) is kept apart from SESSION P/L (all closed trades)
    const live = tradePL(), v = live ?? S.lastPL, e = $("kTP");
    e.textContent = v === null || v === undefined ? "—" : `${v >= 0 ? "+" : ""}${money(v)}`;
    e.className = v > 0 ? "pos" : v < 0 ? "neg" : "";
    set("kTPl", live !== null ? "LIVE TRADE" : "LAST TRADE");
}
function manualUI() {
    const can = ready() && !inTrade() && !S.busy && !S.switching && Boolean(S.sym && S.subTick);
    const solving = K.type === "HL" && K.hl.mode === "payout" && !S.pp.RISE && !S.pp.FALL && (S.barP || (S.armKey && !curBar()));
    [["RISE", "mRise", "▲"], ["FALL", "mFall", "▼"]].forEach(([d, id, ic]) => {
        const b = $(id); if (!b) return;
        const p = fresh(d, stake()); b.disabled = !can;
        const sp = b.querySelector("span"); if (sp) sp.textContent = `${ic} ${sideOf(K.type, d)}`;
        const em = b.querySelector("em");
        if (em) em.textContent = p ? (K.type === "MULT" ? `×${K.mult} · ${money(p.ask)}` : `${p.ratio.toFixed(2)}x · ${money(p.payout)}`) : solving ? "solving barrier…" : "—";
    });
    const st = $("mStatus");
    st.className = `mst${S.qErr ? " warn" : ""}`;
    st.textContent = !ready() ? "Connect to trade" : inTrade() ? "Trade running…" : S.switching ? "Switching market…" : S.busy ? "Executing…"
        : S.qErr ? `⚠ ${S.qErr}` : `${S.exec}${S.exec === "LIVE" ? ` · ${S.acctType.toUpperCase()}` : ""} · ${kLabel()} · ${S.sym || "—"}`;
    st.title = S.qErr || "";
    const br = $("barRead");
    if (br) br.textContent = K.type === "HL" ? (K.hl.mode === "payout" ? (S.bar && S.bar.key === barKey() ? `${barStr(true, S.bar.o)} / ${barStr(false, S.bar.o)}` : "…") : `${barStr(true, num(K.hl.barrier, 0.5))} / ${barStr(false, num(K.hl.barrier, 0.5))}`) : "";
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
        b.className = `mc ${!row ? "" : row.off ? "off" : row.pass ? "ok" : "no"}${SG.req[id] ? " req" : ""}${TRIGS.includes(id) ? " trg" : ""}`;
        b.title = `${FACT_NAME[id]}${row ? ` — ${row.val}` : ""}\nclick: ${SG.req[id] ? "stop requiring" : "require"} for signals`;
    });
    if (r) {
        $("qBar").style.width = `${r.score}%`; set("qVal", `Q ${r.score}`);
        const h = $("hBias"); h.textContent = `${r.dir > 0 ? "▲ BUY" : "▼ SELL"} BIAS`; h.className = `chip ${r.dir > 0 ? "up" : "dn"}`;
        const b = $("sigBadge"), sg = r.dir > 0 ? "RISE" : "FALL", ex = SG.rev ? (r.dir > 0 ? "FALL" : "RISE") : sg;
        if (r.ok) { b.className = `badge ${ex === "RISE" ? "rise" : "fall"}`; b.textContent = `${sideOf(K.type, sg)} READY${SG.rev ? ` ⇄ ${sideOf(K.type, ex)}` : ""}`; }
        else { const near = r.passed >= r.total - 2; b.className = `badge${near ? " watch" : ""}`; b.textContent = near ? `FORMING ${r.passed}/${r.total}` : "WAITING"; }
    } else {
        $("qBar").style.width = "0"; set("qVal", "Q —"); $("hBias").textContent = "BIAS —"; $("hBias").className = "chip mut"; $("sigBadge").className = "badge"; $("sigBadge").textContent = "WAITING";
    }
}
function setRead(i) {
    const T = S.ticks, e = $("hRead"), tf = TFS[V.tf];
    if (i < 0 || i >= T.length) { e.textContent = "—"; return; }
    const t = T[i], d = new Date(t.e * 1000).toLocaleTimeString([], { hour12: false });
    let src = t, s = `${d}  ${t.q.toFixed(dec())}`;
    if (tf && S.B.length) { const j = clamp(lb(S.B, t.e + 1) - 1, 0, S.B.length - 1); src = S.B[j]; s += `  ·  O ${src.o.toFixed(dec())} H ${src.h.toFixed(dec())} L ${src.l.toFixed(dec())} C ${src.c.toFixed(dec())}`; }
    if (P.emaOn) s += `  ·  EMA${P.ema} ${src.m.toFixed(dec())}`;
    if (P.srOn) s += `  ·  K ${src.k.toFixed(0)} D ${src.dd.toFixed(0)}`;
    if (P.stOn) s += `  ·  ST ${src.sdir > 0 ? "▲" : "▼"}`;
    e.textContent = s;
}
const fmtLeft = ms => { const s = Math.max(0, Math.ceil(ms / 1000)); return s >= 3600 ? `${Math.floor(s / 3600)}h ${String(Math.floor(s % 3600 / 60)).padStart(2, "0")}m` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
function contractUI() {
    const c = S.contract, p = S.paper, x = c || p, card = $("tradeCard");
    if (!x) { card.hidden = true; showTradePL(); return; }
    const o = x.opt, kind = o.type;
    card.hidden = false; set("tcSide", `${x.dir === "RISE" ? "▲" : "▼"} ${sideOf(kind, x.dir)}${kind === "MULT" ? ` ×${o.mult}` : ""}`);
    let pct = 0, txt = "";
    if (kind === "MULT") { txt = `${o.tp > 0 ? "TP " + money(o.tp) : "TP off"} · ${o.sl > 0 ? "SL " + money(o.sl) : "SL off"}`; pct = 0; }
    else if (o.unit === "t") { const n = c ? c.ticks : p.n; txt = `${Math.min(n, o.dv)} / ${o.dv} ticks`; pct = n / o.dv * 100; }
    else {
        const start = c ? c.tstart : p.t0, end = c ? (Number.isFinite(c.exp) ? c.exp : c.tstart + c.secs * 1000) : p.t0 + p.secs * 1000;
        txt = `${fmtLeft(end - Date.now())} left`; pct = (Date.now() - start) / Math.max(1, end - start) * 100;
    }
    set("tcN", txt);
    const live = tradePL(), el = $("tcPL");
    if (live === null) { el.textContent = "entering…"; el.className = ""; }
    else { el.textContent = `${live >= 0 ? "+" : ""}${money(live)}`; el.className = live >= 0 ? "pos" : "neg"; }
    $("tcBar").style.width = `${clamp(pct, 0, 100)}%`;
    $("tcSide").className = x.dir === "RISE" ? "pos" : "neg";
    $("tcClose").hidden = kind !== "MULT"; $("tcClose").disabled = Boolean(c && c.closing);
    showTradePL();
}
function renderTrades() {
    const b = $("tradeRows"); if (!b) return; b.innerHTML = "";
    S.hist.forEach(h => {
        const tr = document.createElement("tr"); tr.style.cursor = "default";
        [[new Date(h.t).toLocaleTimeString([], { hour12: false }), ""], [h.sym, ""], [`${h.dir === "RISE" ? "▲" : "▼"} ${KSHORT[h.kind] || ""}${h.src === "auto" ? " A" : ""}`, h.dir === "RISE" ? "up" : "dn"], [money(h.stake), ""], [`${h.profit >= 0 ? "+" : ""}${money(h.profit)}`, h.profit > 0 ? "up" : h.profit < 0 ? "dn" : ""]]
            .forEach(([v, c]) => { const td = document.createElement("td"); td.textContent = v; if (c) td.className = c; tr.appendChild(td); });
        b.appendChild(tr);
    });
}
function setStake(v) {
    S.stake = Math.max(0.35, round2(num(v, S.stake))); ls.set("pw3-stake", S.stake);
    $("dStake").value = S.stake; ui(); armSoon(250);
}
function manualTrade(dir) { execute(dir, "manual"); }

/* ---------- trade-option dock: tabs + an option row that reshapes itself per contract family ---------- */
function kSave(structural) { ls.set("pw3-k", K); if (structural) renderDock(); ui(); armSoon(150); reeval(); }
function setKind(t) {
    if (t === K.type) return;
    if (inTrade() || S.busy) return void toast("Finish the open trade first.", 2000, "bad");
    K.type = t;
    if (t === "HL" && K.unit === "t") { K.unit = "m"; K.dv = 1; }                 // Higher/Lower has no tick durations
    if (t === "MULT") snapMult();
    S.bar = null; S.qErr = ""; S.ratio = 1.9;
    if (SG.auto) autoOff("TRADE OPTION CHANGED — set its values, then start auto again");
    log(`Trade option → ${kLabel()}`); kSave(true);
}
function setDur(unit, v) {
    const [a, b] = DLIM[unit]; if (K.type === "HL" && unit === "t") return;
    K.unit = unit; K.dv = clamp(Math.floor(num(v, K.dv)), a, b); kSave(true); closeDurPop();
}
function renderDock() {
    $("kindTabs").querySelectorAll("[data-k]").forEach(b => b.classList.toggle("on", b.dataset.k === K.type));
    let h = "";
    if (K.type !== "MULT") h += `<button class="pill" id="durBtn" title="Trade duration — ticks, seconds, minutes, hours">⏱ <b>${durText()}</b> ▾</button>`;
    if (K.type === "RF") h += `<label class="chk eq" title="Equals wins too: CALLE / PUTE"><input type="checkbox" id="optEq"${K.eq ? " checked" : ""}> equals</label>`;
    if (K.type === "HL") {
        h += `<div class="seg" id="barMode"><button data-m="manual" class="${K.hl.mode === "manual" ? "on" : ""}" title="You set the barrier distance">BARRIER</button><button data-m="payout" class="${K.hl.mode === "payout" ? "on" : ""}" title="Barrier is calculated from your target payout for every market">PAYOUT</button></div>`;
        h += K.hl.mode === "manual"
            ? `<label class="ofld" title="Barrier distance from entry (price points). Higher uses +, Lower uses −. Negative = in-the-money.">± <input id="optBar" type="number" step="any" value="${K.hl.barrier}"></label>`
            : `<label class="ofld" title="Target payout multiple of your stake">× <input id="optTgt" type="number" step="0.05" min="1.05" max="10" value="${K.hl.target}"></label>`;
        h += `<span class="rd" id="barRead"></span>`;
    }
    if (K.type === "MULT") {
        h += `<label class="ofld">× <select id="optMult">${multList(S.sym).map(m => `<option${m === K.mult ? " selected" : ""}>${m}</option>`).join("")}</select></label>`;
        h += `<label class="ofld tp">TP $ <input id="optTp" type="number" min="0" step="any" placeholder="off" value="${K.tp || ""}"></label>`;
        h += `<label class="ofld sl">SL $ <input id="optSl" type="number" min="0" step="any" placeholder="off" value="${K.sl || ""}"></label>`;
    }
    $("optRow").innerHTML = h; closeDurPop(); manualUI();
}
function closeDurPop() { $("durPop").hidden = true; }
function openDurPop(unit) {
    const pop = $("durPop"); unit = unit || K.unit;
    const units = K.type === "HL" ? ["s", "m", "h"] : ["t", "s", "m", "h"];
    if (!units.includes(unit)) unit = units[0];
    pop.innerHTML = `<div class="dp-t">${units.map(u => `<button data-u="${u}" class="${u === unit ? "on" : ""}">${UNAME[u]}</button>`).join("")}</div>
      <div class="dp-g">${DPRE[unit].map(v => `<button data-v="${v}" data-u="${unit}" class="${K.unit === unit && K.dv === v ? "on" : ""}">${v}</button>`).join("")}</div>
      <div class="dp-c"><input id="dpCustom" type="number" min="${DLIM[unit][0]}" max="${DLIM[unit][1]}" placeholder="custom ${UNAME[unit].toLowerCase()}…" inputmode="numeric"><button data-u="${unit}" id="dpSet">SET</button></div>`;
    pop.hidden = false;
}

/* ---------- drawer panels (generated from schemas) ---------- */
const PSCHEMA = [
    { g: "EMA LINE", on: "emaOn", f: [["ema", "Period", 3, 200, 1]] },
    { g: "SUPPLY / DEMAND ZONES", on: "zOn", f: [["zoneW", "Zone width σ", 0.3, 6, 0.1], ["zoneImp", "Impulse σ", 1, 12, 0.5]] },
    { g: "STOCHASTIC RSI", on: "srOn", f: [["rsi", "RSI length", 2, 50, 1], ["stoch", "Stoch length", 2, 50, 1], ["k", "%K smooth", 1, 10, 1], ["d", "%D smooth", 1, 10, 1]] },
    { g: "SUPERTREND (ST line)", on: "stOn", f: [["atr", "ATR length", 3, 100, 1], ["mul", "Multiplier", 1, 10, 0.5]] }
];
const SSCHEMA = [["z5Min", "Main trend z ≥", 0.2, 4, 0.1], ["z1Min", "Short trend z ≥", 0, 3, 0.1], ["holdMin", "Steps held before cross", 1, 10, 1], ["crossMin", "Cross strength σ", 0, 2, 0.05],
["crossWin", "EMA cross window", 1, 6, 1], ["dualWin", "EMA+ST window", 3, 30, 1], ["zWin", "Zone break window", 2, 20, 1], ["maxFlips", "Max chop flips", 0, 12, 1], ["volCap", "Volatility ceiling", 1, 4, 0.1], ["volMin", "Volatility floor", 0.1, 1.5, 0.05],
["zoneRoom", "Zone room ×", 0, 4, 0.1], ["srLow", "StochRSI zone", 10, 45, 5], ["minQ", "Min score Q", 0, 100, 5]];
const AFIELDS = [["cooldown", "Cooldown (s)", 0, 600, 1], ["maxTrades", "Max auto trades (0=∞)", 0, 999, 1], ["takeProfit", "Session take profit $", 1, 99999, 1], ["maxLoss", "Session max loss $", -99999, -1, 1], ["minPayout", "Min payout ×", 1, 3, 0.01]];
const nf = (attr, f) => `<label>${f[1]}<input type="number" data-${attr}="${f[0]}" min="${f[2]}" max="${f[3]}" step="${f[4]}"></label>`;
const chkBox = id => `<label class="chk"><input type="checkbox" data-req="${id}"> ${FACT_NAME[id]}</label>`;
function buildPanes() {
    let h = `<p class="note">Indicators and signals run on the <b>chart timeframe you are viewing</b> (ticks or candles). The contract itself settles on the option you set under the chart.</p>`;
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
      <label class="switch rev"><input type="checkbox" id="sgRev"><span></span> ⇄ REVERSE signals <small>buy signal opens a SELL, sell signal opens a BUY</small></label>
      <p class="note">A signal fires when its <b>trigger</b> event happens and every ticked <b>confirmation</b> passes. Tap the chips on the chart to tick / untick them too.</p>
      <div class="sub">TRIGGERS · the entry event</div><div class="reqs">${TRIGS.map(chkBox).join("")}</div>
      <label>Trigger logic<select data-sgs="trigMode"><option value="ALL">ALL ticked triggers together</option><option value="ANY">ANY one ticked trigger</option></select></label>
      <label>Zone-play mode<select data-sgs="zpMode"><option value="BOTH">Breaks + zone entries</option><option value="BREAK">Breaks (and retests) only</option><option value="ENTRY">Entering a zone only</option></select></label>
      <p class="note"><b>EMA</b> = price crosses the EMA in the trend direction. <b>EMA+ST</b> = price crosses the EMA <i>and</i> the ST line the same way (up → buy, down → sell). <b>ZONE▸</b> = supply/demand break, retest, or the moment price enters a zone.</p>
      <div class="sub">CONFIRMATIONS</div><div class="reqs">${FACT.filter(([id]) => !TRIGS.includes(id)).map(([id]) => chkBox(id)).join("")}</div>
      <div class="sub">THRESHOLDS</div><div class="grid2">${SSCHEMA.map(f => nf("sg", f)).join("")}</div>
      <div class="sub">AUTO ENTRY</div>
      <label class="switch"><input type="checkbox" id="sgAuto"><span></span> Auto-enter when a signal fires</label>
      <label class="switch"><input type="checkbox" data-sg="sound"><span></span> Sound alerts</label>
      <div class="grid2">${AFIELDS.map(f => nf("sg", f)).join("")}</div>
      <p class="note">Auto trades exactly the option set under the chart (Rise/Fall, Higher/Lower or Multiplier + its duration / barrier / TP / SL). Changing the option type stops auto; set its values and start auto again. Session limits above apply to the SESSION P/L.</p>`;
    $("paneSig").innerHTML = h;
    $("paneSig").addEventListener("change", ev => {
        const e = ev.target;
        if (e.id === "sgPreset") return applyPreset(e.value);
        if (e.id === "sgAuto") return setAuto(e.checked);
        if (e.id === "sgRev") { SG.rev = e.checked; return sgChanged(false); }
        if (e.dataset.sgs) { SG[e.dataset.sgs] = e.value; return sgChanged(false); }
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
    $("sgPreset").value = SG.preset; $("sgAuto").checked = SG.auto; $("sgRev").checked = SG.rev;
    document.querySelectorAll("#paneSig [data-req]").forEach(e => { e.checked = Boolean(SG.req[e.dataset.req]); });
    document.querySelectorAll("#paneSig [data-sg]").forEach(e => { const v = SG[e.dataset.sg]; if (e.type === "checkbox") e.checked = Boolean(v); else e.value = v; });
    document.querySelectorAll("#paneSig [data-sgs]").forEach(e => { e.value = SG[e.dataset.sgs]; });
    $("autoTag").hidden = !SG.auto;
    const rv = $("revChip"); if (rv) { rv.textContent = SG.rev ? "⇄ REVERSE ON" : "⇄ REVERSE OFF"; rv.classList.toggle("on", SG.rev); }
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
    const T = S.ticks, tfs = TFS[V.tf], SR = tfs ? S.B : T, bo = tfs ? tfs / 2 : 0;
    if (tfs && T.length >= 3 && SR.length < 3) { g.fillStyle = "#8696b8"; g.fillText("Loading candles…", 60, H / 2); G = null; return; }
    if (T.length < 3) { g.fillStyle = "#8696b8"; g.fillText(ready() ? "Loading ticks…" : "Sign in / connect to stream a market.", 60, H / 2); G = null; return; }

    const L = 46, R = 74, Tp = W < 760 ? 78 : 50, B = 22, subOn = P.srOn && V.sr, subH = subOn ? Math.round((H - Tp - B) * 0.2) : 0, gap = subOn ? 8 : 0;
    const PW = W - L - R, PH = H - Tp - B - subH - gap, subTop = Tp + PH + gap;
    const last = T[T.length - 1].e, span = V.span, maxOff = Math.max(0, last - T[0].e - span * 0.25);
    V.off = clamp(V.off, 0, maxOff);
    const tR = last + span * 0.08 - V.off, tL = tR - span;
    const X = e => L + PW * (e - tL) / span;
    const i0 = Math.max(0, lb(SR, tL - bo) - 1), i1 = Math.min(SR.length, lb(SR, tR - bo) + 1), step = Math.max(1, Math.ceil((i1 - i0) / (PW * 1.2)));
    let lo = Infinity, hi = -Infinity, cds = null;
    if (tfs) { cds = []; for (let i = i0; i < i1; i++) { const b = SR[i]; cds.push({ t: b.e, o: b.o, h: b.h, l: b.l, c: b.c }); } cds.forEach(c => { if (c.l < lo) lo = c.l; if (c.h > hi) hi = c.h; }); }
    for (let i = i0; i < i1; i++) {
        const t = SR[i];
        if (!tfs) { if (t.q < lo) lo = t.q; if (t.q > hi) hi = t.q; }
        if (V.ema) { if (t.m < lo) lo = t.m; if (t.m > hi) hi = t.m; }
    }
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
        for (let i = i0; i < i1; i += step) {
            const t = SR[i], px = X(t.e + bo), py = Y(t.st);
            if (!run || run.d !== t.sdir) { flush(); g.strokeStyle = t.sdir > 0 ? "rgba(34,227,161,.75)" : "rgba(255,77,109,.75)"; g.beginPath(); g.moveTo(px, py); run = { d: t.sdir }; }
            else g.lineTo(px, py);
        }
        flush();
    }
    // EMA (the exact line the strategy trades)
    if (V.ema && P.emaOn) {
        g.strokeStyle = "#c4b5fd"; g.lineWidth = 1.8; g.beginPath();
        for (let i = i0; i < i1; i += step) (i === i0 ? g.moveTo(X(SR[i].e + bo), Y(SR[i].m)) : g.lineTo(X(SR[i].e + bo), Y(SR[i].m)));
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
            for (let i = i0; i < i1; i += step) (i === i0 ? g.moveTo(X(SR[i].e + bo), Y2(SR[i][key])) : g.lineTo(X(SR[i].e + bo), Y2(SR[i][key])));
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
    renderDock(); syncAS();
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
    // trade option dock
    $("kindTabs").addEventListener("click", ev => { const b = ev.target.closest("[data-k]"); if (b) setKind(b.dataset.k); });
    $("optRow").addEventListener("click", ev => {
        if (ev.target.closest("#durBtn")) { $("durPop").hidden ? openDurPop() : closeDurPop(); return; }
        const m = ev.target.closest("#barMode [data-m]"); if (m && K.hl.mode !== m.dataset.m) { K.hl.mode = m.dataset.m; S.bar = null; kSave(true); }
    });
    $("optRow").addEventListener("change", ev => {
        const e = ev.target;
        if (e.id === "optEq") { K.eq = e.checked; kSave(false); }
        else if (e.id === "optBar") { K.hl.barrier = num(e.value, 0.5); kSave(false); }
        else if (e.id === "optTgt") { K.hl.target = clamp(num(e.value, 1.9), 1.05, 10); e.value = K.hl.target; S.bar = null; kSave(false); }
        else if (e.id === "optMult") { K.mult = Number(e.value); kSave(false); }
        else if (e.id === "optTp") { K.tp = Math.max(0, num(e.value, 0)); kSave(false); }
        else if (e.id === "optSl") { K.sl = Math.max(0, num(e.value, 0)); kSave(false); }
    });
    $("durPop").addEventListener("click", ev => {
        const b = ev.target.closest("button"); if (!b) return;
        if (b.id === "dpSet") { const v = $("dpCustom").value; if (v !== "") setDur(b.dataset.u, v); return; }
        if (b.dataset.v) return setDur(b.dataset.u, b.dataset.v);
        if (b.dataset.u) openDurPop(b.dataset.u);
    });
    $("durPop").addEventListener("keydown", ev => { if (ev.key === "Enter") $("dpSet").click(); });
    document.addEventListener("pointerdown", ev => { const p = $("durPop"); if (!p.hidden && !p.contains(ev.target) && !ev.target.closest("#durBtn")) closeDurPop(); });
    on("tcClose", closeTrade);
    on("revChip", () => { SG.rev = !SG.rev; sgChanged(false); toast(`Reverse ${SG.rev ? "ON — signals open the opposite side" : "OFF"}`, 2000, SG.rev ? "ok" : ""); });
    on("asChip", () => setAS(!AS.on)); on("asOn", () => setAS($("asOn").checked));
    on("asCat", () => { AS.cat = $("asCat").value; ls.set("pw3-as", { cat: AS.cat }); syncAS(); if (AS.on) autoSelect("category changed"); }, "change");
    // chart toolbar
    $("tfBtns").addEventListener("click", ev => {
        const b = ev.target.closest("[data-tf]"); if (!b) return;
        setTF(b.dataset.tf);
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
async function boot() {
    wire(); ui(); contractUI(true); renderTrades(); renderHud(); link("off"); redraw();
    set("ver", "v3.1");
    setInterval(() => { if (inTrade()) contractUI(); }, 1000); setInterval(watchConditions, 5000);
    log("PSYCHIC WINNER Manual Pro ready. PAPER by default — switch to LIVE when you are ready.");
    log("Keys: R / ↑ = RISE · F / ↓ = FALL · M = full screen · Esc = cancel / close.");
    await oauthCallback();
    if (authValid()) connect();
    else if ($("loginCard").hidden) showLogin();
}
boot();
