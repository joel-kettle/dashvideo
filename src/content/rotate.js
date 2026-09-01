/* DashVideo - turning the picture in 90 degree steps.

   The rotation is a transform on the <video> itself, scaled so the turned
   picture still fits the box the player gave it: a quarter turn swaps width
   for height, and without the scale a landscape picture would spill out over
   the page. That scale depends on the box, so it is recomputed whenever the
   box or the source changes - a window resize, a responsive player, a new
   source, and maximizing, which rewrites the video's inline styles wholesale. */
(function (root) {
  'use strict';

  var DV = (root.DV = root.DV || {});

  function rec(video) {
    return DV.videos.data(video);
  }

  function angleOf(video) {
    return video ? rec(video).rotation || 0 : 0;
  }

  function round(n) {
    return Math.round(n * 10000) / 10000;
  }

  /* The picture inside the video's box, once object-fit has had its say. */
  function picture(video, w, h) {
    var fit = 'contain';
    try {
      fit = getComputedStyle(video).objectFit || 'contain';
    } catch (e) { /* detached */ }
    var vw = video.videoWidth;
    var vh = video.videoHeight;
    if (!vw || !vh || (fit !== 'contain' && fit !== 'scale-down')) {
      return { w: w, h: h, fit: fit };
    }
    var scale = Math.min(w / vw, h / vh);
    if (fit === 'scale-down') scale = Math.min(scale, 1);
    return { w: vw * scale, h: vh * scale, fit: fit };
  }

  function transformFor(video) {
    var angle = angleOf(video);
    if (!angle) return '';
    var turn = 'rotate(' + angle + 'deg)';
    if (angle === 180) return turn;          /* a half turn keeps the box */

    /* offsetWidth/Height are the laid-out box: unlike getBoundingClientRect
       they ignore the transform we are about to write, so repeated calls all
       compute the same scale instead of shrinking the picture each time. */
    var w = video.offsetWidth;
    var h = video.offsetHeight;
    if (!(w > 0 && h > 0)) return turn;

    var pic = picture(video, w, h);
    /* Stretching ignores the aspect ratio by definition: scale each axis so
       the turned box lands back on the box it started from. */
    if (pic.fit === 'fill') return turn + ' scale(' + round(h / w) + ',' + round(w / h) + ')';
    /* Turned, the picture is pic.h wide and pic.w tall - shrink it until both
       of those fit inside the box. */
    return turn + ' scale(' + round(Math.min(w / pic.h, h / pic.w)) + ')';
  }

  /* Write the rotation the video is meant to have. Safe to call at any time:
     with no rotation it takes the transform back off. */
  function apply(video) {
    if (!video || !video.isConnected) return 0;
    var value = transformFor(video);
    if (value) {
      video.style.setProperty('transform', value, 'important');
      video.style.setProperty('transform-origin', 'center center', 'important');
    } else {
      video.style.removeProperty('transform');
      video.style.removeProperty('transform-origin');
    }
    return angleOf(video);
  }

  /* A scale is only right for the box it was measured from. */
  var sizes = null;

  function watch(video) {
    var r = rec(video);
    if (r.rotationWatched) return;
    r.rotationWatched = true;
    if (typeof ResizeObserver === 'function') {
      if (!sizes) {
        sizes = new ResizeObserver(function (entries) {
          for (var i = 0; i < entries.length; i++) apply(entries[i].target);
        });
      }
      /* Transforms do not affect layout, so re-applying one never feeds back
         into the observer. */
      sizes.observe(video);
    }
    /* Fires when the source's own dimensions change. */
    video.addEventListener('resize', function () { apply(video); }, true);
  }

  function set(video, angle) {
    if (!video) return 0;
    var next = ((Math.round(angle / 90) * 90) % 360 + 360) % 360;
    rec(video).rotation = next;
    watch(video);
    apply(video);
    if (DV.ui) DV.ui.refresh();
    return next;
  }

  function step(video, delta) {
    return set(video, angleOf(video) + delta);
  }

  /* The box the page laid out for the video, free of our own transform, so
     the overlay stays pinned to the player instead of following the picture
     as it turns. Rotating and scaling happen around the centre, which
     therefore stays put - enough to rebuild the original rectangle. */
  function box(video) {
    var rect = video.getBoundingClientRect();
    if (!angleOf(video)) return rect;
    var w = video.offsetWidth || rect.width;
    var h = video.offsetHeight || rect.height;
    var left = rect.left + rect.width / 2 - w / 2;
    var top = rect.top + rect.height / 2 - h / 2;
    return { left: left, top: top, width: w, height: h, right: left + w, bottom: top + h };
  }

  DV.rotate = {
    angle: angleOf,
    set: set,
    step: step,
    apply: apply,
    box: box
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
