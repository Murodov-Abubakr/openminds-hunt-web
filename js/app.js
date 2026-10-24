// Boot: exchange the link token, then render the screen for this person's role.

import { h, mount, call, session, SIGN_OUT, liveStream, onQueueChange, flush, initTheme, setSignedOutHandler, syncClock, toast, API } from "./core.js?v=ed527b07f0";
import { playerView } from "./player.js?v=ed527b07f0";
import { registrationView, gateView, placeView } from "./staff.js?v=ed527b07f0";
import { controlView } from "./control.js?v=ed527b07f0";

const main = document.getElementById("main");
const net = document.getElementById("net");
const queued = document.getElementById("queued");
const who = document.getElementById("who");
initTheme(document.getElementById("theme"));

let stream = null, render = null, currentRole = null;

function landing(message) {
  if (stream) stream.stop();
  stream = null;
  render = null;
  main.className = "";
  who.textContent = "";
  document.getElementById("signout").hidden = true;
  mount(main, h("section.landing",
    h("img.hero-logo", { src: "img/logo.svg", alt: "", width: 112, height: 112 }),
    h("h1", "The Forgotten ", h("span.gold", "Manuscript")),
    h("p", "Open Minds treasure hunt."),
    message ? h("p.frame", { role: "alert" }, message) : null,
    h("p", "Create your account on the phone you will carry today. Already have one? Sign in."),
    authForms(),
    h("p.muted.small", "No email? Ask the registration desk to show your QR code. The paper passport is the official record; if this app stops, the game goes on.")));
}

function authForms() {
  const box = h("div");
  const tabs = h("div.tabs", { role: "tablist", "aria-label": "Account", style: "margin-top:1.5rem" });
  const show = (which) => {
    mount(tabs, [["create", "Create account"], ["signin", "Sign in"]].map(([k, label]) =>
      h("button", { type: "button", role: "tab", "aria-selected": String(which === k), onclick: () => show(k) }, label)));
    mount(box, which === "create" ? signUpForm() : signInForm());
  };
  show("create");
  return h("div", tabs, box);
}

function passwordField(id, autocomplete) {
  const input = h("input", { id, name: "password", type: "password", autocomplete, spellcheck: "false", maxlength: 128, required: true });
  const toggle = h("button.icon-btn", {
    type: "button", "aria-pressed": "false",
    onclick: (e) => { const reveal = input.type === "password"; input.type = reveal ? "text" : "password"; e.currentTarget.setAttribute("aria-pressed", String(reveal)); e.currentTarget.textContent = reveal ? "Hide" : "Show"; },
  }, "Show");
  return { input, row: h("div.row", h("div.grow", input), toggle) };
}

function signUpForm() {
  const name = h("input", { id: "su-name", name: "name", autocomplete: "name", maxlength: 40, required: true, placeholder: "Your name…" });
  const email = h("input", { id: "su-email", type: "email", name: "email", autocomplete: "email", inputmode: "email", spellcheck: "false", maxlength: 120, required: true, placeholder: "Your email…" });
  const pw = passwordField("su-pw", "new-password");
  const button = h("button.big.primary", { type: "submit" }, "Create account");
  return h("form.frame.stack.signin-form", {
    onsubmit: async (e) => {
      e.preventDefault();
      if (button.disabled) return;
      if (pw.input.value.length < 8) { toast("Use a password of at least 8 characters.", true); pw.input.focus(); return; }
      button.disabled = true;
      button.textContent = "Creating…";
      try {
        const res = await call("POST", "/api/signup", { name: name.value.trim(), email: email.value.trim(), password: pw.input.value, device: navigator.userAgent.slice(0, 60) }, { auth: false });
        session.set(res.session);
        start();
      } catch (err) {
        toast(err.message, true);
        button.disabled = false;
        button.textContent = "Create account";
      }
    },
  },
  h("div.field", h("label", { for: "su-name" }, "Name"), name),
  h("div.field", h("label", { for: "su-email" }, "Email"), email),
  h("div.field", h("label", { for: "su-pw" }, "Password (at least 8 characters)"), pw.row),
  button,
  h("p.muted.small", "Remember this email and password: you sign in with them if you change phones."));
}

