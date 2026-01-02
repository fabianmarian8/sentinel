/**
 * Screenshot configuration constants
 *
 * Global settings for screenshot capture across the extractor package.
 */

/**
 * Screenshot padding around element in pixels.
 *
 * At 96 DPI: 10cm = 378px, so 189px padding on each side = 10x10cm context total.
 * This provides enough context around the monitored element while keeping file size small.
 */
export const SCREENSHOT_PADDING_PX = 189;

/**
 * Default JPEG quality for screenshots (0-100).
 * 80 provides good quality/size balance.
 */
export const SCREENSHOT_QUALITY = 80;
