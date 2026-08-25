# Browser checks

End-to-end checks that run a real Chromium with DashVideo loaded. They cover
what only a browser can answer: whether hotkeys reach the video, whether frame
stepping lands on frame boundaries, and - the reason this suite exists -
whether maximizing actually puts the picture on screen rather than a black
rectangle.

```bash
npm i -D playwright && npx playwright install chromium
node tests/browser/run.mjs
```

The pages in `pages/` are deliberately hostile:

| Page | What it reproduces |
| --- | --- |
| `plain.html` | A video under a transformed, filtered ancestor. |
| `hostile.html` | Every trap at once: a transformed ancestor, a static flex item with a z-index (a stacking context), `contain: paint`, `isolation: isolate`, a fixed site header and overlays above the player. Maximizing used to black-screen here. |
| `letterbox.html` | A 4:3 video inside a 16:9 player that owns the control bar, the way YouTube letterboxes. |
| `embed.html` | A cross-origin `<iframe>` on a second port, for the frame relaying and frame maximizing. |
| `fullscreen.html` | A player that drives the fullscreen API itself, for the takeover: its button, its `fullscreenchange` handler and its exit button. |

`pages/sample.webm` is a four second 30 fps test pattern; the frame-stepping
checks depend on it being exactly 30 fps.
