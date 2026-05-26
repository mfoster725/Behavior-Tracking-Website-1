"""
Seed local marketplace data: 5 items (all add-item fields) and 3 purchase orders.

Uses the same SQLite database as the running app (LOCALAPPDATA/BehaviorTracking by default).

Run from project root (uses the same DB path as app.py on import):
  python seed_marketplace_local.py

If you still use the copy under instance/ (older OneDrive path), pass it explicitly:
  python seed_marketplace_local.py --db instance/behavior_tracking.db

  python seed_marketplace_local.py --force   # replace prior seed items/orders and re-seed
"""

import argparse
import os
import sys
from datetime import datetime
from decimal import Decimal

ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ROOT)


def _configure_db_env(args: argparse.Namespace) -> None:
    """Point app.py at the right SQLite file before it is imported."""
    if args.db:
        db_path = os.path.abspath(args.db).replace(os.sep, "/")
        os.environ["TEST_DATABASE_URI"] = f"sqlite:///{db_path}"
    elif args.use_instance:
        os.environ["LOCAL_DB_DIR"] = os.path.join(ROOT, "instance")

MARKETPLACE_TYPES = [
    ("Food", 1),
    ("Activity", 2),
    ("Privilege", 3),
    ("Equipment", 4),
    ("Reward", 5),
]

MARKETPLACE_CATEGORIES = [
    ("Snacks", 1),
    ("Experiences", 2),
    ("Privileges", 3),
    ("Supplies", 4),
    ("Rewards", 5),
]

MARKETPLACE_ITEMS = [
    {
        "name": "Pizza Slice",
        "description": "One slice of cheese pizza from the cafeteria.",
        "price": "5.00",
        "type_name": "Food",
        "category_name": "Snacks",
        "image_url": "https://images.unsplash.com/photo-1513104890138-7c749659a591?w=400",
    },
    {
        "name": "Extra Recess Pass",
        "description": "15 minutes of extra outdoor recess with staff approval.",
        "price": "8.50",
        "type_name": "Activity",
        "category_name": "Experiences",
        "image_url": "https://images.unsplash.com/photo-1503454537845-cef7fdbb3e56?w=400",
    },
    {
        "name": "Headphones (1 hour)",
        "description": "Borrow noise-canceling headphones for one class period.",
        "price": "3.25",
        "type_name": "Equipment",
        "category_name": "Supplies",
        "image_url": "https://images.unsplash.com/photo-1484704849700-f032a568e944?w=400",
        "case_manager_username": "staff29",
    },
    {
        "name": "Preferred Seating",
        "description": "Choose your seat in the classroom for one week.",
        "price": "12.00",
        "type_name": "Privilege",
        "category_name": "Privileges",
        "image_url": "https://images.unsplash.com/photo-1523050854058-8df90110c9f1?w=400",
    },
    {
        "name": "School Store Gift Card",
        "description": "$10 credit toward pencils, notebooks, and school supplies.",
        "price": "10.00",
        "type_name": "Reward",
        "category_name": "Rewards",
        "image_url": "https://images.unsplash.com/photo-1452860600635-30c2a0d88a03?w=400",
    },
]

SEED_ITEM_NAMES = {spec["name"] for spec in MARKETPLACE_ITEMS}


def discover_case_managers():
    from app import User

    cms = (
        User.query.filter_by(role="staff", designation="Case Manager")
        .order_by(User.id)
        .all()
    )
    if len(cms) < 5:
        print(f"Need at least 5 case managers in this database; found {len(cms)}.")
        sys.exit(1)
    return cms[:5]


def ensure_case_manager_team_member(student_id, case_manager_user):
    """Ensure student has a Case Manager team row that resolves to this user."""
    from app import TeamMember, db

    existing = TeamMember.query.filter_by(
        student_id=student_id, role="Case Manager"
    ).first()
    if existing:
        if existing.name != case_manager_user.name:
            existing.name = case_manager_user.name
            existing.email = f"{case_manager_user.username}@local"
        return existing
    tm = TeamMember(
        student_id=student_id,
        role="Case Manager",
        name=case_manager_user.name,
        email=f"{case_manager_user.username}@local",
    )
    db.session.add(tm)
    db.session.flush()
    return tm


