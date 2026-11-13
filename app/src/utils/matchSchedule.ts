/** Club-local wall-clock dates: use UTC only for arithmetic, never timezone conversion. */
export interface MatchSchedule {
  date: string;
  kickoff?: string;
  durationMinutes?: number | null;
}
export function parseMatchDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const result = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(result.getTime()) && result.toISOString().slice(0, 10) === value ? result : null;
}
export function validKickoff(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}
export function formatMatchDate(value: string): string {
  const parsed = parseMatchDate(value);
  return parsed ? `${value} 周${"日一二三四五六"[parsed.getUTCDay()]}` : "日期待定";
}
export function formatSchedule(value: MatchSchedule | string, kickoff = ""): string {
  const schedule = typeof value === "string" ? { date: value, kickoff } : value;
  return `${formatMatchDate(schedule.date)} · ${validKickoff(schedule.kickoff || "") ? schedule.kickoff : "时间待定"}`;
}
export function matchEndLabel(
  value: MatchSchedule | string,
  kickoff = "",
  durationMinutes: number | null = null
): string {
  const schedule = typeof value === "string" ? { date: value, kickoff, durationMinutes } : value;
  const parsed = parseMatchDate(schedule.date);
  const time = schedule.kickoff || "";
  const duration = schedule.durationMinutes;
  if (
    !parsed ||
    !validKickoff(time) ||
    !Number.isInteger(duration) ||
    duration == null ||
    duration < 1 ||
    duration > 1440
  )
    return "结束时间待定";
  const [hours, minutes] = time.split(":").map(Number);
  parsed.setUTCMinutes(hours * 60 + minutes + duration);
  if (parsed.getUTCFullYear() > 9999) return "结束时间超出支持日期范围";
  const iso = parsed.toISOString();
  return `预计结束：${formatMatchDate(iso.slice(0, 10))} ${iso.slice(11, 16)}`;
}
export function calendarDays(year: number, month: number): string[] {
  const first = parseMatchDate(`${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-01`);
  if (!first) return [];
  first.setUTCDate(1 - ((first.getUTCDay() + 6) % 7));
  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(first);
    day.setUTCDate(first.getUTCDate() + index);
    return day.getUTCFullYear() >= 0 && day.getUTCFullYear() <= 9999 ? day.toISOString().slice(0, 10) : "";
  });
}
