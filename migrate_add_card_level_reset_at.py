"""
Migration script to add the card_level_reset_at column to the students table.
Run once to update an existing database (also auto-applied on app startup).
"""

import sqlite3
import os


def migrate_database():
    db_paths = ['behavior_tracking.db', 'instance/behavior_tracking.db']
    db_path = None

    for path in db_paths:
        if os.path.exists(path):
            db_path = path
            break

    if not db_path:
        print("ERROR: Database not found in any of these locations:")
        for path in db_paths:
            print(f"   - {path}")
        print("   Please ensure the database file exists.")
        return

    print("Starting database migration...")
    print(f"Database: {db_path}")

    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()

        cursor.execute("PRAGMA table_info(students)")
        columns = [row[1] for row in cursor.fetchall()]

        if 'card_level_reset_at' in columns:
            print("SUCCESS: The 'card_level_reset_at' column already exists. No migration needed.")
            conn.close()
            return

        print("Adding 'card_level_reset_at' column to students table...")
        cursor.execute("ALTER TABLE students ADD COLUMN card_level_reset_at DATE")
        conn.commit()
        conn.close()
        print("SUCCESS: Migration completed. Added card_level_reset_at column.")
    except Exception as e:
        print(f"ERROR: Migration failed: {e}")
        raise


if __name__ == '__main__':
    migrate_database()
