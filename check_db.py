import sqlite3
import os

db_paths = ['behavior_tracking.db', 'instance/behavior_tracking.db']

for db_path in db_paths:
    if os.path.exists(db_path):
        print(f"\nChecking {db_path}:")
        try:
            conn = sqlite3.connect(db_path)
            cursor = conn.cursor()
            cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
            tables = [row[0] for row in cursor.fetchall()]
            print(f"  Tables: {tables}")
            
            if 'students' in tables:
                cursor.execute("PRAGMA table_info(students)")
                columns = [row[1] for row in cursor.fetchall()]
                print(f"  Students table columns: {columns}")
                if 'card_color' in columns:
                    print("  ✓ card_color column exists")
                else:
                    print("  ✗ card_color column missing")
            
            conn.close()
        except Exception as e:
            print(f"  Error: {e}")
