"""
Add an index on daily_records.student_id for faster lookups (SQLite or PostgreSQL).

Uses DATABASE_URL when set (same pattern as migrate_marketplace.py).
Otherwise uses instance/behavior_tracking.db.

Optional: python migrate_add_student_id_index.py --db path/to/custom.db
"""
import argparse
import os
import re
import sys

INDEX_NAME = "ix_daily_records_student_id"


def resolve_ssl_cert_env():
    """If DB_SSL_ROOT_CERT is unset or missing, use ./aiven-ca.pem when present."""
    root = os.path.dirname(os.path.abspath(__file__))
    env_path = os.environ.get("DB_SSL_ROOT_CERT")
    if env_path and os.path.isfile(env_path):
        return env_path
    fallback = os.path.join(root, "aiven-ca.pem")
    if os.path.isfile(fallback):
        os.environ.setdefault("DB_SSL_ROOT_CERT", fallback)
        return fallback
    return env_path if env_path else None


def normalize_database_url(raw):
    database_url = raw
    if database_url.startswith("postgres://"):
        database_url = database_url.replace("postgres://", "postgresql+psycopg://", 1)
    elif database_url.startswith("postgresql://") and "+psycopg" not in database_url:
        database_url = database_url.replace("postgresql://", "postgresql+psycopg://", 1)
    if "sslmode" not in database_url.lower():
        sep = "&" if "?" in database_url else "?"
        database_url = f"{database_url}{sep}sslmode=require"
    ssl_root = resolve_ssl_cert_env()
    if ssl_root and os.path.isfile(ssl_root):
        cert_path = os.path.abspath(ssl_root).replace("\\", "/")
        database_url = re.sub(
            r"([?&])sslmode=[^&]*", r"\1sslmode=verify-ca", database_url, flags=re.IGNORECASE
        )
        joiner = "&" if "?" in database_url else "?"
        if "sslrootcert=" not in database_url.lower():
            database_url = f"{database_url}{joiner}sslrootcert={cert_path}"
    return database_url


def sqlite_main(db_path):
    import sqlite3

    print("=" * 60)
    print("Database Migration: Add Index on daily_records.student_id")
    print("=" * 60)
    print(f"\nSQLite file: {db_path}\n")
    conn = sqlite3.connect(db_path)
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT name FROM sqlite_master WHERE type='index' AND name=?",
            (INDEX_NAME,),
        )
        if cur.fetchone():
            print(f"[OK] Index '{INDEX_NAME}' already exists. Nothing to do.")
            return
        cur.execute(
            f"CREATE INDEX IF NOT EXISTS {INDEX_NAME} ON daily_records (student_id)"
        )
        conn.commit()
        print(f"[OK] Created index '{INDEX_NAME}' on daily_records(student_id).")
    finally:
        conn.close()
    print("\n" + "=" * 60)


def postgres_main(database_url):
    import psycopg

    uri = database_url.replace("postgresql+psycopg://", "postgresql://")
    print("=" * 60)
    print("Database Migration: Add Index on daily_records.student_id")
    print("=" * 60)
    print("\nUsing DATABASE_URL (PostgreSQL)\n")
    conn = psycopg.connect(uri)
    try:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT 1 FROM pg_indexes
            WHERE indexname = %s
            """,
            (INDEX_NAME,),
        )
        if cur.fetchone():
            print(f"[OK] Index '{INDEX_NAME}' already exists. Nothing to do.")
            return
        cur.execute(
            f'CREATE INDEX IF NOT EXISTS "{INDEX_NAME}" ON daily_records (student_id)'
        )
        conn.commit()
        print(f"[OK] Created index '{INDEX_NAME}' on daily_records(student_id).")
    finally:
        conn.close()
    print("\n" + "=" * 60)


def main():
    parser = argparse.ArgumentParser(description="Add daily_records.student_id index.")
    parser.add_argument(
        "--db",
        help="SQLite database file path (skip DATABASE_URL)",
        default=None,
    )
    args = parser.parse_args()

    if args.db:
        sqlite_main(os.path.abspath(args.db))
        return

    database_url = os.environ.get("DATABASE_URL")
    if database_url:
        postgres_main(normalize_database_url(database_url))
        return

    instance_path = os.path.join(os.path.dirname(__file__), "instance")
    os.makedirs(instance_path, exist_ok=True)
    db_file = os.path.join(instance_path, "behavior_tracking.db")
    sqlite_main(db_file)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"[ERROR] Error during migration: {e}", file=sys.stderr)
        sys.exit(1)
    sys.exit(0)
