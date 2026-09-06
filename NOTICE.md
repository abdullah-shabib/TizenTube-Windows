# Notice, Attribution & Disclaimer

## Third-party code bundled in this repository

This project is **not** a fork of TizenTube. No source file in `src/main`,
`src/preload` or `src/renderer` is derived from any upstream project; that code
is original to this repository.

However, this repository **redistributes** one third-party work:

| | |
| :--- | :--- |
| **File** | `src/scripts/tizentube-bundle.js` |
| **Upstream project** | [TizenTube](https://github.com/reisxd/TizenTube) by Reis Can (reisxd) |
| **npm package** | `@foxreis/tizentube` |
| **Version** | `1.14.8` |
| **SHA-256** | `0b535d9a870f9905a8b9d399d92453cb463ff35d1a9750b8f6cbe6ee60306108` |
| **Licence** | **GPL-3.0-only** |
| **Modified?** | **No.** The file is the unmodified `dist/userScript.js` build output of that release. |

Corresponding source for that build is the upstream repository at the tagged
release above: <https://github.com/reisxd/TizenTube>.

The bundled digest is enforced at runtime — see *Userscript Integrity Pinning* in
the README. Any copy that does not match the digest above is rejected, so the
provenance recorded here is verifiable rather than merely asserted.

Please consider supporting the upstream author:
[GitHub Sponsors](https://github.com/sponsors/reisxd).

## Licence of this project

Because this application loads and executes the GPL-3.0-only userscript inside
its own process, the combined work is distributed under the **GNU General Public
License, version 3 only**. See [LICENSE](LICENSE).

If you distribute binaries built from this repository, GPL-3.0 §6 requires you to
also make the corresponding source available.

## Not affiliated with Google, YouTube, Samsung, or TizenTube

**This is an unofficial, independent project. It is not affiliated with, endorsed
by, sponsored by, or connected to Google LLC, YouTube, Samsung, the Tizen
project, or the TizenTube project.**

"YouTube", "YouTube TV" and related marks are trademarks of Google LLC. "Tizen"
is a trademark of its respective owner. "TizenTube" is the name of the upstream
project by Reis Can. These names appear here only to describe what this software
is built on and compatible with — nominative use. No logo, wordmark, or brand
asset belonging to any of them is reproduced or imitated.

## What this software does

This application:

- opens `youtube.com/tv` in a Chromium window,
- sends a TV user-agent string so that site serves its 10-foot interface,
- reads a game controller via the HTML5 Gamepad API and translates its input into
  ordinary keyboard events, and
- injects the bundled TizenTube userscript, which **blocks advertising** and adds
  SponsorBlock and DeArrow behaviour to that interface.

It does **not** download, copy, record, redistribute, decrypt, or circumvent any
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
