/* DashVideo - end to end checks in a real Chromium with the extension loaded.
 *
 *   npm i -D playwright && npx playwright install chromium
 *   node tests/browser/run.mjs
 *
 * Covers the parts that only a browser can answer: do the hotkeys reach the
 * video, does frame stepping land on frame boundaries, does maximizing put the
 * picture on screen (rather than a black rectangle) inside a hostile DOM, and
 * does everything restore exactly.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, normalize } from 'node:path';
import zlib from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));
const EXT = join(here, '..', '..');
const PAGES = join(here, 'pages');

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('This suite needs Playwright: npm i -D playwright && npx playwright install chromium');
  process.exit(2);
}

/* ---- tiny static server (two ports, so one embed is cross-origin) -------- */

const TYPES = { '.html': 'text/html', '.webm': 'video/webm', '.srt': 'text/plain' };

function serve(port) {
  const server = createServer(async (req, res) => {
    const name = normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
    let body;
    try {
      body = await readFile(join(PAGES, name));
    } catch {
      return res.writeHead(404).end('not found');
    }
    const type = TYPES[extname(name)] || 'application/octet-stream';
    /* Range support matters: without it the video is not seekable, and half of
       what this suite checks is seeking. */
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (range) {
      const start = range[1] ? Number(range[1]) : 0;
      const end = range[2] ? Math.min(Number(range[2]), body.length - 1) : body.length - 1;
      res.writeHead(206, {
        'content-type': type,
        'accept-ranges': 'bytes',
        'content-range': `bytes ${start}-${end}/${body.length}`,
        'content-length': end - start + 1
      });
      return res.end(body.subarray(start, end + 1));
    }
    res.writeHead(200, { 'content-type': type, 'accept-ranges': 'bytes', 'content-length': body.length });
    res.end(body);
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

/* ---- reporting ---------------------------------------------------------- */

const results = [];
function check(name, pass, detail = '') {
  results.push(pass);
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}
const near = (a, b, tol = 0.15) => Math.abs(a - b) <= tol;

/* ---- screenshots: is anything actually on screen? ----------------------- */

function decodePng(buffer) {
  let pos = 8, idat = [], width = 0, height = 0, channels = 4;
  while (pos < buffer.length) {
    const length = buffer.readUInt32BE(pos);
    const tag = buffer.toString('ascii', pos + 4, pos + 8);
    const body = buffer.subarray(pos + 8, pos + 8 + length);
    if (tag === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      channels = body[9] === 2 ? 3 : 4;
    } else if (tag === 'IDAT') idat.push(body);
    pos += 12 + length;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const rows = [];
  let previous = Buffer.alloc(stride);
  for (let y = 0, i = 0; y < height; y++) {
    const filter = raw[i++];
    const line = Buffer.from(raw.subarray(i, i + stride));
    i += stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? line[x - channels] : 0;
      const b = previous[x];
      const c = x >= channels ? previous[x - channels] : 0;
      if (filter === 1) line[x] = (line[x] + a) & 255;
      else if (filter === 2) line[x] = (line[x] + b) & 255;
      else if (filter === 3) line[x] = (line[x] + ((a + b) >> 1)) & 255;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        line[x] = (line[x] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
      }
    }
    rows.push(line);
    previous = line;
  }
  return { width, height, channels, rows };
}

function samplePixels(buffer, points) {
  const png = decodePng(buffer);
  return points.map(([fx, fy]) => {
    const x = Math.round(png.width * fx), y = Math.round(png.height * fy);
    const o = x * png.channels;
    return [png.rows[y][o], png.rows[y][o + 1], png.rows[y][o + 2]];
  });
}

/* ---- the run ------------------------------------------------------------ */

const servers = [await serve(8931), await serve(8932)];
const ctx = await chromium.launchPersistentContext('', {
  channel: 'chromium',
  headless: true,
  args: [
    `--disable-extensions-except=${EXT}`,
    `--load-extension=${EXT}`,
    '--autoplay-policy=no-user-gesture-required'
  ]
});

/* The extension opens its options page on install - let it settle, then close. */
await new Promise((r) => setTimeout(r, 2500));
for (const p of ctx.pages()) if (p.url().startsWith('chrome-extension://')) await p.close();

const open = async (name, size) => {
  const page = await ctx.newPage();
  if (size) await page.setViewportSize(size);
  await page.goto(`http://127.0.0.1:8931/${name}`);
  await page.waitForFunction(() => document.getElementById('v')?.readyState >= 2, null, { timeout: 20000 });
  await page.waitForTimeout(400);
  return page;
};

const state = (page) => page.evaluate(() => {
  const v = document.getElementById('v');
  return { t: v.currentTime, rate: v.playbackRate, paused: v.paused, duration: v.duration };
});

const overlay = (page) => page.evaluate(() => {
  const host = document.querySelector('dashvideo-ui');
  if (!host) return null;
  const sr = host.shadowRoot;
  return {
    toast: sr.querySelector('.toast').textContent,
    toastOn: sr.querySelector('.toast').classList.contains('on'),
    panelHidden: sr.querySelector('.panel').hidden,
    subs: sr.querySelector('.subs-box').textContent,
    badge: sr.querySelector('.badge').hidden ? null : sr.querySelector('.badge').textContent
  };
});

/* --- hotkeys, speed, frame stepping ------------------------------------- */
{
  const page = await open('plain.html');
  await page.evaluate(() => { document.getElementById('v').currentTime = 1; });
  await page.waitForTimeout(250);

  await page.keyboard.press('x');
  await page.waitForTimeout(250);
  let s = await state(page);
  check('seek forward by the custom interval (X)', near(s.t, 4), `t=${s.t.toFixed(3)}`);
  const hud = await overlay(page);
  check('the overlay reports the action', hud?.toastOn && hud.toast.includes('3s'), hud?.toast);

  await page.keyboard.press('z');
  await page.waitForTimeout(250);
  s = await state(page);
  check('seek back by the custom interval (Z)', near(s.t, 1), `t=${s.t.toFixed(3)}`);

  await page.evaluate(() => document.getElementById('v').play());
  await page.waitForTimeout(350);
  await page.keyboard.press('.');
  await page.waitForTimeout(300);
  const first = await state(page);
  check('frame stepping pauses playback', first.paused === true);
  await page.keyboard.press('.');
  await page.waitForTimeout(250);
  const second = await state(page);
  check('one frame forward is 1/30s', near(second.t - first.t, 1 / 30, 0.008),
    `delta=${(second.t - first.t).toFixed(4)}`);
  await page.keyboard.press(',');
  await page.waitForTimeout(250);
  const third = await state(page);
  check('one frame back is 1/30s', near(third.t - second.t, -1 / 30, 0.008),
    `delta=${(third.t - second.t).toFixed(4)}`);

  await page.keyboard.press('d');
  await page.keyboard.press('d');
  await page.waitForTimeout(250);
  check('speed steps up', near((await state(page)).rate, 1.2, 0.001));
  await page.evaluate(() => { document.getElementById('v').playbackRate = 1; });
  await page.waitForTimeout(300);
  check('speed is re-applied when the page resets it', near((await state(page)).rate, 1.2, 0.001));
  await page.keyboard.press('r');
  await page.waitForTimeout(200);
  check('speed resets', near((await state(page)).rate, 1, 0.001));

  await page.click('#typing');
  await page.keyboard.type('xxx');
  await page.waitForTimeout(200);
  check('hotkeys stay out of text fields',
    (await page.inputValue('#typing')) === 'xxx' && near((await state(page)).t, third.t, 0.05));
  await page.close();
}

/* --- a site that toggles playback on keyup, the way YouTube does --------- */
{
  const [worker] = ctx.serviceWorkers();
  await worker.evaluate(() => chrome.storage.sync.set({
    settings: { keys: { playPause: { code: 'Space', shift: false, ctrl: false, alt: false, meta: false } } }
  }));
  const page = await open('keyup-player.html');
  await page.click('#player');
  await page.waitForTimeout(300);

  /* Press it the way a person does: a real keystroke is held long enough for
     the site to see the state DashVideo already changed on the way down. */
  const tap = async () => {
    await page.keyboard.down('Space');
    await page.waitForTimeout(120);
    await page.keyboard.up('Space');
    await page.waitForTimeout(400);
  };
  const siteToggles = () => page.evaluate(() => window.toggles);

  await tap();
  check('Space plays, and stays playing', (await state(page)).paused === false);
  check('the site never sees the keystroke', (await siteToggles()) === 0,
    `site handled it ${await siteToggles()}×`);

  await tap();
  check('Space pauses again', (await state(page)).paused === true);

  await worker.evaluate(() => chrome.storage.sync.remove('settings'));
  await page.close();
}

/* --- maximizing inside a hostile DOM ------------------------------------ */
{
  const page = await open('hostile.html', { width: 1000, height: 640 });
  await page.evaluate(() => { document.getElementById('v').currentTime = 2; window.scrollTo(0, 300); });
  await page.waitForTimeout(400);

  await page.keyboard.press('m');
  await page.waitForTimeout(700);
  const big = await page.evaluate(() => {
    const v = document.getElementById('v'), c = document.getElementById('controls');
    const vr = v.getBoundingClientRect(), cr = c.getBoundingClientRect();
    return {
      video: { x: Math.round(vr.x), y: Math.round(vr.y), w: Math.round(vr.width), h: Math.round(vr.height) },
      controls: { y: Math.round(cr.y), w: Math.round(cr.width) },
      onTop: document.elementFromPoint(innerWidth / 2, innerHeight / 2)?.id,
      overflow: getComputedStyle(document.documentElement).overflow,
      view: { w: innerWidth, h: innerHeight }
    };
  });
  check('the video fills the tab', big.video.w === big.view.w && big.video.h === big.view.h &&
    big.video.x === 0 && big.video.y === 0, JSON.stringify(big.video));
  check('the video is what is on screen, not a black rectangle', big.onTop === 'v', String(big.onTop));
  check("the site's own controls come along", big.controls.w === big.view.w &&
    big.controls.y > big.view.h - 60, JSON.stringify(big.controls));
  check('the page cannot scroll behind it', big.overflow === 'hidden', big.overflow);

  const shot = await page.screenshot();
  const pixels = samplePixels(shot, [[0.5, 0.5], [0.35, 0.4], [0.65, 0.6]]);
  check('the picture is really painted', pixels.every((p) => p[0] + p[1] + p[2] > 60),
    JSON.stringify(pixels));

  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);
  const back = await page.evaluate(() => {
    const v = document.getElementById('v');
    return {
      w: Math.round(v.getBoundingClientRect().width),
      position: getComputedStyle(v).position,
      transform: getComputedStyle(document.querySelector('main')).transform,
      leftovers: document.querySelectorAll('[style=""], [data-dashvideo-promoted]').length,
      scrollY: Math.round(scrollY),
      overflow: getComputedStyle(document.documentElement).overflow
    };
  });
  check('Escape restores the page exactly', back.w === 480 && back.position === 'static' &&
    back.transform !== 'none' && back.leftovers === 0 && back.scrollY === 300 &&
    back.overflow !== 'hidden', JSON.stringify(back));
  await page.close();
}

/* --- the player is promoted, and the fit modes -------------------------- */
{
  const page = await open('letterbox.html', { width: 1000, height: 600 });
  await page.evaluate(() => { document.getElementById('v').currentTime = 2; });
  await page.waitForTimeout(300);
  await page.keyboard.press('m');
  await page.waitForTimeout(700);

  const shape = await page.evaluate(() => {
    const v = document.getElementById('v'), c = document.getElementById('controls');
    return {
      video: Math.round(v.getBoundingClientRect().width),
      controls: Math.round(c.getBoundingClientRect().width),
      fit: getComputedStyle(v).objectFit,
      view: innerWidth
    };
  });
  check('a letterboxing player is promoted with its controls',
    shape.video === shape.view && shape.controls === shape.view, JSON.stringify(shape));

  const contained = samplePixels(await page.screenshot(), [[0.985, 0.5]]);
  await page.keyboard.press('Shift+M');
  await page.waitForTimeout(400);
  const covered = samplePixels(await page.screenshot(), [[0.985, 0.5]]);
  check('zoom to fill crops instead of letterboxing',
    (await page.evaluate(() => getComputedStyle(document.getElementById('v')).objectFit)) === 'cover' &&
    contained[0].every((c) => c < 20) && covered[0].some((c) => c > 40),
    `contain=${contained[0]} cover=${covered[0]}`);

  await page.keyboard.press('Shift+M');
  await page.waitForTimeout(300);
  check('the fit cycles on to stretch',
    (await page.evaluate(() => getComputedStyle(document.getElementById('v')).objectFit)) === 'fill');
  await page.keyboard.press('Shift+M');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  check('the player restores',
    (await page.evaluate(() => Math.round(document.getElementById('v').getBoundingClientRect().width))) === 480);
  await page.close();
}

/* --- rotating the picture ----------------------------------------------- */
{
  const page = await open('plain.html', { width: 900, height: 600 });
  const shape = () => page.evaluate(() => {
    const v = document.getElementById('v');
    const r = v.getBoundingClientRect();
    const t = getComputedStyle(v).transform;
    const m = t === 'none' ? new DOMMatrix() : new DOMMatrix(t);
    const anchor = document.querySelector('dashvideo-ui')?.shadowRoot.querySelector('.anchor');
    const round = (n) => Math.round(n * 1000) / 1000;
    return {
      w: Math.round(r.width), h: Math.round(r.height),
      cx: Math.round(r.left + r.width / 2), cy: Math.round(r.top + r.height / 2),
      /* For a rotation with a uniform scale: a = cos(angle)·s, b = sin(angle)·s. */
      a: round(m.a), b: round(m.b),
      anchor: anchor ? [Math.round(parseFloat(anchor.style.width)),
        Math.round(parseFloat(anchor.style.height))] : null
    };
  });

  const before = await shape();
  await page.keyboard.press('t');
  await page.waitForTimeout(300);
  const turned = await shape();
  check('T turns the picture a quarter turn clockwise',
    Math.abs(turned.a) < 0.001 && near(turned.b, 0.75, 0.001), JSON.stringify(turned));
  /* 480×360 turned and scaled by 3/4 fits back inside its own box. */
  check('the turned picture is scaled to fit the box it was given',
    turned.w === 270 && turned.h === 360 &&
    turned.cx === before.cx && turned.cy === before.cy, JSON.stringify(turned));
  check('the overlay stays on the box the page laid out',
    turned.anchor?.[0] === 480 && turned.anchor?.[1] === 360, JSON.stringify(turned.anchor));
  const hud = await overlay(page);
  check('the overlay reports the angle', hud?.toastOn && hud.toast.includes('90°'), hud?.toast);

  await page.keyboard.press('m');
  await page.waitForTimeout(700);
  const maxed = await shape();
  check('maximizing keeps the rotation, rescaled for the tab',
    Math.abs(maxed.a) < 0.001 && near(maxed.b, 0.75, 0.001) && maxed.h > maxed.w,
    JSON.stringify(maxed));
  const pixels = samplePixels(await page.screenshot(), [[0.5, 0.5], [0.06, 0.5]]);
  check('the turned picture is on screen, with black down the sides',
    pixels[0][0] + pixels[0][1] + pixels[0][2] > 60 &&
    pixels[1][0] + pixels[1][1] + pixels[1][2] < 60, JSON.stringify(pixels));

  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  const restored = await shape();
  check('and the rotation survives the trip back',
    restored.w === 270 && restored.h === 360 && near(restored.b, 0.75, 0.001),
    JSON.stringify(restored));

  await page.keyboard.press('t');
  await page.keyboard.press('t');
  await page.keyboard.press('t');
  await page.waitForTimeout(400);
  const home = await shape();
  check('four turns are back to normal, with no transform left behind',
    home.w === 480 && home.h === 360 && home.a === 1 && home.b === 0 &&
    (await page.evaluate(() => document.getElementById('v').style.transform)) === '',
    JSON.stringify(home));
  await page.close();
}

/* --- next / previous video on a page with several ----------------------- */
{
  const page = await open('feed.html', { width: 1000, height: 640 });
  await page.waitForFunction(() => ['v2', 'v3'].every((id) => document.getElementById(id).readyState >= 2));
  await page.evaluate(() => document.getElementById('v').play());
  await page.waitForTimeout(400);

  const which = () => page.evaluate(() => {
    const on = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
    const vids = ['v', 'v2', 'v3'].map((id) => document.getElementById(id));
    const r = on?.getBoundingClientRect();
    return {
      onTop: on?.id,
      fills: r && Math.round(r.width) === innerWidth && Math.round(r.height) === innerHeight,
      playing: vids.filter((v) => !v.paused).map((v) => v.id),
      leftovers: document.querySelectorAll('[data-dashvideo-promoted]').length,
      scrollY: Math.round(scrollY)
    };
  });

  await page.keyboard.press('m');
  await page.waitForTimeout(600);
  let now = await which();
  check('the first video is maximized to start', now.onTop === 'v' && now.fills, JSON.stringify(now));

  await page.keyboard.press('n');
  await page.waitForTimeout(700);
  now = await which();
  check('N hands the tab to the next video', now.onTop === 'v2' && now.fills, JSON.stringify(now));
  check('the video left behind is paused and the new one plays',
    now.playing.length === 1 && now.playing[0] === 'v2', JSON.stringify(now.playing));
  const hud = await overlay(page);
  check('the overlay counts the videos', hud?.toastOn && hud.toast.includes('2 / 3'), hud?.toast);

  await page.keyboard.press('n');
  await page.keyboard.press('n');
  await page.waitForTimeout(700);
  now = await which();
  check('past the last one it wraps to the first', now.onTop === 'v' && now.fills, JSON.stringify(now));

  await page.keyboard.press('Shift+N');
  await page.waitForTimeout(700);
  now = await which();
  check('Shift+N goes back the other way', now.onTop === 'v3' && now.fills, JSON.stringify(now));

  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);
  const back = await page.evaluate(() => {
    const r = document.getElementById('v3').getBoundingClientRect();
    return {
      w: Math.round(r.width),
      inView: r.top >= 0 && r.bottom <= innerHeight,
      leftovers: document.querySelectorAll('[style=""], [data-dashvideo-promoted]').length,
      overflow: getComputedStyle(document.documentElement).overflow
    };
  });
  check('Escape restores the page, scrolled to the video that was on', back.w === 480 &&
    back.inView && back.leftovers === 0 && back.overflow !== 'hidden', JSON.stringify(back));

  /* Not maximized, the same key just moves on: pause, switch, scroll. The
     first clip is rewound so a seek afterwards does not run it off the end. */
  await page.evaluate(() => { document.getElementById('v').currentTime = 0; });
  await page.keyboard.press('n');
  await page.waitForTimeout(500);
  await page.keyboard.press('x');
  await page.waitForTimeout(300);
  const moved = await page.evaluate(() => {
    const v = document.getElementById('v');
    return { t: v.currentTime, playing: !v.paused, inView: v.getBoundingClientRect().top >= 0 };
  });
  check('unmaximized, N moves the hotkeys on to the next video',
    moved.playing && moved.inView && moved.t >= 3, JSON.stringify(moved));
  await page.close();
}

/* --- a cross-origin embed ----------------------------------------------- */
{
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:8931/embed.html');
  const frame = page.frames().find((f) => f.url().includes('8932'));
  await frame.waitForFunction(() => document.getElementById('v').readyState >= 2, null, { timeout: 20000 });
  await frame.evaluate(() => { document.getElementById('v').currentTime = 1; });
  await page.click('h1');
  await page.waitForTimeout(400);

  await page.keyboard.press('x');
  await page.waitForTimeout(400);
  check('a hotkey in the top frame reaches a video in a cross-origin iframe',
    near(await frame.evaluate(() => document.getElementById('v').currentTime), 4));

  await page.keyboard.press('m');
  await page.waitForTimeout(700);
  const outer = await page.evaluate(() => {
    const f = document.querySelector('iframe');
    const r = f.getBoundingClientRect();
    return {
      w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y),
      onTop: document.elementFromPoint(innerWidth / 2, innerHeight / 2)?.tagName,
      view: { w: innerWidth, h: innerHeight }
    };
  });
  check('the iframe itself fills the tab', outer.w === outer.view.w && outer.h === outer.view.h &&
    outer.x === 0 && outer.y === 0 && outer.onTop === 'IFRAME', JSON.stringify(outer));
  check('and the video fills the iframe',
    (await frame.evaluate(() => Math.round(document.getElementById('v').getBoundingClientRect().width))) === outer.view.w);

  await page.keyboard.press('Escape');
  await page.waitForTimeout(700);
  const restored = await page.evaluate(() => {
    const f = document.querySelector('iframe');
    return { w: Math.round(f.getBoundingClientRect().width), styled: f.hasAttribute('style'),
             leftovers: document.querySelectorAll('[data-dashvideo-promoted]').length };
  });
  check('Escape restores both frames', restored.w === 560 && !restored.styled &&
    restored.leftovers === 0 &&
    (await frame.evaluate(() => getComputedStyle(document.getElementById('v')).position)) === 'static',
    JSON.stringify(restored));
  await page.close();
}

