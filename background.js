importScripts("shared.js");

const DEFAULT_STATE = {
  accessPasses: {},
  logs: []
};

const LOG_LIMIT = 1000;
const REDIRECT_COOLDOWN_MS = 1200;
const ALLOWED_RECORD_COOLDOWN_MS = 60 * 1000;

const redirectCooldown = new Map();
const allowedRecordCooldown = new Map();

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.local.get(["settings", "accessPasses", "logs"]);
  const updates = {};

  if (!stored.settings) {
    updates.settings = WPM.DEFAULT_SETTINGS;
  }

  if (!stored.accessPasses) {
    updates.accessPasses = DEFAULT_STATE.accessPasses;
  }

  if (!stored.logs) {
    updates.logs = DEFAULT_STATE.logs;
  }

  if (Object.keys(updates).length > 0) {
    await chrome.storage.local.set(updates);
  }
});

chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage();
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url) {
    void inspectNavigation(tabId, changeInfo.url);
    return;
  }

  if (changeInfo.status === "loading" && tab.url) {
    void inspectNavigation(tabId, tab.url);
  }
});

chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId !== 0) {
    return;
  }

  void inspectNavigation(details.tabId, details.url);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "requestAccess") {
    void handleAccessRequest(message, sender).then(sendResponse);
    return true;
  }

  if (message?.type === "getDecisionPreview") {
    void getDecisionPreview(message.targetUrl).then(sendResponse);
    return true;
  }

  return false;
});

async function inspectNavigation(tabId, url) {
  const decision = await getDecision(url);

  if (!decision.shouldBlock) {
    if (decision.shouldRecordAllowed && shouldRecordAllowedVisit(tabId, decision.site, url)) {
      await addLog({
        site: decision.site,
        host: decision.host,
        url,
        reason: "",
        accessType: "allowed",
        policyState: decision.policyState,
        durationMinutes: 0
      });
    }

    return;
  }

  if (!shouldRedirect(tabId, decision.site)) {
    return;
  }

  const blockedUrl = chrome.runtime.getURL(
    `blocked.html?target=${encodeURIComponent(url)}&site=${encodeURIComponent(decision.site)}`
  );

  await chrome.tabs.update(tabId, { url: blockedUrl });
}

async function getDecisionPreview(targetUrl) {
  const decision = await getDecision(targetUrl);

  return {
    ok: true,
    site: decision.site,
    host: decision.host,
    isMonitored: decision.isMonitored,
    isWithinSchedule: decision.isWithinSchedule,
    isInsideBlockedWindow: decision.isInsideBlockedWindow,
    allowPolicyEnabled: decision.allowPolicyEnabled,
    blockPolicyEnabled: decision.blockPolicyEnabled,
    policyState: decision.policyState,
    blockReason: decision.blockReason,
    blockReasons: decision.blockReasons,
    nextWindow: decision.nextWindow,
    nextBlockedWindow: decision.nextBlockedWindow,
    blockedUntil: decision.blockedUntil,
    policyLabel: decision.policyLabel
  };
}

async function getDecision(url) {
  const parsedUrl = WPM.parseHttpUrl(url);

  if (!parsedUrl) {
    return { shouldBlock: false, shouldRecordAllowed: false, isMonitored: false };
  }

  const { settings, accessPasses } = await getSettingsAndPasses();
  const site = WPM.findMatchingSite(parsedUrl.hostname, settings.sites);

  if (!site) {
    return { shouldBlock: false, shouldRecordAllowed: false, isMonitored: false };
  }

  const scheduleState = WPM.getScheduleState(settings);
  const pass = accessPasses[site];
  const hasActivePass = pass?.expiresAt && pass.expiresAt > Date.now();

  return {
    shouldBlock: scheduleState.isBlocked && !hasActivePass,
    shouldRecordAllowed: Boolean(settings.recordAllowed && !scheduleState.isBlocked),
    isMonitored: true,
    isWithinSchedule: scheduleState.isWithinSchedule,
    isInsideBlockedWindow: scheduleState.isInsideBlockedWindow,
    allowPolicyEnabled: settings.allowPolicyEnabled,
    blockPolicyEnabled: settings.blockPolicyEnabled,
    policyState: scheduleState.policyState,
    blockReason: scheduleState.blockReasons[0] || "",
    blockReasons: scheduleState.blockReasons,
    nextWindow: scheduleState.nextWindow,
    nextBlockedWindow: scheduleState.nextBlockedWindow,
    blockedUntil: scheduleState.blockedUntil,
    policyLabel: scheduleState.policyLabel,
    site,
    host: WPM.normalizeHost(parsedUrl.hostname)
  };
}

