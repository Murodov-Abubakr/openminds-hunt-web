// Reusable pieces: leaderboard, seals, chat, map and QR overlay.

import { h, mount, duration, clockHM, loadScript, loadStyle, send, toast, STATIONS, PLACE_LABEL } from "./core.js?v=c2cd978a97";

const LEAFLET = {
  js: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js",
  jsSri: "sha512-puJW3E/qXDqYp9IfhAI54BJEaWIfloJ7JWs7OeD5i6ruC9JZL1gERT1wjtwXFlh7CjE7ZJ+/vcRZRkIYIb6p4g==",
  css: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css",
  cssSri: "sha512-h9FcoyWjHcOcmEVkxOfTLnmZFWIH0iZhZT1H2TbOq55xssQGEJHEaIm+PgoUaZbRvQTNTluNOEfb1ZRy6D3BOw==",
};
const QR = {
  js: "https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js",
  sri: "sha512-ZDSPMa/JM1D+7kdg2x3BsruQ6T/JpJo3jWDWkCZsP+5yVyp1KfESqLI+7RqB5k24F7p2cV7i2YHh/890y6P6Sw==",
};

// Leaderboard -------------------------------------------------------------------------

export function dots(stamps) {
  return h("span.dots", { "aria-label": `${stamps.length} of 4 stamps` },
    STATIONS.map((s) => h(`span.dot.c-${s}` + (stamps.includes(s) ? ".on" : ""), { title: PLACE_LABEL[s] })));
}

export function boardTable(board, myTeam) {
  if (!board || !board.rows.length) return h("p.muted", "No teams yet.");
  return h("table.board", [
    h("caption.sr-only", "Leaderboard"),
    h("thead", h("tr", h("th", { scope: "col" }, "#"), h("th", { scope: "col" }, "Team"), h("th", { scope: "col" }, "Stamps"), h("th.time", { scope: "col" }, "Time"))),
    h("tbody", board.rows.map((r) =>
      h("tr" + (r.team === myTeam ? ".mine" : ""),
        h("td.rank", r.started ? String(r.rank) : "–"),
        h("td", h("strong", r.name), r.name !== `Team ${r.team}` ? h("span.muted.small", ` · ${r.team}`) : null),
        h("td", dots(r.stamps)),
        h("td.time", r.finished ? duration(r.time) : "")))),
  ]);
}

export function seals(stamps, order = STATIONS) {
  return h("div.passport", order.map((s) =>
    h("div", h(`div.seal.c-${s}` + (stamps.includes(s) ? ".on" : ""), { role: "img", "aria-label": `${PLACE_LABEL[s]}: ${stamps.includes(s) ? "stamped" : "not yet"}` }, PLACE_LABEL[s][0]),
      h("div.seal-label", PLACE_LABEL[s]))));
}

// Chat ----------------------------------------------------------------------------------

export function chatBox({ messages, mineIsControl, team, quick, placeholder = "Write a message…" }) {
  const list = h("div.chat", { role: "log", "aria-live": "polite" },
    messages.length ? messages.map((m) => h("div.msg" + (m.control === mineIsControl ? ".mine" : ""),
      h("span.who", `${m.name} · ${clockHM(m.ts)}`), m.text)) : h("p.muted", "No messages yet."));
  const input = h("textarea", { maxlength: 300, placeholder, "aria-label": "Message", rows: 2 });
  const submit = async (text) => {
    text = text.trim();
    if (!text) return;
    const res = await send("/api/chat/send", team ? { text, team } : { text });
    if (!res.error) { input.value = ""; if (res.queued) toast("Message waiting for network"); }
  };
  const box = h("div.stack",
    list,
    quick ? h("div.quick", quick.map((q) => h("button.icon-btn", { type: "button", onclick: () => submit(q) }, q))) : null,
    h("form.row", { onsubmit: (e) => { e.preventDefault(); submit(input.value); } },
      h("div.grow", input), h("button.primary", { type: "submit" }, "Send")));
  requestAnimationFrame(() => { list.scrollTop = list.scrollHeight; });
  box.input = input;
  return box;
}

// Map --------------------------------------------------------------------------------------

export async function loadLeaflet() {
  loadStyle(LEAFLET.css, LEAFLET.cssSri);
  await loadScript(LEAFLET.js, LEAFLET.jsSri);
  return window.L;
}

export function pinIcon(L, { cls = "", label = "", colour }) {
  const el = h("div.map-pin" + (cls ? "." + cls.split(" ").join(".") : "") + (colour ? `.c-${colour}` : ""), label);
  return L.divIcon({ html: el, className: "", iconSize: null, iconAnchor: [15, 15] });
}

/** A Leaflet map with satellite by default and a street toggle. Returns {map, layer}. */
export async function makeMap(el, center, bbox) {
  const L = await loadLeaflet();
  const map = L.map(el, { zoomControl: true, attributionControl: true }).setView(center, 17);
  const sat = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
    maxZoom: 19, attribution: "Imagery © Esri, Maxar, Earthstar Geographics",
  }).addTo(map);
  const street = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19, attribution: "© OpenStreetMap contributors",
    referrerPolicy: "strict-origin-when-cross-origin", // OSM tile policy requires a Referer; origin only, no path
  });
  L.control.layers({ Satellite: sat, Streets: street }, null, { collapsed: false }).addTo(map);
  if (bbox) map.setMaxBounds([[bbox[0] - 0.01, bbox[1] - 0.01], [bbox[2] + 0.01, bbox[3] + 0.01]]);
  const layer = L.layerGroup().addTo(map);
  return { L, map, layer };
}

// QR code overlay for a person's login link ------------------------------------------------

export async function showQr(name, url, code = "") {
  let qr;
  try {
    await loadScript(QR.js, QR.sri);
    qr = window.qrcode(0, "M");
    qr.addData(url);
    qr.make();
  } catch {
    toast("Could not draw the QR code. Use Resend email.", true);
    return;
  }
  const n = qr.getModuleCount(), scale = 8, pad = 2;
  const canvas = h("canvas.qr", { width: (n + pad * 2) * scale, height: (n + pad * 2) * scale, role: "img", "aria-label": `Login QR code for ${name}` });
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#000";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) ctx.fillRect((c + pad) * scale, (r + pad) * scale, scale, scale);
  const close = () => { ov.remove(); document.removeEventListener("keydown", esc); };
  const esc = (e) => { if (e.key === "Escape") close(); };
  const ov = h("div.overlay", { role: "dialog", "aria-modal": "true", "aria-label": `Login link for ${name}`, onclick: (e) => { if (e.target === ov) close(); } },
    h("div.frame.stack",
      h("h2", name),
      h("p", "Scan with the phone camera. This replaces any earlier link and code for this person."),
      canvas,
      code ? h("p", { style: "text-align:center" }, "Or sign in with their email and this code:", h("br"),
        h("strong.signin-code", { translate: "no" }, code)) : null,
      h("button.big", { type: "button", onclick: close }, "Done")));
  document.addEventListener("keydown", esc);
  document.body.append(ov);
  ov.querySelector("button").focus();
}

export function confirmTyped(word, message) {
  const typed = prompt(`${message}\n\nType ${word} to confirm.`);
  return typed === word;
}

export { mount };
