"""
Migration script to add the sort_order, created_at, and updated_at columns to the schedules table.
Run this once to update your existing database.
"""

import sqlite3
import os

def migrate_database():
    db_path = 'instance/behavior_tracking.db'
    
    if not os.path.exists(db_path):
        print(f"[ERROR] Database not found at {db_path}")
        print("   If your database is in a different location, please update the db_path variable.")
        return
    
    print("Starting database migration...")
    print(f"Database: {db_path}")
    
    try:
        # Connect to the database
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        
        # Check existing columns
        cursor.execute("PRAGMA table_info(schedules)")
        columns = [row[1] for row in cursor.fetchall()]
        
        print(f"Current columns in schedules table: {', '.join(columns)}")
        print()
        
        # Add sort_order column if it doesn't exist
        if 'sort_order' not in columns:
            print("Adding 'sort_order' column to schedules table...")
            cursor.execute("ALTER TABLE schedules ADD COLUMN sort_order INTEGER DEFAULT 0")
            print("[OK] Added 'sort_order' column")
        else:
            print("[OK] The 'sort_order' column already exists. Skipping.")
        
        # Add created_at column if it doesn't exist
        if 'created_at' not in columns:
            print("Adding 'created_at' column to schedules table...")
            cursor.execute("ALTER TABLE schedules ADD COLUMN created_at DATETIME")
            # Set default value for existing rows
            cursor.execute("UPDATE schedules SET created_at = datetime('now') WHERE created_at IS NULL")
            print("[OK] Added 'created_at' column")
        else:
            print("[OK] The 'created_at' column already exists. Skipping.")
        
        # Add updated_at column if it doesn't exist
        if 'updated_at' not in columns:
            print("Adding 'updated_at' column to schedules table...")
            cursor.execute("ALTER TABLE schedules ADD COLUMN updated_at DATETIME")
            # Set default value for existing rows
            cursor.execute("UPDATE schedules SET updated_at = datetime('now') WHERE updated_at IS NULL")
            print("[OK] Added 'updated_at' column")
        else:
            print("[OK] The 'updated_at' column already exists. Skipping.")
        
        conn.commit()
        print()
        print("[OK] Migration successful!")
        print("   The required columns have been added to the schedules table.")
        print("\nYou can now:")
        print("  1. Restart your application (python app.py)")
        print("  2. Save teacher and student schedules without errors")
        
    except sqlite3.Error as e:
        print(f"[ERROR] Error during migration: {e}")
        if conn:
            conn.rollback()
        
    finally:
        if conn:
            conn.close()

if __name__ == '__main__':
    print("=" * 60)
    print("Database Migration: Add Sort Order and Timestamp Columns")
    print("=" * 60)
    print()
    migrate_database()
    print()
    print("=" * 60)

