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

  // Web Gamepad actuator equivalents of the native XInput haptic profiles.
  const WEB_HAPTIC_EFFECTS = {
    connect: { duration: 100, magnitude: 0.28 },
    button:  { duration: 35,  magnitude: 0.12 },
    stick:   { duration: 20,  magnitude: 0.08 },
    test:    { duration: 80,  magnitude: 0.22 }
  };

  // Actions that should keep firing while a button is held, matching how the
  // sticks and D-Pad already behave. Without this, holding a trigger bound to
  // VolumeUp gives a single 5% step.
  const REPEATABLE_ACTIONS = new Set(['VolumeUp', 'VolumeDown']);

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
      button6: { action: 'VolumeDown' },
      button7: { action: 'VolumeUp' },
      button8: { action: 'ToggleFullscreen' },
      button9: { action: 'ToggleOverlay' },
      button10: { action: 'CyclePlaybackSpeed' },
      button11: { action: 'VolumeMute' }
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
      this.rightStickStates = {
        up:    { isPressed: false, firstPressedTime: 0, lastRepeatTime: 0 },
        down:  { isPressed: false, firstPressedTime: 0, lastRepeatTime: 0 }
      };

      this.nativeHapticsAvailable = true;
      this.cursorStyleEl = null;
      this.cursorHideTimer = null;
      this.isCursorHidden = false;
      this.onStateChangeCallbacks = [];
      this.overlayOpen = false;

      this.batteryStatus = { connected: false, isWired: false, level: 'unknown', percent: 100, supported: false };
      this.lastBatteryWarningTime = 0;
      this.lastBatteryPollTime = 0;
      this.lbUsedInCombo = false;
      this.comboUpPressed = false;
      this.comboDownPressed = false;
      this.comboResetPressed = false;

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

      ipcRenderer.invoke('vibration-available')
        .then((available) => { this.nativeHapticsAvailable = !!available; })
        .catch(() => { this.nativeHapticsAvailable = false; });

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
        this.handleGamepadConnected(e.gamepad);
      });

      window.addEventListener('gamepaddisconnected', (e) => {
        console.log('[TizenTube Controller] Gamepad disconnected event:', e.gamepad.id);
        this.handleGamepadDisconnected(e.gamepad);
      });
    }

    handleGamepadConnected(pad) {
      if (!pad) return;
      this.activeGamepadIndex = pad.index;
      this.lastLoggedGamepadId = pad.id;
      this.clearAllInputStates();

      const padName = pad.id.split('(')[0].trim() || 'Gamepad';
      window.dispatchEvent(new CustomEvent('tizentube-show-toast', {
        detail: { message: `Controller connected: ${padName}`, icon: '🎮', durationMs: 2500 }
      }));

      this.triggerHaptic('connect', pad.index);
      ipcRenderer.send('controller-reconnected');
      this.checkBattery(pad.index, true);
    }

    handleGamepadDisconnected(pad) {
      if (this.activeGamepadIndex === null || (pad && this.activeGamepadIndex === pad.index)) {
        this.activeGamepadIndex = null;
        this.lastLoggedGamepadId = null;
        this.clearAllInputStates();
        window.dispatchEvent(new CustomEvent('tizentube-show-toast', {
          detail: { message: 'Controller disconnected', icon: '🎮', durationMs: 2500 }
        }));
      }
    }

    clearAllInputStates() {
      this.buttonStates.clear();
      for (const key of Object.keys(this.directionStates)) {
        this.directionStates[key] = { isPressed: false, firstPressedTime: 0, lastRepeatTime: 0 };
      }
      for (const key of Object.keys(this.rightStickStates)) {
        this.rightStickStates[key] = { isPressed: false, firstPressedTime: 0, lastRepeatTime: 0 };
      }
      this.lbUsedInCombo = false;
      this.comboUpPressed = false;
      this.comboDownPressed = false;
      this.comboResetPressed = false;
    }

    async checkBattery(slot = 0, force = false) {
      const now = Date.now();
      if (!force && now - this.lastBatteryPollTime < 30000) return;
      this.lastBatteryPollTime = now;

      try {
        const status = await ipcRenderer.invoke('get-controller-battery', slot);
        if (status && status.supported) {
          this.batteryStatus = status;
          window.dispatchEvent(new CustomEvent('tizentube-battery-status', { detail: status }));

          // If wireless controller is low or empty (<= 20%)
          if (!status.isWired && status.connected && (status.level === 'low' || status.level === 'empty' || status.percent <= 20)) {
            if (now - this.lastBatteryWarningTime > 10 * 60 * 1000) {
              this.lastBatteryWarningTime = now;
              window.dispatchEvent(new CustomEvent('tizentube-show-toast', {
                detail: {
                  message: `Controller battery low (~${status.percent}%). Please recharge or plug in.`,
                  icon: '🪫',
                  durationMs: 4000
                }
              }));
            }
          }
          return;
        }
      } catch (err) {
        // Fall back to Web Gamepad API battery
      }

      try {
        const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
        const pad = gamepads[slot];
        if (pad && pad.battery) {
          const pct = Math.round(pad.battery.level * 100);
          this.batteryStatus = {
            connected: true,
            isWired: pad.battery.charging,
            level: pct <= 20 ? 'low' : 'good',
            percent: pct,
            supported: true
          };
          window.dispatchEvent(new CustomEvent('tizentube-battery-status', { detail: this.batteryStatus }));
        }
      } catch (e) {}
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
        this.cursorStyleEl.textContent = `
          html.tt-hide-cursor, html.tt-hide-cursor * {
            cursor: none !important;
          }
        `;
        root.appendChild(this.cursorStyleEl);
      }
      return this.cursorStyleEl;
    }

    setupCursorManagement() {
      const onActivity = () => this.showCursor(true);
      window.addEventListener('mousemove', onActivity, { passive: true });
      window.addEventListener('mousedown', onActivity, { passive: true });
      window.addEventListener('pointermove', onActivity, { passive: true });
      window.addEventListener('wheel', onActivity, { passive: true });
      window.addEventListener('focus', onActivity, { passive: true });
      window.addEventListener('resize', onActivity, { passive: true });

      this.getCursorStyleEl();

      // Immediately arm cursor auto-hide so launching in windowed mode hides cursor after 2.5s
      if (this.autoHideEnabled()) {
        this.showCursor(true);
      }
    }

    showCursor(rearmTimer) {
      if (this.isCursorHidden) {
        if (document.documentElement) {
          document.documentElement.classList.remove('tt-hide-cursor');
        }
        this.isCursorHidden = false;
      }
      clearTimeout(this.cursorHideTimer);
      if (rearmTimer && this.autoHideEnabled()) {
        const delay = (this.config && this.config.display && this.config.display.cursorHideDelayMs) || 2500;
        this.cursorHideTimer = setTimeout(() => this.hideCursor(), delay);
      }
    }

    hideCursor() {
      if (this.isCursorHidden || !this.autoHideEnabled()) return;
      this.getCursorStyleEl();
      if (document.documentElement) {
        document.documentElement.classList.add('tt-hide-cursor');
      }
      this.isCursorHidden = true;
    }

    executeAction(action) {
      this.hideCursor();
      ipcRenderer.send('user-activity-ping');

      if (action === 'ToggleOverlay') {
        window.dispatchEvent(new CustomEvent('tizentube-toggle-overlay'));
        return;
      }

      if (action === 'ToggleFullscreen') {
        window.dispatchEvent(new CustomEvent('tizentube-toggle-fullscreen'));
        return;
      }

      if (action === 'TogglePiP') {
        ipcRenderer.invoke('toggle-pip');
        return;
      }

      if (action === 'VolumeUp') {
        window.dispatchEvent(new CustomEvent('tizentube-volume-change', { detail: { delta: 0.05 } }));
        return;
      }

      if (action === 'VolumeDown') {
        window.dispatchEvent(new CustomEvent('tizentube-volume-change', { detail: { delta: -0.05 } }));
        return;
      }

      if (action === 'VolumeMute') {
        window.dispatchEvent(new CustomEvent('tizentube-volume-toggle-mute'));
        return;
      }

      if (action === 'CyclePlaybackSpeed') {
        window.dispatchEvent(new CustomEvent('tizentube-speed-cycle'));
        return;
      }

      if (action === 'SpeedUp') {
        window.dispatchEvent(new CustomEvent('tizentube-speed-adjust', { detail: { delta: 0.25 } }));
        return;
      }

      if (action === 'SpeedDown') {
        window.dispatchEvent(new CustomEvent('tizentube-speed-adjust', { detail: { delta: -0.25 } }));
        return;
      }

      if (action === 'ResetSpeed') {
        window.dispatchEvent(new CustomEvent('tizentube-speed-set', { detail: { speed: 1.0 } }));
        return;
      }

      // Back also clears the startup banner if it is showing; the overlay
      // ignores this when no banner is up.
      if (action === 'Escape') {
        window.dispatchEvent(new CustomEvent('tizentube-dismiss-prompt'));
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

    // Exactly one haptic path runs per pulse. Native XInput and the Web Gamepad
    // actuator both end up driving the same motors on Windows, so firing both
    // makes them fight over magnitude and cut each other's pulse short.
    triggerHaptic(type, slot = 0) {
      const controller = (this.config && this.config.controller) || {};
      if (controller.vibration === false) return;

      if (this.nativeHapticsAvailable) {
        ipcRenderer.send('controller-vibrate', { type, slot: slot || 0 });
        return;
      }

      // No native XInput (a DualSense/DualShock over Bluetooth, or the koffi
      // binding did not load), so drive the pad through the browser instead.
      try {
        const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
        const pad = gamepads[slot];
        if (pad && pad.vibrationActuator && typeof pad.vibrationActuator.playEffect === 'function') {
          const effect = WEB_HAPTIC_EFFECTS[type] || WEB_HAPTIC_EFFECTS.button;
          pad.vibrationActuator.playEffect('dual-rumble', {
            startDelay: 0,
            duration: effect.duration,
            weakMagnitude: effect.magnitude,
            strongMagnitude: effect.magnitude
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

    handleRightStick(dirName, isPressed, now) {
      const state = this.rightStickStates[dirName];
      const controller = (this.config && this.config.controller) || {};
      const initialDelay = controller.initialDelayMs || 250;
      const repeatInterval = controller.repeatIntervalMs || 110;
      const actionName = dirName === 'up' ? 'VolumeUp' : 'VolumeDown';

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
          if (this.activeGamepadIndex === null || this.activeGamepadIndex !== i) {
            this.handleGamepadConnected(gamepads[i]);
          }
          return gamepads[i];
        }
      }

      if (this.activeGamepadIndex !== null) {
        this.handleGamepadDisconnected(null);
      }

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

        if (gamepad) {
          this.checkBattery(gamepad.index);
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
          const initialDelay = controller.initialDelayMs || 250;
          const repeatInterval = controller.repeatIntervalMs || 110;

          // 1. Left stick (axes 0 & 1)
          const axisX = gamepad.axes[0] || 0;
          const axisY = gamepad.axes[1] || 0;

          const stickLeft  = axisX < -deadzone;
          const stickRight = axisX > deadzone;
          const stickUp    = axisY < -deadzone;
          const stickDown  = axisY > deadzone;

          // 2. D-Pad (buttons 12-15) & Speed Adjustment Combos
          const isLBPressed = this.isButtonPressed(gamepad, 4);
          const isRBPressed = this.isButtonPressed(gamepad, 5);

          const dpadUp    = this.isButtonPressed(gamepad, 12);
          const dpadDown  = this.isButtonPressed(gamepad, 13);
          const dpadLeft  = this.isButtonPressed(gamepad, 14);
          const dpadRight = this.isButtonPressed(gamepad, 15);

          let speedComboTriggered = false;
          if (isLBPressed) {
            if (isRBPressed) {
              if (!this.comboResetPressed) {
                this.comboResetPressed = true;
                this.triggerHaptic('button', gamepad.index);
                this.executeAction('ResetSpeed');
              }
              speedComboTriggered = true;
            } else {
              this.comboResetPressed = false;
            }

            if (dpadUp || dpadRight) {
              if (!this.comboUpPressed) {
                this.comboUpPressed = true;
                this.triggerHaptic('button', gamepad.index);
                this.executeAction('SpeedUp');
              }
              speedComboTriggered = true;
            } else {
              this.comboUpPressed = false;
            }

            if (dpadDown || dpadLeft) {
              if (!this.comboDownPressed) {
                this.comboDownPressed = true;
                this.triggerHaptic('button', gamepad.index);
                this.executeAction('SpeedDown');
              }
              speedComboTriggered = true;
            } else {
              this.comboDownPressed = false;
            }
          } else {
            this.comboResetPressed = false;
            this.comboUpPressed = false;
            this.comboDownPressed = false;
          }

          if (speedComboTriggered) {
            this.lbUsedInCombo = true;
          }
          if (!isLBPressed) {
            this.lbUsedInCombo = false;
          }

          if (!speedComboTriggered) {
            this.handleDirection('up',    stickUp || dpadUp,       now);
            this.handleDirection('down',  stickDown || dpadDown,   now);
            this.handleDirection('left',  stickLeft || dpadLeft,   now);
            this.handleDirection('right', stickRight || dpadRight, now);
          }

          // 3. Right stick (axis 3) - Volume Control
          const rightAxisY = gamepad.axes[3] || 0;
          const rightStickUp   = rightAxisY < -deadzone;
          const rightStickDown = rightAxisY > deadzone;

          this.handleRightStick('up',   rightStickUp,   now);
          this.handleRightStick('down', rightStickDown, now);

          // 4. Configurable buttons (the D-Pad is handled above)
          const bindings = controller.bindings || {};
          for (let bIdx = 0; bIdx < gamepad.buttons.length; bIdx++) {
            if (bIdx >= DPAD_FIRST && bIdx <= DPAD_LAST) continue;
            if (bIdx === 4 && this.lbUsedInCombo) continue;

            const isPressed = this.isButtonPressed(gamepad, bIdx);
            const binding = bindings['button' + bIdx];

            let bState = this.buttonStates.get(bIdx);
            if (!bState) {
              bState = { isPressed: false, firstPressedTime: 0, lastRepeatTime: 0 };
              this.buttonStates.set(bIdx, bState);
            }

            const action = binding && binding.action;

            if (isPressed) {
              if (!bState.isPressed) {
                bState.isPressed = true;
                bState.firstPressedTime = now;
                bState.lastRepeatTime = now;
                // Only for a button that does something: rumbling an unbound
                // trigger or stick-click promises an action that never happens.
                if (action) {
                  this.triggerHaptic('button', gamepad.index);
                  this.executeAction(action);
                }
              } else if (action && REPEATABLE_ACTIONS.has(action) &&
                         now - bState.firstPressedTime >= initialDelay &&
                         now - bState.lastRepeatTime >= repeatInterval) {
                bState.lastRepeatTime = now;
                this.executeAction(action);
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
