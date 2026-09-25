const { chromium, makeHelpers, login } = require('./harness');

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
    await cap('Viewing & Printing Past Point Cards');
    await pause(2200);

    await step('Start from either Period Entry or Daily Entry.', async () => {
      await page.selectOption('#period-select', { label: '8:30-9:00' });
    }, 800, 2000);

    await step('Click the ⋮ menu on any student.', async () => {
      await page.locator('button[aria-label="Student card menu"]').first().click();
    }, 1000, 1200);

    await step('Then choose "View past point cards."', async () => {
      await page.locator('button[data-action="past-cards"]').first().click();
    }, 800, 2400);

    await step('Every past day is its own card — times, locations, STAR scores, and infractions.', async () => {}, 500, 3000);

    await step('"Info Insights" alongside it summarizes that day: average percent, reminders, resets, frenzies, and more.', async () => {}, 500, 3200);

    await step('Filter by exact date, by month, by year, or search across everything.', async () => {}, 500, 2800);

    await step('Click Edit on any day to go back and correct an entry.', async () => {}, 500, 2400);

    await step('Click Print, top right, to print or save a PDF.', async () => {
      await page.click('#past-point-card-print-btn');
    }, 1000, 1600);

    await step('Choose the Full Point Card, the Info Insights summary, or both — then Print opens your browser’s print dialog.', async () => {}, 500, 3200);

  } finally {
    await pause(500);
    await context.close();
    const vp = await page.video().path().catch(() => null);
    console.log('VIDEO_PATH:', vp);
    await browser.close();
  }
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
