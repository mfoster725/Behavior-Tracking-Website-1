"""
Migration script to add the designation column to the users table.
Run this once to update your existing database.
"""

import sqlite3
import os

def migrate_database():
    db_path = 'instance/behavior_tracking.db'
    
    if not os.path.exists(db_path):
        print(f"❌ Database not found at {db_path}")
        print("   If your database is in a different location, please update the db_path variable.")
        return
    
    print("Starting database migration...")
    print(f"Database: {db_path}")
    
    try:
        # Connect to the database
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        
        # Check if designation column already exists
        cursor.execute("PRAGMA table_info(users)")
        columns = [row[1] for row in cursor.fetchall()]
        
        if 'designation' in columns:
            print("✅ The 'designation' column already exists. No migration needed.")
            conn.close()
            return
        
        # Add the designation column
        print("Adding 'designation' column to users table...")
        cursor.execute("ALTER TABLE users ADD COLUMN designation VARCHAR(50)")
        
        conn.commit()
        print("✅ Migration successful!")
        print("   The 'designation' column has been added to the users table.")
        print("\nYou can now:")
        print("  1. Restart your application (python app.py)")
        print("  2. Set designations for staff and admin users in the User Management tab")
        
    except sqlite3.Error as e:
        print(f"❌ Error during migration: {e}")
        
    finally:
        if conn:
            conn.close()

if __name__ == '__main__':
    print("=" * 60)
    print("Database Migration: Add Designation Column")
    print("=" * 60)
    print()
    migrate_database()
    print()
    print("=" * 60)

