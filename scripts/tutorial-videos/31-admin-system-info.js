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
    await login(page, 'staff1', 'test123');
    await page.evaluate(initCaptions);
    await cap('Admin: System Information');
    mark('Admin: System Information');
    await pause(4200);

    await step('Open the Admin Panel.', async () => {
      await highlight('#nav-hamburger');
      await pause(350);
      await page.click('#nav-hamburger');
      await pause(300);
      await highlight('.nav-btn[data-view="admin"]');
      await pause(350);
      await page.click('.nav-btn[data-view="admin"]');
      await unhighlight();
      await pause(700);
    }, 600, 1200);

    await step("It's one long page — scroll all the way to the bottom, past Manny's Market economy.", async () => {
      const card = page.locator('#system-info').first();
      await card.scrollIntoViewIfNeeded();
      await pause(300);
    }, 500, 2400);

    await step("System Information is read-only — nothing to click, nothing to save.", async () => {
      const card = page.locator('#system-info').first().locator('..');
      await highlight(card, { pad: 8 });
    }, 400, 4800);

    await step("Just three facts: who's logged in, which database, and how many students total.", async () => {
      const card = page.locator('#system-info').first();
      await highlight(card, { pad: 4 });
    }, 300, 5200);

  } finally {
    await pause(500);
    await context.close();
    const vp = await page.video().path().catch(() => null);
    console.log('VIDEO_PATH:', vp);
    await browser.close();
  }
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
