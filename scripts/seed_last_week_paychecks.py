"""Seed last week's point cards for Test Students 1/10/11, then regenerate paychecks."""

import json
from datetime import date, datetime, timedelta
from decimal import Decimal

from app import (
    DailyRecord,
    Paycheck,
    PeriodRecord,
    Student,
    app,
    calculate_weekly_star_percent,
    count_weekly_infractions,
    db,
    fill_paycheck_amounts,
    get_or_create_starbucks_balance,
    live_paycheck_amounts,
)

STANDARD_PERIODS = [
    ("AM Bus", "Bus"),
    ("7:45-8:30", "Bkfst"),
    ("8:30-9:00", "English"),
    ("9:00-9:30", "Math"),
    ("9:30-10:00", "Science"),
    ("10:00-10:30", "Group"),
    ("10:30-11:00", "Group"),
    ("11:00-11:30", "Individual"),
    ("11:30-12:00", "Lunch"),
    ("12:00-12:30", "Phys Ed"),
    ("12:30-1:00", "Social"),
    ("1:00-1:30", "Individual"),
    ("1:30-2:00", "Studio"),
    ("2:00-2:30", "Studio"),
    ("2:30-2:45", "Homeroom"),
]

PLANS = {
    "Test Student 1": {
        # 4 paid days (1 excused) — wait, present+excused = 5 paid
        "attendance": ["present", "present", "present", "excused", "present"],
        "star_pattern": [2, 2, 2, 1],  # ~87.5%
        "starbucks": 2,
        # Citations live in period Additional Information (info JSON)
        "citations": [("Off Task", 2), ("Lang", 1)],
    },
    "Test Student 10": {
        "attendance": ["present", "present", "unexcused", "present", "present"],
        "star_pattern": [2, 2, 1, 2],
        "starbucks": 1,
        "citations": [("Off Task", 1)],
    },
    "Test Student 11": {
        "attendance": ["present", "present", "present", "present", "present"],
        "star_pattern": [2, 2, 2, 2],
        "starbucks": 0,
        "citations": [],
    },
}


def main():
    with app.app_context():
        today = date.today()
        this_monday = today - timedelta(days=today.weekday())
        start = this_monday - timedelta(days=7)
        days = [start + timedelta(days=i) for i in range(5)]
        end = days[-1]
        print("Seeding period", start, "to", end)

        names = list(PLANS.keys())
        students = {s.name: s for s in Student.query.filter(Student.name.in_(names)).all()}
        for name in names:
            if name not in students:
                raise SystemExit(f"missing {name}")

        for s in students.values():
            existing = DailyRecord.query.filter(
                DailyRecord.student_id == s.id,
                DailyRecord.date >= start,
                DailyRecord.date <= end,
            ).all()
            for dr in existing:
                db.session.delete(dr)
        db.session.flush()
        print("Cleared prior daily records for the week")

        seeded_days = 0
        seeded_periods = 0
        for name, plan in PLANS.items():
            s = students[name]
            pattern = plan["star_pattern"]
            pi = 0
            for day, status in zip(days, plan["attendance"]):
                dr = DailyRecord(
                    student_id=s.id,
                    date=day,
                    day_of_week=day.strftime("%A"),
                    attendance_status=status,
                    present=(status == "present"),
                    submitted_at=datetime.utcnow() if status == "present" else None,
                )
                db.session.add(dr)
                db.session.flush()
                seeded_days += 1
                if status != "present":
                    continue
                period_records = []
                for time_range, location in STANDARD_PERIODS:
                    vals = []
                    for _ in range(4):
                        vals.append(str(pattern[pi % len(pattern)]))
                        pi += 1
                    pr = PeriodRecord(
                        daily_record_id=dr.id,
                        time_range=time_range,
                        location=location,
                        safety_points=vals[0],
                        teamwork_points=vals[1],
                        accountability_points=vals[2],
                        relationships_points=vals[3],
                        points_possible=4,
                        reset=False,
                        frenzy=False,
                    )
                    db.session.add(pr)
                    db.session.flush()
                    period_records.append(pr)
                    seeded_periods += 1

                # Attach planned citations to the first present day's early periods
                # via Additional Information (period.info), matching the live point card.
                if day == days[0] and plan.get("citations"):
                    for idx, (inf_type, count) in enumerate(plan["citations"]):
                        if idx >= len(period_records):
                            break
                        period_records[idx].info = json.dumps(
                            {
                                "infraction1": inf_type,
                                "infraction1Count": int(count),
                            }
                        )

            bal = get_or_create_starbucks_balance(s.id)
            bal.count = plan["starbucks"]
            bal.updated_at = datetime.utcnow()

        db.session.flush()
        print("Seeded", seeded_days, "daily records and", seeded_periods, "periods")

        for name in names:
            s = students[name]
            avg = calculate_weekly_star_percent(s.id, start, end)
            cit = count_weekly_infractions(s.id, start, end)
            p = Paycheck.query.filter_by(
                student_id=s.id, pay_period_start=start, pay_period_end=end
            ).first()
            if p and (p.is_verified or p.deposited_at):
                print(name, "skipped deposited", p.id)
                continue
            if not p:
                p = Paycheck(
                    student_id=s.id,
                    pay_period_start=start,
                    pay_period_end=end,
                    average_star_percent=avg,
                    base_pay=Decimal("0.00"),
                    citation_count=cit,
                    citation_deduction=Decimal("0.00"),
                    final_pay=Decimal("0.00"),
                    pay_track=(getattr(s, "pay_track", None) or "simple"),
                )
                db.session.add(p)
                db.session.flush()
                action = "created"
            else:
                p.worksheet_completed = False
                p.student_worksheet_json = None
                p.student_calculated_pay = None
                p.student_calculated_final = None
                p.student_calculated_gross = None
                p.student_calculated_ss = None
                p.student_calculated_medicare = None
                p.student_calculated_federal = None
                p.student_calculated_deduction = None
                p.student_calculated_citations = None
                action = "updated"
            fill_paycheck_amounts(p, s, avg, cit)
            live = live_paycheck_amounts(p)
            print(
                action,
                name,
                f"id={p.id}",
                f"days={live['days_worked']} excused={live['excused_days']}",
                f"star={float(live['avg_pct']):.2f}%",
                f"cites={live['citation_count']} (${live['citation_deduction']})",
                f"rate={live['daily_rate']}",
                f"sb={live['starbucks_count']}",
                f"gross={live['gross']}",
                f"net={live['final_pay']}",
            )

        db.session.commit()
        print("DONE")


if __name__ == "__main__":
    main()
