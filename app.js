(function () {
  'use strict';

  const T = window.RecorderText;
  const store = window.RecorderStorage;
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const canRecordAudio = Boolean(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
  const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  // Deleted audio is kept at least this long, even if another tab starts and removes unused audio meanwhile.
  // It is far longer than the undo message, which stays open while hovered or focused.
  const UNDO_GRACE_MS = 60 * 60 * 1000;

  const toggleBtn = document.getElementById('toggle');
  const languageSelect = document.getElementById('language');
  const statusEl = document.getElementById('status');
  const timerEl = document.getElementById('timer');
  const commandsInput = document.getElementById('voice-commands');
  const commandsNote = document.getElementById('voice-commands-note');
  const audioInput = document.getElementById('save-audio');
  const audioOption = document.getElementById('save-audio-option');
  const shortcutEl = document.getElementById('shortcut');
  const storageWarningEl = document.getElementById('storage-warning');
  const titleInput = document.getElementById('title');
  const newNoteBtn = document.getElementById('new-note');
  const transcriptEl = document.getElementById('transcript');
  const finalEl = document.getElementById('final');
  const interimEl = document.getElementById('interim');
  const editorEl = document.getElementById('editor');
  const placeholderEl = document.getElementById('placeholder');
  const statsEl = document.getElementById('note-stats');
  const announcementsEl = document.getElementById('announcements');
  const clipsEl = document.getElementById('clips');
  const copyBtn = document.getElementById('copy');
  const downloadBtn = document.getElementById('download');
  const clearBtn = document.getElementById('clear');
  const deleteNoteBtn = document.getElementById('delete-note');
  const notesListEl = document.getElementById('notes-list');
  const notesCountEl = document.getElementById('notes-count');
  const notesEmptyEl = document.getElementById('notes-empty');
  const exportAllBtn = document.getElementById('export-all');
  const toastEl = document.getElementById('toast');
  const toastMessageEl = document.getElementById('toast-message');
  const toastActionBtn = document.getElementById('toast-action');

  const settings = Object.assign({ lang: '', voiceCommands: true, saveAudio: false }, store.loadSettings());
  // Audio recorded in this tab that has not been written to IndexedDB (yet).
  const sessionBlobs = new Map();
  const pendingAudioByNote = new Map();
  const notes = new Map(store.loadNotes().map(function (note) { return [note.id, note]; }));
  let currentId = null;
  let recognition = null;
  // The active recording: { noteId, startedAt, timer, audio }.
  let session = null;
  let liveInterim = '';
  let toast = null;
  let renderedClipsKey = '';
  let clipUrls = [];

  // ---- Notes ----

  function newId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  function createNote() {
    const note = { id: newId(), title: '', text: '', createdAt: 0, updatedAt: 0, duration: 0, clips: [] };
    notes.set(note.id, note);
    return note;
  }

  function currentNote() {
    return notes.get(currentId);
  }

  function selectNote(id) {
    currentId = id;
    store.setCurrentId(id);
  }

  function isEmpty(note) {
    return !note.text.trim() && !note.title.trim() && note.clips.length === 0;
  }

  function savedNotes() {
    return Array.from(notes.values())
      .filter(function (note) { return !isEmpty(note); })
      .sort(function (a, b) { return b.createdAt - a.createdAt; });
  }

  // Empty notes are not stored, so a new note only shows up in the list once it has content.
  function persist(note) {
    let saved;
    if (isEmpty(note)) {
      saved = store.removeNote(note.id);
    } else {
      if (!note.createdAt) note.createdAt = Date.now();
      saved = store.saveNote(note);
    }
    if (!saved) storageWarningEl.hidden = false;
  }

  function touch(note) {
    note.updatedAt = Date.now();
    persist(note);
  }

  function saveSettings() {
    if (!store.saveSettings(settings)) storageWarningEl.hidden = false;
  }

  function speechOptions() {
    return { voiceCommands: settings.voiceCommands && T.supportsVoiceCommands(languageSelect.value) };
  }

  function formatDate(ms) {
    return dateFormat.format(new Date(ms));
  }

  function fileStamp(ms) {
    return new Date(ms || Date.now()).toISOString().replace(/[:.]/g, '-');
  }

  function downloadFile(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  // ---- Rendering ----

  function setStatus(text, live) {
    statusEl.textContent = text;
    statusEl.classList.toggle('live', Boolean(live));
  }

  // While recording, a read-only live view shows interim text; otherwise the transcript is an editable textarea.
  function renderTranscript() {
    const note = currentNote();
    const live = Boolean(session);
    const wasLive = !transcriptEl.hidden;
    const editorHadFocus = document.activeElement === editorEl;
    const interim = live ? T.speechSuffix(note.text, liveInterim, speechOptions()) : '';

    finalEl.textContent = note.text;
    interimEl.textContent = interim;
    transcriptEl.hidden = !live;
    editorEl.hidden = live;
    if (editorEl.value !== note.text) setEditorValue(note.text);
    placeholderEl.hidden = Boolean(note.text || interim);

    if (live) {
      transcriptEl.scrollTop = transcriptEl.scrollHeight;
      if (editorHadFocus) toggleBtn.focus();
    } else if (wasLive) {
      editorEl.scrollTop = editorEl.scrollHeight;
    }
  }

  // Keeps the caret in place when text changes underneath it (e.g. results arriving after stopping).
  function setEditorValue(text) {
    const focused = document.activeElement === editorEl;
    const start = editorEl.selectionStart;
    const end = editorEl.selectionEnd;
    editorEl.value = text;
    if (focused) editorEl.setSelectionRange(Math.min(start, text.length), Math.min(end, text.length));
  }

  function renderTitle() {
    const note = currentNote();
    if (titleInput.value !== note.title) titleInput.value = note.title;
    titleInput.placeholder = T.summarize(note.text) || 'Untitled note';
  }

  function renderStats() {
    const note = currentNote();
    const parts = [T.pluralize(T.countWords(note.text), 'word')];
    if (note.duration >= 1000) parts.push(T.formatDuration(note.duration) + ' recorded');
    statsEl.textContent = parts.join(' · ');
  }

  function renderTimer() {
    timerEl.hidden = !session;
    if (session) timerEl.textContent = T.formatDuration(Date.now() - session.startedAt);
  }

  function renderControls() {
    const recording = Boolean(session);
    const note = currentNote();
    const hasText = Boolean(note.text.trim());
    const commandsAvailable = Boolean(SpeechRecognition) && T.supportsVoiceCommands(languageSelect.value);

    toggleBtn.textContent = recording ? 'Stop recording' : 'Start recording';
    toggleBtn.classList.toggle('recording', recording);
    copyBtn.disabled = !hasText;
    downloadBtn.disabled = !hasText;
    clearBtn.disabled = !note.text;
    newNoteBtn.disabled = recording || isEmpty(note);
    deleteNoteBtn.disabled = recording || pendingAudioByNote.has(currentId) || isEmpty(note);
    commandsInput.disabled = !commandsAvailable;
    commandsInput.checked = commandsAvailable && settings.voiceCommands;
    commandsNote.hidden = !SpeechRecognition || commandsAvailable;
    audioInput.disabled = recording || !SpeechRecognition || !canRecordAudio;
    audioOption.title = !canRecordAudio
      ? 'Audio recording is not supported in this browser.'
      : recording ? 'Stop recording to change this.' : '';
  }

  function describeNote(note) {
    const parts = [formatDate(note.createdAt), T.pluralize(T.countWords(note.text), 'word')];
    if (note.duration >= 1000) parts.push(T.formatDuration(note.duration));
    if (note.clips.length) parts.push(T.pluralize(note.clips.length, 'audio clip'));
    return parts.join(' · ');
  }

  function renderNotesList() {
    const list = savedNotes();
    const focused = document.activeElement;
    const focusedId = focused && focused.classList && focused.classList.contains('note-item') ? focused.dataset.id : null;

    notesCountEl.textContent = list.length ? '(' + list.length + ')' : '';
    notesEmptyEl.hidden = list.length > 0;
    exportAllBtn.disabled = list.length === 0;
    notesListEl.replaceChildren(...list.map(function (note) {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'note-item';
      button.dataset.id = note.id;
      if (note.id === currentId) button.setAttribute('aria-current', 'true');
      button.disabled = Boolean(session) && note.id !== currentId;
      const title = document.createElement('span');
      title.className = 'note-title';
      title.textContent = T.noteTitle(note);
      const meta = document.createElement('span');
      meta.className = 'note-meta';
      meta.textContent = describeNote(note);
      button.append(title, meta);
      item.append(button);
      return item;
    }));

    if (focusedId) {
      const button = noteItem(focusedId);
      if (button && !button.disabled) button.focus();
    }
  }

  function noteItem(id) {
    return notesListEl.querySelector('[data-id="' + CSS.escape(id) + '"]');
  }

  // Updates one entry in place, which is cheaper than rebuilding the list on every keystroke.
  function refreshNoteInList(note) {
    const button = noteItem(note.id);
    if (Boolean(button) === isEmpty(note)) {
      renderNotesList();
    } else if (button) {
      button.querySelector('.note-title').textContent = T.noteTitle(note);
      button.querySelector('.note-meta').textContent = describeNote(note);
    }
  }

  function audioExtension(type) {
    if (/ogg/i.test(type)) return '.ogg';
    if (/mp4|aac|m4a/i.test(type)) return '.m4a';
    if (/mpeg|mp3/i.test(type)) return '.mp3';
    if (/wav/i.test(type)) return '.wav';
    return '.webm';
  }

  function loadClip(id) {
    if (sessionBlobs.has(id)) return Promise.resolve(sessionBlobs.get(id));
    return store.getClip(id).catch(function () { return null; });
  }

  // Chrome's MediaRecorder writes WebM files without a duration, which breaks seeking.
  // Seeking far past the end once makes the browser work out the real duration.
  function fixUnknownDuration(audio) {
    audio.addEventListener('loadedmetadata', function () {
      if (audio.duration !== Infinity) return;
      audio.addEventListener('durationchange', function reset() {
        if (audio.duration === Infinity) return;
        audio.removeEventListener('durationchange', reset);
        audio.currentTime = 0;
      });
      audio.currentTime = 1e101;
    }, { once: true });
  }

  function renderClip(note, clip, index) {
    const name = 'Audio ' + (index + 1);
    const item = document.createElement('li');
    item.className = 'clip';
    const label = document.createElement('span');
    label.className = 'clip-label';
    label.textContent = name + ' · ' + T.formatDuration(clip.duration);
    const audio = document.createElement('audio');
    audio.controls = true;
    audio.preload = 'metadata';
    audio.setAttribute('aria-label', name);
    const link = document.createElement('a');
    link.className = 'button';
    link.textContent = 'Download';
    link.setAttribute('aria-label', 'Download ' + name.toLowerCase());
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = 'Delete';
    remove.setAttribute('aria-label', 'Delete ' + name.toLowerCase());
    remove.addEventListener('click', function () { deleteClip(note.id, clip.id); });
    item.append(label, audio, link, remove);

    loadClip(clip.id).then(function (blob) {
      if (!item.isConnected) return;
      if (!blob) {
        label.textContent += ' (audio unavailable)';
        audio.remove();
        link.remove();
        return;
      }
      const url = URL.createObjectURL(blob);
      clipUrls.push(url);
      fixUnknownDuration(audio);
      audio.src = url;
      link.href = url;
      link.download = 'recording-' + fileStamp(clip.createdAt) + audioExtension(blob.type || clip.mimeType);
    });
    return item;
  }

  function renderClips() {
    const note = currentNote();
    const key = note.id + ':' + note.clips.map(function (clip) { return clip.id; }).join(',');
    if (key === renderedClipsKey) return;
    renderedClipsKey = key;
    clipUrls.forEach(function (url) { URL.revokeObjectURL(url); });
    clipUrls = [];
    clipsEl.replaceChildren(...note.clips.map(function (clip, index) { return renderClip(note, clip, index); }));
    clipsEl.hidden = note.clips.length === 0;
  }

  function renderNote() {
    renderTranscript();
    renderTitle();
    renderStats();
    renderControls();
  }

  function renderAll() {
    renderNote();
    renderClips();
    renderTimer();
    renderNotesList();
  }

  // ---- Toast with optional undo ----

  function scheduleToastExpiry() {
    if (!toast) return;
    clearTimeout(toast.timer);
    if (toastEl.matches(':hover, :focus-within')) return;
    toast.timer = setTimeout(expireToast, toast.duration);
  }

  function closeToast() {
    const closed = toast;
    toast = null;
    if (closed) clearTimeout(closed.timer);
    toastEl.hidden = true;
    return closed;
  }

  function expireToast() {
    const expired = closeToast();
    if (expired && expired.onExpire) expired.onExpire();
  }

  function showToast(message, options) {
    const opts = options || {};
    expireToast();
    toastEl.hidden = false;
    toastMessageEl.textContent = message;
    toastActionBtn.hidden = !opts.action;
    toastActionBtn.textContent = opts.action || '';
    toast = { onAction: opts.onAction, onExpire: opts.onExpire, timer: 0, duration: opts.action ? 10000 : 6000 };
    scheduleToastExpiry();
  }

  toastActionBtn.addEventListener('click', function () {
    const active = closeToast();
    if (active && active.onAction) active.onAction();
  });
  toastEl.addEventListener('mouseenter', function () { if (toast) clearTimeout(toast.timer); });
  toastEl.addEventListener('focusin', function () { if (toast) clearTimeout(toast.timer); });
  toastEl.addEventListener('mouseleave', scheduleToastExpiry);
  toastEl.addEventListener('focusout', function () { setTimeout(scheduleToastExpiry, 0); });

  function focusTranscript() {
    (session ? toggleBtn : editorEl).focus();
  }

  // ---- Speech recognition ----

  function appendSpeech(noteId, transcript) {
    const note = notes.get(noteId);
    if (!note) return '';
    const addition = T.speechSuffix(note.text, transcript, speechOptions());
    if (!addition) return '';
    note.text += addition;
    touch(note);
    return addition;
  }

  function createRecognition(noteId) {
    const rec = new SpeechRecognition();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = languageSelect.value;

    rec.onstart = function () {
      if (recognition !== rec || !session) return;
      setStatus('Listening…', true);
    };

    // Results are bound to the note being recorded, so late results never land in another note.
    rec.onresult = function (event) {
      let interim = '';
      const added = [];
      if (recognition !== rec) return;
      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          if (i >= event.resultIndex) {
            const addition = appendSpeech(noteId, result[0].transcript).trim();
            if (addition) added.push(addition);
          }
        } else {
          interim += result[0].transcript;
        }
      }
      liveInterim = session ? interim : '';
      renderNote();
      if (added.length) {
        announcementsEl.textContent = added.join(' ');
        refreshNoteInList(notes.get(noteId));
      }
    };

    rec.onerror = function (event) {
      if (recognition !== rec) return;
      if (event.error === 'no-speech' || event.error === 'aborted') return;
      const denied = event.error === 'not-allowed' || event.error === 'service-not-allowed';
      endSession();
      setStatus(denied ? 'Microphone access was denied.' : 'Error: ' + event.error);
    };

    rec.onend = function () {
      if (recognition !== rec) return;
      liveInterim = '';
      renderNote();
      if (session) {
        // Browsers stop recognition after silence; restart to keep transcribing.
        try {
          rec.start();
          return;
        } catch (e) {
          endSession();
          setStatus('Recording stopped unexpectedly.');
        }
      }
      statusEl.classList.remove('live');
    };

    return rec;
  }

  function startRecognition() {
    setStatus('Starting…');
    recognition = createRecognition(session.noteId);
    try {
      recognition.start();
      return true;
    } catch (e) {
      endSession();
      setStatus('Could not start recording.');
      return false;
    }
  }

  function startRecording() {
    if (session || !SpeechRecognition) return;
    session = { noteId: currentId, startedAt: Date.now(), timer: 0, audio: null };
    liveInterim = '';
    if (!startRecognition()) return;
    if (settings.saveAudio && canRecordAudio) startAudioCapture(session);
    session.timer = setInterval(renderTimer, 250);
    renderAll();
  }

  // Ends the recording session (audio, timer, duration) without touching the recognizer.
  function endSession() {
    const ended = session;
    if (!ended) return;
    session = null;
    clearInterval(ended.timer);
    if (ended.audio) stopAudioCapture(ended.audio);
    const note = notes.get(ended.noteId);
    if (note) {
      note.duration += Date.now() - ended.startedAt;
      persist(note);
    }
    liveInterim = '';
    renderAll();
  }

  function stopRecording() {
    if (!session) return;
    const rec = recognition;
    endSession();
    if (rec) rec.stop();
    setStatus('Idle');
  }

  function toggleRecording() {
    if (session) stopRecording(); else startRecording();
  }

  // ---- Audio capture ----

  function stopTracks(stream) {
    stream.getTracks().forEach(function (track) { track.stop(); });
  }

  function describeMediaError(error) {
    const name = error && error.name;
    if (name === 'NotAllowedError' || name === 'SecurityError') return 'microphone access was denied';
    if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'no microphone was found';
    return 'the microphone could not be used';
  }

  function startAudioCapture(active) {
    const capture = { noteId: active.noteId, recorder: null, stream: null, chunks: [], startedAt: 0, stopped: false, finalized: false };
    pendingAudioByNote.set(capture.noteId, (pendingAudioByNote.get(capture.noteId) || 0) + 1);
    active.audio = capture;
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
      capture.stream = stream;
      if (capture.stopped) {
        stopTracks(stream);
        finishAudioCapture(capture);
        return;
      }
      const recorder = new MediaRecorder(stream);
      capture.recorder = recorder;
      recorder.addEventListener('dataavailable', function (event) {
        if (event.data && event.data.size) capture.chunks.push(event.data);
      });
      recorder.addEventListener('stop', function () {
        stopTracks(stream);
        try {
          saveClip(active.noteId, capture, recorder.mimeType);
        } finally {
          finishAudioCapture(capture);
        }
      });
      recorder.start();
      capture.startedAt = Date.now();
    }).catch(function (error) {
      if (capture.stream) stopTracks(capture.stream);
      if (active.audio === capture) active.audio = null;
      finishAudioCapture(capture);
      if (!capture.stopped) showToast('Audio isn’t being saved: ' + describeMediaError(error) + '. Transcription continues.');
    });
  }

  function finishAudioCapture(capture) {
    if (capture.finalized) return;
    capture.finalized = true;
    const pending = pendingAudioByNote.get(capture.noteId) || 0;
    if (pending <= 1) pendingAudioByNote.delete(capture.noteId);
    else pendingAudioByNote.set(capture.noteId, pending - 1);
    renderAll();
  }

  function stopAudioCapture(capture) {
    capture.stopped = true;
    if (capture.recorder && capture.recorder.state !== 'inactive') capture.recorder.stop();
    else if (capture.stream) stopTracks(capture.stream);
  }

  // The clip's metadata is saved before its audio, so startup cleanup never deletes audio that a note still uses.
  function saveClip(noteId, capture, mimeType) {
    const type = mimeType || (capture.chunks[0] && capture.chunks[0].type) || 'audio/webm';
    const blob = new Blob(capture.chunks, { type: type });
    const note = notes.get(noteId);
    capture.chunks = [];
    if (!blob.size || !note) return;
    const clip = { id: newId(), createdAt: capture.startedAt, duration: Date.now() - capture.startedAt, mimeType: type, size: blob.size };
    sessionBlobs.set(clip.id, blob);
    note.clips.push(clip);
    touch(note);
    renderAll();
    store.putClip(clip.id, blob).then(function () {
      sessionBlobs.delete(clip.id);
    }, function () {
      showToast('Audio couldn’t be stored in this browser. Download it before leaving the page.');
    });
  }

  function isUndoable(deletion) {
    return Math.abs(Date.now() - deletion.time) < UNDO_GRACE_MS;
  }

  // Audio to keep: used by a note here or in storage, or restorable by a deletion that can still be undone in any tab.
  function clipsToKeep() {
    const keep = new Set();
    function addNote(note) {
      note.clips.forEach(function (clip) { keep.add(clip.id); });
    }
    notes.forEach(addNote);
    store.loadNotes().forEach(addNote);
    store.loadDeletions().filter(isUndoable).forEach(function (deletion) {
      deletion.clips.forEach(function (id) { keep.add(id); });
    });
    return keep;
  }

  // A deletion is recorded before its clips leave their note and removed after an undo restores them,
  // so other tabs never see its audio as unused while it can still be restored.
  function startDeletion(clips) {
    const id = newId();
    if (clips.length) store.saveDeletion(id, clips.map(function (clip) { return clip.id; }));
    return id;
  }

  // Called once a deletion can no longer be undone.
  function finishDeletion(deletion, clips) {
    store.removeDeletion(deletion);
    if (!clips.length) return;
    const keep = clipsToKeep();
    clips.forEach(function (clip) {
      if (keep.has(clip.id)) return;
      sessionBlobs.delete(clip.id);
      store.deleteClip(clip.id).catch(function () {});
    });
  }

  function deleteClip(noteId, clipId) {
    const note = notes.get(noteId);
    const index = note ? note.clips.findIndex(function (clip) { return clip.id === clipId; }) : -1;
    if (index === -1) return;
    const clip = note.clips[index];
    const deletion = startDeletion([clip]);
    note.clips.splice(index, 1);
    touch(note);
    renderAll();
    focusTranscript();
    showToast('Audio deleted.', {
      action: 'Undo',
      onAction: function () {
        const target = notes.get(noteId);
        if (!target) {
          finishDeletion(deletion, [clip]);
          return;
        }
        if (!target.clips.some(function (other) { return other.id === clip.id; })) {
          target.clips.splice(Math.min(index, target.clips.length), 0, clip);
          touch(target);
        }
        store.removeDeletion(deletion);
        renderAll();
      },
      onExpire: function () { finishDeletion(deletion, [clip]); },
    });
  }

  // Removes audio nothing uses, e.g. left behind when a page closed while a deletion could still be undone.
  // Notes are read after listing clips: clip metadata is saved before its audio, so new clips are never removed.
  function removeOrphanClips() {
    store.loadDeletions().forEach(function (deletion) {
      if (!isUndoable(deletion)) store.removeDeletion(deletion.id);
    });
    store.listClipIds().then(function (ids) {
      const keep = clipsToKeep();
      ids.forEach(function (id) {
        if (!keep.has(id)) store.deleteClip(id).catch(function () {});
      });
    }).catch(function () {});
  }

  // ---- Setup ----

  function initialLanguage() {
    const available = Array.from(languageSelect.options, function (option) { return option.value; });
    if (available.indexOf(settings.lang) !== -1) return settings.lang;
    const preferred = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language];
    for (let i = 0; i < preferred.length; i++) {
      const wanted = String(preferred[i] || '').toLowerCase();
      if (!wanted) continue;
      const exact = available.find(function (value) { return value.toLowerCase() === wanted; });
      const primary = available.find(function (value) { return value.split('-')[0].toLowerCase() === wanted.split('-')[0]; });
      if (exact || primary) return exact || primary;
    }
    return languageSelect.value;
  }

  languageSelect.value = initialLanguage();
  audioInput.checked = Boolean(settings.saveAudio) && canRecordAudio;
  const platform = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '';
  if (/mac|iphone|ipad|ipod/i.test(platform)) shortcutEl.textContent = '⌘ + Enter';

  const savedId = store.getCurrentId();
  selectNote(savedId && notes.has(savedId) ? savedId : createNote().id);

  if (!SpeechRecognition) {
    document.getElementById('unsupported').hidden = false;
    document.getElementById('options').hidden = true;
    document.getElementById('help').hidden = true;
    toggleBtn.disabled = true;
    languageSelect.disabled = true;
    setStatus('Unavailable');
  }

  toggleBtn.addEventListener('click', toggleRecording);

  languageSelect.addEventListener('change', function () {
    settings.lang = languageSelect.value;
    saveSettings();
    if (session) {
      const old = recognition;
      recognition = null;
      if (old) {
        old.onend = null;
        old.abort();
      }
      liveInterim = '';
      startRecognition();
    }
    renderNote();
  });

  commandsInput.addEventListener('change', function () {
    settings.voiceCommands = commandsInput.checked;
    saveSettings();
    renderNote();
  });

  audioInput.addEventListener('change', function () {
    settings.saveAudio = audioInput.checked;
    saveSettings();
  });

  document.addEventListener('keydown', function (event) {
    if (event.key !== 'Enter' || !(event.ctrlKey || event.metaKey)) return;
    if (event.altKey || event.shiftKey || event.repeat || event.isComposing || toggleBtn.disabled) return;
    event.preventDefault();
    toggleRecording();
  });

  editorEl.addEventListener('input', function () {
    const note = currentNote();
    note.text = editorEl.value;
    touch(note);
    renderNote();
    refreshNoteInList(note);
  });

  titleInput.addEventListener('input', function () {
    const note = currentNote();
    note.title = titleInput.value;
    touch(note);
    renderControls();
    refreshNoteInList(note);
  });

  titleInput.addEventListener('change', function () {
    const note = currentNote();
    const title = titleInput.value.trim();
    if (title === note.title) return;
    note.title = title;
    touch(note);
    renderAll();
  });

  titleInput.addEventListener('keydown', function (event) {
    if (event.key === 'Enter' && !event.ctrlKey && !event.metaKey && !event.isComposing) titleInput.blur();
  });

  notesListEl.addEventListener('click', function (event) {
    const button = event.target.closest('.note-item');
    const id = button && button.dataset.id;
    if (session || !id || id === currentId || !notes.has(id)) return;
    selectNote(id);
    renderAll();
    editorEl.scrollTop = 0;
  });

  newNoteBtn.addEventListener('click', function () {
    if (session || isEmpty(currentNote())) return;
    selectNote(createNote().id);
    renderAll();
    editorEl.focus();
  });

  copyBtn.addEventListener('click', function () {
    const text = currentNote().text;
    if (!text.trim()) return;
    if (!navigator.clipboard) {
      setStatus('Copy failed', Boolean(session));
      return;
    }
    navigator.clipboard.writeText(text).then(
      function () { setStatus('Copied to clipboard', Boolean(session)); },
      function () { setStatus('Copy failed', Boolean(session)); }
    );
  });

  downloadBtn.addEventListener('click', function () {
    const note = currentNote();
    if (!note.text.trim()) return;
    const name = T.slugify(note.title) || 'transcript';
    downloadFile(new Blob([note.text], { type: 'text/plain;charset=utf-8' }), name + '-' + fileStamp() + '.txt');
  });

  clearBtn.addEventListener('click', function () {
    const note = currentNote();
    if (!note.text) return;
    const cleared = note.text;
    note.text = '';
    liveInterim = '';
    touch(note);
    renderAll();
    focusTranscript();
    showToast('Transcript cleared.', {
      action: 'Undo',
      onAction: function () {
        const target = notes.get(note.id);
        if (!target) return;
        target.text = T.joinText(cleared, target.text);
        touch(target);
        renderAll();
        if (target.id === currentId) focusTranscript();
      },
    });
  });

  deleteNoteBtn.addEventListener('click', function () {
    const note = currentNote();
    if (session || pendingAudioByNote.has(note.id) || isEmpty(note)) return;
    const deletion = startDeletion(note.clips);
    notes.delete(note.id);
    store.removeNote(note.id);
    selectNote(createNote().id);
    renderAll();
    editorEl.focus();
    showToast('Note deleted.', {
      action: 'Undo',
      onAction: function () {
        // Another tab may have restored it already, e.g. because it was still recording into it.
        if (!notes.has(note.id)) {
          notes.set(note.id, note);
          persist(note);
        }
        store.removeDeletion(deletion);
        if (!session) {
          const draft = currentNote();
          if (draft && isEmpty(draft)) notes.delete(draft.id);
          selectNote(note.id);
        }
        renderAll();
        if (!session) editorEl.focus();
      },
      onExpire: function () { finishDeletion(deletion, note.clips); },
    });
  });

  exportAllBtn.addEventListener('click', function () {
    const list = savedNotes();
    if (!list.length) return;
    const markdown = T.notesToMarkdown(list, formatDate);
    downloadFile(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }), 'recorder-notes-' + fileStamp() + '.md');
  });

  // Audio is only saved when a recording stops, so warn before leaving mid-recording.
  window.addEventListener('beforeunload', function (event) {
    if (!session || !session.audio) return;
    event.preventDefault();
    event.returnValue = '';
  });

  // ---- Other tabs ----

  // Applies another tab's change to a note. The most recently edited version wins, so edits here that could not
  // be saved are kept, and a note this tab is recording into or finalizing audio for is saved rather than dropped.
  function syncNote(id, stored) {
    const mine = notes.get(id);
    if (stored) {
      if (!mine || stored.updatedAt >= mine.updatedAt) notes.set(id, stored);
      return;
    }
    if (!mine || isEmpty(mine)) return;
    if ((session && session.noteId === id) || pendingAudioByNote.has(id)) {
      persist(mine);
      return;
    }
    notes.delete(id);
    if (id === currentId) {
      selectNote(createNote().id);
      showToast('This note was deleted in another tab.');
    }
  }

  function syncAllNotes() {
    const stored = new Map(store.loadNotes().map(function (note) { return [note.id, note]; }));
    new Set(Array.from(notes.keys()).concat(Array.from(stored.keys()))).forEach(function (id) {
      syncNote(id, stored.get(id) || null);
    });
  }

  window.addEventListener('storage', function (event) {
    if (event.key === null) {
      syncAllNotes();
    } else {
      const id = store.noteIdFromKey(event.key);
      if (!id) return;
      syncNote(id, store.loadNote(id));
    }
    renderAll();
  });

  // A page restored from the back/forward cache missed the changes other tabs made meanwhile.
  window.addEventListener('pageshow', function (event) {
    if (!event.persisted) return;
    syncAllNotes();
    renderAll();
  });

  renderAll();
  removeOrphanClips();
})();
