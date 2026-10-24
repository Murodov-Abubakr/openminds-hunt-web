// The player's phone: passport, roles, map, compass, chat and leaderboard.
// No clocks, countdowns or deadlines: final time appears only after finishing.

import { h, mount, send, toast, duration, serverNow, clockHMS, STATIONS, PLACE_LABEL } from "./core.js";
import { boardTable, seals, chatBox, makeMap, pinIcon } from "./widgets.js";
import * as compass from "./compass.js";

const QUICK = ["A phone died", "We are lost", "Need a walker"];
const ROUTE = (n) => { const i = (n - 1) % 4; return [0, 1, 2, 3].map((k) => STATIONS[(i + k) % 4]); };

export function playerView(root) {
  const parts = {
    head: h("section.frame.gilded"),
    setup: h("section.section"),
    passport: h("section.section"),
    roles: h("section.section"),
    compass: h("section.section"),
    stuck: h("section.section"),
    map: h("section.section"),
    chat: h("section.section"),
    board: h("section.section"),
  };
  mount(root, Object.values(parts));
  let state = null, mapCtx = null, chatEl = null, chatKey = "", nameInput = null, compassResult = null;

  function render(s) {
    state = s;
    const t = s.team;
    if (!t) {
      mount(parts.head, h("h1", "Not on a team"), h("p", "Ask the registration desk to add you to a team."));
      return;
    }
    mount(parts.head,
      h("h1", t.name),
      h("p.muted", `Team ${t.number}`),
      h("p", t.finished ? "Finished. Well done, travellers." : t.started ? "The hunt is on. Follow your riddles." : "Wait at the Gate. Your team starts when the Gate volunteer says so."),
      t.finished ? h("p", h("strong.num", `Final time ${duration(t.score)}`), t.hints ? h("span.muted", ` (includes ${t.hints} hint${t.hints > 1 ? "s" : ""} × 3 min)`) : null) : null);
    renderSetup(t);
    mount(parts.passport, t.started ? [
      h("h2", "Passport"), seals(t.stamps, ROUTE(t.number)),
      h("p.muted", `Hints used: ${t.hints} of ${t.max_hints}`),
    ] : null);
    renderRoles(s);
    renderCompass(s);
    renderStuck(s);
    renderMap(s);
    renderChat(s);
    mount(parts.board, h("h2", "Leaderboard"), boardTable(s.board, t.number));
  }

  function renderSetup(t) {
    if (t.started) { mount(parts.setup); nameInput = null; return; }
    if (nameInput && document.activeElement === nameInput) return; // don't disturb typing
    const meLeader = t.leader === state.me.id;
    nameInput = h("input", { id: "team-name", maxlength: 24, value: t.custom_name || "", placeholder: `Team ${t.number}…`, autocomplete: "off", spellcheck: "false" });
    mount(parts.setup,
      h("h2", "Before the Gate"),
      h("ul.stack", { style: "padding-left:1.1rem" }, t.members.map((m) =>
        h("li", m.name, m.leader ? h("strong", " (leader)") : null, h("span.muted.small", m.joined ? " · phone joined" : " · not joined yet")))),
      h("button.big" + (meLeader ? "" : ".primary"), { type: "button", disabled: meLeader, onclick: () => send("/api/team/leader") },
        meLeader ? "You are the leader" : "I’m the leader"),
      meLeader ? h("form.stack", { style: "margin-top:1rem", onsubmit: (e) => { e.preventDefault(); send("/api/team/name", { name: nameInput.value }).then((r) => r.ok && toast("Name saved")); } },
        h("label", { for: "team-name" }, "Team name (up to 24 letters)"),
        nameInput,
        h("button.primary", { type: "submit" }, "Save name")) : h("p.muted", "The leader can be changed until the Gate starts your team."));
  }

  function renderRoles(s) {
    const r = s.roles;
    if (!s.team.started || !r || !r.on) { mount(parts.roles); return; }
    const lines = [];
    if (r.leader) lines.push(h("p", h("strong", "Leader. "), "Only you may open the final box at the Door."));
    if (r.compass) lines.push(h("p", h("strong", "Compass bearer. "), "You carry the compass. You never speak to a Keeper."));
    for (const st of r.envoy) {
      lines.push(h("div.row", h("p.grow", h("strong", `Envoy to ${PLACE_LABEL[st]}. `), "Only you talk to this Keeper."),
        h("button.primary", { type: "button", onclick: () => badge(s, st) }, `Show ${PLACE_LABEL[st]} badge`)));
    }
    if (!lines.length) lines.push(h("p", "Travel with your team."));
    mount(parts.roles, h("h2", "Your role"), lines,
      h("details", h("summary", "Who does what"), h("ul", s.team.members.map((m) =>
        h("li", m.name, ": ", [m.leader && "leader", m.compass && "compass", ...m.envoy.map((e) => `envoy ${PLACE_LABEL[e]}`)].filter(Boolean).join(", ") || "traveller")))));
  }

  function renderCompass(s) {
    const c = s.compass;
    if (!c) { compass.stop(); compass.setRing(0); mount(parts.compass); return; }
    if (!compass.consent.get()) {
      mount(parts.compass, h("div.frame.stack",
        h("h2", "Share your location"),
        h("p", "The compass works only when every phone in your team shares its location. We send your position to the Control Room about every 12 seconds, only while this page is open on screen."),
        h("p", "It is used to run today’s game and is deleted after the event. Organizers see it; other teams never do."),
        h("button.big.primary", { type: "button", onclick: () => { compass.consent.set(true); renderCompass(state); } }, "Share my location"),
        h("button.big.ghost", { type: "button", onclick: () => { compass.consent.set(false); toast("Not sharing. Your team’s compass stays off."); } }, "Not now")));
      return;
    }
    compass.share(c.interval, (res) => { compassResult = res; paintCompass(); });
    paintCompass();
  }

  function paintCompass() {
    const c = state && state.compass;
    if (!c) return;
    const res = { ...c, ...(compassResult || {}) };
    const items = [h("h2", "Compass")];
    if (res.dark) {
      items.push(h("p.compass-dark", "Your compass went dark. It only guides those who walk together. Find this Keeper on your own."));
      compass.setRing(0);
    } else if (!res.available) {
      items.push(h("p", h("strong", `Compass: ${res.connected} of ${res.total} travellers connected`)),
        h("p.muted", "Every phone must keep this page open and share its location."));
      compass.setRing(0);
    } else if (c.bearer) {
      if (!compass.audioReady()) {
        items.push(h("button.big.primary", { type: "button", onclick: () => { compass.unlockAudio(); paintCompass(); } }, "Start compass"));
      }
      items.push(h("div.compass-ring", { "data-band": String(res.band || 0), role: "img", "aria-label": res.band ? `Signal strength ${res.band} of 4` : "No signal" }, res.q ? "?" : "✦"),
        h("p.muted", { style: "text-align:center" }, res.band ? "Warmer. Listen to the ring." : "Silent. Walk together and listen."));
      compass.setRing(res.band || 0);
    } else {
      items.push(h("p", "Compass is live on your bearer’s phone. Keep this page open."));
    }
    mount(parts.compass, items);
  }

  function renderStuck(s) {
    const st = s.stuck;
    if (!st) { mount(parts.stuck); return; }
    mount(parts.stuck, h("div.frame.stack",
      h("h2", "I’m stuck"),
      st.revealed ? h("p", "Your next station is marked on the map.") :
        h("p", "Reveal your next station’s pin and name. It costs one hint (3 minutes)."),
      st.revealed ? null : h("button.big", {
        type: "button", disabled: !st.ready,
        onclick: () => { if (confirm("Use one hint (+3 minutes) to reveal your next station?")) send("/api/route-hint"); },
      }, st.ready ? "Reveal next station" : "Not yet available")));
  }

  async function renderMap(s) {
    const m = s.map;
    if (!s.team.started) { mount(parts.map); return; }
    if (!mapCtx) {
      const el = h("div.map", { role: "region", "aria-label": "Map" });
      const btn = h("button.big", { type: "button" }, "Show map");
      mount(parts.map, h("h2", "Map"), btn);
      btn.addEventListener("click", async () => {
        btn.replaceWith(el);
        try {
          mapCtx = await makeMap(el, m.center, m.bbox);
          drawPins(state.map);
          mapCtx.map.locate({ watch: true, enableHighAccuracy: true });
          mapCtx.map.on("locationfound", (e) => {
            if (mapCtx.me) mapCtx.me.setLatLng(e.latlng);
            else mapCtx.me = mapCtx.L.marker(e.latlng, { icon: pinIcon(mapCtx.L, { cls: "me" }), title: "You" }).addTo(mapCtx.map);
          });
        } catch { toast("The map could not load. The game continues without it.", true); }
      });
      return;
    }
    drawPins(m);
  }

  function drawPins(m) {
    if (!mapCtx) return;
    const { L, layer } = mapCtx;
    layer.clearLayers();
    for (const p of m.pins) {
      const colour = STATIONS.includes(p.place) ? p.place : null;
      L.marker(p.pos, { icon: pinIcon(L, { colour, label: PLACE_LABEL[p.place][0] }), title: p.name, alt: p.name })
        .bindTooltip(p.name + (p.kind === "revealed" ? " (revealed)" : ""), { permanent: true, direction: "top", offset: [0, -14] }).addTo(layer);
    }
    if (m.q) L.marker(m.q, { icon: pinIcon(L, { cls: "q", label: "?" }), title: "Something is near" }).addTo(layer);
  }

  function renderChat(s) {
    if (!s.chat) { mount(parts.chat); chatEl = null; return; }
    const key = s.chat.map((m) => m.id).join(",");
    if (chatEl && key === chatKey) return;
    const draft = chatEl ? chatEl.input.value : "";
    const focused = chatEl && document.activeElement === chatEl.input;
    chatKey = key;
    chatEl = chatBox({ messages: s.chat, mineIsControl: false, quick: QUICK });
    chatEl.input.value = draft;
    mount(parts.chat, h("h2", "Talk to the Control Room"), chatEl);
    if (focused) chatEl.input.focus();
  }

  return render;
}

// Envoy badge: full screen, station colour, live animation and server time --------------

function badge(s, station) {
  const clock = h("div.clock", { "aria-live": "off" });
  const tick = () => { clock.textContent = clockHMS(serverNow()); };
  tick();
  const timer = setInterval(tick, 1000);
  const close = () => { clearInterval(timer); ov.remove(); };
  const ov = h(`div.badge-screen.c-${station}`, { role: "dialog", "aria-modal": "true", "aria-label": `${PLACE_LABEL[station]} envoy badge` },
    h("div",
      h("div", { style: "font-weight:700;font-size:1.3rem" }, `Envoy to ${PLACE_LABEL[station]}`),
      h("div.team-no", String(s.team.number)),
      h("div.person", s.me.name),
      h("div.spinner", { "aria-hidden": "true" }),
      clock,
      h("button", { type: "button", style: "margin-top:1.5rem", onclick: close }, "Close badge")));
  document.body.append(ov);
  ov.querySelector("button").focus();
}
