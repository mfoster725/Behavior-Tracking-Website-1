"""
Migration: add marketplace_item_hidden_rules table for hiding items from students
by specific student, card color, or grade section.
"""
import os
import sys

database_url = os.environ.get('DATABASE_URL')
if database_url:
    if database_url.startswith('postgres://'):
        database_url = database_url.replace('postgres://', 'postgresql+psycopg://', 1)
    elif database_url.startswith('postgresql://') and '+psycopg' not in database_url:
        database_url = database_url.replace('postgresql://', 'postgresql+psycopg://', 1)
    if 'sslmode' not in database_url.lower():
        separator = '&' if '?' in database_url else '?'
        database_url = f"{database_url}{separator}sslmode=require"
else:
    instance_path = os.path.join(os.path.dirname(__file__), 'instance')
    os.makedirs(instance_path, exist_ok=True)
    database_url = f'sqlite:///{os.path.join(instance_path, "behavior_tracking.db")}'


def run_sqlite_migration(conn):
    cursor = conn.cursor()
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS marketplace_item_hidden_rules (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            item_id INTEGER NOT NULL REFERENCES marketplace_items(id) ON DELETE CASCADE,
            hidden_type VARCHAR(20) NOT NULL,
            value VARCHAR(100) NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    """)
    cursor.execute("CREATE INDEX IF NOT EXISTS ix_marketplace_item_hidden_rules_item_id ON marketplace_item_hidden_rules(item_id)")
    conn.commit()


def run_postgres_migration(conn):
    cursor = conn.cursor()
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS marketplace_item_hidden_rules (
            id SERIAL PRIMARY KEY,
            item_id INTEGER NOT NULL REFERENCES marketplace_items(id) ON DELETE CASCADE,
            hidden_type VARCHAR(20) NOT NULL,
            value VARCHAR(100) NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    try:
        cursor.execute("CREATE INDEX IF NOT EXISTS ix_marketplace_item_hidden_rules_item_id ON marketplace_item_hidden_rules(item_id)")
    except Exception as e:
        if 'already exists' not in str(e).lower():
            print("Index:", e)
    conn.commit()


def main():
    if 'sqlite' in database_url:
        import sqlite3
        conn = sqlite3.connect(database_url.replace('sqlite:///', ''))
        run_sqlite_migration(conn)
        conn.close()
    else:
        import psycopg2
        conn = psycopg2.connect(database_url.replace('postgresql+psycopg://', 'postgresql://'))
        run_postgres_migration(conn)
        conn.close()
    print("Marketplace hidden rules migration completed.")


if __name__ == '__main__':
    main()
    sys.exit(0)
