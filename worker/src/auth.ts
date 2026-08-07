/** Single API-key gate for the ECHO Worker. */

import { json } from "./http.js";

async function timingSafeEqualString(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const aa = enc.encode(String(a || ""));
  const bb = enc.encode(String(b || ""));
  if (aa.byteLength !== bb.byteLength) return false;
  return crypto.subtle.timingSafeEqual(aa, bb);
}

export interface AuthResult {
  ok: boolean;
  status?: number;
  error?: string;
}

export async function authorize(request: Request, env: Env): Promise<AuthResult> {
  const required = String(env.ECHO_API_KEY || "").trim();
  if (!required) return { ok: true };

  const headerKey = request.headers.get("X-Echo-Key") || "";
  const authHdr = request.headers.get("Authorization") || "";
  const bearer = authHdr.startsWith("Bearer ") ? authHdr.slice(7).trim() : "";
  const presented = headerKey || bearer;

  if (await timingSafeEqualString(presented, required)) return { ok: true };
  return { ok: false, status: 401, error: "Invalid or missing API key." };
}

export function authError(origin?: string | null): Response {
  return json({ detail: "Invalid or missing API key." }, 401, origin);
}
