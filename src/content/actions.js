/* DashVideo - the actions behind hotkeys, the overlay panel and the popup. */
(function (root) {
  'use strict';

  var DV = (root.DV = root.DV || {});
  var state = DV.state;
  var util = DV.util;

  function video() {
    return DV.videos.active();
  }

  function timeLabel(v) {
    if (!v) return '';
    if (!isFinite(v.duration)) return util.formatTime(v.currentTime);
    return util.formatTime(v.currentTime) + ' / ' + util.formatTime(v.duration);
  }

  function seekBy(v, seconds) {
    var max = isFinite(v.duration) && v.duration > 0 ? v.duration : Number.MAX_SAFE_INTEGER;
    var target = util.clamp(v.currentTime + seconds, 0, Math.max(0, max - 0.01));
    try {
      v.currentTime = target;
    } catch (e) {
      return false;
    }
    DV.ui.toast((seconds < 0 ? '⏪ ' : '⏩ ') + util.round(Math.abs(seconds), 2) + 's', timeLabel(v));
    return true;
  }

  function frameStep(v, direction) {
    var fps = DV.videos.fps(v);
    var step = 1 / fps;
    if (!v.paused) v.pause();
    var frames = Math.round(v.currentTime / step) + direction;
    var target = util.clamp(frames * step + step * 0.25, 0,
      isFinite(v.duration) ? Math.max(0, v.duration - step * 0.5) : Number.MAX_SAFE_INTEGER);
    try {
      v.currentTime = target;
    } catch (e) {
      return false;
    }
    DV.ui.toast(direction < 0 ? '◀❘ frame' : '❘▶ frame',
      util.formatTime(v.currentTime) + ' · frame ' + Math.max(0, frames) + ' · ' +
      util.round(fps, 3) + ' fps');
    return true;
  }

  function changeSpeed(v, delta) {
    var rate = DV.videos.setRate(v, v.playbackRate + delta);
    DV.ui.toast(util.round(rate, 2).toFixed(2) + '×', 'Playback speed');
    DV.ui.refresh();
    return rate;
  }

  function setSpeed(v, value) {
    var rate = DV.videos.setRate(v, value);
    DV.ui.toast(util.round(rate, 2).toFixed(2) + '×', 'Playback speed');
    DV.ui.refresh();
    return rate;
  }

  function snapshot() {
    var v = state.video && state.video.isConnected ? state.video : DV.videos.best();
    var subs = state.subs;
    return {
      hasVideo: !!v,
      rate: v ? util.round(v.playbackRate, 2) : 1,
      currentTime: v ? v.currentTime : 0,
      duration: v && isFinite(v.duration) ? v.duration : 0,
      paused: v ? v.paused : true,
      muted: v ? v.muted : false,
      width: v ? v.videoWidth : 0,
      height: v ? v.videoHeight : 0,
      fps: v ? util.round(DV.videos.fps(v), 3) : state.settings.fps,
      maximized: !!state.maximized,
      fit: state.settings.maximizeFit,
      panel: !!state.panel,
      subs: {
        loaded: subs.cues.length > 0,
        count: subs.cues.length,
        name: subs.name,
        offset: subs.offset,
        enabled: subs.enabled
      }
    };
  }

  var FIT_LABELS = { contain: '⛶ Fit', cover: '⛶ Zoom to fill', fill: '⛶ Stretch' };
  var FIT_HINTS = {
    contain: 'Whole picture, black bars',
    cover: 'Fills the tab, edges cropped',
    fill: 'Fills the tab, aspect ratio ignored'
  };

  var handlers = {
    seekBack: function (v, s) { return seekBy(v, -s.seekInterval); },
    seekForward: function (v, s) { return seekBy(v, s.seekInterval); },
    seekBackLong: function (v, s) { return seekBy(v, -s.seekIntervalLong); },
    seekForwardLong: function (v, s) { return seekBy(v, s.seekIntervalLong); },
    frameBack: function (v) { return frameStep(v, -1); },
    frameForward: function (v) { return frameStep(v, 1); },
    speedDown: function (v, s) { return changeSpeed(v, -s.speedStep); },
    speedUp: function (v, s) { return changeSpeed(v, s.speedStep); },
    speedReset: function (v, s) { return setSpeed(v, s.speedDefault); },
    playPause: function (v) {
      if (v.paused) {
        var play = v.play();
        if (play && play.catch) play.catch(function () {});
        DV.ui.toast('▶ Play', timeLabel(v));
      } else {
        v.pause();
        DV.ui.toast('❚❚ Pause', timeLabel(v));
      }
      return true;
    },
    mute: function (v) {
      v.muted = !v.muted;
      DV.ui.toast(v.muted ? '🔇 Muted' : '🔊 Unmuted');
      return true;
    },
    maximize: function (v) {
      var on = DV.maximize.toggle(v);
      DV.ui.toast(on ? '⛶ Maximized' : '⛶ Restored', on ? 'Press Esc to restore' : '');
      return true;
    },
    maximizeFit: function (v, s) {
      var order = ['contain', 'cover', 'fill'];
      var next = order[(order.indexOf(s.maximizeFit) + 1) % order.length] || 'contain';
      s.maximizeFit = next;
      DV.maximize.applyFit(v);
      DV.settings.set({ maximizeFit: next });
      DV.ui.toast(FIT_LABELS[next], FIT_HINTS[next]);
      return true;
    },
    panelToggle: function () {
      DV.ui.togglePanel();
      return true;
    },
    subsLoad: function () {
      var ok = DV.subs.pickFile();
      if (!ok) DV.ui.toast('Could not open file picker');
      return ok;
    },
    subsToggle: function () {
      if (!state.subs.cues.length) {
        DV.ui.toast('No subtitles loaded', 'Load a .srt, .vtt or .ass file');
        return false;
      }
      var on = DV.subs.toggle();
      DV.ui.toast(on ? 'Subtitles on' : 'Subtitles off', state.subs.name);
      return true;
    },
    subsDelayMinus: function (v, s) {
      if (!state.subs.cues.length) return false;
      var offset = DV.subs.shift(-s.subsSyncStep);
      DV.ui.toast('Subtitles ' + util.formatSigned(offset) + 's', 'Negative = show earlier');
      return true;
    },
    subsDelayPlus: function (v, s) {
      if (!state.subs.cues.length) return false;
      var offset = DV.subs.shift(s.subsSyncStep);
      DV.ui.toast('Subtitles ' + util.formatSigned(offset) + 's', 'Positive = show later');
      return true;
    },
    subsClear: function () {
      DV.subs.clear();
      DV.ui.toast('Subtitles removed');
      return true;
    }
  };

  /* Actions that make sense even when this frame has no video. */
  var VIDEOLESS = { panelToggle: 1, subsLoad: 1 };

  function run(id, payload) {
    var handler = handlers[id];
    if (!handler) return { ok: false, reason: 'unknown-action' };

    var v = video();
    if (!v && !VIDEOLESS[id]) return { ok: false, reason: 'no-video' };

    DV.ui.ensure();
    var ok = false;
    try {
      ok = handler(v, state.settings, payload) !== false;
    } catch (e) {
      ok = false;
    }
    DV.ui.refresh();
    return { ok: ok, state: snapshot() };
  }

  DV.actions = {
    run: run,
    snapshot: snapshot,
    setSpeed: function (value) {
      var v = video();
      if (!v) return null;
      return setSpeed(v, value);
    },
    seekBy: function (seconds) {
      var v = video();
      if (!v) return false;
      return seekBy(v, seconds);
    },
    has: function (id) { return !!handlers[id]; }
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
