"""
One-off backfill: overwrite period_records.location from each student's current
schedule for selected daily record dates.

Local run (requires DATABASE_URL in this terminal):
    $env:USE_POSTGRES = "1"
    $env:DATABASE_URL = "postgresql://..."
    python migrate_backfill_point_card_locations_2026_08_31.py --dry-run
    python migrate_backfill_point_card_locations_2026_08_31.py
"""
import argparse
import os
import sys
from datetime import date
from urllib.parse import urlparse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from migrate_frenzy_severity import default_sqlite_behavior_tracking_path

DEFAULT_DATES = ("2026-08-31", "2026-09-01")


def mask_database_target(uri):
    if not uri:
        return "(unknown)"
    try:
        parsed = urlparse(uri.replace("postgresql+psycopg://", "postgresql://"))
        host = parsed.hostname or "unknown-host"
        port = f":{parsed.port}" if parsed.port else ""
        db_name = (parsed.path or "/").lstrip("/") or "defaultdb"
        return f"{host}{port}/{db_name}"
    except Exception:
        return "(postgres)"


def prepare_environment(args):
    if args.db:
        os.environ["USE_LOCAL_DB"] = "1"
        os.environ.pop("USE_POSTGRES", None)
        return "sqlite-file", os.path.abspath(args.db)

    if os.environ.get("DATABASE_URL"):
        os.environ["USE_POSTGRES"] = "1"
        return "postgres", None

    sqlite_path = default_sqlite_behavior_tracking_path()
    print(
        "WARNING: DATABASE_URL is not set in this terminal.\n"
        "The script will use LOCAL SQLite only (not your Render website):\n"
        f"  {sqlite_path}\n"
        "For production, use .\\run_backfill_on_production.ps1 instead.\n"
    )
    return "local-sqlite", sqlite_path


def parse_dates(raw):
    if not raw:
        return [date.fromisoformat(value) for value in DEFAULT_DATES]
    parsed = []
    for chunk in raw.split(","):
        chunk = chunk.strip()
        if not chunk:
            continue
        parsed.append(date.fromisoformat(chunk))
    if not parsed:
        raise ValueError("No valid dates provided")
    return parsed


def run_for_date(app, backfill_point_card_locations_for_date, target_date, dry_run):
    with app.app_context():
        result = backfill_point_card_locations_for_date(target_date, dry_run=dry_run)
        print(f"\n=== {target_date.isoformat()} ===")
        for change in result.get("changes", []):
            print(
                f"  {change['student_name']} | {change['time_range']}: "
                f"{change['old_location'] or '(empty)'} -> {change['new_location'] or '(empty)'}"
            )
        if result.get("changes_truncated"):
            print("  ... changes list truncated in output")

        if dry_run:
            print(
                f"[DRY RUN] Would update {result['period_updates']} period row(s) "
                f"across {result['students_touched']} student(s) "
                f"({result['period_unchanged']} already matched)."
            )
        else:
            print(
                f"[OK] Updated {result['period_updates']} period row(s) "
                f"across {result['students_touched']} student(s) "
                f"({result['period_unchanged']} already matched)."
            )
        print(
            f"Processed {result['daily_records']} daily record(s) "
            f"for {result['students']} student(s)."
        )
        return result


def main():
    parser = argparse.ArgumentParser(
        description="Backfill point card locations from current student schedules."
    )
    parser.add_argument("--db", help="SQLite database path (optional)", default=None)
    parser.add_argument(
        "--dates",
        help="Comma-separated dates YYYY-MM-DD (default: 2026-08-31,2026-09-01)",
        default=None,
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show changes without writing to the database",
    )
    args = parser.parse_args()

    target_dates = parse_dates(args.dates)
    mode, db_path = prepare_environment(args)

    from app import app, backfill_point_card_locations_for_date, db

    if mode == "sqlite-file":
        app.config["SQLALCHEMY_DATABASE_URI"] = f"sqlite:///{db_path.replace(os.sep, '/')}"
        db.engine.dispose()
        print(f"Using SQLite file: {db_path}")
    elif mode == "postgres":
        print(f"Using PostgreSQL: {mask_database_target(app.config.get('SQLALCHEMY_DATABASE_URI', ''))}")
    else:
        print(f"Using local SQLite: {db_path}")

    totals = {"period_updates": 0, "daily_records": 0, "students_touched": 0}
    for target_date in target_dates:
        result = run_for_date(app, backfill_point_card_locations_for_date, target_date, args.dry_run)
        totals["period_updates"] += result["period_updates"]
        totals["daily_records"] += result["daily_records"]
        totals["students_touched"] += result["students_touched"]

    print(
        f"\nTotal across {len(target_dates)} date(s): "
        f"{totals['period_updates']} period update(s), "
        f"{totals['daily_records']} daily record(s), "
        f"{totals['students_touched']} student-day touch(es)."
    )


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"[ERROR] {exc}", file=sys.stderr)
        sys.exit(1)
