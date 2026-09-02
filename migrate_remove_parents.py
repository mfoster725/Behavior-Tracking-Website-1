"""
Migration script to remove parent accounts and the parent_students table,
and ensure students.parent_emails exists.

This script:
- Adds students.parent_emails if missing
- Drops parent_students
- Deletes parent user accounts and related rights notifications

WARNING: Deleting parent accounts cannot be undone. Backup before running.
"""

import sqlite3
from pathlib import Path


def remove_parent_accounts():
    """Remove parent accounts / parent_students and ensure parent_emails column."""

    db_path = Path('instance/behavior_tracking.db')
    if not db_path.exists():
        print(f"Error: Database file not found at {db_path}")
        print("Please run this script from the project root directory.")
        return False

    print(f"Connecting to database at {db_path}...")
    conn = sqlite3.connect(str(db_path))
    cursor = conn.cursor()

    try:
        cursor.execute("PRAGMA table_info(students)")
        student_columns = {row[1] for row in cursor.fetchall()}
        if 'parent_emails' not in student_columns:
            print("Adding parent_emails column to students...")
            cursor.execute("ALTER TABLE students ADD COLUMN parent_emails TEXT")

        cursor.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='parent_students'"
        )
        if cursor.fetchone():
            print("Dropping parent_students table...")
            cursor.execute("DROP TABLE IF EXISTS parent_students")

        cursor.execute("SELECT COUNT(*) FROM users WHERE role = 'parent'")
        parent_count = cursor.fetchone()[0]

        if parent_count == 0:
            print("No parent accounts found in the database.")
            conn.commit()
            return True

        print(f"Found {parent_count} parent account(s) to delete.")

        cursor.execute("SELECT id FROM users WHERE role = 'parent'")
        parent_ids = [row[0] for row in cursor.fetchall()]

        cursor.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='ferpa_rights_notifications'"
        )
        if cursor.fetchone() and parent_ids:
            cursor.execute(
                "DELETE FROM ferpa_rights_notifications WHERE user_id IN ({})".format(
                    ','.join('?' * len(parent_ids))
                ),
                parent_ids
            )
            print(f"Deleted {cursor.rowcount} rights notification(s) for parent accounts.")

        cursor.execute("DELETE FROM users WHERE role = 'parent'")
        print(f"Deleted {cursor.rowcount} parent user account(s).")

        conn.commit()
        print("\nMigration completed successfully!")
        return True

    except sqlite3.Error as e:
        print(f"Database error: {e}")
        conn.rollback()
        return False
    except Exception as e:
        print(f"Unexpected error: {e}")
        conn.rollback()
        return False
    finally:
        conn.close()


if __name__ == '__main__':
    import sys

    auto_confirm = '--yes' in sys.argv or '-y' in sys.argv

    print("=" * 60)
    print("Parent Account Removal Migration Script")
    print("=" * 60)
    print()
    print("WARNING: This script will permanently delete:")
    print("  - All parent user accounts")
    print("  - The parent_students table")
    print("  - Rights notifications for parent accounts")
    print()

    if not auto_confirm:
        response = input("Do you want to continue? (yes/no): ")
        if response.lower() not in ['yes', 'y']:
            print("Migration cancelled.")
            exit(0)

    print()
    success = remove_parent_accounts()
    if not success:
        print("\nMigration failed. Please check the error messages above.")
        exit(1)
