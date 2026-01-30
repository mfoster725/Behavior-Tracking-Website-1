"""
Migration script to add the grades_taught column to the users table.
Run this once to update your existing local SQLite database.

This column stores which grade(s) teachers/case managers teach (e.g. "9, 10, 11" or "9-12").
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
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()

        cursor.execute("PRAGMA table_info(users)")
        columns = [row[1] for row in cursor.fetchall()]

        if 'grades_taught' in columns:
            print("✅ The 'grades_taught' column already exists. No migration needed.")
            return

        print("Adding 'grades_taught' column to users table...")
        cursor.execute("ALTER TABLE users ADD COLUMN grades_taught VARCHAR(50)")

        conn.commit()
        print("✅ Migration successful!")
        print("   The 'grades_taught' column has been added to the users table.")
        print("\nYou can now restart your application (python app.py).")

    except sqlite3.Error as e:
        print(f"❌ Error during migration: {e}")

    finally:
        if conn:
            conn.close()


if __name__ == '__main__':
    print("=" * 60)
    print("Database Migration: Add grades_taught Column")
    print("=" * 60)
    print()
    migrate_database()
    print()
    print("=" * 60)
