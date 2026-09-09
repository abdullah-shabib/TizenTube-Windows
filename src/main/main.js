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
const { app, BrowserWindow, session, ipcMain, powerSaveBlocker, Menu, Tray, screen, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const crypto = require('crypto');
const configManager = require('./config');
const NativeVibrationManager = require('./native-vibration');
const DiscordRPC = require('./discord-rpc');
const RemoteServer = require('./remote-server');
const { checkForUpdates, updatesSupported } = require('./updater');

const nativeVibration = new NativeVibrationManager();
let discordRpc = null;
let remoteServer = null;
let tray = null;
let isPiP = false;
let prePiPState = null;
let sleepTimer = {
  active: false,
  totalMs: 0,
  endsAt: 0,
  timerId: null,
  warningShown: false
};

// Disable Blink features that block userscripts and dynamic code
app.commandLine.appendSwitch('disable-blink-features', 'TrustedTypes,TrustedTypesEnforcement');
app.commandLine.appendSwitch('disable-features', 'TrustedTypes,CalculateNativeWinOcclusion');

// Optimal TV video playback and input performance switches
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-background-media-suspend');
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

function getInitialBounds(config) {
  const defaultBounds = { width: 1920, height: 1080 };
  const saved = config && config.display && config.display.windowBounds;
  if (!saved || typeof saved.x !== 'number' || typeof saved.y !== 'number' || !saved.width || !saved.height) {
    return Object.assign({}, defaultBounds, { center: true });
  }

  try {
    const displays = screen.getAllDisplays();
    const isVisible = displays.some(d => {
      const { x, y, width, height } = d.workArea;
      return (
        saved.x + saved.width > x + 50 &&
        saved.x < x + width - 50 &&
        saved.y + saved.height > y + 50 &&
        saved.y < y + height - 50
      );
    });

    if (isVisible) {
      return {
        x: saved.x,
        y: saved.y,
        width: Math.max(480, saved.width),
        height: Math.max(270, saved.height),
        center: false
      };
    }
  } catch (e) {
    console.warn('[TizenTube] Error validating saved display bounds:', e.message);
  }

  return Object.assign({}, defaultBounds, { center: true });
}

function togglePiP() {
  if (!mainWindow || mainWindow.isDestroyed()) return false;

  if (isPiP) {
    mainWindow.setAlwaysOnTop(false);
    mainWindow.setMinimumSize(480, 270);
    if (prePiPState) {
      if (prePiPState.isFullScreen) {
        mainWindow.setFullScreen(true);
      } else if (prePiPState.bounds) {
        mainWindow.setBounds(prePiPState.bounds);
      }
    }
    isPiP = false;
    mainWindow.webContents.send('pip-changed', false);
    updateTrayMenu();
    return false;
  } else {
    const isFullScreen = mainWindow.isFullScreen();
    const bounds = mainWindow.getBounds();
    prePiPState = { isFullScreen, bounds };

    if (isFullScreen) {
      mainWindow.setFullScreen(false);
    }

    try {
      const currentDisplay = screen.getDisplayMatching(bounds) || screen.getPrimaryDisplay();
      const workArea = currentDisplay.workArea;

      // 16:9 mini-player: 480x270 docked bottom-right with 24px margin
      const pipWidth = 480;
      const pipHeight = 270;
      const pipX = workArea.x + workArea.width - pipWidth - 24;
      const pipY = workArea.y + workArea.height - pipHeight - 24;

      mainWindow.setAlwaysOnTop(true, 'screen-saver');
      mainWindow.setMinimumSize(320, 180);
      mainWindow.setBounds({
        x: pipX,
        y: pipY,
        width: pipWidth,
        height: pipHeight
      });
    } catch (e) {
      console.warn('[TizenTube] Error calculating PiP position:', e.message);
    }

    isPiP = true;
    mainWindow.webContents.send('pip-changed', true);
    updateTrayMenu();
    return true;
  }
}

function updateTrayMenu() {
  if (!tray || tray.isDestroyed()) return;

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Open TizenTube',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Play / Pause',
      click: () => {
        if (mainWindow && mainWindow.webContents) {
          mainWindow.webContents.send('media-control-action', 'toggle-play');
        }
      }
    },
    {
      label: 'Next Video',
      click: () => {
        if (mainWindow && mainWindow.webContents) {
          mainWindow.webContents.send('media-control-action', 'next');
        }
      }
    },
    {
      label: 'Previous Video',
      click: () => {
        if (mainWindow && mainWindow.webContents) {
          mainWindow.webContents.send('media-control-action', 'previous');
        }
      }
    },
    {
      label: 'Mute / Unmute',
      click: () => {
        if (mainWindow && mainWindow.webContents) {
          mainWindow.webContents.send('volume-toggle-mute');
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Mini-Player (Picture-in-Picture)',
      type: 'checkbox',
      checked: isPiP,
      click: () => togglePiP()
    },
    { type: 'separator' },
    {
      label: 'Quit TizenTube',
      click: () => {
        app.isQuitting = true;
        app.quit();
      }
    }
  ]);
  tray.setContextMenu(contextMenu);
}

