/* DashVideo - shared defaults and action catalogue. Loaded as a classic script
   in the content scripts, the popup and the options page. */
(function (root) {
  'use strict';

  var DV = (root.DV = root.DV || {});

  function key(code, mods) {
    return {
      code: code,
      shift: !!(mods && mods.shift),
      ctrl: !!(mods && mods.ctrl),
      alt: !!(mods && mods.alt),
      meta: !!(mods && mods.meta)
    };
  }

  /* Every user facing action. `id` is used in messages, settings.keys and the
     options UI. Keep the order: the options page renders it as-is. */
  var ACTIONS = [
    { id: 'seekBack', group: 'Seeking', label: 'Seek backward', hint: 'By the custom interval' },
    { id: 'seekForward', group: 'Seeking', label: 'Seek forward', hint: 'By the custom interval' },
    { id: 'seekBackLong', group: 'Seeking', label: 'Seek backward (long)', hint: 'By the long interval' },
    { id: 'seekForwardLong', group: 'Seeking', label: 'Seek forward (long)', hint: 'By the long interval' },
    { id: 'frameBack', group: 'Seeking', label: 'Previous frame', hint: 'Pauses and steps one frame back' },
    { id: 'frameForward', group: 'Seeking', label: 'Next frame', hint: 'Pauses and steps one frame forward' },
    { id: 'speedDown', group: 'Speed', label: 'Slower', hint: 'By the speed step' },
    { id: 'speedUp', group: 'Speed', label: 'Faster', hint: 'By the speed step' },
    { id: 'speedReset', group: 'Speed', label: 'Reset speed', hint: 'Back to the default speed' },
    { id: 'maximize', group: 'View', label: 'Maximize in tab', hint: 'Fill the tab with the video' },
    { id: 'maximizeFit', group: 'View', label: 'Cycle fit', hint: 'Fit, zoom to fill, or stretch' },
    { id: 'rotate', group: 'View', label: 'Rotate 90°', hint: 'Clockwise; four presses are back to normal' },
    { id: 'panelToggle', group: 'View', label: 'Show / hide controls', hint: 'The compact toolbar at the top of the video' },
    { id: 'playPause', group: 'View', label: 'Play / pause', hint: 'Unbound by default' },
    { id: 'mute', group: 'View', label: 'Mute / unmute', hint: 'Unbound by default' },
    { id: 'subsLoad', group: 'Subtitles', label: 'Load subtitle file', hint: 'Opens a file picker (.srt .vtt .ass)' },
    { id: 'subsToggle', group: 'Subtitles', label: 'Show / hide subtitles', hint: '' },
    { id: 'subsDelayMinus', group: 'Subtitles', label: 'Subtitles earlier', hint: 'By the sync step' },
    { id: 'subsDelayPlus', group: 'Subtitles', label: 'Subtitles later', hint: 'By the sync step' }
  ];

  var DEFAULT_KEYS = {
    seekBack: key('KeyZ'),
    seekForward: key('KeyX'),
    seekBackLong: key('KeyZ', { shift: true }),
    seekForwardLong: key('KeyX', { shift: true }),
    frameBack: key('Comma'),
    frameForward: key('Period'),
    speedDown: key('KeyS'),
    speedUp: key('KeyD'),
    speedReset: key('KeyR'),
    maximize: key('KeyM'),
    maximizeFit: key('KeyM', { shift: true }),
    rotate: key('KeyT'),
    panelToggle: key('KeyV'),
    playPause: null,
    mute: null,
    subsLoad: key('KeyC', { shift: true }),
    subsToggle: key('KeyC'),
    subsDelayMinus: key('BracketLeft'),
    subsDelayPlus: key('BracketRight')
  };

  var DEFAULTS = {
    enabled: true,
    /* Hostnames where DashVideo stays out of the way. */
    blocklist: [],

    /* Seeking */
    seekInterval: 3,
    seekIntervalLong: 30,
    fps: 30,
    fpsAuto: true,

    /* How the picture fills the tab: contain, cover (zoom to fill) or fill */
    maximizeFit: 'contain',

    /* Take over the player's own fullscreen button and hotkey */
    replaceFullscreen: true,

    /* Speed */
    speedStep: 0.1,
    speedMin: 0.07,
    speedMax: 16,
    speedDefault: 1,
    keepSpeed: true,

    /* On screen feedback */
    hud: true,
    hudDuration: 900,
    badge: true,
    panelDefaultVisible: false,

    /* Subtitles */
    subsSyncStep: 0.5,
    subsFontSize: 4.2,
    subsColor: '#ffffff',
    subsBgOpacity: 0.5,
    subsBottom: 6,
    subsOutline: true,

    keys: DEFAULT_KEYS
  };

  DV.ACTIONS = ACTIONS;
  DV.DEFAULTS = DEFAULTS;
  DV.makeKey = key;
})(typeof globalThis !== 'undefined' ? globalThis : window);
