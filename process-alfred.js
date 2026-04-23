// node process-alfred.js
// Quita el fondo gris y espeja horizontalmente la imagen de Alfred
const { Jimp } = require('jimp');
const path = require('path');

const SRC  = path.join(__dirname, 'assets', 'alfred.png');
const DEST = path.join(__dirname, 'assets', 'alfred.png');

async function process() {
  const img = await Jimp.read(SRC);
  const { width, height, data } = img.bitmap;

  // Quitar fondo: pixels grises claros → transparentes
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];

      const isGray   = Math.abs(r - g) < 18 && Math.abs(g - b) < 18 && Math.abs(r - b) < 18;
      const isBright = r > 190 && g > 190 && b > 190;

      if (isGray && isBright) {
        data[idx + 3] = 0; // transparente
      }
    }
  }

  // Espejar horizontalmente → Alfred mira hacia la izquierda
  img.flip({ horizontal: true });

  await img.write(DEST);
  console.log('Alfred procesado: fondo removido + espejado →', DEST);
}

process().catch(err => console.error('Error:', err.message));