def build_purchase_specs(created_items, case_managers_for_items):
    """Use Test Student 1/5/11 (or first available) and ensure each has a case manager."""
    from app import Student, get_student_case_manager

    candidate_ids = [1, 5, 11]
    specs = []
    used_cm_ids = set()
    for item, cm in zip(created_items[:3], case_managers_for_items[:3]):
        if cm.id in used_cm_ids:
            continue
        student = None
        for sid in candidate_ids:
            if any(s["student"].id == sid for s in specs):
                continue
            student = Student.query.get(sid)
            if student:
                break
        if not student:
            student = Student.query.order_by(Student.id).first()
        if not student:
            print("No students in database.")
            sys.exit(1)

        ensure_case_manager_team_member(student.id, cm)
        resolved_cm = get_student_case_manager(student.id)
        if not resolved_cm:
            print(f"Could not link case manager {cm.name} to student {student.name}.")
            sys.exit(1)
        specs.append({"student": student, "item": item, "cm": resolved_cm})
        used_cm_ids.add(cm.id)
    if len(specs) < 3:
        print("Could not build 3 purchase orders.")
        sys.exit(1)
    return specs


def ensure_item_visible_to_case_manager(item, case_manager_user, creator_user_id):
    """Add or update accepted assignment so a CM's students can see the item."""
    from app import MarketplaceItemCaseManager, db

    row = MarketplaceItemCaseManager.query.filter_by(
        item_id=item.id, case_manager_id=case_manager_user.id
    ).first()
    if row:
        row.status = "accepted"
        row.visible_to_students = True
        return row
    row = MarketplaceItemCaseManager(
        item_id=item.id,
        case_manager_id=case_manager_user.id,
        status="accepted",
        visible_to_students=True,
        created_by_user_id=creator_user_id,
    )
    db.session.add(row)
    return row


def get_or_create_lookup(model, name, sort_order=0):
    row = model.query.filter_by(name=name).first()
    if row:
        return row
    row = model(name=name, sort_order=sort_order)
    from app import db
    db.session.add(row)
    db.session.flush()
    return row


