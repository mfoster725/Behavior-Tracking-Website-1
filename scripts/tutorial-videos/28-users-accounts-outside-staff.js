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
    await login(page, 'outsidestaff1', 'test123');
    await page.evaluate(initCaptions);
    await cap('User Management: Accounts & Roster — Outside Staff view');
    mark('User Management: Accounts & Roster — Outside Staff view');
    await pause(4800);

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

    await step('As Outside Staff, there’s no Add Student button here — you can search and view students by name or username.', async () => {
      const search = page.locator('#student-search');
      await highlight(search);
      await search.click();
      await search.fill('Test Student 10');
      await pause(600);
      await search.fill('');
      await unhighlight();
    }, 800, 4400);

    await step('The Staff, Outside Staff, and Admin lists are also here to search — read-only, since only an admin can add or edit accounts.', async () => {
      await page.locator('#staff-search').scrollIntoViewIfNeeded();
      await highlight('#staff-search');
      await pause(300);
      await page.locator('#outside-staff-search').scrollIntoViewIfNeeded();
      await highlight('#outside-staff-search');
    }, 800, 4600);

    await step('Refresh List is the only action button on this page for an Outside Staff account.', async () => {
      const refreshBtn = page.locator('#refresh-users-btn');
      await refreshBtn.scrollIntoViewIfNeeded();
      await highlight(refreshBtn);
    }, 800, 3800);

  } finally {
    await pause(500);
    await context.close();
    const vp = await page.video().path().catch(() => null);
    console.log('VIDEO_PATH:', vp);
    await browser.close();
  }
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
