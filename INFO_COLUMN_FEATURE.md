# Info Column Feature - Documentation

## Overview
A new purple "I" (Info) column has been added to the Daily Entry view, positioned to the right of the "R" (Relationships) column. This column provides a comprehensive data entry form for tracking detailed behavioral information including notes, reminders, infractions, frenzy events, and outcomes.

## Features

### 1. Visual Design
- **Column Header**: Purple "I" header matching the STAR column design
- **Button Style**: Purple button with lowercase "i" that stands out from other data columns
- **Color Scheme**: Uses purple (#E9D5FF background, #6B21A8 text, #9333EA borders)
- **Data Indicator**: Buttons with saved data show a darker purple background and green dot indicator

### 2. Structured Data Entry Form
The info modal includes the following fields:

#### **Notes**
- Free-form text area for general observations and notes

#### **Reminders** 
- 3 checkboxes in a single row for quick reminder tracking
- Labeled as Reminder 1, Reminder 2, and Reminder 3

#### **Reset**
- Single checkbox to indicate if a reset occurred

#### **Infractions** (2 separate entries)
Each infraction entry includes:
- Dropdown menu with 16 infraction types:
  - Aggression
  - Attention Seeking
  - Disrespectful
  - Language
  - MYOB
  - NFD
  - Property Destruction
  - Off Task
  - Personal Space
  - Refusal
  - Self Control
  - Sexual Reference
  - Shutdown
  - Threat
  - Volume
  - Walk Out
- Number field for count (#)

#### **Frenzy**
- Single checkbox to indicate if a frenzy event occurred

#### **Purpose Fields**
- Purpose 1: Text field for primary purpose/reason
- Purpose 2: Text field for secondary purpose/reason

#### **Duration**
- Number field for duration in minutes

#### **Results of Behavior**
- Free-form text area for documenting outcomes and results

### 3. Data Storage & Persistence
- All data is stored as JSON in the `period_records` table under the `info` column
- Structured data format ensures consistent data collection
- Data is saved when you click "Save All Data" in the Daily Entry view
- Information persists across sessions and can be edited at any time
- Visual indicators show which periods have saved information

## How to Use

1. **Navigate to Daily Entry View**
   - Click the "Daily Entry" tab in the navigation

2. **Select a Date**
   - Choose the date you want to work with

3. **Enter STAR Ratings**
   - Fill in S, T, A, R values as usual (using the dropdown menus)

4. **Add Detailed Information**
   - Click the purple "i" button for any student/period combination
   - A comprehensive form popup will appear
   - Fill in any relevant fields:
     - **Notes**: General observations
     - **Reminders**: Check applicable reminders (1, 2, or 3)
     - **Reset**: Check if a reset occurred
     - **Infractions**: Select up to 2 different infractions and their counts
     - **Frenzy**: Check if a frenzy event occurred
     - **Purposes**: Document reasons or triggers (two fields available)
     - **Duration**: Enter duration in minutes
     - **Results**: Document outcomes and consequences
   - Click "Save Info" to store the information
   - Click "Cancel" to discard changes

5. **Visual Indicators**
   - Buttons with saved data appear darker purple with a green dot indicator
   - Empty buttons remain light purple

6. **Save All Data**
   - Click "Save All Data" to persist all changes to the database
   - This saves STAR ratings and all detailed info data together

## Technical Details

### Database Schema
- Added `info` TEXT column to the `period_records` table
- Migration script included: `migrate_add_info.py`

### Frontend Components
- New modal: `#info-modal` with textarea for info input
- New button class: `.info-btn` with purple styling
- New data cell class: `.daily-info-cell` with light purple background

### API Updates
- Backend now handles `info` field in all daily record operations
- GET requests include info data in period records
- POST requests save info data with other period information

## Color Coding

The STAR + Info columns use the following color scheme:
- **S (Safety)**: Yellow (#FEF3C7)
- **T (Teamwork)**: Blue (#DBEAFE)
- **A (Accountability)**: Green (#D1FAE5)
- **R (Relationships)**: Red (#FEE2E2)
- **I (Info)**: Purple (#E9D5FF) ← NEW

## Future Enhancements
- Export info data to CSV reports
- Search/filter by info content
- Rich text formatting in info field
- Info field in Period Entry view

