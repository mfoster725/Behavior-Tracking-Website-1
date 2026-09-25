// Help button (bottom-right "?") -> a gallery of tutorial videos relevant to
// whatever view is currently active. Videos are served locally (staff/admin
// login required, see /tutorial-videos/<file> in app.py) via `videoFile`.
// A `youtubeId` is also supported as a fallback/alternative; if neither is
// set, the card shows a "Video coming soon" placeholder instead.
const TUTORIAL_VIDEOS = {
    'period-entry': {
        title: 'Point Card: Period Entry',
        description: 'Scoring one class period across every scheduled student.',
        duration: '0:53',
        videoFile: 'point-card-period-entry.mp4',
        youtubeId: ''
    },
    'daily-entry': {
        title: 'Point Card: Daily Entry',
        description: "Scoring a student's whole day, all periods at once.",
        duration: '1:02',
        videoFile: 'point-card-daily-entry.mp4',
        youtubeId: ''
    },
    'past-point-cards': {
        title: 'Past Point Cards',
        description: "Viewing a student's past point cards and printing them (Full Card / Info Insights).",
        duration: '0:59',
        videoFile: 'past-point-cards.mp4',
        youtubeId: ''
    },
    'reports-navigation': {
        title: 'Reports: Navigation',
        description: 'Student vs. group, timeframe, Compare / Incentive Tracking show-hide, Insights View, Print.',
        duration: '1:24',
        videoFile: 'reports-navigation.mp4',
        youtubeId: ''
    },
    'report-sections': {
        title: 'Reports: What Each Section Shows',
        description: 'Attendance, STAR Percent, Plan Thresholds, Trigger Time, Infractions, Incidents, Level Ups, Frenzies.',
        duration: '1:15',
        videoFile: 'report-sections.mp4',
        youtubeId: ''
    },
    'bills': {
        title: 'Bills',
        description: 'Class overview, turning bills on for a student, This week / Pay / worksheets, My Plan, Savings, Assistance, History.',
        duration: '1:25',
        videoFile: 'bills.mp4',
        youtubeId: ''
    },
    'schedules': {
        title: 'Schedules: Teacher & Student Setup',
        description: 'Look up a teacher or student schedule, add a period, save, and export (print/CSV, with or without rosters).',
        duration: '',
        videoFile: '', // TODO: 'schedules.mp4' once recorded
        youtubeId: ''
    },
    'bank-account-bonuses': {
        title: 'Bank Account: Staff Bonuses',
        description: 'Awarding Starbucks/Star Student counts per student and Star Classroom per caseload, then submitting the table.',
        duration: '',
        videoFile: '', // TODO: 'bank-account-bonuses.mp4' once recorded
        youtubeId: ''
    },
    'bank-account-balances': {
        title: 'Bank Account: Balances & Paychecks',
        description: "Viewing a student's balance, emergency fund, and paychecks, plus the Weekly Earnings Record worksheet.",
        duration: '',
        videoFile: '', // TODO: 'bank-account-balances.mp4' once recorded
        youtubeId: ''
    },
    'marketplace-shopping': {
        title: 'Marketplace: Shopping & Checkout',
        description: 'Searching and filtering items, adding to cart, checking out, and viewing My Orders.',
        duration: '',
        videoFile: '', // TODO: 'marketplace-shopping.mp4' once recorded
        youtubeId: ''
    },
    'marketplace-fulfilling': {
        title: 'Marketplace: Fulfilling Orders',
        description: 'Working the purchase-order queue to approve and fulfill student orders.',
        duration: '',
        videoFile: '', // TODO: 'marketplace-fulfilling.mp4' once recorded
        youtubeId: ''
    },
    'marketplace-managing': {
        title: 'Marketplace: Managing Items & Analytics',
        description: 'Adding marketplace items, hiding/unhiding in bulk, and reading the purchase-analytics panel.',
        duration: '',
        videoFile: '', // TODO: 'marketplace-managing.mp4' once recorded
        youtubeId: ''
    },
    'users-accounts': {
        title: 'User Management: Accounts & Roster',
        description: 'Searching students/staff/outside staff/admins, adding accounts, and sharing login information in bulk.',
        duration: '',
        videoFile: '', // TODO: 'users-accounts.mp4' once recorded
        youtubeId: ''
    },
    'users-student-plans': {
        title: 'User Management: Student Plans',
        description: "Adding or editing a student's plan from their row's kebab menu.",
        duration: '',
        videoFile: '', // TODO: 'users-student-plans.mp4' once recorded
        youtubeId: ''
    },
    'admin-accounts-billing': {
        title: 'Admin: Accounts & Billing',
        description: 'Managing your subscription/billing and creating new staff or admin accounts.',
        duration: '',
        videoFile: '', // TODO: 'admin-accounts-billing.mp4' once recorded
        youtubeId: ''
    },
    'admin-importing-data': {
        title: 'Admin: Importing Data',
        description: 'Bulk CSV import of staff/outside staff/students, and syncing with a Google Sheet.',
        duration: '',
        videoFile: '', // TODO: 'admin-importing-data.mp4' once recorded
        youtubeId: ''
    },
    'admin-calendar-economy': {
        title: 'Admin: Calendar & Economy Settings',
        description: 'Setting up the school calendar (quarters, holidays) and the market economy (cost of living, bill prices, late fees).',
        duration: '',
        videoFile: '', // TODO: 'admin-calendar-economy.mp4' once recorded
        youtubeId: ''
    }
};

