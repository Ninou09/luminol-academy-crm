import { createHash, createHmac, randomBytes } from "node:crypto";
import { one, run, insert, now, hashPassword } from "./db.mjs";

// --- Two-step sign-in (TOTP, compatible with Google Authenticator) ---------
const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function newTotpSecret() {
  const bytes = randomBytes(20);
  let bits = "",
    out = "";
  for (const b of bytes) bits += b.toString(2).padStart(8, "0");
  for (let i = 0; i + 5 <= bits.length; i += 5)
    out += alphabet[parseInt(bits.slice(i, i + 5), 2)];
  return out;
}
function decode(secret) {
  let bits = "";
  for (const c of secret.replace(/=+$/, "").toUpperCase())
    bits += alphabet.indexOf(c).toString(2).padStart(5, "0");
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8)
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}
export function totp(secret, step = Math.floor(Date.now() / 30000)) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const h = createHmac("sha1", decode(secret)).update(counter).digest();
  const o = h[h.length - 1] & 15;
  const n =
    ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1000000).padStart(6, "0");
}
/** Accept the current code and one step before/after (clock drift). */
export function verifyTotp(secret, code) {
  const c = String(code || "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(c) || !secret) return false;
  const step = Math.floor(Date.now() / 30000);
  return [-1, 0, 1].some((d) => totp(secret, step + d) === c);
}

// --- E-mail (password recovery) ---------------------------------------------
/**
 * Sends through Resend when RESEND_API_KEY is configured. Without it, the
 * message is kept in the meta table so tests and the administrator can see
 * that nothing was sent.
 */
export async function sendMail(to, subject, text) {
  const key = process.env.RESEND_API_KEY;
  if (!key || process.env.MAIL_DRY_RUN === "1") {
    run(
      "INSERT INTO meta(key,value) VALUES ('last_mail',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      JSON.stringify({ to, subject, text, at: now() }),
    );
    return false;
  }
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.MAIL_FROM || "Luminol Academy <onboarding@resend.dev>",
      to: [to],
      subject,
      text,
    }),
  });
  if (!response.ok) throw new Error("The e-mail could not be sent.");
  return true;
}
export const mailConfigured = () => !!process.env.RESEND_API_KEY;

const hash = (s) => createHash("sha256").update(s).digest("hex");

/** Public routes: forgot password + reset password. */
export function installPasswordRecovery(app, { isHosted }) {
  app.post("/api/password/forgot", async (req, res, next) => {
    try {
      const email = String(req.body?.email || "")
        .trim()
        .toLowerCase();
      // Same answer whether or not the account exists (no account guessing).
      const answer = {
        ok: true,
        message:
          "If this e-mail belongs to an account, a link to choose a new password has been sent.",
      };
      const user = email
        ? one("SELECT * FROM users WHERE email=? AND active=1", email)
        : null;
      if (!user || user.email.endsWith("@no-login.local"))
        return res.json(answer);
      const recent = one(
        "SELECT COUNT(*) n FROM password_resets WHERE user_id=? AND expires>?",
        user.id,
        Date.now() + 25 * 60000,
      ).n;
      if (recent >= 3) return res.json(answer);
      const token = randomBytes(32).toString("hex");
      insert("password_resets", {
        token_hash: hash(token),
        user_id: user.id,
        expires: Date.now() + 30 * 60000,
        used: 0,
      });
      const origin = `${isHosted ? "https" : "http"}://${req.headers.host}`;
      const academy = one("SELECT academy FROM settings WHERE id=1").academy;
      await sendMail(
        user.email,
        `${academy} — nouveau mot de passe / new password`,
        `Bonjour ${user.name},\n\nPour choisir un nouveau mot de passe, ouvrez ce lien (valable 30 minutes) :\n${origin}/reset?token=${token}\n\nSi vous n'êtes pas à l'origine de cette demande, ignorez ce message.\n\n— ${academy}`,
      );
      res.json(answer);
    } catch (e) {
      next(e);
    }
  });
  app.post("/api/password/reset", (req, res, next) => {
    try {
      const token = String(req.body?.token || "");
      const password = req.body?.password;
      const row = one(
        "SELECT * FROM password_resets WHERE token_hash=?",
        hash(token),
      );
      if (!row || row.used || row.expires < Date.now())
        throw Object.assign(
          new Error("This link has expired. Ask for a new one."),
          { status: 400 },
        );
      if (
        typeof password !== "string" ||
        password.length < 10 ||
        password.length > 200
      )
        throw Object.assign(
          new Error("The password needs at least 10 characters."),
          { status: 400 },
        );
      run(
        "UPDATE users SET password_hash=? WHERE id=?",
        hashPassword(password),
        row.user_id,
      );
      run("UPDATE password_resets SET used=1 WHERE user_id=?", row.user_id);
      run("DELETE FROM auth_sessions WHERE user_id=?", row.user_id);
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  });
}
