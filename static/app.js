// Standard time periods
const STANDARD_PERIODS = [
    { time: 'AM Bus', location: 'Bus' },
    { time: '7:45-8:30', location: 'Bkfst' },
    { time: '8:30-9:00', location: 'English' },
    { time: '9:00-9:30', location: 'Math' },
    { time: '9:30-10:00', location: 'Science' },
    { time: '10:00-10:30', location: 'Group' },
    { time: '10:30-11:00', location: 'Group' },
    { time: '11:00-11:30', location: 'Individual' },
    { time: '11:30-12:00', location: 'Lunch' },
    { time: '12:00-12:30', location: 'Phys Ed' },
    { time: '12:30-1:00', location: 'Social' },
    { time: '1:00-1:30', location: 'Individual' },
    { time: '1:30-2:00', location: 'Studio' },
    { time: '2:00-2:30', location: 'Studio' },
    { time: '2:30-2:45', location: 'Homeroom' },
    { time: 'PM Bus', location: 'Bus' }
];

const INFRACTION_TYPES = {
    general: ['Lang', 'NFD', 'Off Task', 'MYOB', 'Self Control', 'Shutdown', 'Volume', 'Attention Seeking', 'Refusal', 'Personal Space'],
    harmful: ['Walk', 'Aggression', 'Property Destruction', 'Sexual Reference', 'Threat', 'Disrespectful']
};

let currentStudentId = null;
let currentDate = new Date().toISOString().split('T')[0];
let currentPeriod = null;
let currentLocation = '';
let allStudents = [];
let periodData = {}; // Store data by student_id for current period
let dailyData = {}; // Store data for daily overview: dailyData[studentId][period] = {s, t, a, r}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    try {
        console.log('Initializing Behavior Tracking System...');
        
        // Set default date if not already set
        const dateInput = document.getElementById('date-input');
        if (dateInput && !dateInput.value) {
            dateInput.value = new Date().toISOString().split('T')[0];
        }
        
        // Set default date for period entry if not already set
        const entryDateInput = document.getElementById('entry-date-input');
        if (entryDateInput && !entryDateInput.value) {
            entryDateInput.value = new Date().toISOString().split('T')[0];
            currentDate = entryDateInput.value;
        }
        
        // Set default date for daily entry if not already set
        const dailyDateInput = document.getElementById('daily-date-input');
        if (dailyDateInput && !dailyDateInput.value) {
            dailyDateInput.value = new Date().toISOString().split('T')[0];
        }
        
        loadStudents();
        setupEventListeners();
        
        // Set up period selector
        setupPeriodSelector();
        
        console.log('Initialization complete');
    } catch (error) {
        console.error('Error during initialization:', error);
        alert('Error initializing application. Please check the console for details.');
    }
});