/* --- the player's own fullscreen button ---------------------------------- */
{
  const page = await open('fullscreen.html', { width: 1000, height: 620 });

  await page.click('#fsButton');
  await page.waitForTimeout(700);
  const on = await page.evaluate(() => {
    const p = document.getElementById('player');
    const r = p.getBoundingClientRect();
    return {
      w: Math.round(r.width), h: Math.round(r.height),
      view: { w: innerWidth, h: innerHeight },
      dashvideo: p.hasAttribute('data-dashvideo-fullscreen'),
      reported: document.fullscreenElement === p,
      events: window.fsEvents,
      label: document.getElementById('label').textContent,
      button: document.getElementById('fsButton').textContent,
      video: Math.round(document.getElementById('v').getBoundingClientRect().width)
    };
  });
  check("the player's fullscreen button maximizes in the tab",
    on.dashvideo && on.w === on.view.w && on.h === on.view.h && on.video === on.view.w,
    JSON.stringify(on));
  check('the page is told it is fullscreen', on.reported && on.events === 1,
    `fullscreenElement=${on.reported} events=${on.events}`);
  check('so the player switches to its fullscreen UI',
    on.label === 'fullscreen' && on.button === 'Exit', `${on.label} / ${on.button}`);

  const pixels = samplePixels(await page.screenshot(), [[0.5, 0.4], [0.3, 0.6]]);
  check('and the picture is on screen', pixels.every((p) => p[0] + p[1] + p[2] > 60),
    JSON.stringify(pixels));

  /* The site's own exit button calls document.exitFullscreen(). */
  await page.click('#fsButton');
  await page.waitForTimeout(600);
  const off = await page.evaluate(() => {
    const p = document.getElementById('player');
    return {
      w: Math.round(p.getBoundingClientRect().width),
      reported: document.fullscreenElement,
      events: window.fsEvents,
      label: document.getElementById('label').textContent,
      leftovers: document.querySelectorAll('[data-dashvideo-promoted], [data-dashvideo-fullscreen]').length
    };
  });
  check("the player's exit button restores the page",
    off.w === 560 && off.reported === null && off.events === 2 &&
    off.label === 'windowed' && off.leftovers === 0, JSON.stringify(off));

  await page.click('#fsButton');
  await page.waitForTimeout(500);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  const escaped = await page.evaluate(() => ({
    w: Math.round(document.getElementById('player').getBoundingClientRect().width),
    reported: document.fullscreenElement,
    label: document.getElementById('label').textContent
  }));
  check('Escape exits too, and the player is told',
    escaped.w === 560 && escaped.reported === null && escaped.label === 'windowed',
    JSON.stringify(escaped));
  await page.close();
}

