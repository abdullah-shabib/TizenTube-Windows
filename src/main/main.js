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
const { app, BrowserWindow, session, ipcMain, powerSaveBlocker, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const crypto = require('crypto');
const configManager = require('./config');
const NativeVibrationManager = require('./native-vibration');

const nativeVibration = new NativeVibrationManager();

// Disable Blink features that block userscripts and dynamic code
app.commandLine.appendSwitch('disable-blink-features', 'TrustedTypes,TrustedTypesEnforcement');
app.commandLine.appendSwitch('disable-features', 'TrustedTypes');

// Optimal TV video playback and input performance switches
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
// VaapiVideoDecoder is Linux-only and does nothing here; on Windows the VP9/AV1
// hardware path is D3D11, which is already on by default.
app.commandLine.appendSwitch('enable-features', 'PlatformHEVCDecoderSupport,CanvasOopRasterization');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('enable-hardware-overlays', 'single-fullscreen,single-on-top,underlay');
// Render at the panel's native resolution. Without this, Windows display
// scaling shrinks the CSS viewport (a 4K panel at 150% reports 2560x1440), and
// YouTube's TV app picks its stream from the CSS viewport size.
app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.commandLine.appendSwitch('high-dpi-support', '1');

let mainWindow = null;
let powerSaveId = null;

// A valid TizenTube build is ~550 KB; anything much smaller is an error page.
const MIN_SCRIPT_BYTES = 100000;

const BUNDLED_SCRIPT_PATH = path.join(__dirname, '..', 'scripts', 'tizentube-bundle.js');

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function sha256OfFile(filePath) {
  try {
    return sha256(fs.readFileSync(filePath));
  } catch (err) {
    console.warn('[TizenTube] Could not hash', filePath, err.message);
    return null;
  }
}

function cachedScriptPath() {
  return path.join(app.getPath('userData'), 'tizentube-cached.js');
}

// Move a script that failed verification out of the way rather than deleting
// it, so a genuine version bump can be diagnosed after the fact.
function quarantine(filePath, reason) {
  console.error('[TizenTube] Rejecting cached userscript (' + reason + '):', filePath);
  try {
    fs.renameSync(filePath, filePath + '.rejected');
  } catch (err) {
    try {
      fs.unlinkSync(filePath);
    } catch (e) {
      console.error('[TizenTube] Could not quarantine the rejected script:', e.message);
    }
  }
}

// Resolve the active TizenTube script. The cached copy is only used when its
// SHA-256 matches the pinned digest: it is executed with full Node privileges,
// so an unverified file on disk is never good enough.
function getActiveScriptPath(config) {
  const expected = config && config.tizentube && config.tizentube.scriptSha256;
  const cached = cachedScriptPath();

  if (!fs.existsSync(cached)) return BUNDLED_SCRIPT_PATH;

  if (!expected) {
    quarantine(cached, 'no pinned SHA-256 configured');
    return BUNDLED_SCRIPT_PATH;
  }

  const actual = sha256OfFile(cached);
  if (actual !== expected) {
    quarantine(cached, 'SHA-256 mismatch, expected ' + expected + ' got ' + actual);
    return BUNDLED_SCRIPT_PATH;
  }

  return cached;
}

// Fetch the pinned TizenTube release and verify it before it touches disk.
// Nothing that fails the digest check is ever written or executed.
function checkForScriptUpdates(config) {
  const tt = (config && config.tizentube) || {};
  const { scriptVersion, scriptSha256, cdnUrlTemplate } = tt;

  if (!scriptVersion || !scriptSha256 || !cdnUrlTemplate) {
    console.warn('[TizenTube] Script update skipped: scriptVersion, scriptSha256 and cdnUrlTemplate must all be set.');
    return;
  }

  // The bundled script already is the pinned release in a stock install, so
  // there is nothing to fetch and no reason to touch the network.
  if (sha256OfFile(BUNDLED_SCRIPT_PATH) === scriptSha256) {
    const cached = cachedScriptPath();
    if (fs.existsSync(cached)) {
      try {
        fs.unlinkSync(cached);
        console.log('[TizenTube] Removed a redundant cached script; the bundled build matches the pin.');
      } catch (e) { /* the hash check on read will catch anything wrong with it */ }
    }
    console.log('[TizenTube] Bundled userscript matches the pinned digest for ' + scriptVersion + '; no download needed.');
    return;
  }

  const url = cdnUrlTemplate.replace('{version}', encodeURIComponent(scriptVersion));
  console.log('[TizenTube] Fetching pinned userscript ' + scriptVersion + ' from:', url);
  downloadAndVerify(url, scriptSha256, 3);
}

function downloadAndVerify(url, expectedSha256, redirectsLeft) {
  https.get(url, (res) => {
    const status = res.statusCode;

    if (status >= 300 && status < 400 && res.headers.location) {
      res.resume();
      if (redirectsLeft <= 0) {
        console.warn('[TizenTube] Script update aborted: too many redirects');
        return;
      }
      downloadAndVerify(new URL(res.headers.location, url).toString(), expectedSha256, redirectsLeft - 1);
      return;
    }

    if (status !== 200) {
      console.warn('[TizenTube] Script update check failed with status:', status);
      res.resume();
      return;
    }

    // Chunks are kept as Buffers and joined once: concatenating them as strings
    // splits multi-byte UTF-8 across chunk boundaries and corrupts the script.
    const chunks = [];
    res.on('data', (chunk) => { chunks.push(chunk); });
    res.on('end', () => {
      const buffer = Buffer.concat(chunks);

      if (buffer.length <= MIN_SCRIPT_BYTES) {
        console.warn('[TizenTube] Ignoring script update: response was too small to be a TizenTube build');
        return;
      }

      const actual = sha256(buffer);
      if (actual !== expectedSha256) {
        console.error('[TizenTube] REJECTED script update: SHA-256 mismatch.');
        console.error('[TizenTube]   expected ' + expectedSha256);
        console.error('[TizenTube]   received ' + actual);
        console.error('[TizenTube] Keeping the current script. If you meant to upgrade, run: npm run pin-script -- <version>');
        return;
      }

      // Write to a temp file and rename, so a crash or a concurrent read can
      // never observe a half-written script.
      const target = cachedScriptPath();
      const tmpPath = target + '.tmp';
      try {
        fs.writeFileSync(tmpPath, buffer);
        fs.renameSync(tmpPath, target);
        console.log('[TizenTube] Verified and cached userscript (' + buffer.length + ' bytes, sha256 ' + actual.slice(0, 12) + '...)');
      } catch (err) {
        console.error('[TizenTube] Failed to write cached script:', err);
        try { fs.unlinkSync(tmpPath); } catch (e) { /* nothing to clean up */ }
      }
    });
    res.on('error', (err) => {
      console.warn('[TizenTube] Script update download error:', err.message);
    });
  }).on('error', (err) => {
    console.warn('[TizenTube] Script update network error (offline or CDN blocked):', err.message);
  });
}

// Start or stop the display-sleep blocker to match the current setting.
function applyPowerSaveSetting(enabled) {
  if (enabled && powerSaveId === null) {
    powerSaveId = powerSaveBlocker.start('prevent-display-sleep');
  } else if (!enabled && powerSaveId !== null) {
    if (powerSaveBlocker.isStarted(powerSaveId)) {
      powerSaveBlocker.stop(powerSaveId);
    }
    powerSaveId = null;
  }
}

// Persist the fullscreen state and tell the renderer, so the settings overlay
// never holds a stale copy of it.
function setFullscreenState(isFullscreen) {
  const cfg = configManager.get();
  if (cfg.display.fullscreen !== isFullscreen) {
    cfg.display.fullscreen = isFullscreen;
    configManager.set(cfg);
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('fullscreen-changed', isFullscreen);
  }
}

function createWindow() {
  const config = configManager.init();

  // Prevent display sleep during app execution
  applyPowerSaveSetting(config.display.preventDisplaySleep);

  // Configure native controller haptic vibration
  nativeVibration.setEnabled(config.controller && config.controller.vibration !== false);

  // Check for script updates asynchronously if enabled
  if (config.tizentube.autoUpdateScript) {
    checkForScriptUpdates(config);
  }

  const customSession = session.fromPartition('persist:tizentube', { cache: true });

  // A TV User-Agent makes youtube.com/tv serve Leanback, and decides the
  // maximum resolution YouTube will offer. See USER_AGENTS in config.js.
  customSession.setUserAgent(configManager.getUserAgent());

  // Strip restrictive CSP and enable CORS for SponsorBlock and DeArrow
  customSession.webRequest.onHeadersReceived((details, callback) => {
    const responseHeaders = Object.assign({}, details.responseHeaders);

    for (const key of Object.keys(responseHeaders)) {
      const lower = key.toLowerCase();
      if (lower.includes('content-security-policy') || lower === 'x-frame-options') {
        delete responseHeaders[key];
      }
    }

    // Add CORS headers for all origins
    responseHeaders['access-control-allow-origin'] = ['*'];
    responseHeaders['access-control-allow-methods'] = ['GET, POST, OPTIONS, PUT, DELETE'];
    responseHeaders['access-control-allow-headers'] = ['*'];

    callback({ responseHeaders });
  });

  mainWindow = new BrowserWindow({
    title: 'TizenTube',
    icon: path.join(__dirname, '..', '..', 'assets', 'icon.ico'),
    width: 1920,
    height: 1080,
    fullscreen: config.display.fullscreen,
    autoHideMenuBar: true,
    backgroundColor: '#0f0f0f',
    webPreferences: {
      session: customSession,
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: false,
      nodeIntegration: true,
      sandbox: false,
      webSecurity: false,
      backgroundThrottling: false
    }
  });

  Menu.setApplicationMenu(null);

  // The renderer runs with Node integration and no web security, so nothing
  // may open a second window onto an arbitrary site with those privileges.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    console.log('[TizenTube] Blocked window.open to:', url);
    return { action: 'deny' };
  });

  // Load YouTube on TV
  mainWindow.loadURL('https://www.youtube.com/tv');

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Keep the persisted setting and the renderer's copy in step with the real
  // window state, however the state was changed.
  mainWindow.on('enter-full-screen', () => setFullscreenState(true));
  mainWindow.on('leave-full-screen', () => setFullscreenState(false));

  // Handle F11 fullscreen toggle, F2 overlay toggle, and F5 reload
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown') {
      if (input.key === 'F11') {
        event.preventDefault();
        mainWindow.setFullScreen(!mainWindow.isFullScreen());
      } else if (input.key === 'F2') {
        event.preventDefault();
        mainWindow.webContents.send('toggle-overlay');
      } else if (input.key === 'F5') {
        event.preventDefault();
        mainWindow.webContents.reload();
      }
    }
  });
}

