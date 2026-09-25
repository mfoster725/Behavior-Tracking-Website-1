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
    await cap('Marketplace: Fulfilling Orders');
    mark('Marketplace: Fulfilling Orders');
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

    await step('Purchase orders to fulfill lists every pending student order.', async () => {
      await highlight('#marketplace-po-approvals-section', { pad: 4 });
    }, 500, 4000);

    await step('Fulfill approves it — the item is theirs.', async () => {
      const gumOrder = page.locator('[data-po-id]', { hasText: 'Gum' }).first();
      const fulfillBtn = gumOrder.locator('[data-po-approve]');
      await highlight(fulfillBtn);
      await pause(350);
      await fulfillBtn.click();
      await pause(600);
      await unhighlight();
    }, 800, 4200);

    await step('Deny sends it back — add a reason so the student knows why.', async () => {
      const chipsOrder = page.locator('[data-po-id]', { hasText: 'Chips' }).first();
      const reasonInput = chipsOrder.locator('[data-po-deny-reason]');
      await highlight(reasonInput);
      await reasonInput.click();
      await reasonInput.fill('Out of stock this week');
      await pause(400);
      const denyBtn = chipsOrder.locator('[data-po-deny]');
      await highlight(denyBtn);
      await pause(350);
      await denyBtn.click();
      await pause(600);
      await unhighlight();
    }, 800, 4800);

    await step('The student sees the update on their own Marketplace page.', async () => {
      await highlight('#marketplace-po-approvals-section', { pad: 4 });
    }, 500, 3400);

  } finally {
    await pause(500);
    await context.close();
    const vp = await page.video().path().catch(() => null);
    console.log('VIDEO_PATH:', vp);
    await browser.close();
  }
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
