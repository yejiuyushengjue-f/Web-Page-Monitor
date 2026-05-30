(function attachShared(global) {
  const SCHEDULE_MODE_ALLOW = "allowlist";
  const SCHEDULE_MODE_BLOCK = "blocklist";

  const DAY_NAMES_SHORT = ["日", "一", "二", "三", "四", "五", "六"];
  const DAY_NAMES_FULL = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

  const DEFAULT_SETTINGS = {
    allowPolicyEnabled: true,
    blockPolicyEnabled: false,
    sites: ["youtube.com", "bilibili.com", "x.com", "reddit.com"],
    schedules: [
      { id: "weekday-evening", days: [1, 2, 3, 4, 5], start: "20:00", end: "21:00" },
      { id: "weekend-afternoon", days: [0, 6], start: "14:00", end: "15:30" },
      { id: "weekend-evening", days: [0, 6], start: "20:00", end: "21:00" }
    ],
    blockedSchedules: [],
    passMinutes: 10,
    recordAllowed: false
  };

  function normalizeSettings(input = {}) {
    return {
      allowPolicyEnabled: inferAllowPolicyEnabled(input),
      blockPolicyEnabled: inferBlockPolicyEnabled(input),
      sites: normalizeSites(input.sites),
      schedules: normalizeSchedules(input.schedules, DEFAULT_SETTINGS.schedules),
      blockedSchedules: normalizeSchedules(input.blockedSchedules, DEFAULT_SETTINGS.blockedSchedules),
      passMinutes: clampNumber(Number(input.passMinutes), 1, 60, DEFAULT_SETTINGS.passMinutes),
      recordAllowed: Boolean(input.recordAllowed)
    };
  }

  function inferAllowPolicyEnabled(input) {
    if (typeof input.allowPolicyEnabled === "boolean") {
      return input.allowPolicyEnabled;
    }

    if (typeof input.enableAllowSchedules === "boolean") {
      return input.enableAllowSchedules;
    }

    const legacyMode = input.scheduleMode || input.policyMode || input.mode;
    return legacyMode === SCHEDULE_MODE_BLOCK ? false : DEFAULT_SETTINGS.allowPolicyEnabled;
  }

  function inferBlockPolicyEnabled(input) {
    if (typeof input.blockPolicyEnabled === "boolean") {
      return input.blockPolicyEnabled;
    }

    if (typeof input.enableBlockedSchedules === "boolean") {
      return input.enableBlockedSchedules;
    }

    const legacyMode = input.scheduleMode || input.policyMode || input.mode;
    return legacyMode === SCHEDULE_MODE_BLOCK ? true : DEFAULT_SETTINGS.blockPolicyEnabled;
  }

  function normalizeSites(sites) {
    const normalized = Array.isArray(sites)
      ? sites.map(normalizeSite).filter(Boolean)
      : DEFAULT_SETTINGS.sites;

    return [...new Set(normalized)];
  }

  function normalizeSchedules(schedules, fallback = []) {
    const source = Array.isArray(schedules) ? schedules : fallback;
    return source.map(normalizeSchedule).filter(Boolean);
  }

  function normalizeSchedule(schedule) {
    const days = Array.isArray(schedule?.days)
      ? [...new Set(schedule.days.map(Number).filter((day) => day >= 0 && day <= 6))]
      : [];

    if (days.length === 0 || !isTimeString(schedule?.start) || !isTimeString(schedule?.end)) {
      return null;
    }

    return {
      id: String(schedule.id || createId("schedule")),
      days,
      start: schedule.start,
      end: schedule.end
    };
  }

  function createId(prefix = "id") {
    if (global.crypto?.randomUUID) {
      return global.crypto.randomUUID();
    }

    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function parseHttpUrl(url) {
    try {
      const parsedUrl = new URL(url);

      if (!["http:", "https:"].includes(parsedUrl.protocol)) {
        return null;
      }

      return parsedUrl;
    } catch {
      return null;
    }
  }

  function findMatchingSite(hostname, sites) {
    const host = normalizeHost(hostname);

    return sites.find((site) => host === site || host.endsWith(`.${site}`)) || null;
  }

  function normalizeSite(input) {
    const raw = String(input || "").trim().toLowerCase();

    if (!raw) {
      return "";
    }

    const withProtocol = raw.includes("://") ? raw : `https://${raw}`;

    try {
      return normalizeHost(new URL(withProtocol).hostname.replace(/^\*\./, ""));
    } catch {
      return normalizeHost(raw.split("/")[0].replace(/^\*\./, ""));
    }
  }

  function normalizeHost(hostname) {
    return String(hostname || "")
      .trim()
      .toLowerCase()
      .replace(/\.$/, "")
      .replace(/^www\./, "");
  }

  function getScheduleState(settings, now = new Date()) {
    const activeAllowedWindow = getActiveScheduleWindow(settings.schedules, now);
    const activeBlockedWindow = getActiveScheduleWindow(settings.blockedSchedules, now);
    const outsideAllowed = settings.allowPolicyEnabled && !activeAllowedWindow;
    const insideBlocked = settings.blockPolicyEnabled && Boolean(activeBlockedWindow);
    const blockReasons = [];

    if (outsideAllowed) {
      blockReasons.push("outside_allowed");
    }

    if (insideBlocked) {
      blockReasons.push("inside_blocked");
    }

    return {
      isBlocked: blockReasons.length > 0,
      isWithinSchedule: Boolean(activeAllowedWindow),
      isInsideBlockedWindow: Boolean(activeBlockedWindow),
      blockReasons,
      nextWindow: settings.allowPolicyEnabled ? getNextWindow(settings.schedules, now) : null,
      nextBlockedWindow: settings.blockPolicyEnabled ? getNextWindow(settings.blockedSchedules, now) : null,
      blockedUntil: activeBlockedWindow
        ? {
            label: formatUntilLabel(activeBlockedWindow.endsAt),
            end: activeBlockedWindow.endsAt.toISOString()
          }
        : null,
      policyState: getPolicyState(settings),
      policyLabel: getPolicyLabel(settings)
    };
  }

  function getPolicyState(settings) {
    if (settings.allowPolicyEnabled && settings.blockPolicyEnabled) {
      return "allow_and_block";
    }

    if (settings.allowPolicyEnabled) {
      return "allow_only";
    }

    if (settings.blockPolicyEnabled) {
      return "block_only";
    }

    return "disabled";
  }

  function getPolicyLabel(settings) {
    const state = getPolicyState(settings);

    if (state === "allow_and_block") {
      return "允许和禁止规则同时生效";
    }

    if (state === "allow_only") {
      return "允许时间段规则";
    }

    if (state === "block_only") {
      return "禁止时间段规则";
    }

    return "时间规则未启用";
  }

  function getActiveScheduleWindow(schedules, now = new Date()) {
    const day = now.getDay();
    const previousDay = (day + 6) % 7;
    const minutes = now.getHours() * 60 + now.getMinutes();

    for (const schedule of schedules) {
      const start = timeToMinutes(schedule.start);
      const end = timeToMinutes(schedule.end);

      if (start === end && schedule.days.includes(day)) {
        const startsAt = dateWithMinutes(now, start);
        const endsAt = new Date(startsAt);
        endsAt.setDate(startsAt.getDate() + 1);
        return { schedule, startsAt, endsAt };
      }

      if (start < end && schedule.days.includes(day) && minutes >= start && minutes < end) {
        return {
          schedule,
          startsAt: dateWithMinutes(now, start),
          endsAt: dateWithMinutes(now, end)
        };
      }

      if (start > end && schedule.days.includes(day) && minutes >= start) {
        const endsAt = dateWithMinutes(now, end);
        endsAt.setDate(endsAt.getDate() + 1);
        return {
          schedule,
          startsAt: dateWithMinutes(now, start),
          endsAt
        };
      }

      if (start > end && schedule.days.includes(previousDay) && minutes < end) {
        const startsAt = dateWithMinutes(now, start);
        startsAt.setDate(startsAt.getDate() - 1);
        return {
          schedule,
          startsAt,
          endsAt: dateWithMinutes(now, end)
        };
      }
    }

    return null;
  }

  function getNextWindow(schedules, now = new Date()) {
    if (!Array.isArray(schedules) || schedules.length === 0) {
      return null;
    }

    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const candidates = [];

    for (let offset = 0; offset < 8; offset += 1) {
      const candidateDate = new Date(now);
      candidateDate.setDate(now.getDate() + offset);
      const day = candidateDate.getDay();

      for (const schedule of schedules) {
        if (!schedule.days.includes(day)) {
          continue;
        }

        const start = timeToMinutes(schedule.start);

        if (offset === 0 && start <= currentMinutes) {
          continue;
        }

        const startDate = dateWithMinutes(candidateDate, start);
        candidates.push({ startDate, schedule });
      }
    }

    candidates.sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
    const next = candidates[0];

    if (!next) {
      return null;
    }

    return {
      label: formatWindowLabel(next.startDate, next.schedule),
      start: next.startDate.toISOString(),
      endTime: next.schedule.end
    };
  }

  function getLogTypeText(log) {
    if (log.accessType === "allowed") {
      return "直接访问";
    }

    const blockReason = String(log.blockReason || "");

    if (blockReason.includes("outside_allowed") && blockReason.includes("inside_blocked")) {
      return `双规则放行 ${log.durationMinutes || 0} 分钟`;
    }

    if (blockReason.includes("inside_blocked")) {
      return `禁止时段放行 ${log.durationMinutes || 0} 分钟`;
    }

    return `非允许时段放行 ${log.durationMinutes || 0} 分钟`;
  }

  function dateWithMinutes(baseDate, minutes) {
    const date = new Date(baseDate);
    date.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
    return date;
  }

  function formatWindowLabel(startDate, schedule) {
    return `${DAY_NAMES_FULL[startDate.getDay()]} ${pad2(startDate.getHours())}:${pad2(startDate.getMinutes())}-${schedule.end}`;
  }

  function formatUntilLabel(date) {
    return `${DAY_NAMES_FULL[date.getDay()]} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  }

  function formatLocalDateTime(date) {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
  }

  function timeToMinutes(time) {
    const [hours, minutes] = time.split(":").map(Number);
    return hours * 60 + minutes;
  }

  function isTimeString(value) {
    return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value || ""));
  }

  function clampNumber(value, min, max, fallback) {
    if (!Number.isFinite(value)) {
      return fallback;
    }

    return Math.min(max, Math.max(min, value));
  }

  function pad2(value) {
    return String(value).padStart(2, "0");
  }

  const api = {
    SCHEDULE_MODE_ALLOW,
    SCHEDULE_MODE_BLOCK,
    DAY_NAMES_SHORT,
    DAY_NAMES_FULL,
    DEFAULT_SETTINGS,
    clampNumber,
    createId,
    findMatchingSite,
    formatLocalDateTime,
    getActiveScheduleWindow,
    getLogTypeText,
    getNextWindow,
    getPolicyLabel,
    getPolicyState,
    getScheduleState,
    isTimeString,
    normalizeHost,
    normalizeSchedule,
    normalizeSchedules,
    normalizeSettings,
    normalizeSite,
    normalizeSites,
    parseHttpUrl,
    timeToMinutes
  };

  global.WPM = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(globalThis);
