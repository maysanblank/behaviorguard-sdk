# Demos

Two demo sites, both in backend mode (the recommended deployment: the profile and the
decisions on the site's own server). Each runs its own Flask server; `pip install flask` first.

| Folder | What it shows | Run |
|---|---|---|
| [`arunika/`](arunika/) | **Main demo.** A bank with sign-up, transfers, the step-up, a second-laptop takeover and a presenter panel | `python demo/arunika/server.py` |
| [`shop-checkout/`](shop-checkout/) | A plain shop with its own backend; BehaviorGuard installed with one line in the backend and one in the page (the install GIF) | `python demo/shop-checkout/shop.py` |

Both have tests that drive the real backend: `python demo/arunika/test_server.py` and
`python demo/shop-checkout/test_install.py`.

The earlier local-mode demos (three plug-and-play shops, the outside monitor, the attack
simulator) are kept in [research/legacy-demos/](../research/legacy-demos/).
