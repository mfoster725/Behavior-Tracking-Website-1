"""
One-off migration: ensure every archived Student has a student User row again.

Archived students are exactly those with no User where role='student' and
student_id matches (same definition as get_archived_students() in app.py).
This mirrors restore_student_user() — it does not change archiving behavior.

Usage (repository root):

    python migrate_restore_archived_students_to_current.py

    # Rename accounts created with stu_restore_* usernames to initials-based names
    # (same algorithm as generate_student_username in app.py):
    python migrate_restore_archived_students_to_current.py --fix-usernames

Environment:

    ARCHIVED_RESTORE_DRY_RUN=1     Print actions only; no DB writes.

    ARCHIVED_RESTORE_PASSWORD      If set (min 6 chars), use this password for
                                   every new account. Otherwise each account
                                   gets a random password (printed once).

Password strength uses validate_password_strength() from app.py.

Student.name normally holds initials (≤4 chars; see User Management). Usernames use
generate_student_username(): lowercase seed, then base2, base3, … until unique (CSV
import). If Student.name looks like a full name (spaces or length > 4), initials are
derived from the first alphabetic letter of each word (up to four).
"""
from __future__ import annotations

import argparse
import os
import secrets
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)
os.chdir(ROOT)

from app import app, db, Student, User, generate_student_username, validate_password_strength


def iter_archived_students():
    student_users = User.query.filter_by(role="student").all()
    active_student_ids = {u.student_id for u in student_users if u.student_id}
    if not active_student_ids:
        return Student.query.order_by(Student.name).all()
    return (
        Student.query.filter(~Student.id.in_(active_student_ids))
        .order_by(Student.name)
        .all()
    )


def initials_seed_for_username(student: Student) -> str:
    raw = (student.name or "").strip()
    if not raw:
        return ""
    if len(raw) <= 4 and " " not in raw:
        return raw
    initials = []
    for word in raw.split():
        for ch in word:
            if ch.isalpha():
                initials.append(ch.upper())
                break
        if len(initials) >= 4:
            break
    return "".join(initials) if initials else raw[:4].upper()


def username_from_student_initials(student: Student) -> str:
    """Unique username from initials seed (same uniqueness rules as CSV student import)."""
    return generate_student_username(initials_seed_for_username(student))


def fix_stu_restore_usernames(*, dry: bool) -> None:
    """Rename student users whose username looks like bulk restore placeholders."""
    users = (
        User.query.filter(
            User.role == "student",
            User.username.like("stu_restore_%"),
        )
        .order_by(User.student_id.asc())
        .all()
    )
    print(f"Found {len(users)} student user(s) with stu_restore_* username(s).")

    updated = 0
    for user in users:
        student = db.session.get(Student, user.student_id) if user.student_id else None
        if not student:
            print(f"  Skip user id={user.id}: missing student row")
            continue

        old = user.username
        new_name = username_from_student_initials(student)
        if old == new_name:
            print(f"  Skip user id={user.id}: already {new_name!r}")
            continue

        if dry:
            print(f"  [dry-run] user id={user.id} student_id={student.id}: {old!r} -> {new_name!r}")
            updated += 1
            continue

        user.username = new_name
        db.session.commit()
        print(f"  Renamed user id={user.id} student_id={student.id}: {old!r} -> {new_name!r}")
        updated += 1

    print(f"Done. Renamed: {updated}.")


def main() -> None:
    parser = argparse.ArgumentParser(description="Restore archived students or fix restore usernames.")
    parser.add_argument(
        "--fix-usernames",
        action="store_true",
        help="Rename stu_restore_* student accounts to initials-based usernames (generate_student_username).",
    )
    args = parser.parse_args()

    dry = os.environ.get("ARCHIVED_RESTORE_DRY_RUN", "").strip() == "1"
    shared_pw = os.environ.get("ARCHIVED_RESTORE_PASSWORD", "").strip()

    with app.app_context():
        if args.fix_usernames:
            fix_stu_restore_usernames(dry=dry)
            return

        archived = iter_archived_students()
        print(f"Found {len(archived)} archived student record(s).")

        created = 0
        for student in archived:
            if User.query.filter_by(student_id=student.id, role="student").first():
                continue

            username = username_from_student_initials(student)
            if shared_pw:
                password = shared_pw
            else:
                password = secrets.token_urlsafe(16)
                if len(password) < 6:
                    password = secrets.token_hex(8)

            ok, err = validate_password_strength(password)
            if not ok:
                print(f"  ERROR student_id={student.id} ({student.name}): {err}")
                continue

            display_name = student.name or ""

            if dry:
                print(
                    f"  [dry-run] student_id={student.id} ({display_name}) "
                    f"-> username={username!r}"
                )
                created += 1
                continue

            user = User(
                name=display_name or None,
                username=username,
                role="student",
                student_id=student.id,
            )
            user.set_password(password)
            db.session.add(user)
            db.session.commit()

            pw_note = (
                f"password=<from ARCHIVED_RESTORE_PASSWORD>"
                if shared_pw
                else f"temp_password={password!r}"
            )
            print(
                f"  Created user id={user.id} username={username!r} "
                f"student_id={student.id} ({display_name}) {pw_note}"
            )
            created += 1

        print(f"Done. New accounts created: {created}.")


if __name__ == "__main__":
    main()
