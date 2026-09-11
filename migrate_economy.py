"""
Migration for Manny's Market economy: pay tracks, bills, wages, miss-fee classes,
and 2026 marketplace catalog seeds.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))


def migrate_via_sqlalchemy():
    from app import app, db, ensure_economy_schema, seed_economy

    with app.app_context():
        db.create_all()
        ensure_economy_schema()
        seed_economy()
        print("Economy schema ensured and 2026 seeds applied.")


if __name__ == '__main__':
    print("=" * 60)
    print("Migration: Manny's Market economy")
    print("=" * 60)
    migrate_via_sqlalchemy()
    print("=" * 60)
