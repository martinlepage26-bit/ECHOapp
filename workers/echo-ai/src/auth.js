/** API key gate for echo-ai. */
import { parseCsv } from "./http.js";

async function timingSafeEqualString(a, b) {
  const enc = new TextEncoder();
  const aa = enc.encode(String(a || ""));
  const bb = enc.encode(String(b || ""));
  if (aa.byteLength !== bb.byteLength) return false;
  return crypto.subtle.timingSafeEqual(aa, bb);
}

export async function authorize(request, env, origin) {
  const required = String(env.ECHO_API_KEY || "").trim();
  const allowedOrigins = parseCsv(env.ECHO_ALLOWED_ORIGINS);

  if (allowedOrigins.length && origin) {
    const originOk = allowedOrigins.some((pattern) => {
      if (pattern === "*") return true;
      if (!pattern.includes("*")) return origin === pattern;
      const re = new RegExp(
        `^${pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`,
      );
      return re.test(origin);
    });
    if (originOk && !required) return { ok: true };
  }

  if (!required) return { ok: true };

  const headerKey = request.headers.get("X-Echo-Key") || "";
  const authHdr = request.headers.get("Authorization") || "";
  const bearer = authHdr.startsWith("Bearer ") ? authHdr.slice(7).trim() : "";
  const presented = headerKey || bearer;

  if (await timingSafeEqualString(presented, required)) return { ok: true };
  return { ok: false, status: 401, error: "Invalid or missing X-Echo-Key." };
}
