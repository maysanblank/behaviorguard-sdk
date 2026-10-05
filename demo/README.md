# Demos

To protect a website you only need `dist/behaviorguard.min.js`. Everything in this folder is a
demo site to try it on; none of it is part of the library.

| Folder | What it shows | UI language |
|---|---|---|
| [`arunika/`](arunika/) | **Main demo.** A bank with sign-up, transfers, the step-up and a presenter panel | English |
| [`shop-checkout/`](shop-checkout/) | A shop with its own Flask backend; BehaviorGuard plugged in after login (the install GIF) | Indonesian |
| [`shop-multipage/`](shop-multipage/), [`shop-spa/`](shop-spa/), [`shop-react/`](shop-react/) | The same two pasted lines on three architectures (this guide, below) | Indonesian |
| [`monitor/`](monitor/) + [`plain-site/`](plain-site/) | A shop with zero BehaviorGuard code, scored from the outside | Indonesian |
| [`attack_sim.html`](attack_sim.html) | Four automated attacks: paste replay, speed bot, minimal mouse, mimicry | Indonesian |
| [`accuracy-lab/`](accuracy-lab/) | Label your own sessions as owner or other and export the results as CSV | Indonesian |

Start everything from the repo root with `python -m http.server 8080` (the shop-checkout demo
runs its own Flask server; see its README).

---

## Plug-and-play guide - three sites, three architectures

Step by step: install BehaviorGuard **live, in front of an audience**, on three sites with
different architectures.

None of the three sites **contains BehaviorGuard yet** - on purpose. The audience sees a plain site,
then sees you paste two lines, then sees the system come alive.

| Folder | Shop | Architecture | What it proves |
|---|---|---|---|
| `shop-multipage/` | Toko Kopi Nusantara | multi-page HTML, no framework | real page-to-page navigation |
| `shop-spa/` | Pasar Loka | vanilla SPA, History API | `pushState` - zero reloads |
| `shop-react/` | Butik Rasa | React 18 | a framework with its own synthetic events |

**All three have their own account system**: sign up, log in, log out. Before logging in, the whole
shop is locked. This matters for the demo - the story starts from **signing up a new account**, not
from an account that came from nowhere.

(The shop UIs are in Indonesian: *Masuk* = log in, *Daftar* = sign up, *Keluar* = log out,
*Keranjang* = cart, *Bayar* = pay.)

For a site with its own backend and a checkout that gets gated, see
[shop-checkout/](shop-checkout/).

---

## 0. Setup

### 0.1 Start the server

From the repo root (not from inside `demo/` - the sites load `../../dist/`, so `dist/` must be
served too):

```bash
python -m http.server 8080
```

Leave that window open for the whole demo.

### 0.2 Check the three sites are up

- <http://localhost:8080/demo/shop-multipage/index.html>
- <http://localhost:8080/demo/shop-spa/>
- <http://localhost:8080/demo/shop-react/>

All three go straight to a **log in / sign up** screen because there is no account yet.

### 0.3 Keep these two lines in a text editor

**This is the only thing you paste during the demo, identical on all three sites:**

```html
<script>window.BehaviorGuardConfig = { userId: window.penggunaAktif && window.penggunaAktif.email, panel: true };</script>
<script src="../../dist/behaviorguard.js" defer></script>
```

**The first line** tells BehaviorGuard who is logged in - just like a real application, which always
knows its user. All three sites already publish the active account through `window.penggunaAktif`
("active user"), so this line is identical everywhere.

**The second line** loads the library. That is all.

---

## 1. First site - Toko Kopi Nusantara (multi-page)

### Step 1.1 · Show the site is still plain

Open <http://localhost:8080/demo/shop-multipage/index.html>

You are redirected to the log-in page. Press **F12** -> **Console**:

```js
typeof window.BehaviorGuard
```

The result is `"undefined"`. **Talking point:** *"There is nothing on this site yet."*

### Step 1.2 · Sign up a new account (in front of the audience)

On the **sign up** tab, fill in name, email, password -> **create account**.

You land in the catalogue, with **"Halo, <your name>"** in the top right.

In the Console:

```js
window.penggunaAktif
```

You get `{email: "...", nama: "..."}`. **Talking point:** *"The site now knows who I am. That is
what BehaviorGuard uses as the identity - not a cookie, not the device."*

### Step 1.3 · Open the file in VS Code

Open `demo/shop-multipage/index.html`, press **Ctrl+G**, type `32`, Enter.

```html
30  </div></footer>
31  <script src="toko.js"></script>
32  </body>
33  </html>
```

