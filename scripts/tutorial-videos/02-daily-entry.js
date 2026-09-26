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
    await cap('Point Card: Daily Entry');
    mark('Point Card: Daily Entry');
    await pause(4700);

    await step('Open the menu, then select Daily Entry.', async () => {
      await highlight('#nav-hamburger');
      await pause(350);
      await page.click('#nav-hamburger');
      await pause(300);
      await highlight('.nav-btn[data-view="entry"]');
      await pause(350);
      await page.click('.nav-btn[data-view="entry"]');
      await unhighlight();
    }, 800, 2200);

    await step("Instead of one period, this shows a student's whole day at once.", async () => {
      await highlight([
        page.locator('.daily-header-student:visible').first(),
        page.locator('.daily-percent-cell:not(.period-percent-cell):visible').first(),
      ]);
    }, 500, 5000);

    await step('One column per student you manage — uncheck "Managed by me" to search anyone.', async () => {
      await highlight('label[for="daily-managed-by-me-checkbox"]');
      await pause(350);
      await page.uncheck('#daily-managed-by-me-checkbox').catch(() => {});
    }, 1200, 5600);

    await step("Recheck it to get back to your own students.", async () => {
      await highlight('label[for="daily-managed-by-me-checkbox"]');
      await pause(350);
      await page.check('#daily-managed-by-me-checkbox').catch(() => {});
    }, 500, 2900);

    await step('Set Attendance for the day right at the top of each column.', async () => {
      await highlight([
        page.locator('.attendance-select:visible').first(),
        page.locator('.attendance-select:visible').last(),
      ], { pad: 4 });
    }, 500, 3800);

    await step('Every period is a row — the same Safety/Teamwork/Accountability/Relationships and Infraction boxes.', async () => {
      const cell = page.locator('select.daily-input[data-category="t"]:visible').first();
      await highlight(cell);
      await pause(350);
      await cell.selectOption('0');
    }, 1500, 7800);

    await step('Changes save automatically as you go.', async () => {
      await highlight('#save-daily-status');
    }, 300, 2700);

    await step("Percent for the day totals at the bottom of each column.", async () => {
      await highlight([
        page.locator('.daily-percent-cell:not(.period-percent-cell):visible').first(),
        page.locator('.daily-percent-cell:not(.period-percent-cell):visible').last(),
      ], { pad: 4 });
    }, 500, 3300);

    await step('These buttons jump straight to Student Entry or back to Period Entry.', async () => {
      await highlight('#star-entry-mode-toggle');
    }, 800, 4300);

    await step('Same ⋮ menu here too — that’s where past point cards live.', async () => {
      const menuBtn = page.locator('button[aria-label="Student card menu"]:visible').first();
      await highlight(menuBtn);
      await pause(350);
      await menuBtn.click();
    }, 1000, 5900);

    await step('Escape, then Save All Data when you’re done.', async () => {
      await page.keyboard.press('Escape');
      await pause(400);
      const saveBtn = page.locator('button:has-text("Save All Data")');
      await highlight(saveBtn);
      await pause(350);
      await saveBtn.click();
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
