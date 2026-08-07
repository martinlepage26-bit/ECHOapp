import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, it, expect, beforeAll } from "vitest";
import worker from "./index.js";

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

async function applyMigrations() {
  await env.DB.exec(
    "CREATE TABLE IF NOT EXISTS drafts (id TEXT PRIMARY KEY, title TEXT NOT NULL, text TEXT NOT NULL, created_at TEXT NOT NULL)",
  );
  await env.DB.exec("CREATE INDEX IF NOT EXISTS idx_drafts_created_at ON drafts (created_at DESC)");
}

describe("ECHO Worker", () => {
  beforeAll(applyMigrations);
  it("GET /api/health is public and reports online", async () => {
    const request = new IncomingRequest("http://example.com/api/health");
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      service: string;
      status: string;
      voices: number;
      providers: { workers_ai: string; clone: string; storage: string };
    };
    expect(body.service).toBe("echo");
    expect(body.status).toBe("online");
    expect(body.voices).toBe(28);
    expect(body.providers.workers_ai).toBe("ok");
    expect(body.providers.storage).toBe("ok");
  });

  it("GET /api/voices returns clone voices first then aura voices", async () => {
    const request = new IncomingRequest("http://example.com/api/voices");
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { voices: Array<{ id: string; provider: string }>; default: string };
    expect(body.voices[0].id).toBe("echo");
    expect(body.voices[0].provider).toBe("clone");
    expect(body.voices[4].id).toBe("athena");
    expect(body.voices[4].provider).toBe("workers_ai");
    expect(body.default).toBe("athena");
  });

  it("GET /api/drafts without key returns 401", async () => {
    const request = new IncomingRequest("http://example.com/api/drafts");
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(response.status).toBe(401);
  });

  it("GET /api/drafts with wrong key returns 401", async () => {
    const request = new IncomingRequest("http://example.com/api/drafts", {
      headers: { "X-Echo-Key": "wrong" },
    });
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(response.status).toBe(401);
  });

  it("POST /api/drafts creates and lists a draft", async () => {
    const create = new IncomingRequest("http://example.com/api/drafts", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Echo-Key": "test-key" },
      body: JSON.stringify({ title: "Unit Test", text: "Hello from tests." }),
    });
    const ctx1 = createExecutionContext();
    const createRes = await worker.fetch(create, env, ctx1);
    await waitOnExecutionContext(ctx1);
    expect(createRes.status).toBe(200);
    const draft = (await createRes.json()) as { id: string };

    const list = new IncomingRequest("http://example.com/api/drafts", {
      headers: { "X-Echo-Key": "test-key" },
    });
    const ctx2 = createExecutionContext();
    const listRes = await worker.fetch(list, env, ctx2);
    await waitOnExecutionContext(ctx2);
    expect(listRes.status).toBe(200);
    const body = (await listRes.json()) as Array<{ id: string; title: string }>;
    expect(body.some((d) => d.id === draft.id && d.title === "Unit Test")).toBe(true);

    const del = new IncomingRequest(`http://example.com/api/drafts/${draft.id}`, {
      method: "DELETE",
      headers: { "X-Echo-Key": "test-key" },
    });
    const ctx3 = createExecutionContext();
    const delRes = await worker.fetch(del, env, ctx3);
    await waitOnExecutionContext(ctx3);
    expect(delRes.status).toBe(200);
  });

  it("POST /api/parse extracts text from a .txt file", async () => {
    const form = new FormData();
    form.append("file", new Blob(["Parse me"], { type: "text/plain" }), "test.txt");
    const request = new IncomingRequest("http://example.com/api/parse", {
      method: "POST",
      headers: { "X-Echo-Key": "test-key" },
      body: form,
    });
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { text: string; word_count: number };
    expect(body.text).toBe("Parse me");
    expect(body.word_count).toBe(2);
  });

  it("POST /api/tts with clone voice fails explicitly when sidecar is unreachable", async () => {
    const request = new IncomingRequest("http://example.com/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Echo-Key": "test-key" },
      body: JSON.stringify({ text: "Hello", voice_id: "echo" }),
    });
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(response.status).toBe(503);
    const body = (await response.json()) as { code: string };
    expect(body.code).toBe("clone_unavailable");
  });
});