// Maps each top-level view (the id of its `.view` div, minus the "-view"
// suffix) to the tutorial(s) relevant to it. Views not listed here simply
// show the empty state when the help button is opened.
const VIEW_TUTORIALS = {
    'period-entry': ['period-entry', 'past-point-cards'],
    'entry': ['daily-entry', 'past-point-cards'],
    'summary': ['reports-navigation', 'report-sections'],
    'bills': ['bills'],
    'schedules': ['schedules'],
    'bank-account': ['bank-account-bonuses', 'bank-account-balances'],
    'marketplace': ['marketplace-shopping', 'marketplace-fulfilling', 'marketplace-managing'],
    'users': ['users-accounts', 'users-student-plans'],
    'admin': ['admin-accounts-billing', 'admin-importing-data', 'admin-calendar-economy']
};

function getCurrentViewName() {
    const activeView = document.querySelector('.view.active');
    if (!activeView) return null;
    return activeView.id.replace(/-view$/, '');
}

function tutorialThumbnailUrl(youtubeId) {
    return youtubeId ? `https://img.youtube.com/vi/${youtubeId}/hqdefault.jpg` : '';
}

function renderTutorialGrid() {
    const backBtn = document.getElementById('tutorial-back-btn');
    const subtitle = document.getElementById('tutorial-modal-subtitle');
    const body = document.getElementById('tutorial-modal-body');
    if (!body) return;

    if (backBtn) backBtn.classList.remove('visible');

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

    body.innerHTML = `<div class="tutorial-grid">${keys.map(key => {
        const video = TUTORIAL_VIDEOS[key];
        if (!video) return '';
        const thumbUrl = tutorialThumbnailUrl(video.youtubeId);
        return `
            <button type="button" class="tutorial-card" data-tutorial-key="${key}">
                <div class="tutorial-card-thumb">
                    ${thumbUrl ? `<img src="${thumbUrl}" alt="" loading="lazy">` : ''}
                    <span class="tutorial-play-icon"></span>
                    ${video.duration ? `<span class="tutorial-card-duration">${video.duration}</span>` : ''}
                </div>
                <div class="tutorial-card-body">
                    <p class="tutorial-card-title">${video.title}</p>
                    <p class="tutorial-card-desc">${video.description}</p>
                </div>
            </button>
        `;
    }).join('')}</div>`;

    body.querySelectorAll('.tutorial-card').forEach(card => {
        card.addEventListener('click', () => openTutorialPlayer(card.dataset.tutorialKey));
    });
}

function openTutorialPlayer(key) {
    const video = TUTORIAL_VIDEOS[key];
    if (!video) return;

    const backBtn = document.getElementById('tutorial-back-btn');
    const subtitle = document.getElementById('tutorial-modal-subtitle');
    const body = document.getElementById('tutorial-modal-body');
    if (!body) return;

    if (backBtn) backBtn.classList.add('visible');
    if (subtitle) subtitle.textContent = video.title;

    let player;
    if (video.videoFile) {
        player = `<div class="tutorial-player-frame-wrap">
               <video src="/tutorial-videos/${encodeURIComponent(video.videoFile)}"
                      title="${video.title}" controls autoplay playsinline></video>
           </div>`;
    } else if (video.youtubeId) {
        player = `<div class="tutorial-player-frame-wrap">
               <iframe src="https://www.youtube.com/embed/${video.youtubeId}?autoplay=1&rel=0"
                       title="${video.title}"
                       allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                       allowfullscreen></iframe>
           </div>`;
    } else {
        player = `<p class="tutorial-empty-state">This video hasn't been uploaded yet — check back soon.</p>`;
    }

    body.innerHTML = `
        <div class="tutorial-player">
            ${player}
            <p class="tutorial-player-title">${video.title}</p>
            <p class="tutorial-player-desc">${video.description}</p>
        </div>
    `;
}

function openTutorialModal() {
    const modal = document.getElementById('tutorial-modal');
    if (!modal) return;
    renderTutorialGrid();
    modal.style.display = 'block';
}

function closeTutorialModal() {
    const modal = document.getElementById('tutorial-modal');
    if (!modal) return;
    modal.style.display = 'none';
    // Stop playback by clearing the iframe once the modal is hidden.
    const body = document.getElementById('tutorial-modal-body');
    if (body) body.innerHTML = '';
}

document.addEventListener('DOMContentLoaded', () => {
    const helpBtn = document.getElementById('tutorial-help-btn');
    const modal = document.getElementById('tutorial-modal');
    const closeBtn = document.getElementById('tutorial-modal-close');
    const backBtn = document.getElementById('tutorial-back-btn');

    if (helpBtn) helpBtn.addEventListener('click', openTutorialModal);
    if (closeBtn) closeBtn.addEventListener('click', closeTutorialModal);
    if (backBtn) backBtn.addEventListener('click', renderTutorialGrid);
    if (modal) {
        modal.addEventListener('click', (event) => {
            if (event.target === modal) closeTutorialModal();
        });
    }
});
