const { chromium } = require('playwright');

function makeHelpers(page) {
  const initCaptions = () => {
    const div = document.createElement('div');
    div.id = '__cap';
    div.style.cssText = 'position: fixed; left: 0; right: 0; bottom: 0; z-index: 999999; ' +
      'background: rgba(17,17,17,0.92); color: #fff; font: 600 22px/1.4 -apple-system, Arial, sans-serif; ' +
      'padding: 16px 28px; pointer-events: none; min-height: 30px; box-shadow: 0 -2px 12px rgba(0,0,0,0.25);';
    div.textContent = '';
    document.documentElement.appendChild(div);
    window.__setCaption = (t) => { document.getElementById('__cap').textContent = t; };
  };
  const cap = async (text) => { await page.evaluate((t) => { if (window.__setCaption) window.__setCaption(t); }, text).catch(() => {}); };
  const pause = (ms) => page.waitForTimeout(ms);
  const step = async (label, fn, holdBefore = 1200, holdAfter = 1800) => {
    console.log('STEP:', label);
    await cap(label);
    await pause(holdBefore);
    try { await fn(); } catch (e) { console.log('  (non-fatal) ' + e.message.split('\n')[0]); }
    await pause(holdAfter);
  };
  return { initCaptions, cap, pause, step };
}

async function login(page, username, password) {
  await page.goto('http://localhost:5050/login', { waitUntil: 'domcontentloaded' });
  await page.fill('#username', username);
  await page.fill('#password', password);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(1200);
}

module.exports = { chromium, makeHelpers, login };
