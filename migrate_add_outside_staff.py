"""
Migration script to add is_outside_staff and district columns to users table
and create the outside_staff_students association table.
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
        
        # Check if is_outside_staff column already exists
        cursor.execute("PRAGMA table_info(users)")
        columns = [row[1] for row in cursor.fetchall()]
        
        if 'is_outside_staff' in columns and 'district' in columns:
            # Check if outside_staff_students table exists
            cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='outside_staff_students'")
            if cursor.fetchone():
                print("[OK] All columns and tables already exist. No migration needed.")
                conn.close()
                return
        
        # Add is_outside_staff column if it doesn't exist
        if 'is_outside_staff' not in columns:
            print("Adding 'is_outside_staff' column to users table...")
            cursor.execute("ALTER TABLE users ADD COLUMN is_outside_staff BOOLEAN DEFAULT 0 NOT NULL")
        else:
            print("[OK] The 'is_outside_staff' column already exists.")
        
        # Add district column if it doesn't exist
        if 'district' not in columns:
            print("Adding 'district' column to users table...")
            cursor.execute("ALTER TABLE users ADD COLUMN district VARCHAR(100)")
        else:
            print("[OK] The 'district' column already exists.")
        
        # Create outside_staff_students table if it doesn't exist
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='outside_staff_students'")
        if not cursor.fetchone():
            print("Creating 'outside_staff_students' table...")
            cursor.execute("""
                CREATE TABLE outside_staff_students (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL,
                    student_id INTEGER NOT NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (user_id) REFERENCES users(id),
                    FOREIGN KEY (student_id) REFERENCES students(id),
                    UNIQUE(user_id, student_id)
                )
            """)
        else:
            print("[OK] The 'outside_staff_students' table already exists.")
        
        conn.commit()
        print("[OK] Migration successful!")
        print("   The 'is_outside_staff' and 'district' columns have been added to the users table.")
        print("   The 'outside_staff_students' table has been created.")
        print("\nYou can now:")
        print("  1. Restart your application (python app.py)")
        print("  2. Create Outside Staff users in the User Management tab")
        print("  3. Assign students to Outside Staff users")
        
    except sqlite3.Error as e:
        print(f"[ERROR] Error during migration: {e}")
        if conn:
            conn.rollback()
        
    finally:
        if conn:
            conn.close()

if __name__ == '__main__':
    print("=" * 60)
    print("Database Migration: Add Outside Staff Support")
    print("=" * 60)
    print()
    migrate_database()
    print()
    print("=" * 60)
