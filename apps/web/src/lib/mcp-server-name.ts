const HOST_NOISE = new Set(["mcp", "api", "www", "remote", "server"]);

/** A readable name from an address, so the owner only has to paste the address. */
export function suggestedServerName(endpoint: string): string {
  let url: URL;
  try {
    url = new URL(endpoint.trim());
  } catch {
    return "";
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (/^[\d.:]+$/.test(host) || host === "localhost") return url.host;
  const label = host.split(".").find((part) => !HOST_NOISE.has(part)) ?? host;
  return label.charAt(0).toUpperCase() + label.slice(1);
}
