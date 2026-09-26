// Help button (bottom-right "?") -> a gallery of tutorial videos relevant to
// whatever view is currently active. Videos are served locally (staff/admin
// login required, see /tutorial-videos/<file> in app.py) via `videoFile`.
// A `youtubeId` is also supported as a fallback/alternative; if neither is
// set, the card shows a "Video coming soon" placeholder instead.
const TUTORIAL_VIDEOS = {
    'period-entry': {
        title: 'Point Card: Period Entry',
        description: 'Scoring one class period across every scheduled student.',
        duration: '1:01',
        videoFile: 'point-card-period-entry.mp4',
        youtubeId: ''
    },
    'daily-entry': {
        title: 'Point Card: Daily Entry',
        description: "Scoring a student's whole day, all periods at once.",
        duration: '1:11',
        videoFile: 'point-card-daily-entry.mp4',
        youtubeId: ''
    },
    'past-point-cards': {
        title: 'Past Point Cards',
        description: "Viewing a student's past point cards and printing them (Full Card / Info Insights).",
        duration: '1:04',
        videoFile: 'past-point-cards.mp4',
        youtubeId: ''
    },
    'reports-navigation': {
        title: 'Reports: Navigation',
        description: 'Student vs. group, timeframe, Compare / Incentive Tracking show-hide, Insights View, Print.',
        duration: '1:31',
        videoFile: 'reports-navigation.mp4',
        youtubeId: ''
    },
    'report-sections': {
        title: 'Reports: What Each Section Shows',
        description: 'Attendance, STAR Percent, Plan Thresholds, Trigger Time, Infractions, Incidents, Level Ups, Frenzies.',
        duration: '1:19',
        videoFile: 'report-sections.mp4',
        youtubeId: ''
    },
    'bills': {
        title: 'Bills',
        description: 'Class overview, turning bills on for a student, This week / Pay / worksheets, My Plan, Savings, Assistance, History.',
        duration: '1:30',
        videoFile: 'bills.mp4',
        youtubeId: ''
    },
    'schedules': {
        title: 'Schedules: Teacher & Student Setup',
        description: 'Look up a teacher or student schedule, add a period, save, and export (print/CSV, with or without rosters).',
        duration: '1:08',
        videoFile: 'schedules.mp4',
        youtubeId: ''
    },
    'bank-account-bonuses': {
        title: 'Bank Account: Staff Bonuses',
        description: 'Awarding Starbucks/Star Student counts per student and Star Classroom per caseload, then submitting the table.',
        duration: '0:57',
        videoFile: 'bank-account-bonuses.mp4',
        youtubeId: ''
    },
    'bank-account-balances': {
        title: 'Bank Account: Balances & Paychecks',
        description: "Viewing a student's balance, emergency fund, and paychecks, plus the Weekly Earnings Record worksheet.",
        duration: '0:51',
        videoFile: 'bank-account-balances.mp4',
        youtubeId: ''
    },
    'marketplace-shopping': {
        title: 'Marketplace: Shopping & Checkout',
        description: 'Searching and filtering items, adding to cart, checking out, and viewing My Orders.',
        duration: '0:39',
        videoFile: 'marketplace-shopping.mp4',
        youtubeId: ''
    },
    'marketplace-fulfilling': {
        title: 'Marketplace: Fulfilling Orders',
        description: 'Working the purchase-order queue to approve and fulfill student orders.',
        duration: '0:35',
        videoFile: 'marketplace-fulfilling.mp4',
        youtubeId: ''
    },
    'marketplace-managing': {
        title: 'Marketplace: Managing Items & Analytics',
        description: 'Adding marketplace items, hiding/unhiding in bulk, and reading the purchase-analytics panel.',
        duration: '0:52',
        videoFile: 'marketplace-managing.mp4',
        youtubeId: ''
    },
    'users-accounts': {
        title: 'User Management: Accounts & Roster',
        description: 'Searching students/staff/outside staff/admins, adding accounts, and sharing login information in bulk.',
        duration: '0:48',
        videoFile: 'users-accounts.mp4',
        youtubeId: ''
    },
    'users-accounts-staff': {
        title: 'User Management: Accounts & Roster (Staff view)',
        description: 'What a plain staff account sees on this page — Add Student at the top of the list, and the now-required student/parent emails.',
        duration: '0:37',
        videoFile: 'users-accounts-staff.mp4',
        youtubeId: ''
    },
    'users-accounts-outside-staff': {
        title: 'User Management: Accounts & Roster (Outside Staff view)',
        description: "What an Outside Staff account sees on this page — search and view every table, but no adding or editing accounts.",
        duration: '0:33',
        videoFile: 'users-accounts-outside-staff.mp4',
        youtubeId: ''
    },
    'users-student-plans': {
        title: 'User Management: Student Plans',
        description: "Adding or editing a student's plan from their row's kebab menu.",
        duration: '0:38',
        videoFile: 'users-student-plans.mp4',
        youtubeId: ''
    },
    'admin-accounts-billing': {
        title: 'Admin: Accounts & Billing',
        description: 'Managing your subscription/billing and creating new staff or admin accounts.',
        duration: '0:33',
        videoFile: 'admin-accounts-billing.mp4',
        youtubeId: ''
    },
    'admin-importing-data': {
        title: 'Admin: Importing Data',
        description: 'Bulk CSV import of staff/outside staff/students, and syncing with a Google Sheet.',
        duration: '0:48',
        videoFile: 'admin-importing-data.mp4',
        youtubeId: ''
    },
    'admin-calendar-economy': {
        title: 'Admin: Calendar & Economy Settings',
        description: 'Setting up the school calendar (quarters, holidays) and the market economy (cost of living, bill prices, late fees).',
        duration: '0:47',
        videoFile: 'admin-calendar-economy.mp4',
        youtubeId: ''
    },
    'reports-attendance': {
        title: 'Reports: Attendance Drill-Down',
        description: 'Clicking into the Attendance tile — table view by day, graph view over time.',
        duration: '0:43',
        videoFile: 'reports-attendance.mp4',
        youtubeId: ''
    },
    'reports-star-percent': {
        title: 'Reports: STAR Percent Drill-Down',
        description: 'Clicking into the STAR Percent tile, then a category bar, for time-of-day and day-of-week detail.',
        duration: '0:42',
        videoFile: 'reports-star-percent.mp4',
        youtubeId: ''
    },
    'reports-plan-thresholds': {
        title: 'Reports: Plan Thresholds Drill-Down',
        description: "Clicking into Plan Thresholds for the by-If and by-student breakdown behind the count.",
        duration: '0:36',
        videoFile: 'reports-plan-thresholds.mp4',
        youtubeId: ''
    },
    'reports-trigger-time': {
        title: 'Reports: Trigger Time Drill-Down',
        description: 'Clicking into Trigger Time, then a specific time slot, for its own severity and frenzy detail.',
        duration: '0:42',
        videoFile: 'reports-trigger-time.mp4',
        youtubeId: ''
    },
    'reports-infractions': {
        title: 'Reports: Infractions Drill-Down',
        description: 'Clicking into Infractions, then a specific type, for when it happens by time of day and day of week.',
        duration: '0:41',
        videoFile: 'reports-infractions.mp4',
        youtubeId: ''
    },
    'reports-incidents': {
        title: 'Reports: Incidents Drill-Down',
        description: 'Clicking into Reminders and Resets for their own graph/table breakdown.',
        duration: '0:43',
        videoFile: 'reports-incidents.mp4',
        youtubeId: ''
    },
    'reports-level-ups': {
        title: "Reports: Level Up's Drill-Down",
        description: 'Clicking into Level Up\'s for the Yellow→Green and Green→Blue readiness tables.',
        duration: '0:37',
        videoFile: 'reports-level-ups.mp4',
        youtubeId: ''
    },
    'reports-frenzies': {
        title: 'Reports: Frenzies Drill-Down',
        description: 'Clicking into Frenzies, then a severity level, for its time-of-day and day-of-week detail.',
        duration: '0:44',
        videoFile: 'reports-frenzies.mp4',
        youtubeId: ''
    },
    'marketplace-hiding': {
        title: 'Marketplace: Creating & Hiding Items',
        description: "Adding a new item, and what hiding it from students (by student, card color, grade, or caseload) actually does.",
        duration: '1:03',
        videoFile: 'marketplace-hiding.mp4',
        youtubeId: ''
    },
    'notifications': {
        title: 'Notifications',
        description: 'The header bell — unread badge, mark all read, and clicking a notification to jump straight to what it\'s about.',
        duration: '0:45',
        videoFile: 'notifications.mp4',
        youtubeId: ''
    },
    'reports-level-up-action': {
        title: 'Reports: Leveling a Student Up',
        description: 'Clicking the Level Up button on an eligible student — who can see it, the confirmation, and what happens right after.',
        duration: '0:35',
        videoFile: 'reports-level-up-action.mp4',
        youtubeId: ''
    }
};

