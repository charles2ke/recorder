const { test, expect } = require('@playwright/test');

// Fake SpeechRecognition so tests run without a microphone.
const mockSpeech = () => {
  class FakeRecognition {
    constructor() { window.__rec = this; this.started = false; }
    start() { this.started = true; setTimeout(() => this.onstart && this.onstart(), 0); }
    stop() { this.started = false; setTimeout(() => this.onend && this.onend(), 0); }
    abort() { this.stop(); }
  }
  window.SpeechRecognition = FakeRecognition;
  window.__emit = (results, resultIndex = 0) => {
    const list = results.map(([transcript, isFinal]) => {
      const r = [{ transcript }];
      r.isFinal = isFinal;
      return r;
    });
    window.__rec.onresult({ resultIndex, results: list });
  };
};

test('live transcribes interim and final speech', async ({ page }) => {
  await page.addInitScript(mockSpeech);
  await page.goto('/');
  await expect(page.locator('#placeholder')).toBeVisible();

  await page.click('#toggle');
  await expect(page.locator('#toggle')).toHaveText('Stop recording');
  await expect(page.locator('#status')).toHaveText('Listening…');

  await page.evaluate(() => window.__emit([['hello wor', false]]));
  await expect(page.locator('#interim')).toHaveText('hello wor');
  await expect(page.locator('#placeholder')).toBeHidden();
  await page.screenshot({ path: 'test-results/screenshots/interim.png' });

  await page.evaluate(() => window.__emit([['hello world', true], ['this is', false]]));
  await expect(page.locator('#final')).toHaveText('hello world');
  await expect(page.locator('#interim')).toHaveText(' this is');
  await expect(page.locator('#transcript')).toHaveText('hello world this is');
  await expect(page.locator('#announcements')).toHaveText('hello world');

  await page.evaluate(() => window.__emit([['hello world', true], ['this is live', true]], 1));
  await expect(page.locator('#final')).toHaveText('hello world this is live');
  await expect(page.locator('#announcements')).toHaveText('this is live');
  await page.screenshot({ path: 'test-results/screenshots/final.png' });

  await page.click('#toggle');
  await expect(page.locator('#toggle')).toHaveText('Start recording');
  await expect(page.locator('#status')).toHaveText('Idle');

  await page.click('#clear');
  await expect(page.locator('#final')).toHaveText('');
  await expect(page.locator('#placeholder')).toBeVisible();
});

test('restarts recognition after the browser ends it while recording', async ({ page }) => {
  await page.addInitScript(mockSpeech);
  await page.goto('/');
  await page.click('#toggle');
  await page.evaluate(() => { window.__rec.started = false; window.__rec.onend(); });
  expect(await page.evaluate(() => window.__rec.started)).toBe(true);
});

test('retains unchanged interim results and announces only new final results', async ({ page }) => {
  await page.addInitScript(mockSpeech);
  await page.goto('/');
  await page.click('#toggle');

  await page.evaluate(() => window.__emit([['unchanged ', false], ['changed ', false]], 1));
  await expect(page.locator('#interim')).toHaveText('unchanged changed ');

  await page.evaluate(() => window.__emit([['unchanged ', false], ['final phrase', true]], 1));
  await expect(page.locator('#final')).toHaveText('final phrase');
  await expect(page.locator('#interim')).toHaveText(' unchanged ');
  await expect(page.locator('#announcements')).toHaveText('final phrase');
});

test('ignores delayed events from stopped or replaced recognizers', async ({ page }) => {
  await page.addInitScript(mockSpeech);
  await page.goto('/');
  await page.evaluate(() => {
    document.querySelector('#toggle').click();
    window.__oldRec = window.__rec;
    document.querySelector('#toggle').click();
    window.__oldRec.onstart();
  });
  await expect(page.locator('#status')).toHaveText('Idle');

  await page.click('#toggle');
  await expect(page.locator('#status')).toHaveText('Listening…');
  await page.evaluate(() => {
    window.__emit([['current interim', false]]);
    window.__oldRec.onerror({ error: 'not-allowed' });
    window.__oldRec.onresult({ resultIndex: 0, results: [] });
    window.__oldRec.onend();
  });

  await expect(page.locator('#toggle')).toHaveText('Stop recording');
  await expect(page.locator('#status')).toHaveText('Listening…');
  await expect(page.locator('#interim')).toHaveText('current interim');
});

test('clears interim text when the recognition language changes', async ({ page }) => {
  await page.addInitScript(mockSpeech);
  await page.goto('/');
  await page.click('#toggle');
  await page.evaluate(() => window.__emit([['confirmed', true], ['old language', false]]));

  await page.selectOption('#language', 'es-ES');
  await expect(page.locator('#final')).toHaveText('confirmed');
  await expect(page.locator('#interim')).toHaveText('');
  await expect(page.locator('#transcript')).toHaveText('confirmed');
});

test('stops recording after a recognition error instead of retrying', async ({ page }) => {
  await page.addInitScript(mockSpeech);
  await page.goto('/');
  await page.click('#toggle');
  await expect(page.locator('#status')).toHaveText('Listening…');

  await page.evaluate(() => {
    window.__rec.onerror({ error: 'network' });
    window.__rec.started = false;
    window.__rec.onend();
  });

  await expect(page.locator('#toggle')).toHaveText('Start recording');
  await expect(page.locator('#status')).toHaveText('Error: network');
  expect(await page.evaluate(() => window.__rec.started)).toBe(false);
});

test('shows a notice when speech recognition is unsupported', async ({ page }) => {
  await page.addInitScript(() => {
    delete window.SpeechRecognition;
    delete window.webkitSpeechRecognition;
  });
  await page.goto('/');
  await expect(page.locator('#unsupported')).toBeVisible();
  await expect(page.locator('#toggle')).toBeDisabled();
  await page.screenshot({ path: 'test-results/screenshots/unsupported.png' });
});
