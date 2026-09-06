# 💠 TizenTube for Windows

**TizenTube for Windows** is an application that brings the official **YouTube on TV (Leanback)** experience with full **TizenTube ad-blocking, SponsorBlock, and DeArrow** capabilities to Windows PCs and HTPCs, featuring full **gamepad / controller navigation**, living room display management, and a quick-settings overlay.

---

## ✨ Features

- 🛑 **Ad-Free YouTube TV**: Blocks video advertisements, banners, and promos using the official TizenTube engine.
- ⏭️ **SponsorBlock Support**: Automatically skips sponsored segments, intros, outros, and interaction reminders.
- 🔺 **DeArrow Integration**: Replaces clickbait thumbnails and titles with clear, community-submitted summaries.
- 🎮 **Full Controller Support**: Navigate smoothly with Xbox (XInput), PlayStation (DualShock 4 / DualSense), Switch Pro, and generic DirectInput controllers.
- 📳 **Haptic Vibration Feedback**: Native Windows XInput rumble for Xbox / 8BitDo controllers (and dual-rumble fallback for PlayStation/Switch Pro pads) with tactile feedback on button presses, stick movement, and connection.
- 🖥️ **Smart Living Room Mode**: Borderless fullscreen by default, mouse cursor auto-hides during controller navigation or inactivity, and screensaver/display sleep is prevented during playback.
- ⚙️ **In-App Quick Settings Overlay**: Press `Start` / `Menu` (or `F2`) at any time to open a visual controller tester, calibrate analog stick deadzones, adjust repeat delays, and toggle features.
- 🔄 **Auto-Updating Script Engine**: Bundles an offline-ready script with automatic online checks for new TizenTube updates.
- 🔒 **Clean Sign-In**: Uses native YouTube on TV device linking (`youtube.com/activate`), bypassing Google's anti-embedded-browser OAuth blocks while persistently preserving login cookies and history.

---

## 🎮 Controller Layout

| Controller Input | YouTube on TV Action | Notes |
| :--- | :--- | :--- |
| **D-Pad (Up / Down / Left / Right)** | Navigate Grid & Menus | Smooth discrete navigation |
| **Left Analog Stick** | Navigate Grid & Menus | Calibrated deadzone & continuous repeat |
| **A / Cross (Button 0)** | Select / Enter | Opens videos, selects buttons |
| **B / Circle (Button 1)** | Back / Escape | Returns to previous screen / menu |
| **X / Square (Button 2)** | Play / Pause | Toggles video playback |
| **Y / Triangle (Button 3)** | Search | Opens the search screen |
| **Left Bumper / LB (Button 4)** | Seek Backward | Sends Left; seeks while the player is open |
| **Right Bumper / RB (Button 5)** | Seek Forward | Sends Right; seeks while the player is open |
| **Start / Menu (Button 9)** | Open / Close Settings HUD | Live controller tester & calibration |
| **View / Back (Button 8)** | Toggle Fullscreen | Switch between fullscreen and windowed |

The D-Pad (buttons 12–15) is wired directly to directional navigation with key
repeat and is not remappable. Every other button above can be reassigned in
`config.json`.

Inside the settings overlay the controller drives the overlay itself: D-Pad or
stick to move between controls, Left/Right to adjust sliders and toggles, **A**
to activate, **B** or **Start** to close.

---

## ⌨️ Keyboard Shortcuts

- `F11`: Toggle Fullscreen
- `F2`: Toggle In-App Quick Settings Overlay
- `F5`: Reload Application / Webpage
- `Arrow Keys`: Navigate UI
- `Enter`: Select
- `Esc` or `Backspace`: Go Back
- `Space`: Play / Pause

---

## 🚀 Running & Building

### Pre-Built Binaries
The following binaries have been generated in the `dist/` directory:
- **Portable**: `dist/TizenTube-1.0.0-portable.exe` (Run immediately from any folder or USB drive)
- **Installer**: `dist/TizenTube-1.0.0-win-x64.exe` (Standard Windows setup installer)
- **Unpacked**: `dist/win-unpacked/TizenTube.exe` (Direct executable folder)

### Development Commands
```bash
# Run in development mode
npm start

# Build unpacked directory
npm run pack

# Build both installer and portable executables
npm run dist
```

---

## ⚙️ Configuration

Custom settings and button bindings are automatically saved to:
```
%APPDATA%\tizentube-windows\config.json
```
You can edit this file directly or use the in-app overlay (`Start` / `Menu` or `F2`) to configure:
- **Deadzone**: Threshold to filter stick drift (default: `0.25`).
- **Repeat Interval**: Milliseconds between repeated inputs when holding a direction (default: `110ms`).
- **Controller Vibration**: Enable or disable controller tactile haptic feedback (default: `true`).
- **Auto-Hide Cursor**: Whether to automatically hide the mouse cursor (default: `true`).
- **Prevent Display Sleep**: Keep screen awake during playback (default: `true`).
- **Auto-Update Script**: Fetch the pinned TizenTube release from the CDN (default: `true`).

