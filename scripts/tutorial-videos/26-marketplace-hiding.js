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
    await cap('Marketplace: Creating & Hiding Items');
    mark('Marketplace: Creating & Hiding Items');
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
      await nameInput.click();
      await nameInput.fill('Puzzle Book');
      const descInput = page.locator('#marketplace-add-item-description');
      await descInput.click();
      await descInput.fill('A pocket-sized puzzle book.');
      const priceInput = page.locator('#marketplace-add-item-price');
      await priceInput.click();
      await priceInput.fill('250');
      await highlight(priceInput);
      await unhighlight();
    }, 800, 4000);

    await step('Save adds it straight to the catalog.', async () => {
      const saveBtn = page.locator('#marketplace-add-item-submit');
      await highlight(saveBtn);
      await pause(350);
      await saveBtn.click();
      await page.waitForSelector('#marketplace-add-item-modal', { state: 'hidden' });
      const searchInput = page.locator('#marketplace-search-input');
      await searchInput.click();
      await searchInput.fill('Puzzle Book');
      await page.click('#marketplace-search-btn');
      await page.waitForSelector('.marketplace-item-card:has-text("Puzzle Book")', { state: 'attached', timeout: 15000 });
      await unhighlight();
    }, 800, 3200);

    await step('Hide from students controls exactly who stops seeing an item — not whether it exists at all.', async () => {
      const card = page.locator('.marketplace-item-card:has-text("Puzzle Book")').first();
      await card.scrollIntoViewIfNeeded();
      const hideBtn = card.locator('.marketplace-btn-hide');
      await highlight(hideBtn);
      await pause(350);
      await hideBtn.click();
      await page.waitForSelector('#marketplace-hide-modal', { state: 'visible' });
      await unhighlight();
    }, 800, 4600);

    await step('By card color hides it only from students on that color — yellow, green, or blue.', async () => {
      const radio = page.locator('input[name="marketplace-hide-type"][value="card_color"]');
      await highlight(radio);
      await pause(350);
      await radio.check();
      await pause(400);
      const colorSelect = page.locator('#marketplace-hide-card-color');
      await highlight(colorSelect);
      await colorSelect.selectOption('yellow');
      await unhighlight();
    }, 800, 5400);

    await step('The other options hide it from one student, a grade band, or your whole caseload instead.', async () => {
      await highlight([
        page.locator('input[name="marketplace-hide-type"][value="student"]'),
        page.locator('input[name="marketplace-hide-type"][value="grade_section"]'),
        page.locator('input[name="marketplace-hide-type"][value="managed_by_me"]'),
      ]);
    }, 500, 5200);

    await step('Hide from students saves the rule — staff still see it, only matching students don’t.', async () => {
      const submitBtn = page.locator('#marketplace-hide-submit');
      await highlight(submitBtn);
      await pause(350);
      await submitBtn.click();
      await pause(700);
      await page.click('#marketplace-hide-modal-close');
      await page.waitForSelector('#marketplace-hide-modal', { state: 'hidden' });
      await unhighlight();
    }, 800, 4600);

    await step('Unhide / Manage shows every rule on the item — remove one to make it visible again.', async () => {
      const card = page.locator('.marketplace-item-card:has-text("Puzzle Book")').first();
      await card.scrollIntoViewIfNeeded();
      const unhideBtn = card.locator('.marketplace-btn-unhide');
      await highlight(unhideBtn);
      await pause(350);
      await unhideBtn.click();
      await page.waitForSelector('#marketplace-unhide-modal', { state: 'visible' });
      await pause(700);
      await unhighlight();
    }, 800, 5600);

  } finally {
    await pause(500);
    await context.close();
    const vp = await page.video().path().catch(() => null);
    console.log('VIDEO_PATH:', vp);
    await browser.close();
  }
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
