# recorder
Personal Thoughts Recorder

Speak into your microphone and watch your words get transcribed live in the browser.

## Features
- Live transcription with in-progress (interim) text shown in grey and finalized text in white
- Keeps listening through pauses (automatically restarts when the browser stops recognition)
- Language picker
- Copy, download as `.txt`, and clear the transcript

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

## Tests
```bash
npx playwright install chromium
npm test
```
Tests mock `SpeechRecognition`, so no microphone is needed. Screenshots are written to `test-results/screenshots/`.
