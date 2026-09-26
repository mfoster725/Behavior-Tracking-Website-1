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
    await cap('Admin: Importing Data');
    mark('Admin: Importing Data');
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

    await step('Import Users from CSV bulk-creates or updates staff, outside staff, or students.', async () => {
      const section = page.locator('#admin-view').locator('.admin-section', { hasText: 'Import Users from CSV' });
      await section.scrollIntoViewIfNeeded();
      await highlight(section, { pad: 4 });
    }, 500, 4400);

    await step('Pick the import type — the required columns update to match.', async () => {
      const select = page.locator('#import-type-select');
      await highlight(select);
      await pause(350);
      await select.selectOption('student');
      await pause(600);
    }, 800, 4600);

    await step('Existing accounts are matched and updated — by User Number for staff, Lunch Number for students — instead of duplicated.', async () => {
      const text = page.locator('#import-student-section p').first();
      await highlight(text);
    }, 500, 5200);

    await step('Google Sheet Sync keeps a spreadsheet and the website in step automatically.', async () => {
      const section = page.locator('#admin-view').locator('.admin-section', { hasText: 'Google Sheet Sync' });
      await section.scrollIntoViewIfNeeded();
      await highlight(section, { pad: 4 });
    }, 500, 4600);

    await step('Check Setup tells you how many sheet rows aren’t on the website yet.', async () => {
      await highlight(page.locator('button', { hasText: 'Check Setup' }));
    }, 500, 3600);

    await step('Pull brings sheet edits in; Push writes website changes out; Sync Both Ways does both, in order.', async () => {
      await highlight([
        page.locator('button', { hasText: 'Pull From Sheet' }),
        page.locator('button', { hasText: 'Push To Sheet' }),
        page.locator('button', { hasText: 'Sync Both Ways' }),
      ]);
    }, 500, 5200);

  } finally {
    await pause(500);
    await context.close();
    const vp = await page.video().path().catch(() => null);
    console.log('VIDEO_PATH:', vp);
    await browser.close();
  }
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
