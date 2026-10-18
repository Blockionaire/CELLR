import "server-only";
import webpush from "web-push";
import type { PushEnv } from "@/server/env";

export interface PushMessage {
  title: string;
  body: string;
  /** Where a tap on the notification goes, inside the app. */
  url: string;
  /** Notifications with the same tag replace each other instead of piling up. */
  tag: string;
}

/** "gone": the phone no longer accepts these (unsubscribed, app removed): forget the subscription. */
export type PushOutcome = "sent" | "gone" | "failed";

export async function sendPush(
  env: PushEnv,
  subscription: { endpoint: string; p256dh: string; auth: string },
  message: PushMessage,
): Promise<PushOutcome> {
  try {
    await webpush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      },
      JSON.stringify(message),
      {
        vapidDetails: {
          subject: env.subject,
          publicKey: env.publicKey,
          privateKey: env.privateKey,
        },
        TTL: 60 * 60 * 24,
        timeout: 10_000,
      },
    );
    return "sent";
  } catch (e) {
    const status = (e as { statusCode?: number }).statusCode;
    return status === 404 || status === 410 ? "gone" : "failed";
  }
}
