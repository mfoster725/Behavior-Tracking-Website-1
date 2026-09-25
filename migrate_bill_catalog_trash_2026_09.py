"""
Migration: add the Trash bill category and refresh the housing note that no
longer bundles trash pickup into rent.

Unlike migrate_bill_catalog_2026_09.py (which only refreshes rows that
already exist), this one INSERTS the 'trash' row if it's missing -- a fresh
install never seeded one, and a school running since before the weekly-bills
rewrite has an old, deactivated v1 'trash' row with stale options_json that
needs overwriting, not just filling in. Safe to re-run.

The old v1 rows this replaces (a prior 'housing' row, a prior 'electricity'
row, etc.) are left alone in the database -- they're still referenced by any
historical bills from that era -- but the app now filters them out of the
admin settings and "Hide/unhide bills" lists by only showing slugs in
bills_lib.PRODUCT_ORDER, so they no longer show up as confusing duplicates.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

TOUCHED_SLUGS = {'rent', 'trash'}


def migrate_via_sqlalchemy():
    from app import app, db, BillProduct
    import bills_lib as bl
    from economy_lib import dump_json

    with app.app_context():
        specs = {spec['slug']: spec for spec in bl.BILL_PRODUCTS_V2 if spec['slug'] in TOUCHED_SLUGS}
        for slug, spec in specs.items():
            row = BillProduct.query.filter_by(slug=slug).first()
            if not row:
                row = BillProduct(slug=slug)
                db.session.add(row)
                print(f"  created {slug}")
            else:
                print(f"  refreshed {slug}")
            row.name = spec['name']
            row.category = spec['category']
            row.is_base = spec['is_base']
            row.formula_kind = spec['formula_kind']
            row.sort_order = spec['sort_order']
            row.options_json = dump_json(spec['options_json'])
            row.is_active = True
        db.session.commit()
        print("Trash bill category is live; housing note refreshed.")


if __name__ == '__main__':
    print("=" * 60)
    print("Migration: add Trash bill category, refresh housing note")
    print("=" * 60)
    migrate_via_sqlalchemy()
    print("=" * 60)
