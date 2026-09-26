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
    await cap('Viewing & Printing Past Point Cards');
    mark('Viewing & Printing Past Point Cards');
    await pause(3500);

    await step('Start from either Period Entry or Daily Entry.', async () => {
      await highlight('#period-select');
      await pause(350);
      await page.selectOption('#period-select', { label: '8:30-9:00' });
    }, 800, 4500);

    await step('Click the ⋮ menu on any student.', async () => {
      const menuBtn = page.locator('button[aria-label="Student card menu"]:visible').first();
      await highlight(menuBtn);
      await pause(350);
      await menuBtn.click();
    }, 1000, 2900);

    await step('Then choose "View past point cards."', async () => {
      const pastCardsBtn = page.locator('button[data-action="past-cards"]').first();
      await highlight(pastCardsBtn);
      await pause(350);
      await pastCardsBtn.click();
      await unhighlight();
    }, 800, 2400);

    await step('Every past day is its own card — times, locations, STAR scores, and infractions.', async () => {
      await highlight('.point-card-day:visible', { pad: 6 });
    }, 500, 6900);

    await step('"Info Insights" alongside it summarizes that day: average percent, reminders, resets, frenzies, and more.', async () => {
      await highlight('.point-card-day:visible .point-card-info-aggregate', { pad: 6 });
    }, 500, 8300);

    await step('Filter by exact date, by month, by year, or search across everything.', async () => {
      await highlight('#point-card-filters', { pad: 6 });
    }, 500, 5600);

    await step('Click Edit on any day to go back and correct an entry.', async () => {
      await highlight('.edit-day-btn:visible');
    }, 500, 3900);

    await step('Click Print, top right, to print or save a PDF.', async () => {
      const printBtn = page.locator('#past-point-card-print-btn');
      await highlight(printBtn);
      await pause(350);
      await printBtn.click();
    }, 1000, 4000);

    await step('Choose the Full Point Card, the Info Insights summary, or both — then Print opens your browser’s print dialog.', async () => {
      await highlight('#past-point-card-print-menu', { pad: 6 });
    }, 500, 7000);

  } finally {
    await pause(500);
    await context.close();
    const vp = await page.video().path().catch(() => null);
    console.log('VIDEO_PATH:', vp);
    await browser.close();
  }
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
