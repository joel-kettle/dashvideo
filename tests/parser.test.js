/* Run with: node --test tests/ */
const test = require('node:test');
const assert = require('node:assert');

require('../src/common/defaults.js');
require('../src/common/hotkeys.js');
require('../src/content/subtitles/parser.js');

const { subParser, hotkeys, makeKey } = globalThis.DV;

const SRT = [
  '1',
  '00:00:01,000 --> 00:00:03,500',
  'Hello there',
  '',
  '2',
  '00:00:04,000 --> 00:00:06,000',
  '<i>General</i> Kenobi',
  'second line',
  ''
].join('\r\n');

const VTT = [
  'WEBVTT - some title',
  '',
  'NOTE this is a comment',
  '',
  'cue-1',
  '00:00:02.000 --> 00:00:04.000 line:90% align:middle',
  'Wrapped <c.yellow>styled</c> text',
  ''
].join('\n');

const ASS = [
  '[Script Info]',
  'ScriptType: v4.00+',
  '',
  '[Events]',
  'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  'Dialogue: 0,0:00:05.00,0:00:07.50,Default,,0,0,0,,{\\an8}Top line\\NBottom line',
  'Dialogue: 0,0:00:08.00,0:00:09.00,Default,,0,0,0,,Commas, inside, the text'
].join('\n');

const SBV = [
  '0:00:01.000,0:00:02.500',
  'First caption',
  '',
  '0:00:03.000,0:00:04.000',
  'Second caption'
].join('\n');

test('parses SRT with CRLF line endings', () => {
  const { cues, format } = subParser.parse(SRT, 'movie.srt');
  assert.strictEqual(format, 'srt');
  assert.strictEqual(cues.length, 2);
  assert.deepStrictEqual(cues[0], { start: 1, end: 3.5, text: 'Hello there' });
  assert.strictEqual(cues[1].text, '<i>General</i> Kenobi\nsecond line');
});

test('parses WebVTT, dropping the header and unsupported tags', () => {
  const { cues, format } = subParser.parse(VTT, 'movie.vtt');
  assert.strictEqual(format, 'vtt');
  assert.strictEqual(cues.length, 1);
  assert.strictEqual(cues[0].start, 2);
  assert.strictEqual(cues[0].text, 'Wrapped styled text');
});

test('parses ASS dialogue, overrides and commas in the text', () => {
  const { cues, format } = subParser.parse(ASS, 'movie.ass');
  assert.strictEqual(format, 'ass');
  assert.strictEqual(cues.length, 2);
  assert.strictEqual(cues[0].start, 5);
  assert.strictEqual(cues[0].end, 7.5);
  assert.strictEqual(cues[0].text, 'Top line\nBottom line');
  assert.strictEqual(cues[1].text, 'Commas, inside, the text');
});

test('parses SBV', () => {
  const { cues } = subParser.parse(SBV, 'movie.sbv');
  assert.strictEqual(cues.length, 2);
  assert.strictEqual(cues[1].start, 3);
});

test('cues come back sorted and never zero length', () => {
  const { cues } = subParser.parse([
    '1', '00:00:09,000 --> 00:00:10,000', 'later', '',
    '2', '00:00:02,000 --> 00:00:02,000', 'earlier', ''
  ].join('\n'), 'x.srt');
  assert.strictEqual(cues[0].text, 'earlier');
  assert.ok(cues[0].end > cues[0].start);
});

test('hours are optional and fractions are padded', () => {
  assert.strictEqual(subParser.parseTime('00:01:02,5'), 62.5);
  assert.strictEqual(subParser.parseTime('1:02:03.250'), 3723.25);
});

test('decodes UTF-8, BOMs and windows-1252 bytes', () => {
  const utf8 = new TextEncoder().encode('﻿café');
  assert.strictEqual(subParser.decode(utf8.buffer), 'café');
  const latin = new Uint8Array([0x63, 0x61, 0x66, 0xe9]);   // "café" in cp1252
  assert.strictEqual(subParser.decode(latin.buffer), 'café');
});

test('hotkey matching respects every modifier', () => {
  const binding = makeKey('KeyX', { shift: true });
  assert.ok(hotkeys.matches({ code: 'KeyX', shiftKey: true }, binding));
  assert.ok(!hotkeys.matches({ code: 'KeyX', shiftKey: false }, binding));
  assert.ok(!hotkeys.matches({ code: 'KeyX', shiftKey: true, ctrlKey: true }, binding));
  assert.strictEqual(hotkeys.describe(binding), 'Shift + X');
  assert.strictEqual(hotkeys.describe(makeKey('BracketLeft')), '[');
  assert.ok(hotkeys.same(makeKey('KeyZ'), makeKey('KeyZ')));
});
