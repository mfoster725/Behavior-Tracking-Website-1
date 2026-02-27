## Summary & Frenzy Stats Logic

This document explains how the **Summary** and **Frenzy Stats** pages work: what data they use, how the data is collected, how it is displayed, and how the calculations are performed in the current implementation.

---

## 1. Shared Foundations

- **Backend endpoints**
  - Summary data: `/api/summary` (`summary()` in `app.py`)
  - Frenzy stats data: `/api/frenzy-stats` (`frenzy_stats()` in `app.py`)
- **Core data model**
  - `DailyRecord`
    - One per student per date (for days with data).
    - Holds overall attendance/status, date, `day_of_week`, and links to per-period records.
  - `PeriodRecord` (accessed via `record.periods`)
    - Per period, per day, per student.
    - STAR points:
      - `safety_points`
      - `teamwork_points`
      - `accountability_points`
      - `relationships_points`
      - `points_possible` (normally `4` per period; used to infer number of periods).
    - Additional flags/data:
      - `reset` (boolean)
      - `frenzy` (boolean – quick flag that a frenzy occurred in that period)
      - `notes`, `reminders`
      - `location` (used as “class” in reports)
      - `info` (JSON-encoded extra metadata; used for infractions/reminders/resets/frenzies).
    - Relationships:
      - `infractions` (list of `Infraction` records associated to the period).
  - `FrenzyEvent` (separate table for detailed frenzy events)
    - Linked to `DailyRecord` via `daily_record_id`.
    - Per frenzy event:
      - `time_range`
      - `location`
      - `purpose`
      - `purpose2`
      - `duration_minutes`
      - `result`

- **Role-based access**
  - All stats endpoints are behind authentication (`@login_required`) and rate-limited.
  - **Students**
    - Can only see their own data (backend filters by `current_user.student_id`).
  - **Staff / Admin**
    - Can see all students, with optional filters:
      - Specific `student_id`
      - “Managed by me” (filters to students where the current user is a `TeamMember`).
  - **Outside staff**
    - Limited to assigned students only; if no assigned students, endpoints return empty stats structures.

- **Attendance filtering**
  - Both endpoints:
    - Load all applicable `DailyRecord`s.
    - For each record:
      - If `attendance_status` is missing, it is migrated from old `present` boolean:
        - present → `attendance_status = 'present'`
        - not present → `attendance_status = 'unexcused'`
      - Records with `attendance_status == 'excused'` are **excluded** from all calculations.

- **Timeframe and period selection**
  - Frontend sends either:
    - A **period** (predefined named range, e.g. `weekly`, `30day`, `current_year`, `quarter1`, etc.), **or**
    - A **timeframe** for comparisons (`30day_to_30day`, `month`, `quarter`, `year`, `alltime`).
  - If `period` is provided, `timeframe` is ignored; if neither is provided, backend defaults to `timeframe = 'alltime'`.
  - Quarter and school year boundaries:
    - Frontend passes `quarter_dates` and `school_year_dates` (JSON), which default on the backend to:
      - Quarters:
        - Q1: Aug 1 – Oct 31
        - Q2: Nov 1 – Jan 31
        - Q3: Feb 1 – Apr 30
        - Q4: May 1 – Jul 31
      - School year: Aug 1 – Jul 31.
    - Helper functions map each record date to:
      - A **quarter number** (1–4) using those ranges.
      - A **school year label** like `"2025-2026"` (Aug–Jul).

---

## 2. Summary Page

### 2.1 What data we are looking at

- **Source tables**
  - `DailyRecord`
  - `PeriodRecord` (via `DailyRecord.periods`)
  - `Infraction` (via `PeriodRecord.infractions`)
- **Key fields/metrics**
  - STAR points:
    - Safety (S)
    - Teamwork (T)
    - Accountability (A)
    - Relationships (R)
  - `points_possible` per period.
  - `period.frenzy` flag.
  - Infractions:
    - From `period.infractions` (typed infractions with counts).
    - From `period.info` JSON:
      - `infraction1`, `infraction1Count`
      - `infraction2`, `infraction2Count`
      - `infractions` array of `{ type, count }`.
  - Reminders and resets (from `info` JSON):
    - `reminder1`, `reminder2`, `reminder3`
    - `reset`
  - Day-of-week and class-based breakdowns:
    - Day of week from `DailyRecord.day_of_week` (Monday–Friday only).
    - Class from `PeriodRecord.location` (or `"Unknown"`).

### 2.2 What data we are collecting (internally for summary)

