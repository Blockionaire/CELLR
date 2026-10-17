# Scan eval data

This folder holds the data for `pnpm scan:eval`, which measures how accurately the label reader reads
**your own** bottles. The photos, your expected values and the report are ignored by git and stay on your
machine. Only this README and `expected.example.json` are committed.

```
eval/scan/
  photos/                  your label photos: .jpg .jpeg .png .webp   (not committed)
  expected.json            what each photo really says                (not committed)
  expected.example.json    the format, with made-up wines             (committed)
  report.json              written by each run                        (not committed)
```

## Expected values

`expected.json` maps a photo's file name to what is printed on the label. Every field is optional; only the
fields you write down are scored.

```json
{
  "IMG_0001.jpg": {
    "producer": "Château Margaux",
    "wine": "Pavillon Rouge",
    "vintage": 2015,
    "type": "red",
    "country": "FR",
    "region": "Margaux",
    "grapes": ["Merlot"]
  },
  "IMG_0002.jpg": { "producer": "Bollinger", "vintage": null, "type": "sparkling" }
}
```

| Field      | Write                                                   | Scored as                                                                       |
| ---------- | ------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `producer` | the estate or house                                     | same name, or enough words in common (case, accents, "Château/Domaine" ignored) |
| `wine`     | the cuvée as printed; `null` if the label shows none    | same as producer                                                                |
| `vintage`  | the year, or `null` for non-vintage (NV)                | exact                                                                           |
| `type`     | red, white, rose, sparkling, orange, dessert, fortified | exact (rouge, bianco, ... are understood)                                       |
| `country`  | `"FR"` or `"France"`                                    | exact, by country code                                                          |
| `region`   | region or appellation                                   | matches the region or the appellation the reader found                          |
| `grapes`   | a list                                                  | every grape you list must be found                                              |

A key may be the file name with or without its extension, in any letter case. Keys starting with `_` are
ignored. A photo with no entry is not read (so it costs nothing).

A spreadsheet export works too: `expected.csv` with a first line like
`file,producer,wine,vintage,type,country,region,grapes`. Leave a cell empty to skip that field, write `NV` for
a non-vintage wine, and separate grapes with `;`. If both files exist, `expected.json` is used.

## Run it

```
OPENAI_API_KEY=sk-... pnpm scan:eval
```

The key is read from the environment only, like the app (`AI_MODEL_VISION` and `AI_BASE_URL` work too). Never
put it in a file. With no photos, or no key, the command prints why it did nothing and exits 0.

Options go after the command: `--limit 5` (first five photos), `--only margaux` (file names containing
that text), `--concurrency 3`, `--threshold 0.6` (how many words a name must share), `--min-right-wine 0.8`
(exit 1 below that rate, for a gate).

## Read the report

The terminal shows one row per field: how many photos had it written down, how many the reader got right, and
the accuracy. **right wine** is the share of photos where every identity field you wrote down (producer, wine,
vintage) was right. Below the table: how many photos produced a reading, average and slowest-5% latency,
token use, and a list of misses (photo, field, what you expected, what the reader said).

`report.json` has the same numbers plus, per photo, the expected values, what the reader returned and how each
field scored. Compare it between runs to see whether a change to the prompt or the model helped.
