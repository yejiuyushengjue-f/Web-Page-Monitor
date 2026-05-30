let settings = WPM.normalizeSettings(WPM.DEFAULT_SETTINGS);
let logs = [];

const sitesInput = document.querySelector("#sitesInput");
const passMinutesInput = document.querySelector("#passMinutesInput");
const recordAllowedInput = document.querySelector("#recordAllowedInput");
const saveButton = document.querySelector("#saveButton");
const saveStatus = document.querySelector("#saveStatus");
const allowPolicyEnabledInput = document.querySelector("#allowPolicyEnabledInput");
const blockPolicyEnabledInput = document.querySelector("#blockPolicyEnabledInput");
const activeModeSummary = document.querySelector("#activeModeSummary");
const activeModeBadge = document.querySelector("#activeModeBadge");
const allowBoard = document.querySelector("#allowBoard");
const blockedBoard = document.querySelector("#blockedBoard");
const allowCount = document.querySelector("#allowCount");
const blockedCount = document.querySelector("#blockedCount");
const allowDayGrid = document.querySelector("#allowDayGrid");
const blockedDayGrid = document.querySelector("#blockedDayGrid");
const allowStartInput = document.querySelector("#allowStartInput");
const allowEndInput = document.querySelector("#allowEndInput");
const blockedStartInput = document.querySelector("#blockedStartInput");
const blockedEndInput = document.querySelector("#blockedEndInput");
const addAllowScheduleButton = document.querySelector("#addAllowScheduleButton");
const addBlockedScheduleButton = document.querySelector("#addBlockedScheduleButton");
const allowScheduleList = document.querySelector("#allowScheduleList");
const blockedScheduleList = document.querySelector("#blockedScheduleList");
const logsBody = document.querySelector("#logsBody");
const exportCsvButton = document.querySelector("#exportCsvButton");
const exportJsonButton = document.querySelector("#exportJsonButton");
const clearLogsButton = document.querySelector("#clearLogsButton");

init();

async function init() {
  renderDayPicker(allowDayGrid, [1, 2, 3, 4, 5]);
  renderDayPicker(blockedDayGrid, [0, 1, 2, 3, 4, 5, 6]);

  const stored = await chrome.storage.local.get(["settings", "logs"]);
  settings = WPM.normalizeSettings(stored.settings || WPM.DEFAULT_SETTINGS);
  logs = Array.isArray(stored.logs) ? stored.logs : [];

  renderAll();

  saveButton.addEventListener("click", saveSettings);
  addAllowScheduleButton.addEventListener("click", () => addSchedule("allow"));
  addBlockedScheduleButton.addEventListener("click", () => addSchedule("block"));
  exportCsvButton.addEventListener("click", () => exportLogs("csv"));
  exportJsonButton.addEventListener("click", () => exportLogs("json"));
  clearLogsButton.addEventListener("click", clearLogs);

  allowPolicyEnabledInput.addEventListener("change", () => {
    settings.allowPolicyEnabled = allowPolicyEnabledInput.checked;
    renderPolicyState();
    showStatus("允许时间段开关已更新，记得保存。");
  });

  blockPolicyEnabledInput.addEventListener("change", () => {
    settings.blockPolicyEnabled = blockPolicyEnabledInput.checked;
    renderPolicyState();
    showStatus("禁止时间段开关已更新，记得保存。");
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") {
      return;
    }

    if (changes.logs) {
      logs = Array.isArray(changes.logs.newValue) ? changes.logs.newValue : [];
      renderLogs();
    }
  });
}

function renderAll() {
  renderSettings();
  renderPolicyState();
  renderSchedules("allow");
  renderSchedules("block");
  renderLogs();
}

function renderDayPicker(container, defaultCheckedDays) {
  container.textContent = "";

  WPM.DAY_NAMES_SHORT.forEach((name, day) => {
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = String(day);
    input.checked = defaultCheckedDays.includes(day);

    const span = document.createElement("span");
    span.textContent = name;

    label.append(input, span);
    container.append(label);
  });
}

