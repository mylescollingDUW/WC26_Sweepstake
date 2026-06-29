/* ============================================================
 * WC 2026 Sweepstake Dashboard — control room
 * ------------------------------------------------------------
 * Architecture
 *   1. Load four CSV tabs from a Google Sheet (or the embedded
 *      sample) and normalise the rows
 *   2. computeTeamStats: roll up matches into per-team totals
 *      + per-90 derived stats
 *   3. resolveAllPrizes: each prize returns a *full ranked list*
 *      (cards show top entry; modal shows the whole list)
 *   4. detectPhase: group-stage vs knockout vs complete
 *   5. Render: ticker, carousel (groups OR knockouts), prize
 *      cards, leaderboard, participants
 *
 * Data source — a single Google Sheet, four tabs
 *   Participants         — Group, Team, Entrant
 *   Match Data           — Date, Stage, Home Team, Away Team,
 *                          Home Score, Away Score, Minutes, then
 *                          per-match stat-panel numbers (shots,
 *                          SoT, possession %, fouls, yellows,
 *                          reds, offsides, corners). The Goal
 *                          Diff / Winning Team formula columns
 *                          are ignored — the dashboard recomputes.
 *   Awards               — manually filled in as announcements
 *                          happen. Tournament Winner / 2nd /
 *                          3rd / Golden Boot.
 *   Golden Boot Tracker  — Player / Country / Goals — kept up to
 *                          date through the tournament.
 *
 * Edit the Sheet (web, mobile, anywhere) and refresh the page.
 * No commits, no deploys, no JSON.
 * ============================================================ */

'use strict';

// ============================================================
// Constants
// ============================================================

const STAGE_ORDER = {
  'Group Stage': 1, 'Group': 1,
  'Round of 32': 2,
  'Round of 16': 3,
  'Quarter-finals': 4, 'Quarter-final': 4,
  'Semi-finals': 5, 'Semi-final': 5,
  'Third Place': 6, '3rd Place': 6, 'Third-place play-off': 6,
  'Final': 7,
};

const KNOCKOUT_STAGES = [
  { key: 'Round of 32',  label: 'Round of 32',         short: 'R32' },
  { key: 'Round of 16',  label: 'Round of 16',         short: 'R16' },
  { key: 'Quarter-finals', label: 'Quarter-finals',    short: 'QF'  },
  { key: 'Semi-finals',  label: 'Semi-finals',         short: 'SF'  },
  { key: 'Third Place',  label: 'Third-place play-off',short: '3rd' },
  { key: 'Final',        label: 'Final',               short: 'F'   },
];

// Aliases accepted in the Stage column. Listed labels all collapse
// onto the canonical keys used by STAGE_ORDER / KNOCKOUT_STAGES.
const STAGE_ALIASES = {
  'Quarter-final':         'Quarter-finals',
  'Quarter Finals':        'Quarter-finals',
  'Quarter-Finals':        'Quarter-finals',
  'Semi-final':            'Semi-finals',
  'Semi Finals':           'Semi-finals',
  'Semi-Finals':           'Semi-finals',
  '3rd Place':             'Third Place',
  'Third Place Play-Off':  'Third Place',
  'Third Place Play-off':  'Third Place',
  'Third-place play-off':  'Third Place',
  'Group Stage':           'Group',
};

// Country -> FIFA 3-letter code. Now the flag image's alt text and
// the fallback chip when an image can't load (see ISO2 / flagFor).
// We still avoid emoji flags — regional-indicator pairs don't render
// on Windows Chrome (the office environment) — but a real flag image
// is reliable, with the code kept as a graceful backstop.
const COUNTRY_CODE = {
  // The 48 finalists, named exactly as in the Sheet's Participants tab.
  'Mexico':'MEX', 'South Africa':'RSA', 'Korea Republic':'KOR', 'Czechia':'CZE',
  'Canada':'CAN', 'Bosnia and Herzegovina':'BIH', 'Qatar':'QAT', 'Switzerland':'SUI',
  'Brazil':'BRA', 'Morocco':'MAR', 'Haiti':'HAI', 'Scotland':'SCO',
  'USA':'USA', 'Paraguay':'PAR', 'Australia':'AUS', 'Türkiye':'TUR',
  'Germany':'GER', 'Curaçao':'CUW', "Côte d'Ivoire":'CIV', 'Ecuador':'ECU',
  'Netherlands':'NED', 'Japan':'JPN', 'Sweden':'SWE', 'Tunisia':'TUN',
  'Belgium':'BEL', 'Egypt':'EGY', 'IR Iran':'IRN', 'New Zealand':'NZL',
  'Spain':'ESP', 'Cabo Verde':'CPV', 'Saudi Arabia':'KSA', 'Uruguay':'URU',
  'France':'FRA', 'Senegal':'SEN', 'Iraq':'IRQ', 'Norway':'NOR',
  'Argentina':'ARG', 'Algeria':'ALG', 'Austria':'AUT', 'Jordan':'JOR',
  'Portugal':'POR', 'Congo DR':'COD', 'Uzbekistan':'UZB', 'Colombia':'COL',
  'England':'ENG', 'Croatia':'CRO', 'Ghana':'GHA', 'Panama':'PAN',
  // Legacy aliases — only the embedded sample data uses these names.
  'Cameroon':'CMR', 'Iceland':'ISL', 'Wales':'WAL', 'Costa Rica':'CRC',
  'Poland':'POL', 'Serbia':'SRB', 'South Korea':'KOR', 'Italy':'ITA',
  'Denmark':'DEN', 'Iran':'IRN', 'Nigeria':'NGA', 'Czech Republic':'CZE',
  'Ivory Coast':'CIV', 'Turkey':'TUR', 'Bolivia':'BOL', 'Jamaica':'JAM',
};
// Backwards-compat: callers still reference FLAG_LOOKUP, so
// keep the symbol alive but make it return the country code.
const FLAG_LOOKUP = COUNTRY_CODE;

// Country -> ISO 3166-1 alpha-2 (lowercase) — the key flagcdn uses
// for its flag images. Home nations map to GB subdivision codes
// (gb-eng / gb-wls / gb-sct). Any country missing here (after the
// normalised fallback below) falls back to the COUNTRY_CODE chip.
const ISO2 = {
  // The 48 finalists, named exactly as in the Sheet's Participants tab.
  'Mexico':'mx', 'South Africa':'za', 'Korea Republic':'kr', 'Czechia':'cz',
  'Canada':'ca', 'Bosnia and Herzegovina':'ba', 'Qatar':'qa', 'Switzerland':'ch',
  'Brazil':'br', 'Morocco':'ma', 'Haiti':'ht', 'Scotland':'gb-sct',
  'USA':'us', 'Paraguay':'py', 'Australia':'au', 'Türkiye':'tr',
  'Germany':'de', 'Curaçao':'cw', "Côte d'Ivoire":'ci', 'Ecuador':'ec',
  'Netherlands':'nl', 'Japan':'jp', 'Sweden':'se', 'Tunisia':'tn',
  'Belgium':'be', 'Egypt':'eg', 'IR Iran':'ir', 'New Zealand':'nz',
  'Spain':'es', 'Cabo Verde':'cv', 'Saudi Arabia':'sa', 'Uruguay':'uy',
  'France':'fr', 'Senegal':'sn', 'Iraq':'iq', 'Norway':'no',
  'Argentina':'ar', 'Algeria':'dz', 'Austria':'at', 'Jordan':'jo',
  'Portugal':'pt', 'Congo DR':'cd', 'Uzbekistan':'uz', 'Colombia':'co',
  'England':'gb-eng', 'Croatia':'hr', 'Ghana':'gh', 'Panama':'pa',
  // Legacy aliases — only the embedded sample data uses these names.
  'Cameroon':'cm', 'Iceland':'is', 'Wales':'gb-wls', 'Costa Rica':'cr',
  'Poland':'pl', 'Serbia':'rs', 'South Korea':'kr', 'Italy':'it',
  'Denmark':'dk', 'Iran':'ir', 'Nigeria':'ng', 'Czech Republic':'cz',
  'Ivory Coast':'ci', 'Turkey':'tr', 'Bolivia':'bo', 'Jamaica':'jm',
};

// Case/accent/punctuation-insensitive lookup, so a Sheet that writes
// "Turkiye" or "Cote d'Ivoire" (no accents) still resolves a flag.
const normTeamKey = s => String(s || '')
  .normalize('NFD').replace(/\p{M}/gu, '')   // strip combining accents
  .replace(/[^a-z0-9]+/gi, '')               // drop spaces/punctuation
  .toLowerCase();
const ISO2_BY_NORM = {};
const CODE_BY_NORM = {};
for (const [name, c] of Object.entries(ISO2))         ISO2_BY_NORM[normTeamKey(name)] = c;
for (const [name, c] of Object.entries(COUNTRY_CODE)) CODE_BY_NORM[normTeamKey(name)] = c;

// Prize categories — declarative. Adding a new one is one entry.
// Each resolver returns: { ranked: [...], leaderRank: <value>, isFinal?: bool, note?: string }
// The 10 money prizes from the launch email — and nothing else.
// Order mirrors the email. £ values live in the Google Sheet tracker.
const PRIZE_CATEGORIES = [
  { key: 'winner',         label: '1st Place',                podium: 1, resolver: prizeFinalPosition(1), unit: '' },
  { key: 'runnerup',       label: '2nd Place',                podium: 2, resolver: prizeFinalPosition(2), unit: '' },
  { key: 'third',          label: '3rd Place',                podium: 3, resolver: prizeFinalPosition(3), unit: '' },
  { key: 'goldenBoot',     label: 'Golden Boot',                         resolver: prizeGoldenBoot,                              unit: 'goals' },
  { key: 'biggestLoss',    label: 'Largest negative goal difference',    resolver: prizeMin('goalDifference', { minMatches: 1 }),  unit: 'GD', avg: true },
  { key: 'shotsP90',       label: 'Most shots / 90',                     resolver: prizeMax('shotsP90',    { minMatches: 1 }),    unit: '', decimals: 2, avg: true },
  { key: 'avgPoss',        label: 'Highest avg possession',              resolver: prizeMax('avgPossession', { minMatches: 1 }),  unit: '%', decimals: 1, avg: true },
  { key: 'foulsP90',       label: 'Most fouls / 90',                     resolver: prizeMax('foulsP90',    { minMatches: 1 }),    unit: '', decimals: 2, avg: true },
  { key: 'offsidesP90',    label: 'Most offsides / 90',                  resolver: prizeMax('offsidesP90', { minMatches: 1 }),    unit: '', decimals: 2, avg: true },
  { key: 'cornersP90',     label: 'Most corners / 90',                   resolver: prizeMax('cornersP90',  { minMatches: 1 }),    unit: '', decimals: 2, avg: true },
];

// ============================================================
// State
// ============================================================

const STATE = {
  teams: [],
  matches: [],
  prizes: [],
  awards: {},               // keyed by prize key — see AWARD_KEY_BY_LABEL
  goldenBoot: [],           // [{player, country, goals}], sorted desc
  stats: new Map(),
  prizeResults: [],
  phase: 'group',           // 'group' | 'knockout' | 'complete'
  carouselMode: 'group',    // mirrors phase but separate so we can flip explicitly
  carouselIndex: 0,
  carouselTimer: null,
  carouselPlaying: true,
  filter: '',
  sortKey: 'points',
  sortDir: 'desc',
  ownersSort: 'prizes',
  hasLanded: false,
  spotlightTimer: null,
};
const CAROUSEL_AUTO_MS = 7000;

// ============================================================
// Helpers
// ============================================================

const $  = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));

function setStatus(msg, kind) {
  // Diagnostics only — kept off the page so office viewers don't see
  // load/status chatter. Routed to the browser console instead.
  if (!msg) return;
  (kind === 'error' ? console.warn : console.log)('[sweepstake]', msg);
}
function n(v) { return Number(v) || 0; }
function fmtDate(d) {
  if (!d) return '';
  if (d instanceof Date && !isNaN(d)) return d.toISOString().slice(0, 10);
  return String(d);
}
function fmtShortDate(d) {
  const dt = d instanceof Date ? d : (d ? new Date(d) : null);
  if (!dt || isNaN(dt)) return String(d || '');
  return dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function parseBool(v) {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    return s === 'true' || s === 'yes' || s === 'y' || s === '1';
  }
  return false;
}
function flagFor(team, _override) {
  // Render the country's flag as an image (flagcdn). The 3-letter
  // COUNTRY_CODE is the alt text and an automatic fallback chip if
  // the image can't load or the country is unknown — image flags are
  // reliable (unlike emoji on Windows Chrome) and the code keeps the
  // old newspaper look as a backstop. Returns an HTML string: every
  // call site interpolates it as innerHTML inside a .flag-style slot.
  const nk = normTeamKey(team);
  const iso = ISO2[team] || ISO2_BY_NORM[nk];
  const code = COUNTRY_CODE[team] || CODE_BY_NORM[nk] || (team || '').slice(0, 3).toUpperCase() || '—';
  if (!iso) return `<span class="flag-code">${escapeHtml(code)}</span>`;
  return `<img class="flag-img" src="https://flagcdn.com/${iso}.svg"`
       + ` alt="${escapeHtml(team)} flag" data-code="${escapeHtml(code)}" loading="lazy">`;
}
function canonicalStage(s) {
  const t = String(s || '').trim();
  return STAGE_ALIASES[t] || t;
}
function isGroupStage(s) {
  const c = canonicalStage(s);
  return c === 'Group' || c === 'Group Stage';
}
// Team-name variants seen in the Match Data tab that must collapse onto
// the exact spelling used in the Participants tab (the canonical key for
// stats, flags and owners). Without this a single stray spelling in a
// knockout row loses that team's flag/owner and — worse — could flag a
// qualified team as eliminated. Bias the map toward the Participants name.
const TEAM_ALIASES = {
  'DR Congo': 'Congo DR',
};
function canonicalTeam(name) {
  const t = String(name || '').trim();
  return TEAM_ALIASES[t] || t;
}
function hasResult(m) {
  return m.HomeGoals !== '' && m.HomeGoals != null
      && m.AwayGoals !== '' && m.AwayGoals != null;
}

