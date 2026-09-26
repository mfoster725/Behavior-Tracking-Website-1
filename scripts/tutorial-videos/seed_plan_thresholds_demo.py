#!/usr/bin/env python3
"""
Populate a real Student Plan with met/delivered threshold history, for recording
20-reports-plan-thresholds.js.

seed_test_data.py alone leaves every student with no plan at all — Plan Thresholds
always reads "0 mets" and the drill-down card has nothing to show. This script gives
one seeded student a plan with two If/Then rows (one with a point-card threshold) and
backdates a handful of PlanThresholdEvent rows so the Reports tile and its drill-down
both have real data to demo.

Run against the same test DB the app and recorder scripts use:

    set USE_TEST_DB=1
    python scripts/tutorial-videos/seed_plan_thresholds_demo.py
"""
import argparse
import os
import sys
from datetime import datetime, timedelta

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--student', default='Test Student 1', help='Student name to give a plan (default: Test Student 1).')
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

        plan = appmod.StudentPlan.query.filter_by(student_id=student.id).first()
        if plan is None:
            plan = appmod.StudentPlan(student_id=student.id)
            db.session.add(plan)
            db.session.flush()

        # Clear any prior demo rows so re-running this script is idempotent.
        appmod.PlanThresholdEvent.query.filter_by(student_id=student.id).delete()
        appmod.StudentPlanRow.query.filter_by(plan_id=plan.id).delete()
        db.session.flush()

        row1 = appmod.StudentPlanRow(
            plan_id=plan.id, sort_order=0,
            if_text='STAR percent drops below 70% before lunch',
            then_text='Check in with the case manager for a reset',
            has_threshold=True, threshold_percent=70, threshold_type='end_of_day', cutoff_time='11:30',
        )
        row2 = appmod.StudentPlanRow(
            plan_id=plan.id, sort_order=1,
            if_text='Three Task infractions in one day',
            then_text='Offer a five-minute break before the next period',
            has_threshold=True, threshold_percent=0, threshold_type='specific_period',
        )
        db.session.add_all([row1, row2])
        db.session.flush()

        now = datetime.utcnow()
        events = []
        for i in range(5):
            met_at = now - timedelta(days=7 * (i + 1))
            events.append(appmod.PlanThresholdEvent(
                student_id=student.id, plan_row_id=row1.id,
                if_normalized=row1.if_text, window_key=f'row1-{i}',
                met_at=met_at,
                delivered_at=met_at + timedelta(minutes=15) if i < 4 else None,
            ))
        for i in range(2):
            met_at = now - timedelta(days=10 * (i + 1))
            events.append(appmod.PlanThresholdEvent(
                student_id=student.id, plan_row_id=row2.id,
                if_normalized=row2.if_text, window_key=f'row2-{i}',
                met_at=met_at, delivered_at=met_at + timedelta(minutes=5),
            ))
        db.session.add_all(events)
        db.session.commit()
        print(f"{args.student} (id={student.id}): plan_id={plan.id}, rows=2, threshold_events={len(events)}")


if __name__ == '__main__':
    main()
