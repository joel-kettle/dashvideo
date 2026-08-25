/* DashVideo - subtitle file parsing (SRT, WebVTT, ASS/SSA, SBV). */
(function (root) {
  'use strict';

  var DV = (root.DV = root.DV || {});

  var TIME = /(?:(\d+):)?(\d{1,3}):(\d{1,2})[.,](\d{1,3})/;

  function toSeconds(match) {
    if (!match) return null;
    var hours = Number(match[1] || 0);
    var minutes = Number(match[2] || 0);
    var seconds = Number(match[3] || 0);
    var fraction = match[4] || '0';
    while (fraction.length < 3) fraction += '0';
    return hours * 3600 + minutes * 60 + seconds + Number(fraction) / 1000;
  }

  function parseTime(text) {
    var m = TIME.exec(String(text).trim());
    return m ? toSeconds(m) : null;
  }

  /* Decode bytes, falling back to windows-1252 for the many legacy .srt files
     that are not UTF-8. */
  function decode(buffer) {
    var bytes = new Uint8Array(buffer);
    if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
      bytes = bytes.subarray(3);
    }
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch (e) {
      try {
        return new TextDecoder('windows-1252').decode(bytes);
      } catch (err) {
        return new TextDecoder().decode(bytes);
      }
    }
  }

  function normalize(text) {
    return String(text).replace(/\r\n?/g, '\n').replace(/^\uFEFF/, '');
  }

  function cleanCueText(text) {
    return text
      .replace(/\{\\[^}]*\}/g, '')          /* ASS overrides that leaked in */
      .replace(/<(\/?)([a-zA-Z][^\s/>]*)[^>]*>/g, function (all, slash, tag) {
        tag = tag.toLowerCase();                /* keep basic styling, drop the rest */
        return tag === 'i' || tag === 'b' || tag === 'u' ? '<' + slash + tag + '>' : '';
      })
      .replace(/&nbsp;/gi, ' ')
      .replace(/&lrm;|&rlm;/gi, '')
      .replace(/[ \t]+\n/g, '\n')
      .trim();
  }

  function parseCueBlocks(text) {
    var cues = [];
    var blocks = text.split(/\n{2,}/);
    blocks.forEach(function (block) {
      var lines = block.split('\n');
      var timingIndex = -1;
      for (var i = 0; i < lines.length && i < 3; i++) {
        if (lines[i].indexOf('-->') !== -1) {
          timingIndex = i;
          break;
        }
      }
      if (timingIndex === -1) return;
      var parts = lines[timingIndex].split('-->');
      var start = parseTime(parts[0]);
      var end = parseTime(parts[1]);
      if (start === null || end === null) return;
      var body = cleanCueText(lines.slice(timingIndex + 1).join('\n'));
      if (!body) return;
      cues.push({ start: start, end: Math.max(end, start + 0.05), text: body });
    });
    return cues;
  }

  function parseAss(text) {
    var cues = [];
    var lines = text.split('\n');
    var fields = null;

    lines.forEach(function (line) {
      var trimmed = line.trim();
      if (/^Format\s*:/i.test(trimmed) && fields === null && /Text\s*$/i.test(trimmed)) {
        fields = trimmed.replace(/^Format\s*:/i, '').split(',').map(function (f) {
          return f.trim().toLowerCase();
        });
        return;
      }
      if (!/^Dialogue\s*:/i.test(trimmed)) return;

      var value = trimmed.replace(/^Dialogue\s*:/i, '');
      var names = fields || ['layer', 'start', 'end', 'style', 'name', 'marginl', 'marginr', 'marginv', 'effect', 'text'];
      var textIndex = names.indexOf('text');
      if (textIndex === -1) textIndex = names.length - 1;
      var parts = value.split(',');
      var head = parts.slice(0, textIndex);
      var body = parts.slice(textIndex).join(',');

      var start = parseTime(head[names.indexOf('start')] || head[1]);
      var end = parseTime(head[names.indexOf('end')] || head[2]);
      if (start === null || end === null) return;

      body = body
        .replace(/\{[^}]*\}/g, '')
        .replace(/\\N/gi, '\n')
        .replace(/\\h/gi, ' ')
        .trim();
      if (!body) return;
      cues.push({ start: start, end: Math.max(end, start + 0.05), text: cleanCueText(body) });
    });
    return cues;
  }

  function parseSbv(text) {
    var cues = [];
    text.split(/\n{2,}/).forEach(function (block) {
      var lines = block.split('\n');
      if (!lines.length) return;
      var timing = lines[0].split(',');
      if (timing.length < 2) return;
      var start = parseTime(timing[0]);
      var end = parseTime(timing[1]);
      if (start === null || end === null) return;
      var body = cleanCueText(lines.slice(1).join('\n'));
      if (!body) return;
      cues.push({ start: start, end: Math.max(end, start + 0.05), text: body });
    });
    return cues;
  }

  function detect(text, filename) {
    var name = String(filename || '').toLowerCase();
    if (/\.(ass|ssa)$/.test(name) || /^\s*\[script info\]/i.test(text) || /^Dialogue\s*:/im.test(text)) {
      return 'ass';
    }
    if (/^\s*WEBVTT/i.test(text) || /\.vtt$/.test(name)) return 'vtt';
    if (text.indexOf('-->') !== -1) return 'srt';
    if (/\d:\d{2}:\d{2}\.\d+,\d/.test(text)) return 'sbv';
    return 'srt';
  }

  function parse(rawText, filename) {
    var text = normalize(rawText);
    var format = detect(text, filename);
    var cues;

    if (format === 'ass') cues = parseAss(text);
    else if (format === 'sbv') cues = parseSbv(text);
    else {
      cues = parseCueBlocks(text.replace(/^\s*WEBVTT[^\n]*\n/i, ''));
      /* Some files use a single blank-line-free layout - retry more loosely. */
      if (!cues.length && text.indexOf('-->') !== -1) {
        cues = parseCueBlocks(text.replace(/\n(?=\d+\n\d{1,3}:)/g, '\n\n'));
      }
    }

    cues.sort(function (a, b) { return a.start - b.start || a.end - b.end; });
    return { cues: cues, format: format };
  }

  DV.subParser = { parse: parse, decode: decode, parseTime: parseTime };
})(typeof globalThis !== 'undefined' ? globalThis : window);
