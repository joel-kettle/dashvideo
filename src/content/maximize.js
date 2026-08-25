/* DashVideo - in-tab maximizing.

   Pinning the <video> alone is not enough: any ancestor that forms a stacking
   context (a transform, a filter, `isolation`, or simply a flex item with a
   z-index) traps the fixed element inside it, so the video ends up painted
   below the rest of the page - a black screen. The fix, the same one the
   Windowed extension uses, is to wipe the ancestors with `all: initial`, which
   removes those stacking contexts altogether instead of trying to out-stack
   them.

   What gets promoted is the player container rather than the bare video - the
   closest ancestor that still has the video's box - so the site's own control
   bar comes along and stays usable, exactly like native fullscreen.

   Styles are written inline with !important: that beats any author rule,
   reaches players living in a shadow root, and restores exactly, because the
   whole `style` attribute is stashed and put back. */
(function (root) {
  'use strict';

  var DV = (root.DV = root.DV || {});
  var state = DV.state;

  var Z = 2147483646;                    /* just below the DashVideo overlay */

  /* Everything that can clip, hide or trap a fixed descendant. */
  var CLEAN = {
    transform: 'none',
    filter: 'none',
    'backdrop-filter': 'none',
    perspective: 'none',
    contain: 'none',
    'will-change': 'auto',
    isolation: 'auto',
    'mix-blend-mode': 'normal',
    mask: 'none',
    'clip-path': 'none',
    opacity: '1',
    'transform-style': 'flat'
  };

  var TARGET = Object.assign({}, CLEAN, {
    position: 'fixed',
    left: '0px',
    top: '0px',
    right: 'auto',
    bottom: 'auto',
    width: '100%',
    height: '100%',
    'min-width': '0',
    'min-height': '0',
    'max-width': 'none',
    'max-height': 'none',
    margin: '0',
    padding: '0',
    border: '0',
    'border-radius': '0',
    'z-index': String(Z),
    background: '#000',
    display: 'block',
    visibility: 'visible',
    overflow: 'visible',
    float: 'none',
    'pointer-events': 'auto'
  });

  /* Wrappers between the container and the video just have to get out of the
     way and fill their parent. */
  var WRAP = Object.assign({}, CLEAN, {
    position: 'absolute',
    left: '0px',
    top: '0px',
    right: 'auto',
    bottom: 'auto',
    width: '100%',
    height: '100%',
    'min-width': '0',
    'min-height': '0',
    'max-width': 'none',
    'max-height': 'none',
    margin: '0',
    padding: '0',
    border: '0',
    display: 'block',
    visibility: 'visible',
    overflow: 'visible',
    'z-index': 'auto'
  });

  var VIDEO = Object.assign({}, WRAP, {
    background: '#000',
    'border-radius': '0',
    'object-position': 'center center'
  });

  var ROOT = Object.assign({}, CLEAN, { overflow: 'hidden' });

  /* own = this frame maximized its own video; frame = this frame maximized a
     child <iframe> on behalf of a descendant. */
  var own = null;
  var frame = null;

  var MARK = 'data-dashvideo-promoted';

  /* Save the whole style attribute: `all: initial` collapses every longhand in
     the declaration, so per-property restores would lose the site's own inline
     values. An empty attribute counts as none, so restoring never leaves a bare
     style="" behind. */
  function stash(el) {
    var previous = el.getAttribute('style');
    if (previous === '') previous = null;
    el.setAttribute(MARK, '');
    return function restore() {
      if (previous === null) {
        el.removeAttribute('style');
        /* Chrome serialises the emptied declaration straight back into an
           empty style="" - clearing it again leaves the element untouched. */
        if (el.getAttribute('style') === '') el.removeAttribute('style');
      } else {
        el.setAttribute('style', previous);
      }
      el.removeAttribute(MARK);
    };
  }

  /* Never touch the same element twice: a duplicate frame-maximize message
     would otherwise stash styles we had already replaced. */
  function promoted(el) {
    return el.hasAttribute(MARK);
  }

  function assign(el, props) {
    Object.keys(props).forEach(function (prop) {
      el.style.setProperty(prop, props[prop], 'important');
    });
  }

  function parentOf(node) {
    var parent = node.parentNode;
    if (parent && parent.nodeType === 11 && parent.host) return parent.host;   /* shadow root */
    return parent && parent.nodeType === 1 ? parent : null;
  }

  /* Climb to the player: the outermost ancestor that is still essentially the
     video's own box. Wrappers match it exactly; a player that letterboxes the
     video is a little larger and brings its control bar with it. Anything that
     starts to look like page layout - much bigger than the video, or bigger
     than the viewport - ends the climb. */
  function pickContainer(video) {
    var rect = video.getBoundingClientRect();
    if (rect.width < 4 || rect.height < 4) return video;

    var area = rect.width * rect.height;
    var maxWidth = (window.innerWidth || rect.width) * 1.05;
    var maxHeight = (window.innerHeight || rect.height) * 1.05;

    var best = video;
    var node = parentOf(video);
    var hops = 0;

    while (node && hops++ < 12) {
      if (node === document.body || node === document.documentElement) break;
      var r = node.getBoundingClientRect();
      var wraps = r.left <= rect.left + 2 && r.top <= rect.top + 2 &&
        r.right >= rect.right - 2 && r.bottom >= rect.bottom - 2;
      if (!wraps) break;
      if (r.width * r.height > area * 1.7) break;
      if (r.width > maxWidth || r.height > maxHeight) break;
      best = node;
      node = parentOf(node);
    }
    return best;
  }

  function fitMode() {
    var fit = state.settings.maximizeFit;
    return fit === 'cover' || fit === 'fill' ? fit : 'contain';
  }

  /* Promote `target` to fill the tab, clearing everything above it. */
  function promote(target, video) {
    var restores = [];
    var take = function (el, props) {
      if (promoted(el)) return;
      restores.push(stash(el));
      assign(el, props);
    };

    take(target, TARGET);

    if (video && video !== target) {
      /* Wrappers between the container and the video get out of the way, then
         the video fills what is left. The loop stops at the container - never
         above it, or it would drag <body> along. */
      var node = parentOf(video);
      while (node && node !== target &&
             node !== document.body && node !== document.documentElement) {
        take(node, WRAP);
        node = parentOf(node);
      }
      take(video, Object.assign({ 'object-fit': fitMode() }, VIDEO));
    } else if (video) {
      video.style.setProperty('object-fit', fitMode(), 'important');
    }

    /* `all: initial` leaves no stacking context, no clipping and no transform
       for the fixed target to be trapped in. */
    var ancestor = parentOf(target);
    while (ancestor) {
      if (ancestor === document.body || ancestor === document.documentElement) {
        take(ancestor, ROOT);
      } else if (!promoted(ancestor)) {
        restores.push(stash(ancestor));
        ancestor.style.setProperty('all', 'initial', 'important');
      }
      ancestor = parentOf(ancestor);
    }

    return {
      element: target,
      video: video || null,
      undo: function () {
        for (var i = restores.length - 1; i >= 0; i--) restores[i]();
      }
    };
  }

  var TARGET_ATTR = 'data-dashvideo-fullscreen';

  /* The page-world hook mirrors this back to the site as
     document.fullscreenElement plus a fullscreenchange event. */
  function tellPage(on, requestId) {
    try {
      window.postMessage({ __dashvideo: 'fs-state', on: !!on, id: requestId || 0 }, '*');
    } catch (e) { /* ignore */ }
  }

  function bubble(on) {
    if (window === window.top) return;
    try {
      window.parent.postMessage({ __dashvideo: 'frame-maximize', on: !!on }, '*');
    } catch (e) { /* ignore */ }
  }

  function settle() {
    window.dispatchEvent(new Event('resize'));
    /* Players that lay themselves out on the next frame need a second nudge. */
    setTimeout(function () { window.dispatchEvent(new Event('resize')); }, 120);
  }

  function enter(video) {
    if (!video) return false;
    return enterElement(pickContainer(video), video, 0);
  }

  /* Used by the hotkey (with the container DashVideo picked) and by the
     fullscreen hook (with the element the player asked to blow up). */
  function enterElement(target, video, requestId) {
    if (own) {
      /* Already maximized - a fullscreen request just confirms the state. */
      tellPage(true, requestId);
      return true;
    }
    if (!target) return false;
    own = promote(target, video || null);
    own.element.setAttribute(TARGET_ATTR, '');
    state.maximized = true;
    bubble(true);
    tellPage(true, requestId);
    if (DV.ui) {
      DV.ui.ensure();
      DV.ui.refresh();
    }
    settle();
    return true;
  }

  function exit() {
    if (!own) return false;
    own.element.removeAttribute(TARGET_ATTR);
    own.undo();
    own = null;
    state.maximized = false;
    bubble(false);
    tellPage(false, 0);
    if (DV.ui) DV.ui.refresh();
    settle();
    return true;
  }

  function toggle(video) {
    return own ? (exit(), false) : (enter(video), true);
  }

  /* Re-apply the fit without leaving maximized mode. */
  function applyFit(video) {
    var target = video || (own && own.video);
    if (!target) return fitMode();
    target.style.setProperty('object-fit', fitMode(), 'important');
    return fitMode();
  }

  /* A descendant frame asked us to maximize the iframe that contains it. */
  function fromChildFrame(source, on) {
    if (!on) {
      if (frame) {
        frame.undo();
        frame = null;
        bubble(false);
        settle();
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
        frame = promote(candidate, null);
        bubble(true);
        settle();
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
    enterElement: enterElement,
    exit: exit,
    toggle: toggle,
    applyFit: applyFit,
    isMaximized: isMaximized,
    fromChildFrame: fromChildFrame,
    filledFrameWindow: filledFrameWindow
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
