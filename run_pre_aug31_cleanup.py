#!/usr/bin/env python3
"""
One-off script: delete point cards and paychecks dated before a cutoff date.

This is NOT run automatically. Use only when you intentionally need to purge
test or obsolete data (e.g. pre-school-year test records).

Usage:
    python run_pre_aug31_cleanup.py 2026-08-31 [--dry-run]

Uses the same DATABASE_URL / SQLite config as the web app.
"""

import sys

from app import app, run_pre_cutoff_data_cleanup


def main():
    dry_run = '--dry-run' in sys.argv
    args = [arg for arg in sys.argv[1:] if arg != '--dry-run']
    if not args:
        print('Usage: python run_pre_aug31_cleanup.py YYYY-MM-DD [--dry-run]', file=sys.stderr)
        print('  Deletes all point cards and paychecks before the given date.', file=sys.stderr)
        sys.exit(1)
    cutoff = args[0]

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