function createTray() {
  if (tray) return;

  const iconPath = path.join(__dirname, '..', '..', 'assets', 'icon.ico');
  if (!fs.existsSync(iconPath)) return;

  try {
    tray = new Tray(iconPath);
    tray.setToolTip('TizenTube');
    updateTrayMenu();

    tray.on('click', () => {
      if (mainWindow) {
        if (mainWindow.isVisible() && !mainWindow.isMinimized()) {
          mainWindow.focus();
        } else {
          mainWindow.show();
          mainWindow.focus();
        }
      }
    });

    tray.on('double-click', () => {
      if (mainWindow) {
        mainWindow.show();
        mainWindow.focus();
      }
    });
  } catch (err) {
    console.warn('[TizenTube] Could not initialize system tray:', err.message);
  }
}

function setSleepTimer(minutes) {
  if (sleepTimer.timerId) {
    clearInterval(sleepTimer.timerId);
    sleepTimer.timerId = null;
  }

  const mins = parseInt(minutes, 10);
  if (!mins || mins <= 0) {
    sleepTimer.active = false;
    sleepTimer.totalMs = 0;
    sleepTimer.endsAt = 0;
    sleepTimer.warningShown = false;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('sleep-timer-status', { active: false, remainingMs: 0 });
    }
    return { active: false, remainingMs: 0 };
  }

  const totalMs = mins * 60 * 1000;
  sleepTimer.active = true;
  sleepTimer.totalMs = totalMs;
  sleepTimer.endsAt = Date.now() + totalMs;
  sleepTimer.warningShown = false;

  sleepTimer.timerId = setInterval(() => {
    const remainingMs = Math.max(0, sleepTimer.endsAt - Date.now());

    if (remainingMs <= 60000 && !sleepTimer.warningShown) {
      sleepTimer.warningShown = true;
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('sleep-timer-warning', Math.ceil(remainingMs / 1000));
      }
    }

    if (remainingMs <= 0) {
      clearInterval(sleepTimer.timerId);
      sleepTimer.timerId = null;
      sleepTimer.active = false;
      console.log('[TizenTube] Sleep timer expired. Closing application...');
      app.isQuitting = true;
      app.quit();
    }
  }, 1000);

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('sleep-timer-status', { active: true, remainingMs: totalMs });
  }

  return { active: true, remainingMs: totalMs };
}

function sendNativeKey(keyCode) {
  if (mainWindow && mainWindow.webContents && keyCode) {
    mainWindow.webContents.sendInputEvent({ type: 'keyDown', keyCode });
    setTimeout(() => {
      if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.sendInputEvent({ type: 'keyUp', keyCode });
      }
    }, 40);
  }
}

