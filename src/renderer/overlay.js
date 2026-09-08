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
 * TizenTube Windows - In-App Quick Settings & Controller Tester Overlay
 */

(function () {
  const { ipcRenderer } = require('electron');

  const OVERLAY_CSS = `
    /* YouTube dark-theme palette. Prefixed --tt- so nothing collides with
       YouTube's own --yt-* custom properties on the page we inject into. */
    :root {
      --tt-bg:          #0f0f0f;  /* page backdrop            */
      --tt-surface:     #212121;  /* dialogs and menus        */
      --tt-surface-2:   #282828;  /* raised rows and chips    */
      --tt-surface-3:   #383838;  /* hover                    */
      --tt-border:      #303030;
      --tt-border-2:    #3f3f3f;
      --tt-text:        #f1f1f1;  /* primary text             */
      --tt-text-2:      #aaaaaa;  /* secondary text           */
      --tt-text-3:      #717171;  /* hints                    */
      --tt-accent:      #ff0000;  /* brand red, for fills          */
      --tt-accent-text: #ff5c54;  /* small text: 4.85:1 on surface */
      --tt-accent-dim:  rgba(255, 0, 0, 0.35);
      --tt-red:         #ff0000;  /* brand red                */
      --tt-red-hover:   #cc0000;
      --tt-focus:       #ffffff;  /* Leanback focus is a light fill */
      --tt-focus-fg:    #0f0f0f;
      --tt-radius:      12px;
      --tt-radius-pill: 999px;
      --tt-font: 'YouTube Sans', Roboto, 'Segoe UI', Arial, sans-serif;
    }

    #tizentube-overlay-container {
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      background: rgba(15, 15, 15, 0.92);
      backdrop-filter: blur(12px);
      z-index: 2147483647;
      display: flex;
      justify-content: center;
      align-items: center;
      font-family: var(--tt-font);
      color: var(--tt-text);
      user-select: none;
      box-sizing: border-box;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.2s ease-in-out;
    }

    #tizentube-overlay-container.visible {
      opacity: 1;
      pointer-events: auto;
    }

    .tt-modal {
      width: 820px;
      max-width: 92vw;
      max-height: 88vh;
      background: var(--tt-surface);
      border: 1px solid var(--tt-border);
      border-radius: 16px;
      box-shadow: 0 20px 50px rgba(0,0,0,0.8);
      overflow-y: auto;
      padding: 32px;
      display: flex;
      flex-direction: column;
      gap: 24px;
    }

    .tt-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1px solid var(--tt-border);
      padding-bottom: 16px;
    }

    .tt-title {
      font-size: 26px;
      font-weight: 700;
      color: var(--tt-text);
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .tt-close-btn {
      background: var(--tt-surface-2);
      border: 1px solid var(--tt-border-2);
      color: var(--tt-text);
      padding: 8px 18px;
      border-radius: var(--tt-radius-pill);
      cursor: pointer;
      font-size: 15px;
      font-weight: 600;
      transition: background 0.15s;
    }
    .tt-close-btn:hover {
      background: var(--tt-surface-3);
      border-color: var(--tt-border-2);
    }

    .tt-section {
      background: var(--tt-surface-2);
      border-radius: var(--tt-radius);
      padding: 20px;
      border: 1px solid var(--tt-border);
    }

    .tt-section-title {
      font-size: 17px;
      font-weight: 600;
      margin-bottom: 14px;
      color: var(--tt-text);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    /* Live Gamepad Visualizer */
    .tt-gamepad-visualizer {
      display: flex;
      gap: 24px;
      align-items: center;
    }

    .tt-stick-box {
      width: 110px;
      height: 110px;
      background: var(--tt-bg);
      border: 2px solid var(--tt-border-2);
      border-radius: 50%;
      position: relative;
      flex-shrink: 0;
    }

    .tt-stick-deadzone {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      border: 1px dashed var(--tt-text-3);
      border-radius: 50%;
      pointer-events: none;
    }

    .tt-stick-dot {
      width: 22px;
      height: 22px;
      background: var(--tt-accent);
      border-radius: 50%;
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      box-shadow: 0 0 10px rgba(255, 0, 0, 0.55);
      transition: background 0.05s;
    }

    .tt-buttons-grid {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      flex-grow: 1;
    }

    .tt-btn-pill {
      background: var(--tt-surface-2);
      border: 1px solid var(--tt-border-2);
      padding: 6px 12px;
      border-radius: 6px;
      font-size: 13px;
      color: var(--tt-text-2);
      transition: all 0.05s;
    }
    .tt-btn-pill.pressed {
      background: var(--tt-accent);
      color: var(--tt-focus-fg);
      border-color: var(--tt-accent);
      font-weight: 700;
      box-shadow: 0 0 8px rgba(255, 0, 0, 0.5);
    }

    /* Sliders & Controls */
    .tt-control-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 14px;
      gap: 16px;
    }
    .tt-control-row:last-child {
      margin-bottom: 0;
    }

    .tt-label {
      font-size: 15px;
      font-weight: 500;
      color: var(--tt-text);
    }
    .tt-sublabel {
      font-size: 12px;
      color: var(--tt-text-2);
      margin-top: 2px;
    }

    .tt-slider-group {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    input[type=range] {
      -webkit-appearance: none;
      width: 180px;
      height: 6px;
      background: var(--tt-border);
      border-radius: 3px;
      outline: none;
    }
    input[type=range]::-webkit-slider-thumb {
      -webkit-appearance: none;
      width: 18px;
      height: 18px;
      background: var(--tt-accent);
      border-radius: 50%;
      cursor: pointer;
    }

    .tt-value-display {
      font-size: 14px;
      font-weight: 600;
      color: var(--tt-accent-text);
      min-width: 48px;
      text-align: right;
    }

    /* Toggle Switch */
    .tt-switch {
      position: relative;
      display: inline-block;
      width: 48px;
      height: 26px;
      flex-shrink: 0;
    }
    .tt-switch input {
      opacity: 0;
      width: 0;
      height: 0;
    }
    .tt-switch-slider {
      position: absolute;
      cursor: pointer;
      top: 0; left: 0; right: 0; bottom: 0;
      background-color: var(--tt-border);
      transition: .2s;
      border-radius: 26px;
    }
    .tt-switch-slider:before {
      position: absolute;
      content: "";
      height: 20px;
      width: 20px;
      left: 3px;
      bottom: 3px;
      background-color: white;
      transition: .2s;
      border-radius: 50%;
    }
    input:checked + .tt-switch-slider {
      background-color: var(--tt-accent);
    }
    input:checked + .tt-switch-slider:before {
      transform: translateX(22px);
    }

    .tt-footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-top: 10px;
      border-top: 1px solid var(--tt-border);
    }

    .tt-action-btn {
      background: var(--tt-surface-2);
      border: 1px solid var(--tt-border-2);
      color: var(--tt-text);
      padding: 10px 22px;
      border-radius: var(--tt-radius-pill);
      cursor: pointer;
      font-size: 14px;
      font-weight: 600;
      transition: background 0.15s;
    }
    .tt-action-btn:hover {
      background: var(--tt-surface-3);
      color: var(--tt-text);
    }
    .tt-action-btn.primary {
      background: var(--tt-focus);
      color: var(--tt-focus-fg);
      border-color: var(--tt-focus);
    }
    .tt-action-btn.primary:hover {
      background: var(--tt-text-2);
      border-color: var(--tt-text-2);
    }
    .tt-action-btn.danger:hover {
      background: var(--tt-red);
      color: var(--tt-text);
      border-color: var(--tt-red);
    }

    /* Controller focus ring */
    /* YouTube's TV UI marks focus with a bright fill rather than a thin ring,
       because a 1-2px outline disappears at couch distance. */
    .tt-focused {
      outline: 3px solid var(--tt-focus) !important;
      outline-offset: 4px;
      border-radius: 8px;
      box-shadow: 0 0 0 7px rgba(255, 255, 255, 0.12) !important;
    }

    .tt-hint {
      font-size: 12px;
      color: var(--tt-text-3);
      text-align: center;
      padding-top: 4px;
    }

    /* Fullscreen startup prompt */
    #tt-fullscreen-prompt {
      position: fixed;
      top: 24px;
      left: 50%;
      transform: translateX(-50%) translateY(-12px);
      z-index: 2147483645;
      background: var(--tt-surface);
      border: 1px solid var(--tt-accent);
      border-radius: 30px;
      padding: 8px 18px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.8), 0 0 14px var(--tt-accent-dim);
      backdrop-filter: blur(12px);
      display: flex;
      align-items: center;
      gap: 14px;
      font-family: var(--tt-font);
      color: var(--tt-text);
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.25s ease, transform 0.25s ease;
      user-select: none;
    }

    #tt-fullscreen-prompt.visible {
      opacity: 1;
      transform: translateX(-50%) translateY(0);
      pointer-events: auto;
    }

    .tt-fs-icon {
      font-size: 16px;
      color: var(--tt-accent);
      line-height: 1;
    }

    .tt-fs-text {
      font-size: 13px;
      color: var(--tt-text);
    }
    .tt-fs-text strong {
      color: var(--tt-accent);
      font-weight: 600;
    }

    .tt-fs-btn {
      background: var(--tt-accent);
      color: var(--tt-focus-fg);
      border: none;
      border-radius: 14px;
      padding: 5px 12px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.15s;
    }
    .tt-fs-btn:hover {
      background: var(--tt-accent);
    }

    .tt-fs-close {
      background: transparent;
      border: none;
      color: var(--tt-text-2);
      font-size: 18px;
      cursor: pointer;
      padding: 0 4px;
      line-height: 1;
      transition: color 0.15s;
    }
    .tt-fs-close:hover {
      color: var(--tt-text);
    }
  `;

  // Pixels the visualiser dot moves from centre at full stick deflection.
  const STICK_TRAVEL_PX = 40;

  // The overlay is laid out in px against this width. The app renders at the
  // panel's native resolution, so on a 4K screen everything is scaled up to
  // match rather than sitting tiny in the middle.
  const OVERLAY_DESIGN_WIDTH = 1920;

  // Controls the D-Pad walks through, in visual order.
  const FOCUS_ORDER = [
    { id: 'tt-input-volume', type: 'range' },
    { id: 'tt-toggle-mute', type: 'checkbox' },
    { id: 'tt-input-deadzone', type: 'range' },
    { id: 'tt-input-repeat', type: 'range' },
    { id: 'tt-toggle-vibration', type: 'checkbox' },
    { id: 'tt-toggle-fullscreen', type: 'checkbox' },
    { id: 'tt-toggle-autohide', type: 'checkbox' },
    { id: 'tt-toggle-sleep', type: 'checkbox' },
    { id: 'tt-toggle-autoupdate', type: 'checkbox' },
    { id: 'tt-btn-save', type: 'button' },
    { id: 'tt-btn-reload', type: 'button' },
    { id: 'tt-btn-exit', type: 'button' }
  ];

  class SettingsOverlay {
    constructor() {
      this.container = null;
      this.config = null;
      this.isVisible = false;
      this.buttonPills = new Map();
      this.focusables = [];
      this.focusIndex = 0;
      this.fsPromptEl = null;
      this.fsPromptTimer = null;
      this.init();
    }

    async init() {
      const runInit = async () => {
        this.injectStyles();
        this.createDOM();
        // Listeners are wired before the config arrives so that F2 and the
        // controller's overlay button work even if the config fetch fails.
        this.setupListeners();
        try {
          this.config = await ipcRenderer.invoke('get-config');
          this.populateForm();
        } catch (err) {
          console.error('[TizenTube Overlay] Could not load config:', err);
        }
      };

      if (document.body) {
        runInit();
      } else {
        window.addEventListener('DOMContentLoaded', runInit, { once: true });
      }
    }

    injectStyles() {
      const style = document.createElement('style');
      style.id = 'tizentube-overlay-styles';
      style.textContent = OVERLAY_CSS;
      (document.head || document.documentElement).appendChild(style);
    }

    getSafeHTML(htmlString) {
      if (typeof window !== 'undefined' && window.trustedTypes && window.trustedTypes.createPolicy) {
        try {
          if (!window._ttOverlayPolicy) {
            window._ttOverlayPolicy = window.trustedTypes.createPolicy('tizentube-overlay', {
              createHTML: (s) => s
            });
          }
          return window._ttOverlayPolicy.createHTML(htmlString);
        } catch (e) {
          if (window._ttOverlayPolicy && window._ttOverlayPolicy.createHTML) {
            return window._ttOverlayPolicy.createHTML(htmlString);
          }
        }
      }
      return htmlString;
    }

    createDOM() {
      const container = document.createElement('div');
      container.id = 'tizentube-overlay-container';
      container.innerHTML = this.getSafeHTML(`
        <div class="tt-modal" role="dialog">
          <div class="tt-header">
            <div class="tt-title">
              <span>TizenTube Settings</span>
            </div>
            <button class="tt-close-btn" id="tt-btn-close">Close / Resume (B or Start)</button>
          </div>

          <!-- Section 1: Gamepad Diagnostics -->
          <div class="tt-section">
            <div class="tt-section-title">
              <span>Controller Diagnostics</span>
              <span id="tt-controller-status" style="font-size: 13px; color: #888;">Scanning for controller...</span>
            </div>
            <div class="tt-gamepad-visualizer">
              <div class="tt-stick-box" id="tt-stick-box" title="Left Analog Stick position & Deadzone">
                <div class="tt-stick-deadzone" id="tt-stick-deadzone"></div>
                <div class="tt-stick-dot" id="tt-stick-dot"></div>
              </div>
              <div class="tt-buttons-grid" id="tt-buttons-grid">
                <div class="tt-btn-pill" data-btn="0">A / Cross</div>
                <div class="tt-btn-pill" data-btn="1">B / Circle</div>
                <div class="tt-btn-pill" data-btn="2">X / Square</div>
                <div class="tt-btn-pill" data-btn="3">Y / Triangle</div>
                <div class="tt-btn-pill" data-btn="4">LB</div>
                <div class="tt-btn-pill" data-btn="5">RB</div>
                <div class="tt-btn-pill" data-btn="6">LT</div>
                <div class="tt-btn-pill" data-btn="7">RT</div>
                <div class="tt-btn-pill" data-btn="8">View / Back</div>
                <div class="tt-btn-pill" data-btn="9">Start / Menu</div>
                <div class="tt-btn-pill" data-btn="10">L3</div>
                <div class="tt-btn-pill" data-btn="11">R3</div>
                <div class="tt-btn-pill" data-btn="12">D-Up</div>
                <div class="tt-btn-pill" data-btn="13">D-Down</div>
                <div class="tt-btn-pill" data-btn="14">D-Left</div>
                <div class="tt-btn-pill" data-btn="15">D-Right</div>
              </div>
            </div>
          </div>

          <!-- Section 2: Controller Calibration -->
          <div class="tt-section">
            <div class="tt-section-title">Controller Calibration</div>
            
            <div class="tt-control-row">
              <div>
                <div class="tt-label">Analog Stick Deadzone</div>
                <div class="tt-sublabel">Filters out stick drift. Lower is more responsive.</div>
              </div>
              <div class="tt-slider-group">
                <input type="range" id="tt-input-deadzone" min="0.05" max="0.50" step="0.05" value="0.25">
                <span class="tt-value-display" id="tt-val-deadzone">0.25</span>
              </div>
            </div>

            <div class="tt-control-row">
              <div>
                <div class="tt-label">Key Repeat Interval</div>
                <div class="tt-sublabel">Speed of navigation while holding stick/D-pad.</div>
              </div>
              <div class="tt-slider-group">
                <input type="range" id="tt-input-repeat" min="60" max="250" step="10" value="110">
                <span class="tt-value-display" id="tt-val-repeat">110ms</span>
              </div>
            </div>

            <div class="tt-control-row">
              <div>
                <div class="tt-label">Controller Vibration</div>
                <div class="tt-sublabel">Tactile haptic feedback on button presses and stick navigation.</div>
              </div>
              <label class="tt-switch">
                <input type="checkbox" id="tt-toggle-vibration">
                <span class="tt-switch-slider"></span>
              </label>
            </div>
          </div>

          <!-- Section 3: Audio Settings -->
          <div class="tt-section">
            <div class="tt-section-title">Audio</div>

            <div class="tt-control-row">
              <div>
                <div class="tt-label">Application Volume</div>
                <div class="tt-sublabel">Adjust playback volume of TizenTube.</div>
              </div>
              <div class="tt-slider-group">
                <input type="range" id="tt-input-volume" min="0" max="100" step="5" value="100">
                <span class="tt-value-display" id="tt-val-volume">100%</span>
              </div>
            </div>

            <div class="tt-control-row">
              <div>
                <div class="tt-label">Mute Audio</div>
                <div class="tt-sublabel">Mute all sound output from the application.</div>
              </div>
              <label class="tt-switch">
                <input type="checkbox" id="tt-toggle-mute">
                <span class="tt-switch-slider"></span>
              </label>
            </div>
          </div>

          <!-- Section 4: Display & Features -->
          <div class="tt-section">
            <div class="tt-section-title">Display & Application</div>

            <div class="tt-control-row">
              <div>
                <div class="tt-label">Fullscreen Mode</div>
                <div class="tt-sublabel">Run in borderless fullscreen for TV / living room setups.</div>
              </div>
              <label class="tt-switch">
                <input type="checkbox" id="tt-toggle-fullscreen">
                <span class="tt-switch-slider"></span>
              </label>
            </div>

            <div class="tt-control-row">
              <div>
                <div class="tt-label">Auto-Hide Mouse Cursor</div>
                <div class="tt-sublabel">Hides cursor when navigating with controller or after inactivity.</div>
              </div>
              <label class="tt-switch">
                <input type="checkbox" id="tt-toggle-autohide">
                <span class="tt-switch-slider"></span>
              </label>
            </div>

            <div class="tt-control-row">
              <div>
                <div class="tt-label">Prevent Display Sleep</div>
                <div class="tt-sublabel">Keep screen awake while the app is active.</div>
              </div>
              <label class="tt-switch">
                <input type="checkbox" id="tt-toggle-sleep">
                <span class="tt-switch-slider"></span>
              </label>
            </div>

            <div class="tt-control-row">
              <div>
                <div class="tt-label">Auto-Update TizenTube Script</div>
                <div class="tt-sublabel">Automatically checks for the newest ad-block & SponsorBlock scripts.</div>
              </div>
              <label class="tt-switch">
                <input type="checkbox" id="tt-toggle-autoupdate">
                <span class="tt-switch-slider"></span>
              </label>
            </div>
          </div>

          <!-- Footer Actions -->
          <div class="tt-footer">
            <button class="tt-action-btn danger" id="tt-btn-exit">Exit App</button>
            <div style="display: flex; gap: 12px;">
              <button class="tt-action-btn" id="tt-btn-reload">Reload YouTube</button>
              <button class="tt-action-btn primary" id="tt-btn-save">Save & Close</button>
            </div>
          </div>
          <div class="tt-hint">D-Pad / Stick to move &middot; Left & Right to adjust &middot; A to activate &middot; B or Start to close</div>
        </div>
      `);

      (document.body || document.documentElement).appendChild(container);
      this.container = container;

      this.buttonPills.clear();
      for (const pill of container.querySelectorAll('.tt-btn-pill[data-btn]')) {
        this.buttonPills.set(parseInt(pill.dataset.btn, 10), pill);
      }

      this.focusables = FOCUS_ORDER
        .map((entry) => Object.assign({}, entry, { el: document.getElementById(entry.id) }))
        .filter((entry) => entry.el);

      this.applyViewportScale();
      window.addEventListener('resize', () => this.applyViewportScale());
      this.createFullscreenPrompt();
    }

    setValue(id, value) {
      const el = document.getElementById(id);
      if (el) el.value = value;
    }

    setText(id, text) {
      const el = document.getElementById(id);
      if (el) el.textContent = text;
    }

    setChecked(id, checked) {
      const el = document.getElementById(id);
      if (el) el.checked = !!checked;
    }

    populateForm() {
      if (!this.config) return;
      const controller = this.config.controller || {};
      const display = this.config.display || {};
      const tizentube = this.config.tizentube || {};

      const dz = controller.deadzone || 0.25;
      const rp = controller.repeatIntervalMs || 110;
      const audio = this.config.audio || {};
      // Number.isFinite, not typeof: NaN is a 'number' and would render "NaN%"
      // and leave the slider with no valid position.
      const vol = Number.isFinite(audio.volume)
        ? Math.max(0, Math.min(100, Math.round(audio.volume * 100)))
        : 100;
      const muted = !!audio.muted;

      this.setValue('tt-input-volume', vol);
      this.setText('tt-val-volume', vol + '%');
      this.setChecked('tt-toggle-mute', muted);

      this.setValue('tt-input-deadzone', dz);
      this.setText('tt-val-deadzone', dz.toFixed(2));
      this.updateDeadzoneVisual(dz);

      this.setValue('tt-input-repeat', rp);
      this.setText('tt-val-repeat', rp + 'ms');

      this.setChecked('tt-toggle-vibration', controller.vibration !== false);
      this.setChecked('tt-toggle-fullscreen', display.fullscreen);
      this.setChecked('tt-toggle-autohide', display.autoHideCursor);
      this.setChecked('tt-toggle-sleep', display.preventDisplaySleep);
      this.setChecked('tt-toggle-autoupdate', tizentube.autoUpdateScript);

      // If started in windowed mode, show startup prompt
      if (!display.fullscreen) {
        setTimeout(() => {
          if (this.config && !this.config.display.fullscreen) {
            this.showFullscreenPrompt(8000);
          }
        }, 800);
      }
    }

    // The dot travels STICK_TRAVEL_PX from the centre at full deflection, so a
    // deadzone of dz is a circle of radius dz * STICK_TRAVEL_PX.
    updateDeadzoneVisual(dz) {
      const dzCircle = document.getElementById('tt-stick-deadzone');
      if (dzCircle) {
        const sizePx = Math.round(dz * STICK_TRAVEL_PX * 2);
        dzCircle.style.width = sizePx + 'px';
        dzCircle.style.height = sizePx + 'px';
      }
    }

    on(id, event, handler) {
      const el = document.getElementById(id);
      if (el) el.addEventListener(event, handler);
    }

    pushConfigToController() {
      if (window.TizenTubeGamepadManager) {
        window.TizenTubeGamepadManager.updateConfig(this.config);
      }
    }

    setupListeners() {
      // Sliders
      this.on('tt-input-volume', 'input', (e) => {
        const val = parseInt(e.target.value, 10);
        this.setText('tt-val-volume', val + '%');
        if (!this.config) return;
        this.config.audio = this.config.audio || {};
        this.config.audio.volume = val / 100;
        if (window.TizenTubeAudioManager) {
          window.TizenTubeAudioManager.setVolume(val / 100, true, false);
        }
      });

      this.on('tt-input-deadzone', 'input', (e) => {
        const val = parseFloat(e.target.value);
        this.setText('tt-val-deadzone', val.toFixed(2));
        this.updateDeadzoneVisual(val);
        if (!this.config) return;
        this.config.controller.deadzone = val;
        this.pushConfigToController();
      });

      this.on('tt-input-repeat', 'input', (e) => {
        const val = parseInt(e.target.value, 10);
        this.setText('tt-val-repeat', val + 'ms');
        if (!this.config) return;
        this.config.controller.repeatIntervalMs = val;
        this.pushConfigToController();
      });

      // Toggles
      this.on('tt-toggle-vibration', 'change', (e) => {
        if (!this.config) return;
        if (!this.config.controller) this.config.controller = {};
        this.config.controller.vibration = e.target.checked;
        this.pushConfigToController();
        if (e.target.checked && window.TizenTubeGamepadManager) {
          window.TizenTubeGamepadManager.triggerHaptic('test', 0);
        }
      });
      this.on('tt-toggle-mute', 'change', (e) => {
        if (!this.config) return;
        this.config.audio = this.config.audio || {};
        this.config.audio.muted = e.target.checked;
        if (window.TizenTubeAudioManager) {
          window.TizenTubeAudioManager.setMuted(e.target.checked, true, false);
        }
      });
      this.on('tt-toggle-fullscreen', 'change', (e) => {
        if (this.config) this.config.display.fullscreen = e.target.checked;
      });
      this.on('tt-toggle-autohide', 'change', (e) => {
        if (!this.config) return;
        this.config.display.autoHideCursor = e.target.checked;
        // Apply immediately so the setting can be judged without a restart.
        this.pushConfigToController();
      });
      this.on('tt-toggle-sleep', 'change', (e) => {
        if (this.config) this.config.display.preventDisplaySleep = e.target.checked;
      });
      this.on('tt-toggle-autoupdate', 'change', (e) => {
        if (this.config) this.config.tizentube.autoUpdateScript = e.target.checked;
      });

      // Buttons
      this.on('tt-btn-close', 'click', () => this.toggle(false));
      this.on('tt-btn-save', 'click', async () => {
        if (this.config) {
          try {
            this.config = await ipcRenderer.invoke('save-config', this.config);
            this.pushConfigToController();
            if (window.TizenTubeAudioManager && this.config.audio) {
              window.TizenTubeAudioManager.setVolume(this.config.audio.volume, false, false);
              window.TizenTubeAudioManager.setMuted(this.config.audio.muted, false, false);
            }
          } catch (err) {
            console.error('[TizenTube Overlay] Failed to save config:', err);
          }
        }
        this.toggle(false);
      });
      this.on('tt-btn-reload', 'click', () => {
        window.location.reload();
      });
      this.on('tt-btn-exit', 'click', () => {
        ipcRenderer.invoke('exit-app');
      });

      // Window events from GamepadManager & Main Process
      window.addEventListener('tizentube-toggle-overlay', () => this.toggle());
      ipcRenderer.on('toggle-overlay', () => this.toggle());

      // The resulting fullscreen-changed broadcast updates our copy and the UI.
      window.addEventListener('tizentube-toggle-fullscreen', () => {
        ipcRenderer.invoke('toggle-fullscreen')
          .catch((err) => console.error('[TizenTube Overlay] Fullscreen toggle failed:', err));
      });

      // Keep our copy of the config in step when fullscreen changes elsewhere
      // (F11, or the controller's fullscreen button).
      ipcRenderer.on('fullscreen-changed', (event, isFullscreen) => {
        if (this.config) this.config.display.fullscreen = isFullscreen;
        const el = document.getElementById('tt-toggle-fullscreen');
        if (el) el.checked = isFullscreen;
        if (isFullscreen) {
          this.hideFullscreenPrompt();
        }
      });

      // Controller input when overlay is open
      window.addEventListener('tizentube-overlay-key', (e) => {
        if (!this.isVisible) return;
        this.handleControllerAction(e.detail ? e.detail.action : null);
      });

      // The startup banner is not part of the modal, so it never receives
      // overlay-key events. Let Back/B dismiss it rather than leaving a control
      // on screen that only a mouse can clear.
      window.addEventListener('tizentube-dismiss-prompt', () => this.hideFullscreenPrompt());

      // Hook Gamepad diagnostics to update visualizer
      if (window.TizenTubeGamepadManager) {
        window.TizenTubeGamepadManager.onStateChange((gamepad) => {
          if (!this.isVisible) return;
          this.updateVisualizer(gamepad);
        });
      }

      // Hook Audio manager to sync volume / mute changes
      if (window.TizenTubeAudioManager) {
        window.TizenTubeAudioManager.onStateChange(({ volume, muted }) => {
          const volPct = Math.round(volume * 100);
          this.setValue('tt-input-volume', volPct);
          this.setText('tt-val-volume', volPct + '%');
          this.setChecked('tt-toggle-mute', muted);
          if (this.config) {
            this.config.audio = this.config.audio || {};
            this.config.audio.volume = volume;
            this.config.audio.muted = muted;
          }
        });
      }
    }

    updateVisualizer(gamepad) {
      const statusEl = document.getElementById('tt-controller-status');
      if (!statusEl) return;

      if (!gamepad) {
        statusEl.textContent = 'No controller detected — press a button on it';
        statusEl.style.color = '#888';
        for (const pill of this.buttonPills.values()) {
          pill.classList.remove('pressed');
        }
        return;
      }

      statusEl.textContent = gamepad.id.slice(0, 42);
      statusEl.style.color = 'var(--tt-accent-text)';

      // Analog stick
      const dot = document.getElementById('tt-stick-dot');
      if (dot) {
        const axisX = gamepad.axes[0] || 0;
        const axisY = gamepad.axes[1] || 0;
        dot.style.transform =
          `translate(calc(-50% + ${axisX * STICK_TRAVEL_PX}px), calc(-50% + ${axisY * STICK_TRAVEL_PX}px))`;
      }

      // Buttons (pills are cached; this runs on every polled frame)
      for (const [index, pill] of this.buttonPills) {
        const btn = gamepad.buttons[index];
        pill.classList.toggle('pressed', !!(btn && (btn.pressed || btn.value > 0.5)));
      }
    }

    applyViewportScale() {
      const scale = Math.min(3, Math.max(1, window.innerWidth / OVERLAY_DESIGN_WIDTH));
      if (this.container) {
        this.container.style.zoom = scale;
      }
      if (this.fsPromptEl) {
        this.fsPromptEl.style.zoom = scale;
      }
    }

    createFullscreenPrompt() {
      if (document.getElementById('tt-fullscreen-prompt')) {
        this.fsPromptEl = document.getElementById('tt-fullscreen-prompt');
        return;
      }

      const prompt = document.createElement('div');
      prompt.id = 'tt-fullscreen-prompt';
      prompt.innerHTML = this.getSafeHTML(`
        <span class="tt-fs-text">Press <strong>F11</strong> or <strong>Select (Back/View)</strong> for Fullscreen</span>
        <button class="tt-fs-btn" id="tt-fs-btn-enter">Enter Fullscreen</button>
        <button class="tt-fs-close" id="tt-fs-btn-dismiss" title="Dismiss">&times;</button>
      `);
      (document.body || document.documentElement).appendChild(prompt);
      this.fsPromptEl = prompt;

      const enterBtn = prompt.querySelector('#tt-fs-btn-enter');
      if (enterBtn) {
        enterBtn.addEventListener('click', () => {
          ipcRenderer.invoke('toggle-fullscreen').catch(() => {});
          this.hideFullscreenPrompt();
        });
      }

      const closeBtn = prompt.querySelector('#tt-fs-btn-dismiss');
      if (closeBtn) {
        closeBtn.addEventListener('click', () => {
          this.hideFullscreenPrompt();
        });
      }
    }

    showFullscreenPrompt(autoDismissMs = 8000) {
      if (!this.fsPromptEl) {
        this.createFullscreenPrompt();
      }
      if (!this.fsPromptEl) return;

      if (!this.fsPromptEl.isConnected) {
        (document.body || document.documentElement).appendChild(this.fsPromptEl);
      }
      this.applyViewportScale();
      this.fsPromptEl.classList.add('visible');

      clearTimeout(this.fsPromptTimer);
      if (autoDismissMs > 0) {
        this.fsPromptTimer = setTimeout(() => {
          this.hideFullscreenPrompt();
        }, autoDismissMs);
      }
    }

    hideFullscreenPrompt() {
      clearTimeout(this.fsPromptTimer);
      if (this.fsPromptEl) {
        this.fsPromptEl.classList.remove('visible');
      }
    }

    // Move the controller focus ring to the given index, wrapping around.
    setFocus(index) {
      if (!this.focusables.length) return;
      const count = this.focusables.length;
      this.focusIndex = ((index % count) + count) % count;
      this.focusables.forEach((entry, i) => {
        // Checkboxes are visually hidden inside their switch, so the ring goes
        // on the switch wrapper instead.
        const target = entry.type === 'checkbox' ? entry.el.parentElement : entry.el;
        target.classList.toggle('tt-focused', i === this.focusIndex);
      });
      const current = this.focusables[this.focusIndex].el;
      if (current.scrollIntoView) {
        current.scrollIntoView({ block: 'nearest' });
      }
    }

    handleControllerAction(action) {
      if (action === 'Escape' || action === 'ToggleOverlay') {
        this.toggle(false);
        return;
      }

      const entry = this.focusables[this.focusIndex];
      if (!entry) return;

      switch (action) {
        case 'ArrowUp':
          this.setFocus(this.focusIndex - 1);
          break;
        case 'ArrowDown':
          this.setFocus(this.focusIndex + 1);
          break;
        case 'ArrowLeft':
        case 'ArrowRight': {
          const forward = action === 'ArrowRight';
          if (entry.type === 'range') {
            const step = parseFloat(entry.el.step) || 1;
            const next = parseFloat(entry.el.value) + (forward ? step : -step);
            const min = parseFloat(entry.el.min);
            const max = parseFloat(entry.el.max);
            entry.el.value = Math.min(max, Math.max(min, next));
            entry.el.dispatchEvent(new Event('input', { bubbles: true }));
          } else if (entry.type === 'checkbox') {
            entry.el.checked = forward;
            entry.el.dispatchEvent(new Event('change', { bubbles: true }));
          }
          break;
        }
        case 'Enter':
        case 'PlayPause':
          if (entry.type === 'checkbox') {
            entry.el.checked = !entry.el.checked;
            entry.el.dispatchEvent(new Event('change', { bubbles: true }));
          } else if (entry.type === 'button') {
            entry.el.click();
          }
          break;
        default:
          break;
      }
    }

    toggle(force) {
      if (!this.container) return;

      // YouTube's TV app re-renders the page body; re-attach if we were swept
      // away, otherwise the overlay silently stops appearing.
      if (!this.container.isConnected) {
        (document.body || document.documentElement).appendChild(this.container);
      }

      this.isVisible = typeof force === 'boolean' ? force : !this.isVisible;
      this.container.classList.toggle('visible', this.isVisible);

      if (this.isVisible) {
        this.applyViewportScale();
        // Re-read the config on open so values changed elsewhere (F11, the
        // controller's fullscreen button) are not overwritten on save.
        ipcRenderer.invoke('get-config').then((cfg) => {
          if (cfg) {
            this.config = cfg;
            this.populateForm();
            this.pushConfigToController();
          }
        }).catch((err) => console.warn('[TizenTube Overlay] Could not refresh config:', err));
        this.setFocus(0);
      }

      if (window.TizenTubeGamepadManager) {
        window.TizenTubeGamepadManager.setOverlayOpen(this.isVisible);
      }
    }
  }

  window.TizenTubeOverlay = new SettingsOverlay();
})();
