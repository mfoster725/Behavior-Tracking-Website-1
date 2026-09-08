# Google Sheet sync (staff, outside staff, students)

The app keeps the import spreadsheet and the website in step, in both directions, across all
three tabs of the workbook.

- **Pull** (sheet → website): adds people who are in the sheet but not on the website, and brings
  in cells that were edited in the sheet. This runs through the same code as the CSV import, so it
  creates login accounts, resolves support-team assignments, and emails new users their credentials
  exactly like uploading a CSV would.
- **Push** (website → sheet): writes the import columns (except the key in column A) back into the
  sheet. Only cells the website itself changed are written; see [How conflicts are avoided](#how-conflicts-are-avoided).

The two directions are automated differently, on purpose:

| Direction | How it runs | Why |
|---|---|---|
| Website → sheet | **Automatic**, about a minute after you make the edit | Writing a cell is visible and undoable, and the sheet keeps full revision history |
| Sheet → website | **Manual**, when you press Pull From Sheet | A pull creates accounts and emails people their logins, which cannot be undone |

---

## The three tabs

Tabs are detected by name, and each one must use the **same column order as the CSV import**
(documented in Admin → Import Users from CSV). Column A is always the key.

| Tab named like | Treated as | Key (column A) | Columns |
|---|---|---|---|
| **Staff** | Staff | User Number | A User Number, B Name, C Role, D Grades Taught, E Case Manager, F Email |
| **Outside Staff** | Outside staff | User Number | A User Number, B Name, C District, E Email |
| **Students** | Students | Lunch Number | A Lunch Number, B Initials, C Grade, D Card Color, E–J team members, L Student Email, M/N Parent emails |

A tab is matched if its name contains "student", "staff", or both "outside" and "staff", so
`Students`, `Staff`, and `Outside Staff Users` are all recognised. Any tab that doesn't match one
of the three is ignored; **Check Setup** lists which tabs were ignored so you can spot a misnamed
or misspelled one.

If your tabs are named something else entirely, point the app at them explicitly with
`GOOGLE_SHEET_TAB_STAFF`, `GOOGLE_SHEET_TAB_OUTSIDE_STAFF`, and `GOOGLE_SHEET_TAB_STUDENT`.

Column E on the staff tab lists the case managers a Paraprofessional supports, and can name
several of them. Separate them however is convenient — `Allyson, Amanda`, `Allyson & Amanda`,
`Allyson and Amanda` — and a stray period instead of a comma is read as a separator too. A push
writes the list back as full names.

**Column A is what makes two-way sync work.** A row with no User Number or Lunch Number can be
pulled in, but a person with no key cannot be matched back to a row, so their website edits can't
be pushed. They're listed by name in the push results instead of being guessed at.

---

## How conflicts are avoided

Both sides can be edited, so **each cell belongs to whoever edited it last**, not to one side of
the sync. The app can tell which side moved because it remembers the value the two last agreed on,
per person and per column, in `users.sheet_synced_values` / `students.sheet_synced_values`.

For any one cell, a push compares three values — what the website has, what the sheet has, and
that agreed-on base:

| Website | Sheet | What the push does |
|---|---|---|
| unchanged | unchanged | nothing |
| **changed** | unchanged | writes the website's value into the sheet |
| unchanged | **changed** | leaves the cell alone and reports it under "left alone (changed in the sheet)". Pull From Sheet is what brings it in |
| **changed** | **changed** | the website wins, because it is the side that queued a deliberate edit |

The sheet still owns **who exists** — only a pull ever creates a person.

Editing one of the synced fields on the website also flags that person as having a pending edit.
Until it goes out:

- A **pull holds that row back** and reports it under "held back", so the sheet cannot overwrite an
  edit that has not been written yet.
- The **automatic push** writes the change and clears the flag, usually within a minute.

The columns the website keeps up to date are, for students: Name, Grade, Card Color, support team
(E–J), Student Email (L), Parent emails (M–N); for staff: Name, Role, Grades Taught, Case Manager
(E, Paraprofessionals), Email; for outside staff: Name, District, Email.

Records that have never been synced have no agreed-on base, so the first push writes the website's
values for them. Run **Preview Push** once after upgrading to see exactly what that first pass will
do — especially if `GOOGLE_SHEETS_ALLOW_CLEAR=1`, since that lets a push empty a sheet cell.

### What the sync will never do

- Delete a row, reorder rows, or clear a tab.
- Touch column A (the key) or delete/reorder rows.
- Overwrite a cell that was edited in the sheet and not on the website.
- Blank a sheet cell that has a value, unless you set `GOOGLE_SHEETS_ALLOW_CLEAR=1`.
- Write to the sheet at all, unless you set `GOOGLE_SHEETS_ENABLE_WRITE=1`.
- Run two syncs at once. Every sync takes a lock (`sheet_sync_state`); anything that arrives while
  one is running is queued behind it rather than started alongside it or cancelled.
- Email anyone their login info twice. Sends are recorded in `users.login_info_sent_at`, and only
  newly created accounts are ever emailed.

Deleting someone on the website leaves their sheet row untouched. Delete the row yourself if you
want them gone, otherwise the next pull will recreate them.

---

## 1. Google Cloud setup (one-time)

1. Go to [Google Cloud Console](https://console.cloud.google.com/).
2. Create a project (or pick an existing one).
3. **Enable the Google Sheets API**: APIs & Services → Enable APIs and Services → search
   "Google Sheets API" → Enable. The Drive API is not needed.
4. **Create a service account**: APIs & Services → Credentials → Create Credentials → Service
   account. Name it, then Create and Continue → Continue → Done.
5. Copy the service account's email address (`something@your-project.iam.gserviceaccount.com`).
6. Open the service account → **Keys** → Add key → Create new key → **JSON**. Download it.
7. **Share your Google Sheet** with that email address as **Editor** (untick "Notify people").
   Viewer is only enough for pulling; Editor is required to push.

Keep the JSON key out of the repository. `.gitignore` covers `keys/` and the common credential
filenames, but `GOOGLE_SHEETS_CREDENTIALS_JSON` below needs no file at all.

---

## 2. Configure the app

Set these in your environment (locally in a `.env`, or in Render's Environment tab).

| Variable | Description |
|---|---|
| **GOOGLE_SHEET_ID** | The sheet ID from the URL: `https://docs.google.com/spreadsheets/d/<GOOGLE_SHEET_ID>/edit` |
| **GOOGLE_SHEETS_CREDENTIALS_JSON** | **Either** paste the full contents of the downloaded JSON key here, **or** use the file path option below. |
| **GOOGLE_APPLICATION_CREDENTIALS** | **Or** the path to the JSON key file. Prefer `GOOGLE_SHEETS_CREDENTIALS_JSON` on Render so you don't need to store a file. |
| **GOOGLE_SHEETS_ENABLE_WRITE** | Set to `1` to allow pushing. Without it the app can only pull. |

Optional:

| Variable | Description |
|---|---|
| **GOOGLE_SHEET_TAB_STAFF** | Exact tab name for staff, if auto-detection doesn't find it. |
| **GOOGLE_SHEET_TAB_OUTSIDE_STAFF** | Exact tab name for outside staff. |
| **GOOGLE_SHEET_TAB_STUDENT** | Exact tab name for students. |
| **GOOGLE_SHEETS_ALLOW_CLEAR** | Set to `1` to let the website blank a sheet cell when its own value is empty. Off by default. Only ever applies to a cell the website changed. |
| **GOOGLE_SHEETS_AUTO_PUSH** | Set to `0` to turn the automatic push off. On by default once `GOOGLE_SHEET_ID` and `GOOGLE_SHEETS_ENABLE_WRITE` are set. |
| **GOOGLE_SHEETS_AUTO_PUSH_SECONDS** | How often to flush pending edits. Default `60`, minimum `15`. |
| **GOOGLE_SHEETS_AUTO_PUSH_QUIET_SECONDS** | Wait this long after someone's last edit before pushing them, so saving a person and then their team is one push. Default `20`. |
| **CRON_SECRET** | Required only for the scheduled sync endpoint below. |

---

## 3. Run a sync

**From the admin panel** (Admin → Google Sheet Sync):

| Button | What it does |
|---|---|
| **Check Setup** | Reports credentials, which tabs were found and how they're being read, which tabs were ignored, how many edits are waiting, how many sheet rows are not on the website yet, and the last few syncs that ran. Run this first. |
| **Preview Pull** | Lists everyone a pull would add and every field it would change, with old and new values. Changes nothing and emails nobody. |
| **Pull From Sheet** | Sheet → website, all three tabs. |
| **Preview Push** | Lists every cell a push would write, with the value the sheet holds now and what it would become, plus rows that would be appended and cells left alone because the sheet changed them. Writes nothing. |
| **Push To Sheet** | Website → sheet, the full pass, including people nobody has edited since the last sync. Day-to-day edits don't need it — they push themselves. |
| **Sync Both Ways** | Push, then pull. |

Both previews are exact rather than approximate: the pull preview runs the real import inside a
transaction and rolls it back, so what it reports is what the import would actually do.

**From the API** (admin session required):

| Endpoint | Purpose |
|---|---|
| `GET /api/admin/google-sheet-status` | Configuration, per-tab report, and recent runs |
| `POST /api/admin/sync-google-sheet` | Pull. Body `{ "dry_run": true }` previews it. |
| `POST /api/admin/push-google-sheet` | Push. Body `{ "dry_run": true }` previews it, `{ "dirty_only": true }` limits it to pending edits. |
| `POST /api/admin/sync-google-sheet-two-way` | Push then pull |

All accept an optional body of `{ "sheet_id": "...", "type": "staff" }` to override the configured
workbook or limit the run to one tab (`staff`, `outside_staff`, or `student`). Anything that writes
returns **409** if a sync is already running.

---

## 4. The automatic push

Once `GOOGLE_SHEET_ID` and `GOOGLE_SHEETS_ENABLE_WRITE=1` are set, the app flushes pending website
edits to the sheet every 60 seconds by itself. No cron job and no Apps Script needed.

It is built to be cheap and hard to trip over:

- **Free when idle.** With nothing flagged it returns before opening the workbook, so a quiet site
  spends no Google API quota at all.
- **Bursts collapse into one push.** Editing twenty people over three minutes produces a handful of
  batched writes, not twenty syncs. A record is also held back for `GOOGLE_SHEETS_AUTO_PUSH_QUIET_SECONDS`
  (default 20) after its last change, so saving a person and then their support team is one push.
- **Never two at once, and never cancelled.** Every sync takes a database lock. A request that
  arrives mid-run sets a rerun flag and is picked up by an extra pass at the end, rather than
  interrupting the run in flight or racing it.
- **Only touches records the website changed.** It never even reads the rest, so it cannot rewrite
  a row nobody here edited.

Each run is recorded in `sheet_sync_runs` and the last ten show up under **Check Setup**, since
nobody is watching the screen when they happen.

### Scheduled sync (optional)

`GET|POST /api/admin/sync-google-sheet-cron` runs a sync without a login, authenticated by the
`X-Cron-Secret` header matching the `CRON_SECRET` env var. This is the same pattern the paycheck and
point-card cron jobs use (see `PAYCHECK_CRON.md`), so it works with the free cron-job.org service or
a Render Cron Job.

```
POST https://<your-app>/api/admin/sync-google-sheet-cron
X-Cron-Secret: <CRON_SECRET>
```

By default this **pushes only** — the same thing the built-in timer does, useful if you would rather
drive it externally or your host stops background threads. Add `?pull=1` (or `{"pull": true}`) to
make it a two-way sync, but note that a scheduled pull **will** email login info to any new person
added to the sheet, exactly once, including someone whose row was still half-typed when it ran. That
is why pulling is a button by default.
