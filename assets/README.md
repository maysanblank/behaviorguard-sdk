# assets/

Images used by the top-level `README.md`.

| File | Used for | Status |
|---|---|---|
| `banner.svg` | Header banner at the top of the README | present |
| `demo-enroll.png` | Screenshot: enrollment phase ("the model is learning the owner") | to capture |
| `demo-low.png` | Screenshot: a LOW verdict (ALLOW_SESSION) with the status panel | to capture |
| `demo-stepup.png` | Screenshot: a HIGH verdict raising the built-in step-up dialog | to capture |

## How to capture the three screenshots

Mirror Anubee's `detector-clean / detector-compromised` idea: one shot per state.

1. Serve the demo from the repo root (so `dist/` is served too):
   ```
   python -m http.server 8080
   ```
2. Open `http://localhost:8080/demo/arunika/` and sign up as a new user.
3. **demo-enroll.png** - during the first sessions, capture the status panel showing the
   model is still learning.
4. **demo-low.png** - after enrollment, behave normally and capture a LOW / ALLOW_SESSION verdict.
5. **demo-stepup.png** - hand the keyboard to someone else (or type very differently) until a
   HIGH verdict fires and the step-up dialog appears; capture that.

Save them here as PNG, then add a `## Screenshots` section to the README embedding all three.
