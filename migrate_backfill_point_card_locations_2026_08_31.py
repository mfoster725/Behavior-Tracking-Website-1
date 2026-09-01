"""
One-off backfill: overwrite period_records.location from each student's current
schedule for all daily records on 2026-08-31.

Preferred on production (no local DATABASE_URL needed):
  Invoke the deployed endpoint (uses Render/Aiven DATABASE_URL on the server):
    .\\run_backfill_on_production.ps1 -DryRun
    .\\run_backfill_on_production.ps1

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

TARGET_DATE = date(2026, 8, 31)


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


def main():
    parser = argparse.ArgumentParser(
        description="Backfill point card locations for 2026-08-31 from current student schedules."
    )
    parser.add_argument("--db", help="SQLite database path (optional)", default=None)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show changes without writing to the database",
    )
    args = parser.parse_args()

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

    with app.app_context():
        result = backfill_point_card_locations_for_date(TARGET_DATE, dry_run=args.dry_run)
        for change in result.get("changes", []):
            print(
                f"  {change['student_name']} | {change['time_range']}: "
                f"{change['old_location'] or '(empty)'} -> {change['new_location'] or '(empty)'}"
            )
        if result.get("changes_truncated"):
            print("  ... changes list truncated in output")

        if args.dry_run:
            print(
                f"\n[DRY RUN] Would update {result['period_updates']} period row(s) "
                f"across {result['students_touched']} student(s) "
                f"({result['period_unchanged']} already matched)."
            )
        else:
            print(
                f"\n[OK] Updated {result['period_updates']} period row(s) "
                f"across {result['students_touched']} student(s) "
                f"for {TARGET_DATE.isoformat()} "
                f"({result['period_unchanged']} already matched)."
            )
        print(
            f"Processed {result['daily_records']} daily record(s) "
            f"for {result['students']} student(s)."
        )


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"[ERROR] {exc}", file=sys.stderr)
        sys.exit(1)
