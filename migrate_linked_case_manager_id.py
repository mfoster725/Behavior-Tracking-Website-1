"""
One-time migration: add linked_case_manager_id to users table (PostgreSQL).
Run with DATABASE_URL set to your Postgres connection URI.

  set DATABASE_URL=postgresql://user:pass@host:port/defaultdb?sslmode=require
  python migrate_linked_case_manager_id.py

If you get "SSL error: certificate verify failed" (common on Windows with Aiven):
  Download Aiven's CA certificate: Aiven Console → your PostgreSQL service →
  Overview (or Connection) → CA Certificate → Download. Save the .pem file (e.g. to C:\\Users\\manfo\\aiven-ca.pem).
  Then set (PowerShell):
    $env:DB_SSL_ROOT_CERT = "C:\\Users\\manfo\\aiven-ca.pem"
  Use the real path where you saved the file. Then run the script again.
  See AIVEN_MIGRATION_PATH.md for full steps.

Safe to run multiple times (uses IF NOT EXISTS).
"""
import os
import sys


def main():
    database_url = os.environ.get('DATABASE_URL')
    if not database_url:
        print("Error: DATABASE_URL is not set. Set it to your PostgreSQL connection URI.")
        sys.exit(1)
    if 'postgresql' not in database_url.lower() and 'postgres://' not in database_url:
        print("Warning: DATABASE_URL does not look like PostgreSQL. This script is for Postgres.")

    from app import app, db
    from sqlalchemy import text

    with app.app_context():
        print("Adding linked_case_manager_id to users table (if not exists)...")
        with db.engine.connect() as conn:
            conn.execute(text(
                "ALTER TABLE users ADD COLUMN IF NOT EXISTS linked_case_manager_id INTEGER REFERENCES users(id)"
            ))
            conn.commit()
        print("Done. Column users.linked_case_manager_id is ready.")


if __name__ == '__main__':
    main()
