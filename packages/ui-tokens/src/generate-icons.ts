import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { ENGAZ_FACE_PATH, ENGAZ_FACE_VIEWBOX, ENGAZ_ICON, lightTokens } from "./index.js";

// Regenerates every exported icon from the face path in brand.ts. Run with
// `pnpm --filter @engaz/ui-tokens generate:icons`, then review the images.

type Appearance = "light" | "dark";

const repo = (path: string) => fileURLToPath(new URL(`../../../${path}`, import.meta.url));

// Artwork units: the face is drawn on a 1080 square and its body ends at the bottom
// edge. Android layers are larger than the visible mask, so they continue the body
// straight down from its last row (x 98–1001).
const SIZE = 1080;
const BODY_EXTENSION = '<rect x="98" y="1070" width="903" height="600"/>';

function face(fill: string, extendBody = false): string {
  return `<g fill="${fill}"><path fill-rule="evenodd" d="${ENGAZ_FACE_PATH}"/>${extendBody ? BODY_EXTENSION : ""}</g>`;
}

function background(appearance: Appearance, radius = SIZE / 2): string {
  const { center, edge } = ENGAZ_ICON[appearance];
  return (
    `<radialGradient id="bg-${appearance}" cx="540" cy="540" r="${radius}" gradientUnits="userSpaceOnUse">` +
    `<stop offset="0" stop-color="${center}"/><stop offset="1" stop-color="${edge}"/></radialGradient>` +
    `<rect width="${SIZE}" height="${SIZE}" fill="url(#bg-${appearance})"/>`
  );
}

/** The app icon: gradient square with the face cropped by its edges. */
function icon(appearance: Appearance, rounded: boolean): string {
  const clip = `clip-${appearance}`;
  return (
    `<clipPath id="${clip}"><rect width="${SIZE}" height="${SIZE}" rx="${rounded ? ENGAZ_ICON.cornerRadius : 0}"/></clipPath>` +
    `<g clip-path="url(#${clip})">${background(appearance)}${face(ENGAZ_ICON[appearance].face)}</g>`
  );
}

function svg(body: string, viewBox = ENGAZ_FACE_VIEWBOX): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">${body}</svg>\n`;
}

/** Light icon in light browser chrome, dark icon in dark chrome. */
const adaptiveIconSvg = svg(
  "<style>.dark{display:none}@media (prefers-color-scheme:dark){.light{display:none}.dark{display:inline}}</style>" +
    `<g class="light">${icon("light", true)}</g><g class="dark">${icon("dark", true)}</g>`,
);

// Rasterize large, then downsample, so small sizes keep smooth edges.
function render(source: string, size: number): Promise<Buffer> {
  return sharp(Buffer.from(source), { density: (72 * 2048) / SIZE })
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toBuffer();
}

async function png(source: string, size: number, path: string): Promise<void> {
  writeFileSync(repo(path), await render(source, size));
}

/** A Windows/legacy .ico holding PNG images, which every supported reader accepts. */
function ico(images: { size: number; data: Buffer }[]): Buffer {
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, data }, index) => {
    const entry = 6 + 16 * index;
    header.writeUInt8(size >= 256 ? 0 : size, entry);
    header.writeUInt8(size >= 256 ? 0 : size, entry + 1);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(data.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...images.map(({ data }) => data)]);
}

async function writeIco(source: string, sizes: number[], path: string): Promise<void> {
  const images = await Promise.all(
    sizes.map(async (size) => ({ size, data: await render(source, size) })),
  );
  writeFileSync(repo(path), ico(images));
}

/** Places the artwork, scaled by `scale`, at the center of a canvas of the same units. */
function centered(body: string, scale: number): string {
  const offset = (SIZE * (1 - scale)) / 2;
  return `<g transform="translate(${offset} ${offset}) scale(${scale})">${body}</g>`;
}

const roundedDark = svg(icon("dark", true));
const squareDark = svg(icon("dark", false));

// Android masks show at most the middle 72 of 108 dp and guarantee a 66 dp circle;
// this scale keeps the marks above the face inside that circle.
const ANDROID_SCALE = 0.57;

writeFileSync(repo("packages/ui-tokens/assets/brand/engaz-face.svg"), svg(face("currentColor")));

