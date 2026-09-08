import nodemailer from "nodemailer";
import { sendTelegramMessage } from "./sendTelegramMessage.js";

/**
 * Entrega de OTP para recuperación de contraseña (email / telegram).
 * Helpers compartidos por los handlers de /user de la app system.
 */

// Rate-limit simple en memoria por ip:username. Suficiente para el patrón de
// uso (recovery sanitizado): nunca persiste nada, solo mitiga fuerza bruta.
const MAX_ATTEMPTS_PER_WINDOW = 5;
const WINDOW_MS = 15 * 60 * 1000;
const bursts = new Map();

const keyOf = (ip, username) => `${String(ip || "?")}::${String(username || "").toLowerCase()}`;

export function isRateLimited(ip, username) {
  const key = keyOf(ip, username);
  const now = Date.now();
  const entry = bursts.get(key);
  if (!entry || entry.resetAt <= now) return false;
  return entry.count >= MAX_ATTEMPTS_PER_WINDOW;
}

export function markRecoveryAttempt(ip, username) {
  const key = keyOf(ip, username);
  const now = Date.now();
  const entry = bursts.get(key);
  if (!entry || entry.resetAt <= now) {
    bursts.set(key, { count: 1, resetAt: now + WINDOW_MS });
  } else {
    entry.count += 1;
  }
  if (bursts.size > 5000) {
    // Limpieza oportunista: evita que el mapa crezca sin límite.
    for (const [k, e] of bursts) {
      if (e.resetAt <= now) bursts.delete(k);
    }
  }
}

/** Genera el HTML del correo de recuperación. */
export function otpEmailHtml({ otp, username }) {
  const safeUsername = String(username || "").replace(/[<>&"]/g, "");
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Password recovery</title>
</head>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:24px 0;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08);">
          <tr>
            <td style="background:#1f2937;padding:20px 32px;color:#ffffff;font-size:16px;font-weight:600;">
              OpenFusionAPI
            </td>
          </tr>
          <tr>
            <td style="padding:32px;">
              <h1 style="margin:0 0 16px;font-size:20px;color:#111827;">Password recovery</h1>
              <p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.5;">
                Hello <strong>${safeUsername}</strong>, we received a request to reset your password.
              </p>
              <p style="margin:0 0 24px;color:#374151;font-size:15px;line-height:1.5;">
                Use the following verification code to continue. It is valid for
                <strong>30 minutes</strong> and for one-time use.
              </p>
              <table role="presentation" align="center" cellpadding="0" cellspacing="0" style="margin:0 auto 24px;">
                <tr>
                  <td style="background:#eef2ff;border:1px solid #c7d2fe;border-radius:8px;padding:16px 40px;letter-spacing:8px;font-family:'Courier New',monospace;font-size:28px;font-weight:700;color:#4338ca;">
                    ${String(otp)}
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 8px;color:#6b7280;font-size:13px;line-height:1.5;">
                If you did not request this change, ignore this email. Never share the code with anyone.
              </p>
              <p style="margin:0;color:#6b7280;font-size:12px;line-height:1.5;">
                Platform staff will never ask you for this code.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

const EMAIL_SUBJECT = "Password recovery - OpenFusionAPI";

/**
 * Envía el OTP por email usando nodemailer con la configuración del transporte.
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
export async function deliverOtpByEmail({ transport, from, to, otp, username }) {
  if (!transport || !to) {
    return { ok: false, error: "NO_EMAIL_TARGET" };
  }
  try {
    const transporter = nodemailer.createTransport(transport);
    const info = await transporter.sendMail({
      from: from || transport.from || (transport.auth && transport.auth.user) || undefined,
      to,
      subject: EMAIL_SUBJECT,
      html: otpEmailHtml({ otp, username }),
    });
    return { ok: true, info };
  } catch (error) {
    console.error("[OTP email delivery] error:", error.message);
    return { ok: false, error: error.message };
  }
}

const TELEGRAM_OTP_TEXT = (otp, username) =>
  `Hi ${username}! Here is your verification code to reset your OpenFusionAPI password:\n\n<code>${otp}</code>\n\nValid for 30 minutes and for one-time use. If you did not request it, ignore this message.`;

/**
 * Envía el OTP por Telegram usando la Bot API directamente (HTTP).
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
export async function deliverOtpByTelegram({ token, chatId, otp, username }) {
  if (!token || !chatId) {
    return { ok: false, error: "NO_TELEGRAM_TARGET" };
  }
  return sendTelegramMessage({
    token,
    chatId,
    text: TELEGRAM_OTP_TEXT(otp, username),
  });
}