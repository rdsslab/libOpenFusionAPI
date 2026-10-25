import crypto from "crypto";

export function buildFingerprint({ idendpoint_base, query = {}, body = {}, env = "" }) {
  try {
    const combined = { idendpoint_base, env, query: sortObject(query), body: sortObject(body) };
    const str = JSON.stringify(combined);
    return crypto.createHash("sha256").update(str).digest("hex");
  } catch (e) {
    const str = JSON.stringify({ idendpoint_base, env });
    return crypto.createHash("sha256").update(str).digest("hex");
  }
}

function sortObject(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return obj;
  const sorted = {};
  Object.keys(obj).sort().forEach((key) => {
    sorted[key] = sortObject(obj[key]);
  });
  return sorted;
}
