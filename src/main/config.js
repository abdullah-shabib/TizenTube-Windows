/*
 * TizenTube for Windows
 * Copyright (C) 2026 Abdullah Shabib
 *
 * This program is free software: you can redistribute it and/or modify it under
 * the terms of the GNU General Public License, version 3 only, as published by
 * the Free Software Foundation. This program is distributed WITHOUT ANY
 * WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR
 * A PARTICULAR PURPOSE. See the GNU General Public License for more details.
 * You should have received a copy of the License along with this program; if
 * not, see <https://www.gnu.org/licenses/>.
 *
 * Bundles TizenTube (GPL-3.0-only) by Reis Can. See NOTICE.md.
 */
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

// A TV User-Agent is what makes youtube.com/tv serve the Leanback interface at
// all, and which one you send decides the maximum resolution YouTube offers.
const USER_AGENTS = {
  // Advertises a 4K-capable Cobalt 24 TV client. This is the only profile
  // measured to unlock the 2160p60 ladder.
  ps4: 'Mozilla/5.0 (PS4; Leanback Shell) Cobalt/24.lts.13.1032728-gold v8/8.8.278.8-jit gles Starboard/14, SystemIntegratorName_PS4_ChipsetModelNumber_2024/FirmwareVersion (Sony, PS4, Wired)',
  cobalt: 'Mozilla/5.0 (SMART-TV; Linux; Cobalt/24.lts.13.1032728-gold) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'lg-webos': 'Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.5735.196 Safari/537.36 WebAppManager',
  // Kept for reference: this is the old default and it caps playback at 720p.
  'tizen-legacy': 'Mozilla/5.0 (SMART-TV; Linux; Tizen 6.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/85.0.4183.93 Cobalt/21.lts.1-236400 (unlike Gecko) TV Safari/537.36'
};

// Config files written before the 720p cap was diagnosed are migrated to the
// 4K-capable profile; see migrate().
const CONFIG_VERSION = 2;

const DEFAULT_CONFIG = {
  version: CONFIG_VERSION,
  controller: {
    enabled: true,
    vibration: true,
    deadzone: 0.25,
    initialDelayMs: 250,
    repeatIntervalMs: 110,
    bindings: {
      button0: { action: 'Enter', label: 'Select (A / Cross)' },
      button1: { action: 'Escape', label: 'Back (B / Circle)' },
      button2: { action: 'PlayPause', label: 'Play / Pause (X / Square)' },
      button3: { action: 'Search', label: 'Search (Y / Triangle)' },
      button4: { action: 'SeekLeft', label: 'Seek -10s (Left Bumper)' },
      button5: { action: 'SeekRight', label: 'Seek +10s (Right Bumper)' },
      button6: { action: 'VolumeDown', label: 'Volume Down (Left Trigger)' },
      button7: { action: 'VolumeUp', label: 'Volume Up (Right Trigger)' },
      button8: { action: 'ToggleFullscreen', label: 'Toggle Fullscreen (Back / View)' },
      button9: { action: 'ToggleOverlay', label: 'Settings Overlay (Start / Menu)' },
      button11: { action: 'VolumeMute', label: 'Mute / Unmute (R3 / Right Stick Click)' }
      // Buttons 12-15 (D-Pad) are not listed here: they are wired directly to
      // directional navigation with key-repeat and are not remappable.
    }
  },
  display: {
    // Fullscreen by default: YouTube picks its stream from the player's size in
    // CSS pixels, so a windowed launch caps playback well below 4K. The startup
    // banner in overlay.js covers people who switch to windowed.
    fullscreen: true,
    autoHideCursor: true,
    cursorHideDelayMs: 3000,
    preventDisplaySleep: true
  },
  audio: {
    volume: 1.0,
    muted: false
  },
  tizentube: {
    injectScript: true,
    autoUpdateScript: true,
    // The userscript runs with full Node privileges, so the download is pinned
    // to an exact version and verified against its SHA-256 before it is ever
    // written to disk or executed. To move to a newer TizenTube release, run
    // `npm run pin-script -- <version>`; editing scriptVersion on its own will
    // fail verification, which is the point.
    scriptVersion: '1.14.8',
    scriptSha256: '0b535d9a870f9905a8b9d399d92453cb463ff35d1a9750b8f6cbe6ee60306108',
    cdnUrlTemplate: 'https://cdn.jsdelivr.net/npm/@foxreis/tizentube@{version}/dist/userScript.js'
  },
  system: {
    // The User-Agent decides which format ladder YouTube's TV app will serve.
    // Measured against the same 4K video on the same machine:
    //   Tizen 6.0 / Cobalt 21  -> 720p, 480p, 360p, 240p        (capped)
    //   PS4 / Cobalt 24        -> 2160p60 ... 240p              (full 4K)
    //   Android TV             -> redirects away from Leanback  (unusable)
    // Switch profiles with userAgentProfile, or set it to 'custom' and put your
    // own string in userAgent.
    userAgentProfile: 'ps4',
    userAgent: USER_AGENTS.ps4
  }
};

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function clone(value) {
  return isPlainObject(value) || Array.isArray(value)
    ? JSON.parse(JSON.stringify(value))
    : value;
}

