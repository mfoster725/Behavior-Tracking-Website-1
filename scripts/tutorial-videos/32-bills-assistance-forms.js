const { chromium, makeHelpers, login } = require('./harness');

// Correct answers for the seeded "Test Student 10" demo (see
// scripts/tutorial-videos/seed_bills_demo.py) — matches what
// economy_routes.py's expected_answers() computes for them, checked live via
// GET /api/economy/student/10 before writing this script. If the seed data
// changes (a different demo student, a different rent bill), re-check that
// endpoint's `income` block and the student's real rent bill before reusing
// these values — grading checks the student's own real records, not a fixed
// answer key.
const CORRECT = {
  full_name: 'T1',
  street: '500 John St',
  city: 'Starbuck',
  state: 'MN',
  zip: '56381',
  member_name: 'T1',
  member_ssn: '4471',
  member_dob: '11',
  income_name: 'T1',
  wages_annual: '33581.60',
  worked_who: 'T1',
  current_rent: '152.02',
  landlord: 'Maple Street Apartments',
  printed_name: 'T1',
  signature: 'T1',
};
const WRONG_RENT = '50.00';

function todayMDY() {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${mm}/${dd}/${d.getFullYear()}`;
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

  // This browser environment silently marks text inputs near sensitive-looking
  // labels (SSN, date of birth, address) readonly with custom
  // data-autofill-hardened attributes, unrelated to any app code — Playwright's
  // normal .fill() waits forever for "editable" on them. Set the value directly
  // and dispatch a real input event instead, which the app's own
  // bindApplicationInputs() listener picks up the same as a real keystroke.
  const fillText = async (id, value) => {
    await page.evaluate(({ name, value }) => {
      const el = document.querySelector(`input[name="${name}"]`);
      if (!el) throw new Error('field not found: ' + name);
      el.removeAttribute('readonly');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, { name: `gov-${id}`, value });
  };
  const checkRadio = async (id, value) => {
    await page.check(`input[name="gov-${id}"][value="${value}"]`);
  };
  const checkBox = async (id, value) => {
    await page.check(`input[name="gov-${id}"][value="${value}"]`);
  };

  try {
    await login(page, 'staff17', 'test123');
    await page.evaluate(initCaptions);
    await cap('Bills: Assistance Applications');
    mark('Bills: Assistance Applications');
    await pause(4200);

    await step('Open Bills and pull up a student — Assistance is one of their tabs.', async () => {
      await highlight('#nav-hamburger');
      await pause(350);
      await page.click('#nav-hamburger');
      await pause(300);
      await highlight('.nav-btn[data-view="bills"]');
      await pause(350);
      await page.click('.nav-btn[data-view="bills"]');
      await unhighlight();
      await pause(600);
      const openBtn = page.locator('tr[data-open-student]', { hasText: 'Test Student 10' }).locator('button:has-text("Open")');
      await highlight(openBtn);
      await pause(350);
      await openBtn.click();
      await unhighlight();
    }, 700, 1600);

    await step('Real programs, filled out with practice paperwork — every answer is checked against their real records.', async () => {
      await highlight('.bills2-tab[data-tab="assistance"]');
      await pause(350);
      await page.click('.bills2-tab[data-tab="assistance"]');
      await pause(500);
      await highlight('.bills2-programs', { pad: 4 });
    }, 500, 5200);

    await step("Housing has the shortest form — start there.", async () => {
      const btn = page.locator('[data-open-app="housing"]');
      await highlight(btn);
      await pause(350);
      await btn.click();
      await pause(700);
    }, 600, 1400);

    await step('It tells you exactly what to put — initials for your name, your grade for a birthdate, your lunch number for a Social Security number.', async () => {
      await highlight('.gov-rules', { pad: 4 });
    }, 400, 5600);

    await step("Sensitive real-world questions just say so, instead of asking for them.", async () => {
      const cell = page.locator('.gov-cell.is-disabled').first();
      await cell.scrollIntoViewIfNeeded();
      await highlight(cell, { pad: 4 });
    }, 400, 4600);

    await step('Fill in your identity fields...', async () => {
      const full_name = page.locator('input[name="gov-full_name"]');
      await full_name.scrollIntoViewIfNeeded();
      await highlight(full_name);
      await fillText('full_name', CORRECT.full_name);
      await pause(300);
      await fillText('street', CORRECT.street);
      await fillText('city', CORRECT.city);
      await fillText('state', CORRECT.state);
      await fillText('zip', CORRECT.zip);
      await checkRadio('adult', 'yes');
      await checkRadio('english', 'yes');
      await checkRadio('county_school_work', 'yes');
      await checkRadio('county_reside', 'yes');
      await checkRadio('veteran', 'no');
    }, 500, 2400);

    await step("...pick the program you're waiting for...", async () => {
      const el = page.locator('input[name="gov-waitlists"][value="section8"]');
      await el.scrollIntoViewIfNeeded();
      await highlight(el);
      await checkBox('waitlists', 'section8');
    }, 400, 1800);

    await step("...and answer the rest the same way, using your own real pay and bills.", async () => {
      await fillText('member_name', CORRECT.member_name);
      await fillText('member_ssn', CORRECT.member_ssn);
      await fillText('member_dob', CORRECT.member_dob);
      await fillText('income_name', CORRECT.income_name);
      await fillText('wages_annual', CORRECT.wages_annual);
      await checkRadio('worked_20', 'yes');
      await fillText('worked_who', CORRECT.worked_who);
      await fillText('landlord', CORRECT.landlord);
      await fillText('printed_name', CORRECT.printed_name);
      await fillText('signature', CORRECT.signature);
      await fillText('date', todayMDY());
      const rentField = page.locator('input[name="gov-current_rent"]');
      await rentField.scrollIntoViewIfNeeded();
      await highlight(rentField, { pad: 4 });
      await fillText('current_rent', WRONG_RENT);
    }, 500, 3600);

    await step("Submit grades it instantly — anything wrong gets outlined, with no answer key given.", async () => {
      await page.click('[data-submit-app]');
      await pause(900);
      const wrongCell = page.locator('.gov-cell.is-wrong').first();
      await wrongCell.scrollIntoViewIfNeeded();
      await highlight(wrongCell, { pad: 6 });
    }, 400, 5600);

    await step('Fix it and resubmit...', async () => {
      const rentField = page.locator('input[name="gov-current_rent"]');
      await rentField.scrollIntoViewIfNeeded();
      await highlight(rentField, { pad: 4 });
      await fillText('current_rent', CORRECT.current_rent);
      await pause(400);
      await unhighlight();
      await page.click('[data-submit-app]');
      await pause(900);
    }, 700, 1600);

    await step("...and once every answer matches your real records, it's approved — with the exact week their bill drops.", async () => {
      await highlight('.gov-notice', { pad: 4 });
    }, 300, 5600);

  } finally {
    await pause(500);
    await context.close();
    const vp = await page.video().path().catch(() => null);
    console.log('VIDEO_PATH:', vp);
    await browser.close();
  }
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
