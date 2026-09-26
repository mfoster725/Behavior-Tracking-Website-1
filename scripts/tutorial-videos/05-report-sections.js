const { chromium, makeHelpers, login } = require('./harness');

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    recordVideo: { dir: __dirname, size: { width: 1920, height: 1080 } },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  const { initCaptions, cap, pause, step, highlight, unhighlight, mark } = makeHelpers(page);

  try {
    await login(page, 'staff25', 'test123');
    await page.evaluate(initCaptions);
    await cap('What Each Report Section Shows');
    mark('What Each Report Section Shows');
    await pause(3600);

    await step('Opening Reports and picking one student, so every number below is theirs.', async () => {
      await highlight('#nav-hamburger');
      await pause(350);
      await page.click('#nav-hamburger');
      await pause(300);
      await highlight('.nav-btn[data-view="summary"]');
      await pause(350);
      await page.click('.nav-btn[data-view="summary"]');
      await pause(600);
      await highlight('#summary-student-search-wrap');
      await pause(350);
      const search = page.locator('#summary-student-search');
      await search.click();
      await search.evaluate(el => el.removeAttribute('readonly'));
      await search.type('Test Student 1', { delay: 30 });
      await pause(600);
      const option = page.locator('#summary-student-dropdown .dashboard-search-option').first();
      await highlight(option);
      await pause(350);
      await option.click();
      await pause(500);
      // Trends starts collapsed by default; open it so the full report layout shows
      // for the whole video instead of leaving that column blank.
      await page.locator('.overview-trends-card[data-overview-key="trends"]').click().catch(() => {});
      await unhighlight();
    }, 600, 3100);

    await step('Attendance: percent of scored periods marked present, with the trend versus last period.', async () => {
      await highlight('.overview-stat[data-overview-key="days_present"]', { pad: 4 });
    }, 500, 6200);

    await step('STAR Percent: their overall average across Safety, Teamwork, Accountability, and Relationships.', async () => {
      await highlight('.overview-stat[data-overview-key="star_percent"]', { pad: 4 });
    }, 500, 6500);

    await step('Plan Thresholds: how many times an If/Then behavior plan condition was met and delivered.', async () => {
      await highlight('.overview-stat[data-overview-key="plan_thresholds"]', { pad: 4 });
    }, 500, 7200);

    await step('Trigger Time: the single day-and-period combination with the most infractions — green is calm, red is hot.', async () => {
      await highlight('.overview-stat[data-overview-key="trigger_times"]', { pad: 4 });
    }, 500, 7200);

    await step('Infractions: total count, broken down by Attention, Social, Task, and Safety.', async () => {
      await highlight('.overview-stat[data-overview-key="infractions"]', { pad: 4 });
    }, 500, 7200);

    await step('Incidents: how many Reminders versus full Resets were logged.', async () => {
      await highlight('.overview-incidents-panel', { pad: 4 });
    }, 500, 4700);

    await step('Level Up’s: how many students are ready to move up a card color.', async () => {
      await highlight('.overview-stat[data-overview-key="level_ups"]', { pad: 4 });
    }, 500, 3500);

    await step('Frenzies: how many frenzy events were recorded in this timeframe.', async () => {
      await highlight('.overview-stat[data-overview-key="frenzies"]', { pad: 4 });
    }, 500, 4600);

    await step('That’s the anatomy of a report — the same sections, scoped to whoever or whatever group you’ve selected.', async () => {}, 800, 6300);

  } finally {
    await pause(500);
    await context.close();
    const vp = await page.video().path().catch(() => null);
    console.log('VIDEO_PATH:', vp);
    await browser.close();
  }
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
