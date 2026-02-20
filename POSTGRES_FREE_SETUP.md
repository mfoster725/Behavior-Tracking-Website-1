# Free PostgreSQL Database Setup (Post–Render Trial)

Your app already uses `DATABASE_URL` and supports `postgresql://` with SSL. You only need to create a free database and set the new URL.

---

## Free forever (no time limit)

These free tiers **do not expire**—no 30-day or 90-day trial.

| Provider   | Free storage | Notes |
|------------|--------------|--------|
| **Aiven**  | **1 GB**     | [aiven.io/free-postgresql-database](https://aiven.io/free-postgresql-database) – 1 CPU, 1 GB RAM, no credit card. True Postgres. **Best choice if you want the most permanent free storage.** |
| **Neon**   | 0.5 GB       | [console.neon.tech/signup](https://console.neon.tech/signup) – No credit card, scale-to-zero when idle. Easiest setup. See steps below. |
| **Supabase** | 500 MB     | [supabase.com](https://supabase.com) – Free tier has no expiration, but **projects pause after 7 days of inactivity** (you can unpause). |

**Recommendation:** For a free database with **no time limit**, use **Aiven** (1 GB) or **Neon** (0.5 GB). Both work with your app’s `DATABASE_URL` and SSL.

### Quick setup: Aiven (1 GB, no expiration)

1. Go to **[https://aiven.io/free-postgresql-database](https://aiven.io/free-postgresql-database)** and sign up (no credit card).
2. Create a **PostgreSQL** service on the **free** plan (PostgreSQL 17 is available); pick a cloud region.
3. When the service is ready, open it and copy the **Connection URI** from the overview or **Connection** tab (e.g. `postgresql://avnadmin:PASSWORD@pg-xxx.aivencloud.com:PORT/defaultdb?sslmode=require`).
4. Set `DATABASE_URL` to that URI locally and on your host (e.g. Render). Your app will add `sslmode=require` if the URI does not already include it.
5. **Migrate the database** (create all tables and run migrations):
   ```bash
   set DATABASE_URL=postgresql://avnadmin:PASSWORD@pg-xxx.aivencloud.com:PORT/defaultdb?sslmode=require
   python migrate_postgres.py
   ```
   This runs schema creation and all migrations (marketplace, hidden rules, etc.). Alternatively, starting the app once (`python app.py`) also creates tables on first run.
6. If you are moving from another database (e.g. Render), export/import data (e.g. `pg_dump` / `pg_restore`) or use your app’s export/import, then run `migrate_postgres.py` against the new `DATABASE_URL`.

### Quick setup: Neon (0.5 GB, no expiration)

See the **Easiest setup: Neon** section below for full steps.

---

## CockroachDB Serverless (10 GiB) — *30-day trial*

- **Free tier:** **10 GiB storage** and 50M Request Units per month, but the free offer is a **30-day trial**; after that you may need to add billing or switch.  
- Postgres wire–compatible: use a standard `postgresql://` connection string.  
- **Caveat:** Different engine; test your app after migrating. See [COCKROACHDB_SETUP.md](COCKROACHDB_SETUP.md) for setup steps.

### Steps

1. **Sign up**  
   Go to **[https://cockroachlabs.cloud/signup](https://cockroachlabs.cloud/signup)** and create an account (no credit card required for one free cluster).

2. **Create a Serverless cluster**  
   In the console, create a **Serverless** cluster, choose a region, and create it. You get one free cluster without billing info.

3. **Get the connection string**  
   After the cluster is ready, open it and go to **Connection info**. Copy the connection string (e.g. `postgresql://user:password@xxx.cockroachlabs.cloud:26257/defaultdb?sslmode=verify-full`).  
   Your app adds `sslmode` if missing; CockroachDB often uses `sslmode=verify-full`—if you have connection issues, try appending `&sslmode=require` or using the “General” connection string they provide.

4. **Use it in your app**  
   Set `DATABASE_URL` to that connection string (locally and on Render). Your app will convert it to `postgresql+psycopg://` automatically.

5. **Migrate and test**  
   Use `pg_dump` / `pg_restore` or your app’s export/import from Render, then run migrations. Run through your app’s main flows to confirm compatibility.

---

## Easiest setup: Neon (no credit card, 0.5 GB)

- **Free tier:** 0.5 GB storage per project, ~100 compute hours/month, no credit card  
- **No credit card** for signup  
- **URL format:** Works with your app as-is (SSL supported)

### Steps

1. **Sign up**  
   Go to **[https://console.neon.tech/signup](https://console.neon.tech/signup)** and sign up (email, GitHub, or Google).

2. **Create a project**  
   After login, create a project and pick a region. A default branch and database are created.

3. **Get the connection string**  
   - On the project dashboard, click **Connect**.  
   - Choose branch (e.g. `main`), database, and role.  
   - Copy the connection string. It looks like:
     ```text
     postgresql://USER:PASSWORD@ep-xxx-pooler.REGION.aws.neon.tech/neondb?sslmode=require
     ```
   - Prefer the **pooled** connection (hostname contains `-pooler`) for better concurrency.

4. **Use it in your app**  
   - **Local:** Set in your environment or `.env`:
     ```bash
     DATABASE_URL=postgresql://USER:PASSWORD@ep-xxx-pooler.REGION.aws.neon.tech/neondb?sslmode=require
     ```
   - **Render (or other host):** In the service’s **Environment** tab, set `DATABASE_URL` to this same value (or replace the existing one).

5. **Migrate data from Render (if needed)**  
   - **Option A – pg_dump from Render:**  
     From a machine that can reach Render’s DB, run:
     ```bash
     pg_dump "YOUR_CURRENT_RENDER_DATABASE_URL" --no-owner --no-acl -F c -f backup.dump
     pg_restore -d "YOUR_NEW_NEON_DATABASE_URL" --no-owner --no-acl backup.dump
     ```
     Use your actual Render and Neon URLs.  
   - **Option B – App-level:** If you have export/import or seed scripts in the repo, run them against the new `DATABASE_URL` after switching.

6. **Run migrations**  
   If you use migrations (e.g. `migrate_marketplace.py`), run them with the new `DATABASE_URL` set.

---

## Other free options

| Provider       | Free storage | Time limit | Notes |
|----------------|--------------|------------|--------|
| **Aiven**      | **1 GB**     | None       | True Postgres, 1 CPU, 1 GB RAM. [aiven.io](https://aiven.io) |
| **Neon**       | 0.5 GB       | None       | Easiest, scale-to-zero. [neon.tech](https://neon.tech) |
| **Supabase**   | 500 MB       | None*      | *Pauses after 7 days inactive. [supabase.com](https://supabase.com) |
| **CockroachDB**| 10 GiB       | **30-day trial** | Postgres-compatible. [cockroachlabs.com](https://www.cockroachlabs.com) |
| **Koyeb**      | (varies)     | Check plan | DB can sleep after 5 min. [koyeb.com](https://www.koyeb.com) |

Use the same idea: create a Postgres instance, get a `postgresql://...` connection string, set `DATABASE_URL`, then migrate data and run migrations.

---

## Your app compatibility

- `app.py` (and scripts like `migrate_marketplace.py`, `migrate_postgres.py`) already:
  - Read `DATABASE_URL`.
  - Convert `postgres://` or `postgresql://` to `postgresql+psycopg://` for SQLAlchemy (psycopg3).
  - Add `sslmode=require` if missing (Aiven and Neon often include it; both work).

No code changes are required for Aiven; set `DATABASE_URL` and run `python migrate_postgres.py` to migrate.

---

## Checklist

- [ ] Create free Postgres (e.g. Neon) and copy connection string  
- [ ] Set `DATABASE_URL` locally and/or on Render  
- [ ] Export data from Render DB (if needed)  
- [ ] Import/restore into new DB (or run app seeds)  
- [ ] Run any migrations with new `DATABASE_URL`  
- [ ] Test the app against the new database  
- [ ] Remove or stop using the old Render database when done  
