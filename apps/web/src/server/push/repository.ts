import "server-only";
import { noticeKey } from "@cellr/domain";
import type { Db } from "@/server/db/clients";
import { isMissingTable, mapDbError } from "@/server/db/errors";
import { allRows } from "@/server/db/paging";
import type { PushRepository } from "./types";

export function createPushRepository(db: Db): PushRepository {
  return {
    async add({ endpoint, keys }) {
      const { error } = await db
        .from("push_subscriptions")
        .upsert(
          { endpoint, p256dh: keys.p256dh, auth: keys.auth },
          { onConflict: "user_id,endpoint", ignoreDuplicates: true },
        );
      if (error && isMissingTable(error)) return null;
      if (error) throw mapDbError(error);
      return true;
    },

    async remove(endpoint) {
      const { error } = await db.from("push_subscriptions").delete().eq("endpoint", endpoint);
      if (error && isMissingTable(error)) return null;
      if (error) throw mapDbError(error);
      return true;
    },

    async known() {
      const { data, error } = await allRows((a, b) =>
        db.from("drink_notices").select("vintage_id, kind").order("vintage_id").range(a, b),
      );
      if (error && isMissingTable(error)) return null;
      if (error) throw mapDbError(error);
      return new Set(data.map((r) => noticeKey(r.vintage_id, r.kind as "peak" | "ending")));
    },

    async markKnown(notices) {
      if (notices.length === 0) return true;
      const { error } = await db.from("drink_notices").upsert(
        notices.map((n) => ({ vintage_id: n.vintageId, kind: n.kind })),
        { onConflict: "user_id,vintage_id,kind", ignoreDuplicates: true },
      );
      if (error && isMissingTable(error)) return null;
      if (error) throw mapDbError(error);
      return true;
    },
  };
}
