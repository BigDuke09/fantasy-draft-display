/* Draft Board Script
   Focus: aligned columns, per-cell scrolling names, compact fit, team meta headers
   - ENABLE_POLLING: off by default for layout debugging
   - ANNOUNCEMENTS_ENABLED: off by default
*/

// -------------------------- Config --------------------------
const CONFIG = {
  FORCE_PROXY: true,
  PROXY_TEMPLATE: "https://api.allorigins.win/raw?url={url}",
  MODE: "live",                           // "mock" | "live"
  MOCK_URL: "mock/draftboard_tst2_2024.json",
  LIVE_URL: "https://www.fleaflicker.com/api/FetchLeagueDraftBoard?sport=NFL&league_id=350963&season=2025&draft_number=0",

  ENABLE_POLLING: true,                  // <- OFF for alignment work
  POLL_MS: 10000,
  ANNOUNCEMENTS_ENABLED: false,           // <- OFF for alignment work
  ANNOUNCE_FREEZE_MS: 2500,

  MAX_CHYRON_ITEMS: 40,

  // Team meta (use your file with CustomDraftBoardHeader)
  TEAM_META_FILE: "fleaflicker_team_meta.json"
};

const CHYRON = {
  MODE: "current-round",   // "current-round" | "current+previous" | "recent-picks" | "upcoming-window"
  RECENT_COUNT: 10,        // used for "recent-picks"
  UPCOMING_COUNT: 8,       // used for "upcoming-window"
  SHOW_PLACEHOLDERS: true, // show "ON THE CLOCK"/"PENDING" for unpicked in current round
  SPEED_PX_PER_SEC: 60,    // scroll/bounce speed for center lane
};



// -------------------------- State --------------------------
const state = {
  picks: [],
  teamOrder: [],
  pickQueue: [],
  isAnnouncing: false,
  chyronItems: [],
  teamMetaByName: null   // { "Original Team Name" : "Display Label" }
};

// -------------------------- DOM --------------------------
const elGrid            = document.getElementById("draft-grid");
const elOverlay         = document.getElementById("pick-announcement");
const elOverlayContent  = elOverlay ? elOverlay.querySelector(".content") : null;
const elChyron          = document.getElementById("chyron");
const elChyronText      = document.getElementById("chyron-text") || document.getElementById("chyron");
const elChyronLeft      = document.getElementById("chyron-left-round");
const elChyronRight     = document.getElementById("chyron-right-round");

// -------------------------- Utilities --------------------------
function resolveUrl(relativeOrAbsolute) {
  return new URL(relativeOrAbsolute, window.location.href).toString();
}

function posClass(position) {
  const raw = String(position || "").toUpperCase().replace(/[^A-Z0-9]/g, ""); // strips "/", spaces, etc
  const alias = { PK: "K", DEF: "DST", DSTDEF: "DST" };
  const key = alias[raw] || raw;
  return `pos-${key}`;
}


