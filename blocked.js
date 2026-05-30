const params = new URLSearchParams(window.location.search);
const targetUrl = params.get("target") || "";
const site = params.get("site") || "";

const policyLabel = document.querySelector("#policyLabel");
const siteName = document.querySelector("#siteName");
const targetUrlEl = document.querySelector("#targetUrl");
const nextWindowEl = document.querySelector("#nextWindow");
const accessForm = document.querySelector("#accessForm");
const reasonInput = document.querySelector("#reason");
const durationInput = document.querySelector("#duration");
const errorMessage = document.querySelector("#errorMessage");
const stayButton = document.querySelector("#stayButton");

siteName.textContent = site ? `${site} 现在需要记录原因` : "这个网站现在需要记录原因";
targetUrlEl.textContent = targetUrl;

chrome.runtime.sendMessage({ type: "getDecisionPreview", targetUrl }, (response) => {
  if (!response?.ok) {
    return;
  }

  policyLabel.textContent = response.policyLabel || "非计划访问";

  const blockReasons = Array.isArray(response.blockReasons)
    ? response.blockReasons
    : [response.blockReason].filter(Boolean);
  const isOutsideAllowed = blockReasons.includes("outside_allowed");
  const isInsideBlocked = blockReasons.includes("inside_blocked");

  if (isOutsideAllowed && isInsideBlocked) {
    siteName.textContent = site ? `${site} 同时命中两个时间限制` : "当前同时命中两个时间限制";
    nextWindowEl.textContent = [
      "当前不在允许时间内，并且处于禁止时间段。",
      response.nextWindow?.label ? `下一次允许时间：${response.nextWindow.label}` : "",
      response.blockedUntil?.label ? `本次禁止到：${response.blockedUntil.label}` : ""
    ].filter(Boolean).join(" ");
    return;
  }

  if (isInsideBlocked) {
    siteName.textContent = site ? `${site} 当前处于禁止时间段` : "当前处于禁止时间段";
    nextWindowEl.textContent = response.blockedUntil?.label
      ? `本次禁止到：${response.blockedUntil.label}`
      : "当前禁止时间段内需要填写原因。";
    return;
  }

  siteName.textContent = site ? `${site} 现在不在允许时间内` : "这个网站现在不在允许时间内";
  nextWindowEl.textContent = response.nextWindow?.label
    ? `下一次允许时间：${response.nextWindow.label}`
    : "当前没有可直接访问的允许时间段。";
});

accessForm.addEventListener("submit", (event) => {
  event.preventDefault();

  const reason = reasonInput.value.trim();

  if (reason.length < 2) {
    showError("请写下打开原因。");
    reasonInput.focus();
    return;
  }

  setBusy(true);
  showError("");

  chrome.runtime.sendMessage(
    {
      type: "requestAccess",
      targetUrl,
      reason,
      durationMinutes: Number(durationInput.value)
    },
    (response) => {
      setBusy(false);

      if (chrome.runtime.lastError) {
        showError(chrome.runtime.lastError.message);
        return;
      }

      if (!response?.ok) {
        showError(response?.error || "无法打开，请稍后再试。");
      }
    }
  );
});

stayButton.addEventListener("click", () => {
  window.location.replace("about:blank");
});

function showError(message) {
  errorMessage.textContent = message;
}

function setBusy(isBusy) {
  for (const element of accessForm.elements) {
    element.disabled = isBusy;
  }
}
