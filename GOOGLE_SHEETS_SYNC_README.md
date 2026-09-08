# Google Sheet sync (students)

The app keeps the student import spreadsheet and the website in step, in both directions.

- **Pull** (sheet → website): adds students that are in the sheet but not on the website, and updates
  students that have no pending website edits.
- **Push** (website → sheet): writes website edits to **Name, Email, Grade, and Card Color** back into
  the sheet.

Sync is manual or scheduled, not live. Nothing happens until you press a button or a cron job runs.

---

## How conflicts are avoided

Both sides can be edited, so ownership is split rather than merged:

| Who decides | What they decide |
|---|---|
| **The sheet** | Which students exist. Only a pull creates students. |
| **The website** | Name, Email, Grade, Card Color for students that already exist. |

When you change one of those four fields on the website, that student is flagged as having a pending
edit. Until the next push:

- A **pull leaves that student alone** and reports them under `skipped_conflicts`, so the sheet cannot
  overwrite an edit that has not gone out yet.
- A **push** writes the change to the sheet and clears the flag.

**Sync Both Ways** pushes first and then pulls, which is the order that preserves website edits.

### What the sync will never do

- Delete a row, reorder rows, or clear the sheet.
- Touch any column other than Name, Email, Grade, and Card Color.
- Blank a sheet cell that has a value, unless you set `GOOGLE_SHEETS_ALLOW_CLEAR=1`.
- Write to the sheet at all, unless you set `GOOGLE_SHEETS_ENABLE_WRITE=1`.

Deleting a student on the website leaves their sheet row untouched. Delete the row yourself if you
want them gone, otherwise the next pull will recreate the student.

---

## 1. Set up the sheet

The first row must be a header row. Column order does not matter; the headers are matched by name
(any casing, spaces or underscores).

| Column | Required | Description |
|---|---|---|
| **Lunch Number** | **Yes, for two-way sync** | The key that ties a sheet row to a student. |
| **Name** | Yes | Student name or initials. `Student Name` and `Initials` also work. |
| **Email** | No | Student email address. |
| **Grade** | No | Grade level (e.g. 9, 10, K). |
| **Card Color** | No | yellow, green, or blue. |

Any other columns you keep in the sheet are read past and never modified.

**Lunch Number is what makes two-way sync work.** A student without one cannot be matched to a row, so
their website edits cannot be pushed; they are listed under "could not be written to the sheet" in the
results. The Add Student form has a Lunch Number field for this reason — fill it in.

Rows with a blank Lunch Number are still pulled in. They are matched by a unique name match against
students that have no lunch number, so re-syncing will not duplicate them, but they are safer with a key.

---

## 2. Google Cloud setup (one-time)

1. Go to [Google Cloud Console](https://console.cloud.google.com/).
2. Create a project (or pick an existing one).
3. **Enable the Google Sheets API**: APIs & Services → Enable APIs and Services → search "Google Sheets API" → Enable.
4. **Create a service account**: APIs & Services → Credentials → Create Credentials → Service account.
5. Open the new service account → **Keys** → Add key → Create new key → **JSON**. Download the JSON file.
6. **Share your Google Sheet** with the service account email (e.g. `something@your-project.iam.gserviceaccount.com`)
   as **Editor**. Viewer is only enough for pulling; the app needs Editor to push.

Keep the JSON key out of the repository. `.gitignore` covers `keys/` and the common credential
filenames, but the safest option is `GOOGLE_SHEETS_CREDENTIALS_JSON` below, which needs no file at all.

---

## 3. Configure the app

Set these in your environment (locally in a `.env`, or in Render's Environment tab).

| Variable | Description |
|---|---|
| **GOOGLE_SHEET_ID** | The sheet ID from the URL: `https://docs.google.com/spreadsheets/d/<GOOGLE_SHEET_ID>/edit` |
| **GOOGLE_SHEETS_CREDENTIALS_JSON** | **Either** paste the full contents of the downloaded JSON key here, **or** use the file path option below. |
| **GOOGLE_APPLICATION_CREDENTIALS** | **Or** the path to the JSON key file (e.g. `./keys/sheets-service-account.json`). Prefer `GOOGLE_SHEETS_CREDENTIALS_JSON` on Render so you don't need to store a file. |
| **GOOGLE_SHEETS_ENABLE_WRITE** | Set to `1` to allow pushing. Without it the app can only pull. |

Optional:

| Variable | Description |
|---|---|
| **GOOGLE_SHEET_WORKSHEET** | Tab name or 0-based index. Defaults to the first tab. |
| **GOOGLE_SHEETS_ALLOW_CLEAR** | Set to `1` to let the website blank a sheet cell when its own value is empty. Off by default. |
| **CRON_SECRET** | Required only for the scheduled sync endpoint below. |

---

## 4. Run a sync

**From the admin panel** (Admin → Google Sheet Sync):

| Button | What it does |
|---|---|
| **Check Setup** | Reports credentials, sheet reachability, which columns were found, and how many edits are waiting. Run this first. |
| **Pull From Sheet** | Sheet → website. |
| **Preview Push** | Shows exactly what a push would change without writing anything. |
| **Push To Sheet** | Website → sheet. |
| **Sync Both Ways** | Push, then pull. |

**From the API** (admin session required):

| Endpoint | Purpose |
|---|---|
| `GET /api/admin/google-sheet-status` | Configuration and column report |
| `POST /api/admin/sync-google-sheet` | Pull |
| `POST /api/admin/push-google-sheet` | Push. Body `{ "dry_run": true }` previews it. |
| `POST /api/admin/sync-google-sheet-two-way` | Push then pull |

All of them accept an optional `{ "sheet_id": "...", "worksheet": "Sheet1" }` body to override the
configured sheet or tab.

---

## 5. Automatic sync (optional)

`GET|POST /api/admin/sync-google-sheet-cron` runs a two-way sync without a login, authenticated by the
`X-Cron-Secret` header matching the `CRON_SECRET` env var. This is the same pattern the paycheck and
point-card cron jobs use (see `PAYCHECK_CRON.md`), so it works with the free cron-job.org service or a
Render Cron Job.

```
POST https://<your-app>/api/admin/sync-google-sheet-cron
X-Cron-Secret: <CRON_SECRET>
```

Hourly is a reasonable starting point. The sync is incremental — a push only sends students with
pending edits — so running it often is cheap.
