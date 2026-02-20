"""
Create a single admin user (non-interactive).
Uses DATABASE_URL (and DB_SSL_ROOT_CERT if needed). Set admin credentials via env:

  set ADMIN_USERNAME=admin
  set ADMIN_PASSWORD=your_secure_password
  python create_admin.py

If ADMIN_USERNAME/ADMIN_PASSWORD are not set, creates admin / admin123 (change after first login).
"""

import os
from app import app, db, User


def main():
    username = os.environ.get('ADMIN_USERNAME', 'admin')
    password = os.environ.get('ADMIN_PASSWORD', 'admin123')

    with app.app_context():
        existing = User.query.filter_by(username=username).first()
        if existing:
            if existing.role == 'admin':
                print(f"Admin user '{username}' already exists.")
            else:
                print(f"User '{username}' exists but is not an admin. Use create_users.py to manage users.")
            return

        user = User(username=username, role='admin')
        user.set_password(password)
        db.session.add(user)
        db.session.commit()
        print(f"Admin user created: username={username}")
        if password == 'admin123':
            print("  ** Change the password after first login! **")


if __name__ == '__main__':
    main()
