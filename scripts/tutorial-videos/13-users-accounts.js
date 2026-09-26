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
    await cap('User Management: Accounts & Roster');
    mark('User Management: Accounts & Roster');
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

    await step('Students, staff, and outside staff each get their own table — search any of them by name or username.', async () => {
      const search = page.locator('#student-search');
      await highlight(search);
      await search.click();
      await search.fill('Test Student 10');
      await pause(600);
    }, 800, 4200);

    await step('Add Student sits right at the top of the list, so it’s easy to find.', async () => {
      await page.fill('#student-search', '');
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
    }, 800, 4800);

    await step('Support team roles — Case Manager, Practitioner, Professional, Group Leader — are set right here too.', async () => {
      await highlight('#case-manager-container');
      await pause(300);
      await page.click('#student-modal .close');
      await unhighlight();
    }, 800, 4200);

    await step('The same pattern adds Staff, Outside Staff, or Admin accounts.', async () => {
      await highlight(['#add-staff-btn', '#add-outside-staff-btn', '#add-admin-btn']);
    }, 500, 3800);

    await step('Share login information sends credentials to one or many accounts at once.', async () => {
      const btn = page.locator('#share-login-bulk-btn');
      await btn.scrollIntoViewIfNeeded();
      await highlight(btn);
    }, 800, 4000);

  } finally {
    await pause(500);
    await context.close();
    const vp = await page.video().path().catch(() => null);
    console.log('VIDEO_PATH:', vp);
    await browser.close();
  }
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
