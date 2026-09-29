# Generates the PWA icons as plain PNGs (no dependencies).
# A black "open book" on white; maskable variant keeps it inside the safe zone.
import struct, zlib, os

def png(path, size, inset):
    rows = []
    for y in range(size):
        row = bytearray([0])
        for x in range(size):
            u, v = x / size, y / size
            m = inset
            inside = m < u < 1 - m and m + 0.08 < v < 1 - m - 0.08
            spine = abs(u - 0.5) < 0.012
            page_edge = inside and (abs(v - (m + 0.09)) < 0.015 or abs(v - (1 - m - 0.09)) < 0.015)
            dark = inside and (spine or page_edge or u < m + 0.03 or u > 1 - m - 0.03)
            row += bytes([0, 0, 0] if dark else [255, 255, 255])
        rows.append(bytes(row))
    raw = zlib.compress(b"".join(rows), 9)
    def chunk(t, d):
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    data = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)) + chunk(b"IDAT", raw) + chunk(b"IEND", b"")
    open(path, "wb").write(data)

here = os.path.join(os.path.dirname(__file__), "..", "icons")
os.makedirs(here, exist_ok=True)
png(os.path.join(here, "icon-192.png"), 192, 0.12)
png(os.path.join(here, "icon-512.png"), 512, 0.12)
png(os.path.join(here, "icon-maskable-512.png"), 512, 0.22)
png(os.path.join(here, "apple-touch-icon.png"), 180, 0.12)
