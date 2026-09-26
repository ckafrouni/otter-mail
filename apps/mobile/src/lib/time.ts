const time = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const weekday = new Intl.DateTimeFormat(undefined, { weekday: "short" });
const monthDay = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const fullDate = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });
const fullDateTime = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

const DAY_MS = 24 * 60 * 60 * 1000;

/** List-row date, like Mail: a time today, a weekday this week, then a date. */
export function formatListDate(epochMs: number, now = Date.now()): string {
  const date = new Date(epochMs);
  const startOfToday = new Date(now).setHours(0, 0, 0, 0);
  if (epochMs >= startOfToday) return time.format(date);
  if (epochMs >= startOfToday - DAY_MS) return "Yesterday";
  if (epochMs >= startOfToday - 6 * DAY_MS) return weekday.format(date);
  if (date.getFullYear() === new Date(now).getFullYear()) return monthDay.format(date);
  return fullDate.format(date);
}

export const formatMessageDate = (epochMs: number) => fullDateTime.format(new Date(epochMs));
