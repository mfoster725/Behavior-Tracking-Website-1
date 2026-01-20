"""
Migration script to add the card_color column to the students table.
Run this once to update your existing database.
"""

import sqlite3
import os

def migrate_database():
    # Check both possible database locations
    db_paths = ['behavior_tracking.db', 'instance/behavior_tracking.db']
    db_path = None
    
    for path in db_paths:
        if os.path.exists(path):
            db_path = path
            break
    
    if not db_path:
        print(f"ERROR: Database not found in any of these locations:")
        for path in db_paths:
            print(f"   - {path}")
        print("   Please ensure the database file exists.")
        return
    
    print("Starting database migration...")
    print(f"Database: {db_path}")
    
    try:
        # Connect to the database
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        
        # Check if card_color column already exists
        cursor.execute("PRAGMA table_info(students)")
        columns = [row[1] for row in cursor.fetchall()]
        
        if 'card_color' in columns:
            print("SUCCESS: The 'card_color' column already exists. No migration needed.")
            conn.close()
            return
        
        # Add the card_color column
        print("Adding 'card_color' column to students table...")
        cursor.execute("ALTER TABLE students ADD COLUMN card_color VARCHAR(20)")
        
        conn.commit()
        print("SUCCESS: Migration successful!")
        print("   The 'card_color' column has been added to the students table.")
        print("\nYou can now:")
        print("  1. Restart your application (python app.py)")
        print("  2. Set card colors for students in the User Management tab")
        
    except sqlite3.Error as e:
        print(f"ERROR: Error during migration: {e}")
        
    finally:
        if conn:
            conn.close()

if __name__ == '__main__':
    print("=" * 60)
    print("Database Migration: Add Card Color Column")
    print("=" * 60)
    print()
    migrate_database()
    print()
    print("=" * 60)
