# Staff tutorial videos

Short, silent screen-recordings of the staff-facing UI, each paired with a timed narration
script to read aloud when recording a voiceover. One topic per video — these are not
chapters of a single longer video.

| Video | Length | Narration script | Covers |
|---|---|---|---|
| `point-card-period-entry.mp4` | 29s | `narration-01-period-entry.md` | Period Entry: scoring one class period across every scheduled student |
| `point-card-daily-entry.mp4` | 38s | `narration-02-daily-entry.md` | Daily Entry: scoring a student's whole day, all periods at once |
| `past-point-cards.mp4` | 33s | `narration-03-past-point-cards.md` | Viewing a student's past point cards and printing them (Full Card / Info Insights) |
| `reports-navigation.mp4` | 50s | `narration-04-reports-navigation.md` | Reports controls: student vs. group, timeframe, Compare / Incentive Tracking show-hide, Insights View, Print |
| `report-sections.mp4` | 41s | `narration-05-report-sections.md` | What each report tile shows: Attendance, STAR Percent, Plan Thresholds, Trigger Time, Infractions, Incidents, Level Up's, Frenzies |

## How to use a narration script

Play the video muted and read the script's lines aloud starting around each listed
timestamp — the on-screen caption at that moment is the better guide than the clock. Once
you have an audio recording, sync it over the silent video with any editor (or ffmpeg).

## How these were made / how to regenerate them

Each video is a real Playwright recording against a locally-running copy of this app, not
a mockup. Captions are burned in live during recording (an injected on-page caption bar),
so what's on screen is the actual app UI.

```powershell
# 1. Install deps and seed synthetic test data (safe — never touches real students)
python -m pip install -r requirements.txt
python seed_test_data.py            # creates instance/behavior_tracking_test.db

# 2. Run the app against that test database, on port 5050
set USE_TEST_DB=1
set PORT=5050
python app.py

# 3. In another terminal: Playwright + Chromium, then run the recorder scripts
npm install -D playwright
npx playwright install chromium
node scripts/tutorial-videos/01-period-entry.js
node scripts/tutorial-videos/02-daily-entry.js
node scripts/tutorial-videos/03-past-point-cards.js
node scripts/tutorial-videos/04-reports-navigation.js
node scripts/tutorial-videos/05-report-sections.js
```

Each script writes a `.webm` next to itself; convert to `.mp4` with ffmpeg:

```
ffmpeg -i recording.webm -c:v libx264 -pix_fmt yuv420p -movflags +faststart out.mp4
```

Logged in as `staff25` (password `test123`) — a plain **staff** account (not admin) that
has real scheduled students in the seed data, so the grids aren't empty. `staff2`, by
contrast, has no student assignments in the seed data and its point-card screens are
empty — don't use it for these recordings.

Re-run a script any time the UI changes enough that a video goes stale — each one drives
real selectors (`#nav-hamburger`, `.nav-btn[data-view="..."]`, etc.) against the live app,
so a script failing is itself a signal that something it depends on moved.
