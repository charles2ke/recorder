const { test, expect } = require('@playwright/test');
const { speechSuffix } = require('../text.js');

const formatted = { voiceCommands: true };

test('converts spoken punctuation and capitalizes sentences', () => {
  expect(speechSuffix('', 'hello comma world period how are you question mark new paragraph next', formatted))
    .toBe('Hello, world. How are you?\n\nNext');
  expect(speechSuffix('', 'note colon buy milk semicolon eggs exclamation point new line done', formatted))
    .toBe('Note: buy milk; eggs!\nDone');
});

test('leaves words that only contain a command and decimal numbers alone', () => {
  expect(speechSuffix('', 'the periodic table has a colonel', formatted)).toBe('The periodic table has a colonel');
  expect(speechSuffix('', 'pi is 3.14 period', formatted)).toBe('Pi is 3.14.');
});

test('continues sentences across separate results', () => {
  expect(speechSuffix('Hello.', 'world', formatted)).toBe(' World');
  expect(speechSuffix('Hello', 'world', formatted)).toBe(' world');
  expect(speechSuffix('Hello', 'comma world', formatted)).toBe(', world');
  expect(speechSuffix('Hello\n', 'world', formatted)).toBe('World');
});

test('keeps speech as spoken without voice commands', () => {
  expect(speechSuffix('', ' hello comma world ', {})).toBe('hello comma world');
  expect(speechSuffix('hello', 'world period', {})).toBe(' world period');
});
