export async function sendVerifyEmail(to: string, link: string) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM || "Quantara <no-reply@yourdomain.tld>",
      to, subject: "Confirm your Quantara waitlist",
      html: `<p>Tap to confirm:</p><p><a href="${link}">${link}</a></p>`
    })
  });
  if (!res.ok) throw new Error("email_send_failed");
}
