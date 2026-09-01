"""
One-off backfill: overwrite period_records.location from each student's current
schedule for all daily records on 2026-08-31.

Uses the same location resolution as the app (_student_location_for_period).

Run from project root:

  Production (Render / Aiven Postgres) — set DATABASE_URL in this terminal first:
    $env:USE_POSTGRES = "1"
    $env:DATABASE_URL = "postgresql://USER:PASSWORD@HOST:PORT/DB?sslmode=require"
    python migrate_backfill_point_card_locations_2026_08_31.py --dry-run
    python migrate_backfill_point_card_locations_2026_08_31.py

  Local SQLite only (optional):
    python migrate_backfill_point_card_locations_2026_08_31.py --db PATH [--dry-run]

Remove --dry-run to apply changes.
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
        "To run against production, copy DATABASE_URL from Render/Aiven into this\n"
        "terminal, set USE_POSTGRES=1, then run again.\n"
    )
    return "local-sqlite", sqlite_path


def run_backfill(app, db, *, dry_run=False):
    from app import (
        DailyRecord,
        PeriodRecord,
        Student,
        _student_location_for_period,
        _student_schedule_rows_by_student,
    )

    with app.app_context():
        daily_records = (
            DailyRecord.query.filter_by(date=TARGET_DATE)
            .order_by(DailyRecord.student_id.asc())
            .all()
        )
        if not daily_records:
            print(f"No daily records found for {TARGET_DATE.isoformat()}. Nothing to do.")
            return 0

        student_ids = sorted({record.student_id for record in daily_records if record.student_id})
        students_by_id = {
            student.id: student
            for student in Student.query.filter(Student.id.in_(student_ids)).all()
        }
        schedules_by_student = _student_schedule_rows_by_student(student_ids)

        period_updates = 0
        period_unchanged = 0
        students_touched = set()

        for daily_record in daily_records:
            student_id = daily_record.student_id
            schedule_rows = schedules_by_student.get(student_id, [])
            periods = (
                PeriodRecord.query.filter_by(daily_record_id=daily_record.id)
                .order_by(PeriodRecord.id.asc())
                .all()
            )
            for period in periods:
                time_range = (period.time_range or "").strip()
                if not time_range:
                    continue
                new_location = _student_location_for_period(
                    student_id,
                    time_range,
                    schedule_rows=schedule_rows,
                )
                old_location = (period.location or "").strip()
                if old_location == new_location:
                    period_unchanged += 1
                    continue
                period_updates += 1
                students_touched.add(student_id)
                student = students_by_id.get(student_id)
                student_name = student.name if student else f"student #{student_id}"
                print(
                    f"  {student_name} | {time_range}: "
                    f"{old_location or '(empty)'} -> {new_location or '(empty)'}"
                )
                if not dry_run:
                    period.location = new_location

        if dry_run:
            db.session.rollback()
            print(
                f"\n[DRY RUN] Would update {period_updates} period row(s) "
                f"across {len(students_touched)} student(s) "
                f"({period_unchanged} already matched)."
            )
        else:
            db.session.commit()
            print(
                f"\n[OK] Updated {period_updates} period row(s) "
                f"across {len(students_touched)} student(s) "
                f"for {TARGET_DATE.isoformat()} "
                f"({period_unchanged} already matched)."
            )

        print(
            f"Processed {len(daily_records)} daily record(s) "
            f"for {len(student_ids)} student(s)."
        )
        return period_updates


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

    from app import app, db

    if mode == "sqlite-file":
        app.config["SQLALCHEMY_DATABASE_URI"] = f"sqlite:///{db_path.replace(os.sep, '/')}"
        db.engine.dispose()
        print(f"Using SQLite file: {db_path}")
    elif mode == "postgres":
        print(f"Using PostgreSQL: {mask_database_target(app.config.get('SQLALCHEMY_DATABASE_URI', ''))}")
    else:
        print(f"Using local SQLite: {db_path}")

    run_backfill(app, db, dry_run=args.dry_run)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"[ERROR] {exc}", file=sys.stderr)
        sys.exit(1)
