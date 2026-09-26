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
    await cap('Reports: Incidents Drill-Down');
    mark('Reports: Incidents Drill-Down');
    await pause(4200);

    await step('Open Reports and pick one student.', async () => {
      await highlight('#nav-hamburger');
      await pause(350);
      await page.click('#nav-hamburger');
      await pause(300);
      await highlight('.nav-btn[data-view="summary"]');
      await pause(350);
      await page.click('.nav-btn[data-view="summary"]');
      await pause(600);
      const search = page.locator('#summary-student-search');
      await search.click();
      await search.fill('Test Student 1');
      await pause(500);
      const option = page.locator('#summary-student-dropdown .dashboard-search-option').first();
      await option.click();
      await pause(500);
      await page.selectOption('#summary-period-dropdown', 'all_time');
      await pause(500);
      await unhighlight();
    }, 600, 2600);

    await step('Incidents splits into Reminders and Resets.', async () => {
      await highlight('.overview-incidents-panel', { pad: 4 });
    }, 500, 3600);

    await step('Click Reminders to drill into just that bar.', async () => {
      const bar = page.locator('.overview-stat.overview-incident-bar-col[data-overview-key="reminders"]');
      await bar.click();
      await pause(700);
      const remindersCard = page.locator('.overview-extra-card[data-overview-card="reminders"]');
      await remindersCard.scrollIntoViewIfNeeded();
      await highlight(remindersCard, { pad: 4 });
      await unhighlight();
    }, 800, 4600);

    await step('Table view lists each one by day, instead of just a running total.', async () => {
      const tableBtn = page.locator('.overview-extra-card[data-overview-card="reminders"] [data-rr-view="table"]');
      await highlight(tableBtn);
      await pause(350);
      await tableBtn.click();
      await pause(600);
      await unhighlight();
    }, 800, 4600);

    await step('Resets get the exact same breakdown — click it for its own card.', async () => {
      const bar = page.locator('.overview-stat.overview-incident-bar-col[data-overview-key="resets"]');
      await highlight(bar);
      await pause(350);
      await bar.click();
      await pause(600);
      const resetsCard = page.locator('.overview-extra-card[data-overview-card="resets"]');
      await resetsCard.scrollIntoViewIfNeeded();
      await unhighlight();
    }, 800, 4400);

    await step('Click either bar again to close its card.', async () => {
      const bar = page.locator('.overview-stat.overview-incident-bar-col[data-overview-key="reminders"]');
      await bar.scrollIntoViewIfNeeded();
      await highlight(bar);
      await pause(350);
      await bar.click();
      await unhighlight();
    }, 800, 3200);

  } finally {
    await pause(500);
    await context.close();
    const vp = await page.video().path().catch(() => null);
    console.log('VIDEO_PATH:', vp);
    await browser.close();
  }
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
