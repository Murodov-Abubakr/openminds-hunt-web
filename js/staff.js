// Volunteer screens: Registration, Gate, Keepers and Door. Big buttons, one tap each.

import { h, mount, send, toast, call, clockHM, serverNow, STATIONS, PLACE_LABEL } from "./core.js?v=ed527b07f0";
import { boardTable, showQr } from "./widgets.js?v=ed527b07f0";

function keepFocus(container, fn) {
  // Skip re-rendering a region while someone is typing in it.
  if (container.contains(document.activeElement) && ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName)) return;
  fn();
}

export async function linkAction(person, mode) {
  try {
    const res = await call("POST", "/api/people/link", { person, mode });
    if (mode === "show") showQr(res.name, res.url, res.code);
    else toast("Link sent by email");
  } catch (e) { toast(e.message, true); }
}

// Registration ------------------------------------------------------------------------

export function registrationView(root) {
  const form = h("section.frame.gilded");
  const list = h("section.section");
  const board = h("section.section");
  mount(root, form, list, board);
  let built = false, numberInput, rows;

  function buildForm(next) {
    numberInput = h("input", { id: "reg-team", type: "number", inputmode: "numeric", min: 1, max: 20, value: next || "" });
    rows = h("div.stack");
    const addRow = () => {
      const i = rows.children.length + 1;
      rows.append(h("div.row.member",
        h("div.grow", h("label", { for: `m-name-${i}` }, `Member ${i} name`), h("input", { id: `m-name-${i}`, name: `name-${i}`, autocomplete: "off", maxlength: 40 })),
        h("div.grow", h("label", { for: `m-mail-${i}` }, "Email"), h("input", { id: `m-mail-${i}`, name: `email-${i}`, type: "email", autocomplete: "off", spellcheck: "false", inputmode: "email", maxlength: 120 }))));
    };
    for (let i = 0; i < 3; i++) addRow();
    const submit = async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector('button[type="submit"]');
      if (btn.disabled) return;
      btn.disabled = true;
      btn.textContent = "Creating…";
      const members = [...rows.querySelectorAll(".member")].map((r) => {
        const [n, m] = r.querySelectorAll("input");
        return { name: n.value.trim(), email: m.value.trim() };
      }).filter((m) => m.name);
      try {
        const res = await call("POST", "/api/teams", { team: Number(numberInput.value), members });
        const failed = res.members.filter((m) => !m.emailed).length;
        toast(failed ? `Team ${res.team} created. ${failed} email(s) not sent: show their QR codes.` : `Team ${res.team} created. Links emailed.`, failed > 0);
        built = false;
      } catch (err) { toast(err.message, true); }
      btn.disabled = false;
      btn.textContent = "Create team and email links";
    };
    mount(form,
      h("h1", "Registration"),
      h("form.stack", { onsubmit: submit },
        h("div.field", h("label", { for: "reg-team" }, "Team number (1–20)"), numberInput),
        rows,
        h("div.row",
          h("button", { type: "button", onclick: () => { if (rows.children.length < 6) addRow(); } }, "Add member"),
          h("button", { type: "button", onclick: () => { if (rows.children.length > 3) rows.lastChild.remove(); } }, "Remove last")),
        h("button.big.primary", { type: "submit" }, "Create team and email links")));
    built = true;
  }

  return (s) => {
    if (!built) buildForm(s.next_number);
    keepFocus(list, () => mount(list, h("h2", "Teams"), s.teams.length ? h("div.cards", s.teams.map((t) =>
      h("article.card",
        h("h3", `${t.number}. ${t.name}`, t.started ? h("span.chip.solved", { style: "margin-left:.5rem" }, "started") : null),
        h("ul.log", t.members.map((m) => h("li",
          h("span.grow", m.name, h("span.muted.small", m.joined ? " · joined" : " · not joined")),
          h("button.icon-btn", { type: "button", onclick: () => linkAction(m.id, "show") }, "Show QR"),
          h("button.icon-btn", { type: "button", onclick: () => linkAction(m.id, "email") }, "Resend")))),
        t.members.length < 6 ? addMemberForm(t.number) : null))) : h("p.muted", "No teams yet.")));
    mount(board, h("h2", "Leaderboard"), boardTable(s.board));
  };
}

export function addMemberForm(team) {
  const name = h("input", { "aria-label": "New member name", placeholder: "Name…", autocomplete: "off", maxlength: 40 });
  const email = h("input", { "aria-label": "New member email", placeholder: "Email…", type: "email", autocomplete: "off", spellcheck: "false", maxlength: 120 });
  return h("details", h("summary", "Add a member"),
    h("form.stack", {
      onsubmit: async (e) => {
        e.preventDefault();
        try { await call("POST", "/api/teams/member", { team, name: name.value, email: email.value }); toast("Member added"); } catch (err) { toast(err.message, true); }
      },
    }, name, email, h("button.primary", { type: "submit" }, "Add member")));
}