function handleClipboardPaste() {
  const text = (clipboard.readText() || '').trim();
  if (!text || !mainWindow || mainWindow.isDestroyed()) return;

  const ytMatch = text.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|v\/))([a-zA-Z0-9_-]{11})/);
  if (ytMatch && ytMatch[1]) {
    mainWindow.loadURL(`https://www.youtube.com/tv#/watch?v=${ytMatch[1]}`);
    mainWindow.webContents.send('tizentube-show-toast', {
      message: `Playing pasted video: ${ytMatch[1]}`,
      icon: '▶',
      durationMs: 2500
    });
    return;
  }

  mainWindow.loadURL(`https://www.youtube.com/tv#/search?q=${encodeURIComponent(text)}`);
  mainWindow.webContents.send('tizentube-show-toast', {
    message: `Pasted search: "${text.length > 30 ? text.slice(0, 27) + '...' : text}"`,
    icon: '🔍',
    durationMs: 2500
  });
}

function initRemoteServer() {
  const cfg = configManager.get();
  if (cfg.remote && cfg.remote.enabled === false) return;

  try {
    if (remoteServer) {
      remoteServer.stop();
      remoteServer = null;
    }

    remoteServer = new RemoteServer({ port: (cfg.remote && cfg.remote.port) || 8989 });

    remoteServer.on('search', (query) => {
      if (!mainWindow || mainWindow.isDestroyed() || !query) return;
      const text = query.trim();
      const ytMatch = text.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|v\/))([a-zA-Z0-9_-]{11})/);
      if (ytMatch && ytMatch[1]) {
        mainWindow.loadURL(`https://www.youtube.com/tv#/watch?v=${ytMatch[1]}`);
      } else {
        mainWindow.loadURL(`https://www.youtube.com/tv#/search?q=${encodeURIComponent(text)}`);
      }
      mainWindow.webContents.send('tizentube-show-toast', {
        message: `Remote search: "${text.length > 30 ? text.slice(0, 27) + '...' : text}"`,
        icon: '📱',
        durationMs: 2500
      });
    });

    remoteServer.on('action', (action) => {
      if (!mainWindow || mainWindow.isDestroyed()) return;

      if (action === 'PlayPause') {
        mainWindow.webContents.send('media-control-action', 'toggle-play');
      } else if (action === 'SeekLeft') {
        sendNativeKey('Left');
      } else if (action === 'SeekRight') {
        sendNativeKey('Right');
      } else if (action === 'VolumeUp') {
        mainWindow.webContents.send('volume-adjust', 0.05);
      } else if (action === 'VolumeDown') {
        mainWindow.webContents.send('volume-adjust', -0.05);
      } else if (action === 'VolumeMute') {
        mainWindow.webContents.send('volume-toggle-mute');
      } else if (action === 'ToggleFullscreen') {
        mainWindow.setFullScreen(!mainWindow.isFullScreen());
      } else if (action === 'ToggleOverlay') {
        mainWindow.webContents.send('toggle-overlay');
      } else if (action === 'TogglePiP') {
        togglePiP();
      } else if (action === 'ArrowUp') {
        sendNativeKey('Up');
      } else if (action === 'ArrowDown') {
        sendNativeKey('Down');
      } else if (action === 'ArrowLeft') {
        sendNativeKey('Left');
      } else if (action === 'ArrowRight') {
        sendNativeKey('Right');
      } else if (action === 'Enter') {
        sendNativeKey('Return');
      } else if (action === 'Escape') {
        sendNativeKey('Escape');
      }
    });

    remoteServer.on('speed', (speed) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('speed-set', speed);
      }
    });

    remoteServer.start().catch((err) => {
      console.warn('[TizenTube] Could not start RemoteServer:', err.message);
    });
  } catch (err) {
    console.warn('[TizenTube] Failed to initialize RemoteServer:', err.message);
  }
}

