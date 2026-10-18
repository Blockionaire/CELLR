import { handleReminderCron } from "@/server/push/cron";

export const dynamic = "force-dynamic";

/** GET → the daily "a wine is at its best" round. Called by the scheduler (vercel.json), never by people. */
export const GET = (request: Request) => handleReminderCron(request);
