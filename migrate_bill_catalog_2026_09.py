"""
Migration: refresh the Manny's Market bill catalog (bills_lib.BILL_PRODUCTS_V2)
in the database for the housing/internet/groceries/health/renters/savings/cell/car
rewrite -- new "what this gets you" classroom-impact text, a trimmed housing list,
single-choice internet, an opt-out groceries tier, and a collapsed cell phone plan.

`seed_economy()` only fills in `options_json` for a product that has none yet, so
existing rows keep whatever was seeded on first run. This script overwrites the
options_json (and is_base, where it changed) for just the products this rewrite
touched, using bills_lib.BILL_PRODUCTS_V2 as the source of truth. Safe to re-run.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

TOUCHED_SLUGS = {'rent', 'internet', 'renters', 'groceries', 'health', 'savings', 'cell', 'car_loan'}


def migrate_via_sqlalchemy():
    from app import app, db, BillProduct
    import bills_lib as bl
    from economy_lib import dump_json

    with app.app_context():
        specs = {spec['slug']: spec for spec in bl.BILL_PRODUCTS_V2 if spec['slug'] in TOUCHED_SLUGS}
        updated = 0
        for slug, spec in specs.items():
            row = BillProduct.query.filter_by(slug=slug).first()
            if not row:
                print(f"  skip {slug}: no existing row (seed_economy will create it)")
                continue
            row.options_json = dump_json(spec['options_json'])
            row.is_base = spec['is_base']
            updated += 1
            print(f"  refreshed {slug}")
        db.session.commit()
        print(f"Bill catalog refreshed for {updated} product(s).")


if __name__ == '__main__':
    print("=" * 60)
    print("Migration: refresh bill catalog (housing/internet/groceries/etc.)")
    print("=" * 60)
    migrate_via_sqlalchemy()
    print("=" * 60)