For the selected student set and timeframe, the backend aggregates:

- **Global totals across all included periods**
  - `total_safety`, `total_teamwork`, `total_accountability`, `total_relationships`.
  - `total_possible` (sum of `points_possible` across all periods).
  - `total_frenzies` (count of periods where `period.frenzy == True`).
  - `total_infractions` (by infraction type) from:
    - Formal `period.infractions`.
    - Inline infractions in `period.info` (`infraction1/2`, `infractions` array).
  - `additional_info`:
    - `infractions` (same by-type totals, exposed separately in API).
    - `total_reminders` (all reminders found in `info`).
    - `total_resets` (reset flags found in `info`).

- **By day of week (weekdays only)**
  - For each weekday:
    - `total_days` (number of `DailyRecord`s on that weekday).
    - Raw STAR points:
      - `safety_points`, `teamwork_points`, `accountability_points`, `relationships_points`.
      - `possible_points` (sum of `points_possible`).
    - `infractions` by type (from both `period.infractions` and `info`).
    - `total_reminders`, `total_resets` (from `info`).

- **By class (period location)**
  - For each class name (from `period.location` or `"Unknown"`):
    - `total_days`:
      - Number of unique days where that class appears (tracked via a set of unique dates per class).
    - Raw STAR points:
      - `safety_points`, `teamwork_points`, `accountability_points`, `relationships_points`.
      - `possible_points`.
    - `infractions` by type.
    - `total_reminders`, `total_resets`.

These collected metrics are packaged into:

- A top-level summary (totals and averages/percentages).
- `by_day_of_week` breakdown.
- `by_class` breakdown.
- For comparison timeframes, a `periods` object keyed by period label (e.g. `"2025-2026"`, `"Q1 25"`, `"Jan 25"`) where each value is a summary struct computed via the same `calculate_summary_stats` helper.

### 2.3 How we are calculating the summary data

All percentage calculations use the same core idea: compute how many periods are represented and then what fraction of the maximum STAR points were earned.

- **Number of periods**
  - `num_periods` is inferred from points:
    - `num_periods = total_possible / 4` (since each period contributes 4 possible total points – one per STAR category *per side of the scale*).
  - Each category’s max possible points across all periods:
    - `max_per_category = num_periods * 2`
    - (each category seems to be scored out of 2 per period).

- **Overall STAR percentages (global)**
  - For each category:
    - `safety_percent = (total_safety / max_per_category) * 100`
    - `teamwork_percent = (total_teamwork / max_per_category) * 100`
    - `accountability_percent = (total_accountability / max_per_category) * 100`
    - `relationships_percent = (total_relationships / max_per_category) * 100`
  - Overall average:
    - `overall_percent = (safety_percent + teamwork_percent + accountability_percent + relationships_percent) / 4`
  - These values are rounded on the backend and/or formatted on the frontend (often to one decimal place, then shown with a `%` symbol).

- **Day-of-week percentages**
  - For each weekday:
    - `num_periods_day = possible_points_day / 4`
    - `max_per_category_day = num_periods_day * 2`
    - Category percentages computed the same way as global, but per day.
    - Overall day-of-week average is again the mean of the four category percentages.
  - Total infractions per day = sum of infraction counts for that day.
  - These are exposed in `by_day_of_week[day]['percentages']` and related fields.

- **Class-level stats**
  - Similar structure to day-of-week but grouped by `class_name` instead of day.
  - Uses:
    - Number of unique days where the class appears.
    - Per-class STAR point totals.
    - Per-class infractions/reminders/resets.
  - These are used in class-based summary tables and graphs.

- **Timeframe logic**
  - For a **single-period summary** (e.g. `period='30day'`, `period='current_year'`, `timeframe='30day'`, or `timeframe='alltime'`):
    - The backend filters `all_records` down to the appropriate subset based on dates (last 7 days, last 30 unique school days, selected quarter, year, or school year(s)).
    - Runs `calculate_summary_stats` once on that filtered list.
    - Returns a single summary struct with:
      - `total_days`
      - `averages` (STAR percentages)
      - `percentages` and additional derived fields (infractions, reminders, resets, etc.).
  - For a **comparison timeframe** (`30day_to_30day`, `month`, `quarter`, `year`):
    - The backend splits the filtered records into logical groups:
      - `30day_to_30day`: two 30-day windows (most recent 30 days vs prior 30 days).
      - `month`: grouped by `"Month YY"` within the selected school year.
      - `quarter`: grouped by `"Qn YY"` using `quarter_ranges` and school year mapping.
      - `year`: grouped by school year labels.
    - For each group, `calculate_summary_stats` is called and its result is stored in `periods[group_label]`.
    - Additional metadata per period:
      - `available_data_points` (how many days or unique dates are included, esp. for 30-day windows).
      - `has_full_30_days` flags for 30-day-based comparisons.

