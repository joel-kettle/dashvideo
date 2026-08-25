/* DashVideo - options page. */
(function () {
  'use strict';

  var DV = globalThis.DV;
  var $ = function (id) { return document.getElementById(id); };

  var settings = DV.DEFAULTS;
  var listening = null;      /* { id, button } while capturing a hotkey */
  var savedTimer = 0;

  function flashSaved() {
    var badge = $('saved');
    badge.hidden = false;
    clearTimeout(savedTimer);
    savedTimer = setTimeout(function () { badge.hidden = true; }, 1200);
  }

  function save(patch) {
    return DV.settings.set(patch).then(function (next) {
      settings = next;
      flashSaved();
      renderPreview();
      return next;
    });
  }

  /* ---- simple fields --------------------------------------------------- */

  function fields() {
    return Array.prototype.slice.call(document.querySelectorAll('[data-setting]'));
  }

  function readField(input) {
    if (input.type === 'checkbox') return input.checked;
    if (input.type === 'number' || input.type === 'range') {
      var value = Number(input.value);
      if (!isFinite(value)) return null;
      if (input.min !== '') value = Math.max(Number(input.min), value);
      if (input.max !== '') value = Math.min(Number(input.max), value);
      return value;
    }
    return input.value;
  }

  function renderFields() {
    fields().forEach(function (input) {
      var value = settings[input.getAttribute('data-setting')];
      if (input.type === 'checkbox') input.checked = !!value;
      else input.value = value;
    });
    $('fps').disabled = !!settings.fpsAuto;
    $('subsBgOpacityOut').textContent = Math.round(settings.subsBgOpacity * 100) + '%';
    $('blocklist').value = (settings.blocklist || []).join('\n');
  }

  function wireFields() {
    fields().forEach(function (input) {
      var event = input.type === 'range' ? 'input' : 'change';
      input.addEventListener(event, function () {
        var key = input.getAttribute('data-setting');
        var value = readField(input);
        if (value === null) return renderFields();
        if (input.type === 'number' || input.type === 'range') input.value = value;
        var patch = {};
        patch[key] = value;
        settings[key] = value;
        if (key === 'subsBgOpacity') {
          $('subsBgOpacityOut').textContent = Math.round(value * 100) + '%';
        }
        if (key === 'fpsAuto') $('fps').disabled = !!value;
        save(patch);
      });
    });

    $('blocklist').addEventListener('change', function () {
      var list = $('blocklist').value.split('\n').map(function (line) {
        return line.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
      }).filter(Boolean);
      save({ blocklist: list }).then(renderFields);
    });

    $('reset').addEventListener('click', function () {
      if (!confirm('Reset every DashVideo setting and hotkey to its default?')) return;
      DV.settings.reset().then(function (next) {
        settings = next;
        renderFields();
        renderHotkeys();
        renderPreview();
        flashSaved();
      });
    });

    $('browserShortcuts').addEventListener('click', function () {
      chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
    });
  }

  /* ---- hotkeys --------------------------------------------------------- */

  function clashes(id) {
    var binding = settings.keys[id];
    if (!binding) return false;
    return Object.keys(settings.keys).some(function (other) {
      return other !== id && DV.hotkeys.same(settings.keys[other], binding);
    });
  }

  function paint(button, id) {
    var binding = settings.keys[id];
    var label = DV.hotkeys.describe(binding);
    button.textContent = label || 'Not set';
    button.classList.toggle('empty', !label);
    button.classList.toggle('clash', clashes(id));
    button.title = clashes(id) ? 'Another action uses the same shortcut' : 'Click, then press keys';
  }

  function repaintAll() {
    Array.prototype.forEach.call(document.querySelectorAll('.keybtn'), function (button) {
      paint(button, button.getAttribute('data-id'));
    });
  }

  function stopListening() {
    if (!listening) return;
    listening.button.classList.remove('listening');
    paint(listening.button, listening.id);
    listening = null;
  }

  function renderHotkeys() {
    var wrap = $('hotkeys');
    wrap.textContent = '';
    var groups = [];
    DV.ACTIONS.forEach(function (action) {
      var group = groups.filter(function (g) { return g.name === action.group; })[0];
      if (!group) {
        group = { name: action.group, actions: [] };
        groups.push(group);
      }
      group.actions.push(action);
    });

    groups.forEach(function (group) {
      var section = document.createElement('div');
      section.className = 'keygroup';
      var title = document.createElement('h3');
      title.textContent = group.name;
      section.appendChild(title);

      group.actions.forEach(function (action) {
        var row = document.createElement('div');
        row.className = 'keyrow';

        var name = document.createElement('div');
        name.className = 'name';
        name.textContent = action.label;
        if (action.hint) {
          var hint = document.createElement('small');
          hint.textContent = action.hint;
          name.appendChild(hint);
        }
        row.appendChild(name);

        var button = document.createElement('button');
        button.className = 'keybtn';
        button.type = 'button';
        button.setAttribute('data-id', action.id);
        paint(button, action.id);
        button.addEventListener('click', function () {
          if (listening && listening.id === action.id) return stopListening();
          stopListening();
          listening = { id: action.id, button: button };
          button.classList.add('listening');
          button.textContent = 'Press keys…';
        });
        row.appendChild(button);

        var clear = document.createElement('button');
        clear.className = 'clear';
        clear.type = 'button';
        clear.title = 'Unbind';
        clear.textContent = '✕';
        clear.addEventListener('click', function () {
          stopListening();
          var keys = {};
          keys[action.id] = null;
          settings.keys[action.id] = null;
          save({ keys: keys }).then(repaintAll);
        });
        row.appendChild(clear);

        section.appendChild(row);
      });

      wrap.appendChild(section);
    });
  }

  function onKeyDown(e) {
    if (!listening) return;
    e.preventDefault();
    e.stopPropagation();

    if (e.code === 'Escape') return stopListening();
    if (DV.hotkeys.isModifierEvent(e)) return;

    var binding = e.code === 'Backspace' || e.code === 'Delete' ? null : DV.hotkeys.fromEvent(e);
    var id = listening.id;
    settings.keys[id] = binding;
    var keys = {};
    keys[id] = binding;
    stopListening();
    save({ keys: keys }).then(repaintAll);
  }

  /* ---- subtitle preview ------------------------------------------------ */

  function renderPreview() {
    var preview = $('preview');
    var cue = $('previewCue');
    var height = preview.clientHeight || 170;
    var size = Math.max(12, Math.min(96, height * (settings.subsFontSize / 100)));
    cue.style.fontSize = size.toFixed(1) + 'px';
    cue.style.bottom = Math.round(height * (settings.subsBottom / 100)) + 'px';
    cue.style.color = settings.subsColor;
    cue.style.textShadow = settings.subsOutline
      ? '0 0 3px rgba(0,0,0,.9), 0 1px 2px rgba(0,0,0,.9), 0 0 1px rgba(0,0,0,1)'
      : 'none';
    cue.firstElementChild.style.background = 'rgba(0, 0, 0, ' + settings.subsBgOpacity + ')';
  }

  function init() {
    wireFields();
    document.addEventListener('keydown', onKeyDown, true);
    DV.settings.get().then(function (loaded) {
      settings = loaded;
      renderFields();
      renderHotkeys();
      renderPreview();
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
