// Procedural icons: a knob on a dark panel. No binary assets to maintain.
import { mkdir, writeFile } from 'node:fs/promises';
import sharp from 'sharp';

const svg = (size, { maskable = false, opaque = false } = {}) => {
  const pad = maskable ? size * 0.1 : 0;      // maskable icons need a safe zone
  const r = (size - pad * 2) * 0.32;
  const c = size / 2;
  // Maskable icons must fill the whole canvas (OS masks can turn transparent
  // areas into a hole), and callers can force opaque for platforms that don't
  // honour PNG transparency (e.g. apple-touch-icon on iOS). Everything else
  // renders on a transparent background.
  const bg = maskable || opaque ? `<rect width="${size}" height="${size}" fill="#1b1b1e"/>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
  ${bg}
  <circle cx="${c}" cy="${c}" r="${r * 1.36}" fill="none" stroke="#d8a13a" stroke-width="${size * 0.045}"
          stroke-dasharray="${2 * Math.PI * r * 1.36 * 0.75} ${2 * Math.PI * r * 1.36}"
          transform="rotate(135 ${c} ${c})"/>
  <circle cx="${c}" cy="${c}" r="${r}" fill="#33333a" stroke="#0e0e10" stroke-width="${size * 0.012}"/>
  <line x1="${c}" y1="${c - r * 0.25}" x2="${c}" y2="${c - r * 0.85}"
        stroke="#f2ead8" stroke-width="${size * 0.045}" stroke-linecap="round"/>
</svg>`;
};

await mkdir('public/icons', { recursive: true });

for (const [name, size, maskable] of [
  ['icon-192.png', 192, false],
  ['icon-512.png', 512, false],
  ['icon-maskable-512.png', 512, true],
]) {
  await sharp(Buffer.from(svg(size, { maskable }))).png().toFile(`public/icons/${name}`);
  console.log(`wrote public/icons/${name}`);
}

await writeFile('public/icons/.gitkeep', '');

