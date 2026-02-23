# Deep Report: Text Synchronization Mechanism

This report details how the system achieves perfect synchronization between the **HTML Text Overlay** (used for editing) and the **PIXI Text Rendering** (used for display and animation).

## 1. Dual-Rendering Architecture
The application uses two distinct rendering layers for text:
*   **displayObject (PIXI.Text)**: High-performance, GPU-accelerated rendering used for playback, animations, and static display.
*   **TextEditOverlay (HTML)**: A `contentEditable` `<div>` that appears only during editing. It leverages the browser's native text engine for advanced features like cursors, selections, and complex IME input.

The goal is a **1:1 visual match** so that switching between display and edit modes is "invisible" to the user.

---

## 2. Style Parity
Synchronization begins with identical styling configurations derived from the Redux store ([projectSlice.js](file:///c:/Users/User/Downloads/vevaramotion-front-main%20temp/vevaramotion-front-main/src/store/slices/projectSlice.js)).

| Property | PIXI (`createTextLayer.js`) | HTML ([TextEditOverlay.jsx](file:///c:/Users/User/Downloads/vevaramotion-front-main%20temp/vevaramotion-front-main/src/features/editor/components/TextEditOverlay.jsx)) |
| :--- | :--- | :--- |
| **Font Family** | `data.fontFamily` (Default: Arial) | `style.fontFamily` |
| **Font Size** | `data.fontSize` (Pixels) | `fontSize * zoomScale` |
| **Font Weight** | `data.fontWeight` (normal/bold/etc.) | `style.fontWeight` |
| **Color** | `data.color` (Hex) | `style.color` |
| **Text Align** | `data.textAlign` (left/center/right) | `style.textAlign` |
| **Letter Spacing** | Default: 0 | `style.letterSpacing = '0'` |
| **Line Height** | `fontSize * 1.2` (Fixed Pixels) | `fontSize * 1.2` (Fixed Pixels) |

> [!IMPORTANT]
> Both engines use a fixed **1.2x multiplier** for line-height. This avoids browser-default line-height variations across different fonts.

---

## 3. Layout and Wrapping Logic
To ensure line breaks occur at exactly the same character, the wrapping logic is unified:

*   **PIXI**: `wordWrap: true`, `wordWrapWidth: layer.width`, `breakWords: true`.
*   **HTML**: `whiteSpace: 'pre-wrap'`, `overflowWrap: 'anywhere'`, `wordBreak: 'break-word'`, and `width: layer.width * zoomScale`.

By setting `boxSizing: 'content-box'` and `padding: 0` in the HTML overlay, the content dimensions exactly match the PIXI bounds.

---

## 4. Geometric Alignment (The "Center-Based" System)
PIXI and HTML use different coordinate systems by default. The system reconciles them using a **Center-Origin** approach:

1.  **PIXI Transformation**:
    *   The `anchor` is set horizontally based on alignment (0 for left, 0.5 for center, 1 for right).
    *   The `pivot` is used to shift the rotation center to the **geometric center** of the text box (`width/2`, `actualHeight/2`).
    *   This allows the Redux [(x, y)](file:///c:/Users/User/Downloads/vevaramotion-front-main%20temp/vevaramotion-front-main/src/features/editor/hooks/useSelectionBox.js#410-417) to represent the center of the text.

2.  **HTML Transformation**:
    *   Positioned via `fixed` at the viewport screen coordinate.
    *   Uses `transform: translate(-50%, -50%) rotate(${rotation}deg)`.
    *   **The Baseline Nudge**: A `translateY(0.35px)` is applied to the HTML overlay. This "magic number" compensates for the slight baseline rendering difference between PIXI's Canvas-based text and the DOM engine.

---

## 5. Dynamic Sizing (Height Sync)
Text layers are "Auto-Height". As content changes, the height must be calculated to update the selection box and pivot points.

*   **Logic Location**: [useCanvasLayers.js](file:///c:/Users/User/Downloads/vevaramotion-front-main%20temp/vevaramotion-front-main/src/features/editor/hooks/useCanvasLayers.js) ([calculateTextHeight](file:///c:/Users/User/Downloads/vevaramotion-front-main%20temp/vevaramotion-front-main/src/features/editor/hooks/useCanvasLayers.js#141-183) function).
*   **Measurement Engine**: Uses `PIXI.TextMetrics.measureText` (a fast, non-rendering way to get pixel-accurate bounds).
*   **Synchronization Flow**:
    1.  User types in HTML Overlay.
    2.  `onTextChange` updates Redux `content`.
    3.  [useCanvasLayers](file:///c:/Users/User/Downloads/vevaramotion-front-main%20temp/vevaramotion-front-main/src/features/editor/hooks/useCanvasLayers.js#480-1096) observes change, runs `measureText`.
    4.  If measured height differs significantly (>1px), [updateLayer](file:///c:/Users/User/Downloads/vevaramotion-front-main%20temp/vevaramotion-front-main/src/store/slices/projectSlice.js#221-237) dispatches a new `height` to Redux.
    5.  The [useSelectionBox](file:///c:/Users/User/Downloads/vevaramotion-front-main%20temp/vevaramotion-front-main/src/features/editor/hooks/useSelectionBox.js#244-3664) hook sees the new height and redraws the purple outline.

---

## 6. Real-time Viewport Tracking
During zooming or panning, the HTML overlay must follow the PIXI canvas perfectly. 

*   [TextEditOverlay.jsx](file:///c:/Users/User/Downloads/vevaramotion-front-main%20temp/vevaramotion-front-main/src/features/editor/components/TextEditOverlay.jsx) runs a `requestAnimationFrame` loop that checks the PIXI `viewport` state (`x`, `y`, `scale`).
*   It also listens to viewport events (`moved`, `zoomed`).
*   On every frame/event, it recalibrates `left`, [top](file:///c:/Users/User/Downloads/vevaramotion-front-main%20temp/vevaramotion-front-main/src/store/slices/projectSlice.js#609-619), `width`, and `fontSize` based on the current `zoomScale` and `viewport.toScreen()` coordinates.

---

## 7. Performance Considerations
*   **Resolution 4**: PIXI text is rendered at 4x resolution to remain crisp even at high zoom levels, matching the native clarity of DOM text.
*   **Throttling**: Redux height updates are debounced (200ms) unless the user is actively editing, in which case they are immediate for responsiveness.
*   **Robust Texture Loading**: Fonts are pre-loaded via [textureUtils.js](file:///c:/Users/User/Downloads/vevaramotion-front-main%20temp/vevaramotion-front-main/src/features/engine/pixi/textureUtils.js) ensuring that PIXI has the font metrics available before the first render.

---

## Summary of Files Analyzed
*   [createLayer.js](file:///c:/Users/User/Downloads/vevaramotion-front-main%20temp/vevaramotion-front-main/src/features/engine/pixi/createLayer.js): PIXI text initialization and pivot logic.
*   [TextEditOverlay.jsx](file:///c:/Users/User/Downloads/vevaramotion-front-main%20temp/vevaramotion-front-main/src/features/editor/components/TextEditOverlay.jsx): HTML editing logic and style-syncing loop.
*   [useCanvasLayers.js](file:///c:/Users/User/Downloads/vevaramotion-front-main%20temp/vevaramotion-front-main/src/features/editor/hooks/useCanvasLayers.js): Strategic height calculation and Redux sync.
*   [useSelectionBox.js](file:///c:/Users/User/Downloads/vevaramotion-front-main%20temp/vevaramotion-front-main/src/features/editor/hooks/useSelectionBox.js): Accurate bounding box logic during interaction.
*   [textureUtils.js](file:///c:/Users/User/Downloads/vevaramotion-front-main%20temp/vevaramotion-front-main/src/features/engine/pixi/textureUtils.js): Robust asset loading for font consistency.
