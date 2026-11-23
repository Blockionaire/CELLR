import { parseSommelierParts, type AskSommelier, type ChatMessage } from "@cellr/domain";
import type { AiResult, GenerateObjectRequest, LlmProvider } from "@/server/ai/types";
import { buildTonight } from "@/server/cellar/service";
import { createSommelierIntelligence } from "@/server/sommelier/intelligence";
import { createSommelierFallback } from "@/server/sommelier/parts/fallback";
import { createSommelierService } from "@/server/sommelier/service";
import type { BenchCellar } from "./bench-cellar";
import { NOW } from "./fixtures";

/**
 * THE V1+ BENCHMARK HARNESS (P8): the app's own `createSommelierService`, wired as `server/services.ts` wires it,
 * with in-memory stand-ins for the reads and a FAKE model that answers at once with a fixed, realistic answer.
 * Nothing here calls a model or a network.
 *
 * The fake reads the cellar list the service built (the refs it may point at) and answers like V1's model would:
 * three refs for a pairing, one entry per course for a menu (only when the schema asks for `courses`), the named
 * wine for a serving question. With prompt v7 (`check`) it writes the wines as `[[ref]]`, with v6 as their names.
 */

/** The configurations measured: V1 (no part), each part alone, all five. */
export const CONFIGS = [
  { name: "V1", parts: "" },
  { name: "check", parts: "check" },
  { name: "annotate", parts: "annotate" },
  { name: "quantities", parts: "quantities" },
  { name: "menu", parts: "menu" },
  { name: "fallback", parts: "fallback" },
  { name: "all", parts: "check,annotate,quantities,menu,fallback" },
] as const;
export type ConfigName = (typeof CONFIGS)[number]["name"];

export type QuestionKind =
  "pairing" | "pairing-guests" | "serving" | "menu-3" | "menu-8" | "compare";

/** The question of each kind, as a person types it. */
export const QUESTIONS: Record<QuestionKind, string> = {
  pairing: "Roast lamb with rosemary and garlic tonight. Which bottle should I open?",
  "pairing-guests":
    "We are 6 for dinner tonight: roast lamb with rosemary and garlic. Which bottle should I open?",
  // By its producer alone: "the Vajrelli Barolo" would also match every other Barolo by name, and with more than
  // three such wines the serving facts give no block (experiences/annotate.ts, FACTS_WINES_MAX).
  serving: "How should I serve the Vajrelli, and should I decant it?",
  "menu-3":
    "Oysters to start, then roast lamb, and for dessert chocolate fondant. Which wine with each course?",
  "menu-8":
    "Our menu:\n- oysters\n- smoked salmon\n- mushroom risotto\n- sole meunière\n- duck breast with cherry sauce\n- roast lamb\n- aged Gouda\n- crème brûlée\nWhat should we pour with each?",
  compare: "The Vajrelli Barolo or the Montrachaux Pauillac with the roast lamb?",
};

/** An earlier exchange, as the screen sends it back (the sommelier's words cut at 2,000 characters). */
const HISTORY: ChatMessage[] = [
  {
    role: "assistant",
    text: "Hello! Tell me what you are cooking or what the evening is, and I will look in your cellar.",
  },
  { role: "user", text: "What would you open with a mushroom risotto on a weeknight?" },
  {
    role: "assistant",
    text: "With a mushroom risotto I would open the Vajrelli Barolo: its earthy, savoury side meets the mushrooms and its acidity cuts the butter and cheese. The Domaine Fleurignac Chablis is a fresher choice if you prefer a white.",
  },
  { role: "user", text: "Is the Barolo ready to drink or should I keep it?" },
  {
    role: "assistant",
    text: "Your Barolo is at its best now, by the estimate for its style, so there is no need to keep waiting for it.",
  },
  { role: "user", text: "And something for a cheese board on Saturday?" },
  {
    role: "assistant",
    text: "For a cheese board with hard cheeses the Château Montrachaux Pauillac works well, and a sweet wine would suit a blue cheese.",
  },
  { role: "user", text: "Which of my whites are ready now?" },
  {
    role: "assistant",
    text: "Several of your whites are ready: the Domaine Fleurignac Chablis is at its best now, and a few younger whites can wait a year or two.",
  },
  { role: "user", text: "Thanks, that helps a lot." },
  { role: "assistant", text: "Glad to help. Enjoy your evening!" },
];

/** A conversation of 1 or 12 messages ending with the question. */
export function messagesFor(kind: QuestionKind, length: 1 | 12): ChatMessage[] {
  const question: ChatMessage = { role: "user", text: QUESTIONS[kind] };
  return length === 1 ? [question] : [...HISTORY, question];
}

export const requestFor = (kind: QuestionKind, length: 1 | 12): AskSommelier => ({
  messages: messagesFor(kind, length),
  mode: "chat",
});

/** The wines of the list the model was shown: ref, and the name and type as the line says them. */
export function listedWines(user: string) {
  return [...user.matchAll(/^([0-9a-z]{6,36}) \| (.+?) — (.+?) \| (\S+) \| (\w+) \|/gm)].map(
    (m) => ({ ref: m[1]!, producer: m[2]!, name: m[3]!, year: m[4]!, type: m[5]! }),
  );
}

/**
 * A model that answers at once. `calls` counts the calls; the usage it reports is a plausible one (about three
 * characters a token in, 180 tokens out), used for nothing but the usage record the service writes.
 */
