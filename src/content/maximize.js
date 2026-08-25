/* DashVideo - in-tab maximizing.

   The video is pinned to the viewport with inline !important styles (inline so
   it also works for players living inside a shadow root), ancestors that would
   trap a fixed element - transforms, filters, `contain` - are neutralised, and
   a black backdrop covers the page underneath. When the video sits in an
   iframe, the frame asks its parent to give the same treatment to the <iframe>
   element itself so the video really fills the tab, not just the frame. */
(function (root) {
  'use strict';

  var DV = (root.DV = root.DV || {});
  var state = DV.state;

  var Z_VIDEO = 2147483640;
  var Z_BACKDROP = 2147483639;

  var TRAPPING = ['transform', 'filter', 'backdrop-filter', 'perspective', 'contain',
    'will-change', 'mask', 'clip-path', 'transform-style'];

  var NEUTRAL = {
    transform: 'none',
    filter: 'none',
    'backdrop-filter': 'none',
    perspective: 'none',
    contain: 'none',
    'will-change': 'auto',
    mask: 'none',
    'clip-path': 'none',
    'transform-style': 'flat',
    opacity: '1'
  };

  var FILL = {
    position: 'fixed',
    left: '0px',
    top: '0px',
    right: 'auto',
    bottom: 'auto',
    width: '100vw',
    height: '100vh',
    'max-width': '100vw',
    'max-height': '100vh',
    'min-width': '0',
    'min-height': '0',
    margin: '0',
    padding: '0',
    border: '0',
    'border-radius': '0',
    'z-index': String(Z_VIDEO),
    background: '#000',
    'object-fit': 'contain',
    transform: 'none',
    'clip-path': 'none',
    display: 'block',
    visibility: 'visible',
    opacity: '1'
  };

  /* own = this frame maximized its own video; frame = this frame maximized a
     child <iframe> on behalf of a descendant. */
  var own = null;
  var frame = null;

  function applyStyle(el, props) {
    var saved = [];
    Object.keys(props).forEach(function (prop) {
      saved.push([prop, el.style.getPropertyValue(prop), el.style.getPropertyPriority(prop)]);
      el.style.setProperty(prop, props[prop], 'important');
    });
    return function restore() {
      saved.forEach(function (entry) {
        if (entry[1]) el.style.setProperty(entry[0], entry[1], entry[2]);
        else el.style.removeProperty(entry[0]);
      });
    };
  }

  function ancestors(el) {
    var out = [];
    var node = el.parentNode;
    while (node) {
      if (node.nodeType === 1) out.push(node);
      if (node.nodeType === 11 && node.host) node = node.host;      /* leave shadow root */
      else node = node.parentNode;
    }
    return out;
  }

  function neutralize(el) {
    var style;
    try {
      style = getComputedStyle(el);
    } catch (e) {
      return null;
    }
    var props = null;
    var trapping = TRAPPING.some(function (p) {
      var value = style.getPropertyValue(p);
      return value && value !== 'none' && value !== 'auto' && value !== 'flat';
    }) || Number(style.opacity) < 1;

    if (trapping) props = Object.assign({}, NEUTRAL);

    /* An ancestor stacking context would otherwise paint over the video. */
    if (style.position !== 'static' && style.zIndex !== 'auto') {
      props = props || {};
      props['z-index'] = String(Z_VIDEO);
    }
    return props ? applyStyle(el, props) : null;
  }

  function makeBackdrop() {
    var backdrop = document.createElement('div');
    backdrop.setAttribute('data-dashvideo-backdrop', '');
    backdrop.style.cssText = 'all: initial !important; position: fixed !important;' +
      'left: 0 !important; top: 0 !important; width: 100% !important; height: 100% !important;' +
      'background: #000 !important; z-index: ' + Z_BACKDROP + ' !important;';
    (document.body || document.documentElement).appendChild(backdrop);
    return backdrop;
  }

  function fill(el) {
    var restores = [applyStyle(el, FILL)];
    ancestors(el).forEach(function (node) {
      var undo = neutralize(node);
      if (undo) restores.push(undo);
    });
    var docEl = document.documentElement;
    if (docEl) restores.push(applyStyle(docEl, { overflow: 'hidden' }));
    if (document.body) restores.push(applyStyle(document.body, { overflow: 'hidden' }));
    var backdrop = makeBackdrop();
    return {
      element: el,
      undo: function () {
        restores.forEach(function (fn) { fn(); });
        if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
      }
    };
  }

  function bubble(on) {
    if (window === window.top) return;
    try {
      window.parent.postMessage({ __dashvideo: 'frame-maximize', on: !!on }, '*');
    } catch (e) { /* ignore */ }
  }

  function enter(video) {
    if (own) return true;
    if (!video) return false;
    own = fill(video);
    state.maximized = true;
    bubble(true);
    if (DV.ui) {
      DV.ui.ensure();
      DV.ui.refresh();
    }
    window.dispatchEvent(new Event('resize'));
    return true;
  }

  function exit() {
    if (!own) return false;
    own.undo();
    own = null;
    state.maximized = false;
    bubble(false);
    if (DV.ui) DV.ui.refresh();
    window.dispatchEvent(new Event('resize'));
    return true;
  }

  function toggle(video) {
    return own ? (exit(), false) : (enter(video), true);
  }

  /* A descendant frame asked us to maximize the iframe that contains it. */
  function fromChildFrame(source, on) {
    if (!on) {
      if (frame) {
        frame.undo();
        frame = null;
        bubble(false);
      }
      return;
    }
    if (frame) return;
    var frames = document.querySelectorAll('iframe, frame');
    for (var i = 0; i < frames.length; i++) {
      var candidate = frames[i];
      var win = null;
      try {
        win = candidate.contentWindow;
      } catch (e) {
        win = null;
      }
      if (win && win === source) {
        frame = fill(candidate);
        bubble(true);
        return;
      }
    }
  }

  function isMaximized() {
    return !!own;
  }

  /* The window of the child frame we are currently blowing up, if any - used
     to forward Escape down to the frame that owns the video. */
  function filledFrameWindow() {
    if (!frame) return null;
    try {
      return frame.element.contentWindow;
    } catch (e) {
      return null;
    }
  }

  DV.maximize = {
    enter: enter,
    exit: exit,
    toggle: toggle,
    isMaximized: isMaximized,
    fromChildFrame: fromChildFrame,
    filledFrameWindow: filledFrameWindow
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
