/* DashVideo - external subtitle track: file loading and on-video rendering.

   Cues are drawn by DashVideo itself rather than handed to a <track> element:
   that works on cross-origin streams, survives players that rebuild their own
   text tracks, and lets the timing be nudged while watching. */
(function (root) {
  'use strict';

  var DV = (root.DV = root.DV || {});
  var state = DV.state;
  var util = DV.util;

  var lastCue = null;
  var lastIndex = 0;
  var input = null;

  function subs() {
    return state.subs;
  }

  function markup(text) {
    return util.escapeHtml(text)
      .replace(/&lt;(\/?)(i|b|u)&gt;/gi, '<$1$2>')
      .split('\n')
      .filter(function (line) { return line.trim() !== ''; })
      .map(function (line) { return '<span class="cue">' + line + '</span>'; })
      .join('<br>');
  }

  function findCue(cues, time) {
    if (!cues.length) return null;
    /* The playhead usually moves forward a little, so try the neighbourhood of
       the previous hit before falling back to a binary search. */
    for (var i = Math.max(0, lastIndex - 1); i < Math.min(cues.length, lastIndex + 3); i++) {
      if (time >= cues[i].start && time <= cues[i].end) {
        lastIndex = i;
        return cues[i];
      }
    }
    var lo = 0;
    var hi = cues.length - 1;
    while (lo <= hi) {
      var mid = (lo + hi) >> 1;
      if (time < cues[mid].start) hi = mid - 1;
      else if (time > cues[mid].end) lo = mid + 1;
      else {
        lastIndex = mid;
        return cues[mid];
      }
    }
    lastIndex = Math.max(0, Math.min(cues.length - 1, lo));
    return null;
  }

  function tick(video, rect) {
    var els = DV.ui.els;
    if (!els.subs) return;
    var data = subs();
    var active = data.enabled && data.cues.length > 0 && video && video.isConnected;
    if (!active) {
      if (!els.subs.hidden) {
        els.subs.hidden = true;
        els.subsBox.innerHTML = '';
        lastCue = null;
      }
      return;
    }
    els.subs.hidden = false;

    var settings = state.settings;
    var size = util.clamp(rect.height * (settings.subsFontSize / 100), 12, 96);
    var box = els.subsBox.style;
    box.fontSize = size.toFixed(1) + 'px';
    box.bottom = Math.round(rect.height * (settings.subsBottom / 100)) + 'px';
    box.color = settings.subsColor;
    box.textShadow = settings.subsOutline
      ? '0 0 3px rgba(0,0,0,.9), 0 1px 2px rgba(0,0,0,.9), 0 0 1px rgba(0,0,0,1)'
      : 'none';

    var cue = findCue(data.cues, video.currentTime - data.offset);
    if (cue === lastCue) {
      applyCueBackground(settings);
      return;
    }
    lastCue = cue;
    els.subsBox.innerHTML = cue ? markup(cue.text) : '';
    applyCueBackground(settings);
  }

  function applyCueBackground(settings) {
    var spans = DV.ui.els.subsBox.querySelectorAll('.cue');
    var background = 'rgba(0, 0, 0, ' + util.clamp(settings.subsBgOpacity, 0, 1) + ')';
    for (var i = 0; i < spans.length; i++) spans[i].style.background = background;
  }

  function load(text, name) {
    var parsed = DV.subParser.parse(text, name);
    if (!parsed.cues.length) return { ok: false, count: 0, format: parsed.format };
    var data = subs();
    data.cues = parsed.cues;
    data.name = name || 'subtitles';
    data.offset = 0;
    data.enabled = true;
    lastCue = null;
    lastIndex = 0;
    DV.ui.ensure();
    DV.ui.refresh();
    return { ok: true, count: parsed.cues.length, format: parsed.format };
  }

  function clear() {
    var data = subs();
    data.cues = [];
    data.name = '';
    data.offset = 0;
    lastCue = null;
    lastIndex = 0;
    if (DV.ui.els.subsBox) DV.ui.els.subsBox.innerHTML = '';
    DV.ui.refresh();
  }

  function toggle(force) {
    var data = subs();
    data.enabled = typeof force === 'boolean' ? force : !data.enabled;
    lastCue = null;
    DV.ui.refresh();
    return data.enabled;
  }

  function shift(delta) {
    var data = subs();
    data.offset = util.round(data.offset + delta, 2);
    lastCue = null;
    DV.ui.refresh();
    return data.offset;
  }

  function setOffset(value) {
    var data = subs();
    data.offset = util.round(Number(value) || 0, 2);
    lastCue = null;
    DV.ui.refresh();
    return data.offset;
  }

  function readFile(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onerror = function () { reject(reader.error); };
      reader.onload = function () {
        resolve(DV.subParser.decode(reader.result));
      };
      reader.readAsArrayBuffer(file);
    });
  }

  /* Must be called from a user gesture (a hotkey or a click). */
  function pickFile() {
    if (!input) {
      input = document.createElement('input');
      input.type = 'file';
      input.accept = '.srt,.vtt,.ass,.ssa,.sbv,.txt,text/vtt,application/x-subrip';
      input.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;opacity:0';
      input.addEventListener('change', function () {
        var file = input.files && input.files[0];
        input.value = '';
        if (!file) return;
        readFile(file).then(function (text) {
          var result = load(text, file.name);
          DV.ui.toast(result.ok ? 'Subtitles loaded' : 'No cues found',
            result.ok ? file.name + ' · ' + result.count +
              (result.count === 1 ? ' cue' : ' cues') : file.name);
        }).catch(function () {
          DV.ui.toast('Could not read file', file.name);
        });
      });
      (document.body || document.documentElement).appendChild(input);
    }
    try {
      input.click();
      return true;
    } catch (e) {
      return false;
    }
  }

  DV.subs = {
    tick: tick,
    load: load,
    clear: clear,
    toggle: toggle,
    shift: shift,
    setOffset: setOffset,
    pickFile: pickFile
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