### 2.4 How we are displaying the summary data

**Frontend view:** `Summary` tab (`#summary-view` in `templates/index.html`) and `loadSummary()` in `static/app.js`.

- **Inputs / controls**
  - Student dropdown: `#summary-student-select`
    - Options include “All Students” plus individual students.
    - Staff/Admin also have a `#summary-managed-by-me-checkbox` to limit data to their caseload.
  - Timeframe selection:
    - `#summary-period-select` for single-period reports (weekly, 30 day, specific quarter, current year, all time, previous years).
    - `#quarter-select` for comparison timeframes (`30day_to_30day`, `month`, `quarter`, `year`, `alltime`).
  - Actions:
    - `#load-summary-btn` → triggers `loadSummary()` and fetches `/api/summary`.
    - `#print-summary-btn` (initially disabled) → enabled once data is loaded; passes stored data to PDF generation.
    - `#compare-case-managers-btn` → uses the same summary endpoint data to show case-manager comparison.
    - `#show-point-card-btn` → toggles raw point-card data view (hidden by default).

- **Data fetching and wiring**
  - `loadSummary()` builds the query string:
    - Adds `period` or `timeframe` (plus `school_year` if needed).
    - Adds `student_id` if a student is selected.
    - Adds `managed_by_me=true` if that checkbox is checked.
    - Adds JSON-encoded `quarter_dates` and `school_year_dates`.
  - On success:
    - Saves the response in `window.currentSummaryData` for reuse (PDFs, graphs).
    - Enables the Print button.
    - Renders HTML into `#summary-results` based on whether `comparison_mode` is `true` and whether a `periods` object is present.

- **Rendering modes**
  - **Comparison mode** (`data.comparison_mode == true` and `data.periods` exists):
    - Builds a multi-column comparison table where:
      - Each **row** is a metric (Total Days, Infractions, Reminders, Resets, STAR percentages, etc.).
      - Each **column** is a timeframe/period label (e.g. `Q1 25`, `Q2 25`).
    - Key sections include:
      - Data points / total days per period.
      - Total infractions and “View Details” buttons (which open an infractions summary modal).
      - Total reminders and resets.
      - STAR percentages table (S, T, A, R, Overall).
      - Day-of-week statistics table:
        - Two-row header with timeframe labels and day-of-week subheaders.
        - Cell values show overall percentage or derived stats per weekday and timeframe.
    - Adds “Graph” buttons (e.g. `showSectionGraph('summary_comparison_main', 'summary')`) which:
      - Use Chart.js to visualize:
        - Main metrics (STAR percentages, totals).
        - Day-of-week distributions.
        - Class-based and other breakdowns, depending on section type.
  - **Single-summary mode** (`comparison_mode == false`):
    - Renders a card-style summary:
      - Title: `Summary - <Timeframe Label>`.
      - `Total Days`.
      - Data points info for 30-day windows (e.g. 27/30 vs full 30/30).
      - STAR Averages section with a table:
        - S, T, A, R, Overall percentages.
        - “Graph” button for these metrics.
      - Additional info section:
        - Total infractions and “View Sorted Summary” button.
        - Total reminders and resets.
      - Day-of-week table for the single summary:
        - Same structure as comparison but for one timeframe.
      - Class-based table (uses `by_class` data).
    - Section-graph modal also supports single-summary charts (`source: 'summary'`).

---

## 3. Frenzy Stats Page

### 3.1 What data we are looking at

- **Source tables**
  - `DailyRecord`
  - `FrenzyEvent` (via `record.frenzies`)
  - `PeriodRecord` (via `record.periods`, for Info-based frenzy metadata and potential older data).
- **Key fields/metrics**
  - From `FrenzyEvent`:
    - `time_range`
    - `location`
    - `purpose`
    - `purpose2`
    - `duration_minutes`
    - `result`
  - From `PeriodRecord.info` JSON (for legacy or supplemental frenzy tracking):
    - `frenzy` flag (bool-like, checked against several truthy textual representations).
    - `duration` (minutes, parsed as integer where possible).

### 3.2 What data we are collecting (internally for frenzy stats)

The `calculate_frenzy_stats(record_list)` helper builds a summary struct with:

