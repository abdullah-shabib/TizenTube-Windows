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
 * TizenTube Windows - Mouse & Pointer Navigation Subsystem
 * Injects sleek on-screen mouse controls for YouTube TV:
 * 1. Top-Left Back button inside video playback.
 * 2. Top-Right Volume button that opens an interactive volume slider bar when pressed.
 * 3. Left & Right Carousel chevrons to scroll video cards without blocking menus.
 * 4. Throttled wheel scrolling and non-intrusive sidebar handling.
 */

(function () {
  const { ipcRenderer } = require('electron');

  const MOUSE_CSS = `
    #tt-mouse-ui {
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      z-index: 2147483640;
      pointer-events: none;
      user-select: none;
      font-family: 'Roboto', 'Segoe UI', system-ui, -apple-system, sans-serif;
      opacity: 0;
      transition: opacity 0.25s cubic-bezier(0.16, 1, 0.3, 1);
    }

    #tt-mouse-ui.tt-visible {
      opacity: 1;
    }

    /* Common button styles */
    .tt-mouse-btn {
      pointer-events: auto;
      background: rgba(22, 22, 28, 0.85);
      color: #ffffff;
      border: 1px solid rgba(255, 255, 255, 0.2);
      border-radius: 9999px;
      backdrop-filter: blur(16px);
      box-shadow: 0 6px 22px rgba(0, 0, 0, 0.5);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      user-select: none;
      transition: background 0.18s ease, transform 0.18s cubic-bezier(0.16, 1, 0.3, 1), border-color 0.18s ease, box-shadow 0.18s ease;
      outline: none;
      -webkit-tap-highlight-color: transparent;
    }

    .tt-mouse-btn:hover {
      background: rgba(45, 45, 55, 0.95);
      border-color: rgba(255, 255, 255, 0.45);
      transform: scale(1.06);
      box-shadow: 0 8px 28px rgba(0, 0, 0, 0.65);
    }

    .tt-mouse-btn:active {
      transform: scale(0.95);
      background: rgba(65, 65, 78, 0.98);
    }

    /* Top-Left Back Button */
    #tt-mouse-back-btn {
      position: absolute;
      top: 28px;
      left: 28px;
      height: 46px;
      padding: 0 20px 0 14px;
      gap: 10px;
      font-size: 15px;
      font-weight: 600;
      letter-spacing: 0.2px;
      display: none;
    }

    #tt-mouse-ui.tt-in-video #tt-mouse-back-btn {
      display: inline-flex;
    }

    .tt-mouse-back-icon {
      width: 20px;
      height: 20px;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    /* Top-Right Volume Control (expands INWARD from the right edge) */
    #tt-mouse-volume-wrap {
      position: absolute;
      top: 28px;
      right: 28px;
      display: flex;
      flex-direction: row-reverse;
      align-items: center;
      gap: 10px;
      pointer-events: auto;
    }

    #tt-mouse-vol-btn {
      width: 46px;
      height: 46px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    #tt-mouse-vol-btn svg {
      width: 22px;
      height: 22px;
    }

    #tt-mouse-vol-panel {
      display: flex;
      align-items: center;
      gap: 12px;
      background: rgba(22, 22, 28, 0.92);
      border: 1px solid rgba(255, 255, 255, 0.22);
      border-radius: 9999px;
      backdrop-filter: blur(16px);
      box-shadow: 0 6px 22px rgba(0, 0, 0, 0.5);
      padding: 0 16px;
      height: 46px;
      max-width: 0;
      opacity: 0;
      overflow: hidden;
      pointer-events: none;
      transition: max-width 0.28s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.22s ease, padding 0.28s ease;
    }

    #tt-mouse-volume-wrap.tt-vol-expanded #tt-mouse-vol-panel {
      max-width: 280px;
      opacity: 1;
      pointer-events: auto;
    }

    .tt-mouse-vol-track {
      position: relative;
      width: 120px;
      height: 8px;
      background: rgba(255, 255, 255, 0.18);
      border-radius: 4px;
      cursor: pointer;
      flex-shrink: 0;
    }

    .tt-mouse-vol-fill {
      position: absolute;
      left: 0;
      top: 0;
      height: 100%;
      width: 100%;
      background: #ff0000;
      border-radius: 4px;
      pointer-events: none;
      transition: width 0.04s ease-out;
    }

    .tt-mouse-vol-fill.muted {
      background: rgba(255, 255, 255, 0.35);
    }

    .tt-mouse-vol-thumb {
      position: absolute;
      top: 50%;
      width: 14px;
      height: 14px;
      background: #ffffff;
      border-radius: 50%;
      transform: translate(-50%, -50%);
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.5);
      pointer-events: none;
      transition: transform 0.12s ease;
    }

    .tt-mouse-vol-track:hover .tt-mouse-vol-thumb {
      transform: translate(-50%, -50%) scale(1.2);
    }

    .tt-mouse-vol-label {
      font-size: 13px;
      font-weight: 600;
      color: rgba(255, 255, 255, 0.9);
      min-width: 38px;
      text-align: right;
    }

    .tt-mouse-vol-mute-icon {
      cursor: pointer;
      font-size: 13px;
      opacity: 0.8;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: opacity 0.15s, transform 0.15s;
    }

    .tt-mouse-vol-mute-icon:hover {
      opacity: 1;
      transform: scale(1.1);
    }

    /* Carousel Chevrons (Left & Right) */
    .tt-mouse-carousel-chevron {
      position: absolute;
      top: 50%;
      transform: translateY(-50%);
      width: 52px;
      height: 52px;
      border-radius: 50%;
      display: none;
    }

    #tt-mouse-ui.tt-in-browse .tt-mouse-carousel-chevron {
      display: inline-flex;
    }

    /* Place left chevron clear of the YouTube TV sidebar (which occupies 0-85px) */
    #tt-mouse-scroll-left {
      left: 105px;
    }

    #tt-mouse-scroll-right {
      right: 28px;
    }

    /* Hide the left chevron completely when mouse is hovering over the sidebar menu */
    #tt-mouse-ui.tt-on-sidebar #tt-mouse-scroll-left {
      display: none !important;
    }

    .tt-mouse-carousel-chevron svg {
      width: 26px;
      height: 26px;
    }

    .tt-mouse-carousel-chevron:hover {
      transform: translateY(-50%) scale(1.1);
      border-color: rgba(255, 255, 255, 0.5);
    }

    .tt-mouse-carousel-chevron:active {
      transform: translateY(-50%) scale(0.95);
    }
  `;

  class MouseManager {
    constructor() {
      this.config = null;
      this.rootEl = null;
      this.backBtn = null;
      this.volWrap = null;
      this.volBtn = null;
      this.volPanel = null;
      this.volTrack = null;
      this.volFill = null;
      this.volThumb = null;
      this.volLabel = null;
      this.volMuteToggle = null;
      this.scrollLeftBtn = null;
      this.scrollRightBtn = null;

      this.hideTimer = null;
      this.isInactivityHidden = true;
      this.isDraggingVolume = false;
      this.isVolPanelOpen = false;
      this.scrollRepeatTimer = null;
      this.scrollRepeatInterval = null;
      this.lastWheelStepTime = 0;

      this.currentVolume = 1.0;
      this.isMuted = false;

      this.onMouseMove = this.onMouseMove.bind(this);
      this.onWheel = this.onWheel.bind(this);
      this.onAuxClick = this.onAuxClick.bind(this);
      this.checkMode = this.checkMode.bind(this);
    }

    init(config) {
      this.config = config || {};
      const mouseCfg = this.config.mouse || {};
      if (mouseCfg.enabled === false) {
        console.log('[TizenTube Mouse] Mouse subsystem disabled in config.');
        return;
      }

      this.bindEvents();

      const setupDOM = () => {
        this.injectStyles();
        this.buildUI();
        this.bindAudio();
        this.checkMode();
      };

      if (document.body) {
        setupDOM();
      } else {
        window.addEventListener('DOMContentLoaded', setupDOM, { once: true });
      }

      // Periodic check for view changes
      setInterval(this.checkMode, 500);

      console.log('[TizenTube Mouse] Mouse subsystem initialized successfully.');
    }

    injectStyles() {
      if (document.getElementById('tt-mouse-styles')) return;
      const style = document.createElement('style');
      style.id = 'tt-mouse-styles';
      style.textContent = MOUSE_CSS;
      document.head.appendChild(style);
    }

    buildUI() {
      if (this.rootEl) return;

      const container = document.createElement('div');
      container.id = 'tt-mouse-ui';
      container.innerHTML = `
        <!-- Top-Left Back Button -->
        <button id="tt-mouse-back-btn" class="tt-mouse-btn" tabindex="-1" title="Back (Escape)">
          <div class="tt-mouse-back-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <line x1="19" y1="12" x2="5" y2="12"></line>
              <polyline points="12 19 5 12 12 5"></polyline>
            </svg>
          </div>
          <span>Back</span>
        </button>

        <!-- Top-Right Volume Control (flex row-reverse expands to the left) -->
        <div id="tt-mouse-volume-wrap">
          <button id="tt-mouse-vol-btn" class="tt-mouse-btn" tabindex="-1" title="Volume (Press to show Volume Bar)">
            <svg id="tt-mouse-vol-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
              <path class="tt-vol-wave-1" d="M15.54 8.46a5 5 0 0 1 0 7.07"></path>
              <path class="tt-vol-wave-2" d="M19.07 4.93a10 10 0 0 1 0 14.14"></path>
            </svg>
          </button>
          <div id="tt-mouse-vol-panel">
            <span id="tt-mouse-vol-mute-btn" class="tt-mouse-vol-mute-icon" title="Toggle Mute">🔇</span>
            <div id="tt-mouse-vol-track" class="tt-mouse-vol-track">
              <div id="tt-mouse-vol-fill" class="tt-mouse-vol-fill"></div>
              <div id="tt-mouse-vol-thumb" class="tt-mouse-vol-thumb"></div>
            </div>
            <span id="tt-mouse-vol-label" class="tt-mouse-vol-label">100%</span>
          </div>
        </div>

        <!-- Carousel Left & Right Chevrons -->
        <button id="tt-mouse-scroll-left" class="tt-mouse-btn tt-mouse-carousel-chevron" tabindex="-1" title="Scroll Left (Previous Cards)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="15 18 9 12 15 6"></polyline>
          </svg>
        </button>
        <button id="tt-mouse-scroll-right" class="tt-mouse-btn tt-mouse-carousel-chevron" tabindex="-1" title="Scroll Right (Next Cards)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="9 18 15 12 9 6"></polyline>
          </svg>
        </button>
      `;

      document.body.appendChild(container);

      this.rootEl = container;
      this.backBtn = container.querySelector('#tt-mouse-back-btn');
      this.volWrap = container.querySelector('#tt-mouse-volume-wrap');
      this.volBtn = container.querySelector('#tt-mouse-vol-btn');
      this.volPanel = container.querySelector('#tt-mouse-vol-panel');
      this.volTrack = container.querySelector('#tt-mouse-vol-track');
      this.volFill = container.querySelector('#tt-mouse-vol-fill');
      this.volThumb = container.querySelector('#tt-mouse-vol-thumb');
      this.volLabel = container.querySelector('#tt-mouse-vol-label');
      this.volMuteToggle = container.querySelector('#tt-mouse-vol-mute-btn');
      this.scrollLeftBtn = container.querySelector('#tt-mouse-scroll-left');
      this.scrollRightBtn = container.querySelector('#tt-mouse-scroll-right');

      // Prevent ALL on-screen buttons from stealing DOM focus from the video player or cards
      for (const btn of container.querySelectorAll('button, .tt-mouse-vol-track, #tt-mouse-volume-wrap')) {
        btn.addEventListener('mousedown', (e) => {
          e.preventDefault();
        });
      }

      this.wireButtons();
    }

    wireButtons() {
      // Back Button Click
      if (this.backBtn) {
        this.backBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.handleBack();
        });
      }

      // Volume Button: PRESS to open/close volume slider bar
      if (this.volBtn && this.volWrap) {
        this.volBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.isVolPanelOpen = !this.isVolPanelOpen;
          if (this.isVolPanelOpen) {
            this.volWrap.classList.add('tt-vol-expanded');
          } else {
            this.volWrap.classList.remove('tt-vol-expanded');
          }
        });
      }

      // Mute Toggle Icon inside volume panel
      if (this.volMuteToggle) {
        this.volMuteToggle.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          window.dispatchEvent(new CustomEvent('tizentube-volume-toggle-mute'));
        });
      }

      // Slider Track Click and Drag
      if (this.volTrack) {
        const updateSliderFromEvent = (e) => {
          const rect = this.volTrack.getBoundingClientRect();
          const clientX = e.clientX !== undefined ? e.clientX : (e.touches && e.touches[0] ? e.touches[0].clientX : 0);
          const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
          
          if (window.TizenTubeAudioManager && typeof window.TizenTubeAudioManager.setVolume === 'function') {
            window.TizenTubeAudioManager.setVolume(ratio, false, true);
            if (window.TizenTubeAudioManager.isMuted()) {
              window.TizenTubeAudioManager.setMuted(false, false, true);
            }
          } else {
            window.dispatchEvent(new CustomEvent('tizentube-volume-set', { detail: { volume: ratio } }));
          }
        };

        this.volTrack.addEventListener('mousedown', (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.isDraggingVolume = true;
          updateSliderFromEvent(e);

          const onDrag = (moveEvent) => {
            if (this.isDraggingVolume) {
              updateSliderFromEvent(moveEvent);
            }
          };

          const onStopDrag = () => {
            this.isDraggingVolume = false;
            window.removeEventListener('mousemove', onDrag);
            window.removeEventListener('mouseup', onStopDrag);
            this.armInactivityTimer();
          };

          window.addEventListener('mousemove', onDrag);
          window.addEventListener('mouseup', onStopDrag);
        });

        // Wheel over volume wrap adjusts volume
        this.volWrap.addEventListener('wheel', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const delta = e.deltaY < 0 ? 0.05 : -0.05;
          window.dispatchEvent(new CustomEvent('tizentube-volume-change', { detail: { delta } }));
        }, { passive: false });
      }

      // Left & Right Scroll Chevrons with Press-and-Hold
      this.setupHoldRepeat(this.scrollLeftBtn, 'Left');
      this.setupHoldRepeat(this.scrollRightBtn, 'Right');
    }

    bindEvents() {
      // Activity tracking
      window.addEventListener('mousemove', this.onMouseMove, { passive: true });
      window.addEventListener('wheel', this.onWheel, { passive: false });
      window.addEventListener('auxclick', this.onAuxClick, { passive: false });

      // Native IPC for mouse back & forward
      ipcRenderer.on('tizentube-mouse-back', () => {
        this.handleBack();
      });

      ipcRenderer.on('tizentube-mouse-forward', () => {
        this.sendKey('Right');
      });
    }

    setupHoldRepeat(buttonEl, keyCode) {
      if (!buttonEl) return;

      const triggerAction = () => {
        this.sendKey(keyCode);
      };

      const startHold = (e) => {
        e.preventDefault();
        e.stopPropagation();
        triggerAction();

        this.clearHold();
        this.scrollRepeatTimer = setTimeout(() => {
          this.scrollRepeatInterval = setInterval(triggerAction, 140);
        }, 260);
      };

      buttonEl.addEventListener('mousedown', startHold);
      buttonEl.addEventListener('mouseleave', () => this.clearHold());
      buttonEl.addEventListener('mouseup', () => this.clearHold());
    }

    clearHold() {
      if (this.scrollRepeatTimer) {
        clearTimeout(this.scrollRepeatTimer);
        this.scrollRepeatTimer = null;
      }
      if (this.scrollRepeatInterval) {
        clearInterval(this.scrollRepeatInterval);
        this.scrollRepeatInterval = null;
      }
    }

    bindAudio() {
      const updateUI = ({ volume, muted }) => {
        this.currentVolume = typeof volume === 'number' ? volume : 1.0;
        this.isMuted = !!muted;
        this.renderVolumeState();
      };

      if (window.TizenTubeAudioManager && typeof window.TizenTubeAudioManager.addListener === 'function') {
        window.TizenTubeAudioManager.addListener(updateUI);
      } else {
        window.addEventListener('tizentube-volume-change', () => {
          if (window.TizenTubeAudioManager) {
            updateUI({
              volume: window.TizenTubeAudioManager.getVolume(),
              muted: window.TizenTubeAudioManager.isMuted()
            });
          }
        });
      }
    }

    renderVolumeState() {
      if (!this.volFill || !this.volThumb || !this.volLabel || !this.volBtn) return;

      const pct = this.isMuted ? 0 : Math.round(this.currentVolume * 100);
      this.volFill.style.width = pct + '%';
      this.volThumb.style.left = pct + '%';

      if (this.isMuted) {
        this.volFill.classList.add('muted');
        this.volLabel.textContent = 'Muted';
        if (this.volMuteToggle) this.volMuteToggle.textContent = '🔊';
      } else {
        this.volFill.classList.remove('muted');
        this.volLabel.textContent = pct + '%';
        if (this.volMuteToggle) this.volMuteToggle.textContent = '🔇';
      }

      // Update speaker icon
      const icon = document.getElementById('tt-mouse-vol-icon');
      if (icon) {
        if (this.isMuted || pct === 0) {
          icon.innerHTML = `
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
            <line x1="23" y1="9" x2="17" y2="15"></line>
            <line x1="17" y1="9" x2="23" y2="15"></line>
          `;
        } else if (pct < 50) {
          icon.innerHTML = `
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
            <path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path>
          `;
        } else {
          icon.innerHTML = `
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
            <path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path>
            <path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path>
          `;
        }
      }
    }

    checkMode() {
      if (!this.rootEl) return;

      const isVideo = this.isInsideVideo();
      if (isVideo) {
        this.rootEl.classList.add('tt-in-video');
        this.rootEl.classList.remove('tt-in-browse');
      } else {
        this.rootEl.classList.remove('tt-in-video');
        this.rootEl.classList.add('tt-in-browse');
      }
    }

    isInsideVideo() {
      const href = window.location.href || '';
      const hash = window.location.hash || '';
      if (hash.includes('watch') || href.includes('watch?v=')) {
        return true;
      }

      const player = document.getElementById('movie_player');
      if (player) {
        // YouTube Leanback classes when in video mode
        if (player.classList.contains('playing-mode') || 
            player.classList.contains('paused-mode') || 
            player.classList.contains('buffering-mode')) {
          return true;
        }

        // Check player state: 1 (playing), 2 (paused), 3 (buffering)
        if (typeof player.getPlayerState === 'function') {
          const state = player.getPlayerState();
          if (state === 1 || state === 2 || state === 3) {
            return true;
          }
        }

        if (typeof player.getVideoData === 'function') {
          const data = player.getVideoData();
          if (data && data.video_id) {
            const video = document.querySelector('video');
            if (video && (!video.paused || video.currentTime > 1)) {
              return true;
            }
          }
        }
      }

      return false;
    }

    onMouseMove(e) {
      if (this.rootEl) {
        this.rootEl.classList.add('tt-visible');
        this.isInactivityHidden = false;

        // If hovering over the left sidebar menu (0-95px), hide the left chevron so menu is unobstructed
        if (e && typeof e.clientX === 'number') {
          if (e.clientX < 100) {
            this.rootEl.classList.add('tt-on-sidebar');
          } else {
            this.rootEl.classList.remove('tt-on-sidebar');
          }
        }
      }
      this.armInactivityTimer();
    }

    armInactivityTimer() {
      if (this.hideTimer) {
        clearTimeout(this.hideTimer);
      }

      const delay = (this.config.mouse && this.config.mouse.autoHideDelayMs) || 2500;
      this.hideTimer = setTimeout(() => {
        // Do not hide if user is currently interacting with the volume slider or holding scroll
        if (this.isDraggingVolume || this.scrollRepeatInterval) return;

        if (this.rootEl) {
          this.rootEl.classList.remove('tt-visible');
          this.isInactivityHidden = true;
        }
        if (this.volWrap) {
          this.volWrap.classList.remove('tt-vol-expanded');
          this.isVolPanelOpen = false;
        }
      }, delay);
    }

    onWheel(e) {
      this.onMouseMove(e);

      // If hovering over the volume control or overlay, allow local handling
      const target = e.target;
      if (target && target.closest && (target.closest('#tt-mouse-volume-wrap') || target.closest('#tizentube-overlay-container'))) {
        return;
      }

      // If Ctrl key is held, adjust volume anywhere
      if (e.ctrlKey) {
        e.preventDefault();
        const delta = e.deltaY < 0 ? 0.05 : -0.05;
        window.dispatchEvent(new CustomEvent('tizentube-volume-change', { detail: { delta } }));
        return;
      }

      // In browse mode: support gentle, throttled navigation without hijacking normal input
      if (!this.isInsideVideo()) {
        // Ignore wheel if cursor is on the sidebar menu (let menu handle itself)
        if (e.clientX < 100) {
          return;
        }

        const now = performance.now();
        if (now - this.lastWheelStepTime < 240) {
          // Still in cooldown period; prevent runaway events
          e.preventDefault();
          return;
        }

        const threshold = 55;
        if (Math.abs(e.deltaX) > Math.abs(e.deltaY) && Math.abs(e.deltaX) > threshold) {
          e.preventDefault();
          this.lastWheelStepTime = now;
          this.sendKey(e.deltaX > 0 ? 'Right' : 'Left');
        } else if (Math.abs(e.deltaY) > threshold) {
          e.preventDefault();
          this.lastWheelStepTime = now;
          // Vertical wheel scrolls rows: Down for down, Up for up
          this.sendKey(e.deltaY > 0 ? 'Down' : 'Up');
        }
      }
    }

    onAuxClick(e) {
      // Button 3 is the standard browser/mouse side Back button (XButton1)
      if (e.button === 3) {
        e.preventDefault();
        e.stopPropagation();
        this.handleBack();
      } else if (e.button === 4) {
        // Button 4 is standard Forward button (XButton2)
        e.preventDefault();
        e.stopPropagation();
        this.sendKey('Right');
      }
    }

    handleBack() {
      // 1. If settings overlay is visible, close overlay
      const overlay = document.getElementById('tizentube-overlay-container');
      if (overlay && overlay.classList.contains('visible')) {
        window.dispatchEvent(new CustomEvent('tizentube-overlay-key', { detail: { action: 'Escape' } }));
        return;
      }

      // 2. Clear startup prompt if visible
      window.dispatchEvent(new CustomEvent('tizentube-dismiss-prompt'));

      // 3. Clear any DOM focus on mouse buttons so keys hit the app
      if (document.activeElement && document.activeElement.blur) {
        document.activeElement.blur();
      }

      // 4. Send native Escape to exit player or return to previous screen
      this.sendKey('Escape');

      // 5. In Leanback, if first Escape merely reveals player controls, send a follow-up
      // or history.back() to reliably exit the video player
      if (this.isInsideVideo()) {
        setTimeout(() => {
          if (this.isInsideVideo()) {
            this.sendKey('Escape');
          }
        }, 160);
      }
    }

    sendKey(keyCode) {
      if (!keyCode) return;

      // 1. Send native Chromium key event via main process
      ipcRenderer.send('send-native-key', { keyCode });

      // 2. Also dispatch trusted-style DOM KeyboardEvent directly to active element / body
      try {
        const keyMap = {
          Return: 'Enter',
          Up: 'ArrowUp',
          Down: 'ArrowDown',
          Left: 'ArrowLeft',
          Right: 'ArrowRight',
          Escape: 'Escape'
        };
        const key = keyMap[keyCode] || keyCode;
        const code = key === 'Enter' ? 'Enter' : (key === 'Escape' ? 'Escape' : key);
        const whichMap = { Escape: 27, Return: 13, Left: 37, Up: 38, Right: 39, Down: 40 };
        const which = whichMap[keyCode] || 0;

        const target = (document.activeElement && document.activeElement !== document.body) 
          ? document.activeElement 
          : (document.getElementById('movie_player') || document.body || window);

        const downEvt = new KeyboardEvent('keydown', { key, code, keyCode: which, which, bubbles: true, cancelable: true });
        target.dispatchEvent(downEvt);

        setTimeout(() => {
          const upEvt = new KeyboardEvent('keyup', { key, code, keyCode: which, which, bubbles: true, cancelable: true });
          target.dispatchEvent(upEvt);
        }, 30);
      } catch (err) {}
    }
  }

  window.TizenTubeMouseManager = new MouseManager();
})();
