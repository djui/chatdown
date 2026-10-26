#!/usr/bin/env python3
"""Writes icons/icon{16,32,48,128}.png: a rounded square with a down arrow. No dependencies."""
import os
import struct
import zlib

BG = (47, 111, 235)
FG = (255, 255, 255)


def coverage(x, y, size):
    """Returns (in_square, in_arrow) for point (x, y) in pixel coordinates."""
    u, v = (x + 0.5) / size, (y + 0.5) / size
    r = 0.22
    cx = min(max(u, r), 1 - r)
    cy = min(max(v, r), 1 - r)
    in_square = (u - cx) ** 2 + (v - cy) ** 2 <= r * r
    shaft = 0.43 <= u <= 0.57 and 0.18 <= v <= 0.56
    head = 0.50 <= v <= 0.74 and abs(u - 0.5) <= (0.74 - v) * 1.15
    base = 0.78 <= v <= 0.84 and 0.24 <= u <= 0.76
    return in_square, shaft or head or base


def pixel(x, y, size, ss=4):
    sq = ar = 0
    for i in range(ss):
        for j in range(ss):
            s, a = coverage(x + (i + 0.5) / ss - 0.5, y + (j + 0.5) / ss - 0.5, size)
            sq += s
            ar += s and a
    if not sq:
        return (0, 0, 0, 0)
    t = ar / sq
    rgb = tuple(round(BG[k] * (1 - t) + FG[k] * t) for k in range(3))
    return rgb + (round(sq / (ss * ss) * 255),)


def png(size):
    rows = b"".join(b"\x00" + b"".join(bytes(pixel(x, y, size)) for x in range(size)) for y in range(size))

    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(rows, 9))
        + chunk(b"IEND", b"")
    )


if __name__ == "__main__":
    out = os.path.join(os.path.dirname(__file__), "..", "icons")
    os.makedirs(out, exist_ok=True)
    for s in (16, 32, 48, 128):
        with open(os.path.join(out, f"icon{s}.png"), "wb") as f:
            f.write(png(s))
