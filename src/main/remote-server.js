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
 * TizenTube Windows - Remote & Mobile Typing Companion Server
 * Lightweight, zero-dependency Node.js HTTP server running on LAN.
 * Serves a mobile-friendly remote control and on-screen keyboard companion.
 */

const http = require('http');
const os = require('os');
const { EventEmitter } = require('events');
const { generateQRCodeSVG } = require('./qr');

function getLocalIpAddress() {
  const interfaces = os.networkInterfaces();
  const candidates = [];

  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        const isEthernet = /eth|ethernet|local/i.test(name);
        const isWifi = /wi-?fi|wlan/i.test(name);
        candidates.push({ address: iface.address, priority: isEthernet ? 2 : (isWifi ? 1 : 0) });
      }
    }
  }

  candidates.sort((a, b) => b.priority - a.priority);
  return candidates.length > 0 ? candidates[0].address : '127.0.0.1';
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1e5) {
        req.destroy();
        reject(new Error('Body too large'));
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function getMobileHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>TizenTube Remote</title>
  <style>
    :root {
      --bg: #0f0f0f;
      --surface: #1e1e1e;
      --surface-2: #282828;
      --border: #383838;
      --accent: #ff0000;
      --accent-hover: #cc0000;
      --text: #f1f1f1;
      --text-muted: #aaa;
      --radius: 12px;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; -webkit-tap-highlight-color: transparent; }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      padding: 16px;
      max-width: 480px;
      margin: 0 auto;
      display: flex;
      flex-direction: column;
      gap: 16px;
      user-select: none;
    }
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-bottom: 8px;
      border-bottom: 1px solid var(--border);
    }
    .brand {
      font-size: 18px;
      font-weight: 700;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .brand-accent { color: var(--accent); }
    .status-badge {
      font-size: 12px;
      padding: 4px 8px;
      border-radius: 20px;
      background: rgba(46, 160, 67, 0.2);
      color: #3fb950;
      font-weight: 600;
    }
    .now-playing {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .now-playing-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-muted); }
    .now-playing-title { font-size: 14px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    
    .card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 14px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .card-title {
      font-size: 13px;
      font-weight: 600;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .search-row {
      display: flex;
      gap: 8px;
    }
    input[type="text"] {
      flex: 1;
      background: var(--surface-2);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 12px 14px;
      color: var(--text);
      font-size: 15px;
      outline: none;
    }
    input[type="text"]:focus {
      border-color: var(--accent);
    }
    button {
      background: var(--surface-2);
      border: 1px solid var(--border);
      color: var(--text);
      padding: 10px 14px;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      transition: background 0.1s, transform 0.05s;
    }
    button:active {
      transform: scale(0.96);
      background: var(--border);
    }
    .btn-accent {
      background: var(--accent);
      border-color: var(--accent);
      color: #fff;
    }
    .btn-accent:active {
      background: var(--accent-hover);
    }

    /* D-Pad Layout */
    .dpad-container {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      grid-template-rows: repeat(3, 56px);
      gap: 8px;
      max-width: 260px;
      margin: 0 auto;
      width: 100%;
    }
    .dpad-up    { grid-column: 2; grid-row: 1; }
    .dpad-left  { grid-column: 1; grid-row: 2; }
    .dpad-ok    { grid-column: 2; grid-row: 2; background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 700; font-size: 16px; }
    .dpad-right { grid-column: 3; grid-row: 2; }
    .dpad-down  { grid-column: 2; grid-row: 3; }
    .dpad-back  { grid-column: 1; grid-row: 3; }
    .dpad-home  { grid-column: 3; grid-row: 3; }

    /* Media Grid */
    .btn-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 8px;
    }
    .speed-pills {
      display: flex;
      gap: 6px;
    }
    .speed-pills button {
      flex: 1;
      padding: 8px 4px;
      font-size: 13px;
    }
    .toast {
      position: fixed;
      bottom: 20px;
      left: 50%;
      transform: translateX(-50%) translateY(20px);
      background: rgba(30, 30, 30, 0.95);
      border: 1px solid var(--border);
      padding: 10px 18px;
      border-radius: 20px;
      font-size: 13px;
      color: #fff;
      opacity: 0;
      pointer-events: none;
      transition: all 0.2s ease;
      z-index: 100;
    }
    .toast.show {
      opacity: 1;
      transform: translateX(-50%) translateY(0);
    }
  </style>
</head>
<body>
  <header>
    <div class="brand">
      <span class="brand-accent">&#9654;</span> TizenTube Remote
    </div>
    <div class="status-badge" id="conn-status">Connected</div>
  </header>

  <div class="now-playing">
    <div class="now-playing-label">Now Playing</div>
    <div class="now-playing-title" id="media-title">No media playing</div>
  </div>

  <!-- Search & Typing -->
  <div class="card">
    <div class="card-title">Search & Type on TV</div>
    <div class="search-row">
      <input type="text" id="search-input" placeholder="Type search query or video URL..." autocomplete="off">
      <button id="btn-mic" title="Voice dictation">&#127908;</button>
    </div>
    <div style="display: flex; gap: 8px;">
      <button class="btn-accent" style="flex: 2;" id="btn-search">&#128269; Search on TV</button>
      <button style="flex: 1;" id="btn-paste">&#128203; Paste</button>
    </div>
  </div>

  <!-- TV Navigation D-Pad -->
  <div class="card">
    <div class="card-title">Navigation</div>
    <div class="dpad-container">
      <button class="dpad-up" data-action="ArrowUp">&#9650;</button>
      <button class="dpad-left" data-action="ArrowLeft">&#9664;</button>
      <button class="dpad-ok" data-action="Enter">OK</button>
      <button class="dpad-right" data-action="ArrowRight">&#9654;</button>
      <button class="dpad-back" data-action="Escape">&#8617; Back</button>
      <button class="dpad-down" data-action="ArrowDown">&#9660;</button>
      <button class="dpad-home" data-action="ToggleFullscreen">&#x26F6;</button>
    </div>
  </div>

  <!-- Playback & Volume -->
  <div class="card">
    <div class="card-title">Playback & Volume</div>
    <div class="btn-grid">
      <button data-action="SeekLeft">&#9194; -10s</button>
      <button class="btn-accent" data-action="PlayPause">&#9654;&#10074;&#10074; Play</button>
      <button data-action="SeekRight">+10s &#9193;</button>
      <button data-action="VolumeDown">&#128265; Vol -</button>
      <button data-action="VolumeMute">&#128263; Mute</button>
      <button data-action="VolumeUp">&#128266; Vol +</button>
    </div>
    <div style="margin-top: 4px;">
      <div style="font-size: 11px; color: var(--text-muted); margin-bottom: 6px; text-transform: uppercase;">Playback Speed</div>
      <div class="speed-pills">
        <button data-speed="1.0">1.0x</button>
        <button data-speed="1.25">1.25x</button>
        <button data-speed="1.5">1.5x</button>
        <button data-speed="2.0">2.0x</button>
      </div>
    </div>
    <div style="display: flex; gap: 8px; margin-top: 4px;">
      <button style="flex: 1;" data-action="ToggleOverlay">&#9881; Settings</button>
      <button style="flex: 1;" data-action="TogglePiP">&#9744; Mini-Player</button>
    </div>
  </div>

  <div class="toast" id="toast"></div>

  <script>
    function haptic() {
      if (navigator.vibrate) {
        try { navigator.vibrate(25); } catch (e) {}
      }
    }

    function showToast(msg) {
      const toast = document.getElementById('toast');
      toast.textContent = msg;
      toast.classList.add('show');
      setTimeout(() => toast.classList.remove('show'), 2000);
    }

    async function sendAction(action) {
      haptic();
      try {
        await fetch('/api/action', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action })
        });
      } catch (e) {
        showToast('Connection failed');
      }
    }

    async function sendSearch(query) {
      if (!query || !query.trim()) return;
      haptic();
      try {
        const res = await fetch('/api/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: query.trim() })
        });
        if (res.ok) {
          showToast('Search sent to TV');
          document.getElementById('search-input').value = '';
        }
      } catch (e) {
        showToast('Search error');
      }
    }

    async function setSpeed(speed) {
      haptic();
      try {
        await fetch('/api/speed', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ speed: parseFloat(speed) })
        });
        showToast('Speed set to ' + speed + 'x');
      } catch (e) {
        showToast('Error setting speed');
      }
    }

    // Attach button listeners
    document.querySelectorAll('button[data-action]').forEach(btn => {
      btn.addEventListener('click', () => sendAction(btn.getAttribute('data-action')));
    });

    document.querySelectorAll('button[data-speed]').forEach(btn => {
      btn.addEventListener('click', () => setSpeed(btn.getAttribute('data-speed')));
    });

    const searchInput = document.getElementById('search-input');
    const searchBtn = document.getElementById('btn-search');
    const pasteBtn = document.getElementById('btn-paste');
    const micBtn = document.getElementById('btn-mic');

    searchBtn.addEventListener('click', () => sendSearch(searchInput.value));
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        sendSearch(searchInput.value);
      }
    });

    pasteBtn.addEventListener('click', async () => {
      try {
        const text = await navigator.clipboard.readText();
        if (text) {
          searchInput.value = text;
          sendSearch(text);
        }
      } catch (err) {
        showToast('Clipboard access denied');
      }
    });

    // Voice Dictation
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = false;

      recognition.onstart = () => {
        micBtn.style.color = '#ff0000';
        showToast('Listening...');
      };
      recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        if (transcript) {
          searchInput.value = transcript;
          sendSearch(transcript);
        }
      };
      recognition.onend = () => {
        micBtn.style.color = '';
      };
      recognition.onerror = () => {
        micBtn.style.color = '';
        showToast('Speech recognition error');
      };
      micBtn.addEventListener('click', () => recognition.start());
    } else {
      micBtn.style.display = 'none';
    }

    // Status polling
    async function updateStatus() {
      try {
        const res = await fetch('/api/status');
        if (res.ok) {
          const data = await res.json();
          document.getElementById('conn-status').textContent = 'Connected';
          document.getElementById('conn-status').style.color = '#3fb950';
          if (data.media && data.media.title) {
            document.getElementById('media-title').textContent = data.media.title;
          } else {
            document.getElementById('media-title').textContent = 'No media playing';
          }
        }
      } catch (e) {
        document.getElementById('conn-status').textContent = 'Disconnected';
        document.getElementById('conn-status').style.color = '#f85149';
      }
    }
    setInterval(updateStatus, 3000);
    updateStatus();
  </script>