class ConfigManager {
  constructor() {
    this.configPath = null;
    this.config = null;
  }

  init() {
    try {
      const userData = app.getPath('userData');
      this.configPath = path.join(userData, 'config.json');
      if (!fs.existsSync(userData)) {
        fs.mkdirSync(userData, { recursive: true });
      }
      this.load();
    } catch (e) {
      console.warn('ConfigManager: fallback to default configuration', e);
      this.config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    }
    return this.config;
  }

  load() {
    if (this.configPath && fs.existsSync(this.configPath)) {
      try {
        const raw = fs.readFileSync(this.configPath, 'utf8');
        const parsed = JSON.parse(raw);
        // Read the stored version before merging: DEFAULT_CONFIG carries the
        // current version, so merging first would stamp every old file as up to
        // date and skip the migration entirely.
        const storedVersion = parsed.version || 1;
        this.config = this.mergeWithDefault(parsed, DEFAULT_CONFIG);
        if (this.migrate(storedVersion)) {
          this.save();
        }
        return this.config;
      } catch (err) {
        console.error('Failed to read config file, restoring defaults:', err);
        // Keep the unreadable file around so a hand-edited config is not lost.
        try {
          fs.renameSync(this.configPath, this.configPath + '.bak');
        } catch (e) {
          console.warn('Could not back up the invalid config file:', e);
        }
      }
    }
    this.config = clone(DEFAULT_CONFIG);
    this.save();
    return this.config;
  }

  // Recursive merge. The result never shares object references with either
  // input, so mutating the live config cannot corrupt DEFAULT_CONFIG, and
  // nested defaults (such as individual button bindings) survive a partial
  // user config.
  mergeWithDefault(userCfg, defaultCfg) {
    const result = clone(defaultCfg);
    if (!isPlainObject(userCfg)) return result;

    for (const key of Object.keys(userCfg)) {
      const userVal = userCfg[key];
      if (isPlainObject(userVal)) {
        result[key] = this.mergeWithDefault(userVal, isPlainObject(result[key]) ? result[key] : {});
      } else {
        result[key] = clone(userVal);
      }
    }
    return result;
  }

  // Bring a config written by an older build up to date. Returns true when
  // something changed and the file needs rewriting.
  migrate(storedVersion) {
    let changed = false;

    // v1 -> v2: the Tizen 6.0 / Cobalt 21 User-Agent makes YouTube serve a
    // 720p-only ladder. Anyone still on that exact string never chose it, so
    // move them to the 4K-capable profile. A hand-picked custom UA is left be.
    if (storedVersion < 2) {
      const sys = this.config.system || (this.config.system = {});
      if (!sys.userAgent || sys.userAgent === USER_AGENTS['tizen-legacy']) {
        sys.userAgent = USER_AGENTS.ps4;
        sys.userAgentProfile = 'ps4';
        console.log('[TizenTube] Migrated the User-Agent to the 4K-capable profile (was capped at 720p).');
        changed = true;
      }
    }

    if (this.config.version !== CONFIG_VERSION) {
      this.config.version = CONFIG_VERSION;
      changed = true;
    }
    return changed;
  }

  // Resolve the User-Agent from the selected profile, falling back to the
  // explicit userAgent string.
  getUserAgent() {
    const sys = (this.get() || {}).system || {};
    if (sys.userAgentProfile && sys.userAgentProfile !== 'custom' && USER_AGENTS[sys.userAgentProfile]) {
      return USER_AGENTS[sys.userAgentProfile];
    }
    return sys.userAgent || USER_AGENTS.ps4;
  }

  get() {
    if (!this.config) {
      this.init();
    }
    return this.config;
  }

  // Defaults are always the floor, so a partial or pruned incoming config can
  // never leave the app with missing settings.
  set(newConfig) {
    const base = this.mergeWithDefault(this.config || {}, DEFAULT_CONFIG);
    this.config = this.mergeWithDefault(newConfig, base);
    this.save();
    return this.config;
  }

  save() {
    if (!this.configPath) return;
    try {
      fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2), 'utf8');
    } catch (err) {
      console.error('Failed to save configuration:', err);
    }
  }
}

module.exports = new ConfigManager();
