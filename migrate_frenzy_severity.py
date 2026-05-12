"""
Ensure frenzy_events.severity exists and backfill NULL severities to 1 (Para).

SQLite: same default path as app.py (LOCALAPPDATA/BehaviorTracking first,
then instance/behavior_tracking.db). Use --db for an explicit file.
PostgreSQL: set DATABASE_URL.
"""
import argparse
import os
import sys

from migrate_add_student_id_index import normalize_database_url  # reuse URL + SSL helpers


def default_sqlite_behavior_tracking_path():
    """Match app.py local SQLite resolution so migrations hit the DB Flask uses."""
    project_root = os.path.dirname(os.path.abspath(__file__))
    instance_path = os.path.join(project_root, "instance")
    local_appdata = os.environ.get("LOCALAPPDATA") or os.path.expanduser("~")
    default_local_db_dir = os.path.join(local_appdata, "BehaviorTracking")
    local_db_dir = os.environ.get("LOCAL_DB_DIR", default_local_db_dir)
    legacy_db_path = os.path.join(instance_path, "behavior_tracking.db")
    local_db_path = os.path.join(local_db_dir, "behavior_tracking.db")

    if os.path.isfile(local_db_path):
        return local_db_path
    if os.path.isfile(legacy_db_path):
        return legacy_db_path
    return local_db_path


def sqlite_main(db_path):
    import sqlite3

    print("Using SQLite:", db_path)
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()
    cur.execute("PRAGMA table_info(frenzy_events)")
    cols = [row[1] for row in cur.fetchall()]
    if "severity" not in cols:
        cur.execute("ALTER TABLE frenzy_events ADD COLUMN severity INTEGER")
        conn.commit()
        print("[OK] Added column frenzy_events.severity")
    cur.execute(
        "UPDATE frenzy_events SET severity = 1 WHERE severity IS NULL"
    )
    n = cur.rowcount if cur.rowcount is not None else 0
    conn.commit()
    print(f"[OK] Set severity = 1 for rows that had NULL severity ({n} row(s) touched).")
    conn.close()


def postgres_main(database_url):
    import psycopg

    uri = database_url.replace("postgresql+psycopg://", "postgresql://")
    print("Using DATABASE_URL (PostgreSQL)")
    conn = psycopg.connect(uri)
    cur = conn.cursor()
    cur.execute(
        """
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'frenzy_events'
          AND column_name = 'severity'
        """
    )
    if not cur.fetchone():
        cur.execute("ALTER TABLE frenzy_events ADD COLUMN severity INTEGER")
        print("[OK] Added column frenzy_events.severity")
    cur.execute(
        """
        UPDATE frenzy_events SET severity = 1 WHERE severity IS NULL
        """
    )
    n = cur.rowcount
    conn.commit()
    print(f"[OK] Backfilled NULL severity → 1 ({n} row(s) updated).")
    conn.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", help="SQLite path only", default=None)
    args = parser.parse_args()

    if args.db:
        sqlite_main(os.path.abspath(args.db))
        return

    database_url = os.environ.get("DATABASE_URL")
    if database_url:
        postgres_main(normalize_database_url(database_url))
        return

    sqlite_main(default_sqlite_behavior_tracking_path())


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"[ERROR] {e}", file=sys.stderr)
        sys.exit(1)
