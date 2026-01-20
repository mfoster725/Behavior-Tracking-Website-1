"""
Migration script to add the name column to the users table.
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
        
        # Check if name column already exists
        cursor.execute("PRAGMA table_info(users)")
        columns = [row[1] for row in cursor.fetchall()]
        
        if 'name' in columns:
            print("✅ The 'name' column already exists. No migration needed.")
            conn.close()
            return
        
        # Add the name column
        print("Adding 'name' column to users table...")
        cursor.execute("ALTER TABLE users ADD COLUMN name VARCHAR(100)")
        
        # Update existing users to use username as name (can be changed later)
        print("Setting default names for existing users...")
        cursor.execute("UPDATE users SET name = username WHERE name IS NULL")
        
        conn.commit()
        print("✅ Migration successful!")
        print("   The 'name' column has been added to the users table.")
        print("\nYou can now:")
        print("  1. Restart your application (python app.py)")
        print("  2. Update user names in the User Management tab")
        print("  3. New staff users will have separate name fields")
        
    except sqlite3.Error as e:
        print(f"❌ Error during migration: {e}")
        
    finally:
        if conn:
            conn.close()

if __name__ == '__main__':
    print("=" * 60)
    print("Database Migration: Add Name Column to Users")
    print("=" * 60)
    print()
    migrate_database()
    print()
    print("=" * 60)

