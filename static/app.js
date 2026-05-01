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

// Schedule periods for the schedules tab - automatically loaded in teacher and student schedule tables
const SCHEDULE_PERIODS = [
    'AM Bus',
    '7:45-8:30',
    '8:30-9:00',
    '9:00-9:30',
    '9:30-10:00',
    '10:00-10:30',
    '10:30-11:00',
    '11:00-11:30',
    '11:30-12:00',
    '12:00-12:30',
    '12:30-1:00',
    '1:00-1:30',
    '1:30-2:00',
    '2:00-2:30',
    '2:30-2:45',
    'PM Bus'
];

const INFRACTION_TYPES = {
    general: ['Lang', 'NFD', 'Off Task', 'MYOB', 'Self Control', 'Shutdown', 'Volume', 'Attention Seeking', 'Refusal', 'Personal Space'],
    harmful: ['Walk', 'Aggression', 'Property Destruction', 'Sexual Reference', 'Threat', 'Disrespectful']
};

let currentStudentId = null;
let currentDate = new Date().toISOString().split('T')[0];
let currentPeriod = null;
let currentClass = ''; // Track selected class for period entry
let currentLocation = '';
let allStudents = [];
let editParentLinkedStudentIds = [];
let filteredStudentsForPeriod = []; // Students filtered by staff member and period for period entry view
let allStaffMembers = []; // Store staff users for team member dropdowns
let periodData = {}; // Store data by student_id for current period
let dailyData = {}; // Store data for daily overview: dailyData[studentId][period] = {s, t, a, r}
let attendanceData = {}; // Store attendance by date and studentId: attendanceData[date][studentId] = 'present'|'excused'|'unexcused'
let dailyAutosaveTimer = null; // Debounce timer for daily-entry autosave
let dailyEntrySearchQuery = ''; // Current search text for daily entry
let dailyEntrySearchCommitted = false; // Whether the current daily search query has been submitted
let dailyEntryManagedByMe = false; // Checkbox state for "managed by me" filter
let dailyEntryStaffFilterName = null; // When set, results are for this staff's students (full-name match only)
// Starbucks management state (Bank Account tab)
let starbucksRows = []; // [{ student_id, student_name, starbucks_count }]
let starbucksAutosaveTimer = null; // Debounce timer for Starbucks table autosave
let filteredDailyStudents = []; // Filtered list of students for daily entry display
let currentPdfType = null; // 'summary' or 'frenzy' - for PDF generation modal
let dailyLoadDebounceTimer = null;
let dailyLoadAbortController = null;
let dailyLoadRequestToken = 0;
let dailyGridDelegationBound = false;
const DAILY_LOAD_CACHE_TTL_MS = 60000;
const DAILY_LOAD_TIMEOUT_MS = 20000;
const dailyLoadCache = new Map();

// Load submitted students from localStorage or initialize empty
function loadSubmittedStudents() {
    try {
        const stored = localStorage.getItem('submittedStudents');
        if (stored) {
            const parsed = JSON.parse(stored);
            // Convert arrays back to Sets
            const result = {};
            for (const date in parsed) {
                result[date] = new Set(parsed[date]);
            }
            return result;
        }
    } catch (e) {
        console.error('Error loading submitted students from localStorage:', e);
    }
    return {};
}

function saveSubmittedStudents(submittedStudents) {
    try {
        // Convert Sets to arrays for JSON serialization
        const toSave = {};
        for (const date in submittedStudents) {
            toSave[date] = Array.from(submittedStudents[date]);
        }
        localStorage.setItem('submittedStudents', JSON.stringify(toSave));
    } catch (e) {
        console.error('Error saving submitted students to localStorage:', e);
    }
}

let submittedStudents = loadSubmittedStudents(); // Track submitted students by date: submittedStudents[date] = Set of student IDs

function scheduleDailyDataLoad(delayMs) {
    if (dailyLoadDebounceTimer) {
        clearTimeout(dailyLoadDebounceTimer);
    }
    dailyLoadDebounceTimer = setTimeout(() => {
        loadDailyData();
    }, Math.max(0, delayMs || 0));
}

function invalidateDailyLoadCache(dateKey) {
    if (!dateKey) {
        dailyLoadCache.clear();
        return;
    }
    const prefix = `${dateKey}|`;
    for (const key of dailyLoadCache.keys()) {
        if (key.startsWith(prefix)) {
            dailyLoadCache.delete(key);
        }
    }
}

function handleDailyAttendanceChange(e) {
    const select = e.target;
    if (!select || !select.classList.contains('attendance-select')) {
        return;
    }
    if (!attendanceData[currentDate]) {
        attendanceData[currentDate] = {};
    }
    const studentId = parseInt(select.dataset.studentId, 10);
    const newStatus = select.value;
    if (!studentId) return;

    attendanceData[currentDate][studentId] = newStatus;

    if (newStatus === 'unexcused') {
        if (!dailyData[studentId]) {
            dailyData[studentId] = {};
        }

        STANDARD_PERIODS.forEach(period => {
            if (!dailyData[studentId][period.time]) {
                dailyData[studentId][period.time] = { s: null, t: null, a: null, r: null, info: '' };
            }
            dailyData[studentId][period.time].s = 0;
            dailyData[studentId][period.time].t = 0;
            dailyData[studentId][period.time].a = 0;
            dailyData[studentId][period.time].r = 0;
        });

        document.querySelectorAll(`.daily-input[data-student-id="${studentId}"]`).forEach(inputEl => {
            const category = inputEl.dataset.category;
            if (category && ['s', 't', 'a', 'r'].includes(category)) {
                inputEl.value = '0';
            }
        });
    }

    updateDailyPercentageRow();

    // Schedule an autosave of the current daily grid state
    scheduleDailyAutosave();
}

function ensureDailyGridDelegatedListeners() {
    if (dailyGridDelegationBound) return;
    const gridContainer = document.getElementById('daily-grid-container');
    if (!gridContainer) return;

    gridContainer.addEventListener('change', (e) => {
        if (e.target && e.target.classList.contains('daily-input')) {
            handleDailyInputChange(e);
            return;
        }
        if (e.target && e.target.classList.contains('attendance-select')) {
            handleDailyAttendanceChange(e);
        }
    });

    gridContainer.addEventListener('keydown', (e) => {
        if (e.target && e.target.classList.contains('daily-input')) {
            handleDailyInputKeydown(e);
        }
    });

    gridContainer.addEventListener('click', (e) => {
        const infoBtn = e.target && e.target.closest('.info-btn');
        if (infoBtn) {
            showInfoModal({ target: infoBtn });
        }
    });

    dailyGridDelegationBound = true;
}

// Load quarter dates from localStorage or use defaults
function loadQuarterDates() {
    try {
        const stored = localStorage.getItem('quarterDates');
        if (stored) {
            return JSON.parse(stored);
        }
    } catch (e) {
        console.error('Error loading quarter dates from localStorage:', e);
    }
    // Default quarter dates (MM/DD/YYYY format)
    const currentYear = new Date().getFullYear();
    const nextYear = currentYear + 1;
    return {
        '1': { start: `08/01/${currentYear}`, end: `10/31/${currentYear}`, label: 'Quarter 1' },
        '2': { start: `11/01/${currentYear}`, end: `01/31/${nextYear}`, label: 'Quarter 2' },
        '3': { start: `02/01/${nextYear}`, end: `04/30/${nextYear}`, label: 'Quarter 3' },
        '4': { start: `05/01/${nextYear}`, end: `07/31/${nextYear}`, label: 'Quarter 4' }
    };
}

// Get current school year (August to August)
function getCurrentSchoolYear() {
    const today = new Date();
    const year = today.getFullYear();
    const month = today.getMonth() + 1; // JavaScript months are 0-indexed
    
    if (month >= 8) {  // August to December
        return `${year}-${year + 1}`;
    } else {  // January to July
        return `${year - 1}-${year}`;
    }
}

// Load school year dates - automatically calculated (August to August)
function loadSchoolYearDates() {
    const currentSchoolYear = getCurrentSchoolYear();
    const [startYear, endYear] = currentSchoolYear.split('-').map(Number);
    return {
        label: currentSchoolYear,
        start: `08/01/${startYear}`,
        end: `07/31/${endYear}`
    };
}

// Format month key from "YYYY-MM" to "MonthName YY"
function formatMonthKey(monthKey) {
    try {
        const [year, month] = monthKey.split('-').map(Number);
        const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                           'July', 'August', 'September', 'October', 'November', 'December'];
        const yearShort = String(year).slice(-2);
        return `${monthNames[month - 1]} ${yearShort}`;
    } catch (e) {
        return monthKey; // Return original if parsing fails
    }
}

function saveSchoolYearDates(schoolYearDates) {
    try {
        localStorage.setItem('schoolYearDates', JSON.stringify(schoolYearDates));
    } catch (e) {
        console.error('Error saving school year dates to localStorage:', e);
    }
}

// Helper function to convert MM/DD/YYYY to MM-DD format for backend
function extractMMDD(dateStr) {
    if (!dateStr) return '';
    // If already in MM-DD format, return as is
    if (dateStr.includes('-') && dateStr.length === 5) {
        return dateStr;
    }
    // If in MM/DD/YYYY format, extract MM-DD
    if (dateStr.includes('/')) {
        const parts = dateStr.split('/');
        if (parts.length >= 2) {
            return `${parts[0]}-${parts[1]}`;
        }
    }
    return dateStr;
}

function convertSchoolYearDatesForBackend(schoolYearDates) {
    if (!schoolYearDates) return { start: '08-01', end: '07-31' };
    
    return {
        start: extractMMDD(schoolYearDates.start),
        end: extractMMDD(schoolYearDates.end)
    };
}

// Helper function to convert quarter dates from MM/DD/YYYY to MM-DD format for backend
function convertQuarterDatesForBackend(quarterDates) {
    if (!quarterDates) {
        // Return defaults
        return {
            '1': { start: '08-01', end: '10-31', label: 'Quarter 1' },
            '2': { start: '11-01', end: '01-31', label: 'Quarter 2' },
            '3': { start: '02-01', end: '04-30', label: 'Quarter 3' },
            '4': { start: '05-01', end: '07-31', label: 'Quarter 4' }
        };
    }
    
    const converted = {};
    for (const [quarter, dates] of Object.entries(quarterDates)) {
        converted[quarter] = {
            start: extractMMDD(dates.start),
            end: extractMMDD(dates.end),
            label: dates.label || `Quarter ${quarter}`
        };
    }
    return converted;
}

function saveQuarterDates(quarterDates) {
    try {
        localStorage.setItem('quarterDates', JSON.stringify(quarterDates));
    } catch (e) {
        console.error('Error saving quarter dates to localStorage:', e);
    }
}

function getCurrentQuarter(date) {
    const quarterDates = loadQuarterDates();
    const dateObj = new Date(date);
    const month = dateObj.getMonth() + 1; // 1-12
    const day = dateObj.getDate();
    const dateStr = `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    
    for (const [quarter, dates] of Object.entries(quarterDates)) {
        // Extract MM-DD from MM/DD/YYYY format if needed
        let start = extractMMDD(dates.start);
        let end = extractMMDD(dates.end);
        
        // Handle quarters that span across years (e.g., Q2: Nov-Jan)
        if (start <= end) {
            // Normal quarter within same year
            if (dateStr >= start && dateStr <= end) {
                return dates.label;
            }
        } else {
            // Quarter spans across years
            if (dateStr >= start || dateStr <= end) {
                return dates.label;
            }
        }
    }
    
    return 'Unknown Quarter';
}

function updateQuarterDisplay() {
    const quarterValue = document.getElementById('quarter-value');
    if (quarterValue && currentDate) {
        quarterValue.textContent = getCurrentQuarter(currentDate);
    }
}

let quarterDates = loadQuarterDates();
// Per-user UI preferences loaded from backend (e.g., hidden sections)
let userPreferences = {};

// Check if user is staff
function isStaff() {
    return window.currentUser && window.currentUser.role === 'staff' && !window.currentUser.is_outside_staff;
}

function isOutsideStaff() {
    return window.currentUser && window.currentUser.role === 'staff' && window.currentUser.is_outside_staff;
}

function isStudent() {
    return window.currentUser && window.currentUser.role === 'student';
}

function isAdmin() {
    return window.currentUser && window.currentUser.role === 'admin';
}

function canEdit() {
    return window.currentUser && ((window.currentUser.role === 'staff' && !window.currentUser.is_outside_staff) || window.currentUser.role === 'admin');
}

/** Set "Show students managed by me" checkboxes based on role: staff = checked, admin = unchecked. */
function applyManagedByMeDefaultForRole() {
    if (!window.currentUser || !['staff', 'admin'].includes(window.currentUser.role)) return;
    const shouldCheck = window.currentUser.role === 'staff';
    const ids = [
        'daily-managed-by-me-checkbox',
        'summary-managed-by-me-checkbox',
        'frenzy-managed-by-me-checkbox',
        'schedule-managed-by-me-checkbox',
        'bank-managed-by-me-checkbox',
        'marketplace-managed-by-me-checkbox'
    ];
    ids.forEach(id => {
        const el = document.getElementById(id);
        if (el && el.checked !== shouldCheck) {
            el.checked = shouldCheck;
        }
    });
    dailyEntryManagedByMe = shouldCheck;
}

// Initialize: attach nav/hamburger so it works even if DOMContentLoaded already fired
function setNavDropdownPosition() {
    if (!document.body.classList.contains('nav-menu-open')) return;
    var hamburger = document.getElementById('nav-hamburger');
    var nav = document.getElementById('main-nav');
    if (!hamburger || !nav) return;

    var rect = hamburger.getBoundingClientRect();
    var navWidth = nav.offsetWidth || Math.min(320, Math.max(180, window.innerWidth - 20));
    var left = rect.right - navWidth;
    var minLeft = 10;
    var maxLeft = Math.max(minLeft, window.innerWidth - navWidth - 10);

    left = Math.min(maxLeft, Math.max(minLeft, left));
    document.documentElement.style.setProperty('--nav-dropdown-top', (rect.bottom + 8) + 'px');
    document.documentElement.style.setProperty('--nav-dropdown-left', left + 'px');
}
function toggleNavMenu() {
    document.body.classList.toggle('nav-menu-open');
    setNavDropdownPosition();
}
window.toggleNavMenu = toggleNavMenu;

function attachNavAndHamburger() {
    if (window._navHamburgerAttached) return;
    window._navHamburgerAttached = true;

    // Direct handler on hamburger so it always runs (capture phase, before anything can stop propagation)
    var hamburgerBtn = document.getElementById('nav-hamburger');
    if (hamburgerBtn) {
        hamburgerBtn.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            toggleNavMenu();
        }, true);
    }

    document.addEventListener('click', function navAndHamburgerClick(e) {
            var navBtn = e.target && e.target.closest && e.target.closest('.nav-btn');
            if (navBtn && navBtn.dataset && navBtn.dataset.view) {
                e.preventDefault();
                e.stopPropagation();
                switchView(navBtn.dataset.view);
                document.body.classList.remove('nav-menu-open');
                return;
            }
            var hamburger = e.target && e.target.closest && e.target.closest('#nav-hamburger');
            if (hamburger) {
                toggleNavMenu();
                return;
            }
            if (document.body.classList.contains('nav-menu-open') && !e.target.closest('#main-nav') && !e.target.closest('#nav-hamburger')) {
                document.body.classList.remove('nav-menu-open');
            }
        });

    var navEl = document.getElementById('main-nav');
    if (navEl) {
        navEl.addEventListener('click', function(e) {
            var btn = e.target && e.target.closest && e.target.closest('.nav-btn');
            if (btn && btn.dataset && btn.dataset.view) {
                e.preventDefault();
                e.stopPropagation();
                switchView(btn.dataset.view);
                document.body.classList.remove('nav-menu-open');
            }
        }, true);
    }

        window.addEventListener('resize', setNavDropdownPosition);
}

if (document.readyState !== 'loading') {
    attachNavAndHamburger();
}

document.addEventListener('DOMContentLoaded', () => {
    try {
        attachNavAndHamburger();
        console.log('Current user:', window.currentUser);
        
        // Disable browser autocomplete/autofill on all inputs in the main app
        // (login page does not load this script, so its username/password can still be autofilled)
        try {
            const inputs = document.querySelectorAll('input');
            inputs.forEach((input) => {
                const type = (input.type || '').toLowerCase();
                if (input.dataset && input.dataset.allowAutocomplete === 'true') return;
                if (['hidden', 'checkbox', 'radio', 'file', 'button', 'submit', 'reset'].includes(type)) return;
                input.setAttribute('autocomplete', 'off');
                input.setAttribute('autocapitalize', 'off');
                input.setAttribute('autocorrect', 'off');
                input.setAttribute('spellcheck', 'false');
            });

            // Further discourage third‑party password managers on non-login screens
            const passwordInputs = document.querySelectorAll('input[type="password"]');
            passwordInputs.forEach((input) => {
                if (input.dataset && input.dataset.allowPasswordManager === 'true') return;
                // Hint that these are "new" passwords, not login fields
                if (!input.hasAttribute('autocomplete')) {
                    input.setAttribute('autocomplete', 'new-password');
                }
                // Some managers scan password fields on load; delay exposing type="password" until user interacts
                if (!input.value) {
                    input.dataset.originalType = 'password';
                    input.type = 'text';
                    input.addEventListener('focus', () => {
                        if (input.dataset.originalType === 'password') {
                            input.type = 'password';
                        }
                    }, { once: true });
                }
            });
        } catch (e) {
            console.error('Error disabling autocomplete:', e);
        }
        
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
        
        // Initialize submitted students tracking for current date if not already loaded
        if (!submittedStudents[currentDate]) {
            submittedStudents[currentDate] = new Set();
        }
        
        // Set "Show students managed by me" default by role (staff = checked, admin = unchecked) before first load
        applyManagedByMeDefaultForRole();

        // Password-change banner is rendered server-side; nothing extra needed here beyond dismissal handler inline.
        
        loadStudents();
        setupEventListeners();
        // Load per-user UI preferences (e.g., which User Management sections are hidden)
        loadUserPreferences();
        
        // Set up period selector
        setupPeriodSelector();
        
        // Update quarter display
        updateQuarterDisplay();
        
        // Restore last selected tab (or leave default period-entry)
        try {
            const lastView = localStorage.getItem('lastView');
            if (lastView && document.querySelector(`[data-view="${lastView}"]`)) {
                switchView(lastView);
            }
        } catch (e) {}
        
        // Load teacher schedule and auto-select period if in period-entry view
        if (canEdit()) {
            loadSchedules('teacher');
        }
        
        
        // If user is a parent, ensure parent portal view is active and load children
        
        console.log('Initialization complete');
    } catch (error) {
        console.error('Error during initialization:', error);
        alert('Error initializing application. Please check the console for details.');
    }
});

function setupEventListeners() {
    try {
        console.log('Setting up event listeners...');
        
        // Navigation and hamburger are handled by delegation in DOMContentLoaded (see top of init)

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
                currentClass = ''; // Reset class selection
                console.log('Period selected:', currentPeriod);
                
                // Check for multiple classes at this time period
                const classSelectorGroup = document.getElementById('class-selector-group');
                const classSelect = document.getElementById('class-select');
                const locationInput = document.getElementById('location-input');
                
                if (teacherScheduleData && teacherScheduleData.length > 0) {
                    // Find all classes for this time period
                    const classesForPeriod = teacherScheduleData
                        .filter(s => s && s.time_period === currentPeriod && s.class_name)
                        .map(s => s.class_name)
                        .filter((name, index, self) => self.indexOf(name) === index); // Get unique class names
                    
                    if (classesForPeriod.length > 1) {
                        // Multiple classes - show selector
                        if (classSelectorGroup) classSelectorGroup.style.display = 'block';
                        if (classSelect) {
                            classSelect.innerHTML = '<option value="">Select Class</option>';
                            classesForPeriod.forEach(className => {
                                const option = document.createElement('option');
                                option.value = className;
                                option.textContent = className;
                                classSelect.appendChild(option);
                            });
                            classSelect.value = '';
                        }
                        if (locationInput) {
                            locationInput.value = '';
                            currentLocation = '';
                        }
                        // Don't load data until class is selected
                        filteredStudentsForPeriod = [];
                        renderStudentsGrid();
                    } else {
                        // Single class or none - hide selector and auto-fill
                        if (classSelectorGroup) classSelectorGroup.style.display = 'none';
                        if (classSelect) classSelect.value = '';
                        
                        const scheduleItem = teacherScheduleData.find(s => s && s.time_period === currentPeriod);
                        if (scheduleItem && scheduleItem.class_name) {
                            currentClass = scheduleItem.class_name;
                            if (locationInput) {
                                locationInput.value = scheduleItem.class_name;
                                currentLocation = scheduleItem.class_name;
                            }
                        } else {
                            // Fall back to standard periods
                            const selectedPeriod = STANDARD_PERIODS.find(p => p.time === currentPeriod);
                            if (selectedPeriod) {
                                currentClass = '';
                                if (locationInput) {
                                    locationInput.value = selectedPeriod.location;
                                    currentLocation = selectedPeriod.location;
                                }
                            }
                        }
                        
                        // Load data after setting class
                        loadPeriodData();
                    }
                } else {
                    // No schedule data - hide selector and use defaults
                    if (classSelectorGroup) classSelectorGroup.style.display = 'none';
                    if (classSelect) classSelect.value = '';
                    const selectedPeriod = STANDARD_PERIODS.find(p => p.time === currentPeriod);
                    if (selectedPeriod && locationInput) {
                        locationInput.value = selectedPeriod.location;
                        currentLocation = selectedPeriod.location;
                    }
                    loadPeriodData();
                }
            });
        }
        
        // Class selector for period entry
        const classSelect = document.getElementById('class-select');
        if (classSelect) {
            classSelect.addEventListener('change', (e) => {
                currentClass = e.target.value;
                console.log('Class selected:', currentClass);
                
                // Auto-fill location with selected class
                const locationInput = document.getElementById('location-input');
                if (locationInput && currentClass) {
                    locationInput.value = currentClass;
                    currentLocation = currentClass;
                }
                
                // Reload students for this class
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
                
                // Clear submitted students tracking when date changes
                if (!submittedStudents[currentDate]) {
                    submittedStudents[currentDate] = new Set();
                }
                
                // Update quarter display
                updateQuarterDisplay();
                
                if (allStudents.length > 0) {
                    scheduleDailyDataLoad(0);
                }
            });
        }

        // Daily entry search input with autocomplete
        const dailySearchInput = document.getElementById('daily-search-input');
        if (dailySearchInput) {
            setupDailySearchAutocomplete(dailySearchInput);
            dailySearchInput.addEventListener('input', (e) => {
                dailyEntrySearchQuery = e.target.value;
                console.log('Daily search query changed:', dailyEntrySearchQuery);
                // While typing, just update the query and keep the current grid visible.
                // If the query is cleared, immediately reset the grid.
                if (!dailyEntrySearchQuery.trim()) {
                    dailyEntrySearchCommitted = true;
                    scheduleDailyDataLoad(0);
                } else {
                    dailyEntrySearchCommitted = false;
                }
            });
            dailySearchInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    // If the autocomplete dropdown is not open, treat Enter as submitting the search.
                    const wrapper = dailySearchInput.closest('.daily-search-autocomplete-wrapper');
                    const dropdown = wrapper ? wrapper.querySelector('.daily-search-autocomplete-dropdown') : null;
                    const isDropdownVisible = dropdown && dropdown.style.display === 'block';
                    if (!isDropdownVisible) {
                        e.preventDefault();
                        dailyEntrySearchQuery = dailySearchInput.value;
                        dailyEntrySearchCommitted = true;
                        // When a daily search is committed, clear "managed by me" so it does not persist across searches.
                        const managedCheckbox = document.getElementById('daily-managed-by-me-checkbox');
                        if (managedCheckbox && managedCheckbox.checked) {
                            managedCheckbox.checked = false;
                            dailyEntryManagedByMe = false;
                        }
                        scheduleDailyDataLoad(0);
                    }
                }
            });
        }

        // Daily entry "managed by me" checkbox
        const dailyManagedByMeCheckbox = document.getElementById('daily-managed-by-me-checkbox');
        if (dailyManagedByMeCheckbox) {
            dailyManagedByMeCheckbox.addEventListener('change', (e) => {
                dailyEntryManagedByMe = e.target.checked;
                console.log('Daily managed by me checkbox changed:', dailyEntryManagedByMe);
                scheduleDailyDataLoad(0);
            });
        }

        ensureDailyGridDelegatedListeners();
        
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
            addStudentBtn.addEventListener('click', async () => {
                console.log('Add student button clicked');
                // Clear all fields
                document.getElementById('student-name').value = '';
                document.getElementById('student-grade').value = '';
                document.getElementById('student-card-color').value = '';
                document.getElementById('student-username').value = '';
                document.getElementById('student-password').value = '';
                document.getElementById('student-password-confirm').value = '';
                // Set up team member button handlers
                setupTeamMemberButtons();
                
                // Initialize team member containers with empty rows
                populateTeamMemberRows('case-manager-container', [], ['case_manager', 'teacher']);
                populateTeamMemberRows('practitioner-container', [], ['practitioner']);
                populateTeamMemberRows('professional-container', [], ['professional']);
                populateTeamMemberRows('group-leader-container', [], ['group_leader']);
                
                document.getElementById('student-modal').style.display = 'block';
            });
        }

        // Real-time validation for student initials
        const studentNameInput = document.getElementById('student-name');
        if (studentNameInput) {
            studentNameInput.addEventListener('input', function() {
                const value = this.value;
                const formGroup = this.closest('.form-group');
                let warningMsg = formGroup.querySelector('.initials-warning');
                
                if (value.length > 4) {
                    if (!warningMsg) {
                        warningMsg = document.createElement('small');
                        warningMsg.className = 'initials-warning';
                        warningMsg.style.color = 'var(--danger)';
                        warningMsg.style.display = 'block';
                        warningMsg.style.marginTop = '5px';
                        formGroup.appendChild(warningMsg);
                    }
                    warningMsg.textContent = 'Only initials should be entered (maximum 4 characters). Example: Jane Doe = JD';
                } else if (warningMsg) {
                    warningMsg.remove();
                }
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

        // User Management section visibility toggles
        const userSectionToggleConfigs = [
            { key: 'students', checkboxId: 'toggle-section-students', bodyId: 'user-section-students-body' },
            { key: 'archived', checkboxId: 'toggle-section-archived', bodyId: 'user-section-archived-body' },
            { key: 'staff', checkboxId: 'toggle-section-staff', bodyId: 'user-section-staff-body' },
            { key: 'outsideStaff', checkboxId: 'toggle-section-outside-staff', bodyId: 'user-section-outside-staff-body' },
            { key: 'admin', checkboxId: 'toggle-section-admin', bodyId: 'user-section-admin-body' }
        ];

        userSectionToggleConfigs.forEach(config => {
            const checkbox = document.getElementById(config.checkboxId);
            const body = document.getElementById(config.bodyId);
            if (!checkbox || !body) {
                return;
            }
            checkbox.addEventListener('change', () => {
                const isHidden = checkbox.checked;
                body.style.display = isHidden ? 'none' : '';
                updateUserManagementPreference(config.key, isHidden);
            });
        });

        const loadSummaryBtn = document.getElementById('load-summary-btn');
        if (loadSummaryBtn) {
            loadSummaryBtn.addEventListener('click', () => {
                console.log('Load summary button clicked');
                loadSummary();
            });
        } else {
            console.warn('load-summary-btn not found');
        }
        
        const printSummaryBtn = document.getElementById('print-summary-btn');
        if (printSummaryBtn) {
            printSummaryBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                console.log('Print summary (point card) button clicked');
                console.log('Button disabled?', printSummaryBtn.disabled);
                if (printSummaryBtn.disabled) {
                    alert('Please load summary data first before generating the point card PDF.');
                    return;
                }
                try {
                    openPointCardPrintWindow();
                } catch (error) {
                    console.error('Error in point card print handler:', error);
                    alert('Error preparing point card PDF: ' + (error.message || 'Unknown error'));
                }
            });
        } else {
            console.warn('print-summary-btn not found');
        }
        
        // Make period and timeframe dropdowns mutually exclusive for summary
        const summaryPeriodSelect = document.getElementById('summary-period-select');
        const summaryTimeframeSelect = document.getElementById('quarter-select');
        if (summaryPeriodSelect && summaryTimeframeSelect) {
            summaryPeriodSelect.addEventListener('change', () => {
                if (summaryPeriodSelect.value) {
                    summaryTimeframeSelect.value = '';
                }
            });
            summaryTimeframeSelect.addEventListener('change', () => {
                if (summaryTimeframeSelect.value) {
                    summaryPeriodSelect.value = '';
                }
            });
        }
        
        const managedByMeCheckbox = document.getElementById('summary-managed-by-me-checkbox');
        if (managedByMeCheckbox) {
            managedByMeCheckbox.addEventListener('change', async () => {
                console.log('Managed by me checkbox changed:', managedByMeCheckbox.checked);
                const summarySelect = document.getElementById('summary-student-select');
                const currentSelection = summarySelect ? summarySelect.value : null;
                
                // Reload summary students dropdown with filter
                await loadStudents(managedByMeCheckbox.checked, true);
                
                // If a student was selected, check if it still exists in the filtered list
                if (currentSelection && summarySelect) {
                    const optionExists = Array.from(summarySelect.options).some(opt => opt.value === currentSelection);
                    if (!optionExists) {
                        // Selected student is no longer in the filtered list, clear selection
                        summarySelect.value = '';
                        console.log('Cleared student selection - student not in filtered list');
                    }
                }
            });
        }
        
        // Admin panel buttons
        const addStaffBtn = document.getElementById('add-staff-btn');
        if (addStaffBtn) {
            addStaffBtn.addEventListener('click', () => {
                hideModalError('staff-modal');
                document.getElementById('staff-modal').style.display = 'block';
                const sg = document.getElementById('staff-grades-taught-group');
                const sr = document.getElementById('staff-role');
                if (sg && sr) sg.style.display = sr.value === 'Case Manager' ? 'block' : 'none';
                updateStaffCaseManagerGroup();
            });
        }

        const addOutsideStaffBtn = document.getElementById('add-outside-staff-btn');
        if (addOutsideStaffBtn) {
            addOutsideStaffBtn.addEventListener('click', () => {
                hideModalError('outside-staff-modal');
                document.getElementById('outside-staff-modal').style.display = 'block';
            });
        }

        const addAdminBtn = document.getElementById('add-admin-btn');
        if (addAdminBtn) {
            addAdminBtn.addEventListener('click', () => {
                document.getElementById('admin-modal').style.display = 'block';
            });
        }

        setupEditParentAddStudentCombobox();

        const createStaffAccountBtn = document.getElementById('create-staff-account-btn');
        if (createStaffAccountBtn) {
            createStaffAccountBtn.addEventListener('click', () => {
                hideModalError('staff-modal');
                document.getElementById('staff-modal').style.display = 'block';
                const sg = document.getElementById('staff-grades-taught-group');
                const sr = document.getElementById('staff-role');
                if (sg && sr) sg.style.display = sr.value === 'Case Manager' ? 'block' : 'none';
                updateStaffCaseManagerGroup();
            });
        }
        
        const saveQuarterDatesBtn = document.getElementById('save-quarter-dates-btn');
        if (saveQuarterDatesBtn) {
            saveQuarterDatesBtn.addEventListener('click', saveQuarterDatesConfig);
        }
        

        const createAdminAccountBtn = document.getElementById('create-admin-account-btn');
        if (createAdminAccountBtn) {
            createAdminAccountBtn.addEventListener('click', () => {
                document.getElementById('admin-modal').style.display = 'block';
            });
        }

        const saveStaffUserBtn = document.getElementById('save-staff-user-btn');
        if (saveStaffUserBtn) {
            saveStaffUserBtn.addEventListener('click', () => {
                saveStaffUser();
            });
        }
        // Show/hide Grades taught when staff role is Case Manager
        const staffRoleSelect = document.getElementById('staff-role');
        const staffGradesTaughtGroup = document.getElementById('staff-grades-taught-group');
        if (staffRoleSelect && staffGradesTaughtGroup) {
            staffRoleSelect.addEventListener('change', () => {
                staffGradesTaughtGroup.style.display = staffRoleSelect.value === 'Case Manager' ? 'block' : 'none';
                updateStaffCaseManagerGroup();
            });
        }
        const staffCaseManagerGroup = document.getElementById('staff-case-manager-group');
        if (staffRoleSelect && staffCaseManagerGroup) {
            updateStaffCaseManagerGroup();
        }

        const saveOutsideStaffUserBtn = document.getElementById('save-outside-staff-user-btn');
        if (saveOutsideStaffUserBtn) {
            saveOutsideStaffUserBtn.addEventListener('click', () => {
                saveOutsideStaffUser();
            });
        }

        const saveAdminUserBtn = document.getElementById('save-admin-user-btn');
        if (saveAdminUserBtn) {
            saveAdminUserBtn.addEventListener('click', () => {
                saveAdminUser();
            });
        }


        const saveEditUserBtn = document.getElementById('save-edit-user-btn');
        if (saveEditUserBtn) {
            saveEditUserBtn.addEventListener('click', () => {
                saveEditUser();
            });
        }

        const archiveStudentBtn = document.getElementById('archive-student-btn');
        if (archiveStudentBtn) {
            archiveStudentBtn.addEventListener('click', () => {
                const originalRoleInput = document.getElementById('edit-user-original-role');
                const userIdInput = document.getElementById('edit-user-id');
                const usernameInput = document.getElementById('edit-user-username');
                const nameInput = document.getElementById('edit-user-name');

                if (!originalRoleInput || !userIdInput || !usernameInput) {
                    return;
                }

                const originalRole = originalRoleInput.value;
                if (originalRole !== 'student') {
                    return;
                }

                if (typeof isAdmin === 'function' && !isAdmin()) {
                    if (typeof showMessage === 'function') {
                        showMessage('Only admins can archive students.', 'error');
                    } else {
                        alert('Only admins can archive students.');
                    }
                    return;
                }

                const userId = parseInt(userIdInput.value, 10);
                if (!userId) {
                    return;
                }

                const username = usernameInput.value || '';
                const displayName = (nameInput && nameInput.value) ? nameInput.value : username;

                if (typeof archiveStudentUser === 'function') {
                    archiveStudentUser(userId, username, displayName);
                }
            });
        }

        // Handle add parent student button
        const addParentStudentBtn = document.getElementById('edit-parent-add-student-btn');
        if (addParentStudentBtn) {
            addParentStudentBtn.addEventListener('click', async () => {
                const parentId = parseInt(document.getElementById('edit-user-id').value);
                if (parentId) {
                    await addParentStudent(parentId);
                }
            });
        }

        // Handle role change in edit user modal
        const editUserRoleSelect = document.getElementById('edit-user-role');
        if (editUserRoleSelect) {
            editUserRoleSelect.addEventListener('change', (e) => {
                const teamSection = document.getElementById('edit-user-team-section');
                const gradeGroup = document.getElementById('edit-user-grade-group');
                const gradesTaughtGroup = document.getElementById('edit-user-grades-taught-group');
                const studentId = document.getElementById('edit-user-student-id').value;
                const selectedRole = e.target.value;
                
                // Show team section and grade for students
                if (selectedRole === 'Student') {
                    if (studentId) {
                        teamSection.style.display = 'block';
                    }
                    gradeGroup.style.display = 'block';
                    if (gradesTaughtGroup) gradesTaughtGroup.style.display = 'none';
                } else {
                    teamSection.style.display = 'none';
                    gradeGroup.style.display = 'none';
                    // Show grades taught for Case Manager / Teacher
                    if (gradesTaughtGroup) {
                        gradesTaughtGroup.style.display = (selectedRole === 'Case Manager' || selectedRole === 'Teacher') ? 'block' : 'none';
                    }
                    // Show Case Manager dropdown for Paraprofessional
                    const editCaseManagerGroup = document.getElementById('edit-user-case-manager-group');
                    const editCaseManagerSelect = document.getElementById('edit-user-case-manager-select');
                    if (editCaseManagerGroup && editCaseManagerSelect) {
                        editCaseManagerGroup.style.display = selectedRole === 'Paraprofessional' ? 'block' : 'none';
                        if (selectedRole === 'Paraprofessional') {
                            const caseManagers = (typeof allStaffMembers !== 'undefined' ? allStaffMembers : []).filter(
                                u => u.role === 'staff' && !u.is_outside_staff && u.designation === 'Case Manager'
                            );
                            editCaseManagerSelect.innerHTML = '<option value="">— Select Case Manager (optional) —</option>';
                            caseManagers.forEach(cm => {
                                const opt = document.createElement('option');
                                opt.value = cm.id;
                                opt.textContent = cm.name || cm.username;
                                editCaseManagerSelect.appendChild(opt);
                            });
                        }
                    }
                }
            });
        }

        const refreshUsersBtn = document.getElementById('refresh-users-btn');
        if (refreshUsersBtn) {
            refreshUsersBtn.addEventListener('click', () => {
                loadUsers();
            });
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
            if (e.target.id === 'info-modal') {
                closeInfoModal();
            }
            if (e.target.id === 'staff-modal') {
                document.getElementById('staff-modal').style.display = 'none';
            }
            if (e.target.id === 'outside-staff-modal') {
                document.getElementById('outside-staff-modal').style.display = 'none';
            }
            if (e.target.id === 'admin-modal') {
                document.getElementById('admin-modal').style.display = 'none';
            }
            if (e.target.id === 'edit-user-modal') {
                document.getElementById('edit-user-modal').style.display = 'none';
            }
            if (e.target.id === 'pdf-table-selection-modal') {
                closePdfTableSelectionModal();
            }
        });

        console.log('Event listeners set up successfully');
    } catch (error) {
        console.error('Error setting up event listeners:', error);
        alert('Error setting up event listeners. Please check the console.');
    }
}

async function switchView(viewName) {
    if (viewName === 'frenzy') {
        viewName = 'summary';
    }

    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    
    const viewElement = document.getElementById(`${viewName}-view`);
    if (viewElement) {
        viewElement.classList.add('active');
    }
    
    let navButton = document.querySelector(`[data-view="${viewName}"]`);
    if (navButton) {
        navButton.classList.add('active');
    }

    // Sync Reports sub-toggle buttons (Point Card vs Frenzy)
    const reportsToggleButtons = document.querySelectorAll('.reports-toggle-btn');
    if (reportsToggleButtons.length) {
        reportsToggleButtons.forEach(btn => {
            const target = btn.dataset.reportsView;
            if (!target) return;
            const shouldBeActive = target === viewName;
            btn.classList.toggle('active', shouldBeActive);
        });
    }

    // Persist last selected tab so we reopen to it on next load
    try {
        localStorage.setItem('lastView', viewName);
    } catch (e) {}
    
    if (viewName === 'period-entry') {
        // Load teacher schedule if user is staff/admin
        if (canEdit()) {
            loadSchedules('teacher');
        }
        // If period is already selected, reload data
        if (currentPeriod) {
            loadPeriodData();
        }
    }
    
    // If switching to daily entry view, reload data
    if (viewName === 'entry') {
        // Sync "managed by me" checkbox to role (staff = checked, admin = unchecked)
        const dailyManagedByMeCheckbox = document.getElementById('daily-managed-by-me-checkbox');
        if (dailyManagedByMeCheckbox && window.currentUser && ['staff', 'admin'].includes(window.currentUser.role)) {
            const shouldCheck = window.currentUser.role === 'staff';
            if (dailyManagedByMeCheckbox.checked !== shouldCheck) {
                dailyManagedByMeCheckbox.checked = shouldCheck;
                dailyEntryManagedByMe = shouldCheck;
                dailyManagedByMeCheckbox.dispatchEvent(new Event('change'));
            }
        }
        // Ensure staff members are loaded for search functionality
        if (allStaffMembers.length === 0) {
            await loadUsers();
        }
        // Ensure filteredDailyStudents is initialized
        if (!filteredDailyStudents || filteredDailyStudents.length === 0) {
            filteredDailyStudents = [...allStudents];
        }
        scheduleDailyDataLoad(0);
    }
    
    // If switching to summary view, reload summary data
    if (viewName === 'summary') {
        removeLegacyReportsToggleButtons();

        // Sync "Show students managed by me" to role (staff = checked, admin = unchecked)
        const summaryManagedByMeCheckbox = document.getElementById('summary-managed-by-me-checkbox');
        if (summaryManagedByMeCheckbox && window.currentUser && ['staff', 'admin'].includes(window.currentUser.role)) {
            const shouldCheck = window.currentUser.role === 'staff';
            if (summaryManagedByMeCheckbox.checked !== shouldCheck) {
                summaryManagedByMeCheckbox.checked = shouldCheck;
                summaryManagedByMeCheckbox.dispatchEvent(new Event('change'));
            }
        }
        
        // Check if summary has been loaded before (has student/quarter selected)
        const summaryStudentSelect = document.getElementById('summary-student-select');
        const quarterSelect = document.getElementById('quarter-select');
        if (summaryStudentSelect && quarterSelect) {
            // Reload summary if there's a quarter selected
            if (quarterSelect.value) {
                loadSummary();
            }
        }

        // Always load the new dashboard-style summary when entering the tab,
        // so the default 30-day + "managed by me" state shows data immediately.
        if (typeof triggerDashboardLoad === 'function') {
            triggerDashboardLoad('summary');
        }
    }
    
    // If switching to users view, load users and apply any stored visibility preferences
    if (viewName === 'users') {
        loadUsers();
        applyUserManagementSectionVisibility();
    }
    
    // If switching to admin view, load users and stats
    if (viewName === 'admin') {
        loadUsers();
        loadQuarterConfig();
        loadSchoolYearConfig();
    }
    
    // If switching to schedules view, initialize schedules
    if (viewName === 'schedules') {
        // Sync "Show students managed by me" to role (staff = checked, admin = unchecked)
        const scheduleManagedByMeCheckbox = document.getElementById('schedule-managed-by-me-checkbox');
        if (scheduleManagedByMeCheckbox && window.currentUser && ['staff', 'admin'].includes(window.currentUser.role)) {
            const shouldCheck = window.currentUser.role === 'staff';
            if (scheduleManagedByMeCheckbox.checked !== shouldCheck) {
                scheduleManagedByMeCheckbox.checked = shouldCheck;
                scheduleManagedByMeCheckbox.dispatchEvent(new Event('change'));
            }
        }
        if (scheduleManagedByMeCheckbox && scheduleManagedByMeCheckbox.checked) {
            loadStudents(true, false, true);
        } else {
            loadStudents();
        }
        // Load users to populate staff members for dropdown and teacher schedule search
        loadUsers().then(() => {
            // Update staff datalist after users are loaded
            updateStaffDatalist();
            populateTeacherScheduleStaffSearch();
        });
        // Load teacher schedule if user is staff or admin
        // Use setTimeout to ensure DOM is ready after view is activated
        setTimeout(() => {
            // Fetch all class names from teacher schedules for the dropdown
            fetchAllTeacherClassNames();
            
            if (canEdit()) {
                // Always render teacher schedule immediately with default periods
                // This ensures the periods are shown even before API call completes
                renderTeacherSchedule();
                // Load current user's teacher schedule (always load own schedule when tab opens)
                loadSchedules('teacher');
            }
            // Always render student schedule table with default periods, even if no student is selected
            // This ensures the table is visible with the three columns (Time, Class, Staff)
            renderStudentSchedule();
            // If a student is selected, also try to load from API (will update if saved data exists)
            if (currentScheduleStudentId) {
                loadSchedules('student', currentScheduleStudentId);
            }
        }, 0);
    }
    
    // If switching to bank account view
    if (viewName === 'bank-account') {
        // Sync "Show students managed by me" to role (staff/admin = checked by default)
        const bankManagedByMeCheckbox = document.getElementById('bank-managed-by-me-checkbox');
        if (bankManagedByMeCheckbox && window.currentUser && ['staff', 'admin'].includes(window.currentUser.role)) {
            const shouldCheck = true;
            if (bankManagedByMeCheckbox.checked !== shouldCheck) {
                bankManagedByMeCheckbox.checked = shouldCheck;
                bankManagedByMeCheckbox.dispatchEvent(new Event('change'));
            }
        }

        // Ensure Starbucks "managed by me" starts checked as well
        const starbucksManagedByMeCheckbox = document.getElementById('starbucks-managed-by-me-checkbox');
        if (starbucksManagedByMeCheckbox && window.currentUser && ['staff', 'admin'].includes(window.currentUser.role)) {
            if (!starbucksManagedByMeCheckbox.checked) {
                starbucksManagedByMeCheckbox.checked = true;
                starbucksManagedByMeCheckbox.dispatchEvent(new Event('change'));
            }
        }

        handleBankAccountView();
    }
    if (viewName === 'marketplace') {
        // Sync "Show students managed by me" to role (staff = checked, admin = unchecked)
        const marketplaceManagedByMeCheckbox = document.getElementById('marketplace-managed-by-me-checkbox');
        if (marketplaceManagedByMeCheckbox && window.currentUser && ['staff', 'admin'].includes(window.currentUser.role)) {
            const shouldCheck = window.currentUser.role === 'staff';
            if (marketplaceManagedByMeCheckbox.checked !== shouldCheck) {
                marketplaceManagedByMeCheckbox.checked = shouldCheck;
                marketplaceManagedByMeCheckbox.dispatchEvent(new Event('change'));
            }
        }
        handleMarketplaceView();
    }
}

function removeLegacyReportsToggleButtons() {
    const summaryView = document.getElementById('summary-view');
    if (!summaryView) return;

    // Remove stale legacy sub-toggle buttons ("Point Card" / "Frenzy") if present.
    const legacyLabels = new Set(['point card', 'frenzy']);
    summaryView.querySelectorAll('button').forEach((btn) => {
        const label = (btn.textContent || '').trim().toLowerCase();
        if (legacyLabels.has(label)) {
            btn.remove();
        }
    });

    // Remove empty legacy wrappers after button cleanup.
    summaryView.querySelectorAll('.reports-toggle').forEach((wrap) => {
        if (!wrap.querySelector('button')) {
            wrap.remove();
        }
    });
}

function loadQuarterConfig() {
    const container = document.getElementById('quarter-config');
    if (!container) return;
    
    const quarters = loadQuarterDates();
    
    let html = '';
    for (const [quarter, dates] of Object.entries(quarters)) {
        html += `
            <div style="display: grid; grid-template-columns: 150px 1fr 1fr; gap: 10px; align-items: center; padding: 10px; background: white; border-radius: 4px;">
                <label style="font-weight: 600;">${dates.label}:</label>
                <div>
                    <label style="font-size: 12px; color: var(--text-secondary);">Start Date (MM/DD/YYYY):</label>
                    <input type="text" id="quarter-${quarter}-start" value="${dates.start || ''}" 
                           placeholder="MM/DD/YYYY" pattern="\\d{2}/\\d{2}/\\d{4}" style="width: 100%; padding: 6px; border: 1px solid var(--border); border-radius: 4px; margin-top: 4px;">
                </div>
                <div>
                    <label style="font-size: 12px; color: var(--text-secondary);">End Date (MM/DD/YYYY):</label>
                    <input type="text" id="quarter-${quarter}-end" value="${dates.end || ''}" 
                           placeholder="MM/DD/YYYY" pattern="\\d{2}/\\d{2}/\\d{4}" style="width: 100%; padding: 6px; border: 1px solid var(--border); border-radius: 4px; margin-top: 4px;">
                </div>
            </div>
        `;
    }
    
    container.innerHTML = html;
}

function saveQuarterDatesConfig() {
    const newQuarterDates = {};
    
    for (let i = 1; i <= 4; i++) {
        const startInput = document.getElementById(`quarter-${i}-start`);
        const endInput = document.getElementById(`quarter-${i}-end`);
        
        if (!startInput || !endInput) continue;
        
        const start = startInput.value.trim();
        const end = endInput.value.trim();
        
        // Validate MM/DD/YYYY format
        const datePattern = /^\d{2}\/\d{2}\/\d{4}$/;
        if (!datePattern.test(start) || !datePattern.test(end)) {
            showMessage(`Invalid date format for Quarter ${i}. Use MM/DD/YYYY format (e.g., 08/01/2025).`, 'error');
            return;
        }
        
        // Validate that dates are valid
        const startDate = new Date(start);
        const endDate = new Date(end);
        if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
            showMessage(`Invalid dates for Quarter ${i}. Please check that the dates are valid.`, 'error');
            return;
        }
        
        newQuarterDates[i] = {
            start: start,
            end: end,
            label: `Quarter ${i}`
        };
    }
    
    // Save to localStorage
    saveQuarterDates(newQuarterDates);
    quarterDates = newQuarterDates;
    
    // Update the quarter display if on daily entry view
    updateQuarterDisplay();
    
    showMessage('Quarter dates saved successfully!', 'success');
}


function setupPeriodSelector() {
    const periodSelect = document.getElementById('period-select');
    if (periodSelect) {
        periodSelect.innerHTML = '<option value="">Select Period</option>';
        STANDARD_PERIODS.forEach(period => {
            const option = document.createElement('option');
            option.value = period.time;
            option.textContent = period.time;
            periodSelect.appendChild(option);
        });
    }
}

// Function to parse time string (e.g., "7:45-8:30" or "1:00-1:30") and return start and end times in minutes
function parseTimeRange(timeStr) {
    // Handle special cases like "AM Bus" and "PM Bus"
    if (timeStr === 'AM Bus' || timeStr === 'PM Bus') {
        return null; // These don't have specific time ranges
    }
    
    // Parse format like "7:45-8:30" or "1:00-1:30" (12-hour format, PM times don't have PM marker)
    const parts = timeStr.split('-');
    if (parts.length !== 2) return null;
    
    const parseTime = (timeStr) => {
        const [hours, minutes] = timeStr.split(':').map(Number);
        let hour24 = hours;
        // Convert 12-hour format to 24-hour format
        // Schedule uses 12-hour format without AM/PM markers
        // Morning times: 7:00-11:59 are AM (no conversion)
        // Noon: 12:00 is 12:00 PM = 12:00 (no conversion)
        // Afternoon times: 1:00-2:45 are PM (add 12 hours)
        if (hours >= 1 && hours <= 2) {
            // Times 1:00-2:45 in the schedule are PM (afternoon)
            hour24 = hours + 12; // 1:00 PM = 13:00, 2:00 PM = 14:00
        }
        // Hours 7-11 stay as is (AM), hour 12 stays as 12 (noon)
        return hour24 * 60 + minutes; // Convert to minutes since midnight
    };
    
    try {
        const start = parseTime(parts[0].trim());
        const end = parseTime(parts[1].trim());
        return { start, end };
    } catch (e) {
        return null;
    }
}

// Function to get current period based on current time and user's schedule
function getCurrentPeriodFromSchedule() {
    // Only for staff/admin users who have a teacher schedule
    if (!canEdit()) {
        console.log('getCurrentPeriodFromSchedule: user cannot edit');
        return null;
    }
    if (!teacherScheduleData || teacherScheduleData.length === 0) {
        console.log('getCurrentPeriodFromSchedule: no schedule data', teacherScheduleData);
        return null;
    }
    
    const now = new Date();
    const currentHours = now.getHours();
    const currentMinutes = now.getMinutes();
    const currentTimeInMinutes = currentHours * 60 + currentMinutes;
    console.log('getCurrentPeriodFromSchedule: current time', currentHours + ':' + currentMinutes, '(', currentTimeInMinutes, 'minutes)');
    console.log('getCurrentPeriodFromSchedule: schedule data', teacherScheduleData);
    
    // Find the period that matches the current time
    for (const scheduleItem of teacherScheduleData) {
        if (!scheduleItem || !scheduleItem.time_period) continue;
        
        const timeRange = parseTimeRange(scheduleItem.time_period);
        if (timeRange) {
            // Check if current time falls within this period's time range
            if (currentTimeInMinutes >= timeRange.start && currentTimeInMinutes < timeRange.end) {
                return scheduleItem.time_period;
            }
        }
    }
    
    return null;
}

// Function to auto-select period based on current time
function autoSelectCurrentPeriod() {
    console.log('autoSelectCurrentPeriod called');
    const periodSelect = document.getElementById('period-select');
    if (!periodSelect) {
        console.log('period-select element not found');
        return;
    }
    
    // Get the current period from schedule
    const currentPeriodTime = getCurrentPeriodFromSchedule();
    console.log('getCurrentPeriodFromSchedule returned:', currentPeriodTime);
    if (currentPeriodTime) {
        // Check if this period exists in the dropdown
        const option = Array.from(periodSelect.options).find(opt => opt.value === currentPeriodTime);
        if (option) {
            periodSelect.value = currentPeriodTime;
            currentPeriod = currentPeriodTime;
            
            // Trigger change event to load data and handle class selector
            // The change handler will check for multiple classes and show selector if needed
            periodSelect.dispatchEvent(new Event('change'));
            console.log('Auto-selected period:', currentPeriodTime, 'based on current time');
        } else {
            console.log('Period', currentPeriodTime, 'not found in dropdown options');
        }
    } else {
        console.log('No matching period found for current time');
    }
}

async function loadStudents(filterManagedByMe = false, updateSummaryOnly = false, updateScheduleOnly = false) {
    try {
        let url = '/api/students';
        if (filterManagedByMe) {
            url += '?managed_by_me=true';
        }
        
        const response = await fetch(url);
        const studentsData = await response.json();
        
        // Ensure we have valid data and sort by name for consistency
        const studentsList = Array.isArray(studentsData) ? studentsData.sort((a, b) => {
            const nameA = (a.name || '').toLowerCase();
            const nameB = (b.name || '').toLowerCase();
            return nameA.localeCompare(nameB);
        }) : [];
        
        // Only update allStudents if not filtering for summary only or schedule only
        if (!updateSummaryOnly && !updateScheduleOnly) {
            allStudents = studentsList;
            // Initialize filteredDailyStudents to all students if no filters are active
            if (!dailyEntrySearchQuery && !dailyEntryManagedByMe) {
                filteredDailyStudents = [...allStudents];
            } else {
                // Re-filter if filters are active
                await filterDailyStudents();
            }
        }
        
        const select = document.getElementById('student-select');
        const summarySelect = document.getElementById('summary-student-select');
        const frenzySelect = document.getElementById('frenzy-student-select');
        const scheduleSelect = document.getElementById('schedule-student-select');
        
        // Determine which selects to update
        let selectsToUpdate;
        if (updateSummaryOnly) {
            selectsToUpdate = [summarySelect].filter(s => s !== null);
        } else if (updateScheduleOnly) {
            selectsToUpdate = [scheduleSelect].filter(s => s !== null);
        } else {
            selectsToUpdate = [select, summarySelect, frenzySelect, scheduleSelect].filter(s => s !== null);
        }
        
        selectsToUpdate.forEach(sel => {
            if (sel) {
                // Store the currently selected value to restore it after repopulation
                const currentValue = sel.value;
                
                // Use appropriate default option text based on the select element
                const defaultText = sel.id === 'summary-student-select' || sel.id === 'frenzy-student-select' 
                    ? 'All Students' 
                    : 'Select Student';
                sel.innerHTML = `<option value="">${defaultText}</option>`;
                
                // Populate with students (use filtered list for summary/schedule when in their update-only mode, allStudents for others)
                const studentsToUse = (updateSummaryOnly && sel.id === 'summary-student-select') || (updateScheduleOnly && sel.id === 'schedule-student-select')
                    ? studentsList 
                    : allStudents;
                
                studentsToUse.forEach(student => {
                    if (student && student.id && student.name) {
                        const option = document.createElement('option');
                        option.value = student.id;
                        option.textContent = student.name;
                        sel.appendChild(option);
                    }
                });
                
                // Restore the previously selected value if it still exists
                if (currentValue && Array.from(sel.options).some(opt => opt.value === currentValue)) {
                    sel.value = currentValue;
                } else if (sel.id === 'schedule-student-select' && currentScheduleStudentId) {
                    // If schedule dropdown and selected student no longer exists, clear selection
                    sel.value = '';
                    currentScheduleStudentId = null;
                    // Clear the student schedule display
                    studentScheduleData = [];
                    renderStudentSchedule();
                }
            }
        });
        
        // If period is selected, reload the grid (only if not summary-only update)
        if (!updateSummaryOnly && currentPeriod) {
            loadPeriodData();
        }
        
        // If in daily view, reload that grid (only if not summary-only update)
        if (!updateSummaryOnly) {
            const entryView = document.getElementById('entry-view');
            if (entryView && entryView.classList.contains('active')) {
                // Ensure filteredDailyStudents is initialized
                if (!filteredDailyStudents || filteredDailyStudents.length === 0) {
                    filteredDailyStudents = [...allStudents];
                }
                scheduleDailyDataLoad(0);
            }
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

    // For staff/admin in period entry view, load filtered students based on schedule
    if (canEdit() && document.getElementById('period-entry-view')?.classList.contains('active')) {
        try {
            let url = `/api/students/by-staff-period?period=${encodeURIComponent(currentPeriod)}`;
            if (currentClass) {
                url += `&class_name=${encodeURIComponent(currentClass)}`;
            }
            const response = await fetch(url);
            if (response.ok) {
                filteredStudentsForPeriod = await response.json();
                console.log(`Loaded ${filteredStudentsForPeriod.length} students for period ${currentPeriod}${currentClass ? `, class ${currentClass}` : ''}`);
            } else {
                console.error('Error loading filtered students:', response.statusText);
                filteredStudentsForPeriod = [];
            }
        } catch (error) {
            console.error('Error loading filtered students:', error);
            filteredStudentsForPeriod = [];
        }
    } else {
        // For other views or students, use all students
        filteredStudentsForPeriod = allStudents;
    }

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

function updatePeriodPercentageRow() {
    // Update percentage cells for all students in the period entry
    // Use filtered students for period entry view, otherwise use all students
    const studentsToUpdate = (canEdit() && document.getElementById('period-entry-view')?.classList.contains('active')) 
        ? filteredStudentsForPeriod 
        : allStudents;
    studentsToUpdate.forEach((student) => {
        const data = periodData[student.id] || {};
        const categories = ['safety_points', 'teamwork_points', 'accountability_points', 'relationships_points'];
        const categoryShort = ['s', 't', 'a', 'r'];
        
        let totalPoints = 0;
        let countedCategories = 0;
        
        // Update each category percentage
        categoryShort.forEach((catShort, catIndex) => {
            const catFull = categories[catIndex];
            const cell = document.querySelector(`.period-percent-cell[data-student-id="${student.id}"][data-category="${catShort}"]`);
            
            if (cell) {
                const value = data[catFull];
                if (value !== null && value !== undefined) {
                    const percentage = ((value / 2) * 100).toFixed(0);
                    cell.textContent = `${percentage}%`;
                    totalPoints += value;
                    countedCategories++;
                } else {
                    cell.textContent = '-';
                }
            }
        });
        
        // Update overall percentage
        const overallCell = document.querySelector(`.period-percent-cell[data-student-id="${student.id}"][data-category="overall"]`);
        if (overallCell) {
            if (countedCategories > 0) {
                const maxPossible = countedCategories * 2;
                const overallPercentage = ((totalPoints / maxPossible) * 100).toFixed(0);
                overallCell.textContent = `${overallPercentage}%`;
            } else {
                overallCell.textContent = '-';
            }
        }
    });
}

function renderStudentsGrid() {
    const header = document.getElementById('students-header');
    const grid = document.getElementById('categories-grid');
    if (!grid || !header) return;
    
    header.innerHTML = '';
    grid.innerHTML = '';

    // Use filtered students for period entry view, otherwise use all students
    const studentsToDisplay = (canEdit() && document.getElementById('period-entry-view')?.classList.contains('active')) 
        ? filteredStudentsForPeriod 
        : allStudents;

    if (!studentsToDisplay || studentsToDisplay.length === 0) {
        const message = (canEdit() && document.getElementById('period-entry-view')?.classList.contains('active'))
            ? 'No students found for this period. Make sure students have you assigned in their schedule for this time period.'
            : 'No students found. Click "Add Student" to create one.';
        grid.innerHTML = `<div class="info-message" style="padding: 20px; text-align: center; grid-column: 1/-1;">${message}</div>`;
        return;
    }

    // Reuse the same grid structure as daily grid
    const spacerWidth = '7px';
    const studentColumns = studentsToDisplay.map((_, index) => {
        if (index === studentsToDisplay.length - 1) {
            return 'repeat(4, 40px) 40px';
        } else {
            return `repeat(4, 40px) 40px ${spacerWidth}`;
        }
    }).join(' ');
    
    header.style.gridTemplateColumns = `120px ${spacerWidth} ${studentColumns}`;
    grid.style.gridTemplateColumns = `120px ${spacerWidth} ${studentColumns}`;

    // 1. Period/Location Header
    const periodHeader = document.createElement('div');
    periodHeader.className = 'daily-header-cell daily-header-period';
    periodHeader.textContent = currentPeriod || 'Period';
    header.appendChild(periodHeader);

    const periodSpacer = document.createElement('div');
    // Gutter between period and first student: keep space but make it visually transparent
    periodSpacer.style.background = 'transparent';
    header.appendChild(periodSpacer);

    // Helper function to get background color from card_color (opaque, similar to STAR colors)
    const getCardColor = (cardColor) => {
        if (!cardColor) return null;
        const colors = {
            'yellow': '#FEF3C7',  // Light yellow, Relationships (R)
            'green': '#D1FAE5',   // Light green, Accountability (A)
            'blue': '#E0E7FF'     // Muted blue for Teamwork (T)
        };
        return colors[cardColor.toLowerCase()] || null;
    };
    
    // 2. Student Names Header
    studentsToDisplay.forEach((student, index) => {
        const studentHeader = document.createElement('div');
        studentHeader.className = 'daily-header-cell daily-header-student';
        studentHeader.textContent = student.name;
        studentHeader.style.gridColumn = 'span 5';
        
        // Apply card color background
        const bgColor = getCardColor(student.card_color);
        if (bgColor) {
            studentHeader.style.backgroundColor = bgColor;
        }
        
        header.appendChild(studentHeader);
        
        if (index < studentsToDisplay.length - 1) {
            const spacerHeader = document.createElement('div');
            // Gutter between student name blocks
            spacerHeader.style.background = 'transparent';
            header.appendChild(spacerHeader);
        }
    });

    // 3. Category Labels (S, T, A, R, I)
    const categoryLabels = ['S', 'T', 'A', 'R', 'I'];
    const emptyCell = document.createElement('div');
    emptyCell.className = 'star-category-header';
    emptyCell.style.background = '#f8f9fa';
    header.appendChild(emptyCell);
    
    const emptySpacerCell = document.createElement('div');
    // Gutter column under the period header
    emptySpacerCell.style.background = 'transparent';
    header.appendChild(emptySpacerCell);
    
    studentsToDisplay.forEach((student, index) => {
        const categoryKeys = ['s', 't', 'a', 'r', 'i'];
        categoryLabels.forEach((label, labelIndex) => {
            const catHeader = document.createElement('div');
            catHeader.className = 'star-category-header';
            catHeader.textContent = label;
            catHeader.dataset.category = categoryKeys[labelIndex];
            header.appendChild(catHeader);
        });
        
        if (index < studentsToDisplay.length - 1) {
            const spacerSubHeader = document.createElement('div');
            // Gutter between S/T/A/R/I header groups
            spacerSubHeader.style.background = 'transparent';
            header.appendChild(spacerSubHeader);
        }
    });

    // 4. Data Row
    // Period Name cell
    const periodCell = document.createElement('div');
    periodCell.className = 'daily-period-cell';
    periodCell.textContent = currentPeriod || '';
    grid.appendChild(periodCell);

    const rowSpacer = document.createElement('div');
    // Gutter column next to period in this compact grid
    rowSpacer.style.background = 'transparent';
    grid.appendChild(rowSpacer);

    // Data cells for each student
    studentsToDisplay.forEach((student, studentIndex) => {
        const data = periodData[student.id] || {};
        const categories = [
            { full: 'safety', short: 's' },
            { full: 'teamwork', short: 't' },
            { full: 'accountability', short: 'a' },
            { full: 'relationships', short: 'r' }
        ];
        
        categories.forEach(cat => {
            const cell = document.createElement('div');
            cell.className = 'daily-data-cell';
            cell.style.padding = '2px';
            cell.style.display = 'flex';
            cell.style.justifyContent = 'center';
            cell.style.alignItems = 'center';
            
            const select = document.createElement('select');
            select.className = 'daily-input';
            select.dataset.studentId = student.id;
            select.dataset.category = cat.short;
            
            if (isStudent()) select.disabled = true;
            
            const emptyOption = document.createElement('option');
            emptyOption.value = '';
            emptyOption.textContent = '-';
            select.appendChild(emptyOption);
            
            [2, 1, 0].forEach(val => {
                const option = document.createElement('option');
                option.value = val;
                option.textContent = val;
                if (data[`${cat.full}_points`] === val) option.selected = true;
                select.appendChild(option);
            });
            
            select.addEventListener('change', (e) => {
                const val = e.target.value === '' ? null : parseInt(e.target.value);
                if (!periodData[student.id]) {
                    periodData[student.id] = { student_id: student.id };
                }
                periodData[student.id][`${cat.full}_points`] = val;
                
                // Update percentage row in real-time
                updatePeriodPercentageRow();
                
                // Update "I" box highlight based on STAR values
                updateInfoButtonHighlight(student.id, currentPeriod);
                
                // Auto-advance to next input (skipping Info column), unless this was triggered by backspace
                if (!e.isBackspaceClear) {
                    moveToNextInput(select);
                }
            });
            
            select.addEventListener('keydown', handleDailyInputKeydown);
            
            cell.appendChild(select);
            grid.appendChild(cell);
        });

        // Info Button
        const infoCell = document.createElement('div');
        infoCell.className = 'daily-data-cell daily-info-cell';
        infoCell.style.padding = '2px';
        infoCell.style.display = 'flex';
        infoCell.style.justifyContent = 'center';
        infoCell.style.alignItems = 'center';
        
        const infoButton = document.createElement('button');
        infoButton.className = 'info-btn';
        infoButton.textContent = 'I';
        infoButton.dataset.studentId = student.id;
        infoButton.dataset.period = currentPeriod;
        infoButton.dataset.studentName = student.name;
        infoButton.dataset.info = data.info || '';
        
        if (isStudent()) infoButton.disabled = false;
        
        if (data.info) {
            try {
                const parsed = JSON.parse(data.info);
                if (hasInfoData(parsed)) infoButton.classList.add('has-data');
            } catch (e) {
                if (data.info.trim()) infoButton.classList.add('has-data');
            }
        }
        
        infoButton.addEventListener('click', showInfoModal);
        infoCell.appendChild(infoButton);
        grid.appendChild(infoCell);
        
        if (studentIndex < studentsToDisplay.length - 1) {
            const spacerCell = document.createElement('div');
            // Gutters between student columns in this compact grid
            spacerCell.style.background = 'transparent';
            grid.appendChild(spacerCell);
        }
    });
    
    // Add percentage row
    const percentLabel = document.createElement('div');
    percentLabel.className = 'daily-period-cell';
    percentLabel.textContent = 'Percent';
    percentLabel.style.fontWeight = '600';
    percentLabel.style.borderTop = '2px solid #000';
    percentLabel.style.background = '#f8f9fa';
    grid.appendChild(percentLabel);
    
    const percentSpacer = document.createElement('div');
    // Gutter at the start of the percentage row
    percentSpacer.style.background = 'transparent';
    percentSpacer.style.borderTop = '2px solid #000';
    grid.appendChild(percentSpacer);
    
    // Calculate and display percentage for each student
    studentsToDisplay.forEach((student, studentIndex) => {
        const data = periodData[student.id] || {};
        const categories = ['safety_points', 'teamwork_points', 'accountability_points', 'relationships_points'];
        const categoryShort = ['s', 't', 'a', 'r'];
        
        let totalPoints = 0;
        let countedCategories = 0;
        
        // Calculate percentages for each category
        categoryShort.forEach((catShort, catIndex) => {
            const catFull = categories[catIndex];
            const cell = document.createElement('div');
            cell.className = 'daily-data-cell daily-percent-cell period-percent-cell';
            cell.dataset.studentId = student.id;
            cell.dataset.category = catShort;
            cell.style.padding = '8px';
            cell.style.display = 'flex';
            cell.style.justifyContent = 'center';
            cell.style.alignItems = 'center';
            cell.style.borderTop = '2px solid #000';
            cell.style.fontWeight = '700';
            cell.style.fontSize = '11px';
            cell.style.background = '#f8f9fa';
            
            const value = data[catFull];
            if (value !== null && value !== undefined) {
                const percentage = ((value / 2) * 100).toFixed(0);
                cell.textContent = `${percentage}%`;
                totalPoints += value;
                countedCategories++;
                
                // Color code based on category
                if (catShort === 's') cell.style.color = '#B91C1C';
                else if (catShort === 't') cell.style.color = '#1E40AF';
                else if (catShort === 'a') cell.style.color = '#047857';
                else if (catShort === 'r') cell.style.color = '#B45309';
            } else {
                cell.textContent = '-';
            }
            
            grid.appendChild(cell);
        });
        
        // Overall percentage in Info column
        const overallCell = document.createElement('div');
        overallCell.className = 'daily-data-cell daily-percent-cell period-percent-cell';
        overallCell.dataset.studentId = student.id;
        overallCell.dataset.category = 'overall';
        overallCell.style.padding = '8px';
        overallCell.style.display = 'flex';
        overallCell.style.justifyContent = 'center';
        overallCell.style.alignItems = 'center';
        overallCell.style.borderTop = '2px solid #000';
        overallCell.style.fontWeight = '700';
        overallCell.style.fontSize = '11px';
        overallCell.style.background = 'var(--bg-elevated)';
        overallCell.style.color = 'var(--accent)';
        
        if (countedCategories > 0) {
            const maxPossible = countedCategories * 2;
            const overallPercentage = ((totalPoints / maxPossible) * 100).toFixed(0);
            overallCell.textContent = `${overallPercentage}%`;
        } else {
            overallCell.textContent = '-';
        }
        
        grid.appendChild(overallCell);
        
        if (studentIndex < studentsToDisplay.length - 1) {
            const spacerCell = document.createElement('div');
            // Gutters between student percentage columns
            spacerCell.style.background = 'transparent';
            spacerCell.style.borderTop = '2px solid #000';
            grid.appendChild(spacerCell);
        }
    });
    
    // Update "I" box highlights for all students on initial load
    studentsToDisplay.forEach(student => {
        updateInfoButtonHighlight(student.id, currentPeriod);
    });
}

async function savePeriodData() {
    if (!currentDate || !currentPeriod) {
        alert('Please select a date and period');
        return;
    }

    const locationInput = document.getElementById('location-input');
    const location = locationInput ? locationInput.value || currentPeriod : currentPeriod;

    // For period entry view, only save data for filtered students
    const studentsToSave = (canEdit() && document.getElementById('period-entry-view')?.classList.contains('active')) 
        ? filteredStudentsForPeriod 
        : allStudents;
    const allowedStudentIds = new Set(studentsToSave.map(s => s.id));

    // Prepare data for students (filtered if in period entry view)
    const studentsData = [];
    Object.keys(periodData).forEach(studentId => {
        const studentIdInt = parseInt(studentId);
        // Only include students who are in the allowed list
        if (!allowedStudentIds.has(studentIdInt)) {
            return;
        }
        const data = periodData[studentIdInt];
        if (data.safety_points !== undefined || data.teamwork_points !== undefined || 
            data.accountability_points !== undefined || data.relationships_points !== undefined) {
            studentsData.push({
                student_id: studentIdInt,
                date: currentDate,
                period: currentPeriod,
                location: location,
                safety_points: data.safety_points || 0,
                teamwork_points: data.teamwork_points || 0,
                accountability_points: data.accountability_points || 0,
                relationships_points: data.relationships_points || 0,
                info: data.info || ''
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
            // Refresh summary if it's currently displayed
            refreshSummaryIfActive();
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
async function filterDailyStudents() {
    // Initialize with all students if no filters
    if (!dailyEntrySearchQuery && !dailyEntryManagedByMe) {
        filteredDailyStudents = [...allStudents];
        dailyEntryStaffFilterName = null;
        return;
    }
    
    let studentsToFilter = [...allStudents];
    
    // Apply "managed by me" filter if checked
    if (dailyEntryManagedByMe) {
        try {
            const response = await fetch('/api/students?managed_by_me=true');
            if (response.ok) {
                const managedStudents = await response.json();
                const managedStudentIds = new Set(managedStudents.map(s => s.id));
                studentsToFilter = studentsToFilter.filter(s => managedStudentIds.has(s.id));
            }
        } catch (error) {
            console.error('Error loading managed students:', error);
        }
    }
    
    // Apply search filter if query provided
    if (dailyEntrySearchQuery && dailyEntrySearchQuery.trim()) {
        const query = dailyEntrySearchQuery.trim().toLowerCase();
        
        // Prefer student name match: filter students whose name contains the query
        const studentsMatchingName = studentsToFilter.filter(s =>
            (s.name || '').toLowerCase().includes(query)
        );
        
        if (studentsMatchingName.length > 0) {
            // At least one student name matches — use student name search (expected behavior)
            studentsToFilter = studentsMatchingName;
            dailyEntryStaffFilterName = null;
        } else {
            // No student name match — try staff name search (full name match only)
            const matchingStaff = allStaffMembers.filter(staff => {
                const staffName = (staff.name || staff.username || '').toLowerCase();
                return staffName === query;
            });
            
            if (matchingStaff.length > 0) {
                try {
                    const staffName = matchingStaff[0].name || matchingStaff[0].username;
                    const response = await fetch(`/api/students/by-staff-name?staff_name=${encodeURIComponent(staffName)}`);
                    if (response.ok) {
                        const staffStudents = await response.json();
                        if (staffStudents.length > 0) {
                            const staffStudentIds = new Set(staffStudents.map(s => s.id));
                            studentsToFilter = studentsToFilter.filter(s => staffStudentIds.has(s.id));
                            dailyEntryStaffFilterName = staffName;
                        } else {
                            studentsToFilter = [];
                            dailyEntryStaffFilterName = null;
                        }
                    } else {
                        studentsToFilter = [];
                        dailyEntryStaffFilterName = null;
                    }
                } catch (error) {
                    console.error('Error searching by staff name:', error);
                    studentsToFilter = [];
                    dailyEntryStaffFilterName = null;
                }
            } else {
                studentsToFilter = [];
                dailyEntryStaffFilterName = null;
            }
        }
    } else {
        dailyEntryStaffFilterName = null;
    }
    
    filteredDailyStudents = studentsToFilter;
}

async function loadDailyData() {
    const requestToken = ++dailyLoadRequestToken;

    if (dailyLoadAbortController) {
        dailyLoadAbortController.abort();
    }
    const activeAbortController = new AbortController();
    dailyLoadAbortController = activeAbortController;
    let requestTimedOut = false;
    const timeoutId = setTimeout(() => {
        requestTimedOut = true;
        activeAbortController.abort();
    }, DAILY_LOAD_TIMEOUT_MS);

    // Ensure staff members are loaded for search functionality
    if (allStaffMembers.length === 0) {
        await loadUsers();
    }
    // Filter students first
    await filterDailyStudents();
    
    if (!currentDate || !filteredDailyStudents || filteredDailyStudents.length === 0) {
        const container = document.getElementById('daily-grid-container');
        const noStudents = document.getElementById('daily-no-students');
        const staffFilterTitle = document.getElementById('daily-staff-filter-title');
        if (container) container.style.display = 'none';
        if (staffFilterTitle) staffFilterTitle.style.display = 'none';
        if (noStudents) noStudents.style.display = (filteredDailyStudents.length === 0 && allStudents.length > 0) ? 'block' : (allStudents.length === 0 ? 'block' : 'none');
        return;
    }

    const container = document.getElementById('daily-grid-container');
    const noStudents = document.getElementById('daily-no-students');
    const staffFilterTitle = document.getElementById('daily-staff-filter-title');
    if (container) container.style.display = 'block';
    if (noStudents) noStudents.style.display = 'none';
    if (staffFilterTitle) {
        if (dailyEntryStaffFilterName) {
            staffFilterTitle.textContent = `Showing students for: ${dailyEntryStaffFilterName}`;
            staffFilterTitle.style.display = 'block';
        } else {
            staffFilterTitle.style.display = 'none';
        }
    }

    // Show loading immediately so it appears without delay while we fetch
    let loadingEl = document.getElementById('daily-grid-loading');
    let dailyGridEl = document.getElementById('daily-grid');
    if (loadingEl) loadingEl.style.display = 'flex';
    if (dailyGridEl) dailyGridEl.style.visibility = 'hidden';

    // Initialize submitted students tracking for current date if needed
    if (!submittedStudents[currentDate]) {
        submittedStudents[currentDate] = new Set();
    }

    // Load existing data for all periods
    dailyData = {};
    
    try {
        // Build a set of visible student IDs for this view
        const visibleStudentIds = new Set(filteredDailyStudents.map(s => s.id));
        // Determine which visible students still need data loaded (not yet submitted)
        const nonSubmittedVisibleIds = new Set(
            Array.from(visibleStudentIds).filter(id => !submittedStudents[currentDate].has(id))
        );

        // If all visible students have already been submitted, we don't need to load anything
        if (nonSubmittedVisibleIds.size === 0) {
            renderDailyGrid();
            return;
        }

        const studentIdsCsv = Array.from(nonSubmittedVisibleIds).join(',');
        const cacheKey = `${currentDate}|${studentIdsCsv}`;
        const now = Date.now();
        let allRecords;

        const cached = dailyLoadCache.get(cacheKey);
        if (cached && (now - cached.timestamp) < DAILY_LOAD_CACHE_TTL_MS) {
            allRecords = cached.records;
        } else {
            // Request only visible students and lightweight period fields for faster daily-grid loads.
            const params = new URLSearchParams({
                start_date: currentDate,
                end_date: currentDate,
                student_ids: studentIdsCsv,
                include_details: 'false'
            });
            const response = await fetch(`/api/daily-records?${params.toString()}`, {
                signal: activeAbortController.signal
            });
            if (!response.ok) {
                throw new Error(`Failed to load daily records (${response.status})`);
            }
            allRecords = await response.json();
            dailyLoadCache.set(cacheKey, { timestamp: now, records: allRecords });
        }

        if (requestToken !== dailyLoadRequestToken) {
            return;
        }
        
        // Initialize attendance data for current date if not exists
        if (!attendanceData[currentDate]) {
            attendanceData[currentDate] = {};
        }

        // Map records by student, but only for visible, non-submitted students
        allRecords.forEach(record => {
            const studentId = record.student_id;

            // Only process students that are currently visible in the daily view
            if (!visibleStudentIds.has(studentId)) {
                return;
            }
            // Skip students that have already been submitted for this date
            if (submittedStudents[currentDate].has(studentId)) {
                return;
            }

            dailyData[studentId] = {};

            // Load attendance status - prefer attendance_status, fallback to present boolean for backward compatibility
            if (record.attendance_status) {
                attendanceData[currentDate][studentId] = record.attendance_status;
            } else if (record.present !== undefined) {
                // Migration: convert old present boolean to new attendance_status
                attendanceData[currentDate][studentId] = record.present ? 'present' : 'unexcused';
            } else {
                // Default to present if not set
                if (!attendanceData[currentDate][studentId]) {
                    attendanceData[currentDate][studentId] = 'present';
                }
            }

            record.periods.forEach(period => {
                dailyData[studentId][period.time_range] = {
                    s: period.safety_points,
                    t: period.teamwork_points,
                    a: period.accountability_points,
                    r: period.relationships_points,
                    info: period.info || ''
                };
            });
        });
    } catch (error) {
        if (error && error.name === 'AbortError') {
            if (requestTimedOut && requestToken === dailyLoadRequestToken) {
                showMessage('Daily overview timed out while loading. Please try again.', 'error');
            }
            return;
        }
        console.error('Error loading daily data:', error);
    } finally {
        clearTimeout(timeoutId);

        if (requestToken !== dailyLoadRequestToken) {
            return;
        }

        // Hide loading animation and show grid
        loadingEl = document.getElementById('daily-grid-loading');
        dailyGridEl = document.getElementById('daily-grid');
        if (loadingEl) loadingEl.style.display = 'none';
        if (dailyGridEl) dailyGridEl.style.visibility = '';

        renderDailyGrid();
    }
}

function calculateStudentPercentages(studentId) {
    // Check attendance status
    const attendance = attendanceData[currentDate]?.[studentId] || 'present';
    
    // If excused, exclude from calculations (return '-')
    if (attendance === 'excused') {
        return { s: '-', t: '-', a: '-', r: '-', overall: '-' };
    }
    
    // If unexcused, return 0% for all
    if (attendance === 'unexcused') {
        return { s: '0', t: '0', a: '0', r: '0', overall: '0' };
    }
    
    // Normal calculation for present
    const studentData = dailyData[studentId] || {};
    let totals = { s: 0, t: 0, a: 0, r: 0 };
    let counts = { s: 0, t: 0, a: 0, r: 0 };
    
    // Calculate totals and counts for each category
    Object.values(studentData).forEach(periodData => {
        ['s', 't', 'a', 'r'].forEach(category => {
            if (periodData[category] !== null && periodData[category] !== undefined) {
                totals[category] += periodData[category];
                counts[category]++;
            }
        });
    });
    
    // Calculate percentages (max 2 points per period per category)
    const percentages = {};
    ['s', 't', 'a', 'r'].forEach(category => {
        if (counts[category] > 0) {
            const maxPossible = counts[category] * 2;
            percentages[category] = ((totals[category] / maxPossible) * 100).toFixed(0);
        } else {
            percentages[category] = '-';
        }
    });
    
    // Calculate overall percentage
    const totalPoints = totals.s + totals.t + totals.a + totals.r;
    const totalCounts = counts.s + counts.t + counts.a + counts.r;
    if (totalCounts > 0) {
        const maxPossible = totalCounts * 2;
        percentages.overall = ((totalPoints / maxPossible) * 100).toFixed(0);
    } else {
        percentages.overall = '-';
    }
    
    return percentages;
}

function renderDailyGrid() {
    const header = document.getElementById('daily-header');
    const body = document.getElementById('daily-body');
    const loadingEl = document.getElementById('daily-grid-loading');
    const dailyGridEl = document.getElementById('daily-grid');
    if (!header || !body) return;

    if (loadingEl) loadingEl.style.display = 'none';
    if (dailyGridEl) dailyGridEl.style.visibility = '';

    header.innerHTML = '';
    body.innerHTML = '';

    // Use filtered students for display
    const studentsToDisplay = filteredDailyStudents && filteredDailyStudents.length > 0 ? filteredDailyStudents : allStudents;
    
    if (!studentsToDisplay || studentsToDisplay.length === 0) {
        return;
    }

    // Calculate grid columns: Period + spacer + (5 columns per student: S, T, A, R, I + 1 spacer between)
    const spacerWidth = '7px'; // 1/4 of original 27px
    const studentColumns = studentsToDisplay.map((_, index) => {
        if (index === studentsToDisplay.length - 1) {
            // Last student - no spacer after (4 STAR columns + 1 Info column)
            return 'repeat(4, 40px) 40px';
        } else {
            // Add spacer after student (4 STAR columns + 1 Info column + spacer)
            return `repeat(4, 40px) 40px ${spacerWidth}`;
        }
    }).join(' ');
    
    header.style.gridTemplateColumns = `120px ${spacerWidth} ${studentColumns}`;
    body.style.gridTemplateColumns = `120px ${spacerWidth} ${studentColumns}`;

    // Create header row
    const periodHeader = document.createElement('div');
    periodHeader.className = 'daily-header-cell daily-header-period';
    periodHeader.textContent = 'Period';
    header.appendChild(periodHeader);

    // Add spacer after period column (gutter, but visually transparent)
    const periodSpacer = document.createElement('div');
    periodSpacer.style.background = 'transparent';
    header.appendChild(periodSpacer);

    // Helper function to get background color from card_color (opaque, similar to STAR colors)
    const getCardColor = (cardColor) => {
        if (!cardColor) return null;
        const colors = {
            'yellow': '#FEF3C7',  // Light yellow, Relationships (R)
            'green': '#D1FAE5',   // Light green, Accountability (A)
            'blue': '#E0E7FF'     // Muted blue for Teamwork (T)
        };
        return colors[cardColor.toLowerCase()] || null;
    };

    // Student headers (each spans 5 columns for S, T, A, R, I, plus spacer spans)
    studentsToDisplay.forEach((student, index) => {
        const studentHeader = document.createElement('div');
        studentHeader.className = 'daily-header-cell daily-header-student';
        studentHeader.style.gridColumn = 'span 5';
        studentHeader.dataset.studentIndex = index;
        studentHeader.style.display = 'flex';
        studentHeader.style.flexDirection = 'column';
        studentHeader.style.gap = '4px';
        studentHeader.style.padding = '6px 8px';
        
        // Apply card color background
        const bgColor = getCardColor(student.card_color);
        if (bgColor) {
            studentHeader.style.backgroundColor = bgColor;
        }
        
        // Student name
        const nameSpan = document.createElement('span');
        nameSpan.textContent = student.name;
        nameSpan.style.fontWeight = '600';
        studentHeader.appendChild(nameSpan);
        
        // Attendance dropdown (only for staff/admin)
        if (canEdit()) {
            const attendanceContainer = document.createElement('div');
            attendanceContainer.style.display = 'flex';
            attendanceContainer.style.alignItems = 'center';
            attendanceContainer.style.gap = '6px';
            
            const attendanceLabel = document.createElement('label');
            attendanceLabel.textContent = 'Attendance:';
            attendanceLabel.style.fontSize = '11px';
            attendanceLabel.style.color = '#666';
            attendanceLabel.style.fontWeight = '400';
            attendanceContainer.appendChild(attendanceLabel);
            
            const attendanceSelect = document.createElement('select');
            attendanceSelect.className = 'attendance-select';
            attendanceSelect.dataset.studentId = student.id;
            attendanceSelect.style.padding = '4px 8px';
            attendanceSelect.style.fontSize = '11px';
            attendanceSelect.style.border = '1px solid #ddd';
            attendanceSelect.style.background = 'white';
            attendanceSelect.style.cursor = 'pointer';
            
            // Initialize attendance data for current date if not exists
            if (!attendanceData[currentDate]) {
                attendanceData[currentDate] = {};
            }
            if (!attendanceData[currentDate][student.id]) {
                attendanceData[currentDate][student.id] = 'present';
            }
            
            const currentAttendance = attendanceData[currentDate][student.id];
            
            ['present', 'excused', 'unexcused'].forEach(status => {
                const option = document.createElement('option');
                option.value = status;
                option.textContent = status.charAt(0).toUpperCase() + status.slice(1);
                if (status === currentAttendance) {
                    option.selected = true;
                }
                attendanceSelect.appendChild(option);
            });

            attendanceContainer.appendChild(attendanceSelect);
            studentHeader.appendChild(attendanceContainer);
        }
        
        header.appendChild(studentHeader);
        
        // Add spacer cell after each student (except the last)
        if (index < studentsToDisplay.length - 1) {
            const spacerHeader = document.createElement('div');
            // Gutters between student header blocks
            spacerHeader.style.background = 'transparent';
            spacerHeader.style.gridColumn = 'span 1';
            header.appendChild(spacerHeader);
        }
    });

    // Sub-headers for S, T, A, R, I under each student
    const categoryLabels = ['S', 'T', 'A', 'R', 'I'];
    const subHeaderRow = document.createElement('div');
    subHeaderRow.style.display = 'contents';
    
    // Empty cell for Period column
    const emptyCell = document.createElement('div');
    emptyCell.className = 'star-category-header';
    emptyCell.style.background = '#f8f9fa';
    header.appendChild(emptyCell);
    
    // Empty spacer cell after period column
    const emptySpacerCell = document.createElement('div');
    // Gutter column under the period header
    emptySpacerCell.style.background = 'transparent';
    header.appendChild(emptySpacerCell);
    
    // S, T, A, R, I headers for each student
    studentsToDisplay.forEach((student, index) => {
        const categoryKeys = ['s', 't', 'a', 'r', 'i'];
        categoryLabels.forEach((label, labelIndex) => {
            const catHeader = document.createElement('div');
            catHeader.className = 'star-category-header';
            catHeader.textContent = label;
            catHeader.dataset.studentIndex = index;
            catHeader.dataset.category = categoryKeys[labelIndex];
            header.appendChild(catHeader);
        });
        
        // Add spacer cell after each student (except the last)
        if (index < studentsToDisplay.length - 1) {
            const spacerSubHeader = document.createElement('div');
            // Gutters between S/T/A/R/I header groups
            spacerSubHeader.style.background = 'transparent';
            spacerSubHeader.style.gridColumn = 'span 1';
            header.appendChild(spacerSubHeader);
        }
    });

    // Create rows for each period
    STANDARD_PERIODS.forEach((period, periodIndex) => {
        const isOddRow = periodIndex % 2 === 1;
        // Period cell
        const periodCell = document.createElement('div');
        periodCell.className = 'daily-period-cell';
        periodCell.textContent = period.time;
        periodCell.dataset.periodIndex = periodIndex;
        if (isOddRow) {
            periodCell.style.background = 'var(--bg-page)';
        }
        body.appendChild(periodCell);

        // Add spacer after period column (gutter, but visually transparent)
        const periodRowSpacer = document.createElement('div');
        periodRowSpacer.style.background = 'transparent';
        periodRowSpacer.dataset.periodIndex = periodIndex;
        body.appendChild(periodRowSpacer);

        // For each student, create 5 cells (S, T, A, R, I)
        studentsToDisplay.forEach((student, studentIndex) => {
            const studentData = dailyData[student.id]?.[period.time] || { s: null, t: null, a: null, r: null, info: '' };
            
            ['s', 't', 'a', 'r'].forEach((category, catIndex) => {
                const cell = document.createElement('div');
                cell.className = 'daily-data-cell';
                cell.style.padding = '2px';
                cell.style.display = 'flex';
                cell.style.justifyContent = 'center';
                cell.style.alignItems = 'center';
                cell.dataset.studentIndex = studentIndex;
                cell.dataset.periodIndex = periodIndex;
                if (isOddRow) {
                    cell.style.background = 'var(--bg-page)';
                }
                
                const select = document.createElement('select');
                select.className = 'daily-input';
                select.dataset.studentId = student.id;
                select.dataset.period = period.time;
                select.dataset.category = category;
                
                // Disable for students
                if (isStudent()) {
                    select.disabled = true;
                }
                
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
                
                cell.appendChild(select);
                body.appendChild(cell);
            });
            
            // Add Info button cell
            const infoCell = document.createElement('div');
            infoCell.className = 'daily-data-cell daily-info-cell';
            infoCell.style.padding = '2px';
            infoCell.style.display = 'flex';
            infoCell.style.justifyContent = 'center';
            infoCell.style.alignItems = 'center';
            infoCell.dataset.studentIndex = studentIndex;
            infoCell.dataset.periodIndex = periodIndex;
            if (isOddRow) {
                infoCell.style.background = 'var(--bg-page)';
            }
            
            const infoButton = document.createElement('button');
            infoButton.className = 'info-btn';
            infoButton.textContent = 'I';
            infoButton.dataset.studentId = student.id;
            infoButton.dataset.period = period.time;
            infoButton.dataset.studentName = student.name;
            infoButton.dataset.info = studentData.info || '';
            
            // Disable for students (view only)
            if (isStudent()) {
                infoButton.disabled = false; // Allow viewing but not editing
            }
            
            // Add visual indicator if there's data
            if (studentData.info) {
                try {
                    const parsedInfo = JSON.parse(studentData.info);
                    if (hasInfoData(parsedInfo)) {
                        infoButton.classList.add('has-data');
                    }
                } catch (e) {
                    // If it's plain text and not empty
                    if (studentData.info.trim()) {
                        infoButton.classList.add('has-data');
                    }
                }
            }
            
            infoCell.appendChild(infoButton);
            body.appendChild(infoCell);
            
            // Add spacer cell after each student (except the last)
            if (studentIndex < studentsToDisplay.length - 1) {
                const spacerCell = document.createElement('div');
                // Gutters between student columns in body
                spacerCell.style.background = 'transparent';
                spacerCell.dataset.periodIndex = periodIndex;
                body.appendChild(spacerCell);
            }
        });
    });
    
    // Add percentage row for each student
    // Empty cell for period column
    const percentPeriodCell = document.createElement('div');
    percentPeriodCell.className = 'daily-period-cell';
    percentPeriodCell.textContent = 'Percent';
    percentPeriodCell.style.fontWeight = '600';
    percentPeriodCell.style.borderTop = '2px solid #000';
    percentPeriodCell.style.background = '#f8f9fa';
    body.appendChild(percentPeriodCell);
    
    // Add spacer after period column (gutter, but visually transparent)
    const percentSpacer = document.createElement('div');
    percentSpacer.style.background = 'transparent';
    percentSpacer.style.borderTop = '2px solid #000';
    body.appendChild(percentSpacer);
    
    // For each student, add percentage cells
    studentsToDisplay.forEach((student, studentIndex) => {
        const percentages = calculateStudentPercentages(student.id);
        
        // Add percentage cells for S, T, A, R
        ['s', 't', 'a', 'r'].forEach((category, catIndex) => {
            const percentCell = document.createElement('div');
            percentCell.className = 'daily-data-cell daily-percent-cell';
            percentCell.dataset.studentId = student.id;
            percentCell.dataset.category = category;
            percentCell.style.padding = '8px';
            percentCell.style.display = 'flex';
            percentCell.style.justifyContent = 'center';
            percentCell.style.alignItems = 'center';
            percentCell.style.borderTop = '2px solid #000';
            percentCell.style.fontWeight = '700';
            percentCell.style.fontSize = '11px';
            percentCell.style.background = '#f8f9fa';
            
            const percentText = percentages[category] !== '-' ? `${percentages[category]}%` : '-';
            percentCell.textContent = percentText;
            
            // Color code based on category
            if (percentages[category] !== '-') {
                if (category === 's') percentCell.style.color = '#B91C1C';
                else if (category === 't') percentCell.style.color = '#1E40AF';
                else if (category === 'a') percentCell.style.color = '#047857';
                else if (category === 'r') percentCell.style.color = '#B45309';
            }
            
            body.appendChild(percentCell);
        });
        
        // Add overall percentage in Info column
        const overallPercentCell = document.createElement('div');
        overallPercentCell.className = 'daily-data-cell daily-percent-cell';
        overallPercentCell.dataset.studentId = student.id;
        overallPercentCell.dataset.category = 'overall';
        overallPercentCell.style.padding = '8px';
        overallPercentCell.style.display = 'flex';
        overallPercentCell.style.justifyContent = 'center';
        overallPercentCell.style.alignItems = 'center';
        overallPercentCell.style.borderTop = '2px solid #000';
        overallPercentCell.style.fontWeight = '700';
        overallPercentCell.style.fontSize = '11px';
        overallPercentCell.style.background = 'var(--bg-elevated)';
        overallPercentCell.style.color = 'var(--accent)';
        
        const overallText = percentages.overall !== '-' ? `${percentages.overall}%` : '-';
        overallPercentCell.textContent = overallText;
        
        body.appendChild(overallPercentCell);
        
        // Add spacer cell after each student (except the last)
        if (studentIndex < studentsToDisplay.length - 1) {
            const spacerCell = document.createElement('div');
            // Gutters between overall percentage columns
            spacerCell.style.background = 'transparent';
            spacerCell.style.borderTop = '2px solid #000';
            body.appendChild(spacerCell);
        }
    });
    
    // Add submit button row for each student (staff only)
    if (canEdit()) {
        // Empty cell for period column
        const submitPeriodCell = document.createElement('div');
        submitPeriodCell.className = 'daily-period-cell';
        submitPeriodCell.style.borderTop = '2px solid #e0e0e0';
        body.appendChild(submitPeriodCell);
        
        // Add spacer after period column (gutter, but visually transparent)
        const submitSpacer = document.createElement('div');
        submitSpacer.style.background = 'transparent';
        submitSpacer.style.borderTop = '2px solid #e0e0e0';
        body.appendChild(submitSpacer);
        
        // For each student, add submit button spanning STAR columns (S, T, A, R, I => 5 columns)
        studentsToDisplay.forEach((student, studentIndex) => {
            const submitCell = document.createElement('div');
            submitCell.className = 'daily-data-cell daily-submit-cell';
            submitCell.style.gridColumn = 'span 5'; // Span S, T, A, R, I columns
            submitCell.style.padding = '4px 6px';
            submitCell.style.display = 'flex';
            submitCell.style.justifyContent = 'center';
            submitCell.style.alignItems = 'center';
            submitCell.style.borderTop = '2px solid #e0e0e0';
            
            // Apply card color background
            const bgColor = getCardColor(student.card_color);
            if (bgColor) {
                submitCell.style.backgroundColor = bgColor;
            }
            
            const submitButton = document.createElement('button');
            submitButton.className = 'student-submit-btn';
            submitButton.textContent = `Submit ${student.name}`;
            submitButton.dataset.studentId = student.id;
            submitButton.dataset.studentName = student.name;
            submitButton.addEventListener('click', submitStudentData);
            
            submitCell.appendChild(submitButton);
            body.appendChild(submitCell);
            
            // Add spacer cell after each student (except the last)
            if (studentIndex < studentsToDisplay.length - 1) {
                const spacerCell = document.createElement('div');
                // Gutters between submit-button columns
                spacerCell.style.background = 'transparent';
                spacerCell.style.borderTop = '2px solid #e0e0e0';
                body.appendChild(spacerCell);
            }
        });
    }
    
    // Update "I" box highlights for all students and periods on initial load
    studentsToDisplay.forEach(student => {
        STANDARD_PERIODS.forEach(period => {
            updateInfoButtonHighlight(student.id, period.time);
        });
    });
}

function updateDailyPercentageRow() {
    // Get all percentage cells
    const allPercentCells = document.querySelectorAll('.daily-percent-cell:not(.period-percent-cell)');
    
    if (allPercentCells.length === 0) {
        console.log('No percentage cells found');
        return;
    }
    
    // Update each cell based on its student ID and category
    allPercentCells.forEach(cell => {
        const studentId = parseInt(cell.dataset.studentId);
        const category = cell.dataset.category;
        
        if (!studentId || !category) {
            return;
        }
        
        // Calculate percentages for this student
        const percentages = calculateStudentPercentages(studentId);
        
        // Update the cell text
        if (category === 'overall') {
            const overallText = percentages.overall !== '-' ? `${percentages.overall}%` : '-';
            cell.textContent = overallText;
        } else {
            const percentText = percentages[category] !== '-' ? `${percentages[category]}%` : '-';
            cell.textContent = percentText;
        }
    });
}

function updateInfoButtonHighlight(studentId, period) {
    // Determine if we're in Daily Entry or Period Entry view
    const isDailyEntry = document.getElementById('entry-view')?.classList.contains('active');
    const isPeriodEntry = document.getElementById('period-entry-view')?.classList.contains('active');
    
    let hasZero = false;
    
    if (isDailyEntry) {
        // Check dailyData structure: dailyData[studentId][period] with s, t, a, r
        const studentData = dailyData[studentId];
        if (studentData && studentData[period]) {
            const periodData = studentData[period];
            // Check if any STAR value is 0
            hasZero = periodData.s === 0 || periodData.t === 0 || periodData.a === 0 || periodData.r === 0;
        }
    } else if (isPeriodEntry) {
        // Check periodData structure: periodData[studentId] with safety_points, teamwork_points, etc.
        const data = periodData[studentId];
        if (data) {
            // Check if any STAR value is 0
            hasZero = data.safety_points === 0 || data.teamwork_points === 0 || 
                     data.accountability_points === 0 || data.relationships_points === 0;
        }
    }
    
    // Find the corresponding "I" button
    const infoButton = document.querySelector(`.info-btn[data-student-id="${studentId}"][data-period="${period || currentPeriod}"]`);
    
    if (infoButton) {
        if (hasZero) {
            infoButton.classList.add('has-zero');
        } else {
            infoButton.classList.remove('has-zero');
        }
    }
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
        dailyData[studentId][period] = { s: null, t: null, a: null, r: null, info: '' };
    }
    dailyData[studentId][period][category] = value;
    
    // Update percentage row in real-time
    updateDailyPercentageRow();
    
    // Update "I" box highlight based on STAR values
    if (period) {
        updateInfoButtonHighlight(studentId, period);
    }

    // Schedule an autosave of the current daily grid state
    scheduleDailyAutosave();
    
    // Auto-advance to next input, unless this was triggered by backspace
    if (!e.isBackspaceClear) {
        moveToNextInput(select);
    }
}

function handleDailyInputKeydown(e) {
    const select = e.target;
    
    // Handle backspace
    if (e.key === 'Backspace') {
        e.preventDefault();
        
        // If value is already empty, move to previous input (left)
        if (select.value === '') {
            moveToPreviousInput(select);
        } else {
            // If value is not empty, clear it and trigger change event
            select.value = '';
            const event = new Event('change', { bubbles: true });
            event.isBackspaceClear = true; // Flag to prevent auto-advance
            select.dispatchEvent(event);
            
            // Move to previous input (left) after clearing
            moveToPreviousInput(select);
        }
    }
    // Handle number keys 0, 1, 2
    else if (e.key >= '0' && e.key <= '2') {
        e.preventDefault();
        select.value = e.key;
        
        // Trigger change event
        const event = new Event('change', { bubbles: true });
        select.dispatchEvent(event);
        
        // Move to next input after setting value (works even if clicked first)
        moveToNextInput(select);
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

function updateDailyAutosaveStatus(text) {
    const statusEl = document.getElementById('save-daily-status');
    if (statusEl) {
        statusEl.textContent = text || '';
    }
}

function scheduleDailyAutosave() {
    if (!currentDate) {
        return;
    }

    // Show a lightweight "Saving..." indicator
    updateDailyAutosaveStatus('Saving...');

    if (dailyAutosaveTimer) {
        clearTimeout(dailyAutosaveTimer);
    }

    dailyAutosaveTimer = setTimeout(async () => {
        dailyAutosaveTimer = null;
        try {
            await saveDailyAllData({ silent: true, fromAutosave: true });
            updateDailyAutosaveStatus('All changes saved');
        } catch (error) {
            console.error('Auto-save error for daily data:', error);
            updateDailyAutosaveStatus('Auto-save failed');
        }
    }, 1500);
}

async function saveDailyAllData(options = {}) {
    const { silent = false, fromAutosave = false } = options;

    if (!currentDate) {
        if (!silent) {
            alert('Please select a date');
        }
        return;
    }

    if (Object.keys(dailyData).length === 0) {
        if (!silent) {
            alert('No data to save');
        }
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
                    info: data.info || '',
                    infractions: []
                });
            }
        });

        if (periods.length > 0) {
            // Get attendance status for this student
            const attendance = attendanceData[currentDate]?.[studentId] || 'present';
            
            const promise = fetch('/api/daily-records', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    student_id: parseInt(studentId),
                    date: currentDate,
                    attendance_status: attendance,
                    periods: periods,
                    frenzies: []
                })
            });
            savePromises.push(promise);
        }
    });

    if (savePromises.length === 0) {
        if (!silent) {
            showMessage('No data to save', 'info');
        }
        return;
    }

    try {
        await Promise.all(savePromises);
        if (!silent) {
            showMessage(`Saved data for ${savePromises.length} student(s)!`, 'success');
        }
        invalidateDailyLoadCache(currentDate);
        // For manual saves, reload the grid to confirm. For autosaves, avoid disrupting focus.
        if (!fromAutosave) {
            scheduleDailyDataLoad(0);
        }
        // Refresh summary if it's currently displayed
        refreshSummaryIfActive();
    } catch (error) {
        console.error('Error saving daily data:', error);
        if (!silent) {
            showMessage('Error saving data. Please try again.', 'error');
        }
        throw error;
    }
}

async function submitStudentData(e) {
    const button = e.target;
    const studentId = parseInt(button.dataset.studentId);
    const studentName = button.dataset.studentName;
    
    if (!currentDate) {
        alert('Please select a date');
        return;
    }

    // Check if there's data for this student
    if (!dailyData[studentId] || Object.keys(dailyData[studentId]).length === 0) {
        alert(`No data to submit for ${studentName}`);
        return;
    }

    // Prepare periods data for this student
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
                info: data.info || '',
                infractions: []
            });
        }
    });

    if (periods.length === 0) {
        alert(`No data to submit for ${studentName}`);
        return;
    }

    // Disable button during submission
    button.disabled = true;
    button.textContent = `Submitting...`;

    // Get attendance status
    const attendance = attendanceData[currentDate]?.[studentId] || 'present';

    const abortController = new AbortController();
    const timeoutId = setTimeout(function () {
        abortController.abort();
    }, 45000); // 45 second timeout

    try {
        const response = await fetch('/api/daily-records', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                student_id: studentId,
                date: currentDate,
                attendance_status: attendance,
                periods: periods,
                frenzies: []
            }),
            signal: abortController.signal
        });

        clearTimeout(timeoutId);

        if (response.ok) {
            // Mark this student as submitted for the current date
            if (!submittedStudents[currentDate]) {
                submittedStudents[currentDate] = new Set();
            }
            submittedStudents[currentDate].add(studentId);
            
            // Save to localStorage for persistence
            saveSubmittedStudents(submittedStudents);
            
            // Clear this student's data from dailyData
            delete dailyData[studentId];
            
            // Show success message
            showMessage(`Successfully submitted data for ${studentName}!`, 'success');
            invalidateDailyLoadCache(currentDate);
            
            // Reload the grid to show cleared data
            renderDailyGrid();
        } else {
            var err = new Error('Failed to submit data');
            err.status = response.status;
            throw err;
        }
    } catch (error) {
        clearTimeout(timeoutId);
        console.error('Error submitting student data:', error);
        var isTimeout = error.name === 'AbortError';
        var isServerBusy = error.status >= 502 && error.status <= 504;
        if (isTimeout || isServerBusy) {
            showMessage('Submission didn\'t go through (server may be busy). Please try again in a minute or two.', 'error');
        } else {
            showMessage(`Error submitting data for ${studentName}. Please try again.`, 'error');
        }
        
        // Re-enable button
        button.disabled = false;
        button.textContent = `Submit ${studentName}`;
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
            <input type="text" class="period-location" value="${location}" placeholder="e.g., English, Math" autocomplete="off">
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
            <input type="text" class="frenzy-location" value="${location}" autocomplete="off">
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
            // Refresh summary if it's currently displayed
            refreshSummaryIfActive();
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
    const grade = document.getElementById('student-grade').value;
    const cardColor = document.getElementById('student-card-color')?.value || '';
    const username = document.getElementById('student-username').value;
    const password = document.getElementById('student-password').value;
    const passwordConfirm = document.getElementById('student-password-confirm').value;
    
    // Get values from team member containers as arrays
    const caseManager = getSelectedTeamMembers('case-manager-container');
    const practitioner = getSelectedTeamMembers('practitioner-container');
    const professional = getSelectedTeamMembers('professional-container');
    const groupLeader = getSelectedTeamMembers('group-leader-container');

    // Validation
    if (!name || !name.trim()) {
        alert('Please enter student initials');
        return;
    }

    if (name.length > 4) {
        alert('Please enter only initials (maximum 4 characters). Example: Jane Doe = JD');
        return;
    }

    if (!username || !username.trim()) {
        alert('Please enter a username');
        return;
    }

    if (!password || password.length < 6) {
        alert('Password must be at least 6 characters long');
        return;
    }

    if (password !== passwordConfirm) {
        alert('Passwords do not match. Please re-enter your password.');
        return;
    }

    try {
        const response = await fetch('/api/students', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: name.trim(),
                grade: grade,
                card_color: cardColor || null,
                username: username.trim(),
                password: password,
                case_manager: caseManager,
                practitioner: practitioner,
                professional: professional,
                group_leader: groupLeader,
                paraprofessional: []
            })
        });

        const data = await response.json();

        if (response.ok) {
            document.getElementById('student-modal').style.display = 'none';
            
            // Clear all fields
            document.getElementById('student-name').value = '';
            document.getElementById('student-grade').value = '';
            document.getElementById('student-card-color').value = '';
            document.getElementById('student-username').value = '';
            document.getElementById('student-password').value = '';
            document.getElementById('student-password-confirm').value = '';
            // Clear team member containers
            document.getElementById('case-manager-container').innerHTML = '';
            document.getElementById('practitioner-container').innerHTML = '';
            document.getElementById('professional-container').innerHTML = '';
            document.getElementById('group-leader-container').innerHTML = '';
            
            await loadStudents();
            showMessage('Student and user account created successfully!', 'success');
            
            // Reload users list if in users view
            const usersView = document.getElementById('users-view');
            if (usersView && usersView.classList.contains('active')) {
                loadUsers();
            }
            
            // Reload grid if in period entry view
            if (currentPeriod) {
                renderStudentsGrid();
            }
            // Reload grid if in daily view
            const entryView = document.getElementById('entry-view');
            if (entryView && entryView.classList.contains('active')) {
                renderDailyGrid();
            }
        } else {
            throw new Error(data.error || 'Failed to create student');
        }
    } catch (error) {
        console.error('Error saving student:', error);
        showMessage(`Error: ${error.message}`, 'error');
    }
}

// Helper function to refresh summary if it's currently active
function refreshSummaryIfActive() {
    const summaryView = document.getElementById('summary-view');
    if (summaryView && summaryView.classList.contains('active')) {
        const quarterSelect = document.getElementById('quarter-select');
        if (quarterSelect && quarterSelect.value) {
            loadSummary();
        }
    }
}

async function loadSummary() {
    const studentId = document.getElementById('summary-student-select').value;
    const periodSelect = document.getElementById('summary-period-select');
    const timeframeSelect = document.getElementById('quarter-select');
    const period = periodSelect ? periodSelect.value : '';
    const timeframe = timeframeSelect ? timeframeSelect.value : '';
    const managedByMeCheckbox = document.getElementById('summary-managed-by-me-checkbox');
    const managedByMe = managedByMeCheckbox ? managedByMeCheckbox.checked : false;

    // Get quarter and school year dates from localStorage
    const quarterDates = loadQuarterDates();
    const schoolYearDates = loadSchoolYearDates();
    // Convert to MM-DD format for backend
    const quarterDatesForBackend = convertQuarterDatesForBackend(quarterDates);
    const schoolYearDatesForBackend = convertSchoolYearDatesForBackend(schoolYearDates);

    let url = `/api/summary`;
    const params = [];
    
    // If period is selected, use period and ignore timeframe
    if (period) {
        params.push(`period=${encodeURIComponent(period)}`);
    } else if (timeframe) {
        // Only use timeframe if period is not selected
        params.push(`timeframe=${timeframe}`);
        // Add school year parameter for month comparison
        if (timeframe === 'month') {
            const schoolYearSelect = document.getElementById('summary-school-year-select');
            const selectedSchoolYear = schoolYearSelect ? schoolYearSelect.value : getCurrentSchoolYear();
            if (selectedSchoolYear) {
                params.push(`school_year=${encodeURIComponent(selectedSchoolYear)}`);
            }
        }
    }
    
    if (studentId) {
        params.push(`student_id=${studentId}`);
    }
    if (managedByMe) {
        params.push(`managed_by_me=true`);
    }
    // Send quarter and school year dates to backend
    params.push(`quarter_dates=${encodeURIComponent(JSON.stringify(quarterDatesForBackend))}`);
    params.push(`school_year_dates=${encodeURIComponent(JSON.stringify(schoolYearDatesForBackend))}`);
    
    if (params.length > 0) {
        url += '?' + params.join('&');
    }

    try {
        const response = await fetch(url);
        const data = await response.json();
        
        // Store summary data globally for modal access
        window.currentSummaryData = data;
        
        // Enable Print button
        const printSummaryBtn = document.getElementById('print-summary-btn');
        if (printSummaryBtn) {
            printSummaryBtn.disabled = false;
        }
        
        // Get timeframe label
        let timeframeLabel = 'All Time';
        if (period) {
            // Period labels
            if (period === 'weekly') {
                timeframeLabel = 'Weekly';
            } else if (period === '30day') {
                timeframeLabel = '30 Day';
            } else if (period === 'current_year') {
                timeframeLabel = 'Current Year';
            } else if (period === 'quarter1') {
                timeframeLabel = 'Quarter 1';
            } else if (period === 'quarter2') {
                timeframeLabel = 'Quarter 2';
            } else if (period === 'quarter3') {
                timeframeLabel = 'Quarter 3';
            } else if (period === 'quarter4') {
                timeframeLabel = 'Quarter 4';
            } else if (period === 'all_time') {
                timeframeLabel = 'All Time';
            } else if (period === 'previous_years') {
                timeframeLabel = 'Previous Years';
            }
        } else if (timeframe === 'weekly') {
            timeframeLabel = 'Weekly';
        } else if (timeframe === '30day') {
            timeframeLabel = '30 Day';
        } else if (timeframe === '30day_to_30day') {
            timeframeLabel = '30 Day to 30 Day';
        } else if (timeframe === 'month') {
            timeframeLabel = 'Month to Month';
        } else if (timeframe === 'quarter') {
            timeframeLabel = 'Quarter to Quarter';
        } else if (timeframe === 'year') {
            timeframeLabel = 'Year to Year';
        }

        const container = document.getElementById('summary-results');
        
        // Check if comparison mode
        if (data.comparison_mode && data.periods) {
            // Display comparison table
            const periods = Object.keys(data.periods);
            if (periods.length === 0) {
                container.innerHTML = `<div class="summary-card"><h3>Summary - ${timeframeLabel}</h3><p>No data available for comparison.</p></div>`;
                return;
            }
            
            // Build comparison table
            let html = `
                <div class="summary-card">
                    <h3>Summary - ${timeframeLabel} Comparison</h3>`;
            
            // Add school year dropdown for month comparison
            if (timeframe === 'month' && data.available_school_years && data.available_school_years.length > 0) {
                const currentSchoolYear = data.selected_school_year || getCurrentSchoolYear();
                html += `
                    <div class="form-group" style="margin-top: 15px; margin-bottom: 15px;">
                        <label for="summary-school-year-select" style="display: inline-block; margin-right: 10px;">School Year:</label>
                        <select id="summary-school-year-select" style="padding: 6px 12px; border: 1px solid var(--border); border-radius: 4px; font-size: 14px;">
                `;
                data.available_school_years.forEach(sy => {
                    html += `<option value="${sy}" ${sy === currentSchoolYear ? 'selected' : ''}>${sy}</option>`;
                });
                html += `
                        </select>
                    </div>
                `;
            }
            
            // Add data points warning for 30day_to_30day comparison
            if (timeframe === '30day_to_30day' && data.periods) {
                const periodKeys = Object.keys(data.periods);
                periodKeys.forEach(periodKey => {
                    const periodData = data.periods[periodKey];
                    if (periodData.available_data_points !== undefined) {
                        const dataPoints = periodData.available_data_points;
                        const hasFull30 = periodData.has_full_30_days || false;
                        const statusColor = hasFull30 ? '#10b981' : '#f59e0b';
                        const statusText = hasFull30 ? 'Complete (30/30 data points)' : `Incomplete (${dataPoints}/30 data points)`;
                        html += `<p style="margin-bottom: 15px; padding: 10px; background: ${hasFull30 ? '#d1fae5' : '#fef3c7'}; border-left: 4px solid ${statusColor}; border-radius: 4px;">
                            <strong>${periodKey} - Data Points:</strong> <span style="color: ${statusColor}; font-weight: bold;">${statusText}</span>
                        </p>`;
                    }
                });
            }
            
            html += `
                    <div style="overflow-x: auto; margin-top: 20px; max-height: 80vh; overflow-y: auto;">
                        <table style="width: 100%; border-collapse: collapse; min-width: 600px;">
                            <thead style="position: sticky; top: 0; z-index: 20;">
                                <tr style="background: var(--bg-elevated);">
                                    <th style="padding: 12px; border: 1px solid var(--border); text-align: left; position: sticky; left: 0; top: 0; background: var(--bg-elevated); z-index: 30; opacity: 1;">Metric</th>
            `;
            
            // Add period headers
            periods.forEach(periodKey => {
                html += `<th style="padding: 12px; border: 1px solid var(--border); text-align: center; min-width: 120px; background: var(--bg-elevated);">${periodKey}</th>`;
            });
            
            html += `</tr></thead><tbody>`;
            
            // Data Points row (only for 30day and 30day_to_30day comparisons)
            if ((timeframe === '30day' || timeframe === '30day_to_30day') || (period === '30day')) {
                html += `<tr><td style="padding: 12px; border: 1px solid var(--border); font-weight: 600; background: rgb(229, 231, 235); position: sticky; left: 0; z-index: 10;">Data Points</td>`;
                periods.forEach(periodKey => {
                    const periodData = data.periods[periodKey];
                    const dataPoints = periodData.available_data_points !== undefined ? periodData.available_data_points : periodData.total_days || 0;
                    const hasFull30 = periodData.has_full_30_days !== undefined ? periodData.has_full_30_days : false;
                    const displayText = hasFull30 ? `${dataPoints} (Full 30 Days)` : `${dataPoints}`;
                    html += `<td style="padding: 12px; border: 1px solid var(--border); text-align: center; font-weight: 600; background: rgba(229, 231, 235, 0.5);">${displayText}</td>`;
                });
                html += `</tr>`;
            }
            
            // Total Days
            html += `<tr><td style="padding: 12px; border: 1px solid var(--border); font-weight: 600; background: rgb(229, 231, 235); position: sticky; left: 0; z-index: 10; opacity: 1;">Total Days</td>`;
            periods.forEach(periodKey => {
                const periodData = data.periods[periodKey];
                html += `<td style="padding: 12px; border: 1px solid var(--border); text-align: center;">${periodData.total_days}</td>`;
            });
            html += `</tr>`;
            
            // Infractions
            html += `<tr><td style="padding: 12px; border: 1px solid var(--border); font-weight: 600; background: rgb(229, 231, 235); position: sticky; left: 0; z-index: 10; opacity: 1;">Total Infractions</td>`;
            periods.forEach((periodKey, periodIndex) => {
                const periodData = data.periods[periodKey];
                const totalInfractions = Object.values(periodData.infractions || {}).reduce((sum, count) => sum + count, 0);
                const hasInfractions = totalInfractions > 0;
                html += `<td style="padding: 12px; border: 1px solid var(--border); text-align: center;">
                    <div style="display: flex; align-items: center; justify-content: center; gap: 8px;">
                        <span>${totalInfractions}</span>
                        ${hasInfractions ? `<button onclick="showInfractionsSummary(${periodIndex}, '${period.replace(/'/g, "\\'")}')" class="btn-secondary" style="padding: 4px 8px; font-size: 12px; cursor: pointer;">View Details</button>` : ''}
                    </div>
                </td>`;
            });
            html += `</tr>`;
            
            // Reminders
            html += `<tr><td style="padding: 12px; border: 1px solid var(--border); font-weight: 600; background: rgb(229, 231, 235); position: sticky; left: 0; z-index: 10; opacity: 1;">Reminders</td>`;
            periods.forEach(periodKey => {
                const periodData = data.periods[periodKey];
                html += `<td style="padding: 12px; border: 1px solid var(--border); text-align: center;">${periodData.additional_info.total_reminders || 0}</td>`;
            });
            html += `</tr>`;
            
            // Resets
            html += `<tr><td style="padding: 12px; border: 1px solid var(--border); font-weight: 600; background: rgb(229, 231, 235); position: sticky; left: 0; z-index: 10; opacity: 1;">Resets</td>`;
            periods.forEach(periodKey => {
                const periodData = data.periods[periodKey];
                html += `<td style="padding: 12px; border: 1px solid var(--border); text-align: center;">${periodData.additional_info.total_resets || 0}</td>`;
            });
            html += `</tr>`;
            
            html += `</tbody></table></div>`;
            html += `<div style="margin-top: 10px;"><button type="button" class="btn-secondary btn-graph" style="padding: 4px 10px; font-size: 12px;" onclick="showSectionGraph('summary_comparison_main', 'summary')">Graph Main Metrics</button></div>`;
            
            // STAR Percentages section - Separate Table
            html += `
                <h4 style="margin-top: 30px; margin-bottom: 15px; font-size: 18px; font-weight: 700; color: var(--text-primary);">STAR Percentages <button type="button" class="btn-secondary btn-graph" style="margin-left: 10px; padding: 4px 10px; font-size: 12px; vertical-align: middle;" onclick="showSectionGraph('summary_comparison_star', 'summary')">Graph</button></h4>
                <div style="overflow-x: auto; margin-top: 10px; max-height: 80vh; overflow-y: auto;">
                    <table style="width: 100%; border-collapse: collapse; min-width: 600px;">
                        <thead style="position: sticky; top: 0; z-index: 20;">
                            <tr style="background: var(--bg-elevated);">
                                <th style="padding: 12px; border: 1px solid var(--border); text-align: left; position: sticky; left: 0; top: 0; background: var(--bg-elevated); z-index: 30; opacity: 1;">Metric</th>
            `;
            
            // Add period headers
            periods.forEach(periodKey => {
                html += `<th style="padding: 12px; border: 1px solid var(--border); text-align: center; min-width: 120px; background: var(--bg-elevated);">${periodKey}</th>`;
            });
            
            html += `</tr></thead><tbody>`;
            
            // Safety
            html += `<tr><td style="padding: 12px; border: 1px solid var(--border); background: rgb(254, 226, 226); position: sticky; left: 0; z-index: 10; opacity: 1;">Safety (S)</td>`;
            periods.forEach(periodKey => {
                const periodData = data.periods[periodKey];
                html += `<td style="padding: 12px; border: 1px solid var(--border); text-align: center; font-weight: 600; background: rgba(254, 226, 226, 0.2);">${periodData.percentages.safety}%</td>`;
            });
            html += `</tr>`;
            
            // Teamwork
            html += `<tr><td style="padding: 12px; border: 1px solid var(--border); background: rgb(219, 234, 254); position: sticky; left: 0; z-index: 10; opacity: 1;">Teamwork (T)</td>`;
            periods.forEach(periodKey => {
                const periodData = data.periods[periodKey];
                html += `<td style="padding: 12px; border: 1px solid var(--border); text-align: center; font-weight: 600; background: rgba(219, 234, 254, 0.2);">${periodData.percentages.teamwork}%</td>`;
            });
            html += `</tr>`;
            
            // Accountability
            html += `<tr><td style="padding: 12px; border: 1px solid var(--border); background: rgb(209, 250, 229); position: sticky; left: 0; z-index: 10; opacity: 1;">Accountability (A)</td>`;
            periods.forEach(periodKey => {
                const periodData = data.periods[periodKey];
                html += `<td style="padding: 12px; border: 1px solid var(--border); text-align: center; font-weight: 600; background: rgba(209, 250, 229, 0.2);">${periodData.percentages.accountability}%</td>`;
            });
            html += `</tr>`;
            
            // Relationships
            html += `<tr><td style="padding: 12px; border: 1px solid var(--border); background: rgb(254, 243, 199); position: sticky; left: 0; z-index: 10; opacity: 1;">Relationships (R)</td>`;
            periods.forEach(periodKey => {
                const periodData = data.periods[periodKey];
                html += `<td style="padding: 12px; border: 1px solid var(--border); text-align: center; font-weight: 600; background: rgba(254, 243, 199, 0.2);">${periodData.percentages.relationships}%</td>`;
            });
            html += `</tr>`;
            
            // Overall
            html += `<tr><td style="padding: 12px; border: 1px solid var(--border); font-weight: 700; background: var(--bg-elevated); position: sticky; left: 0; z-index: 10; opacity: 1;">Overall Average</td>`;
            periods.forEach(periodKey => {
                const periodData = data.periods[periodKey];
                html += `<td style="padding: 12px; border: 1px solid var(--border); text-align: center; font-weight: 700; font-size: 18px; background: var(--bg-elevated); color: var(--accent);">${periodData.percentages.overall}%</td>`;
            });
            html += `</tr>`;
            
            html += `</tbody></table></div>`;
            
            // Day of Week Statistics section - Separate Table
            html += `
                <h4 style="margin-top: 30px; margin-bottom: 15px; font-size: 18px; font-weight: 700; color: var(--text-primary);">Day of Week Statistics <button type="button" class="btn-secondary btn-graph" style="margin-left: 10px; padding: 4px 10px; font-size: 12px; vertical-align: middle;" onclick="showSectionGraph('summary_comparison_day', 'summary')">Graph</button></h4>
                <div class="form-group" style="margin-bottom: 10px;">
                    <label for="summary-day-search" style="display: block; margin-bottom: 8px; font-weight: 600;">Search Day of Week:</label>
                    <div class="table-column-search-wrapper" style="width: 100%; max-width: 400px; position: relative;">
                        <input type="text" id="summary-day-search" placeholder="Type to search (e.g., Mon, Tue)" style="width: 100%; padding: 8px; border: 1px solid var(--border); border-radius: 4px;">
                        <div class="table-column-search-dropdown"></div>
                    </div>
                </div>
                <div style="overflow-x: auto; margin-top: 10px; max-height: 80vh; overflow-y: auto;">
                    <table id="summary-day-of-week-table" style="width: 100%; border-collapse: collapse; min-width: 600px;">
                        <thead style="position: sticky; top: 0; z-index: 20;">
                            <tr style="background: var(--bg-elevated);">
                                <th style="padding: 12px; border: 1px solid var(--border); text-align: left; position: sticky; left: 0; top: 0; background: var(--bg-elevated); z-index: 30; opacity: 1; rowspan="2">Metric</th>
            `;
            
            const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
            
            // First header row with timeframe names
            periods.forEach((periodKey, periodIndex) => {
                html += `<th class="summary-timeframe-header" data-period-index="${periodIndex}" style="padding: 12px; border: 1px solid var(--border); text-align: center; background: var(--bg-elevated); font-weight: 700;" colspan="${weekdays.length}">${periodKey}</th>`;
            });
            
            html += `</tr><tr style="background: var(--bg-elevated);">`;
            
            // Second header row with day names
            periods.forEach((periodKey, periodIndex) => {
                weekdays.forEach((day, dayIndex) => {
                    html += `<th class="summary-day-header" data-period-index="${periodIndex}" data-day="${day}" data-column-index="${dayIndex}" style="padding: 12px; border: 1px solid var(--border); text-align: center; min-width: 120px; background: var(--bg-elevated);">${day}</th>`;
                });
            });
            
            html += `</tr></thead><tbody>`;
            
            // Overall % row
            html += `<tr><td style="padding: 12px; border: 1px solid var(--border); font-weight: 600; background: rgb(229, 231, 235); position: sticky; left: 0; z-index: 10; opacity: 1;">Overall %</td>`;
            periods.forEach((periodKey, periodIndex) => {
                weekdays.forEach((day, dayIndex) => {
                    const periodData = data.periods[periodKey];
                    const dayData = periodData.by_day_of_week && periodData.by_day_of_week[day] ? periodData.by_day_of_week[day] : null;
                    const overallPercent = dayData ? dayData.percentages.overall : 0;
                    html += `<td class="summary-day-data" data-period-index="${periodIndex}" data-day="${day}" data-column-index="${dayIndex}" style="padding: 12px; border: 1px solid var(--border); text-align: center; font-weight: 600; background: rgba(229, 231, 235, 0.2);">${overallPercent}%</td>`;
                });
            });
            html += `</tr>`;
            
            // Total Days row
            html += `<tr><td style="padding: 12px; border: 1px solid var(--border); font-weight: 600; background: rgb(229, 231, 235); position: sticky; left: 0; z-index: 10; opacity: 1;">Total Days</td>`;
            periods.forEach((periodKey, periodIndex) => {
                weekdays.forEach((day, dayIndex) => {
                    const periodData = data.periods[periodKey];
                    const dayData = periodData.by_day_of_week && periodData.by_day_of_week[day] ? periodData.by_day_of_week[day] : null;
                    const totalDays = dayData ? dayData.total_days : 0;
                    html += `<td class="summary-day-data" data-period-index="${periodIndex}" data-day="${day}" data-column-index="${dayIndex}" style="padding: 12px; border: 1px solid var(--border); text-align: center; background: rgba(229, 231, 235, 0.2);">${totalDays}</td>`;
                });
            });
            html += `</tr>`;
            
            // Total Infractions row
            html += `<tr><td style="padding: 12px; border: 1px solid var(--border); font-weight: 600; background: rgb(229, 231, 235); position: sticky; left: 0; z-index: 10; opacity: 1;">Total Infractions</td>`;
            periods.forEach((periodKey, periodIndex) => {
                weekdays.forEach((day, dayIndex) => {
                    const periodData = data.periods[periodKey];
                    const dayData = periodData.by_day_of_week && periodData.by_day_of_week[day] ? periodData.by_day_of_week[day] : null;
                    const totalInfractions = dayData ? dayData.total_infractions : 0;
                    html += `<td class="summary-day-data" data-period-index="${periodIndex}" data-day="${day}" data-column-index="${dayIndex}" style="padding: 12px; border: 1px solid var(--border); text-align: center; background: rgba(229, 231, 235, 0.2);">${totalInfractions}</td>`;
                });
            });
            html += `</tr>`;
            
            html += `</tbody></table></div>`;
            
            // Class Statistics section - Separate Table
            const allClasses = new Set();
            periods.forEach(periodKey => {
                const periodData = data.periods[periodKey];
                if (periodData.by_class) {
                    Object.keys(periodData.by_class).forEach(className => {
                        allClasses.add(className);
                    });
                }
            });
            const sortedClasses = Array.from(allClasses).sort();
            
            if (sortedClasses.length > 0) {
                html += `
                    <h4 style="margin-top: 30px; margin-bottom: 15px; font-size: 18px; font-weight: 700; color: var(--text-primary);">Class Statistics <button type="button" class="btn-secondary btn-graph" style="margin-left: 10px; padding: 4px 10px; font-size: 12px; vertical-align: middle;" onclick="showSectionGraph('summary_comparison_class', 'summary')">Graph</button></h4>
                    <div class="form-group" style="margin-bottom: 10px;">
                        <label for="summary-class-search" style="display: block; margin-bottom: 8px; font-weight: 600;">Search Class:</label>
                        <div class="table-column-search-wrapper" style="width: 100%; max-width: 400px; position: relative;">
                            <input type="text" id="summary-class-search" placeholder="Type to search class name" style="width: 100%; padding: 8px; border: 1px solid var(--border); border-radius: 4px;">
                            <div class="table-column-search-dropdown"></div>
                        </div>
                    </div>
                    <div style="overflow-x: auto; margin-top: 10px; max-height: 80vh; overflow-y: auto;">
                        <table id="summary-class-table" style="width: 100%; border-collapse: collapse; min-width: 600px;">
                            <thead style="position: sticky; top: 0; z-index: 20;">
                                <tr style="background: var(--bg-elevated);">
                                    <th style="padding: 12px; border: 1px solid var(--border); text-align: left; position: sticky; left: 0; top: 0; background: var(--bg-elevated); z-index: 30; opacity: 1; rowspan="2">Metric</th>
                `;
                
                // First header row with timeframe names
                periods.forEach((periodKey, periodIndex) => {
                    html += `<th class="summary-timeframe-header" data-period-index="${periodIndex}" style="padding: 12px; border: 1px solid var(--border); text-align: center; background: var(--bg-elevated); font-weight: 700;" colspan="${sortedClasses.length}">${periodKey}</th>`;
                });
                
                html += `</tr><tr style="background: var(--bg-elevated);">`;
                
                // Second header row with class names
                periods.forEach((periodKey, periodIndex) => {
                    sortedClasses.forEach((className, classIndex) => {
                        html += `<th class="summary-class-header" data-period-index="${periodIndex}" data-class="${className}" data-column-index="${classIndex}" style="padding: 12px; border: 1px solid var(--border); text-align: center; min-width: 120px; background: var(--bg-elevated);">${className}</th>`;
                    });
                });
                
                html += `</tr></thead><tbody>`;
                
                // Overall % row
                html += `<tr><td style="padding: 12px; border: 1px solid var(--border); font-weight: 600; background: rgb(229, 231, 235); position: sticky; left: 0; z-index: 10; opacity: 1;">Overall %</td>`;
                periods.forEach((periodKey, periodIndex) => {
                    sortedClasses.forEach((className, classIndex) => {
                        const periodData = data.periods[periodKey];
                        const classData = periodData.by_class && periodData.by_class[className] ? periodData.by_class[className] : null;
                        const overallPercent = classData ? classData.percentages.overall : 0;
                        html += `<td class="summary-class-data" data-period-index="${periodIndex}" data-class="${className}" data-column-index="${classIndex}" style="padding: 12px; border: 1px solid var(--border); text-align: center; font-weight: 600; background: rgba(229, 231, 235, 0.2);">${overallPercent}%</td>`;
                    });
                });
                html += `</tr>`;
                
                // Total Days row
                html += `<tr><td style="padding: 12px; border: 1px solid var(--border); font-weight: 600; background: rgb(229, 231, 235); position: sticky; left: 0; z-index: 10; opacity: 1;">Total Days</td>`;
                periods.forEach((periodKey, periodIndex) => {
                    sortedClasses.forEach((className, classIndex) => {
                        const periodData = data.periods[periodKey];
                        const classData = periodData.by_class && periodData.by_class[className] ? periodData.by_class[className] : null;
                        const totalDays = classData ? classData.total_days : 0;
                        html += `<td class="summary-class-data" data-period-index="${periodIndex}" data-class="${className}" data-column-index="${classIndex}" style="padding: 12px; border: 1px solid var(--border); text-align: center; background: rgba(229, 231, 235, 0.2);">${totalDays}</td>`;
                    });
                });
                html += `</tr>`;
                
                // Total Infractions row
                html += `<tr><td style="padding: 12px; border: 1px solid var(--border); font-weight: 600; background: rgb(229, 231, 235); position: sticky; left: 0; z-index: 10; opacity: 1;">Total Infractions</td>`;
                periods.forEach((periodKey, periodIndex) => {
                    sortedClasses.forEach((className, classIndex) => {
                        const periodData = data.periods[periodKey];
                        const classData = periodData.by_class && periodData.by_class[className] ? periodData.by_class[className] : null;
                        const totalInfractions = classData ? classData.total_infractions : 0;
                        html += `<td class="summary-class-data" data-period-index="${periodIndex}" data-class="${className}" data-column-index="${classIndex}" style="padding: 12px; border: 1px solid var(--border); text-align: center; background: rgba(229, 231, 235, 0.2);">${totalInfractions}</td>`;
                    });
                });
                html += `</tr>`;
                
                html += `</tbody></table></div>`;
            }
            
            html += `</div>`;
            container.innerHTML = html;
            
            // Initialize Day of Week searchable dropdown
            const summaryDaySearchInput = document.getElementById('summary-day-search');
            if (summaryDaySearchInput) {
                const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
                setupTableColumnSearch(summaryDaySearchInput, weekdays, '#summary-day-of-week-table', (selectedValue) => {
                    const table = document.querySelector('#summary-day-of-week-table');
                    if (!table) return;
                    
                    // Get all day header cells (second row) - process in order
                    const dayHeaders = Array.from(table.querySelectorAll('thead tr:last-child th.summary-day-header'));
                    const dataRows = table.querySelectorAll('tbody tr');
                    
                    // Track visible columns per period
                    const visibleCountsByPeriod = {};
                    
                    dayHeaders.forEach((headerCell) => {
                        const periodIndex = parseInt(headerCell.getAttribute('data-period-index'));
                        const day = headerCell.getAttribute('data-day');
                        const columnIndex = parseInt(headerCell.getAttribute('data-column-index'));
                        const headerText = day || headerCell.textContent.trim();
                        const shouldShow = !selectedValue || headerText.toLowerCase().includes(selectedValue.toLowerCase());
                        
                        if (!visibleCountsByPeriod[periodIndex]) {
                            visibleCountsByPeriod[periodIndex] = 0;
                        }
                        if (shouldShow) {
                            visibleCountsByPeriod[periodIndex]++;
                        }
                        
                        headerCell.style.display = shouldShow ? '' : 'none';
                        
                        // When filtering is active, shift all visible headers to the right by 1 column
                        // This fixes alignment issue where headers appear 1 column too far left
                        if (selectedValue && shouldShow) {
                            // Approximate column width based on min-width (120px) + border/padding
                            // Shift right by 1 column width to correct alignment
                            headerCell.style.position = 'relative';
                            headerCell.style.left = '400px';
                        } else {
                            // Reset positioning when no filter is active
                            headerCell.style.position = '';
                            headerCell.style.left = '';
                        }
                        
                        // Hide/show corresponding data cells using data attributes for precise matching
                        dataRows.forEach(row => {
                            const matchingCells = row.querySelectorAll(`td.summary-day-data[data-period-index="${periodIndex}"][data-day="${day}"][data-column-index="${columnIndex}"]`);
                            matchingCells.forEach(cell => {
                                cell.style.display = shouldShow ? '' : 'none';
                            });
                        });
                    });
                    
                    // Update timeframe header colspans
                    const timeframeHeaders = table.querySelectorAll('thead tr:first-child th.summary-timeframe-header');
                    timeframeHeaders.forEach((timeframeHeader) => {
                        const periodIndex = parseInt(timeframeHeader.getAttribute('data-period-index'));
                        const visibleCount = visibleCountsByPeriod[periodIndex] || 0;
                        if (visibleCount > 0) {
                            timeframeHeader.setAttribute('colspan', visibleCount);
                            timeframeHeader.style.display = '';
                        } else {
                            timeframeHeader.style.display = 'none';
                        }
                    });
                });
            }
            
            // Initialize Class searchable dropdown
            const summaryClassSearchInput = document.getElementById('summary-class-search');
            if (summaryClassSearchInput && sortedClasses.length > 0) {
                setupTableColumnSearch(summaryClassSearchInput, sortedClasses, '#summary-class-table', (selectedValue) => {
                    const table = document.querySelector('#summary-class-table');
                    if (!table) return;
                    
                    // Get all class header cells (second row)
                    const classHeaders = table.querySelectorAll('thead tr:last-child th.summary-class-header');
                    const dataRows = table.querySelectorAll('tbody tr');
                    
                    // Track visible columns per period
                    const visibleCountsByPeriod = {};
                    
                    classHeaders.forEach((headerCell) => {
                        const periodIndex = parseInt(headerCell.getAttribute('data-period-index'));
                        const className = headerCell.getAttribute('data-class');
                        const columnIndex = parseInt(headerCell.getAttribute('data-column-index'));
                        const headerText = className || headerCell.textContent.trim();
                        const shouldShow = !selectedValue || headerText.toLowerCase().includes(selectedValue.toLowerCase());
                        
                        headerCell.style.display = shouldShow ? '' : 'none';
                        
                        // When filtering is active, shift all visible headers to the right by 1 column
                        if (selectedValue && shouldShow) {
                            headerCell.style.position = 'relative';
                            headerCell.style.left = '400px';
                        } else {
                            headerCell.style.position = '';
                            headerCell.style.left = '';
                        }
                        
                        if (!visibleCountsByPeriod[periodIndex]) {
                            visibleCountsByPeriod[periodIndex] = 0;
                        }
                        if (shouldShow) {
                            visibleCountsByPeriod[periodIndex]++;
                        }
                        
                        // Hide/show corresponding data cells using data attributes for precise matching
                        dataRows.forEach(row => {
                            const matchingCells = row.querySelectorAll(`td.summary-class-data[data-period-index="${periodIndex}"][data-class="${className}"][data-column-index="${columnIndex}"]`);
                            matchingCells.forEach(cell => {
                                cell.style.display = shouldShow ? '' : 'none';
                            });
                        });
                    });
                    
                    // Update timeframe header colspans
                    const timeframeHeaders = table.querySelectorAll('thead tr:first-child th.summary-timeframe-header');
                    timeframeHeaders.forEach((timeframeHeader) => {
                        const periodIndex = parseInt(timeframeHeader.getAttribute('data-period-index'));
                        const visibleCount = visibleCountsByPeriod[periodIndex] || 0;
                        if (visibleCount > 0) {
                            timeframeHeader.setAttribute('colspan', visibleCount);
                            timeframeHeader.style.display = '';
                        } else {
                            timeframeHeader.style.display = 'none';
                        }
                    });
                });
            }
            
            // Add event listener for school year dropdown (month comparison only)
            if (timeframe === 'month') {
                const schoolYearSelect = document.getElementById('summary-school-year-select');
                if (schoolYearSelect) {
                    schoolYearSelect.addEventListener('change', () => {
                        loadSummary();
                    });
                }
            }
        } else {
            // Single summary mode (30day, alltime)
            const numPeriods = data.totals && data.totals.possible ? data.totals.possible / 4 : 0;
            const maxPerCategory = numPeriods * 2;
            
            let safetyPercent = 0, teamworkPercent = 0, accountabilityPercent = 0, relationshipsPercent = 0, overallPercent = 0;
            
            if (maxPerCategory > 0) {
                safetyPercent = ((data.totals.safety / maxPerCategory) * 100).toFixed(0);
                teamworkPercent = ((data.totals.teamwork / maxPerCategory) * 100).toFixed(0);
                accountabilityPercent = ((data.totals.accountability / maxPerCategory) * 100).toFixed(0);
                relationshipsPercent = ((data.totals.relationships / maxPerCategory) * 100).toFixed(0);
                
                // Overall is average of all four categories
                overallPercent = ((parseFloat(safetyPercent) + parseFloat(teamworkPercent) + parseFloat(accountabilityPercent) + parseFloat(relationshipsPercent)) / 4).toFixed(0);
            }

            // Add data points info for 30day period
            let dataPointsInfo = '';
            if ((period === '30day' || timeframe === '30day') && data.available_data_points !== undefined) {
                const dataPoints = data.available_data_points;
                const hasFull30 = data.has_full_30_days || false;
                const statusColor = hasFull30 ? '#10b981' : '#f59e0b';
                const statusText = hasFull30 ? 'Complete (30/30 data points)' : `Incomplete (${dataPoints}/30 data points)`;
                dataPointsInfo = `<p style="margin-bottom: 15px; padding: 10px; background: ${hasFull30 ? '#d1fae5' : '#fef3c7'}; border-left: 4px solid ${statusColor}; border-radius: 4px;">
                    <strong>Data Points:</strong> <span style="color: ${statusColor}; font-weight: bold;">${statusText}</span>
                </p>`;
            }

            const starbucksTotal = typeof data.starbucks_total === 'number'
                ? data.starbucks_total
                : (data.starbucks_total ? Number(data.starbucks_total) || 0 : 0);

            container.innerHTML = `
                <div class="summary-card">
                    <h3>Summary - ${timeframeLabel}</h3>

                    <div style="display: flex; flex-wrap: wrap; gap: 12px; margin: 12px 0 18px 0;">
                        <div style="flex: 0 0 auto; min-width: 140px; padding: 10px 14px; border-radius: 8px; border: 1px solid var(--border); background: var(--bg-elevated);">
                            <div style="font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; margin-bottom: 4px;">Total Days</div>
                            <div style="font-size: 20px; font-weight: 600;">${data.total_days}</div>
                        </div>
                        <div style="flex: 0 0 auto; min-width: 160px; padding: 10px 14px; border-radius: 8px; border: 1px solid var(--border); background: #fef3c7;">
                            <div style="font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; color: #92400e; margin-bottom: 4px;">Starbucks Received</div>
                            <div style="font-size: 20px; font-weight: 600; color: #92400e;">${starbucksTotal}</div>
                        </div>
                    </div>

                    ${dataPointsInfo}
                    
                    <h4 style="margin-bottom: 15px;">STAR Averages <button type="button" class="btn-secondary btn-graph" style="margin-left: 10px; padding: 4px 10px; font-size: 12px; vertical-align: middle;" onclick="showSectionGraph('summary_single_star', 'summary')">Graph</button></h4>
                    <table class="star-averages-table" style="width: 100%; border-collapse: collapse; margin-bottom: 30px;">
                        <thead>
                            <tr>
                                <th style="padding: 12px; background: #FEE2E2; color: #B91C1C; border: 1px solid var(--border); text-align: center;">Safety (S)</th>
                                <th style="padding: 12px; background: #E0E7FF; color: #1E3A8A; border: 1px solid var(--border); text-align: center;">Teamwork (T)</th>
                                <th style="padding: 12px; background: #D1FAE5; color: #047857; border: 1px solid var(--border); text-align: center;">Accountability (A)</th>
                                <th style="padding: 12px; background: #FEF3C7; color: #B45309; border: 1px solid var(--border); text-align: center;">Relationships (R)</th>
                                <th style="padding: 12px; background: var(--bg-elevated); color: var(--text-primary); border: 1px solid var(--border); text-align: center; font-weight: 700;">Overall Average</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td style="padding: 15px; border: 1px solid var(--border); text-align: center; font-size: 24px; font-weight: 600; background: rgba(254, 226, 226, 0.2);">${safetyPercent}%</td>
                                <td style="padding: 15px; border: 1px solid var(--border); text-align: center; font-size: 24px; font-weight: 600; background: rgba(219, 234, 254, 0.2);">${teamworkPercent}%</td>
                                <td style="padding: 15px; border: 1px solid var(--border); text-align: center; font-size: 24px; font-weight: 600; background: rgba(209, 250, 229, 0.2);">${accountabilityPercent}%</td>
                                <td style="padding: 15px; border: 1px solid var(--border); text-align: center; font-size: 24px; font-weight: 600; background: rgba(254, 243, 199, 0.2);">${relationshipsPercent}%</td>
                                <td style="padding: 15px; border: 1px solid var(--border); text-align: center; font-size: 28px; font-weight: 700; background: var(--bg-elevated); color: var(--accent);">${overallPercent}%</td>
                            </tr>
                        </tbody>
                    </table>
                    
                    <h4 style="margin-top: 20px;">Infractions</h4>
                    <table style="width: 100%; border-collapse: collapse;">
                        <thead>
                            <tr style="background: var(--bg-elevated);">
                                <th style="padding: 12px; border: 1px solid var(--border); text-align: left;">Category</th>
                                <th style="padding: 12px; border: 1px solid var(--border); text-align: left;">Details</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${data.additional_info ? `
                                <!-- Infractions -->
                                <tr>
                                    <td style="padding: 12px; border: 1px solid var(--border); font-weight: 600; background: rgba(229, 231, 235, 0.3);">Infractions</td>
                                    <td style="padding: 12px; border: 1px solid var(--border);">
                                        ${Object.keys(data.additional_info.infractions || {}).length > 0 ? 
                                            `<div style="display: flex; align-items: flex-start; gap: 10px; flex-wrap: wrap;">
                                                <div style="flex: 1;">
                                                    ${Object.entries(data.additional_info.infractions).map(([type, count]) => 
                                                        `<div style="margin: 4px 0;">${type.replace(/</g, '&lt;').replace(/>/g, '&gt;')}: ${count}</div>`
                                                    ).join('')}
                                                </div>
                                                <button onclick="showInfractionsSummarySingle()" class="btn-secondary" style="padding: 6px 12px; font-size: 13px; cursor: pointer; white-space: nowrap;">View Sorted Summary</button>
                                            </div>`
                                            : '<span style="color: #999; font-style: italic;">None</span>'
                                        }
                                    </td>
                                </tr>
                                
                                <!-- Reminders -->
                                <tr>
                                    <td style="padding: 12px; border: 1px solid var(--border); font-weight: 600; background: rgba(229, 231, 235, 0.3);">Reminders</td>
                                    <td style="padding: 12px; border: 1px solid var(--border);">
                                        Total: ${data.additional_info.total_reminders || 0}
                                    </td>
                                </tr>
                                
                                <!-- Resets -->
                                <tr>
                                    <td style="padding: 12px; border: 1px solid var(--border); font-weight: 600; background: rgba(229, 231, 235, 0.3);">Resets</td>
                                    <td style="padding: 12px; border: 1px solid var(--border);">
                                        Total: ${data.additional_info.total_resets || 0}
                                    </td>
                                </tr>
                                
                            ` : `
                                <tr>
                                    <td style="padding: 12px; border: 1px solid var(--border); font-weight: 600; background: rgba(229, 231, 235, 0.3);">Infractions</td>
                                    <td style="padding: 12px; border: 1px solid var(--border);"><span style="color: #999; font-style: italic;">None</span></td>
                                </tr>
                                <tr>
                                    <td style="padding: 12px; border: 1px solid var(--border); font-weight: 600; background: rgba(229, 231, 235, 0.3);">Reminders</td>
                                    <td style="padding: 12px; border: 1px solid var(--border);">Total: 0</td>
                                </tr>
                                <tr>
                                    <td style="padding: 12px; border: 1px solid var(--border); font-weight: 600; background: rgba(229, 231, 235, 0.3);">Resets</td>
                                    <td style="padding: 12px; border: 1px solid var(--border);">Total: 0</td>
                                </tr>
                            `}
                        </tbody>
                    </table>
                    
                    ${data.by_day_of_week ? `
                    <h4 style="margin-top: 30px;">Day of Week Statistics <button type="button" class="btn-secondary btn-graph" style="margin-left: 10px; padding: 4px 10px; font-size: 12px; vertical-align: middle;" onclick="showSectionGraph('summary_single_day', 'summary')">Graph</button></h4>
                    <div style="overflow-x: auto; margin-top: 15px;">
                        <table style="width: 100%; border-collapse: collapse; min-width: 800px;">
                            <thead>
                                <tr style="background: var(--bg-elevated);">
                                    <th style="padding: 12px; border: 1px solid var(--border); text-align: left; position: sticky; left: 0; top: 0; background: var(--bg-elevated); z-index: 30; opacity: 1;">Metric</th>
                                    <th style="padding: 12px; border: 1px solid var(--border); text-align: center;">Monday</th>
                                    <th style="padding: 12px; border: 1px solid var(--border); text-align: center;">Tuesday</th>
                                    <th style="padding: 12px; border: 1px solid var(--border); text-align: center;">Wednesday</th>
                                    <th style="padding: 12px; border: 1px solid var(--border); text-align: center;">Thursday</th>
                                    <th style="padding: 12px; border: 1px solid var(--border); text-align: center;">Friday</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${(() => {
                                    const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
                                    const getDayData = (day) => data.by_day_of_week[day] || {
                                        total_days: 0,
                                        percentages: { safety: 0, teamwork: 0, accountability: 0, relationships: 0, overall: 0 },
                                        total_infractions: 0,
                                        total_reminders: 0,
                                        total_resets: 0
                                    };
                                    
                                    return `
                                        <tr>
                                            <td style="padding: 12px; border: 1px solid var(--border); font-weight: 600; background: rgb(229, 231, 235); position: sticky; left: 0; z-index: 10; opacity: 1;">Total Days</td>
                                            ${weekdays.map(day => `<td style="padding: 12px; border: 1px solid var(--border); text-align: center;">${getDayData(day).total_days || 0}</td>`).join('')}
                                        </tr>
                                        <tr>
                                            <td style="padding: 12px; border: 1px solid var(--border); font-weight: 600; background: rgb(254, 226, 226); position: sticky; left: 0; z-index: 10; opacity: 1;">Safety %</td>
                                            ${weekdays.map(day => `<td style="padding: 12px; border: 1px solid var(--border); text-align: center; background: rgba(254, 226, 226, 0.2);">${getDayData(day).percentages.safety || 0}%</td>`).join('')}
                                        </tr>
                                        <tr>
                                            <td style="padding: 12px; border: 1px solid var(--border); font-weight: 600; background: rgb(219, 234, 254); position: sticky; left: 0; z-index: 10; opacity: 1;">Teamwork %</td>
                                            ${weekdays.map(day => `<td style="padding: 12px; border: 1px solid var(--border); text-align: center; background: rgba(219, 234, 254, 0.2);">${getDayData(day).percentages.teamwork || 0}%</td>`).join('')}
                                        </tr>
                                        <tr>
                                            <td style="padding: 12px; border: 1px solid var(--border); font-weight: 600; background: rgb(209, 250, 229); position: sticky; left: 0; z-index: 10; opacity: 1;">Accountability %</td>
                                            ${weekdays.map(day => `<td style="padding: 12px; border: 1px solid var(--border); text-align: center; background: rgba(209, 250, 229, 0.2);">${getDayData(day).percentages.accountability || 0}%</td>`).join('')}
                                        </tr>
                                        <tr>
                                            <td style="padding: 12px; border: 1px solid var(--border); font-weight: 600; background: rgb(254, 243, 199); position: sticky; left: 0; z-index: 10; opacity: 1;">Relationships %</td>
                                            ${weekdays.map(day => `<td style="padding: 12px; border: 1px solid var(--border); text-align: center; background: rgba(254, 243, 199, 0.2);">${getDayData(day).percentages.relationships || 0}%</td>`).join('')}
                                        </tr>
                                        <tr>
                                            <td style="padding: 12px; border: 1px solid var(--border); font-weight: 600; background: var(--bg-elevated); position: sticky; left: 0; z-index: 10; opacity: 1;">Overall %</td>
                                            ${weekdays.map(day => `<td style="padding: 12px; border: 1px solid var(--border); text-align: center; font-weight: 600; background: var(--bg-elevated);">${getDayData(day).percentages.overall || 0}%</td>`).join('')}
                                        </tr>
                                        <tr>
                                            <td style="padding: 12px; border: 1px solid var(--border); font-weight: 600; background: rgb(229, 231, 235); position: sticky; left: 0; z-index: 10; opacity: 1;">Infractions</td>
                                            ${weekdays.map(day => `<td style="padding: 12px; border: 1px solid var(--border); text-align: center;">${getDayData(day).total_infractions || 0}</td>`).join('')}
                                        </tr>
                                        <tr>
                                            <td style="padding: 12px; border: 1px solid var(--border); font-weight: 600; background: rgb(229, 231, 235); position: sticky; left: 0; z-index: 10; opacity: 1;">Reminders</td>
                                            ${weekdays.map(day => `<td style="padding: 12px; border: 1px solid var(--border); text-align: center;">${getDayData(day).total_reminders || 0}</td>`).join('')}
                                        </tr>
                                        <tr>
                                            <td style="padding: 12px; border: 1px solid var(--border); font-weight: 600; background: rgb(229, 231, 235); position: sticky; left: 0; z-index: 10; opacity: 1;">Resets</td>
                                            ${weekdays.map(day => `<td style="padding: 12px; border: 1px solid var(--border); text-align: center;">${getDayData(day).total_resets || 0}</td>`).join('')}
                                        </tr>
                                    `;
                                })()}
                            </tbody>
                        </table>
                    </div>
                    ` : ''}
                    
                    ${data.by_class ? `
                    <h4 style="margin-top: 30px;">Class Statistics <button type="button" class="btn-secondary btn-graph" style="margin-left: 10px; padding: 4px 10px; font-size: 12px; vertical-align: middle;" onclick="showSectionGraph('summary_single_class', 'summary')">Graph</button></h4>
                    <div style="overflow-x: auto; margin-top: 15px;">
                        <table style="width: 100%; border-collapse: collapse; min-width: 800px;">
                            <thead>
                                <tr style="background: var(--bg-elevated);">
                                    <th style="padding: 12px; border: 1px solid var(--border); text-align: left; position: sticky; left: 0; top: 0; background: var(--bg-elevated); z-index: 30; opacity: 1;">Metric</th>
                                    ${Object.keys(data.by_class).sort().map(className => 
                                        `<th style="padding: 12px; border: 1px solid var(--border); text-align: center;">${className}</th>`
                                    ).join('')}
                                </tr>
                            </thead>
                            <tbody>
                                ${(() => {
                                    const classes = Object.keys(data.by_class).sort();
                                    const getClassData = (className) => data.by_class[className] || {
                                        total_days: 0,
                                        percentages: { safety: 0, teamwork: 0, accountability: 0, relationships: 0, overall: 0 },
                                        total_infractions: 0,
                                        total_reminders: 0,
                                        total_resets: 0
                                    };
                                    
                                    return `
                                        <tr>
                                            <td style="padding: 12px; border: 1px solid var(--border); font-weight: 600; background: rgb(229, 231, 235); position: sticky; left: 0; z-index: 10; opacity: 1;">Total Days</td>
                                            ${classes.map(className => `<td style="padding: 12px; border: 1px solid var(--border); text-align: center;">${getClassData(className).total_days || 0}</td>`).join('')}
                                        </tr>
                                        <tr>
                                            <td style="padding: 12px; border: 1px solid var(--border); font-weight: 600; background: rgb(254, 226, 226); position: sticky; left: 0; z-index: 10; opacity: 1;">Safety %</td>
                                            ${classes.map(className => `<td style="padding: 12px; border: 1px solid var(--border); text-align: center; background: rgba(254, 226, 226, 0.2);">${getClassData(className).percentages.safety || 0}%</td>`).join('')}
                                        </tr>
                                        <tr>
                                            <td style="padding: 12px; border: 1px solid var(--border); font-weight: 600; background: rgb(219, 234, 254); position: sticky; left: 0; z-index: 10; opacity: 1;">Teamwork %</td>
                                            ${classes.map(className => `<td style="padding: 12px; border: 1px solid var(--border); text-align: center; background: rgba(219, 234, 254, 0.2);">${getClassData(className).percentages.teamwork || 0}%</td>`).join('')}
                                        </tr>
                                        <tr>
                                            <td style="padding: 12px; border: 1px solid var(--border); font-weight: 600; background: rgb(209, 250, 229); position: sticky; left: 0; z-index: 10; opacity: 1;">Accountability %</td>
                                            ${classes.map(className => `<td style="padding: 12px; border: 1px solid var(--border); text-align: center; background: rgba(209, 250, 229, 0.2);">${getClassData(className).percentages.accountability || 0}%</td>`).join('')}
                                        </tr>
                                        <tr>
                                            <td style="padding: 12px; border: 1px solid var(--border); font-weight: 600; background: rgb(254, 243, 199); position: sticky; left: 0; z-index: 10; opacity: 1;">Relationships %</td>
                                            ${classes.map(className => `<td style="padding: 12px; border: 1px solid var(--border); text-align: center; background: rgba(254, 243, 199, 0.2);">${getClassData(className).percentages.relationships || 0}%</td>`).join('')}
                                        </tr>
                                        <tr>
                                            <td style="padding: 12px; border: 1px solid var(--border); font-weight: 600; background: var(--bg-elevated); position: sticky; left: 0; z-index: 10; opacity: 1;">Overall %</td>
                                            ${classes.map(className => `<td style="padding: 12px; border: 1px solid var(--border); text-align: center; font-weight: 600; background: var(--bg-elevated);">${getClassData(className).percentages.overall || 0}%</td>`).join('')}
                                        </tr>
                                        <tr>
                                            <td style="padding: 12px; border: 1px solid var(--border); font-weight: 600; background: rgb(229, 231, 235); position: sticky; left: 0; z-index: 10; opacity: 1;">Infractions</td>
                                            ${classes.map(className => `<td style="padding: 12px; border: 1px solid var(--border); text-align: center;">${getClassData(className).total_infractions || 0}</td>`).join('')}
                                        </tr>
                                        <tr>
                                            <td style="padding: 12px; border: 1px solid var(--border); font-weight: 600; background: rgb(229, 231, 235); position: sticky; left: 0; z-index: 10; opacity: 1;">Reminders</td>
                                            ${classes.map(className => `<td style="padding: 12px; border: 1px solid var(--border); text-align: center;">${getClassData(className).total_reminders || 0}</td>`).join('')}
                                        </tr>
                                        <tr>
                                            <td style="padding: 12px; border: 1px solid var(--border); font-weight: 600; background: rgb(229, 231, 235); position: sticky; left: 0; z-index: 10; opacity: 1;">Resets</td>
                                            ${classes.map(className => `<td style="padding: 12px; border: 1px solid var(--border); text-align: center;">${getClassData(className).total_resets || 0}</td>`).join('')}
                                        </tr>
                                    `;
                                })()}
                            </tbody>
                        </table>
                    </div>
                    ` : ''}
                </div>
            `;
        }
        
        // Show "Show Point Card Data" button if a specific student is selected
        const showPointCardBtn = document.getElementById('show-point-card-btn');
        if (studentId) {
            showPointCardBtn.style.display = 'inline-block';
            showPointCardBtn.dataset.studentId = studentId;
            showPointCardBtn.dataset.timeframe = timeframe;
        } else {
            showPointCardBtn.style.display = 'none';
        }
        
        // Hide point card data container
        document.getElementById('point-card-data-container').style.display = 'none';
    } catch (error) {
        console.error('Error loading summary:', error);
        showMessage('Error loading summary. Please try again.', 'error');
        // Disable Print button on error
        const printSummaryBtn = document.getElementById('print-summary-btn');
        if (printSummaryBtn) {
            printSummaryBtn.disabled = true;
        }
    }
}

// Section graph modal (Summary & Frenzy Stats)
let sectionGraphChartInstance = null;
let sectionGraphCurrentState = { sectionType: null, source: null };

function closeSectionGraphModal() {
    const modal = document.getElementById('section-graph-modal');
    if (modal) modal.style.display = 'none';
    if (sectionGraphChartInstance) {
        sectionGraphChartInstance.destroy();
        sectionGraphChartInstance = null;
    }
    const viewBySelect = document.getElementById('section-graph-view-by');
    if (viewBySelect) viewBySelect.onchange = null;
}

function getSectionGraphGroupBy() {
    const sel = document.getElementById('section-graph-view-by');
    return sel ? sel.value : 'month';
}

function parsePeriodKeyToGroup(pk, groupBy) {
    // pk examples: "January 25", "October 24", "Q1 2024", "2023-2024", "Most Recent 30 Days"
    const m = pk.match(/^(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{2})$/);
    if (m) {
        const yy = parseInt(m[2], 10);
        const yyyy = yy >= 90 ? 1900 + yy : 2000 + yy;
        const monthNum = ['January','February','March','April','May','June','July','August','September','October','November','December'].indexOf(m[1]) + 1;
        const q = Math.ceil(monthNum / 3);
        if (groupBy === 'month') return pk;
        if (groupBy === 'quarter') return `Q${q} ${yyyy}`;
        if (groupBy === 'year') return monthNum >= 8 ? `${yyyy}-${yyyy + 1}` : `${yyyy - 1}-${yyyy}`;
        return 'Overall';
    }
    const qm = pk.match(/^Q([1-4])\s+(\d{4})$/);
    if (qm) {
        if (groupBy === 'month' || groupBy === 'quarter') return pk;
        const y = parseInt(qm[2], 10);
        if (groupBy === 'year') return `${y}-${y + 1}`;
        return 'Overall';
    }
    const ym = pk.match(/^(\d{4})-(\d{4})$/);
    if (ym) {
        if (groupBy === 'year') return pk;
        if (groupBy === 'month' || groupBy === 'quarter') return pk;
        return 'Overall';
    }
    return groupBy === 'overall' ? 'Overall' : pk;
}

function aggregatePeriodsByGroup(periods, periodsData, groupBy, source) {
    const groups = {};
    periods.forEach(pk => {
        const g = parsePeriodKeyToGroup(pk, groupBy);
        if (!groups[g]) groups[g] = [];
        groups[g].push({ key: pk, data: periodsData[pk] });
    });
    const sortedKeys = Object.keys(groups).sort((a, b) => {
        if (a === 'Overall' && b !== 'Overall') return 1;
        if (b === 'Overall' && a !== 'Overall') return -1;
        if (a.match(/^\d{4}-\d{4}$/) && b.match(/^\d{4}-\d{4}$/)) return a.localeCompare(b);
        if (a.match(/^Q[1-4]\s+\d{4}$/) && b.match(/^Q[1-4]\s+\d{4}$/)) {
            const [aq, ay] = a.split(' '), [bq, by] = b.split(' ');
            return ay !== by ? ay.localeCompare(by) : aq.localeCompare(bq);
        }
        return a.localeCompare(b);
    });
    const aggregated = {};
    sortedKeys.forEach(g => {
        const items = groups[g];
        if (items.length === 1) {
            aggregated[g] = items[0].data;
            return;
        }
        const first = items[0].data;
        const merged = {};
        if (source === 'summary') {
            merged.total_days = items.reduce((s, x) => s + (x.data.total_days || 0), 0);
            merged.infractions = {};
            items.forEach(x => {
                Object.entries(x.data.infractions || {}).forEach(([k, v]) => {
                    merged.infractions[k] = (merged.infractions[k] || 0) + v;
                });
            });
            merged.additional_info = {
                total_reminders: items.reduce((s, x) => s + (x.data.additional_info?.total_reminders || 0), 0),
                total_resets: items.reduce((s, x) => s + (x.data.additional_info?.total_resets || 0), 0)
            };
            const pct = items[0].data.percentages;
            if (pct) {
                merged.percentages = {};
                ['safety','teamwork','accountability','relationships','overall'].forEach(k => {
                    const vals = items.map(x => parseFloat(String(x.data.percentages?.[k] || 0).replace('%','')) || 0);
                    merged.percentages[k] = vals.reduce((a,b)=>a+b,0) / vals.length;
                });
            }
            merged.by_day_of_week = {};
            ['Monday','Tuesday','Wednesday','Thursday','Friday'].forEach(day => {
                const vals = items.map(x => (x.data.by_day_of_week?.[day]?.percentages?.overall || 0));
                if (vals.some(v => v > 0)) {
                    merged.by_day_of_week[day] = { percentages: { overall: vals.reduce((a,b)=>a+b,0)/vals.length }, total_days: 0, total_infractions: 0 };
                }
            });
            merged.by_class = {};
            const allClasses = new Set();
            items.forEach(x => Object.keys(x.data.by_class || {}).forEach(c => allClasses.add(c)));
            allClasses.forEach(c => {
                const vals = items.map(x => (x.data.by_class?.[c]?.percentages?.overall || 0));
                merged.by_class[c] = { percentages: { overall: vals.reduce((a,b)=>a+b,0)/vals.length } };
            });
        } else {
            merged.total_count = items.reduce((s, x) => s + (x.data.total_count || 0), 0);
            merged.total_duration = items.reduce((s, x) => s + (x.data.total_duration || 0), 0);
            const tc = merged.total_count;
            merged.avg_duration = tc > 0 ? items.reduce((s, x) => s + (x.data.total_duration || 0), 0) / tc : 0;
            merged.by_day = {};
            ['Monday','Tuesday','Wednesday','Thursday','Friday'].forEach(day => {
                const cnt = items.reduce((s, x) => s + (x.data.by_day?.[day]?.count || 0), 0);
                const dur = items.reduce((s, x) => s + (x.data.by_day?.[day]?.duration || 0), 0);
                if (cnt > 0) merged.by_day[day] = { count: cnt, duration: dur, avg_duration: dur / cnt };
            });
            merged.by_location = {};
            const allLocs = new Set();
            items.forEach(x => Object.keys(x.data.by_location || {}).forEach(c => allLocs.add(c)));
            allLocs.forEach(c => {
                const cnt = items.reduce((s, x) => s + (x.data.by_location?.[c]?.count || 0), 0);
                const dur = items.reduce((s, x) => s + (x.data.by_location?.[c]?.duration || 0), 0);
                merged.by_location[c] = { count: cnt, duration: dur, avg_duration: cnt > 0 ? dur / cnt : 0 };
            });
            merged.by_purpose = {};
            const allPurps = new Set();
            items.forEach(x => Object.keys(x.data.by_purpose || {}).forEach(p => allPurps.add(p)));
            allPurps.forEach(p => {
                const cnt = items.reduce((s, x) => s + (x.data.by_purpose?.[p]?.count || 0), 0);
                const dur = items.reduce((s, x) => s + (x.data.by_purpose?.[p]?.duration || 0), 0);
                merged.by_purpose[p] = { count: cnt, duration: dur, avg_duration: cnt > 0 ? dur / cnt : 0 };
            });
        }
        aggregated[g] = merged;
    });
    return { labels: sortedKeys, periodsData: aggregated };
}

function refreshSectionGraphChart() {
    const { sectionType, source } = sectionGraphCurrentState;
    if (!sectionType || !source) return;
    const data = source === 'summary' ? window.currentSummaryData : window.currentFrenzyStatsData;
    if (!data) return;
    const groupBy = getSectionGraphGroupBy();
    const chartConfig = buildSectionChartConfig(sectionType, data, source, groupBy);
    if (!chartConfig) return;
    const titleEl = document.getElementById('section-graph-modal-title');
    if (titleEl) titleEl.textContent = chartConfig.title;
    if (sectionGraphChartInstance) {
        sectionGraphChartInstance.destroy();
        sectionGraphChartInstance = null;
    }
    const canvas = document.getElementById('section-graph-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    sectionGraphChartInstance = new Chart(ctx, {
        type: chartConfig.type || 'bar',
        data: chartConfig.data,
        options: chartConfig.options || {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: true } },
            scales: { x: { beginAtZero: true }, y: { beginAtZero: true } }
        }
    });
}

function showSectionGraph(sectionType, source) {
    const data = source === 'summary' ? window.currentSummaryData : window.currentFrenzyStatsData;
    if (!data) {
        showMessage('No data available to graph. Please load the data first.', 'error');
        return;
    }
    if (typeof Chart === 'undefined') {
        showMessage('Chart library not loaded.', 'error');
        return;
    }
    const modal = document.getElementById('section-graph-modal');
    const titleEl = document.getElementById('section-graph-modal-title');
    const canvas = document.getElementById('section-graph-canvas');
    const viewByWrap = document.getElementById('section-graph-view-by-wrap');
    const viewBySelect = document.getElementById('section-graph-view-by');
    if (!modal || !titleEl || !canvas) return;

    sectionGraphCurrentState = { sectionType, source };
    if (viewByWrap) viewByWrap.style.display = 'flex';
    if (viewBySelect) viewBySelect.value = 'month';

    const chartConfig = buildSectionChartConfig(sectionType, data, source, getSectionGraphGroupBy());
    if (!chartConfig) {
        showMessage('Unable to create graph for this section.', 'error');
        return;
    }

    if (sectionGraphChartInstance) {
        sectionGraphChartInstance.destroy();
        sectionGraphChartInstance = null;
    }

    titleEl.textContent = chartConfig.title;
    modal.style.display = 'block';
    const ctx = canvas.getContext('2d');
    sectionGraphChartInstance = new Chart(ctx, {
        type: chartConfig.type || 'bar',
        data: chartConfig.data,
        options: chartConfig.options || {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: true } },
            scales: {
                x: { beginAtZero: true },
                y: { beginAtZero: true }
            }
        }
    });

    if (viewBySelect) {
        viewBySelect.onchange = refreshSectionGraphChart;
    }
}

function buildSectionChartConfig(sectionType, data, source, groupBy) {
    const palette = ['#2563EB', '#1D4ED8', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#14b8a6', '#ec4899', '#84cc16', '#6366f1'];
    const hex = (i) => palette[i % palette.length];
    groupBy = groupBy || 'month';

    if (source === 'summary') {
        if (data.comparison_mode && data.periods) {
            const periods = Object.keys(data.periods);
            const { labels, periodsData } = aggregatePeriodsByGroup(periods, data.periods, groupBy, source);
            if (sectionType === 'summary_comparison_main') {
                const metrics = [
                    { key: 'total_days', label: 'Total Days' },
                    { key: 'infractions', label: 'Infractions', get: (p) => Object.values(p.infractions || {}).reduce((s, c) => s + c, 0) },
                    { key: 'reminders', label: 'Reminders', get: (p) => p.additional_info?.total_reminders || 0 },
                    { key: 'resets', label: 'Resets', get: (p) => p.additional_info?.total_resets || 0 }
                ];
                const datasets = metrics.map((m, i) => ({
                    label: m.label,
                    data: labels.map(pk => m.get ? m.get(periodsData[pk]) : (periodsData[pk][m.key] || 0)),
                    backgroundColor: hex(i)
                }));
                return {
                    title: 'Summary - Main Metrics',
                    type: 'bar',
                    data: { labels, datasets },
                    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'top' } }, scales: { x: { stacked: false }, y: { beginAtZero: true } } }
                };
            }
            if (sectionType === 'summary_comparison_star') {
                const starKeys = ['safety', 'teamwork', 'accountability', 'relationships', 'overall'];
                const starLabels = ['Safety', 'Teamwork', 'Accountability', 'Relationships', 'Overall'];
                const datasets = starKeys.map((k, i) => ({
                    label: starLabels[i],
                    data: labels.map(pk => (periodsData[pk].percentages?.[k] || 0)),
                    backgroundColor: hex(i)
                }));
                return {
                    title: 'Summary - STAR Percentages',
                    type: 'bar',
                    data: { labels, datasets },
                    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'top' } }, scales: { x: { stacked: false }, y: { beginAtZero: true, max: 100 } } }
                };
            }
            if (sectionType === 'summary_comparison_day') {
                const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
                const datasets = labels.map((pk, i) => ({
                    label: pk,
                    data: weekdays.map(d => (periodsData[pk].by_day_of_week?.[d]?.percentages?.overall || 0)),
                    backgroundColor: hex(i)
                }));
                return {
                    title: 'Summary - Day of Week (Overall %)',
                    type: 'bar',
                    data: { labels: weekdays.map(d => d.slice(0, 3)), datasets },
                    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'top' } }, scales: { x: { stacked: false }, y: { beginAtZero: true, max: 100 } } }
                };
            }
            if (sectionType === 'summary_comparison_class') {
                const allClasses = new Set();
                labels.forEach(pk => {
                    Object.keys(periodsData[pk].by_class || {}).forEach(c => allClasses.add(c));
                });
                const sortedClasses = Array.from(allClasses).sort();
                const datasets = labels.map((pk, i) => ({
                    label: pk,
                    data: sortedClasses.map(c => (periodsData[pk].by_class?.[c]?.percentages?.overall || 0)),
                    backgroundColor: hex(i)
                }));
                return {
                    title: 'Summary - Class Statistics (Overall %)',
                    type: 'bar',
                    data: { labels: sortedClasses, datasets },
                    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'top' } }, scales: { x: { stacked: false }, y: { beginAtZero: true, max: 100 } } }
                };
            }
        } else {
            if (sectionType === 'summary_single_star') {
                const numPeriods = data.totals?.possible ? data.totals.possible / 4 : 0;
                const maxPerCategory = numPeriods * 2;
                const labels = ['Safety', 'Teamwork', 'Accountability', 'Relationships', 'Overall'];
                const keys = ['safety', 'teamwork', 'accountability', 'relationships'];
                let values = keys.map(k => maxPerCategory > 0 ? ((data.totals[k] || 0) / maxPerCategory * 100).toFixed(0) : 0);
                const overall = values.length ? (values.reduce((a, b) => a + parseFloat(b), 0) / values.length).toFixed(0) : 0;
                values.push(overall);
                return {
                    title: 'Summary - STAR Averages',
                    type: 'bar',
                    data: {
                        labels,
                        datasets: [{
                            label: 'Percentage',
                            data: values.map(Number),
                            backgroundColor: labels.map((_, i) => hex(i))
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: {
                            legend: { display: false },
                            tooltip: { enabled: true }
                        },
                        scales: { y: { beginAtZero: true, max: 100 } },
                        onClick: (evt, elements) => {
                            if (!elements || !elements.length) return;
                            const index = elements[0].index;
                            const catKeys = ['safety', 'teamwork', 'accountability', 'relationships', 'overall'];
                            const catKey = catKeys[index];
                            if (!catKey) return;
                            try {
                                showStarCategoryDetails(catKey, labels[index] || catKey);
                            } catch (e) {
                                console.error('Error showing STAR category details:', e);
                            }
                        }
                    }
                };
            }
            if (sectionType === 'summary_single_day') {
                const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
                const getDay = (d) => data.by_day_of_week?.[d] || { percentages: { overall: 0 } };
                const values = weekdays.map(d => getDay(d).percentages?.overall || 0);
                return {
                    title: 'Summary - Day of Week (Overall %)',
                    type: 'bar',
                    data: { labels: weekdays.map(d => d.slice(0, 3)), datasets: [{ label: 'Overall %', data: values, backgroundColor: weekdays.map((_, i) => hex(i)) }] },
                    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, max: 100 } } }
                };
            }
            if (sectionType === 'summary_single_class') {
                const classes = Object.keys(data.by_class || {}).sort();
                const values = classes.map(c => data.by_class[c]?.percentages?.overall || 0);
                return {
                    title: 'Summary - Class Statistics (Overall %)',
                    type: 'bar',
                    data: { labels: classes, datasets: [{ label: 'Overall %', data: values, backgroundColor: classes.map((_, i) => hex(i)) }] },
                    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, max: 100 } } }
                };
            }
        }
    }

    if (source === 'frenzy') {
        if (data.comparison_mode && data.periods) {
            const periods = Object.keys(data.periods);
            const { labels, periodsData } = aggregatePeriodsByGroup(periods, data.periods, groupBy, source);
            if (sectionType === 'frenzy_comparison_main') {
                const datasets = [
                    { label: 'Total Frenzies', data: labels.map(pk => periodsData[pk].total_count || 0), backgroundColor: hex(0) },
                    { label: 'Total Duration (min)', data: labels.map(pk => periodsData[pk].total_duration || 0), backgroundColor: hex(1) },
                    { label: 'Avg Duration (min)', data: labels.map(pk => periodsData[pk].avg_duration || 0), backgroundColor: hex(2) }
                ];
                return {
                    title: 'Frenzy Stats - Main Metrics',
                    type: 'bar',
                    data: { labels, datasets },
                    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'top' } }, scales: { x: { stacked: false }, y: { beginAtZero: true } } }
                };
            }
            if (sectionType === 'frenzy_comparison_day') {
                const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
                const datasets = labels.map((pk, i) => ({
                    label: pk,
                    data: weekdays.map(d => (periodsData[pk].by_day?.[d]?.count || 0)),
                    backgroundColor: hex(i)
                }));
                return {
                    title: 'Frenzy Stats - Day of Week (Count)',
                    type: 'bar',
                    data: { labels: weekdays.map(d => d.slice(0, 3)), datasets },
                    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'top' } }, scales: { y: { beginAtZero: true } } }
                };
            }
            if (sectionType === 'frenzy_comparison_class') {
                const allClasses = new Set();
                labels.forEach(pk => Object.keys(periodsData[pk].by_location || {}).forEach(c => allClasses.add(c)));
                const sortedClasses = Array.from(allClasses).sort();
                const datasets = labels.map((pk, i) => ({
                    label: pk,
                    data: sortedClasses.map(c => (periodsData[pk].by_location?.[c]?.count || 0)),
                    backgroundColor: hex(i)
                }));
                return {
                    title: 'Frenzy Stats - Class (Count)',
                    type: 'bar',
                    data: { labels: sortedClasses, datasets },
                    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'top' } }, scales: { y: { beginAtZero: true } } }
                };
            }
            if (sectionType === 'frenzy_comparison_purpose') {
                const allPurposes = new Set();
                labels.forEach(pk => Object.keys(periodsData[pk].by_purpose || {}).forEach(p => allPurposes.add(p)));
                const sortedPurposes = Array.from(allPurposes).sort();
                const datasets = labels.map((pk, i) => ({
                    label: pk,
                    data: sortedPurposes.map(p => (periodsData[pk].by_purpose?.[p]?.count || 0)),
                    backgroundColor: hex(i)
                }));
                return {
                    title: 'Frenzy Stats - Purpose (Count)',
                    type: 'bar',
                    data: { labels: sortedPurposes, datasets },
                    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'top' } }, scales: { y: { beginAtZero: true } } }
                };
            }
        } else {
            if (sectionType === 'frenzy_single_main') {
                return {
                    title: 'Frenzy Stats - Overview',
                    type: 'bar',
                    data: {
                        labels: ['Total Frenzies', 'Total Duration (min)', 'Avg Duration (min)'],
                        datasets: [{ label: 'Value', data: [data.total_count || 0, data.total_duration || 0, data.avg_duration || 0], backgroundColor: [hex(0), hex(1), hex(2)] }]
                    },
                    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
                };
            }
            if (sectionType === 'frenzy_single_day') {
                const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
                const values = weekdays.map(d => (data.by_day?.[d]?.count || 0));
                return {
                    title: 'Frenzy Stats - Day of Week (Count)',
                    type: 'bar',
                    data: { labels: weekdays.map(d => d.slice(0, 3)), datasets: [{ label: 'Count', data: values, backgroundColor: weekdays.map((_, i) => hex(i)) }] },
                    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
                };
            }
            if (sectionType === 'frenzy_single_class') {
                const classes = Object.keys(data.by_location || {}).sort();
                const values = classes.map(c => data.by_location[c]?.count || 0);
                return {
                    title: 'Frenzy Stats - Class (Count)',
                    type: 'bar',
                    data: { labels: classes, datasets: [{ label: 'Count', data: values, backgroundColor: classes.map((_, i) => hex(i)) }] },
                    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
                };
            }
            if (sectionType === 'frenzy_single_purpose') {
                const purposes = Object.keys(data.by_purpose || {}).sort();
                const values = purposes.map(p => data.by_purpose[p]?.count || 0);
                return {
                    title: 'Frenzy Stats - Purpose (Count)',
                    type: 'bar',
                    data: { labels: purposes, datasets: [{ label: 'Count', data: values, backgroundColor: purposes.map((_, i) => hex(i)) }] },
                    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
                };
            }
        }
    }
    return null;
}

async function loadCaseManagerComparison() {
    const periodSelect = document.getElementById('summary-period-select');
    const timeframe = periodSelect ? periodSelect.value : '';
    
    if (!timeframe) {
        showMessage('Please select a timeframe first.', 'error');
        return;
    }
    
    // Get quarter and school year dates from localStorage
    const quarterDates = loadQuarterDates();
    const schoolYearDates = loadSchoolYearDates();
    // Convert to MM-DD format for backend
    const quarterDatesForBackend = convertQuarterDatesForBackend(quarterDates);
    const schoolYearDatesForBackend = convertSchoolYearDatesForBackend(schoolYearDates);
    
    let url = `/api/case-manager-comparison`;
    const params = [];
    
    params.push(`timeframe=${encodeURIComponent(timeframe)}`);
    params.push(`quarter_dates=${encodeURIComponent(JSON.stringify(quarterDatesForBackend))}`);
    params.push(`school_year_dates=${encodeURIComponent(JSON.stringify(schoolYearDatesForBackend))}`);
    
    if (params.length > 0) {
        url += '?' + params.join('&');
    }
    
    try {
        const response = await fetch(url);
        const data = await response.json();
        if (!response.ok) {
            showMessage(data.error || 'Error loading case manager comparison. Please try again.', 'error');
            return;
        }
        // Get timeframe label
        let timeframeLabel = 'All Time';
        if (timeframe === 'weekly') {
            timeframeLabel = 'Weekly';
        } else if (timeframe === '30day') {
            timeframeLabel = '30 Day';
        } else if (timeframe === 'current_year') {
            timeframeLabel = 'Current Year';
        } else if (timeframe === 'quarter1') {
            timeframeLabel = 'Quarter 1';
        } else if (timeframe === 'quarter2') {
            timeframeLabel = 'Quarter 2';
        } else if (timeframe === 'quarter3') {
            timeframeLabel = 'Quarter 3';
        } else if (timeframe === 'quarter4') {
            timeframeLabel = 'Quarter 4';
        } else if (timeframe === 'all_time') {
            timeframeLabel = 'All Time';
        } else if (timeframe === 'previous_years') {
            timeframeLabel = 'Previous Years';
        }
        
        renderCaseManagerComparison(data, timeframeLabel);
    } catch (error) {
        console.error('Error loading case manager comparison:', error);
        showMessage('Error loading case manager comparison. Please try again.', 'error');
    }
}

function renderCaseManagerComparison(data, timeframeLabel) {
    const container = document.getElementById('summary-results');
    
    if (!data.case_managers || Object.keys(data.case_managers).length === 0) {
        container.innerHTML = `
            <div class="summary-card">
                <h3>Case Manager Comparison - ${timeframeLabel}</h3>
                <p>No case managers with data found for the selected timeframe.</p>
            </div>
        `;
        return;
    }
    
    const sortedManagers = data.sorted_managers || [];
    const caseManagers = data.case_managers || {};
    
    // Get all unique infraction types across all case managers
    const allInfractionTypes = new Set();
    sortedManagers.forEach(cmName => {
        const cmData = caseManagers[cmName];
        if (cmData && cmData.infractions) {
            Object.keys(cmData.infractions).forEach(type => allInfractionTypes.add(type));
        }
    });
    const sortedInfractionTypes = Array.from(allInfractionTypes).sort();
    
    // Build table rows
    let tableRows = '';
    
    // STAR percentages rows
    tableRows += `
        <tr>
            <td style="padding: 12px; border: 1px solid var(--border); font-weight: 600; background: rgba(254, 226, 226, 0.3);">Safety %</td>
            ${sortedManagers.map(cmName => {
                const percent = caseManagers[cmName].star_percentages.safety;
                return `<td style="padding: 12px; border: 1px solid var(--border); text-align: center;">${percent}%</td>`;
            }).join('')}
        </tr>
        <tr>
            <td style="padding: 12px; border: 1px solid var(--border); font-weight: 600; background: rgba(219, 234, 254, 0.3);">Teamwork %</td>
            ${sortedManagers.map(cmName => {
                const percent = caseManagers[cmName].star_percentages.teamwork;
                return `<td style="padding: 12px; border: 1px solid var(--border); text-align: center;">${percent}%</td>`;
            }).join('')}
        </tr>
        <tr>
            <td style="padding: 12px; border: 1px solid var(--border); font-weight: 600; background: rgba(209, 250, 229, 0.3);">Accountability %</td>
            ${sortedManagers.map(cmName => {
                const percent = caseManagers[cmName].star_percentages.accountability;
                return `<td style="padding: 12px; border: 1px solid var(--border); text-align: center;">${percent}%</td>`;
            }).join('')}
        </tr>
        <tr>
            <td style="padding: 12px; border: 1px solid var(--border); font-weight: 600; background: rgba(254, 243, 199, 0.3);">Relationships %</td>
            ${sortedManagers.map(cmName => {
                const percent = caseManagers[cmName].star_percentages.relationships;
                return `<td style="padding: 12px; border: 1px solid var(--border); text-align: center;">${percent}%</td>`;
            }).join('')}
        </tr>
        <tr>
            <td style="padding: 12px; border: 1px solid var(--border); font-weight: 700; background: var(--bg-elevated); font-size: 16px;">Overall STAR %</td>
            ${sortedManagers.map(cmName => {
                const percent = caseManagers[cmName].star_percentages.overall;
                return `<td style="padding: 12px; border: 1px solid var(--border); text-align: center; font-weight: 700; font-size: 16px;">${percent}%</td>`;
            }).join('')}
        </tr>
    `;
    
    // Infraction rows
    sortedInfractionTypes.forEach(infractionType => {
        tableRows += `
            <tr>
                <td style="padding: 12px; border: 1px solid var(--border); font-weight: 600; background: rgba(229, 231, 235, 0.3);">${infractionType.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</td>
                ${sortedManagers.map(cmName => {
                    const count = caseManagers[cmName].infractions[infractionType] || 0;
                    return `<td style="padding: 12px; border: 1px solid var(--border); text-align: center;">${count}</td>`;
                }).join('')}
            </tr>
        `;
    });
    
    // Student count and total days rows
    tableRows += `
        <tr>
            <td style="padding: 12px; border: 1px solid var(--border); font-weight: 600; background: rgba(229, 231, 235, 0.3);">Student Count</td>
            ${sortedManagers.map(cmName => {
                const count = caseManagers[cmName].student_count || 0;
                return `<td style="padding: 12px; border: 1px solid var(--border); text-align: center;">${count}</td>`;
            }).join('')}
        </tr>
        <tr>
            <td style="padding: 12px; border: 1px solid var(--border); font-weight: 600; background: rgba(229, 231, 235, 0.3);">Total Days</td>
            ${sortedManagers.map(cmName => {
                const days = caseManagers[cmName].total_days || 0;
                return `<td style="padding: 12px; border: 1px solid var(--border); text-align: center;">${days}</td>`;
            }).join('')}
        </tr>
    `;
    
    container.innerHTML = `
        <div class="summary-card">
            <h3>Case Manager Comparison - ${timeframeLabel}</h3>
            <p style="margin-bottom: 15px; color: var(--text-secondary);">Case managers ordered by highest to lowest Overall STAR %</p>
            <div style="overflow-x: auto; margin-top: 20px;">
                <table style="width: 100%; border-collapse: collapse; min-width: 600px;">
                    <thead>
                        <tr style="background: var(--bg-elevated);">
                            <th style="padding: 12px; border: 1px solid var(--border); text-align: left; position: sticky; left: 0; background: var(--bg-elevated); z-index: 10;">Metric</th>
                            ${sortedManagers.map(cmName => 
                                `<th style="padding: 12px; border: 1px solid var(--border); text-align: center; background: var(--bg-elevated); min-width: 120px;">${cmName.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</th>`
                            ).join('')}
                        </tr>
                    </thead>
                    <tbody>
                        ${tableRows}
                    </tbody>
                </table>
            </div>
        </div>
    `;
    
    // Hide point card data container
    document.getElementById('point-card-data-container').style.display = 'none';
}

async function loadPointCardData() {
    const showPointCardBtn = document.getElementById('show-point-card-btn');

    // Prefer the dashboard state (new summary UI) for student/timeframe,
    // and fall back to the button's data attributes for backwards compatibility.
    let studentId = null;
    let timeframe = 'alltime';

    if (typeof dashboardState !== 'undefined' && dashboardState.summary) {
        const st = dashboardState.summary;
        if (st.studentId) {
            studentId = st.studentId;
        }

        if (st.compareMode) {
            const quarterSelect = document.getElementById('quarter-select');
            if (quarterSelect && quarterSelect.value) {
                timeframe = quarterSelect.value;
            }
        } else if (st.period) {
            timeframe = st.period === 'all_time' ? 'alltime' : st.period;
        }
    }

    // If state didn't give us a student, fall back to any data attributes on the button
    if (!studentId && showPointCardBtn && showPointCardBtn.dataset.studentId) {
        studentId = showPointCardBtn.dataset.studentId;
        if (showPointCardBtn.dataset.timeframe) {
            timeframe = showPointCardBtn.dataset.timeframe;
        }
    }
    
    if (!studentId) {
        showMessage('Please select a student first', 'error');
        return;
    }
    
    const container = document.getElementById('point-card-data-container');
    container.innerHTML = '<div class="loading">Loading point card data...</div>';
    container.style.display = 'block';
    
    try {
        // Get date range based on timeframe
        let startDate, endDate;
        const currentYear = new Date().getFullYear();
        const quarterDates = loadQuarterDates();
        const schoolYearDates = loadSchoolYearDates();
        
        if (timeframe === 'alltime') {
            // For all time, get all records (no date filter)
            startDate = null;
            endDate = null;
        } else if (timeframe === '30day') {
            // For 30 day, we'll fetch all and filter on frontend or use a wide range
            // Since we need the most recent 30 days with data, we'll fetch a wide range
            const today = new Date();
            const pastDate = new Date(today);
            pastDate.setDate(pastDate.getDate() - 90); // Get last 90 days to ensure we have 30 days with data
            startDate = pastDate.toISOString().split('T')[0];
            endDate = today.toISOString().split('T')[0];
        } else if (timeframe === 'month') {
            // For month to month, get all records (no date filter, will be grouped by month)
            startDate = null;
            endDate = null;
        } else if (timeframe === 'quarter') {
            // For quarter to quarter, get all records within any quarter period
            // We'll need to fetch a wide range that covers all quarters
            startDate = `${currentYear - 1}-01-01`;
            endDate = `${currentYear + 1}-12-31`;
        } else if (timeframe === 'year') {
            // For year to year, get all records within school year periods
            // Calculate based on school year dates (MM/DD/YYYY format)
            if (schoolYearDates.start && schoolYearDates.end) {
                // Parse MM/DD/YYYY format
                const startParts = schoolYearDates.start.split('/');
                const endParts = schoolYearDates.end.split('/');
                if (startParts.length === 3 && endParts.length === 3) {
                    // Convert to YYYY-MM-DD format for API
                    startDate = `${startParts[2]}-${startParts[0]}-${startParts[1]}`;
                    endDate = `${endParts[2]}-${endParts[0]}-${endParts[1]}`;
                } else {
                    // Fallback: try to parse as MM-DD format (old format)
                    const syStart = schoolYearDates.start.split('-');
                    const syEnd = schoolYearDates.end.split('-');
                    if (syStart.length >= 2 && syEnd.length >= 2) {
                        if (parseInt(syStart[0]) <= parseInt(syEnd[0])) {
                            startDate = `${currentYear}-${syStart[0]}-${syStart[1]}`;
                            endDate = `${currentYear}-${syEnd[0]}-${syEnd[1]}`;
                        } else {
                            startDate = `${currentYear}-${syStart[0]}-${syStart[1]}`;
                            endDate = `${currentYear + 1}-${syEnd[0]}-${syEnd[1]}`;
                        }
                    }
                }
            }
        } else {
            // Default to all time
            startDate = null;
            endDate = null;
        }
        
        // Fetch records
        let fetchUrl = `/api/daily-records?student_id=${studentId}`;
        if (startDate) {
            fetchUrl += `&start_date=${startDate}`;
        }
        if (endDate) {
            fetchUrl += `&end_date=${endDate}`;
        }
        const response = await fetch(fetchUrl);
        const records = await response.json();
        
        if (!records || records.length === 0) {
            container.innerHTML = '<div class="info-message">No point card data found for this period.</div>';
            const btn = document.getElementById('show-point-card-btn');
            if (btn) btn.textContent = 'Hide Point Cards';
            return;
        }
        
        // Sort records by date (newest first)
        records.sort((a, b) => new Date(b.date) - new Date(a.date));
        
        // Get student name
        const student = allStudents.find(s => s.id === parseInt(studentId));
        const studentName = student ? student.name : 'Student';
        
        // Build HTML
        let html = `
            <div class="point-card-header">
                <h3>Point Card Data - ${studentName}</h3>
                <p>${timeframe === 'alltime' ? 'All Time' : timeframe === '30day' ? '30 Day' : timeframe === 'month' ? 'Month to Month' : timeframe === 'quarter' ? 'Quarter to Quarter' : timeframe === 'year' ? 'Year to Year' : 'All Time'}</p>
                <div class="point-card-search" style="margin-top: 15px;">
                    <input type="text" id="point-card-search-input" placeholder="🔍 Search dates, times, locations, STAR values, or info..." style="width: 100%; padding: 12px; border: 1px solid var(--border); border-radius: 6px; font-size: 14px;">
                    <p style="font-size: 12px; color: var(--text-secondary); margin-top: 8px;">Search by date, time period, location, STAR values (0-2), or info data</p>
                </div>
            </div>
        `;
        
        records.forEach(record => {
            // Parse date without timezone issues (YYYY-MM-DD format)
            const [year, month, day] = record.date.split('-').map(Number);
            const date = new Date(year, month - 1, day); // month is 0-indexed
            // Format as "Day of Week, Month Day, Year" (e.g., "Monday, January 8, 2026")
            const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
            const formattedDate = date.toLocaleDateString('en-US', options);
            
            html += `
                <div class="point-card-day" data-record-id="${record.id}" data-date="${record.date}">
                    <div class="point-card-day-header">
                        <h4>${formattedDate}</h4>
                        <button class="btn-secondary edit-day-btn" data-record-id="${record.id}" data-date="${record.date}" data-student-id="${studentId}" data-student-name="${studentName}">Edit</button>
                    </div>
                    <div class="point-card-grid" id="point-card-grid-${record.id}">
                        ${renderPointCardGrid(record)}
                    </div>
                </div>
            `;
        });
        
        container.innerHTML = html;
        const btn = document.getElementById('show-point-card-btn');
        if (btn) btn.textContent = 'Hide Point Cards';
        
        // Add event listeners to edit buttons
        container.querySelectorAll('.edit-day-btn').forEach(btn => {
            btn.addEventListener('click', editPointCardDay);
        });
        
        // Add event listeners to info view buttons
        container.querySelectorAll('.info-view-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const recordId = e.target.dataset.recordId;
                const periodIndex = parseInt(e.target.dataset.periodIndex);
                // Find the record and period data
                const record = records.find(r => r.id === parseInt(recordId));
                if (record && record.periods && record.periods[periodIndex]) {
                    const period = record.periods[periodIndex];
                    showInfoViewPopup(period.info, period.time_range, period.location);
                }
            });
        });
        
        // Add search functionality
        const searchInput = document.getElementById('point-card-search-input');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                filterPointCardData(e.target.value, records);
            });
        }
        
        // Store records for filtering
        window.currentPointCardRecords = records;
        
    } catch (error) {
        console.error('Error loading point card data:', error);
        container.innerHTML = '<div class="error">Error loading point card data. Please try again.</div>';
    }
}

function openPointCardPrintWindow() {
    const printBtn = document.getElementById('print-summary-btn');
    // Prevent double-clicks while a PDF is being generated
    if (printBtn && printBtn.dataset.generating === 'true') {
        return;
    }
    if (printBtn) {
        if (!printBtn.dataset.originalLabel) {
            printBtn.dataset.originalLabel = printBtn.textContent || 'Print';
        }
        printBtn.dataset.generating = 'true';
        printBtn.disabled = true;
        printBtn.textContent = 'Generating PDF...';
    }

    const summaryContainer = document.getElementById('summary-results');
    const dataContainer = document.getElementById('point-card-data-container');
    // Determine which element to snapshot:
    // 1) Prefer the summary results (new dashboard UI)
    // 2) Fall back to the raw point-card cards if summary is empty
    let targetEl = null;
    if (summaryContainer && summaryContainer.innerHTML.trim()) {
        targetEl = summaryContainer;
    } else if (dataContainer) {
        const hasCards = dataContainer.querySelector('.point-card-day');
        if (!hasCards) {
            alert('There are no point card days to print.');
            return;
        }
        targetEl = dataContainer;
    } else {
        alert('No summary or point card data is available to print.');
        return;
    }

    // If html2canvas + jsPDF are available, use the robust snapshot → single-page PDF approach
    if (window.html2canvas && window.jspdf && window.jspdf.jsPDF) {
        const { jsPDF } = window.jspdf;

        // Small delay so any recent UI updates (e.g., charts) finish rendering
        setTimeout(() => {
            window.html2canvas(targetEl, {
                // Slightly lower scale for faster rendering while keeping readability
                scale: 1.5,
                backgroundColor: '#ffffff',
                useCORS: true,
                logging: false
            }).then(canvas => {
                const imgData = canvas.toDataURL('image/png');
                const pdf = new jsPDF('portrait', 'pt', 'letter');

                const pageWidth = pdf.internal.pageSize.getWidth();
                const pageHeight = pdf.internal.pageSize.getHeight();
                const margin = 24;
                const maxWidth = pageWidth - margin * 2;
                const maxHeight = pageHeight - margin * 2;

                const imgWidth = canvas.width;
                const imgHeight = canvas.height;

                const scale = Math.min(maxWidth / imgWidth, maxHeight / imgHeight);
                const renderWidth = imgWidth * scale;
                const renderHeight = imgHeight * scale;
                const offsetX = (pageWidth - renderWidth) / 2;
                const offsetY = (pageHeight - renderHeight) / 2;

                pdf.addImage(imgData, 'PNG', offsetX, offsetY, renderWidth, renderHeight);
                pdf.save('PointCardSummary.pdf');
            }).finally(() => {
                if (printBtn) {
                    printBtn.disabled = false;
                    printBtn.textContent = printBtn.dataset.originalLabel || 'Print';
                    printBtn.dataset.generating = 'false';
                }
            }).catch(err => {
                console.error('Error generating snapshot PDF:', err);
                alert('There was a problem generating the PDF. Please try again.');
                if (printBtn) {
                    printBtn.disabled = false;
                    printBtn.textContent = printBtn.dataset.originalLabel || 'Print';
                    printBtn.dataset.generating = 'false';
                }
            });
        }, 150);
        return;
    }

    // Fallback: use browser print with the existing print-root approach
    let printRoot = document.getElementById('point-card-print-root');
    if (!printRoot) {
        printRoot = document.createElement('div');
        printRoot.id = 'point-card-print-root';
        printRoot.className = 'print-root print-view';
        printRoot.style.position = 'fixed';
        printRoot.style.inset = '0';
        printRoot.style.zIndex = '9999';
        printRoot.style.background = '#ffffff';
        printRoot.style.overflow = 'auto';
        printRoot.style.display = 'none';
        document.body.appendChild(printRoot);

        const styleEl = document.createElement('style');
        styleEl.id = 'point-card-print-style';
        styleEl.textContent = `
            @page {
                size: letter;
                margin: 0.5in;
            }
            @media print {
                body > *:not(#point-card-print-root) {
                    display: none !important;
                }
                #point-card-print-root {
                    display: block !important;
                }
            }
            #point-card-print-root {
                box-sizing: border-box;
                padding: 0.25in;
                width: 100%;
            }
        `;
        document.head.appendChild(styleEl);
    }

    printRoot.innerHTML = targetEl.innerHTML;
    printRoot.style.display = 'block';

    setTimeout(() => {
        window.print();
        setTimeout(() => {
            printRoot.style.display = 'none';
            if (printBtn) {
                printBtn.disabled = false;
                printBtn.textContent = printBtn.dataset.originalLabel || 'Print';
                printBtn.dataset.generating = 'false';
            }
        }, 500);
    }, 250);
}

function filterPointCardData(searchQuery, records) {
    const query = searchQuery.toLowerCase().trim();
    
    // If search is empty, show all days
    if (!query) {
        document.querySelectorAll('.point-card-day').forEach(day => {
            day.style.display = 'block';
        });
        return;
    }
    
    // Filter each day
    records.forEach(record => {
        const dayElement = document.querySelector(`.point-card-day[data-date="${record.date}"]`);
        if (!dayElement) return;
        
        // Parse date without timezone issues
        const [year, month, day] = record.date.split('-').map(Number);
        const date = new Date(year, month - 1, day); // month is 0-indexed
        // Format as "Day of Week, Month Day, Year" for searching
        const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
        const formattedDate = date.toLocaleDateString('en-US', options).toLowerCase();
        const shortDate = record.date.toLowerCase(); // YYYY-MM-DD format
        // Also support MM/DD/YYYY format
        const mmddyyyy = `${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')}/${year}`;
        
        // Check if date matches
        let dateMatches = formattedDate.includes(query) || shortDate.includes(query) || mmddyyyy.includes(query);
        
        // Check if any period matches
        let periodMatches = false;
        if (record.periods && record.periods.length > 0) {
            periodMatches = record.periods.some(period => {
                // Check time
                const timeMatches = period.time_range && period.time_range.toLowerCase().includes(query);
                
                // Check location
                const locationMatches = period.location && period.location.toLowerCase().includes(query);
                
                // Check STAR values
                const safetyMatches = period.safety_points !== null && period.safety_points !== undefined && period.safety_points.toString().includes(query);
                const teamworkMatches = period.teamwork_points !== null && period.teamwork_points !== undefined && period.teamwork_points.toString().includes(query);
                const accountabilityMatches = period.accountability_points !== null && period.accountability_points !== undefined && period.accountability_points.toString().includes(query);
                const relationshipsMatches = period.relationships_points !== null && period.relationships_points !== undefined && period.relationships_points.toString().includes(query);
                
                // Check info data
                let infoMatches = false;
                if (period.info && period.info.trim() !== '') {
                    try {
                        const infoData = JSON.parse(period.info);
                        const infoString = JSON.stringify(infoData).toLowerCase();
                        infoMatches = infoString.includes(query);
                    } catch (e) {
                        // If not JSON, treat as plain text
                        infoMatches = period.info.toLowerCase().includes(query);
                    }
                }
                
                return timeMatches || locationMatches || safetyMatches || teamworkMatches || 
                       accountabilityMatches || relationshipsMatches || infoMatches;
            });
        }
        
        // Show/hide day based on matches
        if (dateMatches || periodMatches) {
            dayElement.style.display = 'block';
            
            // If periods match, highlight matching rows
            if (periodMatches && !dateMatches) {
                highlightMatchingRows(dayElement, query, record);
            } else {
                clearHighlights(dayElement);
            }
        } else {
            dayElement.style.display = 'none';
        }
    });
}

function highlightMatchingRows(dayElement, query, record) {
    const grid = dayElement.querySelector('.pc-grid');
    if (!grid) return;

    const cells = grid.querySelectorAll('.pc-cell');
    const colsPerRow = 7;
    const headerOffset = 0;

    record.periods.forEach((period, index) => {
        const startIdx = index * colsPerRow;
        const rowCells = Array.from(cells).slice(startIdx, startIdx + colsPerRow);
        if (rowCells.length === 0) return;

        const timeMatches = period.time_range && period.time_range.toLowerCase().includes(query);
        const locationMatches = period.location && period.location.toLowerCase().includes(query);
        const safetyMatches = period.safety_points !== null && period.safety_points !== undefined && period.safety_points.toString().includes(query);
        const teamworkMatches = period.teamwork_points !== null && period.teamwork_points !== undefined && period.teamwork_points.toString().includes(query);
        const accountabilityMatches = period.accountability_points !== null && period.accountability_points !== undefined && period.accountability_points.toString().includes(query);
        const relationshipsMatches = period.relationships_points !== null && period.relationships_points !== undefined && period.relationships_points.toString().includes(query);

        let infoMatches = false;
        if (period.info && period.info.trim() !== '') {
            try {
                const infoData = JSON.parse(period.info);
                infoMatches = JSON.stringify(infoData).toLowerCase().includes(query);
            } catch (e) {
                infoMatches = period.info.toLowerCase().includes(query);
            }
        }

        const rowMatches = timeMatches || locationMatches || safetyMatches || teamworkMatches ||
                          accountabilityMatches || relationshipsMatches || infoMatches;

        rowCells.forEach(cell => {
            if (rowMatches) {
                cell.style.backgroundColor = '#fffbea';
                cell.style.boxShadow = 'inset 0 -2px 0 #fbbf24, inset 0 2px 0 #fbbf24';
                cell.style.opacity = '';
            } else {
                cell.style.backgroundColor = '';
                cell.style.boxShadow = '';
                cell.style.opacity = '0.5';
            }
        });
    });
}

function clearHighlights(dayElement) {
    const grid = dayElement.querySelector('.pc-grid');
    if (!grid) return;

    const cells = grid.querySelectorAll('.pc-cell');
    cells.forEach(cell => {
        cell.style.backgroundColor = '';
        cell.style.boxShadow = '';
        cell.style.opacity = '';
    });
}

function renderPointCardGrid(record) {
    if (!record.periods || record.periods.length === 0) {
        return '<p>No period data available for this day.</p>';
    }

    let totals = { s: 0, t: 0, a: 0, r: 0 };
    let counts = { s: 0, t: 0, a: 0, r: 0 };

    record.periods.forEach(period => {
        if (period.safety_points !== null && period.safety_points !== undefined) {
            totals.s += period.safety_points; counts.s++;
        }
        if (period.teamwork_points !== null && period.teamwork_points !== undefined) {
            totals.t += period.teamwork_points; counts.t++;
        }
        if (period.accountability_points !== null && period.accountability_points !== undefined) {
            totals.a += period.accountability_points; counts.a++;
        }
        if (period.relationships_points !== null && period.relationships_points !== undefined) {
            totals.r += period.relationships_points; counts.r++;
        }
    });

    const sPercent = counts.s > 0 ? ((totals.s / (counts.s * 2)) * 100).toFixed(0) : '-';
    const tPercent = counts.t > 0 ? ((totals.t / (counts.t * 2)) * 100).toFixed(0) : '-';
    const aPercent = counts.a > 0 ? ((totals.a / (counts.a * 2)) * 100).toFixed(0) : '-';
    const rPercent = counts.r > 0 ? ((totals.r / (counts.r * 2)) * 100).toFixed(0) : '-';
    const totalPoints = totals.s + totals.t + totals.a + totals.r;
    const totalCounts = counts.s + counts.t + counts.a + counts.r;
    const overallPercent = totalCounts > 0 ? ((totalPoints / (totalCounts * 2)) * 100).toFixed(0) : '-';

    let html = `
        <div class="pc-grid" style="grid-template-columns: minmax(80px, max-content) minmax(80px, max-content) 44px 44px 44px 44px 56px;">
            <div class="pc-header-cell pc-header-time">Time</div>
            <div class="pc-header-cell pc-header-location">Location</div>
            <div class="pc-header-cell" data-category="s">S</div>
            <div class="pc-header-cell" data-category="t">T</div>
            <div class="pc-header-cell" data-category="a">A</div>
            <div class="pc-header-cell" data-category="r">R</div>
            <div class="pc-header-cell" data-category="i">Info</div>
    `;

    record.periods.forEach((period, periodIndex) => {
        const hasInfo = period.info && period.info.trim() !== '';
        const recordId = record.id;
        const infoHtml = hasInfo
            ? `<button class="pc-info-view-btn info-view-btn" data-record-id="${recordId}" data-period-index="${periodIndex}">View</button>`
            : '<span style="color: var(--text-secondary);">-</span>';

        html += `
            <div class="pc-cell pc-time-cell">${period.time_range}</div>
            <div class="pc-cell pc-location-cell">${period.location}</div>
            <div class="pc-cell pc-data-cell" data-category="s">${period.safety_points !== null && period.safety_points !== undefined ? period.safety_points : '-'}</div>
            <div class="pc-cell pc-data-cell" data-category="t">${period.teamwork_points !== null && period.teamwork_points !== undefined ? period.teamwork_points : '-'}</div>
            <div class="pc-cell pc-data-cell" data-category="a">${period.accountability_points !== null && period.accountability_points !== undefined ? period.accountability_points : '-'}</div>
            <div class="pc-cell pc-data-cell" data-category="r">${period.relationships_points !== null && period.relationships_points !== undefined ? period.relationships_points : '-'}</div>
            <div class="pc-cell pc-info-cell">${infoHtml}</div>
        `;
    });

    html += `
            <div class="pc-cell pc-percent-label" style="grid-column: span 2;">Percent:</div>
            <div class="pc-cell pc-percent-cell" style="color: #B91C1C;">${sPercent !== '-' ? sPercent + '%' : '-'}</div>
            <div class="pc-cell pc-percent-cell" style="color: #1E40AF;">${tPercent !== '-' ? tPercent + '%' : '-'}</div>
            <div class="pc-cell pc-percent-cell" style="color: #047857;">${aPercent !== '-' ? aPercent + '%' : '-'}</div>
            <div class="pc-cell pc-percent-cell" style="color: #B45309;">${rPercent !== '-' ? rPercent + '%' : '-'}</div>
            <div class="pc-cell pc-percent-overall">${overallPercent !== '-' ? overallPercent + '%' : '-'}</div>
        </div>
    `;

    return html;
}

async function editPointCardDay(e) {
    const button = e.target;
    const recordId = button.dataset.recordId;
    const date = button.dataset.date;
    const studentId = button.dataset.studentId;
    const studentName = button.dataset.studentName;
    
    // Fetch the full record data
    try {
        const response = await fetch(`/api/daily-records?student_id=${studentId}&start_date=${date}&end_date=${date}`);
        const records = await response.json();
        
        if (!records || records.length === 0) {
            showMessage('Record not found', 'error');
            return;
        }
        
        const record = records[0];
        
        // Create edit modal or inline edit view
        showEditPointCardModal(record, studentId, studentName, date);
        
    } catch (error) {
        console.error('Error loading record for editing:', error);
        showMessage('Error loading record. Please try again.', 'error');
    }
}

function showEditPointCardModal(record, studentId, studentName, date) {
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.id = 'edit-point-card-modal';
    modal.style.display = 'block';

    const [year, month, day] = date.split('-').map(Number);
    const dateObj = new Date(year, month - 1, day);
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    const formattedDate = dateObj.toLocaleDateString('en-US', options);

    const buildSelectHtml = (index, category, currentValue) => {
        const opts = ['', '2', '1', '0'].map(v => {
            const label = v === '' ? '-' : v;
            const sel = (v !== '' && parseInt(v) === currentValue) ? 'selected' : (v === '' && (currentValue === null || currentValue === undefined) ? 'selected' : '');
            return `<option value="${v}" ${sel}>${label}</option>`;
        }).join('');
        return `<select class="pc-edit-input edit-input" data-period-index="${index}" data-category="${category}">${opts}</select>`;
    };

    let gridRows = '';
    record.periods.forEach((period, index) => {
        const hasInfo = period.info && period.info.trim() !== '';
        gridRows += `
            <div class="pc-cell pc-time-cell">${period.time_range}</div>
            <div class="pc-cell pc-location-cell">${period.location}</div>
            <div class="pc-cell pc-data-cell" data-category="s" style="padding: 2px; justify-content: center;">
                ${buildSelectHtml(index, 'safety', period.safety_points)}
            </div>
            <div class="pc-cell pc-data-cell" data-category="t" style="padding: 2px; justify-content: center;">
                ${buildSelectHtml(index, 'teamwork', period.teamwork_points)}
            </div>
            <div class="pc-cell pc-data-cell" data-category="a" style="padding: 2px; justify-content: center;">
                ${buildSelectHtml(index, 'accountability', period.accountability_points)}
            </div>
            <div class="pc-cell pc-data-cell" data-category="r" style="padding: 2px; justify-content: center;">
                ${buildSelectHtml(index, 'relationships', period.relationships_points)}
            </div>
            <div class="pc-cell pc-info-cell" style="padding: 2px; justify-content: center;">
                <button class="info-btn-small" data-period-index="${index}" style="padding: 3px 8px; font-size: 10px;">${hasInfo ? 'Edit' : 'Add'}</button>
            </div>
        `;
    });

    let modalContent = `
        <div class="modal-content" style="max-width: 900px; max-height: 90vh; overflow-y: auto;">
            <span class="close" onclick="document.getElementById('edit-point-card-modal').remove()">&times;</span>
            <h2>Edit Point Card Data - ${studentName}</h2>
            <h3>${formattedDate}</h3>

            <div class="edit-point-card-grid" style="margin-top: 20px;">
                <div class="pc-grid point-card-edit-grid" style="grid-template-columns: minmax(80px, max-content) minmax(80px, max-content) 48px 48px 48px 48px 56px;">
                    <div class="pc-header-cell pc-header-time">Time</div>
                    <div class="pc-header-cell pc-header-location">Location</div>
                    <div class="pc-header-cell" data-category="s">S</div>
                    <div class="pc-header-cell" data-category="t">T</div>
                    <div class="pc-header-cell" data-category="a">A</div>
                    <div class="pc-header-cell" data-category="r">R</div>
                    <div class="pc-header-cell" data-category="i">Info</div>
                    ${gridRows}
                </div>
            </div>

            <div style="margin-top: 12px;">
                <button type="button" class="btn-secondary" id="add-point-card-row-btn" style="padding: 6px 12px; font-size: 13px;">+ Add row</button>
            </div>

            <div style="margin-top: 20px; display: flex; gap: 10px; justify-content: flex-end;">
                <button class="btn-primary" onclick="saveEditedPointCard(${record.id}, ${studentId}, '${date}')">Save Changes</button>
                <button class="btn-secondary" onclick="document.getElementById('edit-point-card-modal').remove()">Cancel</button>
            </div>
        </div>
    `;

    modal.innerHTML = modalContent;
    document.body.appendChild(modal);

    window.editingPointCardRecord = record;
    window.editingPointCardStudentId = studentId;
    window.editingPointCardStudentName = studentName;

    const infoButtons = modal.querySelectorAll('.info-btn-small');
    infoButtons.forEach(button => {
        button.addEventListener('click', (e) => {
            const periodIndex = parseInt(button.dataset.periodIndex);
            const period = record.periods[periodIndex];

            if (!period) {
                console.error('Period not found at index:', periodIndex);
                return;
            }

            const syntheticEvent = {
                target: {
                    dataset: {
                        studentId: studentId,
                        period: period.time_range,
                        studentName: studentName,
                        info: period.info || '',
                        periodIndex: periodIndex,
                        isEditPointCard: 'true'
                    }
                }
            };

            showInfoModal(syntheticEvent);
        });
    });

    const addRowBtn = document.getElementById('add-point-card-row-btn');
    if (addRowBtn) {
        addRowBtn.addEventListener('click', addPointCardRow);
    }
}

function addPointCardRow() {
    const record = window.editingPointCardRecord;
    const studentId = window.editingPointCardStudentId;
    const studentName = window.editingPointCardStudentName;
    const modal = document.getElementById('edit-point-card-modal');
    if (!record || !modal) return;

    const index = record.periods.length;
    const newPeriod = {
        time_range: '',
        location: '',
        safety_points: null,
        teamwork_points: null,
        accountability_points: null,
        relationships_points: null,
        points_possible: 4,
        reset: false,
        frenzy: false,
        notes: '',
        reminders: '',
        info: '',
        infractions: []
    };
    record.periods.push(newPeriod);

    const grid = modal.querySelector('.point-card-edit-grid');
    if (!grid) return;

    const buildSelect = (cat) => {
        const sel = document.createElement('select');
        sel.className = 'pc-edit-input edit-input';
        sel.dataset.periodIndex = index;
        sel.dataset.category = cat;
        ['', '2', '1', '0'].forEach(v => {
            const opt = document.createElement('option');
            opt.value = v;
            opt.textContent = v === '' ? '-' : v;
            sel.appendChild(opt);
        });
        return sel;
    };

    const catMap = { safety: 's', teamwork: 't', accountability: 'a', relationships: 'r' };

    // Time cell with input
    const timeCell = document.createElement('div');
    timeCell.className = 'pc-cell pc-time-cell';
    const timeInput = document.createElement('input');
    timeInput.type = 'text';
    timeInput.className = 'pc-text-input edit-input';
    timeInput.dataset.periodIndex = index;
    timeInput.dataset.category = 'time_range';
    timeInput.placeholder = 'Time';
    timeCell.appendChild(timeInput);
    grid.appendChild(timeCell);

    // Location cell with input
    const locCell = document.createElement('div');
    locCell.className = 'pc-cell pc-location-cell';
    const locInput = document.createElement('input');
    locInput.type = 'text';
    locInput.className = 'pc-text-input edit-input';
    locInput.dataset.periodIndex = index;
    locInput.dataset.category = 'location';
    locInput.placeholder = 'Location';
    locInput.autocomplete = 'off';
    locCell.appendChild(locInput);
    grid.appendChild(locCell);

    // STAR select cells
    ['safety', 'teamwork', 'accountability', 'relationships'].forEach(cat => {
        const cell = document.createElement('div');
        cell.className = 'pc-cell pc-data-cell';
        cell.dataset.category = catMap[cat];
        cell.style.padding = '2px';
        cell.style.justifyContent = 'center';
        cell.appendChild(buildSelect(cat));
        grid.appendChild(cell);
    });

    // Info cell
    const infoCell = document.createElement('div');
    infoCell.className = 'pc-cell pc-info-cell';
    infoCell.style.padding = '2px';
    infoCell.style.justifyContent = 'center';
    const infoBtn = document.createElement('button');
    infoBtn.className = 'info-btn-small';
    infoBtn.dataset.periodIndex = index;
    infoBtn.type = 'button';
    infoBtn.style.padding = '3px 8px';
    infoBtn.style.fontSize = '10px';
    infoBtn.textContent = 'Add';
    infoBtn.addEventListener('click', () => {
        const period = record.periods[index];
        const syntheticEvent = {
            target: {
                dataset: {
                    studentId: studentId,
                    period: period.time_range,
                    studentName: studentName,
                    info: period.info || '',
                    periodIndex: index,
                    isEditPointCard: 'true'
                }
            }
        };
        showInfoModal(syntheticEvent);
    });
    infoCell.appendChild(infoBtn);
    grid.appendChild(infoCell);
}

async function saveEditedPointCard(recordId, studentId, date) {
    const modal = document.getElementById('edit-point-card-modal');
    const record = window.editingPointCardRecord;
    
    if (!record) {
        showMessage('Error: Record data not found', 'error');
        return;
    }
    
    // Collect updated values from the form
    const updatedPeriods = record.periods.map((period, index) => {
        const timeInput = modal.querySelector(`input.edit-input[data-period-index="${index}"][data-category="time_range"]`);
        const locationInput = modal.querySelector(`input.edit-input[data-period-index="${index}"][data-category="location"]`);
        const time_range = (timeInput ? timeInput.value : null) ?? period.time_range;
        const location = (locationInput ? locationInput.value : null) ?? period.location;
        
        const safetySelect = modal.querySelector(`.edit-input[data-period-index="${index}"][data-category="safety"]`);
        const teamworkSelect = modal.querySelector(`.edit-input[data-period-index="${index}"][data-category="teamwork"]`);
        const accountabilitySelect = modal.querySelector(`.edit-input[data-period-index="${index}"][data-category="accountability"]`);
        const relationshipsSelect = modal.querySelector(`.edit-input[data-period-index="${index}"][data-category="relationships"]`);
        
        return {
            time_range: (time_range && String(time_range).trim()) ? String(time_range).trim() : (period.time_range || ''),
            location: (location && String(location).trim()) ? String(location).trim() : (period.location || ''),
            safety_points: safetySelect.value === '' ? null : parseInt(safetySelect.value),
            teamwork_points: teamworkSelect.value === '' ? null : parseInt(teamworkSelect.value),
            accountability_points: accountabilitySelect.value === '' ? null : parseInt(accountabilitySelect.value),
            relationships_points: relationshipsSelect.value === '' ? null : parseInt(relationshipsSelect.value),
            points_possible: 4,
            reset: period.reset || false,
            frenzy: period.frenzy || false,
            notes: period.notes || '',
            reminders: period.reminders || '',
            info: period.info || '',
            infractions: period.infractions || []
        };
    });
    
    // Omit periods that have neither time nor location (e.g. added but left blank)
    const periodsToSave = updatedPeriods.filter(p => (p.time_range && p.time_range.trim()) || (p.location && p.location.trim()));
    
    try {
        const response = await fetch('/api/daily-records', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                student_id: studentId,
                date: date,
                present: true,
                periods: periodsToSave,
                frenzies: []
            })
        });
        
        if (response.ok) {
            showMessage('Point card data updated successfully!', 'success');
            modal.remove();
            
            // Reload point card data to show changes
            loadPointCardData();
        } else {
            throw new Error('Failed to save changes');
        }
    } catch (error) {
        console.error('Error saving edited point card:', error);
        showMessage('Error saving changes. Please try again.', 'error');
    }
}

async function loadFrenzyStats() {
    const studentId = document.getElementById('frenzy-student-select').value;
    const periodSelect = document.getElementById('frenzy-period-select');
    const timeframeSelect = document.getElementById('frenzy-timeframe-select');
    const period = periodSelect ? periodSelect.value : '';
    const timeframe = timeframeSelect ? timeframeSelect.value : '';
    const managedByMeCheckbox = document.getElementById('frenzy-managed-by-me-checkbox');
    const managedByMe = managedByMeCheckbox ? managedByMeCheckbox.checked : false;

    // Get quarter and school year dates from localStorage
    const quarterDates = loadQuarterDates();
    const schoolYearDates = loadSchoolYearDates();
    // Convert to MM-DD format for backend
    const quarterDatesForBackend = convertQuarterDatesForBackend(quarterDates);
    const schoolYearDatesForBackend = convertSchoolYearDatesForBackend(schoolYearDates);

    let url = '/api/frenzy-stats';
    const params = [];
    // If period is selected, use period and ignore timeframe
    if (period) {
        params.push(`period=${encodeURIComponent(period)}`);
    } else if (timeframe) {
        // Only use timeframe if period is not selected
        params.push(`timeframe=${timeframe}`);
    }
    
    if (studentId) {
        params.push(`student_id=${studentId}`);
    }
    if (managedByMe) {
        params.push(`managed_by_me=true`);
    }
    // Add school year parameter for month comparison
    if (timeframe === 'month') {
        const schoolYearSelect = document.getElementById('frenzy-school-year-select');
        const selectedSchoolYear = schoolYearSelect ? schoolYearSelect.value : getCurrentSchoolYear();
        if (selectedSchoolYear) {
            params.push(`school_year=${encodeURIComponent(selectedSchoolYear)}`);
        }
    }
    // Send quarter and school year dates to backend
    params.push(`quarter_dates=${encodeURIComponent(JSON.stringify(quarterDatesForBackend))}`);
    params.push(`school_year_dates=${encodeURIComponent(JSON.stringify(schoolYearDatesForBackend))}`);
    
    if (params.length > 0) {
        url += '?' + params.join('&');
    }

    try {
        const response = await fetch(url);
        const data = await response.json();

        // Store frenzy stats data globally for PDF generation
        window.currentFrenzyStatsData = data;

        // Enable Print button
        const printFrenzyBtn = document.getElementById('print-frenzy-btn');
        if (printFrenzyBtn) {
            printFrenzyBtn.disabled = false;
        }

        const container = document.getElementById('frenzy-results');
        
        // Get timeframe label
        let timeframeLabel = 'All Time';
        if (period) {
            // Period labels
            if (period === '30day') {
                timeframeLabel = '30 Day';
            } else if (period === 'current_year') {
                timeframeLabel = 'Current Year';
            } else if (period === 'quarter1') {
                timeframeLabel = 'Quarter 1';
            } else if (period === 'quarter2') {
                timeframeLabel = 'Quarter 2';
            } else if (period === 'quarter3') {
                timeframeLabel = 'Quarter 3';
            } else if (period === 'quarter4') {
                timeframeLabel = 'Quarter 4';
            } else if (period === 'all_time') {
                timeframeLabel = 'All Time';
            } else if (period === 'previous_years') {
                timeframeLabel = 'Previous Years';
            }
        } else if (timeframe === '30day') {
            timeframeLabel = '30 Day';
        } else if (timeframe === '30day_to_30day') {
            timeframeLabel = '30 Day to 30 Day';
        } else if (timeframe === 'month') {
            timeframeLabel = 'Month to Month';
        } else if (timeframe === 'quarter') {
            timeframeLabel = 'Quarter to Quarter';
        } else if (timeframe === 'year') {
            timeframeLabel = 'Year to Year';
        }
        
        // Check if comparison mode
        if (data.comparison_mode && data.periods) {
            // Display comparison table
            const periods = Object.keys(data.periods);
            if (periods.length === 0) {
                container.innerHTML = `<div class="summary-card"><h3>Frenzy Statistics - ${timeframeLabel}</h3><p>No data available for comparison.</p></div>`;
                return;
            }
            
            // Build comparison table
            let html = `
                <div class="summary-card">
                    <h3>Frenzy Statistics - ${timeframeLabel} Comparison</h3>`;
            
            // Add school year dropdown for month comparison
            if (timeframe === 'month' && data.available_school_years && data.available_school_years.length > 0) {
                const currentSchoolYear = data.selected_school_year || getCurrentSchoolYear();
                html += `
                    <div class="form-group" style="margin-top: 15px; margin-bottom: 15px;">
                        <label for="frenzy-school-year-select" style="display: inline-block; margin-right: 10px;">School Year:</label>
                        <select id="frenzy-school-year-select" style="padding: 6px 12px; border: 1px solid var(--border); border-radius: 4px; font-size: 14px;">
                `;
                data.available_school_years.forEach(sy => {
                    html += `<option value="${sy}" ${sy === currentSchoolYear ? 'selected' : ''}>${sy}</option>`;
                });
                html += `
                        </select>
                    </div>
                `;
            }
            
            // Add data points warning for 30day_to_30day comparison
            if (timeframe === '30day_to_30day' && data.periods) {
                const periodKeys = Object.keys(data.periods);
                periodKeys.forEach(periodKey => {
                    const periodData = data.periods[periodKey];
                    if (periodData.available_data_points !== undefined) {
                        const dataPoints = periodData.available_data_points;
                        const hasFull30 = periodData.has_full_30_days || false;
                        const statusColor = hasFull30 ? '#10b981' : '#f59e0b';
                        const statusText = hasFull30 ? 'Complete (30/30 data points)' : `Incomplete (${dataPoints}/30 data points)`;
                        html += `<p style="margin-bottom: 15px; padding: 10px; background: ${hasFull30 ? '#d1fae5' : '#fef3c7'}; border-left: 4px solid ${statusColor}; border-radius: 4px;">
                            <strong>${periodKey} - Data Points:</strong> <span style="color: ${statusColor}; font-weight: bold;">${statusText}</span>
                        </p>`;
                    }
                });
            }
            
            html += `
                    <div style="overflow-x: auto; margin-top: 20px; max-height: 80vh; overflow-y: auto;">
                        <table style="width: 100%; border-collapse: collapse; min-width: 600px;">
                            <thead style="position: sticky; top: 0; z-index: 20;">
                                <tr style="background: var(--bg-elevated);">
                                    <th style="padding: 12px; border: 1px solid var(--border); text-align: left; position: sticky; left: 0; top: 0; background: var(--bg-elevated); z-index: 30; opacity: 1;">Metric</th>
            `;
            
            // Add period headers
            periods.forEach(periodKey => {
                html += `<th style="padding: 12px; border: 1px solid var(--border); text-align: center; min-width: 120px; background: var(--bg-elevated);">${periodKey}</th>`;
            });
            
            html += `</tr></thead><tbody>`;
            
            // Data Points row (only for 30day and 30day_to_30day comparisons)
            if ((timeframe === '30day' || timeframe === '30day_to_30day') || (period === '30day')) {
                html += `<tr><td style="padding: 12px; border: 1px solid var(--border); font-weight: 600; background: rgb(229, 231, 235); position: sticky; left: 0; z-index: 10;">Data Points</td>`;
                periods.forEach(periodKey => {
                    const periodData = data.periods[periodKey];
                    const dataPoints = periodData.available_data_points !== undefined ? periodData.available_data_points : periodData.total_days || 0;
                    const hasFull30 = periodData.has_full_30_days !== undefined ? periodData.has_full_30_days : false;
                    const displayText = hasFull30 ? `${dataPoints} (Full 30 Days)` : `${dataPoints}`;
                    html += `<td style="padding: 12px; border: 1px solid var(--border); text-align: center; font-weight: 600; background: rgba(229, 231, 235, 0.5);">${displayText}</td>`;
                });
                html += `</tr>`;
            }
            
            // Total Frenzies
            html += `<tr><td style="padding: 12px; border: 1px solid var(--border); font-weight: 600; background: rgb(229, 231, 235); position: sticky; left: 0; z-index: 10; opacity: 1;">Total Frenzies</td>`;
            periods.forEach(periodKey => {
                const periodData = data.periods[periodKey];
                html += `<td style="padding: 12px; border: 1px solid var(--border); text-align: center;">${periodData.total_count || 0}</td>`;
            });
            html += `</tr>`;
            
            // Total Duration
            html += `<tr><td style="padding: 12px; border: 1px solid var(--border); font-weight: 600; background: rgb(229, 231, 235); position: sticky; left: 0; z-index: 10; opacity: 1;">Total Duration (min)</td>`;
            periods.forEach(periodKey => {
                const periodData = data.periods[periodKey];
                html += `<td style="padding: 12px; border: 1px solid var(--border); text-align: center;">${periodData.total_duration || 0}</td>`;
            });
            html += `</tr>`;
            
            // Average Duration
            html += `<tr><td style="padding: 12px; border: 1px solid var(--border); font-weight: 600; background: rgb(229, 231, 235); position: sticky; left: 0; z-index: 10; opacity: 1;">Average Duration (min)</td>`;
            periods.forEach(periodKey => {
                const periodData = data.periods[periodKey];
                html += `<td style="padding: 12px; border: 1px solid var(--border); text-align: center;">${periodData.avg_duration ? periodData.avg_duration.toFixed(1) : '0.0'}</td>`;
            });
            html += `</tr>`;
            
            html += `</tbody></table></div>`;
            html += `<div style="margin-top: 10px;"><button type="button" class="btn-secondary btn-graph" style="padding: 4px 10px; font-size: 12px;" onclick="showSectionGraph('frenzy_comparison_main', 'frenzy')">Graph Main Metrics</button></div>`;
            
            // By Day of Week section - Separate Table (weekdays only)
            const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
            const allDays = new Set();
            periods.forEach(periodKey => {
                const periodData = data.periods[periodKey];
                if (periodData.by_day) {
                    Object.keys(periodData.by_day).forEach(day => {
                        // Only include weekdays
                        if (weekdays.includes(day)) {
                            allDays.add(day);
                        }
                    });
                }
            });
            const sortedDays = weekdays.filter(d => allDays.has(d));
            
            if (sortedDays.length > 0) {
                html += `
                    <h4 style="margin-top: 30px; margin-bottom: 15px; font-size: 18px; font-weight: 700; color: var(--text-primary);">Day of Week Statistics <button type="button" class="btn-secondary btn-graph" style="margin-left: 10px; padding: 4px 10px; font-size: 12px; vertical-align: middle;" onclick="showSectionGraph('frenzy_comparison_day', 'frenzy')">Graph</button></h4>
                    <div class="form-group" style="margin-bottom: 10px;">
                        <label for="frenzy-day-search" style="display: block; margin-bottom: 8px; font-weight: 600;">Search Day of Week:</label>
                        <div class="table-column-search-wrapper" style="width: 100%; max-width: 400px; position: relative;">
                            <input type="text" id="frenzy-day-search" placeholder="Type to search (e.g., Mon, Tue)" style="width: 100%; padding: 8px; border: 1px solid var(--border); border-radius: 4px;">
                            <div class="table-column-search-dropdown"></div>
                        </div>
                    </div>
                    <div style="overflow-x: auto; margin-top: 10px; max-height: 80vh; overflow-y: auto;">
                        <table id="frenzy-day-of-week-table" style="width: 100%; border-collapse: collapse; min-width: 600px;">
                            <thead style="position: sticky; top: 0; z-index: 20;">
                                <tr style="background: var(--bg-elevated);">
                                    <th style="padding: 12px; border: 1px solid var(--border); text-align: left; position: sticky; left: 0; top: 0; background: var(--bg-elevated); z-index: 30; opacity: 1; rowspan="2">Metric</th>
                `;
                
                // First header row with timeframe names
                periods.forEach((periodKey, periodIndex) => {
                    html += `<th class="frenzy-timeframe-header" data-period-index="${periodIndex}" style="padding: 12px; border: 1px solid var(--border); text-align: center; background: var(--bg-elevated); font-weight: 700;" colspan="${weekdays.length}">${periodKey}</th>`;
                });
                
                html += `</tr><tr style="background: var(--bg-elevated);">`;
                
                // Second header row with day names
                periods.forEach((periodKey, periodIndex) => {
                    weekdays.forEach((day, dayIndex) => {
                        html += `<th class="frenzy-day-header" data-period-index="${periodIndex}" data-day="${day}" data-column-index="${dayIndex}" style="padding: 12px; border: 1px solid var(--border); text-align: center; min-width: 120px; background: var(--bg-elevated);">${day}</th>`;
                    });
                });
                
                html += `</tr></thead><tbody>`;
                
                // Count row
                html += `<tr><td style="padding: 12px; border: 1px solid var(--border); font-weight: 600; background: rgb(229, 231, 235); position: sticky; left: 0; z-index: 10; opacity: 1;">Count</td>`;
                periods.forEach((periodKey, periodIndex) => {
                    weekdays.forEach((day, dayIndex) => {
                        const periodData = data.periods[periodKey];
                        const dayData = periodData.by_day && periodData.by_day[day] ? periodData.by_day[day] : {count: 0, duration: 0, avg_duration: 0};
                        html += `<td class="frenzy-day-data" data-period-index="${periodIndex}" data-day="${day}" data-column-index="${dayIndex}" style="padding: 12px; border: 1px solid var(--border); text-align: center; background: rgba(229, 231, 235, 0.2);">${dayData.count || 0}</td>`;
                    });
                });
                html += `</tr>`;
                
                // Duration row
                html += `<tr><td style="padding: 12px; border: 1px solid var(--border); font-weight: 600; background: rgb(229, 231, 235); position: sticky; left: 0; z-index: 10; opacity: 1;">Duration (min)</td>`;
                periods.forEach((periodKey, periodIndex) => {
                    weekdays.forEach((day, dayIndex) => {
                        const periodData = data.periods[periodKey];
                        const dayData = periodData.by_day && periodData.by_day[day] ? periodData.by_day[day] : {count: 0, duration: 0, avg_duration: 0};
                        html += `<td class="frenzy-day-data" data-period-index="${periodIndex}" data-day="${day}" data-column-index="${dayIndex}" style="padding: 12px; border: 1px solid var(--border); text-align: center; background: rgba(229, 231, 235, 0.2);">${dayData.duration || 0}</td>`;
                    });
                });
                html += `</tr>`;
                
                // Avg Duration row
                html += `<tr><td style="padding: 12px; border: 1px solid var(--border); font-weight: 600; background: rgb(229, 231, 235); position: sticky; left: 0; z-index: 10; opacity: 1;">Avg Duration (min)</td>`;
                periods.forEach((periodKey, periodIndex) => {
                    weekdays.forEach((day, dayIndex) => {
                        const periodData = data.periods[periodKey];
                        const dayData = periodData.by_day && periodData.by_day[day] ? periodData.by_day[day] : {count: 0, duration: 0, avg_duration: 0};
                        html += `<td class="frenzy-day-data" data-period-index="${periodIndex}" data-day="${day}" data-column-index="${dayIndex}" style="padding: 12px; border: 1px solid var(--border); text-align: center; background: rgba(229, 231, 235, 0.2);">${dayData.avg_duration ? dayData.avg_duration.toFixed(1) : '0.0'}</td>`;
                    });
                });
                html += `</tr>`;
                
                html += `</tbody></table></div>`;
            }
            
            // By Class section - Separate Table
            const allClasses = new Set();
            periods.forEach(periodKey => {
                const periodData = data.periods[periodKey];
                if (periodData.by_location) {
                    Object.keys(periodData.by_location).forEach(className => {
                        allClasses.add(className);
                    });
                }
            });
            const sortedClasses = Array.from(allClasses).sort();
            
            html += `
                <h4 style="margin-top: 30px; margin-bottom: 15px; font-size: 18px; font-weight: 700; color: var(--text-primary);">Class Statistics <button type="button" class="btn-secondary btn-graph" style="margin-left: 10px; padding: 4px 10px; font-size: 12px; vertical-align: middle;" onclick="showSectionGraph('frenzy_comparison_class', 'frenzy')">Graph</button></h4>`;
            
            if (sortedClasses.length > 0) {
                html += `
                    <div class="form-group" style="margin-bottom: 10px;">
                        <label for="frenzy-class-search" style="display: block; margin-bottom: 8px; font-weight: 600;">Search Class:</label>
                        <div class="table-column-search-wrapper" style="width: 100%; max-width: 400px; position: relative;">
                            <input type="text" id="frenzy-class-search" placeholder="Type to search class name" style="width: 100%; padding: 8px; border: 1px solid var(--border); border-radius: 4px;">
                            <div class="table-column-search-dropdown"></div>
                        </div>
                    </div>
                    <div style="overflow-x: auto; margin-top: 10px; max-height: 80vh; overflow-y: auto;">
                        <table id="frenzy-class-table" style="width: 100%; border-collapse: collapse; min-width: 600px;">
                            <thead style="position: sticky; top: 0; z-index: 20;">
                                <tr style="background: var(--bg-elevated);">
                                    <th style="padding: 12px; border: 1px solid var(--border); text-align: left; position: sticky; left: 0; top: 0; background: var(--bg-elevated); z-index: 30; opacity: 1; rowspan="2">Metric</th>
                `;
                
                // First header row with timeframe names
                periods.forEach((periodKey, periodIndex) => {
                    html += `<th class="frenzy-timeframe-header" data-period-index="${periodIndex}" style="padding: 12px; border: 1px solid var(--border); text-align: center; background: var(--bg-elevated); font-weight: 700;" colspan="${sortedClasses.length}">${periodKey}</th>`;
                });
                
                html += `</tr><tr style="background: var(--bg-elevated);">`;
                
                // Second header row with class names
                periods.forEach((periodKey, periodIndex) => {
                    sortedClasses.forEach((className, classIndex) => {
                        html += `<th class="frenzy-class-header" data-period-index="${periodIndex}" data-class="${className}" data-column-index="${classIndex}" style="padding: 12px; border: 1px solid var(--border); text-align: center; min-width: 120px; background: var(--bg-elevated);">${className}</th>`;
                    });
                });
                
                html += `</tr></thead><tbody>`;
                
                // Count row
                html += `<tr><td style="padding: 12px; border: 1px solid var(--border); font-weight: 600; background: rgb(229, 231, 235); position: sticky; left: 0; z-index: 10; opacity: 1;">Count</td>`;
                periods.forEach((periodKey, periodIndex) => {
                    sortedClasses.forEach((className, classIndex) => {
                        const periodData = data.periods[periodKey];
                        const classData = periodData.by_location && periodData.by_location[className] ? periodData.by_location[className] : {count: 0, duration: 0, avg_duration: 0};
                        html += `<td class="frenzy-class-data" data-period-index="${periodIndex}" data-class="${className}" data-column-index="${classIndex}" style="padding: 12px; border: 1px solid var(--border); text-align: center; background: rgba(229, 231, 235, 0.2);">${classData.count || 0}</td>`;
                    });
                });
                html += `</tr>`;
                
                // Duration row
                html += `<tr><td style="padding: 12px; border: 1px solid var(--border); font-weight: 600; background: rgb(229, 231, 235); position: sticky; left: 0; z-index: 10; opacity: 1;">Duration (min)</td>`;
                periods.forEach((periodKey, periodIndex) => {
                    sortedClasses.forEach((className, classIndex) => {
                        const periodData = data.periods[periodKey];
                        const classData = periodData.by_location && periodData.by_location[className] ? periodData.by_location[className] : {count: 0, duration: 0, avg_duration: 0};
                        html += `<td class="frenzy-class-data" data-period-index="${periodIndex}" data-class="${className}" data-column-index="${classIndex}" style="padding: 12px; border: 1px solid var(--border); text-align: center; background: rgba(229, 231, 235, 0.2);">${classData.duration || 0}</td>`;
                    });
                });
                html += `</tr>`;
                
                // Avg Duration row
                html += `<tr><td style="padding: 12px; border: 1px solid var(--border); font-weight: 600; background: rgb(229, 231, 235); position: sticky; left: 0; z-index: 10; opacity: 1;">Avg Duration (min)</td>`;
                periods.forEach((periodKey, periodIndex) => {
                    sortedClasses.forEach((className, classIndex) => {
                        const periodData = data.periods[periodKey];
                        const classData = periodData.by_location && periodData.by_location[className] ? periodData.by_location[className] : {count: 0, duration: 0, avg_duration: 0};
                        html += `<td class="frenzy-class-data" data-period-index="${periodIndex}" data-class="${className}" data-column-index="${classIndex}" style="padding: 12px; border: 1px solid var(--border); text-align: center; background: rgba(229, 231, 235, 0.2);">${classData.avg_duration ? classData.avg_duration.toFixed(1) : '0.0'}</td>`;
                    });
                });
                html += `</tr>`;
                
                html += `</tbody></table></div>`;
            } else {
                html += `
                    <div style="padding: 20px; text-align: center; background: var(--bg-elevated); border-radius: 4px; margin-top: 10px;">
                        <p style="color: #999; font-style: italic;">No class data available for the selected timeframe.</p>
                    </div>`;
            }
            
            // By Purpose section - Separate Table
            const allPurposes = new Set();
            periods.forEach(periodKey => {
                const periodData = data.periods[periodKey];
                if (periodData.by_purpose) {
                    Object.keys(periodData.by_purpose).forEach(purpose => allPurposes.add(purpose));
                }
            });
            const sortedPurposes = Array.from(allPurposes).sort();
            
            if (sortedPurposes.length > 0) {
                html += `
                    <h4 style="margin-top: 30px; margin-bottom: 15px; font-size: 18px; font-weight: 700; color: var(--text-primary);">Purpose Statistics <button type="button" class="btn-secondary btn-graph" style="margin-left: 10px; padding: 4px 10px; font-size: 12px; vertical-align: middle;" onclick="showSectionGraph('frenzy_comparison_purpose', 'frenzy')">Graph</button></h4>
                    <div class="form-group" style="margin-bottom: 10px;">
                        <label for="frenzy-purpose-search" style="display: block; margin-bottom: 8px; font-weight: 600;">Search Purpose:</label>
                        <div class="table-column-search-wrapper" style="width: 100%; max-width: 400px; position: relative;">
                            <input type="text" id="frenzy-purpose-search" placeholder="Type to search purpose name" style="width: 100%; padding: 8px; border: 1px solid var(--border); border-radius: 4px;">
                            <div class="table-column-search-dropdown"></div>
                        </div>
                    </div>
                    <div style="overflow-x: auto; margin-top: 10px; max-height: 80vh; overflow-y: auto;">
                        <table id="frenzy-purpose-table" style="width: 100%; border-collapse: collapse; min-width: 600px;">
                            <thead style="position: sticky; top: 0; z-index: 20;">
                                <tr style="background: var(--bg-elevated);">
                                    <th style="padding: 12px; border: 1px solid var(--border); text-align: left; position: sticky; left: 0; top: 0; background: var(--bg-elevated); z-index: 30; opacity: 1; rowspan="2">Metric</th>
                `;
                
                // First header row with timeframe names
                periods.forEach((periodKey, periodIndex) => {
                    html += `<th class="frenzy-timeframe-header" data-period-index="${periodIndex}" style="padding: 12px; border: 1px solid var(--border); text-align: center; background: var(--bg-elevated); font-weight: 700;" colspan="${sortedPurposes.length}">${periodKey}</th>`;
                });
                
                html += `</tr><tr style="background: var(--bg-elevated);">`;
                
                // Second header row with purpose names
                periods.forEach((periodKey, periodIndex) => {
                    sortedPurposes.forEach((purpose, purposeIndex) => {
                        html += `<th class="frenzy-purpose-header" data-period-index="${periodIndex}" data-purpose="${purpose.replace(/"/g, '&quot;')}" data-column-index="${purposeIndex}" style="padding: 12px; border: 1px solid var(--border); text-align: center; min-width: 120px; background: var(--bg-elevated);">${purpose.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</th>`;
                    });
                });
                
                html += `</tr></thead><tbody>`;
                
                // Count row
                html += `<tr><td style="padding: 12px; border: 1px solid var(--border); font-weight: 600; background: rgb(229, 231, 235); position: sticky; left: 0; z-index: 10; opacity: 1;">Count</td>`;
                periods.forEach((periodKey, periodIndex) => {
                    sortedPurposes.forEach((purpose, purposeIndex) => {
                        const periodData = data.periods[periodKey];
                        const purposeData = periodData.by_purpose && periodData.by_purpose[purpose] ? periodData.by_purpose[purpose] : {count: 0, duration: 0, avg_duration: 0};
                        html += `<td class="frenzy-purpose-data" data-period-index="${periodIndex}" data-purpose="${purpose.replace(/"/g, '&quot;')}" data-column-index="${purposeIndex}" style="padding: 12px; border: 1px solid var(--border); text-align: center; background: rgba(229, 231, 235, 0.2);">${purposeData.count || 0}</td>`;
                    });
                });
                html += `</tr>`;
                
                // Duration row
                html += `<tr><td style="padding: 12px; border: 1px solid var(--border); font-weight: 600; background: rgb(229, 231, 235); position: sticky; left: 0; z-index: 10; opacity: 1;">Duration (min)</td>`;
                periods.forEach((periodKey, periodIndex) => {
                    sortedPurposes.forEach((purpose, purposeIndex) => {
                        const periodData = data.periods[periodKey];
                        const purposeData = periodData.by_purpose && periodData.by_purpose[purpose] ? periodData.by_purpose[purpose] : {count: 0, duration: 0, avg_duration: 0};
                        html += `<td class="frenzy-purpose-data" data-period-index="${periodIndex}" data-purpose="${purpose.replace(/"/g, '&quot;')}" data-column-index="${purposeIndex}" style="padding: 12px; border: 1px solid var(--border); text-align: center; background: rgba(229, 231, 235, 0.2);">${purposeData.duration || 0}</td>`;
                    });
                });
                html += `</tr>`;
                
                // Avg Duration row
                html += `<tr><td style="padding: 12px; border: 1px solid var(--border); font-weight: 600; background: rgb(229, 231, 235); position: sticky; left: 0; z-index: 10; opacity: 1;">Avg Duration (min)</td>`;
                periods.forEach((periodKey, periodIndex) => {
                    sortedPurposes.forEach((purpose, purposeIndex) => {
                        const periodData = data.periods[periodKey];
                        const purposeData = periodData.by_purpose && periodData.by_purpose[purpose] ? periodData.by_purpose[purpose] : {count: 0, duration: 0, avg_duration: 0};
                        html += `<td class="frenzy-purpose-data" data-period-index="${periodIndex}" data-purpose="${purpose.replace(/"/g, '&quot;')}" data-column-index="${purposeIndex}" style="padding: 12px; border: 1px solid var(--border); text-align: center; background: rgba(229, 231, 235, 0.2);">${purposeData.avg_duration ? purposeData.avg_duration.toFixed(1) : '0.0'}</td>`;
                    });
                });
                html += `</tr>`;
                
                html += `</tbody></table></div>`;
            }
            
            html += `</div>`;
            container.innerHTML = html;
            
            // Initialize Day of Week searchable dropdown
            const frenzyDaySearchInput = document.getElementById('frenzy-day-search');
            if (frenzyDaySearchInput) {
                const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
                setupTableColumnSearch(frenzyDaySearchInput, weekdays, '#frenzy-day-of-week-table', (selectedValue) => {
                    const table = document.querySelector('#frenzy-day-of-week-table');
                    if (!table) return;
                    
                    // Get all day header cells (second row)
                    const dayHeaders = table.querySelectorAll('thead tr:last-child th.frenzy-day-header');
                    const dataRows = table.querySelectorAll('tbody tr');
                    
                    // Track visible columns per period
                    const visibleCountsByPeriod = {};
                    
                    dayHeaders.forEach((headerCell) => {
                        const periodIndex = parseInt(headerCell.getAttribute('data-period-index'));
                        const day = headerCell.getAttribute('data-day');
                        const columnIndex = parseInt(headerCell.getAttribute('data-column-index'));
                        const headerText = day || headerCell.textContent.trim();
                        const shouldShow = !selectedValue || headerText.toLowerCase().includes(selectedValue.toLowerCase());
                        
                        headerCell.style.display = shouldShow ? '' : 'none';
                        
                        // When filtering is active, shift all visible headers to the right by 1 column
                        if (selectedValue && shouldShow) {
                            headerCell.style.position = 'relative';
                            headerCell.style.left = '400px';
                        } else {
                            headerCell.style.position = '';
                            headerCell.style.left = '';
                        }
                        
                        if (!visibleCountsByPeriod[periodIndex]) {
                            visibleCountsByPeriod[periodIndex] = 0;
                        }
                        if (shouldShow) {
                            visibleCountsByPeriod[periodIndex]++;
                        }
                        
                        // Hide/show corresponding data cells using data attributes for precise matching
                        dataRows.forEach(row => {
                            const matchingCells = row.querySelectorAll(`td.frenzy-day-data[data-period-index="${periodIndex}"][data-day="${day}"][data-column-index="${columnIndex}"]`);
                            matchingCells.forEach(cell => {
                                cell.style.display = shouldShow ? '' : 'none';
                            });
                        });
                    });
                    
                    // Update timeframe header colspans
                    const timeframeHeaders = table.querySelectorAll('thead tr:first-child th.frenzy-timeframe-header');
                    timeframeHeaders.forEach((timeframeHeader) => {
                        const periodIndex = parseInt(timeframeHeader.getAttribute('data-period-index'));
                        const visibleCount = visibleCountsByPeriod[periodIndex] || 0;
                        if (visibleCount > 0) {
                            timeframeHeader.setAttribute('colspan', visibleCount);
                            timeframeHeader.style.display = '';
                        } else {
                            timeframeHeader.style.display = 'none';
                        }
                    });
                });
            }
            
            // Initialize Class searchable dropdown
            const frenzyClassSearchInput = document.getElementById('frenzy-class-search');
            if (frenzyClassSearchInput && sortedClasses.length > 0) {
                setupTableColumnSearch(frenzyClassSearchInput, sortedClasses, '#frenzy-class-table', (selectedValue) => {
                    const table = document.querySelector('#frenzy-class-table');
                    if (!table) return;
                    
                    // Get all class header cells (second row)
                    const classHeaders = table.querySelectorAll('thead tr:last-child th.frenzy-class-header');
                    const dataRows = table.querySelectorAll('tbody tr');
                    
                    // Track visible columns per period
                    const visibleCountsByPeriod = {};
                    
                    classHeaders.forEach((headerCell) => {
                        const periodIndex = parseInt(headerCell.getAttribute('data-period-index'));
                        const className = headerCell.getAttribute('data-class');
                        const columnIndex = parseInt(headerCell.getAttribute('data-column-index'));
                        const headerText = className || headerCell.textContent.trim();
                        const shouldShow = !selectedValue || headerText.toLowerCase().includes(selectedValue.toLowerCase());
                        
                        headerCell.style.display = shouldShow ? '' : 'none';
                        
                        // When filtering is active, shift all visible headers to the right by 1 column
                        if (selectedValue && shouldShow) {
                            headerCell.style.position = 'relative';
                            headerCell.style.left = '400px';
                        } else {
                            headerCell.style.position = '';
                            headerCell.style.left = '';
                        }
                        
                        if (!visibleCountsByPeriod[periodIndex]) {
                            visibleCountsByPeriod[periodIndex] = 0;
                        }
                        if (shouldShow) {
                            visibleCountsByPeriod[periodIndex]++;
                        }
                        
                        // Hide/show corresponding data cells using data attributes for precise matching
                        dataRows.forEach(row => {
                            const matchingCells = row.querySelectorAll(`td.frenzy-class-data[data-period-index="${periodIndex}"][data-class="${className}"][data-column-index="${columnIndex}"]`);
                            matchingCells.forEach(cell => {
                                cell.style.display = shouldShow ? '' : 'none';
                            });
                        });
                    });
                    
                    // Update timeframe header colspans
                    const timeframeHeaders = table.querySelectorAll('thead tr:first-child th.frenzy-timeframe-header');
                    timeframeHeaders.forEach((timeframeHeader) => {
                        const periodIndex = parseInt(timeframeHeader.getAttribute('data-period-index'));
                        const visibleCount = visibleCountsByPeriod[periodIndex] || 0;
                        if (visibleCount > 0) {
                            timeframeHeader.setAttribute('colspan', visibleCount);
                            timeframeHeader.style.display = '';
                        } else {
                            timeframeHeader.style.display = 'none';
                        }
                    });
                });
            }
            
            // Initialize Purpose searchable dropdown
            const frenzyPurposeSearchInput = document.getElementById('frenzy-purpose-search');
            if (frenzyPurposeSearchInput && sortedPurposes.length > 0) {
                setupTableColumnSearch(frenzyPurposeSearchInput, sortedPurposes, '#frenzy-purpose-table', (selectedValue) => {
                    const table = document.querySelector('#frenzy-purpose-table');
                    if (!table) return;
                    
                    // Get all purpose header cells (second row)
                    const purposeHeaders = table.querySelectorAll('thead tr:last-child th.frenzy-purpose-header');
                    const dataRows = table.querySelectorAll('tbody tr');
                    
                    // Track visible columns per period
                    const visibleCountsByPeriod = {};
                    
                    purposeHeaders.forEach((headerCell) => {
                        const periodIndex = parseInt(headerCell.getAttribute('data-period-index'));
                        const purpose = headerCell.getAttribute('data-purpose');
                        const columnIndex = parseInt(headerCell.getAttribute('data-column-index'));
                        const headerText = purpose || headerCell.textContent.trim();
                        const shouldShow = !selectedValue || headerText.toLowerCase().includes(selectedValue.toLowerCase());
                        
                        headerCell.style.display = shouldShow ? '' : 'none';
                        
                        // When filtering is active, shift all visible headers to the right by 1 column
                        if (selectedValue && shouldShow) {
                            headerCell.style.position = 'relative';
                            headerCell.style.left = '400px';
                        } else {
                            headerCell.style.position = '';
                            headerCell.style.left = '';
                        }
                        
                        if (!visibleCountsByPeriod[periodIndex]) {
                            visibleCountsByPeriod[periodIndex] = 0;
                        }
                        if (shouldShow) {
                            visibleCountsByPeriod[periodIndex]++;
                        }
                        
                        // Hide/show corresponding data cells using data attributes for precise matching
                        dataRows.forEach(row => {
                            const matchingCells = row.querySelectorAll(`td.frenzy-purpose-data[data-period-index="${periodIndex}"][data-purpose="${purpose.replace(/"/g, '\\"')}"][data-column-index="${columnIndex}"]`);
                            matchingCells.forEach(cell => {
                                cell.style.display = shouldShow ? '' : 'none';
                            });
                        });
                    });
                    
                    // Update timeframe header colspans
                    const timeframeHeaders = table.querySelectorAll('thead tr:first-child th.frenzy-timeframe-header');
                    timeframeHeaders.forEach((timeframeHeader) => {
                        const periodIndex = parseInt(timeframeHeader.getAttribute('data-period-index'));
                        const visibleCount = visibleCountsByPeriod[periodIndex] || 0;
                        if (visibleCount > 0) {
                            timeframeHeader.setAttribute('colspan', visibleCount);
                            timeframeHeader.style.display = '';
                        } else {
                            timeframeHeader.style.display = 'none';
                        }
                    });
                });
            }
            
            // Add event listener for school year dropdown (month comparison only)
            if (timeframe === 'month') {
                const schoolYearSelect = document.getElementById('frenzy-school-year-select');
                if (schoolYearSelect) {
                    schoolYearSelect.addEventListener('change', () => {
                        loadFrenzyStats();
                    });
                }
            }
        } else {
            // Single summary mode (30day, alltime)
            container.innerHTML = `
                <div class="summary-card">
                    <h3>Frenzy Statistics - ${timeframeLabel}</h3>
                    <div class="stats-grid">
                        <div class="stat-item">
                            <label>Total Frenzies</label>
                            <div class="value">${data.total_count || 0}</div>
                        </div>
                        <div class="stat-item">
                            <label>Total Duration</label>
                            <div class="value">${data.total_duration || 0} min</div>
                        </div>
                        <div class="stat-item">
                            <label>Average Duration</label>
                            <div class="value">${data.avg_duration ? data.avg_duration.toFixed(1) : '0.0'} min</div>
                        </div>
                    </div>
                    <div style="margin-top: 10px;"><button type="button" class="btn-secondary btn-graph" style="padding: 4px 10px; font-size: 12px;" onclick="showSectionGraph('frenzy_single_main', 'frenzy')">Graph Overview</button></div>
                    <h4 style="margin-top: 20px;">By Day of Week <button type="button" class="btn-secondary btn-graph" style="margin-left: 10px; padding: 4px 10px; font-size: 12px; vertical-align: middle;" onclick="showSectionGraph('frenzy_single_day', 'frenzy')">Graph</button></h4>
                    <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
                        <thead>
                            <tr style="background: var(--bg-elevated);">
                                <th style="padding: 12px; border: 1px solid var(--border); text-align: left;">Metric</th>
                                <th style="padding: 12px; border: 1px solid var(--border); text-align: center;">Monday</th>
                                <th style="padding: 12px; border: 1px solid var(--border); text-align: center;">Tuesday</th>
                                <th style="padding: 12px; border: 1px solid var(--border); text-align: center;">Wednesday</th>
                                <th style="padding: 12px; border: 1px solid var(--border); text-align: center;">Thursday</th>
                                <th style="padding: 12px; border: 1px solid var(--border); text-align: center;">Friday</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${(() => {
                                const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
                                const getDayData = (day) => data.by_day && data.by_day[day] ? data.by_day[day] : {count: 0, duration: 0, avg_duration: 0};
                                const hasData = weekdays.some(day => getDayData(day).count > 0);
                                
                                if (hasData) {
                                    return `
                                        <tr>
                                            <td style="padding: 12px; border: 1px solid var(--border); font-weight: 600; background: rgba(229, 231, 235, 0.3);">Count</td>
                                            ${weekdays.map(day => `<td style="padding: 12px; border: 1px solid var(--border); text-align: center;">${getDayData(day).count || 0}</td>`).join('')}
                                        </tr>
                                        <tr>
                                            <td style="padding: 12px; border: 1px solid var(--border); font-weight: 600; background: rgba(229, 231, 235, 0.3);">Total Duration (min)</td>
                                            ${weekdays.map(day => `<td style="padding: 12px; border: 1px solid var(--border); text-align: center;">${getDayData(day).duration || 0}</td>`).join('')}
                                        </tr>
                                        <tr>
                                            <td style="padding: 12px; border: 1px solid var(--border); font-weight: 600; background: rgba(229, 231, 235, 0.3);">Avg Duration (min)</td>
                                            ${weekdays.map(day => `<td style="padding: 12px; border: 1px solid var(--border); text-align: center;">${getDayData(day).avg_duration ? getDayData(day).avg_duration.toFixed(1) : '0.0'}</td>`).join('')}
                                        </tr>
                                    `;
                                } else {
                                    return '<tr><td colspan="6" style="padding: 12px; border: 1px solid var(--border); text-align: center; color: #999;">No frenzy data by day</td></tr>';
                                }
                            })()}
                        </tbody>
                    </table>
                    <h4 style="margin-top: 30px; margin-bottom: 15px; font-size: 18px; font-weight: 700; color: var(--text-primary);">Class Statistics <button type="button" class="btn-secondary btn-graph" style="margin-left: 10px; padding: 4px 10px; font-size: 12px; vertical-align: middle;" onclick="showSectionGraph('frenzy_single_class', 'frenzy')">Graph</button></h4>
                    ${data.by_location && Object.keys(data.by_location).length > 0 ? `
                    <div class="form-group" style="margin-bottom: 10px;">
                        <label for="frenzy-single-class-search" style="display: block; margin-bottom: 8px; font-weight: 600;">Search Class:</label>
                        <div class="table-column-search-wrapper" style="width: 100%; max-width: 400px; position: relative;">
                            <input type="text" id="frenzy-single-class-search" placeholder="Type to search class name" style="width: 100%; padding: 8px; border: 1px solid var(--border); border-radius: 4px;">
                            <div class="table-column-search-dropdown"></div>
                        </div>
                    </div>
                    <div style="overflow-x: auto; margin-top: 10px; max-height: 80vh; overflow-y: auto;">
                        <table id="frenzy-single-class-table" style="width: 100%; border-collapse: collapse; min-width: 600px;">
                            <thead style="position: sticky; top: 0; z-index: 20;">
                                <tr style="background: var(--bg-elevated);">
                                    <th style="padding: 12px; border: 1px solid var(--border); text-align: left; position: sticky; left: 0; top: 0; background: var(--bg-elevated); z-index: 30; opacity: 1;">Class</th>
                                    <th style="padding: 12px; border: 1px solid var(--border); text-align: center;">Count</th>
                                    <th style="padding: 12px; border: 1px solid var(--border); text-align: center;">Total Duration</th>
                                    <th style="padding: 12px; border: 1px solid var(--border); text-align: center;">Avg Duration</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${Object.entries(data.by_location).sort((a, b) => a[0].localeCompare(b[0])).map(([className, stats]) => `
                                    <tr>
                                        <td class="frenzy-single-class-name" data-class="${className}" style="padding: 12px; border: 1px solid var(--border); font-weight: 600; background: rgb(229, 231, 235); position: sticky; left: 0; z-index: 10; opacity: 1;">${className}</td>
                                        <td class="frenzy-single-class-data" data-class="${className}" style="padding: 12px; border: 1px solid var(--border); text-align: center; background: rgba(229, 231, 235, 0.2);">${stats.count || 0}</td>
                                        <td class="frenzy-single-class-data" data-class="${className}" style="padding: 12px; border: 1px solid var(--border); text-align: center; background: rgba(229, 231, 235, 0.2);">${stats.duration || 0} min</td>
                                        <td class="frenzy-single-class-data" data-class="${className}" style="padding: 12px; border: 1px solid var(--border); text-align: center; background: rgba(229, 231, 235, 0.2);">${stats.avg_duration ? stats.avg_duration.toFixed(1) : '0.0'} min</td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                    ` : `
                    <div style="padding: 20px; text-align: center; background: var(--bg-elevated); border-radius: 4px; margin-top: 10px;">
                        <p style="color: #999; font-style: italic;">No class data available for the selected timeframe.</p>
                    </div>
                    `}
                    <h4 style="margin-top: 20px;">By Purpose <button type="button" class="btn-secondary btn-graph" style="margin-left: 10px; padding: 4px 10px; font-size: 12px; vertical-align: middle;" onclick="showSectionGraph('frenzy_single_purpose', 'frenzy')">Graph</button></h4>
                    <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
                        <thead>
                            <tr style="background: var(--bg-elevated);">
                                <th style="padding: 12px; border: 1px solid var(--border); text-align: left;">Purpose</th>
                                <th style="padding: 12px; border: 1px solid var(--border); text-align: center;">Count</th>
                                <th style="padding: 12px; border: 1px solid var(--border); text-align: center;">Total Duration</th>
                                <th style="padding: 12px; border: 1px solid var(--border); text-align: center;">Avg Duration</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${Object.entries(data.by_purpose || {}).length > 0 ? 
                                Object.entries(data.by_purpose).map(([purpose, stats]) => `
                                    <tr>
                                        <td style="padding: 12px; border: 1px solid var(--border);">${purpose.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</td>
                                        <td style="padding: 12px; border: 1px solid var(--border); text-align: center;">${stats.count}</td>
                                        <td style="padding: 12px; border: 1px solid var(--border); text-align: center;">${stats.duration} min</td>
                                        <td style="padding: 12px; border: 1px solid var(--border); text-align: center;">${stats.avg_duration ? stats.avg_duration.toFixed(1) : '0.0'} min</td>
                                    </tr>
                                `).join('') 
                                : '<tr><td colspan="4" style="padding: 12px; border: 1px solid var(--border); text-align: center; color: #999;">No frenzy data by purpose</td></tr>'
                            }
                        </tbody>
                    </table>
                    ${(() => {
                        // Check if all purposes in all_purposes are already in by_purpose
                        const purposesInTable = new Set(Object.keys(data.by_purpose || {}));
                        const allPurposesList = (data.all_purposes || []).filter(p => p && p.trim());
                        const uniquePurposes = [...new Set(allPurposesList.map(p => p.trim()))];
                        const purposesNotInTable = uniquePurposes.filter(p => !purposesInTable.has(p));
                        
                        // Only show "All Purposes" section if there are purposes not already in the table
                        if (purposesNotInTable.length > 0) {
                            return `
                    <h4 style="margin-top: 30px; margin-bottom: 15px; font-size: 18px; font-weight: 700; color: var(--text-primary);">All Purposes</h4>
                    <div style="overflow-x: auto; margin-top: 10px; max-height: 80vh; overflow-y: auto;">
                        <table style="width: 100%; border-collapse: collapse; min-width: 600px;">
                            <thead style="position: sticky; top: 0; z-index: 20;">
                                <tr style="background: var(--bg-elevated);">
                                    <th style="padding: 12px; border: 1px solid var(--border); text-align: left; position: sticky; left: 0; top: 0; background: var(--bg-elevated); z-index: 30; opacity: 1;">Purpose</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${purposesNotInTable.map(purpose => `
                                    <tr>
                                        <td style="padding: 12px; border: 1px solid var(--border); font-weight: 600; background: rgb(229, 231, 235); position: sticky; left: 0; z-index: 10; opacity: 1;">${(purpose || '').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                            `;
                        }
                        return '';
                    })()}
                    <h4 style="margin-top: 20px;">Results of Behavior</h4>
                    <div style="overflow-x: auto; margin-top: 10px; max-height: 300px; overflow-y: auto;">
                        <table style="width: 100%; border-collapse: collapse;">
                            <thead style="position: sticky; top: 0; z-index: 20;">
                                <tr style="background: var(--bg-elevated);">
                                    <th style="padding: 12px; border: 1px solid var(--border); text-align: left;">Result</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${(data.all_results && data.all_results.length > 0) ? 
                                    data.all_results.map(result => 
                                        `<tr>
                                            <td style="padding: 12px; border: 1px solid var(--border); white-space: pre-wrap;">${(result || '').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</td>
                                        </tr>`
                                    ).join('') 
                                    : '<tr><td style="padding: 12px; border: 1px solid var(--border); text-align: center; color: #999; font-style: italic;">None</td></tr>'
                                }
                            </tbody>
                        </table>
                    </div>
                    
                    <h4 style="margin-top: 30px;">Additional Information</h4>
                    <h5 style="margin-top: 15px; margin-bottom: 10px; color: var(--accent);">Day of Week Comparison</h5>
                    <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
                        <thead>
                            <tr style="background: var(--bg-elevated);">
                                <th style="padding: 12px; border: 1px solid var(--border); text-align: left;">Metric</th>
                                <th style="padding: 12px; border: 1px solid var(--border); text-align: center;">Monday</th>
                                <th style="padding: 12px; border: 1px solid var(--border); text-align: center;">Tuesday</th>
                                <th style="padding: 12px; border: 1px solid var(--border); text-align: center;">Wednesday</th>
                                <th style="padding: 12px; border: 1px solid var(--border); text-align: center;">Thursday</th>
                                <th style="padding: 12px; border: 1px solid var(--border); text-align: center;">Friday</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${(() => {
                                const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
                                const getDayData = (day) => data.by_day && data.by_day[day] ? data.by_day[day] : {count: 0, duration: 0, avg_duration: 0};
                                const hasData = weekdays.some(day => getDayData(day).count > 0);
                                
                                if (hasData) {
                                    return `
                                        <tr>
                                            <td style="padding: 12px; border: 1px solid var(--border); font-weight: 600; background: rgba(229, 231, 235, 0.3);">Count</td>
                                            ${weekdays.map(day => `<td style="padding: 12px; border: 1px solid var(--border); text-align: center;">${getDayData(day).count || 0}</td>`).join('')}
                                        </tr>
                                        <tr>
                                            <td style="padding: 12px; border: 1px solid var(--border); font-weight: 600; background: rgba(229, 231, 235, 0.3);">Total Duration (min)</td>
                                            ${weekdays.map(day => `<td style="padding: 12px; border: 1px solid var(--border); text-align: center;">${getDayData(day).duration || 0}</td>`).join('')}
                                        </tr>
                                        <tr>
                                            <td style="padding: 12px; border: 1px solid var(--border); font-weight: 600; background: rgba(229, 231, 235, 0.3);">Avg Duration (min)</td>
                                            ${weekdays.map(day => `<td style="padding: 12px; border: 1px solid var(--border); text-align: center;">${getDayData(day).avg_duration ? getDayData(day).avg_duration.toFixed(1) : '0.0'}</td>`).join('')}
                                        </tr>
                                    `;
                                } else {
                                    return '<tr><td colspan="6" style="padding: 12px; border: 1px solid var(--border); text-align: center; color: #999;">No frenzy data by day</td></tr>';
                                }
                            })()}
                        </tbody>
                    </table>
                </div>
            `;
            
            // Initialize Class searchable dropdown for single mode
            const frenzySingleClassSearchInput = document.getElementById('frenzy-single-class-search');
            if (frenzySingleClassSearchInput && data.by_location && Object.keys(data.by_location).length > 0) {
                const sortedClasses = Object.keys(data.by_location).sort();
                setupTableColumnSearch(frenzySingleClassSearchInput, sortedClasses, '#frenzy-single-class-table', (selectedValue) => {
                    const table = document.querySelector('#frenzy-single-class-table');
                    if (!table) return;
                    
                    const classRows = table.querySelectorAll('tbody tr');
                    classRows.forEach(row => {
                        const classNameCell = row.querySelector('td.frenzy-single-class-name');
                        if (classNameCell) {
                            const className = classNameCell.getAttribute('data-class') || classNameCell.textContent.trim();
                            const shouldShow = !selectedValue || className.toLowerCase().includes(selectedValue.toLowerCase());
                            row.style.display = shouldShow ? '' : 'none';
                        }
                    });
                });
            }
        }
    } catch (error) {
        console.error('Error loading frenzy stats:', error);
        showMessage('Error loading frenzy statistics. Please try again.', 'error');
        // Disable Print button on error
        const printFrenzyBtn = document.getElementById('print-frenzy-btn');
        if (printFrenzyBtn) {
            printFrenzyBtn.disabled = true;
        }
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

function switchImportTab(tab) {
    const staffSection = document.getElementById('import-staff-section');
    const outsideStaffSection = document.getElementById('import-outside-staff-section');
    const studentSection = document.getElementById('import-student-section');
    const results = document.getElementById('import-results');
    if (staffSection && studentSection) {
        staffSection.style.display = tab === 'staff' ? 'block' : 'none';
        if (outsideStaffSection) outsideStaffSection.style.display = tab === 'outside_staff' ? 'block' : 'none';
        studentSection.style.display = tab === 'student' ? 'block' : 'none';
    }
    if (results) {
        results.style.display = 'none';
        results.innerHTML = '';
    }
}

function importUsersFromCsv() {
    const select = document.getElementById('import-type-select');
    const type = select ? select.value : 'staff';
    if (type === 'student') {
        importStudentCSV();
    } else if (type === 'outside_staff') {
        importOutsideStaffCSV();
    } else {
        importStaffCSV();
    }
}

function renderImportResults(data, type) {
    const container = document.getElementById('import-results');
    if (!container) return;

    let html = '';
    const success = data.success || [];
    const errors = data.errors || [];
    const warnings = data.warnings || [];

    if (success.length > 0) {
        const heading =
            type === 'staff'
                ? 'Successfully created staff user(s):'
                : type === 'outside_staff'
                    ? 'Successfully created outside staff user(s):'
                    : 'Successfully created student user(s):';
        html += `<div class="import-results-success"><strong>${heading}</strong>`;
        html += `<br>Count: ${success.length}`;
        html += '<table class="import-results-table"><thead>';
        if (type === 'staff') {
            html += '<tr><th>Name</th><th>Username</th><th>Password</th><th>Role</th><th>User #</th></tr></thead><tbody>';
            success.forEach(row => {
                html += `<tr><td>${row.name || ''}</td><td>${row.username || ''}</td><td>${row.password || ''}</td><td>${row.role || ''}</td><td>${row.user_number || ''}</td></tr>`;
            });
        } else if (type === 'outside_staff') {
            html += '<tr><th>Name</th><th>Username</th><th>Password</th><th>User #</th><th>District</th></tr></thead><tbody>';
            success.forEach(row => {
                html += `<tr><td>${row.name || ''}</td><td>${row.username || ''}</td><td>${row.password || ''}</td><td>${row.user_number || ''}</td><td>${row.district || ''}</td></tr>`;
            });
        } else {
            html += '<tr><th>Initials</th><th>Username</th><th>Password</th><th>Lunch #</th><th>Grade</th></tr></thead><tbody>';
            success.forEach(row => {
                html += `<tr><td>${row.initials || ''}</td><td>${row.username || ''}</td><td>${row.password || ''}</td><td>${row.lunch_number || ''}</td><td>${row.grade || ''}</td></tr>`;
            });
        }
        html += '</tbody></table></div>';
    }

    if (warnings.length > 0) {
        html += '<div class="import-results-warning">';
        warnings.forEach(msg => {
            html += `<p>${msg}</p>`;
        });
        html += '</div>';
    }

    if (errors.length > 0) {
        html += '<div class="import-results-error"><strong>Some rows were not imported:</strong><ul>';
        errors.forEach(msg => {
            html += `<li>${msg}</li>`;
        });
        html += '</ul></div>';
    }

    if (!html) {
        html = '<div class="import-results-success">No rows were processed.</div>';
    }

    container.innerHTML = html;
    container.style.display = 'block';
}

async function importStaffCSV() {
    const input = document.getElementById('import-staff-file');
    const container = document.getElementById('import-results');
    if (!input || !container) return;

    if (!input.files || input.files.length === 0) {
        showMessage('Please select a staff CSV file to import.', 'error');
        return;
    }

    const formData = new FormData();
    formData.append('file', input.files[0]);
    formData.append('type', 'staff');

    container.style.display = 'block';
    container.innerHTML = '<div class="loading">Importing staff users...</div>';

    try {
        const response = await fetch('/api/import-users', {
            method: 'POST',
            body: formData
        });
        const data = await response.json();
        if (!response.ok) {
            container.innerHTML = `<div class="import-results-error">Error: ${data.error || 'Import failed.'}</div>`;
            return;
        }
        renderImportResults(data, 'staff');
    } catch (err) {
        console.error('Error importing staff CSV:', err);
        container.innerHTML = '<div class="import-results-error">Error importing staff CSV. Please try again.</div>';
    }
}

async function importOutsideStaffCSV() {
    const input = document.getElementById('import-outside-staff-file');
    const container = document.getElementById('import-results');
    if (!input || !container) return;

    if (!input.files || input.files.length === 0) {
        showMessage('Please select an Outside Staff CSV file to import.', 'error');
        return;
    }

    const formData = new FormData();
    formData.append('file', input.files[0]);
    formData.append('type', 'outside_staff');

    container.style.display = 'block';
    container.innerHTML = '<div class="loading">Importing outside staff users...</div>';

    try {
        const response = await fetch('/api/import-users', {
            method: 'POST',
            body: formData
        });
        const data = await response.json();
        if (!response.ok) {
            container.innerHTML = `<div class="import-results-error">Error: ${data.error || 'Import failed.'}</div>`;
            return;
        }
        renderImportResults(data, 'outside_staff');
    } catch (err) {
        console.error('Error importing outside staff CSV:', err);
        container.innerHTML = '<div class="import-results-error">Error importing outside staff CSV. Please try again.</div>';
    }
}

async function importStudentCSV() {
    const input = document.getElementById('import-student-file');
    const container = document.getElementById('import-results');
    if (!input || !container) return;

    if (!input.files || input.files.length === 0) {
        showMessage('Please select a student CSV file to import.', 'error');
        return;
    }

    const formData = new FormData();
    formData.append('file', input.files[0]);
    formData.append('type', 'student');

    container.style.display = 'block';
    container.innerHTML = '<div class="loading">Importing students...</div>';

    try {
        const response = await fetch('/api/import-users', {
            method: 'POST',
            body: formData
        });
        const data = await response.json();
        if (!response.ok) {
            container.innerHTML = `<div class="import-results-error">Error: ${data.error || 'Import failed.'}</div>`;
            return;
        }
        renderImportResults(data, 'student');
    } catch (err) {
        console.error('Error importing student CSV:', err);
        container.innerHTML = '<div class="import-results-error">Error importing student CSV. Please try again.</div>';
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

// Info Modal Functions
const INFRACTION_OPTIONS = [
    'Aggression', 'Attention Seeking', 'Disrespectful', 'Language', 'MYOB', 'NFD',
    'Property Destruction', 'Off Task', 'Personal Space', 'Refusal', 'Self Control',
    'Sexual Reference', 'Shutdown', 'Threat', 'Volume', 'Walk Out'
];

const PURPOSE_OPTIONS = [
    'Obtain Peer Attention', 'Obtain Staff Attention', 'Obtain Item/Activity',
    'Avoid Peer', 'Avoid Staff', 'Avoid Task/Activity'
];

// Function to create a new infraction row
function createInfractionRow(infractionType = '', count = '', isReadOnly = false) {
    const row = document.createElement('div');
    row.className = 'form-group infraction-group';
    row.style.display = 'flex';
    row.style.alignItems = 'center';
    row.style.gap = '10px';
    row.style.marginBottom = '10px';
    
    const select = document.createElement('select');
    select.className = 'info-infraction-select';
    select.style.flex = '1';
    select.disabled = isReadOnly;
    
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'Select Infraction';
    select.appendChild(option);
    
    INFRACTION_OPTIONS.forEach(type => {
        const opt = document.createElement('option');
        opt.value = type;
        opt.textContent = type;
        if (type === infractionType) {
            opt.selected = true;
        }
        select.appendChild(opt);
    });
    
    const countInput = document.createElement('input');
    countInput.type = 'number';
    countInput.className = 'info-infraction-count';
    countInput.min = '0';
    countInput.placeholder = '#';
    countInput.style.width = '60px';
    countInput.value = count;
    countInput.disabled = isReadOnly;
    
    // Auto-set count to 1 when infraction is selected (if count is empty)
    select.addEventListener('change', function() {
        if (this.value && (!countInput.value || countInput.value === '0')) {
            countInput.value = '1';
        }
    });
    
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'delete-btn';
    removeBtn.textContent = '×';
    removeBtn.style.padding = '4px 8px';
    removeBtn.style.fontSize = '14px';
    removeBtn.disabled = isReadOnly;
    removeBtn.onclick = function() {
        row.remove();
    };
    
    row.appendChild(select);
    row.appendChild(countInput);
    if (!isReadOnly) {
        row.appendChild(removeBtn);
    }
    
    return row;
}

// Function to create a new purpose row
function createPurposeRow(purpose = '', isReadOnly = false) {
    const row = document.createElement('div');
    row.className = 'form-group purpose-row';
    row.style.display = 'flex';
    row.style.alignItems = 'center';
    row.style.gap = '10px';
    row.style.marginBottom = '10px';
    
    const select = document.createElement('select');
    select.className = 'info-purpose-select';
    select.style.flex = '1';
    select.disabled = isReadOnly;
    
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'Select Purpose';
    select.appendChild(option);
    
    PURPOSE_OPTIONS.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p;
        opt.textContent = p;
        if (p === purpose) {
            opt.selected = true;
        }
        select.appendChild(opt);
    });
    
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'delete-btn';
    removeBtn.textContent = '×';
    removeBtn.style.padding = '4px 8px';
    removeBtn.style.fontSize = '14px';
    removeBtn.disabled = isReadOnly;
    removeBtn.onclick = function() {
        row.remove();
    };
    
    row.appendChild(select);
    if (!isReadOnly) {
        row.appendChild(removeBtn);
    }
    
    return row;
}

async function showInfoModal(event) {
    const button = event.target;
    const studentId = button.dataset.studentId;
    const period = button.dataset.period;
    const studentName = button.dataset.studentName;
    const currentInfo = button.dataset.info || '';
    
    const modal = document.getElementById('info-modal');
    const modalTitle = document.getElementById('info-modal-title');
    
    const viewOnly = isStudent() ? ' (View Only)' : '';
    modalTitle.textContent = `Additional Information - ${studentName} - ${period}${viewOnly}`;
    
    // Parse existing info (stored as JSON string)
    let infoData = {};
    if (currentInfo) {
        try {
            infoData = JSON.parse(currentInfo);
        } catch (e) {
            // If it's old plain text data, put it in notes
            infoData = { notes: currentInfo };
        }
    }
    
    // Populate form fields and disable for students
    const isReadOnly = isStudent();
    
    // Get student's card color
    const studentIdInt = parseInt(studentId);
    const student = allStudents.find(s => s.id === studentIdInt);
    const cardColor = student?.card_color || null;
    
    // Basic fields
    document.getElementById('info-notes').value = infoData.notes || '';
    document.getElementById('info-notes').disabled = isReadOnly;
    
    // Alternate Location
    const alternateLocationInput = document.getElementById('info-alternate-location');
    alternateLocationInput.value = infoData.alternate_location || '';
    alternateLocationInput.disabled = isReadOnly;
    
    // Load alternate locations from API and add default locations
    if (!isReadOnly) {
        // Default locations that should always be available
        const defaultLocations = ['Studio', 'Reflection Room', 'Professional', 'Hallway', 'Calming Room', 'Outside', 'Off Campus'];
        
        try {
            const response = await fetch('/api/schedules/locations');
            if (response.ok) {
                const apiLocations = await response.json();
                // Combine default locations with API locations, removing duplicates
                const allLocations = [...new Set([...defaultLocations, ...apiLocations])].sort();
                const datalist = document.getElementById('alternate-location-options');
                datalist.innerHTML = '';
                allLocations.forEach(location => {
                    const option = document.createElement('option');
                    option.value = location;
                    datalist.appendChild(option);
                });
                
                // Store locations for autocomplete matching
                alternateLocationInput.dataset.locations = JSON.stringify(allLocations);
            } else {
                // If API fails, at least use default locations
                const datalist = document.getElementById('alternate-location-options');
                datalist.innerHTML = '';
                defaultLocations.forEach(location => {
                    const option = document.createElement('option');
                    option.value = location;
                    datalist.appendChild(option);
                });
                alternateLocationInput.dataset.locations = JSON.stringify(defaultLocations);
            }
        } catch (error) {
            console.error('Error loading alternate locations:', error);
            // If API fails, at least use default locations
            const datalist = document.getElementById('alternate-location-options');
            datalist.innerHTML = '';
            defaultLocations.forEach(location => {
                const option = document.createElement('option');
                option.value = location;
                datalist.appendChild(option);
            });
            alternateLocationInput.dataset.locations = JSON.stringify(defaultLocations);
        }
        
        // Set up autocomplete behavior - auto-select top matching result on Enter
        alternateLocationInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                const inputValue = this.value.trim();
                const locationsStr = this.dataset.locations;
                
                if (locationsStr && inputValue) {
                    const locations = JSON.parse(locationsStr);
                    // Find first matching location (case-insensitive, starts with or exact match)
                    const match = locations.find(loc => {
                        const locLower = loc.toLowerCase();
                        const inputLower = inputValue.toLowerCase();
                        return locLower === inputLower || locLower.startsWith(inputLower);
                    });
                    
                    if (match) {
                        this.value = match;
                        // Trigger input event to ensure value is set
                        this.dispatchEvent(new Event('input', { bubbles: true }));
                    }
                }
                // Blur to confirm selection
                this.blur();
            }
        });
        
        // Auto-select top matching result as user types
        alternateLocationInput.addEventListener('input', function(e) {
            // Don't interfere if user is selecting text or using arrow keys
            if (this.selectionStart !== this.selectionEnd) return;
            
            const inputValue = this.value;
            if (!inputValue) return;
            
            const locationsStr = this.dataset.locations;
            if (!locationsStr) return;
            
            const locations = JSON.parse(locationsStr);
            
            // Find first matching location (case-insensitive)
            const match = locations.find(loc => 
                loc.toLowerCase().startsWith(inputValue.toLowerCase())
            );
            
            if (match && match.toLowerCase() !== inputValue.toLowerCase()) {
                // Store cursor position before we modify the value
                const cursorPos = this.selectionStart;
                
                // Only auto-complete if cursor is at the end
                if (cursorPos === inputValue.length) {
                    // Set the full match and highlight the completion part
                    this.value = match;
                    this.setSelectionRange(inputValue.length, match.length);
                }
            }
        });
    }
    
    // Reminders
    const reminder1 = document.getElementById('info-reminder-1');
    const reminder2 = document.getElementById('info-reminder-2');
    const reminder3 = document.getElementById('info-reminder-3');
    const resetCheckbox = document.getElementById('info-reset');
    const resetWarning = document.getElementById('info-reset-warning');
    
    // Determine which reminders to show based on card color
    // Default to yellow behavior (3 reminders) if no color set
    const effectiveColor = cardColor || 'yellow';
    
    // Show/hide reminder checkboxes based on card color
    if (effectiveColor === 'blue') {
        // Blue: Show only reminder 1
        reminder1.style.display = 'inline';
        reminder2.style.display = 'none';
        reminder3.style.display = 'none';
    } else if (effectiveColor === 'green') {
        // Green: Show only reminders 1 and 2
        reminder1.style.display = 'inline';
        reminder2.style.display = 'inline';
        reminder3.style.display = 'none';
    } else {
        // Yellow or default: Show all 3 reminders
        reminder1.style.display = 'inline';
        reminder2.style.display = 'inline';
        reminder3.style.display = 'inline';
    }
    
    reminder1.checked = infoData.reminder1 || false;
    reminder1.disabled = isReadOnly;
    reminder2.checked = infoData.reminder2 || false;
    reminder2.disabled = isReadOnly;
    reminder3.checked = infoData.reminder3 || false;
    reminder3.disabled = isReadOnly;
    resetCheckbox.checked = infoData.reset || false;
    resetCheckbox.disabled = isReadOnly;
    
    // Show/hide reset warning based on current state
    resetWarning.style.display = resetCheckbox.checked ? 'inline' : 'none';
    
    // Event listeners for reminder checkboxes - show warning based on card color
    if (!isReadOnly) {
        // Remove old listeners by cloning and replacing
        const newReminder1 = reminder1.cloneNode(true);
        const newReminder2 = reminder2.cloneNode(true);
        const newReminder3 = reminder3.cloneNode(true);
        const newResetCheckbox = resetCheckbox.cloneNode(true);
        
        reminder1.parentNode.replaceChild(newReminder1, reminder1);
        reminder2.parentNode.replaceChild(newReminder2, reminder2);
        reminder3.parentNode.replaceChild(newReminder3, reminder3);
        resetCheckbox.parentNode.replaceChild(newResetCheckbox, resetCheckbox);
        
        // Update references to new elements
        const currentReminder1 = newReminder1;
        const currentReminder2 = newReminder2;
        const currentReminder3 = newReminder3;
        const currentResetCheckbox = newResetCheckbox;
        
        // Function to show warning based on card color when appropriate reminder is checked
        const checkRemindersAndShowWarning = () => {
            if (effectiveColor === 'blue') {
                // Blue: Show warning when reminder 1 is checked
                if (currentReminder1.checked) {
                    resetWarning.style.display = 'inline';
                } else {
                    resetWarning.style.display = 'none';
                }
            } else if (effectiveColor === 'green') {
                // Green: Show warning when reminder 2 is checked
                if (currentReminder2.checked) {
                    resetWarning.style.display = 'inline';
                } else {
                    resetWarning.style.display = 'none';
                }
            } else {
                // Yellow or default: Show warning when reminder 3 is checked
                if (currentReminder3.checked) {
                    resetWarning.style.display = 'inline';
                } else {
                    resetWarning.style.display = 'none';
                }
            }
        };
        
        // Add event listeners to show warning when appropriate reminder is checked
        currentReminder1.addEventListener('change', checkRemindersAndShowWarning);
        currentReminder2.addEventListener('change', checkRemindersAndShowWarning);
        currentReminder3.addEventListener('change', checkRemindersAndShowWarning);
        
        // Reset checkbox warning toggle
        currentResetCheckbox.addEventListener('change', function() {
            resetWarning.style.display = this.checked ? 'inline' : 'none';
            // Also show/hide Frenzy warnings (both in Frenzy line and Reset line) when reset is checked
            const frenzyWarning = document.getElementById('info-frenzy-warning');
            const resetFrenzyWarning = document.getElementById('info-reset-frenzy-warning');
            if (frenzyWarning) {
                frenzyWarning.style.display = this.checked ? 'inline' : 'none';
            }
            if (resetFrenzyWarning) {
                resetFrenzyWarning.style.display = this.checked ? 'inline' : 'none';
            }
        });
        
        // Check initial state to show warning if appropriate reminder is already checked
        checkRemindersAndShowWarning();
    }
    
    // Infractions - handle backward compatibility and populate dynamic rows
    const infractionsContainer = document.getElementById('infractions-container');
    infractionsContainer.innerHTML = '';
    
    let infractions = [];
    if (infoData.infractions && Array.isArray(infoData.infractions)) {
        // New format
        infractions = infoData.infractions;
    } else {
        // Backward compatibility - convert old format to array
        if (infoData.infraction1) {
            infractions.push({
                type: infoData.infraction1,
                count: infoData.infraction1Count || '1'
            });
        }
        if (infoData.infraction2) {
            infractions.push({
                type: infoData.infraction2,
                count: infoData.infraction2Count || '1'
            });
        }
    }
    
    // Always show at least one empty row if no infractions
    if (infractions.length === 0) {
        infractions.push({ type: '', count: '' });
    }
    
    infractions.forEach(inf => {
        const row = createInfractionRow(inf.type, inf.count || '', isReadOnly);
        infractionsContainer.appendChild(row);
    });
    
    // Purposes - handle backward compatibility and populate dynamic rows
    const purposesContainer = document.getElementById('purposes-container');
    purposesContainer.innerHTML = '';
    
    let purposes = [];
    if (infoData.purposes && Array.isArray(infoData.purposes)) {
        // New format
        purposes = infoData.purposes;
    } else {
        // Backward compatibility - convert old format to array
        if (infoData.purpose1) {
            purposes.push(infoData.purpose1);
        }
        if (infoData.purpose2) {
            purposes.push(infoData.purpose2);
        }
    }
    
    // Always show at least one empty row if no purposes
    if (purposes.length === 0) {
        purposes.push('');
    }
    
    purposes.forEach(purpose => {
        const row = createPurposeRow(purpose, isReadOnly);
        purposesContainer.appendChild(row);
    });
    
    // Add button event listeners
    const addInfractionBtn = document.getElementById('add-infraction-btn');
    const addPurposeBtn = document.getElementById('add-purpose-btn');
    
    // Remove old listeners by replacing buttons
    const newAddInfractionBtn = addInfractionBtn.cloneNode(true);
    const newAddPurposeBtn = addPurposeBtn.cloneNode(true);
    addInfractionBtn.parentNode.replaceChild(newAddInfractionBtn, addInfractionBtn);
    addPurposeBtn.parentNode.replaceChild(newAddPurposeBtn, addPurposeBtn);
    
    if (!isReadOnly) {
        newAddInfractionBtn.addEventListener('click', function() {
            const row = createInfractionRow('', '', false);
            infractionsContainer.appendChild(row);
        });
        
        newAddPurposeBtn.addEventListener('click', function() {
            const row = createPurposeRow('', false);
            purposesContainer.appendChild(row);
        });
    } else {
        newAddInfractionBtn.style.display = 'none';
        newAddPurposeBtn.style.display = 'none';
    }
    
    // Other fields
    const frenzyCheckbox = document.getElementById('info-frenzy');
    const frenzyWarning = document.getElementById('info-frenzy-warning');
    frenzyCheckbox.checked = infoData.frenzy || false;
    frenzyCheckbox.disabled = isReadOnly;
    
    // Show/hide frenzy warnings (both in Frenzy line and Reset line) based on reset checkbox state
    const resetFrenzyWarning = document.getElementById('info-reset-frenzy-warning');
    if (frenzyWarning) {
        frenzyWarning.style.display = resetCheckbox.checked ? 'inline' : 'none';
    }
    if (resetFrenzyWarning) {
        resetFrenzyWarning.style.display = resetCheckbox.checked ? 'inline' : 'none';
    }
    
    document.getElementById('info-duration').value = infoData.duration || '';
    document.getElementById('info-duration').disabled = isReadOnly;
    document.getElementById('info-results').value = infoData.results || '';
    document.getElementById('info-results').disabled = isReadOnly;
    
    // Store context for saving
    modal.dataset.studentId = studentId;
    modal.dataset.period = period;
    
    // Store edit point card context if applicable
    if (button.dataset.isEditPointCard === 'true') {
        modal.dataset.isEditPointCard = 'true';
        modal.dataset.periodIndex = button.dataset.periodIndex || '';
        // Ensure info modal appears above edit point card modal
        modal.style.zIndex = '2000';
    }
    
    modal.style.display = 'block';
}

function closeInfoModal() {
    const modal = document.getElementById('info-modal');
    modal.style.display = 'none';
}

function saveInfoModal() {
    // Students cannot save
    if (isStudent()) {
        showMessage('View-only access. Contact staff to make changes.', 'error');
        return;
    }
    
    const modal = document.getElementById('info-modal');
    const studentId = modal.dataset.studentId;
    const period = modal.dataset.period;
    
    // Collect all form data
    const infoData = {
        notes: document.getElementById('info-notes').value,
        reminder1: document.getElementById('info-reminder-1').checked,
        reminder2: document.getElementById('info-reminder-2').checked,
        reminder3: document.getElementById('info-reminder-3').checked,
        reset: document.getElementById('info-reset').checked,
        alternate_location: document.getElementById('info-alternate-location').value || '',
        frenzy: document.getElementById('info-frenzy').checked,
        duration: document.getElementById('info-duration').value,
        results: document.getElementById('info-results').value
    };
    
    // Collect infractions from dynamic rows
    const infractions = [];
    const infractionRows = document.querySelectorAll('#infractions-container .infraction-group');
    infractionRows.forEach(row => {
        const select = row.querySelector('.info-infraction-select');
        const countInput = row.querySelector('.info-infraction-count');
        if (select && select.value) {
            infractions.push({
                type: select.value,
                count: countInput.value || '1'
            });
        }
    });
    infoData.infractions = infractions;
    
    // Collect purposes from dynamic rows
    const purposes = [];
    const purposeRows = document.querySelectorAll('#purposes-container .purpose-row');
    purposeRows.forEach(row => {
        const select = row.querySelector('.info-purpose-select');
        if (select && select.value) {
            purposes.push(select.value);
        }
    });
    infoData.purposes = purposes;
    
    // Convert to JSON string
    const infoString = JSON.stringify(infoData);
    
    // Update dailyData
    if (!dailyData[studentId]) {
        dailyData[studentId] = {};
    }
    if (!dailyData[studentId][period]) {
        dailyData[studentId][period] = { s: null, t: null, a: null, r: null, info: '' };
    }
    dailyData[studentId][period].info = infoString;

    // Update periodData if current view is period-entry
    if (periodData[studentId] !== undefined || document.getElementById('period-entry-view').classList.contains('active')) {
        if (!periodData[studentId]) {
            periodData[studentId] = { student_id: studentId };
        }
        periodData[studentId].info = infoString;
    }
    
    // Update the button's data attribute
    const button = document.querySelector(`button.info-btn[data-student-id="${studentId}"][data-period="${period}"]`);
    if (button) {
        button.dataset.info = infoString;
        // Add visual indicator if there's data
        if (hasInfoData(infoData)) {
            button.classList.add('has-data');
        } else {
            button.classList.remove('has-data');
        }
    }
    
    // If we're in edit point card context, update the editing record
    if (modal.dataset.isEditPointCard === 'true' && window.editingPointCardRecord) {
        const periodIndex = parseInt(modal.dataset.periodIndex);
        if (periodIndex !== undefined && window.editingPointCardRecord.periods[periodIndex]) {
            window.editingPointCardRecord.periods[periodIndex].info = infoString;
            
            // Update the button text in the edit modal
            const editModal = document.getElementById('edit-point-card-modal');
            if (editModal) {
                const infoButton = editModal.querySelector(`.info-btn-small[data-period-index="${periodIndex}"]`);
                if (infoButton) {
                    infoButton.textContent = hasInfoData(infoData) ? 'Edit' : 'Add';
                }
            }
        }
    }
    
    closeInfoModal();
    showMessage('Information saved!', 'success');
}

// Helper function to check if info data has any content
function hasInfoData(infoData) {
    // Check new format
    const hasInfractions = (infoData.infractions && Array.isArray(infoData.infractions) && infoData.infractions.length > 0) ||
                          (infoData.infraction1 || infoData.infraction2); // Backward compatibility
    const hasPurposes = (infoData.purposes && Array.isArray(infoData.purposes) && infoData.purposes.length > 0) ||
                       (infoData.purpose1 || infoData.purpose2); // Backward compatibility
    
    return infoData.notes || 
           infoData.reminder1 || infoData.reminder2 || infoData.reminder3 ||
           infoData.reset || 
           hasInfractions ||
           infoData.frenzy ||
           hasPurposes ||
           infoData.duration ||
           infoData.results ||
           infoData.alternate_location;
}

// Function to show info popup in summary view (read-only)
function showInfoViewPopup(infoDataString, time, location) {
    // Parse the info data
    let infoData = {};
    if (infoDataString) {
        try {
            infoData = JSON.parse(infoDataString);
        } catch (e) {
            // If it's old plain text data, put it in notes
            infoData = { notes: infoDataString };
        }
    }
    
    // Create modal HTML
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.id = 'info-view-modal';
    modal.style.display = 'block';
    
    // Build the content HTML
    let contentHtml = `
        <div class="modal-content info-modal-large" style="max-width: 700px;">
            <span class="close" onclick="document.getElementById('info-view-modal').remove()">&times;</span>
            <h2>Additional Information</h2>
            <p style="color: var(--text-secondary); margin-bottom: 20px;"><strong>Time:</strong> ${time || 'N/A'} | <strong>Location:</strong> ${location || 'N/A'}</p>
            
            <div class="info-form-grid" style="pointer-events: none;">
                <!-- Notes -->
                <div class="form-group">
                    <label>Notes:</label>
                    <div style="background: var(--bg-elevated); padding: 10px; border-radius: 4px; min-height: 60px; white-space: pre-wrap;">${(infoData.notes || '').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
                </div>

                <!-- Reminders -->
                <div class="form-group">
                    <label>Reminders:</label>
                    <div style="padding: 10px; background: var(--bg-elevated); border-radius: 4px;">
                        Reminders: ${(infoData.reminder1 ? 1 : 0) + (infoData.reminder2 ? 1 : 0) + (infoData.reminder3 ? 1 : 0)}
                    </div>
                </div>

                <!-- Reset -->
                <div class="form-group">
                    <label>Reset:</label>
                    <div style="padding: 10px; background: var(--bg-elevated); border-radius: 4px;">${infoData.reset ? '✓ Yes' : '✗ No'}</div>
                </div>

                <!-- Alternate Location -->
                ${infoData.alternate_location ? `
                <div class="form-group">
                    <label>Alternate Location:</label>
                    <div style="padding: 10px; background: var(--bg-elevated); border-radius: 4px;">${(infoData.alternate_location || '').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
                </div>
                ` : ''}

                <!-- Infractions -->
                <div class="form-group infraction-group">
                    <label>Infractions:</label>
                    <div style="padding: 10px; background: var(--bg-elevated); border-radius: 4px;">
                        ${(() => {
                            let infractionsHtml = '';
                            if (infoData.infractions && Array.isArray(infoData.infractions)) {
                                // New format
                                if (infoData.infractions.length > 0) {
                                    infractionsHtml = infoData.infractions.map(inf => 
                                        `${(inf.type || '').replace(/</g, '&lt;').replace(/>/g, '&gt;')} (Count: ${inf.count || 1})`
                                    ).join('<br>');
                                } else {
                                    infractionsHtml = 'None';
                                }
                            } else {
                                // Backward compatibility
                                const infractions = [];
                                if (infoData.infraction1) {
                                    infractions.push(`${(infoData.infraction1 || '').replace(/</g, '&lt;').replace(/>/g, '&gt;')} (Count: ${infoData.infraction1Count || 1})`);
                                }
                                if (infoData.infraction2) {
                                    infractions.push(`${(infoData.infraction2 || '').replace(/</g, '&lt;').replace(/>/g, '&gt;')} (Count: ${infoData.infraction2Count || 1})`);
                                }
                                infractionsHtml = infractions.length > 0 ? infractions.join('<br>') : 'None';
                            }
                            return infractionsHtml;
                        })()}
                    </div>
                </div>

                <!-- Frenzy -->
                <div class="form-group">
                    <label>Frenzy:</label>
                    <div style="padding: 10px; background: var(--bg-elevated); border-radius: 4px;">${infoData.frenzy ? '✓ Yes' : '✗ No'}</div>
                </div>

                <!-- Purposes -->
                <div class="form-group">
                    <label>Purposes:</label>
                    <div style="padding: 10px; background: var(--bg-elevated); border-radius: 4px;">
                        ${(() => {
                            let purposesHtml = '';
                            if (infoData.purposes && Array.isArray(infoData.purposes)) {
                                // New format
                                if (infoData.purposes.length > 0) {
                                    purposesHtml = infoData.purposes.map(p => 
                                        (p || '').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                                    ).join('<br>');
                                } else {
                                    purposesHtml = 'None';
                                }
                            } else {
                                // Backward compatibility
                                const purposes = [];
                                if (infoData.purpose1) purposes.push(infoData.purpose1);
                                if (infoData.purpose2) purposes.push(infoData.purpose2);
                                purposesHtml = purposes.length > 0 
                                    ? purposes.map(p => (p || '').replace(/</g, '&lt;').replace(/>/g, '&gt;')).join('<br>')
                                    : 'None';
                            }
                            return purposesHtml;
                        })()}
                    </div>
                </div>

                <!-- Duration -->
                <div class="form-group">
                    <label>Duration (minutes):</label>
                    <div style="padding: 10px; background: var(--bg-elevated); border-radius: 4px;">${infoData.duration || 'None'}</div>
                </div>

                <!-- Results of Behavior -->
                <div class="form-group">
                    <label>Results of Behavior:</label>
                    <div style="background: var(--bg-elevated); padding: 10px; border-radius: 4px; min-height: 60px; white-space: pre-wrap;">${(infoData.results || '').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
                </div>
            </div>

            <div class="modal-buttons" style="margin-top: 20px;">
                <button onclick="document.getElementById('info-view-modal').remove()" class="btn-secondary">Close</button>
            </div>
        </div>
    `;
    
    modal.innerHTML = contentHtml;
    document.body.appendChild(modal);
    
    // Close modal when clicking outside
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.remove();
        }
    });
}

// Starbucks management (Bank Account tab, staff/admin)
function initStarbucksManagement() {
    const studentSearchInput = document.getElementById('starbucks-student-search');
    const staffSearchInput = document.getElementById('starbucks-staff-search');
    const managedByMeCheckbox = document.getElementById('starbucks-managed-by-me-checkbox');
    const submitBtn = document.getElementById('starbucks-submit-btn');
    const studentDropdown = document.getElementById('starbucks-student-dropdown');
    const staffDropdown = document.getElementById('starbucks-staff-dropdown');

    if (!studentSearchInput && !staffSearchInput && !managedByMeCheckbox && !submitBtn) {
        return;
    }

    if (studentSearchInput && studentSearchInput._starbucksBound) return;
    if (studentSearchInput) studentSearchInput._starbucksBound = true;

    async function loadStarbucksData() {
        const studentQuery = studentSearchInput ? studentSearchInput.value.trim() : '';
        const staffQuery = staffSearchInput ? staffSearchInput.value.trim() : '';
        const managed = !!(managedByMeCheckbox && managedByMeCheckbox.checked);

        const params = new URLSearchParams();
        const q = studentQuery || staffQuery;
        if (q) params.append('q', q);
        if (managed) params.append('managed_by_me', 'true');

        const container = document.getElementById('starbucks-table-body');
        if (container) {
            container.innerHTML = `
                <tr>
                    <td colspan="2" style="padding: 12px; border: 1px solid var(--border); text-align: center; color: #94a3b8;">
                        Loading Starbucks data...
                    </td>
                </tr>
            `;
        }

        try {
            const response = await fetch('/api/starbucks?' + params.toString());
            if (!response.ok) {
                throw new Error('Failed to load Starbucks data');
            }
            const data = await response.json();
            starbucksRows = Array.isArray(data) ? data : [];
            renderStarbucksTable();
        } catch (err) {
            console.error('Error loading Starbucks data:', err);
            if (container) {
                container.innerHTML = `
                    <tr>
                        <td colspan="2" style="padding: 12px; border: 1px solid var(--border); text-align: center; color: #dc2626;">
                            Error loading Starbucks data. Please try again.
                        </td>
                    </tr>
                `;
            }
        }
    }

    function setupStarbucksAutocomplete(input, dropdown, type) {
        if (!input || !dropdown) return;

        let debounceTimer = null;
        let attemptedLoadData = false;

        input.addEventListener('input', () => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(async () => {
                const q = input.value.trim().toLowerCase();
                if (!q) {
                    dropdown.classList.remove('active');
                    dropdown.innerHTML = '';
                    return;
                }

                let list = type === 'student' ? (allStudents || []) : (allStaffMembers || []);

                if (list.length === 0 && !attemptedLoadData) {
                    attemptedLoadData = true;
                    try {
                        if (type === 'student' && typeof loadStudents === 'function') {
                            await loadStudents();
                            list = allStudents || [];
                        } else if (type === 'staff' && typeof loadUsers === 'function') {
                            await loadUsers();
                            list = allStaffMembers || [];
                        }
                    } catch (e) {
                        console.error('Error loading data for Starbucks search:', e);
                    }
                }

                const matches = list.filter(item => {
                    const name = (item.name || '').toLowerCase();
                    const uname = (item.username || '').toLowerCase();
                    return name.includes(q) || uname.includes(q);
                }).slice(0, 12);

                if (!matches.length) {
                    dropdown.classList.remove('active');
                    dropdown.innerHTML = '';
                    return;
                }

                dropdown.innerHTML = matches.map(item => {
                    const label = item.name || item.username || '';
                    const meta = type === 'staff' ? (item.designation || item.role || '') : '';
                    return `<div class="dashboard-search-option" data-id="${item.id}" data-name="${label}" data-type="${type}">
                        <span class="search-label">${escapeHtml(label)}</span>
                        ${meta ? `<span class="search-meta">${escapeHtml(meta)}</span>` : ''}
                    </div>`;
                }).join('');
                dropdown.classList.add('active');
            }, 150);
        });

        dropdown.addEventListener('click', (e) => {
            const opt = e.target.closest('.dashboard-search-option');
            if (!opt) return;
            const name = opt.dataset.name || '';
            input.value = name;
            dropdown.classList.remove('active');

            if (type === 'student' && staffSearchInput) {
                staffSearchInput.value = '';
            } else if (type === 'staff' && studentSearchInput) {
                studentSearchInput.value = '';
            }

            // When a Starbucks search is committed, clear "managed by me" so it does not persist across searches.
            if (managedByMeCheckbox && managedByMeCheckbox.checked) {
                managedByMeCheckbox.checked = false;
            }

            loadStarbucksData();
        });

        input.addEventListener('focus', () => {
            if (dropdown.children.length > 0 && input.value.trim().length > 0) {
                dropdown.classList.add('active');
            }
        });

        document.addEventListener('click', (e) => {
            if (!e.target.closest('#starbucks-section')) {
                dropdown.classList.remove('active');
            }
        });

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                dropdown.classList.remove('active');
                return;
            }
            if (e.key === 'Enter') {
                e.preventDefault();
                dropdown.classList.remove('active');
                if (type === 'student' && staffSearchInput) {
                    staffSearchInput.value = '';
                } else if (type === 'staff' && studentSearchInput) {
                    studentSearchInput.value = '';
                }
                // When a Starbucks search is committed via Enter, clear "managed by me" so it does not persist across searches.
                if (managedByMeCheckbox && managedByMeCheckbox.checked) {
                    managedByMeCheckbox.checked = false;
                }
                loadStarbucksData();
            }
        });
    }

    function renderStarbucksTable() {
        const tbody = document.getElementById('starbucks-table-body');
        if (!tbody) return;

        if (!starbucksRows || starbucksRows.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="2" style="padding: 12px; border: 1px solid var(--border); text-align: center; color: #94a3b8;">
                        No students found for the current filters.
                    </td>
                </tr>
            `;
            return;
        }

        tbody.innerHTML = '';
        const sortedRows = [...starbucksRows].sort((a, b) => {
            const aVal = typeof a.starbucks_count === 'number'
                ? a.starbucks_count
                : (a.starbucks_count ? Number(a.starbucks_count) || 0 : 0);
            const bVal = typeof b.starbucks_count === 'number'
                ? b.starbucks_count
                : (b.starbucks_count ? Number(b.starbucks_count) || 0 : 0);
            if (bVal !== aVal) return bVal - aVal;
            const aName = (a.student_name || '').toLowerCase();
            const bName = (b.student_name || '').toLowerCase();
            if (aName < bName) return -1;
            if (aName > bName) return 1;
            return 0;
        });
        sortedRows.forEach((row) => {
            const tr = document.createElement('tr');

            const nameTd = document.createElement('td');
            nameTd.style.padding = '10px 12px';
            nameTd.style.border = '1px solid var(--border)';
            nameTd.style.whiteSpace = 'nowrap';
            nameTd.textContent = row.student_name || '';

            const countTd = document.createElement('td');
            countTd.style.padding = '10px 12px';
            countTd.style.border = '1px solid var(--border)';

            const input = document.createElement('input');
            input.type = 'text';
            input.inputMode = 'numeric';
            input.value = typeof row.starbucks_count === 'number'
                ? row.starbucks_count
                : (row.starbucks_count ? Number(row.starbucks_count) || 0 : 0);
            input.dataset.studentId = row.student_id;
            input.className = 'starbucks-count-input';
            input.style.width = '7ch';
            input.style.padding = '6px 8px';

            input.addEventListener('input', () => {
                const val = parseInt(input.value, 10);
                const safeVal = isNaN(val) || val < 0 ? 0 : val;
                input.value = safeVal;
                const idx = starbucksRows.findIndex(r => r.student_id === row.student_id);
                if (idx !== -1) {
                    starbucksRows[idx].starbucks_count = safeVal;
                }
                scheduleStarbucksAutosave();
            });

            countTd.appendChild(input);
            tr.appendChild(nameTd);
            tr.appendChild(countTd);
            tbody.appendChild(tr);
        });
    }

    function updateStarbucksSaveStatus(text) {
        const statusEl = document.getElementById('starbucks-save-status');
        if (statusEl) {
            statusEl.textContent = text || '';
        }
    }

    function scheduleStarbucksAutosave() {
        updateStarbucksSaveStatus('Saving...');
        if (starbucksAutosaveTimer) {
            clearTimeout(starbucksAutosaveTimer);
        }
        starbucksAutosaveTimer = setTimeout(() => {
            starbucksAutosaveTimer = null;
            saveStarbucksData({ silent: true });
        }, 1500);
    }

    async function saveStarbucksData(options = {}) {
        const { silent = false } = options;
        const rowsPayload = (starbucksRows || []).map((row) => ({
            student_id: row.student_id,
            count: typeof row.starbucks_count === 'number'
                ? row.starbucks_count
                : (row.starbucks_count ? Number(row.starbucks_count) || 0 : 0),
        }));

        if (!rowsPayload.length) {
            if (!silent) {
                updateStarbucksSaveStatus('No Starbucks data to save');
            } else {
                updateStarbucksSaveStatus('');
            }
            return;
        }

        try {
            const response = await fetch('/api/starbucks/bulk', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ rows: rowsPayload }),
            });
            if (!response.ok) {
                throw new Error('Failed to save Starbucks data');
            }
            if (!silent) {
                showMessage('Starbucks table saved successfully!', 'success');
                if (studentSearchInput) {
                    studentSearchInput.value = '';
                }
                if (staffSearchInput) {
                    staffSearchInput.value = '';
                }
                loadStarbucksData();
            }
            updateStarbucksSaveStatus('All changes saved');
        } catch (err) {
            console.error('Error saving Starbucks data:', err);
            if (!silent) {
                showMessage('Error saving Starbucks data. Please try again.', 'error');
            }
            updateStarbucksSaveStatus('Save failed');
        }
    }

    setupStarbucksAutocomplete(studentSearchInput, studentDropdown, 'student');
    setupStarbucksAutocomplete(staffSearchInput, staffDropdown, 'staff');

    if (studentSearchInput) {
        studentSearchInput.addEventListener('input', () => {
            if (staffSearchInput) staffSearchInput.value = '';
            loadStarbucksData();
        });
    }

    if (staffSearchInput) {
        staffSearchInput.addEventListener('input', () => {
            if (studentSearchInput) studentSearchInput.value = '';
            loadStarbucksData();
        });
    }

    if (managedByMeCheckbox && !managedByMeCheckbox._starbucksManagedBound) {
        managedByMeCheckbox._starbucksManagedBound = true;
        managedByMeCheckbox.addEventListener('change', () => {
            loadStarbucksData();
        });
    }

    if (submitBtn && !submitBtn._starbucksSubmitBound) {
        submitBtn._starbucksSubmitBound = true;
        submitBtn.addEventListener('click', () => {
            saveStarbucksData({ silent: false });
        });
    }

    loadStarbucksData();
}

// Make functions globally accessible
window.showInfoModal = showInfoModal;
window.closeInfoModal = closeInfoModal;
window.saveInfoModal = saveInfoModal;
window.showInfoViewPopup = showInfoViewPopup;

// Schedule Management Functions
let teacherScheduleData = [];
let studentScheduleData = [];
let currentScheduleStudentId = null;
let currentTeacherScheduleUserId = null; // User ID whose teacher schedule is being viewed (null = current user)
let allTeacherClassNames = []; // Store all class names from all teacher schedules

// Function to fetch all class names from all teacher schedules
async function fetchAllTeacherClassNames() {
    try {
        const response = await fetch('/api/schedules/locations');
        if (response.ok) {
            const classNames = await response.json();
            allTeacherClassNames = Array.isArray(classNames) ? classNames : [];
            console.log('Loaded class names from teacher schedules:', allTeacherClassNames);
            // Class autocomplete dropdowns will automatically use the updated allTeacherClassNames
        } else {
            console.error('Failed to fetch teacher class names:', response.statusText);
            allTeacherClassNames = [];
        }
    } catch (error) {
        console.error('Error fetching teacher class names:', error);
        allTeacherClassNames = [];
    }
}

// Function to update all class autocomplete dropdowns when class names are loaded
function updateAllClassAutocompletes() {
    const tbody = document.getElementById('student-schedule-body');
    if (!tbody) return;
    
    // All class inputs will automatically use the updated allTeacherClassNames
    // when they are focused or typed in, so no manual update needed
}

function loadSchedules(type, studentId = null, teacherUserId = null) {
    let url = `/api/schedules?schedule_type=${type}`;
    if (studentId) {
        url += `&student_id=${studentId}`;
    }
    if (type === 'teacher' && teacherUserId != null) {
        url += `&user_id=${teacherUserId}`;
    }

    return fetch(url)
        .then(response => {
            if (!response.ok && response.status === 403) {
                return response.json().then(err => Promise.reject(new Error(err.error || 'Permission denied')));
            }
            return response.json();
        })
        .then(data => {
            if (type === 'teacher') {
                currentTeacherScheduleUserId = teacherUserId != null ? teacherUserId : (window.currentUser && window.currentUser.id);
                teacherScheduleData = Array.isArray(data) ? data : [];
                renderTeacherSchedule();
                updateTeacherScheduleSubtitle();
                updateTeacherScheduleEditability();
                // Auto-select current period if we're in period-entry view
                if (document.getElementById('period-entry-view')?.classList.contains('active')) {
                    setTimeout(() => {
                        autoSelectCurrentPeriod();
                    }, 100);
                }
            } else {
                studentScheduleData = data;
                renderStudentSchedule();
            }
            return data;
        })
        .catch(error => {
            console.error('Error loading schedules:', error);
            throw error;
        });
}

function updateTeacherScheduleSubtitle() {
    const el = document.getElementById('teacher-schedule-subtitle');
    if (!el || !window.currentUser) return;
    const uid = currentTeacherScheduleUserId != null ? currentTeacherScheduleUserId : window.currentUser.id;
    const name = (uid === window.currentUser.id)
        ? (window.currentUser.name || window.currentUser.username)
        : (allStaffMembers.find(u => u.id === uid)?.name || allStaffMembers.find(u => u.id === uid)?.username || 'Staff');
    el.textContent = `${name}'s Schedule`;
}

function updateTeacherScheduleEditability() {
    const canEdit = window.currentUser && (
        currentTeacherScheduleUserId == null ||
        currentTeacherScheduleUserId === window.currentUser.id ||
        window.currentUser.role === 'admin'
    );
    const addBtn = document.getElementById('add-teacher-period-btn');
    const saveBtn = document.getElementById('save-teacher-schedule-btn');
    const tbody = document.getElementById('teacher-schedule-body');
    if (addBtn) addBtn.style.display = canEdit ? '' : 'none';
    if (saveBtn) saveBtn.style.display = canEdit ? '' : 'none';
    if (tbody) {
        tbody.querySelectorAll('.time-input, .class-input, .btn-add-class, .btn-remove-class').forEach(el => {
            if (el.classList && (el.classList.contains('time-input') || el.classList.contains('class-input'))) {
                el.readOnly = !canEdit;
                el.disabled = !canEdit;
            }
            if (el.classList && (el.classList.contains('btn-add-class') || el.classList.contains('btn-remove-class'))) {
                el.style.display = canEdit ? '' : 'none';
                el.disabled = !canEdit;
            }
        });
    }
}

function populateTeacherScheduleStaffSearch() {
    const select = document.getElementById('teacher-schedule-staff-search');
    if (!select || !window.currentUser || !window.currentUser.role) return;
    const role = window.currentUser.role;
    if (role !== 'staff' && role !== 'admin') return;

    // Only show staff users in this dropdown (not admins)
    let list = (allStaffMembers || []).filter(u => u.role === 'staff');
    list.sort((a, b) => (a.name || a.username || '').localeCompare(b.name || b.username || ''));

    const currentVal = select.value;
    select.innerHTML = '';

    const isAdmin = role === 'admin';

    // For admins, add a "Select staff…" placeholder so nothing is auto-selected
    if (isAdmin) {
        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = 'Select staff…';
        select.appendChild(placeholder);
    }

    list.forEach(u => {
        const opt = document.createElement('option');
        opt.value = u.id;
        opt.textContent = u.name || u.username || `User ${u.id}`;
        select.appendChild(opt);
    });
    if (list.length) {
        const hasCurrent = list.some(u => u.id === window.currentUser.id);

        if (currentVal && Array.from(select.options).some(o => o.value === currentVal)) {
            // Preserve an existing valid selection (including placeholder)
            select.value = currentVal;
        } else if (hasCurrent) {
            // Staff users default to their own schedule
            select.value = String(window.currentUser.id);
        } else if (!isAdmin) {
            // For non-admins (e.g. staff), fall back to the first staff member
            select.value = String(list[0].id);
        } else {
            // Admins: explicitly select the placeholder (no staff selected)
            select.value = '';
        }
    }
}

function renderTeacherSchedule() {
    const tbody = document.getElementById('teacher-schedule-body');
    if (!tbody) {
        console.warn('Teacher schedule tbody not found');
        return;
    }

    // Ensure teacherScheduleData is an array
    if (!Array.isArray(teacherScheduleData)) {
        teacherScheduleData = [];
    }

    tbody.innerHTML = '';

    // Group schedules by time_period to handle multiple classes per time
    const schedulesByTime = {};
    teacherScheduleData.forEach(schedule => {
        const time = schedule.time_period;
        if (!schedulesByTime[time]) {
            schedulesByTime[time] = [];
        }
        schedulesByTime[time].push(schedule);
    });

    // Always show all periods from SCHEDULE_PERIODS
    // For each time period, create one row with all classes in the same cell
    SCHEDULE_PERIODS.forEach(time => {
        const savedSchedules = schedulesByTime[time] || [];
        
        if (savedSchedules.length > 0) {
            // Create one row with the first schedule data (will load all classes into same cell)
            const row = document.createElement('tr');
            const firstSchedule = savedSchedules[0];
            row.innerHTML = `
                <td class="time-cell">
                    <input type="text" value="${time}" class="time-input" placeholder="e.g., 7:45-8:30" tabindex="-1">
                </td>
                <td class="classes-cell">
                    <div class="classes-container">
                    </div>
                </td>
                <td class="actions-cell">
                    <button type="button" class="btn-add-class" title="Add another class for this time period" style="padding: 4px 8px; font-size: 12px;">+ Add Class</button>
                </td>
            `;
            
            // Add all classes to the container
            const classesContainer = row.querySelector('.classes-container');
            savedSchedules.forEach(schedule => {
                if (schedule.class_name) {
                    addClassInputGroup(classesContainer, schedule.class_name);
                }
            });
            
            // If no classes, add one empty input
            if (classesContainer.querySelectorAll('.class-input-group').length === 0) {
                addClassInputGroup(classesContainer);
            }
            
            // Store reference and setup buttons
            row.dataset.timePeriod = time;
            setupScheduleRowButtons(row, time, tbody);
            
            tbody.appendChild(row);
        } else {
            // Show one empty row for this time period
            addScheduleRow('teacher', time, null);
        }
    });
}

function setupStaffAutocomplete(input) {
    if (!input) return;
    
    const wrapper = input.closest('.staff-autocomplete-wrapper');
    const dropdown = wrapper ? wrapper.querySelector('.staff-autocomplete-dropdown') : null;
    if (!dropdown) return;
    
    let isDropdownVisible = false;
    let selectedIndex = -1;
    
    // Get staff names for autocomplete
    const getStaffNames = () => {
        return allStaffMembers.map(staff => staff.name || staff.username || '').filter(name => name);
    };
    
    // Filter options based on input
    const filterOptions = (query) => {
        if (!query) return getStaffNames();
        const lowerQuery = query.toLowerCase();
        return getStaffNames().filter(name => 
            name.toLowerCase().includes(lowerQuery)
        );
    };
    
    // Show dropdown with filtered options
    const showDropdown = (options) => {
        if (!options || options.length === 0) {
            dropdown.style.display = 'none';
            isDropdownVisible = false;
            return;
        }
        
        dropdown.innerHTML = '';
        options.forEach((option, index) => {
            const item = document.createElement('div');
            item.className = 'staff-autocomplete-item';
            item.textContent = option;
            item.dataset.value = option;
            item.addEventListener('click', () => {
                input.value = option;
                input.dispatchEvent(new Event('input', { bubbles: true }));
                hideDropdown();
                input.blur();
            });
            item.addEventListener('mouseenter', () => {
                selectedIndex = index;
                updateHighlight();
            });
            dropdown.appendChild(item);
        });
        
        dropdown.style.display = 'block';
        isDropdownVisible = true;
        selectedIndex = -1;
        updateHighlight();
    };
    
    // Hide dropdown
    const hideDropdown = () => {
        dropdown.style.display = 'none';
        isDropdownVisible = false;
        selectedIndex = -1;
    };
    
    // Update highlighted item
    const updateHighlight = () => {
        const items = dropdown.querySelectorAll('.staff-autocomplete-item');
        items.forEach((item, index) => {
            if (index === selectedIndex) {
                item.classList.add('highlighted');
            } else {
                item.classList.remove('highlighted');
            }
        });
    };
    
    // Event listeners
    input.addEventListener('input', (e) => {
        const query = e.target.value;
        const options = filterOptions(query);
        showDropdown(options);
    });
    
    input.addEventListener('focus', () => {
        const query = input.value;
        const options = filterOptions(query);
        showDropdown(options);
    });
    
    input.addEventListener('blur', (e) => {
        // Delay to allow click events on dropdown items
        setTimeout(() => {
            if (!dropdown.contains(document.activeElement)) {
                hideDropdown();
            }
        }, 200);
    });
    
    input.addEventListener('keydown', (e) => {
        if (!isDropdownVisible) return;
        
        const items = dropdown.querySelectorAll('.staff-autocomplete-item');
        if (items.length === 0) return;
        
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            selectedIndex = Math.min(selectedIndex + 1, items.length - 1);
            updateHighlight();
            items[selectedIndex].scrollIntoView({ block: 'nearest' });
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            selectedIndex = Math.max(selectedIndex - 1, -1);
            updateHighlight();
            if (selectedIndex >= 0) {
                items[selectedIndex].scrollIntoView({ block: 'nearest' });
            }
        } else if (e.key === 'Enter') {
            e.preventDefault();
            // If no item is selected, select the top option (index 0)
            const indexToSelect = selectedIndex >= 0 ? selectedIndex : 0;
            const selectedItem = items[indexToSelect];
            if (selectedItem) {
                input.value = selectedItem.dataset.value;
                input.dispatchEvent(new Event('input', { bubbles: true }));
                hideDropdown();
            }
        } else if (e.key === 'Escape') {
            hideDropdown();
            input.blur();
        }
    });
    
    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
        if (!wrapper.contains(e.target)) {
            hideDropdown();
        }
    });
}

function setupClassAutocomplete(input) {
    if (!input) return;
    
    const wrapper = input.closest('.class-autocomplete-wrapper');
    const dropdown = wrapper ? wrapper.querySelector('.class-autocomplete-dropdown') : null;
    if (!dropdown) return;
    
    let isDropdownVisible = false;
    let selectedIndex = -1;
    
    // Get class names for autocomplete
    const getClassNames = () => {
        return allTeacherClassNames.filter(name => name);
    };
    
    // Filter options based on input
    const filterOptions = (query) => {
        if (!query) return getClassNames();
        const lowerQuery = query.toLowerCase();
        return getClassNames().filter(name => 
            name.toLowerCase().includes(lowerQuery)
        );
    };
    
    // Show dropdown with filtered options
    const showDropdown = (options) => {
        if (!options || options.length === 0) {
            dropdown.style.display = 'none';
            isDropdownVisible = false;
            return;
        }
        
        dropdown.innerHTML = '';
        options.forEach((option, index) => {
            const item = document.createElement('div');
            item.className = 'class-autocomplete-item';
            item.textContent = option;
            item.dataset.value = option;
            item.addEventListener('click', () => {
                input.value = option;
                input.dispatchEvent(new Event('input', { bubbles: true }));
                hideDropdown();
                input.blur();
            });
            item.addEventListener('mouseenter', () => {
                selectedIndex = index;
                updateHighlight();
            });
            dropdown.appendChild(item);
        });
        
        dropdown.style.display = 'block';
        isDropdownVisible = true;
        selectedIndex = -1;
        updateHighlight();
    };
    
    // Hide dropdown
    const hideDropdown = () => {
        dropdown.style.display = 'none';
        isDropdownVisible = false;
        selectedIndex = -1;
    };
    
    // Update highlighted item
    const updateHighlight = () => {
        const items = dropdown.querySelectorAll('.class-autocomplete-item');
        items.forEach((item, index) => {
            if (index === selectedIndex) {
                item.classList.add('highlighted');
            } else {
                item.classList.remove('highlighted');
            }
        });
    };
    
    // Event listeners
    input.addEventListener('input', (e) => {
        const query = e.target.value;
        const options = filterOptions(query);
        showDropdown(options);
    });
    
    input.addEventListener('focus', () => {
        const query = input.value;
        const options = filterOptions(query);
        showDropdown(options);
    });
    
    input.addEventListener('blur', (e) => {
        // Delay to allow click events on dropdown items
        setTimeout(() => {
            if (!dropdown.contains(document.activeElement)) {
                hideDropdown();
            }
        }, 200);
    });
    
    input.addEventListener('keydown', (e) => {
        if (!isDropdownVisible) return;
        
        const items = dropdown.querySelectorAll('.class-autocomplete-item');
        if (items.length === 0) return;
        
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            selectedIndex = Math.min(selectedIndex + 1, items.length - 1);
            updateHighlight();
            items[selectedIndex].scrollIntoView({ block: 'nearest' });
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            selectedIndex = Math.max(selectedIndex - 1, -1);
            updateHighlight();
            if (selectedIndex >= 0) {
                items[selectedIndex].scrollIntoView({ block: 'nearest' });
            }
        } else if (e.key === 'Enter') {
            e.preventDefault();
            // If no item is selected, select the top option (index 0)
            const indexToSelect = selectedIndex >= 0 ? selectedIndex : 0;
            const selectedItem = items[indexToSelect];
            if (selectedItem) {
                input.value = selectedItem.dataset.value;
                input.dispatchEvent(new Event('input', { bubbles: true }));
                hideDropdown();
            }
        } else if (e.key === 'Escape') {
            hideDropdown();
            input.blur();
        }
    });
    
    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
        if (!wrapper.contains(e.target)) {
            hideDropdown();
        }
    });
}

function updateStaffDatalist() {
    // This function is no longer needed with custom autocomplete,
    // but keeping it for backwards compatibility
    // The custom autocomplete uses allStaffMembers directly
}

function setupDailySearchAutocomplete(input) {
    if (!input) return;
    
    const wrapper = input.closest('.daily-search-autocomplete-wrapper');
    const dropdown = wrapper ? wrapper.querySelector('.daily-search-autocomplete-dropdown') : null;
    if (!dropdown) return;
    
    let isDropdownVisible = false;
    let selectedIndex = -1;
    
    // Get all options (students and staff)
    const getAllOptions = () => {
        const options = [];
        
        // Add students
        allStudents.forEach(student => {
            if (student && student.name) {
                options.push({
                    type: 'student',
                    name: student.name,
                    displayText: `Student: ${student.name}`
                });
            }
        });
        
        // Add staff
        allStaffMembers.forEach(staff => {
            const staffName = staff.name || staff.username || '';
            if (staffName) {
                options.push({
                    type: 'staff',
                    name: staffName,
                    displayText: `Staff: ${staffName}`
                });
            }
        });
        
        return options;
    };
    
    // Filter options based on input (only show when user starts typing)
    const filterOptions = (query) => {
        if (!query || !query.trim()) return []; // Only show when user starts typing
        const lowerQuery = query.trim().toLowerCase();
        const filtered = getAllOptions().filter(option => 
            option.name.toLowerCase().includes(lowerQuery)
        );
        // Prefer staff matches over students when both match the same text
        filtered.sort((a, b) => {
            if (a.type === b.type) {
                return a.name.localeCompare(b.name);
            }
            if (a.type === 'staff') return -1;
            if (b.type === 'staff') return 1;
            return 0;
        });
        return filtered;
    };
    
    // Show dropdown with filtered options
    const showDropdown = (options) => {
        if (!options || options.length === 0) {
            dropdown.style.display = 'none';
            isDropdownVisible = false;
            return;
        }
        
        dropdown.innerHTML = '';
        options.forEach((option, index) => {
            const item = document.createElement('div');
            item.className = 'daily-search-autocomplete-item';
            
            const labelSpan = document.createElement('span');
            labelSpan.className = 'item-label';
            labelSpan.textContent = option.type === 'student' ? 'Student:' : 'Staff:';
            
            const nameSpan = document.createElement('span');
            nameSpan.textContent = option.name;
            
            item.appendChild(labelSpan);
            item.appendChild(nameSpan);
            item.dataset.value = option.name;
            item.dataset.type = option.type;

            item.addEventListener('click', () => {
                input.value = option.name;
                dailyEntrySearchQuery = option.name;
                dailyEntrySearchCommitted = true;
                // When a daily search is committed via autocomplete, clear "managed by me" so it does not persist across searches.
                const managedCheckbox = document.getElementById('daily-managed-by-me-checkbox');
                if (managedCheckbox && managedCheckbox.checked) {
                    managedCheckbox.checked = false;
                    dailyEntryManagedByMe = false;
                }
                hideDropdown();
                input.blur();
                scheduleDailyDataLoad(0);
            });
            item.addEventListener('mouseenter', () => {
                selectedIndex = index;
                updateHighlight();
            });
            dropdown.appendChild(item);
        });
        
        dropdown.style.display = 'block';
        isDropdownVisible = true;
        selectedIndex = -1;
        updateHighlight();
    };
    
    // Hide dropdown
    const hideDropdown = () => {
        dropdown.style.display = 'none';
        isDropdownVisible = false;
        selectedIndex = -1;
    };
    
    // Update highlighted item
    const updateHighlight = () => {
        const items = dropdown.querySelectorAll('.daily-search-autocomplete-item');
        items.forEach((item, index) => {
            if (index === selectedIndex) {
                item.classList.add('highlighted');
            } else {
                item.classList.remove('highlighted');
            }
        });
    };
    
    // Event listeners
    input.addEventListener('input', (e) => {
        const query = e.target.value;
        const options = filterOptions(query);
        showDropdown(options);
    });
    
    input.addEventListener('focus', () => {
        const query = input.value;
        const options = filterOptions(query);
        showDropdown(options);
    });
    
    input.addEventListener('blur', (e) => {
        // Delay to allow click events on dropdown items
        setTimeout(() => {
            if (!dropdown.contains(document.activeElement)) {
                hideDropdown();
            }
        }, 200);
    });
    
    input.addEventListener('keydown', (e) => {
        if (!isDropdownVisible) return;
        
        const items = dropdown.querySelectorAll('.daily-search-autocomplete-item');
        if (items.length === 0) return;
        
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            selectedIndex = Math.min(selectedIndex + 1, items.length - 1);
            updateHighlight();
            items[selectedIndex].scrollIntoView({ block: 'nearest' });
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            selectedIndex = Math.max(selectedIndex - 1, -1);
            updateHighlight();
            if (selectedIndex >= 0) {
                items[selectedIndex].scrollIntoView({ block: 'nearest' });
            }
        } else if (e.key === 'Enter') {
            e.preventDefault();
            // If no item is selected, select the top option (index 0)
            const indexToSelect = selectedIndex >= 0 ? selectedIndex : 0;
            const selectedItem = items[indexToSelect];
            if (selectedItem) {
                input.value = selectedItem.dataset.value;
                dailyEntrySearchQuery = selectedItem.dataset.value;
                dailyEntrySearchCommitted = true;
                hideDropdown();
                scheduleDailyDataLoad(0);
            }
        } else if (e.key === 'Escape') {
            hideDropdown();
            input.blur();
        }
    });
    
    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
        if (!wrapper.contains(e.target)) {
            hideDropdown();
        }
    });
}

function setupTableColumnSearch(input, options, tableSelector, columnFilterCallback) {
    if (!input) return;
    
    const wrapper = input.closest('.table-column-search-wrapper');
    const dropdown = wrapper ? wrapper.querySelector('.table-column-search-dropdown') : null;
    if (!dropdown) return;
    
    let isDropdownVisible = false;
    let selectedIndex = -1;
    
    // Filter options based on input (partial matching)
    const filterOptions = (query) => {
        if (!query || !query.trim()) return options; // Show all when empty
        const lowerQuery = query.trim().toLowerCase();
        return options.filter(option => 
            option.toLowerCase().includes(lowerQuery)
        );
    };
    
    // Show dropdown with filtered options
    const showDropdown = (filteredOptions) => {
        if (!filteredOptions || filteredOptions.length === 0) {
            dropdown.style.display = 'none';
            isDropdownVisible = false;
            return;
        }
        
        dropdown.innerHTML = '';
        filteredOptions.forEach((option, index) => {
            const item = document.createElement('div');
            item.className = 'table-column-search-item';
            item.textContent = option;
            item.dataset.value = option;
            
            item.addEventListener('click', () => {
                input.value = option;
                filterColumns(option);
                hideDropdown();
                input.blur();
            });
            
            item.addEventListener('mouseenter', () => {
                selectedIndex = index;
                updateHighlight();
            });
            
            dropdown.appendChild(item);
        });
        
        dropdown.style.display = 'block';
        isDropdownVisible = true;
        selectedIndex = -1;
        updateHighlight();
    };
    
    // Hide dropdown
    const hideDropdown = () => {
        dropdown.style.display = 'none';
        isDropdownVisible = false;
        selectedIndex = -1;
    };
    
    // Update highlighted item
    const updateHighlight = () => {
        const items = dropdown.querySelectorAll('.table-column-search-item');
        items.forEach((item, index) => {
            if (index === selectedIndex) {
                item.classList.add('highlighted');
            } else {
                item.classList.remove('highlighted');
            }
        });
    };
    
    // Filter table columns based on selected value
    const filterColumns = (selectedValue) => {
        if (columnFilterCallback) {
            columnFilterCallback(selectedValue);
        } else {
            // Default column filtering logic
            const table = document.querySelector(tableSelector);
            if (!table) return;
            
            // Find all header cells (skip the first "Metric" column)
            const headerCells = table.querySelectorAll('thead th');
            const dataRows = table.querySelectorAll('tbody tr');
            
            headerCells.forEach((headerCell, index) => {
                if (index === 0) return; // Skip the first "Metric" column
                
                const headerText = headerCell.textContent.trim();
                const shouldShow = !selectedValue || headerText.toLowerCase().includes(selectedValue.toLowerCase());
                
                // Hide/show header column
                headerCell.style.display = shouldShow ? '' : 'none';
                
                // Hide/show corresponding data cells in all rows
                dataRows.forEach(row => {
                    const cells = row.querySelectorAll('td');
                    if (cells[index]) {
                        cells[index].style.display = shouldShow ? '' : 'none';
                    }
                });
            });
        }
    };
    
    // Event listeners
    input.addEventListener('input', (e) => {
        const query = e.target.value;
        const filteredOptions = filterOptions(query);
        showDropdown(filteredOptions);
        
        // Filter columns in real-time as user types
        filterColumns(query);
    });
    
    input.addEventListener('focus', () => {
        const query = input.value;
        const filteredOptions = filterOptions(query);
        showDropdown(filteredOptions);
    });
    
    input.addEventListener('blur', (e) => {
        // Delay to allow click events on dropdown items
        setTimeout(() => {
            if (!dropdown.contains(document.activeElement)) {
                hideDropdown();
            }
        }, 200);
    });
    
    input.addEventListener('keydown', (e) => {
        if (!isDropdownVisible && e.key !== 'Enter') return;
        
        const items = dropdown.querySelectorAll('.table-column-search-item');
        if (items.length === 0 && e.key === 'Enter') {
            // If no dropdown but Enter pressed, filter with current input
            filterColumns(input.value);
            return;
        }
        
        if (items.length === 0) return;
        
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            selectedIndex = Math.min(selectedIndex + 1, items.length - 1);
            updateHighlight();
            items[selectedIndex].scrollIntoView({ block: 'nearest' });
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            selectedIndex = Math.max(selectedIndex - 1, -1);
            updateHighlight();
            if (selectedIndex >= 0) {
                items[selectedIndex].scrollIntoView({ block: 'nearest' });
            }
        } else if (e.key === 'Enter') {
            e.preventDefault();
            // If no item is selected, select the top option (index 0)
            const indexToSelect = selectedIndex >= 0 ? selectedIndex : 0;
            const selectedItem = items[indexToSelect];
            if (selectedItem) {
                input.value = selectedItem.dataset.value;
                filterColumns(selectedItem.dataset.value);
                hideDropdown();
            } else {
                // If no item selected but Enter pressed, filter with current input
                filterColumns(input.value);
            }
        } else if (e.key === 'Escape') {
            hideDropdown();
            input.blur();
        }
    });
    
    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
        if (!wrapper.contains(e.target)) {
            hideDropdown();
        }
    });
}

function renderStudentSchedule() {
    const tbody = document.getElementById('student-schedule-body');
    const container = document.getElementById('student-schedule-container');
    if (!tbody || !container) {
        console.warn('Student schedule elements not found');
        return;
    }

    // Ensure studentScheduleData is an array
    if (!Array.isArray(studentScheduleData)) {
        studentScheduleData = [];
    }

    container.style.display = 'block';
    tbody.innerHTML = '';

    // Always show all periods from SCHEDULE_PERIODS
    // If saved data exists for a period, use it; otherwise show empty row
    SCHEDULE_PERIODS.forEach(time => {
        const savedSchedule = studentScheduleData.find(s => s && s.time_period === time);
        addScheduleRow('student', time, savedSchedule || null);
    });
}

// Helper function to add a class input group to the classes container
function addClassInputGroup(container, value = '') {
    const group = document.createElement('div');
    group.className = 'class-input-group';
    group.innerHTML = `
        <input type="text" value="${value}" class="class-input" placeholder="Enter class/activity">
        <button type="button" class="btn-delete-class" title="Remove this class" style="padding: 4px 8px; font-size: 12px; background: transparent; color: var(--danger); border: 1px solid var(--danger); border-radius: var(--radius-sm); cursor: pointer; margin-left: 5px;">×</button>
    `;
    
    // Add delete button event listener
    const deleteBtn = group.querySelector('.btn-delete-class');
    if (deleteBtn) {
        deleteBtn.addEventListener('click', () => {
            const container = group.parentElement;
            group.remove();
            // If this was the last class input, ensure at least one remains
            if (container && container.querySelectorAll('.class-input-group').length === 0) {
                addClassInputGroup(container);
            }
        });
    }
    
    container.appendChild(group);
    return group;
}

// Helper function to setup button event listeners for a teacher schedule row
function setupScheduleRowButtons(row, timePeriod, tbody) {
    // Add event listener for "Add Class" button
    const addClassBtn = row.querySelector('.btn-add-class');
    if (addClassBtn) {
        // Remove existing listener if any, then add new one
        const newAddClassBtn = addClassBtn.cloneNode(true);
        addClassBtn.parentNode.replaceChild(newAddClassBtn, addClassBtn);
        newAddClassBtn.addEventListener('click', () => {
            // Add a new class input group within the same cell
            const classesContainer = row.querySelector('.classes-container');
            if (classesContainer) {
                addClassInputGroup(classesContainer);
            }
        });
    }
    
    // Setup delete button listeners for existing class input groups
    const deleteButtons = row.querySelectorAll('.btn-delete-class');
    deleteButtons.forEach(deleteBtn => {
        deleteBtn.addEventListener('click', () => {
            const group = deleteBtn.closest('.class-input-group');
            const container = group?.parentElement;
            if (group && container) {
                group.remove();
                // If this was the last class input, ensure at least one remains
                if (container.querySelectorAll('.class-input-group').length === 0) {
                    addClassInputGroup(container);
                }
            }
        });
    });
}

function addScheduleRow(type, timePeriod = '', data = null) {
    const tbody = document.getElementById(`${type}-schedule-body`);
    if (!tbody) return;
    
    const row = document.createElement('tr');
    
    if (type === 'teacher') {
        // Teacher schedule - Class cell contains container for multiple class inputs
        const initialClassValue = data?.class_name || '';
        row.innerHTML = `
            <td class="time-cell">
                <input type="text" value="${timePeriod}" class="time-input" placeholder="e.g., 7:45-8:30" tabindex="-1">
            </td>
            <td class="classes-cell">
                <div class="classes-container">
                    ${initialClassValue ? `<div class="class-input-group">
                        <input type="text" value="${initialClassValue}" class="class-input" placeholder="Enter class/activity">
                        <button type="button" class="btn-delete-class" title="Remove this class" style="padding: 4px 8px; font-size: 12px; background: transparent; color: var(--danger); border: 1px solid var(--danger); border-radius: var(--radius-sm); cursor: pointer; margin-left: 5px;">×</button>
                    </div>` : ''}
                </div>
            </td>
            <td class="actions-cell">
                <button type="button" class="btn-add-class" title="Add another class for this time period" style="padding: 4px 8px; font-size: 12px;">+ Add Class</button>
            </td>
        `;
        
        // If no initial class, add one empty class input group
        if (!initialClassValue) {
            const classesContainer = row.querySelector('.classes-container');
            if (classesContainer) {
                addClassInputGroup(classesContainer);
            }
        }
        
        // Store reference to row for button setup
        row.dataset.timePeriod = timePeriod;
        
        // Setup button event listeners for this row
        setupScheduleRowButtons(row, timePeriod, tbody);
    } else {
        // Student schedule - includes staff column with custom autocomplete dropdown
        const staffValue = data?.staff_name || '';
        const uniqueId = `staff-input-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const classUniqueId = `class-input-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        row.innerHTML = `
            <td class="time-cell">
                <input type="text" value="${timePeriod}" class="time-input" placeholder="e.g., 7:45-8:30" tabindex="-1">
            </td>
            <td>
                <div class="class-autocomplete-wrapper">
                    <input type="text" value="${data?.class_name || ''}" class="class-input" placeholder="Enter class/activity" data-autocomplete-id="${classUniqueId}">
                    <div class="class-autocomplete-dropdown" id="dropdown-${classUniqueId}"></div>
                </div>
            </td>
            <td>
                <div class="staff-autocomplete-wrapper">
                    <input type="text" value="${staffValue}" class="staff-input" placeholder="Enter staff name" data-autocomplete-id="${uniqueId}">
                    <div class="staff-autocomplete-dropdown" id="dropdown-${uniqueId}"></div>
                </div>
            </td>
        `;
        
        // Setup autocomplete for staff input
        setupStaffAutocomplete(row.querySelector('.staff-input'));
        
        // Setup autocomplete for class input
        setupClassAutocomplete(row.querySelector('.class-input'));
    }
    
    tbody.appendChild(row);
}

async function saveSchedule(type) {
    const tbody = document.getElementById(`${type}-schedule-body`);
    if (!tbody) return;
    
    const rows = tbody.querySelectorAll('tr');
    const periods = [];
    
    rows.forEach(row => {
        const timeInput = row.querySelector('.time-input');
        const staffInput = row.querySelector('.staff-input');
        
        const timePeriod = timeInput.value.trim();
        
        if (timePeriod) {
            // For teacher schedules, get all class inputs from the classes container
            const classesContainer = row.querySelector('.classes-container');
            if (classesContainer && type === 'teacher') {
                const classInputs = classesContainer.querySelectorAll('.class-input');
                classInputs.forEach(classInput => {
                    const classValue = classInput.value.trim();
                    if (classValue) { // Only save non-empty classes
                        periods.push({
                            time_period: timePeriod,
                            class_name: classValue,
                            staff_name: ''
                        });
                    }
                });
            } else {
                // For student schedules, use single class input (existing behavior)
                const classInput = row.querySelector('.class-input');
                if (classInput) {
                    periods.push({
                        time_period: timePeriod,
                        class_name: classInput.value.trim(),
                        staff_name: staffInput ? staffInput.value.trim() : ''
                    });
                }
            }
        }
    });
    
    const payload = {
        schedule_type: type,
        periods: periods
    };
    
    if (type === 'student' && currentScheduleStudentId) {
        payload.student_id = currentScheduleStudentId;
    }
    if (type === 'teacher' && currentTeacherScheduleUserId != null && currentTeacherScheduleUserId !== (window.currentUser && window.currentUser.id) && window.currentUser && window.currentUser.role === 'admin') {
        payload.user_id = currentTeacherScheduleUserId;
    }
    
    try {
        const response = await fetch('/api/schedules', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        
        if (response.ok) {
            showMessage(`${type === 'teacher' ? 'Teacher' : 'Student'} schedule saved successfully!`, 'success');
            loadSchedules(type, currentScheduleStudentId);
        } else {
            // Try to get error message from response
            let errorMessage = 'Error saving schedule. Please try again.';
            try {
                const errorData = await response.json();
                if (errorData.error) {
                    errorMessage = errorData.error;
                }
            } catch (e) {
                // If response is not JSON, use status text
                errorMessage = `Error saving schedule: ${response.statusText}`;
            }
            throw new Error(errorMessage);
        }
    } catch (error) {
        console.error('Error saving schedule:', error);
        showMessage(error.message || 'Error saving schedule. Please try again.', 'error');
    }
}

// Load and apply per-user UI preferences (e.g., hidden User Management sections)
async function loadUserPreferences() {
    try {
        const response = await fetch('/api/user/preferences');
        if (!response.ok) {
            console.warn('Failed to load user preferences:', response.status);
            return;
        }
        const data = await response.json();
        userPreferences = data || {};
        applyUserManagementSectionVisibility();
    } catch (error) {
        console.error('Error loading user preferences:', error);
    }
}

function applyUserManagementSectionVisibility() {
    if (!userPreferences) {
        return;
    }

    const hiddenSections = userPreferences.userManagementHiddenSections || {};
    const sectionConfigs = [
        { key: 'students', checkboxId: 'toggle-section-students', bodyId: 'user-section-students-body' },
        { key: 'archived', checkboxId: 'toggle-section-archived', bodyId: 'user-section-archived-body' },
        { key: 'staff', checkboxId: 'toggle-section-staff', bodyId: 'user-section-staff-body' },
        { key: 'outsideStaff', checkboxId: 'toggle-section-outside-staff', bodyId: 'user-section-outside-staff-body' },
        { key: 'admin', checkboxId: 'toggle-section-admin', bodyId: 'user-section-admin-body' }
    ];

    sectionConfigs.forEach(config => {
        const checkbox = document.getElementById(config.checkboxId);
        const body = document.getElementById(config.bodyId);
        if (!checkbox || !body) {
            return;
        }
        const isHidden = !!hiddenSections[config.key];
        checkbox.checked = isHidden;
        body.style.display = isHidden ? 'none' : '';
    });
}

async function updateUserManagementPreference(sectionKey, hidden) {
    const existingPrefs = userPreferences || {};
    const hiddenSections = existingPrefs.userManagementHiddenSections || {};
    const newHiddenSections = {
        ...hiddenSections,
        [sectionKey]: hidden
    };

    const newPrefs = {
        ...existingPrefs,
        userManagementHiddenSections: newHiddenSections
    };

    userPreferences = newPrefs;

    try {
        const response = await fetch('/api/user/preferences', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(newPrefs)
        });
        if (!response.ok) {
            console.warn('Failed to save user preferences:', response.status);
        }
    } catch (error) {
        console.error('Error saving user preferences:', error);
    }
}

// User Management Functions
let userManagementAutoFitRaf = null;
let userManagementAutoFitObserverInitialized = false;

function autoFitUserManagementTable(table) {
    if (!table) return;

    const headerCells = Array.from(table.querySelectorAll('thead th'));
    if (headerCells.length === 0) return;

    const allBodyRows = Array.from(table.querySelectorAll('tbody tr'));
    const bodyRows = allBodyRows.filter(row =>
        row.style.display !== 'none' && !row.classList.contains('empty-row')
    );

    // Reset widths so measurements reflect current content.
    headerCells.forEach(cell => {
        cell.style.width = '';
        cell.style.minWidth = '';
    });
    allBodyRows.forEach(row => {
        Array.from(row.cells).forEach(cell => {
            cell.style.width = '';
            cell.style.minWidth = '';
        });
    });

    // No data rows: keep natural table width so empty-state text stays centered.
    if (bodyRows.length === 0) {
        return;
    }

    const maxWidths = headerCells.map(cell => cell.scrollWidth);

    bodyRows.forEach(row => {
        Array.from(row.cells).forEach((cell, index) => {
            if (index < maxWidths.length) {
                maxWidths[index] = Math.max(maxWidths[index], cell.scrollWidth);
            }
        });
    });

    maxWidths.forEach((width, index) => {
        const pixelWidth = `${Math.ceil(width + 2)}px`;
        headerCells[index].style.width = pixelWidth;
        headerCells[index].style.minWidth = pixelWidth;
    });

    bodyRows.forEach(row => {
        Array.from(row.cells).forEach((cell, index) => {
            if (index < maxWidths.length) {
                const pixelWidth = `${Math.ceil(maxWidths[index] + 2)}px`;
                cell.style.width = pixelWidth;
                cell.style.minWidth = pixelWidth;
            }
        });
    });
}

function autoFitAllUserManagementTables() {
    const tables = document.querySelectorAll('#users-view .users-table');
    tables.forEach(autoFitUserManagementTable);
}

function updateUserManagementTableEmptyState(tbody) {
    if (!tbody) return;

    const scrollContainer = tbody.closest('.user-table-scroll');
    if (!scrollContainer) return;

    const dataRows = Array.from(tbody.querySelectorAll('tr')).filter(row => !row.classList.contains('empty-row'));
    const hasDataRows = dataRows.length > 0;
    scrollContainer.classList.toggle('table-empty', !hasDataRows);
}

function updateAllUserManagementTableEmptyStates() {
    const bodyIds = [
        'student-users-table-body',
        'archived-students-table-body',
        'staff-users-table-body',
        'outside-staff-users-table-body',
        'admin-users-table-body'
    ];
    bodyIds.forEach((id) => updateUserManagementTableEmptyState(document.getElementById(id)));
}

function scheduleUserManagementTablesAutoFit() {
    if (userManagementAutoFitRaf != null) {
        cancelAnimationFrame(userManagementAutoFitRaf);
    }
    userManagementAutoFitRaf = requestAnimationFrame(() => {
        userManagementAutoFitRaf = null;
        autoFitAllUserManagementTables();
        updateAllUserManagementTableEmptyStates();
    });
}

function initializeUserManagementTableAutoFitObserver() {
    if (userManagementAutoFitObserverInitialized) return;
    userManagementAutoFitObserverInitialized = true;

    const tableBodyIds = [
        'student-users-table-body',
        'archived-students-table-body',
        'staff-users-table-body',
        'outside-staff-users-table-body',
        'admin-users-table-body'
    ];

    tableBodyIds.forEach((id) => {
        const tbody = document.getElementById(id);
        if (!tbody) return;

        const observer = new MutationObserver(() => {
            scheduleUserManagementTablesAutoFit();
        });
        observer.observe(tbody, {
            childList: true,
            subtree: true,
            characterData: true
        });
    });

    window.addEventListener('resize', scheduleUserManagementTablesAutoFit);
}

async function loadUsers() {
    try {
        const response = await fetch('/api/users');
        const users = await response.json();
        
        // Store staff members for dropdowns
        allStaffMembers = users.filter(u => u.role === 'staff' || u.role === 'admin');
        
        // Update staff datalist for schedule dropdowns
        updateStaffDatalist();
        
        const adminTbody = document.getElementById('admin-users-table-body');
        const staffTbody = document.getElementById('staff-users-table-body');
        const studentTbody = document.getElementById('student-users-table-body');
        const outsideStaffTbody = document.getElementById('outside-staff-users-table-body');
        const archivedStudentsTbody = document.getElementById('archived-students-table-body');
        
        if (!adminTbody || !staffTbody || !studentTbody) return;
        
        adminTbody.innerHTML = '';
        staffTbody.innerHTML = '';
        studentTbody.innerHTML = '';
        if (outsideStaffTbody) outsideStaffTbody.innerHTML = '';
        if (archivedStudentsTbody) archivedStudentsTbody.innerHTML = '';
        
        if (users.length === 0) {
            studentTbody.innerHTML = '<tr class="empty-row"><td class="empty-message-cell" colspan="10" style="text-align: center; padding: 20px;">No users found</td></tr>';
            if (archivedStudentsTbody) {
                archivedStudentsTbody.innerHTML = '<tr class="empty-row"><td class="empty-message-cell" colspan="5" style="text-align: center; padding: 20px; color: #999;">No archived students</td></tr>';
            }
            scheduleUserManagementTablesAutoFit();
            return;
        }
        
        // Separate users by role (excluding parent role)
        const adminUsers = users.filter(u => u.role === 'admin');
        const staffUsers = users.filter(u => u.role === 'staff' && !u.is_outside_staff);
        const outsideStaffUsers = users.filter(u => u.role === 'staff' && u.is_outside_staff);
        const studentUsers = users.filter(u => u.role === 'student');
        
        // Helper: safe string for sorting (treat null/undefined as empty, case-insensitive)
        const sortKey = (value) => (value || '').toString().toLowerCase();
        
        // Helper: normalize grade to sortable number, with unknown grades last
        const parseGradeForSort = (grade) => {
            if (grade == null || grade === '' || grade === '-') return Number.POSITIVE_INFINITY;
            if (typeof grade === 'number') return grade;
            const g = grade.toString().trim().toUpperCase();
            if (g === 'K' || g === 'KG' || g === 'KINDERGARTEN') return 0;
            const n = parseInt(g, 10);
            return Number.isNaN(n) ? Number.POSITIVE_INFINITY : n;
        };
        
        // Helper function to get display role
        const getDisplayRole = (user) => {
            if (user.role === 'admin') return 'Admin';
            if (user.role === 'staff') return user.designation || 'Staff';
            return 'Student';
        };
        
        // Sort collections per requirements
        // Students: by grade, then name
        studentUsers.sort((a, b) => {
            const gradeDiff = parseGradeForSort(a.grade) - parseGradeForSort(b.grade);
            if (gradeDiff !== 0) return gradeDiff;
            const nameA = sortKey(a.name || a.student_name || a.username);
            const nameB = sortKey(b.name || b.student_name || b.username);
            if (nameA < nameB) return  -1;
            if (nameA > nameB) return  1;
            return 0;
        });
        
        // Staff: by role (display role), then name
        staffUsers.sort((a, b) => {
            const roleA = sortKey(getDisplayRole(a));
            const roleB = sortKey(getDisplayRole(b));
            if (roleA < roleB) return -1;
            if (roleA > roleB) return 1;
            const nameA = sortKey(a.name || a.username);
            const nameB = sortKey(b.name || b.username);
            if (nameA < nameB) return -1;
            if (nameA > nameB) return 1;
            return 0;
        });
        
        // Helper: ensure current user (if present in a given list) is first
        const prioritizeCurrentUser = (list) => {
            if (!window.currentUser || !Array.isArray(list)) return;
            const idx = list.findIndex(u => u && u.id === window.currentUser.id);
            if (idx > 0) {
                const [current] = list.splice(idx, 1);
                list.unshift(current);
            }
        };
        
        // Put the current user at the top of their respective table
        prioritizeCurrentUser(studentUsers);
        prioritizeCurrentUser(staffUsers);
        prioritizeCurrentUser(outsideStaffUsers);
        prioritizeCurrentUser(adminUsers);
        
        // Outside staff: by district, then name
        outsideStaffUsers.sort((a, b) => {
            const districtA = sortKey(a.district);
            const districtB = sortKey(b.district);
            if (districtA < districtB) return -1;
            if (districtA > districtB) return 1;
            const nameA = sortKey(a.name || a.username);
            const nameB = sortKey(b.name || b.username);
            if (nameA < nameB) return -1;
            if (nameA > nameB) return 1;
            return 0;
        });
        
        // Admin users: by name
        adminUsers.sort((a, b) => {
            const nameA = sortKey(a.name || a.username);
            const nameB = sortKey(b.name || b.username);
            if (nameA < nameB) return -1;
            if (nameA > nameB) return 1;
            return 0;
        });
        
        // Populate Admin table (DocumentFragment for single reflow)
        if (adminUsers.length === 0) {
            adminTbody.innerHTML = '<tr class="empty-row"><td class="empty-message-cell" colspan="5" style="text-align: center; padding: 20px; color: #999;">No admin users</td></tr>';
        } else {
            const adminFrag = document.createDocumentFragment();
            adminUsers.forEach(user => {
                adminFrag.appendChild(createAdminStaffRow(user, getDisplayRole(user)));
            });
            adminTbody.appendChild(adminFrag);
        }
        
        // Populate Staff table (DocumentFragment for single reflow)
        if (staffUsers.length === 0) {
            staffTbody.innerHTML = '<tr class="empty-row"><td class="empty-message-cell" colspan="5" style="text-align: center; padding: 20px; color: #999;">No staff users</td></tr>';
        } else {
            const staffFrag = document.createDocumentFragment();
            staffUsers.forEach(user => {
                staffFrag.appendChild(createAdminStaffRow(user, getDisplayRole(user)));
            });
            staffTbody.appendChild(staffFrag);
        }
        
        // Populate Outside Staff table (DocumentFragment for single reflow)
        if (outsideStaffTbody) {
            if (outsideStaffUsers.length === 0) {
                outsideStaffTbody.innerHTML = '<tr class="empty-row"><td class="empty-message-cell" colspan="6" style="text-align: center; padding: 20px; color: #999;">No outside staff users</td></tr>';
            } else {
                const outsideFrag = document.createDocumentFragment();
                outsideStaffUsers.forEach(user => {
                    outsideFrag.appendChild(createOutsideStaffRow(user));
                });
                outsideStaffTbody.appendChild(outsideFrag);
            }
        }
        
        // Populate Student table (DocumentFragment for single reflow)
        if (studentUsers.length === 0) {
            studentTbody.innerHTML = '<tr class="empty-row"><td class="empty-message-cell" colspan="10" style="text-align: center; padding: 20px; color: #999;">No student users</td></tr>';
        } else {
            const studentFrag = document.createDocumentFragment();
            studentUsers.forEach(user => {
                studentFrag.appendChild(createStudentRow(user));
            });
            studentTbody.appendChild(studentFrag);
        }
        
        // Load admin stats if on admin panel
        if (isAdmin()) {
            loadAdminStats(users);
        }

        // Load archived students table (admin-only view)
        if (archivedStudentsTbody && isAdmin()) {
            try {
                const archivedResponse = await fetch('/api/students/archived');
                if (archivedResponse.ok) {
                    const archivedStudents = await archivedResponse.json();
                    // Sort archived students by grade, then name to match current student ordering
                    archivedStudents.sort((a, b) => {
                        const gradeDiff = parseGradeForSort(a.grade) - parseGradeForSort(b.grade);
                        if (gradeDiff !== 0) return gradeDiff;
                        const nameA = sortKey(a.name || a.student_name);
                        const nameB = sortKey(b.name || b.student_name);
                        if (nameA < nameB) return -1;
                        if (nameA > nameB) return 1;
                        return 0;
                    });
                    
                    if (archivedStudents.length === 0) {
                        archivedStudentsTbody.innerHTML = '<tr class="empty-row"><td class="empty-message-cell" colspan="8" style="text-align: center; padding: 20px; color: #999;">No archived students</td></tr>';
                    } else {
                        const archivedFrag = document.createDocumentFragment();
                        archivedStudents.forEach(student => {
                            const row = document.createElement('tr');
                            const cardColor = student.card_color || '-';
                            const cardColorDisplay = cardColor === '-' ? '-' : cardColor.charAt(0).toUpperCase() + cardColor.slice(1);
                            const tm = student.team_members || {};
                            const fmt = (arr) => (arr && arr.length) ? arr.join('<br>') : '-';
                            const caseManager = fmt(tm.case_manager);
                            const practitioner = fmt(tm.practitioner);
                            const professional = fmt(tm.professional);
                            const groupLeader = fmt(tm.group_leader);
                            const safeName = (student.name || 'Student').replace(/'/g, "\\'");
                            row.innerHTML = `
                                <td><strong>${student.name || 'Unnamed Student'}</strong></td>
                                <td>${student.grade || '-'}</td>
                                <td>${cardColorDisplay}</td>
                                <td style="font-size: 13px;">${caseManager}</td>
                                <td style="font-size: 13px;">${practitioner}</td>
                                <td style="font-size: 13px;">${professional}</td>
                                <td style="font-size: 13px;">${groupLeader}</td>
                                <td class="actions-cell">
                                    <button class="btn-secondary" style="padding: 4px 10px; font-size: 12px;"
                                        onclick="restoreArchivedStudent(${student.id}, '${safeName}')">
                                        Restore Student User
                                    </button>
                                </td>
                            `;
                            archivedFrag.appendChild(row);
                        });
                        archivedStudentsTbody.appendChild(archivedFrag);
                    }
                } else {
                    archivedStudentsTbody.innerHTML = '<tr><td colspan="8" style="text-align: center; padding: 20px; color: #e53935;">Error loading archived students</td></tr>';
                }
            } catch (e) {
                console.error('Error loading archived students:', e);
                archivedStudentsTbody.innerHTML = '<tr><td colspan="8" style="text-align: center; padding: 20px; color: #e53935;">Error loading archived students</td></tr>';
            }
        }

        scheduleUserManagementTablesAutoFit();
    } catch (error) {
        console.error('Error loading users:', error);
        showMessage('Error loading users. Please try again.', 'error');
    }
}

function createAdminStaffRow(user, displayRole) {
    const row = document.createElement('tr');
    row.dataset.userId = user.id;
    
    const name = user.name || user.username;
    
    const canDelete = isAdmin() && user.id !== window.currentUser.id;
    const canEdit = isAdmin() || user.id === window.currentUser.id;
    
    // Password visibility: Admin sees all, staff/admin see their own
    const canSeePassword = isAdmin() || user.id === window.currentUser.id;
    
    const userDesignation = user.designation ? `'${user.designation.replace(/'/g, "\\'")}'` : 'null';
    const grade = user.grade ? `'${user.grade}'` : 'null';
    const userName = user.name ? `'${user.name.replace(/'/g, "\\'")}'` : 'null';
    const gradesTaught = user.grades_taught ? `'${String(user.grades_taught).replace(/'/g, "\\'")}'` : 'null';
    const cardColorVal = user.card_color ? `'${user.card_color}'` : 'null';
    const linkedCaseManagerId = user.linked_case_manager_id != null ? user.linked_case_manager_id : 'null';
    const isTeacherOrCaseManager = user.role === 'staff' && (user.designation === 'Case Manager' || user.designation === 'Teacher');
    const gradesTaughtHtml = isTeacherOrCaseManager && user.grades_taught
        ? `<br><span class="grades-taught-text">${escapeHtml(String(user.grades_taught))}</span>`
        : '';
    const isParaprofessional = user.role === 'staff' && user.designation === 'Paraprofessional';
    const linkedCaseManager = isParaprofessional && user.linked_case_manager_id
        ? (typeof allStaffMembers !== 'undefined' ? allStaffMembers.find(s => s.id === user.linked_case_manager_id) : null)
        : null;
    const linkedCaseManagerHtml = linkedCaseManager
        ? `<br><span class="grades-taught-text">${escapeHtml(linkedCaseManager.name || linkedCaseManager.username || '')}</span>`
        : '';

    row.innerHTML = `
        <td><strong>${name}</strong></td>
        <td style="font-weight: 500; color: ${user.role === 'admin' ? 'var(--danger)' : 'var(--accent)'};">${escapeHtml(displayRole)}${gradesTaughtHtml}${linkedCaseManagerHtml}</td>
        <td>${user.username}</td>
        <td id="password-cell-${user.id}">
            ${canSeePassword ? `
                <button class="btn-secondary" style="padding: 4px 12px; font-size: 12px;" onclick="resetAndViewPassword(${user.id}, '${user.username}')">Reset & View Password</button>
            ` : '<span style="color: #999;">Hidden</span>'}
        </td>
        <td class="actions-cell">
            ${canEdit ? `<button class="btn-secondary" onclick="editUser(${user.id}, ${userName}, '${user.username}', '${user.role}', ${user.student_id || 'null'}, ${userDesignation}, ${grade}, ${cardColorVal}, ${gradesTaught}, ${linkedCaseManagerId})">Edit</button>` : ''}
            ${canDelete ? `<button class="btn-danger" onclick="deleteUser(${user.id}, '${user.username}', '${user.role}')">Delete</button>` : ''}
        </td>
    `;
    
    return row;
}

function createStudentRow(user) {
    const row = document.createElement('tr');
    row.dataset.userId = user.id;
    
    // Use the name from User table if available, otherwise fall back to student_name or username
    const name = user.name || user.student_name || user.username;
    const grade = user.grade || '-';
    
    // Helper function to get staff name by username
    const getStaffNameByUsername = (username) => {
        if (!username || username === '-') return null;
        const staff = allStaffMembers.find(s => s.username === username);
        return staff ? (staff.name || staff.username) : username;
    };
    
    // Helper function to format team members array for display
    const formatTeamMembers = (usernames) => {
        if (!usernames || (Array.isArray(usernames) && usernames.length === 0)) {
            return '-';
        }
        // Handle both array and single value for backward compatibility
        const usernameList = Array.isArray(usernames) ? usernames : [usernames];
        const names = usernameList.map(u => getStaffNameByUsername(u)).filter(n => n !== null);
        if (names.length === 0) return '-';
        return names.join('<br>');
    };
    
    // Team members - display names instead of usernames
    let caseManager = '-';
    let practitioner = '-';
    let professional = '-';
    let groupLeader = '-';
    
    if (user.team_members) {
        caseManager = formatTeamMembers(user.team_members.case_manager);
        practitioner = formatTeamMembers(user.team_members.practitioner);
        professional = formatTeamMembers(user.team_members.professional);
        groupLeader = formatTeamMembers(user.team_members.group_leader);
    }
    
    const canDelete = isAdmin();
    const canEdit = isAdmin() || isStaff();
    
    // Password visibility: Admin and staff can see/edit all student passwords, students see their own
    const canSeePassword = isAdmin() || isStaff() || user.id === window.currentUser.id;
    
    const userDesignation = user.designation ? `'${user.designation}'` : 'null';
    const gradeValue = user.grade ? `'${user.grade}'` : 'null';
    const userName = user.name ? `'${user.name.replace(/'/g, "\\'")}'` : 'null';
    
    const cardColor = user.card_color || '-';
    const cardColorDisplay = cardColor === '-' ? '-' : cardColor.charAt(0).toUpperCase() + cardColor.slice(1);
    
    row.innerHTML = `
        <td><strong>${name}</strong></td>
        <td>${grade}</td>
        <td>${cardColorDisplay}</td>
        <td style="font-size: 13px;">${caseManager}</td>
        <td style="font-size: 13px;">${practitioner}</td>
        <td style="font-size: 13px;">${professional}</td>
        <td style="font-size: 13px;">${groupLeader}</td>
        <td>${user.username}</td>
        <td id="password-cell-${user.id}">
            ${canSeePassword ? `
                <button class="btn-secondary" style="padding: 4px 12px; font-size: 12px;" onclick="resetAndViewPassword(${user.id}, '${user.username}')">Reset & View Password</button>
            ` : '<span style="color: #999;">Hidden</span>'}
        </td>
        <td class="actions-cell">
            ${canEdit ? `<button class="btn-secondary" onclick="editUser(${user.id}, ${userName}, '${user.username}', '${user.role}', ${user.student_id || 'null'}, ${userDesignation}, ${gradeValue}, ${user.card_color ? `'${user.card_color}'` : 'null'}, null)">Edit</button>` : ''}
            ${canDelete ? `<button class="btn-danger" onclick="deleteUser(${user.id}, '${user.username}', '${user.role}')">Delete</button>` : ''}
        </td>
    `;
    
    return row;
}

// Restore an archived student by creating a new Student User account linked to the
// existing Student record. Admin is prompted for username and password.
async function restoreArchivedStudent(studentId, studentName) {
    if (!isAdmin()) {
        showMessage('Only admins can restore archived students.', 'error');
        return;
    }
    
    const nameForPrompt = studentName || 'this student';
    const username = window.prompt(`Enter a username for ${nameForPrompt}:`);
    if (!username) {
        return;
    }
    const password = window.prompt(`Enter a temporary password for ${nameForPrompt} (they should change it after first login):`);
    if (!password) {
        return;
    }
    
    try {
        const response = await fetch(`/api/students/${studentId}/restore-user`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ username, password })
        });
        
        if (response.ok) {
            showMessage('Student user restored successfully.', 'success');
            // Reload users so both Student Users and Archived Students tables refresh
            await loadUsers();
        } else {
            const data = await response.json().catch(() => ({}));
            const errorMsg = data.error || 'Failed to restore student user.';
            showMessage(errorMsg, 'error');
        }
    } catch (error) {
        console.error('Error restoring archived student:', error);
        showMessage('Error restoring student user. Please try again.', 'error');
    }
}

function createOutsideStaffRow(user) {
    const row = document.createElement('tr');
    row.dataset.userId = user.id;
    
    const name = user.name || user.username;
    const district = user.district || '-';
    
    // Format assigned students for display
    let studentsAssignedDisplay = 'No students assigned';
    if (user.assigned_students && user.assigned_students.length > 0) {
        if (user.assigned_students.length <= 3) {
            studentsAssignedDisplay = user.assigned_students.map(s => s.name).join(', ');
        } else {
            studentsAssignedDisplay = `${user.assigned_students.length} students (${user.assigned_students.slice(0, 2).map(s => s.name).join(', ')}, ...)`;
        }
    }
    
    const canDelete = isAdmin() && user.id !== window.currentUser.id;
    const canEdit = isAdmin();
    const canSeePassword = isAdmin();
    
    const userName = user.name ? `'${user.name.replace(/'/g, "\\'")}'` : 'null';
    const userDistrict = user.district ? `'${user.district.replace(/'/g, "\\'")}'` : 'null';
    
    row.innerHTML = `
        <td><strong>${name}</strong></td>
        <td>${district}</td>
        <td style="cursor: pointer; color: var(--accent); text-decoration: underline;" onclick="manageOutsideStaffStudents(${user.id}, ${userName})" title="Click to manage student assignments">
            ${studentsAssignedDisplay}
        </td>
        <td>${user.username}</td>
        <td id="password-cell-${user.id}">
            ${canSeePassword ? `
                <button class="btn-secondary" style="padding: 4px 12px; font-size: 12px;" onclick="resetAndViewPassword(${user.id}, '${user.username}')">Reset & View Password</button>
            ` : '<span style="color: #999;">Hidden</span>'}
        </td>
        <td class="actions-cell">
            ${canEdit ? `<button class="btn-secondary" onclick="editOutsideStaffUser(${user.id}, ${userName}, '${user.username}', ${userDistrict})">Edit</button>` : ''}
            ${canDelete ? `<button class="btn-danger" onclick="deleteUser(${user.id}, '${user.username}', '${user.role}')">Delete</button>` : ''}
        </td>
    `;
    
    return row;
}


async function resetAndViewPassword(userId, username) {
    // Confirm before resetting
    if (!confirm(`This will reset the password for ${username}. Continue?`)) {
        return;
    }
    
    // Generate a simple, memorable password (username + 2024)
    const newPassword = username + '2024';
    
    try {
        const response = await fetch('/api/users', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                id: userId,
                password: newPassword
            })
        });
        
        if (response.ok) {
            // Update the password cell to show the new password
            const cell = document.getElementById(`password-cell-${userId}`);
            if (cell) {
                cell.innerHTML = `
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <code style="background: #e8f5e9; padding: 6px 12px; border-radius: 4px; font-weight: bold; color: #2e7d32; font-size: 14px;">${newPassword}</code>
                        <button class="btn-secondary" style="padding: 4px 8px; font-size: 11px;" onclick="copyToClipboard('${newPassword}', this)">📋 Copy</button>
                        <button class="btn-secondary" style="padding: 4px 12px; font-size: 12px;" onclick="resetAndViewPassword(${userId}, '${username}')">Reset Again</button>
                    </div>
                `;
            }
            showMessage(`Password reset to: ${newPassword}`, 'success');
        } else {
            const data = await response.json();
            throw new Error(data.error || 'Failed to reset password');
        }
    } catch (error) {
        console.error('Error resetting password:', error);
        showMessage('Error: ' + error.message, 'error');
    }
}

function copyToClipboard(text, buttonElement) {
    navigator.clipboard.writeText(text).then(() => {
        const originalText = buttonElement.textContent;
        buttonElement.textContent = '✓ Copied!';
        buttonElement.style.background = '#4caf50';
        buttonElement.style.color = 'white';
        
        setTimeout(() => {
            buttonElement.textContent = originalText;
            buttonElement.style.background = '';
            buttonElement.style.color = '';
        }, 2000);
    }).catch(err => {
        console.error('Failed to copy:', err);
        alert('Failed to copy to clipboard');
    });
}

async function editUser(userId, name, username, role, studentId, designation, grade, cardColor, gradesTaught, linkedCaseManagerId) {
    // Check permissions
    if (!isAdmin() && role !== 'student' && userId !== window.currentUser.id) {
        alert('You can only edit student accounts or your own account');
        return;
    }
    
    // Map system role to display role for the dropdown
    let displayRole;
    if (role === 'admin') {
        displayRole = 'Admin';
    } else if (role === 'staff' && designation) {
        displayRole = designation;
    } else if (role === 'student') {
        displayRole = 'Student';
    } else {
        displayRole = role;
    }
    
    // Populate the modal
    document.getElementById('edit-user-id').value = userId;
    document.getElementById('edit-user-student-id').value = studentId || '';
    document.getElementById('edit-user-name').value = name || '';
    document.getElementById('edit-user-username').value = username;
    document.getElementById('edit-user-role').value = displayRole;
    document.getElementById('edit-user-original-role').value = role;
    document.getElementById('edit-user-password').value = '';
    document.getElementById('edit-user-password-confirm').value = '';
    
    // Set grades taught if staff (Case Manager / Teacher)
    const gradesTaughtGroup = document.getElementById('edit-user-grades-taught-group');
    const gradesTaughtInput = document.getElementById('edit-user-grades-taught');
    if (gradesTaughtInput) {
        gradesTaughtInput.value = gradesTaught || '';
    }
    const isCaseManagerOrTeacher = role === 'staff' && (designation === 'Case Manager' || designation === 'Teacher');
    if (gradesTaughtGroup) {
        gradesTaughtGroup.style.display = isCaseManagerOrTeacher ? 'block' : 'none';
    }
    
    // Set Case Manager dropdown if staff Paraprofessional
    const editCaseManagerGroup = document.getElementById('edit-user-case-manager-group');
    const editCaseManagerSelect = document.getElementById('edit-user-case-manager-select');
    const isParaprofessional = role === 'staff' && designation === 'Paraprofessional';
    if (editCaseManagerGroup && editCaseManagerSelect) {
        editCaseManagerGroup.style.display = isParaprofessional ? 'block' : 'none';
        if (isParaprofessional) {
            const caseManagers = (typeof allStaffMembers !== 'undefined' ? allStaffMembers : []).filter(
                u => u.role === 'staff' && !u.is_outside_staff && u.designation === 'Case Manager'
            );
            const currentVal = linkedCaseManagerId != null && linkedCaseManagerId !== '' ? String(linkedCaseManagerId) : '';
            editCaseManagerSelect.innerHTML = '<option value="">— Select Case Manager (optional) —</option>';
            caseManagers.forEach(cm => {
                const opt = document.createElement('option');
                opt.value = cm.id;
                opt.textContent = cm.name || cm.username;
                editCaseManagerSelect.appendChild(opt);
            });
            if (currentVal && caseManagers.some(cm => String(cm.id) === currentVal)) {
                editCaseManagerSelect.value = currentVal;
            } else {
                editCaseManagerSelect.value = '';
            }
        }
    }
    
    // Set grade if student
    if (role === 'student' && grade) {
        document.getElementById('edit-user-grade').value = grade;
    }
    
    // Set card color if student
    if (role === 'student') {
        const cardColorSelect = document.getElementById('edit-user-card-color');
        if (cardColorSelect) {
            cardColorSelect.value = cardColor || '';
        }
    }
    
    // Check if staff is editing their own account
    const isStaffEditingSelf = isStaff() && !isAdmin() && userId === window.currentUser.id;
    
    // Disable fields for staff editing themselves (they can only change password)
    const nameInput = document.getElementById('edit-user-name');
    const usernameInput = document.getElementById('edit-user-username');
    const roleSelect = document.getElementById('edit-user-role');
    
    if (isStaffEditingSelf) {
        nameInput.disabled = true;
        nameInput.title = 'Staff can only change their own password';
        usernameInput.disabled = true;
        usernameInput.title = 'Staff can only change their own password';
        roleSelect.disabled = true;
        roleSelect.title = 'Staff can only change their own password';
    } else {
        nameInput.disabled = false;
        nameInput.title = '';
        usernameInput.disabled = false;
        usernameInput.title = '';
        
        // Disable role dropdown for staff editing students (they can't change roles)
        if (isStaff() && !isAdmin()) {
            roleSelect.disabled = true;
            roleSelect.title = 'Only admins can change user roles';
        } else {
            roleSelect.disabled = false;
            roleSelect.title = '';
        }
    }
    
    // Show/hide grade field based on role
    const gradeGroup = document.getElementById('edit-user-grade-group');
    const cardColorGroup = document.getElementById('edit-user-card-color-group');
    if (role === 'student') {
        gradeGroup.style.display = 'block';
        if (cardColorGroup) {
            cardColorGroup.style.display = 'block';
        }
    } else {
        gradeGroup.style.display = 'none';
        if (cardColorGroup) {
            cardColorGroup.style.display = 'none';
        }
    }
    
    // Show/hide role field
    const roleGroup = document.getElementById('edit-user-role-group');
    {
        if (roleGroup) roleGroup.style.display = 'block';
    }
    
    // Hide district field for parent users
    const districtInput = document.getElementById('edit-user-district');
    const districtGroup = districtInput ? districtInput.closest('.form-group') : null;
    if (role === 'parent' && districtGroup) {
        districtGroup.style.display = 'none';
    }
    
    // Show/hide team member section based on role
    const teamSection = document.getElementById('edit-user-team-section');
    if (role === 'student' && studentId) {
        teamSection.style.display = 'block';
        
        // Populate staff member dropdowns
        await populateStaffDropdowns();
        
        // Load current team member assignments
        try {
            const response = await fetch(`/api/team-members/${studentId}`);
            const teamMembers = await response.json();
            
            // Populate team member rows
            populateTeamMemberRows('edit-case-manager-container', teamMembers.case_manager || [], ['case_manager', 'teacher']);
            populateTeamMemberRows('edit-practitioner-container', teamMembers.practitioner || [], ['practitioner']);
            populateTeamMemberRows('edit-professional-container', teamMembers.professional || [], ['professional']);
            populateTeamMemberRows('edit-group-leader-container', teamMembers.group_leader || [], ['group_leader']);
            populateTeamMemberRows('edit-paraprofessional-container', teamMembers.paraprofessional || [], ['paraprofessional']);
        } catch (error) {
            console.error('Error loading team members:', error);
        }
    } else {
        teamSection.style.display = 'none';
    }
    
    
    // Show the modal
    document.getElementById('edit-user-modal').style.display = 'block';
}

// Load parent's linked students for edit modal
async function loadParentStudentsForEdit(parentId) {
    try {
        const response = await fetch('/api/parents');
        const parents = await response.json();
        const parent = parents.find(p => p.id === parentId);
        
        const studentsList = document.getElementById('edit-parent-students-list');
        const claimedDiv = document.getElementById('edit-parent-claimed-name');
        const addInput = document.getElementById('edit-parent-add-student-combobox-input');
        const addHidden = document.getElementById('edit-parent-add-student-id');
        const relSelect = document.getElementById('edit-parent-add-relationship');
        
        if (!parent) {
            if (studentsList) studentsList.innerHTML = '<p>No linked students found.</p>';
            return;
        }
        
        const linkedStudentIds = parent.students ? parent.students.map(s => s.student_id) : [];
        editParentLinkedStudentIds = linkedStudentIds;
        
        if (parent.students && parent.students.length > 0) {
            studentsList.innerHTML = parent.students.map(student => `
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px; margin-bottom: 8px; background: #f5f5f5; border-radius: 4px;">
                    <div>
                        <strong>${student.student_name || 'Unknown'}</strong>
                        <span style="color: var(--text-secondary); margin-left: 10px;">(${student.relationship})</span>
                        ${student.verified ? '<span style="color: green; margin-left: 10px;">✓ Verified</span>' : '<span style="color: orange; margin-left: 10px;">Pending Verification</span>'}
                    </div>
                    <div style="display: flex; gap: 8px;">
                        ${!student.verified ? `<button type="button" class="btn-primary" style="padding: 4px 12px; font-size: 12px;" onclick="verifyParentStudent(${parentId}, ${student.student_id})">Verify</button>` : ''}
                        <button type="button" class="btn-danger" style="padding: 4px 12px; font-size: 12px;" onclick="removeParentStudent(${parentId}, ${student.student_id})">Remove</button>
                    </div>
                </div>
            `).join('');
        } else {
            studentsList.innerHTML = '<p style="color: var(--text-secondary);">No linked students.</p>';
        }
        
        if (claimedDiv) {
            if (parent.claimed_student_name) {
                claimedDiv.style.display = 'block';
                claimedDiv.textContent = 'Parent indicated: ' + parent.claimed_student_name;
            } else {
                claimedDiv.style.display = 'none';
                claimedDiv.textContent = '';
            }
        }
        
        if (relSelect) {
            relSelect.value = parent.claimed_relationship || 'parent';
        }
        
        await loadStudents();
        const pool = (allStudents || []).filter(s => !linkedStudentIds.includes(s.id));
        const claimed = (parent.claimed_student_name || '').trim().toLowerCase();
        let preselected = null;
        if (claimed) {
            preselected = pool.find(s => {
                const n = (s.name || '').toLowerCase();
                return n.includes(claimed) || claimed.includes(n);
            });
        }
        
        if (addInput) { addInput.value = ''; addInput.placeholder = 'Type to search students...'; }
        if (addHidden) addHidden.value = '';
        if (preselected) {
            if (addInput) addInput.value = preselected.name || `Student ${preselected.id}`;
            if (addHidden) addHidden.value = preselected.id;
        }
    } catch (error) {
        console.error('Error loading parent students:', error);
        const el = document.getElementById('edit-parent-students-list');
        if (el) el.innerHTML = '<p style="color: red;">Error loading students.</p>';
    }
}

// Verify parent-student relationship
async function verifyParentStudent(parentId, studentId) {
    if (!confirm('Are you sure you want to verify this parent-student relationship? This will allow the parent to access the student\'s records.')) {
        return;
    }
    
    try {
        const response = await fetch(`/api/parents/${parentId}/verify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ student_id: studentId })
        });
        
        if (response.ok) {
            showMessage('Parent-student relationship verified successfully', 'success');
            await loadParentStudentsForEdit(parentId);
        } else {
            const data = await response.json();
            throw new Error(data.error || 'Failed to verify relationship');
        }
    } catch (error) {
        console.error('Error verifying relationship:', error);
        showMessage('Error: ' + error.message, 'error');
    }
}

// Remove student from parent
async function removeParentStudent(parentId, studentId) {
    if (!confirm('Are you sure you want to remove this student from the parent account?')) {
        return;
    }
    
    try {
        const response = await fetch(`/api/parents/${parentId}/students`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ student_id: studentId })
        });
        
        if (response.ok) {
            showMessage('Student removed successfully', 'success');
            await loadParentStudentsForEdit(parentId);
        } else {
            const data = await response.json();
            throw new Error(data.error || 'Failed to remove student');
        }
    } catch (error) {
        console.error('Error removing student:', error);
        showMessage('Error: ' + error.message, 'error');
    }
}

// Add student to parent
async function addParentStudent(parentId) {
    const hidden = document.getElementById('edit-parent-add-student-id');
    const input = document.getElementById('edit-parent-add-student-combobox-input');
    const relationshipSelect = document.getElementById('edit-parent-add-relationship');
    const studentId = hidden ? parseInt(hidden.value) : NaN;
    const relationship = relationshipSelect ? relationshipSelect.value : 'parent';
    
    if (!studentId) {
        alert('Please select a student');
        return;
    }
    
    try {
        const response = await fetch(`/api/parents/${parentId}/students`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                student_id: studentId,
                relationship: relationship
            })
        });
        
        if (response.ok) {
            showMessage('Student added successfully', 'success');
            if (hidden) hidden.value = '';
            if (input) input.value = '';
            await loadParentStudentsForEdit(parentId);
        } else {
            const data = await response.json();
            throw new Error(data.error || 'Failed to add student');
        }
    } catch (error) {
        console.error('Error adding student:', error);
        showMessage('Error: ' + error.message, 'error');
    }
}

// Function to create a new team member row (similar to createInfractionRow)
function createTeamMemberRow(containerId, selectedUsername = '', roles = []) {
    const row = document.createElement('div');
    row.className = 'form-group team-member-group';
    row.style.display = 'flex';
    row.style.alignItems = 'center';
    row.style.gap = '10px';
    row.style.marginBottom = '10px';
    
    const select = document.createElement('select');
    select.className = 'team-member-select';
    select.style.flex = '1';
    
    const defaultOption = document.createElement('option');
    defaultOption.value = '';
    defaultOption.textContent = 'Select Team Member';
    select.appendChild(defaultOption);
    
    // Add staff members who match the role requirements
    allStaffMembers.forEach(staff => {
        const staffName = staff.name || staff.username;
        
        // Map designations to their applicable roles
        const getApplicableRoles = (designation) => {
            const roleMap = {
                'Case Manager': ['case_manager', 'teacher'],
                'Practitioner': ['practitioner', 'group_leader'],
                'Paraprofessional': ['paraprofessional'],
                'Professional': ['professional'],
                'Admin': ['admin']
            };
            return roleMap[designation] || [];
        };
        
        let shouldInclude = false;
        if (!staff.designation) {
            // Staff without designation can be assigned to any role
            shouldInclude = true;
        } else {
            // Check if staff's designation applies to this role
            const applicableRoles = getApplicableRoles(staff.designation);
            shouldInclude = roles.some(role => applicableRoles.includes(role));
        }
        
        if (shouldInclude) {
            const option = document.createElement('option');
            option.value = staff.username;
            const designationText = staff.designation ? ` (${staff.designation})` : ' (No designation)';
            option.textContent = `${staffName}${designationText}`;
            if (staff.username === selectedUsername) {
                option.selected = true;
            }
            select.appendChild(option);
        }
    });
    
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'delete-btn';
    removeBtn.textContent = '×';
    removeBtn.style.padding = '4px 8px';
    removeBtn.style.fontSize = '14px';
    removeBtn.onclick = function() {
        row.remove();
    };
    
    row.appendChild(select);
    row.appendChild(removeBtn);
    
    return row;
}

// Helper function to get selected team member usernames from a container
function getSelectedTeamMembers(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return [];
    
    const rows = container.querySelectorAll('.team-member-group');
    const usernames = [];
    rows.forEach(row => {
        const select = row.querySelector('.team-member-select');
        if (select && select.value) {
            usernames.push(select.value);
        }
    });
    return usernames;
}

// Helper function to populate team member rows in a container
function populateTeamMemberRows(containerId, usernames, roles) {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    container.innerHTML = '';
    
    // Handle both array and single value for backward compatibility
    const usernameArray = Array.isArray(usernames) ? usernames : (usernames ? [usernames] : []);
    
    // Always show at least one empty row if no team members
    if (usernameArray.length === 0) {
        usernameArray.push('');
    }
    
    usernameArray.forEach(username => {
        const row = createTeamMemberRow(containerId, username, roles);
        container.appendChild(row);
    });
}

// Set up team member add buttons (for both add and edit modals)
function setupTeamMemberButtons() {
    // Add Student modal buttons
    const addButtons = [
        { id: 'add-case-manager-btn', container: 'case-manager-container', roles: ['case_manager', 'teacher'] },
        { id: 'add-practitioner-btn', container: 'practitioner-container', roles: ['practitioner'] },
        { id: 'add-professional-btn', container: 'professional-container', roles: ['professional'] },
        { id: 'add-group-leader-btn', container: 'group-leader-container', roles: ['group_leader'] }
    ];
    
    addButtons.forEach(config => {
        const btn = document.getElementById(config.id);
        if (btn) {
            // Remove old listeners by replacing button
            const newBtn = btn.cloneNode(true);
            btn.parentNode.replaceChild(newBtn, btn);
            
            newBtn.addEventListener('click', function() {
                const container = document.getElementById(config.container);
                if (container) {
                    const row = createTeamMemberRow(config.container, '', config.roles);
                    container.appendChild(row);
                }
            });
        }
    });
    
    // Edit User modal buttons
    const editButtons = [
        { id: 'edit-add-case-manager-btn', container: 'edit-case-manager-container', roles: ['case_manager', 'teacher'] },
        { id: 'edit-add-practitioner-btn', container: 'edit-practitioner-container', roles: ['practitioner'] },
        { id: 'edit-add-professional-btn', container: 'edit-professional-container', roles: ['professional'] },
        { id: 'edit-add-group-leader-btn', container: 'edit-group-leader-container', roles: ['group_leader'] },
        { id: 'edit-add-paraprofessional-btn', container: 'edit-paraprofessional-container', roles: ['paraprofessional'] }
    ];
    
    editButtons.forEach(config => {
        const btn = document.getElementById(config.id);
        if (btn) {
            // Remove old listeners by replacing button
            const newBtn = btn.cloneNode(true);
            btn.parentNode.replaceChild(newBtn, btn);
            
            newBtn.addEventListener('click', function() {
                const container = document.getElementById(config.container);
                if (container) {
                    const row = createTeamMemberRow(config.container, '', config.roles);
                    container.appendChild(row);
                }
            });
        }
    });
}

async function populateStaffDropdowns() {
    // This function is now just for setting up button handlers
    setupTeamMemberButtons();
}

async function populateAddStudentDropdowns() {
    // This function is now just for setting up button handlers
    setupTeamMemberButtons();
}

async function saveEditUser() {
    const userId = parseInt(document.getElementById('edit-user-id').value);
    const studentId = document.getElementById('edit-user-student-id').value;
    const name = document.getElementById('edit-user-name').value.trim();
    const username = document.getElementById('edit-user-username').value.trim();
    const displayRole = document.getElementById('edit-user-role').value;
    const originalRole = document.getElementById('edit-user-original-role').value;
    const password = document.getElementById('edit-user-password').value;
    const passwordConfirm = document.getElementById('edit-user-password-confirm').value;
    const grade = document.getElementById('edit-user-grade').value;
    const cardColor = document.getElementById('edit-user-card-color')?.value || '';
    
    // Map display role to system role and designation
    // Skip role mapping for parent users (role field is hidden)
    let systemRole;
    let designation = null;
    
    if (originalRole === 'parent') {
        // For parent users, keep the role as 'parent' and skip role mapping
        systemRole = 'parent';
    } else if (displayRole === 'Admin') {
        systemRole = 'admin';
    } else if (displayRole === 'Student') {
        systemRole = 'student';
    } else {
        // It's a staff designation (Case Manager, Practitioner, etc.)
        systemRole = 'staff';
        designation = displayRole;
    }
    
    // Validation
    if (!username) {
        alert('Please enter a username');
        return;
    }
    
    // Check if role changed and user is not admin
    // Skip role check for parent users (role cannot be changed)
    if (originalRole !== 'parent' && systemRole !== originalRole && !isAdmin()) {
        alert('Only admins can change user roles');
        return;
    }
    
    // For parent users, don't allow role changes (this check is redundant but safe)
    if (originalRole === 'parent' && systemRole !== 'parent') {
        alert('Parent role cannot be changed');
        return;
    }
    
    // Check password if provided
    if (password) {
        if (password.length < 6) {
            alert('Password must be at least 6 characters long');
            return;
        }
        
        if (password !== passwordConfirm) {
            alert('Passwords do not match');
            return;
        }
    }
    
    // Prepare update data
    const updateData = {
        id: userId,
        name: name || null,
        username: username
    };
    
    // Check if this is an Outside Staff user (district field visible means it's Outside Staff)
    const districtInput = document.getElementById('edit-user-district');
    const districtGroup = districtInput ? districtInput.closest('.form-group') : null;
    const isOutsideStaffUser = districtGroup && districtGroup.style.display !== 'none';
    
    // For Outside Staff, always keep role as 'staff' and don't allow role changes
    if (isOutsideStaffUser) {
        updateData.role = 'staff';
        const district = districtInput.value.trim();
        updateData.is_outside_staff = true;
        updateData.district = district || null;
    } else if (originalRole === 'parent') {
        // For parent users, keep role as 'parent' and don't include role in update
        // Parent role cannot be changed
    } else {
        // Only include role if admin and it changed (for non-Outside Staff users)
        if (isAdmin() && systemRole !== originalRole) {
            updateData.role = systemRole;
        }
        
        // Include designation for regular staff users (not Outside Staff)
        if (systemRole === 'staff') {
            updateData.designation = designation;
            updateData.is_outside_staff = false;
        }
    }
    
    // Include grade for student users
    if (systemRole === 'student' && grade) {
        updateData.grade = grade;
    }
    
    // Include grades_taught for staff (Case Manager / Teacher)
    if (systemRole === 'staff') {
        const gradesTaughtInput = document.getElementById('edit-user-grades-taught');
        if (gradesTaughtInput) {
            const gradesTaught = gradesTaughtInput.value.trim();
            updateData.grades_taught = gradesTaught || null;
        }
        if (designation === 'Paraprofessional') {
            const editCaseManagerSelect = document.getElementById('edit-user-case-manager-select');
            const linkedId = editCaseManagerSelect ? editCaseManagerSelect.value : '';
            updateData.linked_case_manager_id = linkedId ? parseInt(linkedId, 10) : null;
        }
    }
    
    // Include card_color for student users
    if (systemRole === 'student') {
        updateData.card_color = cardColor || null;
    }
    
    // Only include password if provided
    if (password) {
        updateData.password = password;
    }
    
    try {
        // Update user account
        const response = await fetch('/api/users', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updateData)
        });
        
        if (!response.ok) {
            const data = await response.json();
            throw new Error(data.error || 'Failed to update user');
        }
        
        // Update team members if this is a student account
        if (systemRole === 'student' && studentId) {
            const teamMemberData = {
                case_manager: getSelectedTeamMembers('edit-case-manager-container'),
                practitioner: getSelectedTeamMembers('edit-practitioner-container'),
                professional: getSelectedTeamMembers('edit-professional-container'),
                group_leader: getSelectedTeamMembers('edit-group-leader-container'),
                paraprofessional: getSelectedTeamMembers('edit-paraprofessional-container')
            };
            
            const teamResponse = await fetch(`/api/team-members/${studentId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(teamMemberData)
            });
            
            if (!teamResponse.ok) {
                console.error('Failed to update team members');
            }
        }
        
        showMessage('User updated successfully', 'success');
        document.getElementById('edit-user-modal').style.display = 'none';
        await loadUsers();
        // If a student user was updated, reload students to update all dropdowns
        if (systemRole === 'student') {
            await loadStudents();
        }
    } catch (error) {
        console.error('Error updating user:', error);
        showMessage('Error: ' + error.message, 'error');
    }
}

async function archiveStudentUser(userId, username, displayName) {
    if (typeof isAdmin === 'function' && !isAdmin()) {
        if (typeof showMessage === 'function') {
            showMessage('Only admins can archive students.', 'error');
        } else {
            alert('Only admins can archive students.');
        }
        return;
    }

    const nameForMessages = displayName || username || 'this student';
    const confirmMessage = [
        'Archive Student Account',
        '',
        `This will remove login access for "${nameForMessages}" and move them to the Archived Students list.`,
        '',
        'Their historical data will be preserved and the account can be restored later from Archived Students.',
        '',
        'Do you want to continue?'
    ].join('\n');

    if (!confirm(confirmMessage)) {
        return;
    }

    try {
        const response = await fetch(`/api/users?id=${userId}`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' }
        });

        if (response.ok) {
            if (typeof showMessage === 'function') {
                showMessage(`Student "${nameForMessages}" has been archived.`, 'success');
            } else {
                alert(`Student "${nameForMessages}" has been archived.`);
            }
            if (typeof loadUsers === 'function') {
                await loadUsers();
            }
        } else {
            const data = await response.json().catch(() => ({}));
            const errorMsg = data.error || 'Failed to archive student.';
            if (typeof showMessage === 'function') {
                showMessage(errorMsg, 'error');
            } else {
                alert(errorMsg);
            }
        }
    } catch (error) {
        console.error('Error archiving student:', error);
        if (typeof showMessage === 'function') {
            showMessage('Error archiving student: ' + error.message, 'error');
        } else {
            alert('Error archiving student: ' + error.message);
        }
    }
}

async function deleteUser(userId, username, role) {
    const roleText = role === 'admin' ? 'ADMIN USER' : 
                     role === 'staff' ? 'STAFF USER' : 'STUDENT USER';
    
    if (!confirm(`⚠️ WARNING: Delete ${roleText}\n\nAre you sure you want to delete user "${username}"?\n\nThis action CANNOT be undone!`)) {
        return;
    }
    
    try {
        const response = await fetch(`/api/users?id=${userId}`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' }
        });
        
        if (response.ok) {
            showMessage(`User "${username}" deleted successfully`, 'success');
            await loadUsers();
        } else {
            const data = await response.json();
            throw new Error(data.error || 'Failed to delete user');
        }
    } catch (error) {
        console.error('Error deleting user:', error);
        showMessage('Error deleting user: ' + error.message, 'error');
    }
}

// Helper function to show error messages in modals
function showModalError(modalId, message) {
    const errorDiv = document.getElementById(modalId + '-error');
    if (errorDiv) {
        errorDiv.textContent = message;
        errorDiv.style.display = 'block';
        // Scroll to top of modal to show error
        errorDiv.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
}

// Helper function to hide error messages in modals
function hideModalError(modalId) {
    const errorDiv = document.getElementById(modalId + '-error');
    if (errorDiv) {
        errorDiv.style.display = 'none';
        errorDiv.textContent = '';
    }
}

/** Show/hide and populate the Case Manager dropdown in Add Staff modal when role is Paraprofessional. */
function updateStaffCaseManagerGroup() {
    const staffRoleSelect = document.getElementById('staff-role');
    const staffCaseManagerGroup = document.getElementById('staff-case-manager-group');
    const staffCaseManagerSelect = document.getElementById('staff-case-manager-select');
    if (!staffRoleSelect || !staffCaseManagerGroup || !staffCaseManagerSelect) return;
    const isParaprofessional = staffRoleSelect.value === 'Paraprofessional';
    staffCaseManagerGroup.style.display = isParaprofessional ? 'block' : 'none';
    if (!isParaprofessional) return;
    const caseManagers = (typeof allStaffMembers !== 'undefined' ? allStaffMembers : []).filter(
        u => u.role === 'staff' && !u.is_outside_staff && u.designation === 'Case Manager'
    );
    const currentValue = staffCaseManagerSelect.value;
    staffCaseManagerSelect.innerHTML = '<option value="">— Select Case Manager (optional) —</option>';
    caseManagers.forEach(cm => {
        const opt = document.createElement('option');
        opt.value = cm.id;
        opt.textContent = cm.name || cm.username;
        staffCaseManagerSelect.appendChild(opt);
    });
    if (currentValue && caseManagers.some(cm => String(cm.id) === currentValue)) {
        staffCaseManagerSelect.value = currentValue;
    }
}

async function saveStaffUser() {
    // Clear any previous errors
    hideModalError('staff-modal');
    
    const name = document.getElementById('staff-name').value.trim();
    const username = document.getElementById('staff-username').value.trim();
    const password = document.getElementById('staff-password').value;
    const passwordConfirm = document.getElementById('staff-password-confirm').value;
    const role = document.getElementById('staff-role').value;
    
    if (!name || !username || !password) {
        showModalError('staff-modal', 'Please fill in all required fields');
        return;
    }
    
    if (password.length < 6) {
        showModalError('staff-modal', 'Password must be at least 6 characters long');
        return;
    }
    
    if (password !== passwordConfirm) {
        showModalError('staff-modal', 'Passwords do not match');
        return;
    }
    
    const gradesTaughtInput = document.getElementById('staff-grades-taught');
    const gradesTaught = gradesTaughtInput ? gradesTaughtInput.value.trim() : '';
    
    try {
        const payload = {
            name: name,
            username: username,
            password: password,
            role: 'staff',
            designation: role
        };
        if (role === 'Case Manager' && gradesTaught) {
            payload.grades_taught = gradesTaught;
        }
        if (role === 'Paraprofessional') {
            const staffCaseManagerSelect = document.getElementById('staff-case-manager-select');
            const linkedId = staffCaseManagerSelect ? staffCaseManagerSelect.value : '';
            if (linkedId) payload.linked_case_manager_id = parseInt(linkedId, 10);
        }
        const response = await fetch('/api/users', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        
        if (response.ok) {
            showMessage('Staff user created successfully', 'success');
            document.getElementById('staff-modal').style.display = 'none';
            hideModalError('staff-modal');
            document.getElementById('staff-name').value = '';
            document.getElementById('staff-username').value = '';
            document.getElementById('staff-password').value = '';
            document.getElementById('staff-password-confirm').value = '';
            document.getElementById('staff-role').value = 'Case Manager';
            const staffGradesTaughtEl = document.getElementById('staff-grades-taught');
            if (staffGradesTaughtEl) staffGradesTaughtEl.value = '';
            const staffGradesTaughtGrp = document.getElementById('staff-grades-taught-group');
            if (staffGradesTaughtGrp) staffGradesTaughtGrp.style.display = 'none';
            const staffCaseManagerGrp = document.getElementById('staff-case-manager-group');
            if (staffCaseManagerGrp) staffCaseManagerGrp.style.display = 'none';
            const staffCaseManagerSel = document.getElementById('staff-case-manager-select');
            if (staffCaseManagerSel) staffCaseManagerSel.value = '';
            await loadUsers();
        } else {
            let data;
            try {
                data = await response.json();
            } catch (_) {
                throw new Error(response.status === 401 ? 'Session expired. Please log in again.' : 'Server error. Please try again.');
            }
            throw new Error(data.error || 'Failed to create staff user');
        }
    } catch (error) {
        console.error('Error creating staff user:', error);
        showModalError('staff-modal', 'Error: ' + error.message);
    }
}

async function saveOutsideStaffUser() {
    // Clear any previous errors
    hideModalError('outside-staff-modal');
    
    const name = document.getElementById('outside-staff-name').value.trim();
    const username = document.getElementById('outside-staff-username').value.trim();
    const district = document.getElementById('outside-staff-district').value.trim();
    const password = document.getElementById('outside-staff-password').value;
    const passwordConfirm = document.getElementById('outside-staff-password-confirm').value;
    
    if (!name || !username || !district || !password) {
        showModalError('outside-staff-modal', 'Please fill in all required fields');
        return;
    }
    
    if (password.length < 6) {
        showModalError('outside-staff-modal', 'Password must be at least 6 characters long');
        return;
    }
    
    if (password !== passwordConfirm) {
        showModalError('outside-staff-modal', 'Passwords do not match');
        return;
    }
    
    try {
        const response = await fetch('/api/users', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: name,
                username: username,
                password: password,
                role: 'staff',
                is_outside_staff: true,
                district: district
            })
        });
        
        if (response.ok) {
            showMessage('Outside Staff user created successfully', 'success');
            document.getElementById('outside-staff-modal').style.display = 'none';
            hideModalError('outside-staff-modal');
            document.getElementById('outside-staff-name').value = '';
            document.getElementById('outside-staff-username').value = '';
            document.getElementById('outside-staff-district').value = '';
            document.getElementById('outside-staff-password').value = '';
            document.getElementById('outside-staff-password-confirm').value = '';
            await loadUsers();
        } else {
            let data;
            try {
                data = await response.json();
            } catch (_) {
                throw new Error(response.status === 401 ? 'Session expired. Please log in again.' : 'Server error. Please try again.');
            }
            throw new Error(data.error || 'Failed to create Outside Staff user');
        }
    } catch (error) {
        console.error('Error creating Outside Staff user:', error);
        showModalError('outside-staff-modal', 'Error: ' + error.message);
    }
}

async function saveAdminUser() {
    const name = document.getElementById('admin-name').value.trim();
    const username = document.getElementById('admin-username').value.trim();
    const password = document.getElementById('admin-password').value;
    const passwordConfirm = document.getElementById('admin-password-confirm').value;
    
    if (!name || !username || !password) {
        alert('Please fill in all required fields');
        return;
    }
    
    if (password.length < 6) {
        alert('Password must be at least 6 characters long');
        return;
    }
    
    if (password !== passwordConfirm) {
        alert('Passwords do not match');
        return;
    }
    
    try {
        const response = await fetch('/api/users', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: name,
                username: username,
                password: password,
                role: 'admin'
            })
        });
        
        if (response.ok) {
            showMessage('Admin user created successfully', 'success');
            document.getElementById('admin-modal').style.display = 'none';
            document.getElementById('admin-name').value = '';
            document.getElementById('admin-username').value = '';
            document.getElementById('admin-password').value = '';
            document.getElementById('admin-password-confirm').value = '';
            await loadUsers();
        } else {
            let data;
            try {
                data = await response.json();
            } catch (_) {
                throw new Error(response.status === 401 ? 'Session expired. Please log in again.' : 'Server error. Please try again.');
            }
            throw new Error(data.error || 'Failed to create admin user');
        }
    } catch (error) {
        console.error('Error creating admin user:', error);
        showMessage('Error: ' + error.message, 'error');
    }
}

function filterStudentsByName(students, query) {
    if (!Array.isArray(students)) return [];
    const q = (query || '').trim().toLowerCase();
    if (!q) return [...students];
    return students.filter(s => {
        const name = (s.name || '').toLowerCase();
        return name.includes(q) || q.includes(name);
    });
}

function setupEditParentAddStudentCombobox() {
    const input = document.getElementById('edit-parent-add-student-combobox-input');
    const hidden = document.getElementById('edit-parent-add-student-id');
    const dropdown = document.getElementById('edit-parent-add-student-dropdown');
    if (!input || !hidden || !dropdown) return;

    function pool() {
        return (allStudents || []).filter(s => !editParentLinkedStudentIds.includes(s.id));
    }

    function render() {
        const query = input.value.trim();
        const list = filterStudentsByName(pool(), query);
        dropdown.innerHTML = '';
        list.forEach(student => {
            const name = student.name || `Student ${student.id}`;
            const div = document.createElement('div');
            div.className = 'student-combobox-item';
            div.dataset.id = student.id;
            div.dataset.name = name;
            div.style.cssText = 'padding: 8px 12px; cursor: pointer; border-bottom: 1px solid #eee;';
            div.textContent = name;
            div.addEventListener('click', () => selectStudent(student.id, name));
            dropdown.appendChild(div);
        });
        dropdown.style.display = list.length ? 'block' : 'none';
    }

    function selectStudent(id, name) {
        hidden.value = id;
        input.value = name;
        dropdown.style.display = 'none';
        dropdown.innerHTML = '';
    }

    input.addEventListener('focus', () => render());
    input.addEventListener('input', () => render());
    input.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const first = dropdown.querySelector('.student-combobox-item');
        if (first) selectStudent(parseInt(first.dataset.id), first.dataset.name);
    });
    input.addEventListener('blur', () => {
        setTimeout(() => {
            dropdown.style.display = 'none';
            dropdown.innerHTML = '';
        }, 200);
    });
}

async function manageOutsideStaffStudents(userId, name) {
    // Fetch assigned students
    const response = await fetch(`/api/outside-staff/${userId}/students`);
    const assignedStudents = await response.json();
    const assignedStudentIds = assignedStudents.map(s => s.id);
    
    // Fetch all students
    const studentsResponse = await fetch('/api/students');
    const allStudents = await studentsResponse.json();
    
    // Create modal content
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.style.display = 'block';
    const displayName = name !== 'null' ? name.replace(/\\'/g, "'") : 'User';
    modal.innerHTML = `
        <div class="modal-content" style="max-width: 600px; max-height: 80vh; overflow-y: auto;">
            <span class="close" onclick="this.closest('.modal').remove()">&times;</span>
            <h2>Manage Students for ${displayName}</h2>
            <p style="margin-bottom: 15px; color: var(--text-secondary);">Select students to assign to this Outside Staff user:</p>
            <div class="form-group" style="margin-bottom: 15px;">
                <input type="text" id="student-assignment-search" placeholder="🔍 Search students by name..." style="width: 100%; padding: 10px; border: 1px solid var(--border); border-radius: 4px;">
            </div>
            <div id="student-assignment-list" style="max-height: 400px; overflow-y: auto; border: 1px solid var(--border); padding: 10px; border-radius: 4px;">
                ${allStudents.map(student => `
                    <label class="student-assignment-item" data-student-name="${student.name.toLowerCase()}" style="display: block; padding: 8px; cursor: pointer;">
                        <input type="checkbox" value="${student.id}" ${assignedStudentIds.includes(student.id) ? 'checked' : ''} style="margin-right: 8px;">
                        ${student.name}
                    </label>
                `).join('')}
            </div>
            <div style="margin-top: 20px; display: flex; gap: 10px;">
                <button id="save-student-assignments-btn" class="btn-primary">Save Assignments</button>
                <button onclick="this.closest('.modal').remove()" class="btn-secondary">Cancel</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    
    // Add search functionality
    const searchInput = document.getElementById('student-assignment-search');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            const query = e.target.value.toLowerCase().trim();
            const items = modal.querySelectorAll('.student-assignment-item');
            items.forEach(item => {
                const studentName = item.dataset.studentName;
                if (query === '' || studentName.includes(query)) {
                    item.style.display = 'block';
                } else {
                    item.style.display = 'none';
                }
            });
        });
    }
    
    // Handle save
    document.getElementById('save-student-assignments-btn').addEventListener('click', async () => {
        const checkboxes = modal.querySelectorAll('input[type="checkbox"]:checked');
        const selectedStudentIds = Array.from(checkboxes).map(cb => parseInt(cb.value));
        
        try {
            // First, get current assignments and unassign all
            const currentResponse = await fetch(`/api/outside-staff/${userId}/students`);
            const currentStudents = await currentResponse.json();
            for (const student of currentStudents) {
                await fetch(`/api/outside-staff/${userId}/students?student_id=${student.id}`, {
                    method: 'DELETE'
                });
            }
            
            // Then assign selected students
            if (selectedStudentIds.length > 0) {
                const assignResponse = await fetch(`/api/outside-staff/${userId}/students`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ student_ids: selectedStudentIds })
                });
                
                if (!assignResponse.ok) {
                    throw new Error('Failed to assign students');
                }
            }
            
            showMessage('Student assignments updated successfully', 'success');
            modal.remove();
            await loadUsers();
        } catch (error) {
            console.error('Error updating student assignments:', error);
            showMessage('Error: ' + error.message, 'error');
        }
    });
}

function editOutsideStaffUser(userId, name, username, district) {
    try {
        document.getElementById('edit-user-id').value = userId;
        document.getElementById('edit-user-name').value = name !== 'null' ? name.replace(/\\'/g, "'") : '';
        document.getElementById('edit-user-username').value = username;
        document.getElementById('edit-user-role').value = 'Staff';
        document.getElementById('edit-user-original-role').value = 'staff';
        
        // Hide the role field for Outside Staff (they can't change their role)
        const roleFormGroup = document.getElementById('edit-user-role').closest('.form-group');
        if (roleFormGroup) {
            roleFormGroup.style.display = 'none';
        }
        
        // Show district field if it exists, or create it
        let districtGroup = document.getElementById('edit-user-district-group');
        if (!districtGroup) {
            // Find the username field and insert district field after it
            const usernameInput = document.getElementById('edit-user-username');
            const usernameFormGroup = usernameInput.closest('.form-group');
            districtGroup = document.createElement('div');
            districtGroup.id = 'edit-user-district-group';
            districtGroup.className = 'form-group';
            districtGroup.innerHTML = `
                <label for="edit-user-district">District:</label>
                <input type="text" id="edit-user-district" placeholder="Enter district name">
            `;
            if (usernameFormGroup && usernameFormGroup.nextSibling) {
                usernameFormGroup.parentNode.insertBefore(districtGroup, usernameFormGroup.nextSibling);
            } else if (usernameFormGroup) {
                usernameFormGroup.parentNode.appendChild(districtGroup);
            }
        }
        const districtInput = document.getElementById('edit-user-district');
        if (districtInput) {
            districtInput.value = district !== 'null' ? district.replace(/\\'/g, "'") : '';
        }
        if (districtGroup) {
            districtGroup.style.display = 'block';
        }
        
        // Hide fields not relevant for Outside Staff
        const gradeGroup = document.getElementById('edit-user-grade-group');
        if (gradeGroup) gradeGroup.style.display = 'none';
        const cardColorGroup = document.getElementById('edit-user-card-color-group');
        if (cardColorGroup) cardColorGroup.style.display = 'none';
        const teamSection = document.getElementById('edit-user-team-members-section');
        if (teamSection) teamSection.style.display = 'none';
        
        document.getElementById('edit-user-modal').style.display = 'block';
    } catch (error) {
        console.error('Error in editOutsideStaffUser:', error);
        alert('Error opening edit dialog. Please check the console for details.');
    }
}

function loadAdminStats(users) {
    const statsContainer = document.getElementById('admin-stats');
    if (!statsContainer) return;
    
    const adminCount = users.filter(u => u.role === 'admin').length;
    const staffCount = users.filter(u => u.role === 'staff').length;
    const studentCount = users.filter(u => u.role === 'student').length;
    const totalCount = users.length;
    
    statsContainer.innerHTML = `
        <div style="background: var(--bg-surface); padding: 15px; border-radius: var(--radius-sm); border-left: 3px solid var(--danger);">
            <div style="font-size: 24px; font-weight: bold; color: var(--danger);">${adminCount}</div>
            <div style="color: var(--text-secondary); font-size: 12px;">Admin Users</div>
        </div>
        <div style="background: var(--bg-surface); padding: 15px; border-radius: var(--radius-sm); border-left: 3px solid var(--accent);">
            <div style="font-size: 24px; font-weight: bold; color: var(--accent);">${staffCount}</div>
            <div style="color: var(--text-secondary); font-size: 12px;">Staff Users</div>
        </div>
        <div style="background: var(--bg-surface); padding: 15px; border-radius: var(--radius-sm); border-left: 3px solid var(--success);">
            <div style="font-size: 24px; font-weight: bold; color: var(--success);">${studentCount}</div>
            <div style="color: var(--text-secondary); font-size: 12px;">Student Users</div>
        </div>
        <div style="background: var(--bg-surface); padding: 15px; border-radius: 6px; border-left: 3px solid var(--accent);">
            <div style="font-size: 24px; font-weight: bold; color: var(--accent);">${totalCount}</div>
            <div style="color: var(--text-secondary); font-size: 12px;">Total Users</div>
        </div>
    `;
    
    // Load system info
    const systemInfoContainer = document.getElementById('system-info');
    if (systemInfoContainer) {
        systemInfoContainer.innerHTML = `
            <div style="display: grid; gap: 10px;">
                <div><strong>Current User:</strong> ${window.currentUser.username} (${window.currentUser.role})</div>
                <div><strong>Database:</strong> SQLite (behavior_tracking.db)</div>
                <div><strong>Total Students:</strong> ${allStudents.length}</div>
            </div>
        `;
    }
}


function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
        showMessage('Copied to clipboard!', 'success');
    }).catch(err => {
        console.error('Failed to copy:', err);
    });
}

// Event listeners for schedule management
document.addEventListener('DOMContentLoaded', () => {
    // Initialize teacher schedule on page load (for staff/admin)
    // Note: Schedules will be rendered when schedules view is shown
    // We don't load here to avoid unnecessary API calls if user never visits schedules tab
    
    // Teacher schedule staff search (view another staff's schedule)
    const teacherScheduleStaffSearch = document.getElementById('teacher-schedule-staff-search');
    if (teacherScheduleStaffSearch) {
        teacherScheduleStaffSearch.addEventListener('change', (e) => {
            const val = e.target.value;
            if (!val) return;
            const userId = parseInt(val, 10);
            loadSchedules('teacher', null, userId).catch(err => {
                showMessage(err.message || 'Could not load schedule.', 'error');
                if (window.currentUser) {
                    teacherScheduleStaffSearch.value = String(window.currentUser.id);
                    loadSchedules('teacher');
                }
            });
        });
    }

    // Schedule student selector
    const scheduleStudentSelect = document.getElementById('schedule-student-select');
    if (scheduleStudentSelect) {
        scheduleStudentSelect.addEventListener('change', (e) => {
            currentScheduleStudentId = parseInt(e.target.value);
            if (currentScheduleStudentId) {
                loadSchedules('student', currentScheduleStudentId);
            }
        });
        // Note: Student dropdown is now populated by loadStudents() function
    }
    
    // Schedule "Show students managed by me" checkbox
    const scheduleManagedByMeCheckbox = document.getElementById('schedule-managed-by-me-checkbox');
    if (scheduleManagedByMeCheckbox) {
        scheduleManagedByMeCheckbox.addEventListener('change', async () => {
            const currentSelection = scheduleStudentSelect ? scheduleStudentSelect.value : null;
            await loadStudents(scheduleManagedByMeCheckbox.checked, false, true);
            if (currentSelection && scheduleStudentSelect) {
                const optionExists = Array.from(scheduleStudentSelect.options).some(opt => opt.value === currentSelection);
                if (!optionExists) {
                    scheduleStudentSelect.value = '';
                    currentScheduleStudentId = null;
                    studentScheduleData = [];
                    renderStudentSchedule();
                }
            }
        });
    }
    
    // Add period buttons
    const addTeacherPeriodBtn = document.getElementById('add-teacher-period-btn');
    if (addTeacherPeriodBtn) {
        addTeacherPeriodBtn.addEventListener('click', () => addScheduleRow('teacher'));
    }
    
    const addStudentPeriodBtn = document.getElementById('add-student-period-btn');
    if (addStudentPeriodBtn) {
        addStudentPeriodBtn.addEventListener('click', () => addScheduleRow('student'));
    }
    
    // Save schedule buttons
    const saveTeacherScheduleBtn = document.getElementById('save-teacher-schedule-btn');
    if (saveTeacherScheduleBtn) {
        saveTeacherScheduleBtn.addEventListener('click', () => saveSchedule('teacher'));
    }
    
    const saveStudentScheduleBtn = document.getElementById('save-student-schedule-btn');
    if (saveStudentScheduleBtn) {
        saveStudentScheduleBtn.addEventListener('click', () => saveSchedule('student'));
    }
    
    // User management buttons
    initializeUserManagementTableAutoFitObserver();

    const refreshUsersBtn = document.getElementById('refresh-users-btn');
    if (refreshUsersBtn) {
        refreshUsersBtn.addEventListener('click', loadUsers);
    }
    
    // Search functionality for user tables
    const studentSearch = document.getElementById('student-search');
    if (studentSearch) {
        studentSearch.addEventListener('input', (e) => filterUserTable('student', e.target.value));
    }
    
    const staffSearch = document.getElementById('staff-search');
    if (staffSearch) {
        staffSearch.addEventListener('input', (e) => filterUserTable('staff', e.target.value));
    }
    
    const adminSearch = document.getElementById('admin-search');
    if (adminSearch) {
        // Start as read-only; enable editing once the user selects the field
        adminSearch.readOnly = true;

        const enableAdminSearchEditing = () => {
            adminSearch.readOnly = false;
            adminSearch.removeEventListener('focus', enableAdminSearchEditing);
            adminSearch.removeEventListener('click', enableAdminSearchEditing);
        };

        adminSearch.addEventListener('focus', enableAdminSearchEditing);
        adminSearch.addEventListener('click', enableAdminSearchEditing);

        adminSearch.addEventListener('input', (e) => filterUserTable('admin', e.target.value));
    }
    
    const outsideStaffSearch = document.getElementById('outside-staff-search');
    if (outsideStaffSearch) {
        outsideStaffSearch.addEventListener('input', (e) => filterUserTable('outside-staff', e.target.value));
    }
    
});

function filterUserTable(tableType, searchQuery) {
    // Skip parent table as it no longer exists
    if (tableType === 'parent') return;
    
    const query = searchQuery.toLowerCase().trim();
    const tbody = document.getElementById(`${tableType}-users-table-body`);
    
    if (!tbody) return;
    
    const rows = tbody.getElementsByTagName('tr');
    
    for (let row of rows) {
        // Skip empty state rows
        if (row.cells.length === 1 && row.cells[0].colSpan > 1) {
            continue;
        }
        
        let shouldShow = false;
        
        if (query === '') {
            shouldShow = true;
        } else {
            // Get text content from all cells except password and actions columns
            const cells = Array.from(row.cells);
            const searchableText = cells
                .filter((cell, index) => {
                    // Exclude password column and actions column
                    if (tableType === 'student') {
                        // For students: exclude password (index 7) and actions (index 8)
                        return index !== 7 && index !== 8;
                    } else {
                        // For admin/staff: exclude password (index 3) and actions (index 4)
                        return index !== 3 && index !== 4;
                    }
                })
                .map(cell => cell.textContent.toLowerCase())
                .join(' ');
            
            shouldShow = searchableText.includes(query);
        }
        
        row.style.display = shouldShow ? '' : 'none';
    }

    scheduleUserManagementTablesAutoFit();
}

async function removeStudent(userId, studentId, studentName) {
    // First confirmation - basic warning
    const firstConfirm = confirm(
        `⚠️ WARNING: Remove Student\n\n` +
        `You are about to remove "${studentName}" from the system.\n\n` +
        `This will:\n` +
        `• Delete the student's user account\n` +
        `• Delete the student record\n` +
        `• Remove all associated data\n\n` +
        `This action CANNOT be undone!\n\n` +
        `Are you sure you want to continue?`
    );
    
    if (!firstConfirm) {
        return; // User cancelled
    }
    
    // Second confirmation - require typing student name
    const typedName = prompt(
        `⚠️ FINAL CONFIRMATION\n\n` +
        `To confirm deletion, please type the student's name exactly:\n\n` +
        `"${studentName}"\n\n` +
        `Type the name to confirm:`
    );
    
    if (typedName !== studentName) {
        if (typedName !== null) { // null means they clicked cancel
            alert('❌ Deletion cancelled: Name did not match.\n\nThe student was NOT removed.');
        }
        return; // User cancelled or name didn't match
    }
    
    // Proceed with deletion
    try {
        const response = await fetch(`/api/students/${studentId}`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' }
        });
        
        if (response.ok) {
            showMessage(`Student "${studentName}" has been removed successfully.`, 'success');
            
            // Reload the users list
            await loadUsers();
            
            // Reload students list for other views
            await loadStudents();
        } else {
            const data = await response.json();
            throw new Error(data.error || 'Failed to remove student');
        }
    } catch (error) {
        console.error('Error removing student:', error);
        showMessage(`Error: ${error.message}`, 'error');
    }
}

function editStudent(studentId, buttonElement) {
    const row = buttonElement.closest('tr');
    const editableCells = row.querySelectorAll('.editable-cell');
    
    // Check if already in edit mode
    if (buttonElement.textContent === 'Save') {
        // Save mode
        saveStudentInfo(studentId, row, buttonElement);
        return;
    }
    
    // Enter edit mode
    editableCells.forEach(cell => {
        const currentValue = cell.textContent === '-' ? '' : cell.textContent;
        const field = cell.dataset.field;
        cell.innerHTML = `<input type="text" class="inline-edit-input" value="${currentValue}" data-field="${field}">`;
    });
    
    buttonElement.textContent = 'Save';
    buttonElement.style.background = 'var(--success)';
}

async function saveStudentInfo(studentId, row, buttonElement) {
    const inputs = row.querySelectorAll('.inline-edit-input');
    const data = {};
    
    inputs.forEach(input => {
        const field = input.dataset.field;
        data[field] = input.value.trim();
    });
    
    try {
        const response = await fetch(`/api/students/${studentId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        
        if (response.ok) {
            showMessage('Student information updated successfully!', 'success');
            
            // Exit edit mode and restore display
            const editableCells = row.querySelectorAll('.editable-cell');
            editableCells.forEach(cell => {
                const input = cell.querySelector('.inline-edit-input');
                const value = input.value.trim() || '-';
                cell.textContent = value;
            });
            
            buttonElement.textContent = 'Edit';
            buttonElement.style.background = '';
            
            // Reload to ensure data consistency
            await loadUsers();
        } else {
            const error = await response.json();
            throw new Error(error.error || 'Failed to update student');
        }
    } catch (error) {
        console.error('Error saving student info:', error);
        showMessage(`Error: ${error.message}`, 'error');
    }
}

// Make functions globally accessible
window.copyToClipboard = copyToClipboard;
window.removeStudent = removeStudent;
window.editStudent = editStudent;

// Infractions Summary Modal Functions
function showInfractionsSummary(periodIndex, periodName) {
    if (!window.currentSummaryData || !window.currentSummaryData.periods) {
        showMessage('Summary data not available', 'error');
        return;
    }
    
    const periods = Object.keys(window.currentSummaryData.periods);
    if (periodIndex >= periods.length) {
        showMessage('Invalid period index', 'error');
        return;
    }
    
    const periodKey = periods[periodIndex];
    const periodData = window.currentSummaryData.periods[periodKey];
    const infractions = periodData.infractions || {};
    
    displayInfractionsModal(infractions, periodName || periodKey);
}

function showInfractionsSummarySingle() {
    if (!window.currentSummaryData || !window.currentSummaryData.additional_info) {
        showMessage('Summary data not available', 'error');
        return;
    }
    
    const infractions = window.currentSummaryData.additional_info.infractions || {};
    displayInfractionsModal(infractions, 'Summary');
}

function displayInfractionsModal(infractions, title) {
    const modal = document.getElementById('infractions-summary-modal');
    const content = document.getElementById('infractions-summary-content');
    
    if (!modal || !content) {
        showMessage('Modal elements not found', 'error');
        return;
    }
    
    // Sort infractions by count (descending), then by type name (ascending)
    const sortedInfractions = Object.entries(infractions)
        .map(([type, count]) => ({ type, count }))
        .sort((a, b) => {
            // First sort by count (descending)
            if (b.count !== a.count) {
                return b.count - a.count;
            }
            // Then sort by type name (ascending)
            return a.type.localeCompare(b.type);
        });
    
    if (sortedInfractions.length === 0) {
        content.innerHTML = '<p style="color: #999; font-style: italic; text-align: center; padding: 20px;">No infractions recorded.</p>';
    } else {
        const totalCount = sortedInfractions.reduce((sum, item) => sum + item.count, 0);
        
        let html = `
            <div style="margin-bottom: 20px;">
                <p style="font-size: 14px; color: var(--text-secondary);"><strong>Total Infractions:</strong> ${totalCount}</p>
                <p style="font-size: 14px; color: var(--text-secondary);"><strong>Unique Types:</strong> ${sortedInfractions.length}</p>
            </div>
            <table style="width: 100%; border-collapse: collapse;">
                <thead>
                    <tr style="background: var(--bg-elevated);">
                        <th style="padding: 12px; border: 1px solid var(--border); text-align: left;">Infraction Type</th>
                        <th style="padding: 12px; border: 1px solid var(--border); text-align: center; width: 120px;">Count</th>
                        <th style="padding: 12px; border: 1px solid var(--border); text-align: center; width: 150px;">Percentage</th>
                    </tr>
                </thead>
                <tbody>
        `;
        
        sortedInfractions.forEach(item => {
            const percentage = totalCount > 0 ? ((item.count / totalCount) * 100).toFixed(1) : '0.0';
            html += `
                <tr>
                    <td style="padding: 10px; border: 1px solid var(--border);">${escapeHtml(item.type)}</td>
                    <td style="padding: 10px; border: 1px solid var(--border); text-align: center; font-weight: 600;">${item.count}</td>
                    <td style="padding: 10px; border: 1px solid var(--border); text-align: center;">${percentage}%</td>
                </tr>
            `;
        });
        
        html += `
                </tbody>
            </table>
        `;
        
        content.innerHTML = html;
    }
    
    // Update modal title
    const modalTitle = modal.querySelector('h2');
    if (modalTitle) {
        modalTitle.textContent = `Infractions Summary - ${title}`;
    }
    
    modal.style.display = 'block';
}

// STAR Category Details (from Reports STAR graph)
function showStarCategoryDetails(categoryKey, categoryLabel, summaryData) {
    let data = summaryData || window.currentSummaryData;
    // If the provided data object is missing detailed breakdowns but the global
    // summary has them (common when restoring state), fall back to the global.
    if (
        data &&
        (!data.by_time || !data.by_day_of_week) &&
        window.currentSummaryData &&
        (window.currentSummaryData.by_time || window.currentSummaryData.by_day_of_week)
    ) {
        data = window.currentSummaryData;
    }

    if (!data) {
        showMessage('Summary data not available', 'error');
        return null;
    }

    const categoryMap = {
        safety: { pointsKey: 'safety_points', label: 'Safety (S)' },
        teamwork: { pointsKey: 'teamwork_points', label: 'Teamwork (T)' },
        accountability: { pointsKey: 'accountability_points', label: 'Accountability (A)' },
        relationships: { pointsKey: 'relationships_points', label: 'Relationships (R)' },
        overall: { pointsKey: null, label: 'Overall Average' }
    };

    const meta = categoryMap[categoryKey];
    if (!meta) {
        showMessage('Unknown STAR category selected', 'error');
        return;
    }

    // Helpers to get percentage for a bucket using backend-computed percentages
    function computeCategoryPercent(bucket) {
        if (!bucket || !bucket.percentages) return null;
        if (categoryKey === 'overall') {
            const val = bucket.percentages.overall;
            return typeof val === 'number' ? val : null;
        }
        const val = bucket.percentages[categoryKey];
        return typeof val === 'number' ? val : null;
    }

    // Time-of-day stats
    let bestTime = null;
    let worstTime = null;
    if (data.by_time) {
        Object.entries(data.by_time).forEach(([label, bucket]) => {
            if (!bucket || !bucket.total_days) return;
            const pct = computeCategoryPercent(bucket);
            if (pct == null || isNaN(pct)) return;
            if (!bestTime || pct > bestTime.percent) bestTime = { label, percent: pct };
            if (!worstTime || pct < worstTime.percent) worstTime = { label, percent: pct };
        });
    }

    // Day-of-week stats
    let bestDay = null;
    let worstDay = null;
    if (data.by_day_of_week) {
        Object.entries(data.by_day_of_week).forEach(([day, bucket]) => {
            if (!bucket || !bucket.total_days) return;
            const pct = computeCategoryPercent(bucket);
            if (pct == null || isNaN(pct)) return;
            if (!bestDay || pct > bestDay.percent) bestDay = { label: day, percent: pct };
            if (!worstDay || pct < worstDay.percent) worstDay = { label: day, percent: pct };
        });
    }

    let html = '';

    // Inline table pattern per TABLE-STYLES.md: horizontal lines only; header elevated, body white
    const tableStyle = 'border-collapse: collapse; font-size: 0.85rem; margin-top: 4px;';
    const thLeft = 'padding: 6px 8px; border-bottom: 1px solid var(--border); text-align: left; background: var(--bg-elevated);';
    const thRight = 'padding: 6px 8px; border-bottom: 1px solid var(--border); text-align: right; background: var(--bg-elevated);';
    const tdLeft = 'padding: 6px 8px; border-bottom: 1px solid var(--border); background: var(--bg-surface);';
    const tdRight = 'padding: 6px 8px; border-bottom: 1px solid var(--border); text-align: right; background: var(--bg-surface);';

    html += `
        <div class="star-category-detail-content">
            <div class="star-performance-drilldown-tabs" role="tablist">
                <button class="star-performance-drill-tab active" data-drill-tab="overview" role="tab" aria-selected="true">
                    <span class="star-performance-drill-tab-label">Overview</span>
                </button>
            </div>
            <div class="star-performance-drilldown-panels">
                <div class="star-performance-drill-tab-panel is-active" data-drill-tab-panel="overview">
                    <div style="display: grid; grid-template-columns: minmax(0, 1fr); gap: 16px;">
                        <div style="padding: 12px 14px; border-radius: 8px; border: 1px solid var(--border); background: var(--bg-surface);">
                            <h3 style="margin-top: 0; margin-bottom: 8px; font-size: 15px; font-weight: 600; color: var(--text-primary);">Time of Day - ${meta.label}</h3>
                            ${bestTime || worstTime ? `
                                <table style="${tableStyle}">
                                    <thead>
                                        <tr>
                                            <th style="${thLeft}">Type</th>
                                            <th style="${thLeft}">Time Period</th>
                                            <th style="${thRight}">Average %</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${bestTime ? `
                                        <tr>
                                            <td style="${tdLeft}; font-weight: 600;">Highest</td>
                                            <td style="${tdLeft}">${escapeHtml(bestTime.label)}</td>
                                            <td style="${tdRight}">${bestTime.percent.toFixed(1)}%</td>
                                        </tr>` : ''}
                                        ${worstTime ? `
                                        <tr>
                                            <td style="${tdLeft}; font-weight: 600;">Lowest</td>
                                            <td style="${tdLeft}">${escapeHtml(worstTime.label)}</td>
                                            <td style="${tdRight}">${worstTime.percent.toFixed(1)}%</td>
                                        </tr>` : ''}
                                    </tbody>
                                </table>
                                <button type="button" class="star-drill-show-all-btn" data-star-drill="by-time" style="margin-top: 8px; padding: 6px 12px; font-size: 0.8rem; cursor: pointer; background: var(--bg-elevated); border: 1px solid var(--border); border-radius: 6px;">Show all time periods</button>
                            ` : `
                                <p style="margin: 4px 0; font-size: 14px; color: var(--text-secondary); font-style: italic;">No time-of-day data available for this category.</p>
                            `}
                        </div>

                        <div style="padding: 12px 14px; border-radius: 8px; border: 1px solid var(--border); background: var(--bg-surface); display: flex; flex-direction: column;">
                            <h3 style="margin-top: 0; margin-bottom: 8px; font-size: 15px; font-weight: 600; color: var(--text-primary);">Day of Week - ${meta.label}</h3>
                            ${bestDay || worstDay ? `
                                <table style="${tableStyle}">
                                    <thead>
                                        <tr>
                                            <th style="${thLeft}">Type</th>
                                            <th style="${thLeft}">Day</th>
                                            <th style="${thRight}">Average %</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${bestDay ? `
                                        <tr>
                                            <td style="${tdLeft}; font-weight: 600;">Highest</td>
                                            <td style="${tdLeft}">${escapeHtml(bestDay.label)}</td>
                                            <td style="${tdRight}">${bestDay.percent.toFixed(1)}%</td>
                                        </tr>` : ''}
                                        ${worstDay ? `
                                        <tr>
                                            <td style="${tdLeft}; font-weight: 600;">Lowest</td>
                                            <td style="${tdLeft}">${escapeHtml(worstDay.label)}</td>
                                            <td style="${tdRight}">${worstDay.percent.toFixed(1)}%</td>
                                        </tr>` : ''}
                                    </tbody>
                                </table>
                                <button type="button" class="star-drill-show-all-btn" data-star-drill="by-day" style="margin-top: 8px; padding: 6px 12px; font-size: 0.8rem; cursor: pointer; background: var(--bg-elevated); border: 1px solid var(--border); border-radius: 6px;">Show all days</button>
                            ` : `
                                <p style="margin: 4px 0; font-size: 14px; color: var(--text-secondary); font-style: italic;">No day-of-week data available for this category.</p>
                            `}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;

    // If called without an explicit summaryData (section graph usage),
    // render into the dedicated modal. For overview card clicks where
    // summaryData is provided, we only return HTML so it can render in-card.
    const detailsContentEl = document.getElementById('star-category-details-content');
    const modal = document.getElementById('star-category-details-modal');
    if (!summaryData && detailsContentEl && modal) {
        const detailsTitleEl = document.getElementById('star-category-details-title');
        if (detailsTitleEl) {
            detailsTitleEl.textContent = `STAR Details - ${meta.label}`;
        }
        detailsContentEl.innerHTML = html;
        wireStarCategoryDrilldown(detailsContentEl, data, categoryKey);
        modal.style.display = 'block';
    }

    return html;
}

/**
 * Wire Level 2 drill tabs and "Show all" buttons in STAR category detail content.
 * root: container that has .star-performance-drilldown-tabs and .star-performance-drilldown-panels
 * data: summary data (by_time, by_day_of_week)
 * categoryKey: 'safety' | 'teamwork' | 'accountability' | 'relationships'
 */
function wireStarCategoryDrilldown(root, data, categoryKey) {
    const drillTabsContainer = root.querySelector('.star-performance-drilldown-tabs');
    const drillPanelsContainer = root.querySelector('.star-performance-drilldown-panels');
    if (!drillTabsContainer || !drillPanelsContainer) return;

    function computeCategoryPercent(bucket) {
        if (!bucket || !bucket.percentages) return null;
        if (categoryKey === 'overall') {
            const val = bucket.percentages.overall;
            return typeof val === 'number' ? val : null;
        }
        const val = bucket.percentages[categoryKey];
        return typeof val === 'number' ? val : null;
    }

    const setActiveDrillTab = (tabName) => {
        const allTabs = drillTabsContainer.querySelectorAll('.star-performance-drill-tab');
        const allPanels = drillPanelsContainer.querySelectorAll('.star-performance-drill-tab-panel');
        allTabs.forEach(tab => {
            const isActive = tab.dataset.drillTab === tabName;
            tab.classList.toggle('active', isActive);
            tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
        });
        allPanels.forEach(panel => {
            panel.classList.toggle('is-active', panel.dataset.drillTabPanel === tabName);
        });
    };

    const wireDrillTabClicks = () => {
        drillTabsContainer.querySelectorAll('.star-performance-drill-tab').forEach(tab => {
            if (tab._starDrillWired) return;
            tab._starDrillWired = true;
            tab.addEventListener('click', (e) => {
                const closeBtn = e.target.closest('.star-performance-drill-tab-close');
                if (closeBtn) {
                    e.stopPropagation();
                    const name = tab.dataset.drillTab;
                    if (name === 'overview') return;
                    const panel = drillPanelsContainer.querySelector(`.star-performance-drill-tab-panel[data-drill-tab-panel="${name}"]`);
                    if (panel) panel.remove();
                    tab.remove();
                    if (!drillTabsContainer.querySelector('.star-performance-drill-tab.active')) {
                        setActiveDrillTab('overview');
                    }
                    return;
                }
                const tabName = tab.dataset.drillTab;
                if (!tabName) return;
                setActiveDrillTab(tabName);
            });
        });
    };

    const tableStyle = 'border-collapse: collapse; font-size: 0.85rem; margin-top: 4px;';
    const thLeft = 'padding: 6px 8px; border-bottom: 1px solid var(--border); text-align: left; background: var(--bg-elevated);';
    const thRight = 'padding: 6px 8px; border-bottom: 1px solid var(--border); text-align: right; background: var(--bg-elevated);';
    const tdLeft = 'padding: 6px 8px; border-bottom: 1px solid var(--border); background: var(--bg-surface);';
    const tdRight = 'padding: 6px 8px; border-bottom: 1px solid var(--border); text-align: right; background: var(--bg-surface);';

    const createOrUpdateDrillSubtab = (tabName, label, innerHtml) => {
        let tab = drillTabsContainer.querySelector(`.star-performance-drill-tab[data-drill-tab="${tabName}"]`);
        let panel = drillPanelsContainer.querySelector(`.star-performance-drill-tab-panel[data-drill-tab-panel="${tabName}"]`);

        if (!tab) {
            tab = document.createElement('button');
            tab.className = 'star-performance-drill-tab';
            tab.dataset.drillTab = tabName;
            tab.setAttribute('role', 'tab');
            tab.setAttribute('aria-selected', 'false');
            tab.innerHTML = `
                <span class="star-performance-drill-tab-label">${escapeHtml(label || tabName)}</span>
                <span class="star-performance-drill-tab-close" aria-label="Close" role="button">&times;</span>
            `;
            drillTabsContainer.appendChild(tab);
        }

        if (!panel) {
            panel = document.createElement('div');
            panel.className = 'star-performance-drill-tab-panel';
            panel.dataset.drillTabPanel = tabName;
            drillPanelsContainer.appendChild(panel);
        }

        panel.innerHTML = `<div style="padding: 12px 14px;">${innerHtml}</div>`;
        wireDrillTabClicks();
        setActiveDrillTab(tabName);
    };

    const metaLabel = { safety: 'Safety (S)', teamwork: 'Teamwork (T)', accountability: 'Accountability (A)', relationships: 'Relationships (R)' }[categoryKey] || categoryKey;

    // "Show all time periods" button
    root.querySelectorAll('.star-drill-show-all-btn[data-star-drill="by-time"]').forEach(btn => {
        if (btn._starDrillBtnWired) return;
        btn._starDrillBtnWired = true;
        btn.addEventListener('click', () => {
            const byTime = data.by_time || {};
            const rows = Object.entries(byTime)
                .map(([label, bucket]) => ({ label, pct: computeCategoryPercent(bucket) }))
                .filter(r => r.pct != null && !isNaN(r.pct))
                .sort((a, b) => (b.pct || 0) - (a.pct || 0));
            let bodyRows = rows.map(r =>
                `<tr><td style="${tdLeft}">${escapeHtml(r.label)}</td><td style="${tdRight}">${(r.pct != null ? r.pct.toFixed(1) : '')}%</td></tr>`
            ).join('');
            const tableHtml = `
                <h4 style="margin: 0 0 8px 0; font-size: 15px; font-weight: 600;">${escapeHtml(metaLabel)} — Average STAR % by time period</h4>
                <table style="${tableStyle}">
                    <thead><tr><th style="${thLeft}">Time Period</th><th style="${thRight}">Average %</th></tr></thead>
                    <tbody>${bodyRows || '<tr><td style="' + tdLeft + '" colspan="2">No data</td></tr>'}</tbody>
                </table>
            `;
            createOrUpdateDrillSubtab('by-time', 'By Time', tableHtml);
            const grid = btn.closest('.dashboard-card-grid');
            if (grid && typeof scheduleMasonryLayoutAfterResize === 'function') scheduleMasonryLayoutAfterResize(grid);
        });
    });

    // "Show all days" button
    root.querySelectorAll('.star-drill-show-all-btn[data-star-drill="by-day"]').forEach(btn => {
        if (btn._starDrillBtnWired) return;
        btn._starDrillBtnWired = true;
        btn.addEventListener('click', () => {
            const byDay = data.by_day_of_week || {};
            const rows = Object.entries(byDay)
                .map(([label, bucket]) => ({ label, pct: computeCategoryPercent(bucket) }))
                .filter(r => r.pct != null && !isNaN(r.pct))
                .sort((a, b) => (b.pct || 0) - (a.pct || 0));
            let bodyRows = rows.map(r =>
                `<tr><td style="${tdLeft}">${escapeHtml(r.label)}</td><td style="${tdRight}">${(r.pct != null ? r.pct.toFixed(1) : '')}%</td></tr>`
            ).join('');
            const tableHtml = `
                <h4 style="margin: 0 0 8px 0; font-size: 15px; font-weight: 600;">${escapeHtml(metaLabel)} — Average STAR % by day of week</h4>
                <table style="${tableStyle}">
                    <thead><tr><th style="${thLeft}">Day</th><th style="${thRight}">Average %</th></tr></thead>
                    <tbody>${bodyRows || '<tr><td style="' + tdLeft + '" colspan="2">No data</td></tr>'}</tbody>
                </table>
            `;
            createOrUpdateDrillSubtab('by-day', 'By Day', tableHtml);
            const grid = btn.closest('.dashboard-card-grid');
            if (grid && typeof scheduleMasonryLayoutAfterResize === 'function') scheduleMasonryLayoutAfterResize(grid);
        });
    });
}

function closeStarCategoryDetailsModal() {
    const modal = document.getElementById('star-category-details-modal');
    if (modal) {
        modal.style.display = 'none';
    }
}

function closeInfractionsSummaryModal() {
    const modal = document.getElementById('infractions-summary-modal');
    if (modal) {
        modal.style.display = 'none';
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// PDF Generation Functions

function showPdfTableSelectionModal(type) {
    console.log('showPdfTableSelectionModal called with type:', type);
    try {
        currentPdfType = type;
        const modal = document.getElementById('pdf-table-selection-modal');
        const title = document.getElementById('pdf-modal-title');
        const optionsDiv = document.getElementById('pdf-table-options');
        
        console.log('Modal elements check:', { 
            modal: !!modal, 
            title: !!title, 
            optionsDiv: !!optionsDiv,
            modalId: modal ? modal.id : 'not found',
            modalDisplay: modal ? window.getComputedStyle(modal).display : 'N/A'
        });
        
        if (!modal) {
            console.error('PDF modal not found');
            alert('PDF modal not found. Please refresh the page.');
            return;
        }
        
        if (!title) {
            console.error('PDF modal title not found');
            alert('PDF modal title not found. Please refresh the page.');
            return;
        }
        
        if (!optionsDiv) {
            console.error('PDF modal options div not found');
            alert('PDF modal options div not found. Please refresh the page.');
            return;
        }
        
        // Set title
        if (type === 'summary') {
            title.textContent = 'Select Tables for Summary PDF';
            try {
                populateSummaryPdfModal();
            } catch (error) {
                console.error('Error populating summary PDF modal:', error);
                optionsDiv.innerHTML = '<p style="color: var(--danger);">Error loading table options. Please try again.</p>';
            }
        } else if (type === 'frenzy') {
            title.textContent = 'Select Tables for Frenzy Stats PDF';
            try {
                populateFrenzyPdfModal();
            } catch (error) {
                console.error('Error populating frenzy PDF modal:', error);
                optionsDiv.innerHTML = '<p style="color: var(--danger);">Error loading table options. Please try again.</p>';
            }
        }
        
        console.log('Setting modal display to block');
        modal.style.display = 'block';
        console.log('Modal display set. Computed display:', window.getComputedStyle(modal).display);
    } catch (error) {
        console.error('Error showing PDF table selection modal:', error);
        alert('Error opening PDF options: ' + (error.message || 'Unknown error'));
    }
}

function closePdfTableSelectionModal() {
    const modal = document.getElementById('pdf-table-selection-modal');
    if (modal) {
        modal.style.display = 'none';
    }
    currentPdfType = null;
}

function populateSummaryPdfModal() {
    const optionsDiv = document.getElementById('pdf-table-options');
    if (!optionsDiv) return;
    
    const data = window.currentSummaryData;
    if (!data) {
        optionsDiv.innerHTML = '<p style="color: var(--danger);">Please load summary data first.</p>';
        return;
    }
    
    const isComparison = data.comparison_mode && data.periods;
    
    let html = `
        <label style="display: flex; align-items: center; gap: 8px; margin: 8px 0; cursor: pointer; padding: 8px; background: var(--bg-elevated); border-radius: 4px;">
            <input type="checkbox" id="modal-pdf-summary-main" checked disabled>
            <span>Main Summary Statistics (always included)</span>
        </label>
        <label style="display: flex; align-items: center; gap: 8px; margin: 8px 0; cursor: pointer; padding: 8px;">
            <input type="checkbox" id="modal-pdf-summary-star" checked>
            <span>STAR Percentages/Averages</span>
        </label>
    `;
    
    // Day of Week Statistics
    let hasDayData = false;
    if (isComparison) {
        const periods = Object.keys(data.periods);
        periods.forEach(periodKey => {
            if (data.periods[periodKey].by_day && Object.keys(data.periods[periodKey].by_day).length > 0) {
                hasDayData = true;
            }
        });
    } else {
        hasDayData = data.by_day && Object.keys(data.by_day).length > 0;
    }
    
    if (hasDayData) {
        html += `
            <label style="display: flex; align-items: center; gap: 8px; margin: 8px 0; cursor: pointer; padding: 8px;">
                <input type="checkbox" id="modal-pdf-summary-day" checked>
                <span>Day of Week Statistics</span>
            </label>
        `;
    }
    
    // Class Statistics
    let hasClassData = false;
    if (isComparison) {
        const periods = Object.keys(data.periods);
        periods.forEach(periodKey => {
            if (data.periods[periodKey].by_class && Object.keys(data.periods[periodKey].by_class).length > 0) {
                hasClassData = true;
            }
        });
    } else {
        hasClassData = data.by_class && Object.keys(data.by_class).length > 0;
    }
    
    if (hasClassData) {
        html += `
            <label style="display: flex; align-items: center; gap: 8px; margin: 8px 0; cursor: pointer; padding: 8px;">
                <input type="checkbox" id="modal-pdf-summary-class" checked>
                <span>Class Statistics</span>
            </label>
        `;
    }
    
    // Infractions (only in single mode)
    if (!isComparison) {
        html += `
            <label style="display: flex; align-items: center; gap: 8px; margin: 8px 0; cursor: pointer; padding: 8px;">
                <input type="checkbox" id="modal-pdf-summary-infractions" checked>
                <span>Infractions</span>
            </label>
        `;
        
        // Infractions by Day of Week (check if data exists)
        let hasInfractionsByDay = false;
        if (data.by_day_of_week) {
            const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
            hasInfractionsByDay = weekdays.some(day => {
                const dayData = data.by_day_of_week[day];
                return dayData && dayData.total_infractions > 0;
            });
        }
        
        if (hasInfractionsByDay) {
            html += `
                <label style="display: flex; align-items: center; gap: 8px; margin: 8px 0; cursor: pointer; padding: 8px;">
                    <input type="checkbox" id="modal-pdf-summary-infractions-day" checked>
                    <span>Infractions by Day of Week</span>
                </label>
            `;
        }
    }
    
    optionsDiv.innerHTML = html;
}

function populateFrenzyPdfModal() {
    const optionsDiv = document.getElementById('pdf-table-options');
    if (!optionsDiv) {
        console.error('pdf-table-options div not found');
        return;
    }
    
    const data = window.currentFrenzyStatsData;
    if (!data) {
        optionsDiv.innerHTML = '<p style="color: var(--danger); padding: 10px;">Please load frenzy statistics data first before generating PDF.</p>';
        return;
    }
    
    const isComparison = data.comparison_mode && data.periods;
    
    let html = `
        <label style="display: flex; align-items: center; gap: 8px; margin: 8px 0; cursor: pointer; padding: 8px; background: var(--bg-elevated); border-radius: 4px;">
            <input type="checkbox" id="modal-pdf-frenzy-main" checked disabled>
            <span>Main Frenzy Statistics (always included)</span>
        </label>
    `;
    
    // Day of Week Statistics
    let hasDayData = false;
    if (isComparison) {
        const periods = Object.keys(data.periods);
        periods.forEach(periodKey => {
            if (data.periods[periodKey].by_day && Object.keys(data.periods[periodKey].by_day).length > 0) {
                hasDayData = true;
            }
        });
    } else {
        hasDayData = data.by_day && Object.keys(data.by_day).length > 0;
    }
    
    if (hasDayData) {
        html += `
            <label style="display: flex; align-items: center; gap: 8px; margin: 8px 0; cursor: pointer; padding: 8px;">
                <input type="checkbox" id="modal-pdf-frenzy-day" checked>
                <span>Day of Week Statistics</span>
            </label>
        `;
    }
    
    // Class Statistics
    let hasClassData = false;
    if (isComparison) {
        const periods = Object.keys(data.periods);
        periods.forEach(periodKey => {
            if (data.periods[periodKey].by_location && Object.keys(data.periods[periodKey].by_location).length > 0) {
                hasClassData = true;
            }
        });
    } else {
        hasClassData = data.by_location && Object.keys(data.by_location).length > 0;
    }
    
    if (hasClassData) {
        html += `
            <label style="display: flex; align-items: center; gap: 8px; margin: 8px 0; cursor: pointer; padding: 8px;">
                <input type="checkbox" id="modal-pdf-frenzy-class" checked>
                <span>Class Statistics</span>
            </label>
        `;
    }
    
    // Purpose Statistics
    let hasPurposeData = false;
    if (isComparison) {
        const periods = Object.keys(data.periods);
        periods.forEach(periodKey => {
            if (data.periods[periodKey].by_purpose && Object.keys(data.periods[periodKey].by_purpose).length > 0) {
                hasPurposeData = true;
            }
        });
    } else {
        hasPurposeData = data.by_purpose && Object.keys(data.by_purpose).length > 0;
    }
    
    if (hasPurposeData) {
        html += `
            <label style="display: flex; align-items: center; gap: 8px; margin: 8px 0; cursor: pointer; padding: 8px;">
                <input type="checkbox" id="modal-pdf-frenzy-purpose" checked>
                <span>Purpose Statistics</span>
            </label>
        `;
    }
    
    optionsDiv.innerHTML = html;
}

function generatePdfFromModal() {
    if (currentPdfType === 'summary') {
        generateSummaryPDF();
    } else if (currentPdfType === 'frenzy') {
        generateFrenzyStatsPDF();
    }
    closePdfTableSelectionModal();
}


function generateSummaryPDF() {
    if (!window.currentSummaryData) {
        alert('Please load summary data first.');
        return;
    }

    const { jsPDF } = window.jspdf;
    const data = window.currentSummaryData;
    
    // Get filter information
    const studentSelect = document.getElementById('summary-student-select');
    const studentId = studentSelect ? studentSelect.value : '';
    const studentName = studentId && studentSelect.options[studentSelect.selectedIndex] ? 
        studentSelect.options[studentSelect.selectedIndex].text : 'All Students';
    
    const periodSelect = document.getElementById('summary-period-select');
    const timeframeSelect = document.getElementById('quarter-select');
    const period = periodSelect ? periodSelect.value : '';
    const timeframe = timeframeSelect ? timeframeSelect.value : '';
    
    // Determine timeframe label (reuse logic from loadSummary)
    let timeframeLabel = 'All Time';
    if (period) {
        const periodLabels = {
            'weekly': 'Weekly',
            '30day': '30 Day',
            'current_year': 'Current Year',
            'quarter1': 'Quarter 1',
            'quarter2': 'Quarter 2',
            'quarter3': 'Quarter 3',
            'quarter4': 'Quarter 4',
            'all_time': 'All Time',
            'previous_years': 'Previous Years'
        };
        timeframeLabel = periodLabels[period] || period;
    } else if (timeframe) {
        const timeframeLabels = {
            'weekly': 'Weekly',
            '30day': '30 Day',
            '30day_to_30day': '30 Day to 30 Day',
            'month': 'Month to Month',
            'quarter': 'Quarter to Quarter',
            'year': 'Year to Year',
            'alltime': 'All Time',
            'custom_range': 'Custom Range'
        };
        timeframeLabel = timeframeLabels[timeframe] || timeframe;
    }

    // Create PDF - use landscape for comparison tables, portrait for single period
    const isComparison = data.comparison_mode && data.periods;
    const doc = new jsPDF(isComparison ? 'landscape' : 'portrait', 'pt', 'letter');
    
    let yPos = 40;
    const margin = 40;
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const contentWidth = pageWidth - (2 * margin);
    
    // Add header
    doc.setFontSize(18);
    doc.setFont(undefined, 'bold');
    doc.text('Summary Report', margin, yPos);
    yPos += 25;
    
    doc.setFontSize(12);
    doc.setFont(undefined, 'normal');
    doc.text(`Student: ${studentName}`, margin, yPos);
    yPos += 20;
    doc.text(`Timeframe: ${timeframeLabel}`, margin, yPos);
    yPos += 20;
    doc.text(`Generated: ${new Date().toLocaleDateString()}`, margin, yPos);
    yPos += 30;

    if (isComparison) {
        // Comparison mode - multiple periods
        const periods = Object.keys(data.periods);
        
        // Main summary table
        const summaryHeaders = ['Metric'];
        periods.forEach(p => summaryHeaders.push(p));
        
        const summaryRows = [];
        
        // Data Points row (if applicable)
        if ((timeframe === '30day' || timeframe === '30day_to_30day') || (period === '30day')) {
            const row = ['Data Points'];
            periods.forEach(periodKey => {
                const periodData = data.periods[periodKey];
                const dataPoints = periodData.available_data_points !== undefined ? periodData.available_data_points : periodData.total_days || 0;
                const hasFull30 = periodData.has_full_30_days !== undefined ? periodData.has_full_30_days : false;
                row.push(hasFull30 ? `${dataPoints} (Full 30 Days)` : `${dataPoints}`);
            });
            summaryRows.push(row);
        }
        
        // Total Days
        const totalDaysRow = ['Total Days'];
        periods.forEach(periodKey => {
            totalDaysRow.push(data.periods[periodKey].total_days.toString());
        });
        summaryRows.push(totalDaysRow);
        
        // Total Infractions
        const infractionsRow = ['Total Infractions'];
        periods.forEach(periodKey => {
            const periodData = data.periods[periodKey];
            const totalInfractions = Object.values(periodData.infractions || {}).reduce((sum, count) => sum + count, 0);
            infractionsRow.push(totalInfractions.toString());
        });
        summaryRows.push(infractionsRow);
        
        // Reminders
        const remindersRow = ['Reminders'];
        periods.forEach(periodKey => {
            remindersRow.push((data.periods[periodKey].additional_info?.total_reminders || 0).toString());
        });
        summaryRows.push(remindersRow);
        
        // Resets
        const resetsRow = ['Resets'];
        periods.forEach(periodKey => {
            resetsRow.push((data.periods[periodKey].additional_info?.total_resets || 0).toString());
        });
        summaryRows.push(resetsRow);
        
        // Add summary table (always included)
        doc.autoTable({
            startY: yPos,
            head: [summaryHeaders],
            body: summaryRows,
            theme: 'grid',
            headStyles: { fillColor: [248, 249, 250], fontStyle: 'bold', fontSize: 10 },
            bodyStyles: { fontSize: 9 },
            margin: { left: margin, right: margin },
            styles: { cellPadding: 6 },
            didParseCell: function(data) {
                if (data.row.index >= 0 && data.column.index === 0) {
                    // Apply gray background to metric column for infractions/reminders/resets rows
                    const rowText = data.row.raw[0];
                    if (rowText === 'Total Infractions' || rowText === 'Reminders' || rowText === 'Resets') {
                        data.cell.styles.fillColor = [229, 231, 235];
                    }
                } else if (data.row.index >= 0 && data.column.index > 0) {
                    // Apply gray background to data cells for infractions/reminders/resets rows
                    const rowText = data.row.raw[0];
                    if (rowText === 'Total Infractions' || rowText === 'Reminders' || rowText === 'Resets') {
                        data.cell.styles.fillColor = [229, 231, 235];
                    }
                }
            }
        });
        
        yPos = doc.lastAutoTable.finalY + 20;
        
        // Check if STAR Percentages should be included
        const includeStar = document.getElementById('modal-pdf-summary-star')?.checked !== false;
        if (includeStar) {
            // STAR Percentages table
            if (yPos > pageHeight - 150) {
                doc.addPage();
                yPos = 40;
            }
            
            doc.setFontSize(14);
            doc.setFont(undefined, 'bold');
            doc.text('STAR Percentages', margin, yPos);
            yPos += 20;
        
        const starHeaders = ['Metric'];
        periods.forEach(p => starHeaders.push(p));
        
        const starRows = [
            ['Safety (S)'],
            ['Teamwork (T)'],
            ['Accountability (A)'],
            ['Relationships (R)'],
            ['Overall Average']
        ];
        
        // Add percentage values
        periods.forEach(periodKey => {
            const periodData = data.periods[periodKey];
            starRows[0].push(`${periodData.percentages.safety}%`);
            starRows[1].push(`${periodData.percentages.teamwork}%`);
            starRows[2].push(`${periodData.percentages.accountability}%`);
            starRows[3].push(`${periodData.percentages.relationships}%`);
            starRows[4].push(`${periodData.percentages.overall}%`);
        });
        
            doc.autoTable({
                startY: yPos,
                head: [starHeaders],
                body: starRows,
                theme: 'grid',
                headStyles: { fillColor: [248, 249, 250], fontStyle: 'bold', fontSize: 10 },
                bodyStyles: { fontSize: 9 },
                margin: { left: margin, right: margin },
                styles: { cellPadding: 6 },
                didParseCell: function(data) {
                    if (data.row.index >= 0 && data.column.index === 0) {
                        // Apply row colors based on STAR category
                        const rowIndex = data.row.index;
                        if (rowIndex === 0) { // Safety
                            data.cell.styles.fillColor = [254, 226, 226];
                        } else if (rowIndex === 1) { // Teamwork
                            data.cell.styles.fillColor = [219, 234, 254];
                        } else if (rowIndex === 2) { // Accountability
                            data.cell.styles.fillColor = [209, 250, 229];
                        } else if (rowIndex === 3) { // Relationships
                            data.cell.styles.fillColor = [254, 243, 199];
                        } else if (rowIndex === 4) { // Overall
                            data.cell.styles.fillColor = [240, 240, 240];
                        }
                    } else if (data.row.index >= 0 && data.column.index > 0) {
                        // Apply lighter background to data cells
                        const rowIndex = data.row.index;
                        if (rowIndex === 0) { // Safety
                            data.cell.styles.fillColor = [254, 226, 226];
                            data.cell.styles.textColor = [0, 0, 0];
                        } else if (rowIndex === 1) { // Teamwork
                            data.cell.styles.fillColor = [219, 234, 254];
                            data.cell.styles.textColor = [0, 0, 0];
                        } else if (rowIndex === 2) { // Accountability
                            data.cell.styles.fillColor = [209, 250, 229];
                            data.cell.styles.textColor = [0, 0, 0];
                        } else if (rowIndex === 3) { // Relationships
                            data.cell.styles.fillColor = [254, 243, 199];
                            data.cell.styles.textColor = [0, 0, 0];
                        } else if (rowIndex === 4) { // Overall
                            data.cell.styles.fillColor = [240, 240, 240];
                            data.cell.styles.textColor = [0, 0, 0];
                        }
                    }
                }
            });
            
            yPos = doc.lastAutoTable.finalY + 20;
        }
        
        // Check if Day of Week Statistics should be included (comparison mode)
        const includeDay = document.getElementById('modal-pdf-summary-day')?.checked === true;
        if (includeDay) {
            const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
            const allDays = new Set();
            periods.forEach(periodKey => {
                const periodData = data.periods[periodKey];
                if (periodData.by_day_of_week) {
                    Object.keys(periodData.by_day_of_week).forEach(day => {
                        if (weekdays.includes(day)) {
                            allDays.add(day);
                        }
                    });
                }
            });
            const sortedDays = weekdays.filter(d => allDays.has(d));
            
            if (sortedDays.length > 0) {
                if (yPos > pageHeight - 150) {
                    doc.addPage();
                    yPos = 40;
                }
                
                doc.setFontSize(14);
                doc.setFont(undefined, 'bold');
                doc.text('Day of Week Statistics', margin, yPos);
                yPos += 20;
                
                // Create headers: Metric, then each period
                const dayHeaders = ['Metric'];
                periods.forEach(p => dayHeaders.push(p));
                
                // Build rows for each metric
                const dayRows = [];
                
                // Total Days row
                const totalDaysRow = ['Total Days'];
                periods.forEach(periodKey => {
                    const periodData = data.periods[periodKey];
                    let totalDays = 0;
                    sortedDays.forEach(day => {
                        const dayData = periodData.by_day_of_week && periodData.by_day_of_week[day] ? periodData.by_day_of_week[day] : null;
                        if (dayData) {
                            totalDays += dayData.total_days || 0;
                        }
                    });
                    totalDaysRow.push(totalDays.toString());
                });
                dayRows.push(totalDaysRow);
                
                // Safety % row
                const safetyRow = ['Safety %'];
                periods.forEach(periodKey => {
                    const periodData = data.periods[periodKey];
                    let safetyValues = [];
                    sortedDays.forEach(day => {
                        const dayData = periodData.by_day_of_week && periodData.by_day_of_week[day] ? periodData.by_day_of_week[day] : null;
                        if (dayData && dayData.percentages) {
                            safetyValues.push(dayData.percentages.safety || 0);
                        }
                    });
                    const avgSafety = safetyValues.length > 0 ? (safetyValues.reduce((a, b) => a + b, 0) / safetyValues.length).toFixed(0) : 0;
                    safetyRow.push(`${avgSafety}%`);
                });
                dayRows.push(safetyRow);
                
                // Teamwork % row
                const teamworkRow = ['Teamwork %'];
                periods.forEach(periodKey => {
                    const periodData = data.periods[periodKey];
                    let teamworkValues = [];
                    sortedDays.forEach(day => {
                        const dayData = periodData.by_day_of_week && periodData.by_day_of_week[day] ? periodData.by_day_of_week[day] : null;
                        if (dayData && dayData.percentages) {
                            teamworkValues.push(dayData.percentages.teamwork || 0);
                        }
                    });
                    const avgTeamwork = teamworkValues.length > 0 ? (teamworkValues.reduce((a, b) => a + b, 0) / teamworkValues.length).toFixed(0) : 0;
                    teamworkRow.push(`${avgTeamwork}%`);
                });
                dayRows.push(teamworkRow);
                
                // Accountability % row
                const accountabilityRow = ['Accountability %'];
                periods.forEach(periodKey => {
                    const periodData = data.periods[periodKey];
                    let accountabilityValues = [];
                    sortedDays.forEach(day => {
                        const dayData = periodData.by_day_of_week && periodData.by_day_of_week[day] ? periodData.by_day_of_week[day] : null;
                        if (dayData && dayData.percentages) {
                            accountabilityValues.push(dayData.percentages.accountability || 0);
                        }
                    });
                    const avgAccountability = accountabilityValues.length > 0 ? (accountabilityValues.reduce((a, b) => a + b, 0) / accountabilityValues.length).toFixed(0) : 0;
                    accountabilityRow.push(`${avgAccountability}%`);
                });
                dayRows.push(accountabilityRow);
                
                // Relationships % row
                const relationshipsRow = ['Relationships %'];
                periods.forEach(periodKey => {
                    const periodData = data.periods[periodKey];
                    let relationshipsValues = [];
                    sortedDays.forEach(day => {
                        const dayData = periodData.by_day_of_week && periodData.by_day_of_week[day] ? periodData.by_day_of_week[day] : null;
                        if (dayData && dayData.percentages) {
                            relationshipsValues.push(dayData.percentages.relationships || 0);
                        }
                    });
                    const avgRelationships = relationshipsValues.length > 0 ? (relationshipsValues.reduce((a, b) => a + b, 0) / relationshipsValues.length).toFixed(0) : 0;
                    relationshipsRow.push(`${avgRelationships}%`);
                });
                dayRows.push(relationshipsRow);
                
                // Overall % row
                const overallRow = ['Overall %'];
                periods.forEach(periodKey => {
                    const periodData = data.periods[periodKey];
                    let overallValues = [];
                    sortedDays.forEach(day => {
                        const dayData = periodData.by_day_of_week && periodData.by_day_of_week[day] ? periodData.by_day_of_week[day] : null;
                        if (dayData && dayData.percentages) {
                            overallValues.push(dayData.percentages.overall || 0);
                        }
                    });
                    // Average across all days for this period
                    const avgOverall = overallValues.length > 0 ? (overallValues.reduce((a, b) => a + b, 0) / overallValues.length).toFixed(0) : 0;
                    overallRow.push(`${avgOverall}%`);
                });
                dayRows.push(overallRow);
                
                // Total Infractions row
                const infractionsRow = ['Total Infractions'];
                periods.forEach(periodKey => {
                    const periodData = data.periods[periodKey];
                    let totalInfractions = 0;
                    sortedDays.forEach(day => {
                        const dayData = periodData.by_day_of_week && periodData.by_day_of_week[day] ? periodData.by_day_of_week[day] : null;
                        if (dayData) {
                            totalInfractions += dayData.total_infractions || 0;
                        }
                    });
                    infractionsRow.push(totalInfractions.toString());
                });
                dayRows.push(infractionsRow);
                
                doc.autoTable({
                    startY: yPos,
                    head: [dayHeaders],
                    body: dayRows,
                    theme: 'grid',
                    headStyles: { fillColor: [64, 64, 64], fontStyle: 'bold', fontSize: 10, textColor: [255, 255, 255] },
                    bodyStyles: { fontSize: 9 },
                    margin: { left: margin, right: margin },
                    styles: { cellPadding: 6 },
                    didParseCell: function(data) {
                        if (data.row.index >= 0 && data.column.index === 0) {
                            // Apply row colors based on metric type
                            const rowText = data.row.raw[0];
                            if (rowText === 'Safety %') {
                                data.cell.styles.fillColor = [254, 226, 226];
                            } else if (rowText === 'Teamwork %') {
                                data.cell.styles.fillColor = [219, 234, 254];
                            } else if (rowText === 'Accountability %') {
                                data.cell.styles.fillColor = [209, 250, 229];
                            } else if (rowText === 'Relationships %') {
                                data.cell.styles.fillColor = [254, 243, 199];
                            } else if (rowText === 'Overall %') {
                                data.cell.styles.fillColor = [240, 240, 240];
                            } else if (rowText === 'Total Days' || rowText === 'Total Infractions') {
                                data.cell.styles.fillColor = [229, 231, 235];
                            }
                            data.cell.styles.textColor = [0, 0, 0];
                        } else if (data.row.index >= 0 && data.column.index > 0) {
                            // Apply colors to data cells
                            const rowText = data.row.raw[0];
                            if (rowText === 'Safety %') {
                                data.cell.styles.fillColor = [254, 226, 226];
                            } else if (rowText === 'Teamwork %') {
                                data.cell.styles.fillColor = [219, 234, 254];
                            } else if (rowText === 'Accountability %') {
                                data.cell.styles.fillColor = [209, 250, 229];
                            } else if (rowText === 'Relationships %') {
                                data.cell.styles.fillColor = [254, 243, 199];
                            } else if (rowText === 'Overall %') {
                                data.cell.styles.fillColor = [240, 240, 240];
                            } else if (rowText === 'Total Days' || rowText === 'Total Infractions') {
                                data.cell.styles.fillColor = [229, 231, 235];
                            }
                            data.cell.styles.textColor = [0, 0, 0];
                        }
                    }
                });
                
                yPos = doc.lastAutoTable.finalY + 20;
            }
        }
        
        // Check if Infractions by Class should be included (comparison mode)
        const includeClassInfractions = document.getElementById('modal-pdf-summary-class')?.checked === true;
        if (includeClassInfractions) {
            const allClasses = new Set();
            periods.forEach(periodKey => {
                const periodData = data.periods[periodKey];
                if (periodData.by_class) {
                    Object.keys(periodData.by_class).forEach(className => {
                        allClasses.add(className);
                    });
                }
            });
            const sortedClasses = Array.from(allClasses).sort();
            
            if (sortedClasses.length > 0) {
                // Check if any class has infractions across any period
                let hasInfractions = false;
                periods.forEach(periodKey => {
                    const periodData = data.periods[periodKey];
                    sortedClasses.forEach(className => {
                        const classData = periodData.by_class && periodData.by_class[className] ? periodData.by_class[className] : null;
                        if (classData && (classData.total_infractions || 0) > 0) {
                            hasInfractions = true;
                        }
                    });
                });
                
                if (hasInfractions) {
                    if (yPos > pageHeight - 150) {
                        doc.addPage();
                        yPos = 40;
                    }
                    
                    doc.setFontSize(14);
                    doc.setFont(undefined, 'bold');
                    doc.text('Infractions by Class', margin, yPos);
                    yPos += 25;
                    
                    // Create headers: Class, then each period
                    const classHeaders = ['Class'];
                    periods.forEach(p => classHeaders.push(p));
                    
                    const classRows = [];
                    sortedClasses.forEach(className => {
                        const classRow = [className];
                        let hasClassInfractions = false;
                        periods.forEach(periodKey => {
                            const periodData = data.periods[periodKey];
                            const classData = periodData.by_class && periodData.by_class[className] ? periodData.by_class[className] : null;
                            const totalInfractions = classData ? (classData.total_infractions || 0) : 0;
                            classRow.push(totalInfractions.toString());
                            if (totalInfractions > 0) {
                                hasClassInfractions = true;
                            }
                        });
                        if (hasClassInfractions) {
                            classRows.push(classRow);
                        }
                    });
                    
                    if (classRows.length > 0) {
                        doc.autoTable({
                            startY: yPos,
                            head: [classHeaders],
                            body: classRows,
                            theme: 'grid',
                            headStyles: { fillColor: [64, 64, 64], fontStyle: 'bold', fontSize: 10, textColor: [255, 255, 255] },
                            bodyStyles: { fontSize: 9 },
                            margin: { left: margin, right: margin },
                            styles: { cellPadding: 6 },
                            didParseCell: function(data) {
                                if (data.row.index >= 0 && data.column.index === 0) {
                                    // Class name column - gray background
                                    data.cell.styles.fillColor = [229, 231, 235];
                                    data.cell.styles.textColor = [0, 0, 0];
                                } else if (data.row.index >= 0 && data.column.index > 0) {
                                    // Infractions data cells - gray background
                                    data.cell.styles.fillColor = [229, 231, 235];
                                    data.cell.styles.textColor = [0, 0, 0];
                                }
                            }
                        });
                        
                        yPos = doc.lastAutoTable.finalY + 20;
                    }
                }
            }
        }
        
    } else {
        // Single period mode
        const numPeriods = data.totals && data.totals.possible ? data.totals.possible / 4 : 0;
        const maxPerCategory = numPeriods * 2;
        
        let safetyPercent = 0, teamworkPercent = 0, accountabilityPercent = 0, relationshipsPercent = 0, overallPercent = 0;
        
        if (maxPerCategory > 0) {
            safetyPercent = ((data.totals.safety / maxPerCategory) * 100).toFixed(0);
            teamworkPercent = ((data.totals.teamwork / maxPerCategory) * 100).toFixed(0);
            accountabilityPercent = ((data.totals.accountability / maxPerCategory) * 100).toFixed(0);
            relationshipsPercent = ((data.totals.relationships / maxPerCategory) * 100).toFixed(0);
            overallPercent = ((parseFloat(safetyPercent) + parseFloat(teamworkPercent) + parseFloat(accountabilityPercent) + parseFloat(relationshipsPercent)) / 4).toFixed(0);
        }
        
        // Check if STAR Averages should be included
        const includeStar = document.getElementById('modal-pdf-summary-star')?.checked !== false;
        if (includeStar) {
            // STAR Averages table
            doc.setFontSize(14);
            doc.setFont(undefined, 'bold');
            doc.text('STAR Averages', margin, yPos);
            yPos += 25;
            
            doc.autoTable({
                startY: yPos,
                head: [['Category', 'Percentage']],
                body: [
                    ['Safety (S)', `${safetyPercent}%`],
                    ['Teamwork (T)', `${teamworkPercent}%`],
                    ['Accountability (A)', `${accountabilityPercent}%`],
                    ['Relationships (R)', `${relationshipsPercent}%`],
                    ['Overall Average', `${overallPercent}%`]
                ],
                theme: 'grid',
                headStyles: { fillColor: [248, 249, 250], fontStyle: 'bold', fontSize: 10 },
                bodyStyles: { fontSize: 10 },
                margin: { left: margin, right: margin },
                styles: { cellPadding: 8 },
                didParseCell: function(data) {
                    if (data.row.index >= 0) {
                        const rowIndex = data.row.index;
                        // Apply row colors based on STAR category
                        if (rowIndex === 0) { // Safety
                            data.cell.styles.fillColor = [254, 226, 226];
                        } else if (rowIndex === 1) { // Teamwork
                            data.cell.styles.fillColor = [219, 234, 254];
                        } else if (rowIndex === 2) { // Accountability
                            data.cell.styles.fillColor = [209, 250, 229];
                        } else if (rowIndex === 3) { // Relationships
                            data.cell.styles.fillColor = [254, 243, 199];
                        } else if (rowIndex === 4) { // Overall
                            data.cell.styles.fillColor = [240, 240, 240];
                        }
                        data.cell.styles.textColor = [0, 0, 0];
                    }
                }
            });
            
            yPos = doc.lastAutoTable.finalY + 20;
        }
        
        // Check if Class Statistics should be included (single mode)
        const includeClass = document.getElementById('modal-pdf-summary-class')?.checked === true;
        if (includeClass && data.by_class && Object.keys(data.by_class).length > 0) {
            if (yPos > pageHeight - 150) {
                doc.addPage();
                yPos = 40;
            }
            
            doc.setFontSize(14);
            doc.setFont(undefined, 'bold');
            doc.text('Class Statistics', margin, yPos);
            yPos += 20;
            
            const classes = Object.keys(data.by_class).sort();
            const classRows = [];
            classes.forEach(className => {
                const classData = data.by_class[className];
                classRows.push([className, `${classData.percentages.overall}%`, classData.total_days || 0]);
            });
            
            doc.autoTable({
                startY: yPos,
                head: [['Class', 'Overall %', 'Total Days']],
                body: classRows,
                theme: 'grid',
                headStyles: { fillColor: [64, 64, 64], fontStyle: 'bold', fontSize: 10, textColor: [255, 255, 255] },
                bodyStyles: { fontSize: 9 },
                margin: { left: margin, right: margin },
                styles: { cellPadding: 6 }
            });
            
            yPos = doc.lastAutoTable.finalY + 20;
        }
        
        // Check if Day of Week Statistics should be included (single mode)
        const includeDay = document.getElementById('modal-pdf-summary-day')?.checked === true;
        if (includeDay && data.by_day_of_week && Object.keys(data.by_day_of_week).length > 0) {
            if (yPos > pageHeight - 150) {
                doc.addPage();
                yPos = 40;
            }
            
            doc.setFontSize(14);
            doc.setFont(undefined, 'bold');
            doc.text('Day of Week Statistics', margin, yPos);
            yPos += 25;
            
            const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
            const dayHeaders = ['Metric'];
            weekdays.forEach(day => dayHeaders.push(day));
            
            const dayRows = [];
            
            // Total Days row
            const totalDaysRow = ['Total Days'];
            weekdays.forEach(day => {
                const dayData = data.by_day_of_week[day];
                totalDaysRow.push((dayData ? (dayData.total_days || 0) : 0).toString());
            });
            dayRows.push(totalDaysRow);
            
            // Safety %
            const safetyRow = ['Safety %'];
            weekdays.forEach(day => {
                const dayData = data.by_day_of_week[day];
                safetyRow.push(`${dayData ? (dayData.percentages?.safety || 0) : 0}%`);
            });
            dayRows.push(safetyRow);
            
            // Teamwork %
            const teamworkRow = ['Teamwork %'];
            weekdays.forEach(day => {
                const dayData = data.by_day_of_week[day];
                teamworkRow.push(`${dayData ? (dayData.percentages?.teamwork || 0) : 0}%`);
            });
            dayRows.push(teamworkRow);
            
            // Accountability %
            const accountabilityRow = ['Accountability %'];
            weekdays.forEach(day => {
                const dayData = data.by_day_of_week[day];
                accountabilityRow.push(`${dayData ? (dayData.percentages?.accountability || 0) : 0}%`);
            });
            dayRows.push(accountabilityRow);
            
            // Relationships %
            const relationshipsRow = ['Relationships %'];
            weekdays.forEach(day => {
                const dayData = data.by_day_of_week[day];
                relationshipsRow.push(`${dayData ? (dayData.percentages?.relationships || 0) : 0}%`);
            });
            dayRows.push(relationshipsRow);
            
            // Overall %
            const overallRow = ['Overall %'];
            weekdays.forEach(day => {
                const dayData = data.by_day_of_week[day];
                overallRow.push(`${dayData ? (dayData.percentages?.overall || 0) : 0}%`);
            });
            dayRows.push(overallRow);
            
            // Infractions
            const infractionsRow = ['Infractions'];
            weekdays.forEach(day => {
                const dayData = data.by_day_of_week[day];
                infractionsRow.push((dayData ? (dayData.total_infractions || 0) : 0).toString());
            });
            dayRows.push(infractionsRow);
            
            // Reminders
            const remindersRow = ['Reminders'];
            weekdays.forEach(day => {
                const dayData = data.by_day_of_week[day];
                remindersRow.push((dayData ? (dayData.total_reminders || 0) : 0).toString());
            });
            dayRows.push(remindersRow);
            
            // Resets
            const resetsRow = ['Resets'];
            weekdays.forEach(day => {
                const dayData = data.by_day_of_week[day];
                resetsRow.push((dayData ? (dayData.total_resets || 0) : 0).toString());
            });
            dayRows.push(resetsRow);
            
            doc.autoTable({
                startY: yPos,
                head: [dayHeaders],
                body: dayRows,
                theme: 'grid',
                headStyles: { fillColor: [64, 64, 64], fontStyle: 'bold', fontSize: 10, textColor: [255, 255, 255] },
                bodyStyles: { fontSize: 9 },
                margin: { left: margin, right: margin },
                styles: { cellPadding: 6 },
                didParseCell: function(data) {
                    if (data.row.index >= 0 && data.column.index === 0) {
                        // Apply row colors based on metric type
                        const rowText = data.row.raw[0];
                        if (rowText === 'Safety %') {
                            data.cell.styles.fillColor = [254, 226, 226];
                        } else if (rowText === 'Teamwork %') {
                            data.cell.styles.fillColor = [219, 234, 254];
                        } else if (rowText === 'Accountability %') {
                            data.cell.styles.fillColor = [209, 250, 229];
                        } else if (rowText === 'Relationships %') {
                            data.cell.styles.fillColor = [254, 243, 199];
                        } else if (rowText === 'Overall %') {
                            data.cell.styles.fillColor = [240, 240, 240];
                        } else if (rowText === 'Total Days' || rowText === 'Infractions' || rowText === 'Reminders' || rowText === 'Resets') {
                            data.cell.styles.fillColor = [229, 231, 235];
                        }
                        data.cell.styles.textColor = [0, 0, 0];
                    } else if (data.row.index >= 0 && data.column.index > 0) {
                        // Apply colors to data cells
                        const rowText = data.row.raw[0];
                        if (rowText === 'Safety %') {
                            data.cell.styles.fillColor = [254, 226, 226];
                        } else if (rowText === 'Teamwork %') {
                            data.cell.styles.fillColor = [219, 234, 254];
                        } else if (rowText === 'Accountability %') {
                            data.cell.styles.fillColor = [209, 250, 229];
                        } else if (rowText === 'Relationships %') {
                            data.cell.styles.fillColor = [254, 243, 199];
                        } else if (rowText === 'Overall %') {
                            data.cell.styles.fillColor = [240, 240, 240];
                        } else if (rowText === 'Total Days' || rowText === 'Infractions' || rowText === 'Reminders' || rowText === 'Resets') {
                            data.cell.styles.fillColor = [229, 231, 235];
                        }
                        data.cell.styles.textColor = [0, 0, 0];
                    }
                }
            });
            
            yPos = doc.lastAutoTable.finalY + 20;
        }
        
        // Check if Infractions by Class should be included (single mode)
        const includeInfractionsClass = document.getElementById('modal-pdf-summary-infractions')?.checked === true;
        if (includeInfractionsClass && data.by_class && Object.keys(data.by_class).length > 0) {
            // Check if any class has infractions
            const hasInfractions = Object.values(data.by_class).some(classData => (classData.total_infractions || 0) > 0);
            
            if (hasInfractions) {
                if (yPos > pageHeight - 150) {
                    doc.addPage();
                    yPos = 40;
                }
                
                doc.setFontSize(14);
                doc.setFont(undefined, 'bold');
                doc.text('Infractions by Class', margin, yPos);
                yPos += 25;
                
                const classes = Object.keys(data.by_class).sort();
                const classRows = [];
                classes.forEach(className => {
                    const classData = data.by_class[className];
                    const totalInfractions = classData.total_infractions || 0;
                    if (totalInfractions > 0) {
                        classRows.push([className, totalInfractions.toString()]);
                    }
                });
                
                if (classRows.length > 0) {
                    doc.autoTable({
                        startY: yPos,
                        head: [['Class', 'Total Infractions']],
                        body: classRows,
                        theme: 'grid',
                        headStyles: { fillColor: [64, 64, 64], fontStyle: 'bold', fontSize: 10, textColor: [255, 255, 255] },
                        bodyStyles: { fontSize: 10 },
                        margin: { left: margin, right: margin },
                        styles: { cellPadding: 8 },
                        didParseCell: function(data) {
                            if (data.row.index >= 0) {
                                // Apply gray background to all infractions rows
                                data.cell.styles.fillColor = [229, 231, 235];
                                data.cell.styles.textColor = [0, 0, 0];
                            }
                        }
                    });
                    
                    yPos = doc.lastAutoTable.finalY + 20;
                }
            }
        }
        
        // Check if Infractions should be included
        const includeInfractions = document.getElementById('modal-pdf-summary-infractions')?.checked === true;
        if (includeInfractions) {
            // Infractions
            if (yPos > pageHeight - 150) {
                doc.addPage();
                yPos = 40;
            }
            
            doc.setFontSize(14);
            doc.setFont(undefined, 'bold');
            doc.text('Infractions', margin, yPos);
            yPos += 25;
            
            const infoRows = [
                ['Total Days', data.total_days.toString()]
            ];
            
            if (data.additional_info) {
                if (data.additional_info.infractions && Object.keys(data.additional_info.infractions).length > 0) {
                    const totalInfractions = Object.values(data.additional_info.infractions).reduce((sum, count) => sum + count, 0);
                    infoRows.push(['Total Infractions', totalInfractions.toString()]);
                }
                infoRows.push(['Reminders', (data.additional_info.total_reminders || 0).toString()]);
                infoRows.push(['Resets', (data.additional_info.total_resets || 0).toString()]);
            }
            
            doc.autoTable({
                startY: yPos,
                head: [['Category', 'Value']],
                body: infoRows,
                theme: 'grid',
                headStyles: { fillColor: [64, 64, 64], fontStyle: 'bold', fontSize: 10, textColor: [255, 255, 255] },
                bodyStyles: { fontSize: 10 },
                margin: { left: margin, right: margin },
                styles: { cellPadding: 8 },
                didParseCell: function(data) {
                    if (data.row.index >= 0) {
                        const rowText = data.row.raw[0];
                        // Apply gray background to Total Infractions, Reminders, and Resets rows
                        if (rowText === 'Total Infractions' || rowText === 'Reminders' || rowText === 'Resets') {
                            data.cell.styles.fillColor = [229, 231, 235];
                            data.cell.styles.textColor = [0, 0, 0];
                        }
                    }
                }
            });
            
            yPos = doc.lastAutoTable.finalY + 20;
        }
        
        // Check if Infractions by Day of Week should be included
        const includeInfractionsDay = document.getElementById('modal-pdf-summary-infractions-day')?.checked === true;
        if (includeInfractionsDay && data.by_day_of_week) {
            if (yPos > pageHeight - 150) {
                doc.addPage();
                yPos = 40;
            }
            
            doc.setFontSize(14);
            doc.setFont(undefined, 'bold');
            doc.text('Infractions by Day of Week', margin, yPos);
            yPos += 25;
            
            const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
            const dayHeaders = ['Metric'];
            weekdays.forEach(day => dayHeaders.push(day));
            
            const dayRows = [];
            
            // Total Days row
            const totalDaysRow = ['Total Days'];
            weekdays.forEach(day => {
                const dayData = data.by_day_of_week[day];
                totalDaysRow.push((dayData ? (dayData.total_days || 0) : 0).toString());
            });
            dayRows.push(totalDaysRow);
            
            // Safety %
            const safetyRow = ['Safety %'];
            weekdays.forEach(day => {
                const dayData = data.by_day_of_week[day];
                safetyRow.push(`${dayData ? (dayData.percentages?.safety || 0) : 0}%`);
            });
            dayRows.push(safetyRow);
            
            // Teamwork %
            const teamworkRow = ['Teamwork %'];
            weekdays.forEach(day => {
                const dayData = data.by_day_of_week[day];
                teamworkRow.push(`${dayData ? (dayData.percentages?.teamwork || 0) : 0}%`);
            });
            dayRows.push(teamworkRow);
            
            // Accountability %
            const accountabilityRow = ['Accountability %'];
            weekdays.forEach(day => {
                const dayData = data.by_day_of_week[day];
                accountabilityRow.push(`${dayData ? (dayData.percentages?.accountability || 0) : 0}%`);
            });
            dayRows.push(accountabilityRow);
            
            // Relationships %
            const relationshipsRow = ['Relationships %'];
            weekdays.forEach(day => {
                const dayData = data.by_day_of_week[day];
                relationshipsRow.push(`${dayData ? (dayData.percentages?.relationships || 0) : 0}%`);
            });
            dayRows.push(relationshipsRow);
            
            // Overall %
            const overallRow = ['Overall %'];
            weekdays.forEach(day => {
                const dayData = data.by_day_of_week[day];
                overallRow.push(`${dayData ? (dayData.percentages?.overall || 0) : 0}%`);
            });
            dayRows.push(overallRow);
            
            // Infractions
            const infractionsRow = ['Infractions'];
            weekdays.forEach(day => {
                const dayData = data.by_day_of_week[day];
                infractionsRow.push((dayData ? (dayData.total_infractions || 0) : 0).toString());
            });
            dayRows.push(infractionsRow);
            
            // Reminders
            const remindersRow = ['Reminders'];
            weekdays.forEach(day => {
                const dayData = data.by_day_of_week[day];
                remindersRow.push((dayData ? (dayData.total_reminders || 0) : 0).toString());
            });
            dayRows.push(remindersRow);
            
            // Resets
            const resetsRow = ['Resets'];
            weekdays.forEach(day => {
                const dayData = data.by_day_of_week[day];
                resetsRow.push((dayData ? (dayData.total_resets || 0) : 0).toString());
            });
            dayRows.push(resetsRow);
            
            doc.autoTable({
                startY: yPos,
                head: [dayHeaders],
                body: dayRows,
                theme: 'grid',
                headStyles: { fillColor: [64, 64, 64], fontStyle: 'bold', fontSize: 10, textColor: [255, 255, 255] },
                bodyStyles: { fontSize: 9 },
                margin: { left: margin, right: margin },
                styles: { cellPadding: 6 },
                didParseCell: function(data) {
                    // Ensure header cells have white text
                    if (data.section === 'head') {
                        data.cell.styles.textColor = [255, 255, 255];
                    }
                    if (data.row.index >= 0 && data.column.index === 0) {
                        // Apply row colors based on metric type
                        const rowText = data.row.raw[0];
                        if (rowText === 'Safety %') {
                            data.cell.styles.fillColor = [254, 226, 226];
                        } else if (rowText === 'Teamwork %') {
                            data.cell.styles.fillColor = [219, 234, 254];
                        } else if (rowText === 'Accountability %') {
                            data.cell.styles.fillColor = [209, 250, 229];
                        } else if (rowText === 'Relationships %') {
                            data.cell.styles.fillColor = [254, 243, 199];
                        } else if (rowText === 'Overall %') {
                            data.cell.styles.fillColor = [240, 240, 240];
                        } else if (rowText === 'Total Days' || rowText === 'Infractions' || rowText === 'Reminders' || rowText === 'Resets') {
                            data.cell.styles.fillColor = [229, 231, 235];
                        }
                        data.cell.styles.textColor = [0, 0, 0];
                    } else if (data.row.index >= 0 && data.column.index > 0) {
                        // Apply colors to data cells
                        const rowText = data.row.raw[0];
                        if (rowText === 'Safety %') {
                            data.cell.styles.fillColor = [254, 226, 226];
                        } else if (rowText === 'Teamwork %') {
                            data.cell.styles.fillColor = [219, 234, 254];
                        } else if (rowText === 'Accountability %') {
                            data.cell.styles.fillColor = [209, 250, 229];
                        } else if (rowText === 'Relationships %') {
                            data.cell.styles.fillColor = [254, 243, 199];
                        } else if (rowText === 'Overall %') {
                            data.cell.styles.fillColor = [240, 240, 240];
                        } else if (rowText === 'Total Days' || rowText === 'Infractions' || rowText === 'Reminders' || rowText === 'Resets') {
                            data.cell.styles.fillColor = [229, 231, 235];
                        }
                        data.cell.styles.textColor = [0, 0, 0];
                    }
                }
            });
            
            yPos = doc.lastAutoTable.finalY + 20;
        }
    }
    
    // Add page numbers
    const pageCount = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFontSize(8);
        doc.text(`Page ${i} of ${pageCount}`, pageWidth - margin - 30, pageHeight - 20);
    }
    
    // Save PDF
    doc.save(`Summary_${studentName.replace(/[^a-zA-Z0-9]/g, '_')}_${timeframeLabel.replace(/[^a-zA-Z0-9]/g, '_')}_${new Date().toISOString().split('T')[0]}.pdf`);
}

function generateFrenzyStatsPDF() {
    if (!window.currentFrenzyStatsData) {
        alert('Please load frenzy statistics data first.');
        return;
    }

    const { jsPDF } = window.jspdf;
    const data = window.currentFrenzyStatsData;
    
    // Get filter information
    const studentSelect = document.getElementById('frenzy-student-select');
    const studentId = studentSelect ? studentSelect.value : '';
    const studentName = studentId && studentSelect.options[studentSelect.selectedIndex] ? 
        studentSelect.options[studentSelect.selectedIndex].text : 'All Students';
    
    const periodSelect = document.getElementById('frenzy-period-select');
    const timeframeSelect = document.getElementById('frenzy-timeframe-select');
    const period = periodSelect ? periodSelect.value : '';
    const timeframe = timeframeSelect ? timeframeSelect.value : '';
    
    // Determine timeframe label
    let timeframeLabel = 'All Time';
    if (period) {
        const periodLabels = {
            '30day': '30 Day',
            'current_year': 'Current Year',
            'quarter1': 'Quarter 1',
            'quarter2': 'Quarter 2',
            'quarter3': 'Quarter 3',
            'quarter4': 'Quarter 4',
            'all_time': 'All Time',
            'previous_years': 'Previous Years'
        };
        timeframeLabel = periodLabels[period] || period;
    } else if (timeframe) {
        const timeframeLabels = {
            '30day': '30 Day',
            '30day_to_30day': '30 Day to 30 Day',
            'month': 'Month to Month',
            'quarter': 'Quarter to Quarter',
            'year': 'Year to Year',
            'alltime': 'All Time',
            'custom_range': 'Custom Range'
        };
        timeframeLabel = timeframeLabels[timeframe] || timeframe;
    }

    // Create PDF - use landscape for comparison tables
    const isComparison = data.comparison_mode && data.periods;
    const doc = new jsPDF(isComparison ? 'landscape' : 'portrait', 'pt', 'letter');
    
    let yPos = 40;
    const margin = 40;
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const contentWidth = pageWidth - (2 * margin);
    
    // Add header
    doc.setFontSize(18);
    doc.setFont(undefined, 'bold');
    doc.text('Frenzy Statistics Report', margin, yPos);
    yPos += 25;
    
    doc.setFontSize(12);
    doc.setFont(undefined, 'normal');
    doc.text(`Student: ${studentName}`, margin, yPos);
    yPos += 20;
    doc.text(`Timeframe: ${timeframeLabel}`, margin, yPos);
    yPos += 20;
    doc.text(`Generated: ${new Date().toLocaleDateString()}`, margin, yPos);
    yPos += 30;

    if (isComparison) {
        // Comparison mode - multiple periods
        const periods = Object.keys(data.periods);
        
        // Main statistics table
        const statsHeaders = ['Metric'];
        periods.forEach(p => statsHeaders.push(p));
        
        const statsRows = [];
        
        // Data Points row (if applicable)
        if ((timeframe === '30day' || timeframe === '30day_to_30day') || (period === '30day')) {
            const row = ['Data Points'];
            periods.forEach(periodKey => {
                const periodData = data.periods[periodKey];
                const dataPoints = periodData.available_data_points !== undefined ? periodData.available_data_points : periodData.total_days || 0;
                const hasFull30 = periodData.has_full_30_days !== undefined ? periodData.has_full_30_days : false;
                row.push(hasFull30 ? `${dataPoints} (Full 30 Days)` : `${dataPoints}`);
            });
            statsRows.push(row);
        }
        
        // Total Frenzies
        const totalFrenziesRow = ['Total Frenzies'];
        periods.forEach(periodKey => {
            totalFrenziesRow.push((data.periods[periodKey].total_count || 0).toString());
        });
        statsRows.push(totalFrenziesRow);
        
        // Total Duration
        const totalDurationRow = ['Total Duration (min)'];
        periods.forEach(periodKey => {
            totalDurationRow.push((data.periods[periodKey].total_duration || 0).toString());
        });
        statsRows.push(totalDurationRow);
        
        // Average Duration
        const avgDurationRow = ['Average Duration (min)'];
        periods.forEach(periodKey => {
            const avgDuration = data.periods[periodKey].avg_duration ? data.periods[periodKey].avg_duration.toFixed(1) : '0.0';
            avgDurationRow.push(avgDuration);
        });
        statsRows.push(avgDurationRow);
        
        // Add statistics table (always included)
        doc.autoTable({
            startY: yPos,
            head: [statsHeaders],
            body: statsRows,
            theme: 'grid',
            headStyles: { fillColor: [248, 249, 250], fontStyle: 'bold', fontSize: 10 },
            bodyStyles: { fontSize: 9 },
            margin: { left: margin, right: margin },
            styles: { cellPadding: 6 }
        });
        
        yPos = doc.lastAutoTable.finalY + 20;
        
        // Check if Day of Week Statistics should be included
        const includeDay = document.getElementById('modal-pdf-frenzy-day')?.checked === true;
        if (includeDay) {
            const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
            const allDays = new Set();
            periods.forEach(periodKey => {
                const periodData = data.periods[periodKey];
                if (periodData.by_day) {
                    Object.keys(periodData.by_day).forEach(day => {
                        if (weekdays.includes(day)) {
                            allDays.add(day);
                        }
                    });
                }
            });
            const sortedDays = weekdays.filter(d => allDays.has(d));
            
            if (sortedDays.length > 0) {
                if (yPos > pageHeight - 150) {
                    doc.addPage();
                    yPos = 40;
                }
                
                doc.setFontSize(14);
                doc.setFont(undefined, 'bold');
                doc.text('Day of Week Statistics', margin, yPos);
                yPos += 20;
                
                const dayHeaders = ['Metric'];
                periods.forEach(p => dayHeaders.push(p));
                
                const dayRows = [];
                sortedDays.forEach(day => {
                    const countRow = [day + ' - Count'];
                    const durationRow = [day + ' - Duration (min)'];
                    periods.forEach(periodKey => {
                        const periodData = data.periods[periodKey];
                        const dayData = periodData.by_day && periodData.by_day[day] ? periodData.by_day[day] : {count: 0, duration: 0};
                        countRow.push((dayData.count || 0).toString());
                        durationRow.push((dayData.duration || 0).toString());
                    });
                    dayRows.push(countRow);
                    dayRows.push(durationRow);
                });
                
                doc.autoTable({
                    startY: yPos,
                    head: [dayHeaders],
                    body: dayRows,
                    theme: 'grid',
                    headStyles: { fillColor: [248, 249, 250], fontStyle: 'bold', fontSize: 10 },
                    bodyStyles: { fontSize: 9 },
                    margin: { left: margin, right: margin },
                    styles: { cellPadding: 6 }
                });
                
                yPos = doc.lastAutoTable.finalY + 20;
            }
        }
        
        // Check if Class Statistics should be included
        const includeClass = document.getElementById('modal-pdf-frenzy-class')?.checked === true;
        if (includeClass) {
            const allClasses = new Set();
            periods.forEach(periodKey => {
                const periodData = data.periods[periodKey];
                if (periodData.by_location) {
                    Object.keys(periodData.by_location).forEach(className => {
                        allClasses.add(className);
                    });
                }
            });
            const sortedClasses = Array.from(allClasses).sort();
            
            if (sortedClasses.length > 0) {
                if (yPos > pageHeight - 150) {
                    doc.addPage();
                    yPos = 40;
                }
                
                doc.setFontSize(14);
                doc.setFont(undefined, 'bold');
                doc.text('Class Statistics', margin, yPos);
                yPos += 20;
                
                const classHeaders = ['Metric'];
                periods.forEach(p => classHeaders.push(p));
                
                const classRows = [];
                sortedClasses.forEach(className => {
                    const countRow = [className + ' - Count'];
                    const durationRow = [className + ' - Duration (min)'];
                    periods.forEach(periodKey => {
                        const periodData = data.periods[periodKey];
                        const classData = periodData.by_location && periodData.by_location[className] ? periodData.by_location[className] : {count: 0, duration: 0};
                        countRow.push((classData.count || 0).toString());
                        durationRow.push((classData.duration || 0).toString());
                    });
                    classRows.push(countRow);
                    classRows.push(durationRow);
                });
                
                doc.autoTable({
                    startY: yPos,
                    head: [classHeaders],
                    body: classRows,
                    theme: 'grid',
                    headStyles: { fillColor: [248, 249, 250], fontStyle: 'bold', fontSize: 10 },
                    bodyStyles: { fontSize: 9 },
                    margin: { left: margin, right: margin },
                    styles: { cellPadding: 6 }
                });
                
                yPos = doc.lastAutoTable.finalY + 20;
            }
        }
        
        // Check if Purpose Statistics should be included
        const includePurpose = document.getElementById('modal-pdf-frenzy-purpose')?.checked === true;
        if (includePurpose) {
            const allPurposes = new Set();
            periods.forEach(periodKey => {
                const periodData = data.periods[periodKey];
                if (periodData.by_purpose) {
                    Object.keys(periodData.by_purpose).forEach(purpose => {
                        allPurposes.add(purpose);
                    });
                }
            });
            const sortedPurposes = Array.from(allPurposes).sort();
            
            if (sortedPurposes.length > 0) {
                if (yPos > pageHeight - 150) {
                    doc.addPage();
                    yPos = 40;
                }
                
                doc.setFontSize(14);
                doc.setFont(undefined, 'bold');
                doc.text('Purpose Statistics', margin, yPos);
                yPos += 20;
                
                const purposeHeaders = ['Metric'];
                periods.forEach(p => purposeHeaders.push(p));
                
                const purposeRows = [];
                sortedPurposes.forEach(purpose => {
                    const countRow = [purpose + ' - Count'];
                    const durationRow = [purpose + ' - Duration (min)'];
                    periods.forEach(periodKey => {
                        const periodData = data.periods[periodKey];
                        const purposeData = periodData.by_purpose && periodData.by_purpose[purpose] ? periodData.by_purpose[purpose] : {count: 0, duration: 0};
                        countRow.push((purposeData.count || 0).toString());
                        durationRow.push((purposeData.duration || 0).toString());
                    });
                    purposeRows.push(countRow);
                    purposeRows.push(durationRow);
                });
                
                doc.autoTable({
                    startY: yPos,
                    head: [purposeHeaders],
                    body: purposeRows,
                    theme: 'grid',
                    headStyles: { fillColor: [248, 249, 250], fontStyle: 'bold', fontSize: 10 },
                    bodyStyles: { fontSize: 9 },
                    margin: { left: margin, right: margin },
                    styles: { cellPadding: 6 }
                });
                
                yPos = doc.lastAutoTable.finalY + 20;
            }
        }
        
    } else {
        // Single period mode
        doc.autoTable({
            startY: yPos,
            head: [['Metric', 'Value']],
            body: [
                ['Total Frenzies', (data.total_count || 0).toString()],
                ['Total Duration (min)', (data.total_duration || 0).toString()],
                ['Average Duration (min)', data.avg_duration ? data.avg_duration.toFixed(1) : '0.0']
            ],
            theme: 'grid',
            headStyles: { fillColor: [248, 249, 250], fontStyle: 'bold', fontSize: 10 },
            bodyStyles: { fontSize: 10 },
            margin: { left: margin, right: margin },
            styles: { cellPadding: 8 }
        });
        
        yPos = doc.lastAutoTable.finalY + 20;
        
        // Check if Day of Week Statistics should be included (single mode)
        const includeDay = document.getElementById('modal-pdf-frenzy-day')?.checked === true;
        if (includeDay && data.by_day && Object.keys(data.by_day).length > 0) {
            if (yPos > pageHeight - 150) {
                doc.addPage();
                yPos = 40;
            }
            
            doc.setFontSize(14);
            doc.setFont(undefined, 'bold');
            doc.text('Day of Week Statistics', margin, yPos);
            yPos += 20;
            
            const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
            const dayRows = [];
            weekdays.forEach(day => {
                if (data.by_day[day]) {
                    const dayData = data.by_day[day];
                    dayRows.push([day, (dayData.count || 0).toString(), (dayData.duration || 0).toString()]);
                }
            });
            
            if (dayRows.length > 0) {
                doc.autoTable({
                    startY: yPos,
                    head: [['Day', 'Count', 'Duration (min)']],
                    body: dayRows,
                    theme: 'grid',
                    headStyles: { fillColor: [248, 249, 250], fontStyle: 'bold', fontSize: 10 },
                    bodyStyles: { fontSize: 10 },
                    margin: { left: margin, right: margin },
                    styles: { cellPadding: 8 }
                });
                
                yPos = doc.lastAutoTable.finalY + 20;
            }
        }
        
        // Check if Class Statistics should be included (single mode)
        const includeClass = document.getElementById('modal-pdf-frenzy-class')?.checked === true;
        if (includeClass && data.by_location && Object.keys(data.by_location).length > 0) {
            if (yPos > pageHeight - 150) {
                doc.addPage();
                yPos = 40;
            }
            
            doc.setFontSize(14);
            doc.setFont(undefined, 'bold');
            doc.text('Class Statistics', margin, yPos);
            yPos += 20;
            
            const classes = Object.keys(data.by_location).sort();
            const classRows = [];
            classes.forEach(className => {
                const classData = data.by_location[className];
                classRows.push([className, (classData.count || 0).toString(), (classData.duration || 0).toString()]);
            });
            
            doc.autoTable({
                startY: yPos,
                head: [['Class', 'Count', 'Duration (min)']],
                body: classRows,
                theme: 'grid',
                headStyles: { fillColor: [248, 249, 250], fontStyle: 'bold', fontSize: 10 },
                bodyStyles: { fontSize: 10 },
                margin: { left: margin, right: margin },
                styles: { cellPadding: 8 }
            });
            
            yPos = doc.lastAutoTable.finalY + 20;
        }
        
        // Check if Purpose Statistics should be included (single mode)
        const includePurpose = document.getElementById('modal-pdf-frenzy-purpose')?.checked === true;
        if (includePurpose && data.by_purpose && Object.keys(data.by_purpose).length > 0) {
            if (yPos > pageHeight - 150) {
                doc.addPage();
                yPos = 40;
            }
            
            doc.setFontSize(14);
            doc.setFont(undefined, 'bold');
            doc.text('Purpose Statistics', margin, yPos);
            yPos += 20;
            
            const purposes = Object.keys(data.by_purpose).sort();
            const purposeRows = [];
            purposes.forEach(purpose => {
                const purposeData = data.by_purpose[purpose];
                purposeRows.push([purpose, (purposeData.count || 0).toString(), (purposeData.duration || 0).toString()]);
            });
            
            doc.autoTable({
                startY: yPos,
                head: [['Purpose', 'Count', 'Duration (min)']],
                body: purposeRows,
                theme: 'grid',
                headStyles: { fillColor: [248, 249, 250], fontStyle: 'bold', fontSize: 10 },
                bodyStyles: { fontSize: 10 },
                margin: { left: margin, right: margin },
                styles: { cellPadding: 8 }
            });
        }
    }
    
    // Add page numbers
    const pageCount = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFontSize(8);
        doc.text(`Page ${i} of ${pageCount}`, pageWidth - margin - 30, pageHeight - 20);
    }
    
    // Save PDF
    doc.save(`FrenzyStats_${studentName.replace(/[^a-zA-Z0-9]/g, '_')}_${timeframeLabel.replace(/[^a-zA-Z0-9]/g, '_')}_${new Date().toISOString().split('T')[0]}.pdf`);
}

// Make functions globally accessible
window.showInfractionsSummary = showInfractionsSummary;
window.showInfractionsSummarySingle = showInfractionsSummarySingle;
window.showStarCategoryDetails = showStarCategoryDetails;
window.closeStarCategoryDetailsModal = closeStarCategoryDetailsModal;
window.closeInfractionsSummaryModal = closeInfractionsSummaryModal;
window.generateSummaryPDF = generateSummaryPDF;
window.generateFrenzyStatsPDF = generateFrenzyStatsPDF;
window.showPdfTableSelectionModal = showPdfTableSelectionModal;
window.closePdfTableSelectionModal = closePdfTableSelectionModal;
window.generatePdfFromModal = generatePdfFromModal;

// ==================== MARKETPLACE TAB ====================

var currentMarketplaceStudentId = null;
var marketplaceCatalog = [];
var marketplaceCart = []; // [{ item_id, quantity, name?, price? }]
var marketplaceBalance = null;

function getMarketplaceCartKey() {
    var uid = (window.currentUser && window.currentUser.id) ? window.currentUser.id : 'anon';
    return 'marketplace_cart_' + uid;
}

function getMarketplaceStudentId() {
    if (window.currentUser && window.currentUser.role === 'student') {
        return window.currentUser.studentId || null;
    }
    return currentMarketplaceStudentId;
}

function loadMarketplaceCartFromStorage() {
    try {
        var raw = sessionStorage.getItem(getMarketplaceCartKey());
        marketplaceCart = raw ? JSON.parse(raw) : [];
    } catch (e) {
        marketplaceCart = [];
    }
}

function saveMarketplaceCartToStorage() {
    try {
        sessionStorage.setItem(getMarketplaceCartKey(), JSON.stringify(marketplaceCart));
    } catch (e) {}
}

function addToMarketplaceCart(itemId, name, price, quantity) {
    quantity = quantity || 1;
    var existing = marketplaceCart.find(function (x) { return x.item_id === itemId; });
    if (existing) {
        existing.quantity += quantity;
    } else {
        marketplaceCart.push({ item_id: itemId, quantity: quantity, name: name, price: price });
    }
    saveMarketplaceCartToStorage();
    renderMarketplaceCart();
}

function removeFromMarketplaceCart(itemId) {
    marketplaceCart = marketplaceCart.filter(function (x) { return x.item_id !== itemId; });
    saveMarketplaceCartToStorage();
    renderMarketplaceCart();
}

function setMarketplaceCartQuantity(itemId, quantity) {
    var item = marketplaceCart.find(function (x) { return x.item_id === itemId; });
    if (!item) return;
    if (quantity <= 0) {
        removeFromMarketplaceCart(itemId);
        return;
    }
    item.quantity = quantity;
    saveMarketplaceCartToStorage();
    renderMarketplaceCart();
}

function renderMarketplaceCart() {
    var el = document.getElementById('marketplace-cart-items');
    var totalEl = document.getElementById('marketplace-cart-total');
    var checkoutBtn = document.getElementById('marketplace-checkout-btn');
    if (!el) return;
    if (!marketplaceCart.length) {
        el.innerHTML = '<p style="margin:0; color:#94a3b8; font-size:13px;">Cart is empty.</p>';
        if (totalEl) totalEl.textContent = 'Total: $0.00';
        if (checkoutBtn) checkoutBtn.disabled = true;
        return;
    }
    var total = 0;
    el.innerHTML = marketplaceCart.map(function (line) {
        var price = Number(line.price || 0);
        var subtotal = price * (line.quantity || 1);
        total += subtotal;
        var itemId = line.item_id;
        return '<div class="marketplace-cart-line" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; font-size:13px; gap:8px;">' +
            '<span style="flex:1; min-width:0;">' + (line.name || 'Item') + ' × ' + (line.quantity || 1) + '</span>' +
            '<span>$' + subtotal.toFixed(2) + '</span>' +
            '<button type="button" class="marketplace-cart-remove-btn" data-item-id="' + itemId + '" title="Remove from cart" style="flex-shrink:0; padding:2px 6px; font-size:12px; color:#64748b; background:var(--bg-elevated); border:none; border-radius:var(--radius-sm); cursor:pointer;">✕</button>' +
            '</div>';
    }).join('');
    el.querySelectorAll('.marketplace-cart-remove-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
            var id = parseInt(btn.getAttribute('data-item-id'), 10);
            removeFromMarketplaceCart(id);
        });
    });
    if (totalEl) totalEl.textContent = 'Total: $' + total.toFixed(2);
    var checkoutMsg = document.getElementById('marketplace-checkout-msg');
    if (marketplaceBalance !== null && total > marketplaceBalance) {
        if (checkoutBtn) checkoutBtn.disabled = true;
        if (checkoutMsg) { checkoutMsg.style.display = 'block'; checkoutMsg.textContent = 'Insufficient funds.'; checkoutMsg.style.color = '#dc2626'; }
    } else {
        if (checkoutBtn) checkoutBtn.disabled = false;
        if (checkoutMsg) checkoutMsg.style.display = 'none';
    }
}

function handleMarketplaceView() {
    loadMarketplaceCartFromStorage();
    var isStudent = window.currentUser && window.currentUser.role === 'student';
    var poSection = document.getElementById('marketplace-po-approvals-section');
    var viewAsRow = document.getElementById('marketplace-view-as-student-row');
    var studentWrap = document.getElementById('marketplace-student-select-wrap');
    var viewAsCheck = document.getElementById('marketplace-show-view-as-student-checkbox');
    var cartSection = document.getElementById('marketplace-cart-section');
    var balanceSection = document.getElementById('marketplace-balance-section');
    if (poSection) poSection.style.display = (isStudent ? 'none' : 'block');
    if (viewAsRow) viewAsRow.style.display = (isStudent ? 'none' : 'block');
    if (viewAsCheck) viewAsCheck.checked = false;
    if (studentWrap) studentWrap.style.display = 'none';
    if (cartSection) cartSection.style.display = (isStudent ? 'block' : 'none');
    // Balance card: only show for students, or for staff/admin when "View as student" is checked
    if (balanceSection) balanceSection.style.display = (isStudent ? 'block' : 'none');

    if (isStudent) {
        currentMarketplaceStudentId = window.currentUser.studentId || null;
        loadMarketplaceTypesAndCategories();
        loadMarketplaceBalance();
        loadMarketplaceCatalog();
        loadMarketplaceMyOrders();
        renderMarketplaceCart();
        bindMarketplaceCheckout();
    } else {
        loadMarketplacePOApprovals();
        setupMarketplaceStudentSearch();
        loadMarketplaceAnalytics();
        // Staff/admin: default to "Hide analytics" checked so analytics are collapsed
        var analyticsHideCheck = document.getElementById('marketplace-analytics-hide-checkbox');
        var analyticsBody = document.getElementById('marketplace-analytics-body');
        if (analyticsHideCheck && analyticsBody) {
            analyticsHideCheck.checked = true;
            analyticsBody.style.display = 'none';
        }
        loadMarketplaceTypesAndCategories();
        currentMarketplaceStudentId = null;
        document.getElementById('marketplace-balance-amount').textContent = '$0.00';
        document.getElementById('marketplace-student-name').textContent = '';
        loadMarketplaceCatalog(); // staff sees all items (no student required)
        renderMarketplaceCart();
        if (document.getElementById('marketplace-no-items-msg')) document.getElementById('marketplace-no-items-msg').style.display = 'none';
    }
    loadNotifications();
}

function loadMarketplaceBalance() {
    var sid = getMarketplaceStudentId();
    if (!sid) {
        marketplaceBalance = null;
        document.getElementById('marketplace-balance-amount').textContent = '$0.00';
        document.getElementById('marketplace-student-name').textContent = '';
        renderMarketplaceCart();
        return;
    }
    fetch('/api/bank-account/' + sid)
        .then(function (r) { return r.ok ? r.json() : Promise.reject(); })
        .then(function (data) {
            marketplaceBalance = Number(data.balance) || 0;
            document.getElementById('marketplace-balance-amount').textContent = '$' + marketplaceBalance.toFixed(2);
            var student = (typeof allStudents !== 'undefined' && allStudents) ? allStudents.find(function (s) { return s.id === sid; }) : null;
            document.getElementById('marketplace-student-name').textContent = student ? student.name : '';
            renderMarketplaceCart();
        })
        .catch(function () {
            marketplaceBalance = null;
            document.getElementById('marketplace-balance-amount').textContent = '$0.00';
            document.getElementById('marketplace-student-name').textContent = '';
            renderMarketplaceCart();
        });
}

function loadMarketplaceCatalog() {
    var isStudent = window.currentUser && window.currentUser.role === 'student';
    var sid = getMarketplaceStudentId();
    var params = new URLSearchParams();
    if (isStudent) {
        if (!sid) {
            document.getElementById('marketplace-items-grid').innerHTML = '';
            document.getElementById('marketplace-no-items-msg').style.display = 'block';
            return;
        }
        params.set('student_id', sid);
    } else {
        // Staff/admin: load all items with hidden_rules (no student required)
        params.set('staff', '1');
    }
    var q = document.getElementById('marketplace-search-input') && document.getElementById('marketplace-search-input').value.trim();
    var typeId = document.getElementById('marketplace-filter-type') && document.getElementById('marketplace-filter-type').value;
    var categoryId = document.getElementById('marketplace-filter-category') && document.getElementById('marketplace-filter-category').value;
    if (q) params.set('q', q);
    if (typeId) params.set('type_id', typeId);
    if (categoryId) params.set('category_id', categoryId);
    fetch('/api/marketplace/catalog?' + params.toString())
        .then(function (r) { return r.ok ? r.json() : Promise.reject(); })
        .then(function (items) {
            marketplaceCatalog = items;
            renderMarketplaceCatalog(items);
            var noMsg = document.getElementById('marketplace-no-items-msg');
            if (noMsg) noMsg.style.display = items.length ? 'none' : 'block';
        })
        .catch(function () {
            marketplaceCatalog = [];
            renderMarketplaceCatalog([]);
            var noMsg = document.getElementById('marketplace-no-items-msg');
            if (noMsg) noMsg.style.display = 'block';
        });
}

/**
 * Return the image src to use for marketplace display. For Google Drive and Imgur we use the
 * backend image proxy so Drive share links and Imgur albums work (they fail when loaded directly).
 */
function getMarketplaceImageSrc(url) {
    if (!url || typeof url !== 'string') return '';
    var u = url.trim();
    if (/drive\.google\.com/i.test(u) || /imgur\.com/i.test(u)) {
        return '/api/marketplace/image-proxy?url=' + encodeURIComponent(u);
    }
    // Other hosts: normalize single-image Imgur page URLs only (no proxy)
    if (/^https?:\/\/(www\.)?imgur\.com\/[a-zA-Z0-9]+(\?.*)?$/.test(u)) {
        var code = u.replace(/^https?:\/\/(www\.)?imgur\.com\/([a-zA-Z0-9]+).*$/, '$2');
        if (code && code !== 'a') return 'https://i.imgur.com/' + code + '.jpg';
    }
    return u;
}

function renderMarketplaceCatalog(items) {
    var grid = document.getElementById('marketplace-items-grid');
    if (!grid) return;
    if (!items || !items.length) {
        grid.innerHTML = '';
        return;
    }
    var isStudent = window.currentUser && window.currentUser.role === 'student';
    var isStaffOrAdmin = window.currentUser && (window.currentUser.role === 'staff' || window.currentUser.role === 'admin');
    var isAdmin = window.currentUser && window.currentUser.role === 'admin';
    grid.innerHTML = items.map(function (item) {
        var imgSrc = item.image_url ? getMarketplaceImageSrc(item.image_url).replace(/"/g, '&quot;') : '';
        var noImgDiv = '<div class="marketplace-card-no-img" style="width:100%; height:140px; background:var(--bg-elevated); border-radius:var(--radius-md); margin-bottom:10px; display:flex; align-items:center; justify-content:center; color:var(--text-secondary);">No image</div>';
        var imgHtml = item.image_url
            ? '<img src="' + imgSrc + '" alt="" referrerpolicy="no-referrer" style="width:100%; height:140px; object-fit:cover; border-radius:8px; margin-bottom:10px;" onerror="this.outerHTML=\'<div class=&quot;marketplace-card-no-img&quot; style=&quot;width:100%;height:140px;background:#e2e8f0;border-radius:8px;margin-bottom:10px;display:flex;align-items:center;justify-content:center;color:#94a3b8;&quot;>No image</div>\';">'
            : noImgDiv;
        var btnHtml = isStudent
            ? '<button type="button" class="btn-primary marketplace-card-add-btn" style="padding:6px 12px; font-size:13px;" data-item-id="' + item.id + '" data-item-name="' + (item.name || '').replace(/"/g, '&quot;') + '" data-item-price="' + item.price + '">Add to cart</button>'
            : '';
        var staffBtns = '';
        if (isStaffOrAdmin) {
            var hasHidden = item.hidden_rules && item.hidden_rules.length > 0;
            staffBtns = '<div class="marketplace-item-staff-actions" style="margin-top:8px; display:flex; flex-wrap:wrap; gap:6px;">' +
                (hasHidden
                    ? '<button type="button" class="marketplace-btn-unhide btn-secondary" style="padding:4px 10px; font-size:12px;" data-item-id="' + item.id + '">Unhide / Manage</button>'
                    : '<button type="button" class="marketplace-btn-hide btn-secondary" style="padding:4px 10px; font-size:12px;" data-item-id="' + item.id + '">Hide from students</button>') +
                '</div>';
        }
        var adminBtns = '';
        if (isAdmin) {
            adminBtns = '<div class="marketplace-item-admin-actions" style="margin-top:6px; display:flex; gap:6px;">' +
                '<button type="button" class="marketplace-btn-edit btn-secondary" style="padding:4px 10px; font-size:12px;" data-item-id="' + item.id + '">Edit</button>' +
                '<button type="button" class="marketplace-btn-delete btn-secondary" style="padding:4px 10px; font-size:12px; color:#dc2626;" data-item-id="' + item.id + '">Delete</button>' +
                '</div>';
        }
        return '<div class="marketplace-item-card" style="background:var(--bg-surface); border:1px solid var(--border); border-radius:var(--radius-lg); padding:14px; box-shadow:0 1px 4px rgba(0,0,0,0.06); cursor:pointer;" data-item-id="' + item.id + '">' +
            imgHtml +
            '<h4 style="margin:0 0 8px 0; font-size:1rem;">' + (item.name || '').replace(/</g, '&lt;') + '</h4>' +
            '<p style="color:#64748b; margin:0 0 12px 0; font-size:13px; line-height:1.4; max-height:2.8em; overflow:hidden;">' + (item.description || '').replace(/</g, '&lt;').substring(0, 80) + (item.description && item.description.length > 80 ? '…' : '') + '</p>' +
            '<div style="display:flex; justify-content:space-between; align-items:center;">' +
            '<span style="font-weight:700; color:var(--accent);">$' + Number(item.price).toFixed(2) + '</span>' + btnHtml +
            '</div>' + staffBtns + adminBtns + '</div>';
    }).join('');
    grid.querySelectorAll('.marketplace-item-card').forEach(function (card) {
        card.addEventListener('click', function (e) {
            if (e.target.closest('.marketplace-card-add-btn') || e.target.closest('.marketplace-btn-hide') || e.target.closest('.marketplace-btn-unhide') || e.target.closest('.marketplace-btn-edit') || e.target.closest('.marketplace-btn-delete')) return;
            var id = parseInt(card.getAttribute('data-item-id'), 10);
            openMarketplaceItemDetailModal(id);
        });
    });
    grid.querySelectorAll('.marketplace-card-add-btn').forEach(function (btn) {
        btn.addEventListener('click', function (e) { e.stopPropagation(); });
        btn.addEventListener('click', function () {
            var id = parseInt(btn.getAttribute('data-item-id'), 10);
            var name = btn.getAttribute('data-item-name') || '';
            var price = parseFloat(btn.getAttribute('data-item-price'), 10) || 0;
            addToMarketplaceCart(id, name, price, 1);
        });
    });
    grid.querySelectorAll('.marketplace-btn-hide').forEach(function (btn) {
        btn.addEventListener('click', function (e) { e.stopPropagation(); openMarketplaceHideModal(parseInt(btn.getAttribute('data-item-id'), 10)); });
    });
    grid.querySelectorAll('.marketplace-btn-unhide').forEach(function (btn) {
        btn.addEventListener('click', function (e) { e.stopPropagation(); openMarketplaceUnhideModal(parseInt(btn.getAttribute('data-item-id'), 10)); });
    });
    grid.querySelectorAll('.marketplace-btn-edit').forEach(function (btn) {
        btn.addEventListener('click', function (e) { e.stopPropagation(); openMarketplaceEditModal(parseInt(btn.getAttribute('data-item-id'), 10)); });
    });
    grid.querySelectorAll('.marketplace-btn-delete').forEach(function (btn) {
        btn.addEventListener('click', function (e) { e.stopPropagation(); confirmDeleteMarketplaceItem(parseInt(btn.getAttribute('data-item-id'), 10)); });
    });
}

function openMarketplaceItemDetailModal(itemId) {
    var item = marketplaceCatalog.find(function (x) { return x.id === itemId; });
    if (!item) return;
    var modal = document.getElementById('marketplace-item-detail-modal');
    var imgEl = document.getElementById('marketplace-item-detail-image');
    var imgWrap = document.querySelector('.marketplace-item-detail-image-wrap');
    var nameEl = document.getElementById('marketplace-item-detail-name');
    var metaEl = document.getElementById('marketplace-item-detail-meta');
    var descEl = document.getElementById('marketplace-item-detail-description');
    var priceEl = document.getElementById('marketplace-item-detail-price');
    var addBtn = document.getElementById('marketplace-item-detail-add-cart');
    if (!modal || !nameEl) return;
    nameEl.textContent = item.name || '';
    var metaParts = [];
    if (item.item_type_name) metaParts.push(item.item_type_name);
    if (item.category_name) metaParts.push(item.category_name);
    metaEl.textContent = metaParts.length ? metaParts.join(' · ') : '';
    metaEl.style.display = metaParts.length ? 'block' : 'none';
    descEl.textContent = item.description || 'No description.';
    descEl.style.display = (item.description || '').trim() ? 'block' : 'block';
    priceEl.textContent = '$' + Number(item.price).toFixed(2);
    var noImgEl = document.getElementById('marketplace-item-detail-no-image');
    if (imgEl && imgWrap) {
        if (item.image_url) {
            imgEl.src = getMarketplaceImageSrc(item.image_url);
            imgEl.referrerPolicy = 'no-referrer';
            imgEl.alt = item.name || '';
            imgEl.style.display = 'block';
            imgWrap.style.display = 'block';
            if (noImgEl) noImgEl.style.display = 'none';
            imgEl.onerror = function () {
                imgEl.style.display = 'none';
                if (noImgEl) { noImgEl.style.display = 'flex'; noImgEl.style.alignItems = 'center'; noImgEl.style.justifyContent = 'center'; }
            };
        } else {
            imgEl.style.display = 'none';
            if (noImgEl) { noImgEl.style.display = 'flex'; noImgEl.style.alignItems = 'center'; noImgEl.style.justifyContent = 'center'; }
            imgWrap.style.display = 'block';
        }
    }
    if (addBtn) {
        addBtn.style.display = (window.currentUser && window.currentUser.role === 'student') ? 'inline-block' : 'none';
        addBtn.onclick = function () {
            addToMarketplaceCart(item.id, item.name || '', item.price, 1);
            closeMarketplaceItemDetailModal();
        };
    }
    modal.setAttribute('data-marketplace-detail-item-id', String(itemId));
    modal.style.display = 'block';
}

function closeMarketplaceItemDetailModal() {
    var modal = document.getElementById('marketplace-item-detail-modal');
    if (modal) modal.style.display = 'none';
}

function bindMarketplaceItemDetailModal() {
    var modal = document.getElementById('marketplace-item-detail-modal');
    var closeBtn = document.getElementById('marketplace-item-detail-close');
    if (closeBtn) closeBtn.addEventListener('click', closeMarketplaceItemDetailModal);
    if (modal) {
        modal.addEventListener('click', function (e) {
            if (e.target === modal) closeMarketplaceItemDetailModal();
        });
    }
}

function loadMarketplaceTypesAndCategories() {
    fetch('/api/marketplace/types').then(function (r) { return r.ok ? r.json() : []; }).then(function (types) {
        var sel = document.getElementById('marketplace-filter-type');
        if (!sel) return;
        sel.innerHTML = '<option value="">All types</option>';
        types.forEach(function (t) {
            var o = document.createElement('option');
            o.value = t.id;
            o.textContent = t.name;
            sel.appendChild(o);
        });
    });
    fetch('/api/marketplace/categories').then(function (r) { return r.ok ? r.json() : []; }).then(function (cats) {
        var sel = document.getElementById('marketplace-filter-category');
        if (!sel) return;
        sel.innerHTML = '<option value="">All categories</option>';
        cats.forEach(function (c) {
            var o = document.createElement('option');
            o.value = c.id;
            o.textContent = c.name;
            sel.appendChild(o);
        });
    });
}

function loadMarketplacePOApprovals() {
    var list = document.getElementById('marketplace-po-approvals-list');
    if (!list) return;
    fetch('/api/purchase-orders')
        .then(function (r) { return r.ok ? r.json() : []; })
        .then(function (orders) {
            var pending = orders.filter(function (o) { return o.status === 'pending'; });
            if (!pending.length) {
                list.innerHTML = '<p style="margin:0; color:#94a3b8;">No pending purchase orders.</p>';
                return;
            }
            list.innerHTML = pending.map(function (o) {
                return '<div style="border:1px solid var(--border); border-radius:var(--radius-md); padding:12px; margin-bottom:10px; background:var(--bg-surface);">' +
                    '<div style="font-weight:600;">' + (o.item_name || '').replace(/</g, '&lt;') + ' — $' + Number(o.item_price).toFixed(2) + '</div>' +
                    '<div style="font-size:13px; color:#64748b;">Student: ' + (o.student_name || '').replace(/</g, '&lt;') + '</div>' +
                    '<div style="font-size:13px; color:#64748b;">' + (o.created_at ? new Date(o.created_at).toLocaleString() : '') + '</div>' +
                    '<div style="margin-top:10px; display:flex; gap:8px; align-items:center;">' +
                    '<button type="button" class="btn-primary" style="padding:6px 12px;" data-po-approve="' + o.id + '">Fulfill</button>' +
                    '<button type="button" class="btn-secondary" style="padding:6px 12px;" data-po-deny="' + o.id + '">Deny</button>' +
                    '<input type="text" placeholder="Reason (optional)" data-po-deny-reason="' + o.id + '" style="flex:1; padding:6px 10px; border:1px solid var(--border); border-radius:var(--radius-sm); font-size:13px;">' +
                    '</div></div>';
            }).join('');
            list.querySelectorAll('[data-po-approve]').forEach(function (btn) {
                btn.addEventListener('click', function () {
                    var id = parseInt(btn.getAttribute('data-po-approve'), 10);
                    marketplaceUpdatePOStatus(id, 'approved');
                });
            });
            list.querySelectorAll('[data-po-deny]').forEach(function (btn) {
                btn.addEventListener('click', function () {
                    var id = parseInt(btn.getAttribute('data-po-deny'), 10);
                    var reasonEl = document.querySelector('[data-po-deny-reason="' + id + '"]');
                    var reason = reasonEl && reasonEl.value ? reasonEl.value.trim() : '';
                    marketplaceUpdatePOStatus(id, 'denied', reason);
                });
            });
        })
        .catch(function () {
            list.innerHTML = '<p style="margin:0; color:#dc2626;">Failed to load orders.</p>';
        });
}

function marketplaceUpdatePOStatus(orderId, status, denialReason) {
    var body = { status: status };
    if (status === 'denied' && denialReason) body.denial_reason = denialReason;
    fetch('/api/purchase-orders/' + orderId + '/status', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    })
        .then(function (r) { return r.json().then(function (data) { return { ok: r.ok, data: data }; }); })
        .then(function (res) {
            if (res.ok) {
                showMessage(res.data.message || 'Updated', 'success');
                loadMarketplacePOApprovals();
                loadMarketplaceAnalytics();
            } else {
                showMessage(res.data.error || 'Error', 'error');
            }
        })
        .catch(function () {
            showMessage('Error updating order', 'error');
        });
}

var marketplaceAnalyticsCharts = { most: null, least: null, grade: null, color: null };
var marketplaceAnalyticsData = null;

function destroyMarketplaceAnalyticsCharts() {
    ['most', 'least', 'grade', 'color'].forEach(function (k) {
        if (marketplaceAnalyticsCharts[k]) {
            marketplaceAnalyticsCharts[k].destroy();
            marketplaceAnalyticsCharts[k] = null;
        }
    });
}

function renderMarketplaceAnalyticsCharts(data) {
    if (typeof Chart === 'undefined') return;
    destroyMarketplaceAnalyticsCharts();
    var palette = ['#2563EB', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#6366f1', '#14b8a6', '#f97316', '#ec4899', '#84cc16'];
    var hex = function (i) { return palette[i % palette.length]; };

    var mostEl = document.getElementById('marketplace-analytics-most-chart');
    var leastEl = document.getElementById('marketplace-analytics-least-chart');
    var mostEmpty = document.getElementById('marketplace-analytics-most-empty');
    var leastEmpty = document.getElementById('marketplace-analytics-least-empty');
    var mostWrap = document.getElementById('marketplace-analytics-most-wrap');
    var leastWrap = document.getElementById('marketplace-analytics-least-wrap');
    if (mostEmpty && mostWrap) {
        mostEmpty.style.display = data.most_purchased.length ? 'none' : 'block';
        mostWrap.style.display = data.most_purchased.length ? 'block' : 'none';
    }
    if (leastEmpty && leastWrap) {
        leastEmpty.style.display = data.least_purchased.length ? 'none' : 'block';
        leastWrap.style.display = data.least_purchased.length ? 'block' : 'none';
    }
    if (mostEl && data.most_purchased.length) {
        var mostCtx = mostEl.getContext('2d');
        marketplaceAnalyticsCharts.most = new Chart(mostCtx, {
            type: 'bar',
            data: {
                labels: data.most_purchased.map(function (x) { return x.item_name.length > 20 ? x.item_name.slice(0, 17) + '…' : x.item_name; }),
                datasets: [{ label: 'Purchases', data: data.most_purchased.map(function (x) { return x.purchase_count; }), backgroundColor: data.most_purchased.map(function (_, i) { return hex(i); }) }]
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: { x: { beginAtZero: true, ticks: { stepSize: 1 } } }
            }
        });
    }
    if (leastEl && data.least_purchased.length) {
        var leastCtx = leastEl.getContext('2d');
        marketplaceAnalyticsCharts.least = new Chart(leastCtx, {
            type: 'bar',
            data: {
                labels: data.least_purchased.map(function (x) { return x.item_name.length > 20 ? x.item_name.slice(0, 17) + '…' : x.item_name; }),
                datasets: [{ label: 'Purchases', data: data.least_purchased.map(function (x) { return x.purchase_count; }), backgroundColor: data.least_purchased.map(function (_, i) { return hex(i); }) }]
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: { x: { beginAtZero: true, ticks: { stepSize: 1 } } }
            }
        });
    }
}

function renderMarketplaceAnalyticsDemographics(itemId) {
    var placeholder = document.getElementById('marketplace-analytics-demographics-placeholder');
    var chartsWrap = document.getElementById('marketplace-analytics-demographics-charts');
    var gradeCanvas = document.getElementById('marketplace-analytics-grade-chart');
    var colorCanvas = document.getElementById('marketplace-analytics-color-chart');
    if (!placeholder || !chartsWrap || !gradeCanvas || !colorCanvas || !marketplaceAnalyticsData || typeof Chart === 'undefined') return;
    var demo = marketplaceAnalyticsData.demographics_by_item && (marketplaceAnalyticsData.demographics_by_item[itemId] || marketplaceAnalyticsData.demographics_by_item[String(itemId)]);
    if (!itemId || !demo) {
        placeholder.style.display = 'block';
        chartsWrap.style.display = 'none';
        if (marketplaceAnalyticsCharts.grade) { marketplaceAnalyticsCharts.grade.destroy(); marketplaceAnalyticsCharts.grade = null; }
        if (marketplaceAnalyticsCharts.color) { marketplaceAnalyticsCharts.color.destroy(); marketplaceAnalyticsCharts.color = null; }
        return;
    }
    var d = demo;
    var byGrade = d.by_grade || {};
    var byColor = d.by_card_color || {};
    var gradeLabels = Object.keys(byGrade).sort();
    var colorLabels = Object.keys(byColor).sort();
    var gradeDisplay = function (k) { return k === '(none)' ? 'No grade' : k; };
    var colorDisplay = function (k) { return k === 'none' ? 'No color' : (k.charAt(0).toUpperCase() + k.slice(1)); };
    var palette = ['#2563EB', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#6366f1', '#14b8a6', '#f97316', '#ec4899', '#84cc16'];
    var hex = function (i) { return palette[i % palette.length]; };
    placeholder.style.display = 'none';
    chartsWrap.style.display = 'grid';
    if (marketplaceAnalyticsCharts.grade) { marketplaceAnalyticsCharts.grade.destroy(); marketplaceAnalyticsCharts.grade = null; }
    if (marketplaceAnalyticsCharts.color) { marketplaceAnalyticsCharts.color.destroy(); marketplaceAnalyticsCharts.color = null; }
    if (gradeLabels.length) {
        var gCtx = gradeCanvas.getContext('2d');
        marketplaceAnalyticsCharts.grade = new Chart(gCtx, {
            type: 'bar',
            data: {
                labels: gradeLabels.map(gradeDisplay),
                datasets: [{ label: 'Purchases', data: gradeLabels.map(function (k) { return byGrade[k]; }), backgroundColor: gradeLabels.map(function (_, i) { return hex(i); }) }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } }
            }
        });
    }
    if (colorLabels.length) {
        var cCtx = colorCanvas.getContext('2d');
        marketplaceAnalyticsCharts.color = new Chart(cCtx, {
            type: 'doughnut',
            data: {
                labels: colorLabels.map(colorDisplay),
                datasets: [{ data: colorLabels.map(function (k) { return byColor[k]; }), backgroundColor: colorLabels.map(function (_, i) { return hex(i); }) }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { position: 'bottom' } }
            }
        });
    }
}

function loadMarketplaceAnalytics() {
    var section = document.getElementById('marketplace-analytics-section');
    var loadingEl = document.getElementById('marketplace-analytics-loading');
    var contentEl = document.getElementById('marketplace-analytics-content');
    var errorEl = document.getElementById('marketplace-analytics-error');
    var neverMsg = document.getElementById('marketplace-analytics-never-msg');
    var neverList = document.getElementById('marketplace-analytics-never-list');
    var itemSelect = document.getElementById('marketplace-analytics-item-select');
    if (!section || !loadingEl || !contentEl) return;
    loadingEl.style.display = 'block';
    contentEl.style.display = 'none';
    if (errorEl) { errorEl.style.display = 'none'; errorEl.textContent = ''; }
    fetch('/api/marketplace/analytics')
        .then(function (r) {
            if (!r.ok) return Promise.reject(new Error('Analytics not available'));
            return r.json();
        })
        .then(function (data) {
            marketplaceAnalyticsData = data;
            loadingEl.style.display = 'none';
            if (errorEl) errorEl.style.display = 'none';
            contentEl.style.display = 'block';
            renderMarketplaceAnalyticsCharts(data);
            if (neverMsg) neverMsg.textContent = data.never_purchased.length ? 'Active items with no purchases (approved/fulfilled):' : 'No active items have zero purchases.';
            if (neverList) {
                neverList.innerHTML = data.never_purchased.map(function (x) {
                    return '<li style="margin-bottom:4px;">' + (x.item_name || '').replace(/</g, '&lt;') + '</li>';
                }).join('');
            }
            if (itemSelect) {
                var idx = data.item_index || {};
                var opts = '<option value="">— Select item —</option>';
                var ids = Object.keys(data.demographics_by_item || {}).map(Number).sort(function (a, b) {
                    var na = idx[a] || idx[String(a)] || '';
                    var nb = idx[b] || idx[String(b)] || '';
                    return na.localeCompare(nb);
                });
                ids.forEach(function (id) {
                    var name = idx[id] || idx[String(id)] || 'Item #' + id;
                    opts += '<option value="' + id + '">' + (name || '').replace(/</g, '&lt;') + '</option>';
                });
                itemSelect.innerHTML = opts;
                itemSelect.value = '';
            }
            renderMarketplaceAnalyticsDemographics(null);
        })
        .catch(function () {
            loadingEl.style.display = 'none';
            contentEl.style.display = 'none';
            if (errorEl) {
                errorEl.textContent = 'Could not load analytics.';
                errorEl.style.display = 'block';
            }
        });
}

// Selected case managers (and optionally School-wide) for the Add marketplace item modal.
// Each item: { id: number|'school_wide', name: string }
var marketplaceAddItemCaseManagerOptions = [];
var marketplaceAddItemSelected = [];
var marketplaceAddItemCaseManagerBound = false;

function renderMarketplaceAddItemCaseManagerChips() {
    var container = document.getElementById('marketplace-add-item-case-manager-chips');
    if (!container) return;
    container.innerHTML = '';
    marketplaceAddItemSelected.forEach(function (item) {
        var chip = document.createElement('span');
        chip.className = 'marketplace-case-manager-chip';
        chip.setAttribute('data-id', item.id === 'school_wide' ? 'school_wide' : String(item.id));
        chip.innerHTML = '<span class="marketplace-case-manager-chip-label">' + (item.name || '').replace(/</g, '&lt;') + '</span><span class="marketplace-case-manager-chip-remove" aria-label="Remove">×</span>';
        chip.addEventListener('click', function () {
            marketplaceAddItemSelected = marketplaceAddItemSelected.filter(function (s) { return s.id !== item.id; });
            renderMarketplaceAddItemCaseManagerChips();
            renderMarketplaceAddItemCaseManagerDropdown();
        });
        container.appendChild(chip);
    });
}

function renderMarketplaceAddItemCaseManagerDropdown() {
    var input = document.getElementById('marketplace-add-item-case-manager-input');
    var dropdown = document.getElementById('marketplace-add-item-case-manager-dropdown');
    if (!input || !dropdown) return;
    var q = (input.value || '').trim().toLowerCase();
    var frag = document.createDocumentFragment();
    marketplaceAddItemCaseManagerOptions.forEach(function (opt) {
        var label = (opt.name || '').trim();
        if (q && label.toLowerCase().indexOf(q) === -1) return;
        var isSelected = marketplaceAddItemSelected.some(function (s) {
            return s.id === opt.id || (opt.id === 'school_wide' && s.id === 'school_wide');
        });
        var div = document.createElement('div');
        div.className = 'marketplace-combobox-option' + (isSelected ? ' is-selected' : '');
        div.setAttribute('role', 'option');
        div.setAttribute('data-id', opt.id === 'school_wide' ? 'school_wide' : String(opt.id));
        div.setAttribute('data-name', label);
        div.textContent = label;
        frag.appendChild(div);
    });
    dropdown.innerHTML = '';
    dropdown.appendChild(frag);
    if (frag.childNodes.length > 0) {
        dropdown.classList.add('is-open');
    } else {
        dropdown.classList.remove('is-open');
    }
}

function openMarketplaceAddItemModal() {
    var modal = document.getElementById('marketplace-add-item-modal');
    var errEl = document.getElementById('marketplace-add-item-error');
    var nameIn = document.getElementById('marketplace-add-item-name');
    var descIn = document.getElementById('marketplace-add-item-description');
    var priceIn = document.getElementById('marketplace-add-item-price');
    var caseManagerInput = document.getElementById('marketplace-add-item-case-manager-input');
    var caseManagerDropdown = document.getElementById('marketplace-add-item-case-manager-dropdown');
    var typeInput = document.getElementById('marketplace-add-item-type-input');
    var typeIdHidden = document.getElementById('marketplace-add-item-type-id');
    var typeDropdown = document.getElementById('marketplace-add-item-type-dropdown');
    var catInput = document.getElementById('marketplace-add-item-category-input');
    var catIdHidden = document.getElementById('marketplace-add-item-category-id');
    var catDropdown = document.getElementById('marketplace-add-item-category-dropdown');
    var imgIn = document.getElementById('marketplace-add-item-image-url');
    if (!modal || !nameIn || !priceIn) return;
    if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }
    nameIn.value = '';
    if (descIn) descIn.value = '';
    priceIn.value = '';
    marketplaceAddItemSelected = [];
    if (caseManagerInput) caseManagerInput.value = '';
    if (typeInput) typeInput.value = '';
    if (typeIdHidden) typeIdHidden.value = '';
    if (catInput) catInput.value = '';
    if (catIdHidden) catIdHidden.value = '';
    if (imgIn) imgIn.value = '';
    var isAdmin = window.currentUser && window.currentUser.role === 'admin';
    // Build options: School-wide (admin only) then case managers
    fetch('/api/marketplace/case-managers').then(function (r) { return r.ok ? r.json() : []; }).then(function (list) {
        marketplaceAddItemCaseManagerOptions = [];
        if (isAdmin) {
            marketplaceAddItemCaseManagerOptions.push({ id: 'school_wide', name: 'School-wide' });
        }
        (list || []).forEach(function (cm) {
            marketplaceAddItemCaseManagerOptions.push({
                id: cm.id,
                name: (cm.name || cm.username || 'User #' + cm.id).trim()
            });
        });
        renderMarketplaceAddItemCaseManagerChips();
        renderMarketplaceAddItemCaseManagerDropdown();
        var me = window.currentUser && window.currentUser.id;
        if (me && list.some(function (cm) { return cm.id === me; })) {
            var meOpt = marketplaceAddItemCaseManagerOptions.find(function (o) { return o.id === me; });
            if (meOpt) {
                marketplaceAddItemSelected.push(meOpt);
                renderMarketplaceAddItemCaseManagerChips();
                renderMarketplaceAddItemCaseManagerDropdown();
            }
        }
    }).catch(function () {});
    if (!marketplaceAddItemCaseManagerBound && caseManagerInput && caseManagerDropdown) {
        marketplaceAddItemCaseManagerBound = true;
        var caseManagerCloseTimer = null;
        caseManagerInput.addEventListener('focus', function () { renderMarketplaceAddItemCaseManagerDropdown(); });
        caseManagerInput.addEventListener('input', function () { renderMarketplaceAddItemCaseManagerDropdown(); });
        caseManagerInput.addEventListener('blur', function () {
            caseManagerCloseTimer = setTimeout(function () { caseManagerDropdown.classList.remove('is-open'); }, 150);
        });
        caseManagerInput.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') caseManagerDropdown.classList.remove('is-open');
        });
        caseManagerDropdown.addEventListener('mousedown', function (e) { e.preventDefault(); });
        caseManagerDropdown.addEventListener('click', function (e) {
            var opt = e.target && e.target.closest && e.target.closest('.marketplace-combobox-option');
            if (!opt) return;
            if (caseManagerCloseTimer) { clearTimeout(caseManagerCloseTimer); caseManagerCloseTimer = null; }
            var id = opt.getAttribute('data-id');
            var name = opt.getAttribute('data-name') || opt.textContent;
            if (id === 'school_wide') {
                var idx = marketplaceAddItemSelected.findIndex(function (s) { return s.id === 'school_wide'; });
                if (idx >= 0) {
                    marketplaceAddItemSelected.splice(idx, 1);
                } else {
                    marketplaceAddItemSelected.push({ id: 'school_wide', name: name });
                }
            } else {
                var numId = parseInt(id, 10);
                var idx = marketplaceAddItemSelected.findIndex(function (s) { return s.id === numId; });
                if (idx >= 0) {
                    marketplaceAddItemSelected.splice(idx, 1);
                } else {
                    marketplaceAddItemSelected.push({ id: numId, name: name });
                }
            }
            renderMarketplaceAddItemCaseManagerChips();
            renderMarketplaceAddItemCaseManagerDropdown();
        });
    }
    var typesList = [];
    var catsList = [];
    function renderTypeDropdown() {
        if (!typeDropdown || !typeInput) return;
        var q = (typeInput.value || '').trim().toLowerCase();
        var frag = document.createDocumentFragment();
        typesList.forEach(function (t) {
            if (q && t.name.toLowerCase().indexOf(q) === -1) return;
            var div = document.createElement('div');
            div.className = 'marketplace-combobox-option';
            div.setAttribute('role', 'option');
            div.setAttribute('data-id', t.id);
            div.textContent = t.name;
            frag.appendChild(div);
        });
        if (q && !typesList.some(function (t) { return t.name.toLowerCase() === q; })) {
            var addDiv = document.createElement('div');
            addDiv.className = 'marketplace-combobox-option add-new';
            addDiv.setAttribute('role', 'option');
            addDiv.setAttribute('data-add', q);
            addDiv.textContent = 'Add "' + q + '"';
            frag.appendChild(addDiv);
        }
        typeDropdown.innerHTML = '';
        typeDropdown.appendChild(frag);
        typeDropdown.classList.toggle('is-open', frag.childNodes.length > 0 && typeInput === document.activeElement);
    }
    function renderCatDropdown() {
        if (!catDropdown || !catInput) return;
        var q = (catInput.value || '').trim().toLowerCase();
        var frag = document.createDocumentFragment();
        catsList.forEach(function (c) {
            if (q && c.name.toLowerCase().indexOf(q) === -1) return;
            var div = document.createElement('div');
            div.className = 'marketplace-combobox-option';
            div.setAttribute('role', 'option');
            div.setAttribute('data-id', c.id);
            div.textContent = c.name;
            frag.appendChild(div);
        });
        if (q && !catsList.some(function (c) { return c.name.toLowerCase() === q; })) {
            var addDiv = document.createElement('div');
            addDiv.className = 'marketplace-combobox-option add-new';
            addDiv.setAttribute('role', 'option');
            addDiv.setAttribute('data-add', q);
            addDiv.textContent = 'Add "' + q + '"';
            frag.appendChild(addDiv);
        }
        catDropdown.innerHTML = '';
        catDropdown.appendChild(frag);
        catDropdown.classList.toggle('is-open', frag.childNodes.length > 0 && catInput === document.activeElement);
    }
    function setupTypeCombobox() {
        if (!typeInput || !typeIdHidden || !typeDropdown) return;
        var typeCloseTimer = null;
        typeInput.addEventListener('focus', function () { renderTypeDropdown(); });
        typeInput.addEventListener('input', function () {
            var sel = typesList.find(function (t) { return String(t.id) === (typeIdHidden && typeIdHidden.value); });
            if (sel && typeInput.value !== sel.name) { if (typeIdHidden) typeIdHidden.value = ''; }
            renderTypeDropdown();
        });
        typeInput.addEventListener('blur', function () {
            typeCloseTimer = setTimeout(function () { typeDropdown.classList.remove('is-open'); }, 150);
        });
        typeInput.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') { typeDropdown.classList.remove('is-open'); }
        });
        typeDropdown.addEventListener('mousedown', function (e) { e.preventDefault(); });
        typeDropdown.addEventListener('click', function (e) {
            var opt = e.target && e.target.closest && e.target.closest('.marketplace-combobox-option');
            if (!opt) return;
            if (typeCloseTimer) { clearTimeout(typeCloseTimer); typeCloseTimer = null; }
            var id = opt.getAttribute('data-id');
            var addName = opt.getAttribute('data-add');
            if (id) {
                typeIdHidden.value = id;
                typeInput.value = opt.textContent;
                typeDropdown.classList.remove('is-open');
            } else if (addName) {
                fetch('/api/marketplace/types', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: addName })
                }).then(function (r) { return r.json().then(function (data) { return { ok: r.ok, data: data }; }); }).then(function (res) {
                    if (res.ok && res.data && res.data.id) {
                        typesList.push({ id: res.data.id, name: res.data.name });
                        typeIdHidden.value = String(res.data.id);
                        typeInput.value = res.data.name;
                        typeDropdown.classList.remove('is-open');
                    } else {
                        showMessage(res.data && res.data.error ? res.data.error : 'Could not add type.', 'error');
                    }
                }).catch(function () { showMessage('Could not add type.', 'error'); });
            }
        });
    }
    function setupCatCombobox() {
        if (!catInput || !catIdHidden || !catDropdown) return;
        var catCloseTimer = null;
        catInput.addEventListener('focus', function () { renderCatDropdown(); });
        catInput.addEventListener('input', function () {
            var sel = catsList.find(function (c) { return String(c.id) === (catIdHidden && catIdHidden.value); });
            if (sel && catInput.value !== sel.name) { if (catIdHidden) catIdHidden.value = ''; }
            renderCatDropdown();
        });
        catInput.addEventListener('blur', function () {
            catCloseTimer = setTimeout(function () { catDropdown.classList.remove('is-open'); }, 150);
        });
        catInput.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') { catDropdown.classList.remove('is-open'); }
        });
        catDropdown.addEventListener('mousedown', function (e) { e.preventDefault(); });
        catDropdown.addEventListener('click', function (e) {
            var opt = e.target && e.target.closest && e.target.closest('.marketplace-combobox-option');
            if (!opt) return;
            if (catCloseTimer) { clearTimeout(catCloseTimer); catCloseTimer = null; }
            var id = opt.getAttribute('data-id');
            var addName = opt.getAttribute('data-add');
            if (id) {
                catIdHidden.value = id;
                catInput.value = opt.textContent;
                catDropdown.classList.remove('is-open');
            } else if (addName) {
                fetch('/api/marketplace/categories', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: addName })
                }).then(function (r) { return r.json().then(function (data) { return { ok: r.ok, data: data }; }); }).then(function (res) {
                    if (res.ok && res.data && res.data.id) {
                        catsList.push({ id: res.data.id, name: res.data.name });
                        catIdHidden.value = String(res.data.id);
                        catInput.value = res.data.name;
                        catDropdown.classList.remove('is-open');
                    } else {
                        showMessage(res.data && res.data.error ? res.data.error : 'Could not add category.', 'error');
                    }
                }).catch(function () { showMessage('Could not add category.', 'error'); });
            }
        });
    }
    setupTypeCombobox();
    setupCatCombobox();
    fetch('/api/marketplace/types').then(function (r) { return r.ok ? r.json() : []; }).then(function (types) {
        typesList = types;
        renderTypeDropdown();
    });
    fetch('/api/marketplace/categories').then(function (r) { return r.ok ? r.json() : []; }).then(function (cats) {
        catsList = cats;
        renderCatDropdown();
    });
    modal.style.display = 'block';
}

function closeMarketplaceAddItemModal() {
    var modal = document.getElementById('marketplace-add-item-modal');
    if (modal) modal.style.display = 'none';
    var popover = document.getElementById('marketplace-add-item-image-url-info');
    if (popover) popover.classList.remove('is-visible');
}

function submitMarketplaceAddItem() {
    var nameIn = document.getElementById('marketplace-add-item-name');
    var descIn = document.getElementById('marketplace-add-item-description');
    var priceIn = document.getElementById('marketplace-add-item-price');
    var typeIdHidden = document.getElementById('marketplace-add-item-type-id');
    var catIdHidden = document.getElementById('marketplace-add-item-category-id');
    var imgIn = document.getElementById('marketplace-add-item-image-url');
    var errEl = document.getElementById('marketplace-add-item-error');
    var name = nameIn && nameIn.value ? nameIn.value.trim() : '';
    var price = priceIn && priceIn.value ? parseFloat(priceIn.value, 10) : NaN;
    if (!name) {
        if (errEl) { errEl.textContent = 'Name is required.'; errEl.style.display = 'block'; }
        return;
    }
    if (!price || isNaN(price) || price <= 0) {
        if (errEl) { errEl.textContent = 'Please enter a valid price.'; errEl.style.display = 'block'; }
        return;
    }
    var hasSchoolWide = marketplaceAddItemSelected.some(function (s) { return s.id === 'school_wide'; });
    var caseManagerIds = marketplaceAddItemSelected.filter(function (s) { return s.id !== 'school_wide'; }).map(function (s) { return s.id; });
    if (!hasSchoolWide && caseManagerIds.length === 0) {
        if (errEl) { errEl.textContent = 'Select at least one Case Manager or School-wide (admins only).'; errEl.style.display = 'block'; }
        return;
    }
    var rawType = typeIdHidden && typeIdHidden.value ? typeIdHidden.value.trim() : '';
    var rawCat = catIdHidden && catIdHidden.value ? catIdHidden.value.trim() : '';
    var typeId = rawType ? parseInt(rawType, 10) : null;
    var catId = rawCat ? parseInt(rawCat, 10) : null;
    var payload = {
        name: name,
        description: (descIn && descIn.value) ? descIn.value.trim() : '',
        price: price,
        case_manager_ids: caseManagerIds,
        is_school_wide: hasSchoolWide,
        item_type_id: typeId,
        category_id: catId,
        image_url: (imgIn && imgIn.value) ? imgIn.value.trim() : null
    };
    if (!payload.item_type_id) delete payload.item_type_id;
    if (!payload.category_id) delete payload.category_id;
    if (!payload.image_url) delete payload.image_url;
    if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }
    fetch('/api/marketplace-items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    })
        .then(function (r) {
            return r.text().then(function (text) {
                var data = null;
                try { data = text ? JSON.parse(text) : {}; } catch (_) { }
                return { ok: r.ok, status: r.status, data: data, text: text };
            });
        })
        .then(function (res) {
            if (res.ok) {
                closeMarketplaceAddItemModal();
                showMessage('Item added.', 'success');
                if (getMarketplaceStudentId()) loadMarketplaceCatalog();
            } else {
                var msg = (res.data && res.data.error) ? res.data.error : (res.status === 500 ? 'Server error. Please try again or contact support.' : 'Failed to add item.');
                if (errEl) { errEl.textContent = msg; errEl.style.display = 'block'; }
            }
        })
        .catch(function (e) {
            if (errEl) { errEl.textContent = 'Network or server error. Please try again.'; errEl.style.display = 'block'; }
        });
}

var marketplaceHideModalItemId = null;
function openMarketplaceHideModal(itemId) {
    marketplaceHideModalItemId = itemId;
    var item = marketplaceCatalog.find(function (x) { return x.id === itemId; });
    var modal = document.getElementById('marketplace-hide-modal');
    var nameEl = document.getElementById('marketplace-hide-item-name');
    if (nameEl) nameEl.textContent = item ? item.name : '';
    document.querySelectorAll('input[name="marketplace-hide-type"]').forEach(function (r) { r.checked = false; });
    document.getElementById('marketplace-hide-value-student').style.display = 'none';
    document.getElementById('marketplace-hide-value-color').style.display = 'none';
    document.getElementById('marketplace-hide-value-grade').style.display = 'none';
    document.getElementById('marketplace-hide-student-id').value = '';
    document.getElementById('marketplace-hide-student-search').value = '';
    document.getElementById('marketplace-hide-card-color').value = '';
    document.getElementById('marketplace-hide-grade').value = '';
    var errEl = document.getElementById('marketplace-hide-error');
    if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }
    if (modal) modal.style.display = 'block';
}
function closeMarketplaceHideModal() {
    marketplaceHideModalItemId = null;
    var modal = document.getElementById('marketplace-hide-modal');
    if (modal) modal.style.display = 'none';
}
function submitMarketplaceHide() {
    var itemId = marketplaceHideModalItemId;
    if (!itemId) return;
    var typeRadios = document.querySelectorAll('input[name="marketplace-hide-type"]');
    var type = null;
    typeRadios.forEach(function (r) { if (r.checked) type = r.value; });
    var value = '';
    if (type === 'student') {
        value = document.getElementById('marketplace-hide-student-id').value.trim();
        if (!value) { document.getElementById('marketplace-hide-error').textContent = 'Select a student.'; document.getElementById('marketplace-hide-error').style.display = 'block'; return; }
    } else if (type === 'card_color') {
        value = document.getElementById('marketplace-hide-card-color').value.trim();
        if (!value) { document.getElementById('marketplace-hide-error').textContent = 'Select a card color.'; document.getElementById('marketplace-hide-error').style.display = 'block'; return; }
    } else if (type === 'grade_section') {
        value = document.getElementById('marketplace-hide-grade').value.trim();
        if (!value) { document.getElementById('marketplace-hide-error').textContent = 'Select a grade section.'; document.getElementById('marketplace-hide-error').style.display = 'block'; return; }
    } else {
        document.getElementById('marketplace-hide-error').textContent = 'Choose one: specific student, card color, or grade.'; document.getElementById('marketplace-hide-error').style.display = 'block'; return;
    }
    var errEl = document.getElementById('marketplace-hide-error');
    errEl.style.display = 'none';
    fetch('/api/marketplace-items/' + itemId + '/hidden-rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hidden_type: type, value: value })
    })
        .then(function (r) { return r.json().then(function (data) { return { ok: r.ok, data: data }; }); })
        .then(function (res) {
            if (res.ok || (res.data && res.data.id)) {
                closeMarketplaceHideModal();
                loadMarketplaceCatalog();
            } else {
                errEl.textContent = (res.data && res.data.error) || 'Failed to add rule.'; errEl.style.display = 'block';
            }
        })
        .catch(function () { errEl.textContent = 'Failed to add rule.'; errEl.style.display = 'block'; });
}

var marketplaceUnhideModalItemId = null;
function openMarketplaceUnhideModal(itemId) {
    marketplaceUnhideModalItemId = itemId;
    var item = marketplaceCatalog.find(function (x) { return x.id === itemId; });
    var modal = document.getElementById('marketplace-unhide-modal');
    var nameEl = document.getElementById('marketplace-unhide-item-name');
    if (nameEl) nameEl.textContent = item ? item.name : '';
    var listEl = document.getElementById('marketplace-unhide-rules-list');
    if (!listEl) { if (modal) modal.style.display = 'block'; return; }
    listEl.innerHTML = '';
    var rules = (item && item.hidden_rules) ? item.hidden_rules : [];
    if (!rules.length) {
        listEl.innerHTML = '<li style="color:#94a3b8;">No visibility rules.</li>';
    } else {
        rules.forEach(function (r) {
            var label = r.hidden_type === 'student' ? 'Student ' + r.value : r.hidden_type === 'card_color' ? 'Card color: ' + r.value : 'Grade section: ' + r.value;
            var li = document.createElement('li');
            li.style.cssText = 'display:flex; justify-content:space-between; align-items:center; padding:8px 0; border-bottom:1px solid #f1f5f9;';
            li.innerHTML = '<span>' + String(label).replace(/</g, '&lt;') + '</span><button type="button" class="marketplace-unhide-remove-rule btn-secondary" style="padding:4px 10px; font-size:12px;" data-rule-id="' + r.id + '">Remove</button>';
            listEl.appendChild(li);
            li.querySelector('.marketplace-unhide-remove-rule').addEventListener('click', function () { removeMarketplaceHiddenRule(itemId, r.id); });
        });
    }
    if (modal) modal.style.display = 'block';
}
function closeMarketplaceUnhideModal() {
    marketplaceUnhideModalItemId = null;
    var modal = document.getElementById('marketplace-unhide-modal');
    if (modal) modal.style.display = 'none';
}
function removeMarketplaceHiddenRule(itemId, ruleId) {
    fetch('/api/marketplace-items/' + itemId + '/hidden-rules/' + ruleId, { method: 'DELETE' })
        .then(function (r) {
            if (r.ok) {
                loadMarketplaceCatalog();
                fetch('/api/marketplace-items/' + itemId + '/hidden-rules')
                    .then(function (res) { return res.ok ? res.json() : []; })
                    .then(function (rules) {
                        var item = marketplaceCatalog.find(function (x) { return x.id === itemId; });
                        if (item) item.hidden_rules = rules;
                        var listEl = document.getElementById('marketplace-unhide-rules-list');
                        if (!listEl) return;
                        listEl.innerHTML = '';
                        if (!rules.length) {
                            listEl.innerHTML = '<li style="color:#94a3b8;">No visibility rules.</li>';
                            closeMarketplaceUnhideModal();
                        } else {
                            rules.forEach(function (r) {
                                var label = r.hidden_type === 'student' ? 'Student ' + r.value : r.hidden_type === 'card_color' ? 'Card color: ' + r.value : 'Grade section: ' + r.value;
                                var li = document.createElement('li');
                                li.style.cssText = 'display:flex; justify-content:space-between; align-items:center; padding:8px 0; border-bottom:1px solid #f1f5f9;';
                                li.innerHTML = '<span>' + String(label).replace(/</g, '&lt;') + '</span><button type="button" class="marketplace-unhide-remove-rule btn-secondary" style="padding:4px 10px; font-size:12px;" data-rule-id="' + r.id + '">Remove</button>';
                                listEl.appendChild(li);
                                li.querySelector('.marketplace-unhide-remove-rule').addEventListener('click', function () { removeMarketplaceHiddenRule(itemId, r.id); });
                            });
                        }
                    });
            }
        });
}
function refreshMarketplaceUnhideModalList() {
    if (marketplaceUnhideModalItemId == null) return;
    fetch('/api/marketplace-items/' + marketplaceUnhideModalItemId + '/hidden-rules')
        .then(function (r) { return r.ok ? r.json() : []; })
        .then(function (rules) {
            var item = marketplaceCatalog.find(function (x) { return x.id === marketplaceUnhideModalItemId; });
            if (item) item.hidden_rules = rules;
            var listEl = document.getElementById('marketplace-unhide-rules-list');
            if (!listEl) return;
            listEl.innerHTML = '';
            if (!rules.length) {
                listEl.innerHTML = '<li style="color:#94a3b8;">No visibility rules.</li>';
                closeMarketplaceUnhideModal();
            } else {
                rules.forEach(function (r) {
                    var label = r.hidden_type === 'student' ? 'Student ' + r.value : r.hidden_type === 'card_color' ? 'Card color: ' + r.value : 'Grade section: ' + r.value;
                    var li = document.createElement('li');
                    li.style.cssText = 'display:flex; justify-content:space-between; align-items:center; padding:8px 0; border-bottom:1px solid #f1f5f9;';
                    li.innerHTML = '<span>' + String(label).replace(/</g, '&lt;') + '</span><button type="button" class="marketplace-unhide-remove-rule btn-secondary" style="padding:4px 10px; font-size:12px;" data-rule-id="' + r.id + '">Remove</button>';
                    listEl.appendChild(li);
                    li.querySelector('.marketplace-unhide-remove-rule').addEventListener('click', function () { removeMarketplaceHiddenRule(marketplaceUnhideModalItemId, r.id); });
                });
            }
        });
}

var marketplaceEditModalItemId = null;
function openMarketplaceEditModal(itemId) {
    marketplaceEditModalItemId = itemId;
    var item = marketplaceCatalog.find(function (x) { return x.id === itemId; });
    if (!item) return;
    var modal = document.getElementById('marketplace-edit-item-modal');
    document.getElementById('marketplace-edit-item-name').value = item.name || '';
    document.getElementById('marketplace-edit-item-description').value = item.description || '';
    document.getElementById('marketplace-edit-item-price').value = item.price != null ? item.price : '';
    document.getElementById('marketplace-edit-item-grade-range').value = item.grade_range || '9_12';
    document.getElementById('marketplace-edit-item-image-url').value = item.image_url || '';
    document.getElementById('marketplace-edit-item-error').style.display = 'none';
    var typeSel = document.getElementById('marketplace-edit-item-type');
    var catSel = document.getElementById('marketplace-edit-item-category');
    if (typeSel && catSel) {
        Promise.all([
            fetch('/api/marketplace/types').then(function (r) { return r.ok ? r.json() : []; }),
            fetch('/api/marketplace/categories').then(function (r) { return r.ok ? r.json() : []; })
        ]).then(function (arr) {
            var types = arr[0] || [];
            var cats = arr[1] || [];
            typeSel.innerHTML = '<option value="">— None —</option>' + types.map(function (t) { return '<option value="' + t.id + '">' + (t.name || '').replace(/</g, '&lt;') + '</option>'; }).join('');
            catSel.innerHTML = '<option value="">— None —</option>' + cats.map(function (c) { return '<option value="' + c.id + '">' + (c.name || '').replace(/</g, '&lt;') + '</option>'; }).join('');
            typeSel.value = item.item_type_id || '';
            catSel.value = item.category_id || '';
        });
    }
    if (modal) modal.style.display = 'block';
}
function closeMarketplaceEditModal() {
    marketplaceEditModalItemId = null;
    var modal = document.getElementById('marketplace-edit-item-modal');
    if (modal) modal.style.display = 'none';
}
function submitMarketplaceEditItem() {
    var itemId = marketplaceEditModalItemId;
    if (!itemId) return;
    var nameIn = document.getElementById('marketplace-edit-item-name');
    var descIn = document.getElementById('marketplace-edit-item-description');
    var priceIn = document.getElementById('marketplace-edit-item-price');
    var gradeSel = document.getElementById('marketplace-edit-item-grade-range');
    var typeSel = document.getElementById('marketplace-edit-item-type');
    var catSel = document.getElementById('marketplace-edit-item-category');
    var imgIn = document.getElementById('marketplace-edit-item-image-url');
    var errEl = document.getElementById('marketplace-edit-item-error');
    var name = nameIn && nameIn.value ? nameIn.value.trim() : '';
    var price = priceIn && priceIn.value ? parseFloat(priceIn.value, 10) : NaN;
    if (!name) { errEl.textContent = 'Name is required.'; errEl.style.display = 'block'; return; }
    if (!price || isNaN(price) || price <= 0) { errEl.textContent = 'Please enter a valid price.'; errEl.style.display = 'block'; return; }
    var payload = {
        name: name,
        description: (descIn && descIn.value) ? descIn.value.trim() : '',
        price: price,
        grade_range: (gradeSel && gradeSel.value) ? gradeSel.value : '9_12',
        item_type_id: (typeSel && typeSel.value) ? parseInt(typeSel.value, 10) : null,
        category_id: (catSel && catSel.value) ? parseInt(catSel.value, 10) : null,
        image_url: (imgIn && imgIn.value) ? imgIn.value.trim() : null
    };
    errEl.style.display = 'none';
    fetch('/api/marketplace-items/' + itemId, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    })
        .then(function (r) { return r.json().then(function (data) { return { ok: r.ok, data: data }; }); })
        .then(function (res) {
            if (res.ok) {
                closeMarketplaceEditModal();
                var idx = marketplaceCatalog.findIndex(function (x) { return x.id === itemId; });
                if (idx >= 0 && res.data) marketplaceCatalog[idx] = Object.assign({}, marketplaceCatalog[idx], res.data);
                loadMarketplaceCatalog();
            } else {
                errEl.textContent = (res.data && res.data.error) || 'Failed to update.'; errEl.style.display = 'block';
            }
        })
        .catch(function () { errEl.textContent = 'Failed to update.'; errEl.style.display = 'block'; });
}
function confirmDeleteMarketplaceItem(itemId) {
    var item = marketplaceCatalog.find(function (x) { return x.id === itemId; });
    if (!item) return;
    var delMsg = "Delete item \"" + (item.name || "").replace(/"/g, "") + "\"? This will deactivate the item.";
    if (!confirm(delMsg)) return;
    fetch('/api/marketplace-items/' + itemId, { method: 'DELETE' })
        .then(function (r) {
            if (r.ok) {
                loadMarketplaceCatalog();
            } else {
                r.json().then(function (data) { alert((data && data.error) || 'Delete failed.'); });
            }
        })
        .catch(function () { alert('Delete failed.'); });
}

function setupMarketplaceStudentSearch() {
    var searchInput = document.getElementById('marketplace-student-search-input');
    var dropdown = document.querySelector('.marketplace-student-autocomplete-dropdown');
    var managedByMe = document.getElementById('marketplace-managed-by-me-checkbox');
    if (!searchInput || !dropdown) return;
    var list = [];
    function showDropdown(items) {
        dropdown.innerHTML = '';
        dropdown.style.display = 'block';
        items.slice(0, 15).forEach(function (s) {
            var div = document.createElement('div');
            div.className = 'bank-search-autocomplete-item';
            div.style.cssText = 'padding:10px 12px; cursor:pointer; font-size:14px;';
            div.textContent = s.student_name + ' ($' + (s.balance != null ? Number(s.balance).toFixed(2) : '0.00') + ')';
            div.addEventListener('mousedown', function (e) {
                e.preventDefault();
                selectMarketplaceStudent(s.student_id);
                searchInput.value = div.textContent;
                dropdown.style.display = 'none';
                // When a marketplace student search is committed, clear "managed by me" so it does not persist across searches.
                if (managedByMe && managedByMe.checked) {
                    managedByMe.checked = false;
                }
            });
            dropdown.appendChild(div);
        });
    }
    function loadList() {
        var params = new URLSearchParams();
        if (managedByMe && managedByMe.checked) params.set('managed_by_me', 'true');
        var q = searchInput.value.trim();
        if (q) params.set('q', q);
        fetch('/api/bank-account/search?' + params.toString()).then(function (r) { return r.ok ? r.json() : []; }).then(function (data) {
            list = data;
            showDropdown(list);
        });
    }
    searchInput.addEventListener('input', loadList);
    searchInput.addEventListener('focus', function () { if (list.length) showDropdown(list); else loadList(); });
    document.addEventListener('click', function (e) { if (!searchInput.contains(e.target) && !dropdown.contains(e.target)) dropdown.style.display = 'none'; });
    if (managedByMe) managedByMe.addEventListener('change', loadList);
}

// Bank Account student search (mirror marketplace behavior)
function setupBankStudentSearch() {
    var searchInput = document.getElementById('bank-student-search-input');
    var wrapper = searchInput && searchInput.closest('.bank-search-autocomplete-wrapper');
    var dropdown = wrapper && wrapper.querySelector('.bank-search-autocomplete-dropdown');
    var managedByMe = document.getElementById('bank-managed-by-me-checkbox');
    var noMsg = document.getElementById('bank-no-student-msg');
    if (!searchInput || !dropdown || searchInput._bankSimpleAutocompleteBound) return;
    searchInput._bankSimpleAutocompleteBound = true;

    var list = [];

    function setSectionsVisible(visible) {
        var display = visible ? 'block' : 'none';
        var balanceSection = document.getElementById('bank-balance-section');
        var paycheckSection = document.getElementById('bank-paycheck-section');
        var transactionsSection = document.getElementById('bank-transactions-section');
        if (balanceSection) balanceSection.style.display = display;
        if (paycheckSection) paycheckSection.style.display = display;
        if (transactionsSection) transactionsSection.style.display = display;
    }

    // Initial state: hide bank sections and show placeholder message until a student is selected.
    setSectionsVisible(false);
    if (noMsg) {
        noMsg.style.display = 'block';
    }

    function showDropdown(items) {
        dropdown.innerHTML = '';
        if (!items || !items.length) {
            dropdown.style.display = 'none';
            return;
        }
        dropdown.style.display = 'block';
        items.slice(0, 15).forEach(function (s) {
            var div = document.createElement('div');
            div.className = 'bank-search-autocomplete-item';
            div.style.cssText = 'padding:10px 12px; cursor:pointer; font-size:14px;';
            var label = (s.student_name || '') + ' ($' + (s.balance != null ? Number(s.balance).toFixed(2) : '0.00') + ')';
            div.textContent = label;
            div.addEventListener('mousedown', function (e) {
                e.preventDefault();
                currentBankStudentId = s.student_id;
                searchInput.value = label;
                dropdown.style.display = 'none';
                if (noMsg) noMsg.style.display = 'none';
                setSectionsVisible(true);
                // When a bank-account student search is committed, clear "managed by me" so it does not persist across searches.
                if (managedByMe && managedByMe.checked) {
                    managedByMe.checked = false;
                }
                loadBankAccount(s.student_id);
            });
            dropdown.appendChild(div);
        });
    }

    function loadList() {
        var params = new URLSearchParams();
        if (managedByMe && managedByMe.checked) params.set('managed_by_me', 'true');
        var q = (searchInput.value || '').trim();
        if (q) params.set('q', q);
        fetch('/api/bank-account/search?' + params.toString())
            .then(function (r) { return r.ok ? r.json() : []; })
            .then(function (data) {
                list = Array.isArray(data) ? data : [];
                showDropdown(list);
            })
            .catch(function () {
                list = [];
                dropdown.style.display = 'none';
            });
    }

    searchInput.addEventListener('input', loadList);
    searchInput.addEventListener('focus', function () {
        if (list.length) showDropdown(list);
        else loadList();
    });
    document.addEventListener('click', function (e) {
        if (!searchInput.contains(e.target) && !dropdown.contains(e.target)) {
            dropdown.style.display = 'none';
        }
    });
    if (managedByMe) managedByMe.addEventListener('change', loadList);
}

function selectMarketplaceStudent(studentId) {
    currentMarketplaceStudentId = studentId;
    loadMarketplaceBalance();
    loadMarketplaceCatalog();
    loadMarketplaceMyOrders();
    loadMarketplaceTypesAndCategories();
}

function loadMarketplaceMyOrders() {
    var list = document.getElementById('marketplace-my-orders-list');
    if (!list) return;
    var sid = getMarketplaceStudentId();
    if (!sid && window.currentUser && window.currentUser.role !== 'student') {
        list.innerHTML = '<p style="margin:0; color:#94a3b8;">Select a student to view their orders.</p>';
        return;
    }
    fetch('/api/purchase-orders')
        .then(function (r) { return r.ok ? r.json() : []; })
        .then(function (orders) {
            if (sid && window.currentUser && window.currentUser.role !== 'student') {
                orders = orders.filter(function (o) { return o.student_id === sid; });
            }
            if (!orders.length) {
                list.innerHTML = '<p style="margin:0; color:#94a3b8;">No orders yet.</p>';
                return;
            }
            list.innerHTML = orders.map(function (o) {
                var statusColor = o.status === 'approved' ? '#059669' : o.status === 'denied' ? '#dc2626' : '#64748b';
                var statusLabel = o.status === 'approved' ? 'fulfilled' : (o.status || '');
                return '<div style="padding:10px 0; border-bottom:1px solid #f1f5f9;">' +
                    '<span style="font-weight:600;">' + (o.item_name || '').replace(/</g, '&lt;') + '</span> — $' + Number(o.item_price).toFixed(2) +
                    ' <span style="color:' + statusColor + ';">(' + statusLabel + ')</span>' +
                    (o.approved_by_name ? ' — Fulfilled by ' + o.approved_by_name.replace(/</g, '&lt;') : '') +
                    (o.denial_reason ? ' — ' + o.denial_reason.replace(/</g, '&lt;') : '') +
                    '</div>';
            }).join('');
        })
        .catch(function () {
            list.innerHTML = '<p style="margin:0; color:#dc2626;">Failed to load orders.</p>';
        });
}

function bindMarketplaceCheckout() {
    var btn = document.getElementById('marketplace-checkout-btn');
    var msg = document.getElementById('marketplace-checkout-msg');
    if (!btn || btn._marketplaceBound) return;
    btn._marketplaceBound = true;
    btn.addEventListener('click', function () {
        if (!marketplaceCart.length) return;
        var sid = getMarketplaceStudentId();
        if (!sid) { if (msg) { msg.style.display = 'block'; msg.textContent = 'Select a student first.'; msg.style.color = '#dc2626'; } return; }
        var cart = marketplaceCart.map(function (x) { return { item_id: x.item_id, quantity: x.quantity || 1 }; });
        fetch('/api/marketplace/checkout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cart: cart })
        })
            .then(function (r) { return r.json().then(function (data) { return { ok: r.ok, data: data }; }); })
            .then(function (res) {
                if (res.ok) {
                    marketplaceCart = [];
                    saveMarketplaceCartToStorage();
                    renderMarketplaceCart();
                    loadMarketplaceBalance();
                    loadMarketplaceMyOrders();
                    if (msg) { msg.style.display = 'block'; msg.textContent = 'Purchase orders submitted. Your support team will review them.'; msg.style.color = '#059669'; }
                } else {
                    if (msg) { msg.style.display = 'block'; msg.textContent = res.data.error || 'Checkout failed'; msg.style.color = '#dc2626'; }
                }
            })
            .catch(function () {
                if (msg) { msg.style.display = 'block'; msg.textContent = 'Checkout failed'; msg.style.color = '#dc2626'; }
            });
    });
}

document.addEventListener('DOMContentLoaded', function () {
    var refreshBtn = document.getElementById('marketplace-refresh-btn');
    if (refreshBtn) refreshBtn.addEventListener('click', function () {
        loadMarketplaceBalance();
        if (getMarketplaceStudentId()) loadMarketplaceCatalog();
    });
    var searchBtn = document.getElementById('marketplace-search-btn');
    if (searchBtn) searchBtn.addEventListener('click', function () {
        loadMarketplaceCatalog();
    });
    var addItemBtn = document.getElementById('marketplace-add-item-btn');
    if (addItemBtn && !addItemBtn._marketplaceAddBound) {
        addItemBtn._marketplaceAddBound = true;
        addItemBtn.addEventListener('click', openMarketplaceAddItemModal);
    }
    var addItemSubmit = document.getElementById('marketplace-add-item-submit');
    if (addItemSubmit && !addItemSubmit._marketplaceAddBound) {
        addItemSubmit._marketplaceAddBound = true;
        addItemSubmit.addEventListener('click', submitMarketplaceAddItem);
    }
    bindMarketplaceItemDetailModal();
    (function bindMarketplaceHideUnhideEditModals() {
        var hideClose = document.getElementById('marketplace-hide-modal-close');
        var hideCancel = document.getElementById('marketplace-hide-cancel');
        var hideSubmit = document.getElementById('marketplace-hide-submit');
        var hideModal = document.getElementById('marketplace-hide-modal');
        if (hideClose) hideClose.addEventListener('click', closeMarketplaceHideModal);
        if (hideCancel) hideCancel.addEventListener('click', closeMarketplaceHideModal);
        if (hideSubmit) hideSubmit.addEventListener('click', submitMarketplaceHide);
        if (hideModal) hideModal.addEventListener('click', function (e) { if (e.target === hideModal) closeMarketplaceHideModal(); });
        var hideTypeRadios = document.querySelectorAll('input[name="marketplace-hide-type"]');
        var hideValueStudent = document.getElementById('marketplace-hide-value-student');
        var hideValueColor = document.getElementById('marketplace-hide-value-color');
        var hideValueGrade = document.getElementById('marketplace-hide-value-grade');
        hideTypeRadios.forEach(function (r) {
            r.addEventListener('change', function () {
                var t = this.value;
                if (hideValueStudent) hideValueStudent.style.display = (t === 'student') ? 'block' : 'none';
                if (hideValueColor) hideValueColor.style.display = (t === 'card_color') ? 'block' : 'none';
                if (hideValueGrade) hideValueGrade.style.display = (t === 'grade_section') ? 'block' : 'none';
            });
        });
        var hideStudentSearch = document.getElementById('marketplace-hide-student-search');
        var hideStudentDropdown = document.getElementById('marketplace-hide-student-dropdown');
        var hideStudentId = document.getElementById('marketplace-hide-student-id');
        if (hideStudentSearch && hideStudentDropdown && hideStudentId) {
            var hideStudentList = [];
            function showHideStudentDropdown(items) {
                hideStudentDropdown.innerHTML = '';
                hideStudentDropdown.style.display = 'block';
                (items || []).slice(0, 15).forEach(function (s) {
                    var div = document.createElement('div');
                    div.className = 'bank-search-autocomplete-item';
                    div.style.cssText = 'padding:10px 12px; cursor:pointer; font-size:14px;';
                    div.textContent = (s.student_name || s.name || '') + (s.balance != null ? ' ($' + Number(s.balance).toFixed(2) + ')' : '');
                    div.addEventListener('mousedown', function (e) {
                        e.preventDefault();
                        var sid = s.student_id != null ? s.student_id : s.id;
                        hideStudentId.value = String(sid);
                        hideStudentSearch.value = s.student_name || s.name || '';
                        hideStudentDropdown.style.display = 'none';
                    });
                    hideStudentDropdown.appendChild(div);
                });
            }
            hideStudentSearch.addEventListener('input', function () {
                var q = hideStudentSearch.value.trim();
                hideStudentId.value = '';
                if (!q) { hideStudentDropdown.style.display = 'none'; return; }
                var params = new URLSearchParams({ q: q });
                fetch('/api/bank-account/search?' + params.toString()).then(function (r) { return r.ok ? r.json() : []; }).then(function (data) {
                    hideStudentList = data;
                    showHideStudentDropdown(data);
                });
            });
            hideStudentSearch.addEventListener('focus', function () {
                if (hideStudentList.length) showHideStudentDropdown(hideStudentList);
                else if (hideStudentSearch.value.trim()) hideStudentSearch.dispatchEvent(new Event('input'));
            });
            document.addEventListener('click', function (e) {
                if (!hideStudentSearch.contains(e.target) && !hideStudentDropdown.contains(e.target)) hideStudentDropdown.style.display = 'none';
            });
        }
        var unhideClose = document.getElementById('marketplace-unhide-modal-close');
        var unhideCloseBtn = document.getElementById('marketplace-unhide-close-btn');
        var unhideAddMore = document.getElementById('marketplace-unhide-add-more');
        var unhideModal = document.getElementById('marketplace-unhide-modal');
        if (unhideClose) unhideClose.addEventListener('click', closeMarketplaceUnhideModal);
        if (unhideCloseBtn) unhideCloseBtn.addEventListener('click', closeMarketplaceUnhideModal);
        if (unhideModal) unhideModal.addEventListener('click', function (e) { if (e.target === unhideModal) closeMarketplaceUnhideModal(); });
        if (unhideAddMore) unhideAddMore.addEventListener('click', function () {
            if (marketplaceUnhideModalItemId != null) {
                closeMarketplaceUnhideModal();
                openMarketplaceHideModal(marketplaceUnhideModalItemId);
            }
        });
        var editClose = document.getElementById('marketplace-edit-item-modal-close');
        var editCancel = document.getElementById('marketplace-edit-item-cancel');
        var editSubmit = document.getElementById('marketplace-edit-item-submit');
        var editModal = document.getElementById('marketplace-edit-item-modal');
        if (editClose) editClose.addEventListener('click', closeMarketplaceEditModal);
        if (editCancel) editCancel.addEventListener('click', closeMarketplaceEditModal);
        if (editSubmit) editSubmit.addEventListener('click', submitMarketplaceEditItem);
        if (editModal) editModal.addEventListener('click', function (e) { if (e.target === editModal) closeMarketplaceEditModal(); });
    })();
    var viewAsCheck = document.getElementById('marketplace-show-view-as-student-checkbox');
    var studentWrap = document.getElementById('marketplace-student-select-wrap');
    var balanceSection = document.getElementById('marketplace-balance-section');
    var cartSection = document.getElementById('marketplace-cart-section');
    if (viewAsCheck && !viewAsCheck._viewAsBound) {
        viewAsCheck._viewAsBound = true;
        viewAsCheck.addEventListener('change', function () {
            if (studentWrap) studentWrap.style.display = viewAsCheck.checked ? 'block' : 'none';
            if (balanceSection) balanceSection.style.display = viewAsCheck.checked ? 'block' : 'none';
            if (cartSection) cartSection.style.display = viewAsCheck.checked ? 'block' : 'none';
            if (!viewAsCheck.checked) {
                currentMarketplaceStudentId = null;
                if (document.getElementById('marketplace-balance-amount')) document.getElementById('marketplace-balance-amount').textContent = '$0.00';
                if (document.getElementById('marketplace-student-name')) document.getElementById('marketplace-student-name').textContent = '';
            } else if (currentMarketplaceStudentId) {
                loadMarketplaceBalance();
                loadMarketplaceCatalog();
                loadMarketplaceMyOrders();
            }
        });
    }
    var imageUrlInfoBtn = document.getElementById('marketplace-add-item-image-url-info-btn');
    var imageUrlInfoPopover = document.getElementById('marketplace-add-item-image-url-info');
    var imageUrlInfoWrap = imageUrlInfoBtn && imageUrlInfoBtn.closest('.marketplace-image-url-info-wrap');
    if (imageUrlInfoBtn && imageUrlInfoPopover && imageUrlInfoWrap && !imageUrlInfoBtn._imageUrlInfoBound) {
        imageUrlInfoBtn._imageUrlInfoBound = true;
        var imageUrlInfoPinned = false;
        function showImageUrlInfo() {
            imageUrlInfoPopover.classList.add('is-visible');
        }
        function hideImageUrlInfo() {
            if (!imageUrlInfoPinned) imageUrlInfoPopover.classList.remove('is-visible');
        }
        function toggleImageUrlInfo() {
            imageUrlInfoPinned = !imageUrlInfoPinned;
            if (imageUrlInfoPinned) showImageUrlInfo(); else hideImageUrlInfo();
        }
        imageUrlInfoWrap.addEventListener('mouseenter', showImageUrlInfo);
        imageUrlInfoWrap.addEventListener('mouseleave', hideImageUrlInfo);
        imageUrlInfoBtn.addEventListener('click', function (e) {
            e.preventDefault();
            toggleImageUrlInfo();
        });
        document.addEventListener('click', function (e) {
            if (!imageUrlInfoPinned) return;
            if (imageUrlInfoWrap.contains(e.target)) return;
            imageUrlInfoPinned = false;
            hideImageUrlInfo();
        });
    }
    loadMarketplaceTypesAndCategories();
    var analyticsItemSelect = document.getElementById('marketplace-analytics-item-select');
    if (analyticsItemSelect && !analyticsItemSelect._analyticsBound) {
        analyticsItemSelect._analyticsBound = true;
        analyticsItemSelect.addEventListener('change', function () {
            var v = this.value;
            renderMarketplaceAnalyticsDemographics(v ? parseInt(v, 10) : null);
        });
    }
    var analyticsHideCheck = document.getElementById('marketplace-analytics-hide-checkbox');
    var analyticsBody = document.getElementById('marketplace-analytics-body');
    if (analyticsHideCheck && analyticsBody && !analyticsHideCheck._hideBound) {
        analyticsHideCheck._hideBound = true;
        function toggleAnalyticsVisible() {
            analyticsBody.style.display = analyticsHideCheck.checked ? 'none' : 'block';
        }
        analyticsHideCheck.addEventListener('change', toggleAnalyticsVisible);
        toggleAnalyticsVisible();
    }
});
window.closeMarketplaceAnalytics = destroyMarketplaceAnalyticsCharts;
window.closeMarketplaceAddItemModal = closeMarketplaceAddItemModal;

function loadNotifications() {
    fetch('/api/notifications').then(function (r) { return r.ok ? r.json() : []; }).then(function (list) {
        var unread = list.filter(function (n) { return !n.read_at; });
        var badge = document.getElementById('notifications-badge');
        if (badge) {
            badge.style.display = unread.length ? 'inline-flex' : 'none';
            badge.textContent = unread.length > 99 ? '99+' : unread.length;
        }
        var listEl = document.getElementById('notifications-list');
        if (!listEl) return;
        listEl.innerHTML = list.slice(0, 30).map(function (n) {
            return '<div style="padding:10px 12px; border-bottom:1px solid #f1f5f9; font-size:13px;' + (n.read_at ? '' : ' background:#f0f9ff;') + '" data-notification-id="' + n.id + '">' +
                '<div style="font-weight:600;">' + (n.title || '').replace(/</g, '&lt;') + '</div>' +
                '<div style="color:#64748b;">' + (n.body || '').replace(/</g, '&lt;') + '</div>' +
                '</div>';
        }).join('');
        listEl.querySelectorAll('[data-notification-id]').forEach(function (el) {
            el.addEventListener('click', function () {
                var id = parseInt(el.getAttribute('data-notification-id'), 10);
                fetch('/api/notifications/' + id + '/read', { method: 'PATCH' }).then(function () { loadNotifications(); });
            });
        });
    });
}

document.addEventListener('DOMContentLoaded', function () {
    var bell = document.getElementById('notifications-bell-btn');
    var wrap = document.getElementById('notifications-bell-wrap');
    var dropdown = document.getElementById('notifications-dropdown');
    if (bell && dropdown) {
        bell.addEventListener('click', function (e) {
            e.stopPropagation();
            var show = dropdown.style.display === 'block';
            dropdown.style.display = show ? 'none' : 'block';
            if (!show) loadNotifications();
        });
    }
    document.addEventListener('click', function (e) {
        var d = document.getElementById('notifications-dropdown');
        var w = document.getElementById('notifications-bell-wrap');
        if (d && w && !w.contains(e.target)) d.style.display = 'none';
    });
    var markAll = document.getElementById('notifications-mark-all-read');
    if (markAll) markAll.addEventListener('click', function () {
        fetch('/api/notifications/read-all', { method: 'PATCH' }).then(function () { loadNotifications(); });
    });
});

// ==================== BANK ACCOUNT FUNCTIONALITY ====================

let allMarketplaceItems = [];
let currentPurchaseItem = null;

// Load bank account data
async function loadBankAccount(studentId) {
    if (!studentId) {
        // Still show UI with default values
        const balanceAmount = document.getElementById('bank-balance-amount');
        const studentName = document.getElementById('bank-student-name');
        if (balanceAmount) balanceAmount.textContent = '$0.00';
        if (studentName) studentName.textContent = window.currentUser.name || 'Student';
        
        const transactionsList = document.getElementById('transactions-list');
        if (transactionsList) transactionsList.innerHTML = '<p>No transactions yet.</p>';
        return;
    }
    
    try {
        const response = await fetch(`/api/bank-account/${studentId}`);
        if (!response.ok) {
            // If account doesn't exist, show default UI
        const balanceAmount = document.getElementById('bank-balance-amount');
        const studentName = document.getElementById('bank-student-name');
        if (balanceAmount) balanceAmount.textContent = '$0.00';
        if (studentName) {
            // Try to get student name
            const student = allStudents.find(s => s.id === studentId);
            if (student) studentName.textContent = student.name;
            else studentName.textContent = window.currentUser.name || 'Student';
        }
            
            const transactionsList = document.getElementById('transactions-list');
            if (transactionsList) transactionsList.innerHTML = '<p>No transactions yet.</p>';
            return;
        }
        
        const data = await response.json();
        
        // Update balance display
        const balanceAmount = document.getElementById('bank-balance-amount');
        const studentName = document.getElementById('bank-student-name');
        if (balanceAmount) balanceAmount.textContent = `$${data.balance.toFixed(2)}`;
        if (studentName) {
            const student = allStudents.find(s => s.id === studentId);
            if (student) studentName.textContent = student.name;
            else studentName.textContent = window.currentUser.name || 'Student';
        }
        
        // Ensure balance section is visible
        const balanceSection = document.getElementById('bank-balance-section');
        if (balanceSection) balanceSection.style.display = 'block';
        
        // Load transactions (include Starbucks as a synthetic deposit line item if present)
        const starbucksTotal = typeof data.starbucks_total === 'number'
            ? data.starbucks_total
            : (data.starbucks_total ? Number(data.starbucks_total) || 0 : 0);
        const baseTransactions = data.transactions || [];
        let transactionsWithStarbucks = baseTransactions.slice();

        if (starbucksTotal > 0) {
            const starbucksDollarValue = starbucksTotal * 0.10;
            const nowIso = new Date().toISOString();
            const lastBalanceAfter = baseTransactions.length
                ? Number(baseTransactions[0].balance_after || baseTransactions[baseTransactions.length - 1].balance_after || 0)
                : Number(data.balance || 0);

            transactionsWithStarbucks.push({
                id: 'starbucks',
                type: 'deposit',
                amount: starbucksDollarValue,
                balance_after: lastBalanceAfter + starbucksDollarValue,
                description: `Starbucks (${starbucksTotal} × $0.10)`,
                created_at: nowIso,
            });
        }

        renderTransactions(transactionsWithStarbucks);
        
        // Load paychecks
        await loadPaychecks(studentId);
        
        currentBankStudentId = studentId;
    } catch (error) {
        console.error('Error loading bank account:', error);
        // Still show UI with default values
        const balanceAmount = document.getElementById('bank-balance-amount');
        const studentName = document.getElementById('bank-student-name');
        if (balanceAmount) balanceAmount.textContent = '$0.00';
        if (studentName) studentName.textContent = window.currentUser.name || 'Student';
        
        const transactionsList = document.getElementById('transactions-list');
        if (transactionsList) transactionsList.innerHTML = '<p>No transactions yet.</p>';
    }
}

// Bank account refresh button
document.addEventListener('DOMContentLoaded', () => {
    const refreshBtn = document.getElementById('bank-refresh-btn');
    if (refreshBtn && !refreshBtn._bankBound) {
        refreshBtn._bankBound = true;
        refreshBtn.addEventListener('click', () => {
            if (typeof currentBankStudentId !== 'undefined' && currentBankStudentId) {
                loadBankAccount(currentBankStudentId);
            }
        });
    }
});

// Load paychecks
async function loadPaychecks(studentId) {
    if (!studentId) {
        window.paychecksData = [];
        return;
    }
    
    try {
        const response = await fetch(`/api/paychecks/${studentId}`);
        if (!response.ok) {
            window.paychecksData = [];
            return;
        }
        
        const paychecks = await response.json();
        
        // Do not auto-show worksheet: worksheet is only shown when the student
        // selects a paycheck from the Undeposited modal.
        const worksheetDiv = document.getElementById('current-paycheck-worksheet');
        if (worksheetDiv) worksheetDiv.style.display = 'none';
        
        // Store paychecks for modal
        window.paychecksData = paychecks || [];
        
        // Highlight Undeposited button when there are one or more undeposited paychecks
        updateUndepositedButtonHighlight();
    } catch (error) {
        console.error('Error loading paychecks:', error);
        window.paychecksData = [];
    }
}

// Currency helpers for paycheck worksheet
function parseCurrency(str) {
    if (str == null || str === '') return NaN;
    const cleaned = String(str).replace(/[$,]/g, '').trim();
    return cleaned === '' ? NaN : parseFloat(cleaned);
}
function formatCurrency(num) {
    if (num === '' || num == null || isNaN(parseFloat(num))) return '';
    const n = parseFloat(num);
    return '$' + n.toFixed(2);
}

// Render paycheck worksheet
function renderPaycheckWorksheet(paycheck) {
    const worksheetDiv = document.getElementById('current-paycheck-worksheet');
    if (!worksheetDiv) return;
    
    worksheetDiv.style.display = 'block';
    document.getElementById('worksheet-avg-percent').textContent = paycheck.average_star_percent.toFixed(2);
    
    // Citation list: unique types with count (e.g. "2 Off Task", "1 Lang")
    const citationListEl = document.getElementById('worksheet-citation-list');
    if (citationListEl) {
        const list = paycheck.citation_list || [];
        if (!list.length) {
            citationListEl.textContent = '(none this week)';
        } else {
            const counts = {};
            list.forEach(function (type) {
                counts[type] = (counts[type] || 0) + 1;
            });
            const lines = Object.keys(counts)
                .sort(function (a, b) {
                    const diff = counts[b] - counts[a];
                    return diff !== 0 ? diff : (a < b ? -1 : a > b ? 1 : 0);
                })
                .map(function (type) {
                    return counts[type] + 'x ' + type;
                });
            citationListEl.textContent = lines.join('\n');
        }
    }
    
    // Store paycheck ID
    worksheetDiv.dataset.paycheckId = paycheck.id;
    
    // Pre-fill inputs if this is a retry (worksheet was completed but not verified)
    if (paycheck.worksheet_completed && !paycheck.is_verified && paycheck.student_calculated_pay) {
        document.getElementById('worksheet-calculated-pay').value = formatCurrency(paycheck.student_calculated_pay);
        document.getElementById('worksheet-calculated-citations').value = paycheck.student_calculated_citations || '';
        document.getElementById('worksheet-calculated-deduction').value = formatCurrency(paycheck.student_calculated_deduction);
        document.getElementById('worksheet-calculated-final').value = formatCurrency(paycheck.student_calculated_final);
    } else {
        // Clear inputs for new worksheet
        document.getElementById('worksheet-calculated-pay').value = '';
        document.getElementById('worksheet-calculated-citations').value = '';
        document.getElementById('worksheet-calculated-deduction').value = '';
        document.getElementById('worksheet-calculated-final').value = '';
    }
    
    // Clear error/success messages
    document.getElementById('worksheet-error').style.display = 'none';
    document.getElementById('worksheet-success').style.display = 'none';
}

// Submit paycheck worksheet
async function submitPaycheckWorksheet() {
    const worksheetDiv = document.getElementById('current-paycheck-worksheet');
    if (!worksheetDiv) return;
    
    const paycheckId = worksheetDiv.dataset.paycheckId;
    if (!paycheckId) return;
    
    const calculatedPay = parseCurrency(document.getElementById('worksheet-calculated-pay').value);
    const calculatedCitations = parseInt(document.getElementById('worksheet-calculated-citations').value, 10);
    const calculatedDeduction = parseCurrency(document.getElementById('worksheet-calculated-deduction').value);
    const calculatedFinal = parseCurrency(document.getElementById('worksheet-calculated-final').value);
    
    if (isNaN(calculatedPay) || isNaN(calculatedCitations) || isNaN(calculatedDeduction) || isNaN(calculatedFinal)) {
        document.getElementById('worksheet-error').textContent = 'Please fill in all fields';
        document.getElementById('worksheet-error').style.display = 'block';
        return;
    }
    
    try {
        const response = await fetch(`/api/paycheck/${paycheckId}/complete-worksheet`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                calculated_pay: calculatedPay,
                calculated_citations: calculatedCitations,
                calculated_deduction: calculatedDeduction,
                calculated_final: calculatedFinal
            })
        });
        
        const data = await response.json();
        
        if (data.verified) {
            document.getElementById('worksheet-success').textContent = data.message;
            document.getElementById('worksheet-success').style.display = 'block';
            document.getElementById('worksheet-error').style.display = 'none';
            
            // Reload paychecks so Undeposited button highlight updates
            if (typeof currentBankStudentId !== 'undefined' && currentBankStudentId) loadPaychecks(currentBankStudentId);
            // Reload bank account
            setTimeout(() => {
                loadBankAccount(currentBankStudentId);
            }, 1000);
        } else {
            document.getElementById('worksheet-error').textContent = data.message || 'Some calculations are incorrect';
            document.getElementById('worksheet-error').style.display = 'block';
            if (data.errors) {
                document.getElementById('worksheet-error').innerHTML = data.errors.join('<br>');
            }
            // Don't hide the worksheet - allow unlimited retries
            // Clear success message if it was showing
            document.getElementById('worksheet-success').style.display = 'none';
        }
    } catch (error) {
        console.error('Error submitting worksheet:', error);
        document.getElementById('worksheet-error').textContent = 'Error submitting worksheet';
        document.getElementById('worksheet-error').style.display = 'block';
    }
}

// Highlight Undeposited button when student has one or more undeposited paychecks
function updateUndepositedButtonHighlight() {
    const btn = document.getElementById('view-undeposited-paychecks-btn');
    if (!btn) return;
    const hasUndeposited = window.paychecksData && window.paychecksData.some(
        p => !p.worksheet_completed || !p.is_verified
    );
    if (hasUndeposited) {
        btn.classList.add('undeposited-highlight');
    } else {
        btn.classList.remove('undeposited-highlight');
    }
}

// Open worksheet for a specific paycheck (called when student selects from Undeposited modal).
// Fetches fresh paycheck data so citation_list and amounts reflect current infractions.
async function openWorksheetForPaycheck(paycheckId) {
    try {
        const response = await fetch(`/api/paycheck/${paycheckId}`);
        if (!response.ok) return;
        const paycheck = await response.json();
        renderPaycheckWorksheet(paycheck);
        closePaychecksModal();
    } catch (error) {
        console.error('Error loading paycheck for worksheet:', error);
    }
}

// View paychecks modal - filtered by deposited/undeposited
function viewPaychecksModal(filterType) {
    const modal = document.getElementById('paychecks-modal');
    const content = document.getElementById('paychecks-modal-content');
    
    if (!window.paychecksData || window.paychecksData.length === 0) {
        content.innerHTML = '<p>No paychecks found.</p>';
        modal.style.display = 'block';
        return;
    }
    
    // Filter paychecks based on type
    let filteredPaychecks = [];
    if (filterType === 'deposited') {
        // Deposited: worksheet completed AND verified
        filteredPaychecks = window.paychecksData.filter(p => p.is_verified === true);
    } else if (filterType === 'undeposited') {
        // Undeposited: worksheet not completed OR not verified
        filteredPaychecks = window.paychecksData.filter(p => !p.worksheet_completed || !p.is_verified);
    } else {
        // Show all if no filter
        filteredPaychecks = window.paychecksData;
    }
    
    if (filteredPaychecks.length === 0) {
        const message = filterType === 'deposited' ? 'No deposited paychecks found.' : 'No undeposited paychecks found.';
        content.innerHTML = `<p>${message}</p>`;
        modal.style.display = 'block';
        return;
    }
    
    const isUndeposited = filterType === 'undeposited';
    let html = `<h3 style="margin-bottom: 15px;">${filterType === 'deposited' ? 'Deposited' : 'Undeposited'} Paychecks</h3>`;
    if (isUndeposited) {
        html += '<p style="margin-bottom: 15px; color: #64748b;">Select a paycheck to complete its worksheet.</p>';
    }
    html += '<table style="width: 100%; border-collapse: collapse;"><thead><tr>';
    html += '<th style="padding: 10px; border: 1px solid var(--border);">Period</th>';
    html += '<th style="padding: 10px; border: 1px solid var(--border);">STAR %</th>';
    if (!isUndeposited) {
        html += '<th style="padding: 10px; border: 1px solid var(--border);">Base Pay</th>';
        html += '<th style="padding: 10px; border: 1px solid var(--border);">Citations</th>';
        html += '<th style="padding: 10px; border: 1px solid var(--border);">Deduction</th>';
        html += '<th style="padding: 10px; border: 1px solid var(--border);">Final Pay</th>';
    }
    html += '<th style="padding: 10px; border: 1px solid var(--border);">Status</th>';
    if (isUndeposited) {
        html += '<th style="padding: 10px; border: 1px solid var(--border);">Action</th>';
    }
    html += '</tr></thead><tbody>';
    
    filteredPaychecks.forEach(p => {
        html += '<tr>';
        html += `<td style="padding: 10px; border: 1px solid var(--border);">${p.pay_period_start} - ${p.pay_period_end}</td>`;
        html += `<td style="padding: 10px; border: 1px solid var(--border);">${Number(p.average_star_percent).toFixed(2)}%</td>`;
        if (!isUndeposited) {
            html += `<td style="padding: 10px; border: 1px solid var(--border);">$${p.base_pay.toFixed(2)}</td>`;
            html += `<td style="padding: 10px; border: 1px solid var(--border);">${p.citation_count}</td>`;
            html += `<td style="padding: 10px; border: 1px solid var(--border);">$${p.citation_deduction.toFixed(2)}</td>`;
            html += `<td style="padding: 10px; border: 1px solid var(--border);">$${p.final_pay.toFixed(2)}</td>`;
        }
        let status = 'Incomplete';
        if (p.is_verified) {
            status = 'Deposited';
        } else if (p.worksheet_completed) {
            status = 'Pending Verification';
        }
        html += `<td style="padding: 10px; border: 1px solid var(--border);">${status}</td>`;
        if (isUndeposited) {
            html += `<td style="padding: 10px; border: 1px solid var(--border);"><button type="button" class="btn-primary" style="background: #10b981; border-color: #10b981; padding: 6px 12px; font-size: 13px;" onclick="openWorksheetForPaycheck(${p.id})">Complete worksheet</button></td>`;
        }
        html += '</tr>';
    });
    
    html += '</tbody></table>';
    content.innerHTML = html;
    modal.style.display = 'block';
}

function closePaychecksModal() {
    document.getElementById('paychecks-modal').style.display = 'none';
}

// Load marketplace items
async function loadMarketplaceItems() {
    try {
        const response = await fetch('/api/marketplace-items');
        if (!response.ok) throw new Error('Failed to load marketplace items');
        
        allMarketplaceItems = await response.json();
        renderMarketplaceItems();
    } catch (error) {
        console.error('Error loading marketplace items:', error);
    }
}

// Render marketplace items
function renderMarketplaceItems() {
    const grid = document.getElementById('marketplace-grid');
    if (!grid) return;
    
    const filter = document.getElementById('marketplace-filter')?.value || 'all';
    
    let items = allMarketplaceItems;
    if (filter === 'global') {
        items = items.filter(i => i.is_global || i.is_approved_for_global);
    } else if (filter === 'case-manager') {
        items = items.filter(i => !i.is_global && !i.is_approved_for_global);
    }
    
    if (items.length === 0) {
        grid.innerHTML = '<p>No items available.</p>';
        return;
    }
    
    grid.innerHTML = items.map(item => `
        <div class="marketplace-item-card" style="background: white; border: 1px solid var(--border); border-radius: 8px; padding: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <h4 style="margin: 0 0 10px 0;">${item.name}</h4>
            <p style="color: var(--text-secondary); margin: 0 0 15px 0;">${item.description || 'No description'}</p>
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <span style="font-size: 1.5em; font-weight: bold; color: var(--accent);">$${item.price.toFixed(2)}</span>
                ${window.currentUser.role === 'student' ? `<button onclick="openPurchaseModal(${item.id})" class="btn-primary" style="background: #10b981; border-color: #10b981;">Purchase</button>` : ''}
            </div>
        </div>
    `).join('');
}

// Open purchase modal
async function openPurchaseModal(itemId) {
    const item = allMarketplaceItems.find(i => i.id === itemId);
    if (!item) return;
    
    currentPurchaseItem = item;
    
    const modal = document.getElementById('purchase-modal');
    const content = document.getElementById('purchase-modal-content');
    
    // Get current balance
    const balanceResponse = await fetch(`/api/bank-account/${currentBankStudentId}`);
    const balanceData = await balanceResponse.json();
    const currentBalance = balanceData.balance;
    const newBalance = currentBalance - item.price;
    
    content.innerHTML = `
        <div style="margin-bottom: 20px;">
            <h3>${item.name}</h3>
            <p>${item.description || 'No description'}</p>
            <p style="font-size: 1.2em; margin: 15px 0;"><strong>Price: $${item.price.toFixed(2)}</strong></p>
        </div>
        <div style="margin-bottom: 20px;">
            <p>Current Balance: <strong>$${currentBalance.toFixed(2)}</strong></p>
            <p>Balance After Purchase: <strong>$${newBalance.toFixed(2)}</strong></p>
        </div>
        <div class="form-group">
            <label>Enter calculated balance after purchase:</label>
            <input type="number" id="purchase-calculated-balance" step="0.01" placeholder="Enter calculated balance" style="width: 100%; padding: 8px; border: 1px solid var(--border); border-radius: 4px;">
        </div>
        <div id="purchase-error" style="color: #dc2626; margin-top: 10px; display: none;"></div>
        <div style="margin-top: 20px; display: flex; gap: 10px;">
            <button onclick="submitPurchase()" class="btn-primary" style="background: #10b981; border-color: #10b981;">Submit Purchase</button>
            <button onclick="closePurchaseModal()" class="btn-secondary">Cancel</button>
        </div>
    `;
    
    modal.style.display = 'block';
}

function closePurchaseModal() {
    document.getElementById('purchase-modal').style.display = 'none';
    currentPurchaseItem = null;
}

// Submit purchase
async function submitPurchase() {
    if (!currentPurchaseItem || !currentBankStudentId) return;
    
    const calculatedBalance = parseFloat(document.getElementById('purchase-calculated-balance').value);
    
    if (isNaN(calculatedBalance)) {
        document.getElementById('purchase-error').textContent = 'Please enter calculated balance';
        document.getElementById('purchase-error').style.display = 'block';
        return;
    }
    
    try {
        const response = await fetch('/api/purchase-orders', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                item_id: currentPurchaseItem.id,
                calculated_balance_after: calculatedBalance
            })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            showMessage('Purchase order created successfully!', 'success');
            closePurchaseModal();
            loadBankAccount(currentBankStudentId);
        } else {
            document.getElementById('purchase-error').textContent = data.error || 'Error creating purchase order';
            document.getElementById('purchase-error').style.display = 'block';
        }
    } catch (error) {
        console.error('Error submitting purchase:', error);
        document.getElementById('purchase-error').textContent = 'Error submitting purchase';
        document.getElementById('purchase-error').style.display = 'block';
    }
}

// Load purchase orders
async function loadPurchaseOrders() {
    try {
        const response = await fetch('/api/purchase-orders');
        if (!response.ok) throw new Error('Failed to load purchase orders');
        
        const orders = await response.json();
        renderPurchaseOrders(orders);
    } catch (error) {
        console.error('Error loading purchase orders:', error);
    }
}

// Render purchase orders
function renderPurchaseOrders(orders) {
    const list = document.getElementById('purchase-orders-list');
    if (!list) return;
    
    const pendingOrders = orders.filter(o => o.status === 'pending');
    
    if (pendingOrders.length === 0) {
        list.innerHTML = '<p>No pending purchase orders.</p>';
        return;
    }
    
    list.innerHTML = pendingOrders.map(order => `
        <div class="purchase-order-card" style="background: var(--bg-elevated); padding: 20px; border-radius: 8px; margin-bottom: 15px; border: 1px solid var(--border);">
            <h4 style="margin: 0 0 10px 0;">${order.item_name}</h4>
            <p style="margin: 5px 0;"><strong>Student:</strong> ${order.student_name}</p>
            <p style="margin: 5px 0;"><strong>Price:</strong> $${order.item_price.toFixed(2)}</p>
            <p style="margin: 5px 0;"><strong>Student's Calculation:</strong> $${order.student_calculated_balance_after.toFixed(2)}</p>
            <p style="margin: 5px 0;"><strong>Actual Balance:</strong> $${order.actual_balance_after.toFixed(2)}</p>
            <p style="margin: 5px 0;"><strong>Correct:</strong> ${order.is_calculation_correct ? 'Yes' : 'No'}</p>
            <div style="margin-top: 15px; display: flex; gap: 10px;">
                <button onclick="updatePurchaseOrderStatus(${order.id}, 'approved')" class="btn-primary" style="background: #10b981; border-color: #10b981;">Fulfill</button>
                <button onclick="updatePurchaseOrderStatus(${order.id}, 'denied')" class="btn-secondary" style="background: #dc2626; border-color: #dc2626; color: white;">Deny</button>
            </div>
        </div>
    `).join('');
}

// Update purchase order status
async function updatePurchaseOrderStatus(orderId, status) {
    try {
        const response = await fetch(`/api/purchase-orders/${orderId}/status`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status })
        });
        
        if (response.ok) {
            showMessage(`Purchase order ${status}`, 'success');
            if (currentBankStudentId) {
                await loadBankAccount(currentBankStudentId);
            }
        } else {
            const data = await response.json();
            showMessage(data.error || 'Error updating order', 'error');
        }
    } catch (error) {
        console.error('Error updating purchase order:', error);
        showMessage('Error updating purchase order', 'error');
    }
}

// Render transactions
function renderTransactions(transactions) {
    const list = document.getElementById('transactions-list');
    if (!list) return;

    if (!transactions || transactions.length === 0) {
        list.innerHTML = '<p style="margin:0; color:#94a3b8;">No transactions yet.</p>';
        return;
    }

    // Render in a compact, table-like list similar to Accounts UI
    const rows = transactions
        .slice()
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        .map(t => {
            const isDeposit = t.type === 'deposit';
            const typeLabel = isDeposit ? 'Deposit' : 'Purchase';
            const amountStr = (isDeposit ? '+' : '−') + '$' + Math.abs(t.amount).toFixed(2);
            const amtColor = isDeposit ? '#059669' : '#dc2626';
            return `
                <div style="display:flex; align-items:center; justify-content:space-between; padding:10px 0; border-bottom:1px solid #f1f5f9;">
                    <div style="flex:1; min-width:0;">
                        <div style="font-size:13px; color:#0f172a;">${new Date(t.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</div>
                        <div style="font-size:13px; color:#64748b; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${t.description || ''}</div>
                    </div>
                    <div style="width:110px; text-align:right; font-size:13px; color:#64748b;">
                        ${typeLabel}
                    </div>
                    <div style="width:120px; text-align:right; font-weight:600; font-size:13px; color:${amtColor};">
                        ${amountStr}
                    </div>
                    <div style="width:120px; text-align:right; font-size:13px; color:#0f172a;">
                        $${t.balance_after.toFixed(2)}
                    </div>
                </div>
            `;
        })
        .join('');

    list.innerHTML = rows;
}

// Create marketplace item
function openCreateItemModal() {
    document.getElementById('create-item-modal').style.display = 'block';
    document.getElementById('item-name').value = '';
    document.getElementById('item-description').value = '';
    document.getElementById('item-price').value = '';
}

function closeCreateItemModal() {
    document.getElementById('create-item-modal').style.display = 'none';
}

async function saveMarketplaceItem() {
    const name = document.getElementById('item-name').value.trim();
    const description = document.getElementById('item-description').value.trim();
    const price = parseFloat(document.getElementById('item-price').value);
    
    if (!name || !price || price <= 0) {
        showMessage('Please fill in all fields with valid values', 'error');
        return;
    }
    
    try {
        const response = await fetch('/api/marketplace-items', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, description, price })
        });
        
        if (response.ok) {
            showMessage('Item created successfully', 'success');
            closeCreateItemModal();
            await loadMarketplaceItems();
        } else {
            const data = await response.json();
            showMessage(data.error || 'Error creating item', 'error');
        }
    } catch (error) {
        console.error('Error creating item:', error);
        showMessage('Error creating item', 'error');
    }
}

// Bank account search (similar to daily entry)
function setupBankAccountSearch() {
    const searchInput = document.getElementById('bank-search-input');
    if (!searchInput) return;
    
    const wrapper = searchInput.closest('.bank-search-autocomplete-wrapper');
    const dropdown = wrapper ? wrapper.querySelector('.bank-search-autocomplete-dropdown') : null;
    if (!dropdown) return;
    
    let isDropdownVisible = false;
    
    const getAllOptions = () => {
        const options = [];
        allStudents.forEach(student => {
            if (student && student.name) {
                options.push({
                    type: 'student',
                    name: student.name,
                    displayText: `Student: ${student.name}`
                });
            }
        });
        allStaffMembers.forEach(staff => {
            const staffName = staff.name || staff.username || '';
            if (staffName) {
                options.push({
                    type: 'staff',
                    name: staffName,
                    displayText: `Staff: ${staffName}`
                });
            }
        });
        return options;
    };
    
    const filterOptions = (query) => {
        if (!query || !query.trim()) return [];
        const lowerQuery = query.trim().toLowerCase();
        return getAllOptions().filter(option => 
            option.name.toLowerCase().includes(lowerQuery)
        );
    };
    
    const showDropdown = (options) => {
        if (!options || options.length === 0) {
            dropdown.style.display = 'none';
            isDropdownVisible = false;
            return;
        }
        
        dropdown.innerHTML = '';
        options.forEach((option) => {
            const item = document.createElement('div');
            item.className = 'bank-search-autocomplete-item';
            item.style.cssText = 'padding: 10px; cursor: pointer; border-bottom: 1px solid #eee;';
            item.innerHTML = `<span style="font-weight: 600;">${option.type === 'student' ? 'Student:' : 'Staff:'}</span> ${option.name}`;
            
            item.addEventListener('click', () => {
                searchInput.value = option.name;
                hideDropdown();
                searchInput.dispatchEvent(new Event('input', { bubbles: true }));
            });
            
            dropdown.appendChild(item);
        });
        
        dropdown.style.display = 'block';
        isDropdownVisible = true;
    };
    
    const hideDropdown = () => {
        dropdown.style.display = 'none';
        isDropdownVisible = false;
    };
    
    searchInput.addEventListener('input', (e) => {
        const query = e.target.value;
        const options = filterOptions(query);
        showDropdown(options);
    });
    
    searchInput.addEventListener('blur', () => {
        setTimeout(() => hideDropdown(), 200);
    });
}

// Switch view handler for bank account
function handleBankAccountView() {
    if (window.currentUser.role === 'student') {
        // Student view - load their own account
        currentBankStudentId = window.currentUser.studentId;
        
        // Always show all sections for students, even if no data yet
        const balanceSection = document.getElementById('bank-balance-section');
        const paycheckSection = document.getElementById('bank-paycheck-section');
        const transactionsSection = document.getElementById('bank-transactions-section');
        
        if (balanceSection) balanceSection.style.display = 'block';
        if (paycheckSection) paycheckSection.style.display = 'block';
        if (transactionsSection) transactionsSection.style.display = 'block';
        
        // Set default student name if available
        if (currentBankStudentId) {
            loadBankAccount(currentBankStudentId);
        } else {
            // Still show UI even if studentId is not set
            const balanceAmount = document.getElementById('bank-balance-amount');
            const studentName = document.getElementById('bank-student-name');
            if (balanceAmount) balanceAmount.textContent = '$0.00';
            if (studentName) studentName.textContent = window.currentUser.name || 'Student';
            const transactionsList = document.getElementById('transactions-list');
            if (transactionsList) transactionsList.innerHTML = '<p>No transactions yet.</p>';
        }
    } else {
        // Staff/Admin view - simple selector; autocomplete handled by setupBankStudentSearch
        const wrap = document.getElementById('bank-student-select-wrap');
        const noMsg = document.getElementById('bank-no-student-msg');
        const adminPaycheckGen = document.getElementById('admin-paycheck-generation');
        if (wrap) wrap.style.display = 'block';
        if (noMsg) noMsg.style.display = 'block';
        if (adminPaycheckGen) adminPaycheckGen.style.display = 'block';

        setupBankStudentSearch();
        initStarbucksManagement();
    }
    
    // Setup event listeners
    const submitWorksheetBtn = document.getElementById('submit-worksheet-btn');
    if (submitWorksheetBtn) {
        submitWorksheetBtn.addEventListener('click', submitPaycheckWorksheet);
    }
    
    // Currency format on blur for worksheet inputs
    ['worksheet-calculated-pay', 'worksheet-calculated-deduction', 'worksheet-calculated-final'].forEach(function (id) {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('blur', function () {
                const parsed = parseCurrency(this.value);
                if (!isNaN(parsed)) this.value = formatCurrency(parsed);
            });
        }
    });
    
    // Enter = Tab in worksheet (move to next field)
    const worksheetFocusOrder = ['worksheet-calculated-pay', 'worksheet-calculated-citations', 'worksheet-calculated-deduction', 'worksheet-calculated-final', 'submit-worksheet-btn'];
    const worksheetDiv = document.getElementById('current-paycheck-worksheet');
    if (worksheetDiv) {
        worksheetDiv.addEventListener('keydown', function (e) {
            if (e.key !== 'Enter') return;
            const id = e.target.id;
            const idx = worksheetFocusOrder.indexOf(id);
            if (idx === -1) return;
            e.preventDefault();
            const nextId = worksheetFocusOrder[idx + 1];
            if (nextId) {
                const nextEl = document.getElementById(nextId);
                if (nextEl) nextEl.focus();
            }
        });
    }
    
    const viewDepositedBtn = document.getElementById('view-deposited-paychecks-btn');
    if (viewDepositedBtn) {
        viewDepositedBtn.addEventListener('click', () => viewPaychecksModal('deposited'));
    }
    
    const viewUndepositedBtn = document.getElementById('view-undeposited-paychecks-btn');
    if (viewUndepositedBtn) {
        viewUndepositedBtn.addEventListener('click', () => viewPaychecksModal('undeposited'));
    }
    
    const marketplaceFilter = document.getElementById('marketplace-filter');
    if (marketplaceFilter) {
        marketplaceFilter.addEventListener('change', renderMarketplaceItems);
    }
    
    const createItemBtn = document.getElementById('create-item-btn');
    if (createItemBtn) {
        createItemBtn.addEventListener('click', openCreateItemModal);
    }
    
    // Admin paycheck generation
    const generatePaychecksBtn = document.getElementById('generate-paychecks-btn');
    if (generatePaychecksBtn) {
        generatePaychecksBtn.addEventListener('click', generatePaychecksForAll);
    }
}

// Generate paychecks for all students (Admin only)
async function generatePaychecksForAll() {
    if (window.currentUser.role !== 'admin') {
        showMessage('Only admins can generate paychecks', 'error');
        return;
    }
    
    const btn = document.getElementById('generate-paychecks-btn');
    const resultDiv = document.getElementById('paycheck-generation-result');
    
    if (btn) btn.disabled = true;
    if (resultDiv) {
        resultDiv.style.display = 'block';
        resultDiv.innerHTML = '<p>Generating paychecks...</p>';
    }
    
    try {
        const response = await fetch('/api/paycheck/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        
        const data = await response.json();
        
        if (response.ok) {
            if (resultDiv) {
                resultDiv.innerHTML = `<p style="color: #10b981;">${data.message}</p>`;
            }
            showMessage(data.message, 'success');
            // Refresh paycheck list for currently selected student so updated paychecks are visible
            if (currentStudentId) {
                await loadPaychecks(currentStudentId);
            }
        } else {
            if (resultDiv) {
                resultDiv.innerHTML = `<p style="color: #dc2626;">${data.error || 'Error generating paychecks'}</p>`;
            }
            showMessage(data.error || 'Error generating paychecks', 'error');
        }
    } catch (error) {
        console.error('Error generating paychecks:', error);
        if (resultDiv) {
            resultDiv.innerHTML = '<p style="color: #dc2626;">Error generating paychecks</p>';
        }
        showMessage('Error generating paychecks', 'error');
    } finally {
        if (btn) btn.disabled = false;
    }
}

// Make functions globally accessible
window.submitPaycheckWorksheet = submitPaycheckWorksheet;
window.viewPaychecksModal = viewPaychecksModal;
window.openWorksheetForPaycheck = openWorksheetForPaycheck;
window.closePaychecksModal = closePaychecksModal;
window.openPurchaseModal = openPurchaseModal;
window.closePurchaseModal = closePurchaseModal;
window.submitPurchase = submitPurchase;
window.updatePurchaseOrderStatus = updatePurchaseOrderStatus;
window.openCreateItemModal = openCreateItemModal;
window.closeCreateItemModal = closeCreateItemModal;
window.saveMarketplaceItem = saveMarketplaceItem;
window.generatePaychecksForAll = generatePaychecksForAll;

// ==================== Parent Portal Functions ====================

// Load parent's verified children
async function loadParentChildren() {
    console.log('loadParentChildren called');
    const container = document.getElementById('parent-children-container');
    const noChildrenDiv = document.getElementById('parent-no-children');
    
    if (!container) {
        console.error('parent-children-container not found');
        return;
    }
    
    try {
        console.log('Fetching children from /api/students');
        const response = await fetch('/api/students');
        if (!response.ok) {
            throw new Error(`Failed to load children: ${response.status} ${response.statusText}`);
        }
        
        const children = await response.json();
        console.log('Received children data:', children);
        
        if (!children || children.length === 0) {
            console.log('No children found');
            container.style.display = 'none';
            if (noChildrenDiv) noChildrenDiv.style.display = 'block';
            return;
        }
        
        if (noChildrenDiv) noChildrenDiv.style.display = 'none';
        container.style.display = 'block';
        
        // Format attendance status
        const formatAttendance = (status) => {
            if (!status) return '-';
            const statusMap = {
                'present': 'Present',
                'excused': 'Excused',
                'unexcused': 'Unexcused'
            };
            return statusMap[status] || status;
        };
        
        // Format STAR points
        const formatStarPoints = (starPoints) => {
            if (!starPoints || Object.values(starPoints).every(v => v === null)) {
                return '-';
            }
            const parts = [];
            if (starPoints.s !== null) parts.push(`S: ${starPoints.s}%`);
            if (starPoints.t !== null) parts.push(`T: ${starPoints.t}%`);
            if (starPoints.a !== null) parts.push(`A: ${starPoints.a}%`);
            if (starPoints.r !== null) parts.push(`R: ${starPoints.r}%`);
            return parts.length > 0 ? parts.join(', ') : '-';
        };
        
        // Build table HTML
        let tableHTML = `
            <table class="parent-children-table">
                <thead>
                    <tr>
                        <th>Name</th>
                        <th>Grade</th>
                        <th>Verification Status</th>
                        <th>Attendance</th>
                        <th>STAR Points</th>
                        <th>Infractions</th>
                        <th>Frenzy Events</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
        `;
        
        children.forEach(child => {
            const verificationBadge = child.verified 
                ? '<span class="verification-badge verified">Verified</span>'
                : '<span class="verification-badge unverified">Not Verified</span>';
            
            tableHTML += `
                <tr>
                    <td>${child.name || 'Unknown'}</td>
                    <td>${child.grade || '-'}</td>
                    <td>${verificationBadge}</td>
                    <td>${formatAttendance(child.attendance)}</td>
                    <td>${formatStarPoints(child.star_points)}</td>
                    <td>${child.infractions_count || 0}</td>
                    <td>${child.frenzy_count || 0}</td>
                    <td class="actions-cell">
                        <button onclick="viewChildRecords(${child.id})" class="btn-secondary" style="padding: 6px 12px; font-size: 12px; margin: 2px;">View Records</button>
                        <button onclick="openAmendmentRequestModal(${child.id})" class="btn-secondary" style="padding: 6px 12px; font-size: 12px; margin: 2px;">Request Amendment</button>
                    </td>
                </tr>
            `;
        });
        
        tableHTML += `
                </tbody>
            </table>
        `;
        
        container.innerHTML = tableHTML;
        console.log('Parent children table rendered successfully');
    } catch (error) {
        console.error('Error loading children:', error);
        container.innerHTML = '<p style="color: #dc2626;">Error loading children. Please try again.</p>';
    }
}

// View child's records (switch to summary view)
function viewChildRecords(studentId) {
    if (document.getElementById('summary-student-select')) {
        document.getElementById('summary-student-select').value = studentId;
    }
    const student = (allStudents || []).find(s => s.id === studentId);
    if (student && dashboardState) {
        dashboardState.summary.studentId = studentId;
        dashboardState.summary.studentName = student.name;
        updateContextBanner('summary');
    }
    switchView('summary');
    setTimeout(() => triggerDashboardLoad('summary'), 100);
}

// Open amendment request modal
function openAmendmentRequestModal(studentId = null) {
    const modal = document.getElementById('amendment-request-modal');
    if (!modal) return;
    
    // Clear previous values
    document.getElementById('amendment-request-error').style.display = 'none';
    document.getElementById('amendment-request-success').style.display = 'none';
    document.getElementById('amendment-student-select').value = studentId || '';
    document.getElementById('amendment-record-type').value = '';
    document.getElementById('amendment-record-id').value = '';
    document.getElementById('amendment-current-value').value = '';
    document.getElementById('amendment-requested-change').value = '';
    document.getElementById('amendment-reason').value = '';
    
    // Load students into dropdown
    loadAmendmentStudents();
    
    modal.style.display = 'block';
}

function closeAmendmentRequestModal() {
    const modal = document.getElementById('amendment-request-modal');
    if (modal) modal.style.display = 'none';
}

// Load students for amendment request dropdown
async function loadAmendmentStudents() {
    const select = document.getElementById('amendment-student-select');
    if (!select) return;
    
    try {
        const response = await fetch('/api/students');
        if (!response.ok) return;
        
        const students = await response.json();
        select.innerHTML = '<option value="">Select Student</option>' +
            students.map(s => `<option value="${s.id}">${s.name || 'Unknown'}</option>`).join('');
    } catch (error) {
        console.error('Error loading students:', error);
    }
}

// Submit amendment request
async function submitAmendmentRequest() {
    const studentId = parseInt(document.getElementById('amendment-student-select').value);
    const recordType = document.getElementById('amendment-record-type').value;
    const recordId = document.getElementById('amendment-record-id').value;
    const currentValue = document.getElementById('amendment-current-value').value.trim();
    const requestedChange = document.getElementById('amendment-requested-change').value.trim();
    const reason = document.getElementById('amendment-reason').value.trim();
    
    const errorDiv = document.getElementById('amendment-request-error');
    const successDiv = document.getElementById('amendment-request-success');
    
    // Validation
    if (!studentId || !recordType || !currentValue || !requestedChange || !reason) {
        errorDiv.textContent = 'Please fill in all required fields';
        errorDiv.style.display = 'block';
        return;
    }
    
    try {
        const response = await fetch('/api/amendment-requests', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                student_id: studentId,
                record_type: recordType,
                record_id: recordId || null,
                current_value: currentValue,
                requested_change: requestedChange,
                reason: reason
            })
        });
        
        if (response.ok) {
            successDiv.textContent = 'Amendment request submitted successfully. The school will review your request.';
            successDiv.style.display = 'block';
            errorDiv.style.display = 'none';
            
            // Clear form
            setTimeout(() => {
                closeAmendmentRequestModal();
            }, 2000);
        } else {
            const data = await response.json();
            errorDiv.textContent = data.error || 'Error submitting request';
            errorDiv.style.display = 'block';
            successDiv.style.display = 'none';
        }
    } catch (error) {
        console.error('Error submitting amendment request:', error);
        errorDiv.textContent = 'Error submitting request. Please try again.';
        errorDiv.style.display = 'block';
        successDiv.style.display = 'none';
    }
}

// Toggle directory information opt-out
async function toggleDirectoryOptOut(studentId, optOut) {
    try {
        const method = optOut ? 'POST' : 'DELETE';
        const response = await fetch(`/api/students/${studentId}/directory-opt-out`, {
            method: method,
            headers: { 'Content-Type': 'application/json' }
        });
        
        if (response.ok) {
            const data = await response.json();
            showMessage(data.message || `Directory information opt-${optOut ? 'out' : 'in'} successful`, 'success');
        } else {
            const data = await response.json();
            showMessage(data.error || 'Error updating directory information preference', 'error');
            // Revert checkbox
            const checkbox = document.getElementById(`directory-opt-out-${studentId}`);
            if (checkbox) checkbox.checked = !optOut;
        }
    } catch (error) {
        console.error('Error toggling directory opt-out:', error);
        showMessage('Error updating directory information preference', 'error');
        // Revert checkbox
        const checkbox = document.getElementById(`directory-opt-out-${studentId}`);
        if (checkbox) checkbox.checked = !optOut;
    }
}

// Export child's data
async function exportChildData(studentId) {
    try {
        const response = await fetch(`/api/export-student-data/${studentId}`);
        if (!response.ok) {
            throw new Error('Failed to export data');
        }
        
        const data = await response.json();
        
        // Create download
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `student-data-${studentId}-${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        showMessage('Data exported successfully', 'success');
    } catch (error) {
        console.error('Error exporting data:', error);
        showMessage('Error exporting data. Please try again.', 'error');
    }
}

// ============================================================
//  DASHBOARD — Search, Filters, Card Rendering
// ============================================================

const DASHBOARD_COLORS = {
    // STAR Performance bar colors (modern palette, same base: red, blue, green, yellow)
    safety: '#EF4444',         // red
    teamwork: '#3B82F6',       // blue
    accountability: '#10B981', // green (emerald)
    relationships: '#FACC15',  // yellow (reverted from warm gold)
    palette: ['#EF4444', '#3B82F6', '#10B981', '#FACC15', '#A78BFA', '#F472B6', '#38BDF8', '#4ADE80']
};

// Translucent bar colors for STAR Performance chart (same hues, less bold)
const STAR_CHART_BAR_COLORS = [
    'rgba(239, 68, 68, 0.65)',   // safety red
    'rgba(59, 130, 246, 0.65)',  // teamwork blue
    'rgba(16, 185, 129, 0.65)',  // accountability green
    'rgba(250, 204, 21, 0.65)'   // relationships yellow
];

// ---- State ----
let dashboardState = {
    summary: { studentId: null, studentName: null, staffId: null, staffName: null, period: '30day', compareMode: false, customStart: null, customEnd: null },
    frenzy:  { studentId: null, studentName: null, staffId: null, staffName: null, period: '30day', compareMode: false, customStart: null, customEnd: null }
};

let summaryChartInstance = null;
let frenzyChartInstance = null;

// ---- Input hardening to resist password managers on search fields ----
function hardenSearchInput(input) {
    if (!input) return;
    try {
        input.setAttribute('autocomplete', 'off');
        input.setAttribute('autocapitalize', 'off');
        input.setAttribute('autocorrect', 'off');
        input.setAttribute('spellcheck', 'false');

        if (!input.hasAttribute('readonly')) {
            input.setAttribute('readonly', '');
        }

        input.addEventListener('focus', () => {
            if (input.hasAttribute('readonly')) {
                input.removeAttribute('readonly');
            }
        });

        let userInteracted = false;
        ['keydown', 'mousedown', 'touchstart'].forEach(evt => {
            input.addEventListener(evt, () => {
                userInteracted = true;
            }, { once: true });
        });

        const clearIfInjected = () => {
            if (!userInteracted && input.value && !input.dataset.allowPrefill) {
                input.value = '';
            }
        };

        setTimeout(clearIfInjected, 600);
        input.addEventListener('blur', clearIfInjected);
    } catch (e) {
        console.error('Error hardening search input:', e);
    }
}

// ---- Autocomplete Search ----
function setupDashboardSearch(prefix, type) {
    const input = document.getElementById(`${prefix}-${type}-search`);
    const dropdown = document.getElementById(`${prefix}-${type}-dropdown`);
    if (!input || !dropdown) return;

    // Extra protection against browser/password‑manager autofill on dashboard searches
    hardenSearchInput(input);

    let debounceTimer = null;
    let attemptedLoadData = false;

    input.addEventListener('input', async () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(async () => {
            const q = input.value.trim().toLowerCase();
            if (q.length < 1) { dropdown.classList.remove('active'); return; }
            let list = type === 'student' ? (allStudents || []) : (allStaffMembers || []);

            // Fallback: if we have no data yet, try to load it once
            if (list.length === 0 && !attemptedLoadData) {
                attemptedLoadData = true;
                try {
                    if (type === 'student' && typeof loadStudents === 'function') {
                        await loadStudents();
                        list = allStudents || [];
                    } else if (type === 'staff' && typeof loadUsers === 'function') {
                        await loadUsers();
                        list = allStaffMembers || [];
                    }
                } catch (e) {
                    console.error('Error loading data for dashboard search:', e);
                }
            }

            const matches = list.filter(item => {
                const name = (item.name || '').toLowerCase();
                const uname = (item.username || '').toLowerCase();
                return name.includes(q) || uname.includes(q);
            }).slice(0, 12);
            if (matches.length === 0) { dropdown.classList.remove('active'); return; }
            dropdown.innerHTML = matches.map(item => {
                const label = item.name || item.username;
                const meta = type === 'staff' ? (item.designation || item.role || '') : '';
                return `<div class="dashboard-search-option" data-id="${item.id}" data-name="${label}" data-type="${type}">
                    <span class="search-label">${escapeHtml(label)}</span>
                    ${meta ? `<span class="search-meta">${escapeHtml(meta)}</span>` : ''}
                </div>`;
            }).join('');
            dropdown.classList.add('active');
        }, 150);
    });

    dropdown.addEventListener('click', (e) => {
        const opt = e.target.closest('.dashboard-search-option');
        if (!opt) return;
        const id = parseInt(opt.dataset.id);
        const name = opt.dataset.name;
        input.value = name;
        dropdown.classList.remove('active');
        const page = prefix.replace('-student', '').replace('-staff', '');
        const pageKey = prefix.startsWith('summary') ? 'summary' : 'frenzy';
        if (type === 'student') {
            dashboardState[pageKey].studentId = id;
            dashboardState[pageKey].studentName = name;
            const hiddenSelect = document.getElementById(`${pageKey}-student-select`);
            if (hiddenSelect) hiddenSelect.value = id;
            // When selecting a student, clear any existing staff filter so the context
            // represents the latest selection (student-only).
            dashboardState[pageKey].staffId = null;
            dashboardState[pageKey].staffName = null;
            const staffSearchInput = document.getElementById(`${pageKey}-staff-search`);
            if (staffSearchInput) staffSearchInput.value = '';
        } else {
            dashboardState[pageKey].staffId = id;
            dashboardState[pageKey].staffName = name;
            // When selecting a staff member, clear any existing student filter so the context
            // represents the latest selection (staff's students).
            dashboardState[pageKey].studentId = null;
            dashboardState[pageKey].studentName = null;
            const studentSearchInput = document.getElementById(`${pageKey}-student-search`);
            if (studentSearchInput) studentSearchInput.value = '';
            const hiddenSelect = document.getElementById(`${pageKey}-student-select`);
            if (hiddenSelect) hiddenSelect.value = '';
        }
        updateContextBanner(pageKey);
        // When a dashboard (summary/frenzy) search is committed, clear "managed by me" so it does not persist across searches.
        const managedCheckbox = document.getElementById(`${pageKey}-managed-by-me-checkbox`);
        if (managedCheckbox && managedCheckbox.checked) {
            managedCheckbox.checked = false;
        }
        triggerDashboardLoad(pageKey);
    });

    input.addEventListener('focus', () => {
        if (dropdown.children.length > 0 && input.value.trim().length > 0) {
            dropdown.classList.add('active');
        }
    });

    document.addEventListener('click', (e) => {
        if (!e.target.closest(`#${prefix}-${type}-search-wrap`)) {
            dropdown.classList.remove('active');
        }
    });

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            dropdown.classList.remove('active');
            return;
        }

        if (e.key === 'Enter') {
            e.preventDefault();
            const q = input.value.trim().toLowerCase();
            if (!q) return;
            const list = type === 'student' ? (allStudents || []) : (allStaffMembers || []);
            const matches = list.filter(item => {
                const name = (item.name || '').toLowerCase();
                const uname = (item.username || '').toLowerCase();
                return name.includes(q) || uname.includes(q);
            }).slice(0, 12);
            if (matches.length === 0) return;

            const match = matches[0];
            const id = parseInt(match.id);
            const name = match.name || match.username;
            const pageKey = prefix.startsWith('summary') ? 'summary' : 'frenzy';

            input.value = name;
            dropdown.classList.remove('active');

            if (type === 'student') {
                dashboardState[pageKey].studentId = id;
                dashboardState[pageKey].studentName = name;
                const hiddenSelect = document.getElementById(`${pageKey}-student-select`);
                if (hiddenSelect) hiddenSelect.value = id;
                // Enter-based student search should also clear any existing staff context.
                dashboardState[pageKey].staffId = null;
                dashboardState[pageKey].staffName = null;
                const staffSearchInput = document.getElementById(`${pageKey}-staff-search`);
                if (staffSearchInput) staffSearchInput.value = '';
            } else {
                dashboardState[pageKey].staffId = id;
                dashboardState[pageKey].staffName = name;
                // Enter-based staff search should clear any existing student context.
                dashboardState[pageKey].studentId = null;
                dashboardState[pageKey].studentName = null;
                const studentSearchInput = document.getElementById(`${pageKey}-student-search`);
                if (studentSearchInput) studentSearchInput.value = '';
                const hiddenSelect = document.getElementById(`${pageKey}-student-select`);
                if (hiddenSelect) hiddenSelect.value = '';
            }
            updateContextBanner(pageKey);
            // When a dashboard (summary/frenzy) search is committed via Enter, clear "managed by me" so it does not persist across searches.
            const managedCheckbox = document.getElementById(`${pageKey}-managed-by-me-checkbox`);
            if (managedCheckbox && managedCheckbox.checked) {
                managedCheckbox.checked = false;
            }
            triggerDashboardLoad(pageKey);
            return;
        }

        if (e.key === 'Backspace' && input.value.length <= 1) {
            const pageKey = prefix.startsWith('summary') ? 'summary' : 'frenzy';
            if (type === 'student') {
                dashboardState[pageKey].studentId = null;
                dashboardState[pageKey].studentName = null;
                const hiddenSelect = document.getElementById(`${pageKey}-student-select`);
                if (hiddenSelect) hiddenSelect.value = '';
            } else {
                dashboardState[pageKey].staffId = null;
                dashboardState[pageKey].staffName = null;
            }
            updateContextBanner(pageKey);
        }
    });
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function updateContextBanner(pageKey) {
    const banner = document.getElementById(`${pageKey}-context-banner`);
    const label = document.getElementById(`${pageKey}-context-label`);
    if (!banner || !label) return;
    const st = dashboardState[pageKey];
    if (st.studentName || st.staffName) {
        let text = '';
        if (st.staffName) text = `${st.staffName}'s Students`;
        if (st.studentName) text = st.studentName;
        if (st.staffName && st.studentName) text = `${st.studentName} (via ${st.staffName})`;
        label.textContent = text;
        banner.classList.add('active');
    } else {
        banner.classList.remove('active');
    }
}

// ---- Filter controls (dropdown for Summary + Frenzy reports; pills elsewhere) ----
function setupFilterPills(pageKey) {
    const container = document.getElementById(`${pageKey}-filter-pills`);
    if (!container) return;

    const dropdown = container.querySelector('.dashboard-period-select');

    // Dropdown-based timeframe (Point Card + Frenzy reports)
    if (dropdown && (pageKey === 'summary' || pageKey === 'frenzy')) {
        const customWrap = pageKey === 'summary' ? document.getElementById('summary-custom-range') : null;
        const startInput = pageKey === 'summary' ? document.getElementById('summary-custom-start') : null;
        const endInput = pageKey === 'summary' ? document.getElementById('summary-custom-end') : null;

        const resetCompare = () => {
            dashboardState[pageKey].compareMode = false;
            const compareToggle = document.getElementById(`${pageKey}-compare-toggle`);
            if (compareToggle) compareToggle.classList.remove('active');
            const compareControls = document.getElementById(`${pageKey}-compare-controls`);
            if (compareControls) compareControls.classList.remove('active');
        };

        const maybeTriggerCustomLoad = () => {
            if (!startInput || !endInput) return;
            const start = startInput.value;
            const end = endInput.value;
            if (!start || !end) return;
            if (start > end) return;
            dashboardState[pageKey].period = 'custom_range';
            dashboardState[pageKey].customStart = start;
            dashboardState[pageKey].customEnd = end;
            resetCompare();
            triggerDashboardLoad(pageKey);
        };

        dropdown.addEventListener('change', () => {
            const value = dropdown.value;
            if (value === 'custom_range') {
                if (customWrap) customWrap.style.display = 'flex';
                // Defer load until user selects both dates
                dashboardState[pageKey].period = null;
                dashboardState[pageKey].customStart = null;
                dashboardState[pageKey].customEnd = null;
                resetCompare();
                const legacyHidden = document.getElementById(`${pageKey}-period-select`);
                if (legacyHidden) legacyHidden.value = '';
            } else {
                if (customWrap) customWrap.style.display = 'none';
                dashboardState[pageKey].period = value;
                dashboardState[pageKey].customStart = null;
                dashboardState[pageKey].customEnd = null;
                resetCompare();
                const legacyHidden = document.getElementById(`${pageKey}-period-select`);
                if (legacyHidden && value !== 'custom_range') legacyHidden.value = value;
                triggerDashboardLoad(pageKey);
            }
        });

        if (startInput && endInput) {
            startInput.addEventListener('change', maybeTriggerCustomLoad);
            endInput.addEventListener('change', maybeTriggerCustomLoad);
        }

        // Initialize state from default dropdown value
        if (dropdown.value && dropdown.value !== 'custom_range') {
            dashboardState[pageKey].period = dropdown.value;
            const legacyHidden = document.getElementById(`${pageKey}-period-select`);
            if (legacyHidden) legacyHidden.value = dropdown.value;
        }
        return;
    }

    // Existing pill-based filters (legacy / other views)
    container.addEventListener('click', (e) => {
        const pill = e.target.closest('.dashboard-pill');
        if (!pill) return;
        container.querySelectorAll('.dashboard-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        dashboardState[pageKey].period = pill.dataset.period;
        dashboardState[pageKey].compareMode = false;
        const compareToggle = document.getElementById(`${pageKey}-compare-toggle`);
        if (compareToggle) compareToggle.classList.remove('active');
        const compareControls = document.getElementById(`${pageKey}-compare-controls`);
        if (compareControls) compareControls.classList.remove('active');
        triggerDashboardLoad(pageKey);
    });
}

function setupCompareToggle(pageKey) {
    const toggle = document.getElementById(`${pageKey}-compare-toggle`);
    const controls = document.getElementById(`${pageKey}-compare-controls`);
    if (!toggle || !controls) return;
    toggle.addEventListener('click', () => {
        const isActive = toggle.classList.toggle('active');
        controls.classList.toggle('active', isActive);
        dashboardState[pageKey].compareMode = isActive;
        if (!isActive) {
            triggerDashboardLoad(pageKey);
        }
    });
    const select = controls.querySelector('select');
    const customRangeContainer = document.getElementById(`${pageKey}-custom-range-controls`);
    const customStartInput = controls.querySelector('input[data-role="custom-start"]');
    const customEndInput = controls.querySelector('input[data-role="custom-end"]');
    const customError = controls.querySelector('.dashboard-custom-error');

    const handleCustomRangeVisibility = () => {
        if (!customRangeContainer) return;
        const useCustom = select && select.value === 'custom_range';
        customRangeContainer.style.display = useCustom ? 'flex' : 'none';
        if (!useCustom && customError) customError.textContent = '';
        if (!useCustom && dashboardState[pageKey]) {
            dashboardState[pageKey].customStart = null;
            dashboardState[pageKey].customEnd = null;
        }
    };

    if (select) {
        select.addEventListener('change', () => {
            if (select.value === 'custom_range' && pageKey === 'summary') {
                handleCustomRangeVisibility();
                // Wait for both dates before triggering load
                return;
            }
            handleCustomRangeVisibility();
            if (select.value) triggerDashboardLoad(pageKey);
        });
    }

    const maybeTriggerCustomRangeLoad = () => {
        if (!select || select.value !== 'custom_range') return;
        if (!customStartInput || !customEndInput) return;
        const start = customStartInput.value;
        const end = customEndInput.value;
        if (!start || !end) return;
        if (new Date(start) > new Date(end)) {
            if (customError) customError.textContent = 'Start date must be on or before end date.';
            return;
        }
        if (customError) customError.textContent = '';
        if (dashboardState[pageKey]) {
            dashboardState[pageKey].customStart = start;
            dashboardState[pageKey].customEnd = end;
        }
        triggerDashboardLoad(pageKey);
    };

    if (customStartInput && customEndInput) {
        customStartInput.addEventListener('change', maybeTriggerCustomRangeLoad);
        customEndInput.addEventListener('change', maybeTriggerCustomRangeLoad);
    }
}

// ---- Incentive Tracking Toggle (Summary / Point Card) ----
function setupIncentiveToggle() {
    const toggle = document.getElementById('summary-incentive-toggle');
    const controls = document.getElementById('summary-incentive-controls');
    if (!toggle || !controls) return;

    const startInput = document.getElementById('incentive-start-date');
    const endInput = document.getElementById('incentive-end-date');
    const generateBtn = document.getElementById('incentive-generate-btn');
    const errorEl = document.getElementById('incentive-error');

    const clearError = () => {
        if (errorEl) errorEl.textContent = '';
    };

    const disableCompareMode = () => {
        const compareToggle = document.getElementById('summary-compare-toggle');
        const compareControls = document.getElementById('summary-compare-controls');
        if (compareToggle) compareToggle.classList.remove('active');
        if (compareControls) compareControls.classList.remove('active');
        if (dashboardState && dashboardState.summary) {
            dashboardState.summary.compareMode = false;
        }
    };

    toggle.addEventListener('click', () => {
        const isActive = toggle.classList.toggle('active');
        controls.classList.toggle('active', isActive);
        clearError();

        if (isActive) {
            disableCompareMode();
        } else {
            // When leaving Incentive mode, return to normal summary view
            triggerDashboardLoad('summary');
        }
    });

    const validateDates = () => {
        if (!startInput || !endInput) return null;
        const start = startInput.value;
        const end = endInput.value;
        if (!start || !end) {
            if (errorEl) errorEl.textContent = 'Please select both start and end dates.';
            return null;
        }
        if (new Date(start) > new Date(end)) {
            if (errorEl) errorEl.textContent = 'Start date must be on or before end date.';
            return null;
        }
        clearError();
        return { start, end };
    };

    if (generateBtn) {
        generateBtn.addEventListener('click', async () => {
            const range = validateDates();
            if (!range) return;
            await loadIncentiveTracking(range.start, range.end);
        });
    }
}

async function loadIncentiveTracking(startDate, endDate) {
    const container = document.getElementById('summary-results');
    if (!container) return;

    container.innerHTML = '<div class="dashboard-loading"><div class="dashboard-spinner"></div><p>Loading incentive tracking...</p></div>';

    try {
        const st = dashboardState.summary || {};
        const params = [];
        if (startDate) params.push(`start_date=${encodeURIComponent(startDate)}`);
        if (endDate) params.push(`end_date=${encodeURIComponent(endDate)}`);
        if (st.studentId) params.push(`student_id=${st.studentId}`);
        if (st.staffId) params.push(`staff_id=${st.staffId}`);
        const managedCheckbox = document.getElementById('summary-managed-by-me-checkbox');
        if (managedCheckbox && managedCheckbox.checked) params.push('managed_by_me=true');

        const url = '/api/incentive-tracking?' + params.join('&');
        const response = await fetch(url);
        const data = await response.json();
        if (!response.ok) {
            const msg = data && data.error ? data.error : 'Error loading incentive tracking data.';
            container.innerHTML = `<div class="dashboard-empty"><p>${msg}</p></div>`;
            return;
        }

        const formatRangeLabel = () => {
            if (!startDate || !endDate) return 'All available data';
            return `${startDate} to ${endDate}`;
        };

        const buildTable = (rows, title, description) => {
            if (!rows || rows.length === 0) {
                return `
                    <div class="summary-card" style="display:inline-block; width:max-content; max-width:100%;">
                        <h3>${title}</h3>
                        <p style="margin-bottom: 10px; color: var(--text-secondary);">${description}</p>
                        <p style="color: var(--text-secondary); font-size: 0.9rem;">No students met this threshold in the selected range.</p>
                    </div>
                `;
            }
            const bodyRows = rows.map(s => `
                <tr>
                    <td>${s.name}</td>
                    <td style="text-transform: capitalize;">${s.card_color || ''}</td>
                    <td style="text-align:right;">${s.average_percent.toFixed(1)}%</td>
                </tr>
            `).join('');
            return `
                <div class="summary-card" style="display:inline-block; width:max-content; max-width:100%;">
                    <h3>${title}</h3>
                    <p style="margin-bottom: 10px; color: var(--text-secondary);">${description}</p>
                    <div style="overflow-x:auto; margin-top: 10px; display:inline-block;">
                        <table style="width:auto; min-width:0; table-layout:auto; display:inline-table;">
                            <thead>
                                <tr>
                                    <th style="white-space:nowrap;">Student</th>
                                    <th style="white-space:nowrap;">Card</th>
                                    <th style="text-align:right; white-space:nowrap;">Average %</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${bodyRows}
                            </tbody>
                        </table>
                    </div>
                </div>
            `;
        };

        const rangeLabel = formatRangeLabel();
        const headerCard = `
            <div class="summary-card" style="display:inline-block; width:max-content; max-width:100%;">
                <h3>Incentive Tracking (${rangeLabel})</h3>
                <p style="margin-top: 6px; color: var(--text-secondary); font-size: 0.9rem;">
                    Shows students who meet incentive thresholds based on their overall point card averages
                    within the selected date range.
                </p>
            </div>
        `;

        const yellowCardBlock = buildTable(
            data.yellow_students || [],
            'Yellow Card (≥ 85%)',
            'Students with a yellow card whose overall point card average is at least 85% in this date range.'
        );
        const greenCardBlock = buildTable(
            data.green_students || [],
            'Green Card (≥ 90%)',
            'Students with a green card whose overall point card average is at least 90% in this date range.'
        );
        const blueCardBlock = buildTable(
            data.blue_students || [],
            'Blue Card (≥ 90%)',
            'Students with a blue card whose overall point card average is at least 90% in this date range.'
        );

        container.innerHTML = headerCard + yellowCardBlock + greenCardBlock + blueCardBlock;

        // Hide raw point card data cards if visible
        const pcContainer = document.getElementById('point-card-data-container');
        if (pcContainer) pcContainer.style.display = 'none';
    } catch (err) {
        console.error('Error loading incentive tracking:', err);
        const container = document.getElementById('summary-results');
        if (container) {
            container.innerHTML = `<div class="dashboard-empty"><p>Error loading incentive tracking: ${err.message}</p></div>`;
        }
    }
}

function setupContextClear(pageKey) {
    const clearBtn = document.getElementById(`${pageKey}-context-clear`);
    if (!clearBtn) return;
    clearBtn.addEventListener('click', () => {
        dashboardState[pageKey].studentId = null;
        dashboardState[pageKey].studentName = null;
        dashboardState[pageKey].staffId = null;
        dashboardState[pageKey].staffName = null;
        const studentSearch = document.getElementById(`${pageKey}-student-search`);
        const staffSearch = document.getElementById(`${pageKey}-staff-search`);
        if (studentSearch) studentSearch.value = '';
        if (staffSearch) staffSearch.value = '';
        const hiddenSelect = document.getElementById(`${pageKey}-student-select`);
        if (hiddenSelect) hiddenSelect.value = '';
        updateContextBanner(pageKey);
        triggerDashboardLoad(pageKey);
    });
}

// ---- Load Trigger ----
function syncSummaryPointCardButton() {
    const btn = document.getElementById('show-point-card-btn');
    if (!btn || typeof dashboardState === 'undefined' || !dashboardState.summary) return;
    const st = dashboardState.summary;
    const pc = document.getElementById('point-card-data-container');
    if (st.studentId) {
        btn.classList.remove('is-inactive');
        btn.dataset.studentId = String(st.studentId);
        const tf = st.compareMode
            ? ((document.getElementById('quarter-select') || {}).value || 'alltime')
            : (st.period === 'all_time' ? 'alltime' : (st.period || '30day'));
        btn.dataset.timeframe = tf;
    } else {
        btn.classList.add('is-inactive');
        delete btn.dataset.studentId;
        delete btn.dataset.timeframe;
        btn.textContent = 'View Past Point Cards';
        if (pc) pc.style.display = 'none';
    }
}

function triggerDashboardLoad(pageKey) {
    if (pageKey === 'summary') loadSummaryDashboard();
    else loadFrenzyDashboard();
}

// ---- Summary Dashboard ----
async function loadSummaryDashboard() {
    const st = dashboardState.summary;
    const container = document.getElementById('summary-results');
    if (!container) return;

    container.innerHTML = '<div class="dashboard-loading"><div class="dashboard-spinner"></div><p>Loading summary...</p></div>';

    const quarterDates = typeof loadQuarterDates === 'function' ? loadQuarterDates() : {};
    const schoolYearDates = typeof loadSchoolYearDates === 'function' ? loadSchoolYearDates() : {};
    const quarterDatesForBackend = typeof convertQuarterDatesForBackend === 'function' ? convertQuarterDatesForBackend(quarterDates) : {};
    const schoolYearDatesForBackend = typeof convertSchoolYearDatesForBackend === 'function' ? convertSchoolYearDatesForBackend(schoolYearDates) : {};

    const params = [];
    if (st.compareMode) {
        const selectEl = document.getElementById('quarter-select');
        const tf = selectEl ? selectEl.value : '';
        if (tf) {
            params.push(`timeframe=${tf}`);
            if (tf === 'month') {
                const sySelect = document.getElementById('summary-school-year-select');
                const sy = sySelect ? sySelect.value : (typeof getCurrentSchoolYear === 'function' ? getCurrentSchoolYear() : '');
                if (sy) params.push(`school_year=${encodeURIComponent(sy)}`);
            } else if (tf === 'custom_range') {
                const start = st.customStart;
                const end = st.customEnd;
                if (start && end) {
                    params.push(`start_date=${encodeURIComponent(start)}`);
                    params.push(`end_date=${encodeURIComponent(end)}`);
                }
            }
        }
    } else {
        if (st.period) params.push(`period=${encodeURIComponent(st.period)}`);
    }
    if (st.studentId) params.push(`student_id=${st.studentId}`);
    if (st.staffId) params.push(`staff_id=${st.staffId}`);
    const managedCheckbox = document.getElementById('summary-managed-by-me-checkbox');
    if (managedCheckbox && managedCheckbox.checked) params.push('managed_by_me=true');
    params.push(`quarter_dates=${encodeURIComponent(JSON.stringify(quarterDatesForBackend))}`);
    params.push(`school_year_dates=${encodeURIComponent(JSON.stringify(schoolYearDatesForBackend))}`);

    const url = '/api/summary?' + params.join('&');

    try {
        const response = await fetch(url);
        const data = await response.json();
        window.currentSummaryData = data;

        const printBtn = document.getElementById('print-summary-btn');
        if (printBtn) printBtn.disabled = false;

        if (data.comparison_mode && data.periods) {
            renderSummaryComparison(container, data);
        } else {
            renderSummarySingle(container, data);
        }
        syncSummaryPointCardButton();
    } catch (err) {
        container.innerHTML = `<div class="dashboard-empty"><p>Error loading summary: ${err.message}</p></div>`;
        syncSummaryPointCardButton();
    }
}

function bucketInfractionsOverview(infractions) {
    const raw = infractions || {};
    const out = { Safety: 0, Task: 0, Attention: 0, Social: 0 };
    for (const [type, count] of Object.entries(raw)) {
        const n = Number(count) || 0;
        const label = String(type || '');
        let bucket = 'Social';
        if (/aggression|property|sexual|threat|^walk$/i.test(label) || /harmful/i.test(label)) bucket = 'Safety';
        else if (/disrespect/i.test(label)) bucket = 'Safety';
        else if (/off\s*task|attention\s*seeking|shutdown|refusal/i.test(label)) bucket = 'Attention';
        else if (/nfd|self\s*control|^task/i.test(label)) bucket = 'Task';
        else if (/lang|volume|myob|personal/i.test(label)) bucket = 'Social';
        out[bucket] += n;
    }
    return out;
}

function formatOverviewSignedInt(n) {
    if (n == null || Number.isNaN(Number(n))) return '';
    const v = Number(n);
    if (v > 0) return `+${v}`;
    return String(v);
}

function overviewTrendDeltaClass(metric, delta) {
    if (delta == null || Number.isNaN(Number(delta))) return 'overview-trend-line-neutral';
    const v = Number(delta);
    if (metric === 'infractions' || metric === 'reminders' || metric === 'resets') {
        if (v < 0) return 'overview-trend-line-pos';
        if (v > 0) return 'overview-trend-line-neg';
    }
    return 'overview-trend-line-neutral';
}

function collectOverviewTimeSlots(byTimeByDay) {
    const hints = ['AM Bus', '9:00', '10:30', '12:00', '1:30', 'PM Bus'];
    const pool = new Set();
    Object.values(byTimeByDay || {}).forEach(tm => {
        Object.keys(tm || {}).forEach(k => pool.add(k));
    });
    let arr = [...pool];
    const ordered = [];
    hints.forEach(h => {
        const idx = arr.findIndex(k =>
            k === h || k.includes(h) || (h.length <= 4 && k.startsWith(h)));
        if (idx >= 0) {
            ordered.push(arr[idx]);
            arr = arr.filter((_, i) => i !== idx);
        }
    });
    arr.sort((a, b) => a.localeCompare(b));
    return ordered.concat(arr);
}

function overviewHeatmapMeta(byTimeByDay) {
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
    const timeSlots = collectOverviewTimeSlots(byTimeByDay);
    let maxInf = 0;
    let worst = null;
    let bestOv = -1;
    let best = null;
    days.forEach(day => {
        const tm = (byTimeByDay || {})[day] || {};
        timeSlots.forEach(timeLabel => {
            const cell = tm[timeLabel];
            if (!cell) return;
            const inf = cell.total_infractions || 0;
            const ov = typeof cell.percentages?.overall === 'number' ? cell.percentages.overall : null;
            if (inf > maxInf) {
                maxInf = inf;
                worst = { day, timeLabel };
            }
            if (ov != null && ov > bestOv) {
                bestOv = ov;
                best = { day, timeLabel };
            }
        });
    });
    return { days, timeSlots, maxInf: maxInf || 1, worst, best };
}

function overviewHeatColor(cell, maxInf) {
    const inf = cell?.total_infractions || 0;
    const ov = typeof cell?.percentages?.overall === 'number' ? cell.percentages.overall : null;
    let t = 0;
    if (maxInf > 0) t = Math.min(1, inf / maxInf);
    else if (ov != null) t = Math.min(1, (100 - ov) / 100);
    const r = Math.round(34 + t * (239 - 34));
    const g = Math.round(197 + t * (68 - 197));
    const b = Math.round(94 + t * (68 - 94));
    return `rgb(${r},${g},${b})`;
}

function overviewDayInitial(day) {
    const m = { Monday: 'M', Tuesday: 'T', Wednesday: 'W', Thursday: 'Th', Friday: 'F' };
    return m[day] || (day || '').slice(0, 2);
}

function buildBehaviorTrendCardHtml() {
    return `
        <div class="dashboard-card behavior-trend-card reports-trend-card" data-summary-card="behavior-trend">
            <div class="behavior-trend-controls">
                <div class="behavior-trend-title-line">
                    <select id="summary-trend-metric" aria-label="Trend metric">
                        <option value="overall" selected>STAR Performance</option>
                        <option value="safety">Safety</option>
                        <option value="teamwork">Teamwork</option>
                        <option value="accountability">Accountability</option>
                        <option value="relationships">Relationships</option>
                    </select>
                    <select id="summary-trend-aggregation" aria-label="Trend aggregation">
                        <option value="average" selected>Average</option>
                    </select>
                    <span>trend over</span>
                    <select id="summary-trend-window" aria-label="Trend window">
                        <option value="30day" selected>30 School Days</option>
                    </select>
                    <button type="button" class="behavior-trend-compare-btn" id="summary-trend-compare-btn">Compare</button>
                </div>
            </div>
            <div class="behavior-trend-timeline" id="summary-behavior-trend-body">
                <div class="behavior-trend-empty">Loading trend data...</div>
            </div>
        </div>`;
}

function getSummaryTrendFetchRange() {
    const st = dashboardState.summary || {};
    const period = st.period || '30day';
    if (period === 'custom_range' && st.customStart && st.customEnd) {
        return { start: st.customStart, end: st.customEnd };
    }

    const today = new Date();
    const end = today.toISOString().split('T')[0];
    let lookbackDays = 120;
    if (period === 'weekly') lookbackDays = 21;
    else if (period === 'current_year') lookbackDays = 330;
    else if (/^quarter[1-4]$/.test(period)) lookbackDays = 150;
    else if (period === 'all_time') return {};

    const startDate = new Date(today);
    startDate.setDate(startDate.getDate() - lookbackDays);
    return { start: startDate.toISOString().split('T')[0], end };
}

async function fetchSummaryTrendRecords() {
    const st = dashboardState.summary || {};
    const params = new URLSearchParams();
    if (st.studentId) params.set('student_id', String(st.studentId));
    if (st.staffId) params.set('staff_id', String(st.staffId));
    const managedCheckbox = document.getElementById('summary-managed-by-me-checkbox');
    if (managedCheckbox && managedCheckbox.checked) params.set('managed_by_me', 'true');

    const range = getSummaryTrendFetchRange();
    if (range.start) params.set('start_date', range.start);
    if (range.end) params.set('end_date', range.end);

    const url = `/api/daily-records${params.toString() ? `?${params.toString()}` : ''}`;
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Unable to load trend records (${response.status})`);
    }
    return response.json();
}

function parseIsoDateLocal(isoDate) {
    const [year, month, day] = String(isoDate || '').split('-').map(Number);
    if (!year || !month || !day) return null;
    return new Date(year, month - 1, day);
}

function formatTrendDateLabel(isoDate) {
    const d = parseIsoDateLocal(isoDate);
    if (!d) return '';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function calculateTrendPercent(records, metric) {
    let safety = 0;
    let teamwork = 0;
    let accountability = 0;
    let relationships = 0;
    let possible = 0;

    records.forEach(record => {
        if (record.attendance_status === 'excused') return;
        (record.periods || []).forEach(period => {
            safety += Number(period.safety_points) || 0;
            teamwork += Number(period.teamwork_points) || 0;
            accountability += Number(period.accountability_points) || 0;
            relationships += Number(period.relationships_points) || 0;
            possible += Number(period.points_possible) || 4;
        });
    });

    const numPeriods = possible > 0 ? possible / 4 : 0;
    const maxPerCategory = numPeriods > 0 ? numPeriods * 2 : 0;
    if (!maxPerCategory) return null;

    const pct = {
        safety: (safety / maxPerCategory) * 100,
        teamwork: (teamwork / maxPerCategory) * 100,
        accountability: (accountability / maxPerCategory) * 100,
        relationships: (relationships / maxPerCategory) * 100
    };
    pct.overall = (pct.safety + pct.teamwork + pct.accountability + pct.relationships) / 4;
    return Math.max(0, Math.min(100, pct[metric] ?? pct.overall));
}

function buildSummaryTrendPoints(records, metric) {
    const recordsByDate = new Map();
    (records || []).forEach(record => {
        if (!record || !record.date) return;
        if (!recordsByDate.has(record.date)) recordsByDate.set(record.date, []);
        recordsByDate.get(record.date).push(record);
    });

    const dateKeys = Array.from(recordsByDate.keys()).sort();
    const selectedDates = dateKeys.slice(-30);
    if (!selectedDates.length) return [];

    const bucketCount = Math.min(5, Math.ceil(selectedDates.length / 4));
    const bucketSize = Math.ceil(selectedDates.length / bucketCount);
    const points = [];

    for (let i = 0; i < selectedDates.length; i += bucketSize) {
        const bucketDates = selectedDates.slice(i, i + bucketSize);
        const bucketRecords = bucketDates.flatMap(date => recordsByDate.get(date) || []);
        const value = calculateTrendPercent(bucketRecords, metric);
        if (value == null) continue;
        points.push({
            label: formatTrendDateLabel(bucketDates[bucketDates.length - 1]),
            value: Math.round(value)
        });
    }

    return points;
}

function renderSummaryTrendSvg(points) {
    if (!points || points.length < 2) {
        return `
            <div class="behavior-trend-empty">
                Not enough point-card data to build a 30-school-day trend yet.
            </div>`;
    }

    const width = 1000;
    const height = 216;
    const left = 54;
    const right = 32;
    const top = 26;
    const bottom = 44;
    const chartW = width - left - right;
    const chartH = height - top - bottom;
    const xStep = points.length > 1 ? chartW / (points.length - 1) : chartW;
    const toX = i => left + (i * xStep);
    const toY = value => top + ((100 - Math.max(0, Math.min(100, value))) / 100) * chartH;
    const plotted = points.map((p, i) => ({ ...p, x: toX(i), y: toY(p.value) }));
    const gridValues = [100, 75, 50, 25, 0];

    let grid = '';
    gridValues.forEach(v => {
        const y = toY(v);
        grid += `<line class="behavior-trend-grid-line" x1="${left}" y1="${y}" x2="${width - right}" y2="${y}"></line>`;
        grid += `<text class="behavior-trend-axis-label" x="${left - 16}" y="${y + 4}" text-anchor="end">${v}%</text>`;
    });

    let segments = '';
    for (let i = 0; i < plotted.length - 1; i++) {
        const a = plotted[i];
        const b = plotted[i + 1];
        const color = b.value > a.value ? '#22c55e' : b.value < a.value ? '#ef4444' : '#64748b';
        segments += `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="${color}" stroke-width="3" stroke-linecap="round"></line>`;
    }

    const markers = plotted.map((p) => `
        <g class="behavior-trend-point-group">
            <circle class="behavior-trend-marker" cx="${p.x}" cy="${p.y}" r="5" fill="#ffffff" stroke="#64748b" stroke-width="2"></circle>
            <text class="behavior-trend-point-value" x="${p.x}" y="${p.y - 11}" text-anchor="middle" fill="#64748b">${p.value}%</text>
            <text class="behavior-trend-point-label" x="${p.x}" y="${height - 12}" text-anchor="middle">${escapeHtml(p.label)}</text>
        </g>
    `).join('');

    return `
        <div class="behavior-trend-chart-wrap">
            <svg class="behavior-trend-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="STAR performance trend">
                ${grid}
                ${segments}
                ${markers}
            </svg>
        </div>`;
}

function populateSummaryBehaviorTrendCard(records) {
    const body = document.getElementById('summary-behavior-trend-body');
    if (!body) return;
    const metricSelect = document.getElementById('summary-trend-metric');
    const metric = metricSelect ? metricSelect.value : 'overall';
    const points = buildSummaryTrendPoints(records || [], metric);
    body.innerHTML = renderSummaryTrendSvg(points);
    const grid = body.closest('.dashboard-card-grid');
    if (grid) scheduleMasonryLayoutAfterResize(grid);
}

async function loadSummaryBehaviorTrendCard() {
    const body = document.getElementById('summary-behavior-trend-body');
    if (!body) return;
    try {
        const records = await fetchSummaryTrendRecords();
        window.currentSummaryTrendRecords = Array.isArray(records) ? records : [];
        populateSummaryBehaviorTrendCard(window.currentSummaryTrendRecords);
    } catch (err) {
        body.innerHTML = `<div class="behavior-trend-empty">Unable to load trend data: ${escapeHtml(err.message || 'Unknown error')}</div>`;
    }
}

function wireSummaryBehaviorTrendCard() {
    const metricSelect = document.getElementById('summary-trend-metric');
    if (metricSelect && !metricSelect.dataset.bound) {
        metricSelect.dataset.bound = 'true';
        metricSelect.addEventListener('change', () => {
            populateSummaryBehaviorTrendCard(window.currentSummaryTrendRecords || []);
        });
    }

    const compareBtn = document.getElementById('summary-trend-compare-btn');
    if (compareBtn && !compareBtn.dataset.bound) {
        compareBtn.dataset.bound = 'true';
        compareBtn.addEventListener('click', () => {
            const compareToggle = document.getElementById('summary-compare-toggle');
            if (compareToggle) compareToggle.click();
        });
    }

    loadSummaryBehaviorTrendCard();
}

function buildDefaultTriggerTimesCardHtml(data) {
    const byClass = data.by_class || {};
    const byTime = data.by_time || {};
    const timeKeys = Object.keys(byTime);
    const classNames = Object.keys(byClass);
    const useByTime = timeKeys.length > 0;
    const triggerEntries = useByTime ? timeKeys.slice() : classNames.slice();

    const sortedTriggerKeys = triggerEntries.sort((a, b) => {
        const aData = useByTime ? (byTime[a] || {}) : (byClass[a] || {});
        const bData = useByTime ? (byTime[b] || {}) : (byClass[b] || {});
        const aPct = typeof aData.percentages?.overall === 'number' ? Math.round(aData.percentages.overall) : Number.POSITIVE_INFINITY;
        const bPct = typeof bData.percentages?.overall === 'number' ? Math.round(bData.percentages.overall) : Number.POSITIVE_INFINITY;
        if (aPct !== bPct) return aPct - bPct;
        const aInfra = typeof aData.total_infractions === 'number' ? aData.total_infractions : (typeof aData.infractions === 'number' ? aData.infractions : 0);
        const bInfra = typeof bData.total_infractions === 'number' ? bData.total_infractions : (typeof bData.infractions === 'number' ? bData.infractions : 0);
        return bInfra - aInfra;
    });

    let rows = '';
    sortedTriggerKeys.slice(0, 6).forEach(key => {
        const rowData = useByTime ? (byTime[key] || {}) : (byClass[key] || {});
        const pctOverall = rowData.percentages?.overall;
        const infractionsCount = typeof rowData.total_infractions === 'number'
            ? rowData.total_infractions
            : (typeof rowData.infractions === 'number' ? rowData.infractions : 0);
        const topClass = useByTime ? (rowData.top_class || '') : '';
        rows += `<tr>
            <td>${escapeHtml(key)}${topClass ? `<div class="trigger-times-sub">${escapeHtml(topClass)}</div>` : ''}</td>
            <td>${typeof pctOverall === 'number' ? Math.round(pctOverall) + '%' : '-'}</td>
            <td>${infractionsCount}</td>
        </tr>`;
    });

    const empty = `<p class="trigger-times-empty">No trigger time data for this period.</p>`;
    return `
        <div class="dashboard-card trigger-times-card summary-default-trigger-card" data-summary-card="trigger-times">
            <div class="dashboard-card-header">
                <h3 class="dashboard-card-title">Trigger Times</h3>
                <button type="button" class="trigger-times-mode-btn active">Table</button>
            </div>
            <div class="trigger-times-table-wrap">
                ${rows ? `
                    <table class="trigger-times-table">
                        <thead>
                            <tr><th>Time</th><th>Average</th><th>Infractions</th></tr>
                        </thead>
                        <tbody>${rows}</tbody>
                    </table>` : empty}
            </div>
        </div>`;
}

function buildOverviewDashboardCardHtml(data) {
    const avgs = data.averages || {};
    const totalDays = data.total_days || 0;
    const infractions = data.infractions || data.additional_info?.infractions || {};
    const totalInfractions = Object.values(infractions).reduce((s, c) => s + Number(c) || 0, 0);
    const reminders = data.additional_info?.total_reminders || 0;
    const resets = data.additional_info?.total_resets || 0;
    const attendance = data.attendance_summary || {};
    const presentPct = typeof attendance.present_pct === 'number'
        ? attendance.present_pct
        : 0;
    const byClass = data.by_class || {};
    const byTime = data.by_time || {};
    const byTimeByDay = data.by_time_by_day || {};
    const trends = data.overview_trends || null;

    const timeKeys = Object.keys(byTime);
    const classNames = Object.keys(byClass);
    const useByTime = timeKeys.length > 0;
    const triggerEntries = useByTime ? timeKeys.slice() : classNames.slice();
    let hardestTriggerLabel = '';
    let hardestTriggerSubtitle = '';
    if (triggerEntries.length > 0) {
        const sortedTriggerKeys = triggerEntries.sort((a, b) => {
            const aData = useByTime ? (byTime[a] || {}) : (byClass[a] || {});
            const bData = useByTime ? (byTime[b] || {}) : (byClass[b] || {});
            const aPct = typeof aData.percentages?.overall === 'number'
                ? Math.round(aData.percentages.overall)
                : Number.POSITIVE_INFINITY;
            const bPct = typeof bData.percentages?.overall === 'number'
                ? Math.round(bData.percentages.overall)
                : Number.POSITIVE_INFINITY;
            if (aPct !== bPct) return aPct - bPct;
            const aInfra = typeof aData.total_infractions === 'number'
                ? aData.total_infractions
                : (typeof aData.infractions === 'number' ? aData.infractions : 0);
            const bInfra = typeof bData.total_infractions === 'number'
                ? bData.total_infractions
                : (typeof bData.infractions === 'number' ? bData.infractions : 0);
            return bInfra - aInfra;
        });
        const hardestKey = sortedTriggerKeys[0];
        const hardestData = useByTime ? (byTime[hardestKey] || {}) : (byClass[hardestKey] || {});
        const hardestPctOverall = hardestData.percentages?.overall;
        const hardestInfractionsCount = typeof hardestData.total_infractions === 'number'
            ? hardestData.total_infractions
            : (typeof hardestData.infractions === 'number' ? hardestData.infractions : 0);
        hardestTriggerSubtitle = typeof hardestPctOverall === 'number'
            ? `${Math.round(hardestPctOverall)}% avg • ${hardestInfractionsCount} infractions`
            : `${hardestInfractionsCount} infractions`;
        hardestTriggerLabel = hardestKey;
    }

    const hm = overviewHeatmapMeta(byTimeByDay);
    let headlineTime = '';
    let headlineDay = '';
    if (hm.worst) {
        headlineTime = hm.worst.timeLabel;
        headlineDay = hm.worst.day || '';
    } else if (hardestTriggerLabel) {
        headlineTime = hardestTriggerLabel;
        headlineDay = '';
    }

    const roundedPresentPct = Math.ceil(Number(presentPct) || 0);
    const overallPct = Math.round(avgs.overall || 0);
    const safetyP = Math.min(100, Math.max(0, Number(avgs.safety) || 0));
    const teamworkP = Math.min(100, Math.max(0, Number(avgs.teamwork) || 0));
    const accountabilityP = Math.min(100, Math.max(0, Number(avgs.accountability) || 0));
    const relationshipsP = Math.min(100, Math.max(0, Number(avgs.relationships) || 0));

    const presentDelta = trends?.present_pct_delta;
    const starDelta = trends?.star_overall_delta;
    const infDelta = trends?.infractions_delta;
    const remDelta = trends?.reminders_delta;
    const rstDelta = trends?.resets_delta;

    let attendanceSub = '';
    if (presentDelta != null && !Number.isNaN(Number(presentDelta))) {
        const abs = Math.abs(Number(presentDelta));
        attendanceSub = abs < 0.05 ? 'No change' : `${formatOverviewSignedInt(presentDelta)}%`;
    } else {
        attendanceSub = totalDays > 0 ? '' : '—';
    }

    let starSub = '';
    if (starDelta != null && !Number.isNaN(Number(starDelta))) {
        starSub = Math.abs(Number(starDelta)) < 0.05 ? 'No change' : `${formatOverviewSignedInt(starDelta)}%`;
    } else {
        starSub = 'No change';
    }

    const buckets = bucketInfractionsOverview(infractions);
    const bSocial = buckets.Social;
    const bTask = buckets.Task;
    const bAttention = buckets.Attention;
    const bSafety = buckets.Safety;
    const bucketTotal = bSocial + bTask + bAttention + bSafety;
    const pct = v => (bucketTotal <= 0 ? 0 : Math.round((v / bucketTotal) * 100));
    const donutColors = ['#9333ea', '#2563eb', '#22c55e', '#dc2626'];
    let donutGradient = '';
    if (bucketTotal > 0) {
        let acc = 0;
        const segs = [
            { v: bSocial, c: donutColors[0] },
            { v: bTask, c: donutColors[1] },
            { v: bAttention, c: donutColors[2] },
            { v: bSafety, c: donutColors[3] }
        ];
        const parts = [];
        segs.forEach(s => {
            const p = (s.v / bucketTotal) * 100;
            if (p <= 0) return;
            const start = acc;
            acc += p;
            parts.push(`${s.c} ${start}% ${acc}%`);
        });
        donutGradient = parts.length ? `conic-gradient(${parts.join(', ')})` : '#e5e7eb';
    } else {
        donutGradient = '#e5e7eb';
    }

    const incidentMax = Math.max(1, reminders, resets);
    const remH = Math.round((reminders / incidentMax) * 100);
    const rstH = Math.round((resets / incidentMax) * 100);

    let heatRows = '';
    hm.timeSlots.forEach(tlabel => {
        let row = `<div class="overview-heatmap-row"><div class="overview-heatmap-time">${escapeHtml(tlabel)}</div>`;
        hm.days.forEach(day => {
            const cell = (byTimeByDay[day] || {})[tlabel];
            const bg = overviewHeatColor(cell, hm.maxInf);
            const isWorst = hm.worst && hm.worst.day === day && hm.worst.timeLabel === tlabel && (cell?.total_infractions || 0) > 0;
            const isBest = hm.best && hm.best.day === day && hm.best.timeLabel === tlabel && cell
                && typeof cell.percentages?.overall === 'number';
            let cls = 'overview-heatmap-cell';
            if (isWorst) cls += ' overview-heatmap-cell--worst';
            if (isBest && !isWorst) cls += ' overview-heatmap-cell--best';
            const title = cell
                ? `${Math.round(cell.percentages?.overall || 0)}% • ${cell.total_infractions || 0} infractions`
                : 'No data';
            row += `<div class="${cls}" style="background:${bg}" title="${escapeHtml(title)}"></div>`;
        });
        row += '</div>';
        heatRows += row;
    });

    if (!heatRows) {
        heatRows = `<p class="overview-heatmap-empty">Not enough scheduled period data to build a heatmap.</p>`;
    }

    const overviewDeltaMetrics = [
        { key: 'present_pct', label: 'Attendance', delta: presentDelta, isPercent: true, lowerIsBetter: false },
        { key: 'star_overall', label: 'STAR %', delta: starDelta, isPercent: true, lowerIsBetter: false },
        { key: 'infractions', label: 'Infractions', delta: infDelta, isPercent: false, lowerIsBetter: true },
        { key: 'reminders', label: 'Reminders', delta: remDelta, isPercent: false, lowerIsBetter: true },
        { key: 'resets', label: 'Resets', delta: rstDelta, isPercent: false, lowerIsBetter: true }
    ].filter(m => m.delta != null && !Number.isNaN(Number(m.delta)));

    const scoredOverviewDeltas = overviewDeltaMetrics.map((m) => {
        const raw = Number(m.delta);
        return {
            ...m,
            delta: raw,
            goodnessDelta: m.lowerIsBetter ? -raw : raw
        };
    });

    const positiveOverviewDeltas = scoredOverviewDeltas
        .filter(m => m.goodnessDelta > 0)
        .sort((a, b) => b.goodnessDelta - a.goodnessDelta);
    const negativeOverviewDeltas = scoredOverviewDeltas
        .filter(m => m.goodnessDelta < 0)
        .sort((a, b) => a.goodnessDelta - b.goodnessDelta);

    const topOverviewIncrease = positiveOverviewDeltas.length ? positiveOverviewDeltas[0] : null;
    const topOverviewDecrease = negativeOverviewDeltas.length ? negativeOverviewDeltas[0] : null;

    const formatOverviewDeltaParts = (metric) => {
        if (!metric) return { metric: '—', delta: '' };
        const formatted = formatOverviewSignedInt(metric.delta);
        return {
            metric: metric.label,
            delta: `${formatted}${metric.isPercent ? '%' : ''}`
        };
    };

    const positiveParts = formatOverviewDeltaParts(topOverviewIncrease);
    const negativeParts = formatOverviewDeltaParts(topOverviewDecrease);

    const trendInf = trends && formatOverviewSignedInt(infDelta);
    const trendRem = trends && formatOverviewSignedInt(remDelta);

    const trendsBlock = `
        <div class="overview-trends-card" aria-label="Trends vs prior window">
            <div class="overview-trends-title">Trends</div>
            <div class="overview-trend-line ${topOverviewIncrease ? 'overview-trend-line-pos' : 'overview-trend-line-neutral'}">
                <svg class="overview-spark overview-spark--up" viewBox="0 0 40 14" aria-hidden="true"><polyline fill="none" stroke="currentColor" stroke-width="2" points="0,12 14,8 26,10 40,4"/></svg>
                <span class="overview-trend-text"><span class="overview-trend-metric">${escapeHtml(positiveParts.metric)}</span><span class="overview-trend-delta">${escapeHtml(positiveParts.delta)}</span></span>
            </div>
            <div class="overview-trend-line ${topOverviewDecrease ? 'overview-trend-line-neg' : 'overview-trend-line-neutral'}">
                <svg class="overview-spark overview-spark--down" viewBox="0 0 40 14" aria-hidden="true"><polyline fill="none" stroke="currentColor" stroke-width="2" points="0,4 12,10 24,6 40,12"/></svg>
                <span class="overview-trend-text"><span class="overview-trend-metric">${escapeHtml(negativeParts.metric)}</span><span class="overview-trend-delta">${escapeHtml(negativeParts.delta)}</span></span>
            </div>
        </div>`;

    const headlineRight = headlineDay
        ? `${escapeHtml(headlineTime)} on ${escapeHtml(headlineDay)}`
        : escapeHtml(headlineTime || '—');

    const triggerMetaLines = headlineTime ? `
            <div class="overview-trigger-meta">
                <div><span class="overview-trigger-meta-k">Trigger Time</span> ${escapeHtml(headlineTime)}</div>
                <div><span class="overview-trigger-meta-k">Trigger Day</span> ${escapeHtml(headlineDay || '—')}</div>
            </div>` : '';

    const dashLen = 100;
    const attOff = dashLen - Math.min(100, Math.max(0, roundedPresentPct));
    const arcOff = pctVal => dashLen - Math.min(100, Math.max(0, pctVal));

    return `<div class="dashboard-card overview-card overview-card--rich">
        <div class="overview-rich-header">
            <h3 class="dashboard-card-title">Overview</h3>
            ${trendsBlock}
        </div>

        <div class="overview-rich-row overview-rich-gauges">
            <div class="overview-beige-panel overview-stat overview-gauge-attendance" data-overview-key="days_present">
                <div class="overview-panel-kicker">Attendance</div>
                <div class="overview-gauge-wrap overview-gauge-wrap--attendance-donut">
                    <svg class="overview-gauge-svg overview-gauge-svg--attendance-donut" viewBox="0 0 100 100" aria-hidden="true">
                        <circle class="overview-gauge-track overview-gauge-track--attendance-donut" cx="50" cy="50" r="34" fill="none" stroke="#e3e8ef" stroke-width="10" pathLength="100" />
                        <circle class="overview-gauge-fill overview-gauge-fill--green overview-gauge-fill--attendance-donut" cx="50" cy="50" r="34" fill="none" stroke="#16a34a" stroke-width="10" stroke-linecap="round" pathLength="100" stroke-dasharray="100" stroke-dashoffset="${attOff}" />
                    </svg>
                    <div class="overview-gauge-center overview-gauge-center--attendance-donut">
                        <div class="overview-gauge-big">${totalDays > 0 ? `${roundedPresentPct}%` : '—'}</div>
                        <div class="overview-gauge-small ${presentDelta != null && Number(presentDelta) < 0 ? 'is-neg' : presentDelta != null && Number(presentDelta) > 0 ? 'is-pos' : ''}">${escapeHtml(attendanceSub)}</div>
                    </div>
                </div>
            </div>
            <div class="overview-beige-panel overview-stat overview-gauge-star" data-overview-key="star_percent">
                <div class="overview-panel-kicker">Star Percent</div>
                <div class="overview-gauge-wrap overview-gauge-wrap--multi">
                    <svg class="overview-gauge-svg" viewBox="0 0 100 54" aria-hidden="true">
                        <path class="overview-gauge-track" d="M 8 46 A 42 42 0 0 1 92 46" fill="none" stroke="#efe9df" stroke-width="5" stroke-linecap="round" pathLength="100" />
                        <path d="M 11 46 A 39 39 0 0 1 89 46" fill="none" stroke="#ef4444" stroke-width="5" stroke-linecap="round" pathLength="100" stroke-dasharray="100" stroke-dashoffset="${arcOff(safetyP)}" />
                        <path d="M 15 46 A 34 34 0 0 1 85 46" fill="none" stroke="#f97316" stroke-width="5" stroke-linecap="round" pathLength="100" stroke-dasharray="100" stroke-dashoffset="${arcOff(teamworkP)}" />
                        <path d="M 19 46 A 29 29 0 0 1 81 46" fill="none" stroke="#3b82f6" stroke-width="5" stroke-linecap="round" pathLength="100" stroke-dasharray="100" stroke-dashoffset="${arcOff(accountabilityP)}" />
                        <path d="M 23 46 A 24 24 0 0 1 77 46" fill="none" stroke="#22c55e" stroke-width="5" stroke-linecap="round" pathLength="100" stroke-dasharray="100" stroke-dashoffset="${arcOff(relationshipsP)}" />
                    </svg>
                    <div class="overview-gauge-center">
                        <div class="overview-gauge-big">${overallPct}%</div>
                        <div class="overview-gauge-small is-muted">${escapeHtml(starSub)}</div>
                    </div>
                </div>
            </div>
        </div>

        <div class="overview-beige-panel overview-stat overview-trigger-panel" data-overview-key="trigger_times">
            <div class="overview-trigger-head">
                <div class="overview-panel-kicker">Trigger Time</div>
                ${triggerMetaLines}
            </div>
            <div class="overview-trigger-hero">${headlineRight}</div>
            ${hardestTriggerSubtitle ? `<div class="overview-trigger-sub">${escapeHtml(hardestTriggerSubtitle)}</div>` : ''}
            <div class="overview-heatmap">
                <div class="overview-heatmap-cols">
                    <div></div>
                    ${hm.days.map(d => `<div class="overview-heatmap-colhead">${overviewDayInitial(d)}</div>`).join('')}
                </div>
                ${heatRows}
                <div class="overview-heatmap-legend"><span>Cool</span><span class="overview-heatmap-legend-bar"></span><span>Hot</span></div>
            </div>
        </div>

        <div class="overview-rich-row overview-rich-bottom">
            <div class="overview-beige-panel overview-stat overview-infractions-panel" data-overview-key="infractions">
                <div class="overview-panel-kicker">Infractions</div>
                <div class="overview-infractions-body">
                    <ul class="overview-infractions-legend">
                        <li><span class="dot" style="background:#9333ea"></span>Social ${pct(bSocial)}%</li>
                        <li><span class="dot" style="background:#2563eb"></span>Task ${pct(bTask)}%</li>
                        <li><span class="dot" style="background:#22c55e"></span>Attention ${pct(bAttention)}%</li>
                        <li><span class="dot" style="background:#dc2626"></span>Safety ${pct(bSafety)}%</li>
                    </ul>
                    <div class="overview-donut-wrap">
                        <div class="overview-donut" style="background:${donutGradient}"></div>
                        <div class="overview-donut-center">
                            <div class="overview-donut-total">${totalInfractions}</div>
                            <div class="overview-donut-delta ${overviewTrendDeltaClass('infractions', infDelta)}">${trendInf ? escapeHtml(trendInf) : ''}</div>
                        </div>
                    </div>
                </div>
            </div>
            <div class="overview-beige-panel overview-incidents-panel">
                <div class="overview-panel-kicker">Incidents</div>
                <div class="overview-incidents-bars">
                    <div class="overview-stat overview-incident-bar-col" data-overview-key="reminders">
                        <div class="overview-incident-delta ${overviewTrendDeltaClass('reminders', remDelta)}">${trendRem ? escapeHtml(trendRem) : ''}</div>
                        <div class="overview-incident-bar-track">
                            <div class="overview-incident-bar-fill overview-incident-bar-fill--reminder" style="height:${remH}%"></div>
                        </div>
                        <div class="overview-incident-label">Reminder</div>
                    </div>
                    <div class="overview-stat overview-incident-bar-col" data-overview-key="resets">
                        <div class="overview-incident-delta ${overviewTrendDeltaClass('resets', rstDelta)}">${trends ? escapeHtml(formatOverviewSignedInt(rstDelta)) : ''}</div>
                        <div class="overview-incident-bar-track">
                            <div class="overview-incident-bar-fill overview-incident-bar-fill--reset" style="height:${rstH}%"></div>
                        </div>
                        <div class="overview-incident-label">Reset</div>
                    </div>
                </div>
            </div>
        </div>
    </div>`;
}

function renderSummarySingle(container, data) {
    let html = `<div class="dashboard-card-grid">`;

    html += buildBehaviorTrendCardHtml(data);
    html += buildOverviewDashboardCardHtml(data);
    html += buildDefaultTriggerTimesCardHtml(data);

    html += `</div>`;
    container.innerHTML = html;
    window.currentSummaryTrendRecords = [];
    wireSummaryBehaviorTrendCard();

    // Attach interactive behavior for Overview card selections
    try {
        attachOverviewCardInteractions(container, data);
    } catch (e) {
        console.error('Error wiring overview card interactions:', e);
    }

    // Initial masonry-like layout for the summary dashboard cards
    const gridEl = container.querySelector('.dashboard-card-grid');
    if (gridEl) {
        applySummaryMasonryLayout(gridEl);
    }
}

// Masonry-style layout for summary dashboard cards:
// - Keeps the Overview card fixed in the right column.
// - Places all other dashboard cards (including extra overview cards)
//   into equal-width columns, always choosing the column with the
//   current smallest height so new cards "wrap" directly beneath
//   the shortest column (typically the Overview card in the first
//   row). This avoids the large blank gap under the Overview card
//   without equalizing card heights.
// - On small screens we skip this and allow the default flex layout.
function applySummaryMasonryLayout(grid) {
    if (!grid) return;

    const cards = Array.from(grid.querySelectorAll('.dashboard-card'));
    if (!cards.length) return;

    // Reset any previous layout so measurements are correct
    grid.style.position = '';
    grid.style.height = '';
    const summaryContainer = grid.parentElement;
    if (summaryContainer && summaryContainer.id === 'summary-results') {
        summaryContainer.style.minHeight = '';
    }
    cards.forEach(card => {
        card.style.position = '';
        card.style.top = '';
        card.style.left = '';
        card.style.width = '';
    });

    // On narrow/medium screens, rely on the normal flex layout so
    // overview can stack above trend content instead of being clipped.
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || grid.clientWidth;
    if (viewportWidth <= 1200) {
        return;
    }

    const gap = 20; // match CSS .dashboard-card-grid gap
    const containerWidth = grid.clientWidth || grid.offsetWidth;
    if (!containerWidth) return;

    // Use up to 3 equal-width columns on desktop
    const maxColumns = 3;
    const minCardWidth = 260;
    const possibleColumns = Math.max(1, Math.floor((containerWidth + gap) / (minCardWidth + gap)));
    const columnCount = Math.min(maxColumns, possibleColumns);
    const totalGapWidth = gap * (columnCount - 1);
    const columnWidth = (containerWidth - totalGapWidth);
    const perColWidth = columnWidth / columnCount;

    const trendCard = grid.querySelector('.reports-trend-card');
    const defaultTriggerCard = grid.querySelector('.summary-default-trigger-card');
    const overviewCard = grid.querySelector('.overview-card');
    const useRestoredReportsLayout = trendCard && defaultTriggerCard && overviewCard && columnCount >= 3;

    if (useRestoredReportsLayout) {
        const leftWidth = (perColWidth * 2) + gap;
        const rightWidth = perColWidth;
        const leftCards = [trendCard, defaultTriggerCard].filter(Boolean);
        const rightLeft = leftWidth + gap;

        grid.style.position = 'relative';
        trendCard.style.width = leftWidth + 'px';
        defaultTriggerCard.style.width = leftWidth + 'px';
        overviewCard.style.width = rightWidth + 'px';

        [...leftCards, overviewCard].forEach(card => {
            card.style.position = 'static';
        });

        void grid.offsetHeight;

        let leftTop = 0;
        leftCards.forEach(card => {
            card.style.position = 'absolute';
            card.style.left = '0px';
            card.style.top = leftTop + 'px';
            card.style.width = leftWidth + 'px';
            leftTop += card.offsetHeight + gap;
        });

        let overviewTopOffset = 0;
        const formSection = grid.closest('.form-section');
        const sectionTitle = formSection ? formSection.querySelector('h2') : null;
        if (sectionTitle) {
            const gridRect = grid.getBoundingClientRect();
            const titleRect = sectionTitle.getBoundingClientRect();
            overviewTopOffset = Math.round(titleRect.top - gridRect.top);
        }

        overviewCard.style.position = 'absolute';
        overviewCard.style.left = rightLeft + 'px';
        overviewCard.style.top = overviewTopOffset + 'px';
        overviewCard.style.width = rightWidth + 'px';

        let rightTop = overviewTopOffset + overviewCard.offsetHeight + gap;
        const handled = new Set([trendCard, defaultTriggerCard, overviewCard]);
        const extraCards = cards.filter(card => !handled.has(card));
        extraCards.forEach(card => {
            card.style.position = 'absolute';
            card.style.width = perColWidth + 'px';
            if (rightTop <= leftTop) {
                card.style.left = rightLeft + 'px';
                card.style.top = rightTop + 'px';
                rightTop += card.offsetHeight + gap;
            } else {
                card.style.left = '0px';
                card.style.top = leftTop + 'px';
                card.style.width = leftWidth + 'px';
                leftTop += card.offsetHeight + gap;
            }
        });

        const maxHeight = Math.max(leftTop, rightTop, overviewCard.offsetHeight + Math.max(0, overviewTopOffset));
        grid.style.height = maxHeight + 'px';
        if (summaryContainer && summaryContainer.id === 'summary-results') {
            summaryContainer.style.minHeight = maxHeight + 'px';
        }
        return;
    }

    // Normalise widths and measure heights with static positioning
    grid.style.position = 'relative';
    cards.forEach(card => {
        card.style.position = 'static';
        card.style.width = perColWidth + 'px';
    });

    // Force reflow so expanded content (tabs, drilldowns) is laid out before we measure
    void grid.offsetHeight;
    const measuredHeights = new Map();
    cards.forEach(card => {
        measuredHeights.set(card, card.offsetHeight);
    });

    const columnHeights = new Array(columnCount).fill(0);

    // Keep Overview anchored at the far-right desktop column.
    const overviewColumnIndex = Math.max(0, columnCount - 1);
    let overviewTopOffset = 0;
    const formSection = grid.closest('.form-section');
    const sectionTitle = formSection ? formSection.querySelector('h2') : null;
    if (sectionTitle) {
        const gridRect = grid.getBoundingClientRect();
        const titleRect = sectionTitle.getBoundingClientRect();
        // Lift Overview so its top aligns with the Summary & Reports title row.
        overviewTopOffset = Math.round(titleRect.top - gridRect.top);
    }

    // Layout cards in selection / DOM order into the shortest column,
    // while pinning the overview card to the rightmost column.
    cards.forEach(card => {
        let colIndex;
        let topOverride = null;
        if (card.classList.contains('overview-card')) {
            colIndex = overviewColumnIndex;
            topOverride = overviewTopOffset;
        } else {
            // Keep the first generated overview detail card out of the
            // overview column so the top row fills left-to-right.
            if (card.classList.contains('overview-extra-card') && columnCount > 1) {
                const fallbackCol = overviewColumnIndex === 0 ? 1 : 0;
                if (columnHeights[fallbackCol] === 0) {
                    colIndex = fallbackCol;
                }
            }

            // If no preferred placement was selected, use shortest column.
            if (colIndex == null) {
                let minHeight = columnHeights[0];
                colIndex = 0;
                for (let i = 1; i < columnCount; i++) {
                    if (columnHeights[i] < minHeight) {
                        minHeight = columnHeights[i];
                        colIndex = i;
                    }
                }
            }
        }

        const top = topOverride != null ? topOverride : columnHeights[colIndex];
        const left = colIndex * (perColWidth + gap);
        const h = measuredHeights.get(card) || card.offsetHeight;

        card.style.position = 'absolute';
        card.style.top = top + 'px';
        card.style.left = left + 'px';
        card.style.width = perColWidth + 'px';

        columnHeights[colIndex] = top + h + gap;
    });

    let maxHeight = Math.max.apply(null, columnHeights);
    grid.style.height = maxHeight + 'px';
    if (summaryContainer && summaryContainer.id === 'summary-results') {
        summaryContainer.style.minHeight = maxHeight + 'px';
    }

    // Ensure grid and container are at least the actual bottom of the lowest card
    requestAnimationFrame(() => {
        const gridRect = grid.getBoundingClientRect();
        let maxBottom = 0;
        cards.forEach(card => {
            const rect = card.getBoundingClientRect();
            const cardBottomRelativeToGrid = rect.bottom - gridRect.top;
            if (cardBottomRelativeToGrid > maxBottom) maxBottom = cardBottomRelativeToGrid;
        });
        const needed = Math.ceil(maxBottom) + gap;
        if (needed > maxHeight) {
            maxHeight = needed;
            grid.style.height = maxHeight + 'px';
            if (summaryContainer && summaryContainer.id === 'summary-results') {
                summaryContainer.style.minHeight = maxHeight + 'px';
            }
        }
    });
}

/**
 * Run masonry layout after card content has grown, so the grid height expands and
 * the page can scroll. Uses two animation frames so the browser has laid out new
 * DOM before we measure, plus several delayed runs to catch late layout (fonts,
 * async content). Call this whenever a card's content is expanded (tabs, drilldowns, etc.).
 */
function scheduleMasonryLayoutAfterResize(grid) {
    if (!grid || typeof applySummaryMasonryLayout !== 'function') return;
    const run = () => {
        if (grid.isConnected) applySummaryMasonryLayout(grid);
    };
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            run();
            setTimeout(run, 100);
            setTimeout(run, 250);
            setTimeout(run, 450);
        });
    });
}

function attachOverviewCardInteractions(container, data) {
    const overviewCard = container.querySelector('.overview-card');
    if (!overviewCard) return;

    const statBoxes = overviewCard.querySelectorAll('.overview-stat');
    if (!statBoxes.length) return;

    const grid = overviewCard.closest('.dashboard-card-grid') || container;

    // Map overview stat keys to the data-overview-card keys used on the
    // corresponding detail cards. Only stats in this map create cards.
    const STAT_KEY_TO_CARD_KEY = {
        days_present: 'days_present',
        star_percent: 'star_performance',
        infractions: 'infractions_card',
        reminders: 'reminders',
        resets: 'resets',
        trigger_times: 'trigger_times'
    };

    const STORAGE_KEY = 'summary_overview_selected_stats_v1';

    let selectionOrder = [];

    const persistSelectionOrder = () => {
        try {
            const toStore = selectionOrder.slice();
            window.localStorage.setItem(STORAGE_KEY, JSON.stringify(toStore));
        } catch (e) {
            console.warn('Unable to persist overview selection order:', e);
        }
    };

    const loadSelectionOrder = () => {
        try {
            const raw = window.localStorage.getItem(STORAGE_KEY);
            if (!raw) return [];
            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed)) return [];
            // Only keep known stat keys that actually create cards
            return parsed.filter(k => Object.prototype.hasOwnProperty.call(STAT_KEY_TO_CARD_KEY, k));
        } catch {
            return [];
        }
    };

    const getExtraCard = (cardKey) =>
        grid.querySelector(`.overview-extra-card[data-overview-card="${cardKey}"]`);

    const removeExtraCard = (cardKey) => {
        const existing = getExtraCard(cardKey);
        if (existing && existing.parentNode) {
            existing.parentNode.removeChild(existing);
        }
    };

    // After selection changes, move existing extra cards so their DOM order
    // matches the selection order. This makes cards appear left-to-right,
    // top-to-bottom in the order they were selected, with wrapping handled
    // purely by CSS flexbox.
    const reorderExtraCards = () => {
        const fragment = document.createDocumentFragment();
        selectionOrder.forEach(statKey => {
            const cardKey = STAT_KEY_TO_CARD_KEY[statKey];
            if (!cardKey) return;
            const card = getExtraCard(cardKey);
            if (card) {
                fragment.appendChild(card);
            }
        });
        // Remove any extra cards that no longer have a corresponding stat key
        const existingCards = Array.from(grid.querySelectorAll('.overview-extra-card'));
        existingCards.forEach(card => {
            const cardKey = card.dataset.overviewCard;
            const statKey = Object.keys(STAT_KEY_TO_CARD_KEY).find(
                sk => STAT_KEY_TO_CARD_KEY[sk] === cardKey
            );
            if (!statKey || !selectionOrder.includes(statKey)) {
                card.parentNode && card.parentNode.removeChild(card);
            }
        });
        grid.appendChild(fragment);
    };

    const toggleExtraCard = (cardKey, buildFn) => {
        const existing = getExtraCard(cardKey);
        if (existing) {
            removeExtraCard(cardKey);
            return false;
        }
        buildFn();
        return true;
    };

    const buildDaysPresentCard = () => {
        // Recompute attendance summary here so this helper does not rely on
        // locals from renderSummarySingle's scope (which are not visible in
        // this function's lexical scope).
        const attendance = data.attendance_summary || {};
        const presentPct = typeof attendance.present_pct === 'number'
            ? attendance.present_pct
            : 0;
        const roundedPresentPct = Math.ceil(Number(presentPct) || 0);
        const totalDays = data.total_days || 0;

        const byDay = data.attendance_by_day_of_week || {};
        const dayEntries = Object.entries(byDay);
        if (!dayEntries.length) {
            const card = document.createElement('div');
            card.className = 'dashboard-card full-width overview-extra-card';
            card.dataset.overviewCard = 'days_present';
            card.innerHTML = `
                <div class="dashboard-card-header">
                    <h3 class="dashboard-card-title">Days Present — Attendance Breakdown</h3>
                </div>
                <div class="dashboard-card-body">
                    <p style="color:var(--text-secondary);font-size:0.85rem;">
                        Attendance by day of week is not available for this timeframe.
                    </p>
                </div>
            `;
            grid.appendChild(card);
            return;
        }
        let maxAbsent = -1;
        let maxAbsentDays = [];
        let totalAbsences = 0;
        let totalUnexcusedAbsences = 0;
        dayEntries.forEach(([day, counts]) => {
            const absent = (counts.excused || 0) + (counts.unexcused || 0);
            totalAbsences += absent;
            totalUnexcusedAbsences += (counts.unexcused || 0);
            if (absent > maxAbsent) {
                maxAbsent = absent;
                maxAbsentDays = [day];
            } else if (absent === maxAbsent && absent > 0) {
                maxAbsentDays.push(day);
            }
        });
        const formatDays = (days) => days.join(', ');
        const mostAbsentText = maxAbsent > 0
            ? `${formatDays(maxAbsentDays)} (${maxAbsent} absence${maxAbsent !== 1 ? 's' : ''})`
            : 'No absences recorded';

        let rows = '';
        const sortedDayEntries = dayEntries.slice().sort(([, aCounts], [, bCounts]) => {
            const aTotalAbsent = (aCounts.excused || 0) + (aCounts.unexcused || 0);
            const bTotalAbsent = (bCounts.excused || 0) + (bCounts.unexcused || 0);
            return bTotalAbsent - aTotalAbsent;
        });
        sortedDayEntries.forEach(([day, counts]) => {
            const absentExcused = counts.excused || 0;
            const absentUnexcused = counts.unexcused || 0;
            const totalForDay = absentExcused + absentUnexcused;
            rows += `<tr>
                <td>${day}</td>
                <td>${absentUnexcused}</td>
                <td>${absentExcused}</td>
                <td>${totalForDay}</td>
            </tr>`;
        });

        const card = document.createElement('div');
        card.className = 'dashboard-card full-width overview-extra-card';
        card.dataset.overviewCard = 'days_present';
        card.innerHTML = `
            <div class="dashboard-card-header">
                <h3 class="dashboard-card-title">Days Present — Attendance Breakdown</h3>
            </div>
            <div class="dashboard-card-body overview-detail-container">
                <div class="overview-metrics">
                    <div class="overview-metrics-row">
                        <span class="overview-metrics-label"><strong>% of days present:</strong></span>
                        <span class="overview-metrics-value">${roundedPresentPct}%</span>
                    </div>
                    <div class="overview-metrics-row">
                        <span class="overview-metrics-label"><strong>Total absences:</strong></span>
                        <span class="overview-metrics-value">${totalAbsences}</span>
                    </div>
                    <div class="overview-metrics-row">
                        <span class="overview-metrics-label"><strong>Total unexcused absences:</strong></span>
                        <span class="overview-metrics-value">${totalUnexcusedAbsences}</span>
                    </div>
                    <div class="overview-metrics-row">
                        <span class="overview-metrics-label"><strong>Total expected days:</strong></span>
                        <span class="overview-metrics-value">${totalDays}</span>
                    </div>
                    <div class="overview-metrics-row">
                        <span class="overview-metrics-label"><strong>Most absences:</strong></span>
                        <span class="overview-metrics-value">${mostAbsentText}</span>
                    </div>
                </div>
                <table class="days-present-table">
                    <thead>
                        <tr>
                            <th>Day</th>
                            <th>Unexcused</th>
                            <th>Excused</th>
                            <th>Total</th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
        `;
        grid.appendChild(card);
    };

    const renderInfractionTypeBreakdown = (type, targetOverride) => {
        const infractionsByType = data.infractions_by_type || {};
        const entry = infractionsByType[type];
        const target = targetOverride;
        if (!target) return;

        if (!entry) {
            target.innerHTML = `<p style="color:var(--text-secondary);font-size:0.85rem;">No detailed data for ${escapeHtml(type)}.</p>`;
            return;
        }

        const byTime = entry.by_time || {};
        const byDay = entry.by_day_of_week || {};

        // Build the inner "subtabs" for this infraction's details. The default
        // subtab is an Overview that shows the by-time/by-day tables. Additional
        // subtabs contain separate cards focused on a selected time or day.
        let timeRows = '';
        Object.entries(byTime)
            .sort(([, a], [, b]) => (b || 0) - (a || 0))
            .forEach(([label, count]) => {
                const overallByTime = (data.by_time || {})[label] || {};
                const topClass =
                    overallByTime.top_class ||
                    overallByTime.topClass ||
                    overallByTime.primary_class ||
                    '';
                const classSubheader = topClass
                    ? `<div style="font-size:0.8rem;color:var(--text-secondary);">${escapeHtml(topClass)}</div>`
                    : '';
                timeRows += `
                    <tr data-time-label="${label}">
                        <td style="padding:4px 8px;border-bottom:1px solid var(--border);">
                            ${escapeHtml(label)}${classSubheader}
                        </td>
                        <td style="padding:4px 8px;border-bottom:1px solid var(--border);">
                            ${count}
                        </td>
                    </tr>
                `;
            });

        let dayRows = '';
        Object.entries(byDay)
            .sort(([, a], [, b]) => (b || 0) - (a || 0))
            .forEach(([label, count]) => {
                dayRows += `
                    <tr data-day-label="${label}">
                        <td style="padding:4px 8px;border-bottom:1px solid var(--border);">
                            ${escapeHtml(label)}
                        </td>
                        <td style="padding:4px 8px;border-bottom:1px solid var(--border);">
                            ${count}
                        </td>
                    </tr>
                `;
            });

        const DETAILS_HINT_KEY = 'infractions_details_click_hint_seen';
        const detailsHintSeen = localStorage.getItem(DETAILS_HINT_KEY);
        const detailsHintMsg = 'Click a time row to see STAR metrics and infractions for that time; click a day row to see the time breakdown for that day.';
        const detailsHintMsgAttr = detailsHintMsg.replace(/"/g, '&quot;');
        const detailsTitleHintBlock = `
            <div class="infractions-click-hint infractions-title-hint" data-hint-key="${DETAILS_HINT_KEY}" data-hint-message="${detailsHintMsgAttr}">
                <span class="infractions-hint-icon" role="button" tabindex="0" aria-label="Show hint">i</span>
                <div class="infractions-hint-popover" role="tooltip" aria-hidden="true" style="display:none;"></div>
            </div>`;
        const detailsFirstTimeText = detailsHintSeen ? '' : `<p class="infractions-click-hint-text" data-hint-key="${DETAILS_HINT_KEY}" style="font-size:0.8rem;color:var(--text-secondary);margin:4px 0 10px 0;">${escapeHtml(detailsHintMsg)}</p>`;

        target.innerHTML = `
            <div class="infractions-drilldown-tabs" role="tablist">
                <button class="infractions-drill-tab active" data-drill-tab="overview" role="tab" aria-selected="true">
                    <span class="infractions-drill-tab-label">Overview</span>
                </button>
            </div>
            <div class="infractions-drilldown-panels">
                <div class="infractions-drill-tab-panel is-active" data-drill-tab-panel="overview">
                    <div class="infractions-details-section-header">
                        <h4 style="margin:0;">${escapeHtml(type)} — When It Occurs</h4>
                        ${detailsTitleHintBlock}
                    </div>
                    ${detailsFirstTimeText}
                    <div class="overview-two-col">
                        <div>
                            <h4>By Time of Day</h4>
                            ${timeRows ? `
                                <table class="infractions-time-table" style="border-collapse:collapse;font-size:0.85rem;margin-top:4px;">
                                    <thead>
                                        <tr>
                                            <th style="padding:4px 8px;border-bottom:1px solid var(--border);text-align:left;">Time</th>
                                            <th style="padding:4px 8px;border-bottom:1px solid var(--border);text-align:left;">Count</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${timeRows}
                                    </tbody>
                                </table>` :
                                `<p style="font-size:0.8rem;color:var(--text-secondary);">No time-of-day data.</p>`}
                        </div>
                        <div>
                            <h4>By Day of Week</h4>
                            ${dayRows ? `
                                <table class="infractions-day-table" style="border-collapse:collapse;font-size:0.85rem;margin-top:4px;">
                                    <thead>
                                        <tr>
                                            <th style="padding:4px 8px;border-bottom:1px solid var(--border);text-align:left;">Day</th>
                                            <th style="padding:4px 8px;border-bottom:1px solid var(--border);text-align:left;">Count</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${dayRows}
                                    </tbody>
                                </table>` :
                                `<p style="font-size:0.8rem;color:var(--text-secondary);">No day-of-week data.</p>`}
                        </div>
                    </div>
                </div>
            </div>
        `;

        // Wire subtab interactions scoped to this details panel
        const detailsPanel = target.closest('.infractions-tab-panel');
        if (!detailsPanel) return;
        const drillTabsContainer = target.querySelector('.infractions-drilldown-tabs');
        const drillPanelsContainer = target.querySelector('.infractions-drilldown-panels');
        if (!drillTabsContainer || !drillPanelsContainer) return;

        const setActiveDrillTab = (tabName) => {
            const allTabs = drillTabsContainer.querySelectorAll('.infractions-drill-tab');
            const allPanels = drillPanelsContainer.querySelectorAll('.infractions-drill-tab-panel');
            allTabs.forEach(tab => {
                const isActive = tab.dataset.drillTab === tabName;
                tab.classList.toggle('active', isActive);
                tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
            });
            allPanels.forEach(panel => {
                panel.classList.toggle('is-active', panel.dataset.drillTabPanel === tabName);
            });
        };

        const wireDrillTabClicks = () => {
            const allTabs = drillTabsContainer.querySelectorAll('.infractions-drill-tab');
            allTabs.forEach(tab => {
                if (tab._infractionsDrillWired) return;
                tab._infractionsDrillWired = true;
                tab.addEventListener('click', (e) => {
                    const closeBtn = e.target.closest('.infractions-drill-tab-close');
                    if (closeBtn) {
                        e.stopPropagation();
                        const name = tab.dataset.drillTab;
                        // Prevent closing the Overview subtab
                        if (name === 'overview') return;
                        const panel = drillPanelsContainer.querySelector(`.infractions-drill-tab-panel[data-drill-tab-panel="${name}"]`);
                        if (panel) {
                            panel.remove();
                        }
                        tab.remove();
                        if (!drillTabsContainer.querySelector('.infractions-drill-tab.active')) {
                            setActiveDrillTab('overview');
                        }
                        return;
                    }
                    const tabName = tab.dataset.drillTab;
                    if (!tabName) return;
                    setActiveDrillTab(tabName);
                });
            });
        };

        wireDrillTabClicks();

        const createOrUpdateDrillSubtab = (tabName, label, innerCardHtml) => {
            let tab = drillTabsContainer.querySelector(`.infractions-drill-tab[data-drill-tab="${tabName}"]`);
            let panel = drillPanelsContainer.querySelector(`.infractions-drill-tab-panel[data-drill-tab-panel="${tabName}"]`);

            if (!tab) {
                tab = document.createElement('button');
                tab.className = 'infractions-drill-tab';
                tab.dataset.drillTab = tabName;
                tab.setAttribute('role', 'tab');
                tab.setAttribute('aria-selected', 'false');
                const safeLabel = label || tabName;
                tab.innerHTML = `
                    <span class="infractions-drill-tab-label">${escapeHtml(safeLabel)}</span>
                    <span class="infractions-drill-tab-close" aria-label="Close" role="button">&times;</span>
                `;
                drillTabsContainer.appendChild(tab);
            }

            if (!panel) {
                panel = document.createElement('div');
                panel.className = 'infractions-drill-tab-panel';
                panel.dataset.drillTabPanel = tabName;
                drillPanelsContainer.appendChild(panel);
            }

            panel.innerHTML = `
                <div class="dashboard-card" style="margin-top:8px;">
                    ${innerCardHtml}
                </div>
            `;

            wireDrillTabClicks();
            setActiveDrillTab(tabName);
        };

        // Time-of-day row clicks: show average percent and lowest STAR category for that time bucket
        const timeRowsEls = target.querySelectorAll('.infractions-time-table tbody tr[data-time-label]');
        timeRowsEls.forEach(row => {
            if (row._infractionsTimeWired) return;
            row._infractionsTimeWired = true;
            row.style.cursor = 'pointer';
            row.addEventListener('click', () => {
                const timeLabel = row.dataset.timeLabel;
                if (!timeLabel) return;
                localStorage.setItem(DETAILS_HINT_KEY, '1');
                const detailsTextEl = target.querySelector('.infractions-click-hint-text[data-hint-key="' + DETAILS_HINT_KEY + '"]');
                if (detailsTextEl) detailsTextEl.remove();
                const bucket = (data.by_time || {})[timeLabel] || {};
                const pct = bucket.percentages || {};
                const overallPct = typeof pct.overall === 'number' ? pct.overall : null;

                const categories = ['safety', 'teamwork', 'accountability', 'relationships'];
                let lowestKey = null;
                let lowestVal = null;
                categories.forEach(k => {
                    const v = typeof pct[k] === 'number' ? pct[k] : null;
                    if (v == null) return;
                    if (lowestVal == null || v < lowestVal) {
                        lowestVal = v;
                        lowestKey = k;
                    }
                });

                // Build infractions table for this time bucket
                const infractionsMap = bucket.infractions || {};
                let infraRows = '';
                const infraEntries = Object.entries(infractionsMap);
                if (infraEntries.length) {
                    infraEntries
                        .sort(([, a], [, b]) => (Number(b) || 0) - (Number(a) || 0))
                        .forEach(([infType, count]) => {
                            infraRows += `
                                <tr>
                                    <td style="padding:4px 8px;border-bottom:1px solid var(--border);">
                                        ${escapeHtml(infType)}
                                    </td>
                                    <td style="padding:4px 8px;border-bottom:1px solid var(--border);text-align:right;">
                                        ${count}
                                    </td>
                                </tr>
                            `;
                        });
                }

                const lowestLabel = lowestKey
                    ? lowestKey.charAt(0).toUpperCase() + lowestKey.slice(1)
                    : 'N/A';

                const contentHtml = `
                    <h4 style="margin:8px 0;">${escapeHtml(type)} — ${escapeHtml(timeLabel)} Focus</h4>
                    <p style="font-size:0.85rem;color:var(--text-secondary);margin:4px 0 8px 0;">
                        Based on all data for this time period in the selected summary range.
                    </p>
                    <table style="border-collapse:collapse;font-size:0.85rem;margin-top:4px;">
                        <thead>
                            <tr>
                                <th style="padding:4px 8px;border-bottom:1px solid var(--border);text-align:left;background:var(--bg-elevated);">Metric</th>
                                <th style="padding:4px 8px;border-bottom:1px solid var(--border);text-align:right;background:var(--bg-elevated);">Value</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td style="padding:4px 8px;border-bottom:1px solid var(--border);">Average STAR %</td>
                                <td style="padding:4px 8px;border-bottom:1px solid var(--border);text-align:right;">
                                    ${overallPct != null ? `${overallPct}%` : 'Not available'}
                                </td>
                            </tr>
                            <tr>
                                <td style="padding:4px 8px;border-bottom:1px solid var(--border);">Lowest STAR Category</td>
                                <td style="padding:4px 8px;border-bottom:1px solid var(--border);text-align:right;">
                                    ${lowestKey ? `${lowestLabel} (${lowestVal}%)` : 'Not available'}
                                </td>
                            </tr>
                        </tbody>
                    </table>
                    <h5 style="margin:12px 0 6px 0;font-size:0.9rem;">Infractions during this time</h5>
                    ${
                        infraRows
                            ? `<table style="border-collapse:collapse;font-size:0.85rem;margin-top:2px;">
                                   <thead>
                                       <tr>
                                           <th style="padding:4px 8px;border-bottom:1px solid var(--border);text-align:left;">Infractions</th>
                                           <th style="padding:4px 8px;border-bottom:1px solid var(--border);text-align:right;">Count</th>
                                       </tr>
                                   </thead>
                                   <tbody>
                                       ${infraRows}
                                   </tbody>
                               </table>`
                            : `<p style="font-size:0.8rem;color:var(--text-secondary);margin-top:4px;">
                                   No infractions recorded for this time period.
                               </p>`
                    }
                `;

                const tabName = `time-${timeLabel}`;
                createOrUpdateDrillSubtab(tabName, timeLabel, contentHtml);
                scheduleMasonryLayoutAfterResize(grid);
            });
        });

        // Day-of-week row clicks: show a Time-of-day breakdown for that day
        const dayRowsEls = target.querySelectorAll('.infractions-day-table tbody tr[data-day-label]');
        dayRowsEls.forEach(row => {
            if (row._infractionsDayWired) return;
            row._infractionsDayWired = true;
            row.style.cursor = 'pointer';
            row.addEventListener('click', () => {
                const dayLabel = row.dataset.dayLabel;
                if (!dayLabel) return;
                localStorage.setItem(DETAILS_HINT_KEY, '1');
                const detailsTextEl = target.querySelector('.infractions-click-hint-text[data-hint-key="' + DETAILS_HINT_KEY + '"]');
                if (detailsTextEl) detailsTextEl.remove();

                const byTimeByDay = data.by_time_by_day || {};
                const timesForDay = byTimeByDay[dayLabel] || {};

                let rowsHtml = '';
                const entries = Object.entries(timesForDay)
                    .map(([timeLabel, bucket]) => {
                        const infra = bucket.infractions || {};
                        const count = typeof infra[type] === 'number' ? infra[type] : 0;
                        return { timeLabel, bucket, count };
                    })
                    .filter(e => e.count > 0);

                if (entries.length) {
                    entries
                        .sort((a, b) => b.count - a.count)
                        .forEach(({ timeLabel, bucket, count }) => {
                            const pct = bucket.percentages || {};
                            const overallPct = typeof pct.overall === 'number' ? pct.overall : null;
                            const categories = ['safety', 'teamwork', 'accountability', 'relationships'];
                            let lowestKey = null;
                            let lowestVal = null;
                            categories.forEach(k => {
                                const v = typeof pct[k] === 'number' ? pct[k] : null;
                                if (v == null) return;
                                if (lowestVal == null || v < lowestVal) {
                                    lowestVal = v;
                                    lowestKey = k;
                                }
                            });
                            const lowestLabel = lowestKey
                                ? lowestKey.charAt(0).toUpperCase() + lowestKey.slice(1)
                                : 'N/A';
                            rowsHtml += `
                                <tr>
                                    <td style="padding:4px 8px;border:1px solid var(--border);">${escapeHtml(timeLabel)}</td>
                                    <td style="padding:4px 8px;border:1px solid var(--border);">
                                        ${overallPct != null ? `${overallPct}%` : 'Not available'}
                                    </td>
                                    <td style="padding:4px 8px;border:1px solid var(--border);">
                                        ${lowestKey ? `${lowestLabel} (${lowestVal}%)` : 'Not available'}
                                    </td>
                                    <td style="padding:4px 8px;border:1px solid var(--border);">
                                        ${count}
                                    </td>
                                </tr>
                            `;
                        });
                }

                const contentHtml = `
                    <h4 style="margin:8px 0;">${escapeHtml(type)} — Time of Day on ${escapeHtml(dayLabel)}</h4>
                    <p style="font-size:0.85rem;color:var(--text-secondary);margin:4px 0 8px 0;">
                        Time-of-day STAR performance for ${escapeHtml(dayLabel)} in this summary range.
                    </p>
                    ${rowsHtml
                        ? `<table style="border-collapse:collapse;font-size:0.85rem;margin-top:4px;">
                                <thead>
                                    <tr>
                                        <th style="padding:4px 8px;border:1px solid var(--border);text-align:left;">Time</th>
                                        <th style="padding:4px 8px;border:1px solid var(--border);text-align:left;">Average STAR %</th>
                                        <th style="padding:4px 8px;border:1px solid var(--border);text-align:left;">Lowest STAR Category</th>
                                        <th style="padding:4px 8px;border:1px solid var(--border);text-align:left;">Infractions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${rowsHtml}
                                </tbody>
                           </table>`
                        : `<p style="font-size:0.85rem;color:var(--text-secondary);margin-top:4px;">
                               No time-of-day data available for ${escapeHtml(dayLabel)}.
                           </p>`
                    }
                `;

                const tabName = `day-${dayLabel}`;
                createOrUpdateDrillSubtab(tabName, dayLabel, contentHtml);
                scheduleMasonryLayoutAfterResize(grid);
            });
        });
    };

    const renderReminderOrResetDetails = (mode) => {
        const label = mode === 'reminders' ? 'Reminders' : 'Resets';
        const assocKey = mode === 'reminders' ? 'infractions_for_reminders' : 'infractions_for_resets';
        const assocMap = data.additional_info?.[assocKey] || {};
        const entries = Object.entries(assocMap).sort((a, b) => b[1] - a[1]);
        const byTime = data.by_time || {};
        const byDay = data.by_day_of_week || {};

        let timeRows = '';
        Object.entries(byTime)
            .map(([labelTime, tdata]) => {
                const count = mode === 'reminders'
                    ? (tdata.total_reminders || 0)
                    : (tdata.total_resets || 0);
                return { labelTime, count };
            })
            .filter(r => r.count)
            .sort((a, b) => b.count - a.count)
            .forEach(({ labelTime, count }) => {
                timeRows += `<tr><td>${escapeHtml(labelTime)}</td><td>${count}</td></tr>`;
            });

        let dayRows = '';
        Object.entries(byDay)
            .map(([dayLabel, ddata]) => {
                const count = mode === 'reminders'
                    ? (ddata.total_reminders || 0)
                    : (ddata.total_resets || 0);
                return { dayLabel, count };
            })
            .filter(r => r.count)
            .sort((a, b) => b.count - a.count)
            .forEach(({ dayLabel, count }) => {
                dayRows += `<tr><td>${escapeHtml(dayLabel)}</td><td>${count}</td></tr>`;
            });

        let infraRows = '';
        entries.forEach(([t, count]) => {
            infraRows += `<tr><td>${escapeHtml(t)}</td><td>${count}</td></tr>`;
        });

        const key = mode === 'reminders' ? 'reminders' : 'resets';
        removeExtraCard(key);
        const card = document.createElement('div');
        card.className = 'dashboard-card full-width overview-extra-card';
        card.dataset.overviewCard = key;
        card.innerHTML = `
        <div class="dashboard-card-header">
        <h3 class="dashboard-card-title">${label} — When & What</h3>
        </div>
        <div class="dashboard-card-body overview-detail-container">
        <div class="overview-two-col" style="margin-bottom:12px;">
                    <div>
                        <h4>By Time of Day</h4>
                        ${timeRows ? `
                            <table>
                                <thead><tr><th>Time</th><th>Count</th></tr></thead>
                                <tbody>${timeRows}</tbody>
                            </table>` :
                            `<p style="font-size:0.8rem;color:var(--text-secondary);">No ${label.toLowerCase()} recorded by time.</p>`}
                    </div>
                    <div>
                        <h4>By Day of Week</h4>
                        ${dayRows ? `
                            <table>
                                <thead><tr><th>Day</th><th>Count</th></tr></thead>
                                <tbody>${dayRows}</tbody>
                            </table>` :
                            `<p style="font-size:0.8rem;color:var(--text-secondary);">No ${label.toLowerCase()} recorded by day.</p>`}
                    </div>
                    <div>
                        <h4>${label} — Connected Infractions</h4>
                        ${infraRows ? `
                            <table>
                                <thead><tr><th>Infraction</th><th>Count</th></tr></thead>
                                <tbody>${infraRows}</tbody>
                            </table>` :
                            `<p style="font-size:0.85rem;color:var(--text-secondary);">No infractions are currently linked to ${label.toLowerCase()} for this period.</p>`}
                    </div>
                </div>
            </div>
        `;
        grid.appendChild(card);
    };

    const toggleTriggerTimesDayTable = () => {
        const triggerCard = container.querySelector('.trigger-times-card');
        if (!triggerCard) return;
        const target = triggerCard.querySelector('.trigger-times-day-of-week');
        if (!target) return;

        // If already visible, hide and clear on repeat click
        if (target.style.display !== 'none' && target.innerHTML) {
            target.style.display = 'none';
            target.innerHTML = '';
            return;
        }

        const byDayData = data.by_day_of_week || {};
        const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
        const rows = [];
        weekdays.forEach(d => {
            const dd = byDayData[d];
            if (!dd) return;
            const pct = typeof dd.percentages?.overall === 'number'
                ? dd.percentages.overall
                : 0;
            const infractionsCount = typeof dd.total_infractions === 'number'
                ? dd.total_infractions
                : 0;
            rows.push({
                label: d.substring(0, 3),
                pct,
                infractions: infractionsCount
            });
        });

        if (!rows.length) {
            target.innerHTML = `<p style="font-size:0.8rem;color:var(--text-secondary);">No day-of-week data for this period.</p>`;
            target.style.display = 'block';
            return;
        }

        rows.sort((a, b) => {
            if (b.infractions !== a.infractions) return b.infractions - a.infractions;
            return (b.pct || 0) - (a.pct || 0);
        });
        let bodyRows = '';
        rows.forEach(r => {
            bodyRows += `<tr>
                <td>${r.label}</td>
                <td>${Math.round(r.pct)}%</td>
                <td>${r.infractions}</td>
            </tr>`;
        });

        target.innerHTML = `
            <h4>Day of Week Breakdown</h4>
            <table>
                <thead>
                    <tr>
                        <th>Day</th>
                        <th>Overall %</th>
                        <th>Infractions</th>
                    </tr>
                </thead>
                <tbody>${bodyRows}</tbody>
            </table>
        `;
        target.style.display = 'block';
        scheduleMasonryLayoutAfterResize(grid);
    };

    const buildStarPerformanceCard = () => {
        const avgs = data.averages || {};
        const totalDays = data.total_days || 0;
        const card = document.createElement('div');
        card.className = 'dashboard-card star-performance-card overview-extra-card';
        card.dataset.overviewCard = 'star_performance';

        const STAR_OVERVIEW_HINT_KEY = 'star_performance_click_hint_seen';
        const starHintSeen = localStorage.getItem(STAR_OVERVIEW_HINT_KEY);
        const starHintMsg = 'Click a STAR bar to see highest and lowest time of day and day of week for that category.';
        const starHintMsgAttr = starHintMsg.replace(/"/g, '&quot;');
        const starTitleHintBlock = `
            <div class="infractions-click-hint infractions-title-hint" data-hint-key="${STAR_OVERVIEW_HINT_KEY}" data-hint-message="${starHintMsgAttr}">
                <span class="infractions-hint-icon" role="button" tabindex="0" aria-label="Show hint">i</span>
                <div class="infractions-hint-popover" role="tooltip" aria-hidden="true" style="display:none;"></div>
            </div>`;
        const starFirstTimeText = starHintSeen ? '' : `<p class="infractions-click-hint-text" data-hint-key="${STAR_OVERVIEW_HINT_KEY}" style="font-size:0.8rem;color:var(--text-secondary);margin:4px 0 10px 0;">${escapeHtml(starHintMsg)}</p>`;

        const overviewContent = starFirstTimeText + `
            <div class="overview-star-layout" style="display:flex; gap:16px; align-items:flex-start; flex-wrap:wrap;">
                <div class="dashboard-chart-wrap summary-star-chart-wrap" style="flex:1 1 260px; min-height:220px;">
                    <canvas id="overview-star-chart"></canvas>
                </div>
                <div id="summary-star-details" class="overview-star-details" style="flex:1 1 260px; font-size:0.9rem; color:var(--text-primary);"></div>
            </div>
        `;
        card.innerHTML = `
            <div class="dashboard-breakdown-card-inner">
                <div class="dashboard-card-header star-performance-card-header">
                    <div>
                        <h3 class="dashboard-card-title">STAR Performance</h3>
                        <div class="dashboard-card-subtitle">${totalDays} school day${totalDays !== 1 ? 's' : ''}</div>
                    </div>
                    ${starTitleHintBlock}
                </div>
                <div class="star-performance-tabs" role="tablist">
                    <button class="star-performance-tab active" data-tab="overview" role="tab" aria-selected="true">
                        <span class="star-performance-tab-label">Overview</span>
                    </button>
                </div>
                <div class="star-performance-tab-panels">
                    <div class="star-performance-tab-panel star-performance-tab-overview is-active" data-tab-panel="overview">
                        ${overviewContent}
                    </div>
                </div>
            </div>
        `;
        grid.appendChild(card);

        const tabsContainer = card.querySelector('.star-performance-tabs');
        const panelsContainer = card.querySelector('.star-performance-tab-panels');
        const setActiveTab = (tabName) => {
            const allTabs = card.querySelectorAll('.star-performance-tab');
            const allPanels = card.querySelectorAll('.star-performance-tab-panel');
            allTabs.forEach(tab => {
                const isActive = tab.dataset.tab === tabName;
                tab.classList.toggle('active', isActive);
                tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
            });
            allPanels.forEach(panel => {
                panel.classList.toggle('is-active', panel.dataset.tabPanel === tabName);
            });
        };

        const wireTabClicks = () => {
            const allTabs = card.querySelectorAll('.star-performance-tab');
            allTabs.forEach(tab => {
                if (tab._starPerformanceWired) return;
                tab._starPerformanceWired = true;
                tab.addEventListener('click', (e) => {
                    const closeBtn = e.target.closest('.star-performance-tab-close');
                    if (closeBtn) {
                        e.stopPropagation();
                        const name = tab.dataset.tab;
                        if (name === 'overview') return;
                        const panel = card.querySelector(`.star-performance-tab-panel[data-tab-panel="${name}"]`);
                        if (panel) panel.remove();
                        tab.remove();
                        if (!card.querySelector('.star-performance-tab.active')) {
                            setActiveTab('overview');
                        }
                        return;
                    }
                    const tabName = tab.dataset.tab;
                    if (!tabName || tab.disabled) return;
                    setActiveTab(tabName);
                });
            });
        };
        wireTabClicks();

        // (i) icon: click shows hint in popover (same text as first-time reminder)
        card.addEventListener('click', (e) => {
            const icon = e.target.closest('.infractions-hint-icon');
            if (icon) {
                e.preventDefault();
                const hintDiv = icon.closest('.infractions-click-hint');
                if (!hintDiv) return;
                const popover = hintDiv.querySelector('.infractions-hint-popover');
                if (!popover) return;
                const msg = hintDiv.getAttribute('data-hint-message');
                if (msg != null) popover.textContent = msg;
                const isOpen = popover.getAttribute('aria-hidden') === 'false';
                card.querySelectorAll('.infractions-hint-popover').forEach(p => {
                    p.style.display = 'none';
                    p.setAttribute('aria-hidden', 'true');
                });
                if (!isOpen) {
                    const cardEl = hintDiv.closest('.star-performance-card') || card;
                    const cardRect = cardEl.getBoundingClientRect();
                    const hintRect = hintDiv.getBoundingClientRect();
                    const padding = 16;
                    const maxW = Math.max(200, Math.min(480, cardRect.right - hintRect.left - padding));
                    popover.style.maxWidth = maxW + 'px';
                    popover.style.display = 'block';
                    popover.setAttribute('aria-hidden', 'false');
                }
                return;
            }
            if (!e.target.closest('.infractions-hint-popover')) {
                card.querySelectorAll('.infractions-hint-popover').forEach(p => {
                    p.style.display = 'none';
                    p.setAttribute('aria-hidden', 'true');
                });
            }
        });
        if (!window._starHintPopoverBound) {
            window._starHintPopoverBound = true;
            document.addEventListener('click', (e) => {
                if (e.target.closest('.star-performance-card')) return;
                document.querySelectorAll('.star-performance-card .infractions-hint-popover').forEach(p => {
                    p.style.display = 'none';
                    p.setAttribute('aria-hidden', 'true');
                });
            }, true);
        }

        const starCanvas = card.querySelector('#overview-star-chart');
        if (starCanvas && typeof Chart !== 'undefined') {
            if (summaryChartInstance) { summaryChartInstance.destroy(); summaryChartInstance = null; }
            summaryChartInstance = new Chart(starCanvas.getContext('2d'), {
                type: 'bar',
                data: {
                    labels: ['Safety', 'Teamwork', 'Accountability', 'Relationships'],
                    datasets: [{
                        label: 'Average %',
                        data: [avgs.safety || 0, avgs.teamwork || 0, avgs.accountability || 0, avgs.relationships || 0],
                        backgroundColor: STAR_CHART_BAR_COLORS,
                        borderRadius: { topLeft: 10, topRight: 10, bottomLeft: 0, bottomRight: 0 },
                        borderSkipped: false,
                        maxBarThickness: 40
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false },
                        datalabels: {
                            anchor: 'end',
                            align: 'top',
                            offset: 4,
                            color: '#64748b',
                            font: { weight: 400, size: 12 },
                            formatter: (value) => `${Math.round(value)}%`
                        }
                    },
                    layout: {
                        padding: { top: 20, right: 20, bottom: 12, left: 12 }
                    },
                    scales: {
                        x: {
                            grid: { display: false },
                            barPercentage: 0.7,
                            categoryPercentage: 0.85,
                            ticks: {
                                maxRotation: 0,
                                minRotation: 0,
                                autoSkip: false,
                                font: { size: 12 },
                                color: '#64748b',
                                padding: 10
                            },
                            border: { display: false }
                        },
                        y: {
                            beginAtZero: true,
                            max: 100,
                            grid: { display: false },
                            ticks: {
                                callback: v => v + '%',
                                font: { size: 11 },
                                color: '#64748b',
                                padding: 8,
                                maxTicksLimit: 6
                            },
                            border: { display: false }
                        }
                    },
                    onClick: (evt, elements) => {
                        if (!elements || !elements.length) return;
                        const index = elements[0].index;
                        const catKeys = ['safety', 'teamwork', 'accountability', 'relationships'];
                        const labels = ['Safety', 'Teamwork', 'Accountability', 'Relationships'];
                        const catKey = catKeys[index];
                        if (!catKey) return;
                        const tabName = `star-${catKey}`;
                        let catTab = Array.from(card.querySelectorAll('.star-performance-tab')).find(t => t.dataset.tab === tabName);
                        let panel = card.querySelector(`.star-performance-tab-panel[data-tab-panel="${tabName}"]`);

                        if (!catTab) {
                            catTab = document.createElement('button');
                            catTab.className = 'star-performance-tab';
                            catTab.dataset.tab = tabName;
                            catTab.setAttribute('role', 'tab');
                            catTab.setAttribute('aria-selected', 'false');
                            const shortLabel = labels[index] || catKey;
                            catTab.innerHTML = `
                                <span class="star-performance-tab-label">${escapeHtml(shortLabel)}</span>
                                <span class="star-performance-tab-close" aria-label="Close" role="button">&times;</span>
                            `;
                            tabsContainer.appendChild(catTab);

                            panel = document.createElement('div');
                            panel.className = 'star-performance-tab-panel';
                            panel.dataset.tabPanel = tabName;
                            panelsContainer.appendChild(panel);
                            wireTabClicks();
                        }

                        try {
                            localStorage.setItem(STAR_OVERVIEW_HINT_KEY, '1');
                            const starHintTextEl = card.querySelector('.infractions-click-hint-text[data-hint-key="' + STAR_OVERVIEW_HINT_KEY + '"]');
                            if (starHintTextEl) starHintTextEl.remove();
                            const html = showStarCategoryDetails(catKey, labels[index] || catKey, data);
                            if (html) {
                                panel.innerHTML = html;
                                if (typeof wireStarCategoryDrilldown === 'function') {
                                    wireStarCategoryDrilldown(panel, data, catKey);
                                }
                                setActiveTab(tabName);
                                scheduleMasonryLayoutAfterResize(grid);
                            } else {
                                setActiveTab(tabName);
                            }
                        } catch (e) {
                            console.error('Error showing STAR category details from overview STAR chart:', e);
                            setActiveTab(tabName);
                        }
                    }
                }
            });
        }
    };

    const buildTriggerTimesCard = () => {
        const byClass = data.by_class || {};
        const byTime = data.by_time || {};

        const timeKeys = Object.keys(byTime);
        const classNames = Object.keys(byClass);
        const useByTime = timeKeys.length > 0;
        const triggerEntries = useByTime ? timeKeys.slice() : classNames.slice();
        let sortedTriggerKeys = [];

        if (triggerEntries.length > 0) {
            sortedTriggerKeys = triggerEntries.sort((a, b) => {
                const aData = useByTime ? (byTime[a] || {}) : (byClass[a] || {});
                const bData = useByTime ? (byTime[b] || {}) : (byClass[b] || {});

                const aPct = typeof aData.percentages?.overall === 'number'
                    ? Math.round(aData.percentages.overall)
                    : Number.POSITIVE_INFINITY;
                const bPct = typeof bData.percentages?.overall === 'number'
                    ? Math.round(bData.percentages.overall)
                    : Number.POSITIVE_INFINITY;
                if (aPct !== bPct) {
                    return aPct - bPct;
                }

                const aInfra = typeof aData.total_infractions === 'number'
                    ? aData.total_infractions
                    : (typeof aData.infractions === 'number' ? aData.infractions : 0);
                const bInfra = typeof bData.total_infractions === 'number'
                    ? bData.total_infractions
                    : (typeof bData.infractions === 'number' ? bData.infractions : 0);

                return bInfra - aInfra;
            });
        }

        const card = document.createElement('div');
        card.className = 'dashboard-card trigger-times-card overview-extra-card';
        card.dataset.overviewCard = 'trigger_times';

        let innerHtml = `
            <div class="dashboard-breakdown-card-inner">
                <div class="dashboard-card-header"><h3 class="dashboard-card-title">Trigger Times</h3></div>
                <div class="overview-two-col">`;

        // Left column: trigger time/class breakdown list
        innerHtml += `<div>`;
        if (sortedTriggerKeys.length > 0) {
            innerHtml += `<ul class="dashboard-breakdown-list">`;
            sortedTriggerKeys.forEach((key) => {
                const rowData = useByTime ? (byTime[key] || {}) : (byClass[key] || {});
                const pctOverall = rowData.percentages?.overall ?? '';

                const infractionsCount = typeof rowData.total_infractions === 'number'
                    ? rowData.total_infractions
                    : (typeof rowData.infractions === 'number' ? rowData.infractions : 0);

                const displayLabel = key;
                const topClass = useByTime ? (rowData.top_class || null) : null;

                innerHtml += `<li class="dashboard-breakdown-item">
                    <span class="dashboard-breakdown-name">
                        <span>
                            <div>${escapeHtml(displayLabel)}</div>
                            ${topClass ? `<div style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 2px;">${escapeHtml(topClass)}</div>` : ''}
                        </span>
                    </span>
                    <span>
                        <span class="dashboard-breakdown-value">${typeof pctOverall === 'number' ? Math.round(pctOverall) + '%' : '-'}</span>
                        <div style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 2px;">Infractions: ${infractionsCount}</div>
                    </span>
                </li>`;
            });
            innerHtml += `</ul>`;
        } else {
            innerHtml += `<p style="color:var(--text-secondary);font-size:0.875rem;">No trigger time data for this period.</p>`;
        }
        innerHtml += `</div>`;

        // Right column: day-of-week breakdown table (initially hidden until populated)
        innerHtml += `<div class="overview-detail-container trigger-times-day-of-week" style="margin-top:10px; display:none;"></div>`;

        innerHtml += `</div></div>`;

        card.innerHTML = innerHtml;
        grid.appendChild(card);
    };

    const applySelectionChange = (box, key, { restore = false } = {}) => {
        if (!key) return;

        // Handle each selection type with toggle behavior
        if (key === 'days_present') {
            const opened = toggleExtraCard('days_present', buildDaysPresentCard);
            box.classList.toggle('overview-stat-selected', opened);
            if (opened) {
                selectionOrder = selectionOrder.filter(k => k !== 'days_present');
                selectionOrder.push('days_present');
            } else {
                selectionOrder = selectionOrder.filter(k => k !== 'days_present');
            }
        } else if (key === 'star_percent') {
            // Toggle STAR Performance card
            const opened = toggleExtraCard('star_performance', buildStarPerformanceCard);
            box.classList.toggle('overview-stat-selected', opened);
            if (opened) {
                selectionOrder = selectionOrder.filter(k => k !== 'star_percent');
                selectionOrder.push('star_percent');
                if (!restore) {
                    const starCard = container.querySelector('.star-performance-card');
                    if (starCard && typeof starCard.scrollIntoView === 'function') {
                        starCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                    }
                }
            } else {
                selectionOrder = selectionOrder.filter(k => k !== 'star_percent');
            }
        } else if (key === 'starbucks') {
            // Starbucks: only visual selection, no extra card
            box.classList.toggle('overview-stat-selected');
        } else if (key === 'frenzies') {
            // Frenzy reports view has been removed.
            return;
        } else if (key === 'infractions') {
            // Toggle Infractions card; details are shown when a row is selected
            const opened = toggleExtraCard('infractions_card', () => {
                    const card = document.createElement('div');
                    card.className = 'dashboard-card infractions-card overview-extra-card';
                    card.dataset.overviewCard = 'infractions_card';

                    const infractions = data.infractions || data.additional_info?.infractions || {};
                    const infractionKeys = Object.keys(infractions).filter(k => infractions[k] > 0);

                    const OVERVIEW_HINT_KEY = 'infractions_overview_click_hint_seen';
                    const overviewHintSeen = localStorage.getItem(OVERVIEW_HINT_KEY);
                    const overviewHintMsg = 'Click an infraction to see breakdowns by time of day and day of week.';
                    const overviewHintMsgAttr = overviewHintMsg.replace(/"/g, '&quot;');
                    const overviewTitleHintBlock = `
                            <div class="infractions-click-hint infractions-title-hint" data-hint-key="${OVERVIEW_HINT_KEY}" data-hint-message="${overviewHintMsgAttr}">
                                <span class="infractions-hint-icon" role="button" tabindex="0" aria-label="Show hint">i</span>
                                <div class="infractions-hint-popover" role="tooltip" aria-hidden="true" style="display:none;"></div>
                            </div>`;
                    const overviewFirstTimeText = overviewHintSeen ? '' : `<p class="infractions-click-hint-text" data-hint-key="${OVERVIEW_HINT_KEY}" style="font-size:0.8rem;color:var(--text-secondary);margin:4px 0 10px 0;">${escapeHtml(overviewHintMsg)}</p>`;

                    let overviewContent = overviewFirstTimeText;

                    if (infractionKeys.length > 0) {
                        overviewContent += `
                            <table class="dashboard-breakdown-list infractions-breakdown-list" style="border-collapse:collapse;font-size:0.85rem;margin-top:4px;">
                                <thead>
                                    <tr>
                                        <th style="padding:6px 8px;border-bottom:1px solid var(--border);text-align:left;background:var(--bg-elevated);">Infraction</th>
                                        <th style="padding:6px 8px;border-bottom:1px solid var(--border);text-align:right;background:var(--bg-elevated);">Count</th>
                                    </tr>
                                </thead>
                                <tbody>`;
                        infractionKeys.sort((a, b) => infractions[b] - infractions[a]).forEach(k => {
                            overviewContent += `<tr class="dashboard-breakdown-item" data-infraction-type="${escapeHtml(k)}" style="cursor:pointer;">
                                <td class="dashboard-breakdown-name" style="padding:6px 8px;border-bottom:1px solid var(--border);">${escapeHtml(k)}</td>
                                <td style="padding:6px 8px;border-bottom:1px solid var(--border);text-align:right;"><span class="dashboard-breakdown-value">${infractions[k]}</span></td>
                            </tr>`;
                        });
                        overviewContent += `</tbody></table>`;
                    } else {
                        overviewContent += `<p style="color:var(--text-secondary);font-size:0.875rem;">No infractions for this period.</p>`;
                    }

                    const innerHtml = `
                        <div class="dashboard-breakdown-card-inner">
                            <div class="dashboard-card-header infractions-card-header">
                                <h3 class="dashboard-card-title">Infractions</h3>
                                ${overviewTitleHintBlock}
                            </div>
                            <div class="infractions-tabs" role="tablist">
                                <button class="infractions-tab active" data-tab="overview" role="tab" aria-selected="true">
                                    <span class="infractions-tab-label">Overview</span>
                                </button>
                            </div>
                            <div class="infractions-tab-panels">
                                <div class="infractions-tab-panel infractions-tab-overview is-active" data-tab-panel="overview">
                                    ${overviewContent}
                                </div>
                            </div>
                        </div>`;

                    card.innerHTML = innerHtml;
                    grid.appendChild(card);

                    // Tab behavior within the Infractions card
                    const tabsContainer = card.querySelector('.infractions-tabs');
                    const panelsContainer = card.querySelector('.infractions-tab-panels');

                    const setActiveTab = (tabName) => {
                        const allTabs = card.querySelectorAll('.infractions-tab');
                        const allPanels = card.querySelectorAll('.infractions-tab-panel');
                        allTabs.forEach(tab => {
                            const isActive = tab.dataset.tab === tabName;
                            tab.classList.toggle('active', isActive);
                            tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
                        });
                        allPanels.forEach(panel => {
                            panel.classList.toggle('is-active', panel.dataset.tabPanel === tabName);
                        });
                    };

                    const wireTabClicks = () => {
                        const allTabs = card.querySelectorAll('.infractions-tab');
                        allTabs.forEach(tab => {
                            if (tab._infractionsWired) return;
                            tab._infractionsWired = true;
                            tab.addEventListener('click', (e) => {
                                const closeBtn = e.target.closest('.infractions-tab-close');
                                if (closeBtn) {
                                    e.stopPropagation();
                                    const name = tab.dataset.tab;
                                    // Prevent closing the primary Overview tab
                                    if (name === 'overview') return;
                                    const panel = card.querySelector(`.infractions-tab-panel[data-tab-panel="${name}"]`);
                                    if (panel) {
                                        panel.remove();
                                    }
                                    tab.remove();
                                    // If the closed tab was active, fall back to Overview
                                    if (!card.querySelector('.infractions-tab.active')) {
                                        setActiveTab('overview');
                                    }
                                    return;
                                }

                                const tabName = tab.dataset.tab;
                                if (!tabName || tab.disabled) return;
                                setActiveTab(tabName);
                            });
                        });
                    };

                    wireTabClicks();

                    // (i) icon: click shows hint in popover (same text as first-time reminder)
                    card.addEventListener('click', (e) => {
                        const icon = e.target.closest('.infractions-hint-icon');
                        if (icon) {
                            e.preventDefault();
                            const hintDiv = icon.closest('.infractions-click-hint');
                            if (!hintDiv) return;
                            const popover = hintDiv.querySelector('.infractions-hint-popover');
                            if (!popover) return;
                            const msg = hintDiv.getAttribute('data-hint-message');
                            if (msg != null) popover.textContent = msg;
                            const isOpen = popover.getAttribute('aria-hidden') === 'false';
                            card.querySelectorAll('.infractions-hint-popover').forEach(p => {
                                p.style.display = 'none';
                                p.setAttribute('aria-hidden', 'true');
                            });
                            if (!isOpen) {
                                const cardEl = hintDiv.closest('.infractions-card') || card;
                                const cardRect = cardEl.getBoundingClientRect();
                                const hintRect = hintDiv.getBoundingClientRect();
                                const padding = 16;
                                const maxW = Math.max(200, Math.min(480, cardRect.right - hintRect.left - padding));
                                popover.style.maxWidth = maxW + 'px';
                                popover.style.display = 'block';
                                popover.setAttribute('aria-hidden', 'false');
                            }
                            return;
                        }
                        const inPopover = e.target.closest('.infractions-hint-popover');
                        if (!inPopover) {
                            card.querySelectorAll('.infractions-hint-popover').forEach(p => {
                                p.style.display = 'none';
                                p.setAttribute('aria-hidden', 'true');
                            });
                        }
                    });
                    if (!window._infractionsHintPopoverBound) {
                        window._infractionsHintPopoverBound = true;
                        document.addEventListener('click', (e) => {
                            if (e.target.closest('.infractions-card')) return;
                            document.querySelectorAll('.infractions-hint-popover').forEach(p => {
                                p.style.display = 'none';
                                p.setAttribute('aria-hidden', 'true');
                            });
                        }, true);
                    }

                    // Wire row clicks inside this newly created card
                    const infractionRows = card.querySelectorAll('.dashboard-breakdown-item[data-infraction-type]');
                    infractionRows.forEach(row => {
                        row.style.cursor = 'pointer';
                        row.addEventListener('click', () => {
                            const type = row.getAttribute('data-infraction-type');
                            if (!type) return;
                            localStorage.setItem(OVERVIEW_HINT_KEY, '1');
                            const overviewTextEl = card.querySelector('.infractions-click-hint-text[data-hint-key="' + OVERVIEW_HINT_KEY + '"]');
                            if (overviewTextEl) overviewTextEl.remove();
                            const labelText = (row.querySelector('.dashboard-breakdown-name')?.textContent || type).trim();
                            const shortLabel = labelText.length > 28 ? `${labelText.slice(0, 25)}…` : labelText;
                            const tabName = `inf-${type}`;

                            // Look for an existing tab for this infraction
                            let infTab = Array.from(card.querySelectorAll('.infractions-tab'))
                                .find(t => t.dataset.tab === tabName);
                            let targetContainer = null;

                            if (!infTab) {
                                // Create a new tab
                                infTab = document.createElement('button');
                                infTab.className = 'infractions-tab';
                                infTab.dataset.tab = tabName;
                                infTab.setAttribute('role', 'tab');
                                infTab.setAttribute('aria-selected', 'false');
                                const safeLabel = shortLabel || type;
                                infTab.innerHTML = `
                                    <span class="infractions-tab-label">${escapeHtml(safeLabel)}</span>
                                    <span class="infractions-tab-close" aria-label="Close" role="button">&times;</span>
                                `;
                                tabsContainer.appendChild(infTab);

                                // Create its panel
                                const panel = document.createElement('div');
                                panel.className = 'infractions-tab-panel';
                                panel.dataset.tabPanel = tabName;

                                targetContainer = document.createElement('div');
                                targetContainer.className = 'overview-detail-container infractions-by-time-day';
                                targetContainer.style.marginTop = '10px';

                                panel.appendChild(targetContainer);
                                panelsContainer.appendChild(panel);

                                // (Re)wire click handlers now that a new tab exists
                                wireTabClicks();
                            } else {
                                // Reuse existing panel for this infraction
                                const panel = card.querySelector(`.infractions-tab-panel[data-tab-panel="${tabName}"]`);
                                if (panel) {
                                    targetContainer = panel.querySelector('.infractions-by-time-day');
                                }
                            }

                            if (targetContainer) {
                                renderInfractionTypeBreakdown(type, targetContainer);
                            }

                            // Activate this infraction's tab
                            setActiveTab(tabName);
                            scheduleMasonryLayoutAfterResize(grid);
                        });
                    });
                });
            box.classList.toggle('overview-stat-selected', opened);
            if (opened) {
                selectionOrder = selectionOrder.filter(k => k !== 'infractions');
                selectionOrder.push('infractions');
                if (!restore) {
                    const infractionsCard = container.querySelector('.infractions-card');
                    if (infractionsCard && typeof infractionsCard.scrollIntoView === 'function') {
                        infractionsCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                    }
                }
            } else {
                selectionOrder = selectionOrder.filter(k => k !== 'infractions');
            }
        } else if (key === 'reminders') {
            const opened = !getExtraCard('reminders');
            if (opened) {
                renderReminderOrResetDetails('reminders');
                selectionOrder = selectionOrder.filter(k => k !== 'reminders');
                selectionOrder.push('reminders');
            } else {
                removeExtraCard('reminders');
                selectionOrder = selectionOrder.filter(k => k !== 'reminders');
            }
            box.classList.toggle('overview-stat-selected', opened);
        } else if (key === 'resets') {
            const opened = !getExtraCard('resets');
            if (opened) {
                renderReminderOrResetDetails('resets');
                selectionOrder = selectionOrder.filter(k => k !== 'resets');
                selectionOrder.push('resets');
            } else {
                removeExtraCard('resets');
                selectionOrder = selectionOrder.filter(k => k !== 'resets');
            }
            box.classList.toggle('overview-stat-selected', opened);
        } else if (key === 'trigger_times') {
            // Trigger Times: create/toggle the Trigger Times card and show day-of-week breakdown
            const opened = toggleExtraCard('trigger_times', buildTriggerTimesCard);
            box.classList.toggle('overview-stat-selected', opened);
            if (opened) {
                selectionOrder = selectionOrder.filter(k => k !== 'trigger_times');
                selectionOrder.push('trigger_times');
                if (!restore) {
                    const triggerCard = container.querySelector('.trigger-times-card');
                    if (triggerCard && typeof triggerCard.scrollIntoView === 'function') {
                        triggerCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                    }
                    toggleTriggerTimesDayTable();
                } else {
                    // On restore, still populate the day-of-week table once
                    toggleTriggerTimesDayTable();
                }
            } else {
                selectionOrder = selectionOrder.filter(k => k !== 'trigger_times');
            }
        }

        // After any change that affects cards, normalize DOM order so cards
        // appear in selection sequence and store updated order.
        if (Object.prototype.hasOwnProperty.call(STAT_KEY_TO_CARD_KEY, key)) {
            reorderExtraCards();
            persistSelectionOrder();
            // Re-apply masonry layout so newly added/removed cards
            // are positioned into columns immediately after any
            // selection change (including the very first one).
            applySummaryMasonryLayout(grid);
        }
    };

    statBoxes.forEach(box => {
        box.addEventListener('click', () => {
            const key = box.dataset.overviewKey;
            applySelectionChange(box, key, { restore: false });
        });
    });

    // Restore previously selected overview stats (if any) so that cards
    // re-appear in the same order as last time the user viewed this page.
    const storedOrder = loadSelectionOrder();
    if (storedOrder.length) {
        selectionOrder = [];
        storedOrder.forEach(statKey => {
            const box = overviewCard.querySelector(`.overview-stat[data-overview-key="${statKey}"]`);
            if (!box) return;
            applySelectionChange(box, statKey, { restore: true });
        });
        reorderExtraCards();
    }

    // Apply layout whenever overview interactions are (re)wired
    applySummaryMasonryLayout(grid);

}

function renderSummaryComparison(container, data) {
    const periods = Object.keys(data.periods || {});
    if (periods.length === 0) {
        container.innerHTML = '<div class="dashboard-empty"><p>No comparison data available.</p></div>';
        return;
    }

    const trendMetrics = [
        { label: 'Total Days', get: p => Number(p?.total_days || 0) },
        { label: 'Safety %', get: p => Number(p?.percentages?.safety || p?.averages?.safety || 0) },
        { label: 'Teamwork %', get: p => Number(p?.percentages?.teamwork || p?.averages?.teamwork || 0) },
        { label: 'Accountability %', get: p => Number(p?.percentages?.accountability || p?.averages?.accountability || 0) },
        { label: 'Relationships %', get: p => Number(p?.percentages?.relationships || p?.averages?.relationships || 0) },
        { label: 'Overall %', get: p => Number(p?.percentages?.overall || p?.averages?.overall || 0) },
        { label: 'Infractions', get: p => Number(Object.values(p?.infractions || {}).reduce((s, c) => s + c, 0)) },
        { label: 'Reminders', get: p => Number(p?.additional_info?.total_reminders || 0) },
        { label: 'Resets', get: p => Number(p?.additional_info?.total_resets || 0) }
    ];

    let topIncrease = null;
    let topDecrease = null;
    if (periods.length >= 2) {
        const newestKey = periods.includes('Most Recent 30 Days') ? 'Most Recent 30 Days' : periods[periods.length - 1];
        const oldestKey = periods.includes('Previous 30 Days') ? 'Previous 30 Days' : periods[0];
        const newest = data.periods?.[newestKey] || {};
        const oldest = data.periods?.[oldestKey] || {};

        const deltas = trendMetrics
            .map(m => ({ label: m.label, delta: m.get(newest) - m.get(oldest) }))
            .filter(d => Number.isFinite(d.delta));

        const positives = deltas.filter(d => d.delta > 0).sort((a, b) => b.delta - a.delta);
        const negatives = deltas.filter(d => d.delta < 0).sort((a, b) => a.delta - b.delta);

        topIncrease = positives.length ? positives[0] : null;
        topDecrease = negatives.length ? negatives[0] : null;
    }

    const formatDelta = (value) => {
        if (!Number.isFinite(value)) return 'n/a';
        const rounded = Math.round(value * 10) / 10;
        const sign = rounded > 0 ? '+' : '';
        return `${sign}${rounded}`;
    };

    let html = `<div class="dashboard-card-grid">`;
    // Comparison chart card – matches dashboard card style
    html += `<div class="dashboard-card full-width">
        <div class="dashboard-card-header">
            <div>
                <h3 class="dashboard-card-title">Comparison</h3>
                <div class="dashboard-card-subtitle">${periods.length} period${periods.length !== 1 ? 's' : ''} selected</div>
            </div>
            <div style="margin-left:auto; min-width:230px; max-width:320px; border:1px solid var(--border); border-radius:10px; padding:8px 10px; background:var(--bg-elevated);">
                <div style="font-size:11px; letter-spacing:0.04em; text-transform:uppercase; color:var(--text-secondary); margin-bottom:6px;">Trends</div>
                <div style="display:flex; flex-direction:column; gap:4px; font-size:12px;">
                    <div>
                        <strong style="color:${topIncrease ? '#16a34a' : 'var(--text-secondary)'};">Top increase:</strong>
                        ${topIncrease ? `${escapeHtml(topIncrease.label)} (${formatDelta(topIncrease.delta)})` : 'n/a'}
                    </div>
                    <div>
                        <strong style="color:${topDecrease ? '#dc2626' : 'var(--text-secondary)'};">Top decrease:</strong>
                        ${topDecrease ? `${escapeHtml(topDecrease.label)} (${formatDelta(topDecrease.delta)})` : 'n/a'}
                    </div>
                </div>
            </div>
        </div>
        <div class="dashboard-chart-wrap summary-compare-chart-wrap" style="height:260px"><canvas id="summary-compare-chart"></canvas></div>
    </div>`;

    // Comparison table card – use dashboard card header + shared table styling
    html += `<div class="dashboard-card full-width">
        <div class="dashboard-card-header">
            <h3 class="dashboard-card-title">Comparison breakdown</h3>
        </div>
        <div class="dashboard-compare-table-wrap">
        <table class="dashboard-compare-table">
        <thead><tr>
            <th>Metric</th>`;
    periods.forEach(p => { html += `<th style="padding:10px 12px;border:1px solid var(--border);text-align:center;">${escapeHtml(p)}</th>`; });
    html += `</tr></thead><tbody>`;
    const rows = [
        { label: 'Total Days', get: p => p.total_days || 0 },
        { label: 'Safety %', get: p => Math.round(p.percentages?.safety || p.averages?.safety || 0) + '%' },
        { label: 'Teamwork %', get: p => Math.round(p.percentages?.teamwork || p.averages?.teamwork || 0) + '%' },
        { label: 'Accountability %', get: p => Math.round(p.percentages?.accountability || p.averages?.accountability || 0) + '%' },
        { label: 'Relationships %', get: p => Math.round(p.percentages?.relationships || p.averages?.relationships || 0) + '%' },
        { label: 'Overall %', get: p => Math.round(p.percentages?.overall || p.averages?.overall || 0) + '%' },
        { label: 'Infractions', get: p => Object.values(p.infractions || {}).reduce((s, c) => s + c, 0) },
        { label: 'Reminders', get: p => p.additional_info?.total_reminders || 0 },
        { label: 'Resets', get: p => p.additional_info?.total_resets || 0 }
    ];
    rows.forEach(r => {
        html += `<tr><td>${r.label}</td>`;
        periods.forEach(p => {
            html += `<td>${r.get(data.periods[p])}</td>`;
        });
        html += `</tr>`;
    });
    html += `</tbody></table></div></div>`;
    html += `</div>`;
    container.innerHTML = html;

    // Render comparison chart
    const canvas = document.getElementById('summary-compare-chart');
    if (canvas && typeof Chart !== 'undefined') {
        if (summaryChartInstance) { summaryChartInstance.destroy(); summaryChartInstance = null; }
        // Show one chart with STAR categories on the x-axis and
        // the selected periods rendered as side-by-side bars
        const catKeys = ['safety', 'teamwork', 'accountability', 'relationships'];
        const catLabels = ['Safety', 'Teamwork', 'Accountability', 'Relationships'];
        const periodColors = [
            '#1D4ED8', // blue
            '#F97316', // orange
            '#059669', // green
            '#7C3AED'  // purple
        ];
        summaryChartInstance = new Chart(canvas.getContext('2d'), {
            type: 'bar',
            data: {
                // X-axis is STAR categories
                labels: catLabels,
                // Each compared period becomes its own dataset;
                // bars for that period sit next to each other per category
                datasets: periods.map((p, periodIndex) => {
                    const pd = data.periods[p] || {};
                    return {
                        label: p,
                        data: catKeys.map(key => {
                            return pd.percentages?.[key] || pd.averages?.[key] || 0;
                        }),
                        backgroundColor: periodColors[periodIndex % periodColors.length],
                        // Match non-comparison STAR chart style (4 rounded corners)
                        borderRadius: 8,
                        borderSkipped: false,
                        // Make each bar relatively thick so grouped bars visually fill the category
                        barThickness: 32,
                        maxBarThickness: 48
                    };
                })
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'top' },
                    datalabels: {
                        anchor: 'end',
                        align: 'end',
                        offset: -4,
                        color: '#111827',
                        clip: false,
                        font: {
                            weight: '600',
                            size: 10
                        },
                        formatter: (value) => `${Math.round(value)}%`
                    }
                },
                scales: {
                    y: { beginAtZero: true, max: 100, ticks: { callback: v => v + '%' }, grid: { color: 'rgba(0,0,0,0.04)' } },
                    x: {
                        grid: { display: false },
                        stacked: false,
                        // Keep bars within a category tight, but add more
                        // whitespace between the STAR categories themselves.
                        categoryPercentage: 0.7,
                        barPercentage: 0.95,
                        ticks: {
                            maxRotation: 0,
                            minRotation: 0,
                            autoSkip: false
                        }
                    }
                }
            }
        });
    }
}

// ---- Frenzy Dashboard ----
async function loadFrenzyDashboard() {
    const st = dashboardState.frenzy;
    const container = document.getElementById('frenzy-results');
    if (!container) return;

    container.innerHTML = '<div class="dashboard-loading"><div class="dashboard-spinner"></div><p>Loading frenzy stats...</p></div>';

    const quarterDates = typeof loadQuarterDates === 'function' ? loadQuarterDates() : {};
    const schoolYearDates = typeof loadSchoolYearDates === 'function' ? loadSchoolYearDates() : {};
    const quarterDatesForBackend = typeof convertQuarterDatesForBackend === 'function' ? convertQuarterDatesForBackend(quarterDates) : {};
    const schoolYearDatesForBackend = typeof convertSchoolYearDatesForBackend === 'function' ? convertSchoolYearDatesForBackend(schoolYearDates) : {};

    const params = [];
    if (st.compareMode) {
        const selectEl = document.getElementById('frenzy-timeframe-select');
        const tf = selectEl ? selectEl.value : '';
        if (tf) {
            params.push(`timeframe=${tf}`);
            if (tf === 'month') {
                const sySelect = document.getElementById('frenzy-school-year-select');
                const sy = sySelect ? sySelect.value : (typeof getCurrentSchoolYear === 'function' ? getCurrentSchoolYear() : '');
                if (sy) params.push(`school_year=${encodeURIComponent(sy)}`);
            } else if (tf === 'custom_range') {
                const start = st.customStart;
                const end = st.customEnd;
                if (start && end) {
                    params.push(`start_date=${encodeURIComponent(start)}`);
                    params.push(`end_date=${encodeURIComponent(end)}`);
                }
            }
        }
    } else {
        if (st.period) params.push(`period=${encodeURIComponent(st.period)}`);
    }
    if (st.studentId) params.push(`student_id=${st.studentId}`);
    if (st.staffId) params.push(`staff_id=${st.staffId}`);
    const managedCheckbox = document.getElementById('frenzy-managed-by-me-checkbox');
    if (managedCheckbox && managedCheckbox.checked) params.push('managed_by_me=true');
    params.push(`quarter_dates=${encodeURIComponent(JSON.stringify(quarterDatesForBackend))}`);
    params.push(`school_year_dates=${encodeURIComponent(JSON.stringify(schoolYearDatesForBackend))}`);

    const url = '/api/frenzy-stats?' + params.join('&');

    try {
        const response = await fetch(url);
        const data = await response.json();
        window.currentFrenzyStatsData = data;

        const printBtn = document.getElementById('print-frenzy-btn');
        if (printBtn) printBtn.disabled = false;

        if (data.comparison_mode && data.periods) {
            renderFrenzyComparison(container, data);
        } else {
            renderFrenzySingle(container, data);
        }
    } catch (err) {
        container.innerHTML = `<div class="dashboard-empty"><p>Error loading frenzy stats: ${err.message}</p></div>`;
    }
}

function renderFrenzySingle(container, data) {
    const totalCount = data.total_count || 0;
    const totalDuration = data.total_duration || 0;
    const avgDuration = data.avg_duration || 0;
    const byDay = data.by_day || {};
    const byLocation = data.by_location || {};
    const byPurpose = data.by_purpose || {};
    const allPurposes = data.all_purposes || [];
    const allResults = data.all_results || [];

    let html = `<div class="dashboard-card-grid">`;

    // Frenzy Frequency Chart
    const dayOrder = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
    const hasDayData = dayOrder.some(d => byDay[d]);
    html += `<div class="dashboard-card">
        <div class="dashboard-card-header">
            <div>
                <h3 class="dashboard-card-title">Frenzy Frequency</h3>
                <div class="dashboard-card-subtitle">${totalCount} total frenzy event${totalCount !== 1 ? 's' : ''}</div>
            </div>
        </div>
        <div class="dashboard-chart-wrap"><canvas id="frenzy-freq-chart"></canvas></div>
    </div>`;

    // Duration Stats Card
    html += `<div class="dashboard-card">
        <div class="dashboard-card-header"><h3 class="dashboard-card-title">Duration Breakdown</h3></div>
        <div class="dashboard-stat-row">
            <div class="dashboard-stat-box"><div class="dashboard-stat-value">${totalCount}</div><div class="dashboard-stat-label">Frenzies</div></div>
            <div class="dashboard-stat-box"><div class="dashboard-stat-value">${totalDuration}</div><div class="dashboard-stat-label">Minutes</div></div>
            <div class="dashboard-stat-box"><div class="dashboard-stat-value">${typeof avgDuration === 'number' ? avgDuration.toFixed(1) : '0'}</div><div class="dashboard-stat-label">Avg Min</div></div>
        </div>`;

    // By-location breakdown
    const locKeys = Object.keys(byLocation);
    if (locKeys.length > 0) {
        html += `<ul class="dashboard-breakdown-list" style="margin-top:12px;">`;
        locKeys.sort((a, b) => (byLocation[b].count || 0) - (byLocation[a].count || 0)).forEach((loc, i) => {
            const ld = byLocation[loc];
            const dotColor = DASHBOARD_COLORS.palette[i % DASHBOARD_COLORS.palette.length];
            html += `<li class="dashboard-breakdown-item">
                <span class="dashboard-breakdown-name"><span class="dashboard-breakdown-dot" style="background:${dotColor}"></span>${escapeHtml(loc)}</span>
                <span><span class="dashboard-breakdown-value">${ld.count || 0}</span><span class="dashboard-breakdown-meta">${ld.duration || 0} min</span></span>
            </li>`;
        });
        html += `</ul>`;
    }
    html += `</div>`;

    // Purpose & Results Card
    html += `<div class="dashboard-card">
        <div class="dashboard-card-header"><h3 class="dashboard-card-title">Purpose</h3></div>`;
    const purposeKeys = Object.keys(byPurpose);
    if (purposeKeys.length > 0) {
        html += `<div class="dashboard-log-list">`;
        purposeKeys.sort((a, b) => (byPurpose[b].count || 0) - (byPurpose[a].count || 0)).forEach(p => {
            html += `<div class="dashboard-log-item"><span class="log-type"><span class="dashboard-badge badge-blue">${escapeHtml(p)}</span></span><span class="log-count">${byPurpose[p].count || 0}</span></div>`;
        });
        html += `</div>`;
    } else {
        html += `<p style="color:var(--text-secondary);font-size:0.875rem;">No purpose data recorded.</p>`;
    }
    if (allResults.length > 0) {
        html += `<div style="margin-top:16px;"><div class="dashboard-card-subtitle" style="margin-bottom:8px;">Results</div>`;
        html += `<div class="dashboard-tag-cloud">`;
        const resultCounts = {};
        allResults.forEach(r => { resultCounts[r] = (resultCounts[r] || 0) + 1; });
        Object.keys(resultCounts).sort((a, b) => resultCounts[b] - resultCounts[a]).forEach(r => {
            html += `<span class="dashboard-tag">${escapeHtml(r)}<span class="tag-count">${resultCounts[r]}</span></span>`;
        });
        html += `</div></div>`;
    }
    html += `</div>`;

    // Day-of-week detail card
    if (hasDayData) {
        html += `<div class="dashboard-card">
            <div class="dashboard-card-header"><h3 class="dashboard-card-title">By Day of Week</h3></div>
            <ul class="dashboard-breakdown-list">`;
        dayOrder.forEach((d, i) => {
            const dd = byDay[d];
            if (dd) {
                html += `<li class="dashboard-breakdown-item">
                    <span class="dashboard-breakdown-name"><span class="dashboard-breakdown-dot" style="background:${DASHBOARD_COLORS.palette[i]}"></span>${d.substring(0, 3)}</span>
                    <span><span class="dashboard-breakdown-value">${dd.count || 0}</span><span class="dashboard-breakdown-meta">${dd.duration || 0} min</span></span>
                </li>`;
            }
        });
        html += `</ul></div>`;
    }

    html += `</div>`;
    container.innerHTML = html;

    // Render Frenzy Frequency Chart
    const freqCanvas = document.getElementById('frenzy-freq-chart');
    if (freqCanvas && typeof Chart !== 'undefined') {
        if (frenzyChartInstance) { frenzyChartInstance.destroy(); frenzyChartInstance = null; }
        const labels = dayOrder;
        const counts = labels.map(d => byDay[d]?.count || 0);
        frenzyChartInstance = new Chart(freqCanvas.getContext('2d'), {
            type: 'bar',
            data: {
                labels: labels.map(d => d.substring(0, 3)),
                datasets: [{
                    label: 'Frenzies',
                    data: counts,
                    backgroundColor: '#F97316',
                    borderRadius: 8,
                    maxBarThickness: 48
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    y: { beginAtZero: true, ticks: { stepSize: 1 }, grid: { color: 'rgba(0,0,0,0.04)' } },
                    x: { grid: { display: false } }
                }
            }
        });
    }
}

function renderFrenzyComparison(container, data) {
    const periods = Object.keys(data.periods || {});
    if (periods.length === 0) {
        container.innerHTML = '<div class="dashboard-empty"><p>No comparison data available.</p></div>';
        return;
    }
    let html = `<div class="dashboard-card-grid">`;
    html += `<div class="dashboard-card full-width">
        <div class="dashboard-card-header">
            <div>
                <h3 class="dashboard-card-title">Frenzy Comparison</h3>
                <div class="dashboard-card-subtitle">${periods.length} period${periods.length !== 1 ? 's' : ''} selected</div>
            </div>
        </div>
        <div class="dashboard-chart-wrap" style="height:260px"><canvas id="frenzy-compare-chart"></canvas></div>
    </div>`;
    html += `<div class="dashboard-card full-width">
        <div class="dashboard-card-header">
            <h3 class="dashboard-card-title">Comparison breakdown</h3>
        </div>
        <div style="overflow-x:auto;">
        <table class="dashboard-compare-table">
        <thead><tr>
            <th>Metric</th>`;
    periods.forEach(p => { html += `<th style="padding:10px 12px;border:1px solid var(--border);text-align:center;">${escapeHtml(p)}</th>`; });
    html += `</tr></thead><tbody>`;
    const rows = [
        { label: 'Total Frenzies', get: p => p.total_count || 0 },
        { label: 'Total Duration (min)', get: p => p.total_duration || 0 },
        { label: 'Avg Duration (min)', get: p => typeof p.avg_duration === 'number' ? p.avg_duration.toFixed(1) : '0' }
    ];
    rows.forEach(r => {
        html += `<tr><td>${r.label}</td>`;
        periods.forEach(p => {
            html += `<td>${r.get(data.periods[p])}</td>`;
        });
        html += `</tr>`;
    });
    html += `</tbody></table></div></div></div>`;
    container.innerHTML = html;

    const canvas = document.getElementById('frenzy-compare-chart');
    if (canvas && typeof Chart !== 'undefined') {
        if (frenzyChartInstance) { frenzyChartInstance.destroy(); frenzyChartInstance = null; }
        frenzyChartInstance = new Chart(canvas.getContext('2d'), {
            type: 'bar',
            data: {
                labels: periods,
                datasets: [
                    { label: 'Total Frenzies', data: periods.map(p => data.periods[p].total_count || 0), backgroundColor: '#F97316', borderRadius: 6, maxBarThickness: 32 },
                    { label: 'Avg Duration (min)', data: periods.map(p => data.periods[p].avg_duration || 0), backgroundColor: '#60A5FA', borderRadius: 6, maxBarThickness: 32 }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { position: 'top' } },
                scales: {
                    y: { beginAtZero: true, grid: { color: 'rgba(0,0,0,0.04)' } },
                    x: { grid: { display: false } }
                }
            }
        });
    }
}

// Ensure numeric values in Reports tab tables are right-aligned
function setupReportsNumberAlignment() {
    const summaryContainer = document.getElementById('summary-results');
    const frenzyContainer = document.getElementById('frenzy-results');
    const pointCardContainer = document.getElementById('point-card-data-container');

    const targets = [summaryContainer, frenzyContainer, pointCardContainer].filter(Boolean);
    if (!targets.length || typeof MutationObserver === 'undefined') {
        return;
    }

    const numericRegex = /^[^A-Za-z]*\d[^A-Za-z]*$/;

    function alignNumericCells(root) {
        if (!root) return;
        const cells = root.querySelectorAll('table th, table td');
        cells.forEach(cell => {
            // First column (times/labels) stays left-aligned — do not treat as numeric
            if (cell.cellIndex === 0) {
                cell.classList.remove('numeric-cell');
                return;
            }
            const text = (cell.textContent || '').trim();
            if (text && numericRegex.test(text)) {
                cell.classList.add('numeric-cell');
            } else {
                cell.classList.remove('numeric-cell');
            }
        });
    }

    targets.forEach(target => {
        let scheduled = false;
        const raf = window.requestAnimationFrame || function (fn) { return setTimeout(fn, 0); };

        function scheduleAlign() {
            if (scheduled) return;
            scheduled = true;
            raf(() => {
                scheduled = false;
                alignNumericCells(target);
            });
        }

        // Initial pass in case content is already present
        alignNumericCells(target);

        const observer = new MutationObserver((mutations) => {
            for (let i = 0; i < mutations.length; i++) {
                const m = mutations[i];
                if (m.type === 'childList' || m.type === 'characterData') {
                    scheduleAlign();
                    break;
                }
            }
        });

        observer.observe(target, {
            childList: true,
            subtree: true,
            characterData: true
        });
    });
}

// ---- Initialize Dashboard ----
function initDashboard() {
    removeLegacyReportsToggleButtons();

    ['summary', 'frenzy'].forEach(pageKey => {
        setupDashboardSearch(`${pageKey}`, 'student');
        setupDashboardSearch(`${pageKey}`, 'staff');
        setupFilterPills(pageKey);
        setupCompareToggle(pageKey);
        setupContextClear(pageKey);
    });

    // Incentive Tracking is specific to the Summary (Point Card) view
    setupIncentiveToggle();

    // Right-align numeric values in Reports tab tables
    setupReportsNumberAlignment();

    // Wire managed-by-me checkboxes
    const summaryManagedCheckbox = document.getElementById('summary-managed-by-me-checkbox');
    if (summaryManagedCheckbox) {
        summaryManagedCheckbox.addEventListener('change', () => triggerDashboardLoad('summary'));
    }
    // Wire Reports sub-toggle button(s) to switch views
    const reportsToggleButtons = document.querySelectorAll('.reports-toggle-btn');
    reportsToggleButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const targetView = btn.dataset.reportsView;
            if (!targetView) return;
            // Use normal view switching so all existing logic (managed by me, dashboard load, etc.) still runs
            switchView(targetView);
            if (typeof triggerDashboardLoad === 'function') {
                if (targetView === 'summary') {
                    setTimeout(() => triggerDashboardLoad('summary'), 100);
                }
            }
        });
    });

    syncSummaryPointCardButton();
}

// Auto-load when switching to summary tab
const origNavHandler = document.querySelectorAll('.nav-btn');
origNavHandler.forEach(btn => {
    btn.addEventListener('click', () => {
        const view = btn.dataset.view;
        if (view === 'summary') {
            setTimeout(() => triggerDashboardLoad('summary'), 100);
        }
    });
});

// Init when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDashboard);
} else {
    setTimeout(initDashboard, 0);
}

// Expose functions to window
window.loadParentChildren = loadParentChildren;
window.viewChildRecords = viewChildRecords;
window.openAmendmentRequestModal = openAmendmentRequestModal;
window.closeAmendmentRequestModal = closeAmendmentRequestModal;
window.submitAmendmentRequest = submitAmendmentRequest;
window.toggleDirectoryOptOut = toggleDirectoryOptOut;
window.exportChildData = exportChildData;
window.removeParentStudent = removeParentStudent;
window.addParentStudent = addParentStudent;
window.verifyParentStudent = verifyParentStudent;
