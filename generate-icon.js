// Run once: node generate-icon.js
// Generates a minimal 16x16 PNG tray icon using raw PNG encoding (no deps)
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function createPNG(width, height, pixels) {
  // pixels: flat RGBA array, length = width*height*4
  const PNG_SIGNATURE = Buffer.from([137,80,78,71,13,10,26,10]);

  function chunk(type, data) {
    const typeBuffer = Buffer.from(type, 'ascii');
    const crcBuf = Buffer.concat([typeBuffer, data]);
    let crc = 0xFFFFFFFF;
    for (const b of crcBuf) {
      crc ^= b;
      for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
    }
    crc ^= 0xFFFFFFFF;
    const len = Buffer.allocUnsafe(4); len.writeUInt32BE(data.length);
    const crcBufOut = Buffer.allocUnsafe(4); crcBufOut.writeInt32BE(crc | 0);
    return Buffer.concat([len, typeBuffer, data, crcBufOut]);
  }

  // IHDR
  const ihdrData = Buffer.allocUnsafe(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 2; // color type RGB
  ihdrData[10] = ihdrData[11] = ihdrData[12] = 0;

  // IDAT: filter byte 0 + RGB rows (no alpha for simplicity)
  const rows = [];
  for (let y = 0; y < height; y++) {
    const row = [0]; // filter byte
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      row.push(pixels[i], pixels[i+1], pixels[i+2]);
    }
    rows.push(...row);
  }
  const rawData = Buffer.from(rows);
  const compressed = zlib.deflateSync(rawData);

  return Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', ihdrData),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Draw a 16x16 Alfred-style icon: dark background, white "A" letter
const W = 16, H = 16;
const pixels = new Uint8Array(W * H * 4);

function setPixel(x, y, r, g, b, a = 255) {
  if (x < 0 || x >= W || y < 0 || y >= H) return;
  const i = (y * W + x) * 4;
  pixels[i] = r; pixels[i+1] = g; pixels[i+2] = b; pixels[i+3] = a;
}

// Background
for (let i = 0; i < W * H * 4; i += 4) {
  pixels[i] = 26; pixels[i+1] = 26; pixels[i+2] = 46; pixels[i+3] = 255;
}

// Red border
for (let x = 0; x < W; x++) { setPixel(x,0,233,69,96); setPixel(x,H-1,233,69,96); }
for (let y = 0; y < H; y++) { setPixel(0,y,233,69,96); setPixel(W-1,y,233,69,96); }

// White "L" for LifeCheck
const letterPixels = [
  [4,3],[4,4],[4,5],[4,6],[4,7],[4,8],[4,9],[4,10],[4,11],
  [5,11],[6,11],[7,11],[8,11],[9,11],[10,11]
];
for (const [x, y] of letterPixels) setPixel(x, y, 255, 255, 255);

// Small diamond accent
setPixel(11, 4, 233, 69, 96);
setPixel(12, 5, 233, 69, 96);
setPixel(11, 6, 233, 69, 96);
setPixel(10, 5, 233, 69, 96);

const outPath = path.join(__dirname, 'assets', 'tray-icon.png');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, createPNG(W, H, pixels));
console.log('Icon generated at', outPath);
