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
    await cap('Reports: Attendance Drill-Down');
    mark('Reports: Attendance Drill-Down');
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

    await step('Attendance shows the percent of scored periods marked present.', async () => {
      await highlight('.overview-stat[data-overview-key="days_present"]', { pad: 4 });
    }, 500, 3400);

    await step('Click the tile to drill in.', async () => {
      const tile = page.locator('.overview-stat[data-overview-key="days_present"]');
      await tile.click();
      await pause(500);
      const card = page.locator('.overview-extra-card[data-overview-card="days_present"]');
      await card.scrollIntoViewIfNeeded();
      await highlight(card, { pad: 4 });
      await unhighlight();
    }, 800, 3600);

    await step('Table view breaks attendance down day by day, instead of one overall percent.', async () => {
      const tableBtn = page.locator('[data-days-present-view="table"]');
      await highlight(tableBtn);
      await pause(350);
      await tableBtn.click();
      await pause(600);
      await unhighlight();
    }, 800, 5200);

    await step('Graph view plots the same days as a trend line over time.', async () => {
      const graphBtn = page.locator('[data-days-present-view="graph"]');
      await highlight(graphBtn);
      await pause(350);
      await graphBtn.click();
      await pause(600);
      await unhighlight();
    }, 800, 4600);

    await step('Click the tile again to close it and get back to the full report.', async () => {
      const tile = page.locator('.overview-stat[data-overview-key="days_present"]');
      await highlight(tile);
      await pause(350);
      await tile.click();
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
