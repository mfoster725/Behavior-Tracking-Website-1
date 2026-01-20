"""
Migration script to add the info column to the period_records table.
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
        cursor.execute("PRAGMA table_info(period_records)")
        columns = [row[1] for row in cursor.fetchall()]
        
        print(f"Current columns in period_records table: {', '.join(columns)}")
        print()
        
        # Add info column if it doesn't exist
        if 'info' not in columns:
            print("Adding 'info' column to period_records table...")
            cursor.execute("ALTER TABLE period_records ADD COLUMN info TEXT")
            print("[OK] Added 'info' column")
        else:
            print("[OK] The 'info' column already exists. Skipping.")
        
        conn.commit()
        print()
        print("[OK] Migration successful!")
        print("   The 'info' column has been added to the period_records table.")
        print("\nYou can now:")
        print("  1. Restart your application (python app.py)")
        print("  2. Save info column data from period entry tab to daily entry tab")
        
    except sqlite3.Error as e:
        print(f"[ERROR] Error during migration: {e}")
        if conn:
            conn.rollback()
        
    finally:
        if conn:
            conn.close()

if __name__ == '__main__':
    print("=" * 60)
    print("Database Migration: Add Info Column to Period Records")
    print("=" * 60)
    print()
    migrate_database()
    print()
    print("=" * 60)

