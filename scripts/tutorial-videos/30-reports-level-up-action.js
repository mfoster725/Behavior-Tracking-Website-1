const { chromium, makeHelpers, login } = require('./harness');

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    recordVideo: { dir: __dirname, size: { width: 1920, height: 1080 } },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  // window.confirm() blocks page script until answered — auto-accept every
  // dialog so the recording doesn't hang on the native confirm() this action
  // uses (see harness.js's step() for why everything else here is app UI,
  // not a browser dialog).
  page.on('dialog', (dialog) => dialog.accept());
  const { initCaptions, cap, pause, step, highlight, unhighlight, mark } = makeHelpers(page);

  try {
    await login(page, 'staff21', 'test123');
    await page.evaluate(initCaptions);
    await cap('Reports: Leveling a Student Up');
    mark('Reports: Leveling a Student Up');
    await pause(4200);

    await step('Open Reports for your whole caseload — same place the Level Up\'s tile lives.', async () => {
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
    }, 600, 2600);

    await step('Click the Level Up\'s tile to open the readiness tables.', async () => {
      const tile = page.locator('.overview-stat[data-overview-key="level_ups"]').first();
      await highlight(tile, { pad: 4 });
      await pause(350);
      await tile.click();
      await pause(900);
      const card = page.locator('.overview-extra-card[data-overview-card="level_ups"]');
      await card.scrollIntoViewIfNeeded();
    }, 600, 1600);

    await step('A student who\'s already qualified shows "Eligible now!" with a Level Up button — only for admins and Case Managers.', async () => {
      const row = page.locator('tr:has([data-level-up-student-id])').first();
      await row.scrollIntoViewIfNeeded();
      await highlight(row, { pad: 4 });
    }, 500, 5000);

    await step('Clicking it asks you to confirm — this actually promotes them and restarts their 30-day window.', async () => {
      const btn = page.locator('[data-level-up-student-id]').first();
      await highlight(btn, { pad: 4 });
      await pause(500);
      await btn.click();
      await pause(1800);
    }, 700, 3400);

    await step('They\'re promoted immediately and drop out of this table — no separate approval step.', async () => {
      const card = page.locator('.overview-extra-card[data-overview-card="level_ups"]');
      await highlight(card, { pad: 4 });
    }, 300, 4600);

  } finally {
    await pause(500);
    await context.close();
    const vp = await page.video().path().catch(() => null);
    console.log('VIDEO_PATH:', vp);
    await browser.close();
  }
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
