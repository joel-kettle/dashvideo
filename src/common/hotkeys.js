/* DashVideo - hotkey matching and formatting, shared by content and options. */
(function (root) {
  'use strict';

  var DV = (root.DV = root.DV || {});

  var MODIFIER_CODES = {
    ShiftLeft: 1, ShiftRight: 1,
    ControlLeft: 1, ControlRight: 1,
    AltLeft: 1, AltRight: 1,
    MetaLeft: 1, MetaRight: 1
  };

  var CODE_LABELS = {
    Comma: ',', Period: '.', Slash: '/', Backslash: '\\', Semicolon: ';', Quote: "'",
    BracketLeft: '[', BracketRight: ']', Minus: '-', Equal: '=', Backquote: '`',
    Space: 'Space', Enter: 'Enter', Escape: 'Esc', Backspace: 'Backspace', Tab: 'Tab',
    ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓',
    PageUp: 'PgUp', PageDown: 'PgDn', Home: 'Home', End: 'End', Insert: 'Ins', Delete: 'Del'
  };

  function labelForCode(code) {
    if (!code) return '';
    if (CODE_LABELS[code]) return CODE_LABELS[code];
    if (/^Key[A-Z]$/.test(code)) return code.slice(3);
    if (/^Digit\d$/.test(code)) return code.slice(5);
    if (/^Numpad/.test(code)) return 'Num ' + code.slice(6);
    return code;
  }

  var isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || '');

  function describe(binding) {
    if (!binding || !binding.code) return '';
    var parts = [];
    if (binding.ctrl) parts.push('Ctrl');
    if (binding.alt) parts.push(isMac ? '⌥' : 'Alt');
    if (binding.shift) parts.push('Shift');
    if (binding.meta) parts.push(isMac ? '⌘' : 'Win');
    parts.push(labelForCode(binding.code));
    return parts.join(' + ');
  }

  function isModifierEvent(e) {
    return !!MODIFIER_CODES[e.code];
  }

  function fromEvent(e) {
    if (isModifierEvent(e)) return null;
    return {
      code: e.code,
      shift: !!e.shiftKey,
      ctrl: !!e.ctrlKey,
      alt: !!e.altKey,
      meta: !!e.metaKey
    };
  }

  function matches(e, binding) {
    if (!binding || !binding.code) return false;
    return e.code === binding.code &&
      !!e.shiftKey === !!binding.shift &&
      !!e.ctrlKey === !!binding.ctrl &&
      !!e.altKey === !!binding.alt &&
      !!e.metaKey === !!binding.meta;
  }

  function same(a, b) {
    if (!a || !b) return false;
    return a.code === b.code && !!a.shift === !!b.shift && !!a.ctrl === !!b.ctrl &&
      !!a.alt === !!b.alt && !!a.meta === !!b.meta;
  }

  DV.hotkeys = {
    describe: describe,
    fromEvent: fromEvent,
    matches: matches,
    same: same,
    labelForCode: labelForCode,
    isModifierEvent: isModifierEvent
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