// Maps each top-level view (the id of its `.view` div, minus the "-view"
// suffix) to the tutorial(s) relevant to it. Views not listed here simply
// show the empty state when the help button is opened.
const VIEW_TUTORIALS = {
    'period-entry': ['period-entry', 'past-point-cards', 'notifications'],
    'entry': ['daily-entry', 'past-point-cards', 'notifications'],
    'summary': [
        'reports-navigation', 'report-sections',
        'reports-attendance', 'reports-star-percent', 'reports-plan-thresholds',
        'reports-trigger-time', 'reports-infractions', 'reports-incidents',
        'reports-level-ups', 'reports-level-up-action', 'reports-frenzies', 'notifications'
    ],
    'bills': ['bills', 'notifications'],
    'schedules': ['schedules', 'notifications'],
    'bank-account': ['bank-account-bonuses', 'bank-account-balances', 'notifications'],
    'marketplace': ['marketplace-shopping', 'marketplace-fulfilling', 'marketplace-managing', 'marketplace-hiding', 'notifications'],
    'users': ['users-accounts', 'users-accounts-staff', 'users-accounts-outside-staff', 'users-student-plans', 'notifications'],
    'admin': ['admin-accounts-billing', 'admin-importing-data', 'admin-calendar-economy', 'notifications']
};

