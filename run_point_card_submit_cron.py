#!/usr/bin/env python3
"""
Cron script: auto-submit point cards that have data after 10:00pm school time.

Usage:
    python run_point_card_submit_cron.py [YYYY-MM-DD]
"""

import sys

from app import app, run_point_card_auto_submit


def main():
    target = sys.argv[1] if len(sys.argv) > 1 else None
    with app.app_context():
        try:
            count = run_point_card_auto_submit(target)
            print(f"OK: Auto-submitted {count} point card(s)")
        except Exception as e:
            print(f"ERROR: {e}", file=sys.stderr)
            sys.exit(1)


if __name__ == "__main__":
    main()
