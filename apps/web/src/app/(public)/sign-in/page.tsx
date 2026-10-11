import type { Metadata } from "next";
import { SignInForm } from "@/features/auth/sign-in-form";
import { safeNextPath } from "@/lib/routes";

export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  return <SignInForm next={safeNextPath(next)} />;
}
