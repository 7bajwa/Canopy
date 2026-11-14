# Building Canopy

All builds run the same editor from the `dist` folder, so a fix reaches every device after a build. Finished
builds go into `release/v0.NN/` (the version from `package.json`, now v0.47), one folder each:

| Build | Command | Result |
|---|---|---|
| Website | `npm run web:build` | `release/v0.47/Web/` and `release/web/` (published) |
| Windows | `npm run pc:build` | `release/v0.47/Win/Canopy-win32-x64/Canopy.exe` — copy the whole folder |
| Android (test) | `npm run android:build` | `release/v0.47/Apk/Canopy-v0.47.apk` |

`npm run docs` rewrites the node reference (`public/docs/index.html`); the website and Windows builds do it too.

## Publishing the website on GitHub Pages

This folder is the repository `7bajwa/Canopy` (source code). `npm run web:build` also copies the site into
`release/web/`, which is committed; `.github/workflows/pages.yml` publishes that folder on every push to `main`
(**Settings → Pages → Source: GitHub Actions**). The site is at `https://7bajwa.github.io/Canopy/`.

Each version: build, commit, tag `v0.NN`, push with tags. The Windows zip and APK go on a GitHub Release for that tag
(they are too big for git).

On an https address the editor also installs from the browser's menu and works offline.

## Phone or tablet over Wi-Fi (no install)

1. Connect the computer and the device to the same Wi-Fi.
2. Run `npm run build` and then `npm run serve:lan`.
3. Open the printed `Network:` address (such as `http://192.168.1.20:4173/`) in Chrome on the device.
4. If nothing loads, allow Node.js through the Windows firewall for private networks.

## Windows

`npm run pc:build`, then open `release/v0.47/Win/Canopy-win32-x64/Canopy.exe`. The first build downloads Electron
(about 100 MB).

## Android

The Android tools are set up on this computer (Android SDK 35 and Java 21). `npm run android:build` makes the
test app in `release/v0.47/Apk/Canopy-v0.47.apk`. Copy it to the device and open it (allow installs from this
source), or with USB debugging on run `adb install` with its path. A store release needs a signing key, which is a
separate step.

## AI control

See `ai/README.md`: an MCP server lets an AI assistant build plants in the Windows app when it's turned on in
Settings → Developer.

## Versions

Raise the middle number of `version` in `package.json` (and `versionName`/`versionCode` in `android/app/build.gradle`) for each new round of changes; the builds then land in a new `release/v0.NN` folder and older ones stay as they were.
