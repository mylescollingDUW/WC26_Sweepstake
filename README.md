# WC 2026 Sweepstake Dashboard

A single-page dashboard for an office World Cup sweepstake. It reads
tournament data live from a Google Sheet and shows group standings, a
match ticker, an auto-rotating group/knockout carousel, and a knockout
bracket.

Pure HTML / CSS / JS — no build step, no backend.

## Files

| File           | Purpose                                   |
|----------------|-------------------------------------------|
| `index.html`   | Page layout                               |
| `styles.css`   | Theme                                      |
| `app.js`       | Data loading, stats, and rendering        |
| `Tracker.xlsx` | Snapshot of the Google Sheet (reference)  |

## Data

The Google Sheet is the source of truth at runtime — edits happen there
and the dashboard reflects them on refresh. The Sheet must be shared as
**Anyone with the link → Viewer** for the dashboard to read it.

To point the dashboard at a different Sheet, change `SHEET_ID` near the
top of `app.js`.

## Running locally

```powershell
python -m http.server 8000
```

Then open <http://localhost:8000/>.

## Hosting

Code is hosted on GitHub Pages; data lives in Google Sheets.
