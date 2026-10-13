import { nativeImage } from 'electron';
import { deflateSync } from 'node:zlib';

const glyphs: Record<string, string[]> = {
  '0': ['111', '101', '101', '101', '111'], '1': ['010', '110', '010', '010', '111'], '2': ['111', '001', '111', '100', '111'],
  '3': ['111', '001', '111', '001', '111'], '4': ['101', '101', '111', '001', '001'], '5': ['111', '100', '111', '001', '111'],
  '6': ['111', '100', '111', '101', '111'], '7': ['111', '001', '010', '010', '010'], '8': ['111', '101', '111', '101', '111'],
  '9': ['111', '101', '111', '001', '111'], '+': ['000', '010', '111', '010', '000'], '<': ['001', '010', '100', '010', '001'],
  '-': ['000', '000', '111', '000', '000'], '!': ['010', '010', '010', '000', '010'], 'P': ['110', '101', '110', '100', '100'],
};
function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
const chunk = (type: string, data: Buffer): Buffer => {
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const payload = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(payload));
  return Buffer.concat([length, payload, crc]);
};
/** macOS 状态项必须携带非空图片，空图片会让整个菜单栏项（含标题）消失；用 1×1 透明模板图占位以显示纯文字倒计时。 */
export function blankTrayIcon(): Electron.NativeImage {
  const pixels = Buffer.alloc(1 * 4 + 1);
  const header = Buffer.alloc(13); header.writeUInt32BE(1, 0); header.writeUInt32BE(1, 4); header[8] = 8; header[9] = 6;
  const image = nativeImage.createFromBuffer(Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]));
  image.setTemplateImage(true);
  return image;
}
export function numericTrayIcon(label: string, dark: boolean): Electron.NativeImage {
  const size = 32;
  const pixels = Buffer.alloc((size * 4 + 1) * size);
  const color = dark ? [237, 246, 241] : [23, 44, 38];
  const width = label.length * 8 - 2;
  for (let index = 0; index < label.length; index++) {
    const glyph = glyphs[label[index]] ?? glyphs['!'];
    for (let y = 0; y < 5; y++) for (let x = 0; x < 3; x++) if (glyph[y][x] === '1') {
      for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 2; dx++) {
        const py = 8 + y * 3 + dy; const px = Math.floor((size - width) / 2) + index * 8 + x * 2 + dx;
        const offset = py * (size * 4 + 1) + 1 + px * 4;
        pixels[offset] = color[0]; pixels[offset + 1] = color[1]; pixels[offset + 2] = color[2]; pixels[offset + 3] = 255;
      }
    }
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
  return nativeImage.createFromBuffer(Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]));
}
export function trayLabel(remainingMs: number | null): string {
  if (remainingMs === null) return '-';
  if (remainingMs < 60000) return '<1';
  const minutes = Math.ceil(remainingMs / 60000);
  return minutes > 99 ? '99+' : String(minutes);
}
