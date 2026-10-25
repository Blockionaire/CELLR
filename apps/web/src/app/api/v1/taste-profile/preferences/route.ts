import { SaveTastePreferencesSchema } from "@cellr/domain";
import { authed, readJson } from "@/server/http";
import { servicesFor } from "@/server/services";

/** PUT { wineFocus, body, tannin, sweetness, acidity, onboarded? } → saves my own taste answers. */
export const PUT = authed(async ({ request, ctx }) =>
  servicesFor(ctx).taste.savePreferences(await readJson(request, SaveTastePreferencesSchema)),
);