function createWindow() {
  const config = configManager.init();

  // Prevent display sleep during app execution
  applyPowerSaveSetting(config.display.preventDisplaySleep);

  // Configure native controller haptic vibration
  nativeVibration.setEnabled(config.controller && config.controller.vibration !== false);

  // Initialize Discord Rich Presence if enabled
  if (!discordRpc) {
    discordRpc = new DiscordRPC({
      clientId: (config.discord && config.discord.clientId) || '463097721130188830',
      enabled: config.discord ? config.discord.enabled !== false : true
    });
    if (config.discord && config.discord.enabled !== false) {
      discordRpc.connect();
    }
  }

  // Initialize System Tray
  createTray();

  // Initialize Mobile Companion Remote Server
  initRemoteServer();

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

  const initialBounds = getInitialBounds(config);
  const winOpts = {
    title: 'TizenTube',
    icon: path.join(__dirname, '..', '..', 'assets', 'icon.ico'),
    width: initialBounds.width,
    height: initialBounds.height,
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
  };
  if (initialBounds.center) {
    winOpts.center = true;
  } else {
    winOpts.x = initialBounds.x;
    winOpts.y = initialBounds.y;
  }

  mainWindow = new BrowserWindow(winOpts);

  Menu.setApplicationMenu(null);

  mainWindow.show();
  mainWindow.focus();

  // Track and persist window bounds when resized or moved (excluding fullscreen / PiP)
  let saveBoundsTimeout = null;
  const scheduleSaveBounds = () => {
    if (isPiP || !mainWindow || mainWindow.isDestroyed() || mainWindow.isFullScreen() || mainWindow.isMinimized()) return;
    if (saveBoundsTimeout) clearTimeout(saveBoundsTimeout);
    saveBoundsTimeout = setTimeout(() => {
      if (isPiP || !mainWindow || mainWindow.isDestroyed() || mainWindow.isFullScreen() || mainWindow.isMinimized()) return;
      try {
        const bounds = mainWindow.getBounds();
        const cfg = configManager.get();
        cfg.display = cfg.display || {};
        cfg.display.windowBounds = bounds;
        configManager.set(cfg);
      } catch (e) {}
    }, 500);
  };

  mainWindow.on('resize', scheduleSaveBounds);
  mainWindow.on('move', scheduleSaveBounds);

  // Minimize to tray if enabled
  mainWindow.on('minimize', (event) => {
    const cfg = configManager.get();
    if (cfg.system && cfg.system.minimizeToTray) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  // The renderer runs with Node integration and no web security, so nothing
  // may open a second window onto an arbitrary site with those privileges.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    console.log('[TizenTube] Blocked window.open to:', url);
    return { action: 'deny' };
  });

  // Check for an app update once the window is up, so a slow or failing
  // network never delays startup.
  mainWindow.webContents.once('did-finish-load', () => {
    setTimeout(() => {
      checkForUpdates(() => mainWindow, configManager.get());
    }, 4000);
  });

  // Load YouTube on TV
  mainWindow.loadURL('https://www.youtube.com/tv');

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Handle mouse side buttons (Back / Forward) and multimedia app commands
  mainWindow.on('app-command', (event, cmd) => {
    if (cmd === 'browser-backward') {
      event.preventDefault();
      if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send('tizentube-mouse-back');
      }
    } else if (cmd === 'browser-forward') {
      event.preventDefault();
      if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send('tizentube-mouse-forward');
      }
    }
  });

  // Keep the persisted setting and the renderer's copy in step with the real
  // window state, however the state was changed.
  mainWindow.on('enter-full-screen', () => setFullscreenState(true));
  mainWindow.on('leave-full-screen', () => setFullscreenState(false));

  // Handle F11 fullscreen toggle, PiP toggle, F2 overlay toggle, F5 reload, and volume shortcuts
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown') {
      if (input.key === 'F11') {
        event.preventDefault();
        mainWindow.setFullScreen(!mainWindow.isFullScreen());
      } else if ((input.control && input.shift && (input.key === 'P' || input.key === 'p')) ||
                 (input.alt && (input.key === 'P' || input.key === 'p'))) {
        event.preventDefault();
        togglePiP();
      } else if (input.key === 'F2') {
        event.preventDefault();
        mainWindow.webContents.send('toggle-overlay');
      } else if (input.key === 'F5') {
        event.preventDefault();
        mainWindow.webContents.reload();
      } else if (input.key === 'AudioVolumeUp' || input.key === 'VolumeUp') {
        event.preventDefault();
        mainWindow.webContents.send('volume-adjust', 0.05);
      } else if (input.key === 'AudioVolumeDown' || input.key === 'VolumeDown') {
        event.preventDefault();
        mainWindow.webContents.send('volume-adjust', -0.05);
      } else if (input.key === 'AudioVolumeMute' || input.key === 'VolumeMute') {
        event.preventDefault();
        mainWindow.webContents.send('volume-toggle-mute');
      } else if (input.control && input.key === 'ArrowUp') {
        event.preventDefault();
        mainWindow.webContents.send('volume-adjust', 0.05);
      } else if (input.control && input.key === 'ArrowDown') {
        event.preventDefault();
        mainWindow.webContents.send('volume-adjust', -0.05);
      } else if (input.control && (input.key === 'm' || input.key === 'M')) {
        event.preventDefault();
        mainWindow.webContents.send('volume-toggle-mute');
      } else if (input.control && (input.key === 'v' || input.key === 'V')) {
        event.preventDefault();
        handleClipboardPaste();
      } else if (input.key === '[' || (input.shift && input.key === '<')) {
        event.preventDefault();
        mainWindow.webContents.send('speed-adjust', -0.25);
      } else if (input.key === ']' || (input.shift && input.key === '>')) {
        event.preventDefault();
        mainWindow.webContents.send('speed-adjust', 0.25);
      } else if (input.shift && input.key === '{') {
        event.preventDefault();
        mainWindow.webContents.send('speed-set', 1.0);
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

// Lets the renderer decide whether it needs the Web Gamepad actuator fallback,
// so the two haptic paths never drive the same motors at once.
ipcMain.handle('vibration-available', () => {
  return !!(nativeVibration && nativeVibration.isAvailable());
});

// IPC Handlers
ipcMain.handle('get-config', () => {
  return configManager.get();
});

ipcMain.handle('save-config', (event, newConfig) => {
  const updated = configManager.set(newConfig);
  applyPowerSaveSetting(updated.display.preventDisplaySleep);
  nativeVibration.setEnabled(updated.controller && updated.controller.vibration !== false);
  if (discordRpc && updated.discord) {
    discordRpc.setEnabled(updated.discord.enabled !== false);
    if (updated.discord.clientId) {
      discordRpc.setClientId(updated.discord.clientId);
    }
  }
  if (updated.remote) {
    if (updated.remote.enabled === false && remoteServer) {
      remoteServer.stop();
    } else if (updated.remote.enabled !== false && (!remoteServer || !remoteServer.running)) {
      if (!remoteServer) initRemoteServer();
      else remoteServer.start();
    }
  }
  if (mainWindow && typeof updated.display.fullscreen === 'boolean') {
    if (mainWindow.isFullScreen() !== updated.display.fullscreen && !isPiP) {
      mainWindow.setFullScreen(updated.display.fullscreen);
    }
  }
  return updated;
});

ipcMain.handle('toggle-pip', () => {
  return togglePiP();
});

ipcMain.handle('is-pip', () => {
  return isPiP;
});

ipcMain.handle('set-sleep-timer', (event, { minutes }) => {
  return setSleepTimer(minutes);
});

ipcMain.handle('get-sleep-timer', () => {
  const remainingMs = sleepTimer.active ? Math.max(0, sleepTimer.endsAt - Date.now()) : 0;
  return {
    active: sleepTimer.active,
    totalMs: sleepTimer.totalMs,
    remainingMs
  };
});

ipcMain.handle('cancel-sleep-timer', () => {
  return setSleepTimer(0);
});

ipcMain.on('user-activity-ping', () => {
  if (sleepTimer.active && sleepTimer.warningShown) {
    setSleepTimer(0);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('sleep-timer-cancelled');
    }
  }
});

