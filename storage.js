// Persistence: notes and settings in localStorage, audio clips in IndexedDB. Exposed as window.RecorderStorage.
(function (root) {
  'use strict';

  // Each note is stored under its own key so tabs editing different notes never overwrite each other.
  const NOTE_PREFIX = 'recorder.note.';
  const SETTINGS_KEY = 'recorder.settings';
  const CURRENT_KEY = 'recorder.current';
  // While a deletion can be undone, a record of the audio it may restore tells other tabs to keep that audio.
  const DELETION_PREFIX = 'recorder.deletion.';
  const DB_NAME = 'recorder';
  const CLIP_STORE = 'clips';

  function getStorage() {
    try {
      return root.localStorage || null;
    } catch (e) {
      return null;
    }
  }

  function read(key) {
    const storage = getStorage();
    if (!storage) return null;
    try {
      const raw = storage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function write(key, value) {
    const storage = getStorage();
    if (!storage) return false;
    try {
      storage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      return false;
    }
  }

  function remove(key) {
    const storage = getStorage();
    if (!storage) return false;
    try {
      storage.removeItem(key);
      return true;
    } catch (e) {
      return false;
    }
  }

  function toNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  function normalizeClip(raw) {
    if (!raw || typeof raw.id !== 'string') return null;
    return {
      id: raw.id,
      createdAt: toNumber(raw.createdAt),
      duration: toNumber(raw.duration),
      mimeType: typeof raw.mimeType === 'string' ? raw.mimeType : '',
      size: toNumber(raw.size),
    };
  }

  function normalizeNote(raw) {
    if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string') return null;
    return {
      id: raw.id,
      title: typeof raw.title === 'string' ? raw.title : '',
      text: typeof raw.text === 'string' ? raw.text.replace(/\r\n?/g, '\n') : '',
      createdAt: toNumber(raw.createdAt),
      updatedAt: toNumber(raw.updatedAt),
      duration: toNumber(raw.duration),
      clips: Array.isArray(raw.clips) ? raw.clips.map(normalizeClip).filter(Boolean) : [],
    };
  }

  function hasPrefix(key, prefix) {
    return typeof key === 'string' && key.length > prefix.length && key.indexOf(prefix) === 0;
  }

  function keysWithPrefix(prefix) {
    const storage = getStorage();
    const keys = [];
    try {
      for (let i = 0; storage && i < storage.length; i++) keys.push(storage.key(i));
    } catch (e) {
      return [];
    }
    return keys.filter(function (key) { return hasPrefix(key, prefix); });
  }

  // Returns the id of the note stored under a localStorage key, or null for other keys.
  function noteIdFromKey(key) {
    return hasPrefix(key, NOTE_PREFIX) ? key.slice(NOTE_PREFIX.length) : null;
  }

  function loadNote(id) {
    const note = normalizeNote(read(NOTE_PREFIX + id));
    return note && note.id === id ? note : null;
  }

  function loadNotes() {
    return keysWithPrefix(NOTE_PREFIX).map(noteIdFromKey).map(loadNote).filter(Boolean);
  }

  function saveNote(note) {
    return write(NOTE_PREFIX + note.id, note);
  }

  function removeNote(id) {
    return remove(NOTE_PREFIX + id);
  }

  function loadSettings() {
    const settings = read(SETTINGS_KEY);
    return settings && typeof settings === 'object' ? settings : {};
  }

  function saveSettings(settings) {
    return write(SETTINGS_KEY, settings);
  }

  function getCurrentId() {
    const id = read(CURRENT_KEY);
    return typeof id === 'string' ? id : null;
  }

  function setCurrentId(id) {
    return write(CURRENT_KEY, id);
  }

  function saveDeletion(id, clipIds) {
    return write(DELETION_PREFIX + id, { time: Date.now(), clips: clipIds });
  }

  function removeDeletion(id) {
    return remove(DELETION_PREFIX + id);
  }

  // Returns the recorded deletions as [{ id, time, clips }], where clips are clip ids.
  function loadDeletions() {
    return keysWithPrefix(DELETION_PREFIX).map(function (key) {
      const value = read(key) || {};
      return {
        id: key.slice(DELETION_PREFIX.length),
        time: toNumber(value.time),
        clips: Array.isArray(value.clips) ? value.clips.filter(function (id) { return typeof id === 'string'; }) : [],
      };
    });
  }

  let dbPromise = null;

  function openDb() {
    if (!dbPromise) {
      dbPromise = new Promise(function (resolve, reject) {
        if (!root.indexedDB) {
          reject(new Error('IndexedDB is unavailable'));
          return;
        }
        const request = root.indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = function () {
          request.result.createObjectStore(CLIP_STORE);
        };
        request.onsuccess = function () {
          const db = request.result;
          db.onversionchange = function () {
            db.close();
            dbPromise = null;
          };
          db.onclose = function () { dbPromise = null; };
          resolve(db);
        };
        request.onerror = function () { reject(request.error); };
      });
      dbPromise.catch(function () { dbPromise = null; });
    }
    return dbPromise;
  }

  function withClipStore(mode, operation) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        const transaction = db.transaction(CLIP_STORE, mode);
        const request = operation(transaction.objectStore(CLIP_STORE));
        transaction.oncomplete = function () { resolve(request.result); };
        transaction.onerror = transaction.onabort = function () {
          reject(transaction.error || request.error);
        };
      });
    });
  }

  function putClip(id, blob) {
    return withClipStore('readwrite', function (clips) { return clips.put(blob, id); }).then(function () {});
  }

  function getClip(id) {
    return withClipStore('readonly', function (clips) { return clips.get(id); }).then(function (blob) {
      return blob instanceof Blob ? blob : null;
    });
  }

  function deleteClip(id) {
    return withClipStore('readwrite', function (clips) { return clips.delete(id); }).then(function () {});
  }

  function listClipIds() {
    return withClipStore('readonly', function (clips) { return clips.getAllKeys(); });
  }

  root.RecorderStorage = {
    noteIdFromKey: noteIdFromKey,
    loadNote: loadNote,
    loadNotes: loadNotes,
    saveNote: saveNote,
    removeNote: removeNote,
    loadSettings: loadSettings,
    saveSettings: saveSettings,
    getCurrentId: getCurrentId,
    setCurrentId: setCurrentId,
    saveDeletion: saveDeletion,
    removeDeletion: removeDeletion,
    loadDeletions: loadDeletions,
    putClip: putClip,
    getClip: getClip,
    deleteClip: deleteClip,
    listClipIds: listClipIds,
  };
})(window);
