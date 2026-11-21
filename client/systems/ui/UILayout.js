/**
 * UILayout — Viewport sizing, quantized scale tiers, responsive screen anchors,
 * and integer pixel snapping for Sanctum UI.
 */

export const UI_ANCHOR = {
  TOP_LEFT: 'TOP_LEFT',
  TOP_CENTER: 'TOP_CENTER',
  TOP_RIGHT: 'TOP_RIGHT',
  BOTTOM_LEFT: 'BOTTOM_LEFT',
  BOTTOM_CENTER: 'BOTTOM_CENTER',
  BOTTOM_RIGHT: 'BOTTOM_RIGHT',
  CENTER: 'CENTER',
  CUSTOM: 'CUSTOM'
};

export const UI_SCALE_TIER = {
  COMPACT: 'COMPACT',   // < 720px width
  STANDARD: 'STANDARD', // 720px – 1199px
  LARGE: 'LARGE',       // 1200px – 1799px
  ULTRA: 'ULTRA'        // >= 1800px
};

export const UI_LAYOUT_CONFIG = {
  BASE_WIDTH: 720,
  BASE_HEIGHT: 432,
  MAX_SAFE_ASPECT: 16 / 9, // Constraint for HUD anchors on ultrawide displays
  MIN_TOUCH_HITBOX: 36     // Minimum physical pixel hit target for touch devices
};

export class UILayout {
  constructor() {
    this.stageW = 720;
    this.stageH = 432;
    this.dpr = 1;
    this.scale = 1.0;
    this.tier = UI_SCALE_TIER.STANDARD;
    this.userScalePreference = 'AUTO'; // AUTO | 75 | 100 | 125 | 150
    this.safeZone = { x: 0, y: 0, w: 720, h: 432 };
    this.isWide = false;
    this.isMedium = true;
    this.isCompact = false;
  }

  /**
   * Recalculates layout metrics when the stage or browser window resizes.
   */
  update(stageW, stageH, dpr = 1) {
    this.stageW = stageW;
    this.stageH = stageH;
    this.dpr = dpr || 1;

    // Breakpoint classification
    this.isWide = stageW >= 960;
    this.isMedium = stageW >= 720 && stageW < 960;
    this.isCompact = stageW < 720;

    // Compute Scale Tier
    if (stageW < 720) {
      this.tier = UI_SCALE_TIER.COMPACT;
      this.scale = Math.max(0.72, Math.round((stageW / UI_LAYOUT_CONFIG.BASE_WIDTH) * 20) / 20);
    } else if (stageW < 1200) {
      this.tier = UI_SCALE_TIER.STANDARD;
      this.scale = 1.0;
    } else if (stageW < 1800) {
      this.tier = UI_SCALE_TIER.LARGE;
      this.scale = 1.25;
    } else {
      this.tier = UI_SCALE_TIER.ULTRA;
      this.scale = 1.5;
    }

    // Apply manual user scale preference if set
    if (this.userScalePreference === '75') this.scale = 0.75;
    else if (this.userScalePreference === '100') this.scale = 1.0;
    else if (this.userScalePreference === '125') this.scale = 1.25;
    else if (this.userScalePreference === '150') this.scale = 1.5;

    // Compute Ultrawide Safe Zone (keeps HUD elements within comfortable peripheral vision)
    const aspect = stageW / stageH;
    if (aspect > UI_LAYOUT_CONFIG.MAX_SAFE_ASPECT) {
      const safeW = Math.round(stageH * UI_LAYOUT_CONFIG.MAX_SAFE_ASPECT);
      const safeX = Math.round((stageW - safeW) / 2);
      this.safeZone = { x: safeX, y: 0, w: safeW, h: stageH };
    } else {
      this.safeZone = { x: 0, y: 0, w: stageW, h: stageH };
    }
  }

  setUserScalePreference(pref) {
    this.userScalePreference = pref;
    this.update(this.stageW, this.stageH, this.dpr);
  }

  /**
   * Snaps a value to the nearest integer pixel to avoid subpixel antialiasing blur.
   */
  snap(val) {
    return Math.round(val);
  }

  /**
   * Resolves absolute screen (x, y) coordinates for a component based on its anchor.
   */
  resolveAnchor(anchor, w, h, offsetX = 0, offsetY = 0, useSafeZone = true) {
    const zone = useSafeZone ? this.safeZone : { x: 0, y: 0, w: this.stageW, h: this.stageH };
    const scaledOffX = Math.round(offsetX * this.scale);
    const scaledOffY = Math.round(offsetY * this.scale);

    let x = 0;
    let y = 0;

    switch (anchor) {
      case UI_ANCHOR.TOP_LEFT:
        x = zone.x + scaledOffX;
        y = zone.y + scaledOffY;
        break;

      case UI_ANCHOR.TOP_CENTER:
        x = zone.x + Math.round((zone.w - w) / 2) + scaledOffX;
        y = zone.y + scaledOffY;
        break;

      case UI_ANCHOR.TOP_RIGHT:
        x = zone.x + zone.w - w - scaledOffX;
        y = zone.y + scaledOffY;
        break;

      case UI_ANCHOR.BOTTOM_LEFT:
        x = zone.x + scaledOffX;
        y = zone.y + zone.h - h - scaledOffY;
        break;

      case UI_ANCHOR.BOTTOM_CENTER:
        x = zone.x + Math.round((zone.w - w) / 2) + scaledOffX;
        y = zone.y + zone.h - h - scaledOffY;
        break;

      case UI_ANCHOR.BOTTOM_RIGHT:
        x = zone.x + zone.w - w - scaledOffX;
        y = zone.y + zone.h - h - scaledOffY;
        break;

      case UI_ANCHOR.CENTER:
        x = zone.x + Math.round((zone.w - w) / 2) + scaledOffX;
        y = zone.y + Math.round((zone.h - h) / 2) + scaledOffY;
        break;

      case UI_ANCHOR.CUSTOM:
      default:
        x = scaledOffX;
        y = scaledOffY;
        break;
    }

    return { x: Math.round(x), y: Math.round(y) };
  }
}

export const uiLayout = new UILayout();
