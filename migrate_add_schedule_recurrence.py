"""
Migration script to add recurrence columns to the schedules table.
Run this once to update your existing database.
"""

import sqlite3
import os


COLUMNS = [
    ('recurrence_type', "VARCHAR(20) DEFAULT 'daily'"),
    ('weekdays', 'TEXT'),
    ('month_ordinal', 'VARCHAR(10)'),
    ('biweekly_anchor', 'DATE'),
    ('effective_start', 'DATE'),
    ('effective_end', 'DATE'),
]


def migrate_database():
    db_path = 'instance/behavior_tracking.db'

    if not os.path.exists(db_path):
        print(f"[ERROR] Database not found at {db_path}")
        print("   If your database is in a different location, please update the db_path variable.")
        return

    print("Starting database migration...")
    print(f"Database: {db_path}")

    conn = None
    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()

        cursor.execute("PRAGMA table_info(schedules)")
        columns = [row[1] for row in cursor.fetchall()]
        print(f"Current columns in schedules table: {', '.join(columns)}")
        print()

        for name, ddl in COLUMNS:
            if name not in columns:
                print(f"Adding '{name}' column to schedules table...")
                cursor.execute(f"ALTER TABLE schedules ADD COLUMN {name} {ddl}")
                print(f"[OK] Added '{name}' column")
            else:
                print(f"[OK] The '{name}' column already exists. Skipping.")

        cursor.execute(
            "UPDATE schedules SET recurrence_type = 'daily' "
            "WHERE recurrence_type IS NULL OR recurrence_type = ''"
        )

        conn.commit()
        print()
        print("[OK] Migration successful!")
        print("   Schedule recurrence columns have been added.")

    except sqlite3.Error as e:
        print(f"[ERROR] Error during migration: {e}")
        if conn:
            conn.rollback()
    finally:
        if conn:
            conn.close()


if __name__ == '__main__':
    print("=" * 60)
    print("Database Migration: Add Schedule Recurrence Columns")
    print("=" * 60)
    print()
    migrate_database()
    print()
    print("=" * 60)
