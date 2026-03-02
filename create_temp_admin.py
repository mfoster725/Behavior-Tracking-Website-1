"""
Create or update a temporary admin user in the same database the app uses.

Run from project root, with the SAME environment as when you start the app
(e.g. no USE_TEST_DB if you use the main DB, or set USE_TEST_DB=1 if you use the test DB):

  python create_temp_admin.py

Options:
  --use-main   Force main DB (instance/behavior_tracking.db)
  --use-test   Force test DB (instance/behavior_tracking_test.db)
  --db PATH    Use this SQLite file path
"""
import os
import argparse

from app import app, db, User


def main() -> None:
    parser = argparse.ArgumentParser(description="Create or update a temporary admin user.")
    parser.add_argument(
        "--use-main",
        action="store_true",
        help="Use the main app database (instance/behavior_tracking.db).",
    )
    parser.add_argument(
        "--use-test",
        action="store_true",
        help="Use the test database (instance/behavior_tracking_test.db).",
    )
    parser.add_argument(
        "--db",
        default=None,
        help="Optional explicit SQLite DB path. Overrides --use-main/--use-test.",
    )
    args = parser.parse_args()

    # Use the same DB as the app unless overridden (so run with same env as the app)
    if args.db:
        db_path = os.path.abspath(args.db)
        app.config["SQLALCHEMY_DATABASE_URI"] = f"sqlite:///{db_path.replace(os.sep, '/')}"
    elif args.use_main or args.use_test:
        root = os.path.dirname(os.path.abspath(__file__))
        instance_path = os.path.join(root, "instance")
        os.makedirs(instance_path, exist_ok=True)
        name = "behavior_tracking_test.db" if args.use_test else "behavior_tracking.db"
        db_path = os.path.join(instance_path, name)
        app.config["SQLALCHEMY_DATABASE_URI"] = f"sqlite:///{db_path.replace(os.sep, '/')}"
    # else: leave app.config as set at import (same DB the running app uses)

    print("Using DB:", app.config["SQLALCHEMY_DATABASE_URI"])

    username = "admin_temp"
    password = "TempAdmin123!"

    with app.app_context():
        db.create_all()

        user = User.query.filter_by(username=username).first()
        if user is None:
            user = User(
                name="Temporary Admin",
                username=username,
                role="admin",
                designation="Admin",
            )
            user.set_password(password)
            db.session.add(user)
            action = "created"
        else:
            user.role = "admin"
            user.designation = "Admin"
            user.set_password(password)
            action = "updated"

        db.session.commit()

        # Verify: re-query and check password (ensures hash is correct in DB)
        db.session.expire_all()  # clear session cache
        u = User.query.filter_by(username=username).first()
        ok = u is not None and u.check_password(password)
        print(f"{action} user {user.username} with role {user.role}")
        print("Password:", password)
        if ok:
            print("Verification: password check OK (login should work).")
        else:
            print("Verification: password check FAILED (unexpected).")


if __name__ == "__main__":
    main()