// ============================================================
// Sample data
// ------------------------------------------------------------
// Embedded so the dashboard renders immediately on first load
// (or under file://). 48 teams, 24 participants (2 teams each),
// 72 group-stage matches with deterministic plausible scores
// and per-90 stats derived from FIFA-rank gap.
// ============================================================

function generateSampleData() {
  const TEAMS_RAW = [
    ['Mexico','A',13],['Saudi Arabia','A',56],['Cameroon','A',41],['Jamaica','A',64],
    ['Canada','B',31],['Egypt','B',36],['Iceland','B',70],['Algeria','B',38],
    ['USA','C',16],['Wales','C',28],['Japan','C',18],['Costa Rica','C',50],
    ['Argentina','D',1],['New Zealand','D',95],['Poland','D',33],['Tunisia','D',39],
    ['Brazil','E',5],['Switzerland','E',19],['Serbia','E',30],['Croatia','E',7],
    ['France','F',2],['Germany','F',16],['Australia','F',25],['South Korea','F',22],
    ['Spain','G',8],['Belgium','G',4],['Morocco','G',13],['Ghana','G',60],
    ['England','H',5],['Netherlands','H',7],['Portugal','H',9],['Uruguay','H',11],
    ['Italy','I',10],['Denmark','I',19],['Ecuador','I',32],['Iran','I',20],
    ['Colombia','J',12],['Sweden','J',26],['Nigeria','J',41],['Qatar','J',43],
    ['Norway','K',41],['Czech Republic','K',35],['Ivory Coast','K',40],['Panama','K',47],
    ['Austria','L',25],['Turkey','L',38],['South Africa','L',58],['Bolivia','L',84],
  ];
  const PARTICIPANTS = [
    'Alex','Jamie','Sam','Taylor','Casey','Jordan','Morgan','Riley',
    'Avery','Quinn','Drew','Skylar','Reese','Sage','Rowan','Emery',
    'Parker','Blake','Cameron','Devon','Elliot','Finley','Harper','Logan',
  ];

  const teams = TEAMS_RAW.map((row, idx) => ({
    TeamID: row[0],
    Team: row[0],
    Group: row[1],
    FIFA_Rank: row[2],
    FlagEmoji: '',
    Participant: '',
    Eliminated: false,
    EliminationStage: '',
    EliminationDate: '',
    FinalPosition: '',
  }));

  // Deterministic shuffle, then assign participants round-robin.
  const order = teams.map((_, i) => i);
  shuffleSeeded(order, 42);
  for (let i = 0; i < order.length; i++) {
    teams[order[i]].Participant = PARTICIPANTS[i % PARTICIPANTS.length];
  }

  // 72 group-stage matches.
  const matches = [];
  let matchId = 1;
  const groupStart = new Date(2026, 5, 11);
  const pairings = [[0,1],[2,3],[0,2],[1,3],[0,3],[1,2]];

  for (const groupCode of ['A','B','C','D','E','F','G','H','I','J','K','L']) {
    const gTeams = teams.filter(t => t.Group === groupCode);
    pairings.forEach(([a, b], idx) => {
      const home = gTeams[a], away = gTeams[b];
      const matchDay = Math.floor(idx / 2); // 0, 1, 2
      const date = new Date(groupStart);
      date.setDate(groupStart.getDate() + matchDay * 4 + (groupCode.charCodeAt(0) - 65) % 3);
      // Sample state: matchdays 1 & 2 complete; matchday 3 left as
      // fixtures so the demo sits in mid-tournament group stage.
      const isPlayed = matchDay < 2;
      const stats = isPlayed ? pseudoMatchStats(home, away, matchId * 17) : emptyMatchStats();
      matches.push({
        MatchID: 'M' + String(matchId++).padStart(3, '0'),
        Date: date,
        Stage: 'Group',
        Group: groupCode,
        HomeTeam: home.Team,
        AwayTeam: away.Team,
        HomeFlagEmoji: '',
        AwayFlagEmoji: '',
        Minutes: isPlayed ? 90 : 90,
        ...stats,
        HomeNotableEvents: '',
        AwayNotableEvents: '',
        Winner: '',
        Notes: '',
      });
    });
  }

  // Placeholder R32 fixtures — date set, teams empty so they render
  // as TBD in the bracket while group stage is still being played.
  const r32Start = new Date(2026, 5, 27);
  for (let i = 0; i < 16; i++) {
    const d = new Date(r32Start);
    d.setDate(r32Start.getDate() + Math.floor(i / 4));
    matches.push({
      MatchID: 'M' + String(matchId++).padStart(3, '0'),
      Date: d,
      Stage: 'Round of 32',
      Group: '',
      HomeTeam: '', AwayTeam: '',
      HomeFlagEmoji: '', AwayFlagEmoji: '',
      Minutes: 90,
      ...emptyMatchStats(),
      HomeNotableEvents: '', AwayNotableEvents: '',
      Winner: '', Notes: '',
    });
  }

  // Demo Golden Boot: one scorer per a few teams, deterministic
  // counts so the live race shows something on first load.
  const goldenBoot = [
    { player: 'Sample Striker A', country: 'Argentina', goals: 4 },
    { player: 'Sample Striker B', country: 'France',    goals: 3 },
    { player: 'Sample Striker C', country: 'Spain',     goals: 3 },
    { player: 'Sample Striker D', country: 'Brazil',    goals: 2 },
    { player: 'Sample Striker E', country: 'Portugal',  goals: 2 },
  ];

  return { teams, matches, prizes: [], awards: {}, goldenBoot };
}

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffleSeeded(arr, seed) {
  const r = mulberry32(seed);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

function emptyMatchStats() {
  return {
    HomeGoals: '', AwayGoals: '',
    HomeShots: 0, AwayShots: 0,
    HomeSoT: 0, AwaySoT: 0,
    HomePossession: 0, AwayPossession: 0,
    HomeFouls: 0, AwayFouls: 0,
    HomeYellowCards: 0, AwayYellowCards: 0,
    HomeRedCards: 0, AwayRedCards: 0,
    HomeOffsides: 0, AwayOffsides: 0,
    HomeCorners: 0, AwayCorners: 0,
    HomePenaltyGoals: '', AwayPenaltyGoals: '',
    HomePenaltiesConceded: 0, AwayPenaltiesConceded: 0,
  };
}

function pseudoMatchStats(home, away, seed) {
  const r = mulberry32(seed);
  const gap = away.FIFA_Rank - home.FIFA_Rank;
  const homeAdv = 0.3 + Math.max(-0.5, Math.min(0.5, gap / 60));
  const hg = Math.max(0, Math.round(homeAdv + 1.2 + (r() - 0.5) * 2));
  const ag = Math.max(0, Math.round(1.0 - homeAdv * 0.5 + (r() - 0.5) * 2));
  // Plausible per-match stats. Possession sums to 100. Shots
  // skew toward the home side roughly with rank-gap.
  const homePoss = Math.round(50 + homeAdv * 25 + (r() - 0.5) * 10);
  const awayPoss = 100 - homePoss;
  const homeShots = 6 + Math.floor(r() * 12) + Math.max(0, hg);
  const awayShots = 4 + Math.floor(r() * 10) + Math.max(0, ag);
  return {
    HomeGoals: hg,
    AwayGoals: ag,
    HomeShots: homeShots,
    AwayShots: awayShots,
    HomeSoT: Math.min(homeShots, hg + Math.floor(r() * 4) + 1),
    AwaySoT: Math.min(awayShots, ag + Math.floor(r() * 4) + 1),
    HomePossession: homePoss,
    AwayPossession: awayPoss,
    HomeFouls: 6 + Math.floor(r() * 10),
    AwayFouls: 6 + Math.floor(r() * 10),
    HomeYellowCards: Math.floor(r() * 4),
    AwayYellowCards: Math.floor(r() * 4),
    HomeRedCards: r() < 0.06 ? 1 : 0,
    AwayRedCards: r() < 0.06 ? 1 : 0,
    HomeOffsides: Math.floor(r() * 5),
    AwayOffsides: Math.floor(r() * 5),
    HomeCorners: Math.floor(r() * 8) + 1,
    AwayCorners: Math.floor(r() * 8) + 1,
    HomePenaltyGoals: '',
    AwayPenaltyGoals: '',
    HomePenaltiesConceded: 0,
    AwayPenaltiesConceded: 0,
  };
}
function prizeDescription(key) {
  return ({
    winner:           'Tournament winner',
    runnerup:         'Runner-up',
    third:            'Third place',
    goldenBoot:       "Team of the tournament's top scorer",
    biggestLoss:      'Most negative aggregate goal difference',
    shotsP90:         'Most shots per 90 minutes played',
    avgPoss:          'Highest average possession across the tournament',
    foulsP90:         'Most fouls committed per 90 minutes played',
    offsidesP90:      'Most offsides per 90 minutes played',
    cornersP90:       'Most corners per 90 minutes played',
  })[key] || '';
}

// ============================================================
// Stats — roll up matches into per-team totals.
// ============================================================

function computeTeamStats(teams, matches) {
  const stats = new Map();
  for (const t of teams) {
    stats.set(t.Team, {
      team: t.Team,
      group: t.Group,
      flag: flagFor(t.Team),
      participant: t.Participant || '',
      played: 0, wins: 0, draws: 0, losses: 0,
      goalsFor: 0, goalsAgainst: 0, goalDifference: 0,
      points: 0, groupPoints: 0,
      biggestWinMargin: 0,
      // raw totals across the team's matches
      minutes: 0,
      shotsTotal: 0,
      sotTotal: 0,
      possessionSum: 0,        // sum of match possession % (averaged later)
      foulsTotal: 0,
      yellowCards: 0, redCards: 0,
      cardPoints: 0,           // Y*1 + R*2 raw total
      offsidesTotal: 0,
      cornersTotal: 0,
      // per-90 derived (filled in second pass)
      shotsP90: 0, sotP90: 0,
      foulsP90: 0, cardsP90: 0,
      offsidesP90: 0, cornersP90: 0,
      avgPossession: 0,
      eliminated: !!t.Eliminated,
      eliminationStage: t.EliminationStage || '',
      eliminationDate: t.EliminationDate || '',
      finalPosition: t.FinalPosition === '' || t.FinalPosition == null ? '' : Number(t.FinalPosition),
    });
  }

  for (const m of matches) {
    if (!m.HomeTeam || !m.AwayTeam || !hasResult(m)) continue;
    const home = stats.get(m.HomeTeam);
    const away = stats.get(m.AwayTeam);
    if (!home || !away) continue;

    const hg = n(m.HomeGoals);
    const ag = n(m.AwayGoals);

    home.played++; away.played++;
    home.goalsFor += hg; home.goalsAgainst += ag;
    away.goalsFor += ag; away.goalsAgainst += hg;
    home.yellowCards += n(m.HomeYellowCards);
    away.yellowCards += n(m.AwayYellowCards);
    home.redCards += n(m.HomeRedCards);
    away.redCards += n(m.AwayRedCards);

    // Per-90 inputs
    const mins = n(m.Minutes) || 90;
    home.minutes += mins; away.minutes += mins;
    home.shotsTotal    += n(m.HomeShots);    away.shotsTotal    += n(m.AwayShots);
    home.sotTotal      += n(m.HomeSoT);      away.sotTotal      += n(m.AwaySoT);
    home.possessionSum += n(m.HomePossession); away.possessionSum += n(m.AwayPossession);
    home.foulsTotal    += n(m.HomeFouls);    away.foulsTotal    += n(m.AwayFouls);
    home.offsidesTotal += n(m.HomeOffsides); away.offsidesTotal += n(m.AwayOffsides);
    home.cornersTotal  += n(m.HomeCorners);  away.cornersTotal  += n(m.AwayCorners);

    let pHome = 0, pAway = 0;
    const margin = Math.abs(hg - ag);
    if (hg > ag) {
      home.wins++; away.losses++; pHome = 3;
      if (margin > home.biggestWinMargin) home.biggestWinMargin = margin;
    } else if (ag > hg) {
      away.wins++; home.losses++; pAway = 3;
      if (margin > away.biggestWinMargin) away.biggestWinMargin = margin;
    } else {
      home.draws++; away.draws++; pHome = 1; pAway = 1;
    }
    home.points += pHome; away.points += pAway;
    if (isGroupStage(m.Stage)) {
      home.groupPoints += pHome;
      away.groupPoints += pAway;
    }
  }

  for (const s of stats.values()) {
    s.goalDifference = s.goalsFor - s.goalsAgainst;
    s.cardPoints = s.yellowCards * 1 + s.redCards * 2;
    const m = s.minutes;
    const p90 = v => m > 0 ? v / m * 90 : 0;
    s.shotsP90    = p90(s.shotsTotal);
    s.sotP90      = p90(s.sotTotal);
    s.foulsP90    = p90(s.foulsTotal);
    s.cardsP90    = p90(s.cardPoints);
    s.offsidesP90 = p90(s.offsidesTotal);
    s.cornersP90  = p90(s.cornersTotal);
    s.avgPossession = s.played > 0 ? s.possessionSum / s.played : 0;
  }
  return stats;
}

// ============================================================
// Prize resolvers
// ------------------------------------------------------------
// Each returns the *full ranked list*, so cards (top entry)
// and the modal (entire list) both read from the same data.
//
// Status values:
//   'leading'     — value matches the current leader value
//   'contention'  — team can still catch up (active in tournament)
//   'eliminated'  — team is out of tournament and below leader
//   'won'         — prize is final and this team holds it
//   'tbd'         — prize state not known yet
// ============================================================

function rankAndStatus(items, opts) {
  // items: [{team, participant, flag, value, eliminated, ...}], sorted best-first.
  // Returns same items annotated with rank + status.
  if (!items.length) return items;
  const leaderValue = items[0].value;
  const direction = opts && opts.lower ? 'lower' : 'higher';
  let curRank = 0, prevValue = null;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (i === 0 || it.value !== prevValue) curRank = i + 1;
    it.rank = curRank;
    prevValue = it.value;
    if (it.value === leaderValue) {
      it.status = 'leading';
    } else if (it.eliminated) {
      it.status = 'eliminated';
    } else if (direction === 'lower' && it.value > leaderValue) {
      // For "fewest", an active team with already-higher value still in race
      // (their tally only grows, but the leader's might too). Keep as contention.
      it.status = 'contention';
    } else {
      it.status = 'contention';
    }
  }
  return items;
}

