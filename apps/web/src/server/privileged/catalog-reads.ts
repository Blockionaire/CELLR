import "server-only";
import { createServiceClient } from "./client";

/**
 * After the vision model read a label photo of a household: note what it read, so that adding that wine with that
 * photo can count as a label confirmation for catalogue learning. Service role only (people cannot write it), kept
 * for a day and used once; the database keeps nothing while learning is off. Never fails the scan.
 */
export async function noteScanRead(read: {
  imageId: string;
  householdId: string;
  producer: string;
  name: string;
  type: string | null;
}): Promise<void> {
  const db = createServiceClient();
  if (!db) return;
  await db
    .rpc("catalog_note_scan_read", {
      p_image_id: read.imageId,
      p_household_id: read.householdId,
      p_producer: read.producer,
      p_name: read.name,
      p_type: read.type as string,
    })
    .then(
      () => undefined,
      () => undefined,
    );
}
