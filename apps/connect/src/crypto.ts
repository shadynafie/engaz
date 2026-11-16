import type { Provider, Tokens } from "./platform.js";

const encoder = new TextEncoder();
export function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
export function unbase64url(text: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) throw new Error("Invalid encoding");
  return Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), (char) =>
    char.charCodeAt(0),
  );
}
export function randomSecret(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}
export async function hash(text: string): Promise<string> {
  return base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(text))));
}
export function equalSecret(first: string, second: string): boolean {
  if (first.length !== second.length) return false;
  let difference = 0;
  for (let index = 0; index < first.length; index += 1)
    difference |= first.charCodeAt(index) ^ second.charCodeAt(index);
  return difference === 0;
}
async function key(master: string, purpose: "encryption" | "capability") {
  const bytes = /^[a-f\d]{64}$/i.test(master)
    ? Uint8Array.from(master.match(/../g)!, (value) => Number.parseInt(value, 16))
    : unbase64url(master);
  if (bytes.byteLength !== 32) throw new Error("Invalid key configuration");
  const material = await crypto.subtle.importKey("raw", bytes, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      salt: new Uint8Array(32),
      info: encoder.encode(`engaz-connect-v1:${purpose}`),
      hash: "SHA-256",
    },
    material,
    purpose === "encryption"
      ? { name: "AES-GCM", length: 256 }
      : { name: "HMAC", hash: "SHA-256", length: 256 },
    false,
    purpose === "encryption" ? ["encrypt", "decrypt"] : ["sign", "verify"],
  );
}
export async function validateTokenKey(master: string): Promise<void> {
  await key(master, "capability");
}
export async function seal(master: string, value: unknown): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: encoder.encode("engaz-connect-session-v1") },
    await key(master, "encryption"),
    encoder.encode(JSON.stringify(value)),
  );
  return `${base64url(iv)}.${base64url(new Uint8Array(ciphertext))}`;
}
export async function unseal<T>(master: string, value: string): Promise<T> {
  const [iv, ciphertext, extra] = value.split(".");
  if (!iv || !ciphertext || extra) throw new Error("Invalid encrypted session");
  const clear = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: unbase64url(iv),
      additionalData: encoder.encode("engaz-connect-session-v1"),
    },
    await key(master, "encryption"),
    unbase64url(ciphertext),
  );
  return JSON.parse(new TextDecoder().decode(clear)) as T;
}
interface Capability {
  v: 1;
  audience: string;
  provider: Provider;
  accessHash: string;
  refreshHash: string | null;
}
export async function issueCapability(
  master: string,
  audience: string,
  provider: Provider,
  tokens: Tokens,
): Promise<string> {
  const payload: Capability = {
    v: 1,
    audience,
    provider,
    accessHash: await hash(tokens.accessToken),
    refreshHash: tokens.refreshToken ? await hash(tokens.refreshToken) : null,
  };
  const body = base64url(encoder.encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign(
    "HMAC",
    await key(master, "capability"),
    encoder.encode(body),
  );
  return `${body}.${base64url(new Uint8Array(signature))}`;
}
export async function verifyCapability(
  master: string,
  audience: string,
  provider: Provider,
  credential: string,
  tokens: { accessToken?: string; refreshToken?: string },
  operation: "refresh" | "revoke",
): Promise<boolean> {
  try {
    const [body, signature, extra] = credential.split(".");
    if (!body || !signature || extra || body.length > 4096 || signature.length !== 43) return false;
    if (
      !(await crypto.subtle.verify(
        "HMAC",
        await key(master, "capability"),
        unbase64url(signature),
        encoder.encode(body),
      ))
    )
      return false;
    const capability = JSON.parse(new TextDecoder().decode(unbase64url(body))) as Capability;
    if (capability.v !== 1 || capability.audience !== audience || capability.provider !== provider)
      return false;
    if (operation === "refresh")
      return Boolean(
        tokens.refreshToken &&
          capability.refreshHash &&
          equalSecret(await hash(tokens.refreshToken), capability.refreshHash),
      );
    if (!tokens.accessToken || !equalSecret(await hash(tokens.accessToken), capability.accessHash))
      return false;
    return (
      !tokens.refreshToken ||
      Boolean(
        capability.refreshHash &&
          equalSecret(await hash(tokens.refreshToken), capability.refreshHash),
      )
    );
  } catch {
    return false;
  }
}
