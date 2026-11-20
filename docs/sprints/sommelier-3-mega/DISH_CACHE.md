# Shared dish readings: the cache (S10)

A model's reading of a dish is not about the person who asked. "Zuurkool met casselerrib" is the same dish for
everyone, so a reading can be kept and given to the next person who asks about it, and that second question then
costs nothing and answers at once. This page says what is kept, under what key, for how long, and why it
cannot become a way for one person's data to reach another.

Code: `apps/web/src/server/sommelier/dish-cache.ts` (the store), `dish-reader.ts` (its use),
`packages/domain/src/food/route.ts` (`dishPhrase`), `packages/domain/src/food/reading.ts` (what a reading is).

## What the model sees, and what the key is made of

Both are the **dish phrase** (`dishPhrase`): the question lower case, with every `@name` removed, every number,
price and punctuation mark removed, accents folded, and the words around the dish dropped: the occasion
("tonight", "birthday"), the people ("my in-laws", "the kids"), the budget ("under 30 euro"), the shop, the
cellar, and the asking ("which wine should I open"). At most 12 words and 120 characters. "Zuurkool met
casselerrib vanavond voor mijn schoonouders, max 20 euro?" becomes `zuurkool met casselerrib`.

Because the model is shown exactly the phrase and nothing else (no question, no conversation, no cellar, no
taste, no friend), the reading is a function of the phrase alone. Two people who type the same phrase would get
the same reading from the model; giving the second one the first one's reading tells them nothing about the
first.

**Never in the phrase, so never sent and never kept:** names of people (mentions), numbers (ages, guests,
prices, phone numbers), the conversation, anything about the cellar or a friend. A question that names a friend
is not sent to the model at all, not even its dish (the friend's consent text promises that).

**Can still be in the phrase:** a word the lists do not know as "not food", for example a health word
("bulgogi for my **diabetic** dad" becomes `bulgogi diabetic`: "dad" is dropped, "diabetic" is not). Such a word
is sent to the model, as the whole question is sent today by the V1 sommelier, and it is part of the key. It is
not readable in the store (below), and the reading kept under it holds no text.

## What is kept

The checked reading only (`DishReading`): whether the dish was recognised, its class, ids from the food
knowledge (ingredients, techniques, sauces), numbers on the engine's fixed scales, tags from a closed list, and a
confidence word. **No text**: not the phrase, not the question, not anything the model wrote. Before a reading is
stored it is checked again against the schema and copied field by field, so anything else on the object (a
mistake, a field added later) is not stored (tested).

## The key

`sha256(JSON([reading schema version, prompt version, model id, hash of the knowledge's ids, phrase]))`. The
phrase is never stored as such, only inside this hash.

- A new schema of the reading, a new prompt (`dish_reading@v1`), a new model, or a change to the food knowledge's
  ids each make every key new: an old reading is never used with a newer engine. That is the **versioning and
  invalidation**; nothing has to be deleted by hand.
- In a store shared by every server (below), the key must be an **HMAC** with a server-side secret instead of a
  plain hash, so that someone who could read the store cannot test guesses ("did anyone ask about X?").

## How long

- A recognised dish: **30 days**. Dishes do not change; models and prompts do, and those change the key anyway.
- A dish the model did not recognise: **1 day**, so a better model or prompt gets a chance soon.
- At most **5,000** readings per store; the least recently used goes first.

## Where it lives

**Built:** in the memory of one server instance (`createMemoryDishCache`). Everyone that instance serves shares
it; it is lost when the instance stops. On a serverless platform instances are short-lived, so it saves less
than a shared store would. It needs no migration and nothing to configure.

**Designed, not built:** a table shared by every instance, for when the switch is on for many people:

| Column       | Type          | Note                                                    |
| ------------ | ------------- | ------------------------------------------------------- |
| `key`        | `text`, PK    | HMAC-SHA-256 hex of the key above, with a server secret |
| `reading`    | `jsonb`       | the checked reading; a check constraint on its keys     |
| `recognised` | `boolean`     |                                                         |
| `expires_at` | `timestamptz` | from the TTLs above; a daily job deletes expired rows   |
| `created_at` | `timestamptz` |                                                         |

No `user_id`, no `household_id`, no phrase. Row-level security on, **no grants to `authenticated` or `anon`**:
only the server's service role reads and writes it, through two functions (`get`, `put`) that validate the
key's format and the reading's shape. That needs a migration, a secret and the owner's approval; it is not part
of this work.

## Why it cannot leak private data between people

1. The value has no text, so nothing a person wrote can come out of it.
2. The value is a function of the phrase, and the phrase holds nothing about the asker but the dish (and,
   rarely, a word the lists do not drop, which stays in the key only, hashed).
3. A cache hit tells the second person nothing they did not type themselves. The one thing it can reveal is
   timing (a hit answers faster), which says only that someone, somewhen, asked about the same dish phrase.
4. Friends, cellars, taste, conversations and names never reach the reader, so they cannot reach the store.

## Tests

`apps/web/src/server/sommelier/intelligence-dish.test.ts` ("the shared store of dish readings"): the key is a hash
and changes with every version; only checked fields are kept; an out-of-range reading is not kept; expiry, the
shorter expiry of an unknown dish, and least-recently-used eviction. `packages/domain/src/food/reading.test.ts`
("the dish phrase a model sees"): names, numbers and prices never reach the phrase.
