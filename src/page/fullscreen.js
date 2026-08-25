/* DashVideo - the fullscreen hook.

   This file is injected into the page's own world (not the extension's
   isolated one), which is the only place the fullscreen API the player calls
   can be replaced. When a player asks to go fullscreen - its own button, its
   own hotkey, a double click - DashVideo maximizes it in the tab instead.

   The page is then told it *is* fullscreen: document.fullscreenElement reports
   the element and a fullscreenchange event fires, so the player switches to its
   fullscreen layout and its exit button works, which calls exitFullscreen and
   lands back here.

   Nothing here can reach the extension directly; it talks to the content
   script over window.postMessage. */
(function () {
  'use strict';

  if (window.__dashvideoFullscreen) return;
  window.__dashvideoFullscreen = true;

  var REQUEST_ATTR = 'data-dashvideo-fullscreen-request';
  var TARGET_ATTR = 'data-dashvideo-fullscreen';

  var REQUEST = ['requestFullscreen', 'webkitRequestFullscreen', 'webkitRequestFullScreen',
    'mozRequestFullScreen', 'msRequestFullscreen'];
  var EXIT = ['exitFullscreen', 'webkitExitFullscreen', 'webkitCancelFullScreen',
    'mozCancelFullScreen', 'msExitFullscreen'];
  var ELEMENT_PROPS = ['fullscreenElement', 'webkitFullscreenElement',
    'mozFullScreenElement', 'msFullscreenElement'];

  /* Assume on, matching the default setting: the decision has to be made
     synchronously inside the click, long before storage could answer. The
     content script corrects this as soon as it has read the settings. */
  var enabled = true;
  var fake = null;
  var pending = {};
  var counter = 0;

  var originalRequest = {};
  var originalExit = {};

  REQUEST.forEach(function (name) {
    if (typeof Element.prototype[name] === 'function') {
      originalRequest[name] = Element.prototype[name];
    }
  });
  EXIT.forEach(function (name) {
    if (typeof document[name] === 'function') originalExit[name] = document[name];
  });

  function post(message) {
    try {
      window.postMessage(message, '*');
    } catch (e) { /* ignore */ }
  }

  /* The content script lives in another world but shares this DOM, so elements
     are handed over as attributes rather than as values. */
  function findByAttribute(attr, value) {
    var selector = value == null ? '[' + attr + ']' : '[' + attr + '="' + value + '"]';
    var found = document.querySelector(selector);
    if (found) return found;

    var seen = new Set();
    var walk = function (node) {
      if (!node || seen.has(node)) return null;
      seen.add(node);
      var hit = node.querySelector ? node.querySelector(selector) : null;
      if (hit) return hit;
      var all = node.querySelectorAll ? node.querySelectorAll('*') : [];
      for (var i = 0; i < all.length; i++) {
        if (all[i].shadowRoot) {
          var deep = walk(all[i].shadowRoot);
          if (deep) return deep;
        }
      }
      return null;
    };
    return walk(document);
  }

  function fire(element) {
    var target = element || document;
    ['fullscreenchange', 'webkitfullscreenchange', 'mozfullscreenchange', 'MSFullscreenChange']
      .forEach(function (type) {
        try {
          target.dispatchEvent(new Event(type, { bubbles: true, composed: true }));
        } catch (e) { /* ignore */ }
      });
    try {
      window.dispatchEvent(new Event('resize'));
    } catch (e) { /* ignore */ }
  }

  function setFullscreen(element) {
    var previous = fake;
    fake = element;
    fire(element || previous);
  }

  REQUEST.forEach(function (name) {
    if (!originalRequest[name]) return;
    Element.prototype[name] = function () {
      if (!enabled) return originalRequest[name].apply(this, arguments);

      var element = this;
      var args = arguments;
      var id = ++counter;
      element.setAttribute(REQUEST_ATTR, String(id));
      post({ __dashvideo: 'fs-request', id: id });

      return new Promise(function (resolve, reject) {
        pending[id] = {
          resolve: resolve,
          reject: reject,
          fallback: function () {
            var result;
            try {
              result = originalRequest[name].apply(element, args);
            } catch (e) {
              return reject(e);
            }
            if (result && typeof result.then === 'function') result.then(resolve, reject);
            else resolve();
          }
        };
      });
    };
  });

  EXIT.forEach(function (name) {
    if (!originalExit[name]) return;
    document[name] = function () {
      if (!fake) return originalExit[name].apply(document, arguments);
      post({ __dashvideo: 'fs-exit' });
      return Promise.resolve();
    };
  });

  ELEMENT_PROPS.forEach(function (name) {
    var descriptor = Object.getOwnPropertyDescriptor(Document.prototype, name);
    if (!descriptor || !descriptor.get) return;
    Object.defineProperty(document, name, {
      configurable: true,
      enumerable: false,
      get: function () {
        return fake || descriptor.get.call(this);
      }
    });
  });

  window.addEventListener('message', function (event) {
    if (event.source !== window) return;
    var data = event.data;
    if (!data || typeof data !== 'object') return;

    switch (data.__dashvideo) {
      case 'fs-enabled':
        enabled = !!data.on;
        return;

      case 'fs-native': {
        var waiting = pending[data.id];
        delete pending[data.id];
        if (waiting) waiting.fallback();
        return;
      }

      case 'fs-state': {
        var element = data.on ? findByAttribute(TARGET_ATTR, null) : null;
        setFullscreen(element);
        var request = pending[data.id];
        if (request) {
          delete pending[data.id];
          if (data.on) request.resolve();
          else request.reject(new TypeError('Fullscreen request denied'));
        }
        return;
      }
    }
  }, true);
})();
