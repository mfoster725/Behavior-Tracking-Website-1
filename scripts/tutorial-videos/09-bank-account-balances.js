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
    await cap('Bank Account: Balances & Paychecks');
    mark('Bank Account: Balances & Paychecks');
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

    await step('Check "Managed by me" to list every balance on your caseload.', async () => {
      const checkbox = page.locator('#bank-managed-by-me-checkbox');
      await checkbox.scrollIntoViewIfNeeded();
      await highlight(checkbox);
      await pause(350);
      await checkbox.check();
      await pause(500);
      await unhighlight();
    }, 800, 3600);

    await step('Click any student to open their account.', async () => {
      const row = page.locator('.bank-balances-preview-row[data-student-id="10"]');
      await highlight(row);
      await pause(350);
      await row.click();
      await pause(500);
      await unhighlight();
    }, 800, 2800);

    await step('Current balance is what’s in checking right now.', async () => {
      await highlight('.accounts-total-balance');
    }, 500, 3400);

    await step('Emergency fund is their savings, building toward a goal.', async () => {
      await highlight('#bank-savings-section');
    }, 500, 3600);

    await step('Undeposited paychecks are waiting for the student to complete their worksheet.', async () => {
      const btn = page.locator('#view-undeposited-paychecks-btn');
      await highlight(btn);
      await pause(350);
      await btn.click();
      await pause(500);
      await unhighlight();
    }, 800, 4200);

    await step('Complete worksheet opens the pay stub they’ll fill in.', async () => {
      const btn = page.locator('#paychecks-modal button:has-text("Complete worksheet")').first();
      await highlight(btn);
      await pause(350);
      await btn.click();
      await pause(500);
      await unhighlight();
    }, 800, 3600);

    await step('Every box is blank until the student does the math themselves — gross pay, taxes, and the Point Card Deduction.', async () => {
      const worksheet = page.locator('#current-paycheck-worksheet');
      await worksheet.scrollIntoViewIfNeeded();
      await highlight(worksheet, { pad: 2 });
    }, 800, 6200);

  } finally {
    await pause(500);
    await context.close();
    const vp = await page.video().path().catch(() => null);
    console.log('VIDEO_PATH:', vp);
    await browser.close();
  }
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
