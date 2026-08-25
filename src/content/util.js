/* DashVideo - small content-script helpers. */
(function (root) {
  'use strict';

  var DV = (root.DV = root.DV || {});

  function clamp(n, lo, hi) {
    return n < lo ? lo : n > hi ? hi : n;
  }

  function round(n, digits) {
    var f = Math.pow(10, digits == null ? 2 : digits);
    return Math.round(n * f) / f;
  }

  function formatTime(seconds) {
    if (!isFinite(seconds) || seconds < 0) seconds = 0;
    var s = Math.floor(seconds % 60);
    var m = Math.floor((seconds / 60) % 60);
    var h = Math.floor(seconds / 3600);
    var pad = function (n) { return n < 10 ? '0' + n : String(n); };
    return (h ? h + ':' + pad(m) : String(m)) + ':' + pad(s);
  }

  function formatSigned(n) {
    var v = round(n, 2);
    return (v >= 0 ? '+' : '') + v;
  }

  /* True when the keystroke belongs to whatever the user is typing into. */
  function isEditable(node) {
    while (node) {
      if (node.nodeType === 1) {
        var tag = node.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
        if (node.isContentEditable) return true;
        if (node.getAttribute && node.getAttribute('role') === 'textbox') return true;
      }
      node = node.parentNode || (node.host ? node.host : null);
    }
    return false;
  }

  /* Collect elements matching `selector`, descending into open shadow roots. */
  function deepQueryAll(selector, rootNode) {
    var out = [];
    var seen = new Set();

    function walk(node) {
      if (!node || seen.has(node)) return;
      seen.add(node);
      var found;
      try {
        found = node.querySelectorAll ? node.querySelectorAll(selector) : [];
      } catch (e) {
        found = [];
      }
      for (var i = 0; i < found.length; i++) out.push(found[i]);

      var all;
      try {
        all = node.querySelectorAll ? node.querySelectorAll('*') : [];
      } catch (e) {
        all = [];
      }
      for (var j = 0; j < all.length; j++) {
        if (all[j].shadowRoot) walk(all[j].shadowRoot);
      }
    }

    walk(rootNode || document);
    return out;
  }

  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    var rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return false;
    var style;
    try {
      style = getComputedStyle(el);
    } catch (e) {
      return true;
    }
    return style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity) > 0.05;
  }

  function hostBlocked(list) {
    if (!list || !list.length) return false;
    var host = '';
    try {
      host = (location.hostname || '').toLowerCase();
    } catch (e) {
      return false;
    }
    return list.some(function (entry) {
      var pattern = String(entry || '').trim().toLowerCase().replace(/^\*\./, '');
      if (!pattern) return false;
      return host === pattern || host.endsWith('.' + pattern);
    });
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  DV.util = {
    clamp: clamp,
    round: round,
    formatTime: formatTime,
    formatSigned: formatSigned,
    isEditable: isEditable,
    deepQueryAll: deepQueryAll,
    isVisible: isVisible,
    hostBlocked: hostBlocked,
    escapeHtml: escapeHtml
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
