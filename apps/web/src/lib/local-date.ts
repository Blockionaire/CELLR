/** Today's date where the person is (YYYY-MM-DD), not in UTC: just after midnight in Amsterdam it is already today. */
export function todayLocal(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