function setupEventListeners() {
    try {
        console.log('Setting up event listeners...');
        
        // Navigation
        const navButtons = document.querySelectorAll('.nav-btn');
        console.log(`Found ${navButtons.length} navigation buttons`);
        navButtons.forEach(btn => {
            btn.addEventListener('click', (e) => {
                const view = e.target.dataset.view;
                console.log('Switching to view:', view);
                switchView(view);
            });
        });

        // Student selection
        const studentSelect = document.getElementById('student-select');
        if (studentSelect) {
            studentSelect.addEventListener('change', (e) => {
                currentStudentId = e.target.value;
                console.log('Student selected:', currentStudentId);
                loadExistingRecord();
            });
        } else {
            console.warn('student-select element not found');
        }

        const dateInput = document.getElementById('date-input');
        if (dateInput) {
            dateInput.addEventListener('change', (e) => {
                currentDate = e.target.value;
                console.log('Date changed:', currentDate);
                loadExistingRecord();
            });
        } else {
            console.warn('date-input element not found');
        }

        // Period-based entry
        const periodSelect = document.getElementById('period-select');
        if (periodSelect) {
            periodSelect.addEventListener('change', (e) => {
                currentPeriod = e.target.value;
                console.log('Period selected:', currentPeriod);
                
                // Auto-fill location based on period
                const selectedPeriod = STANDARD_PERIODS.find(p => p.time === currentPeriod);
                const locationInput = document.getElementById('location-input');
                if (locationInput && selectedPeriod) {
                    locationInput.value = selectedPeriod.location;
                    currentLocation = selectedPeriod.location;
                }
                
                loadPeriodData();
            });
        }

        const entryDateInput = document.getElementById('entry-date-input');
        if (entryDateInput) {
            entryDateInput.addEventListener('change', (e) => {
                currentDate = e.target.value;
                console.log('Entry date changed:', currentDate);
                if (currentPeriod) {
                    loadPeriodData();
                }
            });
        }

        const locationInput = document.getElementById('location-input');
        if (locationInput) {
            locationInput.addEventListener('change', (e) => {
                currentLocation = e.target.value;
            });
        }

        const savePeriodBtn = document.getElementById('save-period-btn');
        if (savePeriodBtn) {
            savePeriodBtn.addEventListener('click', savePeriodData);
        }

        const clearPeriodBtn = document.getElementById('clear-period-btn');
        if (clearPeriodBtn) {
            clearPeriodBtn.addEventListener('click', clearPeriodData);
        }

        // Daily overview entry
        const dailyDateInput = document.getElementById('daily-date-input');
        if (dailyDateInput) {
            dailyDateInput.addEventListener('change', (e) => {
                currentDate = e.target.value;
                console.log('Daily date changed:', currentDate);
                if (allStudents.length > 0) {
                    loadDailyData();
                }
            });
        }

        const saveDailyAllBtn = document.getElementById('save-daily-all-btn');
        if (saveDailyAllBtn) {
            saveDailyAllBtn.addEventListener('click', saveDailyAllData);
        }

        const clearDailyAllBtn = document.getElementById('clear-daily-all-btn');
        if (clearDailyAllBtn) {
            clearDailyAllBtn.addEventListener('click', clearDailyAllData);
        }

        // Buttons
        const addPeriodBtn = document.getElementById('add-period-btn');
        if (addPeriodBtn) {
            addPeriodBtn.addEventListener('click', () => {
                console.log('Add period button clicked');
                addPeriod();
            });
        } else {
            console.warn('add-period-btn not found');
        }

        const addFrenzyBtn = document.getElementById('add-frenzy-btn');
        if (addFrenzyBtn) {
            addFrenzyBtn.addEventListener('click', () => {
                console.log('Add frenzy button clicked');
                addFrenzy();
            });
        } else {
            console.warn('add-frenzy-btn not found');
        }

        const saveBtn = document.getElementById('save-btn');
        if (saveBtn) {
            saveBtn.addEventListener('click', () => {
                console.log('Save button clicked');
                saveDailyRecord();
            });
        } else {
            console.warn('save-btn not found');
        }

        const addStudentBtn = document.getElementById('add-student-btn');
        if (addStudentBtn) {
            addStudentBtn.addEventListener('click', () => {
                console.log('Add student button clicked');
                document.getElementById('student-modal').style.display = 'block';
            });
        }

        const addStudentBtnPeriod = document.getElementById('add-student-btn-period');
        if (addStudentBtnPeriod) {
            addStudentBtnPeriod.addEventListener('click', () => {
                console.log('Add student button clicked (period view)');
                document.getElementById('student-modal').style.display = 'block';
            });
        }

        const saveStudentBtn = document.getElementById('save-student-btn');
        if (saveStudentBtn) {
            saveStudentBtn.addEventListener('click', () => {
                console.log('Save student button clicked');
                saveStudent();
            });
        } else {
            console.warn('save-student-btn not found');
        }

        const loadSummaryBtn = document.getElementById('load-summary-btn');
        if (loadSummaryBtn) {
            loadSummaryBtn.addEventListener('click', () => {
                console.log('Load summary button clicked');
                loadSummary();
            });
        } else {
            console.warn('load-summary-btn not found');
        }

        const loadFrenzyStatsBtn = document.getElementById('load-frenzy-stats-btn');
        if (loadFrenzyStatsBtn) {
            loadFrenzyStatsBtn.addEventListener('click', () => {
                console.log('Load frenzy stats button clicked');
                loadFrenzyStats();
            });
        } else {
            console.warn('load-frenzy-stats-btn not found');
        }

        const importCsvBtn = document.getElementById('import-csv-btn');
        if (importCsvBtn) {
            importCsvBtn.addEventListener('click', () => {
                console.log('Import CSV button clicked');
                importCSV();
            });
        } else {
            console.warn('import-csv-btn not found');
        }

        // Modal close
        const closeBtn = document.querySelector('.close');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                document.getElementById('student-modal').style.display = 'none';
            });
        } else {
            console.warn('Close button not found');
        }

        window.addEventListener('click', (e) => {
            if (e.target.id === 'student-modal') {
                document.getElementById('student-modal').style.display = 'none';
            }
        });

        console.log('Event listeners set up successfully');
    } catch (error) {
        console.error('Error setting up event listeners:', error);
        alert('Error setting up event listeners. Please check the console.');
    }
}

function switchView(viewName) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    
    const viewElement = document.getElementById(`${viewName}-view`);
    if (viewElement) {
        viewElement.classList.add('active');
    }
    
    const navButton = document.querySelector(`[data-view="${viewName}"]`);
    if (navButton) {
        navButton.classList.add('active');
    }
    
    // If switching to period entry view, reload data
    if (viewName === 'period-entry' && currentPeriod) {
        loadPeriodData();
    }
    
    // If switching to daily entry view, reload data
    if (viewName === 'entry') {
        loadDailyData();
    }
}

function setupPeriodSelector() {
    const periodSelect = document.getElementById('period-select');
    if (periodSelect) {
        periodSelect.innerHTML = '<option value="">Select Period</option>';
        STANDARD_PERIODS.forEach(period => {
            const option = document.createElement('option');
            option.value = period.time;
            option.textContent = `${period.time} - ${period.location}`;
            periodSelect.appendChild(option);
        });
    }
}

async function loadStudents() {
    try {
        const response = await fetch('/api/students');
        allStudents = await response.json();
        
        const select = document.getElementById('student-select');
        const summarySelect = document.getElementById('summary-student-select');
        const frenzySelect = document.getElementById('frenzy-student-select');
        
        [select, summarySelect, frenzySelect].forEach(sel => {
            if (sel) {
                sel.innerHTML = '<option value="">Select Student</option>';
                allStudents.forEach(student => {
                    const option = document.createElement('option');
                    option.value = student.id;
                    option.textContent = student.name;
                    sel.appendChild(option);
                });
            }
        });
        
        // If period is selected, reload the grid
        if (currentPeriod) {
            loadPeriodData();
        }
        
        // If in daily view, reload that grid
        const entryView = document.getElementById('entry-view');
        if (entryView && entryView.classList.contains('active')) {
            loadDailyData();
        }
    } catch (error) {
        console.error('Error loading students:', error);
    }
}

