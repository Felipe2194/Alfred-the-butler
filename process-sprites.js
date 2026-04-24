// node process-sprites.js
// Reprocesa ambos sprites desde los originales usando flood-fill desde bordes
// (no global threshold → preserva camisa, ojos, corbata blanca)
// Incluye paso de fringe removal para eliminar pixels anti-aliased residuales.
const { Jimp } = require('jimp');
const path = require('path');
const fs   = require('fs');

// ─── Flood fill desde bordes ────────────────────────────────────────────────
// Solo hace transparente los pixels conectados al exterior que coincidan con
// la condicion isBg. El interior del personaje queda intacto.
function floodFillBg(img, isBg) {
  const { width, height, data } = img.bitmap;
  const visited = new Uint8Array(width * height);
  const queue   = [];

  function enqueue(x, y) {
    if (x < 0 || x >= width || y < 0 || y >= height) return;
    const pos = y * width + x;
    if (visited[pos]) return;
    if (!isBg(data, pos * 4)) return;
    visited[pos] = 1;
    queue.push(x, y);
  }

  // Sembrar todos los bordes
  for (let x = 0; x < width;  x++) { enqueue(x, 0); enqueue(x, height - 1); }
  for (let y = 0; y < height; y++) { enqueue(0, y); enqueue(width - 1, y); }

  let head = 0;
  while (head < queue.length) {
    const x = queue[head++];
    const y = queue[head++];
    data[(y * width + x) * 4 + 3] = 0; // transparente
    // 8 vecinos para no dejar pixels colgados en esquinas
    enqueue(x+1,y); enqueue(x-1,y); enqueue(x,y+1); enqueue(x,y-1);
    enqueue(x+1,y+1); enqueue(x-1,y-1); enqueue(x+1,y-1); enqueue(x-1,y+1);
  }
}

// ─── Fringe removal ─────────────────────────────────────────────────────────
// El flood-fill con tolerancia ±20-25 deja pixels anti-aliased en los bordes
// del personaje: mezclas parciales entre el fondo y el color del borde del
// sprite. Estos aparecen como líneas blancas sobre fondos oscuros.
//
// Este paso usa tolerancia más amplia (±60) pero SOLO elimina pixels que:
//   (a) son cercanos al color de fondo, Y
//   (b) están adyacentes a un pixel ya transparente (verdadero borde externo)
// Corre hasta 3 pasadas iterativas para cubrir bandas de fringe de varios pixels.
function removeFringe(img, bgR, bgG, bgB, bgR2, bgG2, bgB2) {
  const { width, height, data } = img.bitmap;
  const TOL = 60;

  function nearBg(i) {
    if (data[i+3] === 0) return false;
    const r = data[i], g = data[i+1], b = data[i+2];
    const match1 = Math.abs(r-bgR)<TOL && Math.abs(g-bgG)<TOL && Math.abs(b-bgB)<TOL;
    const match2 = bgR2 !== undefined
      ? Math.abs(r-bgR2)<TOL && Math.abs(g-bgG2)<TOL && Math.abs(b-bgB2)<TOL
      : false;
    return match1 || match2;
  }

  for (let pass = 0; pass < 3; pass++) {
    let changed = false;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        if (data[i+3] === 0) continue;
        if (!nearBg(i)) continue;

        // Solo eliminar si el pixel está en el borde (adyacente a transparente)
        let isEdge = false;
        for (let dy = -1; dy <= 1 && !isEdge; dy++) {
          for (let dx = -1; dx <= 1 && !isEdge; dx++) {
            if (!dx && !dy) continue;
            const nx = x+dx, ny = y+dy;
            if (nx<0||nx>=width||ny<0||ny>=height) { isEdge=true; break; }
            if (data[(ny*width+nx)*4+3] === 0) isEdge = true;
          }
        }
        if (isEdge) { data[i+3] = 0; changed = true; }
      }
    }
    if (!changed) break;
  }
}

// ─── Sprite 1: alfred.png (fondo gris uniforme ~236,236,236) ───────────────
async function processIdle() {
  const src  = 'C:/Users/bonzo/Downloads/Alfred.png';
  const dest = path.join(__dirname, 'assets', 'alfred.png');

  const img = await Jimp.read(src);

  // Muestrear el color exacto del fondo desde la esquina
  const { data, width } = img.bitmap;
  const bgR = data[0], bgG = data[1], bgB = data[2];
  console.log('alfred.png bg color sampled:', bgR, bgG, bgB);

  floodFillBg(img, (d, i) => {
    const dr = Math.abs(d[i]   - bgR);
    const dg = Math.abs(d[i+1] - bgG);
    const db = Math.abs(d[i+2] - bgB);
    return dr < 25 && dg < 25 && db < 25 && d[i+3] > 0;
  });

  // Limpiar fringe anti-aliased residual
  removeFringe(img, bgR, bgG, bgB);

  // Espejar → mira a la izquierda
  img.flip({ horizontal: true });

  await img.write(dest);
  console.log('✓ alfred.png procesado');
}

// ─── Sprite 2: alfred-walk.png (fondo tablero blanco+gris claro) ──────────
async function processWalk() {
  const src  = 'C:/Users/bonzo/Downloads/Alfred movimientos.png';
  const dest = path.join(__dirname, 'assets', 'alfred-walk.png');

  const img = await Jimp.read(src);
  const { data, width, height } = img.bitmap;

  // El tablero tiene dos colores — muestrear ambos
  // Esquina sup-izq: blanco ~254,254,254
  // Pixel (1,1): gris claro ~241,241,240
  const w1R = data[0], w1G = data[1], w1B = data[2];
  const w2R = data[((1*width+1)*4)], w2G = data[((1*width+1)*4)+1], w2B = data[((1*width+1)*4)+2];
  console.log('Walk bg color 1 (corner):', w1R, w1G, w1B);
  console.log('Walk bg color 2 (1,1):', w2R, w2G, w2B);

  floodFillBg(img, (d, i) => {
    const r = d[i], g = d[i+1], b = d[i+2], a = d[i+3];
    if (a === 0) return false;
    // Coincide con alguno de los dos tonos del tablero
    const matchW1 = Math.abs(r-w1R)<20 && Math.abs(g-w1G)<20 && Math.abs(b-w1B)<20;
    const matchW2 = Math.abs(r-w2R)<20 && Math.abs(g-w2G)<20 && Math.abs(b-w2B)<20;
    return matchW1 || matchW2;
  });

  // Limpiar fringe de ambos colores del tablero
  removeFringe(img, w1R, w1G, w1B, w2R, w2G, w2B);

  // Espejar → mira a la izquierda igual que idle
  img.flip({ horizontal: true });

  await img.write(dest);
  console.log('✓ alfred-walk.png procesado');
}

// ─── Run ───────────────────────────────────────────────────────────────────
Promise.all([processIdle(), processWalk()])
  .then(() => console.log('\nAmbos sprites listos.'))
  .catch(err => console.error('Error:', err.message));
