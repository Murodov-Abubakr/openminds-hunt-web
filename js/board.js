// Public read-only leaderboard for a TV or projector. No login, no clocks, no names of members.

import { h, mount, liveStream, initTheme } from "./core.js";
import { boardTable } from "./widgets.js";

initTheme(document.getElementById("theme"));
const main = document.getElementById("main");
const net = document.getElementById("net");

liveStream("/api/board/stream", {
  auth: false,
  pollPath: "/api/board",
  onStatus: (up) => { net.hidden = up; net.textContent = up ? "" : "Reconnecting…"; },
  onState: (board) => mount(main, h("h1", board.ended ? "Final results" : "Leaderboard"), boardTable(board)),
});
