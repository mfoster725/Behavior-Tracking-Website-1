#!/usr/bin/env python3
"""
Delete point cards and paychecks dated before the school-year cutoff (default: 2026-08-31).

Usage:
    python run_pre_aug31_cleanup.py [--dry-run] [YYYY-MM-DD]

Uses the same DATABASE_URL / SQLite config as the web app.
"""

import sys

from app import app, run_pre_cutoff_data_cleanup


def main():
    dry_run = '--dry-run' in sys.argv
    args = [arg for arg in sys.argv[1:] if arg != '--dry-run']
    cutoff = args[0] if args else None

    with app.app_context():
        try:
            stats = run_pre_cutoff_data_cleanup(cutoff_date=cutoff, dry_run=dry_run)
            mode = 'DRY RUN' if dry_run else 'OK'
            print(f"{mode}: {stats}")
        except Exception as exc:
            print(f"ERROR: {exc}", file=sys.stderr)
            sys.exit(1)


if __name__ == '__main__':
    main()