async function loadPeriodData() {
    if (!currentDate || !currentPeriod) {
        const container = document.getElementById('students-grid-container');
        const noSelect = document.getElementById('no-period-selected');
        if (container) container.style.display = 'none';
        if (noSelect) noSelect.style.display = 'block';
        return;
    }

    const container = document.getElementById('students-grid-container');
    const noSelect = document.getElementById('no-period-selected');
    if (container) container.style.display = 'block';
    if (noSelect) noSelect.style.display = 'none';

    // Load existing data for this period
    try {
        const response = await fetch(`/api/period-data?date=${currentDate}&period=${encodeURIComponent(currentPeriod)}`);
        if (response.ok) {
            const data = await response.json();
            periodData = {};
            data.forEach(item => {
                periodData[item.student_id] = item;
            });
        }
    } catch (error) {
        console.error('Error loading period data:', error);
        periodData = {};
    }

    renderStudentsGrid();
}

function createPointButtons(studentId, category, currentValue) {
    const buttons = [];
    for (let i = 0; i <= 2; i++) {
        const isSelected = currentValue === i ? 'selected' : '';
        buttons.push(`<button type="button" class="point-btn ${isSelected}" data-value="${i}" onclick="selectPoint(${studentId}, '${category}', ${i}, this)">${i}</button>`);
    }
    return buttons.join('');
}

function renderStudentsGrid() {
    const headerRow = document.getElementById('students-header');
    const grid = document.getElementById('categories-grid');
    if (!grid || !headerRow) return;
    
    headerRow.innerHTML = '';
    grid.innerHTML = '';

    if (!allStudents || allStudents.length === 0) {
        grid.innerHTML = '<div class="info-message" style="padding: 20px; text-align: center; grid-column: 1/-1;">No students found. Click "Add Student" to create one.</div>';
        return;
    }

    // Create student headers
    allStudents.forEach(student => {
        const header = document.createElement('div');
        header.className = 'student-header';
        header.textContent = student.name;
        headerRow.appendChild(header);
    });

    // Create category rows
    const categories = [
        { name: 'Safety', key: 'safety' },
        { name: 'Teamwork', key: 'teamwork' },
        { name: 'Accountability', key: 'accountability' },
        { name: 'Relationships', key: 'relationships' }
    ];

    categories.forEach(category => {
        // Category name cell (sticky)
        const categoryName = document.createElement('div');
        categoryName.className = 'category-name';
        categoryName.textContent = category.name;
        categoryName.dataset.category = category.key;
        grid.appendChild(categoryName);

        // Student cells for this category
        allStudents.forEach(student => {
            const data = periodData[student.id] || {};
            const value = data[`${category.key}_points`] !== undefined ? data[`${category.key}_points`] : '';

            const cell = document.createElement('div');
            cell.className = 'student-cell';
            cell.dataset.category = category.key;
            cell.innerHTML = `
                <div class="points-buttons" data-student-id="${student.id}" data-category="${category.key}">
                    ${createPointButtons(student.id, category.key, value)}
                </div>
            `;
            grid.appendChild(cell);
        });
    });
}

function selectPoint(studentId, category, value, buttonElement) {
    // Remove selected class from all buttons in this group
    const buttonGroup = buttonElement.parentElement;
    buttonGroup.querySelectorAll('.point-btn').forEach(btn => {
        btn.classList.remove('selected');
    });
    
    // Add selected class to clicked button
    buttonElement.classList.add('selected');
    
    // Update period data
    if (!periodData[studentId]) {
        periodData[studentId] = { student_id: studentId };
    }
    periodData[studentId][`${category}_points`] = value;
}

// Make function globally accessible for inline handlers
window.selectPoint = selectPoint;

async function savePeriodData() {
    if (!currentDate || !currentPeriod) {
        alert('Please select a date and period');
        return;
    }

    const locationInput = document.getElementById('location-input');
    const location = locationInput ? locationInput.value || currentPeriod : currentPeriod;

    // Prepare data for all students
    const studentsData = [];
    Object.keys(periodData).forEach(studentId => {
        const data = periodData[studentId];
        if (data.safety_points !== undefined || data.teamwork_points !== undefined || 
            data.accountability_points !== undefined || data.relationships_points !== undefined) {
            studentsData.push({
                student_id: parseInt(studentId),
                date: currentDate,
                period: currentPeriod,
                location: location,
                safety_points: data.safety_points || 0,
                teamwork_points: data.teamwork_points || 0,
                accountability_points: data.accountability_points || 0,
                relationships_points: data.relationships_points || 0
            });
        }
    });

    if (studentsData.length === 0) {
        alert('No data to save');
        return;
    }

    try {
        const response = await fetch('/api/period-data', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                date: currentDate,
                period: currentPeriod,
                location: location,
                students: studentsData
            })
        });

        if (response.ok) {
            showMessage(`Saved data for ${studentsData.length} student(s)!`, 'success');
            // Reload to get updated data
            loadPeriodData();
        } else {
            throw new Error('Failed to save');
        }
    } catch (error) {
        console.error('Error saving period data:', error);
        showMessage('Error saving data. Please try again.', 'error');
    }
}

