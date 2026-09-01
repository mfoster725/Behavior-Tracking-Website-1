"""
One-off backfill: overwrite period_records.location from each student's current
schedule for all daily records on 2026-08-31.

Uses the same location resolution as the app (_student_location_for_period).

Run from project root:
  python migrate_backfill_point_card_locations_2026_08_31.py [--dry-run]
  python migrate_backfill_point_card_locations_2026_08_31.py --db PATH [--dry-run]

PostgreSQL (production): set DATABASE_URL, then:
  python migrate_backfill_point_card_locations_2026_08_31.py [--dry-run]

Remove --dry-run to apply changes.
"""
import argparse
import os
import sys
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from migrate_frenzy_severity import default_sqlite_behavior_tracking_path
from migrate_add_student_id_index import normalize_database_url

TARGET_DATE = date(2026, 8, 31)


def configure_database(app, db_path=None):
    if db_path:
        app.config["SQLALCHEMY_DATABASE_URI"] = f"sqlite:///{db_path.replace(os.sep, '/')}"
        print(f"Using SQLite: {db_path}")
        return

    database_url = os.environ.get("DATABASE_URL")
    if database_url:
        app.config["SQLALCHEMY_DATABASE_URI"] = normalize_database_url(database_url)
        print("Using DATABASE_URL (PostgreSQL)")
        return

    sqlite_path = default_sqlite_behavior_tracking_path()
    app.config["SQLALCHEMY_DATABASE_URI"] = f"sqlite:///{sqlite_path.replace(os.sep, '/')}"
    print(f"Using SQLite: {sqlite_path}")


def run_backfill(*, dry_run=False):
    from app import (
        DailyRecord,
        PeriodRecord,
        Student,
        _student_location_for_period,
        _student_schedule_rows_by_student,
        app,
        db,
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
                student_name = (students_by_id.get(student_id).name
                                if students_by_id.get(student_id) else f"student #{student_id}")
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

    from app import app

    configure_database(app, args.db)
    run_backfill(dry_run=args.dry_run)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"[ERROR] {exc}", file=sys.stderr)
        sys.exit(1)
