# Automatic Paycheck Generation (Cron)

Paychecks can run automatically every **Monday** for the previous **Monday–Friday** pay period.

---

## Free option: External cron + HTTP endpoint

Use a **free external cron service** (e.g. [cron-job.org](https://cron-job.org)) to call an HTTP endpoint on your app. No Render Cron (paid) needed.

### 1. Set `CRON_SECRET` in Render

1. **Render Dashboard** → your **Web Service** → **Environment**.
2. Add a variable:
   - **Key:** `CRON_SECRET`
   - **Value:** a long random string (e.g. generate one: `python -c "import secrets; print(secrets.token_urlsafe(32))"`).
3. Save. Redeploy so the new env var is picked up.

### 2. Create a free cron job on cron-job.org

1. **Sign up / log in**  
   Go to [cron-job.org](https://cron-job.org) and create an account (free), then log in.

2. **Create a new cron job**  
   Click **“Create cronjob”** (or **“Cronjobs”** → **“Create cronjob”**).

3. **Basic settings**
   - **Title:** e.g. `Paycheck generation`
   - **Address (URL):**  
     `https://YOUR-RENDER-URL.onrender.com/api/paycheck/generate-cron`  
     Replace `YOUR-RENDER-URL` with your actual Render service URL (e.g. `behavior-tracking-website-1`).

4. **Schedule**
   - **Execution schedule:** choose **“Regular schedule”** (or equivalent).
   - Set to run **every Monday**.
   - Pick a time (e.g. **09:00**).  
   - **Timezone:** use **UTC** if you’re unsure (or your local timezone).  
   - Example: *Every Monday at 09:00 UTC*.

5. **Request method**
   - Leave **Request method** as **GET** (default). No request body needed.

6. **Add the secret header**
   - Open **“Advanced”** or **“Request headers”** (or similar).
   - Add a **custom header**:
     - **Name:** `X-Cron-Secret`
     - **Value:** the **exact same** string you set for `CRON_SECRET` in Render.  
   - Save the header.

7. **Save the cron job**  
   Click **Save** or **Create**. The job will run on the schedule and call your app; the app verifies `X-Cron-Secret` and runs paycheck generation.

8. **Optional: test run**  
   Use **“Execute now”** / **“Trigger”** to run the job once. Check the response (or your app logs) to confirm it returns something like `{"message": "Generated X paychecks", ...}`.

### 3. Optional: trigger for a specific week

- **GET:** `https://your-app.onrender.com/api/paycheck/generate-cron?date=2025-02-03`  
  (use that Monday’s date).
- **POST** with `Content-Type: application/json` and body `{"date": "2025-02-03"}`.  
In both cases, send the `X-Cron-Secret` header.

### 4. Manual test

```bash
curl -H "X-Cron-Secret: YOUR_CRON_SECRET" "https://your-app.onrender.com/api/paycheck/generate-cron"
```

You should get JSON like `{"message": "Generated 0 paychecks", "count": 0, ...}` (or with `count > 0` if new paychecks were created).

---

## Alternative: Render Cron Job (paid)

Render Cron Jobs require a paid plan (~$1/month per cron job). If you use it:

1. **New** → **Cron Job** → connect same repo.
2. **Schedule:** `0 9 * * 1` (9:00 UTC Mondays).
3. **Command:** `python run_paycheck_cron.py`
4. Use the same **Environment Group** as your web service (so `DATABASE_URL` etc. are set).

No `CRON_SECRET` or HTTP endpoint needed; the cron runs the script directly.

---

## Manual run

- **HTTP:**  
  `curl -H "X-Cron-Secret: YOUR_CRON_SECRET" "https://your-app.onrender.com/api/paycheck/generate-cron"`
- **CLI (local or Render shell):**  
  `python run_paycheck_cron.py`  
  Or for a specific Monday:  
  `python run_paycheck_cron.py 2025-02-03`

---

## What it does

- Uses the **previous Monday–Friday** (or the Monday you pass via `date`).
- For each student, creates a paycheck if one doesn’t already exist for that period.
- Skips students who already have a paycheck for that week.
- Uses the same STAR % and citation logic as the **Generate Paychecks** button in the app.
