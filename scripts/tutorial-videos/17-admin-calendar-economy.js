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
    await cap('Admin: Calendar & Economy Settings');
    mark('Admin: Calendar & Economy Settings');
    await pause(4400);

    await step('Open the menu, and select Admin Panel.', async () => {
      await highlight('#nav-hamburger');
      await pause(350);
      await page.click('#nav-hamburger');
      await pause(300);
      await highlight('.nav-btn[data-view="admin"]');
      await pause(350);
      await page.click('.nav-btn[data-view="admin"]');
      await unhighlight();
    }, 800, 2200);

    await step('Quarter Date Configuration sets the school calendar everything else runs on.', async () => {
      const section = page.locator('#admin-view').locator('.admin-section', { hasText: 'Quarter Date Configuration' });
      await section.scrollIntoViewIfNeeded();
      await highlight(section, { pad: 4 });
    }, 500, 4200);

    await step('Upload a calendar PDF and it auto-detects quarters and holidays for you.', async () => {
      await highlight('#calendar-pdf-file');
    }, 500, 4200);

    await step('Or set each quarter’s start and end dates by hand.', async () => {
      const q1 = page.locator('#quarter-1-start');
      await q1.scrollIntoViewIfNeeded();
      await highlight(q1);
    }, 500, 3600);

    await step('Manny’s Market economy sets the numbers behind Bills.', async () => {
      const section = page.locator('#admin-view').locator('.admin-section', { hasText: "Manny's Market economy" });
      await section.scrollIntoViewIfNeeded();
      await highlight(section, { pad: 4 });
    }, 500, 4000);

    await step('Cost of living controls what students actually pay, as a percent of real prices.', async () => {
      const input = page.locator('#econ-col');
      await highlight(input);
    }, 500, 4200);

    await step('The emergency fund goal, late fees, and assistance rules are set the same way.', async () => {
      const input = page.locator('#econ-goal-weeks');
      await highlight(input);
    }, 500, 3600);

    await step('Generate bills now runs the weekly cycle on demand, instead of waiting for Monday.', async () => {
      const btn = page.locator('#economy-admin-generate-btn');
      await btn.scrollIntoViewIfNeeded();
      await highlight(btn);
    }, 500, 4200);

  } finally {
    await pause(500);
    await context.close();
    const vp = await page.video().path().catch(() => null);
    console.log('VIDEO_PATH:', vp);
    await browser.close();
  }
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
