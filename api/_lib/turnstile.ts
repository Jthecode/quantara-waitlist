export async function verifyTurnstile(token?: string, ip?: string) {
  if (!process.env.TURNSTILE_SECRET_KEY) return true; // allow in dev if unset
  if (!token) return false;
  const body = new URLSearchParams({ secret: process.env.TURNSTILE_SECRET_KEY, response: token });
  if (ip) body.append("remoteip", ip);
  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body });
  const json = await res.json();
  return !!json.success;
}