- **Top-level aggregates**
  - `total_count` – total number of frenzy events.
  - `total_duration` – sum of all frenzy durations in minutes.
  - `avg_duration` – average duration per frenzy event (`total_duration / total_count` when `total_count > 0`).

- **Grouped breakdowns**
  - `by_day` (weekdays only; Monday–Friday):
    - For each day:
      - `count` – number of frenzies occurring on that weekday.
      - `duration` – total duration of frenzies on that weekday.
      - (For some views, average duration can be derived or added.)
  - `by_time`:
    - Grouped by `time_range` (e.g. `"7:45-8:30"`), defaulting to `"Unknown"` if missing.
    - Each bucket holds:
      - `count`
      - `duration`.
  - `by_location`:
    - Grouped by `location` (or `"Unknown"` if missing).
    - Each bucket holds:
      - `count`
      - `duration`.
  - `by_purpose`:
    - Grouped by `purpose` (or `"Unknown"`).
    - Each bucket holds:
      - `count`
      - `duration`.

- **Distinct lists**
  - `all_purposes`:
    - Collects all non-empty `purpose` and `purpose2` strings (trimmed) across all events.
  - `all_results`:
    - Collects all non-empty `result` strings (trimmed).

- **Additional frenzy data from `PeriodRecord.info`**
  - For each `record.periods` entry:
    - If `period.info` parses as JSON and contains a `frenzy` value that is truthy (not `False`, `''`, `'false'`, `'0'`, etc.):
      - `total_count` is incremented by 1.
      - `duration`:
        - Attempts to parse `info_data['duration']` as an int; if successful, added to `total_duration`.
      - These Info-based frenzies do **not** currently contribute to `by_day`, `by_time`, `by_location`, or `by_purpose` (unless additional fields are added), but they are counted in top-level aggregates and 30-day availability metadata where appropriate.

- **Timeframe / comparison structures**
  - For a single timeframe, `calculate_frenzy_stats` is run once on the filtered `all_records`.
  - For comparison modes (30-day windows, month-to-month, quarter-to-quarter, year-to-year), it is run once per period group, resulting in:
    - `periods[period_label] = { by_day, by_time, by_location, by_purpose, total_count, total_duration, avg_duration, ... }`
  - For 30-day-based views:
    - `available_data_points` – number of days contributing data.
    - `has_full_30_days` – whether the period has at least 30 unique days of data.

### 3.3 How we are calculating the frenzy stats

- **Total and average duration**
  - For each `FrenzyEvent` in `record.frenzies`:
    - Increment `total_count` by 1.
    - Add `duration_minutes` (or 0 if missing) to `total_duration`.
  - After processing all records/events:
    - `avg_duration = total_duration / total_count` (handled safely to avoid divide-by-zero).

- **By-day (weekday) metrics**
  - For each frenzy event:
    - Determine `day = record.day_of_week`.
    - If `day` is in `[Monday, Tuesday, Wednesday, Thursday, Friday]`:
      - Initialize `stats['by_day'][day]` if needed.
      - Increment:
        - `count` by 1.
        - `duration` by `duration_minutes` (or 0).

- **By-time, by-location, by-purpose**
  - For each frenzy event:
    - Time:
      - `time_range = frenzy.time_range or 'Unknown'`.
      - Increment `stats['by_time'][time_range].count` and `.duration`.
    - Location:
      - `location = frenzy.location or 'Unknown'`.
      - Increment `stats['by_location'][location].count` and `.duration`.
    - Purpose:
      - `purpose = frenzy.purpose or 'Unknown'`.
      - Increment `stats['by_purpose'][purpose].count` and `.duration`.
    - Distinct lists:
      - If `frenzy.purpose` is non-empty, append to `all_purposes`.
      - If `frenzy.purpose2` is non-empty, append to `all_purposes`.
      - If `frenzy.result` is non-empty, append to `all_results`.

- **Timeframe logic**
  - Mirrors the summary endpoint logic:
    - Filters `DailyRecord`s by:
      - Explicit `period` (e.g. `30day`, `current_year`, `quarter1`, etc.) **or**
      - Comparative `timeframe` (e.g. `30day_to_30day`, `month`, `quarter`, `year`, `alltime`).
    - Uses the same quarter and school-year mapping functions.
  - For 30-day-based modes:
    - Similar pattern of selecting the most recent 30 unique school days, plus previous 30 for comparisons.
    - Tracks `available_data_points` and `has_full_30_days` at the period level.