function fetchJSON(urlLike) {
  const orig = resolveUrl(urlLike);
  const url = (CONFIG.FORCE_PROXY && CONFIG.PROXY_TEMPLATE)
    ? CONFIG.PROXY_TEMPLATE.replace("{url}", encodeURIComponent(orig))
    : orig;
  console.debug("[fetchJSON] GET", url); // debug line
  return fetch(url, { cache: "no-store" })
    .then(async (r) => {
      const text = await r.text();
      if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText} @ ${url}\n${text.slice(0,200)}`);
      return JSON.parse(text);
    });
}

function deriveTeamOrder(picks) {
  const r1 = picks.filter(p => p.round === 1).sort((a,b)=>a.slot-b.slot);
  if (r1.length) return r1.map(p => p.team);
  const seen = new Set();
  const order = [];
  for (const p of picks) if (!seen.has(p.team)) { seen.add(p.team); order.push(p.team); }
  return order;
}

// Normalize a raw record to our pick shape
function normalizePick(rec) {
  // FleaFlicker nested structure
  const hasFF = rec?.slot && rec?.player?.proPlayer && rec?.team?.name;
  if (hasFF) {
    const pro = rec.player.proPlayer;
    const round   = Number(rec.slot.round || 0);
    const slot    = Number(rec.slot.slot || 0);
    const overall = Number(rec.slot.overall || ((round - 1) * 12 + slot) || 0);

    const team       = String(rec.team.name || "Team");
    const playerName = String(pro.nameFull || pro.nameShort || `${pro.nameFirst ?? ""} ${pro.nameLast ?? ""}`).trim();
    const position   = String(pro.position || "").toUpperCase();
    const teamAbbr   = String(pro.proTeamAbbreviation || pro.proTeam?.abbreviation || "").toUpperCase();
    const headshot   = pro.headshotUrl || "https://a.espncdn.com/i/headshots/nfl/players/full/0.png";

    return { round, slot, overall, team, playerName, position, teamAbbr, headshot };
  }

  // Flat shapes (fallback)
  const round   = Number(rec.round ?? rec.rnd ?? 0);
  const slot    = Number(rec.slot ?? rec.pick ?? rec.pickInRound ?? 0);
  const overall = Number(
    rec.overall ??
    rec.overallPick ??
    ((round - 1) * 12 + slot) ??
    0
  );
  const team       = String(rec.team ?? rec.teamName ?? rec.owner ?? rec.franchise ?? "Team");
  const playerName = String(rec.player ?? rec.playerName ?? rec.name ?? "").trim();
  const position   = String(rec.pos ?? rec.position ?? "").toUpperCase();
  const teamAbbr   = String(rec.nfl ?? rec.teamAbbr ?? rec.proTeam ?? "").toUpperCase();
  const headshot   = rec.headshot || "https://a.espncdn.com/i/headshots/nfl/players/full/0.png";

  return { round, slot, overall, team, playerName, position, teamAbbr, headshot };
}

// Accept FleaFlicker-style mock: { orderedSelections: [...] } and a few alternates.
function extractPicks(raw) {
  if (!raw) return [];
  let arr = [];
  if (Array.isArray(raw)) {
    arr = raw;
  } else if (raw.orderedSelections) {
    arr = raw.orderedSelections;
  } else if (raw.picks) {
    arr = raw.picks;
  } else if (raw.selections) {
    arr = raw.selections;
  } else if (raw.data) {
    arr = raw.data;
  } else {
    const firstArrayKey = Object.keys(raw).find(
      k => Array.isArray(raw[k]) && raw[k].length && typeof raw[k][0] === "object"
    );
    if (firstArrayKey) arr = raw[firstArrayKey];
  }

  // Handle FleaFlicker table schema: { draftOrder:[...], rows:[ { round, cells:[...] } ] }
  if (Array.isArray(raw?.rows)) {
    const flattened = [];
    for (const row of raw.rows) {
      const r = Number(row.round ?? row.rnd ?? 0);
      const cells = Array.isArray(row.cells) ? row.cells : [];
      for (let i = 0; i < cells.length; i++) {
        const c = cells[i];
        const slot = Number(c?.slot?.slot ?? c?.pickInRound ?? (i + 1));
        const overall = Number(
          c?.slot?.overall ?? ((r > 0 && slot > 0) ? ((r - 1) * (cells.length || 12) + slot) : 0)
        );
        const merged = Object.assign({}, c, { slot: { round: r, slot, overall } });
        flattened.push(merged);
      }
    }
    return flattened
      .map(normalizePick)
      .filter(p => p.playerName)
      .sort((a,b) => a.overall - b.overall);
  }

  return arr
    .map(normalizePick)
    .filter(p => p.playerName)
    .sort((a,b) => a.overall - b.overall);
}

function deriveCurrentRound(picks, teamsCount) {
  if (!picks.length || !teamsCount) return 1;
  const maxOverall = Math.max(...picks.map(p => p.overall));
  return Math.max(1, Math.ceil(maxOverall / teamsCount));
}


function currentRoundFromPicks(picks, teamsCount) {
  if (!picks?.length || !teamsCount) return 1;
  const maxOverall = Math.max(...picks.map(p => p.overall));
  return Math.max(1, Math.ceil(maxOverall / teamsCount));
}

// Group picks by round, preserve team column order
function picksByRound(picks, teamOrder) {
  const map = new Map();
  for (const p of picks) {
    if (!map.has(p.round)) map.set(p.round, new Array(teamOrder.length).fill(null));
    const idx = teamOrder.indexOf(p.team);
    if (idx >= 0) map.get(p.round)[idx] = p;
  }
  return map; // { round -> [cells in team order] }
}

function formatPickChip(p) {
  // ex: “Scorgasms — Bijan Robinson (RB ATL) • #7”
  const teamLabel = draftHeaderForTeam(p.team);
  return `${teamLabel} — ${p.playerName} (${p.position} ${p.teamAbbr}) • #${p.overall}`;
}

function formatPlaceholder(teamName, round, slot, type) {
  const teamLabel = draftHeaderForTeam(teamName);
  if (type === "clock")  return `${teamLabel} — ON THE CLOCK (${round}:${slot})`;
  if (type === "pending")return `${teamLabel} — PENDING (${round}:${slot})`;
  return `${teamLabel} — ${round}:${slot}`;
}

// Build the chyron items array based on CHYRON.MODE
function buildChyronItems(picks, teamOrder) {
  const teams = teamOrder?.length ? teamOrder : deriveTeamOrder(picks);
  const roundNow = currentRoundFromPicks(picks, teams.length || 12);
  const byRound = picksByRound(picks, teams);

  if (CHYRON.MODE === "recent-picks") {
    const recent = [...picks].sort((a,b)=>b.overall-a.overall).slice(0, CHYRON.RECENT_COUNT).reverse();
    return recent.map(formatPickChip);
  }

  if (CHYRON.MODE === "upcoming-window") {
    const row = byRound.get(roundNow) || new Array(teams.length).fill(null);
    const result = [];
    // find first empty -> “on the clock”
    let firstEmptyIdx = row.findIndex(x => !x);
    if (firstEmptyIdx === -1) firstEmptyIdx = teams.length; // round full
    // include already-made picks (left of first empty) as chips
    for (let i = 0; i < Math.min(teams.length, CHYRON.UPCOMING_COUNT); i++) {
      const idx = (firstEmptyIdx - (Math.min(teams.length, CHYRON.UPCOMING_COUNT) - firstEmptyIdx) + i);
      const j = Math.max(0, Math.min(teams.length-1, i));
    }
    // simpler: current round left→right limited window
    for (let i = 0; i < teams.length && result.length < CHYRON.UPCOMING_COUNT; i++) {
      const pick = row[i];
      const slot = i + 1;
      if (pick) {
        result.push(formatPickChip(pick));
      } else if (CHYRON.SHOW_PLACEHOLDERS) {
        const type = (i === (row.findIndex(x=>!x))) ? "clock" : "pending";
        result.push(formatPlaceholder(teams[i], roundNow, slot, type));
      }
    }
    return result;
  }

  if (CHYRON.MODE === "current+previous") {
    const nowRow = byRound.get(roundNow) || [];
    const prevRow = byRound.get(roundNow - 1) || [];
    const nowItems  = nowRow.filter(Boolean).map(formatPickChip);
    const prevItems = prevRow.filter(Boolean).map(formatPickChip);
    // Optionally add placeholders at the end of current
    if (CHYRON.SHOW_PLACEHOLDERS) {
      for (let i=0;i<teams.length;i++) if (!nowRow[i]) {
        const slot = i+1;
        const type = (i === nowRow.findIndex(x=>!x)) ? "clock" : "pending";
        nowItems.push(formatPlaceholder(teams[i], roundNow, slot, type));
      }
    }
    return [...nowItems, ...prevItems];
  }

  // default: current-round
  const row = byRound.get(roundNow) || new Array(teams.length).fill(null);
  const items = row.filter(Boolean).map(formatPickChip);
  if (CHYRON.SHOW_PLACEHOLDERS) {
    for (let i=0;i<teams.length;i++) if (!row[i]) {
      const slot = i+1;
      const type = (i === row.findIndex(x=>!x)) ? "clock" : "pending";
      items.push(formatPlaceholder(teams[i], roundNow, slot, type));
    }
  }
  return items;
}


// -------------------------- Team Meta (exact file you added) --------------------------
function normKey(s) { return String(s || "").trim().toLowerCase(); }

async function loadTeamMeta() {
  try {
    const json = await fetchJSON(CONFIG.TEAM_META_FILE);
    // Your file format: array of objects with { name, CustomDraftBoardHeader, ... }
    // We build a case-insensitive map based on 'name'.
    const map = {};
    if (Array.isArray(json)) {
      for (const t of json) {
        const key = normKey(t.name);
        const label = t.CustomDraftBoardHeader || t.CustomName2 || t.CustomAbbreviation || t.initials || t.name;
        if (key && label) map[key] = String(label);
      }
    }
    state.teamMetaByName = map;
    return map;
  } catch {
    state.teamMetaByName = null;
    return null;
  }
}

function draftHeaderForTeam(teamName) {
  if (!state.teamMetaByName) return teamName;
  const hit = state.teamMetaByName[normKey(teamName)];
  return hit || teamName;
}

// -------------------------- Rendering --------------------------
function renderGrid(picks) {
  if (!elGrid) return;
  const teamOrder = state.teamOrder.length ? state.teamOrder : deriveTeamOrder(picks);
  state.teamOrder = teamOrder;
  const teamsCount = teamOrder.length || 12;

  // Ensure all rows use identical template (CSS reads this var)
  elGrid.style.setProperty("--teams-count", teamsCount);

  // How many rounds to show (cap to at least 22)
  const maxRound = Math.max( (picks.length ? Math.max(...picks.map(p => p.round)) : 0), 22 );

  // Map (round|team) -> pick
  const byKey = new Map();
  for (const p of picks) byKey.set(`${p.round}|${p.team}`, p);

  let html = "";
  // Header row
  html += `<div class="grid header">`;
  html += `<div class="hdr round sticky">Rd.</div>`;
  for (const t of teamOrder) html += `<div class="hdr team">${escapeHtml(draftHeaderForTeam(t))}</div>`;
  html += `<div class="hdr round sticky">Rd.</div>`;
  html += `</div>`;

  // Data rows
  for (let r = 1; r <= maxRound; r++) {
    html += `<div class="grid row">`;
    html += `<div class="cell round sticky">${r}</div>`;
    for (const t of teamOrder) {
      const p = byKey.get(`${r}|${t}`);
      if (!p) {
        html += `<div class="cell empty"></div>`;
      } else {
        const posCls = posClass(p.position);
        html += `<div class="cell pick ${posCls}" data-round="${p.round}" data-team="${escapeAttr(t)}" data-overall="${p.overall}">` +
                  `<div class="player"><span class="scroll-text">${escapeHtml(p.playerName)}</span></div>` +
                  `<div class="meta">${escapeHtml(p.position)} • ${escapeHtml(p.teamAbbr)} • ${p.round}:${p.slot} (#${p.overall})</div>` +
                `</div>`;
      }
    }
    html += `<div class="cell round sticky">${r}</div>`;
    html += `</div>`;
  }

  elGrid.innerHTML = html;
  enableCellScrolling(); // apply marquee if a name overflows
}

function enableCellScrolling() {
  const PX_PER_SECOND = 5; // tweak speed here (lower = slower, higher = faster)
  const nodes = elGrid.querySelectorAll(".cell.pick .player");

  nodes.forEach(el => {
    const inner = el.querySelector(".scroll-text");
    if (!inner) return;

    // reset any previous inline vars
    el.classList.remove("marquee");
    inner.style.removeProperty("--scroll-distance");
    inner.style.removeProperty("--marquee-duration");

    // measure overflow
    const distance = inner.scrollWidth - el.clientWidth;
    if (distance > 1) {
      // duration is "there" + "back" (because we bounce)
      const oneWay = Math.max(0.5, distance / PX_PER_SECOND);
      const roundTrip = oneWay; // animation uses 0%..100% then alternates back
      inner.style.setProperty("--scroll-distance", `${distance}px`);
      inner.style.setProperty("--marquee-duration", `${roundTrip}s`);
      el.classList.add("marquee");
    }
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}
function escapeAttr(s){ return escapeHtml(s).replace(/"/g,'&quot;'); }

// -------------------------- Chyron --------------------------
function setChyronRoundNumbers(round) {
  if (elChyronLeft)  elChyronLeft.textContent = `ROUND ${round}`;
  if (elChyronRight) elChyronRight.textContent = `ROUND ${round}`;
}

// Replace previous updateChyron with this scoped renderer
function renderChyronFromState() {
  if (!elChyronText) return;
  const items = buildChyronItems(state.picks, state.teamOrder);
  const text = items.join("    •    ");
  elChyronText.textContent = text;

  // Bounce animation vars (same speed model you liked)
  const PX_PER_SECOND = CHYRON.SPEED_PX_PER_SEC;
  // Measure after we set text
  requestAnimationFrame(() => {
    const lane = elChyronText;
    const distance = lane.scrollWidth - lane.clientWidth;
    const oneWay = Math.max(0.5, distance / PX_PER_SECOND);
    lane.style.setProperty("--chyron-distance", `${distance}px`);
    lane.style.setProperty("--chyron-duration", `${oneWay}s`);
    if (distance > 1) {
      elChyron.classList.remove("paused");
      lane.classList.add("bounce");
    } else {
      lane.classList.remove("bounce");
    }
  });
}


function pauseChyron() { if (elChyron) elChyron.classList.add("paused"); }
function resumeChyron(){ if (elChyron) elChyron.classList.remove("paused"); }

// -------------------------- Announcements --------------------------
async function processQueue() {
  if (!CONFIG.ANNOUNCEMENTS_ENABLED) return;
  if (state.isAnnouncing) return;
  const pick = state.pickQueue.shift();
  if (!pick) return;
  await announcePick(pick);
}

async function announcePick(pick) {
  if (!CONFIG.ANNOUNCEMENTS_ENABLED) return;
  state.isAnnouncing = true;
  try {
    pauseChyron();
    highlightCell(pick);
    if (elOverlay && elOverlayContent) {
      elOverlayContent.innerHTML = `
        <div class="stinger">
          <div class="title">PICK IS IN</div>
          <div class="team">${escapeHtml(pick.team)}</div>
          <div class="player">${escapeHtml(pick.playerName)}</div>
          <div class="meta">${escapeHtml(pick.position)} • ${escapeHtml(pick.teamAbbr)} • #${pick.overall}</div>
        </div>`;
      elOverlay.classList.remove("hidden");
    }
    await sleep(CONFIG.ANNOUNCE_FREEZE_MS);
  } finally {
    if (elOverlay) elOverlay.classList.add("hidden");
    unhighlightCell(pick);
    resumeChyron();
    state.isAnnouncing = false;
  }
}

function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }

function highlightCell(pick) {
  const sel = `.cell.pick[data-overall="${pick.overall}"]`;
  const cell = document.querySelector(sel);
  if (cell) cell.classList.add("glow");
}
function unhighlightCell(pick) {
  const sel = `.cell.pick[data-overall="${pick.overall}"]`;
  const cell = document.querySelector(sel);
  if (cell) cell.classList.remove("glow");
}

function renderNoPicksMessage() {
  const el = document.getElementById("draft-grid");
  if (!el) return;
  el.innerHTML = `<div class="grid header"><div class="hdr round sticky">Rnd</div></div>
                  <div style="padding:12px;color:#fff;background:#5a2b2b;border-radius:8px;">
                    No picks loaded. Check JSON shape and CONFIG paths.
                  </div>`;
}

// -------------------------- Polling --------------------------
async function poll() {
  const url = (CONFIG.MODE === "live" && CONFIG.LIVE_URL) ? CONFIG.LIVE_URL : CONFIG.MOCK_URL;
  try {
    const json = await fetchJSON(url);
    const picks = extractPicks(json);
    if (!picks.length) { renderNoPicksMessage(); return; }

    const seen = new Set(state.picks.map(p => p.overall));
    const newPicks = picks.filter(p => !seen.has(p.overall));

    state.picks = picks;
    renderGrid(state.picks);

    state.lastShownOverall = Math.max(state.lastShownOverall || 0, ...state.picks.map(p => p.overall));
    renderChyronFromState();

    const round = deriveCurrentRound(state.picks, state.teamOrder.length || deriveTeamOrder(state.picks).length);
    setChyronRoundNumbers(round);
    if (newPicks.length) renderChyronFromState();

    if (CONFIG.ANNOUNCEMENTS_ENABLED && newPicks.length) {
      state.pickQueue.push(...newPicks);
    }
  } catch (err) {
    console.error("Polling failed:", err);
  }
}

// -------------------------- Boot --------------------------
async function boot() {
  // Load team meta labels (uses your uploaded file)
  loadTeamMeta().catch(()=>{}); // non-blocking

  // Initial static render + single data load
  renderGrid(state.picks);
  setChyronRoundNumbers(1);
  resumeChyron();

  await poll();

  if (CONFIG.ENABLE_POLLING) setInterval(poll, CONFIG.POLL_MS);
  if (CONFIG.ANNOUNCEMENTS_ENABLED) setInterval(processQueue, 500);

  // Re-evaluate scrolling on resize
  window.addEventListener("resize", enableCellScrolling);
}

document.addEventListener("DOMContentLoaded", boot);
