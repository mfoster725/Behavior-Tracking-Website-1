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
    await cap('Bank Account: Staff Bonuses');
    mark('Bank Account: Staff Bonuses');
    await pause(4600);

    await step('Open the menu, and select Bank Account.', async () => {
      await highlight('#nav-hamburger');
      await pause(350);
      await page.click('#nav-hamburger');
      await pause(300);
      await highlight('.nav-btn[data-view="bank-account"]');
      await pause(350);
      await page.click('.nav-btn[data-view="bank-account"]');
      await unhighlight();
    }, 800, 2200);

    await step('Bonuses awards extra pay on top of a student’s point-card earnings.', async () => {
      await highlight('#starbucks-section');
    }, 500, 3600);

    await step('Check "Managed by me" to load everyone on your caseload.', async () => {
      const checkbox = page.locator('#starbucks-managed-by-me-checkbox');
      await highlight(checkbox);
      await pause(350);
      await checkbox.check();
      await pause(500);
    }, 800, 3600);

    await step('Type a count directly into a student’s row — here, a Starbucks run for Test Student 10.', async () => {
      const row = page.locator('#starbucks-table-body tr', { hasText: 'Test Student 10' });
      const input = row.locator('input');
      await highlight(input);
      await input.click();
      await input.fill('1');
    }, 800, 4000);

    await step('Submit Table saves every count you’ve changed at once.', async () => {
      const submitBtn = page.locator('#starbucks-submit-btn');
      await highlight(submitBtn);
      await pause(350);
      await submitBtn.click();
      await pause(500);
      await unhighlight();
    }, 800, 3600);

    await step('Switch the type to award Star Student or Star Classroom instead.', async () => {
      const select = page.locator('#bonuses-type-select');
      await highlight(select);
      await pause(350);
      await select.selectOption('star_classroom');
      await pause(500);
    }, 800, 4400);

    await step('Star Classroom awards a whole caseload at once — search for the teacher or case manager.', async () => {
      const input = page.locator('#bonuses-teacher-search');
      await highlight(input);
      await input.click();
      await input.fill('Staff Member 10');
      await pause(500);
    }, 800, 4200);

    await step('Pick them from the list to preview their caseload.', async () => {
      const option = page.locator('#bonuses-teacher-dropdown .dashboard-search-option').first();
      await highlight(option);
      await pause(350);
      await option.click();
      await pause(500);
      await unhighlight();
    }, 800, 3600);

    await step('Award Star Classroom adds one to every student on that caseload at once.', async () => {
      const awardBtn = page.locator('#bonuses-classroom-award-btn');
      await awardBtn.scrollIntoViewIfNeeded();
      await highlight(awardBtn);
      await pause(350);
    }, 800, 4200);

  } finally {
    await pause(500);
    await context.close();
    const vp = await page.video().path().catch(() => null);
    console.log('VIDEO_PATH:', vp);
    await browser.close();
  }
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
