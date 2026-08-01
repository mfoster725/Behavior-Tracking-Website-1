"""
Migration: create student if/then plan tables and seed plan_if_library with 40 common Ifs.
Supports SQLite (instance/behavior_tracking.db) and will no-op gracefully if DB missing.
"""

import os
import sqlite3
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from student_plans_lib import PLAN_IF_SEED_TEXTS, normalize_if_text


def _db_path():
    return os.environ.get('PLAN_MIGRATE_DB', 'instance/behavior_tracking.db')


def migrate_sqlite(db_path):
    if not os.path.exists(db_path):
        print(f"Database not found at {db_path} — skipping sqlite migration "
              "(tables will be created via SQLAlchemy create_all on app start).")
        return

    conn = sqlite3.connect(db_path)
    try:
        cur = conn.cursor()
        cur.execute("SELECT name FROM sqlite_master WHERE type='table'")
        tables = {r[0] for r in cur.fetchall()}

        if 'plan_if_library' not in tables:
            print("Creating plan_if_library...")
            cur.execute("""
                CREATE TABLE plan_if_library (
                    id INTEGER PRIMARY KEY,
                    text TEXT NOT NULL,
                    normalized_text VARCHAR(500) NOT NULL UNIQUE,
                    usage_count INTEGER NOT NULL DEFAULT 0,
                    created_at DATETIME
                )
            """)
            cur.execute(
                "CREATE INDEX IF NOT EXISTS ix_plan_if_library_normalized_text "
                "ON plan_if_library (normalized_text)"
            )

        if 'student_plans' not in tables:
            print("Creating student_plans...")
            cur.execute("""
                CREATE TABLE student_plans (
                    id INTEGER PRIMARY KEY,
                    student_id INTEGER NOT NULL UNIQUE,
                    updated_by_user_id INTEGER,
                    updated_at DATETIME,
                    created_at DATETIME,
                    FOREIGN KEY(student_id) REFERENCES students(id),
                    FOREIGN KEY(updated_by_user_id) REFERENCES users(id)
                )
            """)

        if 'student_plan_rows' not in tables:
            print("Creating student_plan_rows...")
            cur.execute("""
                CREATE TABLE student_plan_rows (
                    id INTEGER PRIMARY KEY,
                    plan_id INTEGER NOT NULL,
                    sort_order INTEGER NOT NULL DEFAULT 0,
                    if_text TEXT NOT NULL DEFAULT '',
                    then_text TEXT NOT NULL DEFAULT '',
                    has_threshold BOOLEAN NOT NULL DEFAULT 0,
                    threshold_percent NUMERIC(5, 2),
                    threshold_type VARCHAR(40),
                    cutoff_time VARCHAR(20),
                    dow_start VARCHAR(20),
                    dow_end VARCHAR(20),
                    consecutive_n INTEGER,
                    days_needed INTEGER,
                    window_days INTEGER,
                    period_time_range VARCHAR(50),
                    period_location VARCHAR(100),
                    star_category VARCHAR(20),
                    FOREIGN KEY(plan_id) REFERENCES student_plans(id)
                )
            """)
            cur.execute(
                "CREATE INDEX IF NOT EXISTS ix_student_plan_rows_plan_id "
                "ON student_plan_rows (plan_id)"
            )

        if 'plan_threshold_events' not in tables:
            print("Creating plan_threshold_events...")
            cur.execute("""
                CREATE TABLE plan_threshold_events (
                    id INTEGER PRIMARY KEY,
                    student_id INTEGER NOT NULL,
                    plan_row_id INTEGER NOT NULL,
                    if_normalized VARCHAR(500) NOT NULL,
                    window_key VARCHAR(64) NOT NULL,
                    met_at DATETIME NOT NULL,
                    delivered_at DATETIME,
                    delivered_by_user_id INTEGER,
                    FOREIGN KEY(student_id) REFERENCES students(id),
                    FOREIGN KEY(plan_row_id) REFERENCES student_plan_rows(id),
                    FOREIGN KEY(delivered_by_user_id) REFERENCES users(id),
                    UNIQUE(plan_row_id, window_key)
                )
            """)
            cur.execute(
                "CREATE INDEX IF NOT EXISTS ix_plan_threshold_events_student_id "
                "ON plan_threshold_events (student_id)"
            )
            cur.execute(
                "CREATE INDEX IF NOT EXISTS ix_plan_threshold_events_plan_row_id "
                "ON plan_threshold_events (plan_row_id)"
            )
            cur.execute(
                "CREATE INDEX IF NOT EXISTS ix_plan_threshold_events_if_normalized "
                "ON plan_threshold_events (if_normalized)"
            )

        inserted = 0
        for text in PLAN_IF_SEED_TEXTS:
            norm = normalize_if_text(text)
            cur.execute("SELECT id FROM plan_if_library WHERE normalized_text = ?", (norm,))
            if cur.fetchone():
                continue
            cur.execute(
                "INSERT INTO plan_if_library (text, normalized_text, usage_count, created_at) "
                "VALUES (?, ?, 0, datetime('now'))",
                (text, norm),
            )
            inserted += 1

        conn.commit()
        print(
            f"Migration complete. Seeded {inserted} new If library entries "
            f"({len(PLAN_IF_SEED_TEXTS)} total in seed list)."
        )
    finally:
        conn.close()


def migrate_via_sqlalchemy():
    """Fallback when using Postgres / configured DATABASE_URL."""
    from datetime import datetime
    from app import app, db, PlanIfLibrary

    with app.app_context():
        db.create_all()
        inserted = 0
        for text in PLAN_IF_SEED_TEXTS:
            norm = normalize_if_text(text)
            existing = PlanIfLibrary.query.filter_by(normalized_text=norm).first()
            if existing:
                continue
            db.session.add(
                PlanIfLibrary(
                    text=text,
                    normalized_text=norm,
                    usage_count=0,
                    created_at=datetime.utcnow(),
                )
            )
            inserted += 1
        db.session.commit()
        print(f"SQLAlchemy migration complete. Seeded {inserted} new If library entries.")


if __name__ == '__main__':
    print("=" * 60)
    print("Migration: Student If/Then Plans")
    print("=" * 60)
    path = _db_path()
    if os.path.exists(path):
        migrate_sqlite(path)
    else:
        print(f"No sqlite DB at {path}; running SQLAlchemy create_all + seed...")
        migrate_via_sqlalchemy()
    print("=" * 60)
