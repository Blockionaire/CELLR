import { beforeEach, describe, expect, it, vi } from "vitest";

const insert = vi.fn<(row: Record<string, unknown>) => Promise<{ error: unknown }>>();
const release = vi.fn<(id: string) => Promise<void>>(async () => {});
let db: { from: () => { insert: typeof insert } } | null = null;

vi.mock("./client", () => ({ createServiceClient: () => db }));
vi.mock("./ai-budget", () => ({ releaseAiBudget: (id: string) => release(id) }));
vi.mock("@/server/log", () => ({ logError: () => {} }));

const { recordAiUsage } = await import("./ai-usage");

const entry = {
  userId: "u1",
  householdId: null,
  task: "sommelier_chat",
  status: "ok" as const,
  usage: {
    model: "gpt-4.1-mini",
    tokensIn: 1000,
    tokensOut: 100,
    latencyMs: 5,
    reported: true,
    budgetHold: { id: "hold-1", estimateUsdMicro: 9000 },
  },
};

beforeEach(() => {
  insert.mockReset();
  release.mockClear();
  db = { from: () => ({ insert }) };
});

describe("a budget hold is released only once the spending is durably recorded", () => {
  it("released after the row is written", async () => {
    insert.mockResolvedValueOnce({ error: null });
    await recordAiUsage(entry);
    expect(release).toHaveBeenCalledWith("hold-1");
  });

  it("kept when the write fails, so the held amount keeps counting as spent", async () => {
    insert.mockResolvedValueOnce({ error: { code: "57014", message: "timeout" } });
    await recordAiUsage(entry);
    expect(release).not.toHaveBeenCalled();
  });

  it("kept when the legacy retry fails too, and when there is no database at all", async () => {
    insert
      .mockResolvedValueOnce({ error: { code: "PGRST204" } })
      .mockResolvedValueOnce({ error: { code: "08006" } });
    await recordAiUsage(entry);
    db = null;
    await recordAiUsage(entry);
    expect(release).not.toHaveBeenCalled();
  });

  it("an unknown cost is written as NULL with its hold, never as 0", async () => {
    insert.mockResolvedValueOnce({ error: null });
    await recordAiUsage({ ...entry, usage: { ...entry.usage, reported: false } });
    expect(insert.mock.calls[0]?.[0]).toMatchObject({
      cost_usd_micro: null,
      cost_hold_usd_micro: 9000,
    });
  });
});