function prizeMax(field, opts) {
  opts = opts || {};
  return function (stats) {
    const items = [];
    for (const s of stats.values()) {
      if (opts.minMatches && s.played < opts.minMatches) continue;
      items.push({
        team: s.team, participant: s.participant, flag: s.flag,
        value: s[field], eliminated: s.eliminated, group: s.group,
      });
    }
    items.sort((a, b) => b.value - a.value);
    if (!items.length || (opts.minValue != null && items[0].value < opts.minValue)) {
      return { ranked: [], leaderRank: null, note: 'No data yet' };
    }
    return { ranked: rankAndStatus(items), leaderRank: items[0].value };
  };
}
function prizeMin(field, opts) {
  opts = opts || {};
  return function (stats) {
    const items = [];
    for (const s of stats.values()) {
      if (opts.minMatches && s.played < opts.minMatches) continue;
      items.push({
        team: s.team, participant: s.participant, flag: s.flag,
        value: s[field], eliminated: s.eliminated, group: s.group,
      });
    }
    items.sort((a, b) => a.value - b.value);
    if (!items.length) {
      return { ranked: [], leaderRank: null, note: opts.minMatches ? 'Need ' + opts.minMatches + '+ matches' : 'No data yet' };
    }
    return { ranked: rankAndStatus(items, { lower: true }), leaderRank: items[0].value };
  };
}
function prizeFinalPosition(pos) {
  return function (stats, ctx) {
    const items = [];
    for (const t of ctx.teams) {
      if (Number(t.FinalPosition) === pos) {
        const s = stats.get(t.Team);
        items.push({
          team: t.Team,
          participant: s ? s.participant : (t.Participant || ''),
          flag: (s && s.flag) || flagFor(t.Team, t.FlagEmoji),
          value: '',
          eliminated: false,
          group: t.Group || '',
        });
      }
    }
    if (!items.length) return { ranked: [], leaderRank: null, note: 'TBD', autoFinal: false };
    items.forEach((it, i) => { it.rank = i + 1; it.status = 'won'; });
    return { ranked: items, leaderRank: '', autoFinal: true };
  };
}

// Awards-driven prizes (Golden Ball / Glove / Young Player). Until
// the user fills in the country in the Awards sheet, the prize is
// TBD. Once filled, the country's team becomes the confirmed
// winner.
function prizeAward(awardKey) {
  return function (stats, ctx) {
    const award = ctx.awards && ctx.awards[awardKey];
    if (!award || !award.country) {
      return { ranked: [], leaderRank: null, note: 'Awarded post-tournament', autoFinal: false };
    }
    const country = award.country;
    const s = stats.get(country);
    const item = {
      team: country,
      participant: s ? s.participant : participantFor(ctx.teams, country),
      flag: s ? s.flag : flagFor(country),
      value: award.player || '',
      valueLabel: award.player ? award.player + ' (' + country + ')' : country,
      eliminated: false,
      group: s ? s.group : (groupFor(ctx.teams, country) || ''),
      rank: 1,
      status: 'won',
    };
    return { ranked: [item], leaderRank: award.player || country, autoFinal: true };
  };
}

// Golden Boot — live: top scorer in Golden Boot Tracker; once the
// Awards sheet has a confirmed entry, that wins outright.
function prizeGoldenBoot(stats, ctx) {
  const award = ctx.awards && ctx.awards.goldenBoot;
  if (award && award.country) {
    return prizeAward('goldenBoot')(stats, ctx);
  }
  const scorers = ctx.goldenBoot || [];
  if (!scorers.length) {
    return { ranked: [], leaderRank: null, note: 'No goals tracked yet', autoFinal: false };
  }
  const top = scorers[0].goals;
  // The prize is "team of the tournament's top scorer", so the race is
  // between teams, not individuals. scorers is sorted goals-desc, so the
  // first time we see a country is its top scorer — keep that row only.
  const seen = new Set();
  const items = [];
  for (const sc of scorers) {
    if (seen.has(sc.country)) continue;
    seen.add(sc.country);
    const s = stats.get(sc.country);
    items.push({
      team: sc.country,
      participant: s ? s.participant : participantFor(ctx.teams, sc.country),
      flag: s ? s.flag : flagFor(sc.country),
      value: sc.goals,
      valueLabel: sc.goals + (Number(sc.goals) === 1 ? ' goal — ' : ' goals — ') + sc.player,
      eliminated: false,
      group: s ? s.group : (groupFor(ctx.teams, sc.country) || ''),
    });
  }
  items.sort((a, b) => b.value - a.value);
  return { ranked: rankAndStatus(items), leaderRank: top, autoFinal: false };
}

function participantFor(teams, country) {
  const t = teams.find(x => x.Team === country);
  return t ? (t.Participant || '') : '';
}
function groupFor(teams, country) {
  const t = teams.find(x => x.Team === country);
  return t ? (t.Group || '') : '';
}

// ============================================================
// Phase / finalisation
// ============================================================

function detectPhase(matches, awards) {
  const winnerAwarded = awards && awards.winner && awards.winner.country;
  const finalsPlayed = matches.some(m => canonicalStage(m.Stage) === 'Final' && hasResult(m));
  if (winnerAwarded || finalsPlayed) return 'complete';
  const knockoutPlayed = matches.some(m => !isGroupStage(m.Stage) && hasResult(m));
  if (knockoutPlayed) return 'knockout';
  const groups = matches.filter(m => isGroupStage(m.Stage));
  const groupsAllPlayed = groups.length > 0 && groups.every(hasResult);
  if (groupsAllPlayed) return 'knockout';
  return 'group';
}

// Short, friendly label for an elimination stage badge ("Groups" reads
// better than the canonical "Group"; knockout rounds keep their names).
function eliminationStageLabel(stage) {
  const c = canonicalStage(stage);
  if (c === 'Group' || c === 'Group Stage') return 'Groups';
  return c || 'Out';
}

// Decide a knockout tie's winner/loser. Prefers an explicit "Winning
// Team" (covers ties settled on penalties), else falls back to the
// score. Returns null when level with no recorded winner — undecided,
// so neither side is treated as out.
function decideWinner(m) {
  if (!m.HomeTeam || !m.AwayTeam) return null;
  const hg = n(m.HomeGoals), ag = n(m.AwayGoals);
  let winner = '';
  if (m.Winner && (m.Winner === m.HomeTeam || m.Winner === m.AwayTeam)) winner = m.Winner;
  else if (hg > ag) winner = m.HomeTeam;
  else if (ag > hg) winner = m.AwayTeam;
  else return null;
  return { winner, loser: winner === m.HomeTeam ? m.AwayTeam : m.HomeTeam };
}

// Derive who's knocked out purely from results, so the All-Teams table
// and Owners cards update themselves as games are entered. Two sources:
//   (1) the losing side of any completed knockout tie, and
//   (2) once the full Round-of-32 draw is in, every team that didn't
//       make the cut (i.e. isn't anywhere in the bracket).
// Deliberately biased against false positives — a team is only ever
// marked out on a settled result or a complete 32-team draw, since a
// wrongly struck-out team is far worse than one marked out a bit late.
function applyEliminations(teams, matches, phase) {
  for (const t of teams) { t.Eliminated = false; t.EliminationStage = ''; t.EliminationDate = ''; }
  const byTeam = new Map(teams.map(t => [t.Team, t]));

  const ko = matches.filter(m =>
    !isGroupStage(m.Stage) && m.HomeTeam && m.HomeTeam !== 'TBD'
    && m.AwayTeam && m.AwayTeam !== 'TBD');

  // (1) Knockout losers.
  for (const m of ko) {
    if (!hasResult(m)) continue;
    const res = decideWinner(m);
    if (!res) continue;
    const t = byTeam.get(res.loser);
    if (t) { t.Eliminated = true; t.EliminationStage = canonicalStage(m.Stage); t.EliminationDate = m.Date; }
  }

  // (2) Group-stage non-qualifiers — only once the R32 draw is complete
  // (16 ties / 32 distinct teams), so a half-entered draw can't strike
  // anyone out by mistake.
  const r32 = ko.filter(m => canonicalStage(m.Stage) === 'Round of 32');
  const qualified = new Set();
  r32.forEach(m => { qualified.add(m.HomeTeam); qualified.add(m.AwayTeam); });
  if (phase !== 'group' && r32.length === 16 && qualified.size === 32) {
    for (const t of teams) {
      if (!t.Eliminated && !qualified.has(t.Team)) {
        t.Eliminated = true;
        t.EliminationStage = 'Group';
      }
    }
  }
}

function isPrizeFinal(prizeCat, sheetRow, phase, hasFinalPos1) {
  // Manual override always wins.
  if (sheetRow && parseBool(sheetRow.IsFinal)) return true;
  // Podium: final iff matching FinalPosition exists.
  if (prizeCat.podium) return sheetRow && hasFinalPos1 ? hasFinalPos1.has(prizeCat.podium) : false;
  // Group-stage-only prize: final once group stage complete.
  if (prizeCat.groupStageOnly) return phase === 'knockout' || phase === 'complete';
  // Tournament-wide prize: final when tournament complete.
  return phase === 'complete';
}

function resolveAllPrizes(state) {
  const ctx = {
    teams: state.teams,
    matches: state.matches,
    awards: state.awards || {},
    goldenBoot: state.goldenBoot || [],
  };
  const filledPositions = new Set(
    state.teams
      .map(t => Number(t.FinalPosition))
      .filter(v => v === 1 || v === 2 || v === 3)
  );

  return PRIZE_CATEGORIES.map(p => {
    const r = p.resolver(state.stats, ctx);
    const sheetRow = state.prizes.find(x => x.PrizeCategory === p.label);
    const isFinal = r.autoFinal || isPrizeFinal(p, sheetRow, state.phase, filledPositions);

    // If final, every leading row becomes 'won'; non-leaders keep 'eliminated'.
    if (isFinal && r.ranked) {
      for (const it of r.ranked) {
        if (it.status === 'leading') it.status = 'won';
        else if (it.status === 'contention') it.status = 'eliminated';
      }
    }
    // Field average across the ranked pool — a benchmark so viewers can
    // gauge how the leader (and their own team) compares to the field.
    // Stat prizes only (p.avg); podium / Golden Boot have no meaningful one.
    let fieldAvg = null;
    if (p.avg && r.ranked && r.ranked.length) {
      const nums = r.ranked
        .map(x => Number(x.value))
        .filter(v => !isNaN(v) && isFinite(v));
      if (nums.length) fieldAvg = nums.reduce((a, b) => a + b, 0) / nums.length;
    }
    return {
      key: p.key,
      label: p.label,
      podium: !!p.podium,
      unit: p.unit,
      decimals: p.decimals,
      fieldAvg,
      description: prizeDescription(p.key),
      prizeValue: (sheetRow && sheetRow.PrizeValue) || '',
      isFinal,
      ranked: r.ranked || [],
      leaderRank: r.leaderRank,
      note: r.note || '',
      contextLabel: r.contextLabel || '',
    };
  });
}

// ============================================================
// Workbook IO
// ============================================================

// ------------------------------------------------------------
// Google Sheets source
// ------------------------------------------------------------
// Each tab is fetched as CSV via the GVIZ endpoint, which is
// publicly readable as long as the Sheet is shared "Anyone with
// the link can view". No API key required.
const SHEET_ID = '1bwXMIDUFiwmr-SjUsHon9vwXwKmpvQV6';
const SHEET_TABS = {
  participants: 'Participants',
  matches:      'Match Data',
  awards:       'Awards',
  goldenBoot:   'Golden Boot Tracker',
};
function sheetTabUrl(name) {
  // Cache-buster on every load so edits reflect within seconds.
  const t = Date.now();
  return 'https://docs.google.com/spreadsheets/d/' + SHEET_ID
       + '/gviz/tq?tqx=out:csv&sheet=' + encodeURIComponent(name)
       + '&_t=' + t;
}

