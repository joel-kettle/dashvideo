# DashVideo

A Chrome extension that puts the video controls you actually use on every
HTML5 video: custom seek intervals, frame-by-frame stepping, in-tab
maximizing, playback speed steps, hotkeys for all of it, and your own
subtitle file on top of any stream.

![The overlay panel, a toast and an attached subtitle track on a video](docs/overlay.png)

## Features

| | |
| --- | --- |
| **Custom seek** | Jump by your own interval (3 seconds by default) plus a second, longer jump. |
| **Frame by frame** | Steps exactly one frame at a time. The real frame rate is measured while the video plays, so 24, 25, 29.97 and 60 fps sources all step correctly. |
| **In-tab maximize** | Fills the browser tab with the video - no native fullscreen, so the rest of the browser stays put. Works even when the player sits inside a transformed container or a cross-origin iframe. |
| **Playback speed** | Raise and lower the speed by your own step, reset to a default, and keep the speed when a player tries to reset it. |
| **Hotkeys** | Every action is rebindable, including modifier combinations. They stay out of the way while you type. |
| **Your own subtitles** | Attach a local `.srt`, `.vtt`, `.ass`/`.ssa` or `.sbv` file to any video - including streams that ship no subtitles - and nudge the timing while you watch. |

## Install

DashVideo is a plain Manifest V3 extension with no build step:

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Choose **Load unpacked** and select this folder.

## Default hotkeys

| Key | Action |
| --- | --- |
| <kbd>Z</kbd> / <kbd>X</kbd> | Seek back / forward by the custom interval (3s) |
| <kbd>Shift</kbd>+<kbd>Z</kbd> / <kbd>Shift</kbd>+<kbd>X</kbd> | Seek back / forward by the long interval (30s) |
| <kbd>,</kbd> / <kbd>.</kbd> | Previous / next frame (pauses the video) |
| <kbd>S</kbd> / <kbd>D</kbd> | Slower / faster by the speed step (0.1×) |
| <kbd>R</kbd> | Reset the speed |
| <kbd>M</kbd> | Maximize in the tab (<kbd>Esc</kbd> restores) |
| <kbd>V</kbd> | Show / hide the on-video control panel |
| <kbd>Shift</kbd>+<kbd>C</kbd> | Load a subtitle file |
| <kbd>C</kbd> | Show / hide the subtitles |
| <kbd>[</kbd> / <kbd>]</kbd> | Shift the subtitles earlier / later by the sync step (0.5s) |

Everything is rebindable on the options page. <kbd>Alt</kbd>+<kbd>M</kbd>,
<kbd>Alt</kbd>+<kbd>.</kbd> and <kbd>Alt</kbd>+<kbd>,</kbd> are registered as
browser-level shortcuts as well (maximize, faster, slower) and can be changed
at `chrome://extensions/shortcuts`.

Hotkeys are ignored while the focus is in a text field, a text area or any
`contenteditable` element, so site search boxes keep working.

## Subtitles

Press <kbd>Shift</kbd>+<kbd>C</kbd> on the page, or use **Load subtitle
file…** in the popup, and pick a subtitle file from your computer. Nothing is
uploaded - the file is parsed locally and drawn over the video.

* Formats: SubRip (`.srt`), WebVTT (`.vtt`), SubStation Alpha (`.ass`, `.ssa`)
  and YouTube's `.sbv`.
* Files that are not UTF-8 fall back to windows-1252, which covers most older
  subtitle downloads.
* `[` and `]` shift the timing live while you watch; the offset is shown in the
  panel and the popup.
* Size, colour, background opacity, position and outline are configurable on
  the options page, with a live preview.
* Cues are drawn by DashVideo instead of being handed to the player, so they
  work on cross-origin streams and survive players that rebuild their own text
  tracks. They are held in memory for the tab: reloading the page clears them.

## Settings

The popup carries the controls you reach for mid-video plus the seek interval,
long seek, speed step and frame rate. The options page has everything else:
the full hotkey editor, the speed range and default, subtitle appearance,
on-screen feedback, and a per-site block list for pages where DashVideo should
stay out of the way.

## How it works

* `src/content/` is injected into every frame at `document_start`. It finds the
  video the user means (largest, visible, playing - shadow DOM included), keeps
  its playback rate, and measures the frame rate with
  `requestVideoFrameCallback`.
* The overlay - toast, speed badge, control panel and subtitles - lives in a
  shadow root, so page CSS cannot reach it and it cannot leak into the page.
* Maximizing pins the video with inline `!important` styles, neutralises the
  ancestor transforms, filters and `contain` values that would otherwise trap a
  fixed element, and covers the page with a black backdrop.
* When the video is inside an iframe, the frame asks its parent to give the
  same treatment to the `<iframe>` element, so an embedded player really fills
  the tab. Hotkeys pressed in the top frame are relayed down to the frame that
  owns the video.

## Development

```bash
node --test tests/*.test.js     # subtitle parsing and hotkey matching
python3 tools/make-icons.py     # regenerate the icons
```

There is no bundler, no dependency and no build output - the folder you clone
is the folder you load.

```
manifest.json
src/common/      defaults, settings storage, hotkey matching (shared everywhere)
src/content/     video detection, actions, overlay UI, maximize, subtitles
src/popup/       toolbar popup
src/options/     settings and hotkey editor
src/background/  browser-level command handling
tools/           icon generator
tests/           node --test suite
```

## Limitations

* Chrome does not let extensions touch DRM-protected pixels, so the subtitle
  overlay and the maximize treatment work on Netflix-style players, but the
  frame stepping precision depends on what the player exposes.
* Frame stepping is as accurate as the source: variable-frame-rate videos have
  no single frame duration, so DashVideo uses the measured average.
* Pages that block extension content scripts (the Chrome Web Store,
  `chrome://` pages) are out of reach for any extension, DashVideo included.