function clearPeriodData() {
    if (confirm('Clear all data for this period?')) {
        periodData = {};
        renderStudentsGrid();
    }
}

// Daily Overview Functions
async function loadDailyData() {
    if (!currentDate || !allStudents || allStudents.length === 0) {
        const container = document.getElementById('daily-grid-container');
        const noStudents = document.getElementById('daily-no-students');
        if (container) container.style.display = 'none';
        if (noStudents) noStudents.style.display = allStudents.length === 0 ? 'block' : 'none';
        return;
    }

    const container = document.getElementById('daily-grid-container');
    const noStudents = document.getElementById('daily-no-students');
    if (container) container.style.display = 'block';
    if (noStudents) noStudents.style.display = 'none';

    // Load existing data for all periods
    dailyData = {};
    
    try {
        // Load data for each student for the current date
        const promises = allStudents.map(student => 
            fetch(`/api/daily-records?student_id=${student.id}&start_date=${currentDate}&end_date=${currentDate}`)
                .then(response => response.json())
        );
        
        const results = await Promise.all(promises);
        
        results.forEach((records, index) => {
            const studentId = allStudents[index].id;
            dailyData[studentId] = {};
            
            if (records && records.length > 0) {
                const record = records[0];
                record.periods.forEach(period => {
                    dailyData[studentId][period.time_range] = {
                        s: period.safety_points,
                        t: period.teamwork_points,
                        a: period.accountability_points,
                        r: period.relationships_points
                    };
                });
            }
        });
    } catch (error) {
        console.error('Error loading daily data:', error);
    }

    renderDailyGrid();
}

function renderDailyGrid() {
    const header = document.getElementById('daily-header');
    const body = document.getElementById('daily-body');
    if (!header || !body) return;
    
    header.innerHTML = '';
    body.innerHTML = '';

    if (!allStudents || allStudents.length === 0) {
        return;
    }

    // Calculate grid columns: Period + spacer + (4 columns per student + 1 spacer between)
    const spacerWidth = '7px'; // 1/4 of original 27px
    const studentColumns = allStudents.map((_, index) => {
        if (index === allStudents.length - 1) {
            // Last student - no spacer after
            return 'repeat(4, 40px)';
        } else {
            // Add spacer after student
            return `repeat(4, 40px) ${spacerWidth}`;
        }
    }).join(' ');
    
    header.style.gridTemplateColumns = `120px ${spacerWidth} ${studentColumns}`;
    body.style.gridTemplateColumns = `120px ${spacerWidth} ${studentColumns}`;

    // Create header row
    const periodHeader = document.createElement('div');
    periodHeader.className = 'daily-header-cell daily-header-period';
    periodHeader.textContent = 'Period';
    header.appendChild(periodHeader);

    // Add spacer after period column
    const periodSpacer = document.createElement('div');
    periodSpacer.style.background = '#e9ecef';
    header.appendChild(periodSpacer);

    // Student headers (each spans 4 columns for S, T, A, R, plus spacer spans)
    allStudents.forEach((student, index) => {
        const studentHeader = document.createElement('div');
        studentHeader.className = 'daily-header-cell daily-header-student';
        studentHeader.textContent = student.name;
        studentHeader.style.gridColumn = 'span 4';
        studentHeader.dataset.studentIndex = index;
        header.appendChild(studentHeader);
        
        // Add spacer cell after each student (except the last)
        if (index < allStudents.length - 1) {
            const spacerHeader = document.createElement('div');
            spacerHeader.style.background = '#e9ecef';
            spacerHeader.style.gridColumn = 'span 1';
            header.appendChild(spacerHeader);
        }
    });

    // Sub-headers for S, T, A, R under each student
    const categoryLabels = ['S', 'T', 'A', 'R'];
    const subHeaderRow = document.createElement('div');
    subHeaderRow.style.display = 'contents';
    
    // Empty cell for Period column
    const emptyCell = document.createElement('div');
    emptyCell.className = 'star-category-header';
    emptyCell.style.background = '#f8f9fa';
    header.appendChild(emptyCell);
    
    // Empty spacer cell after period column
    const emptySpacerCell = document.createElement('div');
    emptySpacerCell.style.background = '#e9ecef';
    header.appendChild(emptySpacerCell);
    
    // S, T, A, R headers for each student
    allStudents.forEach((student, index) => {
        const categoryKeys = ['s', 't', 'a', 'r'];
        categoryLabels.forEach((label, labelIndex) => {
            const catHeader = document.createElement('div');
            catHeader.className = 'star-category-header';
            catHeader.textContent = label;
            catHeader.dataset.studentIndex = index;
            catHeader.dataset.category = categoryKeys[labelIndex];
            header.appendChild(catHeader);
        });
        
        // Add spacer cell after each student (except the last)
        if (index < allStudents.length - 1) {
            const spacerSubHeader = document.createElement('div');
            spacerSubHeader.style.background = '#e9ecef';
            spacerSubHeader.style.gridColumn = 'span 1';
            header.appendChild(spacerSubHeader);
        }
    });

    // Create rows for each period
    STANDARD_PERIODS.forEach((period, periodIndex) => {
        // Period cell
        const periodCell = document.createElement('div');
        periodCell.className = 'daily-period-cell';
        periodCell.textContent = period.time;
        periodCell.dataset.periodIndex = periodIndex;
        body.appendChild(periodCell);

        // Add spacer after period column
        const periodRowSpacer = document.createElement('div');
        periodRowSpacer.style.background = '#e9ecef';
        periodRowSpacer.dataset.periodIndex = periodIndex;
        body.appendChild(periodRowSpacer);

        // For each student, create 4 cells (S, T, A, R)
        allStudents.forEach((student, studentIndex) => {
            const studentData = dailyData[student.id]?.[period.time] || { s: null, t: null, a: null, r: null };
            
            ['s', 't', 'a', 'r'].forEach((category, catIndex) => {
                const cell = document.createElement('div');
                cell.className = 'daily-data-cell';
                cell.style.padding = '2px';
                cell.style.display = 'flex';
                cell.style.justifyContent = 'center';
                cell.style.alignItems = 'center';
                cell.dataset.studentIndex = studentIndex;
                cell.dataset.periodIndex = periodIndex;
                
                const select = document.createElement('select');
                select.className = 'daily-input';
                select.dataset.studentId = student.id;
                select.dataset.period = period.time;
                select.dataset.category = category;
                
                // Add empty option
                const emptyOption = document.createElement('option');
                emptyOption.value = '';
                emptyOption.textContent = '-';
                select.appendChild(emptyOption);
                
                // Add options 2, 1, 0
                [2, 1, 0].forEach(val => {
                    const option = document.createElement('option');
                    option.value = val;
                    option.textContent = val;
                    if (studentData[category] === val) {
                        option.selected = true;
                    }
                    select.appendChild(option);
                });
                
                select.addEventListener('change', handleDailyInputChange);
                select.addEventListener('keydown', handleDailyInputKeydown);
                
                cell.appendChild(select);
                body.appendChild(cell);
            });
            
            // Add spacer cell after each student (except the last)
            if (studentIndex < allStudents.length - 1) {
                const spacerCell = document.createElement('div');
                spacerCell.style.background = '#e9ecef';
                spacerCell.dataset.periodIndex = periodIndex;
                body.appendChild(spacerCell);
            }
        });
    });
}