const AWARD_KEY_BY_LABEL = {
  'Tournament Winner':        'winner',
  '2nd Place':                'runnerup',
  '3rd Place':                'third',
  'Golden Boot (Top Scorer)': 'goldenBoot',
};

// Minimal RFC 4180 CSV parser. Handles quoted fields, escaped
// quotes (""), and CRLF line endings. Treats leading whitespace
// inside an unquoted field as significant — fine for our data.
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\r') {
      // skip — wait for the \n
    } else if (c === '\n') {
      row.push(field); rows.push(row);
      row = []; field = '';
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return [];
  const headers = rows[0].map(h => h.trim());
  return rows.slice(1)
    .filter(r => r.some(v => String(v).trim() !== ''))
    .map(r => Object.fromEntries(headers.map((h, i) => [h, r[i] != null ? r[i] : ''])));
}

function parseSheetCsvs(csvs) {
  const participants = parseCsv(csvs.participants);
  const matches      = parseCsv(csvs.matches);
  const awards       = parseCsv(csvs.awards);
  const goldenBoot   = parseCsv(csvs.goldenBoot);
  return buildState({ participants, matches, awards, goldenBoot });
}

// Internal: takes already-parsed row arrays (one per tab) and
// returns the shape the rest of the app consumes.
function buildState({ participants, matches, awards: awardRows, goldenBoot: gbRows }) {
  const awards = {
    winner:     { player: '', country: '' },
    runnerup:   { player: '', country: '' },
    third:      { player: '', country: '' },
    goldenBoot: { player: '', country: '' },
  };
  for (const row of awardRows) {
    const key = AWARD_KEY_BY_LABEL[String(row.Award || '').trim()];
    if (!key) continue;
    awards[key] = {
      player:  String(row['Player (if applicable)'] || '').trim(),
      country: String(row['Country / Team'] || '').trim(),
    };
  }

  const podiumByCountry = {};
  if (awards.winner.country)   podiumByCountry[awards.winner.country]   = 1;
  if (awards.runnerup.country) podiumByCountry[awards.runnerup.country] = 2;
  if (awards.third.country)    podiumByCountry[awards.third.country]    = 3;

  const teams = participants
    .filter(r => String(r.Team || '').trim())
    .map(r => {
      const team = String(r.Team).trim();
      return {
        TeamID: team,
        Team: team,
        Group: String(r.Group || '').trim(),
        FIFA_Rank: 0,
        FlagEmoji: '',
        Participant: String(r.Entrant || '').trim(),
        Eliminated: false,
        EliminationStage: '',
        EliminationDate: '',
        FinalPosition: podiumByCountry[team] || '',
      };
    });

  const groupByTeam = Object.fromEntries(teams.map(t => [t.Team, t.Group]));

  const normalizedMatches = matches
    .filter(r => {
      const home = String(r['Home Team'] || '').trim();
      const away = String(r['Away Team'] || '').trim();
      const stage = canonicalStage(r.Stage);
      if (!stage) return false;                  // skip blank / junk rows
      if (isGroupStage(stage)) return home && away; // group rows need both teams
      // Keep every knockout row, even all-TBD ones, so the bracket lays out
      // its full set of slots and fills them as formula-fed winners land
      // (lets "Canada vs TBD" show the moment one feeder is decided).
      return true;
    })
    .map((r, i) => {
      const stage = canonicalStage(r.Stage);
      const homeTeam = canonicalTeam(r['Home Team']);
      const awayTeam = canonicalTeam(r['Away Team']);
      const group = isGroupStage(stage) ? (groupByTeam[homeTeam] || '') : '';
      const minutesRaw = r.Minutes;
      const minutes = minutesRaw === '' || minutesRaw == null ? 90 : Number(minutesRaw) || 90;
      // Combine the Date (M/D/YYYY, parsed as local midnight) with the Time
      // column (HH:MM, 24h UK time) into one local Date. Office viewers are
      // in London, so local time == the UK kick-off time. HasKickoff lets the
      // spotlight show a real time and count down to it, while fixtures with
      // no time entered fall back cleanly instead of printing "00:00".
      let matchDate = r.Date ? new Date(r.Date) : '';
      let hasKickoff = false;
      const tm = /^(\d{1,2}):(\d{2})$/.exec(String(r.Time || '').trim());
      if (matchDate instanceof Date && !isNaN(matchDate) && tm) {
        const hh = Number(tm[1]), mm = Number(tm[2]);
        if (hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59) {
          matchDate.setHours(hh, mm, 0, 0);
          hasKickoff = true;
        }
      }
      const homeScore = r['Home Score'] === '' || r['Home Score'] == null ? '' : Number(r['Home Score']);
      const awayScore = r['Away Score'] === '' || r['Away Score'] == null ? '' : Number(r['Away Score']);
      return {
        MatchID: 'M' + String(i + 1).padStart(3, '0'),
        Date: matchDate,
        HasKickoff: hasKickoff,
        Stage: stage,
        Group: group,
        HomeTeam: homeTeam,
        AwayTeam: awayTeam,
        HomeFlagEmoji: '',
        AwayFlagEmoji: '',
        HomeGoals: isFinite(homeScore) ? homeScore : '',
        AwayGoals: isFinite(awayScore) ? awayScore : '',
        Minutes: minutes,
        HomePenaltyGoals: '',
        AwayPenaltyGoals: '',
        HomeShots:        n(r['Home Shots']),
        AwayShots:        n(r['Away Shots']),
        HomeSoT:          n(r['Home SoT']),
        AwaySoT:          n(r['Away SoT']),
        HomePossession:   n(r['Home Possession %']),
        AwayPossession:   n(r['Away Possession %']),
        HomeFouls:        n(r['Home Fouls']),
        AwayFouls:        n(r['Away Fouls']),
        HomeYellowCards:  n(r['Home Yellow']),
        AwayYellowCards:  n(r['Away Yellow']),
        HomeRedCards:     n(r['Home Red']),
        AwayRedCards:     n(r['Away Red']),
        HomeOffsides:     n(r['Home Offsides']),
        AwayOffsides:     n(r['Away Offsides']),
        HomeCorners:      n(r['Home Corners']),
        AwayCorners:      n(r['Away Corners']),
        HomePenaltiesConceded: 0,
        AwayPenaltiesConceded: 0,
        HomeNotableEvents: '',
        AwayNotableEvents: '',
        Winner: canonicalTeam(r['Winning Team']),
        Notes: '',
      };
    });

  const goldenBoot = gbRows
    .filter(r => String(r.Player || '').trim())
    .map(r => ({
      player:  String(r.Player).trim(),
      country: String(r.Country || '').trim(),
      goals:   n(r.Goals),
    }))
    .sort((a, b) => b.goals - a.goals);

  return { teams, matches: normalizedMatches, prizes: [], awards, goldenBoot };
}

async function loadFromSheet(silent) {
  try {
    if (!silent) setStatus('Loading from Google Sheet…');
    const fetchTab = name => fetch(sheetTabUrl(name), { cache: 'no-store' })
      .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status + ' on tab "' + name + '"'); return r.text(); });
    const [participants, matches, awards, goldenBoot] = await Promise.all([
      fetchTab(SHEET_TABS.participants),
      fetchTab(SHEET_TABS.matches),
      fetchTab(SHEET_TABS.awards),
      fetchTab(SHEET_TABS.goldenBoot),
    ]);
    setData(parseSheetCsvs({ participants, matches, awards, goldenBoot }), 'Google Sheet');
  } catch (e) {
    console.warn('Sheet load failed:', e);
    if (!silent) setStatus("Couldn't load the Google Sheet — showing sample data. " + e.message, 'error');
    loadSample();
  }
}
function loadSample() {
  setData(generateSampleData(), 'sample data');
}

function setData({ teams, matches, prizes, awards, goldenBoot }, source) {
  STATE.teams = teams;
  STATE.matches = matches;
  STATE.prizes = prizes || [];
  STATE.awards = awards || {};
  STATE.goldenBoot = goldenBoot || [];
  STATE.phase = detectPhase(matches, STATE.awards);
  // Derive eliminations onto the team objects BEFORE rolling up stats,
  // so computeTeamStats picks up Eliminated/EliminationStage for free.
  applyEliminations(teams, matches, STATE.phase);
  STATE.stats = computeTeamStats(teams, matches);
  STATE.carouselMode = STATE.phase === 'group' ? 'group' : 'knockout';
  STATE.carouselIndex = 0;
  STATE.prizeResults = resolveAllPrizes(STATE);
  renderAll();
  if (source) {
    const playedCount = matches.filter(hasResult).length;
    setStatus('Loaded ' + source + ' — ' + teams.length + ' teams, ' + playedCount + '/' + matches.length + ' matches played.', 'ok');
  }
}

// ============================================================
// Rendering
// ============================================================

function renderAll() {
  renderHeaderMeta();
  renderSpotlight();
  renderTicker();
  renderCarousel();
  renderBracket();
  renderPrizeCards();
  renderLeaderboard();
  renderParticipants();
  startCarouselTimer();
  if (!STATE.hasLanded) {
    requestAnimationFrame(playLandingChoreography);
    STATE.hasLanded = true;
  }
}

function renderHeaderMeta() {
  const played = STATE.matches.filter(hasResult);
  const goals = played.reduce((s, m) => s + n(m.HomeGoals) + n(m.AwayGoals), 0);
  $('#meta-teams').textContent = STATE.teams.length || '—';
  $('#meta-played').textContent = played.length + ' / ' + STATE.matches.length;
  $('#meta-goals').textContent = goals;
  $('#meta-updated').textContent = new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

  const phaseLabels = {
    group: 'Group stage live',
    knockout: 'Knockout stage live',
    complete: 'Tournament complete',
  };
  $('#phase-indicator').textContent = phaseLabels[STATE.phase] || 'Live';

  // Tournament progress (% of matches with results)
  const total = STATE.matches.length;
  const pct = total ? Math.round((played.length / total) * 100) : 0;
  const fill = $('#hero-progress-fill');
  if (fill) fill.style.width = pct + '%';
  const label = $('#phase-progress-label');
  if (label) label.textContent = total
    ? pct + '% complete · ' + played.length + ' of ' + total + ' matches'
    : 'Awaiting fixtures';
}

// ---------- Match ticker ----------

function renderTicker() {
  const root = $('#ticker');
  root.innerHTML = '';
  const items = STATE.matches
    .filter(hasResult)
    .slice()
    .sort((a, b) => {
      const da = a.Date instanceof Date ? a.Date.getTime() : new Date(a.Date).getTime() || 0;
      const db = b.Date instanceof Date ? b.Date.getTime() : new Date(b.Date).getTime() || 0;
      return db - da;
    });

  if (!items.length) {
    root.innerHTML = '<div class="ticker-empty">No completed matches yet.</div>';
    return;
  }

  for (const m of items) {
    const stage = canonicalStage(m.Stage);
    const stageShort = stageBadge(stage);
    const hg = n(m.HomeGoals), ag = n(m.AwayGoals);
    const hpen = m.HomePenaltyGoals, apen = m.AwayPenaltyGoals;
    const winner = m.Winner || (hg > ag ? m.HomeTeam : ag > hg ? m.AwayTeam : '');
    const tags = [];
    if (n(m.HomeRedCards) + n(m.AwayRedCards) > 0) tags.push(['red', 'RED']);
    if (n(m.HomePenaltiesConceded) + n(m.AwayPenaltiesConceded) > 0) tags.push(['pen', 'PEN']);
    if (hg + ag >= 5) tags.push(['high', 'HOT']);

    const homeFlag = m.HomeFlagEmoji || flagFor(m.HomeTeam);
    const awayFlag = m.AwayFlagEmoji || flagFor(m.AwayTeam);
    const homeMark = winner === m.HomeTeam ? 'winner-mark' : (winner && winner !== '' ? 'loser-mark' : '');
    const awayMark = winner === m.AwayTeam ? 'winner-mark' : (winner && winner !== '' ? 'loser-mark' : '');
    const penLine = (hpen !== '' && hpen != null && apen !== '' && apen != null)
      ? `<span class="pen-score">(${hpen}-${apen} pens)</span>` : '';

    const item = document.createElement('div');
    item.className = 'ticker-item';
    item.title = stage + ' • ' + fmtShortDate(m.Date);
    item.innerHTML = `
      <span class="stage-tag">${escapeHtml(stageShort)}</span>
      <div class="home ${homeMark}">
        <span class="team-name">${escapeHtml(m.HomeTeam)}</span>
        <span class="flag">${homeFlag}</span>
      </div>
      <div class="score-block">
        <div class="score">${hg}<span class="score-dash">-</span>${ag}${penLine}</div>
        ${tags.length ? `<div class="event-tags">${tags.map(([k, l]) => `<span class="event-tag ${k}">${l}</span>`).join('')}</div>` : ''}
      </div>
      <div class="away ${awayMark}">
        <span class="flag">${awayFlag}</span>
        <span class="team-name">${escapeHtml(m.AwayTeam)}</span>
      </div>
    `;
    root.appendChild(item);
  }
}

