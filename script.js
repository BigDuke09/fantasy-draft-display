// 🟩 CONFIG
const FLEAFLICKER_URL = 'https://corsproxy.io/?https://www.fleaflicker.com/api/FetchLeagueDraftBoard?sport=NFL&league_id=350963&season=2025&draft_number=0';
const POLL_INTERVAL_MS = 10000; // every 10 seconds
const ANNOUNCE_INTERVAL_MS = 5000; // every 5 seconds

// 🟨 STATE
let lastSeenOverall = 0;
let pickQueue = [];
let isAnnouncing = false;

// 🟥 MAIN POLLING FUNCTION
async function pollDraftData() {
  try {
    const response = await fetch(FLEAFLICKER_URL);
    const data = await response.json();

    const allPicks = extractPicks(data).sort((a, b) => a.overall - b.overall);
    const newPicks = allPicks
      .filter(p => p.overall > lastSeenOverall);

    if (newPicks.length > 0) {
      pickQueue.push(...newPicks);
      lastSeenOverall = newPicks[newPicks.length - 1].overall;
    }

    updateBoard(allPicks);
    updateChyron(allPicks);
  } catch (err) {
    console.error('Polling failed:', err);
  }
}

// 🟧 QUEUED ANNOUNCEMENT PROCESSOR
function processQueue() {
  if (isAnnouncing || pickQueue.length === 0) return;

  const nextPick = pickQueue.shift();
  announcePick(nextPick);
}

// 🟩 EXTRACT PICK DATA FROM API JSON
function extractPicks(data) {
  const picks = [];
  data.rows.forEach(row => {
    row.cells.forEach(cell => {
      if (cell.player) {
        const p = cell.player.proPlayer;
        picks.push({
          round: row.round,
          overall: cell.slot.overall,
          team_name: cell.team.name,
          team_initials: cell.team.initials || '',
          player_name: p.nameFull,
          position: p.position,
          nfl_team: p.proTeam.name,
          headshot: p.headshotUrl || ''
        });
      }
    });
  });
  return picks;
}

// 🟦 ANIMATE PICK-IN DISPLAY
function announcePick(pick) {
  isAnnouncing = true;
  const el = document.getElementById('pick-announcement');
  el.innerHTML = `
    <h2>The Pick is In!</h2>
    <img src="${pick.headshot}" alt="${pick.player_name}" />
    <p><strong>${pick.player_name}</strong> (${pick.position}, ${pick.nfl_team})</p>
    <p>Selected by <strong>${pick.team_name}</strong> in Round ${pick.round}</p>
  `;
  el.classList.remove('hidden');

  setTimeout(() => {
    el.classList.add('hidden');
    isAnnouncing = false;
  }, 4000);
}

// 📋 BIG BOARD UPDATE
function updateBoard(picks) {
  const el = document.getElementById('draft-board');
  const sorted = picks.slice().sort((a, b) => a.overall - b.overall);
  el.innerHTML = sorted.map(pick =>
    `<div class="pick">
      ${pick.overall}. ${pick.player_name} (${pick.position}, ${pick.nfl_team}) - ${pick.team_name}
    </div>`
  ).join('');
}

// 📜 CHYRON SCROLLING TEXT
function updateChyron(picks) {
  const el = document.getElementById('chyron');
  const sorted = picks.slice().sort((a, b) => a.overall - b.overall);
  el.innerText = sorted
    .map(p => `${p.overall}. ${p.player_name} (${p.position}, ${p.nfl_team})`)
    .join(' ● ');

  // Restart animation
  el.style.animation = 'none';
  el.offsetHeight;
  el.style.animation = null;
}

// 🚀 START POLLING & ANNOUNCING
setInterval(pollDraftData, POLL_INTERVAL_MS);
setInterval(processQueue, ANNOUNCE_INTERVAL_MS);
