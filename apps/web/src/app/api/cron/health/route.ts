import { handleHealthCron } from "@/server/health/http";

export const dynamic = "force-dynamic";
// every probe has 3 s, the round a few more: well inside this
export const maxDuration = 20;

/** GET → one round of health checks. Called by the heartbeat with CRON_SECRET, never by people. */
export const GET = (request: Request) => handleHealthCron(request);