function stageBadge(stage) {
  const c = canonicalStage(stage);
  const m = {
    'Group':'GS', 'Group Stage':'GS',
    'Round of 32':'R32', 'Round of 16':'R16',
    'Quarter-finals':'QF', 'Semi-finals':'SF',
    'Third Place':'3rd', 'Final':'FINAL',
  };
  return m[c] || c.slice(0, 3).toUpperCase();
}

// ---------- Group / knockout carousel ----------

function carouselPanels() {
  if (STATE.carouselMode === 'group') {
    const groups = Array.from(new Set(STATE.teams.map(t => t.Group).filter(Boolean))).sort();
    return groups.map(g => ({ kind: 'group', key: g, title: 'Group ' + g }));
  }
  return KNOCKOUT_STAGES.map(s => ({ kind: 'knockout', key: s.key, title: s.label, short: s.short }));
}

function renderCarousel() {
  // Group-stage view only. Once we reach the knockout stage the
  // bracket takes over (clean swap), so the whole section hides.
  const section = $('#carousel-section');
  if (section) section.hidden = STATE.phase !== 'group';
  if (STATE.phase !== 'group') return;

  const track = $('#carousel-track');
  track.innerHTML = '';
  const panels = carouselPanels();

  // Title + sub
  $('#carousel-title').textContent = STATE.carouselMode === 'group' ? 'Group standings' : 'Knockout fixtures';
  $('#carousel-sub').textContent = STATE.carouselMode === 'group'
    ? 'Top 2 in each group, plus 8 best 3rd-placed, advance'
    : 'Each knockout round in order';

  if (!panels.length) {
    track.innerHTML = '<div class="carousel-panel active"><div class="fixture-card no-fixtures">No data yet.</div></div>';
    $('#carousel-pager').textContent = '—';
    $('#carousel-dots').innerHTML = '';
    return;
  }
  if (STATE.carouselIndex >= panels.length) STATE.carouselIndex = 0;

  panels.forEach((p, idx) => {
    const panel = document.createElement('div');
    panel.className = 'carousel-panel' + (idx === STATE.carouselIndex ? ' active' : '');
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-hidden', idx === STATE.carouselIndex ? 'false' : 'true');

    if (p.kind === 'group') {
      panel.innerHTML = renderGroupPanel(p.key);
    } else {
      panel.innerHTML = renderKnockoutPanel(p.key, p.short);
    }
    track.appendChild(panel);
  });

  // Dots
  const dots = $('#carousel-dots');
  dots.innerHTML = '';
  panels.forEach((p, idx) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-label', p.title);
    b.setAttribute('aria-current', idx === STATE.carouselIndex ? 'true' : 'false');
    b.addEventListener('click', () => {
      STATE.carouselIndex = idx;
      pauseCarousel();
      renderCarousel();
    });
    dots.appendChild(b);
  });

  $('#carousel-pager').textContent = (STATE.carouselIndex + 1).toString().padStart(2, '0') + ' / ' + panels.length.toString().padStart(2, '0');
}

function renderGroupPanel(groupCode) {
  const groupTeams = STATE.teams
    .filter(t => t.Group === groupCode)
    .map(t => STATE.stats.get(t.Team))
    .filter(Boolean);

  // Sort by group points, GD, GF, alphabet — the typical FIFA rule order.
  groupTeams.sort((a, b) =>
    (b.groupPoints - a.groupPoints) ||
    (b.goalDifference - a.goalDifference) ||
    (b.goalsFor - a.goalsFor) ||
    a.team.localeCompare(b.team)
  );

  const groupMatchesPlayed = STATE.matches
    .filter(m => isGroupStage(m.Stage) && m.Group === groupCode && hasResult(m))
    .length;
  const groupMatchesTotal = STATE.matches
    .filter(m => isGroupStage(m.Stage) && m.Group === groupCode)
    .length || 6;

  const rows = groupTeams.map((s, i) => {
    const cls = [];
    if (i < 2) cls.push('qualifying-zone');
    if (s.eliminated) cls.push('knocked-out');
    return `
      <tr class="${cls.join(' ')}">
        <td class="pos">${i + 1}</td>
        <td>
          <span class="flag-with-name">
            <span class="flag">${s.flag || flagFor(s.team)}</span>
            <span class="team-name">${escapeHtml(s.team)}</span>
          </span>
        </td>
        <td class="owner">${escapeHtml(s.participant || '—')}</td>
        <td class="num">${s.played}</td>
        <td class="num">${s.wins}</td>
        <td class="num">${s.draws}</td>
        <td class="num">${s.losses}</td>
        <td class="num">${s.goalsFor}</td>
        <td class="num">${s.goalsAgainst}</td>
        <td class="num">${s.goalDifference >= 0 ? '+' : ''}${s.goalDifference}</td>
        <td class="num pts">${s.groupPoints}</td>
      </tr>`;
  }).join('');

  return `
    <div class="panel-letter" aria-hidden="true">${escapeHtml(groupCode)}</div>
    <div class="panel-head">
      <div class="panel-title">Group ${escapeHtml(groupCode)}</div>
      <div class="panel-meta">${groupMatchesPlayed} / ${groupMatchesTotal} played</div>
    </div>
    <table class="group-table">
      <thead><tr>
        <th></th><th>Team</th><th>Owner</th>
        <th class="num">P</th><th class="num">W</th><th class="num">D</th><th class="num">L</th>
        <th class="num">GF</th><th class="num">GA</th><th class="num">GD</th><th class="num">Pts</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function renderKnockoutPanel(stageKey, shortLabel) {
  const fixtures = STATE.matches
    .filter(m => canonicalStage(m.Stage) === stageKey)
    .sort((a, b) => {
      const da = a.Date instanceof Date ? a.Date.getTime() : new Date(a.Date).getTime() || 0;
      const db = b.Date instanceof Date ? b.Date.getTime() : new Date(b.Date).getTime() || 0;
      return da - db;
    });

  if (!fixtures.length) {
    return `
      <div class="panel-head">
        <div class="panel-title">${escapeHtml(stageKey)}</div>
        <div class="panel-meta">${escapeHtml(shortLabel || '')}</div>
      </div>
      <div class="fixtures-grid">
        <div class="fixture-card no-fixtures">Fixtures not added yet.</div>
      </div>`;
  }

  const cards = fixtures.map(m => {
    const played = hasResult(m);
    const hg = n(m.HomeGoals), ag = n(m.AwayGoals);
    const hpen = m.HomePenaltyGoals, apen = m.AwayPenaltyGoals;
    const explicitWinner = m.Winner;
    const winner = explicitWinner || (played && hg !== ag ? (hg > ag ? m.HomeTeam : m.AwayTeam) : '');
    const homeS = STATE.stats.get(m.HomeTeam);
    const awayS = STATE.stats.get(m.AwayTeam);
    const homeOwner = homeS ? homeS.participant : '';
    const awayOwner = awayS ? awayS.participant : '';

    function rowCls(team) {
      if (!played) return 'tbd';
      if (winner && winner === team) return 'winner';
      if (winner) return 'loser';
      return '';
    }

    const penLine = (hpen !== '' && hpen != null && apen !== '' && apen != null)
      ? `<div class="pen-line">Pens ${hpen}-${apen}</div>` : '';

    return `
      <div class="fixture-card">
        <div class="fixture-meta">
          <span>${escapeHtml(fmtShortDate(m.Date))}</span>
          <span>${escapeHtml(stageBadge(m.Stage))}</span>
        </div>
        <div class="row ${rowCls(m.HomeTeam)}">
          <div class="team-side">
            <span class="flag">${m.HomeFlagEmoji || flagFor(m.HomeTeam)}</span>
            <div>
              <div class="team-name">${escapeHtml(m.HomeTeam)}</div>
              <div class="owner">${escapeHtml(homeOwner || '—')}</div>
            </div>
          </div>
          <div class="goals">${played ? hg : '—'}</div>
        </div>
        <div class="row ${rowCls(m.AwayTeam)}">
          <div class="team-side">
            <span class="flag">${m.AwayFlagEmoji || flagFor(m.AwayTeam)}</span>
            <div>
              <div class="team-name">${escapeHtml(m.AwayTeam)}</div>
              <div class="owner">${escapeHtml(awayOwner || '—')}</div>
            </div>
          </div>
          <div class="goals">${played ? ag : '—'}</div>
        </div>
        ${penLine}
      </div>`;
  }).join('');

  const playedCount = fixtures.filter(hasResult).length;
  return `
    <div class="panel-head">
      <div class="panel-title">${escapeHtml(stageKey)}</div>
      <div class="panel-meta">${playedCount}/${fixtures.length} played</div>
    </div>
    <div class="fixtures-grid">${cards}</div>
  `;
}

function startCarouselTimer() {
  stopCarouselTimer();
  if (STATE.phase !== 'group') return;   // carousel only runs in the group stage
  if (!STATE.carouselPlaying) return;
  STATE.carouselTimer = setInterval(() => {
    const panels = carouselPanels();
    if (!panels.length) return;
    STATE.carouselIndex = (STATE.carouselIndex + 1) % panels.length;
    renderCarousel();
  }, CAROUSEL_AUTO_MS);
}
function stopCarouselTimer() {
  if (STATE.carouselTimer) clearInterval(STATE.carouselTimer);
  STATE.carouselTimer = null;
}
function pauseCarousel() {
  STATE.carouselPlaying = false;
  stopCarouselTimer();
  syncCarouselPauseBtn();
}
function syncCarouselPauseBtn() {
  const btn = $('#carousel-pause');
  const playing = STATE.carouselPlaying;
  btn.dataset.playing = String(playing);
  btn.setAttribute('aria-label', playing ? 'Pause auto-rotate' : 'Resume auto-rotate');
  btn.title = playing ? 'Pause auto-rotate' : 'Resume auto-rotate';
  $('#carousel-pause-icon').innerHTML = playing
    ? '<path fill="currentColor" d="M6 5h4v14H6zM14 5h4v14h-4z"/>'
    : '<path fill="currentColor" d="M8 5v14l11-7z"/>';
}

// ---------- Prize cards ----------

function renderPrizeCards() {
  const root = $('#prize-cards');
  root.innerHTML = '';

  for (const p of STATE.prizeResults) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'prize-card' + (p.podium ? ' podium' : '') + (p.isFinal ? ' final' : '');
    card.setAttribute('aria-label', 'Open race for ' + p.label);

    // Collapse multiple leaders from the same team into one row. This
    // matters for Golden Boot, where two scorers from one country would
    // otherwise render as identical team+owner rows; the full per-player
    // list is still shown in the tap-through race modal. Every other
    // prize already has one row per team, so this is a no-op for them.
    const seenLeaderTeams = new Set();
    const leaders = p.ranked
      .filter(r => r.status === 'leading' || r.status === 'won')
      .filter(r => !seenLeaderTeams.has(r.team) && seenLeaderTeams.add(r.team));
    const top = leaders[0];
    const tieCount = leaders.length - 1;

    // Lead margin: numerical values only. Compares leader to next non-tied row.
    let leadInfo = null;
    if (top && typeof top.value === 'number' && p.ranked.length > 1) {
      const nextNonTie = p.ranked.find(r => r.value !== top.value);
      if (nextNonTie && typeof nextNonTie.value === 'number') {
        const gap = Math.abs(top.value - nextNonTie.value);
        leadInfo = { gap, runnerUpValue: nextNonTie.value };
      }
    }

    let body;
    if (!top) {
      body = `<div class="empty">${escapeHtml(p.note || 'Awaiting data')}</div>`;
    } else {
      const valueDisplay = formatPrizeValueShort(top, p);
      const avgDisplay = formatAvg(p);
      const MAX_VISIBLE_LEADERS = 3;
      const visibleLeaders = leaders.slice(0, MAX_VISIBLE_LEADERS);
      const overflow = Math.max(0, leaders.length - MAX_VISIBLE_LEADERS);
      const isStacked = visibleLeaders.length > 1;
      const stackedClass = isStacked ? ' stacked' : '';
      const leaderRows = visibleLeaders.map(l => `
        <div class="winner-info">
          <span class="flag${isStacked ? '' : ' lg'}">${l.flag || flagFor(l.team)}</span>
          <div class="meta-line">
            <span class="team">${escapeHtml(l.team)}</span>
            <span class="participant">${escapeHtml(l.participant || 'unassigned')}</span>
          </div>
        </div>
      `).join('');
      const overflowRow = overflow > 0
        ? `<div class="winners-overflow">+${overflow} more</div>`
        : '';
      body = `
        <div class="winner-row${stackedClass}">
          <div class="winners-stack">${leaderRows}${overflowRow}</div>
          ${valueDisplay ? `<div class="stat-block">
            <div class="stat">${escapeHtml(valueDisplay)}</div>
            ${avgDisplay ? `<div class="stat-avg">${escapeHtml(avgDisplay)}</div>` : ''}
          </div>` : ''}
        </div>
        ${renderLeadBar(p, leadInfo, tieCount)}`;
    }

    card.innerHTML = `
      <div class="top-row">
        <span class="label">${escapeHtml(p.label)}</span>
        ${renderStatusChip(p, top)}
      </div>
      ${body}
      <div class="desc">
        <span>${escapeHtml(p.description)}</span>
        <span class="more">${tieCount > 0 ? '+' + tieCount + ' tied · ' : ''}View race</span>
      </div>
    `;
    card.addEventListener('click', () => openRaceModal(p));
    root.appendChild(card);
  }
}

// Lead-margin hairline under the winner row. Final = full bar
// in gold; tied = striped half-bar; otherwise lead distance
// scaled against the runner-up's value so a "1-goal lead in a
// 1-goal contest" still reads as a fragile lead.
function renderLeadBar(prize, leadInfo, tieCount) {
  if (prize.isFinal) {
    return `<div class="lead-bar lead-final" aria-hidden="true">
      <span class="lead-rail"><span class="lead-fill" style="width:100%"></span></span>
      <span class="lead-text">Confirmed</span>
    </div>`;
  }
  if (tieCount > 0) {
    return `<div class="lead-bar lead-tied" aria-hidden="true">
      <span class="lead-rail"><span class="lead-fill" style="width:50%"></span></span>
      <span class="lead-text">${tieCount + 1}-way tie</span>
    </div>`;
  }
  if (!leadInfo || leadInfo.gap === 0) return '';
  const max = Math.max(3, Math.abs(leadInfo.runnerUpValue) || 3);
  const pct = Math.max(15, Math.min(100, Math.round((leadInfo.gap / max) * 100)));
  return `<div class="lead-bar" aria-hidden="true">
    <span class="lead-rail"><span class="lead-fill" style="width:${pct}%"></span></span>
    <span class="lead-text">+${escapeHtml(formatNumeric(leadInfo.gap, prize))} clear</span>
  </div>`;
}

function renderStatusChip(prize, leader) {
  if (!leader) return `<span class="chip chip-tbd">TBD</span>`;
  if (prize.isFinal) return `<span class="chip chip-won">Winner confirmed</span>`;
  if (prize.podium && !prize.isFinal) return `<span class="chip chip-tbd">Awaiting result</span>`;
  return `<span class="chip chip-leading">Current leader</span>`;
}

function appendUnit(v, prize, value) {
  if (!prize.unit) return v;
  if (prize.unit === '%') return v + '%';                                  // tight: "62%"
  if (prize.unit === 'goals')                                             // pluralise: "1 goal" / "2 goals"
    return v + ' ' + (Math.abs(Number(value)) === 1 ? 'goal' : 'goals');
  return v + ' ' + prize.unit;
}
function formatPrizeValue(item, prize) {
  // Long form for the race-modal table — includes any free-text
  // valueLabel (e.g. score breakdown for "Highest-scoring match").
  if (item.valueLabel) return item.valueLabel;
  if (item.value === '' || item.value == null) return '';
  return appendUnit(formatNumeric(item.value, prize), prize, item.value);
}
function formatPrizeValueShort(item, prize) {
  // Tight form for the prize-card grid: no valueLabel — that
  // text overflows the card. Always "<value> <unit>" or just
  // value, never the long contextual variant.
  if (item.value === '' || item.value == null) return '';
  return appendUnit(formatNumeric(item.value, prize), prize, item.value);
}
function avgValueText(prize) {
  // The field-average value, formatted like a leader value: "15" / "50%" / "0 GD".
  if (!prize || prize.fieldAvg == null) return '';
  const decimals = prize.decimals != null ? prize.decimals : 1;
  return appendUnit(trimNumeric(prize.fieldAvg, decimals), prize, prize.fieldAvg);
}
function formatAvg(prize) {
  const v = avgValueText(prize);
  return v ? 'avg ' + v : '';
}
function trimNumeric(value, decimals) {
  // Round to the given precision, then drop trailing zeros so a clean
  // 13.00 reads "13" while a genuine 13.67 keeps its decimals. Also
  // launders float noise like 12.9999999999998 -> "13".
  return String(Number(value.toFixed(decimals)));
}
function formatNumeric(value, prize) {
  if (typeof value === 'number' && prize && prize.decimals != null) {
    return trimNumeric(value, prize.decimals);
  }
  return String(value);
}

// ---------- Race modal ----------

function openRaceModal(prize) {
  const modal = $('#race-modal');
  $('#race-modal-title').textContent = prize.label;
  $('#race-modal-eyebrow').textContent = prize.isFinal ? 'Prize confirmed' : 'Prize race — live';
  $('#race-modal-sub').innerHTML = escapeHtml(prize.description) +
    (prize.contextLabel ? ' &middot; <em>' + escapeHtml(prize.contextLabel) + '</em>' : '');

  const body = $('#race-modal-body');
  if (!prize.ranked.length) {
    body.innerHTML = `<p style="text-align:center;color:var(--text-4);font-style:italic;padding:32px 0;">${escapeHtml(prize.note || 'No data yet.')}</p>`;
  } else {
    const leaderValue = prize.ranked[0].value;
    // Compute denominator for the value bar. Numeric values only.
    const numericValues = prize.ranked
      .map(r => Number(r.value))
      .filter(v => !isNaN(v) && isFinite(v));
    const maxNumeric = numericValues.length ? Math.max(...numericValues) : 0;
    const minNumeric = numericValues.length ? Math.min(...numericValues) : 0;
    const isMin = (leaderValue === minNumeric && leaderValue !== maxNumeric);
    // The magnitude bar assumes a short numeric value sitting at the
    // right edge. Prizes with a descriptive valueLabel (e.g. Golden
    // Boot's "3 goals — Messi") are too long and the bar would strike
    // through the text, so skip it for those.
    const hasLabels = prize.ranked.some(r => r.valueLabel);
    const showBar = !hasLabels && numericValues.length > 1 && maxNumeric !== minNumeric;

    // Bar position for a value, on the shared 0–100% scale (inverse for
    // "min" prizes, where smaller is better). Used for the per-row fills
    // and the field-average marker so they line up.
    const clampPct = x => Math.max(0, Math.min(100, x));
    const barPctFor = v => {
      if (isMin) {
        return maxNumeric === minNumeric ? 100
          : Math.round(((maxNumeric - v) / (maxNumeric - minNumeric)) * 100);
      }
      return maxNumeric === 0 ? 0 : Math.round((v / maxNumeric) * 100);
    };
    const avgPct = (showBar && prize.fieldAvg != null && isFinite(prize.fieldAvg))
      ? clampPct(barPctFor(prize.fieldAvg)) : null;

    const rows = prize.ranked.map(r => {
      const tied = r.value === leaderValue && (r.status === 'leading' || r.status === 'won');
      const cls = [];
      if (r.eliminated) cls.push('eliminated');
      if (tied) cls.push('tied-with-leader');
      const valueText = formatPrizeValue(r, prize);
      const tooltipData = JSON.stringify({
        title: r.team,
        owner: r.participant || 'unassigned',
        value: valueText || prize.label,
        group: r.group || '',
      });
      // Value bar: scale 0–100% relative to leader (or inverse for "min" prizes).
      let barPct = 0;
      const numv = Number(r.value);
      if (showBar && !isNaN(numv) && isFinite(numv)) {
        barPct = clampPct(barPctFor(numv));
      }
      const avgMarker = avgPct != null
        ? `<span class="value-bar-avg" style="left:${avgPct}%"></span>` : '';
      const valueCell = showBar
        ? `<td class="value-cell"><span class="value-bar"><span class="value-bar-fill" style="width:${barPct}%"></span>${avgMarker}</span>${escapeHtml(valueText || '')}</td>`
        : `<td class="num value">${escapeHtml(valueText || '')}</td>`;
      return `
        <tr class="${cls.join(' ')}">
          <td class="rank">${r.rank}</td>
          <td>
            <div class="team-cell" data-tooltip='${escapeHtml(tooltipData)}'>
              <span class="flag">${r.flag || flagFor(r.team)}</span>
              <span class="team-name">${escapeHtml(r.team)}</span>
            </div>
          </td>
          <td class="owner">${escapeHtml(r.participant || '—')}</td>
          ${valueCell}
          <td>${chipFor(r.status)}</td>
        </tr>`;
    }).join('');
    const avgNote = avgPct != null
      ? `<p class="race-avg-note"><span class="avg-tick" aria-hidden="true"></span>Dashed line &mdash; field average (${escapeHtml(avgValueText(prize))})</p>`
      : '';
    body.innerHTML = `
      ${avgNote}
      <table class="race-table">
        <thead><tr>
          <th>#</th><th>Team</th><th>Owner</th><th class="num">${showBar ? 'Race' : 'Value'}</th><th>Status</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `;

    // Wire tooltips for team cells
    body.querySelectorAll('[data-tooltip]').forEach(el => {
      el.addEventListener('mouseenter', showTooltipFor);
      el.addEventListener('mouseleave', hideTooltip);
      el.addEventListener('focus', showTooltipFor);
      el.addEventListener('blur', hideTooltip);
    });
  }

  modal.hidden = false;
  document.body.style.overflow = 'hidden';
  stopCarouselTimer();
  // Focus trap entry point
  modal.querySelector('.icon-btn').focus();
}

