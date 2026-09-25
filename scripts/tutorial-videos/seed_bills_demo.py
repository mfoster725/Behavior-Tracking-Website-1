#!/usr/bin/env python3
"""
Populate realistic Bills data for one seeded test student, for recording 06-bills.js.

seed_test_data.py alone leaves every student with bills turned off and $0 balances —
enrolling a student "for real" through the UI only starts billing them the following
Monday, and paychecks sit undeposited until a student completes the paycheck-math
worksheet. None of that gives a recorder script anything to show. This script instead:

  1. Turns weekly bills on for one student, backdating their enrollment so this week's
     bills are already issued (rather than "first bills arrive next Monday").
  2. Credits their checking account directly (bypassing the paycheck-worksheet flow)
     so there's real money to pay bills with.
  3. Calls the same maintenance routine the nightly cron uses, to issue this week's
     bills against their (default) cost-of-living plan.

Run against the same test DB the app and recorder scripts use:

    set USE_TEST_DB=1
    python scripts/tutorial-videos/seed_bills_demo.py
    python scripts/tutorial-videos/seed_bills_demo.py --student "Test Student 12" --checking 500
"""
import argparse
import os
import sys
from datetime import datetime, timedelta

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--student', default='Test Student 10',
                         help='Student name to enroll (default: Test Student 10 — managed by staff25 in seed_test_data.py).')
    parser.add_argument('--checking', type=float, default=700.0, help='Checking balance to set (default: 700).')
    parser.add_argument('--weeks-enrolled', type=int, default=4,
                         help='How many weeks back to backdate enrollment, so this week is billable (default: 4).')
    args = parser.parse_args()

    os.environ.setdefault('USE_TEST_DB', '1')
    sys.path.insert(0, REPO_ROOT)
    import app as appmod

    application = appmod.app
    db = appmod.db

    with application.app_context():
        student = appmod.Student.query.filter_by(name=args.student).first()
        if not student:
            sys.exit(f"No student named {args.student!r} — run seed_test_data.py first.")

        budget = appmod.StudentBudget.query.filter_by(student_id=student.id).first()
        if budget is None:
            budget = appmod.StudentBudget(student_id=student.id)
            db.session.add(budget)
        budget.enrolled = True
        budget.enrolled_at = datetime.utcnow() - timedelta(days=7 * args.weeks_enrolled)

        account = appmod.get_or_create_bank_account(student.id)
        account.balance = args.checking
        db.session.commit()
        print(f"{args.student} (id={student.id}): enrolled_at={budget.enrolled_at}, checking={account.balance}")

    # Issue this week's bills the same way the nightly cron / "Generate now" admin
    # action would — run inside a throwaway test client so it goes through the real
    # route (and its @staff_required / login checks) rather than calling internals.
    with application.test_client() as client:
        client.post('/login', json={'username': 'staff25', 'password': 'test123'})
        resp = client.post('/api/economy/generate')
        print('generate:', resp.status_code, resp.get_data(as_text=True))


if __name__ == '__main__':
    main()