function handleDailyInputChange(e) {
    const select = e.target;
    const studentId = parseInt(select.dataset.studentId);
    const period = select.dataset.period;
    const category = select.dataset.category;
    const value = select.value === '' ? null : parseInt(select.value);
    
    // Update dailyData
    if (!dailyData[studentId]) {
        dailyData[studentId] = {};
    }
    if (!dailyData[studentId][period]) {
        dailyData[studentId][period] = { s: null, t: null, a: null, r: null };
    }
    dailyData[studentId][period][category] = value;
    
    // Auto-advance to next input
    moveToNextInput(select);
}

function handleDailyInputKeydown(e) {
    const select = e.target;
    
    // Handle backspace to clear value
    if (e.key === 'Backspace') {
        e.preventDefault();
        select.value = '';
        
        // Trigger change event to update data
        const event = new Event('change', { bubbles: true });
        select.dispatchEvent(event);
    }
    // Handle number keys 0, 1, 2
    else if (e.key >= '0' && e.key <= '2') {
        e.preventDefault();
        select.value = e.key;
        
        // Trigger change event
        const event = new Event('change', { bubbles: true });
        select.dispatchEvent(event);
    }
    // Handle arrow keys for navigation
    else if (e.key === 'ArrowRight' || e.key === 'Tab') {
        if (e.key === 'ArrowRight') {
            e.preventDefault();
        }
        moveToNextInput(select);
    }
    else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        moveToPreviousInput(select);
    }
}

function moveToNextInput(currentInput) {
    const allInputs = Array.from(document.querySelectorAll('.daily-input'));
    const currentIndex = allInputs.indexOf(currentInput);
    
    if (currentIndex >= 0 && currentIndex < allInputs.length - 1) {
        const nextInput = allInputs[currentIndex + 1];
        nextInput.focus();
    }
}

function moveToPreviousInput(currentInput) {
    const allInputs = Array.from(document.querySelectorAll('.daily-input'));
    const currentIndex = allInputs.indexOf(currentInput);
    
    if (currentIndex > 0) {
        const prevInput = allInputs[currentIndex - 1];
        prevInput.focus();
    }
}

async function saveDailyAllData() {
    if (!currentDate) {
        alert('Please select a date');
        return;
    }

    if (Object.keys(dailyData).length === 0) {
        alert('No data to save');
        return;
    }

    // Prepare data for API
    const savePromises = [];
    
    Object.keys(dailyData).forEach(studentId => {
        const periods = [];
        
        Object.keys(dailyData[studentId]).forEach(periodTime => {
            const data = dailyData[studentId][periodTime];
            const periodInfo = STANDARD_PERIODS.find(p => p.time === periodTime);
            
            // Only save if at least one value is not null
            if (data.s !== null || data.t !== null || data.a !== null || data.r !== null) {
                periods.push({
                    time_range: periodTime,
                    location: periodInfo ? periodInfo.location : periodTime,
                    safety_points: data.s !== null ? data.s : 0,
                    teamwork_points: data.t !== null ? data.t : 0,
                    accountability_points: data.a !== null ? data.a : 0,
                    relationships_points: data.r !== null ? data.r : 0,
                    points_possible: 4,
                    reset: false,
                    frenzy: false,
                    notes: '',
                    reminders: '',
                    infractions: []
                });
            }
        });

        if (periods.length > 0) {
            const promise = fetch('/api/daily-records', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    student_id: parseInt(studentId),
                    date: currentDate,
                    present: true,
                    periods: periods,
                    frenzies: []
                })
            });
            savePromises.push(promise);
        }
    });

    try {
        await Promise.all(savePromises);
        showMessage(`Saved data for ${savePromises.length} student(s)!`, 'success');
        loadDailyData(); // Reload to confirm
    } catch (error) {
        console.error('Error saving daily data:', error);
        showMessage('Error saving data. Please try again.', 'error');
    }
}

