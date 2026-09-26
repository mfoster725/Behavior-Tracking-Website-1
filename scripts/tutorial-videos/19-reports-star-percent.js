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
    await cap('Reports: STAR Percent Drill-Down');
    mark('Reports: STAR Percent Drill-Down');
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

    await step('STAR Percent is their average across Safety, Teamwork, Accountability, and Relationships.', async () => {
      await highlight('.overview-stat[data-overview-key="star_percent"]', { pad: 4 });
    }, 500, 3600);

    await step('Click the tile to see all four categories charted side by side.', async () => {
      const tile = page.locator('.overview-stat[data-overview-key="star_percent"]');
      await tile.click();
      await pause(600);
      const card = page.locator('.overview-extra-card[data-overview-card="star_performance"]');
      await card.scrollIntoViewIfNeeded();
      await highlight(card, { pad: 4 });
      await unhighlight();
    }, 800, 3600);

    await step('Click any bar for that category’s best and worst time of day and day of week.', async () => {
      const canvas = page.locator('#overview-star-chart');
      const box = await canvas.boundingBox();
      if (box) {
        const x = box.x + box.width * 0.18;
        const y = box.y + box.height * 0.6;
        await page.mouse.move(x, y, { steps: 15 });
        await pause(400);
        await page.mouse.click(x, y);
      }
      await pause(700);
    }, 800, 5600);

    await step('That new tab holds the detail — close it with its × when you’re done.', async () => {
      const closeBtn = page.locator('.star-performance-tab-close');
      await highlight(closeBtn);
      await pause(350);
      await closeBtn.click();
      await unhighlight();
    }, 800, 3600);

    await step('Click the tile again to close the whole card.', async () => {
      const tile = page.locator('.overview-stat[data-overview-key="star_percent"]');
      await highlight(tile);
      await pause(350);
      await tile.click();
      await unhighlight();
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
