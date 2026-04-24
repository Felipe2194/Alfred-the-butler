// node process-sprites.js
// Extracts all 5 Alfred frames from AlfredTotal.png and saves them individually.
//
// Sheet layout (3 cols × 2 rows, 2048×2048):
//   [0,0] idle      [1,0] walk-1   [2,0] walk-2
//   [0,1] walk-3    [1,1] walk-4   [2,1] (empty)
//
// Each frame is:
//   1. Cropped from its grid cell
//   2. Background-removed via flood-fill from edges + fringe erosion
//   3. Trimmed to tight bounding box
//   4. Padded to a common square size (bottom-aligned, centered)
//   5. Mirrored horizontally so Alfred faces left by default
//   6. Saved to assets/

const { Jimp } = require('jimp');
const path     = require('path');

const SRC  = 'C:/Users/bonzo/Downloads/AlfredTotal.png';
const DEST = path.join(__dirname, 'assets');

// ─── Background detection ──────────────────────────────────────────────────
// White background with tolerance to handle slight JPEG-style artifacts.
function isBg(r, g, b) {
  return r > 210 && g > 210 && b > 210;
}

// ─── Remove background from a Jimp image in-place ─────────────────────────
// Step 1 — flood-fill from all four edges (connected background only).
// Step 2 — fringe erosion: remove near-white pixels adjacent to transparency.
function removeBg(img) {
  const { width, height, data } = img.bitmap;
  const visited = new Uint8Array(width * height);
  const queue   = [];

  function enq(x, y) {
    if (x < 0 || x >= width || y < 0 || y >= height) return;
    const pos = y * width + x;
    if (visited[pos]) return;
    const i = pos * 4;
    if (data[i + 3] === 0) return;
    if (!isBg(data[i], data[i + 1], data[i + 2])) return;
    visited[pos] = 1;
    queue.push(x, y);
  }

  for (let x = 0; x < width;  x++) { enq(x, 0); enq(x, height - 1); }
  for (let y = 0; y < height; y++) { enq(0, y); enq(width - 1, y);  }

  let head = 0;
  while (head < queue.length) {
    const x = queue[head++], y = queue[head++];
    data[(y * width + x) * 4 + 3] = 0;
    enq(x+1,y); enq(x-1,y); enq(x,y+1); enq(x,y-1);
    enq(x+1,y+1); enq(x-1,y-1); enq(x+1,y-1); enq(x-1,y+1);
  }

  // Fringe erosion — two passes to remove anti-aliased edge remnants
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        if (data[i + 3] === 0) continue;
        if (!isBg(data[i], data[i + 1], data[i + 2])) continue;
        let edge = false;
        for (let dy = -1; dy <= 1 && !edge; dy++) {
          for (let dx = -1; dx <= 1 && !edge; dx++) {
            if (!dx && !dy) continue;
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || nx >= width || ny < 0 || ny >= height) { edge = true; break; }
            if (data[(ny * width + nx) * 4 + 3] === 0) edge = true;
          }
        }
        if (edge) data[i + 3] = 0;
      }
    }
  }
}

// ─── Tight bounding box of non-transparent pixels ─────────────────────────
function boundingBox(img) {
  const { width, height, data } = img.bitmap;
  let minX = width, maxX = 0, minY = height, maxY = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return { minX, maxX, minY, maxY };
}

// ─── Find column ranges where sprites live ────────────────────────────────
// Scans the sheet row-by-row to find vertical bands of non-background pixels.
// Returns an array of {x0, x1} ranges, one per sprite column.
function findSpriteColumns(img, rowY, rowH, minGap = 20) {
  const { width, data } = img.bitmap;
  const colHasContent = new Uint8Array(width);

  for (let y = rowY; y < rowY + rowH; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (data[i + 3] > 0 && !isBg(data[i], data[i+1], data[i+2])) {
        colHasContent[x] = 1;
      }
    }
  }

  const ranges = [];
  let inSprite = false, start = 0;
  for (let x = 0; x < width; x++) {
    if (!inSprite && colHasContent[x]) { inSprite = true; start = x; }
    if (inSprite && !colHasContent[x]) {
      // Check if gap is long enough to be a real separator
      let gapEnd = x;
      while (gapEnd < width && !colHasContent[gapEnd]) gapEnd++;
      if (gapEnd - x >= minGap || gapEnd >= width) {
        ranges.push({ x0: start, x1: x - 1 });
        inSprite = false;
        x = gapEnd - 1;
      }
    }
  }
  if (inSprite) ranges.push({ x0: start, x1: width - 1 });
  return ranges;
}

