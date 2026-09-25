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
    await cap('Schedules: Teacher & Student Setup');
    mark('Schedules: Teacher & Student Setup');
    await pause(4200);

    await step('Open the menu, and select Schedules.', async () => {
      await highlight('#nav-hamburger');
      await pause(350);
      await page.click('#nav-hamburger');
      await pause(300);
      await highlight('.nav-btn[data-view="schedules"]');
      await pause(350);
      await page.click('.nav-btn[data-view="schedules"]');
      await unhighlight();
    }, 800, 2200);

    await step('A teacher’s schedule sits next to a student’s, so you can line them up side by side.', async () => {
      await highlight(['#teacher-schedule-container', '#student-schedule-container'], { pad: 4 });
    }, 500, 4600);

    await step('Pick a staff member here to view their schedule.', async () => {
      await highlight('#teacher-schedule-staff-search');
      await pause(400);
      await page.selectOption('#teacher-schedule-staff-search', { label: 'Staff Member 10' });
      await pause(500);
      await unhighlight();
    }, 800, 3400);

    await step('And pick a student here to view theirs.', async () => {
      await highlight('#schedule-student-select');
      await pause(400);
      await page.selectOption('#schedule-student-select', { label: 'Test Student 10' });
      await pause(500);
      await unhighlight();
    }, 800, 3600);

    await step('Add Time Period opens a new row — type the time range first.', async () => {
      await page.click('#add-student-period-btn');
      const rows = page.locator('#student-schedule-body tr');
      const lastRow = rows.last();
      await lastRow.scrollIntoViewIfNeeded();
      const timeInput = lastRow.locator('.time-input');
      await highlight(timeInput);
      await timeInput.click();
      await timeInput.fill('2:45-3:00');
      await unhighlight();
    }, 800, 3200);

    await step('Then use its menu to add the class and staff for that period.', async () => {
      const rows = page.locator('#student-schedule-body tr');
      const lastRow = rows.last();
      const kebab = lastRow.locator('.schedule-entry-kebab-btn');
      await highlight(kebab);
      await kebab.click();
      await pause(250);
      await lastRow.locator('.schedule-entry-add-btn').click();
      await unhighlight();
    }, 800, 2600);

    await step('Name the class or activity, and who’s running it.', async () => {
      await highlight('.schedule-entry-modal-class-input');
      await page.fill('.schedule-entry-modal-class-input', 'Study Hall');
      await pause(400);
      await highlight('.schedule-entry-modal-staff-input');
      await pause(400);
      await unhighlight();
    }, 800, 4200);

    await step('Save adds it to the table — then Save Student Schedule makes it official.', async () => {
      await highlight('#schedule-entry-modal-save');
      await pause(350);
      await page.click('#schedule-entry-modal-save');
      await pause(400);
      const saveBtn = page.locator('#save-student-schedule-btn');
      await saveBtn.scrollIntoViewIfNeeded();
      await highlight(saveBtn);
      await pause(350);
      await saveBtn.click();
      await unhighlight();
    }, 800, 4400);

    await step('Transition moves a student to a new schedule when they change grades or programs.', async () => {
      const transitionBtn = page.locator('#student-transition-btn');
      await transitionBtn.scrollIntoViewIfNeeded();
      await highlight(transitionBtn);
    }, 800, 4200);

    await step('Export prints a schedule, or a class list, or saves it as a CSV — for one student, everyone you manage, or the whole school.', async () => {
      const exportBtn = page.locator('#print-student-schedule-menu-btn');
      await exportBtn.scrollIntoViewIfNeeded();
      await highlight(exportBtn);
      await pause(350);
      await exportBtn.click();
      await pause(600);
    }, 800, 5600);

  } finally {
    await page.keyboard.press('Escape').catch(() => {});
    await pause(500);
    await context.close();
    const vp = await page.video().path().catch(() => null);
    console.log('VIDEO_PATH:', vp);
    await browser.close();
  }
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
