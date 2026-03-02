"""
Seed script: temporary database with generated test data for website testing.

Creates:
  - 40 students
  - 40 staff (Users with role staff or admin)
  - 100 school days of data (weekdays only)
  - For each student per day: one DailyRecord and one PeriodRecord per time period (16 periods)
  - STAR points: each data box (S, T, A, R) is in [0, 2] for every period
  - Random reminders, frenzies, infractions

Students are created without User accounts (no usernames/passwords), so they appear in the
Archived Students table—this avoids creating 40 student logins for testing. Each student
has team_members filled for Case Manager, Practitioner, Professional, and Group Leader.

Run from project root:
  python seed_test_data.py [--db PATH] [--clear]

  --db PATH   Use this SQLite database file (default: instance/behavior_tracking_test.db).
  --clear     Drop and recreate tables before seeding (only for the target DB).
  --use-main  Seed the main app DB (instance/behavior_tracking.db). Use with care.

To run the app against the test database:
  Windows:  set USE_TEST_DB=1
  Unix:     export USE_TEST_DB=1
  Then start the app as usual; it will use instance/behavior_tracking_test.db.

Alternatively, copy behavior_tracking_test.db to behavior_tracking.db (back up the original first).
"""

import os
import sys
import random
import argparse
import json
from datetime import date, timedelta
from decimal import Decimal
from werkzeug.security import generate_password_hash

# Add project root so we can import app
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# Standard periods matching static/app.js STANDARD_PERIODS
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
    ("PM Bus", "Bus"),
]

INFRACTION_TYPES_GENERAL = [
    "Lang", "NFD", "Off Task", "MYOB", "Self Control", "Shutdown",
    "Volume", "Attention Seeking", "Refusal", "Personal Space",
]
INFRACTION_TYPES_HARMFUL = [
    "Walk", "Aggression", "Property Destruction", "Sexual Reference", "Threat", "Disrespectful",
]

FRENZY_PURPOSES = ["Sensory", "Escape", "Attention", "Tangible", "Unknown"]
FRENZY_RESULTS = ["Redirected", "De-escalated", "Room clear", "Recovery", "Unknown"]


def random_star_value():
    """STAR points: min 0, max 2 per box."""
    return random.randint(0, 2)


def generate_school_days(count=100, end_date=None):
    """Generate `count` weekdays (Mon–Fri) going backwards from end_date (default: today)."""
    if end_date is None:
        end_date = date.today()
    days = []
    d = end_date
    while len(days) < count:
        if d.weekday() < 5:  # Monday=0 .. Friday=4
            days.append(d)
        d -= timedelta(days=1)
    days.reverse()
    return days


