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
    await cap('Admin: Accounts & Billing');
    mark('Admin: Accounts & Billing');
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

    await step('Plan & Billing manages your subscription — Manage Plan opens Stripe’s billing portal.', async () => {
      await highlight('#billing-portal-btn');
    }, 500, 4400);

    await step('User Statistics gives a live headcount of every role.', async () => {
      await highlight('#admin-stats');
    }, 500, 3600);

    await step('Quick Actions creates a Staff or Admin account without leaving this page.', async () => {
      const btn = page.locator('#create-staff-account-btn');
      await highlight(btn);
      await pause(350);
      await btn.click();
      await page.waitForSelector('#staff-modal', { state: 'visible' });
      await pause(600);
      await unhighlight();
    }, 800, 3600);

    await step('Manage All Users jumps straight to User Management.', async () => {
      await page.click('#staff-modal .close');
      await pause(300);
      const btn = page.locator('#view-all-users-btn');
      await highlight(btn);
    }, 800, 3600);

  } finally {
    await pause(500);
    await context.close();
    const vp = await page.video().path().catch(() => null);
    console.log('VIDEO_PATH:', vp);
    await browser.close();
  }
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
