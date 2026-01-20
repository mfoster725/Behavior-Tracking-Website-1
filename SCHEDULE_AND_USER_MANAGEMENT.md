# Schedule and User Management Guide

## Overview
The Behavior Tracking System now includes comprehensive schedule management and user credential management features for staff users.

## New Features

### 1. Schedule Management Tab
Create and manage teacher and student schedules with a weekly grid interface.

### 2. User Management Tab
View student login credentials, reset passwords, and create new student accounts.

## Schedule Management

### Accessing Schedule Management
1. Log in as a staff user
2. Click the **"Schedules"** tab in the navigation

### Teacher Schedule

#### Creating a Teacher Schedule
1. Navigate to the Schedules tab
2. The Teacher Schedule section shows a weekly grid
3. Default time periods are pre-populated based on your standard periods
4. Fill in activities for each day:
   - **Time**: Period time (e.g., "7:45-8:30")
   - **Monday - Friday**: Enter the activity/class for each day
5. Click **"Add Time Period"** to add additional rows
6. Click **"Save Teacher Schedule"** to save changes

#### Example Teacher Schedule
| Time | Monday | Tuesday | Wednesday | Thursday | Friday |
|------|---------|---------|-----------|----------|---------|
| 7:45-8:30 | Planning | Planning | Planning | Planning | Planning |
| 8:30-9:00 | English 101 | English 101 | English 101 | English 101 | English 101 |
| 9:00-9:30 | Math Support | Math Support | Math Support | Math Support | Math Support |

### Student Schedules

#### Creating a Student Schedule
1. Navigate to the Schedules tab
2. Scroll to the "Student Schedules" section
3. Select a student from the dropdown menu
4. Fill in their weekly schedule
5. Click **"Add Time Period"** to add rows as needed
6. Click **"Save Student Schedule"** to save

#### Use Cases
- Track where students should be during each period
- Plan individualized instruction times
- Coordinate with other staff members
- Document therapy or specialist appointments

### Features
- **Persistent Storage**: Schedules are saved to the database
- **Edit Anytime**: Load and modify existing schedules
- **Per-Student Customization**: Each student can have their own unique schedule
- **Weekly View**: See the entire week at a glance

## User Management

### Accessing User Management
1. Log in as a staff user
2. Click the **"User Management"** tab in the navigation

### Viewing Student Credentials

The User Management page displays a table with:
- **Student Name**: The linked student's name
- **Username**: Login username
- **Password**: Hidden by default (shown as ••••••••)
- **Actions**: Reset password button

### Features

#### 1. View All Student Users
- Automatically loads all student accounts
- Shows which students have login access
- Displays username for each student

#### 2. Copy Username
- Click the 📋 button next to the username
- Username is copied to clipboard
- Share credentials with students easily

#### 3. Reset Password
**How to Reset a Password:**
1. Click the **"Reset Password"** button for the desired user
2. Enter the new password when prompted
3. Password must be at least 6 characters
4. The new password displays temporarily (10 seconds) after reset
5. Copy the password immediately to share with the student

**Best Practices:**
- Use memorable but secure passwords
- Consider using student ID + name format (e.g., "student123_john")
- Document passwords securely
- Inform students of password changes promptly

#### 4. Create New Student Users
**How to Create a Student Account:**
1. Click **"Create Student User"** button
2. View list of students without accounts
3. Enter the student ID from the list
4. Enter a username (suggested format shown)
5. Enter a secure password (minimum 6 characters)
6. Confirm creation

**Requirements:**
- Student must exist in the system first
- Username must be unique
- Password minimum length: 6 characters

**Suggested Username Formats:**
- First name + last initial: `john_d`
- Full name underscore: `john_doe`
- Student ID: `student_123`

#### 5. Refresh User List
- Click **"Refresh List"** to reload all users
- Useful after creating new accounts
- Updates displayed information

## Security Considerations

### Password Management
- Passwords are hashed in the database
- Staff can view usernames but not stored passwords
- Reset passwords are shown only once after creation
- Use strong passwords for all accounts

### Access Control
- Only staff users can access Schedule and User Management tabs
- Students cannot see other students' schedules or credentials
- All actions are logged with timestamps

### Best Practices
1. **Regular Updates**: Review and update schedules regularly
2. **Password Policy**: Establish minimum password requirements
3. **Documentation**: Keep a secure backup of credentials
4. **Student Privacy**: Handle login information responsibly
5. **Schedule Accuracy**: Verify schedules with students regularly

## Database Schema

### Schedules Table
```sql
CREATE TABLE schedules (
    id INTEGER PRIMARY KEY,
    schedule_type VARCHAR(20) NOT NULL,  -- 'teacher' or 'student'
    student_id INTEGER,  -- Foreign key to students table (NULL for teacher)
    time_period VARCHAR(50) NOT NULL,
    monday VARCHAR(100),
    tuesday VARCHAR(100),
    wednesday VARCHAR(100),
    thursday VARCHAR(100),
    friday VARCHAR(100),
    created_at DATETIME,
    updated_at DATETIME
);
```

## API Endpoints

### Schedule Management
- `GET /api/schedules?schedule_type=teacher` - Get teacher schedule
- `GET /api/schedules?schedule_type=student&student_id=X` - Get student schedule
- `POST /api/schedules` - Save schedule

### User Management
- `GET /api/users/list` - Get all student users
- `POST /api/users/reset-password` - Reset a user's password
- `POST /api/users/create-student` - Create new student user account

## Troubleshooting

### Schedule Not Saving
1. Verify all time periods are filled in
2. Check that you clicked "Save" button
3. Ensure you have staff permissions
4. Check browser console for errors

### Cannot Create User
1. Verify student exists in the system
2. Check that username is unique
3. Ensure password meets minimum length (6 characters)
4. Verify student doesn't already have an account

### User List Not Loading
1. Click "Refresh List" button
2. Verify you're logged in as staff
3. Check network connection
4. Verify database connection

## Tips and Tricks

### For Schedule Management
- **Copy Schedule**: Load an existing schedule, modify it for another student
- **Standard Periods**: Use consistent time periods across all schedules
- **Color Coding**: Use consistent naming (e.g., "Math - Room 101")
- **Planning Time**: Block out planning/prep periods

### For User Management
- **Bulk Creation**: Use the create_users.py script for multiple accounts
- **Password Patterns**: Establish a consistent password format
- **Username Convention**: Use lowercase, underscores instead of spaces
- **Regular Audits**: Review user list quarterly
- **Inactive Accounts**: Remove accounts for students who leave

## Future Enhancements
- Schedule templates
- Bulk schedule import
- Schedule conflict detection
- Email credentials to students/parents
- Password expiration and forced resets
- Multi-week schedules
- Print/export schedules
- Schedule sharing between staff members

