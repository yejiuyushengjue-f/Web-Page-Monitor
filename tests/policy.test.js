const assert = require("node:assert/strict");
const WPM = require("../shared.js");

const monday1900 = new Date("2026-06-01T19:00:00");
const monday2030 = new Date("2026-06-01T20:30:00");
const monday2230 = new Date("2026-06-01T22:30:00");
const tuesday0700 = new Date("2026-06-02T07:00:00");

function settings(overrides = {}) {
  return WPM.normalizeSettings({
    ...WPM.DEFAULT_SETTINGS,
    ...overrides
  });
}

{
  const result = WPM.getScheduleState(settings(), monday2030);
  assert.equal(result.isBlocked, false);
  assert.equal(result.isWithinSchedule, true);
}

{
  const result = WPM.getScheduleState(settings(), monday1900);
  assert.equal(result.isBlocked, true);
  assert.deepEqual(result.blockReasons, ["outside_allowed"]);
}

{
  const result = WPM.getScheduleState(
    settings({
      allowPolicyEnabled: false,
      blockPolicyEnabled: true,
      blockedSchedules: [{ id: "night", days: [1], start: "22:00", end: "08:00" }]
    }),
    tuesday0700
  );
  assert.equal(result.isBlocked, true);
  assert.deepEqual(result.blockReasons, ["inside_blocked"]);
  assert.equal(result.blockedUntil.label, "周二 08:00");
}

{
  const result = WPM.getScheduleState(
    settings({
      allowPolicyEnabled: true,
      blockPolicyEnabled: true,
      schedules: [{ id: "evening", days: [1], start: "20:00", end: "21:00" }],
      blockedSchedules: [{ id: "focus", days: [1], start: "20:15", end: "20:45" }]
    }),
    monday2030
  );
  assert.equal(result.isBlocked, true);
  assert.deepEqual(result.blockReasons, ["inside_blocked"]);
}

{
  const result = WPM.getScheduleState(
    settings({
      allowPolicyEnabled: false,
      blockPolicyEnabled: false
    }),
    monday2230
  );
  assert.equal(result.isBlocked, false);
  assert.equal(result.policyState, "disabled");
}

{
  const sites = WPM.normalizeSites([" https://www.youtube.com/watch?v=1 ", "*.bilibili.com"]);
  assert.deepEqual(sites, ["youtube.com", "bilibili.com"]);
  assert.equal(WPM.findMatchingSite("m.youtube.com", sites), "youtube.com");
  assert.equal(WPM.findMatchingSite("example.com", sites), null);
}

console.log("Policy tests passed.");
