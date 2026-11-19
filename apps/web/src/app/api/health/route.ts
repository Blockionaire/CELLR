import { handleLiveness } from "@/server/health/http";

export const dynamic = "force-dynamic";

/** GET → public liveness for external uptime checks: {"status":"ok"} and nothing else (System Intelligence sprint 2). */
export const GET = () => handleLiveness();
