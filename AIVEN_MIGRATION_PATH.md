# Aiven PostgreSQL 17 — Step-by-step migration path

Follow these steps in order.

---

## Step 1: Get your Aiven connection URI

1. Go to [Aiven Console](https://console.aiven.io/) and sign in.
2. Open your **PostgreSQL 17** service.
3. Go to the **Overview** or **Connection** tab.
4. Copy the **Connection URI** (or build it from host, port, user, password).  
   It looks like:
   ```text
   postgresql://avnadmin:YOUR_PASSWORD@pg-xxxxx-xxxx.aivencloud.com:12345/defaultdb?sslmode=require
   ```
5. Replace `YOUR_PASSWORD` with the actual password (or use the one Aiven shows if you just reset it).

---

## Step 2: Set DATABASE_URL (and fix SSL on Windows if needed)

**Windows (PowerShell):**

```powershell
cd "c:\Users\manfo\OneDrive\Desktop\Cursor"
$env:DATABASE_URL = "postgresql://avnadmin:YOUR_PASSWORD@pg-xxxxx-xxxx.aivencloud.com:12345/defaultdb?sslmode=require"
```

**If you get "SSL error: certificate verify failed"** (common on Windows):

1. In Aiven Console → your PostgreSQL service → **Overview** (or Connection), find **CA Certificate** and click **Download**. Save the `.pem` file (e.g. to `C:\Users\manfo\aiven-ca.pem`).
2. Set the path so the app uses it:
   ```powershell
   $env:DB_SSL_ROOT_CERT = "C:\Users\manfo\aiven-ca.pem"
   ```
   Use the real path where you saved the file.

**Windows (Command Prompt):** Same as above, but use `set DATABASE_URL=...` and `set DB_SSL_ROOT_CERT=C:\path\to\aiven-ca.pem`.

---

## Step 3: Run the migration script

From the project root, with `DATABASE_URL` set:

**PowerShell:**

```powershell
python migrate_postgres.py
```

**Command Prompt:**

```cmd
python migrate_postgres.py
```

You should see output like:

- "Running database initialization..."
- "Database connection successful"
- "Database tables created/verified"
- "App schema migration done."
- "Marketplace migration completed."
- "Marketplace hidden rules migration completed."
- "PostgreSQL migration completed successfully."

If you see **"SSL error: certificate verify failed"**, go back to Step 2 and download Aiven’s CA certificate, then set **`DB_SSL_ROOT_CERT`** to the path to that `.pem` file and run Step 3 again. For other connection errors, check the URI (host, port, password) and that the Aiven service is running.

---

## Step 4: (Optional) Migrate existing data from another database

If you have data in another Postgres (e.g. Render):

1. From a machine that can reach the **old** database:
   ```bash
   pg_dump "OLD_DATABASE_URL" --no-owner --no-acl -F c -f backup.dump
   ```
2. Restore into Aiven (use the same URI you set in Step 2):
   ```bash
   pg_restore -d "YOUR_AIVEN_DATABASE_URL" --no-owner --no-acl backup.dump
   ```
3. Run the migration again so any missing columns/tables are added:
   ```powershell
   python migrate_postgres.py
   ```

If you don’t have another database, skip this step.

---

## Step 5: Run the app against Aiven

With `DATABASE_URL` still set to your Aiven URI:

```powershell
python app.py
```

Or start your production server (e.g. Gunicorn) with `DATABASE_URL` set in the environment. The app will use the Aiven database.

---

## Step 6: Production (e.g. Render) — path to use Aiven

Use this path so your app on Render (or another host) talks to your Aiven database.

### 6a. Open environment variables on Render

1. Go to **[Render Dashboard](https://dashboard.render.com/)** and sign in.
2. Click your **Web Service** (the app that runs `app.py` or Gunicorn).
3. In the left sidebar, click **Environment** (or **Environment Variables**).

### 6b. Set DATABASE_URL

1. In the Environment tab, find **`DATABASE_URL`** (if it exists from an old Render Postgres, you’ll replace it).
2. Click **Add Environment Variable** (or edit the existing one).
3. **Key:** `DATABASE_URL`
4. **Value:** Your **Aiven connection URI** from Step 1, for example:
   ```text
   postgres://avnadmin:AVNS_xxxxx@pg-xxxxx-xxxx.aivencloud.com:23771/defaultdb?sslmode=require
   ```
   Paste the full URI from Aiven (same one you used locally).
5. Save (e.g. **Save Changes**).

### 6c. (Only if you see SSL errors on Render) Set DB_SSL_ROOT_CERT

Render runs on Linux. Often **`sslmode=require`** is enough and you don’t need a CA file. If the app logs **“certificate verify failed”** on Render:

1. Download the **CA certificate** from Aiven (same as for Windows: Overview → CA Certificate → Download). You get a `.pem` file.
2. You must give the app a **path** to that file on Render. Two options:
   - **Option A — Commit the CA file (simplest):** Put `aiven-ca.pem` in your repo (e.g. project root). Commit and push. On Render, set:
     - **Key:** `DB_SSL_ROOT_CERT`  
     - **Value:** `aiven-ca.pem`  
     (or the path relative to the app’s working directory, e.g. `/opt/render/project/src/aiven-ca.pem` if Render runs from there; check Render’s docs for the run directory).
   - **Option B — Render Secret File:** In Render, create a **Secret File** that contains the CA contents and is mounted at a path (e.g. `/etc/secrets/aiven-ca.pem`). Then set:
     - **Key:** `DB_SSL_ROOT_CERT`  
     - **Value:** `/etc/secrets/aiven-ca.pem`
3. Save and redeploy.

If you never see an SSL error on Render, **skip this step**.

### 6d. Optional: DB_POOL_SIZE

If you have more than a few concurrent users, you can raise the connection pool:

- **Key:** `DB_POOL_SIZE`
- **Value:** `10` or `15` (default is 5)

Save.

### 6e. Redeploy

1. After changing environment variables, trigger a **Manual Deploy** (e.g. **Manual Deploy** → **Deploy latest commit**), or push a commit so Render auto-deploys.
2. When the deploy finishes, the app will use the Aiven database. Test login and a few main flows.

### 6f. Create admin on production (if needed)

If the production database was freshly migrated and has no users, create an admin once. Either:

- Call your one-time setup endpoint if you have one (e.g. `/api/init-default-users` with the right secret), or  
- From your **local machine** with the **same** Aiven `DATABASE_URL` and (if used) `DB_SSL_ROOT_CERT` set, run:
  ```powershell
  python create_admin.py
  ```
  That creates the admin in the same Aiven DB the production app uses.

---

## Quick reference

| Step | Action |
|------|--------|
| 1 | Get Aiven Connection URI from Aiven Console |
| 2 | Set `DATABASE_URL` locally (PowerShell or .env) |
| 3 | Run `python migrate_postgres.py` |
| 4 | (Optional) pg_dump / pg_restore from old DB, then run `migrate_postgres.py` again |
| 5 | Run `python app.py` (or your server) with `DATABASE_URL` set |
| 6 | On Render: set `DATABASE_URL` (and optional `DB_SSL_ROOT_CERT`, `DB_POOL_SIZE`), then redeploy |

Path: **1 → 2 → 3 → [4 if you have old data] → 5 → 6.**
