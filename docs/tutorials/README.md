# Staff tutorial videos

Screen-recordings of the staff-facing UI with on-screen captions and a synthesized
voiceover, each paired with the timed narration script the voiceover was generated from.
One topic per video — these are not chapters of a single longer video.

| Video | Length | Narration script | Covers |
|---|---|---|---|
| `point-card-period-entry.mp4` | 60s | `narration-01-period-entry.md` | Period Entry: scoring one class period across every scheduled student |
| `point-card-daily-entry.mp4` | 70s | `narration-02-daily-entry.md` | Daily Entry: scoring a student's whole day, all periods at once |
| `past-point-cards.mp4` | 64s | `narration-03-past-point-cards.md` | Viewing a student's past point cards and printing them (Full Card / Info Insights) |
| `reports-navigation.mp4` | 92s | `narration-04-reports-navigation.md` | Reports controls: student vs. group, timeframe, Compare / Incentive Tracking show-hide, Insights View, Print |
| `report-sections.mp4` | 80s | `narration-05-report-sections.md` | What each report tile shows: Attendance, STAR Percent, Plan Thresholds, Trigger Time, Infractions, Incidents, Level Up's, Frenzies |
| `bills.mp4` | 92s | `narration-06-bills.md` | Bills: class overview, turning bills on for a student, This week / Pay / worksheets, My Plan, Savings, Assistance, History |

Each recorder script (`scripts/tutorial-videos/0N-*.js`) paces its `step()` hold times to
match how long that step's narration line actually takes to speak (measured with
`edge-tts`, the same engine `voiceover.py` uses), so the recording and the generated voice
track stay in sync end to end instead of needing a frozen final frame. If you edit a
narration line's wording, its spoken length changes — re-time the matching step in the
recorder script (see below) and re-record so the two stay in sync, then re-run
`voiceover.py`.

## Voicing a narration script automatically

`scripts/tutorial-videos/voiceover.py` synthesizes each narration script's lines with
[edge-tts](https://github.com/rany2/edge-tts) (free Microsoft neural voices, no API key,
needs internet access) and muxes them into the matching silent video at their listed
timestamps — no human recording required.

```powershell
python -m pip install edge-tts     # one-time; not in requirements.txt (docs-only tool)
# ffmpeg / ffprobe must be on PATH — winget install Gyan.FFmpeg

python scripts/tutorial-videos/voiceover.py --one period-entry   # one video
python scripts/tutorial-videos/voiceover.py --all                # all six, overwritten in place
```

`--one` takes a short name (`period-entry`, `daily-entry`, `past-point-cards`,
`reports-navigation`, `report-sections`, `bills`); or pass `--narration <file.md> --video <file.mp4>`
directly for a video outside that list. By default the script overwrites the target video
in place; pass `--out <path>` to write elsewhere instead. `--voice` picks a different
edge-tts voice (`python -m edge_tts --list-voices` to see options) and `--rate` adjusts
speaking speed (e.g. `--rate="-10%"`).

Each line is scheduled at its narration timestamp, but never starts before the previous
line finishes speaking, so lines never talk over each other even if a timestamp turns out
to be optimistic. The recorder scripts' hold times are already tuned to each line's actual
spoken length (see below), so in practice this rarely has to slide anything — but if you
edit narration wording without re-timing the recorder, expect drift warnings again. If the
narration as a whole ends up running longer than the recording, the last video frame is
frozen to cover the extra narration instead of cutting it off; that's a safety net, not the
normal case.

## How to use a narration script by hand

If you'd rather record a human voiceover instead: play the video muted and read the
script's lines aloud starting around each listed timestamp — the on-screen caption at that
moment is the better guide than the clock. Once you have an audio recording, sync it over
the silent video with any editor (or ffmpeg).

## How these were made / how to regenerate them

Each video is a real Playwright recording against a locally-running copy of this app, not
a mockup, at a full-screen 1920x1080 viewport (a narrower window collapses the Reports
grid's card layout awkwardly). Captions are burned in live during recording (an injected
on-page caption bar), so what's on screen is the actual app UI.

