"""Build the original app icon and bundled short non-looping reminder tones."""
from pathlib import Path
import math
import struct
import wave
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parents[1]
resources = root / 'resources'
resources.mkdir(exist_ok=True)
image = Image.new('RGBA', (1024, 1024), (0, 0, 0, 0))
draw = ImageDraw.Draw(image)
draw.rounded_rectangle((24, 24, 1000, 1000), radius=245, fill='#16715C')
points = []
for i in range(101):
    t = i / 100
    points.append((160 + 704 * t, 512 - math.sin(t * math.pi) * 216))
for i in range(101):
    t = 1 - i / 100
    points.append((160 + 704 * t, 512 + math.sin(t * math.pi) * 216))
draw.polygon(points, fill='#EDF6F1')
draw.ellipse((380, 380, 644, 644), fill='#16715C')
draw.ellipse((468, 416, 538, 486), fill='#EDF6F1')
image.resize((256, 256), Image.Resampling.LANCZOS).save(resources / 'icon.png')
image.save(resources / 'icon.ico', sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
image.save(resources / 'icon.icns')
tray = Image.new('RGBA', (1024, 1024), (0, 0, 0, 0))
tray_draw = ImageDraw.Draw(tray)
tray_draw.line(points + [points[0]], fill='#172C26', width=72, joint='curve')
tray_draw.ellipse((380, 380, 644, 644), fill='#172C26')
tray.resize((64, 64), Image.Resampling.LANCZOS).save(resources / 'tray-eye-light.png')
tray_dark = Image.new('RGBA', tray.size, '#EDF6F1')
tray_dark.putalpha(tray.getchannel('A'))
tray_dark.resize((64, 64), Image.Resampling.LANCZOS).save(resources / 'tray-eye-dark.png')
assets = root / 'app' / 'renderer' / 'assets'
assets.mkdir(parents=True, exist_ok=True)
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
