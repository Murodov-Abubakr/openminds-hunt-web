// Location sharing and the Compass. Location is read only while the page is visible.
// All distance maths happens on the server; this phone only receives a ring band.

import { call, toast } from "./core.js?v=54dfeb324d";

const CONSENT_KEY = "hunt.gps-consent";
let watchId = null, lastSent = 0, lastPos = null, interval = 12, onResult = () => {};
let audio = null, ringTimer = null, band = 0;

export const consent = {
  get() { try { return localStorage.getItem(CONSENT_KEY) === "yes"; } catch { return false; } },
  set(v) { try { localStorage.setItem(CONSENT_KEY, v ? "yes" : "no"); } catch { /* private mode */ } },
};

function metres(a, b) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

async function report(pos) {
  const now = Date.now() / 1000;
  const p = { lat: pos.coords.latitude, lon: pos.coords.longitude, acc: Math.min(pos.coords.accuracy || 9999, 10000) };
  const moved = lastPos ? metres(lastPos, p) : Infinity;
  if (now - lastSent < interval && !(moved > 10 && now - lastSent > 3)) return;
  lastSent = now;
  lastPos = p;
  try {
    const res = await call("POST", "/api/gps", p);
    onResult(res);
  } catch (e) {
    if (e.status === 409) stop();
  }
}

function start() {
  if (watchId !== null || !navigator.geolocation || document.visibilityState !== "visible") return;
  watchId = navigator.geolocation.watchPosition(report, (err) => {
    if (err.code === 1) { toast("Location is blocked. Allow it in the browser settings to use the compass.", true); stop(); }
  }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
}

export function stop() {
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
}

/** Share location while the page is visible. */
export function share(seconds, callback) {
  interval = Math.max(8, seconds || 12);
  onResult = callback;
  start();
}
export const sharing = () => watchId !== null;

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") { if (consent.get() && onResult) start(); } else { stop(); setRing(0); }
});

// Ring: beeps (and vibration where supported) get more frequent as the band rises -----------

export function unlockAudio() {
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === "suspended") audio.resume();
    beep(660, 0.08);
  } catch { audio = null; }
}
export const audioReady = () => !!audio;

function beep(freq = 880, len = 0.12) {
  if (!audio) return;
  const o = audio.createOscillator(), g = audio.createGain();
  o.frequency.value = freq;
  g.gain.setValueAtTime(0.25, audio.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + len);
  o.connect(g).connect(audio.destination);
  o.start();
  o.stop(audio.currentTime + len);
}

const PERIOD = { 1: 3000, 2: 1800, 3: 1000, 4: 500 };
export function setRing(next) {
  if (next === band) return;
  band = next;
  clearInterval(ringTimer);
  ringTimer = null;
  if (!band) return;
  const tick = () => {
    beep(600 + band * 120);
    if (navigator.vibrate) navigator.vibrate(60 + band * 20);
  };
  tick();
  ringTimer = setInterval(tick, PERIOD[band]);
}