### Step 1.4 · Paste

Click at the **end of line 31**, press **Enter**, paste the two lines. Result:

```html
30  </div></footer>
31  <script src="toko.js"></script>
32  <script>window.BehaviorGuardConfig = { userId: window.penggunaAktif && window.penggunaAktif.email, panel: true };</script>
33  <script src="../../dist/behaviorguard.js" defer></script>
34  </body>
35  </html>
```

**Ctrl+S**.

> The order matters: it must come **after** `toko.js`, because `toko.js` is what fills
> `window.penggunaAktif`.

### Step 1.5 · Reload

Browser -> **Ctrl+Shift+R**.

A panel appears in the **bottom-right corner** saying **MENGENALI...** (recognising). In the
Console:

```js
BehaviorGuard._instance.userId
```

You get the email of the account you just signed up. **Talking point:** *"Two lines. No build, no
npm install, no backend, and the identity follows the logged-in account automatically."*

### Step 1.6 · Install on the other pages

Repeat for the remaining four files. The two pasted lines are **exactly the same**:

| File | Ctrl+G to line | Paste after line |
|---|---|---|
| `masuk.html` | `35` | 34 |
| `produk.html` | `30` | 29 |
| `keranjang.html` | `32` | 31 |
| `checkout.html` | `57` | 56 |

**Talking point:** *"A multi-page site needs the tag on every page - just like Google Analytics. But
there is still one profile, because it is tied to the account."*

---

## 2. Second site - Pasar Loka (SPA)

Just **one file**, paste **once**.

### Step 2.1 · Show it really is an SPA

Open <http://localhost:8080/demo/shop-spa/> -> sign up a new account first.

After logging in, click through **shop -> cart -> pay -> about**. Show that:
- the address changes (`?r=/keranjang`, `?r=/checkout`)
- **the browser's reload icon never spins**

Every screen has a box: `rute aktif: /keranjang - tanpa muat ulang` (active route, no reload).

### Step 2.2 · Paste

Open `demo/shop-spa/index.html`, **Ctrl+End**.

```html
348  })();
349  </script>
350  </body>
351  </html>
```

Click the end of **line 349**, Enter, paste the two lines. **Ctrl+S** -> **Ctrl+Shift+R**.

### Step 2.3 · Prove `pushState` is captured

In the Console:

```js
BehaviorGuard._instance.capture.peek().filter(e => e.event_type === 'NAVIGATION').length
```

The result is `0`. Click **cart**, then **pay**, run it again -> the result is **`2`**.

**Talking point:** *"This site never reloads a page. BehaviorGuard still knows the user moved,
because it hooks `history.pushState`. This is what usually breaks on SPAs."*

---

## 3. Third site - Butik Rasa (React 18)

Just **one file**, paste **once**.

### Step 3.1 · Show it really is React

Open <http://localhost:8080/demo/shop-react/> -> sign up a new account.

In the Console: `React.version` -> `"18.3.1"`. Click a category filter - the list is re-rendered by
React components.

### Step 3.2 · Paste

Open `demo/shop-react/index.html`, **Ctrl+End**.

```html
410  })();
411  </script>
412  </body>
413  </html>
```

Click the end of **line 411**, Enter, paste. **Ctrl+S** -> **Ctrl+Shift+R**.

### Step 3.3 · Prove React interactions are captured

Click a few buttons, change a size, type in a form. Then:

```js
BehaviorGuard._instance.capture.peek().reduce((a,e)=>{a[e.event_type]=(a[e.event_type]||0)+1;return a},{})
```

You get `MOUSE_MOVE`, `MOUSE_CLICK`, `KEYSTROKE`, `FORM_FOCUS`.

**Talking point:** *"React re-renders the whole interface and uses its own synthetic events.
BehaviorGuard listens at the `document` level, so it does not care which framework it is."*

---

## 4. The whole story: from sign-up to recognised

This is the most convincing part, and its order is exactly what a real user experiences.

### What the panel shows

| Stage | Panel |
|---|---|
| Just signed up, session 1 | **MENGENALI 1/10** (recognising) + 10% bar |
| Session 5 | **MENGENALI 5/10** + 50% bar |
| Session 10 | **MENGENALI 10/10** - profile ready |
| Session 11+ | **LOW · AMAN** (safe) with the behaviour score |
| Someone else using it | **MEDIUM · WASPADA** (caution) or **HIGH · BAHAYA** (danger) |

The progress bar moves every time a session ends - so the audience sees the system **learning**, not
hanging.

