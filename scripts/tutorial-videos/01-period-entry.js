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
    await cap('Point Card: Period Entry');
    await pause(2200);

    await step('Open the menu, then select Period Entry.', async () => {
      await page.click('#nav-hamburger');
      await pause(300);
      await page.click('.nav-btn[data-view="period-entry"]');
    }, 800, 1600);

    await step('Set the Date, then pick a Period. The Location fills in for you.', async () => {
      await page.selectOption('#period-select', { label: '8:30-9:00' });
    }, 1200, 2200);

    await step("Every student scheduled for that period shows up as its own column.", async () => {}, 500, 2600);

    await step('Each row is Safety, Teamwork, Accountability, Relationships — and Infractions.', async () => {}, 500, 2800);

    await step('Click any box to score it — 2, 1, 0, Excused, or Unable.', async () => {
      const cell = page.locator('select.daily-input[data-student-id="1"][data-category="s"]').first();
      await cell.selectOption('1');
    }, 1000, 1200);

    await step('It saves automatically — watch the indicator.', async () => {}, 300, 2200);

    await step('This ⋮ menu opens more tools for that student — including their past point cards, next.', async () => {
      await page.locator('button[aria-label="Student card menu"]').first().click();
    }, 1000, 2600);

    await step("Closing this, and saving the period.", async () => {
      await page.keyboard.press('Escape');
      await pause(400);
      await page.locator('button:has-text("Save Period Data")').click();
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