def main():
    parser = argparse.ArgumentParser(description="Seed marketplace items and purchase orders (local DB)")
    parser.add_argument(
        "--db",
        default=None,
        help="SQLite file path (default: same DB as app.py, usually %%LOCALAPPDATA%%/BehaviorTracking/behavior_tracking.db)",
    )
    parser.add_argument(
        "--use-instance",
        action="store_true",
        help="Seed instance/behavior_tracking.db in the project folder (legacy OneDrive path)",
    )
    parser.add_argument("--force", action="store_true", help="Remove prior seed items/orders and re-seed")
    args = parser.parse_args()
    _configure_db_env(args)

    from app import (
        app,
        db,
        User,
        Student,
        MarketplaceItem,
        MarketplaceItemType,
        MarketplaceCategory,
        MarketplaceItemCaseManager,
        PurchaseOrder,
        Transaction,
        BankAccount,
        get_or_create_bank_account,
        get_student_case_manager,
    )

    print("Using DB:", app.config["SQLALCHEMY_DATABASE_URI"])

    with app.app_context():
        db.create_all()

        creator = User.query.filter_by(role="admin").first()
        if not creator:
            creator = User.query.filter_by(role="staff").first()
        if not creator:
            print("No admin/staff user found. Create users first.")
            sys.exit(1)

        if args.force:
            seed_items = MarketplaceItem.query.filter(
                MarketplaceItem.name.in_(SEED_ITEM_NAMES)
            ).all()
            seed_item_ids = [i.id for i in seed_items]
            if seed_item_ids:
                po_ids = [
                    row[0]
                    for row in db.session.query(PurchaseOrder.id)
                    .filter(PurchaseOrder.item_id.in_(seed_item_ids))
                    .all()
                ]
                if po_ids:
                    Transaction.query.filter(Transaction.purchase_order_id.in_(po_ids)).delete(
                        synchronize_session=False
                    )
                    PurchaseOrder.query.filter(PurchaseOrder.id.in_(po_ids)).delete(
                        synchronize_session=False
                    )
                MarketplaceItemCaseManager.query.filter(
                    MarketplaceItemCaseManager.item_id.in_(seed_item_ids)
                ).delete(synchronize_session=False)
                MarketplaceItem.query.filter(MarketplaceItem.id.in_(seed_item_ids)).delete(
                    synchronize_session=False
                )
                db.session.commit()
                print("Removed prior seed marketplace rows.")

        existing_seed_count = MarketplaceItem.query.filter(
            MarketplaceItem.name.in_(SEED_ITEM_NAMES)
        ).count()
        if existing_seed_count >= 5 and PurchaseOrder.query.count() >= 3 and not args.force:
            print("Seed data already present. Use --force to re-seed.")
            return

        type_by_name = {}
        for name, order in MARKETPLACE_TYPES:
            type_by_name[name] = get_or_create_lookup(MarketplaceItemType, name, order)

        cat_by_name = {}
        for name, order in MARKETPLACE_CATEGORIES:
            cat_by_name[name] = get_or_create_lookup(MarketplaceCategory, name, order)

        db.session.commit()

        case_managers = discover_case_managers()
        created_items = []
        for idx, spec in enumerate(MARKETPLACE_ITEMS):
            cm = case_managers[idx]

            item = MarketplaceItem(
                name=spec["name"],
                description=spec["description"],
                price=Decimal(spec["price"]),
                created_by_user_id=creator.id,
                is_global=False,
                is_active=True,
                grade_range="9_12",
                item_type_id=type_by_name[spec["type_name"]].id,
                category_id=cat_by_name[spec["category_name"]].id,
                image_url=spec["image_url"],
            )
            db.session.add(item)
            db.session.flush()

            assignment = MarketplaceItemCaseManager(
                item_id=item.id,
                case_manager_id=cm.id,
                status="accepted",
                visible_to_students=True,
                created_by_user_id=creator.id,
            )
            db.session.add(assignment)
            created_items.append(item)
            print(f"  Item: {item.name} (${item.price}) -> {cm.name}")

        db.session.commit()

        purchase_specs = build_purchase_specs(created_items, case_managers)
        for po_spec in purchase_specs:
            ensure_item_visible_to_case_manager(
                po_spec["item"], po_spec["cm"], creator.id
            )
            student = po_spec["student"]
            item = po_spec["item"]
            cm = po_spec["cm"]

            account = get_or_create_bank_account(student.id)
            if account.balance < Decimal("50.00"):
                account.balance = Decimal("100.00")
                account.updated_at = datetime.utcnow()

            price = item.price
            balance_before = account.balance
            balance_after = balance_before - price

            order = PurchaseOrder(
                student_id=student.id,
                item_id=item.id,
                item_price=price,
                student_balance_before=balance_before,
                student_calculated_balance_after=balance_after,
                actual_balance_after=balance_after,
                is_calculation_correct=True,
                status="pending",
                case_manager_id=cm.id,
            )
            db.session.add(order)
            db.session.flush()

            txn = Transaction(
                student_id=student.id,
                bank_account_id=account.id,
                transaction_type="purchase",
                amount=-price,
                purchase_order_id=order.id,
                balance_after=balance_after,
                description=f"Purchase (pending fulfillment): {item.name}",
            )
            db.session.add(txn)
            account.balance = balance_after
            account.updated_at = datetime.utcnow()
            print(
                f"  Order: {student.name} bought {item.name} "
                f"(CM: {cm.name}, balance ${balance_before} -> ${balance_after})"
            )

        db.session.commit()
        print("Done. Seeded 5 marketplace items and 3 purchase orders.")


if __name__ == "__main__":
    main()
