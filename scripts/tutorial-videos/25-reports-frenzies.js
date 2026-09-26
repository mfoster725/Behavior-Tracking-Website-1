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
    await cap('Reports: Frenzies Drill-Down');
    mark('Reports: Frenzies Drill-Down');
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

    await step('Frenzies counts every frenzy event recorded in this timeframe.', async () => {
      await highlight('.overview-stat[data-overview-key="frenzies"]', { pad: 4 });
    }, 500, 3600);

    await step('Click the tile for the severity breakdown behind that count.', async () => {
      const tile = page.locator('.overview-stat[data-overview-key="frenzies"]').first();
      await tile.click();
      await pause(700);
      const card = page.locator('.overview-extra-card[data-overview-card="frenzies_card"]');
      await card.scrollIntoViewIfNeeded();
      await highlight(card, { pad: 4 });
    }, 800, 4200);

    await step('Click a severity level to see when it happens — by time of day and day of week.', async () => {
      const legendItem = page.locator('.frenzies-severity-legend-item[data-frenzy-drill-severity]').first();
      await highlight(legendItem);
      await pause(350);
      await legendItem.click();
      await pause(700);
    }, 800, 5600);

    await step('Table view lists location and purpose too, not just severity.', async () => {
      const tableBtn = page.locator('.overview-extra-card[data-overview-card="frenzies_card"] [data-frenzies-view="table"]');
      await highlight(tableBtn);
      await pause(350);
      await tableBtn.click();
      await pause(600);
    }, 800, 4600);

    await step('Click the tile again to close it.', async () => {
      const tile = page.locator('.overview-stat[data-overview-key="frenzies"]').first();
      await tile.scrollIntoViewIfNeeded();
      await highlight(tile);
      await pause(350);
      await tile.click();
    }, 800, 3000);

  } finally {
    await pause(500);
    await context.close();
    const vp = await page.video().path().catch(() => null);
    console.log('VIDEO_PATH:', vp);
    await browser.close();
  }
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
