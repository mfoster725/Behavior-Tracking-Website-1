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
    await login(page, 'staff17', 'test123');
    await page.evaluate(initCaptions);
    await cap('Notifications');
    mark('Notifications');
    await pause(4200);

    await step("The bell in the header shows unread notifications — a red badge means something's waiting.", async () => {
      await highlight('#notifications-bell-btn', { pad: 6 });
    }, 500, 4200);

    await step('Click it to open the list.', async () => {
      await page.click('#notifications-bell-btn');
      await pause(500);
      await highlight('#notifications-list', { pad: 4 });
    }, 600, 4400);

    await step('Unread ones are tinted blue. Mark all read, or show what you already read, from here.', async () => {
      await highlight(['#notifications-mark-all-read', '#notifications-show-read']);
    }, 500, 4600);

    await step('Click a notification and it jumps you straight to what it\'s about.', async () => {
      const row = page.locator('[data-notification-id]', { hasText: 'Missing points' }).first();
      await highlight(row, { pad: 2 });
      await pause(500);
      await row.click();
      await pause(900);
    }, 700, 1600);

    await step("This one lands on Daily Entry, searches up the student, and flashes their row.", async () => {
      const header = page.locator('.daily-header-student[data-student-id]').first();
      await highlight(header, { pad: 6 });
    }, 200, 4600);

    await step('Back to the bell for the other one still waiting.', async () => {
      await highlight('#notifications-bell-btn', { pad: 6 });
      await pause(350);
      await page.click('#notifications-bell-btn');
      await pause(500);
      const row = page.locator('[data-notification-id]', { hasText: 'New purchase order' }).first();
      await highlight(row, { pad: 2 });
    }, 600, 3400);

    await step('A pending purchase order jumps to Marketplace and flashes it in the approval queue.', async () => {
      const row = page.locator('[data-notification-id]', { hasText: 'New purchase order' }).first();
      await row.click();
      await unhighlight();
      await pause(900);
      const flashed = page.locator('#marketplace-po-approvals-list [data-po-id]').first();
      await highlight(flashed, { pad: 6 });
    }, 200, 5000);

  } finally {
    await pause(500);
    await context.close();
    const vp = await page.video().path().catch(() => null);
    console.log('VIDEO_PATH:', vp);
    await browser.close();
  }
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
