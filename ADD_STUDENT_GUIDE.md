# Add Student Feature Guide

## Overview
The "Add Student" functionality has been consolidated into the **User Management** tab for a streamlined experience. This comprehensive form allows staff to create a new student record, user account, and assign support team members all in one place.

## Location
**User Management Tab** → **Add Student Button**

## Accessing the Feature
1. Log in as a staff user
2. Click the **"User Management"** tab in the navigation
3. Click the **"Add Student"** button (blue, primary button)

## Add Student Form

The Add Student modal includes three main sections:

### 1. Student Information (Required)
- **Student Name** * - Full name of the student
- **Email** - Student's email address (optional)

### 2. Login Credentials (Required)
- **Username** * - Unique username for student login
  - Used by the student to access their data
  - Must be unique across all users
  - Suggested format: `firstname_lastname` or `firstname_l`
- **Password** * - Login password for the student
  - Minimum 6 characters required
  - Student will use this to log in to view their data

### 3. Support Team (Optional)
Assign team members who support this student:
- **Case Manager** - Primary case manager name
- **Practitioner** - Assigned practitioner name
- **Professional** - Assigned professional name
- **Group Leader** - Group leader name

All team member fields are optional but recommended for comprehensive student support tracking.

## How to Add a Student

### Step-by-Step Instructions

1. **Open the Form**
   - Navigate to User Management tab
   - Click "Add Student" button
   - Modal window appears with the form

2. **Fill in Student Information**
   ```
   Student Name: John Doe
   Email: john.doe@example.com (optional)
   ```

3. **Set Login Credentials**
   ```
   Username: john_doe
   Password: student123 (minimum 6 characters)
   ```

4. **Assign Support Team** (Optional)
   ```
   Case Manager: Ms. Smith
   Practitioner: Dr. Johnson
   Professional: Mr. Williams
   Group Leader: Ms. Davis
   ```

5. **Save**
   - Click "Save Student" button
   - Or click "Cancel" to discard

### What Happens When You Save

The system will:
1. ✓ Create the student record in the database
2. ✓ Create a user account with the provided credentials
3. ✓ Link the user account to the student record
4. ✓ Store all support team member information
5. ✓ Add the student to all dropdown lists throughout the application
6. ✓ Enable the student to log in immediately with their credentials
7. ✓ Display success message

## Field Requirements

### Required Fields (marked with *)
- **Student Name** - Cannot be empty
- **Username** - Must be unique, cannot be empty
- **Password** - Minimum 6 characters

### Optional Fields
- Email
- All support team member fields

## Validation

### Username Validation
- Checked for uniqueness
- If username exists, error message displayed: "Username already exists"
- Must contain at least one character

### Password Validation
- Must be at least 6 characters long
- Can contain letters, numbers, and special characters
- Case sensitive

### Error Messages
The form will display specific error messages:
- "Please enter a student name"
- "Please enter a username"
- "Password must be at least 6 characters long"
- "Username already exists"

## After Creation

Once a student is created:

### Student Can:
1. Log in at `/login` with their username and password
2. View their own behavior data (read-only)
3. See their STAR ratings, notes, and statistics
4. Access their personal summary reports

### Staff Can:
1. See the student in all dropdowns (Period Entry, Daily Entry, Summaries)
2. Enter behavior data for the student
3. View/edit the student's credentials in User Management
4. Reset the student's password if needed
5. View assigned support team members

## Best Practices

### Username Guidelines
- Use lowercase letters
- Replace spaces with underscores: `john_doe`
- Keep it simple and memorable
- Avoid special characters except underscore
- Examples:
  - `john_d`
  - `john_doe`
  - `jdoe`
  - `student_123`

### Password Guidelines
- Use at least 8 characters (though minimum is 6)
- Make it memorable but secure
- Consider patterns: `student123`, `school2024`
- Document passwords securely
- Share only with the student/guardian

### Support Team Information
- Use full names for clarity
- Keep information current
- Update when team members change
- Use consistent formatting

## Removed Features

The following changes were made to consolidate functionality:

### Removed from Period Entry Tab
- ❌ "Add Student" button removed
- All student creation now through User Management

### Removed from Daily Entry Tab
- ❌ "Add Student" button removed
- Cleaner interface focused on data entry

### Why the Change?
- **Single Location**: All user/student management in one place
- **Comprehensive Form**: Capture all information at once
- **Better Organization**: Separate data entry from user management
- **Consistent Experience**: One way to add students reduces confusion

## Comparison: Old vs New

### Old Method
- Multiple "Add Student" buttons across different tabs
- Simple form with only name and email
- No user account creation
- Had to create login separately
- No team member assignment

### New Method
- Single "Add Student" button in User Management
- Comprehensive form with all fields
- Creates student AND user account simultaneously
- Assigns support team members
- All data in one transaction

## Troubleshooting

### "Username already exists" Error
**Solution:** Choose a different username. Try adding numbers or variations.

### Cannot Save Student
**Possible causes:**
1. Missing required fields (name, username, or password)
2. Password too short (less than 6 characters)
3. Username already taken
4. Network connection issue

### Student Not Appearing in Dropdowns
**Solution:**
1. Click "Refresh List" in User Management
2. Reload the page
3. Check that save was successful

### Login Not Working
**Verify:**
1. Username is correct (case-sensitive)
2. Password is correct (case-sensitive)
3. Account was successfully created
4. Check User Management table for the account

## Tips and Tricks

### Bulk Student Creation
For adding multiple students:
1. Prepare a list with all information
2. Open the form once for each student
3. Use consistent naming patterns
4. Document all credentials immediately

### Team Member Tracking
- Use the support team fields to track who works with each student
- Update these fields as assignments change
- Helps coordinate care and communication

### Quick Username Creation
Suggested formats based on student name:
- "John Michael Doe" → `john_doe` or `jdoe` or `john_m_d`
- "Sarah Smith" → `sarah_smith` or `ssmith` or `sarah_s`

### Password Management
- Create a secure document with all student credentials
- Store in encrypted/secure location
- Update when passwords are reset
- Share securely with students/guardians

## Related Features

### User Management Tab
- View all student credentials
- Reset passwords
- Refresh user list

### Other Tabs
- **Period Entry**: Select student for data entry
- **Daily Entry**: Bulk data entry for all students
- **Summary**: View student statistics
- **Schedules**: Create student-specific schedules

## Security Notes

- Only staff users can add students
- Passwords are hashed (never stored as plain text)
- Students can only view their own data
- All actions require authentication
- Session timeout for security

## Future Enhancements

Potential improvements:
- CSV import for bulk student creation
- Email notification to students with credentials
- Auto-generate secure passwords
- Parent/guardian contact information
- Student photos/avatars
- Bulk edit support team assignments

