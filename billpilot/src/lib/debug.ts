import "server-only";

const DEBUG_HEADER = "x-billpilot-debug";

export function isDebugRequest(request: Request): boolean {
  const key = process.env.BILLPILOT_DEBUG_KEY;
  if (!key || !key.trim()) return false;
  const token = request.headers.get(DEBUG_HEADER);
  return Boolean(token && token === key);
}

export function debugEnabledHeaderName() {
  return DEBUG_HEADER;
}
