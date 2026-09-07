# Notice and attribution

## Bundled third-party code

This project is not a fork of TizenTube. Nothing under `src/main`, `src/preload`
or `src/renderer` is derived from another project. It does redistribute one
third-party file:

| | |
| :--- | :--- |
| File | `src/scripts/tizentube-bundle.js` |
| Upstream | [TizenTube](https://github.com/reisxd/TizenTube) by Reis Can (reisxd) |
| npm package | `@foxreis/tizentube` |
| Version | `1.14.8` |
| SHA-256 | `0b535d9a870f9905a8b9d399d92453cb463ff35d1a9750b8f6cbe6ee60306108` |
| Licence | GPL-3.0-only |
| Modified | No. It is the unmodified `dist/userScript.js` from that release. |

Corresponding source for that build is the upstream repository at the tagged
release above: <https://github.com/reisxd/TizenTube>.

That digest is checked at runtime; anything that does not match is rejected, so
the provenance above can be verified rather than taken on trust.

If you find this useful, [sponsor Reis Can](https://github.com/sponsors/reisxd).

### Runtime dependencies

| Package | Purpose | Licence |
| :--- | :--- | :--- |
| [koffi](https://github.com/Koromix/koffi) | Calls into the Windows `xinput1_4.dll` system library for controller vibration | MIT |

Electron and electron-builder are development dependencies (MIT). These are
permissively licensed and compatible with this project's GPL-3.0-only terms.

## Licence

Because this application loads and executes the GPL-3.0-only userscript inside
its own process, the combined work is distributed under the **GNU General Public
License, version 3 only**. See [LICENSE](LICENSE).

If you distribute binaries built from this repository, GPL-3.0 §6 requires you to
also make the corresponding source available.

## Affiliation

This is an unofficial, independent project. It is not affiliated with, endorsed
by, sponsored by, or connected to Google LLC, YouTube, Samsung, the Tizen
project, or the TizenTube project.

"YouTube", "YouTube TV" and related marks are trademarks of Google LLC. "Tizen"
is a trademark of its respective owner. "TizenTube" is the name of the upstream
project by Reis Can. These names appear here only to describe what this software
is built on and compatible with — nominative use. No logo, wordmark, or brand
asset belonging to any of them is reproduced or imitated.

## What it does

This application:

- opens `youtube.com/tv` in a Chromium window,
- sends a TV user-agent string so that site serves its 10-foot interface,
- reads a game controller via the HTML5 Gamepad API and translates its input into
  ordinary keyboard events, and
- injects the bundled TizenTube userscript, which blocks advertising and adds
  SponsorBlock and DeArrow behaviour to that interface.

It does not download, copy, record, redistribute, decrypt, or circumvent any
access control on any video or audio content. All media is played by the site
itself, in an ordinary browser engine, as that site delivers it.

## User responsibility

Blocking advertising and sending a modified user-agent string may conflict with
the Terms of Service of the site being accessed. You are responsible for your own
use of this software and for complying with the terms of any service you use it
with. The realistic consequence of a terms violation is account action by the
service provider — but that is a judgement you should make for yourself.

This software is provided "as is", without warranty of any kind, to the extent
permitted by the GNU General Public License. See [LICENSE](LICENSE).

## Requests

If you represent a rights holder — including the upstream TizenTube author — and
believe something in this repository infringes your rights or misrepresents your
work, please open an issue and it will be addressed promptly.
