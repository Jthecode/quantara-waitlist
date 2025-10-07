// api/_lib/turnstile.ts

export type TurnstileVerifyResult = {
  success: boolean;
  score?: number;             // only on certain CF plans
  action?: string;
  challenge_ts?: string;
  hostname?: string;
  errorCodes?: string[];
  reason?: string;            // our local reason string
};

type VerifyOpts = {
  ip?: string;
  minScore?: number;          // e.g. 0.5 to require a minimum score if present
  allowDevBypass?: boolean;   // allow pass in dev if secret missing
};

export async function verifyTurnstile(
  token?: string,
  opts: VerifyOpts = {}
): Promise<TurnstileVerifyResult> {
  const { ip, minScore, allowDevBypass = true } = opts;
  const secret = process.env.TURNSTILE_SECRET_KEY;

  // basic input check
  if (!token) {
    return { success: false, reason: "missing-token" };
  }

  // Dev convenience: if no secret and not production, optionally bypass
  if (!secret) {
    const isProd = process.env.NODE_ENV === "production";
    if (!isProd && allowDevBypass) return { success: true, reason: "dev-bypass" };
    return { success: false, reason: "missing-secret" };
  }

  try {
    const body = new URLSearchParams();
    body.set("secret", secret);
    body.set("response", token);
    if (ip) body.set("remoteip", ip);

    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body,
    });

    if (!res.ok) {
      return { success: false, reason: `http-${res.status}` };
    }

    // Cloudflare response shape:
    // { success, "error-codes"?: string[], challenge_ts?: string, hostname?: string, action?: string, cdata?: string, score?: number }
    const json = (await res.json().catch(() => ({}))) as any;

    const success = !!json?.success;
    const score = typeof json?.score === "number" ? json.score : undefined;
    const errorCodes: string[] | undefined = json?.["error-codes"];

    // Enforce minimum score if requested and score is present
    if (success && typeof minScore === "number" && typeof score === "number" && score < minScore) {
      return { success: false, score, errorCodes, reason: "low-score" };
    }

    return {
      success,
      score,
      action: json?.action,
      challenge_ts: json?.challenge_ts,
      hostname: json?.hostname,
      errorCodes,
    };
  } catch (err: any) {
    return { success: false, reason: `exception:${String(err?.message || err)}` };
  }
}
