# WC 2026 Sweepstake — Control Room

A single-page "control room" dashboard for an office World Cup
sweepstake. Reads tournament data live from a Google Sheet,
computes per-team stats (including per-90 metrics from the
Google match panel), and shows a live leader for every prize
category — plus a Bloomberg-style match ticker, an auto-rotating
group/knockout carousel, a knockout bracket, and a click-through
"race view" for each prize.

- 48 teams, £20 per person to charity, prize pot funded separately
- 16 prize categories so every team has a realistic shot at something
- Pure HTML / CSS / JS — no build step, no backend
- Edits happen in the Google Sheet — no commits, no JSON, no faff

## Files

```
.
├── index.html       # Page layout
├── styles.css       # Dark "control room" theme
├── app.js           # Loading, stats, prize resolution, rendering
├── Tracker.xlsx     # Snapshot of the Sheet at project start (reference only)
└── README.md
```

The Google Sheet is the source of truth at runtime. `Tracker.xlsx`
is kept around as a snapshot of the structure.

## Editing during the tournament

Open the Sheet (web or mobile app), change a cell, you're done.
Refresh the dashboard to see the change.

The Sheet has four tabs the dashboard reads:

### `Participants` tab

| Column | Notes |
|---|---|
| `Group`   | A–L |
| `Team`    | Country name. Joined to Match Data Home/Away Team — must match exactly. |
| `Entrant` | The owner. Drives the participant grid and prize chips. |

### `Match Data` tab

One row per match — group games **and** knockouts. Leave score
columns blank for fixtures not yet played; the team-stat columns
can stay blank too until the match completes.

| Column | Notes |
|---|---|
| `Date`              | Match date. |
| `Stage`             | `Group`, `Round of 32`, `Round of 16`, `Quarter Finals` (or `Quarter-finals`), `Semi Finals` (or `Semi-finals`), `Third Place Play-Off` (or `Third Place`), `Final`. |
| `Home Team` / `Away Team` | Country names — must match `Participants.Team`. |
| `Home Score` / `Away Score` | Blank if not played. |
| `Minutes`           | `90` for group games. `120` if the knockout went to extra time. This is the per-90 denominator. Penalty-shootout stats are not recorded. |
| `Home Shots` / `Away Shots` | From the Google stat panel. |
| `Home SoT` / `Away SoT` | Shots on target. |
| `Home Possession %` / `Away Possession %` | Whole numbers (e.g. `75`); both should sum to 100. |
| `Home Fouls` / `Away Fouls` | |
| `Home Yellow` / `Away Yellow` | |
| `Home Red` / `Away Red` | |
| `Home Offsides` / `Away Offsides` | |
| `Home Corners` / `Away Corners` | |
| `Goal Diff` / `Winning Team` | Sheet-side formula columns; the dashboard ignores them and recomputes. |

> **Cards convention.** Record exactly what the Google match panel
> shows. When a player picks up a 2nd yellow → red, Google
> typically shows it as 2 yellows AND 1 red — record what you
> see. The cards/90 metric is `Yellow * 1 + Red * 2` per 90
> minutes played, so a 2Y → R incident scores 4 points. Fairer
> than a single yellow.

### `Awards` tab

Manually entered when announcements happen. Until a row's
`Country / Team` is filled in, the corresponding prize card on
the dashboard shows TBD. Once filled, the prize is final and the
country's owner wins.

| Column | Notes |
|---|---|
| `Award`                  | One of: `Tournament Winner`, `2nd Place`, `3rd Place`, `Golden Boot (Top Scorer)`. Wording must match. Other rows are ignored. |
| `Player (if applicable)` | Top scorer's name (used for the Golden Boot row). |
| `Country / Team`         | The country whose entrant wins the prize. |
| `Entrant`                | Auto-filled (Sheet-side formula). |

### `Golden Boot Tracker` tab

Optional but useful — keep this updated through the tournament so
the Golden Boot card on the dashboard shows the current top
scorer's country (and the race view shows the chasing pack).

| Column | Notes |
|---|---|
| `Player`  | Free text. |
| `Country` | Country name — must match `Participants.Team` for the entrant lookup to work. |
| `Goals`   | Number. |
| `Entrant` | Auto-filled. |

## Prize categories

| Category | How it's calculated | Auto-confirms when |
|---|---|---|
| **1st / 2nd / 3rd Place** | `Awards` rows for each. | The country is filled in. |
| **Golden Boot** | Live: top scorer in `Golden Boot Tracker`. Confirmed: `Awards`. | Awards row filled. |
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

"Tournament complete" = the Awards sheet has a `Tournament Winner`
country, or the Final has a recorded result. Ties are always
shown — no random tie-break.

## Hosting & sharing

- Code is hosted on GitHub Pages (this repo).
- Data is hosted in Google Sheets.
- The Sheet must be shared as **Anyone with the link → Viewer**
  for the dashboard to read it. Edit access stays restricted to
  whoever you explicitly invite.

To swap the Sheet (e.g. for a different tournament): change
`SHEET_ID` near the top of `app.js` and push.

## Running it locally

```powershell
# from the project folder
python -m http.server 8000
```

Open <http://localhost:8000/>.

## Editing the dashboard

- **Add a prize category:** append one entry to `PRIZE_CATEGORIES`
  in `app.js` and (if it's a new stat) extend `computeTeamStats`.
- **Tune per-90 minimums:** the `prizeMax(..., { minMatches: 1 })`
  options on each per-90 prize.
- **Restyle:** every colour, spacing, type-scale, motion-curve
  token lives at the top of `styles.css` under `:root`.
- **Carousel auto-rotate speed:** change `CAROUSEL_AUTO_MS` near
  the top of `app.js`.

## Notes

- Final positions come from the `Awards` tab, not derived from
  the bracket — set the country on each podium row manually
  after the final.
- The dashboard is read-only; all edits happen in the Sheet.
- Respects `prefers-reduced-motion`.