ipcMain.on('media-status-update', (event, data = {}) => {
  const { title, author, isPlaying, duration, currentTime } = data;

  if (tray && !tray.isDestroyed()) {
    if (title) {
      const displayTitle = title.length > 45 ? title.slice(0, 42) + '...' : title;
      tray.setToolTip(`TizenTube - ${displayTitle}`);
    } else {
      tray.setToolTip('TizenTube');
    }
  }

  if (discordRpc && discordRpc.enabled) {
    if (title && isPlaying) {
      const now = Math.floor(Date.now() / 1000);
      const start = Number.isFinite(currentTime) && currentTime > 0
        ? Math.floor(now - currentTime)
        : now;
      const end = Number.isFinite(duration) && duration > 0 && Number.isFinite(currentTime)
        ? Math.floor(now + (duration - currentTime))
        : undefined;

      discordRpc.setActivity({
        details: title.length > 128 ? title.slice(0, 125) + '...' : title,
        state: author ? (author.length > 128 ? author.slice(0, 125) + '...' : author) : 'YouTube TV',
        timestamps: { start, end },
        assets: {
          large_image: 'youtube',
          large_text: title,
          small_image: 'play',
          small_text: 'Playing'
        }
      });
    } else if (title && !isPlaying) {
      discordRpc.setActivity({
        details: title.length > 128 ? title.slice(0, 125) + '...' : title,
        state: 'Paused',
        assets: {
          large_image: 'youtube',
          large_text: 'TizenTube for Windows',
          small_image: 'pause',
          small_text: 'Paused'
        }
      });
    } else {
      discordRpc.setActivity({
        details: 'Browsing YouTube TV',
        state: 'TizenTube for Windows',
        assets: {
          large_image: 'youtube',
          large_text: 'TizenTube'
        }
      });
    }
  }

  if (remoteServer) {
    remoteServer.setMediaStatus({ title, author, isPlaying, duration, currentTime });
  }
});

