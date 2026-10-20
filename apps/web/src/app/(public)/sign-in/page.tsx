import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { SignInForm } from "@/features/auth/sign-in-form";
import { safeNextPath } from "@/lib/routes";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("signIn"))("pageTitle") };
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  return <SignInForm next={safeNextPath(next)} />;
}
