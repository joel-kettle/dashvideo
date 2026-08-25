/* DashVideo - content script entry point: hotkeys, frame relaying and the
   message API used by the popup and the background service worker. */
(function (root) {
  'use strict';

  var DV = (root.DV = root.DV || {});
  var state = DV.state;
  var util = DV.util;

  var ready = false;
  var active = false;   /* false on blocked hosts or when globally disabled */

  /* ---- hotkeys --------------------------------------------------------- */

  function relayToChildFrames(id) {
    var frames = document.querySelectorAll('iframe, frame');
    for (var i = 0; i < frames.length; i++) {
      try {
        if (frames[i].contentWindow) {
          frames[i].contentWindow.postMessage({ __dashvideo: 'action', id: id }, '*');
        }
      } catch (e) { /* cross-origin frames still accept postMessage */ }
    }
  }

  function onKeyDown(e) {
    if (!ready || !active) return;
    if (e.defaultPrevented || e.isComposing || e.keyCode === 229) return;
    if (util.isEditable(e.target) || util.isEditable(document.activeElement)) return;

    if (e.code === 'Escape') {
      if (state.maximized) {
        DV.maximize.exit();
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      /* The video is in a child frame that we blew up on its behalf. */
      var framed = DV.maximize.filledFrameWindow();
      if (framed) {
        try {
          framed.postMessage({ __dashvideo: 'action', id: 'maximize' }, '*');
        } catch (err) { /* ignore */ }
        e.preventDefault();
        e.stopPropagation();
        return;
      }
    }

    var keys = state.settings.keys || {};
    var ids = Object.keys(keys);
    for (var i = 0; i < ids.length; i++) {
      if (!DV.hotkeys.matches(e, keys[ids[i]])) continue;
      var id = ids[i];
      if (!DV.actions.has(id)) return;

      if (!DV.videos.active()) {
        /* The video probably lives in a child frame - let it handle the key. */
        relayToChildFrames(id);
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      DV.actions.run(id);
      return;
    }
  }

  /* ---- the player's own fullscreen button ------------------------------ */

  function toPage(message) {
    try {
      window.postMessage(message, '*');
    } catch (e) { /* ignore */ }
  }

  /* The page-world hook parked the element behind an attribute for us. */
  function fullscreenRequest(id) {
    if (!/^\d+$/.test(String(id))) return null;
    var found = util.deepQueryAll('[data-dashvideo-fullscreen-request="' + id + '"]');
    return found[0] || null;
  }

  function onFullscreenRequest(id) {
    var element = fullscreenRequest(id);
    if (element) element.removeAttribute('data-dashvideo-fullscreen-request');

    if (!element || !ready || !active || !state.settings.replaceFullscreen) {
      toPage({ __dashvideo: 'fs-native', id: id });
      return;
    }

    /* The player hands us exactly the box it wanted blown up - use that
       instead of guessing a container from the video. */
    var video = element.tagName === 'VIDEO'
      ? element
      : util.deepQueryAll('video', element)[0] || DV.videos.active();

    if (!DV.maximize.enterElement(element, video, id)) {
      toPage({ __dashvideo: 'fs-native', id: id });
    }
  }

  /* ---- cross-frame messages ------------------------------------------- */

  function onWindowMessage(e) {
    var data = e.data;
    if (!data || typeof data !== 'object' || !data.__dashvideo) return;

    if (data.__dashvideo === 'fs-request') {
      onFullscreenRequest(data.id);
      return;
    }
    if (data.__dashvideo === 'fs-exit') {
      if (state.maximized) DV.maximize.exit();
      else toPage({ __dashvideo: 'fs-state', on: false, id: 0 });
      return;
    }
    if (data.__dashvideo === 'frame-maximize') {
      DV.maximize.fromChildFrame(e.source, data.on);
      return;
    }
    if (data.__dashvideo === 'action') {
      if (!active) return;
      if (DV.videos.active()) DV.actions.run(data.id);
      else relayToChildFrames(data.id);
    }
  }

  /* ---- popup / background messages ------------------------------------ */

  function handleMessage(msg, sender, sendResponse) {
    if (!msg || typeof msg.type !== 'string' || msg.type.indexOf('DV_') !== 0) return;
    if (!active) return;

    var hasVideo = !!DV.videos.active();

    switch (msg.type) {
      case 'DV_STATE':
        if (!hasVideo) return;
        sendResponse({ ok: true, state: DV.actions.snapshot() });
        return true;

      case 'DV_DO':
        if (!hasVideo) return;
        sendResponse(DV.actions.run(msg.action, msg.payload));
        return true;

      case 'DV_SET_SPEED':
        if (!hasVideo) return;
        DV.actions.setSpeed(Number(msg.value));
        sendResponse({ ok: true, state: DV.actions.snapshot() });
        return true;

      case 'DV_SUBS_LOAD':
        if (!hasVideo) return;
        var result = DV.subs.load(msg.text, msg.name);
        DV.ui.ensure();
        DV.ui.toast(result.ok ? 'Subtitles loaded' : 'No cues found',
          result.ok ? msg.name + ' · ' + result.count +
            (result.count === 1 ? ' cue' : ' cues') : msg.name);
        sendResponse({ ok: result.ok, count: result.count, state: DV.actions.snapshot() });
        return true;

      case 'DV_SUBS_OFFSET':
        if (!hasVideo) return;
        DV.subs.setOffset(msg.value);
        sendResponse({ ok: true, state: DV.actions.snapshot() });
        return true;

      case 'DV_PING':
        sendResponse({ ok: true, hasVideo: hasVideo });
        return true;
    }
  }

  /* ---- settings -------------------------------------------------------- */

  function applySettings(settings) {
    state.settings = settings;
    active = settings.enabled && !util.hostBlocked(settings.blocklist);
    /* The hook has to answer a fullscreen click synchronously, so it keeps its
       own copy of this flag. */
    toPage({ __dashvideo: 'fs-enabled', on: active && !!settings.replaceFullscreen });
    if (active && DV.ui.els.anchor) DV.ui.refresh();
  }

  function start() {
    DV.ui.onAction = function (id) {
      DV.actions.run(id);
    };

    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('message', onWindowMessage, false);

    try {
      chrome.runtime.onMessage.addListener(handleMessage);
    } catch (e) { /* extension context not available in this frame */ }

    DV.videos.observe();

    DV.settings.get().then(function (settings) {
      applySettings(settings);
      ready = true;
      if (active && settings.panelDefaultVisible && DV.videos.active()) DV.ui.showPanel();
    });

    DV.settings.onChange(applySettings);

    /* Keep the overlay attached when a site swaps out large parts of the DOM. */
    document.addEventListener('DOMContentLoaded', function () {
      if (active && (state.panel || state.subs.cues.length)) DV.ui.ensure();
    }, { once: true });
  }

  start();
})(typeof globalThis !== 'undefined' ? globalThis : window);
