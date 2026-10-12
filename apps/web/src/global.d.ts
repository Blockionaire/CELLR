import type en from "../messages/en.json";

declare module "next-intl" {
  interface AppConfig {
    Locale: "en" | "nl";
    Messages: typeof en;
  }
}
