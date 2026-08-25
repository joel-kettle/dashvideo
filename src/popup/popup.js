/* DashVideo - popup: live control of the video in the current tab. */
(function () {
  'use strict';

  var DV = globalThis.DV;
  var $ = function (id) { return document.getElementById(id); };

  var FIT_LABELS = { contain: 'whole picture', cover: 'zoom to fill', fill: 'stretch' };

  var tabId = null;
  var settings = DV.DEFAULTS;
  var current = null;
  var poll = 0;

  function send(message) {
    return new Promise(function (resolve) {
      if (tabId == null) return resolve(null);
      try {
        chrome.tabs.sendMessage(tabId, message, function (response) {
          void chrome.runtime.lastError;   /* no content script / no video */
          resolve(response || null);
        });
      } catch (e) {
        resolve(null);
      }
    });
  }

  function formatTime(seconds) {
    if (!isFinite(seconds) || seconds < 0) seconds = 0;
    var s = Math.floor(seconds % 60);
    var m = Math.floor((seconds / 60) % 60);
    var h = Math.floor(seconds / 3600);
    var pad = function (n) { return n < 10 ? '0' + n : String(n); };
    return (h ? h + ':' + pad(m) : String(m)) + ':' + pad(s);
  }

  function renderState(state) {
    current = state;
    var status = $('status');
    var controls = $('controls');

    if (!state || !state.hasVideo) {
      status.textContent = 'No video found on this page.';
      status.classList.remove('ok');
      controls.hidden = true;
      return;
    }

    controls.hidden = false;
    status.classList.add('ok');
    var size = state.width ? state.width + '×' + state.height : 'video';
    status.textContent = (state.paused ? '❚❚ ' : '▶ ') + formatTime(state.currentTime) +
      (state.duration ? ' / ' + formatTime(state.duration) : '') + ' · ' + size;

    $('speedValue').textContent = state.rate.toFixed(2) + '×';
    $('fpsValue').textContent = Math.round(state.fps) + ' fps';
    $('maximize').textContent = state.maximized ? '⛶ Restore size' : '⛶ Maximize in tab';
    $('maximize').classList.toggle('on', state.maximized);
    $('fit').textContent = 'Fit: ' + (FIT_LABELS[state.fit] || FIT_LABELS.contain);

    var subs = state.subs;
    $('subsInfo').hidden = !subs.loaded;
    if (subs.loaded) {
      $('subsName').textContent = subs.name + ' · ' + subs.count +
        (subs.count === 1 ? ' cue' : ' cues');
      $('subsOffset').textContent = (subs.offset >= 0 ? '+' : '') + subs.offset + 's';
      $('subsToggle').classList.toggle('on', subs.enabled);
      $('pickSubs').textContent = 'Replace subtitle file…';
    } else {
      $('pickSubs').textContent = 'Load subtitle file…';
    }
  }

  function refresh() {
    send({ type: 'DV_STATE' }).then(function (response) {
      renderState(response && response.state);
    });
  }

  function renderSettings() {
    $('seekBack').textContent = '⏪ ' + settings.seekInterval + 's';
    $('seekForward').textContent = settings.seekInterval + 's ⏩';
    $('seekInterval').value = settings.seekInterval;
    $('seekIntervalLong').value = settings.seekIntervalLong;
    $('speedStep').value = settings.speedStep;
    $('fps').value = settings.fps;
    $('fpsAuto').checked = !!settings.fpsAuto;
    $('fps').disabled = !!settings.fpsAuto;

    var keys = settings.keys || {};
    var hint = [];
    if (keys.seekForward) hint.push(DV.hotkeys.describe(keys.seekForward) + ' seek');
    if (keys.speedUp) hint.push(DV.hotkeys.describe(keys.speedUp) + ' faster');
    $('hotkeyHint').textContent = hint.join(' · ');
  }

  function buildPresets() {
    var row = $('presets');
    row.textContent = '';
    [0.5, 1, 1.25, 1.5, 2, 3].forEach(function (rate) {
      var button = document.createElement('button');
      button.type = 'button';
      button.textContent = rate + '×';
      button.addEventListener('click', function () {
        send({ type: 'DV_SET_SPEED', value: rate }).then(function (response) {
          renderState(response && response.state);
        });
      });
      row.appendChild(button);
    });
  }

  function saveNumber(id, key, min, max) {
    var input = $(id);
    input.addEventListener('change', function () {
      var value = Number(input.value);
      if (!isFinite(value)) return renderSettings();
      value = Math.min(max, Math.max(min, value));
      input.value = value;
      var patch = {};
      patch[key] = value;
      DV.settings.set(patch).then(function (next) {
        settings = next;
        renderSettings();
      });
    });
  }

  function wire() {
    document.addEventListener('click', function (e) {
      var target = e.target.closest('[data-do]');
      if (!target) return;
      send({ type: 'DV_DO', action: target.getAttribute('data-do') }).then(function (response) {
        if (response && response.state) renderState(response.state);
        else refresh();
      });
    });

    $('openOptions').addEventListener('click', function () {
      chrome.runtime.openOptionsPage();
      window.close();
    });
    $('allHotkeys').addEventListener('click', function (e) {
      e.preventDefault();
      chrome.runtime.openOptionsPage();
      window.close();
    });

    $('pickSubs').addEventListener('click', function () {
      $('subsFile').click();
    });

    $('subsFile').addEventListener('change', function () {
      var file = $('subsFile').files && $('subsFile').files[0];
      $('subsFile').value = '';
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        var bytes = new Uint8Array(reader.result);
        if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
          bytes = bytes.subarray(3);
        }
        var text;
        try {
          text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        } catch (err) {
          text = new TextDecoder('windows-1252').decode(bytes);
        }
        send({ type: 'DV_SUBS_LOAD', text: text, name: file.name }).then(function (response) {
          if (response && response.state) renderState(response.state);
          if (response && !response.ok) {
            $('status').textContent = 'No cues found in ' + file.name;
          }
        });
      };
      reader.readAsArrayBuffer(file);
    });

    $('fpsAuto').addEventListener('change', function () {
      DV.settings.set({ fpsAuto: $('fpsAuto').checked }).then(function (next) {
        settings = next;
        renderSettings();
      });
    });

    saveNumber('seekInterval', 'seekInterval', 0.1, 600);
    saveNumber('seekIntervalLong', 'seekIntervalLong', 1, 3600);
    saveNumber('speedStep', 'speedStep', 0.01, 2);
    saveNumber('fps', 'fps', 1, 240);
  }

  function init() {
    buildPresets();
    wire();
    DV.settings.get().then(function (loaded) {
      settings = loaded;
      renderSettings();
    });
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      tabId = tabs && tabs[0] ? tabs[0].id : null;
      refresh();
      poll = setInterval(refresh, 900);
    });
    window.addEventListener('unload', function () { clearInterval(poll); });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
