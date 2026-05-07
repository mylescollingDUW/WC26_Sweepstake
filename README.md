# WC 2026 Sweepstake — Control Room

A single-page "control room" dashboard for an office World Cup
sweepstake. Reads tournament data from `tracker.json`, computes
per-team stats (including per-90 metrics from the Google match
panel), and shows a live leader for every prize category — plus a
Bloomberg-style match ticker, an auto-rotating group/knockout
carousel, a knockout bracket, and a click-through "race view" for
each prize.

- 48 teams, £20 per person to charity, prize pot funded separately
- 16 prize categories so every team has a realistic shot at something
- Pure HTML / CSS / JS — no build step, no backend
- One file (`tracker.json`) is the source of truth — edit it
  during the tournament and refresh the page

## Files

```
.
├── index.html         # Page layout
├── styles.css         # Dark "control room" theme
├── app.js             # Loading, stats, prize resolution, rendering
├── tracker.json       # The source of truth — edit this
├── Tracker.xlsx       # Excel reference / bulk-edit helper (optional)
└── README.md
```

`tracker.json` is what the dashboard fetches at runtime. `Tracker.xlsx`
is kept around as an Excel-friendly editor; if you prefer to edit
in Excel, run `xlsx_to_json.py` (in the project's tools folder) to
regenerate `tracker.json` from the workbook.

## Editing tracker.json

Three workflows; pick whatever's most convenient at the moment.

1. **Direct on github.com** (works on phone / anywhere). Open the
   repo, click `tracker.json`, click the pencil icon, edit, hit
   *Commit changes*. GitHub Pages serves the new file in ~30s.
2. **Locally in any text editor.** Open `tracker.json`, change
   values, save. Push the commit when you're done.
3. **In Excel via `Tracker.xlsx`.** Edit the workbook normally,
   then run `python xlsx_to_json.py` to regenerate `tracker.json`.
   Push both files.

## tracker.json structure

```jsonc
{
  "version": 1,

  "teams": [
    { "group": "A", "team": "Mexico", "entrant": "Alex" },
    ...
  ],

  "matches": [
    {
      "id":        "M001",
      "date":      "2026-06-11",
      "stage":     "Group",
      "homeTeam":  "Mexico",  "awayTeam": "Saudi Arabia",
      "homeScore": null,      "awayScore": null,
      "minutes":   90,

      "homeShots": 0,         "awayShots": 0,
      "homeSoT": 0,           "awaySoT": 0,
      "homePossession": 0,    "awayPossession": 0,
      "homeFouls": 0,         "awayFouls": 0,
      "homeYellow": 0,        "awayYellow": 0,
      "homeRed": 0,           "awayRed": 0,
      "homeOffsides": 0,      "awayOffsides": 0,
      "homeCorners": 0,       "awayCorners": 0
    },
    ...
  ],

  "awards": {
    "winner":     { "player": "",           "country": "" },
    "runnerup":   { "player": "",           "country": "" },
    "third":      { "player": "",           "country": "" },
    "goldenBoot": { "player": "Top scorer", "country": "Argentina" }
  },

  "goldenBoot": [
    { "player": "...", "country": "...", "goals": 0 }
  ]
}
```

Notes on values:

- `homeScore` / `awayScore` use `null` for "not played yet". As
  soon as a number is set, the match is considered played.
- `minutes` is the per-90 denominator. `90` for group games. Use
  `120` for knockouts that went to extra time. Penalty shootout
  stats are not recorded.
- `homePossession` / `awayPossession` are whole numbers (e.g.
  `75`); both should sum to 100.
- `stage` accepts `Group`, `Round of 32`, `Round of 16`,
  `Quarter-finals` (or `Quarter Finals`), `Semi-finals` (or
  `Semi Finals`), `Third Place` (or `Third Place Play-Off`),
  `Final`. The dashboard normalises common variants.
- **Cards convention**: record exactly what the Google match
  panel shows. When a player picks up a 2nd yellow → red, Google
  typically shows it as 2 yellows AND 1 red — record what you
  see. The cards/90 metric is `Yellow*1 + Red*2 per 90 minutes
  played`, so a 2Y → R incident scores 4 points. Fairer than a
  single yellow.

## Prize categories

| Category | How it's calculated | Auto-confirms when |
|---|---|---|
| **1st / 2nd / 3rd Place** | `awards.winner / runnerup / third`. | `country` is filled in. |
| **Golden Boot** | Live: top scorer in `goldenBoot`. Confirmed: `awards.goldenBoot`. | Awards entry filled. |
| **Largest Goal Difference** | Largest single-match winning margin. | Tournament complete. |
| **Largest Negative Goal Difference** | Most negative aggregate goal difference (worst tournament-long GF − GA). | Tournament complete. |
| **Highest Scoring Match** | Both teams in the match with most total goals share the prize. | Tournament complete. |
| **Most Goals in a Drawn Match** | Both teams in the highest-scoring draw share the prize. | Tournament complete. |
| **First Team to Score 10 Goals** | First team whose cumulative goals scored reaches 10 (chronological match order). | A team crosses 10. |
| **Most Shots / 90** | `Σ shots ÷ Σ minutes × 90`. | Tournament complete. |
| **Most Shots on Target / 90** | Same, on SoT. | Tournament complete. |
| **Highest Avg Possession** | Average of per-match possession %. | Tournament complete. |
| **Most Fouls / 90** | Per-90 fouls. | Tournament complete. |
| **Most Cards / 90** | `(Yellow * 1 + Red * 2) per 90`. | Tournament complete. |
| **Most Offsides / 90** | Per-90 offsides. | Tournament complete. |
| **Most Corners / 90** | Per-90 corners. | Tournament complete. |

"Tournament complete" = `awards.winner.country` is filled, or the
Final has a recorded result. Ties are always shown — no random
tie-break.

## Running it

### On GitHub Pages (the live site)

1. Push to the repo — GitHub Pages serves it from `main` /
   project root.
2. Open the Pages URL.
3. Edits to `tracker.json` (via web editor or `git push`) appear
   on the live site within ~30 seconds.

### Locally

```powershell
# from the project folder
python -m http.server 8000
```

Open <http://localhost:8000/>. Reload the page after any edit
to `tracker.json`.

### Quick view (no server)

Double-click `index.html`. Sample data renders immediately. The
admin drawer (gear icon, top-right) lets you load a `tracker.json`
file manually.

## Editing the dashboard

- **Add a prize category:** append one entry to `PRIZE_CATEGORIES`
  in `app.js` and (if it's a new stat) extend `computeTeamStats`.
- **Tune per-90 minimums:** the `prizeMax(..., { minMatches: 1 })`
  options on each per-90 prize. Bump to 3 if you don't want
  group-stage flukes leading the table on day 1.
- **Restyle:** every colour, spacing, type-scale, motion-curve
  token lives at the top of `styles.css` under `:root`.
- **Carousel auto-rotate speed:** change `CAROUSEL_AUTO_MS` near
  the top of `app.js`.

## Notes

- Final positions come from `awards`, not derived from the
  bracket — set the country on each podium row manually after
  the final.
- The dashboard is read-only; all edits happen in the JSON.
- Respects `prefers-reduced-motion`.
