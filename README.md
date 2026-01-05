# Behavior Tracking System

A modern web-based system for collecting and managing behavior data for schools. This system replaces the inefficient CSV-based workflow with a database-driven application.

## Features

- **Daily Point Card Entry**: Easy-to-use interface for entering daily behavior data
- **Automatic Calculations**: Summary reports and statistics calculated automatically
- **Frenzy Event Tracking**: Track and analyze frenzy events with detailed statistics
- **Student Management**: Add and manage multiple students
- **Quarter-based Reporting**: View summaries by quarter or all year
- **Data Persistence**: SQLite database for reliable data storage

## Installation

### Prerequisites
**Python 3.11 or newer must be installed first!**

If you see "pip is not recognized" or "python is not recognized", you need to install Python:
1. Download from https://www.python.org/downloads/
2. **IMPORTANT:** Check "Add Python to PATH" during installation
3. Restart PowerShell after installation

See `SETUP_GUIDE.md` for detailed installation instructions.

### Option 1: Using the batch file (Windows)
1. Double-click `install.bat` to install dependencies
2. Double-click `run.bat` to start the server

### Option 2: Manual installation
1. Install Python dependencies (try these in order):
```powershell
python -m pip install -r requirements.txt
```
   Or if that doesn't work:
```powershell
py -m pip install -r requirements.txt
```
   Or:
```powershell
pip3 install -r requirements.txt
```

2. Run the application:
```powershell
python app.py
```
   Or:
```powershell
py app.py
```

3. Open your browser and navigate to:
```
http://localhost:5000
```

### Troubleshooting
- **"pip is not recognized"**: Use `python -m pip` instead of just `pip`
- **"python is not recognized"**: Python is not installed. Download from https://www.python.org/ and make sure to check "Add Python to PATH"
- **After installing Python**: Restart your terminal/PowerShell window

## Usage

### Daily Entry
1. Select a student from the dropdown (or add a new one)
2. Select the date
3. Add periods with STAR points (Safety, Teamwork, Accountability, Relationships)
4. Add infractions if needed
5. Add frenzy events if applicable
6. Click "Save Daily Record"

### Summary View
1. Select a student (or leave as "All Students")
2. Select a quarter
3. Click "Load Summary" to view aggregated statistics

### Frenzy Stats
1. Select a student (or leave as "All Students")
2. Click "Load Statistics" to view frenzy event analysis

## Data Structure

The system tracks:
- **Daily Records**: Date, attendance, periods
- **Period Records**: Time, location, STAR points, infractions
- **Infractions**: General and harmful infraction types
- **Frenzy Events**: Time, location, purpose, duration, results

## Database

Data is stored in `behavior_tracking.db` (SQLite). The database is created automatically on first run.

## Future Enhancements

- CSV import functionality for existing data
- Data export capabilities
- Advanced reporting and charts
- User authentication
- Multi-school support

