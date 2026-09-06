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
 * Native XInput Vibration Manager for Windows PC
 * Directly interfaces with Windows xinput1_4.dll via koffi for zero-latency,
 * reliable controller haptic feedback on Xbox, 8BitDo, and XInput-compatible gamepads.
 */

const koffi = require('koffi');

let typesRegistered = false;

function registerXInputTypes() {
  if (typesRegistered) return;

  koffi.struct('XINPUT_VIBRATION_NATIVE', {
    wLeftMotorSpeed: 'uint16',
    wRightMotorSpeed: 'uint16'
  });

  typesRegistered = true;
}

// Haptic feedback profiles (intensity 0-65535, duration in ms)
const HAPTIC_PROFILES = {
  connect: { left: 18000, right: 18000, duration: 100 },
  button:  { left: 8000,  right: 8000,  duration: 35 },
  stick:   { left: 5000,  right: 5000,  duration: 20 },
  test:    { left: 15000, right: 15000, duration: 80 }
};

class NativeVibrationManager {
  constructor(options = {}) {
    this.enabled = options.enabled !== false;
    this.lib = null;
    this.XInputSetState = null;
    this.activeTimers = new Map(); // slot -> timer

    this.init();
  }

  isAvailable() {
    return !!this.XInputSetState;
  }

  init() {
    try {
      const dlls = ['xinput1_4.dll', 'xinput1_3.dll', 'xinput9_1_0.dll'];
      for (const dll of dlls) {
        try {
          this.lib = koffi.load(dll);
          console.log(`[TizenTube Vibration] Loaded Windows XInput library: ${dll}`);
          break;
        } catch (e) {}
      }

      if (!this.lib) {
        console.warn('[TizenTube Vibration] Could not load XInput DLL; native rumble unavailable.');
        return;
      }

      registerXInputTypes();
      this.XInputSetState = this.lib.func('uint32 __stdcall XInputSetState(uint32 dwUserIndex, XINPUT_VIBRATION_NATIVE *pVibration)');
    } catch (err) {
      console.error('[TizenTube Vibration] Initialization error:', err.message);
    }
  }

  setEnabled(enabled) {
    this.enabled = !!enabled;
    if (!this.enabled) {
      this.stopAll();
    }
  }

  /**
   * Directly vibrate controller in given slot (0-3).
   * @param {number} slot Controller index (0-3)
   * @param {number} leftMotor Low-frequency motor speed (0-65535)
   * @param {number} rightMotor High-frequency motor speed (0-65535)
   * @param {number} durationMs Vibration duration in milliseconds
   */
  vibrate(slot = 0, leftMotor = 10000, rightMotor = 10000, durationMs = 40) {
    if (!this.enabled || !this.XInputSetState) return;

    // Clear any existing stop timer for this slot
    if (this.activeTimers.has(slot)) {
      clearTimeout(this.activeTimers.get(slot));
      this.activeTimers.delete(slot);
    }

    try {
      this.XInputSetState(slot, { wLeftMotorSpeed: leftMotor, wRightMotorSpeed: rightMotor });
      const timer = setTimeout(() => {
        try {
          if (this.XInputSetState) {
            this.XInputSetState(slot, { wLeftMotorSpeed: 0, wRightMotorSpeed: 0 });
          }
        } catch (e) {}
        this.activeTimers.delete(slot);
      }, durationMs);

      this.activeTimers.set(slot, timer);
    } catch (e) {
      // Slot disconnected or XInput error
    }
  }

  /**
   * Trigger predefined haptic feedback profile.
   * @param {string} profileName 'connect' | 'button' | 'stick' | 'test'
   * @param {number} slot Controller slot (0-3)
   */
  pulse(profileName, slot = 0) {
    const profile = HAPTIC_PROFILES[profileName] || HAPTIC_PROFILES.button;
    this.vibrate(slot, profile.left, profile.right, profile.duration);
  }

  stopAll() {
    for (const [slot, timer] of this.activeTimers.entries()) {
      clearTimeout(timer);
    }
    this.activeTimers.clear();

    if (!this.XInputSetState) return;
    for (let slot = 0; slot < 4; slot++) {
      try {
        this.XInputSetState(slot, { wLeftMotorSpeed: 0, wRightMotorSpeed: 0 });
      } catch (e) {}
    }
  }
}

module.exports = NativeVibrationManager;
