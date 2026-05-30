# Privacy

Web Page Monitor stores all data locally in the browser through `chrome.storage.local`.

The extension records:

- configured monitored domains
- configured allow/block time windows
- temporary access passes
- access logs containing time, site, URL, reason, policy state, and pass duration

The extension does not:

- upload data to any server
- use analytics
- make external network requests
- sell or share data

The extension requests broad `http://*/*` and `https://*/*` host permissions so it can detect visits to user-configured monitored domains. Only domains listed in the settings are acted on.
