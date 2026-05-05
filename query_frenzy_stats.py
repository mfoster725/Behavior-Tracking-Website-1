"""
Print frenzy_events totals; if a severity column exists, print counts by severity.

Uses the same SQLAlchemy engine as the Flask app (DATABASE_URL / SQLite logic in app.py).
"""
from sqlalchemy import inspect, text

from app import app, db


def main():
    with app.app_context():
        insp = inspect(db.engine)
        try:
            cols = {c["name"] for c in insp.get_columns("frenzy_events")}
        except Exception as e:
            print(f"[ERROR] Could not inspect frenzy_events: {e}")
            return

        total = db.session.execute(text("SELECT COUNT(*) FROM frenzy_events")).scalar()
        print(f"Total frenzy events: {total}")

        if "severity" not in cols:
            print(
                "(No `severity` column on frenzy_events — run migrate_frenzy_severity.py "
                "after adding the column if you use severity tracking.)"
            )
            return

        rows = db.session.execute(
            text(
                """
                SELECT severity, COUNT(*) AS n
                FROM frenzy_events
                GROUP BY severity
                ORDER BY severity IS NULL DESC, severity
                """
            )
        ).fetchall()
        labels = {
            1: "Para (1)",
            2: "Professional (2)",
            3: "Response Team (3)",
            4: "Administration (4)",
            5: "SRO (5)",
        }
        print("\nBy severity:")
        for sev, n in rows:
            key = labels.get(sev, f"severity={sev!r}")
            print(f"  {key}: {n}")


if __name__ == "__main__":
    main()
