import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import type { SmartStoragePlacementsView } from "@cellr/domain";
import { readPlacementsFresh, smartPlacementsKey } from "./smart-cellar-hooks";

const view = (revision: string) =>
  ({ unit: { id: "p", revision }, placements: [] }) as unknown as SmartStoragePlacementsView;
const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

describe("reading a place fresh (Rack Builder, review corrections)", () => {
  it("answers what the server says now, and puts it in the cache", async () => {
    const qc = client();
    qc.setQueryData(smartPlacementsKey("p"), view("old"));
    const fresh = await readPlacementsFresh(qc, "p", async () => view("new"));
    expect(fresh.unit.revision).toBe("new");
    expect(
      qc.getQueryData<SmartStoragePlacementsView>(smartPlacementsKey("p"))!.unit.revision,
    ).toBe("new");
  });

  it("a failure is thrown, never answered with what is cached, and the cache is left as it was", async () => {
    const qc = client();
    qc.setQueryData(smartPlacementsKey("p"), view("cached"));
    for (const failure of [
      new Error("network"),
      Object.assign(new Error("401"), { code: "UNAUTHORIZED" }),
    ])
      await expect(
        readPlacementsFresh(qc, "p", async () => {
          throw failure;
        }),
      ).rejects.toBe(failure);
    expect(
      qc.getQueryData<SmartStoragePlacementsView>(smartPlacementsKey("p"))!.unit.revision,
    ).toBe("cached");
  });

  it("a refresh already on its way is cancelled: its older answer cannot land on top of the fresh one", async () => {
    const qc = client();
    let release: (v: SmartStoragePlacementsView) => void = () => {};
    const slow = qc
      .fetchQuery({
        queryKey: smartPlacementsKey("p"),
        queryFn: () => new Promise<SmartStoragePlacementsView>((r) => (release = r)),
      })
      .catch(() => "cancelled");
    await readPlacementsFresh(qc, "p", async () => view("fresh"));
    release(view("older"));
    expect(await slow).toBe("cancelled");
    expect(
      qc.getQueryData<SmartStoragePlacementsView>(smartPlacementsKey("p"))!.unit.revision,
    ).toBe("fresh");
  });
});
