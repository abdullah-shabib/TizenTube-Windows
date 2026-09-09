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

// koffi is a native binding. If its prebuilt binary is missing or fails to load
// (a packaging mistake, an unsupported arch), that must cost us rumble and
// nothing else - main.js requires this module at load time, so a throw here
// would stop the whole app from starting.
let koffi = null;
try {
  koffi = require('koffi');
} catch (err) {
  console.warn('[TizenTube Vibration] koffi unavailable, rumble disabled:', err.message);
}

let typesRegistered = false;

function registerXInputTypes() {
  if (typesRegistered || !koffi) return;

  koffi.struct('XINPUT_VIBRATION_NATIVE', {
    wLeftMotorSpeed: 'uint16',
    wRightMotorSpeed: 'uint16'
  });

  koffi.struct('XINPUT_BATTERY_INFORMATION', {
    BatteryType: 'uint8',
    BatteryLevel: 'uint8'
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
    this.XInputGetBatteryInformation = null;
    this.activeTimers = new Map(); // slot -> timer

    this.init();
  }

  isAvailable() {
    return !!this.XInputSetState;
  }

  init() {
    if (!koffi) return;
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
      try {
        this.XInputGetBatteryInformation = this.lib.func('uint32 __stdcall XInputGetBatteryInformation(uint32 dwUserIndex, uint8 devType, _Out_ XINPUT_BATTERY_INFORMATION *pBatteryInformation)');
      } catch (err) {
        console.warn('[TizenTube Vibration] XInputGetBatteryInformation unavailable:', err.message);
      }
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

  /**
   * Query XInput battery status for controller slot (0-3).
   * @param {number} slot Controller index (0-3)
   * @returns {{ connected: boolean, isWired: boolean, level: string, percent: number, supported: boolean }}
   */
  getBatteryStatus(slot = 0) {
    if (!this.XInputGetBatteryInformation) {
      return { connected: false, supported: false, isWired: false, level: 'unknown', percent: 100 };
    }

    try {
      const info = {};
      const res = this.XInputGetBatteryInformation(slot, 0, info); // devType 0 = BATTERY_DEVTYPE_GAMEPAD
      if (res !== 0) {
        // ERROR_DEVICE_NOT_CONNECTED (1167)
        return { connected: false, supported: true, isWired: false, level: 'disconnected', percent: 0 };
      }

      // 0x00 = DISCONNECTED, 0x01 = WIRED, 0x02 = ALKALINE, 0x03 = NIMH, 0xFF = UNKNOWN
      const isWired = info.BatteryType === 1;
      const isDisconnected = info.BatteryType === 0;

      // 0x00 = EMPTY (~5%), 0x01 = LOW (~20%), 0x02 = MEDIUM (~60%), 0x03 = FULL (~100%)
      let level = 'unknown';
      let percent = 100;
      if (isWired) {
        level = 'wired';
        percent = 100;
      } else if (!isDisconnected) {
        switch (info.BatteryLevel) {
          case 0:
            level = 'empty';
            percent = 5;
            break;
          case 1:
            level = 'low';
            percent = 20;
            break;
          case 2:
            level = 'medium';
            percent = 60;
            break;
          case 3:
            level = 'full';
            percent = 100;
            break;
        }
      }

      return {
        connected: !isDisconnected,
        isWired,
        level,
        percent,
        batteryType: info.BatteryType,
        batteryLevelRaw: info.BatteryLevel,
        supported: true
      };
    } catch (err) {
      return { connected: false, supported: false, isWired: false, level: 'error', percent: 0, error: err.message };
    }
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
