/* Run with: node --test tests/
   The geometry behind the rotation hotkey: how far the turned picture has to
   shrink to stay inside the box the player gave it. The browser suite covers
   the same thing end to end, in a real page. */
const test = require('node:test');
const assert = require('node:assert');

const records = new WeakMap();
globalThis.DV = {
  videos: {
    data: function (video) {
      if (!records.has(video)) records.set(video, {});
      return records.get(video);
    }
  }
};
globalThis.getComputedStyle = function (el) {
  return { objectFit: el.objectFit };
};

require('../src/content/rotate.js');
const rotate = globalThis.DV.rotate;

/* Enough of a <video> for the maths: a laid-out box, an intrinsic size, an
   object-fit and a style declaration to write into. */
function video(box, intrinsic, fit) {
  const props = {};
  return {
    isConnected: true,
    offsetWidth: box.w,
    offsetHeight: box.h,
    videoWidth: intrinsic ? intrinsic.w : 0,
    videoHeight: intrinsic ? intrinsic.h : 0,
    objectFit: fit || 'contain',
    props: props,
    rect: { left: 0, top: 0, width: box.w, height: box.h },
    style: {
      setProperty: function (name, value) { props[name] = value; },
      removeProperty: function (name) { delete props[name]; }
    },
    addEventListener: function () {},
    getBoundingClientRect: function () {
      const r = this.rect;
      return { left: r.left, top: r.top, width: r.width, height: r.height,
        right: r.left + r.width, bottom: r.top + r.height };
    }
  };
}

const turn = (v, angle) => {
  rotate.set(v, angle);
  return v.props.transform;
};

test('a quarter turn is scaled to fit the box it was given', () => {
  /* A 4:3 picture filling a 480×360 box: turned it is 360 wide by 480 tall,
     so it has to come down to three quarters. */
  const v = video({ w: 480, h: 360 }, { w: 320, h: 240 });
  assert.strictEqual(turn(v, 90), 'rotate(90deg) scale(0.75)');
  assert.strictEqual(v.props['transform-origin'], 'center center');
  assert.strictEqual(turn(v, 270), 'rotate(270deg) scale(0.75)');
});

test('a half turn keeps the box, so it needs no scale', () => {
  const v = video({ w: 480, h: 360 }, { w: 320, h: 240 });
  assert.strictEqual(turn(v, 180), 'rotate(180deg)');
});

test('the black bars are not part of the picture', () => {
  /* 16:9 inside a tall box: the picture is only 400×225, so turning it can
     grow it instead of shrinking it - it still fits. */
  const v = video({ w: 400, h: 800 }, { w: 1920, h: 1080 });
  assert.strictEqual(turn(v, 90), 'rotate(90deg) scale(1.7778)');
});

test('scale-down never blows a small picture up first', () => {
  const v = video({ w: 480, h: 360 }, { w: 160, h: 120 }, 'scale-down');
  assert.strictEqual(turn(v, 90), 'rotate(90deg) scale(2.25)');
});

test('a stretched picture stays stretched, turned onto the same box', () => {
  const v = video({ w: 480, h: 360 }, { w: 320, h: 240 }, 'fill');
  assert.strictEqual(turn(v, 90), 'rotate(90deg) scale(0.75,1.3333)');
});

test('an unmeasurable box still turns', () => {
  const v = video({ w: 0, h: 0 }, { w: 320, h: 240 });
  assert.strictEqual(turn(v, 90), 'rotate(90deg)');
});

test('four steps come back to normal and leave nothing behind', () => {
  const v = video({ w: 480, h: 360 }, { w: 320, h: 240 });
  assert.strictEqual(rotate.step(v, 90), 90);
  assert.strictEqual(rotate.step(v, 90), 180);
  assert.strictEqual(rotate.step(v, 90), 270);
  assert.strictEqual(rotate.step(v, 90), 0);
  assert.strictEqual(rotate.angle(v), 0);
  assert.deepStrictEqual(v.props, {});
});

test('the angle wraps and snaps to quarters', () => {
  const v = video({ w: 480, h: 360 }, { w: 320, h: 240 });
  assert.strictEqual(rotate.set(v, 450), 90);
  assert.strictEqual(rotate.set(v, -90), 270);
  assert.strictEqual(rotate.set(v, 88), 90);
});

test('the box the overlay uses ignores the turn', () => {
  const v = video({ w: 480, h: 360 }, { w: 320, h: 240 });
  v.rect = { left: 0, top: 20, width: 480, height: 360 };
  assert.deepStrictEqual(rotate.box(v), v.getBoundingClientRect());

  rotate.set(v, 90);
  /* What Chrome would report once the video is turned: 270×360, centred
     where the original box was. */
  v.rect = { left: 105, top: 20, width: 270, height: 360 };
  assert.deepStrictEqual(rotate.box(v),
    { left: 0, top: 20, width: 480, height: 360, right: 480, bottom: 380 });
});
