/** D1-backed drafts and transcripts. */
import { json } from "./http.js";

function nowIso() {
  return new Date().toISOString();
}

export async function d1CreateDraft(env, title, text) {
  const id = crypto.randomUUID();
  const created_at = nowIso();
  await env.DB.prepare(
    "INSERT INTO drafts (id, title, text, created_at) VALUES (?, ?, ?, ?)",
  )
    .bind(id, title, text, created_at)
    .run();
  return { id, title, text, created_at };
}

export async function d1ListDrafts(env) {
  const { results } = await env.DB.prepare(
    "SELECT id, title, text, created_at FROM drafts ORDER BY created_at DESC LIMIT 200",
  ).all();
  return results || [];
}

export async function d1DeleteDraft(env, id) {
  const res = await env.DB.prepare("DELETE FROM drafts WHERE id = ?").bind(id).run();
  return res.meta?.changes || 0;
}

export async function d1CreateTranscript(env, text, duration) {
  const id = crypto.randomUUID();
  const created_at = nowIso();
  await env.DB.prepare(
    "INSERT INTO transcripts (id, text, duration, created_at) VALUES (?, ?, ?, ?)",
  )
    .bind(id, text, duration ?? null, created_at)
    .run();
  return { id, text, duration: duration ?? null, created_at };
}

export async function d1ListTranscripts(env) {
  const { results } = await env.DB.prepare(
    "SELECT id, text, duration, created_at FROM transcripts ORDER BY created_at DESC LIMIT 200",
  ).all();
  return results || [];
}

export async function d1DeleteTranscript(env, id) {
  const res = await env.DB.prepare("DELETE FROM transcripts WHERE id = ?").bind(id).run();
  return res.meta?.changes || 0;
}

export function storageUnavailable(origin) {
  return json(
    {
      detail:
        "Storage unavailable: D1 database not bound on this Worker. Run the echo-ai D1 " +
        "migration (migrations/0001_init.sql) and add the [[d1_databases]] binding, then redeploy.",
    },
    503,
    origin,
  );
}
