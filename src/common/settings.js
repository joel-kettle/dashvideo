/* DashVideo - settings storage with defaults merged in. */
(function (root) {
  'use strict';

  var DV = (root.DV = root.DV || {});
  var KEY = 'settings';

  function area() {
    try {
      if (chrome.storage && chrome.storage.sync) return chrome.storage.sync;
    } catch (e) { /* fall through */ }
    return chrome.storage.local;
  }

  function merge(stored) {
    var out = {};
    var d = DV.DEFAULTS;
    Object.keys(d).forEach(function (k) {
      out[k] = k === 'keys' ? Object.assign({}, d.keys) : d[k];
    });
    if (stored && typeof stored === 'object') {
      Object.keys(stored).forEach(function (k) {
        if (k === 'keys') return;
        if (k in out) out[k] = stored[k];
      });
      if (stored.keys && typeof stored.keys === 'object') {
        Object.keys(stored.keys).forEach(function (id) {
          if (id in out.keys || DV.ACTIONS.some(function (a) { return a.id === id; })) {
            out.keys[id] = stored.keys[id] || null;
          }
        });
      }
    }
    return out;
  }

  function get() {
    return new Promise(function (resolve) {
      var done = false;
      var finish = function (raw) {
        if (done) return;
        done = true;
        resolve(merge(raw));
      };
      try {
        area().get(KEY, function (res) {
          if (chrome.runtime.lastError) return finish(null);
          finish(res && res[KEY]);
        });
      } catch (e) {
        finish(null);
      }
    });
  }

  function set(patch) {
    return get().then(function (current) {
      var next = Object.assign({}, current, patch);
      if (patch && patch.keys) next.keys = Object.assign({}, current.keys, patch.keys);
      return new Promise(function (resolve) {
        var obj = {};
        obj[KEY] = next;
        try {
          area().set(obj, function () {
            void chrome.runtime.lastError;
            resolve(next);
          });
        } catch (e) {
          resolve(next);
        }
      });
    });
  }

  function reset() {
    return new Promise(function (resolve) {
      try {
        area().remove(KEY, function () {
          void chrome.runtime.lastError;
          resolve(merge(null));
        });
      } catch (e) {
        resolve(merge(null));
      }
    });
  }

  function onChange(cb) {
    if (!chrome.storage || !chrome.storage.onChanged) return;
    chrome.storage.onChanged.addListener(function (changes) {
      if (!changes[KEY]) return;
      cb(merge(changes[KEY].newValue));
    });
  }

  DV.settings = { get: get, set: set, reset: reset, onChange: onChange, merge: merge };
})(typeof globalThis !== 'undefined' ? globalThis : window);