/* --- and the site keeps real fullscreen when the takeover is off --------- */
{
  const [worker] = ctx.serviceWorkers();
  await worker.evaluate(() => chrome.storage.sync.set({
    settings: { replaceFullscreen: false }
  }));
  const page = await open('fullscreen.html', { width: 1000, height: 620 });
  await page.waitForTimeout(400);
  await page.click('#fsButton');
  await page.waitForTimeout(700);
  const native = await page.evaluate(() => {
    const p = document.getElementById('player');
    return {
      dashvideo: p.hasAttribute('data-dashvideo-fullscreen'),
      promoted: document.querySelectorAll('[data-dashvideo-promoted]').length,
      reported: document.fullscreenElement === p
    };
  });
  check('with the takeover off the request goes to the browser',
    !native.dashvideo && native.promoted === 0 && native.reported, JSON.stringify(native));
  await page.evaluate(() => document.fullscreenElement && document.exitFullscreen());
  await worker.evaluate(() => chrome.storage.sync.remove('settings'));
  await page.close();
}

/* --- subtitles ----------------------------------------------------------- */
{
  const page = await open('plain.html');
  const [worker] = ctx.serviceWorkers().length ? ctx.serviceWorkers() : [await ctx.waitForEvent('serviceworker')];
  const srt = ['1', '00:00:01,000 --> 00:00:02,000', 'first line', '',
               '2', '00:00:03,000 --> 00:00:04,000', 'second <i>line</i>', ''].join('\n');
  const loaded = await worker.evaluate(async (text) => {
    const [tab] = await chrome.tabs.query({ url: 'http://127.0.0.1:8931/plain.html' });
    return chrome.tabs.sendMessage(tab.id, { type: 'DV_SUBS_LOAD', text, name: 'test.srt' });
  }, srt);
  check('a subtitle file loads', loaded?.ok && loaded.count === 2, JSON.stringify(loaded?.count));

  await page.evaluate(() => { document.getElementById('v').currentTime = 3.5; });
  await page.waitForTimeout(400);
  check('the cue shows at its time', (await overlay(page))?.subs.includes('second line'));

  await page.evaluate(() => { document.getElementById('v').currentTime = 2.5; });
  await page.waitForTimeout(400);
  check('and nothing shows between cues', (await overlay(page))?.subs.trim() === '');

  await page.keyboard.press('[');
  await page.keyboard.press('[');
  await page.waitForTimeout(400);
  check('the sync offset applies live', (await overlay(page))?.subs.includes('second line'));

  await page.keyboard.press('c');
  await page.waitForTimeout(300);
  check('C hides the subtitles', (await overlay(page))?.subs.trim() === '');
  await page.close();
}

await ctx.close();
servers.forEach((s) => s.close());

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