// ─── Main ──────────────────────────────────────────────────────────────────
async function extract() {
  console.log('Reading sprite sheet…');
  const sheet = await Jimp.read(SRC);
  const W = sheet.bitmap.width;   // 2048
  const H = sheet.bitmap.height;  // 2048

  const rowH = Math.floor(H / 2);  // ~1024 per row

  // Auto-detect sprite column boundaries per row
  const row0cols = findSpriteColumns(sheet, 0,    rowH);
  const row1cols = findSpriteColumns(sheet, rowH, rowH);
  console.log(`Row 0: ${row0cols.length} sprites detected`);
  console.log(`Row 1: ${row1cols.length} sprites detected`);

  const cells = [
    { x0: row0cols[0].x0, x1: row0cols[0].x1, y0: 0,    name: 'alfred-idle'   },
    { x0: row0cols[1].x0, x1: row0cols[1].x1, y0: 0,    name: 'alfred-walk-1' },
    { x0: row0cols[2].x0, x1: row0cols[2].x1, y0: 0,    name: 'alfred-walk-2' },
    { x0: row1cols[0].x0, x1: row1cols[0].x1, y0: rowH, name: 'alfred-walk-3' },
    { x0: row1cols[1].x0, x1: row1cols[1].x1, y0: rowH, name: 'alfred-walk-4' },
  ];

  // ── Pass 1: extract, remove bg, find bounding boxes ─────────────────────
  const extracted = [];
  for (const cell of cells) {
    process.stdout.write(`  Extracting ${cell.name}…`);

    const cellW = cell.x1 - cell.x0 + 1;

    // Crop cell from sheet using detected boundaries
    const cropped = sheet.clone().crop({ x: cell.x0, y: cell.y0, w: cellW, h: rowH });

    // Remove background
    removeBg(cropped);

    // Tight bounding box
    const bb = boundingBox(cropped);
    const sprW = bb.maxX - bb.minX + 1;
    const sprH = bb.maxY - bb.minY + 1;

    // Crop to tight bounds
    const tight = cropped.crop({ x: bb.minX, y: bb.minY, w: sprW, h: sprH });

    extracted.push({ img: tight, sprW, sprH, name: cell.name });
    console.log(` ${sprW}×${sprH}px`);
  }

  // ── Pass 2: normalize to common square size ──────────────────────────────
  const maxW  = Math.max(...extracted.map(e => e.sprW));
  const maxH  = Math.max(...extracted.map(e => e.sprH));
  const SIZE  = Math.max(maxW, maxH);
  console.log(`\nNormalising all frames to ${SIZE}×${SIZE}px…`);

  for (const e of extracted) {
    // Transparent canvas of SIZE×SIZE
    const canvas = new Jimp({ width: SIZE, height: SIZE, color: 0x00000000 });

    // Bottom-aligned, horizontally centered
    const offsetX = Math.floor((SIZE - e.sprW) / 2);
    const offsetY = SIZE - e.sprH;

    canvas.composite(e.img, offsetX, offsetY);

    // Mirror so Alfred faces left by default (matching old sprite orientation)
    canvas.flip({ horizontal: true });

    const dest = path.join(DEST, `${e.name}.png`);
    await canvas.write(dest);
    console.log(`  ✓ ${e.name}.png`);
  }

  // Keep backward-compatible aliases so old code referencing alfred.png still works
  const idle = await Jimp.read(path.join(DEST, 'alfred-idle.png'));
  await idle.write(path.join(DEST, 'alfred.png'));
  const walk1 = await Jimp.read(path.join(DEST, 'alfred-walk-1.png'));
  await walk1.write(path.join(DEST, 'alfred-walk.png'));

  console.log('\n✓ All 5 frames ready. Backward-compatible aliases written.');
  console.log('  Restart Alfred to see the smooth 4-frame walk cycle.');
}

extract().catch(err => console.error('Error:', err.message));