export function fakeModel(): LlmProvider & { calls: number } {
  const model = {
    calls: 0,
    async generateObject<T>(request: GenerateObjectRequest<T>): Promise<AiResult<T>> {
      model.calls += 1;
      const wines = listedWines(request.user);
      const v7 = !JSON.stringify(request.jsonSchema).includes('"price"');
      const say = (w: (typeof wines)[number] | undefined) =>
        !w
          ? "a wine"
          : v7
            ? `[[${w.ref}]]`
            : `${w.producer} ${w.name}${w.year === "NV" ? "" : ` ${w.year}`}`;
      const question = request.user.slice(request.user.lastIndexOf("\nQuestion: ") + 11);
      const serving = /\bserve\b|decant/i.test(question);
      // The wines the question names (the serving question names the Barolo, the comparison two wines), else reds.
      const named = wines.filter(
        (w) =>
          (/Vajrelli/i.test(question) && w.producer === "Vajrelli") ||
          (/Montrachaux/i.test(question) && w.producer === "Château Montrachaux"),
      );
      const reds = wines.filter((w) => w.type === "red");
      const chosen = (named.length > 0 ? named : reds)
        .concat(wines)
        .filter((w, i, all) => all.findIndex((x) => x.ref === w.ref) === i)
        .slice(0, serving ? 1 : 3);
      const courses = (request.jsonSchema as { properties?: Record<string, unknown> }).properties
        ?.courses
        ? [...request.user.matchAll(/^(\d+)\. /gm)].map((m, k) => ({
            course: Number(m[1]),
            ref: wines[(k * 7) % Math.max(1, wines.length)]?.ref ?? null,
            why: "Its freshness and weight suit this course, and it leads on to the next wine.",
          }))
        : null;
      const answer = courses
        ? "A menu that goes from lighter to fuller wines: one bottle per course, shown below."
        : serving
          ? `Serve ${say(chosen[0])} at about 16–18 °C, and give it about an hour in a decanter so the tannins soften. It is at its best now, so there is no need to keep it longer.`
          : `For the lamb I would open ${say(chosen[0])}: its firm tannins and dark fruit stand up to the rosemary and the fat of the meat. ${say(chosen[1])} is a softer alternative, and ${say(chosen[2])} works if you prefer something lighter.`;
      const value = {
        answer,
        bottle_refs: (courses
          ? courses.flatMap((c) => (c.ref ? [c.ref] : []))
          : chosen.map((w) => w.ref)
        ).slice(0, 3),
        verdict: serving ? "not_pairing" : "match",
        buy: [],
        used_taste: false,
        ...(courses ? { courses } : {}),
      };
      return {
        ok: true,
        value: request.parse(value),
        usage: {
          model: "gpt-6-luna",
          tokensIn: Math.ceil((request.system.length + request.user.length) / 3),
          tokensOut: 180,
          latencyMs: 0,
          reported: true,
        },
      };
    },
  };
  return model;
}

export interface BenchService {
  ask: (request: AskSommelier) => ReturnType<ReturnType<typeof createSommelierService>["ask"]>;
  /** Reads of the household's profiles (the service's and the fallback engines'), and model calls. */
  counts: { profileReads: number; modelCalls: () => number };
}

/**
 * The service as `server/services.ts` builds it, for one cellar and one configuration. `llm: false` is the path
 * with no model (no key configured); the `fallback` part then asks the engines (built without buying advice).
 */
export function benchService(
  cellar: BenchCellar,
  parts: string,
  options: { llm: boolean; provider?: LlmProvider },
): BenchService {
  const counts = { profileReads: 0, modelCalls: () => model?.calls ?? 0 };
  const model = options.llm ? fakeModel() : null;
  /** A provider of the caller's (one that records the request), else the fake model itself. */
  const llm = options.llm ? (options.provider ?? model) : null;
  const sommelierParts = parseSommelierParts(parts);
  const readCellar = async () => cellar.view;
  const profiles = async (ids: readonly string[]) => {
    counts.profileReads += 1;
    return new Map(
      ids.flatMap((id) => (cellar.profiles.has(id) ? [[id, cellar.profiles.get(id)!]] : [])),
    );
  };
  const fallback = sommelierParts.on.has("fallback")
    ? createSommelierFallback({
        intelligence: createSommelierIntelligence({
          cellar: readCellar,
          profiles,
          taste: async () => null,
          offers: null,
          buying: false,
          now: () => NOW,
        }),
        spend: async () => {},
      })
    : null;
  const service = createSommelierService({
    fallback,
    cellar: readCellar,
    storage: async () => [],
    racks: async () => ({ units: [], unplaced: [] }),
    tonight: async (request, taste) => ({
      ...buildTonight(cellar.rows, cellar.favorites, cellar.scores, request, NOW, taste ?? null),
    }),
    taste: async () => null,
    llm,
    parts: sommelierParts,
    profiles,
    now: () => NOW,
    spend: async () => {},
    householdId: async () => "00000000-0000-4000-8000-0000000000aa",
    locale: async () => "en",
    recordUsage: async () => {},
  });
  return { ask: (request) => service.ask(request), counts };
}

/** A percentile of sorted values, with the same definition as score.ts (the value at floor(p·n)). */
export const percentile = (sorted: readonly number[], p: number) =>
  sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!;
