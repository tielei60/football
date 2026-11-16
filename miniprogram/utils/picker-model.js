// Pure business-selection state. Never invokes native picker chrome or mutates business data.
const pad = (n) => String(n).padStart(2, "0");
const iso = (y, m, d) => `${String(y).padStart(4, "0")}-${pad(m)}-${pad(d)}`;
const daysIn = (y, m) => new Date(y, m, 0).getDate();
function parseDate(v) {
  const m = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(String(v || ""));
  if (!m) return null;
  const y = +m[1],
    month = +(m[2] || 1),
    d = +(m[3] || 1);
  return y >= 100 &&
    y <= 9999 &&
    month >= 1 &&
    month <= 12 &&
    d >= 1 &&
    d <= daysIn(y, month)
    ? { y, m: month, d }
    : null;
}
const minutes = (v) =>
  /^([01]\d|2[0-3]):[0-5]\d$/.test(String(v))
    ? Number(v.slice(0, 2)) * 60 + Number(v.slice(3))
    : null;
function decorate(s) {
  const out = {
    ...s,
    rows: [],
    days: [],
    hours: [],
    minutes: [],
    weekdays: ["一", "二", "三", "四", "五", "六", "日"],
  };
  if (s.mode === "selector") {
    out.rows = s.labels.map((label, value) => ({
      value,
      label,
      selected: value === s.draft,
      disabled: false,
    }));
    out.heading = "请选择";
  } else if (s.mode === "time") {
    const [hour, minute] = s.draft.split(":").map(Number);
    out.heading = s.draft;
    out.hours = Array.from({ length: 24 }, (_, h) => ({
      value: "hour:" + pad(h),
      label: pad(h),
      selected: h === hour,
      disabled: h * 60 + 59 < s.min || h * 60 > s.max,
    }));
    const minuteOptions = Array.from({ length: Math.ceil(60 / s.minuteStep) }, (_, i) => i * s.minuteStep);
    if (minute % s.minuteStep !== 0) minuteOptions.push(minute);
    out.minutes = minuteOptions.sort((a, b) => a - b).map((m) => ({
      value: "minute:" + pad(m),
      label: pad(m),
      selected: m === minute,
      disabled: hour * 60 + m < s.min || hour * 60 + m > s.max,
    }));
  } else if (s.fields === "year") {
    out.heading = `${s.viewYear}–${s.viewYear + 11}`;
    out.rows = Array.from({ length: 12 }, (_, i) => {
      const value = String(s.viewYear + i);
      return {
        value,
        label: value + "年",
        selected: value === s.draft,
        disabled: value < s.min || value > s.max,
      };
    });
  } else if (s.fields === "month") {
    out.heading = s.viewYear + "年";
    out.rows = Array.from({ length: 12 }, (_, i) => {
      const value = `${s.viewYear}-${pad(i + 1)}`;
      return {
        value,
        label: i + 1 + "月",
        selected: value === s.draft,
        disabled: value < s.min || value > s.max,
      };
    });
  } else {
    out.heading = `${s.viewYear}年${s.viewMonth}月`;
    const offset = (new Date(s.viewYear, s.viewMonth - 1, 1).getDay() + 6) % 7;
    out.days = [
      ...Array.from({ length: offset }, (_, i) => ({
        value: "blank" + i,
        label: "",
        disabled: true,
      })),
      ...Array.from({ length: daysIn(s.viewYear, s.viewMonth) }, (_, i) => {
        const value = iso(s.viewYear, s.viewMonth, i + 1);
        return {
          value,
          label: String(i + 1),
          selected: value === s.draft,
          disabled: value < s.min || value > s.max,
        };
      }),
    ];
  }
  if (s.mode === "date") {
    const lo = parseDate(s.min),
      hi = parseDate(s.max);
    out.yearOptions =
      lo && hi
        ? Array.from({ length: Math.max(0, hi.y - lo.y + 1) }, (_, i) => ({
            value: lo.y + i,
            label: lo.y + i + "年",
            selected: lo.y + i === s.viewYear,
            disabled: false,
          }))
        : [];
  }
  out.valid = valid(out);
  return out;
}
function create(config = {}, now = new Date()) {
  const mode = config.mode || "selector";
  let s = {
    mode,
    title:
      config.title ||
      { selector: "请选择", date: "选择日期", time: "选择时间" }[mode],
    fields: config.fields || "day",
    error: "",
  };
  if (mode === "selector") {
    const range = Array.isArray(config.range) ? config.range : [];
    s.labels = range.map((v) =>
      String(
        config.rangeKey && v && typeof v === "object"
          ? (v[config.rangeKey] ?? "")
          : (v ?? ""),
      ),
    );
    const index = Number(config.value);
    s.draft =
      Number.isInteger(index) && index >= 0 && index < range.length ? index : 0;
  } else if (mode === "time") {
    s.minuteStep = Number.isInteger(config.minuteStep) && config.minuteStep >= 1 && config.minuteStep <= 60
      ? config.minuteStep : 1;
    s.min = config.start ? minutes(config.start) : 0;
    s.max = config.end ? minutes(config.end) : 1439;
    if (s.min === null || s.max === null || s.min > s.max) {
      s.error = "时间范围无效";
      s.min = 0;
      s.max = -1;
    }
    const value = minutes(config.value) ?? now.getHours() * 60 + Math.floor(now.getMinutes() / s.minuteStep) * s.minuteStep;
    const selected = Math.max(s.min, Math.min(s.max, value));
    s.draft =
      pad(Math.floor(Math.max(0, selected) / 60)) +
      ":" +
      pad(Math.max(0, selected) % 60);
  } else if (mode === "date") {
    if (!["year", "month", "day"].includes(s.fields)) s.fields = "day";
    const size = s.fields === "year" ? 4 : s.fields === "month" ? 7 : 10;
    const start = parseDate(config.start || "1900-01-01"),
      end = parseDate(config.end || "2100-12-31");
    if (!start || !end) {
      s.error = "日期范围无效";
      s.min = "1900";
      s.max = "1899";
    } else {
      s.min = iso(start.y, start.m, start.d).slice(0, size);
      s.max = iso(end.y, end.m, end.d).slice(0, size);
      if (s.min > s.max) s.error = "日期范围无效";
    }
    const p = parseDate(config.value) || {
      y: now.getFullYear(),
      m: now.getMonth() + 1,
      d: now.getDate(),
    };
    s.draft = iso(p.y, p.m, p.d).slice(0, size);
    s.draft = s.draft < s.min ? s.min : s.draft > s.max ? s.max : s.draft;
    const v = parseDate(s.draft) || p;
    s.viewYear = v.y;
    s.viewMonth = v.m;
  } else {
    s.error = "不支持的选择类型";
    s.draft = "";
  }
  return decorate(s);
}
function valid(s) {
  if (s.error) return false;
  if (s.mode === "selector")
    return (
      Number.isInteger(s.draft) && s.draft >= 0 && s.draft < s.labels.length
    );
  if (s.mode === "time") {
    const v = minutes(s.draft);
    return v !== null && v >= s.min && v <= s.max;
  }
  return !!parseDate(s.draft) && s.draft >= s.min && s.draft <= s.max;
}
function select(s, value) {
  let draft = s.draft;
  if (s.mode === "selector") {
    value = Number(value);
    if (!Number.isInteger(value) || value < 0 || value >= s.labels.length)
      return s;
    draft = value;
  } else if (s.mode === "time") {
    const match = /^(hour|minute):(\d{2})$/.exec(String(value));
    if (!match) return s;
    const n = Number(match[2]),
      [h, m] = draft.split(":").map(Number);
    if (match[1] === "hour" && n <= 23) {
      if (n * 60 + 59 < s.min || n * 60 > s.max) return s;
      const t = Math.max(s.min, Math.min(s.max, n * 60 + m));
      draft = pad(Math.floor(t / 60)) + ":" + pad(t % 60);
    } else if (match[1] === "minute" && n <= 59 && (n % s.minuteStep === 0 || n === m)) draft = pad(h) + ":" + pad(n);
    else return s;
  } else {
    if (typeof value !== "string" || !parseDate(value)) return s;
    const size = s.fields === "year" ? 4 : s.fields === "month" ? 7 : 10;
    if (value.length !== size) return s;
    draft = value;
  }
  const candidate = { ...s, draft };
  return valid(candidate) ? decorate(candidate) : s;
}
function navigate(s, delta) {
  if (s.mode !== "date" || !Number.isInteger(delta)) return s;
  let y = s.viewYear,
    m = s.viewMonth;
  if (s.fields === "year") y += delta * 12;
  else if (s.fields === "month") y += delta;
  else {
    const d = new Date(y, m - 1 + delta, 1);
    y = d.getFullYear();
    m = d.getMonth() + 1;
  }
  const min = parseDate(s.min),
    max = parseDate(s.max);
  if (!min || !max || y < min.y - 11 || y > max.y) return s;
  return decorate({ ...s, viewYear: y, viewMonth: m });
}
function result(s) {
  return valid(s) ? s.draft : null;
}
function jump(s, year, month = s.viewMonth) {
  const lo = parseDate(s.min),
    hi = parseDate(s.max);
  if (
    s.mode !== "date" ||
    !lo ||
    !hi ||
    !Number.isInteger(year) ||
    year < lo.y ||
    year > hi.y ||
    !Number.isInteger(month) ||
    month < 1 ||
    month > 12
  )
    return s;
  return decorate({ ...s, viewYear: year, viewMonth: month });
}
module.exports = { create, select, navigate, jump, valid, result };
