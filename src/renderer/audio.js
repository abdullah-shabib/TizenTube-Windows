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
 * TizenTube Windows - Application Audio Subsystem & Volume HUD
 * Provides volume control, mute management, media element synchronization,
 * and an on-screen display (HUD) for TV and desktop environments.
 */

(function () {
  const { ipcRenderer } = require('electron');

  const OVERLAY_DESIGN_WIDTH = 1920;

  const HUD_CSS = `
    #tizentube-volume-hud {
      position: fixed;
      top: 36px;
      right: 36px;
      z-index: 2147483646;
      background: rgba(18, 18, 18, 0.92);
      border: 1px solid #333333;
      border-radius: 12px;
      padding: 12px 20px;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.7);
      backdrop-filter: blur(12px);
      display: flex;
      align-items: center;
      gap: 16px;
      font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      color: #FFFFFF;
      pointer-events: none;
      opacity: 0;
      transform: translateY(-8px);
      transition: opacity 0.2s ease-in-out, transform 0.2s ease-in-out;
      user-select: none;
    }

    #tizentube-volume-hud.visible {
      opacity: 1;
      transform: translateY(0);
    }

    .tt-hud-icon {
      font-size: 20px;
      line-height: 1;
      min-width: 24px;
      text-align: center;
    }

    .tt-hud-bar-container {
      width: 140px;
      height: 8px;
      background: #2a2a2a;
      border-radius: 4px;
      overflow: hidden;
    }

    .tt-hud-bar-fill {
      height: 100%;
      background: var(--tt-accent, #ff0000);
      border-radius: 4px;
      transition: width 0.08s ease-out;
    }

    .tt-hud-bar-fill.muted {
      background: #777777;
    }

    .tt-hud-text {
      font-size: 15px;
      font-weight: 600;
      color: var(--tt-accent-text, #ff5c54);
      min-width: 50px;
      text-align: right;
    }

    .tt-hud-text.muted {
      color: #aaaaaa;
    }
  `;

  function whenDomReady(fn) {
    if (document.body) {
      fn();
    } else {
      window.addEventListener('DOMContentLoaded', fn, { once: true });
    }
  }

  // typeof NaN === 'number', so a plain type check lets non-finite values reach
  // the clamp, and Math.min/Math.max propagate them. Everything that accepts a
  // volume goes through this.
  function toVolume(value) {
    if (!Number.isFinite(value)) return null;
    return Math.max(0, Math.min(1, Math.round(value * 100) / 100));
  }

  const HUD_ICONS = {
    muted: '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" aria-hidden="true"><path d="M3 9v6h4l5 5V4L7 9H3zm13.6 3l2.7-2.7-1.1-1.1L15.5 11l-2.7-2.7-1.1 1.1L14.4 12l-2.7 2.7 1.1 1.1 2.7-2.7 2.7 2.7 1.1-1.1L16.6 12z"/></svg>',
    low:   '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" aria-hidden="true"><path d="M3 9v6h4l5 5V4L7 9H3zm12 3a3.5 3.5 0 0 0-2-3.2v6.4A3.5 3.5 0 0 0 15 12z"/></svg>',
    high:  '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" aria-hidden="true"><path d="M3 9v6h4l5 5V4L7 9H3zm12 3a3.5 3.5 0 0 0-2-3.2v6.4A3.5 3.5 0 0 0 15 12zm-2-7v2.1a5 5 0 0 1 0 9.8V19a7 7 0 0 0 0-14z"/></svg>'
  };

  class AudioManager {
    constructor() {
      this.volume = 1.0;
      this.muted = false;
      this.hudEl = null;
      this.hudTimer = null;
      this.listeners = [];
      this.persistTimer = null;
      this.applyingInternally = false;
    }

    init(config) {
      const audioCfg = (config && config.audio) || {};
      const stored = toVolume(audioCfg.volume);
      this.volume = stored === null ? 1.0 : stored;

      this.muted = !!audioCfg.muted;

      this.hookMediaElements();
      this.setupIPC();

      whenDomReady(() => {
        this.injectStyles();
        this.createHUD();
        this.applyToAll();
      });

      console.log('[TizenTube Audio] Subsystem initialized at volume:', Math.round(this.volume * 100) + '%', 'muted:', this.muted);
    }

    // Mirrors overlay.js: CSP is stripped, but a Trusted Types policy may still
    // be active, so route markup through one if the page has it.
    getSafeHTML(htmlString) {
      try {
        if (window.trustedTypes && window.trustedTypes.createPolicy) {
          if (!window._ttAudioPolicy) {
            window._ttAudioPolicy = window.trustedTypes.createPolicy('tizentube-audio', {
              createHTML: (str) => str
            });
          }
          return window._ttAudioPolicy.createHTML(htmlString);
        }
      } catch (e) {}
      return htmlString;
    }

    injectStyles() {
      if (document.getElementById('tizentube-audio-styles')) return;
      const style = document.createElement('style');
      style.id = 'tizentube-audio-styles';
      style.textContent = HUD_CSS;
      (document.head || document.documentElement).appendChild(style);
    }

    createHUD() {
      if (document.getElementById('tizentube-volume-hud')) {
        this.hudEl = document.getElementById('tizentube-volume-hud');
        return;
      }

      const hud = document.createElement('div');
      hud.id = 'tizentube-volume-hud';
      hud.innerHTML = `
        <span class="tt-hud-icon" id="tt-hud-icon"><svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" aria-hidden="true"><path d="M3 9v6h4l5 5V4L7 9H3zm12 3a3.5 3.5 0 0 0-2-3.2v6.4A3.5 3.5 0 0 0 15 12zm-2-7v2.1a5 5 0 0 1 0 9.8V19a7 7 0 0 0 0-14z"/></svg></span>
        <div class="tt-hud-bar-container">
          <div class="tt-hud-bar-fill" id="tt-hud-bar-fill" style="width: 100%;"></div>
        </div>
        <span class="tt-hud-text" id="tt-hud-text">100%</span>
      `;

      (document.body || document.documentElement).appendChild(hud);
      this.hudEl = hud;

      this.applyViewportScale();
      window.addEventListener('resize', () => this.applyViewportScale());
    }

    applyViewportScale() {
      if (!this.hudEl) return;
      const scale = Math.min(3, Math.max(1, window.innerWidth / OVERLAY_DESIGN_WIDTH));
      this.hudEl.style.zoom = scale;
    }

    showHUD() {
      if (!this.hudEl) {
        this.createHUD();
      }
      if (!this.hudEl) return;

      // Re-attach if swept away by YouTube TV page rendering
      if (!this.hudEl.isConnected) {
        (document.body || document.documentElement).appendChild(this.hudEl);
      }

      const iconEl = document.getElementById('tt-hud-icon');
      const barEl = document.getElementById('tt-hud-bar-fill');
      const textEl = document.getElementById('tt-hud-text');

      const pct = Math.round(this.volume * 100);

      if (this.muted || pct === 0) {
        if (iconEl) iconEl.innerHTML = this.getSafeHTML(HUD_ICONS.muted);
        if (barEl) {
          barEl.style.width = pct + '%';
          barEl.classList.add('muted');
        }
        if (textEl) {
          textEl.textContent = this.muted ? 'Muted' : '0%';
          textEl.classList.add('muted');
        }
      } else {
        if (iconEl) iconEl.innerHTML = this.getSafeHTML(pct < 50 ? HUD_ICONS.low : HUD_ICONS.high);
        if (barEl) {
          barEl.style.width = pct + '%';
          barEl.classList.remove('muted');
        }
        if (textEl) {
          textEl.textContent = pct + '%';
          textEl.classList.remove('muted');
        }
      }

      this.hudEl.classList.add('visible');

      clearTimeout(this.hudTimer);
      this.hudTimer = setTimeout(() => {
        if (this.hudEl) {
          this.hudEl.classList.remove('visible');
        }
      }, 1500);
    }

    applyToElement(media) {
      if (!media) return;
      this.applyingInternally = true;
      try {
        media.volume = this.volume;
        media.muted = this.muted;
      } catch (e) {
      } finally {
        this.applyingInternally = false;
      }
    }

    applyToAll() {
      const mediaList = document.querySelectorAll('video, audio');
      for (const media of mediaList) {
        this.applyToElement(media);
      }
    }

    // Media events do not bubble, but they do capture, so a single listener on
    // the document catches every <video>/<audio> the page creates. That avoids
    // both patching HTMLMediaElement.prototype and running a MutationObserver
    // over the whole subtree of a heavy SPA.
    hookMediaElements() {
      const adopt = (e) => {
        const media = e.target;
        if (media && (media.tagName === 'VIDEO' || media.tagName === 'AUDIO')) {
          this.applyToElement(media);
        }
      };

      for (const evt of ['loadedmetadata', 'loadstart', 'play']) {
        document.addEventListener(evt, adopt, true);
      }

      // If something else changes the volume - YouTube's own player UI, or the
      // user - follow it instead of fighting it on the next play().
      document.addEventListener('volumechange', (e) => {
        const media = e.target;
        if (this.applyingInternally) return;
        if (!media || (media.tagName !== 'VIDEO' && media.tagName !== 'AUDIO')) return;

        const external = toVolume(media.volume);
        if (external === null) return;
        if (external === this.volume && media.muted === this.muted) return;

        this.volume = external;
        this.muted = !!media.muted;
        this.notifyListeners();
        this.schedulePersist();
      }, true);
    }

    setupIPC() {
      ipcRenderer.on('volume-adjust', (event, delta) => {
        this.adjustVolume(delta);
      });

      ipcRenderer.on('volume-toggle-mute', () => {
        this.toggleMute();
      });

      window.addEventListener('tizentube-volume-change', (e) => {
        const delta = (e.detail && typeof e.detail.delta === 'number') ? e.detail.delta : 0.05;
        this.adjustVolume(delta);
      });

      window.addEventListener('tizentube-volume-toggle-mute', () => {
        this.toggleMute();
      });

      window.addEventListener('tizentube-volume-set', (e) => {
        if (e.detail && Number.isFinite(e.detail.volume)) {
          this.setVolume(e.detail.volume);
        }
      });
    }

    setVolume(newVolume, persist = true, showHud = true) {
      const clamped = toVolume(newVolume);
      // A non-finite value would render as "NaN%" and break the slider, so keep
      // the previous level instead.
      if (clamped === null) {
        console.warn('[TizenTube Audio] Ignoring non-finite volume:', newVolume);
        return;
      }
      this.volume = clamped;

      // If muted and volume is adjusted upwards, automatically unmute
      if (this.muted && clamped > 0) {
        this.muted = false;
      }

      this.applyToAll();
      this.notifyListeners();

      if (showHud) {
        this.showHUD();
      }

      if (persist) {
        this.schedulePersist();
      }
    }

    adjustVolume(delta) {
      this.setVolume(this.volume + delta, true, true);
    }

    setMuted(muted, persist = true, showHud = true) {
      this.muted = !!muted;
      this.applyToAll();
      this.notifyListeners();

      if (showHud) {
        this.showHUD();
      }

      if (persist) {
        this.schedulePersist();
      }
    }

    toggleMute() {
      this.setMuted(!this.muted, true, true);
    }

    schedulePersist() {
      clearTimeout(this.persistTimer);
      this.persistTimer = setTimeout(() => {
        ipcRenderer.invoke('set-audio-settings', {
          volume: this.volume,
          muted: this.muted
        }).catch((err) => console.warn('[TizenTube Audio] Failed to persist audio settings:', err));
      }, 300);
    }

    onStateChange(callback) {
      this.listeners.push(callback);
    }

    notifyListeners() {
      for (const cb of this.listeners) {
        try {
          cb({ volume: this.volume, muted: this.muted });
        } catch (e) {
          console.error('[TizenTube Audio] Listener callback failed:', e);
        }
      }
    }
  }

  window.TizenTubeAudioManager = new AudioManager();
})();
