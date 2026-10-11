"use client";

import { useTranslations } from "next-intl";
import { ERROR_MESSAGES } from "@cellr/domain";
import { errorMessage } from "@/lib/api";
import { Button } from "@/ui/button";
import { CopyIcon, ShareIcon } from "@/ui/icons";
import { Sheet } from "@/ui/sheet";
import { Skeleton } from "@/ui/skeleton";
import { useToast } from "@/ui/toast";
import { useCreateInvite } from "./hooks";

interface InviteSheetProps {
  open: boolean;
  onClose: () => void;
  household: { id: string; name: string };
  invite: ReturnType<typeof useCreateInvite>;
}

/** The code is shown once (only a hash is stored), so make copying and sharing effortless. */
export function InviteSheet({ open, onClose, household, invite }: InviteSheetProps) {
  const t = useTranslations("profile");
  const tc = useTranslations("common");
  const te = useTranslations();
  const toast = useToast();
  const code = invite.data?.formattedCode;

  async function copy() {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      toast.show(tc("copied"));
    } catch {
      toast.show(code); // clipboard blocked: at least show it plainly
    }
  }

  async function share() {
    if (!code) return;
    const text = t("inviteShareText", { code });
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: "CELLR", text });
        return;
      } catch {
        return; // dismissed
      }
    }
    await copy();
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t("inviteTitle", { household: household.name })}
      description={t("inviteBody")}
      closeLabel={tc("close")}
    >
      <div className="flex flex-col gap-5 pb-2 pt-2">
        <div className="rounded-card bg-raised px-4 py-6 text-center" aria-live="polite">
          {invite.isError ? (
            <p role="alert" className="text-small text-danger">
              {errorMessage(invite.error, (k) => te(k), ERROR_MESSAGES)}
            </p>
          ) : code ? (
            <p
              className="select-all font-display text-display tracking-[0.12em] tnum"
              aria-label={t("inviteCodeLabel")}
            >
              {code}
            </p>
          ) : (
            <Skeleton className="mx-auto h-11 w-56" />
          )}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" size="lg" onClick={copy} disabled={!code}>
            <CopyIcon size={20} />
            {tc("copy")}
          </Button>
          <Button size="lg" onClick={share} disabled={!code}>
            <ShareIcon size={20} />
            {tc("share")}
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
