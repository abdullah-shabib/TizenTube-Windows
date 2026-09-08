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
 * Shared design tokens for everything this app draws over YouTube.
 *
 * The settings overlay and the volume HUD are separate top-level elements, so
 * without a single source of truth the palette drifts between them - which is
 * exactly what happened once already.
 *
 * Values follow YouTube's dark theme. Names are prefixed --tt- so they cannot
 * collide with YouTube's own --yt-* custom properties on the page.
 */

const THEME_CSS = `
  :root {
    --tt-bg:          #0f0f0f;  /* page backdrop                 */
    --tt-surface:     #212121;  /* dialogs and menus             */
    --tt-surface-2:   #282828;  /* raised rows and chips         */
    --tt-surface-3:   #383838;  /* hover                         */
    --tt-border:      #303030;
    --tt-border-2:    #3f3f3f;
    --tt-text:        #f1f1f1;  /* primary text                  */
    --tt-text-2:      #aaaaaa;  /* secondary text                */
    --tt-text-3:      #717171;  /* hints                         */
    --tt-accent:      #ff0000;  /* brand red, fills only         */
    --tt-accent-text: #ff5c54;  /* small text: 4.85:1 on surface */
    --tt-accent-dim:  rgba(255, 0, 0, 0.35);
    --tt-red:         #ff0000;
    --tt-red-hover:   #cc0000;
    --tt-focus:       #ffffff;  /* the TV UI marks focus with a light fill */
    --tt-focus-fg:    #0f0f0f;
    --tt-radius:      12px;
    --tt-radius-pill: 999px;
    --tt-scrim:       rgba(15, 15, 15, 0.92);
    --tt-shadow:      0 10px 30px rgba(0, 0, 0, 0.7);
    --tt-font: 'YouTube Sans', Roboto, 'Segoe UI', Arial, sans-serif;
  }
`;

const STYLE_ID = 'tizentube-theme-tokens';

// Injected once, by whichever subsystem initialises first.
function ensureThemeTokens() {
  try {
    if (document.getElementById(STYLE_ID)) return;
    const root = document.head || document.documentElement;
    if (!root) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = THEME_CSS;
    root.appendChild(style);
  } catch (e) {
    // Styling is not worth taking anything else down for.
  }
}

module.exports = { THEME_CSS, ensureThemeTokens };
