import "server-only";

/**
 * The data API never returns more than `max_rows` rows in one answer (1000 on Supabase), however large a limit
 * is asked for, and it does not say that it cut the list short. So a long list is read page by page, until a
 * page comes back short. Pages need a stable order, so callers sort on something unique as a last key.
 */
export const PAGE_SIZE = 1000;
/** A guard, not a limit anyone should meet: 200 pages = 200 000 rows. */
const MAX_PAGES = 200;

export async function allRows<T, E>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: E | null }>,
  pageSize = PAGE_SIZE,
): Promise<{ data: T[]; error: E | null }> {
  const rows: T[] = [];
  for (let i = 0; i < MAX_PAGES; i++) {
    const { data, error } = await page(i * pageSize, (i + 1) * pageSize - 1);
    if (error) return { data: rows, error };
    rows.push(...(data ?? []));
    if ((data?.length ?? 0) < pageSize) break;
  }
  return { data: rows, error: null };
}