function clearDailyAllData() {
    if (confirm('Clear all data for this day?')) {
        dailyData = {};
        renderDailyGrid();
    }
}

async function loadExistingRecord() {
    if (!currentStudentId || !currentDate) return;

    try {
        const response = await fetch(`/api/daily-records?student_id=${currentStudentId}&start_date=${currentDate}&end_date=${currentDate}`);
        const records = await response.json();
        
        if (records.length > 0) {
            const record = records[0];
            loadRecordIntoForm(record);
        } else {
            // Load standard periods
            loadStandardPeriods();
        }
    } catch (error) {
        console.error('Error loading record:', error);
    }
}

function loadStandardPeriods() {
    const container = document.getElementById('periods-container');
    container.innerHTML = '';
    
    STANDARD_PERIODS.forEach(period => {
        addPeriod(period.time, period.location);
    });
}

function loadRecordIntoForm(record) {
    const container = document.getElementById('periods-container');
    container.innerHTML = '';
    
    record.periods.forEach(period => {
        addPeriod(
            period.time_range,
            period.location,
            period.safety_points,
            period.teamwork_points,
            period.accountability_points,
            period.relationships_points,
            period.reset,
            period.frenzy,
            period.notes,
            period.reminders,
            period.infractions
        );
    });

    const frenziesContainer = document.getElementById('frenzies-container');
    if (frenziesContainer) {
        frenziesContainer.innerHTML = '';
        record.frenzies.forEach(frenzy => {
            addFrenzy(
                frenzy.time_range,
                frenzy.location,
                frenzy.purpose,
                frenzy.purpose2,
                frenzy.duration_minutes,
                frenzy.result
            );
        });
    }
}

function addPeriod(timeRange = '', location = '', safety = 0, teamwork = 0, accountability = 0, relationships = 0, reset = false, frenzy = false, notes = '', reminders = '', infractions = []) {
    try {
        const container = document.getElementById('periods-container');
        if (!container) {
            console.error('periods-container element not found');
            return;
        }
    const card = document.createElement('div');
    card.className = 'period-card';
    
    card.innerHTML = `
        <button class="delete-btn" onclick="this.parentElement.remove()">×</button>
        <h4>Period</h4>
        <div class="form-group">
            <label>Time Range:</label>
            <input type="text" class="period-time" value="${timeRange}" placeholder="e.g., 7:45-8:30">
        </div>
        <div class="form-group">
            <label>Location:</label>
            <input type="text" class="period-location" value="${location}" placeholder="e.g., English, Math">
        </div>
        <div class="points-grid">
            <div class="points-input">
                <label>Safety</label>
                <input type="number" class="points-safety" value="${safety}" min="0" max="4">
            </div>
            <div class="points-input">
                <label>Teamwork</label>
                <input type="number" class="points-teamwork" value="${teamwork}" min="0" max="4">
            </div>
            <div class="points-input">
                <label>Accountability</label>
                <input type="number" class="points-accountability" value="${accountability}" min="0" max="4">
            </div>
            <div class="points-input">
                <label>Relationships</label>
                <input type="number" class="points-relationships" value="${relationships}" min="0" max="4">
            </div>
        </div>
        <div class="checkbox-group">
            <div class="checkbox-item">
                <input type="checkbox" class="period-reset" ${reset ? 'checked' : ''}>
                <label>Reset</label>
            </div>
            <div class="checkbox-item">
                <input type="checkbox" class="period-frenzy" ${frenzy ? 'checked' : ''}>
                <label>Frenzy</label>
            </div>
        </div>
        <div class="form-group">
            <label>Notes:</label>
            <textarea class="period-notes" rows="2">${notes}</textarea>
        </div>
        <div class="form-group">
            <label>Reminders:</label>
            <textarea class="period-reminders" rows="2">${reminders}</textarea>
        </div>
        <div class="infractions-section">
            <h5>Infractions</h5>
            <div class="infractions-list"></div>
            <button type="button" class="btn-secondary" onclick="addInfraction(this)">Add Infraction</button>
        </div>
    `;
    
        container.appendChild(card);
        
        // Load existing infractions
        const infractionsList = card.querySelector('.infractions-list');
        if (infractionsList) {
            infractions.forEach(inf => {
                addInfractionToCard(infractionsList, inf.type, inf.count, inf.is_general, inf.is_harmful);
            });
        }
        
        console.log('Period added successfully');
    } catch (error) {
        console.error('Error adding period:', error);
        alert('Error adding period. Please check the console.');
    }
}

function addInfraction(button) {
    const card = button.closest('.period-card');
    const list = card.querySelector('.infractions-list');
    addInfractionToCard(list);
}

