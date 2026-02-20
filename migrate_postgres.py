"""
One-time migration for PostgreSQL (e.g. Aiven, Render, Neon).
Run with DATABASE_URL set to your Postgres connection URI.

  set DATABASE_URL=postgresql://user:pass@host:port/defaultdb?sslmode=require
  python migrate_postgres.py

This will:
  1. Create all tables and run app migrations (init_db)
  2. Run marketplace migrations if needed
  3. Run marketplace hidden rules migration if needed
"""
import os
import sys

def main():
    database_url = os.environ.get('DATABASE_URL')
    if not database_url:
        print("Error: DATABASE_URL is not set. Set it to your PostgreSQL connection URI (e.g. Aiven).")
        sys.exit(1)
    if 'postgresql' not in database_url.lower() and 'postgres://' not in database_url:
        print("Warning: DATABASE_URL does not look like PostgreSQL. This script is for Postgres (e.g. Aiven).")

    # Import app so that DATABASE_URL is applied and init_db is available
    from app import app, init_db

    with app.app_context():
        print("Running database initialization (create_all + column migrations)...")
        init_db()
        print("App schema migration done.")

    # Run marketplace migrations (they use their own connection from DATABASE_URL)
    print("Running marketplace migrations...")
    try:
        import migrate_marketplace
        migrate_marketplace.main()
    except Exception as e:
        print(f"Marketplace migration note: {e}")

    print("Running marketplace hidden rules migration...")
    try:
        import migrate_marketplace_hidden_rules
        migrate_marketplace_hidden_rules.main()
    except Exception as e:
        print(f"Hidden rules migration note: {e}")

    print("PostgreSQL migration completed successfully.")

if __name__ == '__main__':
    main()
