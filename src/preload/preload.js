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
 * TizenTube Windows - Preload Script
 * Connects Electron main process with YouTube TV,
 * initializes gamepad controller subsystem, in-app settings overlay, and TizenTube userscript.
 */

const { webFrame, ipcRenderer } = require('electron');
const fs = require('fs');
const path = require('path');

// Configure Trusted Types default policy to prevent EvalError in modern Chromium
if (typeof window !== 'undefined') {
  try {
    if (window.trustedTypes && window.trustedTypes.createPolicy) {
      window.trustedTypes.createPolicy('default', {
        createHTML: (string) => string,
        createScript: (string) => string,
        createScriptURL: (string) => string,
      });
    }
  } catch (e) {
    // Policy already registered or not supported
  }
}

// Prevent YouTube TV from pausing playback when the window blurs or is hidden
(function preventBackgroundPause() {
  if (typeof window === 'undefined') return;

  try {
    // 1. Spoof visibility properties on Document prototype and document instance
    const docProto = Document.prototype;
    const visibilityProps = {
      visibilityState: { get: () => 'visible', configurable: true },
      hidden: { get: () => false, configurable: true },
      webkitVisibilityState: { get: () => 'visible', configurable: true },
      webkitHidden: { get: () => false, configurable: true },
      hasFocus: { value: () => true, writable: true, configurable: true }
    };

    for (const [prop, desc] of Object.entries(visibilityProps)) {
      try { Object.defineProperty(docProto, prop, desc); } catch (e) {}
      try { Object.defineProperty(document, prop, desc); } catch (e) {}
    }

    // 2. Swallow the page-lifecycle events YouTube pauses on, in the capture
    // phase so its own listeners never run.
    //
    // Deliberately NOT blocked: focusout, and blur on anything but window.
    // Those drive focus movement inside the Leanback UI, and killing them with
    // stopImmediatePropagation breaks D-pad navigation and form fields. Only
    // whole-window blur is suppressed, which is what pauses playback.
    const blockHandler = (e) => {
      e.stopImmediatePropagation();
      e.stopPropagation();
    };

    for (const evt of ['visibilitychange', 'webkitvisibilitychange', 'pagehide']) {
      window.addEventListener(evt, blockHandler, true);
      document.addEventListener(evt, blockHandler, true);
    }

    // window.blur only - a blur event whose target is the window means the app
    // lost focus, not that focus moved between elements in the page.
    window.addEventListener('blur', (e) => {
      if (e.target === window || e.target === document) blockHandler(e);
    }, true);
  } catch (err) {
    console.error('[TizenTube Preload] Failed to configure background playback protection:', err);
  }
})();

// Inject the active TizenTube userscript into the webpage's DOM
async function injectTizenTubeScript() {
  try {
    const scriptContent = await ipcRenderer.invoke('get-tizentube-script');
    if (!scriptContent) {
      console.warn('[TizenTube Preload] No userscript content returned from main process.');
      return;
    }

    await webFrame.executeJavaScript(scriptContent);
    console.log('[TizenTube Preload] Successfully executed TizenTube userscript via webFrame.');
  } catch (err) {
    console.error('[TizenTube Preload] Error during userscript injection:', err);
  }
}

// Bootstrap lifecycle
(async function init() {
  console.log('[TizenTube Preload] Initializing TizenTube Windows environment...');

  // 1. Fetch configuration from main process
  let config = null;
  try {
    config = await ipcRenderer.invoke('get-config');
  } catch (err) {
    console.warn('[TizenTube Preload] Could not load config via IPC, using defaults:', err);
  }

  // 2. Load Controller subsystem directly via Node require.
  // It is initialised even when the config failed to load so that a bad config
  // file can never leave the app without controller input.
  try {
    require('../renderer/controller.js');
    if (window.TizenTubeGamepadManager) {
      window.TizenTubeGamepadManager.init(config || {});
    }
    console.log('[TizenTube Preload] Controller subsystem loaded successfully.');
  } catch (err) {
    console.error('[TizenTube Preload] Failed to load controller.js:', err);
  }

  // 3. Load Audio Subsystem directly via Node require
  try {
    require('../renderer/audio.js');
    if (window.TizenTubeAudioManager) {
      window.TizenTubeAudioManager.init(config || {});
    }
    console.log('[TizenTube Preload] Audio subsystem loaded successfully.');
  } catch (err) {
    console.error('[TizenTube Preload] Failed to load audio.js:', err);
  }

  // 4. Load In-App Settings Overlay directly via Node require
  function initOverlay() {
    try {
      require('../renderer/overlay.js');
      console.log('[TizenTube Preload] Settings overlay loaded successfully.');
    } catch (err) {
      console.error('[TizenTube Preload] Failed to load overlay.js:', err);
    }
  }

  if (document.body) {
    initOverlay();
  } else {
    window.addEventListener('DOMContentLoaded', initOverlay, { once: true });
  }

  // 4. Inject TizenTube userscript once DOM is ready
  if (!config || config.tizentube.injectScript !== false) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', injectTizenTubeScript, { once: true });
    } else {
      injectTizenTubeScript();
    }
  }
})();
