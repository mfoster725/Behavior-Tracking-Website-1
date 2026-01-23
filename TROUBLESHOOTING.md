# Troubleshooting: Not Seeing Changes After Deployment

## Issue Analysis

The HIPAA and FERPA compliance features were successfully pushed to git and are in the codebase, but you're not seeing them because:

1. **Backend-only implementation**: We added API endpoints but no frontend UI
2. **Database migrations**: New tables need to be created on Render
3. **No visible UI changes**: The features are accessible via API calls, not through the web interface

## How to Verify Changes Are Working

### 1. Check if Backend Endpoints Are Available

Test the endpoints directly using curl or Postman:

```bash
# Test parent creation endpoint (requires authentication)
curl -X POST https://your-render-app.onrender.com/api/parents \
  -H "Content-Type: application/json" \
  -H "Cookie: session=your-session-cookie" \
  -d '{
    "student_id": 1,
    "name": "Test Parent",
    "username": "testparent",
    "password": "TestPassword123!",
    "relationship": "parent"
  }'

# Test amendment requests endpoint
curl -X GET https://your-render-app.onrender.com/api/amendment-requests \
  -H "Cookie: session=your-session-cookie"

# Test data export endpoint
curl -X GET https://your-render-app.onrender.com/api/export-student-data/1 \
  -H "Cookie: session=your-session-cookie"
```

### 2. Check Render Deployment Logs

1. Go to your Render dashboard
2. Click on your service
3. Go to "Logs" tab
4. Look for:
   - "Creating parent_students table..."
   - "Creating amendment_requests table..."
   - "Adding directory_info_opt_out column to students table..."
   - Any error messages

### 3. Verify Database Tables Exist

You can check if tables exist by looking at the logs or by testing the endpoints. If tables don't exist, you'll get database errors.

### 4. Check Browser Console

Open your browser's developer console (F12) and check for:
- 404 errors when trying to access new endpoints
- CORS errors
- Authentication errors

## What Was Added (Backend Only)

### New API Endpoints:
1. **Parent Management**:
   - `POST /api/parents` - Create parent account
   - `GET /api/parents` - List parents
   - `POST /api/parents/<id>/verify` - Verify parent access

2. **Amendment Requests**:
   - `POST /api/amendment-requests` - Create request
   - `GET /api/amendment-requests` - View requests
   - `POST /api/amendment-requests/<id>/review` - Review request

3. **Directory Opt-Out**:
   - `POST /api/students/<id>/directory-opt-out` - Opt-out
   - `DELETE /api/students/<id>/directory-opt-out` - Opt-in

4. **Data Export**:
   - `GET /api/export-student-data/<id>` - Export student data

### New Database Tables:
- `parent_students` - Links parents to students
- `amendment_requests` - Tracks amendment requests

### New Database Columns:
- `students.directory_info_opt_out` - Directory information opt-out flag

## Why You're Not Seeing UI Changes

**We only added backend API endpoints.** There is no frontend UI for:
- Creating parent accounts
- Viewing/managing amendment requests
- Directory information opt-out
- Data export button

These features need to be accessed via:
- API calls (curl, Postman, etc.)
- Frontend JavaScript code (not yet implemented)
- Direct database queries

## Solutions

### Option 1: Test via Browser Console

You can test the endpoints directly from the browser console:

```javascript
// After logging in, test parent creation
fetch('/api/parents', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    student_id: 1,
    name: 'Test Parent',
    username: 'testparent',
    password: 'TestPassword123!',
    relationship: 'parent'
  })
})
.then(r => r.json())
.then(console.log);

// Test amendment requests
fetch('/api/amendment-requests')
.then(r => r.json())
.then(console.log);

// Test data export
fetch('/api/export-student-data/1')
.then(r => r.json())
.then(console.log);
```

### Option 2: Check Render Deployment

1. **Verify deployment succeeded**:
   - Check Render dashboard → Your service → "Events" tab
   - Look for successful deployment

2. **Check for errors**:
   - Look at "Logs" tab for any errors
   - Common issues:
     - Database connection errors
     - Missing environment variables
     - Import errors

3. **Force redeploy**:
   - In Render dashboard, click "Manual Deploy" → "Deploy latest commit"

### Option 3: Verify Database Migrations Ran

The `init_db()` function should automatically create tables, but you can verify:

1. Check Render logs for table creation messages
2. If tables don't exist, you may need to manually run migrations

### Option 4: Add Frontend UI (Recommended)

To make these features visible, you need to add frontend UI. This would involve:
- Adding new tabs/views in `templates/index.html`
- Adding JavaScript functions in `static/app.js` to call the API endpoints
- Adding forms and buttons for user interaction

## Quick Verification Checklist

- [ ] Check Render deployment logs for errors
- [ ] Verify tables exist (check logs for "Creating parent_students table...")
- [ ] Test endpoints via browser console or Postman
- [ ] Check browser console for JavaScript errors
- [ ] Verify you're logged in with appropriate role (staff/admin for most endpoints)

## Next Steps

1. **Immediate**: Test endpoints via browser console or API tool
2. **Short-term**: Add frontend UI for these features
3. **Ongoing**: Monitor Render logs for any deployment issues

## Common Issues on Render

1. **Database migrations not running**: The `init_db()` function runs on app startup, but if there are errors, tables won't be created
2. **Environment variables**: Make sure `SECRET_KEY` and `DATABASE_URL` are set
3. **Build failures**: Check if Python dependencies installed correctly
4. **Timeout errors**: Render free tier has cold starts - first request may timeout

## Need Help?

If endpoints still don't work:
1. Check Render logs for specific error messages
2. Test locally first: `python app.py` and test endpoints
3. Verify database connection on Render
4. Check that all dependencies are in `requirements.txt`
