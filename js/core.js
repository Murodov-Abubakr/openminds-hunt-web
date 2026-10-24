// Shared plumbing: API calls, the offline tap queue, the live stream and DOM helpers.
// User data is only ever placed with textContent (see h()).

const CFG = window.HUNT_CONFIG || {};
export const API = (CFG.api || "").replace(/\/$/, "");
const SESSION_KEY = "hunt.session";
const QUEUE_KEY = "hunt.queue";
const BASE_HEADERS = { "ngrok-skip-browser-warning": "1" };

// Storage ----------------------------------------------------------------------

function store(key, value) {
  try {
    if (value === undefined) return JSON.parse(localStorage.getItem(key));
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch { return null; }
  return value;
}
export const session = {
  get: () => store(SESSION_KEY),
  set: (t) => store(SESSION_KEY, t),
  clear: () => store(SESSION_KEY, null),
};

// DOM ----------------------------------------------------------------------------

/** h("button.primary", {onclick}, "Text", child) — strings become text nodes, never HTML. */
export function h(tag, props, ...children) {
  const [name, ...classes] = tag.split(".");
  const el = document.createElement(name || "div");
  if (classes.length) el.className = classes.join(" ");
  if (props && (typeof props !== "object" || props instanceof Node || Array.isArray(props))) {
    children.unshift(props);
    props = null;
  }
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className += (el.className ? " " : "") + v;
    else if (k === "text") el.textContent = v;
    else if (k === "style") el.style.cssText = v; // CSSOM, allowed by our CSP (no inline style attributes)
    else if (k in el && k !== "list" && typeof v !== "string") el[k] = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  append(el, children);
  return el;
}
function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}
export function mount(el, ...children) {
  el.replaceChildren();
  append(el, children);
  return el;
}

export function toast(text, err = false) {
  const box = document.getElementById("toasts");
  const t = h("div.toast" + (err ? ".err" : ""), { role: err ? "alert" : "status" }, text);
  box.append(t);
  setTimeout(() => t.remove(), err ? 6000 : 3000);
}

export function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

// Time: the server clock is the only clock -------------------------------------------

let offset = 0; // server - local, in seconds
export const serverNow = () => Date.now() / 1000 + offset;
export function syncClock(now) { if (typeof now === "number") offset = now - Date.now() / 1000; }
const fmtHM = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dushanbe", hour: "2-digit", minute: "2-digit" });
const fmtHMS = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dushanbe", hour: "2-digit", minute: "2-digit", second: "2-digit" });
export const clockHM = (ts) => (ts ? fmtHM.format(new Date(ts * 1000)) : "");
export const clockHMS = (ts) => (ts ? fmtHMS.format(new Date(ts * 1000)) : "");
export function duration(s) {
  if (s === null || s === undefined) return "";
  const m = Math.floor(s / 60), sec = s % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

// Theme ------------------------------------------------------------------------------

// Sun and moon icons, built as DOM nodes (no HTML strings).
const SVG_NS = "http://www.w3.org/2000/svg";
function svgIcon(parts) {
  const svg = document.createElementNS(SVG_NS, "svg");
  for (const [k, v] of Object.entries({ viewBox: "0 0 24 24", width: 22, height: 22, fill: "none", stroke: "currentColor",
    "stroke-width": 2, "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true", focusable: "false" })) svg.setAttribute(k, v);
  for (const [tag, attrs] of parts) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    svg.append(el);
  }
  return svg;
}
const SUN = () => svgIcon([["circle", { cx: 12, cy: 12, r: 4.5 }],
  ...[[12, 1.5, 12, 4], [12, 20, 12, 22.5], [1.5, 12, 4, 12], [20, 12, 22.5, 12], [4.6, 4.6, 6.4, 6.4], [17.6, 17.6, 19.4, 19.4], [4.6, 19.4, 6.4, 17.6], [17.6, 6.4, 19.4, 4.6]]
    .map(([x1, y1, x2, y2]) => ["line", { x1, y1, x2, y2 }])]);
