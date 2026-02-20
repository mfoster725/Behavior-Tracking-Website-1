# CockroachDB Serverless Setup Guide

Step-by-step setup for a **free** CockroachDB Serverless database (10 GiB storage, 50M Request Units/month). Your Flask app already supports `DATABASE_URL` with `postgresql://` and SSL—no code changes needed.

---

## 1. Sign up

1. Go to **https://cockroachlabs.cloud/signup** (or **https://cockroachlabs.com/lp/serverless**).
2. Sign up with **Google**, **GitHub**, or **email**. No credit card required for one free cluster.
3. Log in to the **CockroachDB Cloud Console**.

---

## 2. Create a Serverless cluster

1. On the **Overview** page, click **Create cluster** (or **Create Cluster**).
2. **Select plan:** Choose **Serverless** → Continue.
3. **Cloud & region:**
   - Pick **AWS** or **GCP** (no account with them required).
   - Choose a **region** (e.g. same as your Render app for lower latency).
4. **Cluster name:** Keep the default or enter a name (e.g. `my-app-db`).
5. Click **Create cluster**. The cluster is usually ready in **20–30 seconds**.

---

## 3. Get your connection string

1. When the cluster is ready, open it from the **Clusters** list.
2. Open the **Connection** / **Connect** tab (or **Connection info**).
3. You’ll see connection options. For your Flask app you want a **connection string** (URI).
4. **Copy the connection string.** It will look like one of these:

   **With username/password in URL:**
   ```text
   postgresql://USERNAME:PASSWORD@HOST:26257/defaultdb?sslmode=verify-full
   ```

   **Or with a connection parameters form:**  
   If they show **Host**, **Port**, **User**, **Password**, and **Database** separately, build the URL like this (replace placeholders):

   ```text
   postgresql://USER:PASSWORD@HOST:26257/defaultdb?sslmode=verify-full
   ```

5. **If your app can’t connect:** Some clients have trouble with `sslmode=verify-full`. Try changing the query to `sslmode=require`:

   ```text
   postgresql://USER:PASSWORD@HOST:26257/defaultdb?sslmode=require
   ```

   Your `app.py` already adds `sslmode=require` if no `sslmode` is present, so you can also try the URL without any `?sslmode=...` and let the app add it.

6. **Save the password** somewhere safe; you may not be able to see it again in the console. If you lose it, create a new SQL user and use that user’s credentials in the URL.

---

## 4. Use it in your app

Your app reads `DATABASE_URL` and converts `postgres://` / `postgresql://` to `postgresql+psycopg://` for SQLAlchemy. You only need to set the variable.

### Local (Windows PowerShell)

```powershell
$env:DATABASE_URL = "postgresql://USER:PASSWORD@HOST:26257/defaultdb?sslmode=require"
```

Or in a `.env` file in the project root (if you use something like `python-dotenv`):

```env
DATABASE_URL=postgresql://USER:PASSWORD@HOST:26257/defaultdb?sslmode=require
```

### On Render

1. Open your **Web Service** (or the service that runs the app).
2. Go to **Environment**.
3. Add or edit **DATABASE_URL** and paste the full connection string.
4. Save. Render will redeploy with the new value.

---

## 5. Run migrations

If you use migration scripts (e.g. `migrate_marketplace.py`), run them with `DATABASE_URL` set to the CockroachDB URL:

```powershell
$env:DATABASE_URL = "postgresql://USER:PASSWORD@HOST:26257/defaultdb?sslmode=require"
python migrate_marketplace.py
```

(Or set `DATABASE_URL` in your shell/profile and run the script.)

---

## 6. Migrate data from Render (optional)

If you have data in a Render Postgres database:

1. **Export from Render** (from a machine that can reach Render’s DB):

   ```bash
   pg_dump "YOUR_RENDER_DATABASE_URL" --no-owner --no-acl -F c -f backup.dump
   ```

2. **Restore into CockroachDB:**

   ```bash
   pg_restore -d "YOUR_COCKROACHDB_DATABASE_URL" --no-owner --no-acl backup.dump
   ```

   Replace both URLs with your actual connection strings. If `pg_restore` reports errors about unsupported features, you may need to exclude certain objects or use SQL dump instead:

   ```bash
   pg_dump "YOUR_RENDER_DATABASE_URL" --no-owner --no-acl > backup.sql
   ```

   Then run the SQL file against CockroachDB (e.g. with `psql` or your app’s migration path). CockroachDB is Postgres-compatible but not 100% identical; some advanced features may need adjustment.

---

## 7. Test the app

1. Start the app locally with `DATABASE_URL` pointing at CockroachDB.
2. Log in, create/edit records, and run the main flows.
3. Deploy to Render with the new `DATABASE_URL` and test again.

If you see SQL or compatibility errors, check [CockroachDB’s SQL support](https://www.cockroachlabs.com/docs/stable/sql-feature-support) and adjust queries or migrations as needed.

---

## Quick reference

| Step            | Action |
|-----------------|--------|
| Sign up         | [cockroachlabs.cloud/signup](https://cockroachlabs.cloud/signup) |
| Create cluster  | Console → Create cluster → Serverless → choose cloud/region → Create |
| Connection URL  | Cluster → Connect / Connection info → copy URI, use `sslmode=require` if needed |
| In app          | Set `DATABASE_URL` (env or `.env`) to that URI |
| Migrations      | Run your migration script with same `DATABASE_URL` |
| Data migration  | `pg_dump` from Render → `pg_restore` or SQL import into CockroachDB |

---

## Troubleshooting

- **“SSL connection required”**  
  Add `?sslmode=require` to the connection string (or ensure your app adds it).

- **“password authentication failed”**  
  Double-check user and password; create a new SQL user in the console if needed and update the URL.

- **SQL errors after migration**  
  CockroachDB doesn’t support every Postgres feature. Check the [SQL feature support](https://www.cockroachlabs.com/docs/stable/sql-feature-support) page and adapt schema or queries.

- **Connection timeouts**  
  Confirm the host and port (usually `26257`) and that your firewall allows outbound HTTPS (CockroachDB uses TLS). Serverless does not use IP allowlists.
