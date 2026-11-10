// Garde simple par mot de passe partagé (APP_PASSWORD).
// Le cookie contient un hash SHA-256 du mot de passe + secret, jamais le mot de passe.
export const AUTH_COOKIE = "bb_auth";

export async function expectedToken(): Promise<string> {
  const password = process.env.APP_PASSWORD ?? "";
  const secret = process.env.AUTH_SECRET ?? "diaper-tracker";
  const data = new TextEncoder().encode(`${secret}:${password}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function authEnabled(): boolean {
  return Boolean(process.env.APP_PASSWORD);
}