function signInForm() {
  const email = h("input", { id: "signin-email", type: "email", name: "email", autocomplete: "email", inputmode: "email", spellcheck: "false", maxlength: 120, required: true, placeholder: "Your email…" });
  const code = h("input", { id: "signin-code", name: "code", type: "password", autocomplete: "current-password", spellcheck: "false", maxlength: 128, required: true, placeholder: "Password…" });
  const button = h("button.big.primary", { type: "submit" }, "Sign in");
  return h("form.frame.stack.signin-form", {
    onsubmit: async (e) => {
      e.preventDefault();
      if (button.disabled) return;
      button.disabled = true;
      button.textContent = "Signing in…";
      try {
        const res = await call("POST", "/api/login-code", { email: email.value.trim(), code: code.value.trim(), device: navigator.userAgent.slice(0, 60) }, { auth: false });
        session.set(res.session);
        start();
      } catch (err) {
        toast(err.message, true);
        button.disabled = false;
        button.textContent = "Sign in";
        code.focus();
      }
    },
  },
  h("h2", "Sign in"),
  h("div.field", h("label", { for: "signin-email" }, "Email"), email),
  h("div.field", h("label", { for: "signin-code" }, "Password (or the code from an invite email)"),
    h("div.row", h("div.grow", code), h("button.icon-btn", {
      type: "button", "aria-pressed": "false",
      onclick: (e) => { const show = code.type === "password"; code.type = show ? "text" : "password"; e.currentTarget.setAttribute("aria-pressed", String(show)); e.currentTarget.textContent = show ? "Hide" : "Show"; },
    }, "Show"))),
  button);
}

function pickView(role) {
  if (role === "player") return playerView;
  if (role === "registration") return registrationView;
  if (role === "gate") return gateView;
  if (role === "admin" || role === "control") return controlView;
  return placeView;
}

function showState(s) {
  syncClock(s.now);
  if (render && s.me.role !== currentRole) render = null; // the Admin changed this person's role
  if (!render) {
    currentRole = s.me.role;
    main.className = ["admin", "control"].includes(s.me.role) ? "wide" : "";
    mount(main);
    render = pickView(s.me.role)(main);
  }
  document.getElementById("signout").hidden = false;
  who.textContent = `${s.me.name} · ${s.me.role === "player" ? `team ${s.me.team}` : s.me.role.replace("keeper:", "Keeper ")}`;
  if (s.ended) document.title = "Game ended · The Forgotten Manuscript";
  render(s);
}

function setNet(up) {
  net.hidden = up;
  net.textContent = up ? "" : "Reconnecting… taps are saved on this phone and sent when the network returns.";
}

onQueueChange((n) => {
  queued.hidden = n === 0;
  queued.textContent = n ? `${n} tap${n > 1 ? "s" : ""} waiting for network` : "";
});

async function start() {
  try {
    showState(await call("GET", "/api/state"));
  } catch (e) {
    if (e.status === 401) return;
    mount(main, h("section.frame", { role: "alert" }, h("h1", "Can’t reach the game server"), h("p", e.message),
      h("p", "The game continues on paper. This page retries by itself."), h("button.primary", { type: "button", onclick: start }, "Try again")));
    setTimeout(() => { if (!render) start(); }, 15000);
    return;
  }
  stream = liveStream("/api/stream", { onState: showState, onStatus: setNet, pollPath: "/api/state" });
  flush();
}

async function boot() {
  setSignedOutHandler((msg) => landing(msg || "You were signed out. Open your newest link."));
  const m = location.hash.match(/[#&]t=([A-Za-z0-9_-]{20,64})/);
  if (m) {
    history.replaceState(null, "", location.pathname); // drop the token from the address bar
    try {
      const res = await call("POST", "/api/login", { token: m[1], device: navigator.userAgent.slice(0, 60) }, { auth: false });
      session.set(res.session);
    } catch (e) {
      landing(e.message);
      return;
    }
  }
  if (!session.get()) return landing();
  start();
}

if (!API || API.includes("CHANGE_ME")) landing("This page is not configured yet.");
else boot();

document.getElementById("signout").append(SIGN_OUT());
document.getElementById("signout").addEventListener("click", async () => {
  if (!confirm("Sign out on this phone? You will need your link again.")) return;
  try { await call("POST", "/api/logout", {}); } catch { /* signed out locally anyway */ }
  session.clear();
  landing("Signed out.");
});
window.addEventListener("error", () => toast("Something went wrong on this screen. Reload the page if it looks stuck.", true));
