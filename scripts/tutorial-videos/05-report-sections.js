const { chromium, makeHelpers, login } = require('./harness');

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    recordVideo: { dir: __dirname, size: { width: 1440, height: 900 } },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  const { initCaptions, cap, pause, step } = makeHelpers(page);

  try {
    await login(page, 'staff25', 'test123');
    await page.evaluate(initCaptions);
    await cap('What Each Report Section Shows');
    await pause(2400);

    await step('Opening Reports and picking one student, so every number below is theirs.', async () => {
      await page.click('#nav-hamburger');
      await pause(300);
      await page.click('.nav-btn[data-view="summary"]');
      await pause(600);
      const search = page.locator('#summary-student-search');
      await search.click();
      await search.evaluate(el => el.removeAttribute('readonly'));
      await search.type('Test Student 1', { delay: 30 });
      await pause(600);
      await page.locator('#summary-student-dropdown .dashboard-search-option').first().click();
    }, 600, 2000);

    await step('Attendance: percent of scored periods marked present, with the trend versus last period.', async () => {}, 500, 3000);

    await step('STAR Percent: their overall average across Safety, Teamwork, Accountability, and Relationships.', async () => {}, 500, 3000);

    await step('Plan Thresholds: how many times an If/Then behavior plan condition was met and delivered.', async () => {}, 500, 3000);

    await step('Trigger Time: the single day-and-period combination with the most infractions — green is calm, red is hot.', async () => {}, 500, 3400);

    await step('Infractions: total count, broken down by Attention, Social, Task, and Safety.', async () => {}, 500, 3000);

    await step('Incidents: how many Reminders versus full Resets were logged.', async () => {}, 500, 2800);

    await step('Level Up’s: how many students are ready to move up a card color.', async () => {}, 500, 2600);

    await step('Frenzies: how many frenzy events were recorded in this timeframe.', async () => {}, 500, 2600);

    await step('That’s the anatomy of a report — the same sections, scoped to whoever or whatever group you’ve selected.', async () => {}, 800, 2800);

  } finally {
    await pause(500);
    await context.close();
    const vp = await page.video().path().catch(() => null);
    console.log('VIDEO_PATH:', vp);
    await browser.close();
  }
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
