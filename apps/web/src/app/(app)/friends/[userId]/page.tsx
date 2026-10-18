import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { isDomainError } from "@cellr/domain";
import { FriendScreen } from "@/features/friends/friend-screen";
import { getPageContext } from "@/server/context";
import { servicesFor } from "@/server/services";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("friends"))("title") };
}

export default async function FriendPage({ params }: { params: Promise<{ userId: string }> }) {
  const ctx = await getPageContext();
  if (!ctx) return null;
  const id = z.uuid().safeParse((await params).userId);
  if (!id.success) notFound();
  const view = await servicesFor(ctx)
    .friends.friend(id.data)
    .catch((e: unknown) => {
      if (isDomainError(e) && e.code === "NOT_FOUND") return null;
      throw e;
    });
  if (!view) notFound();
  return <FriendScreen initial={view} />;
}
