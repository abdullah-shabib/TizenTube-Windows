# TizenTube for Windows

YouTube's TV interface as a desktop app, driven by a game controller.

It opens `youtube.com/tv` in an Electron window, sends a TV user-agent so YouTube
serves the 10-foot Leanback UI instead of the desktop site, and injects
[TizenTube](https://github.com/reisxd/TizenTube) to strip ads and add SponsorBlock
and DeArrow. Plug in an Xbox pad and it behaves like a TV app.

The ad-blocking, SponsorBlock and DeArrow work is all TizenTube's, by
[Reis Can](https://github.com/reisxd). This project is the Windows shell around it —
controller input, display handling, and a settings overlay. If you find it useful,
[sponsor him](https://github.com/sponsors/reisxd), not me.

## Install

Download the installer or the portable build from
[Releases](https://github.com/abdullah-shabib/TizenTube-Windows/releases).

The binaries aren't code-signed, so SmartScreen will warn you on first run —
*More info* → *Run anyway*. Check your download against `SHA256SUMS.txt` first if
you'd rather not take my word for it.

To run from source:

```bash
npm install
npm start
```

`npm run dist` builds both the installer and the portable exe.

## Controls

| Button | Does |
| :--- | :--- |
| D-pad / left stick | Navigate |
| A | Select |
| B | Back |
| X | Play/pause |
| Y | Search |
| LB / RB | Seek back/forward in the player |
| Right stick up / down | Volume up / down |
| R3 (right stick click) | Mute / unmute |
| RT / LT | Volume up / down |
| Start | Settings overlay |
| Back/View | Toggle fullscreen |

The D-pad and stick both navigate, with a configurable repeat rate. Everything
except the D-pad can be remapped in `config.json` (including `VolumeUp`, `VolumeDown`,
and `VolumeMute`).

Keyboard works too: arrows, Enter, Esc, Space, `F11` fullscreen, `F2` overlay, `F5` reload,
and volume controls (`Ctrl+Up` / `Ctrl+Down`, `Ctrl+M` mute, and media keys).

The settings overlay (Start, or `F2`) has a live controller tester — useful for
checking a pad is seen at all, and for tuning stick deadzone without guessing.
It's navigable with the pad: D-pad to move, left/right to adjust sliders, A to
flip a toggle or press a button.

## Signing in

Choose **Sign in** in the sidebar. YouTube shows a short code — enter it at
[youtube.com/activate](https://youtube.com/activate) on your phone. This is the
normal TV device-linking flow, so it sidesteps Google's blocking of embedded
browsers, and the login persists.

## Getting 4K

Two things have to be right, and both are set up by default:

**The user-agent.** YouTube decides what to offer from the device it thinks it's
talking to. Measured against the same video on the same machine:

| Profile | Offered |
| :--- | :--- |
| `ps4` (default) | 2160p60 down to 240p |
| `tizen-legacy` | 720p and below, hard capped |
| Android TV | redirects to the desktop site, unusable |

Change it with `system.userAgentProfile` — `ps4`, `cobalt`, `lg-webos`,
`tizen-legacy`, or `custom` with your own string in `system.userAgent`.

**The viewport.** YouTube picks its stream from the player's size in CSS pixels,
so Windows display scaling quietly costs you resolution — a 4K panel at 150%
reports as 2560×1440. The app runs with `--force-device-scale-factor=1` to render
at the panel's real resolution.

**Run it fullscreen.** Windowed, the player is small enough that YouTube drops to
a lower rung no matter what user-agent you send.

TizenTube's own menu (**Settings → Video Player**) can force a specific quality
and codec. Note that picking anything other than *Auto* pins the player to exactly
that rung, so leave it on Auto unless you want a hard lock.

## Configuration

`%APPDATA%\tizentube-windows\config.json`, written on first run. Most of it is
reachable from the overlay; the rest is worth editing by hand:

- `controller.deadzone` — stick drift threshold, default `0.25`
- `controller.repeatIntervalMs` — navigation repeat while held, default `110`
- `controller.bindings` — per-button actions
- `controller.vibration` — rumble on button presses and navigation
- `display.autoHideCursor`, `display.preventDisplaySleep`
- `audio.volume`, `audio.muted` — playback volume level (`0.0`–`1.0`) and mute state
- `updates.autoCheck` — look for a newer app version on startup
- `system.userAgentProfile` — see above

## Updating

Two separate things update, and they work differently.

**The app** checks this project's GitHub releases on startup and downloads a
newer build in the background, then offers to restart. Choosing *Later* installs
it the next time you quit. Turn it off with `updates.autoCheck`, or from the
overlay.

This only works for the **installed** build. A portable exe cannot replace
itself while running, and a dev checkout has no release to compare against; both
skip the check and say so in the log. The installers are not code-signed, so
Windows may ask you to confirm the update.

**The bundled TizenTube userscript** does not update at runtime. It is pinned by
SHA-256 and ships inside the build, so it changes only when a new release is cut
- see below. `autoUpdateScript` controls whether a mismatched bundle may be
re-fetched, not whether the pin moves on its own.

## Userscript pinning

The bundled TizenTube script runs with full Node privileges, so it's pinned to an
exact release and checked by SHA-256 before it's written to disk or executed:

```jsonc
"scriptVersion":  "1.14.8",
"scriptSha256":   "0b535d9a870f9905a8b9d399d92453cb463ff35d1a9750b8f6cbe6ee60306108",
"cdnUrlTemplate": "https://cdn.jsdelivr.net/npm/@foxreis/tizentube@{version}/dist/userScript.js"
```

A download that doesn't match is rejected and never written. The cached copy is
re-hashed every launch and quarantined on mismatch. The bundled file *is* the
pinned release, so a normal install never fetches anything.

To move to a newer TizenTube:

```bash
npm run pin-script -- 1.14.9   # or `latest`
```

That downloads it, replaces the bundle, and updates both config fields together so
they can't drift apart. `npm test` verifies they still match.

## Licence

GPL-3.0-only — see [LICENSE](LICENSE).

This is **not a fork of TizenTube**. Everything under `src/main`, `src/preload` and
`src/renderer` is original. It does redistribute one third-party file:
`src/scripts/tizentube-bundle.js` is the unmodified `dist/userScript.js` from
[TizenTube](https://github.com/reisxd/TizenTube) v1.14.8 (npm `@foxreis/tizentube`),
GPL-3.0-only. Because that script runs inside this app's process, the combined work
is GPL-3.0-only too.

See [NOTICE.md](NOTICE.md) for full attribution and disclaimers.

Not affiliated with Google, YouTube, Samsung, the Tizen project, or TizenTube.
