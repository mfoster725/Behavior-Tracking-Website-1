#!/usr/bin/env python3
"""
Populate realistic Notification rows for one seeded staff login, for recording
29-notifications.js.

seed_test_data.py doesn't create any Notification rows at all, so a fresh test
DB always shows an empty bell. This script instead:

  1. Has a seeded student (Test Student 10) submit a real marketplace purchase
     through the actual checkout route, which fires the app's own
     notify_support_team_purchase_order_pending() to everyone on that
     student's support team — a real, clickable "New purchase order"
     notification with a working deep link into Marketplace -> PO Approvals.
  2. Hand-inserts one unread "missing_point_card" notification (the same
     shape notify_missing_point_card_entries() would have created) for the
     same recipient, so the dropdown also demonstrates the Daily Entry
     deep-link/scroll-to-student behavior.
  3. Hand-inserts one already-read notification so the dropdown shows both
     the unread (tinted) and read states, and "Show read notifications".

Run against the same test DB the app and recorder scripts use:

    set USE_TEST_DB=1
    python scripts/tutorial-videos/seed_notifications_demo.py
"""
import argparse
import os
import sys
from datetime import date, datetime, timedelta

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--student', default='Test Student 10',
                         help='Student name whose support team receives the demo notifications '
                              '(default: Test Student 10 — already has bills seeded by seed_bills_demo.py).')
    parser.add_argument('--item', default='Gum', help='Marketplace item name to buy (default: Gum).')
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

        student_user = appmod.User.query.filter_by(student_id=student.id, role='student').first()
        if not student_user:
            sys.exit(f"{args.student!r} has no student login — run seed_test_data.py first.")

        case_manager = appmod.get_student_case_manager(student.id)
        if not case_manager:
            sys.exit(f"{args.student!r} has no Case Manager on their support team.")

        account = appmod.get_or_create_bank_account(student.id)
        if account.balance < 100:
            account.balance = 700.0
            db.session.commit()

        student_username = student_user.username
        recipient_username = case_manager.username
        print(f"Recipient (case manager): {recipient_username}")
        print(f"Student login for checkout: {student_username}")

    # 1. Real purchase -> real purchase_order_pending notification, via the
    #    actual route (so it goes through every real check the UI would).
    with application.test_client() as client:
        login_resp = client.post('/login', json={'username': student_username, 'password': 'test123'})
        if login_resp.status_code != 200:
            sys.exit(f"Login as {student_username} failed: {login_resp.status_code} {login_resp.get_data(as_text=True)}")
        with application.app_context():
            item = appmod.MarketplaceItem.query.filter_by(name=args.item, is_active=True).first()
            if not item:
                sys.exit(f"No active marketplace item named {args.item!r}.")
            item_id = item.id
        checkout_resp = client.post('/api/marketplace/checkout', json={'cart': [{'item_id': item_id, 'quantity': 1}]})
        print('checkout:', checkout_resp.status_code, checkout_resp.get_data(as_text=True))
        if checkout_resp.status_code != 201:
            sys.exit("Checkout failed — see response above.")

    # 2 & 3. Hand-inserted notifications for the same recipient.
    with application.app_context():
        student = appmod.Student.query.filter_by(name=args.student).first()
        case_manager = appmod.get_student_case_manager(student.id)

        yesterday = date.today() - timedelta(days=1)
        gaps = [
            {'time_range': '9:00-9:30', 'categories': ['Safety', 'Teamwork']},
            {'time_range': '9:30-10:00', 'categories': ['Safety', 'Teamwork', 'Accountability', 'Relationships']},
        ]
        body = appmod._missing_points_body(student.name, yesterday, gaps, False)
        db.session.add(appmod.Notification(
            user_id=case_manager.id,
            type='missing_point_card',
            title=f'Missing points: {student.name}',
            body=body,
            student_id=student.id,
            record_date=yesterday,
        ))

        last_week = datetime.utcnow() - timedelta(days=6)
        read_notification = appmod.Notification(
            user_id=case_manager.id,
            type='purchase_approved',
            title='Purchase approved',
            body=f'Your approval for {student.name}’s earlier order went through.',
            student_id=student.id,
            created_at=last_week,
            read_at=last_week + timedelta(minutes=20),
        )
        db.session.add(read_notification)
        db.session.commit()

        count = appmod.Notification.query.filter_by(user_id=case_manager.id).count()
        print(f"{case_manager.username} now has {count} notification(s).")


if __name__ == '__main__':
    main()
