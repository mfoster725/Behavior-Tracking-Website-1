"""
Script to create the users table and add default users.
Run this once to set up authentication.
"""

from app import app, db, User, Student

def create_default_users():
    with app.app_context():
        # Create all tables
        db.create_all()
        print("Database tables created successfully!")
        
        # Check if users already exist
        existing_users = User.query.count()
        if existing_users > 0:
            print(f"\nFound {existing_users} existing user(s).")
            response = input("Do you want to create additional users? (y/n): ")
            if response.lower() != 'y':
                print("Exiting without creating new users.")
                return
        
        print("\n" + "=" * 50)
        print("Creating Default Users")
        print("=" * 50)
        
        # Create default admin user
        print("\nCreating default admin user...")
        admin_exists = User.query.filter_by(username='admin').first()
        if not admin_exists:
            admin_user = User(
                username='admin',
                role='admin'
            )
            admin_user.set_password('admin123')  # Change this password!
            db.session.add(admin_user)
            print("[OK] Admin user created (username: admin, password: admin123)")
            print("     **IMPORTANT: Change this password after first login!**")
        else:
            print("[SKIP] Admin user already exists")
        
        # Create default staff user
        print("\nCreating default staff user...")
        staff_exists = User.query.filter_by(username='staff').first()
        if not staff_exists:
            staff_user = User(
                username='staff',
                role='staff'
            )
            staff_user.set_password('staff123')  # Change this password!
            db.session.add(staff_user)
            print("[OK] Staff user created (username: staff, password: staff123)")
            print("     **IMPORTANT: Change this password after first login!**")
        else:
            print("[SKIP] Staff user already exists")
        
        # Option to create additional users
        print("\n" + "=" * 50)
        print("Additional User Creation")
        print("=" * 50)
        print("\nWhat type of users do you want to create?")
        print("  1. Student users (linked to student records)")
        print("  2. Staff user")
        print("  3. Admin user")
        print("  4. Skip")
        user_type_choice = input("Enter choice (1-4): ")
        
        if user_type_choice == '2':
            # Create staff user
            print("\n--- Create Staff User ---")
            username = input("Enter username: ")
            if not User.query.filter_by(username=username).first():
                password = input("Enter password: ")
                staff_user = User(
                    username=username,
                    role='staff'
                )
                staff_user.set_password(password)
                db.session.add(staff_user)
                print(f"[OK] Staff user created (username: {username})")
            else:
                print(f"[ERROR] Username '{username}' already exists")
        
        elif user_type_choice == '3':
            # Create admin user
            print("\n--- Create Admin User ---")
            username = input("Enter username: ")
            if not User.query.filter_by(username=username).first():
                password = input("Enter password: ")
                admin_user = User(
                    username=username,
                    role='admin'
                )
                admin_user.set_password(password)
                db.session.add(admin_user)
                print(f"[OK] Admin user created (username: {username})")
            else:
                print(f"[ERROR] Username '{username}' already exists")
        
        elif user_type_choice == '1':
            # Get all students
            students = Student.query.all()
            if not students:
                print("[INFO] No students found in database. Add students first.")
            else:
                print(f"\nFound {len(students)} student(s) in database:")
                for i, student in enumerate(students, 1):
                    print(f"  {i}. {student.name} (ID: {student.id})")
                
                print("\nCreate login for:")
                print("  1. All students")
                print("  2. Specific student")
                print("  3. Skip")
                choice = input("Enter choice (1-3): ")
                
                if choice == '1':
                    for student in students:
                        # Create username from student name
                        username = student.name.lower().replace(' ', '_')
                        if not User.query.filter_by(username=username).first():
                            student_user = User(
                                username=username,
                                role='student',
                                student_id=student.id
                            )
                            # Default password is studentXXX where XXX is the student ID
                            student_user.set_password(f'student{student.id}')
                            db.session.add(student_user)
                            print(f"[OK] Created login for {student.name}")
                            print(f"     Username: {username}, Password: student{student.id}")
                        else:
                            print(f"[SKIP] Login already exists for {student.name}")
                
                elif choice == '2':
                    student_id = int(input("Enter student ID: "))
                    student = Student.query.get(student_id)
                    if student:
                        username = input(f"Enter username for {student.name}: ")
                        password = input("Enter password: ")
                        
                        if not User.query.filter_by(username=username).first():
                            student_user = User(
                                username=username,
                                role='student',
                                student_id=student.id
                            )
                            student_user.set_password(password)
                            db.session.add(student_user)
                            print(f"[OK] Created login for {student.name}")
                        else:
                            print(f"[ERROR] Username '{username}' already exists")
                    else:
                        print("[ERROR] Student not found")
        
        # Commit all changes
        db.session.commit()
        print("\n" + "=" * 50)
        print("Setup complete!")
        print("=" * 50)
        print("\nYou can now log in at: http://localhost:5000/login")
        print("\nDefault credentials:")
        print("  Admin: username='admin', password='admin123'")
        print("  Staff: username='staff', password='staff123'")
        print("\n**Remember to change default passwords!**")
        print("\nRole Permissions:")
        print("  - Admin: Can create staff/admin accounts, manage all data")
        print("  - Staff: Can create student accounts, edit all student data")
        print("  - Student: Can view only their own data (read-only)")

if __name__ == '__main__':
    create_default_users()

