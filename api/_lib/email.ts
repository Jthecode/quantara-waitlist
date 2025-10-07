// api/_lib/email.ts
export async function sendVerifyEmail(
  to: string,
  link: string,
  opts?: {
    name?: string;          // recipient display name
    replyTo?: string;       // optional reply-to address
    idempotencyKey?: string // set to dedupe retries (optional)
  }
) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM || "Quantara <no-reply@yourdomain.tld>";

  if (!key) {
    console.warn("[email] RESEND_API_KEY missing; skipping send");
    return;
  }

  // normalize recipient
  const rcpt = opts?.name ? `${opts.name} <${to}>` : to;

  // make sure link is absolute and https
  let url = link;
  try {
    const u = new URL(link, "https://www.quantara-waitlist.com");
    if (u.protocol !== "https:") u.protocol = "https:";
    url = u.toString();
  } catch {
    // if invalid, keep original; Resend will reject if it's truly broken
  }

  // very light HTML escaping for the link text
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

  const subject = "Confirm your Quantara waitlist";
  const text = `You're almost in!

Tap the link below to confirm your email and lock in your spot:

${url}

If you didn’t request this, you can ignore this message.`;
  const html = `
  <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;line-height:1.5;color:#0b0c0c">
    <h2 style="margin:0 0 12px 0;font-weight:700;">Confirm your Quantara waitlist</h2>
    <p style="margin:0 0 16px 0;">You're almost in! Click the button below to confirm your email and lock in your spot.</p>
    <p style="margin:20px 0;">
      <a href="${esc(url)}"
         style="display:inline-block;background:#111827;color:#f9fafb;text-decoration:none;padding:10px 16px;border-radius:8px;font-weight:600"
         target="_blank" rel="noopener">Confirm email</a>
    </p>
    <p style="margin:16px 0 0 0;font-size:14px;color:#4b5563;">Or paste this link into your browser:</p>
    <p style="margin:4px 0 0 0;font-size:13px;"><a href="${esc(url)}" target="_blank" rel="noopener">${esc(url)}</a></p>
    <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0" />
    <p style="font-size:12px;color:#6b7280;margin:0;">If you didn’t request this, you can safely ignore this email.</p>
  </div>
  `;

  // Basic tags for analytics in Resend; optional
  const tags = [{ name: "purpose", value: "verify-email" }];

  const headers: Record<string, string> = {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };

  // Idempotency header helps avoid duplicate sends on retries
  const idem =
    opts?.idempotencyKey ||
    // stable-ish hash from recipient+url (low-stakes)
    (await cryptoDigest(`verify:${rcpt}|${url}`));
  if (idem) headers["Idempotency-Key"] = idem;

  // Optional: Reply-To
  const payload: any = {
    from,
    to: rcpt,
    subject,
    text,
    html,
    tags,
  };
  if (opts?.replyTo) payload.reply_to = opts.replyTo;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  // Resend returns { id: "email_..." } on success
  if (!res.ok) {
    const body = await safeBody(res);
    throw new Error(`[email_send_failed] ${res.status} ${res.statusText} :: ${body}`);
  }

  return (await res.json()) as { id: string };
}

// ---- helpers ----
async function cryptoDigest(s: string) {
  try {
    const enc = new TextEncoder().encode(s);
    // Web Crypto (available on Node 18+ / Edge runtime)
    const hash = await crypto.subtle.digest("SHA-256", enc);
    const hex = [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, "0")).join("");
    return hex.slice(0, 32);
  } catch {
    // If Web Crypto isn't available, fall back to a simple stamp
    return `stamp_${Date.now()}`;
  }
}

async function safeBody(res: Response) {
  try {
    const t = await res.text();
    return t.slice(0, 500);
  } catch {
    return "<no-body>";
  }
}
