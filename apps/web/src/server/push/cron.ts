import "server-only";
import { timingSafeEqual } from "node:crypto";
import { getCronSecret } from "@/server/env";
import { jsonResponse } from "@/server/http";
import { runDrinkReminders } from "@/server/privileged/drink-reminders";

/** The daily reminder round, for the scheduler only: it must show the shared secret. */
export async function handleReminderCron(request: Request): Promise<Response> {
  const secret = getCronSecret();
  if (!secret) return jsonResponse({ error: "Scheduled jobs are not set up (CRON_SECRET)." }, 503);
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (given.length !== expected.length || !timingSafeEqual(given, expected))
    return jsonResponse({ error: "Not allowed." }, 401);
  return jsonResponse(await runDrinkReminders());
}
