#!/usr/bin/env python3
"""
Cron script: generate paychecks for the previous Monday–Friday.

Run on a schedule (e.g. every Monday 9am UTC) via Render Cron Jobs or any scheduler.
Uses the same DATABASE_URL / SQLite config as the web app. No auth required.

Usage:
    python run_paycheck_cron.py [YYYY-MM-DD]

If YYYY-MM-DD is omitted, uses the previous Monday (or last week's Monday if today is Monday).
"""

import sys

from app import app, run_paycheck_generation


def main():
    target = sys.argv[1] if len(sys.argv) > 1 else None
    with app.app_context():
        try:
            count, start, end = run_paycheck_generation(target)
            print(f"OK: Generated {count} paychecks for {start} to {end}")
        except Exception as e:
            print(f"ERROR: {e}", file=sys.stderr)
            sys.exit(1)


if __name__ == "__main__":
    main()
