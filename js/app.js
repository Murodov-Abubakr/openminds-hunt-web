// Boot: exchange the link token, then render the screen for this person's role.

import { h, mount, call, session, SIGN_OUT, liveStream, onQueueChange, flush, initTheme, setSignedOutHandler, syncClock, toast, API } from "./core.js?v=1a54b40e1c";
import { playerView } from "./player.js?v=1a54b40e1c";
import { registrationView, gateView, placeView } from "./staff.js?v=1a54b40e1c";
import { controlView } from "./control.js?v=1a54b40e1c";

const main = document.getElementById("main");
const net = document.getElementById("net");
const queued = document.getElementById("queued");
const who = document.getElementById("who");
initTheme(document.getElementById("theme"));

let stream = null, render = null;

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
    h("p", "Open the personal link from your email on the phone you will carry today, or sign in below with your email and the code from that email."),
    signInForm(),
    h("p.muted.small", "No email? Ask the registration desk to show your QR code. The paper passport is the official record; if this app stops, the game goes on.")));
}

function signInForm() {
  const email = h("input", { id: "signin-email", type: "email", name: "email", autocomplete: "email", inputmode: "email", spellcheck: "false", maxlength: 120, required: true, placeholder: "Your email…" });
  const code = h("input", { id: "signin-code", name: "code", autocomplete: "one-time-code", autocapitalize: "characters", spellcheck: "false", maxlength: 12, required: true, placeholder: "ABCD-1234" });
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
  h("h2", "Sign in with a code"),
  h("div.field", h("label", { for: "signin-email" }, "Email"), email),
  h("div.field", h("label", { for: "signin-code" }, "Code (8 letters and numbers)"), code),
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
  if (!render) {
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
