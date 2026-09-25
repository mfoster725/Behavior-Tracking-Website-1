const { chromium } = require('playwright');

function makeHelpers(page) {
  // Recording starts at the page's first navigation (the login goto), so this
  // doubles as a clock for reporting how far into the video each step lands —
  // handy for re-timing a narration script's ~Time column after edits that
  // change step durations (e.g. adding highlight lead-in time).
  const t0 = Date.now();
  const elapsed = () => ((Date.now() - t0) / 1000).toFixed(1);
  const mark = (label) => console.log(`MARK @ ${elapsed()}s: ${label}`);

  const initCaptions = () => {
    const div = document.createElement('div');
    div.id = '__cap';
    div.style.cssText = 'position: fixed; left: 0; right: 0; bottom: 0; z-index: 999999; ' +
      'background: rgba(17,17,17,0.92); color: #fff; font: 600 22px/1.4 -apple-system, Arial, sans-serif; ' +
      'padding: 16px 28px; pointer-events: none; min-height: 30px; box-shadow: 0 -2px 12px rgba(0,0,0,0.25);';
    div.textContent = '';
    document.documentElement.appendChild(div);
    window.__setCaption = (t) => { document.getElementById('__cap').textContent = t; };

    // Cursor dot that follows the real (Playwright-driven) mouse position, so
    // viewers can always see where the pointer is, plus a click ripple.
    const style = document.createElement('style');
    style.textContent =
      '@keyframes __clickRipple { to { width: 46px; height: 46px; margin: -23px 0 0 -23px; opacity: 0; } }' +
      '@keyframes __ringPulse { 0%, 100% { box-shadow: 0 0 0 0 rgba(255,90,30,0.55); } 50% { box-shadow: 0 0 0 8px rgba(255,90,30,0); } }';
    document.head.appendChild(style);

    const cursor = document.createElement('div');
    cursor.id = '__cursor';
    cursor.style.cssText = 'position: fixed; top: 0; left: 0; width: 26px; height: 26px; margin: -13px 0 0 -13px; ' +
      'border-radius: 50%; background: rgba(255,90,30,0.35); border: 2px solid #ff5a1e; ' +
      'box-shadow: 0 0 0 2px rgba(255,255,255,0.7); pointer-events: none; z-index: 1000000; ' +
      'transform: translate(-9999px, -9999px); transition: transform 60ms linear;';
    document.documentElement.appendChild(cursor);
    document.addEventListener('mousemove', (e) => {
      cursor.style.transform = 'translate(' + e.clientX + 'px, ' + e.clientY + 'px)';
    }, true);
    document.addEventListener('mousedown', (e) => {
      const ripple = document.createElement('div');
      ripple.style.cssText = 'position: fixed; top: ' + e.clientY + 'px; left: ' + e.clientX + 'px; ' +
        'width: 10px; height: 10px; margin: -5px 0 0 -5px; border-radius: 50%; border: 3px solid #ff5a1e; ' +
        'pointer-events: none; z-index: 999999; animation: __clickRipple 450ms ease-out forwards;';
      document.documentElement.appendChild(ripple);
      setTimeout(() => ripple.remove(), 500);
    }, true);

    // Highlight ring circled around whatever element is currently being talked about.
    const ring = document.createElement('div');
    ring.id = '__ring';
    ring.style.cssText = 'position: fixed; display: none; border: 4px solid #ff5a1e; border-radius: 12px; ' +
      'pointer-events: none; z-index: 999998; animation: __ringPulse 1100ms ease-in-out infinite; ' +
      'transition: top 250ms ease, left 250ms ease, width 250ms ease, height 250ms ease;';
    document.documentElement.appendChild(ring);
    window.__showHighlight = (rect) => {
      ring.style.display = 'block';
      ring.style.top = rect.y + 'px';
      ring.style.left = rect.x + 'px';
      ring.style.width = rect.width + 'px';
      ring.style.height = rect.height + 'px';
    };
    window.__hideHighlight = () => { ring.style.display = 'none'; };
  };
  const cap = async (text) => { await page.evaluate((t) => { if (window.__setCaption) window.__setCaption(t); }, text).catch(() => {}); };
  const pause = (ms) => page.waitForTimeout(ms);

  // Moves the real mouse to an element and circles it with a pulsing ring, so
  // the recording shows exactly what the narrator is talking about or about
  // to click. `target` is a selector string or a Locator; pass an array of
  // either to circle the union of several elements at once (e.g. a whole row
  // of cells, or "from this header down to that cell" to frame a column).
  const highlight = async (target, opts = {}) => {
    const pad = opts.pad != null ? opts.pad : 8;
    try {
      const targets = Array.isArray(target) ? target : [target];
      const locators = targets.map((t) => (typeof t === 'string' ? page.locator(t).first() : t));
      const boxes = [];
      for (const locator of locators) {
        const box = await locator.boundingBox();
        if (box) boxes.push(box);
      }
      if (!boxes.length) return null;
      const x0 = Math.min(...boxes.map((b) => b.x));
      const y0 = Math.min(...boxes.map((b) => b.y));
      const x1 = Math.max(...boxes.map((b) => b.x + b.width));
      const y1 = Math.max(...boxes.map((b) => b.y + b.height));
      const box = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
      // Land the real mouse on the first target specifically (not the union's
      // midpoint), so a multi-element highlight can't accidentally park the
      // cursor on some unrelated hoverable cell inside the group and pop its
      // tooltip mid-narration.
      const landing = boxes[0];
      await page.mouse.move(landing.x + landing.width / 2, landing.y + landing.height / 2, { steps: 20 });
      const rect = { x: box.x - pad, y: box.y - pad, width: box.width + pad * 2, height: box.height + pad * 2 };
      await page.evaluate((r) => { if (window.__showHighlight) window.__showHighlight(r); }, rect);
      return box;
    } catch (e) {
      console.log('  (highlight skipped) ' + e.message.split('\n')[0]);
      return null;
    }
  };
  const unhighlight = async () => {
    await page.evaluate(() => { if (window.__hideHighlight) window.__hideHighlight(); }).catch(() => {});
  };

  const step = async (label, fn, holdBefore = 1200, holdAfter = 1800) => {
    console.log(`STEP @ ${elapsed()}s:`, label);
    await unhighlight();
    await cap(label);
    await pause(holdBefore);
    try { await fn(); } catch (e) { console.log('  (non-fatal) ' + e.message.split('\n')[0]); }
    await pause(holdAfter);
  };
  return { initCaptions, cap, pause, step, highlight, unhighlight, mark };
}

async function login(page, username, password) {
  await page.goto('http://localhost:5050/login', { waitUntil: 'domcontentloaded' });
  await page.fill('#username', username);
  await page.fill('#password', password);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(1200);
}

module.exports = { chromium, makeHelpers, login };
