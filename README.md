# recorder
Personal Thoughts Recorder

Speak into your microphone and watch your words get transcribed live in the browser.

## Features
- Live transcription with in-progress (interim) text shown in grey and finalized text in white
- Keeps listening through pauses (automatically restarts when the browser stops recognition)
- Language picker that starts in your browser's language and remembers your choice
- Voice commands (English): say “comma”, “period”, “question mark”, “new line”, “new paragraph” and more;
  new sentences are capitalized automatically. Can be turned off.
- Editable transcript: fix mistakes or type notes when you are not recording
- Saved notes: everything is saved in your browser as you go and stays in sync across open tabs.
  Create, rename, switch between and delete notes, and export them all as Markdown
- Optional audio: tick **Save audio** to keep a recording of each session next to its note,
  with playback and download
- Recording timer, word count, and <kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>Enter</kbd> to start or stop
- Copy, download as `.txt`, and clear the transcript (with undo)

Notes and audio never leave your device: notes are kept in `localStorage` and audio in IndexedDB.
Clearing site data removes them, so export anything you want to keep.

## Usage
```bash
npm install
npm start          # serves the app at http://localhost:4173
```
Open http://localhost:4173, click **Start recording**, and allow microphone access.

Transcription uses the browser's built-in [Web Speech API](https://developer.mozilla.org/docs/Web/API/SpeechRecognition),
so it works in Chrome, Edge and Safari (Firefox is not supported). In Chrome, audio is sent to Google's
speech service for recognition, so an internet connection is required. The page must be served from
`localhost` or over HTTPS for microphone access.

## Live demo
The app is published to GitHub Pages at https://charles2ke.github.io/recorder/ by the
`Deploy to GitHub Pages` workflow (`.github/workflows/pages.yml`) on every push to `main`.
GitHub Pages must be enabled once by a repository admin before the workflow can deploy
(the workflow's `GITHUB_TOKEN` cannot create the Pages site): set
**Settings → Pages → Build and deployment → Source** to **GitHub Actions**, then re-run the workflow.

## Tests
```bash
npx playwright install chromium
npm test
```
Tests mock `SpeechRecognition` (and the microphone and `MediaRecorder` for audio), so no microphone is needed.
Screenshots are written to `test-results/screenshots/`.
