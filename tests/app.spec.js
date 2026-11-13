const fs = require('fs');
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

// Fake microphone and MediaRecorder; set window.__denyMic to simulate a blocked microphone.
const mockAudio = () => {
  navigator.mediaDevices.getUserMedia = async () => {
    if (window.__denyMic) throw new DOMException('Permission denied', 'NotAllowedError');
    return { getTracks: () => [{ stop() {} }] };
  };
  window.MediaRecorder = class extends EventTarget {
    constructor() { super(); this.state = 'inactive'; this.mimeType = 'audio/webm'; }
    start() { this.state = 'recording'; }
    stop() {
      this.state = 'inactive';
      setTimeout(() => {
        const data = new Event('dataavailable');
        data.data = new Blob(['fake audio'], { type: 'audio/webm' });
        this.dispatchEvent(data);
        this.dispatchEvent(new Event('stop'));
      }, 0);
    }
  };
};

// Starts recording, says one final phrase and stops again.
const record = async (page, transcript) => {
  await page.click('#toggle');
  await expect(page.locator('#status')).toHaveText('Listening…');
  await page.evaluate((text) => window.__emit([[text, true]]), transcript);
  await page.click('#toggle');
  await expect(page.locator('#toggle')).toHaveText('Start recording');
};

test('live transcribes interim and final speech', async ({ page }) => {
  await page.addInitScript(mockSpeech);
  await page.goto('/');
  await expect(page.locator('#placeholder')).toBeVisible();

  await page.click('#toggle');
  await expect(page.locator('#toggle')).toHaveText('Stop recording');
  await expect(page.locator('#status')).toHaveText('Listening…');

  await page.evaluate(() => window.__emit([['hello wor', false]]));
  await expect(page.locator('#interim')).toHaveText('Hello wor');
  await expect(page.locator('#placeholder')).toBeHidden();
  await page.screenshot({ path: 'test-results/screenshots/interim.png' });

  await page.evaluate(() => window.__emit([['hello world', true], ['this is', false]]));
  await expect(page.locator('#final')).toHaveText('Hello world');
  await expect(page.locator('#interim')).toHaveText(' this is');
  await expect(page.locator('#transcript')).toHaveText('Hello world this is');
  await expect(page.locator('#announcements')).toHaveText('Hello world');

  await page.evaluate(() => window.__emit([['hello world', true], ['this is live', true]], 1));
  await expect(page.locator('#final')).toHaveText('Hello world this is live');
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
  await expect(page.locator('#interim')).toHaveText('Unchanged changed');

  await page.evaluate(() => window.__emit([['unchanged ', false], ['final phrase', true]], 1));
  await expect(page.locator('#final')).toHaveText('Final phrase');
  await expect(page.locator('#interim')).toHaveText(' unchanged');
  await expect(page.locator('#announcements')).toHaveText('Final phrase');
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
  await expect(page.locator('#interim')).toHaveText('Current interim');
});

test('clears interim text when the recognition language changes', async ({ page }) => {
  await page.addInitScript(mockSpeech);
  await page.goto('/');
  await page.click('#toggle');
  await page.evaluate(() => window.__emit([['confirmed', true], ['old language', false]]));

  await page.selectOption('#language', 'es-ES');
  await expect(page.locator('#final')).toHaveText('Confirmed');
  await expect(page.locator('#interim')).toHaveText('');
  await expect(page.locator('#transcript')).toHaveText('Confirmed');
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
  await expect(page.locator('#options')).toBeHidden();

  await page.fill('#editor', 'Typed instead');
  await page.reload();
  await expect(page.locator('#editor')).toHaveValue('Typed instead');
  await page.screenshot({ path: 'test-results/screenshots/unsupported.png' });
});

