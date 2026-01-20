#!/usr/bin/env python3
"""
Script to sync Student table names with User table names for student users.
This fixes the issue where editing names in User Management only updated User.name
but not Student.name.
"""

import sqlite3
import os

# Get the database path
db_path = os.path.join('instance', 'behavior_tracking.db')

if not os.path.exists(db_path):
    print(f"Error: Database not found at {db_path}")
    exit(1)

conn = sqlite3.connect(db_path)
cursor = conn.cursor()

print("Syncing Student names with User names...")
print("-" * 60)

# Get all student users with their associated student records
cursor.execute("""
    SELECT u.id, u.name as user_name, u.student_id, s.id as student_table_id, s.name as student_name
    FROM users u
    LEFT JOIN students s ON u.student_id = s.id
    WHERE u.role = 'student'
    ORDER BY u.id
""")

rows = cursor.fetchall()

if not rows:
    print("No student users found.")
    conn.close()
    exit(0)

updated_count = 0
for row in rows:
    user_id, user_name, student_id, student_table_id, student_name = row
    
    if not student_id or not student_table_id:
        print(f"User ID {user_id} ({user_name}): No associated student record, skipping...")
        continue
    
    if user_name != student_name:
        print(f"Updating Student ID {student_table_id}: '{student_name}' -> '{user_name}'")
        cursor.execute("UPDATE students SET name = ? WHERE id = ?", (user_name, student_table_id))
        updated_count += 1
    else:
        print(f"Student ID {student_table_id} ({user_name}): Already in sync")

if updated_count > 0:
    conn.commit()
    print("-" * 60)
    print(f"Successfully updated {updated_count} student name(s).")
else:
    print("-" * 60)
    print("All student names are already in sync.")

conn.close()
print("Done!")