export const SIGN_OUT = () => svgIcon([["path", { d: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" }],
  ["polyline", { points: "16 17 21 12 16 7" }], ["line", { x1: 21, y1: 12, x2: 9, y2: 12 }]]);
const MOON = () => svgIcon([["path", { d: "M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11z", fill: "currentColor" }]]);

export function initTheme(button) {
  const meta = document.querySelector('meta[name="theme-color"]');
  const apply = (t) => {
    document.documentElement.dataset.theme = t;
    if (meta) meta.content = t === "light" ? "#f6efdd" : "#0e1626";
    // Show what a tap switches to: the sun in dark mode, the moon in sunlight mode.
    const label = t === "light" ? "Switch to dark mode" : "Switch to sunlight mode (high contrast for bright sun)";
    button.replaceChildren(t === "light" ? MOON() : SUN());
    button.setAttribute("aria-label", label);
    button.title = label;
    store("hunt.theme", t);
  };
  apply(store("hunt.theme") || "dark");
  button.addEventListener("click", () => apply(document.documentElement.dataset.theme === "light" ? "dark" : "light"));
}

// HTTP -------------------------------------------------------------------------------

export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export async function call(method, path, body, { auth = true, timeout = 15000 } = {}) {
  if (!API || API.includes("CHANGE_ME")) throw new ApiError(0, "The app is not configured yet (config.js).");
  const headers = { ...BASE_HEADERS };
  const token = session.get();
  if (auth && token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  let res;
  try {
    res = await fetch(API + path, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal, referrerPolicy: "no-referrer", credentials: "omit", cache: "no-store",
    });
  } catch {
    throw new ApiError(0, "No network.");
  } finally {
    clearTimeout(timer);
  }
  const type = res.headers.get("Content-Type") || "";
  const data = type.includes("json") ? await res.json().catch(() => ({})) : await res.text();
  if (res.status === 401 && auth) onSignedOut(data.error);
  if (!res.ok) throw new ApiError(res.status, (data && data.error) || `Error ${res.status}`);
  return data;
}

let signedOutHandler = () => {};
export function setSignedOutHandler(fn) { signedOutHandler = fn; }
function onSignedOut(msg) { session.clear(); signedOutHandler(msg); }

// Offline tap queue: every write is retried until the server answers -------------------

let queue = store(QUEUE_KEY) || [];
let flushing = false;
let queueListener = () => {};
export function onQueueChange(fn) { queueListener = fn; fn(queue.length); }
function saveQueue() { store(QUEUE_KEY, queue); queueListener(queue.length); }

/** Queue a write. Resolves with the server's answer, or with {queued:true} if offline. */
export function send(path, body = {}) {
  if (!("id" in body)) body = { id: uuid(), ...body };
  return new Promise((resolve) => {
    const item = { path, body, added: Date.now() };
    queue.push(item);
    saveQueue();
    waiters.set(body.id, resolve);
    flush();
    setTimeout(() => { if (waiters.has(body.id)) { waiters.delete(body.id); resolve({ queued: true }); } }, 4000);
  });
}
const waiters = new Map();
let backoff = 1000;

export async function flush() {
  if (flushing) return;
  flushing = true;
  try {
    while (queue.length) {
      const item = queue[0];
      try {
        const res = await call("POST", item.path, item.body);
        settle(item, res);
        backoff = 1000;
      } catch (e) {
        if (e.status === 0 || e.status === 429 || e.status >= 500) {
          setTimeout(flush, backoff);
          backoff = Math.min(backoff * 2, 30000);
          return;
        }
        settle(item, null, e); // rejected by the rules: drop it and say why
      }
    }
  } finally {
    flushing = false;
  }
}
function settle(item, res, err) {
  queue.shift();
  saveQueue();
  const w = waiters.get(item.body.id);
  waiters.delete(item.body.id);
  if (err) {
    toast(err.message, true);
    if (w) w({ error: err.message });
  } else if (w) {
    w(res);
  } else if (res && res.handover) {
    toast(`Sent: hand over the riddle for ${res.handover.name}`);
  }
}
window.addEventListener("online", () => { backoff = 1000; flush(); });

// Live stream: fetch + ReadableStream (EventSource cannot send our headers) ----------------

export function liveStream(path, { onState, onStatus, auth = true, pollPath }) {
  let stopped = false, attempt = 0, pollTimer = null, ctrl = null, up = false, polling = false;

  // Poll only while the stream is down, and never run two polling loops at once.
  const poll = async () => {
    clearTimeout(pollTimer);
    if (stopped || up) { polling = false; return; }
    polling = true;
    try { onState(await call("GET", pollPath, undefined, { auth })); } catch { /* still down */ }
    if (stopped || up) { polling = false; return; }
    pollTimer = setTimeout(poll, 20000 + Math.random() * 5000);
  };

  const connect = async () => {
    if (stopped) return;
    ctrl = new AbortController();
    const headers = { ...BASE_HEADERS };
    if (auth) headers.Authorization = `Bearer ${session.get()}`;
    try {
      const res = await fetch(API + path, { headers, signal: ctrl.signal, cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer" });
      if (res.status === 401) { onSignedOut(); return; }
      if (!res.ok || !res.body) throw new Error("stream");
      up = true;
      onStatus(true);
      clearTimeout(pollTimer);
      attempt = 0;
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += value;
        let i;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const chunk = buf.slice(0, i);
          buf = buf.slice(i + 2);
          handle(chunk);
        }
      }
    } catch { /* fall through to reconnect */ }
    if (stopped) return;
    up = false;
    onStatus(false);
    if (!polling) poll();
    attempt += 1;
    const wait = Math.min(30000, 1000 * 2 ** Math.min(attempt, 5)) * (0.7 + Math.random() * 0.6);
    setTimeout(connect, attempt === 1 ? 300 : wait);
  };

  const handle = (chunk) => {
    let event = "message", data = "";
    for (const line of chunk.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data += line.slice(5).trim();
    }
    if (!data) return;
    let obj;
    try { obj = JSON.parse(data); } catch { return; }
    if (event === "state") onState(obj);
    else if (event === "ping") syncClock(obj.now);
    else if (event === "signout") onSignedOut();
  };

  connect();
  return { stop() { stopped = true; ctrl && ctrl.abort(); clearTimeout(pollTimer); } };
}

// Lazy, integrity-checked CDN scripts ------------------------------------------------------

const loaded = {};
export function loadScript(src, integrity) {
  if (!loaded[src]) {
    loaded[src] = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src; s.integrity = integrity; s.crossOrigin = "anonymous"; s.referrerPolicy = "no-referrer";
      s.onload = resolve; s.onerror = () => { delete loaded[src]; reject(new Error("Could not load " + src)); };
      document.head.append(s);
    });
  }
  return loaded[src];
}
export function loadStyle(href, integrity) {
  if (document.querySelector(`link[href="${href}"]`)) return;
  document.head.append(h("link", { rel: "stylesheet", href, integrity, crossorigin: "anonymous", referrerpolicy: "no-referrer" }));
}

export const PLACE_LABEL = { gate: "Gate", reed: "Reed", leaf: "Leaf", bird: "Bird", stage: "Stage", door: "Door" };
export const STATIONS = ["reed", "leaf", "bird", "stage"];
