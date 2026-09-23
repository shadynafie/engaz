export const HOME_MARKDOWN = `# Engaz

Open-source AI teammates for solo founders and small businesses.

- [Source code](https://github.com/shadynafie/engaz)
- [Self-hosting guide](https://github.com/shadynafie/engaz/blob/main/docs/self-host.md)
`;

export const ABOUT_MARKDOWN = `# About Engaz

Engaz is an open-source AI team workspace in early development. Give agents roles, connect tools, inspect work, and approve important actions.

[Source code](https://github.com/shadynafie/engaz)
`;

export const SUPPORT_MARKDOWN = `# Engaz support

Read the [self-hosting guide](https://github.com/shadynafie/engaz/blob/main/docs/self-host.md) and use [GitHub Issues](https://github.com/shadynafie/engaz/issues) for bugs and questions. Do not include secrets or private data.

Report vulnerabilities through [private vulnerability reporting](https://github.com/shadynafie/engaz/security/advisories/new).
`;

export const PRIVACY_MARKDOWN = `# Engaz privacy

Engaz does not currently offer a hosted service. The operator of a self-hosted installation controls its server, database, files, backups, and provider connections. Configured AI and integration providers may receive task content. Contact your server operator for account or data requests.
`;

export const AGENT_INSTRUCTIONS = `# Engaz

Engaz is an open-source AI team workspace in early development. Use the [self-hosting guide](https://github.com/shadynafie/engaz/blob/main/docs/self-host.md) for installation. Keep credentials and user data out of public issues.
`;

export const NOT_FOUND_MARKDOWN = `# Page not found

- [Source](https://github.com/shadynafie/engaz)
- [Self-hosting guide](https://github.com/shadynafie/engaz/blob/main/docs/self-host.md)
`;

const MARKDOWN_DOCUMENTS = new Map<string, string>([
  ["/", HOME_MARKDOWN],
  ["/about", ABOUT_MARKDOWN],
  ["/privacy", PRIVACY_MARKDOWN],
  ["/support", SUPPORT_MARKDOWN],
]);

type MediaPreference = {
  quality: number;
  specificity: number;
};

export type Representation = "html" | "markdown" | "not-acceptable";

function normalizePathname(pathname: string): string {
  if (pathname === "/") return pathname;
  return pathname.replace(/\/+$/, "");
}

function preferenceFor(accept: string, desiredType: string): MediaPreference {
  const [desiredMajor, desiredMinor] = desiredType.split("/");
  let best: MediaPreference = { quality: 0, specificity: -1 };

  for (const rawRange of accept.split(",")) {
    const [rawType = "", ...rawParameters] = rawRange
      .trim()
      .toLowerCase()
      .split(";");
    const [major, minor] = rawType.trim().split("/");
    if (!major || !minor) continue;

    const specificity =
      major === desiredMajor && minor === desiredMinor
        ? 2
        : major === desiredMajor && minor === "*"
          ? 1
          : major === "*" && minor === "*"
            ? 0
            : -1;
    if (specificity < 0) continue;

    const qualityParameter = rawParameters.find((parameter) =>
      parameter.trim().startsWith("q="),
    );
    const parsedQuality = qualityParameter
      ? Number.parseFloat(qualityParameter.trim().slice(2))
      : 1;
    const quality =
      Number.isFinite(parsedQuality) && parsedQuality >= 0 && parsedQuality <= 1
        ? parsedQuality
        : 0;

    if (
      specificity > best.specificity ||
      (specificity === best.specificity && quality > best.quality)
    ) {
      best = { quality, specificity };
    }
  }

  return best;
}

export function negotiateRepresentation(
  acceptHeader: string | null,
): Representation {
  if (!acceptHeader?.trim()) return "html";

  const markdown = preferenceFor(acceptHeader, "text/markdown");
  const html = preferenceFor(acceptHeader, "text/html");

  if (markdown.quality <= 0 && html.quality <= 0) return "not-acceptable";
  if (markdown.quality > html.quality) return "markdown";
  if (
    markdown.quality === html.quality &&
    markdown.specificity > html.specificity
  )
    return "markdown";
  return "html";
}

export function getMarkdownDocument(pathname: string): string | undefined {
  return MARKDOWN_DOCUMENTS.get(normalizePathname(pathname));
}

export function getMarkdownAlternate(pathname: string): string | undefined {
  const normalizedPathname = normalizePathname(pathname);
  if (!MARKDOWN_DOCUMENTS.has(normalizedPathname)) return undefined;
  return normalizedPathname === "/" ? "/index.md" : `${normalizedPathname}.md`;
}

export function markdownResponse(
  body: string,
  method = "GET",
  status = 200,
): Response {
  return new Response(method === "HEAD" ? null : body, {
    status,
    headers: {
      "Cache-Control": "public, max-age=0, must-revalidate",
      "Content-Language": "en",
      "Content-Type": "text/markdown; charset=utf-8",
      Link: '</llms.txt>; rel="describedby"; type="text/plain"',
      Vary: "Accept, Accept-Encoding",
    },
  });
}
