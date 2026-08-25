/* DashVideo - the on-video overlay (toast, badge, control panel, subtitles).
   Everything lives in a shadow root so page styles cannot reach it. */
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

    /* toast */
    '.toast { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);',
    '  padding: 10px 18px; border-radius: 10px; background: rgba(18, 18, 20, .82);',
    '  color: #fff; font-size: 20px; font-weight: 600; letter-spacing: .2px; line-height: 1.25;',
    '  text-align: center; white-space: pre-line; opacity: 0; transition: opacity .12s ease;',
    '  box-shadow: 0 6px 24px rgba(0,0,0,.45); backdrop-filter: blur(6px); }',
    '.toast.on { opacity: 1; }',
    '.anchor.paneled .toast { left: auto; right: 12px; top: 12px; transform: none;',
    '  font-size: 16px; padding: 8px 14px; text-align: right; }',
    '.toast .sub { display: block; margin-top: 3px; font-size: 13px; font-weight: 500; opacity: .72; }',

    /* speed badge */
    '.badge { position: absolute; left: 10px; top: 10px; padding: 3px 8px; border-radius: 6px;',
    '  background: rgba(18, 18, 20, .72); color: #fff; font-size: 13px; font-weight: 600;',
    '  cursor: pointer; pointer-events: auto; opacity: .55; transition: opacity .12s ease;',
    '  user-select: none; }',
    '.badge:hover { opacity: 1; }',
    '.badge[hidden] { display: none; }',

    /* control panel */
    '.panel { position: absolute; left: 10px; top: 10px; width: 232px; padding: 8px;',
    '  border-radius: 12px; background: rgba(18, 18, 20, .9); color: #fff; pointer-events: auto;',
    '  box-shadow: 0 8px 30px rgba(0,0,0,.5); backdrop-filter: blur(8px); user-select: none;',
    '  border: 1px solid rgba(255,255,255,.09); }',
    '.panel[hidden] { display: none; }',
    '.head { display: flex; align-items: center; gap: 6px; padding: 0 2px 7px; cursor: move; }',
    '.head .title { font-size: 12px; font-weight: 700; letter-spacing: .6px; text-transform: uppercase;',
    '  opacity: .62; flex: 1; }',
    '.row { display: flex; align-items: center; gap: 5px; margin-top: 5px; }',
    '.row .lbl { font-size: 10px; text-transform: uppercase; letter-spacing: .5px; opacity: .5;',
    '  width: 34px; flex: none; }',
    'button { flex: 1; min-width: 0; height: 26px; padding: 0 6px; border: 0; border-radius: 7px;',
    '  background: rgba(255,255,255,.1); color: #fff; font-size: 12px; font-weight: 600;',
    '  font-family: inherit; cursor: pointer; line-height: 1; white-space: nowrap;',
    '  overflow: hidden; text-overflow: ellipsis; }',
    'button:hover { background: rgba(255,255,255,.2); }',
    'button:active { background: rgba(255,255,255,.28); }',
    'button.ghost { background: transparent; opacity: .6; flex: none; width: 28px; padding: 0 2px; }',
    'button.ghost:hover { background: rgba(255,255,255,.14); opacity: 1; }',
    'button.on { background: #3b82f6; }',
    '.value { flex: 1.3; text-align: center; font-size: 12px; font-variant-numeric: tabular-nums;',
    '  opacity: .9; padding: 0 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
    '.note { margin-top: 6px; font-size: 10.5px; opacity: .45; text-align: center; line-height: 1.35; }',

    /* subtitles */
    '.subs { position: absolute; left: 0; top: 0; width: 100%; height: 100%; overflow: hidden; }',
    '.subs[hidden] { display: none; }',
    '.subs-box { position: absolute; left: 50%; transform: translateX(-50%); max-width: 88%;',
    '  text-align: center; line-height: 1.28; font-weight: 600; white-space: pre-wrap;',
    '  word-wrap: break-word; }',
    '.subs-box:empty { display: none; }',
    '.subs-box span.cue { display: inline-block; padding: .12em .4em; border-radius: .12em; }'
  ].join('\n');

  var host = null;
  var shadow = null;
  var els = {};
  var rafId = 0;
  var toastTimer = 0;
  var drag = { on: false, dx: 0, dy: 0, x: 10, y: 10, moved: false };

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }

  function button(act, label, cls) {
    var b = el('button', cls || '', label);
    b.setAttribute('data-act', act);
    b.type = 'button';
    return b;
  }

  function buildPanel() {
    var panel = el('div', 'panel');
    panel.hidden = true;

    var head = el('div', 'head');
    head.appendChild(el('span', 'title', 'DashVideo'));
    head.appendChild(button('panelClose', '×', 'ghost'));
    panel.appendChild(head);

    var speed = el('div', 'row');
    speed.appendChild(el('span', 'lbl', 'Speed'));
    speed.appendChild(button('speedDown', '−'));
    var speedValue = el('span', 'value', '1.00×');
    speed.appendChild(speedValue);
    speed.appendChild(button('speedUp', '+'));
    speed.appendChild(button('speedReset', '↺', 'ghost'));
    panel.appendChild(speed);

    var seek = el('div', 'row');
    seek.appendChild(el('span', 'lbl', 'Seek'));
    var seekBack = button('seekBack', '⏪ 3s');
    var seekFwd = button('seekForward', '3s ⏩');
    seek.appendChild(seekBack);
    seek.appendChild(seekFwd);
    panel.appendChild(seek);

    var frame = el('div', 'row');
    frame.appendChild(el('span', 'lbl', 'Frame'));
    frame.appendChild(button('frameBack', '◀❘'));
    var frameValue = el('span', 'value', '30 fps');
    frame.appendChild(frameValue);
    frame.appendChild(button('frameForward', '❘▶'));
    panel.appendChild(frame);

    var view = el('div', 'row');
    view.appendChild(el('span', 'lbl', 'View'));
    var maxBtn = button('maximize', '⛶ Maximize');
    view.appendChild(maxBtn);
    panel.appendChild(view);

    var subsRow = el('div', 'row');
    subsRow.appendChild(el('span', 'lbl', 'Subs'));
    var subsBtn = button('subsLoad', 'Load file…');
    subsRow.appendChild(subsBtn);
    panel.appendChild(subsRow);

    var syncRow = el('div', 'row');
    syncRow.hidden = true;
    syncRow.appendChild(el('span', 'lbl', 'Sync'));
    syncRow.appendChild(button('subsDelayMinus', '−'));
    var syncValue = el('span', 'value', '0s');
    syncRow.appendChild(syncValue);
    syncRow.appendChild(button('subsDelayPlus', '+'));
    syncRow.appendChild(button('subsToggle', 'CC', 'ghost'));
    panel.appendChild(syncRow);

    els.panel = panel;
    els.speedValue = speedValue;
    els.seekBack = seekBack;
    els.seekFwd = seekFwd;
    els.frameValue = frameValue;
    els.maxBtn = maxBtn;
    els.subsBtn = subsBtn;
    els.syncRow = syncRow;
    els.syncValue = syncValue;
    els.head = head;
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

    /* Keystrokes typed over the panel must not reach the page. */
    shadow.addEventListener('keydown', function (e) { e.stopPropagation(); });

    els.head.addEventListener('pointerdown', function (e) {
      if (e.target.getAttribute && e.target.getAttribute('data-act')) return;
      drag.on = true;
      drag.moved = false;
      drag.dx = e.clientX - drag.x;
      drag.dy = e.clientY - drag.y;
      els.head.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    els.head.addEventListener('pointermove', function (e) {
      if (!drag.on) return;
      drag.x = e.clientX - drag.dx;
      drag.y = e.clientY - drag.dy;
      drag.moved = true;
      els.panel.style.left = drag.x + 'px';
      els.panel.style.top = drag.y + 'px';
    });
    els.head.addEventListener('pointerup', function () { drag.on = false; });
    els.head.addEventListener('pointercancel', function () { drag.on = false; });

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

  function toast(text, sub) {
    if (!state.settings.hud) return;
    var shadowRoot = ensure();
    if (!shadowRoot) return;
    startLoop();
    els.toast.textContent = '';
    els.toast.appendChild(document.createTextNode(text));
    if (sub) {
      var s = el('span', 'sub', sub);
      els.toast.appendChild(s);
    }
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
    els.anchor.classList.add('paneled');
    setBadge(null);
    DV.ui.refresh();
  }

  function hidePanel() {
    state.panel = false;
    if (els.panel) els.panel.hidden = true;
    if (els.anchor) els.anchor.classList.remove('paneled');
    DV.ui.refresh();
  }

  function togglePanel() {
    if (state.panel) hidePanel(); else showPanel();
  }

  /* Push the current video/settings state into the panel and badge. */
  function refresh() {
    startLoop();
    var s = state.settings;
    var v = state.video;
    var rate = v ? v.playbackRate : 1;
    setBadge(v && Math.abs(rate - 1) > 0.001 ? DV.util.round(rate, 2).toFixed(2) + '×' : null);
    if (!els.panel || els.panel.hidden) return;

    els.speedValue.textContent = DV.util.round(rate, 2).toFixed(2) + '×';
    els.seekBack.textContent = '⏪ ' + s.seekInterval + 's';
    els.seekFwd.textContent = s.seekInterval + 's ⏩';
    var fps = (DV.videos && v) ? DV.videos.fps(v) : s.fps;
    els.frameValue.textContent = Math.round(fps) + ' fps';
    els.maxBtn.textContent = state.maximized ? '⛶ Restore' : '⛶ Maximize';
    els.maxBtn.classList.toggle('on', state.maximized);

    var subs = state.subs;
    var loaded = subs.cues.length > 0;
    els.subsBtn.textContent = loaded ? (subs.name || 'Subtitles').slice(0, 22) : 'Load file…';
    els.syncRow.hidden = !loaded;
    if (loaded) {
      els.syncValue.textContent = DV.util.formatSigned(subs.offset) + 's';
      els.syncRow.querySelector('[data-act="subsToggle"]').classList.toggle('on', subs.enabled);
    }
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
