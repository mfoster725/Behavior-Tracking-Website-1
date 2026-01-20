"""
Migration script to add the user_id column to the schedules table.
This allows each user to have their own teacher schedule.
Run this once to update your existing database.
"""

import sqlite3
import os

def migrate_database():
    # Check both possible database locations
    db_paths = [
        'behavior_tracking.db',
        'instance/behavior_tracking.db'
    ]
    
    db_path = None
    for path in db_paths:
        if os.path.exists(path):
            db_path = path
            break
    
    if not db_path:
        print(f"[ERROR] Database not found in any of these locations:")
        for path in db_paths:
            print(f"   - {path}")
        print("\n   If your database is in a different location, please update the db_paths list.")
        return
    
    print("Starting database migration...")
    print(f"Database: {db_path}")
    
    conn = None
    try:
        # Connect to the database
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        
        # Check existing columns
        cursor.execute("PRAGMA table_info(schedules)")
        columns = [row[1] for row in cursor.fetchall()]
        
        print(f"Current columns in schedules table: {', '.join(columns)}")
        print()
        
        # Add user_id column if it doesn't exist
        if 'user_id' not in columns:
            print("Adding 'user_id' column to schedules table...")
            cursor.execute("ALTER TABLE schedules ADD COLUMN user_id INTEGER")
            print("[OK] Added 'user_id' column")
            print()
            print("Note: Existing teacher schedules will have NULL user_id.")
            print("   These will need to be re-saved by each user to associate them with the correct user.")
        else:
            print("[OK] The 'user_id' column already exists. Skipping.")
        
        conn.commit()
        print()
        print("[OK] Migration successful!")
        print("   The 'user_id' column has been added to the schedules table.")
        print("\nYou can now:")
        print("  1. Restart your application (python app.py)")
        print("  2. Each user can save their own teacher schedule")
        print("  3. The location column in Period Entry will pull from the current user's schedule")
        
    except sqlite3.Error as e:
        print(f"[ERROR] Error during migration: {e}")
        if conn:
            conn.rollback()
        
    finally:
        if conn:
            conn.close()

if __name__ == '__main__':
    print("=" * 60)
    print("Database Migration: Add User ID Column to Schedules")
    print("=" * 60)
    print()
    migrate_database()
    print()
    print("=" * 60)

