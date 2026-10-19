// AES-GCM encryption for refresh tokens at rest. Key: TOKEN_ENCRYPTION_KEY (32 bytes, base64).

function b64encode(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function b64decode(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function getKey(rawKey = process.env.TOKEN_ENCRYPTION_KEY): Promise<CryptoKey> {
  if (!rawKey) throw new Error("TOKEN_ENCRYPTION_KEY is not set");
  const bytes = b64decode(rawKey);
  if (bytes.length !== 32) throw new Error("TOKEN_ENCRYPTION_KEY must be 32 bytes, base64-encoded");
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encrypt(plaintext: string, rawKey?: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await getKey(rawKey),
    new TextEncoder().encode(plaintext),
  );
  return `${b64encode(iv)}.${b64encode(new Uint8Array(data))}`;
}

export async function decrypt(ciphertext: string, rawKey?: string): Promise<string> {
  const [iv, data] = ciphertext.split(".");
  if (!iv || !data) throw new Error("Malformed ciphertext");
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: b64decode(iv) },
    await getKey(rawKey),
    b64decode(data),
  );
  return new TextDecoder().decode(plain);
}

export function randomToken(bytes = 32): string {
  return b64encode(crypto.getRandomValues(new Uint8Array(bytes)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
