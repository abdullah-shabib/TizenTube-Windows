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
 */

const net = require('net');
const crypto = require('crypto');
const EventEmitter = require('events');

const OPCODES = {
  HANDSHAKE: 0,
  FRAME: 1,
  CLOSE: 2,
  PING: 3,
  PONG: 4
};

class DiscordRPC extends EventEmitter {
  constructor(options = {}) {
    super();
    this.clientId = options.clientId || '463097721130188830';
    this.enabled = options.enabled !== false;
    this.socket = null;
    this.isConnected = false;
    this.isConnecting = false;
    this.reconnectTimer = null;
    this.currentActivity = null;
    this.incomingBuffer = Buffer.alloc(0);
  }

  setClientId(clientId) {
    if (this.clientId !== clientId) {
      this.clientId = clientId;
      if (this.isConnected) {
        this.disconnect();
        this.connect();
      }
    }
  }

  setEnabled(enabled) {
    this.enabled = !!enabled;
    if (!this.enabled) {
      this.clearActivity();
      this.disconnect();
    } else if (!this.isConnected && !this.isConnecting) {
      this.connect();
    }
  }

  connect() {
    if (!this.enabled || this.isConnected || this.isConnecting) return;
    this.isConnecting = true;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this._tryConnectPipe(0);
  }

  _tryConnectPipe(index) {
    if (!this.enabled || this.isConnected) {
      this.isConnecting = false;
      return;
    }

    if (index > 9) {
      // Checked all pipes 0-9; Discord is likely not open. Schedule reconnect.
      this.isConnecting = false;
      this._scheduleReconnect(15000);
      return;
    }

    const pipePath = '\\\\.\\pipe\\discord-ipc-' + index;
    const socket = net.connect(pipePath);

    let connected = false;

    socket.once('connect', () => {
      connected = true;
      this.socket = socket;
      this.isConnecting = false;
      this.incomingBuffer = Buffer.alloc(0);
      this._setupSocketListeners();
      this._sendHandshake();
    });

    socket.once('error', () => {
      if (!connected) {
        socket.destroy();
        this._tryConnectPipe(index + 1);
      }
    });
  }

  _setupSocketListeners() {
    if (!this.socket) return;

    this.socket.on('data', (data) => {
      this.incomingBuffer = Buffer.concat([this.incomingBuffer, data]);
      this._processIncoming();
    });

    this.socket.once('close', () => {
      this._onSocketDisconnected();
    });

    this.socket.on('error', (err) => {
      console.warn('[DiscordRPC] Socket error:', err.message);
      // 'close' event will follow and trigger reconnection
    });
  }

  _processIncoming() {
    while (this.incomingBuffer.length >= 8) {
      const opcode = this.incomingBuffer.readInt32LE(0);
      const length = this.incomingBuffer.readInt32LE(4);

      if (this.incomingBuffer.length < 8 + length) {
        // Wait for remainder of packet
        break;
      }

      const payloadBuf = this.incomingBuffer.slice(8, 8 + length);
      this.incomingBuffer = this.incomingBuffer.slice(8 + length);

      try {
        const payload = JSON.parse(payloadBuf.toString('utf8'));
        this._handleMessage(opcode, payload);
      } catch (err) {
        console.warn('[DiscordRPC] Malformed payload from Discord:', err.message);
      }
    }
  }

  _handleMessage(opcode, payload) {
    if (opcode === OPCODES.FRAME) {
      if (payload.cmd === 'DISPATCH' && payload.evt === 'READY') {
        this.isConnected = true;
        const user = (payload.data && payload.data.user) || payload.data;
        this.emit('ready', user);
        console.log('[DiscordRPC] Connected to Discord as', (user && user.username) || 'User');
        if (this.currentActivity) {
          this._sendActivity(this.currentActivity);
        }
      }
    } else if (opcode === OPCODES.PING) {
      this._send(OPCODES.PONG, payload);
    } else if (opcode === OPCODES.CLOSE) {
      this.disconnect();
    }
  }

  _sendHandshake() {
    const payload = {
      v: 1,
      client_id: this.clientId
    };
    this._send(OPCODES.HANDSHAKE, payload);
  }

  _send(opcode, payload) {
    if (!this.socket || this.socket.destroyed) return;

    try {
      const json = JSON.stringify(payload);
      const payloadBuf = Buffer.from(json, 'utf8');
      const headerBuf = Buffer.alloc(8);
      headerBuf.writeInt32LE(opcode, 0);
      headerBuf.writeInt32LE(payloadBuf.length, 4);

      this.socket.write(Buffer.concat([headerBuf, payloadBuf]));
    } catch (err) {
      console.warn('[DiscordRPC] Failed to send packet:', err.message);
    }
  }

  setActivity(activity) {
    this.currentActivity = activity;
    if (this.enabled && this.isConnected) {
      this._sendActivity(activity);
    } else if (this.enabled && !this.isConnected && !this.isConnecting) {
      this.connect();
    }
  }

  _sendActivity(activity) {
    const nonce = crypto.randomUUID();
    const payload = {
      cmd: 'SET_ACTIVITY',
      args: {
        pid: process.pid,
        activity: activity || null
      },
      nonce
    };
    this._send(OPCODES.FRAME, payload);
  }

  clearActivity() {
    this.currentActivity = null;
    if (this.isConnected) {
      this._sendActivity(null);
    }
  }

  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.isConnecting = false;
    this.isConnected = false;
    if (this.socket) {
      try {
        this.socket.destroy();
      } catch (e) {}
      this.socket = null;
    }
  }

  _onSocketDisconnected() {
    this.isConnected = false;
    this.socket = null;
    if (this.enabled) {
      this._scheduleReconnect(10000);
    }
  }

  _scheduleReconnect(ms) {
    if (this.reconnectTimer || !this.enabled) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, ms);
  }
}

module.exports = DiscordRPC;
