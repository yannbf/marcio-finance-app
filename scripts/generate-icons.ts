import { mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import sharp from "sharp";

/**
 * Generate PWA icons + apple-touch-icon from an inline SVG. Outputs PNG
 * files under public/. Run with: pnpm tsx scripts/generate-icons.ts
 */

const BG = "#0B0D10";
const FG = "#22C9A4"; // approx --primary teal in sRGB

function svg(size: number, radius: number): string {
  const r = radius;
  const fontSize = Math.round(size * 0.55);
  const cy = Math.round(size * 0.7);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <rect width="${size}" height="${size}" rx="${r}" ry="${r}" fill="${BG}"/>
    <text x="50%" y="${cy}" text-anchor="middle"
      font-family="-apple-system,BlinkMacSystemFont,Inter,sans-serif"
      font-weight="700" font-size="${fontSize}" fill="${FG}">M</text>
  </svg>`;
}

const SIZES: { name: string; size: number; radius: number }[] = [
  { name: "icon-192.png", size: 192, radius: 36 },
  { name: "icon-512.png", size: 512, radius: 96 },
  { name: "apple-touch-icon.png", size: 180, radius: 36 },
  { name: "icon-maskable-512.png", size: 512, radius: 0 }, // square for maskable
];

async function main() {
  const out = join(process.cwd(), "public");
  await mkdir(out, { recursive: true });
  for (const { name, size, radius } of SIZES) {
    const buf = Buffer.from(svg(size, radius));
    const png = await sharp(buf).png().toBuffer();
    const path = join(out, name);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, png);
    console.log(`wrote ${path} (${png.byteLength} bytes)`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
