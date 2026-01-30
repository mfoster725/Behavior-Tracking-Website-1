"""
Migration script for Marketplace feature: new columns and tables.
- marketplace_items: grade_range, item_type_id, category_id, image_url, suggested_by_user_id
- purchase_orders: approved_by_user_id, denied_by_user_id, denial_reason (case_manager_id stays, can be nullable)
- New tables: marketplace_item_types, marketplace_categories, notifications
"""
import os
import sys

# Use same DB as app
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
    # New tables first (so FKs can reference them)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS marketplace_item_types (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name VARCHAR(100) NOT NULL UNIQUE,
            sort_order INTEGER NOT NULL DEFAULT 0
        )
    """)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS marketplace_categories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name VARCHAR(100) NOT NULL UNIQUE,
            sort_order INTEGER NOT NULL DEFAULT 0
        )
    """)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS notifications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL REFERENCES users(id),
            type VARCHAR(50) NOT NULL,
            title VARCHAR(200) NOT NULL,
            body TEXT,
            purchase_order_id INTEGER REFERENCES purchase_orders(id),
            read_at DATETIME,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    """)
    # marketplace_items
    try:
        cursor.execute("PRAGMA table_info(marketplace_items)")
        cols = [r[1] for r in cursor.fetchall()]
        if 'grade_range' not in cols:
            cursor.execute("ALTER TABLE marketplace_items ADD COLUMN grade_range VARCHAR(20) DEFAULT '9_12'")
        if 'item_type_id' not in cols:
            cursor.execute("ALTER TABLE marketplace_items ADD COLUMN item_type_id INTEGER REFERENCES marketplace_item_types(id)")
        if 'category_id' not in cols:
            cursor.execute("ALTER TABLE marketplace_items ADD COLUMN category_id INTEGER REFERENCES marketplace_categories(id)")
        if 'image_url' not in cols:
            cursor.execute("ALTER TABLE marketplace_items ADD COLUMN image_url VARCHAR(500)")
        if 'suggested_by_user_id' not in cols:
            cursor.execute("ALTER TABLE marketplace_items ADD COLUMN suggested_by_user_id INTEGER REFERENCES users(id)")
    except Exception as e:
        print("marketplace_items:", e)
    # purchase_orders
    try:
        cursor.execute("PRAGMA table_info(purchase_orders)")
        cols = [r[1] for r in cursor.fetchall()]
        if 'approved_by_user_id' not in cols:
            cursor.execute("ALTER TABLE purchase_orders ADD COLUMN approved_by_user_id INTEGER REFERENCES users(id)")
        if 'denied_by_user_id' not in cols:
            cursor.execute("ALTER TABLE purchase_orders ADD COLUMN denied_by_user_id INTEGER REFERENCES users(id)")
        if 'denial_reason' not in cols:
            cursor.execute("ALTER TABLE purchase_orders ADD COLUMN denial_reason TEXT")
    except Exception as e:
        print("purchase_orders:", e)
    conn.commit()

def run_postgres_migration(conn):
    cursor = conn.cursor()
    # Create new tables first (so FKs can reference them)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS marketplace_item_types (
            id SERIAL PRIMARY KEY,
            name VARCHAR(100) NOT NULL UNIQUE,
            sort_order INTEGER NOT NULL DEFAULT 0
        )
    """)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS marketplace_categories (
            id SERIAL PRIMARY KEY,
            name VARCHAR(100) NOT NULL UNIQUE,
            sort_order INTEGER NOT NULL DEFAULT 0
        )
    """)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS notifications (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id),
            type VARCHAR(50) NOT NULL,
            title VARCHAR(200) NOT NULL,
            body TEXT,
            purchase_order_id INTEGER REFERENCES purchase_orders(id),
            read_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    # marketplace_items columns
    for col, typ in [
        ('grade_range', 'VARCHAR(20) DEFAULT \'9_12\''),
        ('item_type_id', 'INTEGER REFERENCES marketplace_item_types(id)'),
        ('category_id', 'INTEGER REFERENCES marketplace_categories(id)'),
        ('image_url', 'VARCHAR(500)'),
        ('suggested_by_user_id', 'INTEGER REFERENCES users(id)'),
    ]:
        try:
            cursor.execute(f"ALTER TABLE marketplace_items ADD COLUMN IF NOT EXISTS {col} {typ}")
        except Exception as e:
            if 'already exists' not in str(e).lower():
                print(f"marketplace_items.{col}:", e)
    # purchase_orders columns
    for col, typ in [
        ('approved_by_user_id', 'INTEGER REFERENCES users(id)'),
        ('denied_by_user_id', 'INTEGER REFERENCES users(id)'),
        ('denial_reason', 'TEXT'),
    ]:
        try:
            cursor.execute(f"ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS {col} {typ}")
        except Exception as e:
            if 'already exists' not in str(e).lower():
                print(f"purchase_orders.{col}:", e)
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
    print("Marketplace migration completed.")

if __name__ == '__main__':
    main()
    sys.exit(0)