// Gate ------------------------------------------------------------------------------------

export function gateView(root) {
  const head = h("section.frame.gilded", h("h1", "The Gate"),
    h("p", "When a team arrives: check the count (everyone present, including people whose phone is off), then tap ▶ Start. Their time starts at that tap."));
  const handover = h("div", { "aria-live": "assertive" });
  const waiting = h("section.cards", { "aria-labelledby": "gate-waiting" });
  const running = h("section.cards", { "aria-labelledby": "gate-running" });
  const board = h("section.section");
  mount(root, head, handover,
    h("h2", { id: "gate-waiting" }, "Waiting to start"), waiting,
    h("h2", { id: "gate-running", style: "margin-top:2rem" }, "Started"), running, board);
  const counts = {};

  // Live running time for started teams (staff screens only; players never see a clock).
  const tick = () => {
    for (const el of root.querySelectorAll("[data-started]")) {
      const secs = Math.max(0, Math.floor(serverNow() - Number(el.dataset.started)));
      const hh = Math.floor(secs / 3600), mm = Math.floor((secs % 3600) / 60), ss = secs % 60;
      el.textContent = (hh ? `${hh}:${String(mm).padStart(2, "0")}` : String(mm)) + `:${String(ss).padStart(2, "0")}`;
    }
  };
  setInterval(tick, 1000);

  const startTeam = async (t) => {
    const people = counts[t.number] ?? t.members.length;
    if (!confirm(`Start team ${t.number} (${t.name}) now with ${people} people?`)) return;
    const res = await send("/api/gate/start", { team: t.number, people });
    if (res.handover) {
      mount(handover, h("div.handover.frame", { style: "font-size:1.3rem" },
        `▶ Team ${t.number} started. Hand over the riddle for ${res.handover.name}.`));
      if (navigator.vibrate) navigator.vibrate(80);
    } else if (res.queued) {
      toast("Start saved on this phone. It will send when the network returns.");
    }
  };

  const waitingCard = (t) => {
    const n = counts[t.number] ?? t.members.length;
    const set = (v) => { counts[t.number] = Math.min(12, Math.max(1, v)); render(last); };
    const joined = t.members.filter((m) => m.joined).length;
    return h("article.card.is-heading",
      h("div.row", h("h3.grow", `${t.number}. ${t.name}`), h("span.small.muted", `Route ${t.route}`)),
      h("p.small.muted", `${t.members.length} registered · ${joined} phone${joined === 1 ? "" : "s"} signed in · leader: `, h("strong", t.leader || "not chosen")),
      h("div.gate-row",
        h("div.stepper", { role: "group", "aria-label": `People present in team ${t.number}` },
          h("button", { type: "button", "aria-label": "One fewer person", onclick: () => set(n - 1) }, "−"),
          h("span.num", { "aria-live": "polite" }, `${n} ${n === 1 ? "person" : "people"}`),
          h("button", { type: "button", "aria-label": "One more person", onclick: () => set(n + 1) }, "+")),
        h("button.primary.gate-start", { type: "button", onclick: () => startTeam(t) }, "▶ Start")));
  };

  const runningCard = (t) => h("article.card",
    h("div.row", h("h3.grow", `${t.number}. ${t.name}`), h("span.chip.solved", "Running")),
    h("p.gate-clock", h("span.num", { "data-started": String(t.started) }, ""), h("span.small.muted", ` since ${clockHM(t.started)}`)),
    h("p.small.muted", `${t.people} people · first riddle: ${t.first.name}`));

  let last = null;
  function render(s) {
    last = s;
    const notStarted = s.teams.filter((t) => !t.started);
    const started = s.teams.filter((t) => t.started).sort((a, b) => b.started - a.started);
    mount(waiting, notStarted.length ? notStarted.map(waitingCard) : h("p.muted", "No team is waiting."));
    mount(running, started.length ? started.map(runningCard) : h("p.muted", "No team has started yet."));
    tick();
    mount(board, h("h2", "Leaderboard"), boardTable(s.board));
  }
  return render;
}

// Keeper and Door --------------------------------------------------------------------------

const STATUS_TEXT = { not_started: "Not started", heading: "Heading here", arrived: "Arrived", solved: "Stamped", elsewhere: "Elsewhere", finished: "Finished" };
const ORDER = { arrived: 0, heading: 1, elsewhere: 2, not_started: 3, solved: 4, finished: 5 };