def main():
    parser = argparse.ArgumentParser(description="Seed test data for behavior tracking app")
    parser.add_argument("--db", default=None, help="SQLite path (default: instance/behavior_tracking_test.db)")
    parser.add_argument("--clear", action="store_true", help="Drop and recreate tables before seeding")
    parser.add_argument("--use-main", action="store_true", help="Use main app DB (instance/behavior_tracking.db)")
    args = parser.parse_args()

    root = os.path.dirname(os.path.abspath(__file__))
    instance_path = os.path.join(root, "instance")
    os.makedirs(instance_path, exist_ok=True)

    if args.use_main:
        db_path = os.path.join(instance_path, "behavior_tracking.db")
        print("Using MAIN database:", db_path)
    elif args.db:
        db_path = os.path.abspath(args.db)
        print("Using database:", db_path)
    else:
        db_path = os.path.join(instance_path, "behavior_tracking_test.db")
        print("Using TEST database:", db_path)

    from app import app, db, User, Student, DailyRecord, PeriodRecord, Infraction, FrenzyEvent, TeamMember

    # Use the chosen DB path (must set before any db. operation so the engine uses it)
    app.config["SQLALCHEMY_DATABASE_URI"] = f"sqlite:///{db_path.replace(os.sep, '/')}"

    with app.app_context():
        if args.clear:
            print("Dropping all tables...")
            db.drop_all()
        db.create_all()

        num_students = 40
        num_staff = 40
        num_days = 100

        # ----- Students -----
        print("Creating", num_students, "students...")
        students = []
        for i in range(1, num_students + 1):
            s = Student(
                name=f"Test Student {i}",
                email=f"student{i}@test.example",
                grade=random.choice(["9", "10", "11", "12"]),
                card_color=random.choice(["yellow", "green", "blue", None]),
            )
            db.session.add(s)
            students.append(s)
        db.session.flush()

        # ----- Staff (Users) -----
        print("Creating", num_staff, "staff users...")
        staff_users = []
        # Ensure a good mix of designations so TeamMember roles map correctly
        designation_cycle = ["Case Manager", "Practitioner", "Professional", "Paraprofessional"]
        for i in range(1, num_staff + 1):
            role = "admin" if i == 1 else "staff"
            designation = designation_cycle[(i - 1) % len(designation_cycle)]
            u = User(
                name=f"Staff Member {i}",
                username=f"staff{i}",
                password_hash=generate_password_hash("test123"),
                role=role,
                designation=designation,
            )
            db.session.add(u)
            staff_users.append(u)
        db.session.flush()

        # ----- Student Users (active students) -----
        print("Creating student user accounts (active students)...")
        for idx, s in enumerate(students, start=1):
            su = User(
                name=s.name,
                username=f"student{idx}",
                password_hash=generate_password_hash("test123"),
                role="student",
                student_id=s.id,
            )
            db.session.add(su)
        db.session.flush()

        # Index staff by designation for accurate role mapping
        staff_by_designation = {}
        for u in staff_users:
            staff_by_designation.setdefault(u.designation, []).append(u)

        # ----- TeamMember: each student gets all four roles with matching staff designations -----
        print("Linking staff to students (TeamMember)...")
        for s in students:
            # Case Manager -> staff.designation == "Case Manager"
            cm_pool = staff_by_designation.get("Case Manager") or staff_users
            cm_user = random.choice(cm_pool)
            db.session.add(TeamMember(
                student_id=s.id,
                role="Case Manager",
                name=cm_user.name,
                email=f"{cm_user.username}@test.example",
            ))

            # Practitioner -> staff.designation == "Practitioner"
            pr_pool = staff_by_designation.get("Practitioner") or staff_users
            pr_user = random.choice(pr_pool)
            db.session.add(TeamMember(
                student_id=s.id,
                role="Practitioner",
                name=pr_user.name,
                email=f"{pr_user.username}@test.example",
            ))

            # Professional -> staff.designation == "Professional"
            prof_pool = staff_by_designation.get("Professional") or staff_users
            prof_user = random.choice(prof_pool)
            db.session.add(TeamMember(
                student_id=s.id,
                role="Professional",
                name=prof_user.name,
                email=f"{prof_user.username}@test.example",
            ))

            # Group Leader -> use staff with Practitioner designation (matches app's Practitioner/Group Leader pairing)
            gl_pool = staff_by_designation.get("Practitioner") or staff_users
            gl_user = random.choice(gl_pool)
            db.session.add(TeamMember(
                student_id=s.id,
                role="Group Leader",
                name=gl_user.name,
                email=f"{gl_user.username}@test.example",
            ))

        db.session.flush()

        # ----- 100 school days -----
        school_days = generate_school_days(num_days)
        print("Generating", len(school_days), "school days from", school_days[0], "to", school_days[-1])

        total_periods_created = 0
        total_infractions = 0
        total_frenzy_events = 0

        for day_date in school_days:
            day_of_week = day_date.strftime("%A")
            for student in students:
                # Decide attendance for this student-day:
                # ~80% present, 10% excused, 10% unexcused
                r = random.random()
                if r < 0.8:
                    attendance_status = "present"
                elif r < 0.9:
                    attendance_status = "excused"
                else:
                    attendance_status = "unexcused"

                dr = DailyRecord(
                    student_id=student.id,
                    date=day_date,
                    day_of_week=day_of_week,
                    attendance_status=attendance_status,
                    present=(attendance_status == "present"),
                )
                db.session.add(dr)
                db.session.flush()

                # Only present days get STAR period data and frenzy events.
                if attendance_status != "present":
                    continue

                for time_range, location in STANDARD_PERIODS:
                    # STAR: each box 0–2
                    s_pts = random_star_value()
                    t_pts = random_star_value()
                    a_pts = random_star_value()
                    r_pts = random_star_value()

                    # Random reminders/reset in info JSON
                    info_obj = {}
                    if random.random() < 0.15:
                        info_obj["reminder1"] = "Reminder note"
                    if random.random() < 0.10:
                        info_obj["reminder2"] = "Second reminder"
                    if random.random() < 0.05:
                        info_obj["reminder3"] = "Third reminder"
                    if random.random() < 0.08:
                        info_obj["reset"] = True

                    frenzy_this_period = random.random() < 0.05
                    if frenzy_this_period:
                        info_obj["frenzy"] = True
                        info_obj["duration"] = random.randint(1, 25)

                    info_str = json.dumps(info_obj) if info_obj else None

                    pr = PeriodRecord(
                        daily_record_id=dr.id,
                        time_range=time_range,
                        location=location,
                        safety_points=s_pts,
                        teamwork_points=t_pts,
                        accountability_points=a_pts,
                        relationships_points=r_pts,
                        points_possible=4,
                        reset=info_obj.get("reset", False),
                        frenzy=frenzy_this_period,
                        notes="Test note" if random.random() < 0.1 else None,
                        reminders="Test reminder" if random.random() < 0.1 else None,
                        info=info_str,
                    )
                    db.session.add(pr)
                    db.session.flush()
                    total_periods_created += 1

                    # Random infractions (0–2 per period, ~20% of periods)
                    if random.random() < 0.20:
                        n_inf = random.randint(1, 2)
                        for _ in range(n_inf):
                            is_harmful = random.random() < 0.2
                            types_list = INFRACTION_TYPES_HARMFUL if is_harmful else INFRACTION_TYPES_GENERAL
                            inf = Infraction(
                                period_record_id=pr.id,
                                infraction_type=random.choice(types_list),
                                count=random.randint(1, 3),
                                is_general=not is_harmful,
                                is_harmful=is_harmful,
                            )
                            db.session.add(inf)
                            total_infractions += 1

                # Standalone FrenzyEvent on some days (~8% of student-days)
                if attendance_status == "present" and random.random() < 0.08:
                    fe = FrenzyEvent(
                        daily_record_id=dr.id,
                        time_range=random.choice([p[0] for p in STANDARD_PERIODS]),
                        location=random.choice(list({p[1] for p in STANDARD_PERIODS})),
                        purpose=random.choice(FRENZY_PURPOSES),
                        purpose2=random.choice(FRENZY_PURPOSES) if random.random() < 0.5 else None,
                        duration_minutes=random.randint(1, 30),
                        result=random.choice(FRENZY_RESULTS),
                    )
                    db.session.add(fe)
                    total_frenzy_events += 1

            if len(school_days) <= 10 or (school_days.index(day_date) + 1) % 20 == 0:
                db.session.commit()
                print("  Committed through", day_date)

        db.session.commit()
        print("Done.")
        print("  Students:", num_students)
        print("  Staff:", num_staff)
        print("  School days:", num_days)
        print("  Period records (STAR filled 0–2 per box):", total_periods_created)
        print("  Infractions:", total_infractions)
        print("  Frenzy events (FrenzyEvent):", total_frenzy_events)
        print()
        if not args.use_main and not args.db:
            print("To run the app with this test DB:")
            print("  Set USE_TEST_DB=1 (Windows: set USE_TEST_DB=1) then start the app.")
            print("  Or backup behavior_tracking.db and copy behavior_tracking_test.db to it.")
        print("  Staff logins: staff1, staff2, ... staff40 (password: test123). staff1 is admin.")
        print()


if __name__ == "__main__":
    main()
