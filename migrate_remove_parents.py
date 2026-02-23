"""
Migration script to remove parent accounts and related data.

This script deletes:
- All parent user accounts
- All parent-student relationships
- All rights notifications for parent accounts

WARNING: This operation cannot be undone. Make sure to backup your database before running this script.
"""

import sqlite3
import os
from pathlib import Path

def remove_parent_accounts():
    """Remove all parent accounts and related data from the database"""
    
    # Find the database file
    db_path = Path('instance/behavior_tracking.db')
    if not db_path.exists():
        print(f"Error: Database file not found at {db_path}")
        print("Please run this script from the project root directory.")
        return False
    
    print(f"Connecting to database at {db_path}...")
    conn = sqlite3.connect(str(db_path))
    cursor = conn.cursor()
    
    try:
        # Get count of parent accounts before deletion
        cursor.execute("SELECT COUNT(*) FROM users WHERE role = 'parent'")
        parent_count = cursor.fetchone()[0]
        
        if parent_count == 0:
            print("No parent accounts found in the database.")
            return True
        
        print(f"Found {parent_count} parent account(s) to delete.")
        
        # Get parent user IDs
        cursor.execute("SELECT id FROM users WHERE role = 'parent'")
        parent_ids = [row[0] for row in cursor.fetchall()]
        
        if not parent_ids:
            print("No parent IDs found.")
            return True
        
        # Delete rights notifications for parents
        cursor.execute(
            "DELETE FROM ferpa_rights_notifications WHERE user_id IN ({})".format(
                ','.join('?' * len(parent_ids))
            ),
            parent_ids
        )
        notifications_deleted = cursor.rowcount
        print(f"Deleted {notifications_deleted} rights notification(s) for parent accounts.")
        
        # Delete parent-student relationships
        cursor.execute(
            "DELETE FROM parent_students WHERE parent_user_id IN ({})".format(
                ','.join('?' * len(parent_ids))
            ),
            parent_ids
        )
        relationships_deleted = cursor.rowcount
        print(f"Deleted {relationships_deleted} parent-student relationship(s).")
        
        # Delete parent users
        cursor.execute(
            "DELETE FROM users WHERE role = 'parent'"
        )
        users_deleted = cursor.rowcount
        print(f"Deleted {users_deleted} parent user account(s).")
        
        # Commit the changes
        conn.commit()
        print("\nMigration completed successfully!")
        print(f"Summary:")
        print(f"  - Parent accounts deleted: {users_deleted}")
        print(f"  - Parent-student relationships deleted: {relationships_deleted}")
        print(f"  - Rights notifications deleted: {notifications_deleted}")
        
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
    
    # Allow running with --yes flag to skip confirmation
    auto_confirm = '--yes' in sys.argv or '-y' in sys.argv
    
    print("=" * 60)
    print("Parent Account Removal Migration Script")
    print("=" * 60)
    print()
    print("WARNING: This script will permanently delete:")
    print("  - All parent user accounts")
    print("  - All parent-student relationships")
    print("  - All rights notifications for parent accounts")
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
