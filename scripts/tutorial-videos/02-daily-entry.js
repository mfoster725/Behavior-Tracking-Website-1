const { chromium, makeHelpers, login } = require('./harness');

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    recordVideo: { dir: __dirname, size: { width: 1440, height: 900 } },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  const { initCaptions, cap, pause, step } = makeHelpers(page);

  try {
    await login(page, 'staff25', 'test123');
    await page.evaluate(initCaptions);
    await cap('Point Card: Daily Entry');
    await pause(2200);

    await step('Open the menu, then select Daily Entry.', async () => {
      await page.click('#nav-hamburger');
      await pause(300);
      await page.click('.nav-btn[data-view="entry"]');
    }, 800, 1800);

    await step("Instead of one period, this shows a student's whole day at once.", async () => {}, 500, 2600);

    await step('One column per student you manage — uncheck "Managed by me" to search anyone.', async () => {
      await page.uncheck('#daily-managed-by-me-checkbox').catch(() => {});
    }, 1200, 2200);

    await step("Recheck it to get back to your own students.", async () => {
      await page.check('#daily-managed-by-me-checkbox').catch(() => {});
    }, 500, 1600);

    await step('Set Attendance for the day right at the top of each column.', async () => {}, 500, 2400);

    await step('Every period is a row — the same Safety/Teamwork/Accountability/Relationships and Infraction boxes.', async () => {
      const cell = page.locator('select.daily-input[data-student-id="1"][data-category="t"]').first();
      await cell.selectOption('0');
    }, 1500, 1200);

    await step('Changes save automatically as you go.', async () => {}, 300, 2200);

    await step("Percent for the day totals at the bottom of each column.", async () => {}, 500, 2400);

    await step('These buttons jump straight to Student Entry or back to Period Entry.', async () => {}, 800, 2400);

    await step('Same ⋮ menu here too — that’s where past point cards live.', async () => {
      await page.locator('button[aria-label="Student card menu"]').first().click();
    }, 1000, 2200);

    await step('Escape, then Save All Data when you’re done.', async () => {
      await page.keyboard.press('Escape');
      await pause(400);
      await page.locator('button:has-text("Save All Data")').click();
    }, 800, 2200);

  } finally {
    await pause(500);
    await context.close();
    const vp = await page.video().path().catch(() => null);
    console.log('VIDEO_PATH:', vp);
    await browser.close();
  }
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
