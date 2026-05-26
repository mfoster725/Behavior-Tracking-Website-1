"""
Fix marketplace visibility for students missing Case Manager team rows.

Run with the same DB as your app, e.g.:
  python fix_marketplace_student_visibility.py --use-instance
"""
import argparse
import os
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ROOT)


def _configure_db_env(args):
    if args.db:
        db_path = os.path.abspath(args.db).replace(os.sep, "/")
        os.environ["TEST_DATABASE_URI"] = f"sqlite:///{db_path}"
    elif args.use_instance:
        os.environ["LOCAL_DB_DIR"] = os.path.join(ROOT, "instance")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", default=None)
    parser.add_argument("--use-instance", action="store_true")
    args = parser.parse_args()
    _configure_db_env(args)

    from seed_marketplace_local import (
        ensure_case_manager_team_member,
        ensure_item_visible_to_case_manager,
    )
    from app import (
        app,
        db,
        User,
        Student,
        PurchaseOrder,
        MarketplaceItemCaseManager,
        get_student_case_manager,
        get_case_manager_user_ids_for_student,
    )

    with app.app_context():
        print("DB:", app.config["SQLALCHEMY_DATABASE_URI"])
        creator = User.query.filter_by(role="admin").first() or User.query.filter_by(role="staff").first()

        # Fix students with purchase orders
        orders = PurchaseOrder.query.all()
        fixed_students = set()
        for order in orders:
            if order.student_id in fixed_students:
                continue
            cm = User.query.get(order.case_manager_id) if order.case_manager_id else None
            if not cm:
                cm = get_student_case_manager(order.student_id)
            if not cm:
                print(f"  Skip order {order.id}: no case manager user")
                continue
            student = Student.query.get(order.student_id)
            ensure_case_manager_team_member(student.id, cm)
            ensure_item_visible_to_case_manager(order.item, cm, creator.id)
            fixed_students.add(student.id)
            print(f"  Fixed {student.name}: CM {cm.name}, item {order.item.name}")

        # Fix Test Student 1 explicitly (common local login)
        from seed_marketplace_local import SEED_ITEM_NAMES
        from app import MarketplaceItem

        s1 = Student.query.filter(Student.name.ilike("%Test Student 1%")).first()
        if s1:
            cm = get_student_case_manager(s1.id)
            if not cm:
                cm = User.query.filter_by(designation="Case Manager", role="staff").order_by(User.id).first()
                if cm:
                    ensure_case_manager_team_member(s1.id, cm)
                    print(f"  Linked Test Student 1 to CM {cm.name}")
            if cm:
                for spec_name in SEED_ITEM_NAMES:
                    item = MarketplaceItem.query.filter_by(name=spec_name).first()
                    if item:
                        ensure_item_visible_to_case_manager(item, cm, creator.id)
                print(f"  Test Student 1 catalog: all seed items visible via CM {cm.name}")

        db.session.commit()
        print("Done.")


if __name__ == "__main__":
    main()