async function handleAccessRequest(message, sender) {
  const targetUrl = String(message.targetUrl || "");
  const reason = String(message.reason || "").trim();
  const durationMinutes = WPM.clampNumber(Number(message.durationMinutes), 1, 60, WPM.DEFAULT_SETTINGS.passMinutes);
  const parsedUrl = WPM.parseHttpUrl(targetUrl);

  if (!parsedUrl) {
    return { ok: false, error: "目标地址无效。" };
  }

  if (reason.length < 2) {
    return { ok: false, error: "请写下打开原因。" };
  }

  const { settings, accessPasses } = await getSettingsAndPasses();
  const site = WPM.findMatchingSite(parsedUrl.hostname, settings.sites);

  if (!site) {
    return { ok: false, error: "这个网站不在受控列表中。" };
  }

  const decision = await getDecision(targetUrl);
  const expiresAt = Date.now() + durationMinutes * 60 * 1000;
  accessPasses[site] = {
    expiresAt,
    reason,
    createdAt: new Date().toISOString()
  };

  await chrome.storage.local.set({ accessPasses });

  await addLog({
    site,
    host: WPM.normalizeHost(parsedUrl.hostname),
    url: targetUrl,
    reason,
    accessType: "manual_release",
    policyState: WPM.getPolicyState(settings),
    blockReason: decision.blockReasons?.join("+") || decision.blockReason || "",
    durationMinutes
  });

  if (sender.tab?.id) {
    await chrome.tabs.update(sender.tab.id, { url: targetUrl });
  }

  return { ok: true, expiresAt };
}

async function getSettingsAndPasses() {
  const stored = await chrome.storage.local.get(["settings", "accessPasses"]);
  const settings = WPM.normalizeSettings(stored.settings || WPM.DEFAULT_SETTINGS);
  const accessPasses = removeExpiredPasses(stored.accessPasses || {});

  if (JSON.stringify(accessPasses) !== JSON.stringify(stored.accessPasses || {})) {
    await chrome.storage.local.set({ accessPasses });
  }

  return { settings, accessPasses };
}

async function addLog(entry) {
  const stored = await chrome.storage.local.get(["logs"]);
  const logs = Array.isArray(stored.logs) ? stored.logs : [];
  logs.unshift({
    id: WPM.createId("log"),
    openedAt: new Date().toISOString(),
    localTime: WPM.formatLocalDateTime(new Date()),
    ...entry
  });

  await chrome.storage.local.set({ logs: logs.slice(0, LOG_LIMIT) });
}

function removeExpiredPasses(accessPasses) {
  const now = Date.now();
  return Object.fromEntries(
    Object.entries(accessPasses).filter(([, pass]) => pass?.expiresAt && pass.expiresAt > now)
  );
}

function shouldRedirect(tabId, site) {
  const key = `${tabId}:${site}`;
  const now = Date.now();
  const lastRedirectAt = redirectCooldown.get(key) || 0;

  if (now - lastRedirectAt < REDIRECT_COOLDOWN_MS) {
    return false;
  }

  redirectCooldown.set(key, now);
  return true;
}

function shouldRecordAllowedVisit(tabId, site, url) {
  const key = `${tabId}:${site}:${url}`;
  const now = Date.now();
  const lastRecordedAt = allowedRecordCooldown.get(key) || 0;

  if (now - lastRecordedAt < ALLOWED_RECORD_COOLDOWN_MS) {
    return false;
  }

  allowedRecordCooldown.set(key, now);
  return true;
}
