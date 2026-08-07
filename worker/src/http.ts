/** Small HTTP helpers shared by the ECHO Worker. */

export function corsHeaders(origin?: string | null): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Echo-Key, Authorization",
    "Access-Control-Max-Age": "86400",
  };
}

export function json(
  payload: unknown,
  status: number,
  origin?: string | null,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders(origin),
      "Content-Type": "application/json; charset=utf-8",
      ...extraHeaders,
    },
  });
}

export function text(
  body: string,
  status: number,
  origin?: string | null,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(body, {
    status,
    headers: {
      ...corsHeaders(origin),
      "Content-Type": "text/plain; charset=utf-8",
      ...extraHeaders,
    },
  });
}

export function noContent(origin?: string | null): Response {
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}