function renderSettings() {
  sitesInput.value = settings.sites.join("\n");
  passMinutesInput.value = String(settings.passMinutes);
  recordAllowedInput.checked = settings.recordAllowed;
}

function renderPolicyState() {
  allowPolicyEnabledInput.checked = settings.allowPolicyEnabled;
  blockPolicyEnabledInput.checked = settings.blockPolicyEnabled;
  allowBoard.classList.toggle("isActive", settings.allowPolicyEnabled);
  blockedBoard.classList.toggle("isActive", settings.blockPolicyEnabled);

  const state = WPM.getPolicyState(settings);
  activeModeBadge.className = `modeBadge ${getPolicyBadgeClass(state)}`;
  activeModeBadge.textContent = getPolicyBadgeText(state);
  activeModeSummary.textContent = getPolicySummary(state);
}

function renderSchedules(kind) {
  const config = getScheduleConfig(kind);
  config.list.textContent = "";
  config.count.textContent = `${config.schedules.length} 个时间段`;

  if (config.schedules.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = kind === "allow"
      ? "还没有允许时间段。启用后，受控网站会始终要求填写原因。"
      : "还没有禁止时间段。启用后，暂时不会产生限制。";
    config.list.append(empty);
    return;
  }

  config.schedules.forEach((schedule) => {
    const item = document.createElement("div");
    item.className = `scheduleItem ${kind === "block" ? "block" : "allow"}`;

    const content = document.createElement("div");
    const time = document.createElement("div");
    time.className = "timeRange";
    time.append(document.createTextNode(schedule.start));

    const separator = document.createElement("span");
    separator.textContent = "到";
    time.append(separator, document.createTextNode(schedule.end));

    const days = document.createElement("div");
    days.className = "dayChips";
    schedule.days.forEach((day) => {
      const chip = document.createElement("span");
      chip.className = "dayChip";
      chip.textContent = WPM.DAY_NAMES_FULL[day];
      days.append(chip);
    });

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.textContent = "删除";
    removeButton.addEventListener("click", () => {
      config.setSchedules(config.schedules.filter((itemSchedule) => itemSchedule.id !== schedule.id));
      renderSchedules(kind);
      showStatus("时间段已删除，记得保存。");
    });

    content.append(time, days);
    item.append(content, removeButton);
    config.list.append(item);
  });
}

function renderLogs() {
  logsBody.textContent = "";

  if (logs.length === 0) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 5;
    cell.textContent = "暂无记录。";
    row.append(cell);
    logsBody.append(row);
    return;
  }

  logs.slice(0, 300).forEach((log) => {
    const row = document.createElement("tr");

    const timeCell = document.createElement("td");
    timeCell.textContent = log.localTime || formatLogTime(log.openedAt);

    const siteCell = document.createElement("td");
    siteCell.textContent = log.site || log.host || "";

    const typeCell = document.createElement("td");
    const pill = document.createElement("span");
    pill.className = `pill ${log.accessType === "allowed" ? "allowed" : ""}`;
    pill.textContent = WPM.getLogTypeText(log);
    typeCell.append(pill);

    const reasonCell = document.createElement("td");
    reasonCell.className = "reason";
    reasonCell.textContent = log.reason || "";

    const urlCell = document.createElement("td");
    urlCell.className = "url";
    urlCell.textContent = log.url || "";

    row.append(timeCell, siteCell, typeCell, reasonCell, urlCell);
    logsBody.append(row);
  });
}

async function saveSettings() {
  settings = WPM.normalizeSettings({
    allowPolicyEnabled: allowPolicyEnabledInput.checked,
    blockPolicyEnabled: blockPolicyEnabledInput.checked,
    sites: sitesInput.value.split(/\r?\n/),
    schedules: settings.schedules,
    blockedSchedules: settings.blockedSchedules,
    passMinutes: Number(passMinutesInput.value),
    recordAllowed: recordAllowedInput.checked
  });

  await chrome.storage.local.set({ settings });
  renderAll();
  showStatus("已保存。");
}

