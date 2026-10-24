// Control Room (control) and Admin (admin): table, map, alerts, chat, log, people, settings.

import { h, mount, send, toast, call, clockHM, duration, session, API, STATIONS, PLACE_LABEL } from "./core.js?v=15cd746ac8";
import { boardTable, chatBox, dots, makeMap, pinIcon, confirmTyped } from "./widgets.js?v=15cd746ac8";
import { linkAction, addMemberForm } from "./staff.js?v=15cd746ac8";

const TABS = [["overview", "Teams"], ["map", "Map"], ["chat", "Chat"], ["log", "Log"], ["people", "People"], ["settings", "Settings"]];
const ROLES = ["control", "registration", "gate", "keeper:reed", "keeper:leaf", "keeper:bird", "keeper:stage", "door", "admin"];
const SWITCH_TEXT = { route_hint: "Paid route hint (I’m stuck)", roles: "Roles inside teams", compass: "Compass and GPS", chat: "Chat" };
const THRESH_TEXT = { q_distance_m: "“?” distance (m)", split_distance_m: "Split distance (m)", split_duration_s: "Split duration (s)", stuck_alert_min: "Stuck alert (min)" };

export function controlView(root) {
  const fromUrl = new URLSearchParams(location.search).get("tab");
  let tab = TABS.some(([k]) => k === fromUrl) ? fromUrl : "overview", state = null, openTeam = null, mapCtx = null, placing = null;
  const tabBar = h("div.tabs", { role: "tablist", "aria-label": "Control Room" });
  const alerts = h("div.alerts", { "aria-live": "polite" });
  const panel = h("section", { role: "tabpanel" });
  const mapPanel = h("section", { role: "tabpanel", hidden: true });
  mount(root, h("h1", "Control Room"), tabBar, alerts, panel, mapPanel);

  const isAdmin = () => state && state.me.role === "admin";

  function render(s) {
    state = s;
    const unread = s.inbox.reduce((n, b) => n + b.unread, 0);
    mount(tabBar, TABS.map(([k, label]) => h("button", {
      type: "button", role: "tab", "aria-selected": String(tab === k),
      onclick: () => { tab = k; history.replaceState(null, "", `?tab=${k}`); render(state); },
    }, label, k === "chat" && unread ? h("span.badge-count", String(unread)) : null)));
    mount(alerts, s.alerts.map((a) => h(`div.alert.${a.kind}`, a.text)));
    panel.hidden = tab === "map";
    mapPanel.hidden = tab !== "map";
    if (tab === "map") return renderMap(s);
    if (panel.contains(document.activeElement) && ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName)) return;
    const fn = { overview, chat, log, people, settings }[tab];
    mount(panel, fn(s));
  }

  // Teams table -----------------------------------------------------------------

  function overview(s) {
    const cols = ["Team", "Route", "Leader", "Phones", "Gate", ...STATIONS.map((p) => PLACE_LABEL[p]), "Door", "Hints", "Status", "Score", ""];
    const cell = (t, p) => {
      const a = t.arrived[p], v = t.solved[p];
      if (!a && !v) return h("td.muted", t.next === p ? "→" : "");
      return h("td.num", a ? `in ${clockHM(a)}` : "", a && v ? h("br") : null, v ? h("strong", `✓ ${clockHM(v)}`) : "");
    };
    return [
      h("div.table-wrap", h("table.grid", [
        h("thead", h("tr", cols.map((c) => h("th", { scope: "col" }, c)))),
        h("tbody", s.teams.map((t) => h("tr" + (t.split ? ".split" : ""),
          h("td", h("strong", `${t.number}. ${t.name}`), t.dark.length ? h("div.small.muted", `compass dark: ${t.dark.join(", ")}`) : null),
          h("td", t.route),
          h("td", t.leader || "—"),
          h("td.num", `${t.phones.connected}/${t.phones.total}`),
          h("td.num", t.started ? `${clockHM(t.started)} (${t.people})` : ""),
          STATIONS.map((p) => cell(t, p)),
          h("td.num", t.arrived.door ? `in ${clockHM(t.arrived.door)}` : "", t.finished ? h("strong", ` ✓ ${clockHM(t.finished)}`) : ""),
          h("td", h("div.row",
            h("button.icon-btn", { type: "button", "aria-label": `Remove a hint from team ${t.number}`, onclick: () => send("/api/control/hint", { team: t.number, delta: -1 }) }, "−"),
            h("span.num", String(t.hints)),
            h("button.icon-btn", { type: "button", "aria-label": `Add a hint to team ${t.number}`, onclick: () => send("/api/control/hint", { team: t.number, delta: 1 }) }, "+"))),
          h("td", t.status, t.split ? h("span.chip.alert", { style: "margin-left:.3rem" }, "split") : null),
          h("td.num", t.score !== null ? `${duration(t.score)} (#${t.rank})` : ""),
          h("td", h("button.icon-btn", { type: "button", onclick: () => { openTeam = t.number; tab = "people"; render(state); } }, "Edit")))))])),
      h("div.section", h("h2", "Leaderboard"), boardTable(s.board)),
    ];
  }

  // Map ----------------------------------------------------------------------------

  async function renderMap(s) {
    if (!mapCtx) {
      const el = h("div.map", { style: "height:70vh", role: "region", "aria-label": "Garden map" });
      const tools = h("div.map-tools");
      mount(mapPanel, tools, el);
      mapCtx = { tools, loading: true };
      try {
        Object.assign(mapCtx, await makeMap(el, s.map.center, s.map.bbox));
        mapCtx.map.on("click", (e) => {
          if (!placing) return;
          const place = placing;
          placing = null;
          if (confirm(`Set ${PLACE_LABEL[place]} here?`)) send("/api/place/position", { place, lat: e.latlng.lat, lon: e.latlng.lng });
          renderMap(state);
        });
      } catch {
        mount(mapPanel, h("p", "The map could not load. Use the Teams table."));
        mapCtx = null;
        return;
      }
      mapCtx.loading = false;
    }
    if (mapCtx.loading) return;
    mount(mapCtx.tools,
      isAdmin() ? ["gate", ...STATIONS, "door"].map((p) => h("button.icon-btn", {
        type: "button", "aria-pressed": String(placing === p),
        onclick: () => { placing = placing === p ? null : p; renderMap(state); },
      }, `Place ${PLACE_LABEL[p]}`)) : null,
      placing ? h("span", `Tap the map where ${PLACE_LABEL[placing]} is.`) : null);
    const { L, layer } = mapCtx;
    layer.clearLayers();
    for (const [p, pos] of Object.entries(s.positions)) {
      if (!pos) continue;
      const n = (s.heading[p] || []).length;
      L.marker(pos, { icon: pinIcon(L, { colour: STATIONS.includes(p) ? p : null, label: PLACE_LABEL[p][0] }), title: s.names[p] })
        .bindTooltip(`${PLACE_LABEL[p]}: ${s.names[p]}${n ? ` · ${n} heading` : ""}`, { permanent: true, direction: "top", offset: [0, -14] }).addTo(layer);
    }
    for (const ph of s.phones) {
      L.marker([ph.lat, ph.lon], { icon: pinIcon(L, { cls: "phone" + (ph.fresh ? "" : " stale") }), title: `${ph.name} (team ${ph.team})` }).addTo(layer);
    }
    for (const t of s.teams) {
      if (!t.centroid) continue;
      L.marker(t.centroid, { icon: pinIcon(L, { cls: "team" + (t.split ? " split" : ""), label: String(t.number) }), title: t.name, zIndexOffset: 500 }).addTo(layer);
    }
  }

  // Chat -------------------------------------------------------------------------------

  function chat(s) {
    if (!s.switches.chat) return h("p", "Chat is switched off.");
    const boxes = s.inbox;
    const teamNums = s.teams.map((t) => t.number);
    const current = openTeam ?? (boxes[0] && boxes[0].team) ?? teamNums[0];
    const box = boxes.find((b) => b.team === current) || { team: current, messages: [], unread: 0 };
    const team = s.teams.find((t) => t.number === current);
    if (box.unread) call("POST", "/api/chat/read", { team: current, last: box.messages[box.messages.length - 1].id }).catch(() => {});
    return h("div.split-cols",
      h("div", h("h2", "Inbox"), h("ul.log", teamNums.map((n) => {
        const b = boxes.find((x) => x.team === n);
        return h("li", h("button" + (n === current ? ".primary" : ".ghost"), {
          type: "button", style: "width:100%;text-align:left", onclick: () => { openTeam = n; render(state); },
        }, `Team ${n}`, b && b.unread ? h("span.badge-count", String(b.unread)) : null, b ? h("span.muted.small", ` · ${b.messages.length} messages`) : null));
      }))),
      current ? h("div",
        h("h2", `Team ${current}${team ? `: ${team.name}` : ""}`),
        chatBox({ messages: box.messages, mineIsControl: true, team: current, quick: ["A walker is on the way", "Stay where you are", "Phone removed. Compass should work again."] }),
        team ? h("details", { style: "margin-top:1rem" }, h("summary", "Remove a dead phone"),
          h("ul.log", team.members.filter((m) => m.session && !m.dead).map((m) => h("li", h("span.grow", m.name),
            h("button.danger.icon-btn", { type: "button", onclick: () => { if (confirm(`Remove ${m.name}'s phone from team ${current}?`)) call("POST", "/api/control/dead-phone", { session: m.session }).then(() => toast("Phone removed")).catch((e) => toast(e.message, true)); } }, "Remove phone"))))) : null)
        : h("p.muted", "No teams yet."));
  }

  // Log -------------------------------------------------------------------------------

  function log(s) {
    return h("div.split-cols",
      h("div", h("h2", "Game log"), h("ul.log", s.log.map((e) => h("li",
        h("time", clockHM(e.ts)), h("span.grow", e.text),
        isAdmin() ? h("button.icon-btn", { type: "button", onclick: () => { if (confirm(`Undo: ${e.text}?`)) send("/api/admin/undo", { event: e.id }); } }, "Undo") : null)))),
      h("div", h("h2", "Audit"), h("ul.log", s.audit.map((a) => h("li", h("time", clockHM(a.ts)), h("span.grow", a.text))))));
  }

  // People ------------------------------------------------------------------------------

  function people(s) {
    const canShow = (role) => isAdmin() || !["admin", "control"].includes(role);
    const personRow = (p, role) => h("li.person",
      h("div.person-info", h("strong", p.name),
        h("div.muted.small", [role, p.email, p.joined || p.session ? "joined" : "not joined"].filter(Boolean).join(" · "))),
      h("div.person-actions",
      canShow(role) ? h("button.icon-btn", { type: "button", onclick: () => linkAction(p.id, "show") }, "Show QR") : null,
      h("button.icon-btn", { type: "button", onclick: () => linkAction(p.id, "email") }, "Resend"),
      canShow(role) ? h("button.icon-btn.danger", { type: "button", onclick: () => { if (confirm(`Sign ${p.name} out everywhere and cancel their links?`)) call("POST", "/api/people/revoke", { person: p.id }).then(() => toast("Revoked")).catch((e) => toast(e.message, true)); } }, "Revoke") : null,
      canShow(role) ? h("button.icon-btn", { type: "button", onclick: () => editPerson(p) }, "Edit") : null));
    const invite = () => {
      const name = h("input", { id: "inv-name", name: "name", autocomplete: "off", maxlength: 40 });
      const email = h("input", { id: "inv-mail", name: "email", type: "email", autocomplete: "off", spellcheck: "false", maxlength: 120 });
      const role = h("select", { id: "inv-role" }, ROLES.map((r) => h("option", { value: r }, r)));
      return h("form.frame.stack", {
        onsubmit: async (e) => {
          e.preventDefault();
          try { const r = await call("POST", "/api/people/invite", { name: name.value, email: email.value, role: role.value }); toast(r.emailed ? "Invite emailed" : "Created. Email not sent: use Show QR.", !r.emailed); } catch (err) { toast(err.message, true); }
        },
      }, h("h3", "Invite staff"), h("label", { for: "inv-name" }, "Name"), name, h("label", { for: "inv-mail" }, "Email"), email, h("label", { for: "inv-role" }, "Role"), role, h("button.primary", { type: "submit" }, "Invite"));
    };
    return [
      s.smtp_ready ? null : h("p.alert", "Email is not configured on the server. Use Show QR for every login."),
      h("div.split-cols",
        h("div", h("h2", "Staff"), h("ul.log", s.staff.map((p) => personRow(p, p.role))), isAdmin() ? invite() : null),
        h("div", h("h2", "Teams"), s.teams.map((t) => h("details.card", { open: openTeam === t.number, style: "margin-bottom:.5rem" },
          h("summary", h("strong", `${t.number}. ${t.name}`)),
          renameForm(t),
          h("ul.log", t.members.map((m) => personRow(m, "player"))),
          t.members.length < 6 ? addMemberForm(t.number) : null)))),
    ];
  }

  function renameForm(t) {
    const input = h("input", { maxlength: 24, value: t.custom_name || "", "aria-label": `New name for team ${t.number}` });
    return h("form.row", { style: "margin:.5rem 0", onsubmit: (e) => { e.preventDefault(); send("/api/team/name", { team: t.number, name: input.value }).then((r) => r.ok && toast("Renamed")); } },
      h("div.grow", input), h("button", { type: "submit" }, "Rename"));
  }

  function editPerson(p) {
    const name = prompt("Name", p.name);
    if (name === null) return;
    const email = prompt("Email", p.email || "");
    if (email === null) return;
    call("POST", "/api/people/edit", { person: p.id, name, email }).then(() => toast("Saved")).catch((e) => toast(e.message, true));
  }

  // Settings (Admin) ---------------------------------------------------------------------

  function settings(s) {
    if (!isAdmin()) {
      return [h("h2", "Settings"), h("ul", Object.entries(SWITCH_TEXT).map(([k, label]) => h("li", `${label}: ${s.settings[k] ? "on" : "off"}`))),
        h("p.muted", "Only the Admin can change settings.")];
    }
    const switches = Object.entries(SWITCH_TEXT).map(([k, label]) => h("label.row.field", { style: "min-height:48px;cursor:pointer" },
      h("input", { type: "checkbox", checked: !!s.settings[k], onchange: (e) => send("/api/admin/setting", { key: k, value: e.target.checked }) }),
      h("span", label)));
    const thresholds = Object.entries(THRESH_TEXT).map(([k, label]) => {
      const input = h("input.num", { type: "number", inputmode: "numeric", id: `th-${k}`, value: s.settings[k] });
      return h("form.row.field", { onsubmit: (e) => { e.preventDefault(); send("/api/admin/setting", { key: k, value: Number(input.value) }).then((r) => r.ok && toast("Saved")); } },
        h("label.grow", { for: `th-${k}` }, label), h("div", { style: "width:7rem" }, input), h("button", { type: "submit" }, "Save"));
    });
    return h("div.split-cols",
      h("div", h("h2", "Feature switches"), switches, h("h2", "Thresholds"), thresholds,
        s.security.length ? [h("h2", "Security alerts"), h("ul.log", s.security.map((a) => h("li", h("time", clockHM(a.ts)), h("span.grow", a.detail || a.kind))))] : null),
      h("div.stack", h("h2", "Envelope (DII Hall, 12:00)"),
        s.envelope
          ? h("p", h("span.chip.solved", "Open"), ` since ${clockHM(s.envelope.opened_at)}. Every player sees it. To hide it again, use Undo in the Log.`)
          : h("p", "Closed. Players cannot see any of it until you open it."),
        h("button.big.primary", {
          type: "button", disabled: !!s.envelope,
          onclick: () => { if (confirm("Open the envelopes now? Every signed-in player sees the coded line and clue at once.")) send("/api/admin/envelope"); },
        }, s.envelope ? "Envelopes are open" : "Open the envelopes for everyone"),
        h("h2", { style: "margin-top:2rem" }, "End of game"),
        h("button.big.primary", { type: "button", disabled: s.ended, onclick: () => { if (confirmTyped("END", "End the game? All actions freeze and results are final.")) send("/api/admin/end"); } }, s.ended ? "Game ended" : "End game"),
        h("button.big", { type: "button", onclick: exportCsv }, "Export results (CSV)"),
        h("h2", { style: "margin-top:2rem" }, "After the 09:00 test"),
        h("p.small", "Reset saves a backup, then clears teams, players, stamps, chat and positions. Staff, settings and station positions stay."),
        h("button.big.danger", { type: "button", onclick: () => { if (confirmTyped("RESET", "Reset all game data?")) call("POST", "/api/admin/reset", { confirm: "RESET" }).then((r) => toast(`Reset done. Backup: ${r.backup}`)).catch((e) => toast(e.message, true)); } }, "Reset after test"),
        h("h2", { style: "margin-top:2rem" }, "After the event"),
        h("p.small", "Purge deletes every email, position and chat message. Export the results first."),
        h("button.big.danger", { type: "button", onclick: () => { if (confirmTyped("PURGE", "Delete all personal data?")) call("POST", "/api/admin/purge", { confirm: "PURGE" }).then(() => toast("Personal data purged")).catch((e) => toast(e.message, true)); } }, "Purge personal data")));
  }

  async function exportCsv() {
    try {
      const res = await fetch(API + "/api/admin/export", { headers: { Authorization: `Bearer ${session.get()}`, "ngrok-skip-browser-warning": "1" }, credentials: "omit", referrerPolicy: "no-referrer" });
      if (!res.ok) throw new Error();
      const url = URL.createObjectURL(await res.blob());
      const a = h("a", { href: url, download: "hunt-results.csv" });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch { toast("Export failed. Try again.", true); }
  }

  return render;
}

export { dots };