test('formats spoken punctuation with voice commands', async ({ page }) => {
  await page.addInitScript(mockSpeech);
  await page.goto('/');
  await expect(page.locator('#voice-commands')).toBeChecked();

  await page.click('#toggle');
  await page.evaluate(() => window.__emit([
    ['hello comma world period new paragraph how are you question mark', true],
    ['the periodic table exclamation mark', false],
  ]));
  await expect(page.locator('#final')).toHaveJSProperty('textContent', 'Hello, world.\n\nHow are you?');
  await expect(page.locator('#interim')).toHaveText(' The periodic table!');
  await page.screenshot({ path: 'test-results/screenshots/voice-commands.png' });
  await page.click('#toggle');
  await expect(page.locator('#editor')).toHaveValue('Hello, world.\n\nHow are you?');

  await page.uncheck('#voice-commands');
  await record(page, 'comma stays');
  await expect(page.locator('#editor')).toHaveValue('Hello, world.\n\nHow are you? comma stays');

  await page.check('#voice-commands');
  await page.selectOption('#language', 'es-ES');
  await expect(page.locator('#voice-commands')).toBeDisabled();
  await expect(page.locator('#voice-commands')).not.toBeChecked();
  await expect(page.locator('#voice-commands-note')).toBeVisible();
});

test('autosaves an editable transcript and undoes clearing it', async ({ page }) => {
  await page.addInitScript(mockSpeech);
  await page.goto('/');
  for (const id of ['#copy', '#download', '#clear', '#new-note', '#delete-note']) {
    await expect(page.locator(id)).toBeDisabled();
  }

  await record(page, 'first thought');
  await expect(page.locator('#editor')).toHaveValue('First thought');
  await page.locator('#editor').focus();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' edited');
  await expect(page.locator('#note-stats')).toHaveText('3 words');

  await page.reload();
  await expect(page.locator('#editor')).toHaveValue('First thought edited');
  await expect(page.locator('#copy')).toBeEnabled();

  await page.click('#clear');
  await expect(page.locator('#editor')).toHaveValue('');
  await expect(page.locator('#editor')).toBeFocused();
  await expect(page.locator('#copy')).toBeDisabled();
  await expect(page.locator('#toast-message')).toHaveText('Transcript cleared.');
  await page.screenshot({ path: 'test-results/screenshots/undo-clear.png' });
  await page.click('#toast-action');
  await expect(page.locator('#toast')).toBeHidden();
  await expect(page.locator('#editor')).toHaveValue('First thought edited');
});

test('keeps notes that can be renamed, switched, exported and deleted', async ({ page }) => {
  await page.addInitScript(mockSpeech);
  await page.goto('/');
  const items = page.locator('.note-item');
  await expect(page.locator('#notes-empty')).toBeVisible();
  await expect(page.locator('#export-all')).toBeDisabled();

  await page.fill('#editor', 'Shopping list\nmilk and eggs');
  await expect(items).toHaveCount(1);
  await expect(items.locator('.note-title')).toHaveText('Shopping list');
  await expect(page.locator('#title')).toHaveAttribute('placeholder', 'Shopping list');

  await page.click('#new-note');
  await expect(page.locator('#editor')).toHaveValue('');
  await expect(page.locator('#editor')).toBeFocused();
  await page.click('#toggle');
  await page.evaluate(() => window.__emit([['call the bank', true]]));
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toHaveAttribute('aria-current', 'true');
  await expect(items.nth(1)).toBeDisabled();
  await expect(page.locator('#new-note')).toBeDisabled();
  await page.click('#toggle');
  await expect(items.nth(1)).toBeEnabled();

  await page.fill('#title', 'Errands');
  await expect(items.nth(0).locator('.note-title')).toHaveText('Errands');
  await page.screenshot({ path: 'test-results/screenshots/notes.png', fullPage: true });

  await page.reload();
  await expect(page.locator('#title')).toHaveValue('Errands');
  await expect(page.locator('#editor')).toHaveValue('Call the bank');
  await items.nth(1).click();
  await expect(page.locator('#editor')).toHaveValue('Shopping list\nmilk and eggs');
  await expect(items.nth(1)).toHaveAttribute('aria-current', 'true');

  const downloadPromise = page.waitForEvent('download');
  await page.click('#export-all');
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^recorder-notes-.+\.md$/);
  const markdown = fs.readFileSync(await download.path(), 'utf8');
  expect(markdown).toMatch(/^# Errands\n[\s\S]*\nCall the bank\n\n---\n\n# Shopping list\n[\s\S]*\nShopping list\nmilk and eggs\n$/);

  await page.click('#delete-note');
  await expect(items).toHaveCount(1);
  await expect(page.locator('#editor')).toHaveValue('');
  await expect(page.locator('#toast-message')).toHaveText('Note deleted.');
  await page.click('#toast-action');
  await expect(items).toHaveCount(2);
  await expect(page.locator('#editor')).toHaveValue('Shopping list\nmilk and eggs');
});

