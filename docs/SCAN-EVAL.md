# Scan eval

A way to measure how well the app reads wine labels, using your own photos. It answers "is the scan good
enough, and did my last change make it better or worse?" with numbers instead of a feeling. It is the
regression set from decision D9 in the architecture plan.

## What it measures

For each photo it runs the **same label reading the app runs** (same instructions to the model, same strict
answer format, same sanity checks such as "a vintage of 2087 is dropped") and compares the result to what you
wrote down. You get:

- accuracy per field: producer, wine name, vintage, type, country, region, grapes;
- the share of photos where the right wine was identified (producer, wine and vintage all correct);
- average and slowest-5% time per photo, and tokens used;
- a list of every miss: photo, field, what you expected, what it read.

Names are compared forgivingly (case, accents, "Château"/"Domaine" and punctuation do not matter; enough
shared words counts). Vintage, type and country must be exactly right.

## Cost

One vision call per photo, the same call a scan makes in the app: roughly a cent or two each. A run over 50
photos costs about a euro at most. Nothing else is called, and nothing is saved anywhere but your own disk.

## How to use it

1. Put your label photos in `eval/scan/photos/` (jpg, png or webp; 30-50 bottles is a good set, a mix of easy
   and awkward labels).
2. Copy `eval/scan/expected.example.json` to `eval/scan/expected.json` and write what each photo really says.
   The format and every field are explained in `eval/scan/README.md`.
3. Run it, with the key set for that one command:

   ```
   OPENAI_API_KEY=sk-... pnpm scan:eval
   ```

   Try `pnpm scan:eval --limit 5` first to see it work on a handful.

4. Read the table, then open `eval/scan/report.json` for detail. The thresholds in the architecture plan
   (when a scan counts as strong or ambiguous) are meant to be tuned against these numbers.

Without photos, or without a key, the command says so and exits cleanly (exit code 0), so it can never break
the build.

## Privacy

- The photos, `expected.json` and `report.json` are in `.gitignore`. **Never commit them** and never put real
  photos or an API key anywhere in the repository (it is public).
- Photos stay on your machine and are sent only to OpenAI, to be read, exactly as a scan in the app does.
- The key is read from the environment and is not written anywhere.

## How it works (for the curious)

`scripts/scan-eval/run.ts` builds the app's own scan service (`server/scans/service.ts`) with the real AI
provider and plain stand-ins for storage, the scan budget and the cellar. Photos are first shrunk and
re-encoded like the phone does (longest side 1600 px, JPEG 85%). Scoring lives in `scripts/scan-eval/score.ts`
and `report.ts`, with unit tests (`pnpm --filter @cellr/scan-eval test`, also part of `pnpm test`).
