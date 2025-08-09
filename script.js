// 🟩 CONFIG
const FLEAFLICKER_URL = 'mock/draftboard_btks_2024.json';
// const FLEAFLICKER_URL = 'https://corsproxy.io/?https://www.fleaflicker.com/api/FetchLeagueDraftBoard?sport=NFL&league_id=350963&season=2025&draft_number=0';

const POLL_INTERVAL_MS = 10000; // every 10 seconds
const ANNOUNCE_INTERVAL_MS = 5000; // every 5 seconds

// 🟨 STATE
let lastSeenOverall = 0;
let pickQueue = [];
let isAnnouncing = false;
let chyronPicks = [];
let teamOrder = [];

// Team meta (global, keyed by teamId)
let TEAM_META = new Map();

async function loadTeamMeta() {
  // adjust path if you put the file somewhere else
  const res = await fetch('data/fleaflicker_team_meta.json');
  if (!res.ok) throw new Error('Failed to load team meta');
  const arr = await res.json();
  TEAM_META = new Map(arr.map(t => [t.teamId, t]));
}

function draftHeaderForTeam(teamId, fallbackName) {
  const meta = TEAM_META.get(teamId);
  const custom = (meta?.CustomDraftBoardHeader || '').trim();
  return custom || fallbackName;
}




function buildBoard(picks) {
  const grid = document.getElementById('draft-grid');
  grid.innerHTML = '';

  // Set team order from Round 1 only once
  if (teamOrder.length === 0) {
    teamOrder = picks
      .filter(p => p.round === 1)
      .sort((a, b) => a.slot - b.slot) // slot should be correct order for Round 1
      .map(p => p.team_name);
  }

  // Create rows for 22 rounds
  for (let round = 1; round <= 22; round++) {
    const row = document.createElement('div');
    row.classList.add('round-row');

    // Create cells in the fixed team order
    teamOrder.forEach(teamName => {
      const pick = picks.find(
        p => p.round === round && p.team_name === teamName
      );

      const cell = document.createElement('div');
      cell.classList.add('pick-cell');

      if (pick) {
        cell.innerHTML = `
          <div class="pick-num">${pick.overall}</div>
          <div class="player">${pick.player_name}</div>
          <div class="pos-team">${pick.position} - ${pick.nfl_team}</div>
        `;
      }
      row.appendChild(cell);
    });

    grid.appendChild(row);
  }
}


// 🟥 MAIN POLLING FUNCTION
async function pollDraftData() {
  try {
    const response = await fetch(FLEAFLICKER_URL);
    const data = await response.json();

    const allPicks = extractPicks(data).sort((a, b) => a.overall - b.overall);
    const newPicks = allPicks.filter(p => p.overall > lastSeenOverall);

    if (newPicks.length > 0) {
      pickQueue.push(...newPicks);
      lastSeenOverall = newPicks[newPicks.length - 1].overall;
    }

    updateChyron(allPicks);
    renderGrid(allPicks);

  } catch (err) {
    console.error('Polling failed:', err);
  }
}

