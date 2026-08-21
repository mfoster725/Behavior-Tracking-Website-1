"""
Migration: curriculum lessons, assignments, savings goals, and notification link.
Supports SQLite and Postgres (via SQLAlchemy create_all + seed).
"""

import os
import sqlite3
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from curriculum_lib import LESSON_SEEDS


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

        if 'curriculum_lessons' not in tables:
            print("Creating curriculum_lessons...")
            cur.execute("""
                CREATE TABLE curriculum_lessons (
                    id INTEGER PRIMARY KEY,
                    slug VARCHAR(50) NOT NULL UNIQUE,
                    title VARCHAR(200) NOT NULL,
                    skill_name VARCHAR(100) NOT NULL,
                    student_prompt TEXT,
                    staff_script TEXT,
                    teaching_body TEXT,
                    sort_order INTEGER NOT NULL DEFAULT 0,
                    is_active BOOLEAN NOT NULL DEFAULT 1
                )
            """)

        if 'curriculum_assignments' not in tables:
            print("Creating curriculum_assignments...")
            cur.execute("""
                CREATE TABLE curriculum_assignments (
                    id INTEGER PRIMARY KEY,
                    student_id INTEGER NOT NULL,
                    lesson_id INTEGER NOT NULL,
                    assigned_by_user_id INTEGER,
                    source VARCHAR(20) NOT NULL DEFAULT 'staff',
                    paycheck_id INTEGER,
                    status VARCHAR(20) NOT NULL DEFAULT 'assigned',
                    responses_json TEXT,
                    started_at DATETIME,
                    completed_at DATETIME,
                    created_at DATETIME,
                    FOREIGN KEY(student_id) REFERENCES students(id),
                    FOREIGN KEY(lesson_id) REFERENCES curriculum_lessons(id),
                    FOREIGN KEY(assigned_by_user_id) REFERENCES users(id),
                    FOREIGN KEY(paycheck_id) REFERENCES paychecks(id)
                )
            """)
            cur.execute(
                "CREATE INDEX IF NOT EXISTS ix_curriculum_assignments_student_id "
                "ON curriculum_assignments (student_id)"
            )
            cur.execute(
                "CREATE INDEX IF NOT EXISTS ix_curriculum_assignments_lesson_id "
                "ON curriculum_assignments (lesson_id)"
            )
            cur.execute(
                "CREATE UNIQUE INDEX IF NOT EXISTS ix_curriculum_assign_paycheck "
                "ON curriculum_assignments (student_id, lesson_id, paycheck_id)"
            )

        if 'savings_goals' not in tables:
            print("Creating savings_goals...")
            cur.execute("""
                CREATE TABLE savings_goals (
                    id INTEGER PRIMARY KEY,
                    student_id INTEGER NOT NULL,
                    marketplace_item_id INTEGER,
                    custom_label VARCHAR(200),
                    target_amount NUMERIC(10, 2) NOT NULL,
                    is_active BOOLEAN NOT NULL DEFAULT 1,
                    created_at DATETIME,
                    completed_at DATETIME,
                    FOREIGN KEY(student_id) REFERENCES students(id),
                    FOREIGN KEY(marketplace_item_id) REFERENCES marketplace_items(id)
                )
            """)
            cur.execute(
                "CREATE INDEX IF NOT EXISTS ix_savings_goals_student_id "
                "ON savings_goals (student_id)"
            )

        cur.execute("PRAGMA table_info(notifications)")
        notif_cols = {row[1] for row in cur.fetchall()}
        if 'curriculum_assignment_id' not in notif_cols:
            print("Adding notifications.curriculum_assignment_id...")
            cur.execute(
                "ALTER TABLE notifications ADD COLUMN curriculum_assignment_id INTEGER "
                "REFERENCES curriculum_assignments(id)"
            )

        cur.execute("PRAGMA table_info(curriculum_lessons)")
        lesson_cols = {row[1] for row in cur.fetchall()}
        if 'curriculum_lessons' in tables and 'teaching_body' not in lesson_cols:
            print("Adding curriculum_lessons.teaching_body...")
            cur.execute("ALTER TABLE curriculum_lessons ADD COLUMN teaching_body TEXT")

        inserted = 0
        for lesson in LESSON_SEEDS:
            cur.execute("SELECT id FROM curriculum_lessons WHERE slug = ?", (lesson['slug'],))
            if cur.fetchone():
                cur.execute(
                    "UPDATE curriculum_lessons SET title=?, skill_name=?, student_prompt=?, "
                    "staff_script=?, teaching_body=?, sort_order=? WHERE slug=?",
                    (
                        lesson['title'],
                        lesson['skill_name'],
                        lesson['student_prompt'],
                        lesson['staff_script'],
                        lesson.get('teaching'),
                        lesson['sort_order'],
                        lesson['slug'],
                    ),
                )
                continue
            cur.execute(
                "INSERT INTO curriculum_lessons "
                "(slug, title, skill_name, student_prompt, staff_script, teaching_body, sort_order, is_active) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, 1)",
                (
                    lesson['slug'],
                    lesson['title'],
                    lesson['skill_name'],
                    lesson['student_prompt'],
                    lesson['staff_script'],
                    lesson.get('teaching'),
                    lesson['sort_order'],
                ),
            )
            inserted += 1

        conn.commit()
        print(f"Migration complete. Seeded {inserted} new curriculum lessons.")
    finally:
        conn.close()


def migrate_via_sqlalchemy():
    from app import app, db, seed_curriculum_lessons, ensure_curriculum_schema

    with app.app_context():
        db.create_all()
        ensure_curriculum_schema()
        inserted = seed_curriculum_lessons()
        print(f"SQLAlchemy migration complete. Seeded {inserted} new curriculum lessons.")


if __name__ == '__main__':
    print("=" * 60)
    print("Migration: Financial literacy curriculum")
    print("=" * 60)
    path = _db_path()
    if os.path.exists(path):
        migrate_sqlite(path)
    else:
        print(f"No sqlite DB at {path}; running SQLAlchemy create_all + seed...")
        migrate_via_sqlalchemy()
    print("=" * 60)