// Friendly page names for search-result badges (view name -> label).
const VIEW_LABELS = {
    'period-entry': 'Point Card (Period Entry)',
    'entry': 'Point Card (Daily Entry)',
    'summary': 'Reports',
    'bills': 'Bills',
    'schedules': 'Schedules',
    'bank-account': 'Bank Account',
    'marketplace': 'Marketplace',
    'users': 'User Management',
    'admin': 'Admin'
};

// Reverse index built from VIEW_TUTORIALS: tutorial key -> view name.
const TUTORIAL_KEY_TO_VIEW = {};
Object.keys(VIEW_TUTORIALS).forEach(viewName => {
    VIEW_TUTORIALS[viewName].forEach(key => {
        TUTORIAL_KEY_TO_VIEW[key] = viewName;
    });
});

function getCurrentViewName() {
    const activeView = document.querySelector('.view.active');
    if (!activeView) return null;
    return activeView.id.replace(/-view$/, '');
}

function searchTutorials(query) {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return Object.keys(TUTORIAL_VIDEOS).filter(key => {
        const video = TUTORIAL_VIDEOS[key];
        return video.title.toLowerCase().includes(q) || video.description.toLowerCase().includes(q);
    });
}

// A hand-picked mid-video frame for each tutorial key, not the opening view —
// see static/tutorial-thumbs/README.md for how these were chosen/regenerated.
function tutorialThumbnailUrl(key) {
    return `/static/tutorial-thumbs/${key}.jpg`;
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
}

// Builds one tutorial card. `showBadge` adds a "which page" pill, used in
// search results where cards may come from views other than the current one.
function buildTutorialCard(key, { showBadge = false } = {}) {
    const video = TUTORIAL_VIDEOS[key];
    if (!video) return '';
    const thumbUrl = tutorialThumbnailUrl(key);
    const viewName = TUTORIAL_KEY_TO_VIEW[key];
    const badge = showBadge && viewName
        ? `<span class="tutorial-card-badge">${escapeHtml(VIEW_LABELS[viewName] || viewName)}</span>`
        : '';
    return `
        <button type="button" class="tutorial-card" data-tutorial-key="${key}">
            <div class="tutorial-card-thumb">
                <img src="${thumbUrl}" alt="" loading="lazy" onerror="this.remove()">
                <span class="tutorial-play-icon"></span>
                ${video.duration ? `<span class="tutorial-card-duration">${video.duration}</span>` : ''}
            </div>
            <div class="tutorial-card-body">
                ${badge}
                <p class="tutorial-card-title">${escapeHtml(video.title)}</p>
                <p class="tutorial-card-desc">${escapeHtml(video.description)}</p>
            </div>
        </button>
    `;
}

