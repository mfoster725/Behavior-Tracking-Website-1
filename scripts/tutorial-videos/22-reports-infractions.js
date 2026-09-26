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
    await cap('Reports: Infractions Drill-Down');
    mark('Reports: Infractions Drill-Down');
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

    await step('Infractions totals every category — Task, Attention, Social, Safety.', async () => {
      await highlight('.overview-stat[data-overview-key="infractions"]', { pad: 4 });
    }, 500, 4000);

    await step('Click the tile, then Type, Time, or Day to slice the same totals differently.', async () => {
      const tile = page.locator('.overview-stat[data-overview-key="infractions"]').first();
      await tile.click();
      await pause(600);
      const card = page.locator('.overview-extra-card[data-overview-card="infractions_card"]');
      await card.scrollIntoViewIfNeeded();
      await highlight(card, { pad: 4 });
    }, 800, 4600);

    await step('Click any specific infraction to see when it actually happens.', async () => {
      const label = page.locator('.overview-extra-card[data-overview-card="infractions_card"] .days-present-legend-label').first();
      await highlight(label);
      await pause(350);
      await label.click();
      await pause(700);
    }, 800, 5600);

    await step('By Time of Day, and by Day of Week — close the tab, then click the tile again to close the card.', async () => {
      const closeBtn = page.locator('.infractions-tab-close').first();
      await closeBtn.click().catch(() => {});
      await pause(400);
      const tile = page.locator('.overview-stat[data-overview-key="infractions"]').first();
      await highlight(tile);
      await pause(350);
      await tile.click();
    }, 800, 5600);

  } finally {
    await pause(500);
    await context.close();
    const vp = await page.video().path().catch(() => null);
    console.log('VIDEO_PATH:', vp);
    await browser.close();
  }
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
