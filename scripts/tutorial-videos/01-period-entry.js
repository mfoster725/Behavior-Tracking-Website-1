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
    await cap('Point Card: Period Entry');
    mark('Point Card: Period Entry');
    await pause(4600);

    await step('Open the menu, then select Period Entry.', async () => {
      await highlight('#nav-hamburger');
      await pause(350);
      await page.click('#nav-hamburger');
      await pause(300);
      await highlight('.nav-btn[data-view="period-entry"]');
      await pause(350);
      await page.click('.nav-btn[data-view="period-entry"]');
      await unhighlight();
    }, 800, 3200);

    await step('Set the Date, then pick a Period. The Location fills in for you.', async () => {
      await highlight('#period-select');
      await pause(350);
      await page.selectOption('#period-select', { label: '8:30-9:00' });
    }, 1200, 4800);

    await step("Every student scheduled for that period shows up as its own column.", async () => {
      await highlight([
        page.locator('.daily-header-student:visible').first(),
        page.locator('button.info-btn:visible').first(),
      ]);
    }, 500, 4300);

    await step('Each row is Safety, Teamwork, Accountability, Relationships — and Infractions.', async () => {
      await highlight([
        page.locator('.star-category-header[data-category]:visible').first(),
        page.locator('.star-category-header[data-category]:visible').last(),
      ], { pad: 4 });
    }, 500, 6000);

    await step('Click any box to score it — 2, 1, 0, Excused, or Unable.', async () => {
      const cell = page.locator('select.daily-input[data-category="s"]:visible').first();
      await highlight(cell);
      await pause(350);
      await cell.selectOption('1');
    }, 1000, 5800);

    await step('It saves automatically — watch the indicator.', async () => {
      await highlight('button:has-text("Save Period Data")');
    }, 300, 5000);

    await step('This ⋮ menu opens more tools for that student — including their past point cards, next.', async () => {
      const menuBtn = page.locator('button[aria-label="Student card menu"]:visible').first();
      await highlight(menuBtn);
      await pause(350);
      await menuBtn.click();
    }, 1000, 6800);

    await step("Closing this, and saving the period.", async () => {
      await page.keyboard.press('Escape');
      await pause(400);
      const saveBtn = page.locator('button:has-text("Save Period Data")');
      await highlight(saveBtn);
      await pause(350);
      await saveBtn.click();
    }, 800, 3900);

  } finally {
    await pause(500);
    await context.close();
    const vp = await page.video().path().catch(() => null);
    console.log('VIDEO_PATH:', vp);
    await browser.close();
  }
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
