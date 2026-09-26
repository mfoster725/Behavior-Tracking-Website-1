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
    await cap("Reports: Level Up's Drill-Down");
    mark("Reports: Level Up's Drill-Down");
    await pause(4200);

    await step('Open Reports — this one works best across your whole caseload.', async () => {
      await highlight('#nav-hamburger');
      await pause(350);
      await page.click('#nav-hamburger');
      await pause(300);
      await highlight('.nav-btn[data-view="summary"]');
      await pause(350);
      await page.click('.nav-btn[data-view="summary"]');
      await unhighlight();
      await pause(600);
      await page.selectOption('#summary-period-dropdown', 'all_time');
      await pause(500);
    }, 600, 3000);

    await step("Level Up's counts how many students are ready to move up a card color.", async () => {
      await highlight('.overview-stat[data-overview-key="level_ups"]', { pad: 4 });
    }, 500, 4000);

    await step('Click the tile for two tables — Yellow to Green, and Green to Blue.', async () => {
      const tile = page.locator('.overview-stat[data-overview-key="level_ups"]').first();
      await tile.click();
      await pause(900);
      const card = page.locator('.overview-extra-card[data-overview-card="level_ups"]');
      await card.scrollIntoViewIfNeeded();
      await highlight(card, { pad: 4 });
    }, 800, 6200);

    await step('Each row shows their qualifying days, average, and what’s still needed — or that they’re eligible now.', async () => {
      await pause(200);
    }, 500, 5200);

    await step('Click the tile again to close it.', async () => {
      const tile = page.locator('.overview-stat[data-overview-key="level_ups"]').first();
      await tile.scrollIntoViewIfNeeded();
      await highlight(tile);
      await pause(350);
      await tile.click();
      // Closing this card collapses a lot of vertical space (the caseload-wide
      // Yellow->Green / Green->Blue tables are tall), which shifts the page's
      // scroll position enough to strand the fixed-position ring over whatever
      // now sits where the tile used to be (verified: it lands on INFRACTIONS).
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
