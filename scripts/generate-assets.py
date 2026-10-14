"""Build app icons and bundled short non-looping reminder tones."""
from pathlib import Path
import math
import struct
import wave
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parents[1]
resources = root / 'resources'
resources.mkdir(exist_ok=True)

TRAY_BLOB_PATH = 'M12 2.6 C6.2 2.6 2 5.7 1.3 11.1 C0.2 17.4 5.3 21.5 12 21.5 C18.7 21.5 23.8 17.4 22.7 11.1 C22 5.7 17.8 2.6 12 2.6 Z'
TRAY_EYE_PATH = 'M5 10.7 C6.5 12.9 8.7 13.4 10.8 10.8 M13.2 10.8 C15.3 13.4 17.5 12.9 19 10.7'
TRAY_EYES = [
    ((5, 10.7), (6.5, 12.9), (8.7, 13.4), (10.8, 10.8)),
    ((13.2, 10.8), (15.3, 13.4), (17.5, 12.9), (19, 10.7)),
]

def cubic_points(segment, steps=32):
    start, control1, control2, end = segment
    for index in range(steps + 1):
        t = index / steps
        u = 1 - t
        yield (
            u ** 3 * start[0] + 3 * u ** 2 * t * control1[0] + 3 * u * t ** 2 * control2[0] + t ** 3 * end[0],
            u ** 3 * start[1] + 3 * u ** 2 * t * control1[1] + 3 * u * t ** 2 * control2[1] + t ** 3 * end[1],
        )

def render_tray_icon(fill):
    scale = 8
    size = 24 * scale
    mask = Image.new('L', (size, size), 0)
    draw = ImageDraw.Draw(mask)
    blob_segments = [
        ((12, 2.6), (6.2, 2.6), (2, 5.7), (1.3, 11.1)),
        ((1.3, 11.1), (0.2, 17.4), (5.3, 21.5), (12, 21.5)),
        ((12, 21.5), (18.7, 21.5), (23.8, 17.4), (22.7, 11.1)),
        ((22.7, 11.1), (22, 5.7), (17.8, 2.6), (12, 2.6)),
    ]
    outline = [point for segment in blob_segments for point in cubic_points(segment)]
    draw.polygon([(round(x * scale), round(y * scale)) for x, y in outline], fill=255)
    eye_width = round(2.1 * scale)
    for eye in TRAY_EYES:
        line = [(round(x * scale), round(y * scale)) for x, y in cubic_points(eye)]
        draw.line(line, fill=0, width=eye_width)
        radius = eye_width // 2
        for x, y in (line[0], line[-1]):
            draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=0)
    image = Image.new('RGBA', (size, size), fill)
    image.putalpha(mask)
    return image.resize((64, 64), Image.Resampling.LANCZOS)

image = Image.open(root / 'design-system' / 'eyecare' / 'icon-warm-clay.png').convert('RGBA')
if image.size != (1024, 1024):
    raise ValueError('The EyeCare icon artwork must be 1024 × 1024 pixels')
mask = Image.new('L', image.size, 0)
ImageDraw.Draw(mask).rounded_rectangle((24, 24, 1000, 1000), radius=245, fill=255)
image.putalpha(mask)
image.resize((256, 256), Image.Resampling.LANCZOS).save(resources / 'icon.png')
image.save(resources / 'icon.ico', sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
image.save(resources / 'icon.icns')
render_tray_icon('#172C26').save(resources / 'tray-rest-light.png')
render_tray_icon('#EDF6F1').save(resources / 'tray-rest-dark.png')
mask_svg = '''<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
  <defs>
    <mask id="closed-eyes">
      <rect width="24" height="24" fill="white"/>
      <path d="{eyes}" fill="none" stroke="black" stroke-width="2.1" stroke-linecap="round"/>
    </mask>
  </defs>
  <path d="{blob}" fill="black" mask="url(#closed-eyes)"/>
</svg>
'''.format(blob=TRAY_BLOB_PATH, eyes=TRAY_EYE_PATH)
(resources / 'tray-rest.svg').write_text(mask_svg)
assets = root / 'app' / 'renderer' / 'assets'
assets.mkdir(parents=True, exist_ok=True)
(assets / 'rest-mark.svg').write_text(mask_svg)
rate = 44100
for name, frequencies in [('gentle', (523.25, 659.25)), ('bell', (659.25, 783.99, 1046.5))]:
    samples = []
    for index in range(int(rate * 1.25)):
        t = index / rate
        envelope = min(1, t / .06) * math.exp(-t * 4) * min(1, (1.25 - t) / .08)
        value = sum(math.sin(2 * math.pi * frequency * t) for frequency in frequencies) / len(frequencies)
        samples.append(struct.pack('<h', int(value * envelope * 11000)))
    with wave.open(str(assets / f'{name}.wav'), 'wb') as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(rate)
        output.writeframes(b''.join(samples))