---

## 📺 Video Quality / 4K

Two things decide the maximum resolution YouTube's TV app will serve, and both
are now configured for 4K by default:

**1. The User-Agent.** YouTube picks a format ladder from the device it thinks it
is talking to. Measured against the same 4K video on the same machine:

| `userAgentProfile` | Ladder offered |
| :--- | :--- |
| `ps4` **(default)** | `2160p60, 1440p60, 1080p60, 720p60, 480p, 360p, 240p` |
| `tizen-legacy` | `720p, 480p, 360p, 240p` — hard capped |
| Android TV | redirects away from Leanback, unusable |

Set `system.userAgentProfile` to `ps4`, `cobalt`, `lg-webos`, `tizen-legacy`, or
`custom` (with your own string in `system.userAgent`).

**2. The viewport.** The app requests a stream sized to the player's CSS-pixel
box, so Windows display scaling used to cost you resolution — a 4K panel at 150%
scaling reports as 2560×1440. The app now runs with
`--force-device-scale-factor=1` and renders at the panel's native resolution.

**Run fullscreen for 4K.** Windowed, the player box is small enough that YouTube
drops to a lower rung regardless of the User-Agent.

Per-video quality can be forced from the userscript's own menu at
**Settings → Video Player → Preferred Video Quality** (Auto / 2160p … 144p), with
**Preferred Video Codec** alongside it (any / VP9 / AV1 / AVC1). Note that
setting anything other than *Auto* pins the player to exactly that rung.

---

## 🔒 Userscript Integrity Pinning

The TizenTube userscript is executed with full Node privileges, so it is **pinned
to an exact release and verified by SHA-256** before it is written to disk or
run. Three settings control this:

```jsonc
"tizentube": {
  "scriptVersion":  "1.14.8",
  "scriptSha256":   "0b535d9a870f9905a8b9d399d92453cb463ff35d1a9750b8f6cbe6ee60306108",
  "cdnUrlTemplate": "https://cdn.jsdelivr.net/npm/@foxreis/tizentube@{version}/dist/userScript.js"
}
```

- A download whose digest does not match is **rejected and never written**.
- The cached copy is re-hashed on every launch; a mismatch is renamed to
  `tizentube-cached.js.rejected` and the bundled build is used instead.
- The shipped bundle is byte-identical to the pinned release, so a stock install
  makes no network request for the script at all.

### Moving to a newer TizenTube release

```bash
npm run pin-script -- 1.14.9   # a specific version
npm run pin-script -- latest   # whatever npm currently tags latest
npm run pin-script             # re-download and re-verify the current pin
```

This downloads the release, replaces `src/scripts/tizentube-bundle.js`, and
updates `scriptVersion` / `scriptSha256` in `src/main/config.js` together, so
the bundle and the pin cannot drift apart. Editing `scriptVersion` by hand
without the matching digest will fail verification — which is the point.

---

## 🔐 How to Sign In

1. Open **TizenTube**.
2. Navigate to the left sidebar and select **Sign in**.
3. YouTube will display a short code and instruction: *"Go to youtube.com/activate on your phone or computer and enter this code"*.
4. Open the link on your phone/browser, enter the code, and select your account.
5. Your account, watch history, subscriptions, and playlists will instantly sync to the app!

---

## 📜 Licence & Attribution

This project is licensed under the **GNU General Public License v3.0 only** — see
[LICENSE](LICENSE).

It is **not a fork of TizenTube**. All code under `src/main`, `src/preload` and
`src/renderer` is original to this repository. It does, however, **redistribute one
third-party work**:

> `src/scripts/tizentube-bundle.js` is the unmodified `dist/userScript.js` build of
> [**TizenTube**](https://github.com/reisxd/TizenTube) `v1.14.8` by **Reis Can**
> (npm `@foxreis/tizentube`), licensed **GPL-3.0-only**.
> SHA-256 `0b535d9a870f9905a8b9d399d92453cb463ff35d1a9750b8f6cbe6ee60306108`.

Because that script is loaded and executed inside this application's own process,
the combined work is distributed under GPL-3.0-only. If you publish binaries built
from this repository, GPL-3.0 §6 requires you to make the corresponding source
available too.

All the ad-blocking, SponsorBlock and DeArrow behaviour comes from TizenTube.
Please consider [sponsoring the upstream author](https://github.com/sponsors/reisxd).

See [NOTICE.md](NOTICE.md) for full attribution, trademark notes and disclaimers.

**Unaffiliated:** this project is not endorsed by or connected to Google LLC,
YouTube, Samsung, the Tizen project, or the TizenTube project.
