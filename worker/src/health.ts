/** Provider health probes for /api/health. */

export interface HealthReport {
  workers_ai: "ok" | "unbound" | string;
  clone: "ok" | "unconfigured" | "unreachable" | string;
  storage: "ok" | "unbound";
}

export async function checkHealth(env: Env): Promise<HealthReport> {
  const report: HealthReport = {
    workers_ai: env.AI ? "ok" : "unbound",
    clone: "unconfigured",
    storage: env.DB ? "ok" : "unbound",
  };

  const cloneBase = String(env.ECHO_CLONE_TTS_URL || "").trim().replace(/\/+$/, "");
  if (cloneBase) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      const res = await fetch(`${cloneBase}/health`, {
        method: "GET",
        signal: controller.signal,
      });
      clearTimeout(timeout);
      report.clone = res.ok ? "ok" : `http_${res.status}`;
    } catch (e) {
      report.clone = `unreachable: ${String((e as Error)?.message || e)}`;
    }
  }

  return report;
}