function addSchedule(kind) {
  const config = getScheduleConfig(kind);
  const days = [...config.dayGrid.querySelectorAll("input:checked")].map((input) => Number(input.value));
  const start = config.startInput.value;
  const end = config.endInput.value;

  if (days.length === 0) {
    showStatus("请选择星期。");
    return;
  }

  if (!WPM.isTimeString(start) || !WPM.isTimeString(end)) {
    showStatus("请选择有效时间。");
    return;
  }

  config.setSchedules([
    ...config.schedules,
    {
      id: WPM.createId("schedule"),
      days,
      start,
      end
    }
  ]);

  renderSchedules(kind);
  showStatus("时间段已添加，记得保存。");
}

async function clearLogs() {
  if (!confirm("清空所有访问日志？")) {
    return;
  }

  logs = [];
  await chrome.storage.local.set({ logs });
  renderLogs();
}

function exportLogs(format) {
  const date = new Date().toISOString().slice(0, 10);

  if (format === "json") {
    downloadFile(`web-page-monitor-logs-${date}.json`, JSON.stringify(logs, null, 2), "application/json");
    return;
  }

  const header = [
    "openedAt",
    "localTime",
    "site",
    "host",
    "accessType",
    "policyState",
    "blockReason",
    "durationMinutes",
    "reason",
    "url"
  ];
  const rows = logs.map((log) => header.map((key) => csvEscape(log[key] ?? "")).join(","));
  downloadFile(`web-page-monitor-logs-${date}.csv`, [header.join(","), ...rows].join("\n"), "text/csv");
}

function getScheduleConfig(kind) {
  if (kind === "block") {
    return {
      schedules: settings.blockedSchedules,
      setSchedules: (nextSchedules) => {
        settings.blockedSchedules = nextSchedules;
      },
      list: blockedScheduleList,
      count: blockedCount,
      dayGrid: blockedDayGrid,
      startInput: blockedStartInput,
      endInput: blockedEndInput
    };
  }

  return {
    schedules: settings.schedules,
    setSchedules: (nextSchedules) => {
      settings.schedules = nextSchedules;
    },
    list: allowScheduleList,
    count: allowCount,
    dayGrid: allowDayGrid,
    startInput: allowStartInput,
    endInput: allowEndInput
  };
}

function getPolicyBadgeClass(state) {
  if (state === "allow_and_block") {
    return "both";
  }

  if (state === "block_only") {
    return "block";
  }

  if (state === "disabled") {
    return "disabled";
  }

  return "";
}

function getPolicyBadgeText(state) {
  if (state === "allow_and_block") {
    return "双规则生效";
  }

  if (state === "allow_only") {
    return "允许规则生效";
  }

  if (state === "block_only") {
    return "禁止规则生效";
  }

  return "未启用";
}

function getPolicySummary(state) {
  if (state === "allow_and_block") {
    return "当前规则：不在允许时间段内，或处于禁止时间段内，都需要填写原因。";
  }

  if (state === "allow_only") {
    return "当前规则：只有允许时间段内可以直接打开，其他时间需要填写原因。";
  }

  if (state === "block_only") {
    return "当前规则：禁止时间段内需要填写原因，其他时间直接打开。";
  }

  return "当前规则：时间限制未启用，受控网站会直接打开。";
}

function showStatus(message) {
  saveStatus.textContent = message;
  window.clearTimeout(showStatus.timer);
  showStatus.timer = window.setTimeout(() => {
    saveStatus.textContent = "";
  }, 2600);
}

function downloadFile(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function csvEscape(value) {
  const text = String(value).replace(/\r?\n/g, " ");
  return `"${text.replace(/"/g, '""')}"`;
}

function formatLogTime(value) {
  if (!value) {
    return "";
  }

  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}
