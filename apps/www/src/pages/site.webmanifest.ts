import { lightTokens } from "@engaz/ui-tokens";
import { SITE_DESCRIPTION, SITE_NAME } from "../site";

export function GET() {
  return new Response(
    JSON.stringify({
      name: SITE_NAME,
      short_name: SITE_NAME,
      description: SITE_DESCRIPTION,
      start_url: "/",
      display: "browser",
      background_color: lightTokens.background,
      theme_color: lightTokens.primary,
      icons: [
        { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
        { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      ],
    }),
    { headers: { "Content-Type": "application/manifest+json" } },
  );
}