// Favicons need a separate, simplified variant of the mark. The full artwork's
// stroke widths and knob radius are proportional to size (size * 0.045 for
// strokes, size * 0.32 for the knob radius) and that ratio only reads at
// icon.png sizes (192/512). At 16-32px the amber arc and pointer line get
// thin enough to vanish or dither into grey, and the knob itself looks like
// an indistinct blob. So: drop the arc entirely, enlarge the knob, and
// thicken + lengthen the pointer so it survives downscaling.
const faviconSvg = (size) => {
  const r = size * 0.38;
  const c = size / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <circle cx="${c}" cy="${c}" r="${r}" fill="#33333a" stroke="#0e0e10" stroke-width="${size * 0.02}"/>
  <line x1="${c}" y1="${c - r * 0.15}" x2="${c}" y2="${c - r * 0.88}"
        stroke="#f2ead8" stroke-width="${size * 0.11}" stroke-linecap="round"/>
</svg>`;
};

// favicon.svg: base the coordinate system on a 32px canvas. Every dimension
// in faviconSvg is proportional to `size`, so this renders identically sharp
// at any display size a browser scales it to.
await writeFile('public/favicon.svg', faviconSvg(32));
console.log('wrote public/favicon.svg');

const faviconPngBuffers = {};
for (const size of [16, 32]) {
  const buf = await sharp(Buffer.from(faviconSvg(size))).png().toBuffer();
  faviconPngBuffers[size] = buf;
  await writeFile(`public/favicon-${size}.png`, buf);
  console.log(`wrote public/favicon-${size}.png`);
}

// apple-touch-icon: full artwork (arc included — it reads fine at 180px),
// solid dark ground since iOS does not honour transparency.
await sharp(Buffer.from(svg(180, { opaque: true }))).png().toFile('public/apple-touch-icon.png');
console.log('wrote public/apple-touch-icon.png');

// favicon.ico: sharp has no ICO encoder, and adding a dependency for a
// 38-byte header is not worth it — ICO permits embedding PNG data directly
// (the "PNG in ICO" form every modern consumer of .ico understands). Write
// the container by hand: a 6-byte ICONDIR, two 16-byte ICONDIRENTRY records
// (16px first), then the two PNG payloads back to back. All fields
// little-endian.
const icoEntries = [
  { size: 16, png: faviconPngBuffers[16] },
  { size: 32, png: faviconPngBuffers[32] },
];

const ICONDIR_SIZE = 6;
const ICONDIRENTRY_SIZE = 16;
const headerSize = ICONDIR_SIZE + ICONDIRENTRY_SIZE * icoEntries.length;

const iconDir = Buffer.alloc(ICONDIR_SIZE);
iconDir.writeUInt16LE(0, 0); // reserved
iconDir.writeUInt16LE(1, 2); // type = 1 (icon)
iconDir.writeUInt16LE(icoEntries.length, 4); // count

let offset = headerSize;
const dirEntries = [];
for (const entry of icoEntries) {
  const dirEntry = Buffer.alloc(ICONDIRENTRY_SIZE);
  dirEntry.writeUInt8(entry.size === 256 ? 0 : entry.size, 0); // width (0 means 256)
  dirEntry.writeUInt8(entry.size === 256 ? 0 : entry.size, 1); // height
  dirEntry.writeUInt8(0, 2); // colour count
  dirEntry.writeUInt8(0, 3); // reserved
  dirEntry.writeUInt16LE(1, 4); // planes
  dirEntry.writeUInt16LE(32, 6); // bit count
  dirEntry.writeUInt32LE(entry.png.length, 8); // bytes in resource
  dirEntry.writeUInt32LE(offset, 12); // image offset
  dirEntries.push(dirEntry);
  offset += entry.png.length;
}

const ico = Buffer.concat([iconDir, ...dirEntries, ...icoEntries.map((e) => e.png)]);
await writeFile('public/favicon.ico', ico);
console.log(`wrote public/favicon.ico (${ico.length} bytes)`);

// Social share card (Open Graph / Twitter): same knob-on-panel motif as the
// app icon, plus the wordmark and tagline. 1200x630 is the standard OG ratio.
// Font family is a generic stack (no bundled fonts) since sharp's SVG
// rasteriser (librsvg) resolves text through the host's fontconfig, not a
// browser — see the verification step in npm run gen:icons for how to check
// the text actually rendered.
const ogCardSvg = () => {
  const width = 1200;
  const height = 630;
  const cx = 230;
  const cy = height / 2;
  const r = 125;
  const textX = 460;
  const font = 'system-ui, -apple-system, Segoe UI, Helvetica, Arial, sans-serif';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="#1b1b1e"/>
  <rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" fill="none" stroke="#0e0e10" stroke-width="1"/>

  <circle cx="${cx}" cy="${cy}" r="${r * 1.36}" fill="none" stroke="#d8a13a" stroke-width="${r * 0.09}"
          stroke-dasharray="${2 * Math.PI * r * 1.36 * 0.75} ${2 * Math.PI * r * 1.36}"
          transform="rotate(135 ${cx} ${cy})"/>
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="#33333a" stroke="#0e0e10" stroke-width="${r * 0.025}"/>
  <line x1="${cx}" y1="${cy - r * 0.25}" x2="${cx}" y2="${cy - r * 0.85}"
        stroke="#f2ead8" stroke-width="${r * 0.09}" stroke-linecap="round"/>

  <text x="${textX}" y="290" font-family="${font}" font-size="76" font-weight="700"
        letter-spacing="8" fill="#cfc8b8">SARLIFIER</text>
  <text x="${textX + 2}" y="354" font-family="${font}" font-size="26" fill="#8a857a">A browser-based amp &amp; tone stack built by someone</text>
  <text x="${textX + 2}" y="388" font-family="${font}" font-size="26" fill="#8a857a">who still double-checks his pointer math.</text>
</svg>`;
};

await sharp(Buffer.from(ogCardSvg())).png().toFile('public/og-card.png');
console.log('wrote public/og-card.png');
