const { chromium, makeHelpers } = require('./harness');

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
    await page.goto('http://localhost:5050/login', { waitUntil: 'domcontentloaded' });
    await page.fill('#username', 'student10');
    await page.fill('#password', 'test123');
    await page.click('button[type="submit"]');
    await page.waitForTimeout(1200);
    await page.evaluate(initCaptions);
    await cap('Marketplace: Shopping & Checkout');
    mark('Marketplace: Shopping & Checkout');
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

    await step('The balance card shows what a student has to spend right now.', async () => {
      await highlight('#marketplace-balance-section');
    }, 500, 3400);

    await step('Search, or filter by type and category, to find an item.', async () => {
      const search = page.locator('#marketplace-search-input');
      await highlight(search);
      await search.click();
      await search.fill('Chips');
      await pause(400);
      await page.click('#marketplace-search-btn');
      await pause(500);
      await unhighlight();
    }, 800, 3600);

    await step('Add to cart puts it in the cart on the right.', async () => {
      const addBtn = page.locator('.marketplace-card-add-btn').first();
      await highlight(addBtn);
      await pause(350);
      await addBtn.click();
      await unhighlight();
    }, 800, 3000);

    await step('The cart totals everything, and Checkout submits it as a purchase order.', async () => {
      await highlight('#marketplace-cart-section');
      await pause(500);
      await page.click('#marketplace-checkout-btn');
      await pause(500);
      await unhighlight();
    }, 800, 4200);

    await step('My orders tracks every purchase, pending until staff review it.', async () => {
      const orders = page.locator('#marketplace-my-orders-section');
      await orders.scrollIntoViewIfNeeded();
      await highlight(orders, { pad: 4 });
    }, 800, 4600);

  } finally {
    await pause(500);
    await context.close();
    const vp = await page.video().path().catch(() => null);
    console.log('VIDEO_PATH:', vp);
    await browser.close();
  }
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
