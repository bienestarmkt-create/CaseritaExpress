const sharp = require('sharp');
const path = require('path');

const INPUT  = path.join(__dirname, '../assets/images/CaseritaExpress.png');
const OUTPUT = path.join(__dirname, '../assets/images/icon.png');

const CANVAS  = 1024;
const PADDING = 100;
const LOGO_SIZE = CANVAS - PADDING * 2; // 824

async function main() {
  // Resize logo to fit within the padded area, keeping aspect ratio
  const logoBuffer = await sharp(INPUT)
    .resize(LOGO_SIZE, LOGO_SIZE, { fit: 'inside', withoutEnlargement: false })
    .png()
    .toBuffer();

  // Get dimensions of the resized logo
  const { width, height } = await sharp(logoBuffer).metadata();

  const left = Math.round((CANVAS - width)  / 2);
  const top  = Math.round((CANVAS - height) / 2);

  await sharp({
    create: {
      width: CANVAS,
      height: CANVAS,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    },
  })
    .composite([{ input: logoBuffer, left, top }])
    .png()
    .toFile(OUTPUT);

  console.log(`Generated ${OUTPUT} (${CANVAS}x${CANVAS}, logo ${width}x${height} at ${left},${top})`);
}

main().catch((err) => { console.error(err); process.exit(1); });
