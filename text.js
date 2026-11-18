// Pure text helpers. Exposed as window.RecorderText in the browser and via require() in Node tests.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RecorderText = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Spoken (English) commands and the text they produce.
  const VOICE_COMMANDS = {
    'new paragraph': '\n\n',
    'new line': '\n',
    'period': '.',
    'full stop': '.',
    'comma': ',',
    'question mark': '?',
    'exclamation mark': '!',
    'exclamation point': '!',
    'semicolon': ';',
    'colon': ':',
  };
  const COMMAND_PATTERN = new RegExp(
    '[ \\t]*\\b(' + Object.keys(VOICE_COMMANDS).map(function (phrase) {
      return phrase.replace(' ', '\\s+');
    }).join('|') + ')\\b[ \\t]*',
    'gi'
  );
  const LETTER = /\p{L}/u;
  const WORD_CHAR = /[\p{L}\p{N}]/u;

  function supportsVoiceCommands(lang) {
    return /^en(-|$)/i.test(lang || '');
  }

  function applyVoiceCommands(text) {
    return String(text || '')
      .replace(COMMAND_PATTERN, function (match, phrase) {
        const output = VOICE_COMMANDS[phrase.toLowerCase().replace(/\s+/g, ' ')];
        return output.charAt(0) === '\n' ? output : output + ' ';
      })
      .replace(/[ \t]+(?=[.,;:?!])/g, '')
      .replace(/[ \t]*\n[ \t]*/g, '\n')
      .replace(/[ \t]{2,}/g, ' ');
  }

  // Tracks whether the next letter starts a sentence: 'start', 'end' (just after . ? !) or 'mid'.
  function nextSentenceState(state, ch) {
    if (ch === '\n') return 'start';
    if (ch === '.' || ch === '?' || ch === '!') return 'end';
    if (ch === ' ' || ch === '\t') return state === 'end' ? 'start' : state;
    if (WORD_CHAR.test(ch)) return 'mid';
    return state;
  }

  // Capitalizes sentence starts in `text`, using the preceding text for context.
  function capitalizeSentences(text, before) {
    const context = String(before || '');
    let state = context.length > 200 ? 'mid' : 'start';
    for (const ch of context.slice(-200)) state = nextSentenceState(state, ch);
    let out = '';
    for (const ch of String(text || '')) {
      if (state === 'start' && LETTER.test(ch)) {
        out += ch.toUpperCase();
        state = 'mid';
      } else {
        out += ch;
        state = nextSentenceState(state, ch);
      }
    }
    return out;
  }

  // Returns the text to append to `base` for a recognized phrase, including a separating
  // space when needed. With voiceCommands, spoken punctuation is converted and sentences capitalized.
  function speechSuffix(base, transcript, options) {
    const formatted = Boolean(options && options.voiceCommands);
    let text = String(transcript || '').trim();
    if (formatted) text = applyVoiceCommands(text).replace(/^[ \t]+|[ \t]+$/g, '');
    if (!base) text = text.replace(/^\s+/, '');
    if (!text) return '';
    if (base && !/\s$/.test(base) && !/^[\s.,;:?!]/.test(text)) text = ' ' + text;
    return formatted ? capitalizeSentences(text, base) : text;
  }

  function joinText(first, second) {
    if (!first) return second || '';
    if (!second) return first;
    return /\s$/.test(first) || /^\s/.test(second) ? first + second : first + ' ' + second;
  }

  function countWords(text) {
    return String(text || '').split(/\s+/).filter(function (token) {
      return WORD_CHAR.test(token);
    }).length;
  }

  function pluralize(count, noun) {
    return count + ' ' + noun + (count === 1 ? '' : 's');
  }

  function formatDuration(ms) {
    const total = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = String(total % 60).padStart(2, '0');
    return hours ? hours + ':' + String(minutes).padStart(2, '0') + ':' + seconds : minutes + ':' + seconds;
  }

  // First line of the text, shortened at a word boundary.
  function summarize(text, maxLength) {
    const limit = maxLength || 40;
    const line = String(text || '').trim().split('\n')[0].replace(/\s+/g, ' ');
    if (line.length <= limit) return line;
    const cut = line.slice(0, limit + 1);
    const lastSpace = cut.lastIndexOf(' ');
    const short = lastSpace > limit / 2 ? cut.slice(0, lastSpace) : line.slice(0, limit);
    return short.replace(/[\s.,;:?!-]+$/, '') + '…';
  }

  function noteTitle(note) {
    return String(note.title || '').trim() || summarize(note.text) || 'Untitled note';
  }

  function slugify(text) {
    return String(text || '')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60)
      .replace(/-+$/, '');
  }

  function notesToMarkdown(notes, formatDate) {
    return notes.map(function (note) {
      const details = [];
      if (formatDate && note.createdAt) details.push(formatDate(note.createdAt));
      details.push(pluralize(countWords(note.text), 'word'));
      if (note.duration >= 1000) details.push(formatDuration(note.duration) + ' recorded');
      const clips = (note.clips || []).length;
      if (clips) details.push(pluralize(clips, 'audio clip') + ' (not included)');
      return '# ' + noteTitle(note) + '\n\n_' + details.join(' · ') + '_\n\n' + String(note.text || '').trim() + '\n';
    }).join('\n---\n\n');
  }

  return {
    supportsVoiceCommands: supportsVoiceCommands,
    applyVoiceCommands: applyVoiceCommands,
    capitalizeSentences: capitalizeSentences,
    speechSuffix: speechSuffix,
    joinText: joinText,
    countWords: countWords,
    pluralize: pluralize,
    formatDuration: formatDuration,
    summarize: summarize,
    noteTitle: noteTitle,
    slugify: slugify,
    notesToMarkdown: notesToMarkdown,
  };
});
