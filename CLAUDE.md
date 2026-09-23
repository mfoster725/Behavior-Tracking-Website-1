# Behavior Tracking Website

A web-based behavior/point-card tracking system for schools (STAR points,
infractions, frenzy events, student marketplace/economy, curriculum library).
Flask + SQLAlchemy backend, server-rendered templates + vanilla JS/CSS
frontend, deployed on Render (web dyno via gunicorn + a separate nightly cron
service). Postgres in production (Aiven/Render), SQLite locally.

## Build & run

```powershell
python -m pip install -r requirements.txt
python app.py
```

App serves on http://localhost:5000 (or `python -m gunicorn app:app` to mirror
production). `run.bat` / `install.bat` wrap the same commands for non-CLI use.

Default local admin/staff logins are in [README.md](README.md) — change them
before any shared/deployed use.

## Structure notes

- `app.py` is a single large Flask app file (~21k lines) — routes, models, and
  most business logic live here. `economy_lib.py`, `economy_routes.py`,
  `curriculum_lib.py`, `student_plans_lib.py` hold split-out subsystems.
- `migrate_*.py` at the repo root are one-off, already-applied migration
  scripts (schema changes made outside an ORM migration framework) — kept for
  history/reference, not meant to be re-run against a current database.
- `templates/` + `static/` are server-rendered views and their JS/CSS.
- No automated test suite currently exists. Verify changes by running the app
  locally and exercising the affected flow in a browser.
- `node_modules/` / esbuild are present but there's no `package.json` at repo
  root currently — check before assuming a JS build step is wired up.

## Deployment

- `Procfile`: `gunicorn app:app` for the web service.
- `render.yaml`: a separate Render cron service running
  `run_point_card_submit_cron.py` nightly (04:15 UTC) for point-card
  auto-submit — see the schedule comment in that file before changing it.
- See `RENDER_POSTGRES_SIZING.md`, `AIVEN_MIGRATION_PATH.md`,
  `COCKROACHDB_SETUP.md`, `POSTGRES_FREE_SETUP.md` for the Postgres history —
  multiple providers have been evaluated; check current `DATABASE_URL` config
  before assuming which one is live.
- `FERPA_COMPLIANCE.md` / `FERPA_IMPLEMENTATION.md`: student-data handling
  constraints — read before changing anything touching student PII, exports,
  or auth/access scoping.

## Git workflow

Repo: `mfoster725/Behavior-Tracking-Website-1`, working branch `main` (no
separate development branch currently — confirm before assuming otherwise).

**This project is also open in Cursor.** Both tools read/write the same
working directory and the same git repo, so:

- Commit and pull/push often rather than leaving long-lived uncommitted
  changes — the two tools have no awareness of each other's in-progress edits,
  and simultaneous edits to the same file can silently overwrite one side's
  work (no merge, no warning).
- Before starting a task, check `git status` for uncommitted changes that
  might be Cursor's in-progress work, not stray state to discard.
- Avoid both tools running unattended against this same checkout at the same
  time on overlapping files. If you need true parallelism, use a git worktree
  (`git worktree add ../Cursor-claude main`) for one of the two tools so each
  works in its own directory against the same repo.
- Never commit `.env`, `*service-account*.json`, `*credentials*.json`,
  `aiven-ca.pem`-style secrets, or the SQLite `.db` files (see `.gitignore`).

## Logs / scratch files

Root-level `debug-*.log` files and `.cursor/debug-*.log` are transient tool
output, not application logs — safe to ignore/delete, don't treat as source.
