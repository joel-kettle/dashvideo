#!/usr/bin/env python3
"""Generate the DashVideo PNG icons.

Renders the mark at 4x with plain arithmetic, box-filters it down for
anti-aliasing and writes the PNG files with zlib - no image libraries needed.

    python3 tools/make-icons.py
"""
import struct
import zlib
from pathlib import Path

SS = 4                      # supersampling factor
BASE = 128                  # design canvas
SIZES = (128, 48, 32, 16)
OUT = Path(__file__).resolve().parent.parent / "icons"

TOP = (0x3b, 0x82, 0xf6)    # blue
BOTTOM = (0x7c, 0x3a, 0xed)  # violet
WHITE = (0xff, 0xff, 0xff)


def rounded_rect(x, y, w, h, radius, px, py):
    """Signed coverage test for a rounded rectangle."""
    if px < x or px > x + w or py < y or py > y + h:
        return False
    cx = min(max(px, x + radius), x + w - radius)
    cy = min(max(py, y + radius), y + h - radius)
    dx, dy = px - cx, py - cy
    return dx * dx + dy * dy <= radius * radius


def in_triangle(pts, px, py):
    (ax, ay), (bx, by), (cx, cy) = pts
    d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
    if d == 0:
        return False
    a = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / d
    b = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / d
    c = 1 - a - b
    return a >= 0 and b >= 0 and c >= 0


def render(size):
    """Render one icon at `size` px, supersampled, returning RGBA bytes."""
    hi = size * SS
    scale = hi / BASE
    pixels = bytearray(hi * hi * 4)

    triangle = ((60, 34), (60, 94), (104, 64))
    dashes = ((22, 46, 11, 36), (40, 38, 11, 52))   # x, y, w, h in design units

    for py in range(hi):
        dy = (py + 0.5) / scale
        t = min(1.0, max(0.0, dy / BASE))
        bg = tuple(int(TOP[i] + (BOTTOM[i] - TOP[i]) * t) for i in range(3))
        for px in range(hi):
            dx = (px + 0.5) / scale
            idx = (py * hi + px) * 4
            if not rounded_rect(0, 0, BASE, BASE, BASE * 0.24, dx, dy):
                continue
            colour = bg
            if in_triangle(triangle, dx, dy):
                colour = WHITE
            else:
                for x, y, w, h in dashes:
                    if rounded_rect(x, y, w, h, w / 2, dx, dy):
                        colour = WHITE
                        break
            pixels[idx:idx + 4] = bytes((colour[0], colour[1], colour[2], 255))

    return downsample(pixels, hi, size)


def downsample(pixels, hi, size):
    out = bytearray(size * size * 4)
    for y in range(size):
        for x in range(size):
            r = g = b = a = 0
            for sy in range(SS):
                for sx in range(SS):
                    idx = ((y * SS + sy) * hi + (x * SS + sx)) * 4
                    alpha = pixels[idx + 3]
                    r += pixels[idx] * alpha
                    g += pixels[idx + 1] * alpha
                    b += pixels[idx + 2] * alpha
                    a += alpha
            o = (y * size + x) * 4
            if a:
                out[o] = min(255, r // a)
                out[o + 1] = min(255, g // a)
                out[o + 2] = min(255, b // a)
            out[o + 3] = a // (SS * SS)
    return out


def write_png(path, pixels, size):
    raw = bytearray()
    stride = size * 4
    for y in range(size):
        raw.append(0)                         # filter type: none
        raw += pixels[y * stride:(y + 1) * stride]

    def chunk(tag, data):
        body = tag + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body))

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(bytes(raw), 9))
    png += chunk(b"IEND", b"")
    path.write_bytes(png)


def main():
    OUT.mkdir(exist_ok=True)
    for size in SIZES:
        path = OUT / f"icon{size}.png"
        write_png(path, render(size), size)
        print(f"wrote {path.relative_to(OUT.parent)} ({path.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