export function placeView(root) {
  const head = h("section.frame.gilded");
  const tools = h("div.filters", { role: "group", "aria-label": "Filter teams" });
  const handover = h("div", { "aria-live": "assertive" });
  const list = h("section.cards");
  const board = h("section.section");
  mount(root, head, handover, h("h2", "Teams"), tools, list, board);
  let filter = "active", lastHead = "";

  const act = async (path, team, label) => {
    const res = await send(path, { team });
    if (res.queued) toast(`${label} saved offline. Waiting for network.`);
    else if (res.handover) mount(handover, h(`div.handover.frame.c-${res.handover.place}`, { style: "font-size:1.25rem" },
      `Team ${team}: hand over the ${res.handover.place === "door" ? "Door riddle" : `riddle for ${res.handover.name}`}`));
    else if (res.ok) toast(`${label}: team ${team}`);
  };

  const setHere = () => {
    if (!navigator.geolocation) return toast("This phone has no location.", true);
    if (!confirm("Set this station’s position to where you are standing now?")) return;
    navigator.geolocation.getCurrentPosition(async (pos) => {
      if (pos.coords.accuracy > 30) toast(`GPS accuracy is ${Math.round(pos.coords.accuracy)} m. Try again in the open for a better fix.`, true);
      const res = await send("/api/place/position", { lat: pos.coords.latitude, lon: pos.coords.longitude });
      if (res.ok) toast("Station position saved");
    }, () => toast("Could not read your location.", true), { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
  };

  return (s) => {
    const p = s.place, isDoor = p.key === "door";
    const headKey = `${p.key}|${p.pos}`;
    if (headKey !== lastHead) {
      lastHead = headKey;
      mount(head,
        h(`div.place-band.c-${p.key}`),
        h("h1", isDoor ? "The Door" : `${PLACE_LABEL[p.key]} Keeper`),
        h("p.muted", p.name),
        h("div.row", h("button", { type: "button", onclick: setHere }, "Set my station here"),
          h("span.small.muted", p.pos ? "Position set." : "Position not set yet.")));
    }
    mount(tools, [["active", "Needs action"], ["all", "All teams"]].map(([k, label]) =>
      h("button", { type: "button", "aria-pressed": String(filter === k), onclick: () => { filter = k; renderList(s); } }, label)));
    renderList(s);
    mount(board, h("h2", "Leaderboard"), boardTable(s.board));
  };

  function renderList(s) {
    const isDoor = s.place.key === "door";
    let teams = [...s.teams].sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.number - b.number);
    if (filter === "active") teams = teams.filter((t) => ["arrived", "heading"].includes(t.status));
    mount(list, teams.length ? teams.map((t) => card(t, isDoor, s)) : h("p.muted", filter === "active" ? "No team is heading here right now." : "No teams yet."));
  }

  function card(t, isDoor, s) {
    const playing = !["not_started", "solved", "finished"].includes(t.status) && !s.ended;
    const actions = [];
    if (playing) {
      actions.push(h("button" + (t.status === "arrived" ? "" : ".primary"), { type: "button", disabled: t.status === "arrived", onclick: () => act("/api/place/arrived", t.number, "Arrived") }, "Arrived"));
      actions.push(h("button", {
        type: "button", disabled: !t.hint_ready, title: t.hint_reason || "",
        onclick: () => { if (confirm(`Give team ${t.number} a hint? It adds 3 minutes.`)) act("/api/place/hint", t.number, "Hint"); },
      }, `+Hint (${t.hints}/3)`));
      if (isDoor) {
        actions.push(h("button.primary", {
          type: "button", disabled: !t.finish_ready,
          onclick: () => { if (confirm(`Team ${t.number} opened the box. Mark finished?`)) act("/api/door/finish", t.number, "Finished"); },
        }, "Finished"));
      } else {
        actions.push(h("button.primary", {
          type: "button",
          onclick: () => { if (confirm(`Stamp team ${t.number}'s passport for ${PLACE_LABEL[s.place.key]}?`)) act("/api/place/solved", t.number, "Stamped"); },
        }, "Solved"));
      }
    }
    const waited = t.arrived ? Math.floor((serverNow() - t.arrived) / 60) : null;
    return h("article.card" + (t.status === "arrived" ? ".is-arrived" : t.status === "heading" ? ".is-heading" : ""),
      h("div.row", h("h3.grow", `${t.number}. ${t.name}`), h(`span.chip.${t.status}`, STATUS_TEXT[t.status])),
      h("p.small.muted", `${t.stamps}/4 stamps · hints ${t.hints}/3`, t.arrived ? ` · arrived ${clockHM(t.arrived)}${t.status === "arrived" ? ` (${waited} min ago)` : ""}` : ""),
      t.envoy ? h("p", "Envoy: ", h("strong", t.envoy)) : null,
      isDoor && t.roles_on && t.leader ? h("p", "Only the leader opens the box: ", h("strong", t.leader)) : null,
      isDoor && !t.finish_ready && playing ? h("p.small", "Finished needs 4 stamps.") : null,
      playing && !t.hint_ready && t.hint_reason && t.status === "arrived" ? h("p.small.muted", `Hint: ${t.hint_reason}`) : null,
      t.handover ? h(`div.handover.c-${t.handover.place}`, `Next: ${t.handover.place === "door" ? "the Door riddle" : `riddle for ${t.handover.name}`}`) : null,
      actions.length ? h("div.actions", actions) : null);
  }
}

export { STATIONS };
