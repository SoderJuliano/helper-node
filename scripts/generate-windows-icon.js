// scripts/generate-windows-icon.js
// Gera assets/windows.ico a partir de assets/linux.png (512x512), sem depender
// de ImageMagick (não vem no Windows). Usa `sharp` (já é dependência do app)
// para reamostrar em múltiplos tamanhos e monta o container .ico na mão —
// cada entrada guarda um PNG comprimido, formato aceito desde o Windows Vista.

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const SRC = path.join(__dirname, '..', 'assets', 'linux.png');
const OUT = path.join(__dirname, '..', 'assets', 'windows.ico');
const SIZES = [16, 32, 48, 64, 128, 256];

async function buildIco() {
    const pngBuffers = await Promise.all(
        SIZES.map((size) => sharp(SRC).resize(size, size).png().toBuffer())
    );

    const headerSize = 6;
    const dirEntrySize = 16;
    const dataOffsetStart = headerSize + dirEntrySize * SIZES.length;

    const header = Buffer.alloc(headerSize);
    header.writeUInt16LE(0, 0); // reserved
    header.writeUInt16LE(1, 2); // type: 1 = icon
    header.writeUInt16LE(SIZES.length, 4); // image count

    const dirEntries = [];
    let offset = dataOffsetStart;
    SIZES.forEach((size, i) => {
        const buf = pngBuffers[i];
        const entry = Buffer.alloc(dirEntrySize);
        entry.writeUInt8(size >= 256 ? 0 : size, 0); // width (0 = 256)
        entry.writeUInt8(size >= 256 ? 0 : size, 1); // height (0 = 256)
        entry.writeUInt8(0, 2); // color palette
        entry.writeUInt8(0, 3); // reserved
        entry.writeUInt16LE(1, 4); // color planes
        entry.writeUInt16LE(32, 6); // bits per pixel
        entry.writeUInt32LE(buf.length, 8); // size of image data
        entry.writeUInt32LE(offset, 12); // offset of image data
        dirEntries.push(entry);
        offset += buf.length;
    });

    const ico = Buffer.concat([header, ...dirEntries, ...pngBuffers]);
    fs.writeFileSync(OUT, ico);
    console.log(`OK: ${OUT} (${SIZES.join('x, ')}x — ${(ico.length / 1024).toFixed(1)} KB)`);
}

buildIco().catch((err) => {
    console.error('Falha ao gerar windows.ico:', err.message);
    process.exit(1);
});
