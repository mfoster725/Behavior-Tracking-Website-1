// Reloads the page when the local calendar date changes so tabs left open
// overnight pick up the new day instead of sitting on yesterday's data.
(function () {
    'use strict';

    const CHECK_INTERVAL_MS = 30000;

    function dateKey(date) {
        return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
    }

    const pageLoadDate = dateKey(new Date());
    let reloadStarted = false;

    async function reloadForNewDay() {
        if (reloadStarted) return;
        // Only defined on the main app page, where a reload could otherwise
        // discard point-card edits that have not reached the server yet.
        if (typeof window.flushPendingPointCardSaves === 'function') {
            let flushed = false;
            try {
                flushed = await window.flushPendingPointCardSaves();
            } catch (error) {
                console.error('Daily refresh: error flushing pending saves', error);
            }
            if (!flushed) {
                console.warn('Daily refresh: skipping reload, pending edits could not be saved');
                return;
            }
        }
        reloadStarted = true;
        window.location.reload();
    }

    function refreshIfDue() {
        if (reloadStarted || dateKey(new Date()) === pageLoadDate) {
            return;
        }
        reloadForNewDay();
    }

    function start() {
        window.setInterval(refreshIfDue, CHECK_INTERVAL_MS);
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') {
                refreshIfDue();
            }
        });
        window.addEventListener('focus', refreshIfDue);
        refreshIfDue();
    }

    start();
})();
