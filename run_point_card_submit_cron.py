#!/usr/bin/env python3
"""
Cron script: auto-submit point cards that have data after 11:15pm school time.

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
        # Weekly bills: issue Monday statements and roll late bills forward even if nobody opens the page.
        try:
            if hasattr(app, 'run_economy_maintenance'):
                result = app.run_economy_maintenance() or {}
                print(f"OK: Weekly bills {result}")
        except Exception as e:
            print(f"Weekly bills maintenance failed: {e}", file=sys.stderr)


if __name__ == "__main__":
    main()
