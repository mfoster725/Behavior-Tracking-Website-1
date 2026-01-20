# Authentication System Guide

## Overview
The Behavior Tracking System includes a complete authentication system with role-based access control. The system supports three user types: **Admin**, **Staff**, and **Student**.

## User Roles

### Admin Users
- **Full System Access**: Complete control over the entire system
- **User Management**: Can create and manage all user types
- **Permissions**:
  - Everything Staff can do
  - Create new Admin accounts
  - Create new Staff accounts
  - Delete any user account (except their own)
  - Access Admin Panel with system statistics
  - Manage all aspects of the system

### Staff Users
- **Full Data Access**: Can view and edit all student data
- **Student Management**: Can add/edit students, create student accounts
- **Permissions**: 
  - View all students
  - Edit all data (STAR ratings, notes, infractions, etc.)
  - Save and delete records
  - Import CSV data
  - Manage schedules
  - Create student user accounts
  - Reset student passwords
  - Access all data views and features

### Student Users
- **View-Only Access**: Can only view their own data
- **Restrictions**:
  - Cannot see other students' data
  - Cannot edit any data
  - Cannot save changes
  - Cannot add/delete records
  - Cannot access import features
  - Cannot access admin or user management
- **What Students Can Do**:
  - View their own STAR ratings in real-time (Daily Entry tab)
  - See their past STAR data across all periods
  - View their own behavior notes and infractions (read-only)
  - View their summary statistics and frenzy stats
  - Navigate through their historical data

## Initial Setup

### 1. Install Dependencies
```bash
pip install -r requirements.txt
```

### 2. Create Database Tables and Users
```bash
python create_users.py
```

This script will:
- Create all necessary database tables including the `users` table
- Create a default staff account (username: `staff`, password: `staff123`)
- Optionally create student login accounts

### 3. Default Credentials
**Admin Account:**
- Username: `admin`
- Password: `admin123`

**Staff Account:**
- Username: `staff`
- Password: `staff123`

**⚠️ IMPORTANT:** Change these passwords after first login!

## Creating User Accounts

### Creating Student Accounts (Staff/Admin)
**Through the Web Interface:**
1. Log in as Staff or Admin
2. Click "Add Student" button in User Management or any data entry view
3. Fill in student information:
   - Student Name (required)
   - Email (optional)
   - Username (required) - for student login
   - Password (required) - minimum 6 characters
   - Support team members (optional)
4. Click "Save Student"
5. The system creates both the student record and login account

### Creating Staff Accounts (Admin Only)
**Through the Web Interface:**
1. Log in as Admin
2. Navigate to Admin Panel or User Management
3. Click "Add Staff User"
4. Enter:
   - Username (required)
   - Password (required, minimum 6 characters)
   - Confirm Password
5. Click "Create Staff User"

### Creating Admin Accounts (Admin Only)
**Through the Web Interface:**
1. Log in as Admin
2. Navigate to Admin Panel or User Management
3. Click "Add Admin User"
4. Enter:
   - Username (required)
   - Password (required, minimum 6 characters)
   - Confirm Password
5. Click "Create Admin User"
6. Confirm the warning about admin privileges

### Using the Setup Script
Run `python create_users.py` to:
- Create default admin and staff accounts
- Create student accounts linked to existing students
- Create individual custom accounts

## Using the System

### Logging In
1. Navigate to `http://localhost:5000/login`
2. Enter your username and password
3. Click "Log In"
4. You'll be redirected to the main application

### Logging Out
- Click the "Logout" button in the top-right corner of the header

### Admin Workflow
1. Log in with admin credentials
2. Access Admin Panel to:
   - View system statistics
   - Create staff and admin accounts
   - Manage all users
3. Perform all staff functions:
   - Manage student data
   - Create/edit students
   - Import data
   - Manage schedules
4. User Management:
   - Create/delete any user type
   - Reset passwords for any user
   - View all user accounts

### Staff Workflow
1. Log in with staff credentials
2. Access all data views (Period Entry, Daily Entry, Summary, Frenzy Stats, Import)
3. Select any student to view/edit their data
4. Make changes and save using "Save" buttons
5. Add new students using "Add Student" button
   - This automatically creates both student record and login account
6. Import CSV data from the Import view
7. Manage schedules for teachers and students
8. User Management:
   - View all student accounts
   - Reset student passwords
   - Delete student accounts

### Student Workflow
1. Log in with student credentials
2. Views automatically filtered to show only their own data
3. View real-time STAR data in Daily Entry tab
4. Browse through their historical records (all fields are read-only)
5. Click info buttons to view detailed notes (cannot edit)
6. View their summary statistics and frenzy stats by quarter