### 3.4 How we are displaying the frenzy stats data

**Frontend view:** `Frenzy Stats` tab (`#frenzy-view` in `templates/index.html`) and `loadFrenzyStats()` in `static/app.js`.

- **Inputs / controls**
  - Student dropdown: `#frenzy-student-select`.
  - Timeframe selection:
    - `#frenzy-period-select` for named single-period summaries (`30day`, `current_year`, quarters, `all_time`, `previous_years`).
    - `#frenzy-timeframe-select` for comparative timeframes (`30day_to_30day`, `month`, `quarter`, `year`, `alltime`).
  - Additional filters:
    - `#frenzy-managed-by-me-checkbox` for staff/admin caseload filtering.
  - Actions:
    - `#load-frenzy-stats-btn` → triggers `loadFrenzyStats()` and fetches `/api/frenzy-stats`.
    - `#print-frenzy-btn` → enabled after data load; uses `window.currentFrenzyStatsData` for PDFs.

- **Data fetching and wiring**
  - `loadFrenzyStats()` builds query parameters:
    - `period` or `timeframe`.
    - `student_id` if selected.
    - `managed_by_me=true` if checked.
    - `school_year` for month comparisons.
    - JSON-encoded `quarter_dates` and `school_year_dates`.
  - On success:
    - Stores the data in `window.currentFrenzyStatsData`.
    - Enables the Print button.
    - Renders into `#frenzy-results`.

- **Rendering modes**
  - **Comparison mode** (`data.comparison_mode && data.periods`):
    - Builds a comparison table similar in structure to the Summary page:
      - Metric rows:
        - Data points (30-day windows).
        - `Total Frenzies`.
        - `Total Duration (min)`.
        - `Average Duration (min)`.
      - Columns:
        - Each selected timeframe (e.g. current 30 days vs previous 30 days, multiple months, quarters, or school years).
    - Adds a “Graph Main Metrics” button:
      - Calls `showSectionGraph('frenzy_comparison_main', 'frenzy')`, which uses Chart.js to show multi-period bar charts for total count, total duration, and average duration.
    - **Day-of-week comparison table:**
      - Weekdays only (Monday–Friday).
      - Two-level header (periods × days).
      - Rows:
        - `Count` (number of frenzies per day of week and period).
        - `Duration (min)`.
        - `Avg Duration (min)` (where available).
      - Includes a search box to filter visible day columns.
      - Also integrates with graphing via `showSectionGraph('frenzy_comparison_day', 'frenzy')`.
    - Additional comparison tables for location/purpose can be built or are supported via the section-graph system.

  - **Single-summary mode** (`comparison_mode == false`):
    - Renders a card with:
      - Title: `Frenzy Statistics - <Timeframe Label>`.
      - Top-line metrics:
        - Total frenzies.
        - Total duration.
        - Average duration.
      - Day-of-week breakdown table (weekdays only).
      - Optional breakdowns by time, location, and purpose.
    - The section-graph modal supports single-summary views with:
      - `frenzy_single_main` (overview bar chart).
      - `frenzy_single_day` (day-of-week counts).
      - `frenzy_single_class` (by location/class).
      - `frenzy_single_purpose` (by purpose).

---

## 4. How this ties back to data entry

- **Summary page depends on:**
  - **Period Entry** and **Daily Entry** views:
    - Users enter per-period STAR points and mark infractions, reminders, resets, and frenzies.
    - These writes go to:
      - `DailyRecord` (date, student, attendance).
      - `PeriodRecord` (points, flags, location, info).
      - `Infraction` records and `FrenzyEvent` records.
  - **Imports**:
    - CSV imports (e.g. point cards, frenzy imports) populate the same underlying tables.

- **Frenzy Stats page depends on:**
  - **Frenzy event entry** within Daily Entry view:
    - The “Add Frenzy” button (`addFrenzy()`) builds `FrenzyEvent`-like JSON that is saved when the daily record is submitted.
  - **Legacy/inline frenzy flags** within `info` JSON:
    - For historical data or simplified entry, a simple `frenzy` flag and optional `duration` can be stored in the Info column; these are still counted in top-level frenzy metrics.

Taken together, the Summary and Frenzy Stats pages provide:

- A **STAR-focused view** of behavioral performance (Summary).
- A **frenzy-focused view** of when, where, and why escalations occur (Frenzy Stats).

Both views are driven entirely by the underlying `DailyRecord`, `PeriodRecord`, `Infraction`, and `FrenzyEvent` data, filtered by role, student selection, and timeframe.

