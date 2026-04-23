// node process-walk.js
// Quita el fondo tablero de ajedrez con flood-fill desde las esquinas
const { Jimp } = require('jimp');
const path = require('path');

const SRC  = path.join(__dirname, 'assets', 'alfred-walk.png');
const DEST = path.join(__dirname, 'assets', 'alfred-walk.png');

async function process() {
  const img = await Jimp.read(SRC);
  const { width, height, data } = img.bitmap;

  function isBackground(idx) {
    const r = data[idx], g = data[idx+1], b = data[idx+2];
    // Blanco del tablero: ~254,254,254
    // Gris del tablero:   ~241,241,240
    const isBright = r > 220 && g > 220 && b > 220;
    const isNeutral = Math.abs(r - g) < 20 && Math.abs(g - b) < 20 && Math.abs(r - b) < 20;
    return isBright && isNeutral && data[idx+3] > 0;
  }

  const visited = new Uint8Array(width * height);

  // BFS flood fill desde cada esquina y bordes
  const queue = [];
  function enqueue(x, y) {
    if (x < 0 || x >= width || y < 0 || y >= height) return;
    const pos = y * width + x;
    if (visited[pos]) return;
    const idx = pos * 4;
    if (!isBackground(idx)) return;
    visited[pos] = 1;
    queue.push(x, y);
  }

  // Sembrar desde todos los bordes
  for (let x = 0; x < width; x++) { enqueue(x, 0); enqueue(x, height - 1); }
  for (let y = 0; y < height; y++) { enqueue(0, y); enqueue(width - 1, y); }

  // BFS iterativo
  let head = 0;
  while (head < queue.length) {
    const x = queue[head++];
    const y = queue[head++];
    // Hacer transparente
    const idx = (y * width + x) * 4;
    data[idx + 3] = 0;
    // 4 vecinos + diagonales para cubrir el patron de tablero
    enqueue(x+1, y); enqueue(x-1, y);
    enqueue(x, y+1); enqueue(x, y-1);
    enqueue(x+1, y+1); enqueue(x-1, y-1);
    enqueue(x+1, y-1); enqueue(x-1, y+1);
  }

  // Espejar horizontalmente para que mire a la izquierda (igual que idle)
  img.flip({ horizontal: true });

  await img.write(DEST);
  console.log('Walk sprite procesado →', DEST);
}

process().catch(err => console.error('Error:', err.message));
