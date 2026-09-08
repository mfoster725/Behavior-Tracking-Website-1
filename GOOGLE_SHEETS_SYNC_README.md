# Google Sheet sync (staff, outside staff, students)

The app keeps the import spreadsheet and the website in step, in both directions, across all
three tabs of the workbook.

- **Pull** (sheet → website): adds people who are in the sheet but not on the website. This runs
  through the same code as the CSV import, so it creates login accounts, resolves support-team
  assignments, and emails new users their credentials exactly like uploading a CSV would.
- **Push** (website → sheet): writes every import column (except the key in column A) back into the sheet. Preview push compares all keyed website records against their sheet rows and lists every difference.

Sync is manual or scheduled, not live. Nothing happens until you press a button or a cron job runs.

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

**Column A is what makes two-way sync work.** A row with no User Number or Lunch Number can be
pulled in, but a person with no key cannot be matched back to a row, so their website edits can't
be pushed. They're listed by name in the push results instead of being guessed at.

---

## How conflicts are avoided

Both sides can be edited, so ownership is split rather than merged:

| Who decides | What they decide |
|---|---|
| **The sheet** | Who exists. Only a pull creates people. |
| **The website** | For students: Name, Grade, Card Color, support team (E–J), Student Email (L), Parent emails (M–N). For staff: Name, Role, Grades Taught, Case Manager (E, Paraprofessionals), Email. For outside staff: Name, District, Email. |

When you change one of those fields on the website, that person is flagged as having a pending
edit. Until the next push:

- A **pull holds that row back** and reports it under "held back", so the sheet cannot overwrite an
  edit that has not gone out yet.
- A **push** writes the change to the sheet and clears the flag.

**Sync Both Ways** pushes first and then pulls, which is the order that preserves website edits.

### What the sync will never do

- Delete a row, reorder rows, or clear a tab.
- Touch column A (the key) or delete/reorder rows.
- Blank a sheet cell that has a value, unless you set `GOOGLE_SHEETS_ALLOW_CLEAR=1`.
- Write to the sheet at all, unless you set `GOOGLE_SHEETS_ENABLE_WRITE=1`.
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
| **GOOGLE_SHEETS_ALLOW_CLEAR** | Set to `1` to let the website blank a sheet cell when its own value is empty. Off by default. |
| **CRON_SECRET** | Required only for the scheduled sync endpoint below. |

---

## 3. Run a sync

**From the admin panel** (Admin → Google Sheet Sync):

| Button | What it does |
|---|---|
| **Check Setup** | Reports credentials, which tabs were found and how they're being read, which tabs were ignored, and how many edits are waiting. Run this first. |
| **Preview Pull** | Lists everyone a pull would add and every field it would change, with old and new values. Changes nothing and emails nobody. |
| **Pull From Sheet** | Sheet → website, all three tabs. |
| **Preview Push** | Lists every cell a push would write, with the value the sheet holds now and what it would become, plus any rows that would be appended. Writes nothing. |
| **Push To Sheet** | Website → sheet. |
| **Sync Both Ways** | Push, then pull. |

Both previews are exact rather than approximate: the pull preview runs the real import inside a
transaction and rolls it back, so what it reports is what the import would actually do.

**From the API** (admin session required):

| Endpoint | Purpose |
|---|---|
| `GET /api/admin/google-sheet-status` | Configuration and per-tab report |
| `POST /api/admin/sync-google-sheet` | Pull. Body `{ "dry_run": true }` previews it. |
| `POST /api/admin/push-google-sheet` | Push. Body `{ "dry_run": true }` previews it. |
| `POST /api/admin/sync-google-sheet-two-way` | Push then pull |

All accept an optional body of `{ "sheet_id": "...", "type": "staff" }` to override the configured
workbook or limit the run to one tab (`staff`, `outside_staff`, or `student`).

---

## 4. Automatic sync (optional)

`GET|POST /api/admin/sync-google-sheet-cron` runs a two-way sync without a login, authenticated by
the `X-Cron-Secret` header matching the `CRON_SECRET` env var. This is the same pattern the paycheck
and point-card cron jobs use (see `PAYCHECK_CRON.md`), so it works with the free cron-job.org
service or a Render Cron Job.

```
POST https://<your-app>/api/admin/sync-google-sheet-cron
X-Cron-Secret: <CRON_SECRET>
```

Hourly is a reasonable starting point. A push only sends people with pending edits, so running it
often is cheap. Note that a scheduled pull **will** email login info to any new person added to the
sheet, exactly once — the same thing that happens when you import a CSV.