`scripts/tutorial-videos/harness.js` also injects a cursor dot that tracks the real mouse
position plus a `highlight(selector)` helper that moves the mouse to an element and circles
it with a pulsing ring — call it from a step's `fn` before clicking (or on its own, for a
step that's just talking about something) so viewers can see what's being clicked or
described instead of just watching the UI change underneath them. `06-bills.js` is the
current example; `unhighlight()` is called automatically at the top of every `step()`, so a
ring only outlives its own step if the step's `fn` doesn't clear it itself (do that right
after a click that navigates or opens a modal, so a stale ring doesn't float over the next
screen). Adding highlight calls lengthens a step's actual recorded duration a bit (mouse
movement + a short pause before the click) — re-measure the narration script's `~Time`
column afterward instead of assuming the old timestamps still line up (see below).

The Reports page's "Trends" chart starts collapsed by default (a real app behavior, not a
recording artifact) and the layout doesn't reflow to fill the gap it leaves — so
`04-reports-navigation.js` and `05-report-sections.js` click the Trends stat tile
(`.overview-trends-card[data-overview-key="trends"]`) right after opening Reports, so the
recording shows the full 3-column layout instead of a blank left column.

`06-bills.js` also depends on `scripts/tutorial-videos/seed_bills_demo.py` having been
run first (see below) — it drives the demo by matching bill-row text like `Maple Street
Apartments` and `Prairie Power & Light`, which come from the bill catalog in
`bills_lib.py`; if that catalog's names change, update both the recorder script and the
seed script's expectations together.

```powershell
# 1. Install deps and seed synthetic test data (safe — never touches real students)
python -m pip install -r requirements.txt
python seed_test_data.py            # creates instance/behavior_tracking_test.db

# 2. Run the app against that test database, on port 5050
set USE_TEST_DB=1
set PORT=5050
python app.py

# 3. In another terminal: Playwright + Chromium, then run the recorder scripts
#    WARNING: this repo has no package.json (node_modules/esbuild is vendored directly —
#    see the root CLAUDE.md). `npm install` auto-creates one and PRUNES anything not in
#    its lockfile, deleting the vendored esbuild files as a side effect. After installing,
#    delete the generated package.json/package-lock.json and restore esbuild:
npm install -D playwright
npx playwright install chromium
git checkout -- node_modules/          # restores esbuild if npm install pruned it
rm -f package.json package-lock.json   # node_modules/playwright still resolves without one
node scripts/tutorial-videos/01-period-entry.js
node scripts/tutorial-videos/02-daily-entry.js
node scripts/tutorial-videos/03-past-point-cards.js
node scripts/tutorial-videos/04-reports-navigation.js
node scripts/tutorial-videos/05-report-sections.js

# 06-bills.js needs one seeded student to actually have bills turned on with real
# money and a week of bills issued — seed_test_data.py alone leaves everyone at
# "Bills off" / $0. Run this once (in yet another terminal, same USE_TEST_DB=1):
python scripts/tutorial-videos/seed_bills_demo.py
node scripts/tutorial-videos/06-bills.js
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
so a script failing is itself a signal that something it depends on moved. Prefer a
`:visible` suffix on selectors that pick "the first matching element" (e.g.
`select.daily-input[data-category="t"]:visible`) — some grids keep hidden placeholder
cells in the DOM for periods a given student isn't scheduled for, and an unqualified
`.first()` can land on one of those.

If you change narration wording, re-measure that line's spoken length and update the
matching step's hold time before re-recording — see the per-line durations printed by
running `voiceover.py` (or `python -m edge_tts --voice en-US-AndrewNeural --text "..." --write-media /tmp/x.mp3` for a single line), then set that step's `holdBefore + holdAfter`
to roughly the spoken duration plus a ~500ms buffer, and its `~Time` row in the narration
table to the new cumulative timestamp.

The reverse also matters: if you change what a step's `fn` *does* (e.g. adding a
`highlight()` call) without touching the narration wording, the step's on-screen timing
still shifts and the narration table goes stale. `harness.js`'s `step()` logs
`STEP @ <seconds>s: <label>` to the console as it runs (seconds since the recording
started); re-run the recorder, read off each step's actual elapsed time, and update the
narration table's `~Time` column to match (round up, not down — audio starting a little
after the on-screen change reads better than audio racing ahead of it) before running
`voiceover.py`.