// Native input event dispatch from Gamepad controller loop
ipcMain.on('send-native-key', (event, { keyCode }) => {
  if (mainWindow && mainWindow.webContents && keyCode) {
    mainWindow.webContents.sendInputEvent({ type: 'keyDown', keyCode });
    setTimeout(() => {
      if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.sendInputEvent({ type: 'keyUp', keyCode });
      }
    }, 40);
  }
});

// Native controller haptic vibration dispatch
ipcMain.on('controller-vibrate', (event, { type, slot }) => {
  if (nativeVibration && nativeVibration.isAvailable()) {
    nativeVibration.pulse(type || 'button', slot || 0);
  }
});

// IPC Handlers
ipcMain.handle('get-config', () => {
  return configManager.get();
});

ipcMain.handle('save-config', (event, newConfig) => {
  const updated = configManager.set(newConfig);
  applyPowerSaveSetting(updated.display.preventDisplaySleep);
  nativeVibration.setEnabled(updated.controller && updated.controller.vibration !== false);
  if (mainWindow && typeof updated.display.fullscreen === 'boolean') {
    if (mainWindow.isFullScreen() !== updated.display.fullscreen) {
      mainWindow.setFullScreen(updated.display.fullscreen);
    }
  }
  return updated;
});

ipcMain.handle('get-tizentube-script', () => {
  const scriptPath = getActiveScriptPath(configManager.get());
  try {
    return fs.readFileSync(scriptPath, 'utf8');
  } catch (err) {
    console.error('[TizenTube] Error reading userscript:', scriptPath, err);
  }

  // A damaged cached update must not cost us ad-blocking entirely.
  const bundledPath = BUNDLED_SCRIPT_PATH;
  if (scriptPath !== bundledPath) {
    try {
      console.warn('[TizenTube] Falling back to the bundled userscript.');
      return fs.readFileSync(bundledPath, 'utf8');
    } catch (err) {
      console.error('[TizenTube] Error reading bundled userscript:', err);
    }
  }
  return null;
});

// Persistence and the renderer notification are handled by the window's
// enter-full-screen / leave-full-screen events.
ipcMain.handle('toggle-fullscreen', () => {
  if (mainWindow) {
    const nextState = !mainWindow.isFullScreen();
    mainWindow.setFullScreen(nextState);
    return nextState;
  }
  return false;
});

ipcMain.handle('exit-app', () => {
  app.quit();
});

// App lifecycle
// A second instance would share the persist:tizentube partition and fight over
// its cookie/cache databases, so focus the existing window instead.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });
}

app.on('window-all-closed', () => {
  applyPowerSaveSetting(false);
  nativeVibration.stopAll();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
