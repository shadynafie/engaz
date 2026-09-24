# Brand and app icon source

`brand/` holds the designer's artwork: the Engaz face in black and white, and the
light and dark app icons. `src/brand.ts` traces the face into one vector path and
records the icon background gradient and corner radius. Web, desktop, and mobile
icons are drawn from that path; do not edit the exported images by hand.

After changing the artwork or `brand.ts`, run:

```bash
pnpm --filter @engaz/ui-tokens generate:icons
```

It writes:

- `apps/web/public` and `apps/www/public`: `favicon.svg` (light icon in light browser
  chrome, dark icon in dark), dark `favicon.ico` and small PNGs, and square
  `apple-touch-icon.png`, `icon-192.png`, and `icon-512.png` for platforms that apply
  their own mask. The marketing header reuses `favicon.svg` as `brand/engaz-mark.svg`.
  The marketing social preview uses the same face and light palette.
- `apps/desktop/assets`: the rounded dark icon as `icon.png` and `icon.ico` for Linux and
  Windows, and `icon-macos.png`, Apple's 824-point tile with a shadow inside a 1024 canvas,
  for unpackaged Dock launches.
- `Engaz.icon/Assets/engaz-face.png`: the white face layer for Icon Composer, which
  supplies the dark background, mask, and lighting for macOS Tahoe and iOS. Open
  `Engaz.icon` in Icon Composer (Xcode 26 or newer) to adjust those effects.
- `apps/mobile/assets`: the opaque square `icon.png`; Android's adaptive foreground,
  monochrome layer, and gradient background; `splash-icon.png`; `favicon.png`; and the
  notification silhouette. Android layers keep the face and marks inside the launcher's
  66 dp safe circle and extend the body below the mask. Never bake corners or shadows
  into adaptive layers.

In the product, `EngazMark` from `@engaz/ui-web` draws the same face with theme tokens.
