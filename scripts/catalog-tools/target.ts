import { readFileSync } from "node:fs";
import type { Client } from "pg";
import {
  actAsService,
  assertSafeTarget,
  assertTargetIdentity,
  connect,
  type ApprovedTargets,
  type Args,
} from "./lib";

export const approvedTargets = (): ApprovedTargets =>
  JSON.parse(
    readFileSync(new URL("./approved-targets.json", import.meta.url), "utf8"),
  ) as ApprovedTargets;

/** Connects only to an allowed target, checks what the database says it is, and acts as the service role. */
export async function connectToTarget(url: string, args: Args): Promise<Client> {
  const target = assertSafeTarget(url, args, approvedTargets());
  const client = await connect(url);
  try {
    await actAsService(client);
    await assertTargetIdentity(client, target);
  } catch (e) {
    await client.end();
    throw e;
  }
  return client;
}