function wireTutorialCardClicks(body) {
    body.querySelectorAll('.tutorial-card').forEach(card => {
        card.addEventListener('click', () => openTutorialByKey(card.dataset.tutorialKey));
    });
}

function resetTutorialModalChrome() {
    const modal = document.getElementById('tutorial-modal');
    const backBtn = document.getElementById('tutorial-back-btn');
    if (modal) modal.classList.remove('tutorial-modal-playing');
    if (backBtn) backBtn.classList.remove('visible');
}

function renderTutorialGrid() {
    const subtitle = document.getElementById('tutorial-modal-subtitle');
    const body = document.getElementById('tutorial-modal-body');
    if (!body) return;

    resetTutorialModalChrome();

    const viewName = getCurrentViewName();
    const keys = VIEW_TUTORIALS[viewName] || [];

    if (subtitle) {
        subtitle.textContent = keys.length
            ? 'Tutorials for this page'
            : 'No tutorials for this page yet';
    }

    if (!keys.length) {
        body.innerHTML = '<p class="tutorial-empty-state">There aren\'t any tutorial videos for this page yet.</p>';
        return;
    }

    body.innerHTML = `<div class="tutorial-grid">${keys.map(key => buildTutorialCard(key)).join('')}</div>`;
    wireTutorialCardClicks(body);
}

// Searches every tutorial (regardless of the current page) by title/description.
function renderTutorialSearchResults(query) {
    const subtitle = document.getElementById('tutorial-modal-subtitle');
    const body = document.getElementById('tutorial-modal-body');
    if (!body) return;

    resetTutorialModalChrome();

    const keys = searchTutorials(query);

    if (subtitle) {
        subtitle.textContent = keys.length
            ? `${keys.length} result${keys.length === 1 ? '' : 's'} for "${query.trim()}"`
            : `No results for "${query.trim()}"`;
    }

    if (!keys.length) {
        body.innerHTML = '<p class="tutorial-empty-state">No tutorial videos match your search.</p>';
        return;
    }

    body.innerHTML = `<div class="tutorial-grid">${keys.map(key => buildTutorialCard(key, { showBadge: true })).join('')}</div>`;
    wireTutorialCardClicks(body);
}

function getTutorialSearchQuery() {
    const input = document.getElementById('tutorial-search-input');
    return input ? input.value : '';
}

// Re-renders whatever should currently be showing (search results if there's
// an active query, otherwise the current page's grid). Used after closing a
// video (back button) and after a search-result navigation completes.
function renderTutorialListForCurrentState() {
    const query = getTutorialSearchQuery();
    if (query.trim()) {
        renderTutorialSearchResults(query);
    } else {
        renderTutorialGrid();
    }
}

// Opens a tutorial by key, navigating to its page first if it isn't the one
// currently active (e.g. a search result found from a different page).
async function openTutorialByKey(key) {
    const targetView = TUTORIAL_KEY_TO_VIEW[key];
    const currentView = getCurrentViewName();
    if (targetView && targetView !== currentView && typeof window.switchView === 'function') {
        await window.switchView(targetView);
    }
    openTutorialPlayer(key);
}

function openTutorialPlayer(key) {
    const video = TUTORIAL_VIDEOS[key];
    if (!video) return;

    const modal = document.getElementById('tutorial-modal');
    const backBtn = document.getElementById('tutorial-back-btn');
    const subtitle = document.getElementById('tutorial-modal-subtitle');
    const body = document.getElementById('tutorial-modal-body');
    if (!body) return;

    if (modal) modal.classList.add('tutorial-modal-playing');
    if (backBtn) backBtn.classList.add('visible');
    if (subtitle) subtitle.textContent = video.title;

    let player;
    if (video.videoFile) {
        player = `<div class="tutorial-player-frame-wrap">
               <video src="/tutorial-videos/${encodeURIComponent(video.videoFile)}"
                      title="${escapeHtml(video.title)}" controls autoplay playsinline></video>
           </div>`;
    } else if (video.youtubeId) {
        player = `<div class="tutorial-player-frame-wrap">
               <iframe src="https://www.youtube.com/embed/${video.youtubeId}?autoplay=1&rel=0"
                       title="${escapeHtml(video.title)}"
                       allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                       allowfullscreen></iframe>
           </div>`;
    } else {
        player = `<p class="tutorial-empty-state">This video hasn't been uploaded yet — check back soon.</p>`;
    }

    body.innerHTML = `
        <div class="tutorial-player">
            ${player}
            <p class="tutorial-player-title">${escapeHtml(video.title)}</p>
            <p class="tutorial-player-desc">${escapeHtml(video.description)}</p>
        </div>
    `;
}

