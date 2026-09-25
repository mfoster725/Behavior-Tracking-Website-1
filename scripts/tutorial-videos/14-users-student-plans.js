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
    await cap('User Management: Student Plans');
    mark('User Management: Student Plans');
    await pause(4400);

    await step('Open the menu, and select User Management.', async () => {
      await highlight('#nav-hamburger');
      await pause(350);
      await page.click('#nav-hamburger');
      await pause(300);
      await highlight('.nav-btn[data-view="users"]');
      await pause(350);
      await page.click('.nav-btn[data-view="users"]');
      await unhighlight();
    }, 800, 2200);

    await step('Every student row has a menu of actions — open it with the kebab.', async () => {
      const search = page.locator('#student-search');
      await search.click();
      await search.fill('Test Student 10');
      await pause(500);
      const row = page.locator('#student-users-table-body tr', { hasText: 'Test Student 10' }).first();
      const kebab = row.locator('.users-actions-kebab-btn');
      await highlight(kebab);
      await pause(350);
      await kebab.click();
      await pause(400);
      await unhighlight();
    }, 800, 3400);

    await step('Add/Edit Plan opens their If/Then plan.', async () => {
      const menuBtn = page.locator('.users-actions-kebab-menu.open button', { hasText: 'Add/Edit Plan' });
      await highlight(menuBtn);
      await pause(350);
      await menuBtn.click();
      await page.waitForSelector('#student-plan-modal', { state: 'visible' });
      await unhighlight();
    }, 800, 2600);

    await step('Write the trigger — the If — and what happens next — the Then.', async () => {
      const ifInput = page.locator('.plan-if-input').first();
      await ifInput.click();
      await ifInput.fill('STAR percent drops below 70% before lunch');
      const thenInput = page.locator('.plan-then-input').first();
      await thenInput.click();
      await thenInput.fill('Check in with the case manager for a reset');
      await highlight(thenInput);
      await unhighlight();
    }, 800, 4600);

    await step('Add a point-card threshold so the system can flag it automatically.', async () => {
      const checkbox = page.locator('.plan-has-threshold').first();
      await highlight(checkbox);
      await pause(350);
      await checkbox.check();
      await pause(500);
      await unhighlight();
    }, 800, 4200);

    await step('Add row starts another If/Then; Save plan keeps everything you’ve written.', async () => {
      await highlight('#plan-add-row-btn');
      await pause(400);
      await highlight('#plan-save-btn');
      await unhighlight();
      await page.click('#student-plan-modal .close');
    }, 800, 1000);

  } finally {
    await pause(500);
    await context.close();
    const vp = await page.video().path().catch(() => null);
    console.log('VIDEO_PATH:', vp);
    await browser.close();
  }
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
