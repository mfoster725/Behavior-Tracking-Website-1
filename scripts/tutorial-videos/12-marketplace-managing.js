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
    await cap('Marketplace: Managing Items & Analytics');
    mark('Marketplace: Managing Items & Analytics');
    await pause(4400);

    await step('Open the menu, and select Marketplace.', async () => {
      await highlight('#nav-hamburger');
      await pause(350);
      await page.click('#nav-hamburger');
      await pause(300);
      await highlight('.nav-btn[data-view="marketplace"]');
      await pause(350);
      await page.click('.nav-btn[data-view="marketplace"]');
      await unhighlight();
    }, 800, 2200);

    await step('Add item creates something new for students to buy.', async () => {
      const btn = page.locator('#marketplace-add-item-btn');
      await highlight(btn);
      await pause(350);
      await btn.click();
      await page.waitForSelector('#marketplace-add-item-modal', { state: 'visible' });
      await page.waitForSelector('#marketplace-add-item-name', { state: 'visible' });
      await unhighlight();
    }, 800, 1600);

    await step('Name it, describe it, and set a price.', async () => {
      const nameInput = page.locator('#marketplace-add-item-name');
      await nameInput.scrollIntoViewIfNeeded();
      await nameInput.click();
      await nameInput.fill('Fidget Spinner');
      const descInput = page.locator('#marketplace-add-item-description');
      await descInput.click();
      await descInput.fill('Classic desk fidget.');
      const priceInput = page.locator('#marketplace-add-item-price');
      await priceInput.click();
      await priceInput.fill('300');
      await highlight(priceInput);
    }, 800, 4000);

    await step('Save adds it straight to the catalog.', async () => {
      const saveBtn = page.locator('#marketplace-add-item-submit');
      await highlight(saveBtn);
      await pause(350);
      await saveBtn.click();
      await pause(700);
      await unhighlight();
    }, 800, 3400);

    await step('Select items, then hide or unhide them from students in bulk.', async () => {
      const selectAll = page.locator('#marketplace-select-all-items');
      await selectAll.scrollIntoViewIfNeeded();
      await highlight(selectAll);
      await pause(350);
      await selectAll.check();
      await pause(400);
      const hideBtn = page.locator('#marketplace-bulk-hide-btn');
      await highlight(hideBtn);
    }, 800, 5000);

    await step('Purchase analytics shows what’s popular — and what never sells.', async () => {
      const hideCheckbox = page.locator('#marketplace-analytics-hide-checkbox');
      await hideCheckbox.scrollIntoViewIfNeeded();
      await highlight(hideCheckbox);
      await pause(350);
      await hideCheckbox.uncheck();
      await pause(600);
    }, 800, 3600);

    await step('Most and least purchased, by count.', async () => {
      const charts = page.locator('.marketplace-analytics-charts-grid');
      await charts.scrollIntoViewIfNeeded();
      await highlight(charts, { pad: 4 });
    }, 500, 4200);

    await step('Pick an item to see who buys it, by grade and card color.', async () => {
      const select = page.locator('#marketplace-analytics-item-select');
      await select.scrollIntoViewIfNeeded();
      await highlight(select);
      await pause(350);
      await select.selectOption({ index: 1 });
      await pause(700);
    }, 800, 5000);

  } finally {
    await pause(500);
    await context.close();
    const vp = await page.video().path().catch(() => null);
    console.log('VIDEO_PATH:', vp);
    await browser.close();
  }
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