function openTutorialModal() {
    const modal = document.getElementById('tutorial-modal');
    if (!modal) return;
    renderTutorialGrid();
    modal.style.display = 'block';
    document.body.classList.add('tutorial-modal-open');
}

function closeTutorialModal() {
    const modal = document.getElementById('tutorial-modal');
    if (!modal) return;
    modal.style.display = 'none';
    document.body.classList.remove('tutorial-modal-open');
    // Stop playback by clearing the iframe once the modal is hidden.
    const body = document.getElementById('tutorial-modal-body');
    if (body) body.innerHTML = '';

    const searchInput = document.getElementById('tutorial-search-input');
    if (searchInput) searchInput.value = '';

    resetTutorialSuggestionPanel();
}

function resetTutorialSuggestionPanel() {
    const panel = document.getElementById('tutorial-suggestion-panel');
    const text = document.getElementById('tutorial-suggestion-text');
    const status = document.getElementById('tutorial-suggestion-status');
    if (panel) panel.hidden = true;
    if (text) text.value = '';
    if (status) {
        status.textContent = '';
        status.className = 'tutorial-suggestion-status';
    }
}

async function submitTutorialSuggestion() {
    const text = document.getElementById('tutorial-suggestion-text');
    const status = document.getElementById('tutorial-suggestion-status');
    const submitBtn = document.getElementById('tutorial-suggestion-submit');
    const kindInput = document.querySelector('input[name="tutorial-suggestion-kind"]:checked');
    const message = text ? text.value.trim() : '';

    if (!message) {
        if (status) {
            status.textContent = 'Please enter a message first.';
            status.className = 'tutorial-suggestion-status tutorial-suggestion-status-error';
        }
        return;
    }

    if (submitBtn) submitBtn.disabled = true;
    if (status) {
        status.textContent = 'Sending...';
        status.className = 'tutorial-suggestion-status';
    }

    try {
        const response = await fetch('/api/tutorial-suggestions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({
                message,
                kind: kindInput ? kindInput.value : 'suggestion',
                page_context: getCurrentViewName()
            })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(data.error || 'Something went wrong.');
        }
        if (status) {
            status.textContent = 'Thanks — your note was submitted!';
            status.className = 'tutorial-suggestion-status tutorial-suggestion-status-success';
        }
        if (text) text.value = '';
    } catch (err) {
        if (status) {
            status.textContent = err.message || 'Failed to submit. Please try again.';
            status.className = 'tutorial-suggestion-status tutorial-suggestion-status-error';
        }
    } finally {
        if (submitBtn) submitBtn.disabled = false;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const helpBtn = document.getElementById('tutorial-help-btn');
    const modal = document.getElementById('tutorial-modal');
    const closeBtn = document.getElementById('tutorial-modal-close');
    const backBtn = document.getElementById('tutorial-back-btn');
    const searchInput = document.getElementById('tutorial-search-input');
    const suggestionToggle = document.getElementById('tutorial-suggestion-toggle');
    const suggestionPanel = document.getElementById('tutorial-suggestion-panel');
    const suggestionSubmit = document.getElementById('tutorial-suggestion-submit');

    if (helpBtn) helpBtn.addEventListener('click', openTutorialModal);
    if (closeBtn) closeBtn.addEventListener('click', closeTutorialModal);
    if (backBtn) backBtn.addEventListener('click', renderTutorialListForCurrentState);
    if (modal) {
        modal.addEventListener('click', (event) => {
            if (event.target === modal) closeTutorialModal();
        });
    }
    if (searchInput) {
        searchInput.addEventListener('input', () => {
            renderTutorialListForCurrentState();
        });
    }
    if (suggestionToggle && suggestionPanel) {
        suggestionToggle.addEventListener('click', () => {
            suggestionPanel.hidden = !suggestionPanel.hidden;
        });
    }
    if (suggestionSubmit) {
        suggestionSubmit.addEventListener('click', submitTutorialSuggestion);
    }
});
