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
      await unhighlight();
    }, 800, 4200);

    await step('Add Student opens a form for a new account.', async () => {
      await page.fill('#student-search', '');
      const addBtn = page.locator('#add-student-btn');
      await highlight(addBtn);
      await pause(350);
      await addBtn.click();
      await page.waitForSelector('#student-modal', { state: 'visible' });
      await unhighlight();
    }, 800, 1600);

    await step('Initials and a lunch number are all that’s required — everything else has sensible defaults.', async () => {
      const nameInput = page.locator('#student-name');
      await nameInput.click();
      await nameInput.fill('NS');
      const lunchInput = page.locator('#student-lunch-number');
      await lunchInput.click();
      await lunchInput.fill('54321');
      await highlight('#student-lunch-number');
      await unhighlight();
    }, 800, 4400);

    await step('Support team roles — Case Manager, Practitioner, Professional, Group Leader — are set right here too.', async () => {
      await highlight('#case-manager-container');
      await pause(300);
      await page.click('#student-modal .close');
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
