const { chromium, makeHelpers, login } = require('./harness');

async function selectStudent(page, name, highlight, pause) {
  await highlight('#summary-student-search-wrap');
  await pause(400);
  const search = page.locator('#summary-student-search');
  await search.click();
  await search.evaluate(el => el.removeAttribute('readonly'));
  await search.type(name, { delay: 30 });
  await page.waitForTimeout(600);
  const option = page.locator('#summary-student-dropdown .dashboard-search-option').first();
  await highlight(option);
  await pause(350);
  await option.click();
}

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
    await cap('Navigating Reports');
    mark('Navigating Reports');
    await pause(2700);

    await step('Open the menu, then select Reports.', async () => {
      await highlight('#nav-hamburger');
      await pause(350);
      await page.click('#nav-hamburger');
      await pause(300);
      await highlight('.nav-btn[data-view="summary"]');
      await pause(350);
      await page.click('.nav-btn[data-view="summary"]');
      await pause(500);
      // Trends starts collapsed by default; open it so the full report layout shows
      // for the whole video instead of leaving that column blank.
      await page.locator('.overview-trends-card[data-overview-key="trends"]').click().catch(() => {});
      await unhighlight();
    }, 800, 2100);

    await step('With no student picked, and "Managed by me" checked, you get your whole caseload as a group.', async () => {
      await highlight('.dashboard-managed-check');
    }, 500, 6100);

    await step('Search for one student to switch to just their report.', async () => {
      await selectStudent(page, 'Test Student 1', highlight, pause);
      await unhighlight();
    }, 1000, 3500);

    await step('A banner confirms who you’re viewing — click Clear to go back to the group.', async () => {
      await highlight('#summary-context-banner');
      await pause(500);
      const clearBtn = page.locator('#summary-context-clear');
      await highlight(clearBtn);
      await pause(350);
      await clearBtn.click();
      await unhighlight();
    }, 800, 3900);

    await step('Uncheck "Managed by me" to widen the group to every student, not just yours.', async () => {
      await highlight('.dashboard-managed-check');
      await pause(350);
      await page.uncheck('#summary-managed-by-me-checkbox');
    }, 1000, 5400);

    await step('Recheck it to narrow back to your own students.', async () => {
      await highlight('.dashboard-managed-check');
      await pause(350);
      await page.check('#summary-managed-by-me-checkbox');
    }, 500, 3100);

    await step('Timeframe controls the date range for everything below.', async () => {
      await highlight('#summary-period-dropdown');
      await pause(350);
      await page.click('#summary-period-dropdown');
    }, 800, 3300);

    await step('30 school days, a week, the current year, any quarter, all time, or a custom range.', async () => {
      await highlight('#summary-period-dropdown');
      await pause(350);
      await page.selectOption('#summary-period-dropdown', 'current_year');
    }, 500, 7400);

    await step('Back to the default range.', async () => {
      await highlight('#summary-period-dropdown');
      await pause(350);
      await page.selectOption('#summary-period-dropdown', '30day');
    }, 500, 1900);

    await step('Compare shows a second section for comparing two periods side by side.', async () => {
      const toggle = page.locator('#summary-compare-toggle');
      await highlight(toggle);
      await pause(350);
      await toggle.click();
    }, 1000, 4100);

    await step('Click it again to hide that section.', async () => {
      const toggle = page.locator('#summary-compare-toggle');
      await highlight(toggle);
      await pause(350);
      await toggle.click();
      await unhighlight();
    }, 800, 1900);

    await step('Incentive Tracking shows a section for building incentive tables over a date range.', async () => {
      const toggle = page.locator('#summary-incentive-toggle');
      await highlight(toggle);
      await pause(350);
      await toggle.click();
    }, 1000, 5500);

    await step('Same idea — click again to hide it.', async () => {
      const toggle = page.locator('#summary-incentive-toggle');
      await highlight(toggle);
      await pause(350);
      await toggle.click();
      await unhighlight();
    }, 800, 2200);

    await step('Insights View opens a separate, deeper analytics page for whoever you have selected.', async () => {
      await highlight('#summary-insights-btn');
    }, 800, 5100);

    await step('And Print sends the report you’re looking at to your printer or a PDF.', async () => {
      await highlight('#print-summary-btn');
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
