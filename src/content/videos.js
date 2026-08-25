/* DashVideo - finding the video the user means, frame rate detection and
   playback-rate keeping. */
(function (root) {
  'use strict';

  var DV = (root.DV = root.DV || {});
  var state = DV.state;
  var util = DV.util;

  var store = new WeakMap();
  var COMMON_FPS = [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60, 90, 120];

  function data(video) {
    var rec = store.get(video);
    if (!rec) {
      rec = { fps: 0, detecting: false, desiredRate: 0, guard: false, lastTouched: 0 };
      store.set(video, rec);
    }
    return rec;
  }

  function all() {
    return util.deepQueryAll('video');
  }

  function score(video) {
    if (!util.isVisible(video)) return 0;
    var rect = video.getBoundingClientRect();
    var area = rect.width * rect.height;
    if (area < 400) return 0;
    var vw = window.innerWidth || 1;
    var vh = window.innerHeight || 1;
    var visibleW = Math.max(0, Math.min(rect.right, vw) - Math.max(rect.left, 0));
    var visibleH = Math.max(0, Math.min(rect.bottom, vh) - Math.max(rect.top, 0));
    var onScreen = (visibleW * visibleH) / area;
    var s = area * (0.25 + onScreen);
    if (!video.paused && !video.ended) s *= 3;
    if (video.readyState >= 2) s *= 1.5;
    if (data(video).lastTouched) s *= 1.2;
    return s;
  }

  function best() {
    var videos = all();
    var winner = null;
    var top = 0;
    for (var i = 0; i < videos.length; i++) {
      var s = score(videos[i]);
      if (s > top) {
        top = s;
        winner = videos[i];
      }
    }
    if (winner) return winner;
    /* Nothing visible: fall back to any media that could still be controlled. */
    for (var j = 0; j < videos.length; j++) {
      if (videos[j].readyState > 0 || videos[j].currentSrc) return videos[j];
    }
    return videos[0] || null;
  }

  function active() {
    var current = state.video;
    if (current && current.isConnected && util.isVisible(current)) {
      /* Keep the current pick unless something clearly better is playing. */
      if (!current.paused) return current;
      var candidate = best();
      if (candidate && candidate !== current && !candidate.paused) {
        state.video = candidate;
        return candidate;
      }
      return current;
    }
    state.video = best();
    return state.video;
  }

  function setActive(video) {
    if (!video) return;
    data(video).lastTouched = Date.now();
    if (state.video !== video) {
      state.video = video;
      if (DV.ui) DV.ui.refresh();
    }
  }

  function has() {
    return !!active();
  }

  /* ---- frame rate ------------------------------------------------------ */

  function snap(fps) {
    for (var i = 0; i < COMMON_FPS.length; i++) {
      if (Math.abs(fps - COMMON_FPS[i]) / COMMON_FPS[i] < 0.06) return COMMON_FPS[i];
    }
    return Math.round(fps * 100) / 100;
  }

  function detectFps(video) {
    var rec = data(video);
    if (rec.fps || rec.detecting) return;
    if (typeof video.requestVideoFrameCallback !== 'function') return;
    rec.detecting = true;

    var deltas = [];
    var previous = null;
    var frames = 0;

    var step = function (now, meta) {
      var mediaTime = meta && typeof meta.mediaTime === 'number' ? meta.mediaTime : video.currentTime;
      if (previous !== null) {
        var d = mediaTime - previous;
        if (d > 0.0005 && d < 0.5) deltas.push(d);
      }
      previous = mediaTime;
      frames++;
      if (deltas.length >= 15 || frames > 60) {
        rec.detecting = false;
        if (deltas.length >= 5) {
          deltas.sort(function (a, b) { return a - b; });
          var median = deltas[Math.floor(deltas.length / 2)];
          if (median > 0) rec.fps = snap(1 / median);
          if (DV.ui) DV.ui.refresh();
        }
        return;
      }
      try {
        video.requestVideoFrameCallback(step);
      } catch (e) {
        rec.detecting = false;
      }
    };

    try {
      video.requestVideoFrameCallback(step);
    } catch (e) {
      rec.detecting = false;
    }
  }

  function fps(video) {
    var settings = state.settings;
    if (!video) return settings.fps || 30;
    var rec = data(video);
    if (settings.fpsAuto && rec.fps) return rec.fps;
    return settings.fps || 30;
  }

  /* ---- playback rate --------------------------------------------------- */

  function setRate(video, rate) {
    if (!video) return 1;
    var settings = state.settings;
    var value = util.clamp(util.round(rate, 2), settings.speedMin, settings.speedMax);
    var rec = data(video);
    rec.desiredRate = value;
    rec.guard = true;
    try {
      video.playbackRate = value;
    } catch (e) { /* some players reject extreme rates */ }
    setTimeout(function () { rec.guard = false; }, 50);
    return video.playbackRate;
  }

  function onRateChange(e) {
    var video = e.target;
    var rec = data(video);
    if (!state.settings.keepSpeed || rec.guard || !rec.desiredRate) {
      if (DV.ui) DV.ui.refresh();
      return;
    }
    /* Players such as Netflix or YouTube reset the rate on quality or source
       changes - put the user's choice back. */
    if (Math.abs(video.playbackRate - rec.desiredRate) > 0.01) {
      rec.guard = true;
      try {
        video.playbackRate = rec.desiredRate;
      } catch (err) { /* ignore */ }
      setTimeout(function () { rec.guard = false; }, 50);
    }
    if (DV.ui) DV.ui.refresh();
  }

  function attach(video) {
    var rec = data(video);
    if (rec.attached) return;
    rec.attached = true;
    video.addEventListener('ratechange', onRateChange, true);
    video.addEventListener('playing', function () {
      setActive(video);
      detectFps(video);
      var r = data(video);
      if (state.settings.keepSpeed && r.desiredRate &&
          Math.abs(video.playbackRate - r.desiredRate) > 0.01) {
        setRate(video, r.desiredRate);
      }
    }, true);
    video.addEventListener('pointerdown', function () { setActive(video); }, true);
    video.addEventListener('loadedmetadata', function () {
      rec.fps = 0;
      detectFps(video);
    }, true);
    if (!video.paused) {
      setActive(video);
      detectFps(video);
    }
  }

  function scan() {
    var videos = all();
    for (var i = 0; i < videos.length; i++) attach(videos[i]);
    if (!state.video || !state.video.isConnected) state.video = best();
  }

  function observe() {
    scan();
    var pending = false;
    var observer = new MutationObserver(function () {
      if (pending) return;
      pending = true;
      setTimeout(function () {
        pending = false;
        scan();
      }, 250);
    });
    var start = function () {
      observer.observe(document.documentElement, { childList: true, subtree: true });
      scan();
    };
    if (document.documentElement) start();
    else document.addEventListener('DOMContentLoaded', start, { once: true });
    document.addEventListener('play', function (e) {
      if (e.target && e.target.tagName === 'VIDEO') {
        attach(e.target);
        setActive(e.target);
      }
    }, true);
  }

  DV.videos = {
    all: all,
    best: best,
    active: active,
    setActive: setActive,
    has: has,
    fps: fps,
    setRate: setRate,
    detectFps: detectFps,
    observe: observe,
    data: data
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