// 🟧 QUEUED ANNOUNCEMENT PROCESSOR
function extractPicks(data) {
  const picks = [];

  if (Array.isArray(data.orderedSelections) && data.orderedSelections.length) {
    data.orderedSelections.forEach(sel => {
      const p = sel.player?.proPlayer || sel.player || {};
      const proTeamName = p.proTeam?.name || p.proTeamAbbreviation || '';
      picks.push({
        round: sel.slot.round,
        overall: sel.slot.overall,
        pickInRound: sel.slot.slot,  // 1-based
        team_id: sel.team?.id || null,           // ⬅️ NEW
        team_name: sel.team?.name || '',
        team_initials: sel.team?.initials || '',
        player_name: p.nameFull || '',
        position: p.position || '',
        nfl_abbr: p.proTeam?.abbreviation || p.proTeamAbbreviation || '',
        nfl_team: p.proTeam?.name || '',         // surname (e.g., "Chiefs")
        nfl_city: p.proTeam?.location || '',     // e.g., "Kansas City"
        nfl_full: p.proTeam?.location && p.proTeam?.name ? `${p.proTeam.location} ${p.proTeam.name}` : '',
        headshot: p.headshotUrl || ''
      });
    });
    return picks;
  }

  // Fallback for older mocks that actually embed players in rows
  (data.rows || []).forEach(row => {
    (row.cells || []).forEach(cell => {
      if (cell.player) {
        const p = cell.player.proPlayer || cell.player;
        const proTeamName = p.proTeam?.name || p.proTeamAbbreviation || '';
        picks.push({
          round: row.round,
          overall: cell.slot.overall,
          pickInRound: cell.slot.slot, // if present
          team_id: cell.team.id || null, // ⬅️ NEW
          team_name: cell.team.name,
          team_initials: cell.team.initials || '',
          player_name: p.nameFull,
          position: p.position,
          nfl_abbr: p.proTeam?.abbreviation || p.proTeamAbbreviation || '',
          nfl_team: p.proTeam?.name || '',         // surname (e.g., "Chiefs")
          nfl_city: p.proTeam?.location || '',     // e.g., "Kansas City"
          nfl_full: p.proTeam?.location && p.proTeam?.name ? `${p.proTeam.location} ${p.proTeam.name}` : '',
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

// 📜 CHYRON SCROLLING TEXT
function updateChyron(picks) {
  const el = document.getElementById('chyron');

  const newChyronItems = picks
    .filter(p => !chyronPicks.includes(p.overall))
    .sort((a, b) => a.overall - b.overall)
    .map(p => {
      chyronPicks.push(p.overall);
      return `${p.overall}. ${p.player_name} (${p.position}, ${p.nfl_team})`;
    });

  if (newChyronItems.length > 0) {
    el.innerText += (el.innerText ? ' ● ' : '') + newChyronItems.join(' ● ');

    // Calculate dynamic scroll speed
    const textWidth = el.scrollWidth; // actual rendered pixel width
    const pxPerSecond = 50; // slower = smaller number, faster = bigger number
    const duration = textWidth / pxPerSecond;

    el.style.animationDuration = `${duration}s`;
  }
}



// 📊 RENDER GRID BIG BOARD (10x22)
function renderGrid(picks) {
  const grid = document.getElementById('draft-grid');
  grid.innerHTML = '';

  // Lock team order from Round 1 (id + name)
  const round1 = picks.filter(p => p.round === 1);
  const teamOrder = round1
  .sort((a, b) => a.pickInRound - b.pickInRound)
  .map(p => ({ id: p.team_id, name: p.team_name }));


  const numRounds = Math.max(...picks.map(p => p.round), 22);
  const teamCount = teamOrder.length || 10;
  grid.style.setProperty('--team-count', teamCount);

 // Header row
{
  // LEFT header round cell (label)
  const leftHdr = document.createElement('div');
  leftHdr.className = 'round-cell header left';
  leftHdr.textContent = 'Rnd';
  grid.appendChild(leftHdr);

  // Team headers
  teamOrder.forEach(t => {
    const cell = document.createElement('div');
    cell.className = 'draft-cell header-cell';
    cell.textContent = draftHeaderForTeam(t.id, t.name);
    grid.appendChild(cell);
  });

  // RIGHT header round cell (label)
  const rightHdr = document.createElement('div');
  rightHdr.className = 'round-cell header right';
  rightHdr.textContent = 'Rnd';
  grid.appendChild(rightHdr);
}



  // Body rows: one per round
for (let round = 1; round <= numRounds; round++) {
  // LEFT round badge
  const left = document.createElement('div');
  left.className = 'round-cell left';
  left.textContent = `R${round}`;
  grid.appendChild(left);

  // Team cells for this round
  teamOrder.forEach(t => {
  const cell = document.createElement('div');

  // find the pick by round + team_id
  const pick = picks.find(p => p.round === round && p.team_id === t.id);

  if (pick) {
    const posClass = pick.position ? `pos-${pick.position.toUpperCase()}` : '';
    cell.className = `draft-cell ${posClass}`;

    // Two-line content:
    // Line 1: Player Name
    // Line 2: POSITION – NFL_SURNAME   ROUND:SLOT(OVERALL)
    const metaLine = [
      pick.position || '',
      pick.nfl_abbr || ''
    ].filter(Boolean).join(' – ');

    cell.innerHTML = `
      <div class="player-line">${pick.player_name}</div>
      <div class="meta-line">${metaLine} &nbsp; ${round}:${pick.pickInRound}(${pick.overall})</div>
    `;
  } else {
    cell.className = 'draft-cell';
    cell.innerHTML = `
      <div class="player-line"></div>
      <div class="meta-line"></div>
    `;
  }

  grid.appendChild(cell);
});


  // RIGHT round badge
  const right = document.createElement('div');
  right.className = 'round-cell right';
  right.textContent = `R${round}`;
  grid.appendChild(right);
}


}

function setChyronRoundNumbers(currentRound) {
  document.getElementById('chyron-left-round').textContent = `R${currentRound}`;
  document.getElementById('chyron-right-round').textContent = `R${currentRound}`;
}


// 🚀 START POLLING & ANNOUNCING
(async function init() {
  try {
    await loadTeamMeta();           // ⬅️ load once
  } catch (e) {
    console.warn('Team meta load failed:', e);
  }
  // kick off the first poll and then the interval
  await pollDraftData();
  setInterval(pollDraftData, POLL_INTERVAL_MS);
})();
// setInterval(processQueue, ANNOUNCE_INTERVAL_MS);