### What you must do BEFORE standing in front of people

A session ends every **30 seconds**, and **10 sessions** are needed. So from a new account to the
first verdict is ≈ **5 minutes of continuous active interaction**. The audience will not wait.

**The right plan:**

1. **Before the booth:** sign up an account (e.g. `andi@tokokopi.id`), install the tag, then use the
   shop like a normal person for ~5 minutes - move the mouse, type in forms, click products, fill in
   checkout. Do not sit still; a session needs ≥100 events and ≥5 seconds.

   Watch in the Console:
   ```js
   BehaviorGuard._instance.getState().sessions.length
   ```
   Once it is ≥ 10:
   ```js
   BehaviorGuard._instance.getState().hasModel   // must be true
   ```

2. **Complete the "set up security verification" popup once.** It appears on the first LOW session
   after enrollment finishes. Type the phrase **3 times** with your normal rhythm.

   > If you skip it, no rhythm template is stored, and on a later HIGH verdict the step-up **will not
   > appear** - that is deliberate safe behaviour (an intruder must not be able to enroll their own
   > rhythm), but on stage it looks like the feature is broken.

3. **Do not log out, do not reset, do not use a private window.** The profile is stored in
   `localStorage` and survives reloads.

### During the demo: two possible stories

**Story A - "the system is learning"** (to show it from zero)
Sign up a new account in front of the audience, use the shop for ~1 minute, show the panel moving
**1/10 -> 2/10 -> 3/10**. No need to wait until 10; what matters is that progress is visible.

**Story B - "the login is legitimate, the session is not"** (with a trained account)
1. Log in with the account you trained. Use it briefly -> panel **LOW · AMAN**.
2. **Ask someone in the audience to use your mouse and keyboard** for ~30 seconds in their own style.
3. Wait for the session to end, or force it from the Console:
   ```js
   await BehaviorGuard.endSession()
   ```
4. The panel turns **MEDIUM** or **HIGH**, and the rhythm verification popup appears.
5. The audience member tries to type the phrase -> **rejected**. You type it -> **passes**.

Closing line: *"The login is legitimate. The session is not."*

### Automated attacks (optional)

<http://localhost:8080/demo/attack_sim.html> - wait ~10 seconds for seeding, click all four buttons.
All of them must be **HIGH**, and Mimicry is caught by the **ensemble**, not by the bot heuristics.

---

## 5. Running the demo again from zero

**Delete the two lines** you pasted, save, reload.

Delete only the behaviour profile (the account stays):
```js
await BehaviorGuard._instance.clear()
```

Delete everything including the account: F12 -> **Application** -> **Storage** -> **Clear site data**.

---

## 6. If something goes wrong

| Symptom | Cause & fix |
|---|---|
| No panel | The server was started from the wrong folder. It must be the repo root. |
| Console: `404 behaviorguard.js` | From `demo/<site>/` the path really is `../../dist/`. |
| `BehaviorGuard._instance.userId` = `undefined` | You are not logged in, or the config line was pasted **before** the site's script. It must come **after**. |
| `typeof window.BehaviorGuard` still `undefined` | Tag pasted after `</body>`, forgot Ctrl+S, or used F5 - use **Ctrl+Shift+R**. |
| Panel stuck at MENGENALI 0 | Too little interaction. A session needs ≥100 events and ≥5 seconds. Move the mouse and type. |
| Sessions do not increase | Same as above. Check `getState().sessions.length`. |
| No verification popup on HIGH | The rhythm template was never enrolled. Repeat section 4 item 2. |
| React site is empty | `vendor/react.js` is missing. Check `demo/shop-react/vendor/` has two files. |

---

## 7. Summary

Three architectures, **exactly the same two lines**:

```html
<script>window.BehaviorGuardConfig = { userId: window.penggunaAktif && window.penggunaAktif.email, panel: true };</script>
<script src="../../dist/behaviorguard.js" defer></script>
```

| Site | File | Ctrl+G |
|---|---|---|
| Toko Kopi | `shop-multipage/index.html` | 32 |
| | `shop-multipage/masuk.html` | 35 |
| | `shop-multipage/produk.html` | 30 |
| | `shop-multipage/keranjang.html` | 32 |
| | `shop-multipage/checkout.html` | 57 |
| Pasar Loka | `shop-spa/index.html` | Ctrl+End (349) |
| Butik Rasa | `shop-react/index.html` | Ctrl+End (411) |

Zero dependencies, zero build, zero backend, one file of ~250 KB (44 KB gzip minified).
