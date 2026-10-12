import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ImportScreen } from "@/features/import/import-screen";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("import"))("title") };
}

export default function ImportPage() {
  return <ImportScreen />;
}