// Query native controller battery status
ipcMain.handle('get-controller-battery', (event, slot = 0) => {
  if (nativeVibration && typeof nativeVibration.getBatteryStatus === 'function') {
    return nativeVibration.getBatteryStatus(slot);
  }
  return { connected: false, supported: false, isWired: false, level: 'unknown', percent: 100 };
});

// Query mobile companion remote info & QR code SVG
ipcMain.handle('get-remote-info', () => {
  if (!remoteServer) {
    return { enabled: false, url: '', qrSvg: '' };
  }
  return {
    enabled: remoteServer.running,
    url: remoteServer.getUrl(),
    qrSvg: remoteServer.getQRCodeSVG(180)
  };
});

// Toggle mobile companion remote server from settings
ipcMain.handle('toggle-remote-server', (event, enable) => {
  const cfg = configManager.get();
  cfg.remote = cfg.remote || {};
  cfg.remote.enabled = !!enable;
  configManager.set(cfg);

  if (enable) {
    if (!remoteServer) initRemoteServer();
    else if (!remoteServer.running) remoteServer.start();
  } else {
    if (remoteServer) remoteServer.stop();
  }

  return {
    enabled: remoteServer ? remoteServer.running : false,
    url: remoteServer ? remoteServer.getUrl() : '',
    qrSvg: remoteServer ? remoteServer.getQRCodeSVG(180) : ''
  };
});

// Focus window on controller reconnection
ipcMain.on('controller-reconnected', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.focus();
    mainWindow.webContents.focus();
  }
});

// Forward playback speed to remote server
ipcMain.on('speed-changed', (event, { speed }) => {
  if (remoteServer) {
    remoteServer.setPlaybackSpeed(speed);
  }
});

// The payload is defaulted so a bare invoke cannot throw on destructuring, and
// the level is checked with Number.isFinite: typeof NaN is 'number', and
// Math.min/Math.max would carry it straight into the config.
ipcMain.handle('set-audio-settings', (event, payload = {}) => {
  const { volume, muted } = payload || {};
  const cfg = configManager.get();
  cfg.audio = cfg.audio || {};
  if (Number.isFinite(volume)) {
    cfg.audio.volume = Math.max(0, Math.min(1, volume));
  }
  if (typeof muted === 'boolean') cfg.audio.muted = muted;
  configManager.set(cfg);
  return cfg.audio;
});

ipcMain.handle('check-for-updates', () => {
  return checkForUpdates(() => mainWindow, configManager.get(), { silent: false });
});

ipcMain.handle('updates-supported', () => updatesSupported());

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
  if (remoteServer) {
    remoteServer.stop();
    remoteServer = null;
  }
  if (discordRpc) {
    discordRpc.disconnect();
  }
  if (tray) {
    try { tray.destroy(); } catch (e) {}
    tray = null;
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