function chipFor(status) {
  const map = {
    leading:    '<span class="chip chip-leading">Leading</span>',
    contention: '<span class="chip chip-contention">In contention</span>',
    eliminated: '<span class="chip chip-eliminated">Eliminated</span>',
    won:        '<span class="chip chip-won">Won</span>',
    tbd:        '<span class="chip chip-tbd">TBD</span>',
  };
  return map[status] || map.tbd;
}

function closeRaceModal() {
  $('#race-modal').hidden = true;
  document.body.style.overflow = '';
  hideTooltip();
  if (STATE.carouselPlaying) startCarouselTimer();
}

// ---------- Tooltip ----------

function showTooltipFor(e) {
  const el = e.currentTarget;
  const raw = el.getAttribute('data-tooltip');
  if (!raw) return;
  let data;
  try { data = JSON.parse(raw); } catch { return; }
  const tip = $('#tooltip');
  tip.innerHTML = `
    <div class="tt-title">${escapeHtml(data.title)}</div>
    ${data.group ? `<div class="tt-line">Group ${escapeHtml(data.group)}</div>` : ''}
    <div class="tt-line">Owner: <span class="tt-value">${escapeHtml(data.owner)}</span></div>
    ${data.value ? `<div class="tt-line">${escapeHtml(data.value)}</div>` : ''}
  `;
  tip.hidden = false;
  positionTooltip(e);
  el.addEventListener('mousemove', positionTooltip);
  el._ttCleanup = () => el.removeEventListener('mousemove', positionTooltip);
}
function hideTooltip(e) {
  const tip = $('#tooltip');
  tip.hidden = true;
  const el = e && e.currentTarget;
  if (el && el._ttCleanup) { el._ttCleanup(); el._ttCleanup = null; }
}
function positionTooltip(e) {
  const tip = $('#tooltip');
  const pad = 10;
  const x = (e.clientX || 0) + 12;
  const y = (e.clientY || 0) + 16;
  tip.style.left = Math.min(window.innerWidth - tip.offsetWidth - pad, x) + 'px';
  tip.style.top  = Math.min(window.innerHeight - tip.offsetHeight - pad, y) + 'px';
}

// ---------- Leaderboard ----------

const LEADERBOARD_COLS = [
  { key: 'group',          label: 'Grp' },
  { key: 'team',           label: 'Team' },
  { key: 'participant',    label: 'Owner' },
  { key: 'played',         label: 'P',     num: true },
  { key: 'wins',           label: 'W',     num: true },
  { key: 'draws',          label: 'D',     num: true },
  { key: 'losses',         label: 'L',     num: true },
  { key: 'goalsFor',       label: 'GF',    num: true },
  { key: 'goalsAgainst',   label: 'GA',    num: true },
  { key: 'goalDifference', label: 'GD',    num: true },
  { key: 'points',         label: 'Pts',   num: true },
  { key: 'avgPossession',  label: 'Poss%', num: true, decimals: 1 },
  { key: 'shotsP90',       label: 'Sh/90', num: true, decimals: 2 },
  { key: 'foulsP90',       label: 'Fls/90', num: true, decimals: 2 },
  { key: 'offsidesP90',    label: 'Off/90', num: true, decimals: 2 },
  { key: 'cornersP90',     label: 'Cnr/90', num: true, decimals: 2 },
];