test('toggles recording with Ctrl+Enter', async ({ page }) => {
  await page.addInitScript(mockSpeech);
  await page.goto('/');
  await page.locator('#editor').focus();

  await page.keyboard.press('Control+Enter');
  await expect(page.locator('#toggle')).toHaveText('Stop recording');
  await expect(page.locator('#toggle')).toBeFocused();
  await page.keyboard.press('Control+Enter');
  await expect(page.locator('#toggle')).toHaveText('Start recording');
  await expect(page.locator('#editor')).toHaveValue('');
});

test('shows the recording time and word count', async ({ page }) => {
  await page.clock.install({ time: new Date('2025-01-01T10:00:00') });
  await page.addInitScript(mockSpeech);
  await page.goto('/');
  await page.clock.pauseAt(new Date('2025-01-01T10:05:00'));

  await page.click('#toggle');
  await page.clock.runFor(100);
  await expect(page.locator('#status')).toHaveText('Listening…');
  await expect(page.locator('#timer')).toHaveText('0:00');
  await page.clock.runFor(65000);
  await expect(page.locator('#timer')).toHaveText('1:05');
  await page.evaluate(() => window.__emit([['one two three', true]]));
  await expect(page.locator('#note-stats')).toHaveText('3 words');

  await page.click('#toggle');
  await expect(page.locator('#timer')).toBeHidden();
  await expect(page.locator('#note-stats')).toHaveText('3 words · 1:05 recorded');
});

test('saves audio clips that survive a reload and can be deleted', async ({ page }) => {
  await page.addInitScript(mockSpeech);
  await page.addInitScript(mockAudio);
  await page.goto('/');
  const clips = page.locator('#clips .clip');

  await page.check('#save-audio');
  await page.click('#toggle');
  await expect(page.locator('#save-audio')).toBeDisabled();
  await page.evaluate(() => window.__emit([['with audio', true]]));
  await page.click('#toggle');
  await expect(clips).toHaveCount(1);
  await expect(clips).toContainText('Audio 1');
  await page.screenshot({ path: 'test-results/screenshots/audio.png' });

  await page.reload();
  await expect(page.locator('#save-audio')).toBeChecked();
  await expect(page.locator('.note-item .note-meta')).toContainText('1 audio clip');
  const link = page.getByRole('link', { name: 'Download audio 1' });
  await expect(link).toHaveAttribute('href', /^blob:/);
  const downloadPromise = page.waitForEvent('download');
  await link.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^recording-.+\.webm$/);
  expect(fs.readFileSync(await download.path(), 'utf8')).toBe('fake audio');

  await page.getByRole('button', { name: 'Delete audio 1' }).click();
  await expect(clips).toHaveCount(0);
  await page.click('#toast-action');
  await expect(clips).toHaveCount(1);

  await page.evaluate(() => { window.__denyMic = true; });
  await page.click('#toggle');
  await expect(page.locator('#toast-message')).toHaveText('Audio isn’t being saved: microphone access was denied. Transcription continues.');
  await expect(page.locator('#toggle')).toHaveText('Stop recording');
  await page.click('#toggle');
  await expect(clips).toHaveCount(1);
});

test.describe('in a French browser', () => {
  test.use({ locale: 'fr-FR' });

  test('starts in the browser language and remembers the chosen one', async ({ page }) => {
    await page.addInitScript(mockSpeech);
    await page.goto('/');
    await expect(page.locator('#language')).toHaveValue('fr-FR');
    await expect(page.locator('#voice-commands')).toBeDisabled();
    await expect(page.locator('#voice-commands-note')).toBeVisible();

    await page.selectOption('#language', 'en-GB');
    await page.reload();
    await expect(page.locator('#language')).toHaveValue('en-GB');
    await expect(page.locator('#voice-commands')).toBeChecked();
  });
});