</body>
</html>`;
}

class RemoteServer extends EventEmitter {
  constructor(options = {}) {
    super();
    this.port = options.port || 8989;
    this.server = null;
    this.ip = getLocalIpAddress();
    this.latestMedia = {};
    this.latestSpeed = 1.0;
    this.running = false;
  }

  getUrl() {
    return `http://${this.ip}:${this.port}`;
  }

  getQRCodeSVG(size = 180) {
    return generateQRCodeSVG(this.getUrl(), size);
  }

  setMediaStatus(media) {
    this.latestMedia = media || {};
  }

  setPlaybackSpeed(speed) {
    this.latestSpeed = speed || 1.0;
  }

  start() {
    if (this.server) return Promise.resolve(this.getUrl());

    return new Promise((resolve, reject) => {
      this.server = http.createServer(async (req, res) => {
        // Enable CORS
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

        if (req.method === 'OPTIONS') {
          res.writeHead(204);
          res.end();
          return;
        }

        const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

        if (req.method === 'GET' && url.pathname === '/') {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(getMobileHtml());
          return;
        }

        if (req.method === 'GET' && url.pathname === '/api/status') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            online: true,
            media: this.latestMedia,
            speed: this.latestSpeed
          }));
          return;
        }

        if (req.method === 'POST' && url.pathname === '/api/search') {
          try {
            const body = await parseJsonBody(req);
            this.emit('search', body.query || '');
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
          } catch (e) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: e.message }));
          }
          return;
        }

        if (req.method === 'POST' && url.pathname === '/api/action') {
          try {
            const body = await parseJsonBody(req);
            this.emit('action', body.action || '');
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
          } catch (e) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: e.message }));
          }
          return;
        }

        if (req.method === 'POST' && url.pathname === '/api/speed') {
          try {
            const body = await parseJsonBody(req);
            this.emit('speed', body.speed || 1.0);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
          } catch (e) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: e.message }));
          }
          return;
        }

        res.writeHead(404);
        res.end('Not Found');
      });

      const onListen = () => {
        this.running = true;
        console.log(`[TizenTube Remote] Mobile companion server listening at: ${this.getUrl()}`);
        resolve(this.getUrl());
      };

      const onError = (err) => {
        if (err.code === 'EADDRINUSE') {
          console.warn(`[TizenTube Remote] Port ${this.port} in use, trying ${this.port + 1}...`);
          this.port++;
          this.server.close();
          this.server.listen(this.port, onListen);
        } else {
          console.error('[TizenTube Remote] Server failed to start:', err.message);
          reject(err);
        }
      };

      this.server.once('error', onError);
      this.server.listen(this.port, onListen);
    });
  }

  stop() {
    if (this.server) {
      this.server.close();
      this.server = null;
      this.running = false;
      console.log('[TizenTube Remote] Server stopped.');
    }
  }
}

module.exports = RemoteServer;
