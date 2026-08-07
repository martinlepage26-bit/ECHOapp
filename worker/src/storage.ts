/** D1-backed drafts. The only persisted user data in ECHO. */

import { json } from "./http.js";

function nowIso(): string {
  return new Date().toISOString();
}

export interface Draft {
  id: string;
  title: string;
  text: string;
  created_at: string;
}

export async function createDraft(env: Env, title: string, text: string): Promise<Draft> {
  const id = crypto.randomUUID();
  const created_at = nowIso();
  await env.DB.prepare("INSERT INTO drafts (id, title, text, created_at) VALUES (?, ?, ?, ?)")
    .bind(id, title, text, created_at)
    .run();
  return { id, title, text, created_at };
}

export async function listDrafts(env: Env): Promise<Draft[]> {
  const { results } = await env.DB.prepare(
    "SELECT id, title, text, created_at FROM drafts ORDER BY created_at DESC LIMIT 200",
  ).all<Draft>();
  return results || [];
}

export async function deleteDraft(env: Env, id: string): Promise<number> {
  const res = await env.DB.prepare("DELETE FROM drafts WHERE id = ?").bind(id).run();
  return res.meta?.changes || 0;
}

export function storageUnavailable(origin?: string | null): Response {
  return json(
    {
      detail:
        "Storage unavailable: D1 database not bound on this Worker. " +
        "Run the D1 migration (migrations/0001_init.sql) and add the [[d1_databases]] binding.",
    },
    503,
    origin,
  );
}
