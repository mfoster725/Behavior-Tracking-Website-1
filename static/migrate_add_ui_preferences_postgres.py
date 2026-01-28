from app import db

def migrate():
    with db.engine.connect() as conn:
        conn.execute(db.text(
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS ui_preferences TEXT"
        ))
        conn.commit()
    print("Added ui_preferences column (if it did not already exist).")

if __name__ == "__main__":
    migrate()