# Is Render Basic Postgres Enough for This App?

You asked about **Render Basic Postgres**: 256 MB RAM, 0.1 CPU, 5 GB storage.

Based on how your app uses the database, here’s when that plan is enough and when to upgrade.

---

## Your planned usage: 40 users every 30 minutes

**Verdict: 256 MB RAM + 0.1 CPU is not sufficient for 40 users inputting data every 30 minutes.**

When many of those 40 users submit or load pages around the same time (e.g. at the end of a period), the app needs enough DB connections and CPU to handle the burst. With only 5 connections (current default) and 0.1 CPU, you’d see request queuing, timeouts, and slow or failed submissions.

**Recommendation:** Use a **higher Render Postgres tier** (e.g. 512 MB–1 GB+ RAM and more CPU). Then set **`DB_POOL_SIZE=15`** (or `20`) in your **web service** environment on Render so the app can handle 40 concurrent users. **5 GB storage** is still fine unless you expect very large data growth.

---

## Minimum RAM and CPU for 40 users (every 30 min)

For your predicted usage (40 users inputting data every 30 minutes), the **lowest specs you can reasonably use** are:

| Resource | Minimum | Why |
|----------|---------|-----|
| **RAM**  | **512 MB** | Postgres needs memory per connection (~5–10 MB each). With a pool of 15–20 connections plus shared buffers and overhead, 256 MB is too tight; 512 MB gives enough headroom for connections and the cron job. |
| **CPU**  | **0.5 vCPU** (if available) or **1 vCPU** | 0.1 CPU can’t keep up with bursty traffic from 40 users. 0.5 vCPU is the practical minimum for this load; if Render only offers 1 vCPU in the next tier up, use that. |
| **Storage** | **5 GB** | Already enough for your current scale; no need to increase unless you expect much more data. |

**What to pick on Render:**  
In the Render dashboard, choose the **smallest instance** that meets the above: e.g. a **Basic** instance with **512 MB RAM** and **0.5 CPU** (or the next step up if 0.5 isn’t offered). Render’s flexible plans let you select compute and storage separately; 5 GB storage is fine. Then set **`DB_POOL_SIZE=15`** on your web service.

**If you want a bit of headroom** (fewer timeouts on peak, faster reports): use **1 GB RAM** and **1 vCPU** instead of the bare minimum. That’s still a modest tier and will handle 40 users more comfortably.

---

## What your app does with the database

- **~20 tables:** Students, daily/period records, marketplace, transactions, paychecks, schedules, users, etc.
- **Normal usage:** Login, CRUD on students/records, marketplace, accounts, schedules. Most queries are simple filters and single-row or small result sets.
- **Heavier usage:** A few report-style views load larger sets (e.g. all daily records for case-manager comparison, all students for dropdowns). One weekly cron job (`run_paycheck_cron.py`) runs paycheck generation.
- **Connection pool:** The app uses `DB_POOL_SIZE` (default **5** when unset). For 40 users you need a larger pool and a bigger Postgres instance.

---

## When the basic plan (256 MB, 0.1 CPU, 5 GB) is **enough**

- **Single school or small org** (e.g. dozens to low hundreds of students).
- **Low concurrency** (e.g. 5–10 staff using the app at once, not 40).
- **Moderate data size** (thousands to low tens of thousands of rows in the biggest tables; no huge file blobs in the DB).
- **5 GB storage** is plenty for that scale (students, daily records, transactions, marketplace) unless you store lots of large attachments or many years of dense data.

In that case, **256 MB RAM + 0.1 CPU + 5 GB is usually sufficient**. You may see slower response on the heaviest report pages (e.g. case manager comparison that loads all daily records); that’s acceptable for light use.

**Recommendation on the basic plan:** Use a **smaller connection pool** so the database isn’t starved for RAM. With 256 MB, Postgres has limited memory per connection. Reducing the app pool from 10 to **5** or **6** leaves headroom for the cron job and avoids connection/memory pressure. See “Connection pool” below.

---

## When you should **upgrade**

Consider a plan with **more RAM and CPU** (and same or more storage) if:

- **~40 users** inputting data every 30 minutes (or 10+ concurrent users regularly) — upgrade and set `DB_POOL_SIZE=15` or `20`.
- **Larger data** (hundreds of thousands of rows in daily_records or transactions) — reports and list pages can get slow on 0.1 CPU.
- **You see** connection errors, timeouts, or consistently slow pages (especially on reports and schedule/student list views).
- **Cron + web at same time** often causes timeouts or errors on the smallest instance.

Upgrading to the next Render Postgres tier (e.g. 512 MB–1 GB RAM, more CPU) will improve concurrency and report speed. Storage can stay at 5 GB unless you expect much more data.

---

## Connection pool

On a **256 MB** Postgres instance, the app defaults to **pool_size 5** so the database isn’t starved for RAM (the cron job and admin connections need headroom too).

**What the app does:**  
When using Postgres (`DATABASE_URL` set), the app defaults to **pool_size 5** (good for tiny instances and light traffic). For **40 users**, use a **larger Postgres instance** and set **`DB_POOL_SIZE=15`** (or `20`) in your **web service** environment on Render. Do not set a high pool on a 256 MB instance—it has limited connections and memory.

---

## Summary

| Use case | Basic (256 MB, 0.1 CPU, 5 GB) | Upgrade (e.g. 512 MB–1 GB+, more CPU) |
|----------|-------------------------------|---------------------------------------|
| 5–10 concurrent users, moderate data | **OK** — default pool 5. | Optional. |
| **40 users inputting data every 30 min** | **No** — timeouts and queuing likely. | **Yes** — set `DB_POOL_SIZE=15` or `20`. |
| 5 GB storage | Enough for typical use. | Same; increase only if needed. |

For 40 users every 30 minutes, start on an upgraded Postgres tier and set `DB_POOL_SIZE=15` (or `20`) on the web service.