function renderLeaderboard() {
  const tbl = $('#leaderboard');
  tbl.innerHTML = '';
  const filter = STATE.filter.trim().toLowerCase();
  const rows = Array.from(STATE.stats.values()).filter(s => {
    if (!filter) return true;
    return s.team.toLowerCase().includes(filter)
        || (s.participant || '').toLowerCase().includes(filter)
        || (s.group || '').toLowerCase().includes(filter);
  });
  rows.sort((a, b) => compareForSort(a, b, STATE.sortKey, STATE.sortDir));

  const thead = document.createElement('thead');
  const trh = document.createElement('tr');
  for (const col of LEADERBOARD_COLS) {
    const th = document.createElement('th');
    th.textContent = col.label;
    if (col.num) th.classList.add('num');
    if (STATE.sortKey === col.key) th.classList.add(STATE.sortDir === 'asc' ? 'sorted-asc' : 'sorted-desc');
    th.addEventListener('click', () => {
      if (STATE.sortKey === col.key) STATE.sortDir = STATE.sortDir === 'asc' ? 'desc' : 'asc';
      else { STATE.sortKey = col.key; STATE.sortDir = col.num ? 'desc' : 'asc'; }
      renderLeaderboard();
    });
    trh.appendChild(th);
  }
  thead.appendChild(trh);
  tbl.appendChild(thead);

  const tbody = document.createElement('tbody');
  // Mark top 3 with podium markers when sorting by points descending
  // — purely visual reinforcement of the current sort.
  const showPodium = STATE.sortKey === 'points' && STATE.sortDir === 'desc' && !STATE.filter.trim();
  rows.forEach((s, i) => {
    const tr = document.createElement('tr');
    if (s.eliminated) tr.classList.add('eliminated');
    if (showPodium && i < 3 && s.points > 0) tr.classList.add('podium-' + (i + 1));
    for (const col of LEADERBOARD_COLS) {
      const td = document.createElement('td');
      if (col.num) td.classList.add('num');
      if (col.key === 'team') {
        td.classList.add('team-cell');
        td.innerHTML = `<span class="flag">${s.flag || flagFor(s.team)}</span> ${escapeHtml(s.team)}`;
      } else if (col.key === 'group') {
        td.innerHTML = `<span class="group-pill">${escapeHtml(s.group)}</span>`;
      } else if (col.key === 'participant') {
        td.textContent = s.participant || '—';
      } else if (col.key === 'goalDifference') {
        td.textContent = (s.goalDifference >= 0 ? '+' : '') + s.goalDifference;
      } else if (col.decimals != null) {
        const v = Number(s[col.key]);
        td.textContent = isFinite(v) ? trimNumeric(v, col.decimals) : '—';
      } else {
        td.textContent = s[col.key];
      }
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  });
  tbl.appendChild(tbody);
}
function compareForSort(a, b, key, dir) {
  const av = a[key], bv = b[key];
  let cmp;
  if (typeof av === 'number' && typeof bv === 'number') cmp = av - bv;
  else cmp = String(av).localeCompare(String(bv));
  return dir === 'asc' ? cmp : -cmp;
}

// ---------- Owners scoreboard ----------

function buildOwnersStandings() {
  // Prizes won (final) and prizes still in race (live) per participant.
  // "In race" must dedupe by prize: an owner with two teams both
  // contending for "Most goals" only has ONE prize in race, not two.
  const prizesByParticipant = new Map();        // name -> count of confirmed wins
  const contendingPrizesBy = new Map();         // name -> Set<prizeKey> still live
  for (const p of STATE.prizeResults) {
    for (const r of p.ranked) {
      if (!r.participant) continue;
      if (p.isFinal && r.status === 'won') {
        prizesByParticipant.set(r.participant, (prizesByParticipant.get(r.participant) || 0) + 1);
      } else if (!p.isFinal && (r.status === 'leading' || r.status === 'contention')) {
        if (!contendingPrizesBy.has(r.participant)) contendingPrizesBy.set(r.participant, new Set());
        contendingPrizesBy.get(r.participant).add(p.key);
      }
    }
  }

  const byParticipant = new Map();
  for (const t of STATE.teams) {
    const key = t.Participant || '(unassigned)';
    if (!byParticipant.has(key)) byParticipant.set(key, []);
    byParticipant.get(key).push(t);
  }

  return Array.from(byParticipant.entries()).map(([name, teams]) => {
    let alive = 0;
    teams.forEach(t => { if (!t.Eliminated) alive++; });
    return {
      name,
      teams,
      alive,
      prizesWon: prizesByParticipant.get(name) || 0,
      prizesInRace: (contendingPrizesBy.get(name) || new Set()).size,
    };
  });
}

function sortOwners(rows, key) {
  // Default + tiebreaks land on what the user actually cares
  // about for an office sweepstake: confirmed prizes first,
  // then live prize races, then teams still alive, then name.
  const cmp = {
    prizes:  (a, b) => (b.prizesWon - a.prizesWon) || (b.prizesInRace - a.prizesInRace) || (b.alive - a.alive) || a.name.localeCompare(b.name),
    inrace:  (a, b) => (b.prizesInRace - a.prizesInRace) || (b.prizesWon - a.prizesWon) || (b.alive - a.alive) || a.name.localeCompare(b.name),
    alive:   (a, b) => (b.alive - a.alive) || (b.prizesWon - a.prizesWon) || (b.prizesInRace - a.prizesInRace) || a.name.localeCompare(b.name),
    name:    (a, b) => a.name.localeCompare(b.name),
  }[key] || ((a, b) => a.name.localeCompare(b.name));
  return rows.slice().sort(cmp);
}

function renderParticipants() {
  const root = $('#participants');
  root.innerHTML = '';

  const all = buildOwnersStandings();
  const sortKey = STATE.ownersSort || 'prizes';
  const ranked = sortOwners(all, sortKey);

  ranked.forEach((row, idx) => {
    const card = document.createElement('div');
    card.className = 'participant-card';
    // Gold accent on the leader by prizes-won, but only if they
    // actually have any won prizes — otherwise everyone's tied
    // at zero and it'd be arbitrary.
    if (sortKey === 'prizes' && row.prizesWon > 0 && idx === 0) card.classList.add('podium-1');
    if (row.alive === 0 && row.teams.length > 0) card.classList.add('all-out');

    const teamsHtml = row.teams.map(t => {
      const s = STATE.stats.get(t.Team);
      const elim = t.Eliminated ? ' eliminated' : '';
      // Only call out a stage when the team is actually out — "In" on
      // every row is just noise when each owner has a single team.
      const stage = t.Eliminated ? eliminationStageLabel(t.EliminationStage) : '';
      return `<div class="team-row${elim}">
        <span class="flag-with-name">
          <span class="flag">${(s && s.flag) || flagFor(t.Team)}</span>
          <span class="name">${escapeHtml(t.Team)}</span>
        </span>
        ${stage ? `<span class="team-pts">${escapeHtml(stage)}</span>` : ''}
      </div>`;
    }).join('');

    // Big number reflects the only thing that actually matters:
    // confirmed prizes won. When nothing's been won the score block is
    // dropped entirely rather than padded with "awaiting"/"in race"
    // noise — the card collapses to just rank + name + team.
    const hasScore = row.prizesWon > 0;
    const bigNum = hasScore ? String(row.prizesWon).padStart(2, '0') : '';
    const bigLabel = hasScore ? (row.prizesWon === 1 ? 'prize won' : 'prizes won') : '';

    const rankNum = String(idx + 1).padStart(2, '0');
    const rankClass = idx === 0 && row.prizesWon > 0 && sortKey === 'prizes' ? 'rank-medal medal-1'
                   : idx === 0 ? 'rank-num leading'
                   : 'rank-num';

    card.innerHTML = `
      <div class="owner-head">
        <span class="${rankClass}">${rankNum}</span>
        <div class="owner-id">
          <div class="name">${escapeHtml(row.name)}</div>
        </div>
        ${hasScore ? `<div class="owner-score gold">
          <div class="score-num">${bigNum}</div>
          <div class="score-label">${escapeHtml(bigLabel)}</div>
        </div>` : ''}
      </div>
      ${row.prizesWon > 0 || (row.alive === 0 && row.teams.length > 0) ? `<div class="owner-pills">
        ${row.prizesWon > 0 ? `<span class="owner-pill won">★ ${row.prizesWon} won</span>` : ''}
        ${row.alive === 0 && row.teams.length > 0 ? `<span class="owner-pill out">All out</span>` : ''}
      </div>` : ''}
      <div class="teams">${teamsHtml}</div>
    `;
    root.appendChild(card);
  });
}

// ============================================================
// Spotlight (now / next match)
// ------------------------------------------------------------
// Picks the most relevant match for the moment:
//   - LIVE     : a fixture whose Date is today and result not yet
//                entered (heuristic — the real "live" signal is
//                that you've not yet typed in goals).
//   - NEXT     : earliest unplayed fixture in the future.
//   - JUST IN  : if no upcoming fixture, surface the latest result
//                instead so the strip still feels alive.
// ============================================================

function pickSpotlight() {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(today.getTime() + 86400000);

  const dateOf = m => {
    const d = m.Date instanceof Date ? m.Date : (m.Date ? new Date(m.Date) : null);
    return d && !isNaN(d) ? d : null;
  };

  const withDates = STATE.matches
    .filter(m => m.HomeTeam && m.AwayTeam)
    .map(m => ({ match: m, date: dateOf(m) }));

  // TODAY: the full slate for today — played and upcoming alike, in
  // kick-off order — so a busy match day shows every game, not one.
  const todays = withDates
    .filter(u => u.date && u.date >= today && u.date < tomorrow)
    .sort((a, b) => a.date - b.date);
  if (todays.length) {
    return {
      kind: 'live',
      matches: todays.map(u => u.match),
      date: todays[0].date,
      anyUpcoming: todays.some(u => !hasResult(u.match)),
    };
  }

  // NEXT: the next chronological unplayed fixture in the future.
  const next = withDates
    .filter(u => !hasResult(u.match) && u.date && u.date >= today)
    .sort((a, b) => a.date - b.date)[0];
  if (next) return { kind: 'next', matches: [next.match], date: next.date };

  // No upcoming with a date — surface most recent result instead.
  const recent = withDates
    .filter(u => hasResult(u.match) && u.date)
    .sort((a, b) => b.date - a.date)[0];
  if (recent) return { kind: 'recent', matches: [recent.match], date: recent.date };

  return null;
}

function formatCountdown(ms) {
  if (ms <= 0) return 'Kick-off imminent';
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (h >= 24) {
    const days = Math.floor(h / 24);
    const rem = h % 24;
    return days + 'd ' + rem + 'h to go';
  }
  if (h > 0) return h + 'h ' + m + 'm to go';
  return m + 'm to go';
}

function fmtKickoff(dt) {
  return dt.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function spotlightStatusLine(spot) {
  const dt = spot.date;
  const m0 = spot.matches[0];
  if (spot.kind === 'live') {
    const count = spot.matches.length;
    if (count > 1) return { tag: 'TODAY', label: count + ' matches today' };
    if (!dt) return { tag: 'TODAY', label: 'Match scheduled today' };
    if (hasResult(m0)) return { tag: 'TODAY', label: 'Result' };
    return { tag: 'TODAY', label: m0 && m0.HasKickoff ? 'Kick-off ' + fmtKickoff(dt) : 'Scheduled today' };
  }
  if (spot.kind === 'next') {
    const ms = dt - new Date();
    const day = dt.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    const time = m0 && m0.HasKickoff ? ' · ' + fmtKickoff(dt) : '';
    return { tag: 'NEXT UP', label: formatCountdown(ms) + ' · ' + day + time };
  }
  if (spot.kind === 'recent') {
    return { tag: 'JUST IN', label: 'Most recent result · ' + (dt ? fmtShortDate(dt) : '') };
  }
  return { tag: '', label: '' };
}

function spotlightMatchBody(m, spot) {
  const homeS = STATE.stats.get(m.HomeTeam);
  const awayS = STATE.stats.get(m.AwayTeam);
  const homeOwner = (homeS && homeS.participant) || '';
  const awayOwner = (awayS && awayS.participant) || '';
  const homeFlag  = m.HomeFlagEmoji || flagFor(m.HomeTeam);
  const awayFlag  = m.AwayFlagEmoji || flagFor(m.AwayTeam);

  const hg = n(m.HomeGoals), ag = n(m.AwayGoals);
  const hpen = m.HomePenaltyGoals, apen = m.AwayPenaltyGoals;
  const winner = m.Winner || (hasResult(m) && hg !== ag ? (hg > ag ? m.HomeTeam : m.AwayTeam) : '');

  let centre;
  if (hasResult(m)) {
    centre = `<div class="spotlight-score">
         <span class="${winner === m.HomeTeam ? 'win' : winner ? 'lose' : ''}">${hg}</span>
         <span class="dash">–</span>
         <span class="${winner === m.AwayTeam ? 'win' : winner ? 'lose' : ''}">${ag}</span>
         ${hpen !== '' && hpen != null && apen !== '' && apen != null
           ? `<div class="spotlight-pens">(${hpen}-${apen} pens)</div>` : ''}
       </div>`;
  } else {
    // Today's upcoming games show their kick-off time where the score
    // will go; the lone "next" preview keeps the simple "vs".
    const dt = m.Date instanceof Date ? m.Date : (m.Date ? new Date(m.Date) : null);
    centre = spot.kind === 'live' && m.HasKickoff && dt && !isNaN(dt)
      ? `<div class="spot-time">${escapeHtml(fmtKickoff(dt))}</div>`
      : `<div class="spotlight-vs">vs</div>`;
  }

  return `
    <div class="spotlight-body">
      <div class="spotlight-team home ${winner === m.HomeTeam ? 'is-winner' : ''}">
        <div class="spot-flag">${homeFlag}</div>
        <div class="spot-text">
          <div class="spot-team">${escapeHtml(m.HomeTeam)}</div>
          <div class="spot-owner">${escapeHtml(homeOwner || 'unassigned')}</div>
        </div>
      </div>
      ${centre}
      <div class="spotlight-team away ${winner === m.AwayTeam ? 'is-winner' : ''}">
        <div class="spot-text right">
          <div class="spot-team">${escapeHtml(m.AwayTeam)}</div>
          <div class="spot-owner">${escapeHtml(awayOwner || 'unassigned')}</div>
        </div>
        <div class="spot-flag">${awayFlag}</div>
      </div>
    </div>`;
}

function renderSpotlight() {
  const root = $('#spotlight');
  const section = $('#spotlight-section');
  if (!root || !section) return;
  if (STATE.spotlightTimer) { clearInterval(STATE.spotlightTimer); STATE.spotlightTimer = null; }

  const spot = pickSpotlight();
  if (!spot) { section.hidden = true; return; }
  section.hidden = false;

  const status = spotlightStatusLine(spot);
  // Use the stage label only when the whole slate shares one stage —
  // a mixed day (rare) gets no stage tag rather than a misleading one.
  const stages = [...new Set(spot.matches.map(m => canonicalStage(m.Stage)))];
  const stage = stages.length === 1 ? stages[0] : '';

  const tagClass = spot.kind === 'live' ? 'spotlight-tag live'
                : spot.kind === 'next' ? 'spotlight-tag next'
                : 'spotlight-tag recent';
  // Pulse only when something's actually still to come.
  const showPulse = spot.kind === 'live' && spot.anyUpcoming;

  const bodies = spot.matches.map(m => spotlightMatchBody(m, spot)).join('');

  root.className = 'spotlight kind-' + spot.kind + (spot.matches.length > 1 ? ' multi' : '');
  root.innerHTML = `
    <div class="spotlight-rail">
      <div class="${tagClass}">
        ${showPulse ? '<span class="spot-pulse" aria-hidden="true"></span>' : ''}
        <span class="spotlight-tag-text">${escapeHtml(status.tag)}</span>
      </div>
      <div class="spotlight-stage">${escapeHtml(stage)}</div>
      <div class="spotlight-status" id="spotlight-countdown">${escapeHtml(status.label)}</div>
    </div>
    ${bodies}
  `;

  // Live countdown ticker for the "next" kind.
  if (spot.kind === 'next' && spot.date) {
    const nextMatch = spot.matches[0];
    const timeSuffix = nextMatch && nextMatch.HasKickoff ? ' · ' + fmtKickoff(spot.date) : '';
    STATE.spotlightTimer = setInterval(() => {
      const el = document.getElementById('spotlight-countdown');
      if (!el) { clearInterval(STATE.spotlightTimer); return; }
      const ms = spot.date - new Date();
      if (ms <= 0) { renderSpotlight(); return; }
      const dt = spot.date;
      el.textContent = formatCountdown(ms) + ' · ' + dt.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) + timeSuffix;
    }, 30000);
  }
}

// ============================================================
// Knockout bracket
// ------------------------------------------------------------
// Renders R32 → R16 → QF → SF → Final as five vertical columns
// with a separate small card for the 3rd-place play-off. Each
// match card shows both teams + owner, with winner highlight.
// Spacing is even per-column so successive rounds visually align
// to the midpoints of the prior round (classic ESPN-style flow).
// ============================================================

const BRACKET_ROUNDS = ['Round of 32', 'Round of 16', 'Quarter-finals', 'Semi-finals', 'Final'];

function renderBracket() {
  const section = $('#bracket-section');
  const root = $('#bracket');
  if (!section || !root) return;

  // The bracket is the knockout-phase counterpart to the group
  // carousel: hidden during the group stage, then it takes that
  // section's place once we reach the knockout stage (clean swap).
  if (STATE.phase === 'group') { section.hidden = true; return; }
  section.hidden = false;

  const roundsHtml = BRACKET_ROUNDS.map(stage => {
    // Order by Sheet row (MatchID is assigned by row index, zero-padded
    // so a string sort == row order). The workbook lists each knockout
    // round top-to-bottom in bracket order, NOT by date, so we honour that
    // rather than re-sorting by kick-off time.
    const fixtures = STATE.matches
      .filter(m => canonicalStage(m.Stage) === stage)
      .sort((a, b) => String(a.MatchID).localeCompare(String(b.MatchID)));
    const expectedCount = stage === 'Round of 32' ? 16
                       : stage === 'Round of 16' ? 8
                       : stage === 'Quarter-finals' ? 4
                       : stage === 'Semi-finals' ? 2
                       : 1;
    // A round shows its individual slots as soon as ANY team in it is known
    // (one feeder decided → "Canada vs TBD"). While a round is entirely
    // unknown it stays collapsed as a single compact "N matches TBD".
    const anyKnown = fixtures.some(f => f.HomeTeam || f.AwayTeam);
    let cards;
    if (anyKnown) {
      cards = fixtures.map(m => bracketMatchCard(m, stage)).join('');
    } else {
      cards = `<div class="bracket-match tbd bracket-empty"><div class="bracket-team"><span class="bracket-name muted">${expectedCount} match${expectedCount === 1 ? '' : 'es'} TBD</span></div></div>`;
    }
    return `
      <div class="bracket-round" data-stage="${escapeHtml(stage)}">
        <div class="bracket-round-head">
          <span class="bracket-round-name">${escapeHtml(stage)}</span>
          <span class="bracket-round-meta">${fixtures.filter(hasResult).length}/${expectedCount}</span>
        </div>
        <div class="bracket-round-body">${cards}</div>
      </div>`;
  }).join('');

  // 3rd place play-off, shown as an aside.
  const third = STATE.matches.find(m => canonicalStage(m.Stage) === 'Third Place');
  // Only surface the 3rd-place play-off once at least one finalist-loser is
  // known — otherwise its all-TBD row is just noise before the semis.
  const thirdKnown = third && (third.HomeTeam || third.AwayTeam);
  const thirdHtml = thirdKnown ? `
    <div class="bracket-aside">
      <div class="bracket-round-head">
        <span class="bracket-round-name">3rd Place</span>
        <span class="bracket-round-meta">${hasResult(third) ? '1/1' : '0/1'}</span>
      </div>
      ${bracketMatchCard(third, 'Third Place')}
    </div>` : '';

  root.innerHTML = `<div class="bracket">${roundsHtml}</div>${thirdHtml}`;
}

function bracketMatchCard(m, stage) {
  const homeTeam = (m && m.HomeTeam) || '';
  const awayTeam = (m && m.AwayTeam) || '';
  const played = m ? hasResult(m) : false;
  const hg = n(m && m.HomeGoals), ag = n(m && m.AwayGoals);
  const hpen = m && m.HomePenaltyGoals, apen = m && m.AwayPenaltyGoals;
  const onPens = hpen !== '' && hpen != null && apen !== '' && apen != null;
  const winner = played ? ((m.Winner) || (hg !== ag ? (hg > ag ? homeTeam : awayTeam) : '')) : '';

  // Each side renders independently: a known team (with flag + owner), or a
  // TBD placeholder when its feeder match hasn't been decided yet. This lets
  // a half-known tie show "Canada vs TBD" the instant one feeder finishes.
  const teamRow = (team, goals) => {
    if (!team) {
      return `<div class="bracket-team is-tbd"><span class="bracket-flag muted">·</span><span class="bracket-name muted">TBD</span><span class="bracket-owner"></span><span class="bracket-goals muted">·</span></div>`;
    }
    const s = STATE.stats.get(team);
    const owner = (s && s.participant) || '';
    const isWinner = winner === team;
    const isLoser = !!winner && !isWinner;
    return `
      <div class="bracket-team ${isWinner ? 'is-winner' : ''} ${isLoser ? 'is-loser' : ''}">
        <span class="bracket-flag">${flagFor(team)}</span>
        <span class="bracket-name">${escapeHtml(team)}</span>
        <span class="bracket-owner">${escapeHtml(owner || '—')}</span>
        <span class="bracket-goals">${played ? goals : '·'}</span>
      </div>`;
  };

  const dateTitle = m && m.Date ? ' · ' + fmtShortDate(m.Date) : '';
  return `
    <div class="bracket-match ${played ? 'played' : 'pending'} ${onPens ? 'on-pens' : ''}" title="${escapeHtml(stage + dateTitle)}">
      ${teamRow(homeTeam, hg)}
      ${teamRow(awayTeam, ag)}
      ${onPens ? `<div class="bracket-pens">${hpen}-${apen} on pens</div>` : ''}
    </div>`;
}

// ============================================================
// Landing motion choreography
// ------------------------------------------------------------
// Runs once on first data load. Tweens each numeric counter in
// the hero from 0 -> final value, then triggers the cascading
// .land-in animations on prize cards / ticker / spotlight via
// CSS classes. Respects prefers-reduced-motion.
// ============================================================

function playLandingChoreography() {
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) return;

  // Number tween only on the masthead — quiet, considered.
  const counters = [
    { el: $('#meta-teams'),  end: STATE.teams.length },
    { el: $('#meta-played'), end: STATE.matches.filter(hasResult).length, total: STATE.matches.length },
    { el: $('#meta-goals'),  end: STATE.matches.filter(hasResult).reduce((s, m) => s + n(m.HomeGoals) + n(m.AwayGoals), 0) },
  ];
  counters.forEach((c, i) => tweenNumber(c.el, c.end, 600, i * 60, c.total));
}