for (const site of ["apps/web/public", "apps/www/public"]) {
  writeFileSync(repo(`${site}/favicon.svg`), adaptiveIconSvg);
  await writeIco(roundedDark, [16, 32, 48], `${site}/favicon.ico`);
  await png(roundedDark, 16, `${site}/favicon-16x16.png`);
  await png(roundedDark, 32, `${site}/favicon-32x32.png`);
  // iOS and install prompts apply their own mask, so these stay square.
  await png(squareDark, 180, `${site}/apple-touch-icon.png`);
  await png(squareDark, 192, `${site}/icon-192.png`);
  await png(squareDark, 512, `${site}/icon-512.png`);
}
writeFileSync(repo("apps/www/public/brand/engaz-mark.svg"), adaptiveIconSvg);

const socialPreview = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="${lightTokens.background}"/>
  <g transform="translate(54 66) scale(0.46)">${icon("light", true)}</g>
  <path d="M580 94v442" stroke="${lightTokens.border}"/>
  <text x="640" y="254" fill="${lightTokens.foreground}" font-family="Arial, Helvetica, sans-serif" font-size="96" font-weight="700" letter-spacing="-5">Engaz</text>
  <text x="645" y="326" fill="${lightTokens.mutedForeground}" font-family="Arial, Helvetica, sans-serif" font-size="27" font-weight="700" letter-spacing="4">AI TEAMMATES.</text>
  <text x="645" y="372" fill="${lightTokens.mutedForeground}" font-family="Arial, Helvetica, sans-serif" font-size="27" font-weight="700" letter-spacing="4">REAL PROGRESS.</text>
</svg>`;
writeFileSync(
  repo("apps/www/public/og-image.png"),
  await sharp(Buffer.from(socialPreview)).png({ compressionLevel: 9 }).toBuffer(),
);

await png(roundedDark, 1024, "apps/desktop/assets/icon.png");
await writeIco(roundedDark, [16, 24, 32, 48, 64, 128, 256], "apps/desktop/assets/icon.ico");
// macOS draws unpackaged Dock icons as-is: Apple's 824-point tile inside a 1024 canvas,
// over a soft shadow. Blurring separately keeps the gradient free of filter banding.
const TILE = 824;
const tileShadow = await sharp(
  Buffer.from(
    svg(
      `<rect width="${SIZE}" height="${SIZE}" rx="${ENGAZ_ICON.cornerRadius}" fill-opacity="0.35"/>`,
    ),
  ),
  { density: (72 * TILE) / SIZE },
)
  .resize(TILE, TILE)
  .extend({ top: 20, bottom: 20, left: 20, right: 20, background: "#0000" })
  .blur(14)
  .png()
  .toBuffer();
writeFileSync(
  repo("apps/desktop/assets/icon-macos.png"),
  await sharp({ create: { width: 1024, height: 1024, channels: 4, background: "#0000" } })
    .composite([
      { input: tileShadow, left: 80, top: 92 },
      { input: await render(roundedDark, TILE), left: 100, top: 100 },
    ])
    .png({ compressionLevel: 9 })
    .toBuffer(),
);
// Icon Composer supplies the background, mask, and lighting around this layer.
await png(
  svg(face(ENGAZ_ICON.dark.face)),
  1024,
  "packages/ui-tokens/assets/Engaz.icon/Assets/engaz-face.png",
);

await png(squareDark, 1024, "apps/mobile/assets/icon.png");
await png(roundedDark, 48, "apps/mobile/assets/favicon.png");
await png(
  svg(centered(icon("dark", true), 620 / 1024)),
  1024,
  "apps/mobile/assets/splash-icon.png",
);
const androidForeground = svg(centered(face("#ffffff", true), ANDROID_SCALE));
await png(androidForeground, 1024, "apps/mobile/assets/adaptive-icon.png");
await png(androidForeground, 1024, "apps/mobile/assets/monochrome-icon.png");
await png(
  svg(background("dark", (SIZE / 2) * ANDROID_SCALE)),
  1024,
  "apps/mobile/assets/icon-background.png",
);
// Android tints notification icons, so only the silhouette's alpha matters.
await png(svg(centered(face("#ffffff"), 80 / 96)), 96, "apps/mobile/assets/notification-icon.png");