function addInfractionToCard(list, type = '', count = 1, isGeneral = true, isHarmful = false) {
    const item = document.createElement('div');
    item.className = 'infraction-item';
    
    item.innerHTML = `
        <select class="infraction-type">
            <option value="">Select Type</option>
            <optgroup label="General">
                ${INFRACTION_TYPES.general.map(t => `<option value="${t}" ${type === t && isGeneral ? 'selected' : ''}>${t}</option>`).join('')}
            </optgroup>
            <optgroup label="Harmful">
                ${INFRACTION_TYPES.harmful.map(t => `<option value="${t}" ${type === t && isHarmful ? 'selected' : ''}>${t}</option>`).join('')}
            </optgroup>
        </select>
        <input type="number" class="infraction-count" value="${count}" min="1" placeholder="Count">
        <button type="button" class="delete-btn" onclick="this.parentElement.remove()">×</button>
    `;
    
    list.appendChild(item);
}

function addFrenzy(timeRange = '', location = '', purpose = '', purpose2 = '', duration = '', result = '') {
    try {
        const container = document.getElementById('frenzies-container');
        if (!container) {
            console.error('frenzies-container element not found');
            return;
        }
    const card = document.createElement('div');
    card.className = 'frenzy-card';
    
    card.innerHTML = `
        <button class="delete-btn" onclick="this.parentElement.remove()">×</button>
        <h4>Frenzy Event</h4>
        <div class="form-group">
            <label>Time Range:</label>
            <input type="text" class="frenzy-time" value="${timeRange}" placeholder="e.g., 7:45-8:30">
        </div>
        <div class="form-group">
            <label>Location:</label>
            <input type="text" class="frenzy-location" value="${location}">
        </div>
        <div class="form-group">
            <label>Purpose:</label>
            <input type="text" class="frenzy-purpose" value="${purpose}">
        </div>
        <div class="form-group">
            <label>Purpose 2:</label>
            <input type="text" class="frenzy-purpose2" value="${purpose2}">
        </div>
        <div class="form-group">
            <label>Duration (minutes):</label>
            <input type="number" class="frenzy-duration" value="${duration}" min="0">
        </div>
        <div class="form-group">
            <label>Result:</label>
            <input type="text" class="frenzy-result" value="${result}">
        </div>
    `;
        
        container.appendChild(card);
        console.log('Frenzy event added successfully');
    } catch (error) {
        console.error('Error adding frenzy event:', error);
        alert('Error adding frenzy event. Please check the console.');
    }
}

async function saveDailyRecord() {
    if (!currentStudentId) {
        alert('Please select a student');
        return;
    }

    const date = document.getElementById('date-input').value;
    if (!date) {
        alert('Please select a date');
        return;
    }

    // Collect periods
    const periods = [];
    document.querySelectorAll('.period-card').forEach(card => {
        const infractions = [];
        card.querySelectorAll('.infraction-item').forEach(item => {
            const type = item.querySelector('.infraction-type').value;
            const count = parseInt(item.querySelector('.infraction-count').value) || 1;
            if (type) {
                const isGeneral = INFRACTION_TYPES.general.includes(type);
                const isHarmful = INFRACTION_TYPES.harmful.includes(type);
                infractions.push({ type, count, is_general: isGeneral, is_harmful: isHarmful });
            }
        });

        periods.push({
            time_range: card.querySelector('.period-time').value,
            location: card.querySelector('.period-location').value,
            safety_points: parseInt(card.querySelector('.points-safety').value) || 0,
            teamwork_points: parseInt(card.querySelector('.points-teamwork').value) || 0,
            accountability_points: parseInt(card.querySelector('.points-accountability').value) || 0,
            relationships_points: parseInt(card.querySelector('.points-relationships').value) || 0,
            points_possible: 4,
            reset: card.querySelector('.period-reset').checked,
            frenzy: card.querySelector('.period-frenzy').checked,
            notes: card.querySelector('.period-notes').value,
            reminders: card.querySelector('.period-reminders').value,
            infractions
        });
    });

    // Collect frenzies
    const frenzies = [];
    document.querySelectorAll('.frenzy-card').forEach(card => {
        frenzies.push({
            time_range: card.querySelector('.frenzy-time').value,
            location: card.querySelector('.frenzy-location').value,
            purpose: card.querySelector('.frenzy-purpose').value,
            purpose2: card.querySelector('.frenzy-purpose2').value,
            duration_minutes: parseInt(card.querySelector('.frenzy-duration').value) || 0,
            result: card.querySelector('.frenzy-result').value
        });
    });

    const data = {
        student_id: parseInt(currentStudentId),
        date: date,
        present: true,
        periods,
        frenzies
    };

    try {
        const response = await fetch('/api/daily-records', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });

        if (response.ok) {
            showMessage('Record saved successfully!', 'success');
        } else {
            throw new Error('Failed to save record');
        }
    } catch (error) {
        console.error('Error saving record:', error);
        showMessage('Error saving record. Please try again.', 'error');
    }
}

async function saveStudent() {
    const name = document.getElementById('student-name').value;
    const email = document.getElementById('student-email').value;

    if (!name) {
        alert('Please enter a student name');
        return;
    }

    try {
        const response = await fetch('/api/students', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, email })
        });

        if (response.ok) {
            document.getElementById('student-modal').style.display = 'none';
            document.getElementById('student-name').value = '';
            document.getElementById('student-email').value = '';
            await loadStudents();
            showMessage('Student added successfully!', 'success');
            // Reload grid if in period entry view
            if (currentPeriod) {
                renderStudentsGrid();
            }
            // Reload grid if in daily view
            const entryView = document.getElementById('entry-view');
            if (entryView && entryView.classList.contains('active')) {
                renderDailyGrid();
            }
        }
    } catch (error) {
        console.error('Error saving student:', error);
        showMessage('Error adding student. Please try again.', 'error');
    }
}

