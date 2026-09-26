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
    await cap('User Management: Accounts & Roster — Staff view');
    mark('User Management: Accounts & Roster — Staff view');
    await pause(4600);

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

    await step('As a plain staff account, you can search students, staff, and outside staff by name or username.', async () => {
      const search = page.locator('#student-search');
      await highlight(search);
      await search.click();
      await search.fill('Test Student 10');
      await pause(600);
      await search.fill('');
      await unhighlight();
    }, 800, 4200);

    await step('Add Student sits right at the top of the list, so it’s easy to find.', async () => {
      const addBtnTop = page.locator('#add-student-btn-top');
      await highlight(addBtnTop);
      await pause(350);
      await addBtnTop.click();
      await page.waitForSelector('#student-modal', { state: 'visible' });
      await unhighlight();
    }, 800, 1600);

    await step('Initials and a lunch number are required, and so are a student email and a parent or guardian email.', async () => {
      const nameInput = page.locator('#student-name');
      await nameInput.click();
      await nameInput.fill('NS');
      const lunchInput = page.locator('#student-lunch-number');
      await lunchInput.click();
      await lunchInput.fill('54321');
      const emailInput = page.locator('#student-email');
      await emailInput.click();
      await emailInput.fill('student@example.com');
      const parentEmailInput = page.locator('#student-parent-emails-container .parent-email-input').first();
      await parentEmailInput.click();
      await parentEmailInput.fill('parent@example.com');
      await highlight(['#student-email', '#student-parent-emails-container']);
      await unhighlight();
    }, 800, 4800);

    await step('Staff accounts can view Staff, Outside Staff, and Admin lists, but only an admin can add or edit those accounts.', async () => {
      await page.click('#student-modal .close');
      await pause(200);
      await page.locator('#add-student-btn').scrollIntoViewIfNeeded();
      await highlight('#add-student-btn');
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
