# Google Sheets sync (students)

The app can sync **students** from a Google Sheet into the database. When you run the sync, rows in the sheet create or update `Student` records. No need to share the sheet with the app first—you set it up once with credentials and sheet ID, then trigger sync when you want.

---

## 1. Create a Google Sheet

- Create a sheet with a **header row** in the first row.
- Use these column names (any casing; spaces allowed):

| Column       | Required | Description |
|-------------|----------|-------------|
| **Name**    | Yes      | Student full name |
| **Email**   | No       | Email address |
| **Grade**   | No       | Grade level (e.g. 9, 10, K) |
| **Card Color** | No    | e.g. yellow, green, blue |
| **Lunch Number** | No  | Unique ID used to match rows to existing students (updates) or leave blank for new |

- **Lunch Number** is the “key”: same Lunch Number = update that student; new Lunch Number or blank = create new student (if Name is present).
- Add one row per student below the header. Empty rows are skipped.

---

## 2. Google Cloud setup (one-time)

1. Go to [Google Cloud Console](https://console.cloud.google.com/).
2. Create a project (or pick an existing one).
3. **Enable the Google Sheets API**: APIs & Services → Enable APIs and Services → search “Google Sheets API” → Enable.
4. **Create a service account**: APIs & Services → Credentials → Create Credentials → Service account. Give it a name and finish.
5. Open the new service account → **Keys** → Add key → Create new key → **JSON**. Download the JSON file.
6. **Share your Google Sheet** with the service account email (e.g. `something@your-project.iam.gserviceaccount.com`) as Viewer so the app can read the sheet.

---

## 3. Configure the app

Set these in your environment (locally in a `.env` or in Render’s Environment tab).

| Variable | Description |
|----------|-------------|
| **GOOGLE_SHEET_ID** | The sheet ID from the URL: `https://docs.google.com/spreadsheets/d/<GOOGLE_SHEET_ID>/edit` |
| **GOOGLE_SHEETS_CREDENTIALS_JSON** | **Either** paste the full contents of the downloaded JSON key here, **or** use the file path option below. |
| **GOOGLE_APPLICATION_CREDENTIALS** | **Or** set this to the path of the JSON key file (e.g. `./keys/sheets-service-account.json`). Prefer `GOOGLE_SHEETS_CREDENTIALS_JSON` on Render so you don’t need to store a file. |

Optional:

| Variable | Description |
|----------|-------------|
| **GOOGLE_SHEET_WORKSHEET** | Sheet/tab name or 0-based index. If not set, the first tab is used. |

---

## 4. Run the sync

- **From the app**: Only **admins** can trigger sync.
  - **API**: `POST /api/admin/sync-google-sheet`
  - Optional JSON body: `{ "sheet_id": "...", "worksheet": "Sheet1" }` to override env sheet or tab.
- **Response**: `{ "created": 5, "updated": 10, "errors": [] }` (or a list of error messages).

So: **you don’t need to have the sheet “available” to the developer**—you create the sheet, set the env vars, and the app (running locally or on Render) will read and sync using the service account.

---

## 5. Automatic sync (optional)

Right now sync runs only when an admin calls the API. To update the website “when the spreadsheet updates” automatically you can:

- **Render**: Add a **Cron Job** or **Background Worker** that hits `POST /api/admin/sync-google-sheet` on a schedule (e.g. every hour), or use an internal endpoint protected by a secret header/token.
- **Manual**: Use the same endpoint from the admin UI or a script whenever you’ve updated the sheet.

If you want, we can add a “Sync from Google Sheet” button in the admin UI that calls this endpoint.
