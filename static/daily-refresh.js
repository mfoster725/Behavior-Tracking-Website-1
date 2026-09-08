// Reloads the page once each night at 10:45pm local time so tabs left open
// overnight pick up the new day instead of sitting on stale data.
(function () {
    'use strict';

    const REFRESH_HOUR = 22;
    const REFRESH_MINUTE = 45;
    const CHECK_INTERVAL_MS = 30000;

    // The day whose refresh is already done. Loading the page counts as that
    // day's refresh, which is what stops the reload from repeating in a loop.
    let handledDate = null;

    function dateKey(date) {
        return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
    }

    function refreshTimeOn(date) {
        return new Date(date.getFullYear(), date.getMonth(), date.getDate(), REFRESH_HOUR, REFRESH_MINUTE, 0, 0);
    }

    function msUntilNextRefresh() {
        const now = new Date();
        const target = refreshTimeOn(now);
        if (now.getTime() >= target.getTime()) {
            target.setDate(target.getDate() + 1);
        }
        return Math.max(1000, target.getTime() - now.getTime());
    }

    async function reloadForNewDay() {
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
        window.location.reload();
    }

    function refreshIfDue() {
        const now = new Date();
        const key = dateKey(now);
        if (handledDate === key || now.getTime() < refreshTimeOn(now).getTime()) {
            return;
        }
        handledDate = key;
        reloadForNewDay();
    }

    function start() {
        const now = new Date();
        if (now.getTime() >= refreshTimeOn(now).getTime()) {
            handledDate = dateKey(now);
        }

        const scheduleNext = () => {
            window.setTimeout(() => {
                refreshIfDue();
                scheduleNext();
            }, msUntilNextRefresh());
        };
        scheduleNext();

        // Backstop for timers the browser throttled or froze while the tab was
        // in the background, or while the machine was asleep.
        window.setInterval(refreshIfDue, CHECK_INTERVAL_MS);
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') {
                refreshIfDue();
            }
        });
        window.addEventListener('focus', refreshIfDue);
    }

    start();
})();