function tweenNumber(el, endValue, durationMs, delayMs, totalForFraction) {
  if (!el) return;
  const finalText = totalForFraction != null ? (endValue + ' / ' + totalForFraction) : String(endValue);
  el.textContent = totalForFraction != null ? '0 / ' + totalForFraction : '0';
  const start = performance.now() + delayMs;
  function frame(now) {
    if (now < start) { requestAnimationFrame(frame); return; }
    const t = Math.min(1, (now - start) / durationMs);
    const eased = 1 - Math.pow(1 - t, 3);
    const value = Math.round(endValue * eased);
    el.textContent = totalForFraction != null ? value + ' / ' + totalForFraction : String(value);
    if (t < 1) requestAnimationFrame(frame);
    else el.textContent = finalText;
  }
  requestAnimationFrame(frame);
}

// ============================================================
// Init
// ============================================================

function trapFocus(modalEl) {
  const focusable = modalEl.querySelectorAll(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  );
  if (!focusable.length) return;
  const first = focusable[0], last = focusable[focusable.length - 1];
  modalEl.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    if (e.shiftKey && document.activeElement === first) { last.focus(); e.preventDefault(); }
    else if (!e.shiftKey && document.activeElement === last) { first.focus(); e.preventDefault(); }
  });
}

function init() {
  // Flag images that fail to load fall back to the 3-letter code
  // chip. The error event doesn't bubble, so listen in the capture
  // phase to catch it for every .flag-img on the page.
  document.addEventListener('error', (e) => {
    const el = e.target;
    if (el && el.tagName === 'IMG' && el.classList.contains('flag-img') && !el.dataset.fellBack) {
      el.dataset.fellBack = '1';
      el.outerHTML = `<span class="flag-code">${escapeHtml(el.dataset.code || '—')}</span>`;
    }
  }, true);

  // Admin drawer toggle
  $('#admin-toggle').addEventListener('click', () => {
    $('#admin-drawer').hidden = false;
  });
  document.querySelectorAll('[data-drawer-close]').forEach(el => {
    el.addEventListener('click', () => { $('#admin-drawer').hidden = true; });
  });

  // Drawer actions
  $('#sample-btn').addEventListener('click', () => { loadSample(); $('#admin-drawer').hidden = true; });
  $('#reload-btn').addEventListener('click', () => { loadFromSheet(); $('#admin-drawer').hidden = true; });

  // Carousel controls
  $('#carousel-prev').addEventListener('click', () => {
    const panels = carouselPanels();
    if (!panels.length) return;
    STATE.carouselIndex = (STATE.carouselIndex - 1 + panels.length) % panels.length;
    pauseCarousel();
    renderCarousel();
  });
  $('#carousel-next').addEventListener('click', () => {
    const panels = carouselPanels();
    if (!panels.length) return;
    STATE.carouselIndex = (STATE.carouselIndex + 1) % panels.length;
    pauseCarousel();
    renderCarousel();
  });
  $('#carousel-pause').addEventListener('click', () => {
    STATE.carouselPlaying = !STATE.carouselPlaying;
    if (STATE.carouselPlaying) startCarouselTimer();
    else stopCarouselTimer();
    syncCarouselPauseBtn();
  });

  // Pause auto-rotate on hover/focus
  const carousel = $('#carousel');
  carousel.addEventListener('mouseenter', stopCarouselTimer);
  carousel.addEventListener('mouseleave', () => { if (STATE.carouselPlaying) startCarouselTimer(); });
  carousel.addEventListener('focusin', stopCarouselTimer);
  carousel.addEventListener('focusout', () => { if (STATE.carouselPlaying) startCarouselTimer(); });

  // Carousel keyboard: ← / →
  carousel.addEventListener('keydown', e => {
    if (e.key === 'ArrowLeft')  { $('#carousel-prev').click(); }
    if (e.key === 'ArrowRight') { $('#carousel-next').click(); }
  });

  // Modal close
  document.querySelectorAll('[data-modal-close]').forEach(el => {
    el.addEventListener('click', closeRaceModal);
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (!$('#race-modal').hidden) closeRaceModal();
      else if (!$('#admin-drawer').hidden) $('#admin-drawer').hidden = true;
    }
    // Admin drawer is hidden in the masthead; reach it via "?" key
    // (or URL hash #admin) so sweepstake admins can still open it.
    if (e.key === '?' && $('#race-modal').hidden && document.activeElement.tagName !== 'INPUT') {
      $('#admin-drawer').hidden = false;
    }
  });
  if (location.hash === '#admin') $('#admin-drawer').hidden = false;
  trapFocus($('#race-modal'));
  trapFocus($('#admin-drawer'));

  // Leaderboard search
  $('#leaderboard-search').addEventListener('input', e => {
    STATE.filter = e.target.value;
    renderLeaderboard();
  });

  // First load
  if (location.protocol === 'http:' || location.protocol === 'https:') {
    loadFromSheet();
  } else {
    setStatus("Showing sample data (browsers block CORS requests over file://). Open via http://localhost or the live site.", 'ok');
    loadSample();
  }
}

init();