## Security Features

### Password Security
- Passwords are hashed using Werkzeug's `generate_password_hash`
- Plain text passwords are never stored
- Password verification uses `check_password_hash`

### Session Management
- Uses Flask-Login for secure session handling
- Sessions are encrypted using Flask's SECRET_KEY
- Auto-logout on session expiration

### Access Control
- All API endpoints require authentication (`@login_required`)
- Staff-only endpoints use `@staff_required` decorator
- Student users are automatically restricted to their own data
- Frontend controls are disabled for read-only users

## API Endpoint Security

### Public Endpoints
- `/login` - Login page (GET/POST)

### Authenticated Endpoints (All Users)
All require login, data filtered by role:
- `/` - Main application
- `/logout` - Logout
- `/api/students` (GET) - View students (filtered by role)
- `/api/period-data` (GET) - View period data (filtered by role)
- `/api/daily-records` (GET) - View daily records (filtered by role)
- `/api/summary` - View summary statistics (filtered by role)
- `/api/frenzy-stats` - View frenzy statistics (filtered by role)
- `/api/schedules` (GET) - View schedules

### Staff/Admin Endpoints
Require Staff or Admin role:
- `/api/students` (POST) - Create students
- `/api/students/<id>` (DELETE) - Delete students
- `/api/period-data` (POST) - Save period data
- `/api/daily-records` (POST) - Save daily records
- `/api/schedules` (POST) - Save schedules
- `/api/import-csv` - CSV import
- `/api/users` (GET) - View users (staff sees students only)
- `/api/users` (POST) - Create student users (staff) or any user (admin)
- `/api/users` (PUT) - Update users
- `/api/users` (DELETE) - Delete users (limited by role)

### Admin-Only Endpoints
Require Admin role:
- `/api/users` (POST with role='staff' or 'admin') - Create staff/admin accounts
- Full access to all user management features

## Configuration

### Secret Key
The application uses a secret key for session encryption. Set it via environment variable:

```bash
# Windows
set SECRET_KEY=your-secure-random-key-here

# Linux/Mac
export SECRET_KEY=your-secure-random-key-here
```

**Default:** `dev-secret-key-change-in-production` (⚠️ Change in production!)

### Session Settings
Edit `app.py` to customize:
- Session timeout
- Cookie security
- Remember me functionality

## Troubleshooting

### Can't Log In
1. Verify username and password
2. Check that users table exists: `python create_users.py`
3. Verify user exists in database

### Student Sees Wrong Data
1. Check that `student_id` is correctly linked in users table
2. Verify student record exists

### Permission Errors
1. Check user role is correctly set ('staff' or 'student')
2. Verify authentication middleware is working
3. Check browser console for error messages

## Best Practices

### For Administrators
1. **Change default passwords immediately**
2. Use strong passwords for all accounts
3. Set a secure SECRET_KEY in production
4. Regularly backup the database
5. Review user accounts periodically

### For Staff Users
1. Log out when finished
2. Don't share your credentials
3. Use "Save" buttons frequently to avoid data loss
4. Verify student selection before editing data

### For Student Users
1. Contact staff if you notice any data issues
2. Log out on shared computers
3. Report any access problems to staff

## Database Schema

### Users Table
```sql
CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    username VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(200) NOT NULL,
    role VARCHAR(20) NOT NULL,  -- 'admin', 'staff', or 'student'
    student_id INTEGER,  -- Foreign key to students table (nullable, only for student role)
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

**Role Hierarchy:**
- **Admin** (highest privileges)
  - Can create/delete: Admin, Staff, Student accounts
  - Full system access
- **Staff** (medium privileges)
  - Can create/delete: Student accounts only
  - Full data access (view/edit all students)
- **Student** (lowest privileges)
  - View-only access to own data
  - Cannot create/edit/delete anything

## Features Implemented
✅ Three-tier role-based authentication (Admin, Staff, Student)
✅ Secure password hashing
✅ Session management with Flask-Login
✅ Role-based access control on all endpoints
✅ Data filtering by user role
✅ User management interface
✅ Password reset functionality
✅ Real-time student data viewing
✅ Read-only access for students

## Future Enhancements
- Email-based password reset
- Multi-factor authentication (MFA)
- Password complexity requirements enforcement
- Account lockout after failed login attempts
- Detailed audit logging for data changes
- Password expiration policies
- Session timeout customization
- IP-based access restrictions

