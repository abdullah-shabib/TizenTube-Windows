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

/**
 * Application auto-update, against the project's public GitHub releases.
 *
 * This only covers the app itself. The bundled TizenTube userscript is pinned
 * by SHA-256 and ships inside the build, so it changes only when a new release
 * is cut - see checkForScriptUpdates in main.js and NOTICE.md.
 */

const { app, dialog } = require('electron');

let autoUpdater = null;
try {
  ({ autoUpdater } = require('electron-updater'));
} catch (err) {
  // A missing optional native/dep tree must not stop the app from starting.
  console.warn('[TizenTube Update] electron-updater unavailable:', err.message);
}

let checking = false;
let promptShown = false;

// Portable builds run from a single exe that the NSIS updater cannot replace,
// and a dev checkout has no release to compare against. electron-builder sets
// PORTABLE_EXECUTABLE_DIR only for the portable target.
function updatesSupported() {
  if (!autoUpdater) return { ok: false, why: 'electron-updater not loaded' };
  if (!app.isPackaged) return { ok: false, why: 'running from source' };
  if (process.env.PORTABLE_EXECUTABLE_DIR) return { ok: false, why: 'portable build' };
  return { ok: true };
}

function describeSkip(why) {
  console.log('[TizenTube Update] Skipping update check (' + why + ').');
}

function wire(getMainWindow) {
  autoUpdater.autoDownload = true;
  // Let the user finish watching; the installer runs when they choose to quit.
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    console.log('[TizenTube Update] Checking for updates...');
  });

  autoUpdater.on('update-not-available', (info) => {
    checking = false;
    console.log('[TizenTube Update] Already on the latest version (' + (info && info.version) + ').');
  });

  autoUpdater.on('update-available', (info) => {
    console.log('[TizenTube Update] Update available:', info && info.version, '- downloading in the background.');
  });

  autoUpdater.on('download-progress', (p) => {
    console.log('[TizenTube Update] Downloading: ' + Math.round(p.percent) + '%');
  });

  autoUpdater.on('update-downloaded', async (info) => {
    checking = false;
    if (promptShown) return;
    promptShown = true;

    const version = (info && info.version) || 'a new version';
    console.log('[TizenTube Update] Downloaded ' + version + '.');

    try {
      const win = typeof getMainWindow === 'function' ? getMainWindow() : null;
      const opts = {
        type: 'info',
        buttons: ['Restart now', 'Later'],
        defaultId: 0,
        cancelId: 1,
        title: 'Update ready',
        message: 'TizenTube ' + version + ' is ready to install.',
        detail: 'The update installs when you restart. Choosing Later installs it '
              + 'the next time you quit.\n\nThe installer is not code-signed, so '
              + 'Windows may ask you to confirm it.'
      };
      const { response } = win && !win.isDestroyed()
        ? await dialog.showMessageBox(win, opts)
        : await dialog.showMessageBox(opts);

      if (response === 0) {
        setImmediate(() => autoUpdater.quitAndInstall());
      }
    } catch (err) {
      console.error('[TizenTube Update] Could not prompt to install:', err.message);
    }
  });

  autoUpdater.on('error', (err) => {
    checking = false;
    // Offline, rate-limited, or no release yet. Never surfaced to the user:
    // a failed update check is not something they need to act on.
    console.warn('[TizenTube Update] Update check failed:', err && err.message);
  });
}

let wired = false;

// Returns a short status string, which the renderer uses for the settings row.
function checkForUpdates(getMainWindow, config, { silent = true } = {}) {
  const supported = updatesSupported();
  if (!supported.ok) {
    describeSkip(supported.why);
    return Promise.resolve({ checked: false, reason: supported.why });
  }

  const updates = (config && config.updates) || {};
  if (silent && updates.autoCheck === false) {
    describeSkip('disabled in settings');
    return Promise.resolve({ checked: false, reason: 'disabled in settings' });
  }

  if (!wired) {
    wire(getMainWindow);
    wired = true;
  }

  if (checking) return Promise.resolve({ checked: false, reason: 'already checking' });
  checking = true;

  return autoUpdater.checkForUpdates()
    .then((result) => ({ checked: true, version: result && result.updateInfo && result.updateInfo.version }))
    .catch((err) => {
      checking = false;
      return { checked: false, reason: err && err.message };
    });
}

module.exports = { checkForUpdates, updatesSupported };
