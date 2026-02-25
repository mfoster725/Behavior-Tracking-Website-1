"""Print current (active) students from the database. Run: py list_students.py"""
from app import app, db
from app import Student, User

with app.app_context():
    # Active = has a User account with role='student'
    student_users = User.query.filter_by(role='student').all()
    active_student_ids = {u.student_id for u in student_users if u.student_id}
    if active_student_ids:
        current = Student.query.filter(Student.id.in_(active_student_ids)).order_by(Student.name).all()
    else:
        current = []
    # All students in the students table (for reference)
    all_students = Student.query.order_by(Student.name).all()

    print("=== Current (active) students ===")
    if not current:
        print("  (none – no student user accounts linked)")
    else:
        for s in current:
            print(f"  {s.id}: {s.name}  (grade: {s.grade or '-'}, email: {s.email or '-'})")
    print(f"\nTotal current: {len(current)}")
    print(f"Total in database (including archived): {len(all_students)}")
