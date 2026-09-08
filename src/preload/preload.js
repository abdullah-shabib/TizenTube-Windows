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

// MediaSession, SMTC, and external media action synchronization
function initMediaSessionIntegration() {
  let lastMediaState = {
    title: '',
    author: '',
    videoId: '',
    isPlaying: false
  };

  const getPlayer = () => document.getElementById('movie_player');
  const getVideo = () => document.querySelector('video');

  // Setup navigator.mediaSession action handlers once
  if ('mediaSession' in navigator) {
    const safeSet = (action, handler) => {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch (e) {}
    };

    safeSet('play', () => {
      const p = getPlayer();
      if (p && typeof p.playVideo === 'function') p.playVideo();
      else {
        const v = getVideo();
        if (v) v.play();
      }
    });

    safeSet('pause', () => {
      const p = getPlayer();
      if (p && typeof p.pauseVideo === 'function') p.pauseVideo();
      else {
        const v = getVideo();
        if (v) v.pause();
      }
    });

    safeSet('nexttrack', () => {
      const p = getPlayer();
      if (p && typeof p.nextVideo === 'function') p.nextVideo();
    });

    safeSet('previoustrack', () => {
      const p = getPlayer();
      if (p && typeof p.previousVideo === 'function') p.previousVideo();
    });

    safeSet('seekto', (details) => {
      const v = getVideo();
      if (v && details && details.seekTime !== undefined) {
        v.currentTime = details.seekTime;
      }
    });

    safeSet('seekbackward', (details) => {
      const v = getVideo();
      if (v) {
        v.currentTime = Math.max(0, v.currentTime - ((details && details.seekOffset) || 10));
      }
    });

    safeSet('seekforward', (details) => {
      const v = getVideo();
      if (v) {
        v.currentTime = Math.min(v.duration || 999999, v.currentTime + ((details && details.seekOffset) || 10));
      }
    });

    safeSet('stop', () => {
      const v = getVideo();
      if (v) v.pause();
    });
  }

  // Poll video & player state
  function updateMediaStatus() {
    try {
      const player = getPlayer();
      const video = getVideo();

      let title = '';
      let author = '';
      let videoId = '';
      let isPlaying = false;
      let duration = 0;
      let currentTime = 0;

      if (player && typeof player.getVideoData === 'function') {
        const data = player.getVideoData() || {};
        title = data.title || '';
        author = data.author || '';
        videoId = data.video_id || '';
      }

      if (!title) {
        const titleEl = document.querySelector('.ytp-title-link, .ytp-title, .title');
        if (titleEl && titleEl.textContent) title = titleEl.textContent.trim();
      }

      if (video) {
        isPlaying = !video.paused && !video.ended && video.readyState > 2;
        duration = Number.isFinite(video.duration) ? video.duration : 0;
        currentTime = Number.isFinite(video.currentTime) ? video.currentTime : 0;
      }

      // Update navigator.mediaSession
      if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';

        if (title && (title !== lastMediaState.title || author !== lastMediaState.author || videoId !== lastMediaState.videoId)) {
          const artwork = videoId ? [
            { src: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`, sizes: '480x360', type: 'image/jpeg' }
          ] : [];

          try {
            navigator.mediaSession.metadata = new MediaMetadata({
              title,
              artist: author || 'YouTube TV',
              album: 'TizenTube',
              artwork
            });
          } catch (e) {}
        }
      }

      // If state changed or during playback progress, send IPC to main process
      const stateChanged = (
        title !== lastMediaState.title ||
        author !== lastMediaState.author ||
        videoId !== lastMediaState.videoId ||
        isPlaying !== lastMediaState.isPlaying
      );

      if (stateChanged || (isPlaying && Math.abs(currentTime - (lastMediaState.currentTime || 0)) > 5)) {
        lastMediaState = { title, author, videoId, isPlaying, duration, currentTime };
        ipcRenderer.send('media-status-update', {
          title,
          author,
          videoId,
          isPlaying,
          duration,
          currentTime
        });
      }
    } catch (err) {
      // Quietly ignore DOM inspection errors
    }
  }

  setInterval(updateMediaStatus, 1000);

  // External media control actions from tray or main
  ipcRenderer.on('media-control-action', (event, action) => {
    const v = getVideo();
    const p = getPlayer();
    if (action === 'toggle-play') {
      if (v) {
        if (v.paused) v.play(); else v.pause();
      } else if (p) {
        if (p.getPlayerState && p.getPlayerState() === 1) p.pauseVideo();
        else if (p.playVideo) p.playVideo();
      }
    } else if (action === 'next') {
      if (p && p.nextVideo) p.nextVideo();
    } else if (action === 'previous') {
      if (p && p.previousVideo) p.previousVideo();
    }
  });

  // Sleep timer HUD alerts
  ipcRenderer.on('sleep-timer-warning', (event, secondsRemaining) => {
    if (window.TizenTubeAudioManager && typeof window.TizenTubeAudioManager.showToast === 'function') {
      window.TizenTubeAudioManager.showToast(`⏰ Sleep timer: closing in ${secondsRemaining}s (press any key to cancel)`);
    }
  });

  ipcRenderer.on('sleep-timer-cancelled', () => {
    if (window.TizenTubeAudioManager && typeof window.TizenTubeAudioManager.showToast === 'function') {
      window.TizenTubeAudioManager.showToast('⏰ Sleep timer cancelled');
    }
  });

  // User input activity cancels sleep timer if warning is showing
  window.addEventListener('keydown', () => {
    ipcRenderer.send('user-activity-ping');
  }, { passive: true });
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

  // 4. Initialize MediaSession & SMTC integration
  try {
    initMediaSessionIntegration();
    console.log('[TizenTube Preload] MediaSession SMTC integration initialized.');
  } catch (err) {
    console.error('[TizenTube Preload] Failed to initialize MediaSession:', err);
  }

  // 5. Load In-App Settings Overlay directly via Node require
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

  // 6. Inject TizenTube userscript once DOM is ready
  if (!config || config.tizentube.injectScript !== false) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', injectTizenTubeScript, { once: true });
    } else {
      injectTizenTubeScript();
    }
  }
})();
