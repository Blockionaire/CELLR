import "server-only";
import type { ScanProposal } from "@/server/scans/service";
import { createServiceClient } from "./client";

/**
 * After the vision model read a label photo of a household: note what it read, so that adding that wine with that
 * photo can count as a label confirmation for catalogue learning. Service role only (people cannot write it). The
 * person is the signed-in user of this request (from the verified session, never from the client); the database
 * keeps nothing unless that person may count right now, deletes the note when used, and never keeps it a day.
 * Never fails the scan.
 */
export async function noteScanRead(read: {
  imageId: string;
  householdId: string;
  userId: string;
  producer: string;
  name: string;
  type: string | null;
  proposal?: ScanProposal | null;
}): Promise<void> {
  const db = createServiceClient();
  if (!db) return;
  try {
    const { error } = await db.rpc("catalog_note_scan_read", {
      p_image_id: read.imageId,
      p_household_id: read.householdId,
      p_user_id: read.userId,
      p_producer: read.producer,
      p_name: read.name,
      p_type: read.type as string,
    });
    if (error || !read.proposal) return;
    // What was proposed, next to the reading (the database keeps it only where it kept the reading).
    await db.rpc("catalog_note_scan_proposal", {
      p_image_id: read.imageId,
      p_user_id: read.userId,
      p_wine_id: (read.proposal.kind === "catalog" ? read.proposal.wineId : null) as string,
      p_ai: (read.proposal.kind === "ai" ? read.proposal.ai : null) as never,
      p_year: read.proposal.year as number,
    });
  } catch {
    // never fails the scan
  }
}
