# Setup Guide - Behavior Tracking System

## Python Installation Required

It looks like Python is not installed on your system. Follow these steps:

### Step 1: Install Python

1. **Download Python:**
   - Go to https://www.python.org/downloads/
   - Download Python 3.11 or newer (Windows installer)

2. **Install Python:**
   - Run the installer
   - **IMPORTANT:** Check the box "Add Python to PATH" at the bottom of the installer
   - Click "Install Now"
   - Wait for installation to complete

3. **Verify Installation:**
   - Close and reopen PowerShell/Command Prompt
   - Run: `python --version`
   - You should see something like: `Python 3.11.x`

### Step 2: Install Dependencies

Once Python is installed, run one of these commands:

**Option A (Recommended):**
```powershell
python -m pip install -r requirements.txt
```

**Option B (If Option A doesn't work):**
```powershell
py -m pip install -r requirements.txt
```

**Option C (Alternative):**
```powershell
pip3 install -r requirements.txt
```

### Step 3: Run the Application

After dependencies are installed:

**Option A:**
```powershell
python app.py
```

**Option B:**
```powershell
py app.py
```

Or simply double-click `run.bat`

### Step 4: Access the Application

Open your web browser and go to:
```
http://localhost:5000
```

## Troubleshooting

### "python is not recognized"
- Python is not installed or not in PATH
- Reinstall Python and make sure to check "Add Python to PATH"
- Restart your terminal after installation

### "pip is not recognized"
- Use `python -m pip` instead of just `pip`
- Or use `py -m pip` if you have the Python launcher

### "Module not found" errors
- Make sure you ran the pip install command successfully
- Try: `python -m pip install --upgrade pip`
- Then: `python -m pip install -r requirements.txt`

## Quick Start (After Python is Installed)

1. Open PowerShell in this folder
2. Run: `python -m pip install -r requirements.txt`
3. Run: `python app.py`
4. Open browser to: http://localhost:5000

## Need Help?

If you continue to have issues:
1. Make sure Python 3.11+ is installed
2. Make sure "Add Python to PATH" was checked during installation
3. Restart your computer after installing Python
4. Try using the full path to Python (usually `C:\Python3x\python.exe`)

