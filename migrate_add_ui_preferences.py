"""
Migration script to add the ui_preferences column to the users table.
Run this once to update your existing local SQLite database.

This column stores JSON-encoded, non-PHI per-user UI preferences
(for example, which sections of the User Management page are hidden).
"""

import os
import sqlite3


def migrate_database():
    db_path = 'instance/behavior_tracking.db'

    if not os.path.exists(db_path):
        print(f"❌ Database not found at {db_path}")
        print("   If your database is in a different location, please update the db_path variable.")
        return

    print("Starting database migration...")
    print(f"Database: {db_path}")

    conn = None
    try:
        # Connect to the database
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()

        # Check if ui_preferences column already exists
        cursor.execute("PRAGMA table_info(users)")
        columns = [row[1] for row in cursor.fetchall()]

        if 'ui_preferences' in columns:
            print("✅ The 'ui_preferences' column already exists. No migration needed.")
            return

        # Add the ui_preferences column
        print("Adding 'ui_preferences' column to users table...")
        cursor.execute("ALTER TABLE users ADD COLUMN ui_preferences TEXT")

        conn.commit()
        print("✅ Migration successful!")
        print("   The 'ui_preferences' column has been added to the users table.")
        print("\nYou can now restart your application (python app.py) and the")
        print("User Management section visibility preferences will persist per user.")

    except sqlite3.Error as e:
        print(f"❌ Error during migration: {e}")

    finally:
        if conn:
            conn.close()


if __name__ == '__main__':
    print("=" * 60)
    print("Database Migration: Add ui_preferences Column")
    print("=" * 60)
    print()
    migrate_database()
    print()
    print("=" * 60)

