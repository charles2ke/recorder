(function () {
  'use strict';

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

  const toggleBtn = document.getElementById('toggle');
  const languageSelect = document.getElementById('language');
  const statusEl = document.getElementById('status');
  const finalEl = document.getElementById('final');
  const interimEl = document.getElementById('interim');
  const placeholderEl = document.getElementById('placeholder');
  const transcriptEl = document.getElementById('transcript');
  const copyBtn = document.getElementById('copy');
  const downloadBtn = document.getElementById('download');
  const clearBtn = document.getElementById('clear');

  let finalText = '';
  let recognition = null;
  let wantRecording = false;

  function setStatus(text, live) {
    statusEl.textContent = text;
    statusEl.classList.toggle('live', Boolean(live));
  }

  function render(interimText) {
    finalEl.textContent = finalText;
    interimEl.textContent = interimText || '';
    placeholderEl.hidden = Boolean(finalText || interimText);
    transcriptEl.scrollTop = transcriptEl.scrollHeight;
  }

  function appendFinal(text) {
    const trimmed = text.trim();
    if (!trimmed) return;
    finalText += (finalText && !/\s$/.test(finalText) ? ' ' : '') + trimmed;
  }

  function updateButton() {
    toggleBtn.textContent = wantRecording ? 'Stop recording' : 'Start recording';
    toggleBtn.classList.toggle('recording', wantRecording);
  }

  function createRecognition() {
    const rec = new SpeechRecognition();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = languageSelect.value;

    rec.onstart = function () {
      setStatus('Listening…', true);
    };

    rec.onresult = function (event) {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          appendFinal(result[0].transcript);
        } else {
          interim += result[0].transcript;
        }
      }
      render(interim);
    };

    rec.onerror = function (event) {
      if (event.error === 'no-speech' || event.error === 'aborted') return;
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        wantRecording = false;
        updateButton();
        setStatus('Microphone access was denied.');
        return;
      }
      wantRecording = false;
      updateButton();
      setStatus('Error: ' + event.error);
    };

    rec.onend = function () {
      render('');
      if (wantRecording && recognition === rec) {
        // Browsers stop recognition after silence; restart to keep transcribing.
        try {
          rec.start();
          return;
        } catch (e) {
          wantRecording = false;
          updateButton();
          setStatus('Recording stopped unexpectedly.');
        }
      }
      statusEl.classList.remove('live');
    };

    return rec;
  }

  function start() {
    wantRecording = true;
    updateButton();
    setStatus('Starting…');
    recognition = createRecognition();
    try {
      recognition.start();
    } catch (e) {
      wantRecording = false;
      updateButton();
      setStatus('Could not start recording.');
    }
  }

  function stop() {
    wantRecording = false;
    updateButton();
    if (recognition) recognition.stop();
    setStatus('Idle');
  }

  if (!SpeechRecognition) {
    document.getElementById('unsupported').hidden = false;
    toggleBtn.disabled = true;
    languageSelect.disabled = true;
    setStatus('Unavailable');
  } else {
    toggleBtn.addEventListener('click', function () {
      if (wantRecording) stop(); else start();
    });

    languageSelect.addEventListener('change', function () {
      if (!wantRecording) return;
      const old = recognition;
      recognition = null;
      old.onend = null;
      old.abort();
      start();
    });
  }

  copyBtn.addEventListener('click', function () {
    if (!finalText) return;
    navigator.clipboard.writeText(finalText).then(
      function () { setStatus('Copied to clipboard', wantRecording); },
      function () { setStatus('Copy failed', wantRecording); }
    );
  });

  downloadBtn.addEventListener('click', function () {
    if (!finalText) return;
    const blob = new Blob([finalText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'transcript-' + new Date().toISOString().replace(/[:.]/g, '-') + '.txt';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });

  clearBtn.addEventListener('click', function () {
    finalText = '';
    render('');
  });

  render('');
})();
