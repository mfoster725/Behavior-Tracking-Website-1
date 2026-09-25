const { chromium, makeHelpers, login } = require('./harness');

async function selectStudent(page, name) {
  const search = page.locator('#summary-student-search');
  await search.click();
  await search.evaluate(el => el.removeAttribute('readonly'));
  await search.type(name, { delay: 30 });
  await page.waitForTimeout(600);
  await page.locator('#summary-student-dropdown .dashboard-search-option').first().click();
}

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    recordVideo: { dir: __dirname, size: { width: 1440, height: 900 } },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  const { initCaptions, cap, pause, step } = makeHelpers(page);

  try {
    await login(page, 'staff25', 'test123');
    await page.evaluate(initCaptions);
    await cap('Navigating Reports');
    await pause(2200);

    await step('Open the menu, then select Reports.', async () => {
      await page.click('#nav-hamburger');
      await pause(300);
      await page.click('.nav-btn[data-view="summary"]');
    }, 800, 2000);

    await step('With no student picked, and "Managed by me" checked, you get your whole caseload as a group.', async () => {}, 500, 3000);

    await step('Search for one student to switch to just their report.', async () => {
      await selectStudent(page, 'Test Student 1');
    }, 1000, 2600);

    await step('A banner confirms who you’re viewing — click Clear to go back to the group.', async () => {
      await page.click('#summary-context-clear');
    }, 800, 2000);

    await step('Uncheck "Managed by me" to widen the group to every student, not just yours.', async () => {
      await page.uncheck('#summary-managed-by-me-checkbox');
    }, 1000, 2400);

    await step('Recheck it to narrow back to your own students.', async () => {
      await page.check('#summary-managed-by-me-checkbox');
    }, 500, 1800);

    await step('Timeframe controls the date range for everything below.', async () => {
      await page.click('#summary-period-dropdown');
    }, 800, 800);

    await step('30 school days, a week, the current year, any quarter, all time, or a custom range.', async () => {
      await page.selectOption('#summary-period-dropdown', 'current_year');
    }, 500, 2600);

    await step('Back to the default range.', async () => {
      await page.selectOption('#summary-period-dropdown', '30day');
    }, 500, 1200);

    await step('Compare shows a second section for comparing two periods side by side.', async () => {
      await page.click('#summary-compare-toggle');
    }, 1000, 2600);

    await step('Click it again to hide that section.', async () => {
      await page.click('#summary-compare-toggle');
    }, 800, 1400);

    await step('Incentive Tracking shows a section for building incentive tables over a date range.', async () => {
      await page.click('#summary-incentive-toggle');
    }, 1000, 2600);

    await step('Same idea — click again to hide it.', async () => {
      await page.click('#summary-incentive-toggle');
    }, 800, 1400);

    await step('Insights View opens a separate, deeper analytics page for whoever you have selected.', async () => {}, 800, 2400);

    await step('And Print sends the report you’re looking at to your printer or a PDF.', async () => {}, 800, 2400);

  } finally {
    await pause(500);
    await context.close();
    const vp = await page.video().path().catch(() => null);
    console.log('VIDEO_PATH:', vp);
    await browser.close();
  }
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
