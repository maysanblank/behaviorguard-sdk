# BehaviorGuard browser extension (MV3, experimental)

The same engine as the SDK, packaged as a Chrome extension so you can try it on sites you do
not control. It is a research companion to the library, not the product: a site integrates
the SDK; the extension is for exploring how the engine behaves on your own browsing.

- `core/`, `behaviorguard.js`, `storage.js` are **copies of `sdk/`**, refreshed by
  `tools/sync_core.ps1`. CI fails if they drift (`sync` job). Edit `sdk/`, never these.
- `content.js` attaches the SDK's capture (`core/capture.js`) to each page. Typed characters
  are replaced by per-page tokens before anything leaves the page.
- `background.js` keeps one model per origin and scores 30-second windows through the real
  orchestrator.
- `popup.html` shows enrollment progress and the last verdict for the current site.

There is no step-up inside an extension, so a `HIGH` verdict shows a notice, not a lock.

## Load it

1. `chrome://extensions` -> turn on **Developer mode**.
2. **Load unpacked** -> pick this `extension/` folder.
3. Browse normally; open the popup to watch enrollment on the current site.

The extension asks for `<all_urls>` because it captures on every site. Nothing is sent
anywhere: scoring and storage stay in the browser.