async function loadSummary() {
    const studentId = document.getElementById('summary-student-select').value;
    const quarter = document.getElementById('quarter-select').value;

    let url = `/api/summary?quarter=${quarter}`;
    if (studentId) {
        url += `&student_id=${studentId}`;
    }

    try {
        const response = await fetch(url);
        const data = await response.json();

        const container = document.getElementById('summary-results');
        container.innerHTML = `
            <div class="summary-card">
                <h3>Summary - ${quarter === 'all' ? 'All Year' : `Quarter ${quarter}`}</h3>
                <div class="stats-grid">
                    <div class="stat-item">
                        <label>Total Days</label>
                        <div class="value">${data.total_days}</div>
                    </div>
                    <div class="stat-item">
                        <label>Safety Average</label>
                        <div class="value">${data.averages.safety}</div>
                    </div>
                    <div class="stat-item">
                        <label>Teamwork Average</label>
                        <div class="value">${data.averages.teamwork}</div>
                    </div>
                    <div class="stat-item">
                        <label>Accountability Average</label>
                        <div class="value">${data.averages.accountability}</div>
                    </div>
                    <div class="stat-item">
                        <label>Relationships Average</label>
                        <div class="value">${data.averages.relationships}</div>
                    </div>
                    <div class="stat-item">
                        <label>Overall Average</label>
                        <div class="value">${data.averages.overall}</div>
                    </div>
                </div>
                <h4 style="margin-top: 20px;">Infractions</h4>
                <table>
                    <thead>
                        <tr>
                            <th>Type</th>
                            <th>Count</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${Object.entries(data.infractions).map(([type, count]) => `
                            <tr>
                                <td>${type}</td>
                                <td>${count}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;
    } catch (error) {
        console.error('Error loading summary:', error);
        showMessage('Error loading summary. Please try again.', 'error');
    }
}

async function loadFrenzyStats() {
    const studentId = document.getElementById('frenzy-student-select').value;

    let url = '/api/frenzy-stats';
    if (studentId) {
        url += `?student_id=${studentId}`;
    }

    try {
        const response = await fetch(url);
        const data = await response.json();

        const container = document.getElementById('frenzy-results');
        container.innerHTML = `
            <div class="summary-card">
                <h3>Frenzy Statistics</h3>
                <div class="stats-grid">
                    <div class="stat-item">
                        <label>Total Frenzies</label>
                        <div class="value">${data.total_count}</div>
                    </div>
                    <div class="stat-item">
                        <label>Total Duration</label>
                        <div class="value">${data.total_duration} min</div>
                    </div>
                    <div class="stat-item">
                        <label>Average Duration</label>
                        <div class="value">${data.avg_duration.toFixed(1)} min</div>
                    </div>
                </div>
                <h4 style="margin-top: 20px;">By Day of Week</h4>
                <table>
                    <thead>
                        <tr>
                            <th>Day</th>
                            <th>Count</th>
                            <th>Total Duration</th>
                            <th>Avg Duration</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${Object.entries(data.by_day).map(([day, stats]) => `
                            <tr>
                                <td>${day}</td>
                                <td>${stats.count}</td>
                                <td>${stats.duration} min</td>
                                <td>${stats.avg_duration.toFixed(1)} min</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
                <h4 style="margin-top: 20px;">By Location</h4>
                <table>
                    <thead>
                        <tr>
                            <th>Location</th>
                            <th>Count</th>
                            <th>Total Duration</th>
                            <th>Avg Duration</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${Object.entries(data.by_location).map(([loc, stats]) => `
                            <tr>
                                <td>${loc}</td>
                                <td>${stats.count}</td>
                                <td>${stats.duration} min</td>
                                <td>${stats.avg_duration.toFixed(1)} min</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;
    } catch (error) {
        console.error('Error loading frenzy stats:', error);
        showMessage('Error loading frenzy statistics. Please try again.', 'error');
    }
}

async function importCSV() {
    const fileInput = document.getElementById('csv-file');
    const fileType = document.getElementById('csv-file-type').value;
    
    if (!fileInput.files || fileInput.files.length === 0) {
        alert('Please select a CSV file');
        return;
    }
    
    const formData = new FormData();
    formData.append('file', fileInput.files[0]);
    formData.append('type', fileType);
    
    const container = document.getElementById('import-results');
    container.innerHTML = '<div class="loading">Importing...</div>';
    
    try {
        const response = await fetch('/api/import-csv', {
            method: 'POST',
            body: formData
        });
        
        const data = await response.json();
        
        if (response.ok) {
            container.innerHTML = `<div class="success">${data.message}</div>`;
        } else {
            container.innerHTML = `<div class="error">Error: ${data.error}</div>`;
        }
    } catch (error) {
        console.error('Error importing CSV:', error);
        container.innerHTML = '<div class="error">Error importing CSV. Please try again.</div>';
    }
}

function showMessage(message, type) {
    const container = document.querySelector('.view.active');
    const msgDiv = document.createElement('div');
    msgDiv.className = type;
    msgDiv.textContent = message;
    container.insertBefore(msgDiv, container.firstChild);
    
    setTimeout(() => msgDiv.remove(), 5000);
}

