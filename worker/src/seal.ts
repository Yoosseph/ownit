// Debrief state (questions and their references) travels between requests as
// an AES-GCM sealed token held by the CLI. The worker stores no references, and
// the CLI cannot read them.

const encoder = new TextEncoder();
const decoder = new TextDecoder();

async function keyFor(secret: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(`ownit-seal:${secret}`));
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array {
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

export async function seal(secret: string, value: unknown): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await keyFor(secret), encoder.encode(JSON.stringify(value))),
  );
  const out = new Uint8Array(iv.length + ciphertext.length);
  out.set(iv);
  out.set(ciphertext, iv.length);
  return toBase64Url(out);
}

/** Returns undefined for a tampered, malformed, or foreign token. */
export async function unseal<T>(secret: string, token: string): Promise<T | undefined> {
  try {
    const bytes = fromBase64Url(token);
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: bytes.slice(0, 12) },
      await keyFor(secret),
      bytes.slice(12),
    );
    return JSON.parse(decoder.decode(plain)) as T;
  } catch {
    return undefined;
  }
}
