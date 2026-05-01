"""Quick date-range sanity check for daily_records (uses Flask app DB config)."""
from sqlalchemy import text

from app import app, db


def main():
    with app.app_context():
        r = db.session.execute(
            text("SELECT MIN(date), MAX(date), COUNT(*) FROM daily_records")
        ).fetchone()
        print(f"daily_records: {r[0]} to {r[1]} ({r[2]} records)")


if __name__ == "__main__":
    main()
