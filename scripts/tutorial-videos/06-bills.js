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
    await cap('Bills: Class Overview and a Student’s Week');
    mark('Bills: Class Overview and a Student’s Week');
    await pause(5400);

    await step('Open the menu, and select Bills.', async () => {
      await highlight('#nav-hamburger');
      await pause(350);
      await page.click('#nav-hamburger');
      await pause(300);
      await highlight('.nav-btn[data-view="bills"]');
      await pause(350);
      await page.click('.nav-btn[data-view="bills"]');
      await unhighlight();
    }, 800, 2000);

    await step("Class overview lists every student you manage — checking, savings, what's due, and who's behind.", async () => {
      await highlight('.bills2-table-wrap', { pad: 4 });
    }, 500, 6600);

    await step('Search for a student, or click Open, to manage their bills directly.', async () => {
      await highlight('.bills2-student-search');
      await pause(500);
      const openBtn = page.locator('tr[data-open-student]', { hasText: 'Test Student 10' }).locator('button:has-text("Open")');
      await highlight(openBtn);
      await pause(350);
      await openBtn.click();
      await unhighlight();
    }, 1000, 3800);

    await step("This checkbox turns weekly bills on or off for them — nothing charges until it's on.", async () => {
      await highlight('.bills2-switch');
    }, 500, 5700);

    await step("This week shows what's due, what's left after bills, and progress toward their emergency fund.", async () => {
      await highlight('.bills2-tiles', { pad: 4 });
    }, 500, 5700);

    await step('Pay sends money straight from checking — the full amount, or part of it.', async () => {
      const payBtn = page.locator('.bills2-row', { hasText: 'Maple Street Apartments' }).locator('button:has-text("Pay")');
      await highlight(payBtn);
      await pause(350);
      await payBtn.click();
      await unhighlight();
    }, 1000, 3600);

    await step('Some bills need the math worked out first, like this electric bill. Check the work, or add a convenience fee to skip it.', async () => {
      await page.keyboard.press('Escape');
      await pause(300);
      const workBtn = page.locator('.bills2-row', { hasText: 'Prairie Power & Light' }).locator('button:has-text("Work it out")');
      await highlight(workBtn);
      await pause(350);
      await workBtn.click();
      await unhighlight();
    }, 1000, 6500);

    await step('My Plan is where a student picks their cost of living — rent, internet, insurance, groceries — and that sets next week’s bills.', async () => {
      await page.keyboard.press('Escape');
      await pause(300);
      await highlight('.bills2-tab[data-tab="plan"]');
      await pause(350);
      await page.click('.bills2-tab[data-tab="plan"]');
    }, 1000, 7900);

    await step('Savings tracks their emergency fund, and moves money between checking and savings.', async () => {
      await highlight('.bills2-tab[data-tab="savings"]');
      await pause(350);
      await page.click('.bills2-tab[data-tab="savings"]');
    }, 800, 4900);

    await step('Assistance covers real aid programs — SNAP, Medical Assistance, Housing Choice Voucher — approved off their take-home pay.', async () => {
      await highlight('.bills2-tab[data-tab="assistance"]');
      await pause(350);
      await page.click('.bills2-tab[data-tab="assistance"]');
    }, 800, 7600);

    await step('History holds past weeks, once there’s a week to look back on.', async () => {
      await highlight('.bills2-tab[data-tab="history"]');
      await pause(350);
      await page.click('.bills2-tab[data-tab="history"]');
    }, 800, 3600);

    await step('Grant a PTO day here too, for a paid day off from bills.', async () => {
      await highlight('.bills2-tab[data-tab="week"]');
      await pause(350);
      await page.click('.bills2-tab[data-tab="week"]');
      await pause(300);
      await highlight('button[data-pto-grant]');
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
