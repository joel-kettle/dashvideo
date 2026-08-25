/* DashVideo - the on-video overlay (toast, badge, control panel, subtitles).
   Everything lives in a shadow root so page styles cannot reach it.

   The chrome is deliberately small and pinned to the top edge of the video:
   a one-line toolbar centred at the top, the speed badge in the top-left
   corner and the toast tucked underneath them. Only the subtitles sit at the
   bottom, where subtitles belong. */
(function (root) {
  'use strict';

  var DV = (root.DV = root.DV || {});

  DV.state = DV.state || {
    settings: DV.DEFAULTS,
    video: null,
    maximized: false,
    panel: false,
    subs: { cues: [], name: '', offset: 0, enabled: true }
  };

  var state = DV.state;

  var CSS = [
    ':host, * { box-sizing: border-box; }',
    '.anchor { position: absolute; left: 0; top: 0; width: 0; height: 0; pointer-events: none;',
    '  font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }',

    /* toast - one short line under the toolbar */
    '.toast { position: absolute; left: 50%; top: 8px; transform: translateX(-50%);',
    '  width: max-content; max-width: calc(100% - 16px); padding: 5px 11px; border-radius: 7px;',
    '  background: rgba(18, 18, 20, .82); color: #fff; font-size: 13px; font-weight: 600;',
    '  line-height: 1.3; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;',
    '  opacity: 0; transition: opacity .12s ease; box-shadow: 0 3px 14px rgba(0,0,0,.4);',
    '  backdrop-filter: blur(6px); }',
    '.toast.on { opacity: 1; }',
    '.toast .sub { margin-left: 7px; font-size: 11.5px; font-weight: 500; opacity: .62; }',

    /* speed badge */
    '.badge { position: absolute; left: 8px; top: 8px; padding: 2px 6px; border-radius: 5px;',
    '  background: rgba(18, 18, 20, .7); color: #fff; font-size: 11px; font-weight: 600;',
    '  cursor: pointer; pointer-events: auto; opacity: .5; transition: opacity .12s ease;',
    '  user-select: none; }',
    '.badge:hover { opacity: 1; }',
    '.badge[hidden] { display: none; }',

    /* control toolbar */
    '.panel { position: absolute; left: 50%; top: 8px; transform: translateX(-50%);',
    '  display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 3px;',
    '  width: max-content; max-width: calc(100% - 16px); padding: 3px 4px; border-radius: 8px;',
    '  background: rgba(18, 18, 20, .84); color: #fff; pointer-events: auto;',
    '  box-shadow: 0 3px 16px rgba(0,0,0,.45); backdrop-filter: blur(8px);',
    '  border: 1px solid rgba(255,255,255,.08); user-select: none; opacity: .92; }',
    '.panel:hover { opacity: 1; }',
    '.panel[hidden] { display: none; }',
    '.grp { display: flex; align-items: center; gap: 1px; }',
    '.grp[hidden] { display: none; }',
    '.grp + .grp { margin-left: 2px; padding-left: 4px;',
    '  border-left: 1px solid rgba(255,255,255,.13); }',
    '.grip { padding: 0 3px; cursor: move; opacity: .35; font-size: 12px; line-height: 1;',
    '  letter-spacing: -2px; }',
    '.grip:hover { opacity: .7; }',
    'button { height: 20px; min-width: 20px; padding: 0 4px; border: 0; border-radius: 5px;',
    '  background: transparent; color: #fff; font-size: 11px; font-weight: 600;',
    '  font-family: inherit; line-height: 1; cursor: pointer; white-space: nowrap;',
    '  opacity: .85; }',
    'button:hover { background: rgba(255,255,255,.18); opacity: 1; }',
    'button:active { background: rgba(255,255,255,.28); }',
    'button.on { background: #3b82f6; opacity: 1; }',
    'button.close { opacity: .45; font-size: 13px; margin-left: 1px; }',
    '.value { min-width: 32px; padding: 0 1px; text-align: center; font-size: 11px;',
    '  font-variant-numeric: tabular-nums; opacity: .85; }',

    /* subtitles */
    '.subs { position: absolute; left: 0; top: 0; width: 100%; height: 100%; overflow: hidden; }',
    '.subs[hidden] { display: none; }',
    '.subs-box { position: absolute; left: 50%; transform: translateX(-50%); max-width: 88%;',
    '  text-align: center; line-height: 1.28; font-weight: 600; white-space: pre-wrap;',
    '  word-wrap: break-word; }',
    '.subs-box:empty { display: none; }',
    '.subs-box span.cue { display: inline-block; padding: .12em .4em; border-radius: .12em; }'
  ].join('\n');

  var FIT_TITLES = {
    contain: 'fit the whole picture',
    cover: 'zoom to fill, cropping the edges',
    fill: 'stretch to fill, ignoring the aspect ratio'
  };

  var host = null;
  var shadow = null;
  var els = {};
  var rafId = 0;
  var toastTimer = 0;
  var drag = { on: false, dx: 0, dy: 0, moved: false, placed: false };

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }

  function button(act, label, title, cls) {
    var b = el('button', cls || '', label);
    b.setAttribute('data-act', act);
    b.type = 'button';
    if (title) b.title = title;
    return b;
  }

  function group() {
    return el('div', 'grp');
  }

  function buildPanel() {
    var panel = el('div', 'panel');
    panel.hidden = true;

    els.grip = el('span', 'grip', '⋮⋮');
    els.grip.title = 'Drag to move';
    panel.appendChild(els.grip);

    var speed = group();
    speed.appendChild(button('speedDown', '−', 'Slower'));
    els.speedValue = el('span', 'value', '1.00×');
    speed.appendChild(els.speedValue);
    speed.appendChild(button('speedUp', '+', 'Faster'));
    speed.appendChild(button('speedReset', '↺', 'Reset speed'));
    panel.appendChild(speed);

    var seek = group();
    els.seekBack = button('seekBack', '⏪3s', 'Seek backward');
    els.seekFwd = button('seekForward', '3s⏩', 'Seek forward');
    seek.appendChild(els.seekBack);
    seek.appendChild(els.seekFwd);
    panel.appendChild(seek);

    var frame = group();
    els.frameBack = button('frameBack', '◀❘', 'Previous frame');
    els.frameFwd = button('frameForward', '❘▶', 'Next frame');
    frame.appendChild(els.frameBack);
    frame.appendChild(els.frameFwd);
    panel.appendChild(frame);

    var view = group();
    els.maxBtn = button('maximize', '⛶', 'Maximize in tab');
    els.fitBtn = button('maximizeFit', 'Fit', 'Cycle the picture fit');
    els.fitBtn.hidden = true;
    els.subsBtn = button('subsLoad', 'CC', 'Load a subtitle file');
    view.appendChild(els.maxBtn);
    view.appendChild(els.fitBtn);
    view.appendChild(els.subsBtn);
    panel.appendChild(view);
    els.viewGroup = view;

    els.syncGroup = group();
    els.syncGroup.hidden = true;
    els.syncGroup.appendChild(button('subsDelayMinus', '−', 'Subtitles earlier'));
    els.syncValue = el('span', 'value', '+0s');
    els.syncGroup.appendChild(els.syncValue);
    els.syncGroup.appendChild(button('subsDelayPlus', '+', 'Subtitles later'));
    els.syncGroup.appendChild(button('panelClose', '×', 'Hide these controls', 'close'));
    panel.appendChild(els.syncGroup);

    els.close = button('panelClose', '×', 'Hide these controls', 'close');
    view.appendChild(els.close);

    els.panel = panel;
    return panel;
  }

  function attachHost() {
    var parent = document.fullscreenElement;
    if (!parent || parent.tagName === 'VIDEO') parent = document.body || document.documentElement;
    if (host.parentNode !== parent) parent.appendChild(host);
  }

  function ensure() {
    if (host && host.isConnected) {
      attachHost();
      return shadow;
    }
    if (!document.documentElement) return null;

    host = document.createElement('dashvideo-ui');
    host.style.cssText = [
      'all: initial !important',
      'position: fixed !important',
      'left: 0 !important',
      'top: 0 !important',
      'width: 100% !important',
      'height: 100% !important',
      'margin: 0 !important',
      'padding: 0 !important',
      'border: 0 !important',
      'pointer-events: none !important',
      'z-index: 2147483647 !important',
      'color-scheme: dark',
      'contain: layout style'
    ].join('; ');
    host.setAttribute('dir', 'ltr');

    shadow = host.attachShadow({ mode: 'open' });
    var style = document.createElement('style');
    style.textContent = CSS;
    shadow.appendChild(style);

    var anchor = el('div', 'anchor');
    els.anchor = anchor;

    els.toast = el('div', 'toast');
    anchor.appendChild(els.toast);

    els.badge = el('div', 'badge', '1.00×');
    els.badge.hidden = true;
    anchor.appendChild(els.badge);

    anchor.appendChild(buildPanel());

    els.subs = el('div', 'subs');
    els.subs.hidden = true;
    els.subsBox = el('div', 'subs-box');
    els.subs.appendChild(els.subsBox);
    anchor.appendChild(els.subs);

    shadow.appendChild(anchor);
    attachHost();
    wireEvents();
    startLoop();
    return shadow;
  }

  function wireEvents() {
    shadow.addEventListener('click', function (e) {
      var target = e.target.closest ? e.target.closest('[data-act]') : null;
      if (target) {
        e.preventDefault();
        e.stopPropagation();
        var act = target.getAttribute('data-act');
        if (act === 'panelClose') return hidePanel();
        if (DV.ui.onAction) DV.ui.onAction(act);
        return;
      }
      if (e.target === els.badge && !drag.moved) togglePanel();
    });

    /* Keystrokes over the toolbar must not reach the page. */
    shadow.addEventListener('keydown', function (e) { e.stopPropagation(); });

    els.grip.addEventListener('pointerdown', function (e) {
      var panel = els.panel.getBoundingClientRect();
      var anchor = els.anchor.getBoundingClientRect();
      /* Switch from the centred position to explicit coordinates on first drag. */
      var x = panel.left - anchor.left;
      var y = panel.top - anchor.top;
      els.panel.style.transform = 'none';
      els.panel.style.left = x + 'px';
      els.panel.style.top = y + 'px';
      drag.on = true;
      drag.placed = true;
      drag.moved = false;
      drag.dx = e.clientX - x;
      drag.dy = e.clientY - y;
      els.grip.setPointerCapture(e.pointerId);
      e.preventDefault();
    });

    els.grip.addEventListener('pointermove', function (e) {
      if (!drag.on) return;
      var anchor = els.anchor.getBoundingClientRect();
      var panel = els.panel.getBoundingClientRect();
      var x = DV.util.clamp(e.clientX - drag.dx, 0, Math.max(0, anchor.width - panel.width));
      var y = DV.util.clamp(e.clientY - drag.dy, 0, Math.max(0, anchor.height - panel.height));
      els.panel.style.left = x + 'px';
      els.panel.style.top = y + 'px';
      drag.moved = true;
    });

    els.grip.addEventListener('pointerup', function () { drag.on = false; });
    els.grip.addEventListener('pointercancel', function () { drag.on = false; });

    document.addEventListener('fullscreenchange', function () {
      if (host) attachHost();
    }, true);
  }

  /* One rAF loop drives anchor placement and the subtitle renderer. It parks
     itself a second after the last overlay disappears and is woken by the next
     toast, panel or subtitle. */
  function needsLoop() {
    return !!(state.panel ||
      (state.subs.cues.length && state.subs.enabled) ||
      (els.toast && els.toast.classList.contains('on')) ||
      (els.badge && !els.badge.hidden));
  }

  function startLoop() {
    if (rafId) return;
    var idle = 0;
    var tick = function () {
      if (needsLoop()) idle = 0;
      else if (++idle > 60) {
        rafId = 0;
        return;
      }
      rafId = requestAnimationFrame(tick);
      layout();
    };
    rafId = requestAnimationFrame(tick);
  }

  function layout() {
    if (!els.anchor) return;
    var video = state.video;
    var rect;
    if (video && video.isConnected) {
      rect = video.getBoundingClientRect();
    } else {
      rect = { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
    }
    if (rect.width < 1 || rect.height < 1) {
      rect = { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
    }
    var a = els.anchor.style;
    a.transform = 'translate(' + Math.round(rect.left) + 'px,' + Math.round(rect.top) + 'px)';
    a.width = Math.round(rect.width) + 'px';
    a.height = Math.round(rect.height) + 'px';

    if (DV.subs && DV.subs.tick) DV.subs.tick(video, rect);
  }

  /* Keep the toast clear of the toolbar when both are on screen. */
  function placeToast() {
    if (!els.toast) return;
    els.toast.style.top = state.panel && !drag.placed
      ? (els.panel.offsetHeight + 12) + 'px'
      : '';
  }

  function toast(text, sub) {
    if (!state.settings.hud) return;
    var shadowRoot = ensure();
    if (!shadowRoot) return;
    startLoop();
    els.toast.textContent = '';
    els.toast.appendChild(document.createTextNode(text));
    if (sub) els.toast.appendChild(el('span', 'sub', sub));
    placeToast();
    els.toast.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      els.toast.classList.remove('on');
    }, Math.max(200, state.settings.hudDuration || 900));
  }

  function setBadge(text) {
    if (!els.badge) return;
    var show = !!text && state.settings.badge && !state.panel;
    els.badge.hidden = !show;
    if (show) els.badge.textContent = text;
  }

  function showPanel() {
    ensure();
    startLoop();
    state.panel = true;
    els.panel.hidden = false;
    setBadge(null);
    DV.ui.refresh();
  }

  function hidePanel() {
    state.panel = false;
    if (els.panel) els.panel.hidden = true;
    DV.ui.refresh();
  }

  function togglePanel() {
    if (state.panel) hidePanel(); else showPanel();
  }

  /* Push the current video/settings state into the toolbar and badge. */
  function refresh() {
    startLoop();
    var s = state.settings;
    var v = state.video;
    var rate = v ? v.playbackRate : 1;
    setBadge(v && Math.abs(rate - 1) > 0.001 ? DV.util.round(rate, 2).toFixed(2) + '×' : null);
    if (!els.panel || els.panel.hidden) return;

    els.speedValue.textContent = DV.util.round(rate, 2).toFixed(2) + '×';
    els.seekBack.textContent = '⏪' + s.seekInterval + 's';
    els.seekFwd.textContent = s.seekInterval + 's⏩';

    var fps = Math.round((DV.videos && v) ? DV.videos.fps(v) : s.fps);
    els.frameBack.title = 'Previous frame (' + fps + ' fps)';
    els.frameFwd.title = 'Next frame (' + fps + ' fps)';

    els.maxBtn.title = state.maximized ? 'Restore the size' : 'Maximize in tab';
    els.maxBtn.classList.toggle('on', state.maximized);

    var fit = s.maximizeFit === 'cover' ? 'Fill' : s.maximizeFit === 'fill' ? 'Str' : 'Fit';
    els.fitBtn.hidden = !state.maximized;
    els.fitBtn.textContent = fit;
    els.fitBtn.title = 'Picture fit: ' + FIT_TITLES[s.maximizeFit || 'contain'];

    var subs = state.subs;
    var loaded = subs.cues.length > 0;
    /* One CC button: loads a file when there is none, toggles it once loaded. */
    els.subsBtn.setAttribute('data-act', loaded ? 'subsToggle' : 'subsLoad');
    els.subsBtn.title = loaded
      ? (subs.enabled ? 'Hide ' : 'Show ') + subs.name
      : 'Load a subtitle file';
    els.subsBtn.classList.toggle('on', loaded && subs.enabled);
    els.syncGroup.hidden = !loaded;
    els.close.hidden = loaded;
    if (loaded) els.syncValue.textContent = DV.util.formatSigned(subs.offset) + 's';
    placeToast();
  }

  DV.ui = {
    ensure: ensure,
    toast: toast,
    refresh: refresh,
    showPanel: showPanel,
    hidePanel: hidePanel,
    togglePanel: togglePanel,
    setBadge: setBadge,
    els: els,
    onAction: null
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
