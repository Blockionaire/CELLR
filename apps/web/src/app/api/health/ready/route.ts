import { handleReadiness } from "@/server/health/http";

export const dynamic = "force-dynamic";

/** GET → readiness for an external uptime provider, with CELLR_HEALTH_READY_TOKEN; 404 while none is configured. */
export const GET = (request: Request) => handleReadiness(request);
