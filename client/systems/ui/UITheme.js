import { PALETTE, PALETTE_INDEX } from '../../../shared/Constants.js';

/**
 * UITheme — Canonical palette-indexed color management for Sanctum UI.
 * 
 * Guarantees that UI elements resolve colors independently of world lighting
 * and environmental brightness bands, while supporting global palette swapping.
 */
export class UITheme {
  constructor() {
    this.palette = [...PALETTE];
    this.index = { ...PALETTE_INDEX };
    this.cachedRgb = this.palette.map((hex) => [
      parseInt(hex.slice(1, 3), 16),
      parseInt(hex.slice(3, 5), 16),
      parseInt(hex.slice(5, 7), 16)
    ]);

    // Standardized semantic UI color tokens referencing PALETTE_INDEX
    this.tokens = {
      // Panel backgrounds & frames
      PANEL_BG: PALETTE_INDEX.BLACK,
      PANEL_INSET: PALETTE_INDEX.DARK_BLUE,
      PANEL_BORDER_LIGHT: PALETTE_INDEX.LIGHT_GRAY,
      PANEL_BORDER_DARK: PALETTE_INDEX.BLACK,
      PANEL_BRONZE: PALETTE_INDEX.BROWN,
      PANEL_GOLD: PALETTE_INDEX.ORANGE,
      PANEL_RIVET: PALETTE_INDEX.YELLOW,

      // Typography
      TEXT_NORMAL: PALETTE_INDEX.WHITE,
      TEXT_MUTED: PALETTE_INDEX.LIGHT_GRAY,
      TEXT_DARK: PALETTE_INDEX.DARK_GRAY,
      TEXT_ACCENT: PALETTE_INDEX.YELLOW,
      TEXT_HEADER: PALETTE_INDEX.ORANGE,
      TEXT_HIGHLIGHT: PALETTE_INDEX.PEACH,

      // Button interaction states
      BUTTON_BG: PALETTE_INDEX.DARK_GRAY,
      BUTTON_BORDER_LIGHT: PALETTE_INDEX.LIGHT_GRAY,
      BUTTON_BORDER_DARK: PALETTE_INDEX.BLACK,
      BUTTON_HOVER_BG: PALETTE_INDEX.INDIGO,
      BUTTON_HOVER_BORDER: PALETTE_INDEX.BLUE,
      BUTTON_PRESSED_BG: PALETTE_INDEX.DARK_BLUE,
      BUTTON_DISABLED_TEXT: PALETTE_INDEX.DARK_GRAY,

      // Sockets & slots
      SLOT_BG: PALETTE_INDEX.BLACK,
      SLOT_BORDER: PALETTE_INDEX.DARK_GRAY,
      SLOT_HOVER_BORDER: PALETTE_INDEX.YELLOW,
      SLOT_EMPTY_ICON: PALETTE_INDEX.DARK_GRAY,

      // Vitals & Progression
      HEALTH_FILL: PALETTE_INDEX.RED,
      HEALTH_LIGHT: PALETTE_INDEX.PINK,
      MANA_FILL: PALETTE_INDEX.BLUE,
      MANA_LIGHT: PALETTE_INDEX.WHITE,
      XP_FILL: PALETTE_INDEX.YELLOW,
      XP_BG: PALETTE_INDEX.BLACK,

      // Rarity borders
      RARITY_NORMAL: PALETTE_INDEX.WHITE,
      RARITY_MAGIC: PALETTE_INDEX.BLUE,
      RARITY_RARE: PALETTE_INDEX.YELLOW,
      RARITY_UNIQUE: PALETTE_INDEX.ORANGE
    };
  }

  /**
   * Updates the active palette array (for themes, color-blind modes, or biome themes).
   */
  setPalette(newPalette) {
    if (Array.isArray(newPalette) && newPalette.length >= 16) {
      this.palette = [...newPalette];
      this.cachedRgb = this.palette.map((hex) => [
        parseInt(hex.slice(1, 3), 16),
        parseInt(hex.slice(3, 5), 16),
        parseInt(hex.slice(5, 7), 16)
      ]);
    }
  }

  /**
   * Resolves a palette index or semantic token to a CSS hex string.
   */
  getHex(idxOrToken) {
    const idx = typeof idxOrToken === 'number' ? idxOrToken : (this.tokens[idxOrToken] ?? PALETTE_INDEX.WHITE);
    return this.palette[idx] || '#FFFFFF';
  }

  /**
   * Resolves a palette index to an RGBA color string.
   */
  getRgba(idxOrToken, alpha = 1.0) {
    const idx = typeof idxOrToken === 'number' ? idxOrToken : (this.tokens[idxOrToken] ?? PALETTE_INDEX.WHITE);
    const rgb = this.cachedRgb[idx] || [255, 255, 255];
    return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
  }

  /**
   * Resolves a palette index to [r, g, b] array.
   */
  getRgb(idxOrToken) {
    const idx = typeof idxOrToken === 'number' ? idxOrToken : (this.tokens[idxOrToken] ?? PALETTE_INDEX.WHITE);
    return this.cachedRgb[idx] || [255, 255, 255];
  }
}

// Global default theme instance
export const uiTheme = new UITheme();
