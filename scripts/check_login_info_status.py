#!/usr/bin/env python3
"""Report student login-info email status from the app database."""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

os.environ.setdefault('USE_LOCAL_DB', '1')

from app import app, db, User, Student  # noqa: E402


def main():
    with app.app_context():
        students = (
            User.query.filter(
                User.role == 'student',
                db.or_(User.hidden_from_management.is_(False), User.hidden_from_management.is_(None)),
            )
            .order_by(User.username)
            .all()
        )

        sent = []
        not_sent = []
        skipped = []

        for user in students:
            name = (user.name or '').strip()
            if user.student_id:
                st = Student.query.get(user.student_id)
                if st and st.name:
                    name = st.name
            entry = {
                'username': user.username,
                'name': name,
                'email': getattr(user, 'email', None),
                'sent_at': getattr(user, 'login_info_sent_at', None),
                'skipped_at': getattr(user, 'login_info_skipped_at', None),
            }
            if entry['skipped_at']:
                skipped.append(entry)
            elif entry['sent_at']:
                sent.append(entry)
            else:
                not_sent.append(entry)

        print(f"Total students: {len(students)}")
        print(f"Sent: {len(sent)} | Not sent: {len(not_sent)} | Skipped (no email): {len(skipped)}")
        print()

        if sent:
            print("=== SENT ===")
            for e in sent:
                print(f"  {e['username']:8}  {e['name']:<30}  {e['sent_at']}")
            print()

        if not_sent:
            print("=== NOT SENT ===")
            for e in not_sent:
                print(f"  {e['username']:8}  {e['name']}")
            print()

        if skipped:
            print("=== SKIPPED (no email on file) ===")
            for e in skipped:
                print(f"  {e['username']:8}  {e['name']}")
            print()


if __name__ == '__main__':
    main()
