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
 * TizenTube Windows - Gamepad Controller Subsystem
 * Implements HTML5 Gamepad API loop with TV navigation, deadzone filtering,
 * key repeat emulation, cursor auto-hiding, and native Chromium input dispatch.
 */

(function () {
  const { ipcRenderer } = require('electron');

  // Actions that are translated into real Chromium key events.
  // nativeCode values are Electron accelerator names accepted by sendInputEvent().
  const ACTION_MAPPINGS = {
    ArrowUp:    { nativeCode: 'Up' },
    ArrowDown:  { nativeCode: 'Down' },
    ArrowLeft:  { nativeCode: 'Left' },
    ArrowRight: { nativeCode: 'Right' },
    Enter:      { nativeCode: 'Return' },
    Escape:     { nativeCode: 'Escape' },
    PlayPause:  { nativeCode: 'Space' },
    Search:     { nativeCode: '/' },
    SeekLeft:   { nativeCode: 'Left' },
    SeekRight:  { nativeCode: 'Right' }
  };

  // Buttons 12-15 are the D-Pad and are handled by the direction/repeat logic.
  const DPAD_FIRST = 12;
  const DPAD_LAST = 15;

  // Used when the config could not be loaded, so a broken config file can never
  // leave the app without controller input.
  const FALLBACK_CONTROLLER = {
    enabled: true,
    vibration: true,
    deadzone: 0.25,
    initialDelayMs: 250,
    repeatIntervalMs: 110,
    bindings: {
      button0: { action: 'Enter' },
      button1: { action: 'Escape' },
      button2: { action: 'PlayPause' },
      button3: { action: 'Search' },
      button4: { action: 'SeekLeft' },
      button5: { action: 'SeekRight' },
      button8: { action: 'ToggleFullscreen' },
      button9: { action: 'ToggleOverlay' }
    }
  };

  // Run fn once the document has an element we can append to. At preload time
  // (document-start) both document.head and document.documentElement are still
  // null, so anything touching the DOM has to wait.
  function whenDomReady(fn) {
    if (document.head || document.documentElement) {
      fn();
    } else {
      document.addEventListener('DOMContentLoaded', fn, { once: true });
    }
  }

  class GamepadManager {
    constructor() {
      this.config = null;
      this.activeGamepadIndex = null;
      this.lastLoggedGamepadId = null;
      this.isPolling = false;

      this.buttonStates = new Map();
      this.directionStates = {
        up:    { isPressed: false, firstPressedTime: 0, lastRepeatTime: 0 },
        down:  { isPressed: false, firstPressedTime: 0, lastRepeatTime: 0 },
        left:  { isPressed: false, firstPressedTime: 0, lastRepeatTime: 0 },
        right: { isPressed: false, firstPressedTime: 0, lastRepeatTime: 0 }
      };

      this.cursorStyleEl = null;
      this.cursorHideTimer = null;
      this.isCursorHidden = false;
      this.onStateChangeCallbacks = [];
      this.overlayOpen = false;

      this.poll = this.poll.bind(this);
    }

    init(config) {
      this.config = config || {};
      if (!this.config.controller) {
        console.warn('[TizenTube Controller] No controller config supplied; using built-in defaults.');
        this.config.controller = FALLBACK_CONTROLLER;
      }

      // Start polling before anything else. Nothing below may be allowed to
      // prevent controller input from working, so each step is isolated.
      if (!this.isPolling) {
        this.isPolling = true;
        requestAnimationFrame(this.poll);
      }

      try {
        this.setupWindowListeners();
      } catch (err) {
        console.error('[TizenTube Controller] Failed to attach window listeners:', err);
      }

      whenDomReady(() => {
        try {
          this.setupCursorManagement();
        } catch (err) {
          console.error('[TizenTube Controller] Failed to set up cursor management:', err);
        }
      });

      console.log('[TizenTube Controller] Gamepad Subsystem initialized and polling started.');
    }

    updateConfig(newConfig) {
      if (!newConfig || !newConfig.controller) return;
      this.config = newConfig;
      if (!this.autoHideEnabled()) {
        this.showCursor(false);
      }
    }

    autoHideEnabled() {
      return !!(this.config && this.config.display && this.config.display.autoHideCursor);
    }

    setOverlayOpen(isOpen) {
      this.overlayOpen = isOpen;
    }

    onStateChange(cb) {
      this.onStateChangeCallbacks.push(cb);
    }

    setupWindowListeners() {
      window.addEventListener('gamepadconnected', (e) => {
        console.log('[TizenTube Controller] Gamepad connected event:', e.gamepad.id, 'index:', e.gamepad.index);
        this.activeGamepadIndex = e.gamepad.index;
      });

      window.addEventListener('gamepaddisconnected', (e) => {
        console.log('[TizenTube Controller] Gamepad disconnected event:', e.gamepad.id);
        if (this.activeGamepadIndex === e.gamepad.index) {
          this.activeGamepadIndex = null;
          this.lastLoggedGamepadId = null;
        }
      });
    }

    getCursorStyleEl() {
      const root = document.head || document.documentElement;
      if (!root) return null;
      if (!this.cursorStyleEl || !this.cursorStyleEl.isConnected) {
        this.cursorStyleEl = document.getElementById('tizentube-cursor-style');
      }
      if (!this.cursorStyleEl || !this.cursorStyleEl.isConnected) {
        this.cursorStyleEl = document.createElement('style');
        this.cursorStyleEl.id = 'tizentube-cursor-style';
        root.appendChild(this.cursorStyleEl);
      }
      return this.cursorStyleEl;
    }

    setupCursorManagement() {
      // Listeners are always attached so the setting can be toggled at runtime
      // without restarting; the flag is checked when hiding instead.
      const onActivity = () => this.showCursor(true);
      window.addEventListener('mousemove', onActivity);
      window.addEventListener('mousedown', onActivity);
      this.getCursorStyleEl();
    }

    showCursor(rearmTimer) {
      if (this.isCursorHidden) {
        const style = this.getCursorStyleEl();
        if (style) style.textContent = '';
        this.isCursorHidden = false;
      }
      clearTimeout(this.cursorHideTimer);
      if (rearmTimer && this.autoHideEnabled()) {
        const delay = (this.config && this.config.display && this.config.display.cursorHideDelayMs) || 3000;
        this.cursorHideTimer = setTimeout(() => this.hideCursor(), delay);
      }
    }

    hideCursor() {
      if (this.isCursorHidden || !this.autoHideEnabled()) return;
      const style = this.getCursorStyleEl();
      if (!style) return;
      style.textContent = '* { cursor: none !important; }';
      this.isCursorHidden = true;
    }

    executeAction(action) {
      this.hideCursor();

      if (action === 'ToggleOverlay') {
        window.dispatchEvent(new CustomEvent('tizentube-toggle-overlay'));
        return;
      }

      if (action === 'ToggleFullscreen') {
        window.dispatchEvent(new CustomEvent('tizentube-toggle-fullscreen'));
        return;
      }

      // While the overlay is open the controller drives the overlay instead of
      // the YouTube page underneath it.
      if (this.overlayOpen) {
        window.dispatchEvent(new CustomEvent('tizentube-overlay-key', { detail: { action } }));
        return;
      }

      const mapping = ACTION_MAPPINGS[action];
      if (mapping) {
        // Chromium synthesises a real, trusted keydown/keyup pair from this,
        // which is what the YouTube TV app listens for.
        ipcRenderer.send('send-native-key', { keyCode: mapping.nativeCode });
      }
    }

    triggerHaptic(type, slot = 0) {
      const controller = (this.config && this.config.controller) || {};
      if (controller.vibration === false) return;

      // 1. Native XInput haptic feedback via Electron main process
      ipcRenderer.send('controller-vibrate', { type, slot: slot || 0 });

      // 2. Web Gamepad vibrationActuator fallback for non-XInput controllers
      try {
        const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
        const pad = gamepads[slot];
        if (pad && pad.vibrationActuator && typeof pad.vibrationActuator.playEffect === 'function') {
          const durations = { connect: 100, button: 35, stick: 20, test: 80 };
          const intensities = { connect: 0.28, button: 0.12, stick: 0.08, test: 0.22 };
          const dur = durations[type] || 35;
          const mag = intensities[type] || 0.12;
          pad.vibrationActuator.playEffect('dual-rumble', {
            startDelay: 0,
            duration: dur,
            weakMagnitude: mag,
            strongMagnitude: mag
          }).catch(() => {});
        }
      } catch (e) {}
    }

    handleDirection(dirName, isPressed, now) {
      const state = this.directionStates[dirName];
      const controller = (this.config && this.config.controller) || {};
      const initialDelay = controller.initialDelayMs || 250;
      const repeatInterval = controller.repeatIntervalMs || 110;
      const actionName = 'Arrow' + dirName.charAt(0).toUpperCase() + dirName.slice(1);

      if (isPressed) {
        if (!state.isPressed) {
          state.isPressed = true;
          state.firstPressedTime = now;
          state.lastRepeatTime = now;
          this.triggerHaptic('stick', this.activeGamepadIndex || 0);
          this.executeAction(actionName);
        } else if (now - state.firstPressedTime >= initialDelay &&
                   now - state.lastRepeatTime >= repeatInterval) {
          state.lastRepeatTime = now;
          this.executeAction(actionName);
        }
      } else {
        state.isPressed = false;
      }
    }

    findGamepad() {
      const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];

      const active = this.activeGamepadIndex !== null ? gamepads[this.activeGamepadIndex] : null;
      if (active && active.connected) return active;

      for (let i = 0; i < gamepads.length; i++) {
        if (gamepads[i] && gamepads[i].connected) {
          this.activeGamepadIndex = i;
          return gamepads[i];
        }
      }

      this.activeGamepadIndex = null;
      return null;
    }

    poll() {
      try {
        const gamepad = this.findGamepad();

        if (gamepad && this.lastLoggedGamepadId !== gamepad.id) {
          console.log('[TizenTube Controller] Active gamepad detected:', gamepad.id,
            'axes:', gamepad.axes.length, 'buttons:', gamepad.buttons.length);
          this.lastLoggedGamepadId = gamepad.id;
          this.triggerHaptic('connect', gamepad.index);
        }

        // Always notify listeners, including with null, so the HUD can report
        // "no controller detected" rather than sitting on its initial state.
        for (const cb of this.onStateChangeCallbacks) {
          try {
            cb(gamepad);
          } catch (err) {
            console.error('[TizenTube Controller] State change callback failed:', err);
          }
        }

        const controller = (this.config && this.config.controller) || null;
        if (gamepad && controller && controller.enabled !== false) {
          const now = Date.now();
          const deadzone = controller.deadzone || 0.25;

          // 1. Left stick (axes 0 & 1)
          const axisX = gamepad.axes[0] || 0;
          const axisY = gamepad.axes[1] || 0;

          const stickLeft  = axisX < -deadzone;
          const stickRight = axisX > deadzone;
          const stickUp    = axisY < -deadzone;
          const stickDown  = axisY > deadzone;

          // 2. D-Pad (buttons 12-15)
          const dpadUp    = this.isButtonPressed(gamepad, 12);
          const dpadDown  = this.isButtonPressed(gamepad, 13);
          const dpadLeft  = this.isButtonPressed(gamepad, 14);
          const dpadRight = this.isButtonPressed(gamepad, 15);

          this.handleDirection('up',    stickUp || dpadUp,       now);
          this.handleDirection('down',  stickDown || dpadDown,   now);
          this.handleDirection('left',  stickLeft || dpadLeft,   now);
          this.handleDirection('right', stickRight || dpadRight, now);

          // 3. Configurable buttons (the D-Pad is handled above)
          const bindings = controller.bindings || {};
          for (let bIdx = 0; bIdx < gamepad.buttons.length; bIdx++) {
            if (bIdx >= DPAD_FIRST && bIdx <= DPAD_LAST) continue;

            const isPressed = this.isButtonPressed(gamepad, bIdx);
            const binding = bindings['button' + bIdx];

            let bState = this.buttonStates.get(bIdx);
            if (!bState) {
              bState = { isPressed: false };
              this.buttonStates.set(bIdx, bState);
            }

            if (isPressed) {
              if (!bState.isPressed) {
                bState.isPressed = true;
                this.triggerHaptic('button', gamepad.index);
                if (binding && binding.action) {
                  this.executeAction(binding.action);
                }
              }
            } else {
              bState.isPressed = false;
            }
          }
        }
      } catch (err) {
        console.error('[TizenTube Controller] Error in poll loop:', err);
      }

      requestAnimationFrame(this.poll);
    }

    isButtonPressed(gamepad, index) {
      const btn = gamepad.buttons[index];
      return !!(btn && (btn.pressed || btn.value > 0.5));
    }
  }

  window.TizenTubeGamepadManager = new GamepadManager();
})();
