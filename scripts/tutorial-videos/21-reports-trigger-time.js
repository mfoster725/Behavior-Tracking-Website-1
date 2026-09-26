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
    await cap('Reports: Trigger Time Drill-Down');
    mark('Reports: Trigger Time Drill-Down');
    await pause(4200);

    await step('Open Reports and pick one student.', async () => {
      await highlight('#nav-hamburger');
      await pause(350);
      await page.click('#nav-hamburger');
      await pause(300);
      await highlight('.nav-btn[data-view="summary"]');
      await pause(350);
      await page.click('.nav-btn[data-view="summary"]');
      await unhighlight();
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
    }, 600, 2600);

    await step('Trigger Time is the single day-and-period combination with the most infractions.', async () => {
      await highlight('.overview-stat[data-overview-key="trigger_times"]', { pad: 4 });
    }, 500, 4200);

    await step('Click the tile for the full heat map, or switch to Table.', async () => {
      const tile = page.locator('.overview-stat[data-overview-key="trigger_times"]');
      await tile.click();
      await pause(600);
      const card = page.locator('.overview-extra-card[data-overview-card="trigger_times"]');
      await card.scrollIntoViewIfNeeded();
      await highlight(card, { pad: 4 });
      const tableBtn = page.locator('[data-trigger-times-view="table"]');
      await tableBtn.click();
      await pause(600);
    }, 800, 4600);

    await step('Click any time slot in the table for that slot’s own detail.', async () => {
      const row = page.locator('.trigger-times-row-jump[data-drill-type="time"]').first();
      await highlight(row);
      await pause(350);
      await row.click();
      await pause(700);
    }, 800, 5600);

    await step('That opens its own tab — close it when you’re done, then click the tile again to close the whole card.', async () => {
      const closeBtn = page.locator('.trigger-times-drill-tab-close').first();
      await closeBtn.click().catch(() => {});
      await pause(400);
      const tile = page.locator('.overview-stat[data-overview-key="trigger_times"]').first();
      await highlight(tile);
      await pause(350);
      await tile.click();
    }, 800, 5200);

  } finally {
    await pause(500);
    await context.close();
    const vp = await page.video().path().catch(() => null);
    console.log('VIDEO_PATH:', vp);
    await browser.close();
  }
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