test('warns when notes cannot be saved', async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => { throw new DOMException('Storage is full', 'QuotaExceededError'); };
  });
  await page.goto('/');
  await expect(page.locator('#storage-warning')).toBeHidden();
  await page.fill('#editor', 'Not saved');
  await expect(page.locator('#storage-warning')).toBeVisible();
});

test('keeps notes in sync across tabs', async ({ page, context }) => {
  await page.addInitScript(mockSpeech);
  await page.goto('/');
  await page.fill('#editor', 'Meeting notes');
  const other = await context.newPage();
  await other.addInitScript(mockSpeech);
  await other.goto('/');
  await expect(other.locator('#editor')).toHaveValue('Meeting notes');

  // Text recorded in one tab is not lost when the other tab is edited afterwards.
  await record(page, 'decision made');
  await expect(other.locator('#editor')).toHaveValue('Meeting notes decision made');
  await other.locator('#editor').press('Control+End');
  await other.keyboard.type('!');
  await expect(page.locator('#editor')).toHaveValue('Meeting notes decision made!');

  // A note being recorded is kept when another tab deletes it.
  await page.click('#toggle');
  await other.click('#delete-note');
  await expect(other.locator('.note-item')).toHaveCount(1);
  await page.evaluate(() => window.__emit([['still here', true]]));
  await page.click('#toggle');
  await expect(other.locator('.note-item .note-title')).toHaveText('Meeting notes decision made! Still here');

  // The open note is closed when another tab deletes it.
  await other.locator('.note-item').click();
  await other.click('#delete-note');
  await expect(page.locator('#toast-message')).toHaveText('This note was deleted in another tab.');
  await expect(page.locator('#editor')).toHaveValue('');
  await expect(page.locator('.note-item')).toHaveCount(0);
});

test('shows saved values instead of stale form values after going back to the page', async ({ page, context }) => {
  await page.addInitScript(mockSpeech);
  await page.addInitScript(() => window.addEventListener('pageshow', () => { window.__shown = true; }));
  await page.goto('/');
  await page.fill('#editor', 'first');
  await page.selectOption('#language', 'en-GB');
  await page.uncheck('#voice-commands');
  await page.check('#save-audio');
  await page.goto('about:blank');

  const other = await context.newPage();
  await other.addInitScript(mockSpeech);
  await other.goto('/');
  await other.locator('#editor').press('Control+End');
  await other.keyboard.type(' second');
  await other.selectOption('#language', 'en-US');
  await other.check('#voice-commands');
  await other.uncheck('#save-audio');

  // Browsers may refill form fields with the values they had when the page was left.
  await page.goBack();
  await page.waitForFunction(() => window.__shown);
  await expect(page.locator('#editor')).toHaveValue('first second');
  await expect(page.locator('#language')).toHaveValue('en-US');
  await expect(page.locator('#voice-commands')).toBeChecked();
  await expect(page.locator('#save-audio')).not.toBeChecked();
});

test('keeps deleted audio while the deletion can still be undone', async ({ page, context }) => {
  await page.addInitScript(mockSpeech);
  await page.addInitScript(mockAudio);
  await page.goto('/');
  const clipIds = (target) => target.evaluate(() => window.RecorderStorage.listClipIds());

  await page.check('#save-audio');
  await record(page, 'with audio');
  await expect.poll(() => clipIds(page)).toHaveLength(1);
  await page.uncheck('#save-audio');
  await page.evaluate(() => window.RecorderStorage.putClip('orphan', new Blob(['unused'])));

  // The note is deleted in another tab while still being recorded into here, so it is kept; then it is deleted again.
  const other = await context.newPage();
  await other.goto('/');
  await page.click('#toggle');
  await other.click('#delete-note');
  await expect(other.locator('.note-item')).toHaveCount(1);
  await page.click('#toggle');
  await other.locator('.note-item').click();
  await other.click('#delete-note');

  // Neither the end of the first deletion nor a new tab removing unused audio may remove audio the second can restore.
  const third = await context.newPage();
  await third.goto('/');
  await expect.poll(() => clipIds(third)).not.toContain('orphan');
  await other.click('#toast-action');
  await expect(other.getByRole('link', { name: 'Download audio 1' })).toHaveAttribute('href', /^blob:/);
});
