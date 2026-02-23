/**
 * Canvas Interaction Utilities Index
 *
 * This module serves as the central export point for all canvas interaction utilities.
 * It re-exports functions from specialized utility modules to provide a clean,
 * organized API for canvas-related operations.
 *
 * Modules included:
 * - layerUtils: Layer identification and bounds calculation
 * - badgeUtils: Dimension badge creation and management
 * - handleUtils: Interactive handle creation and positioning
 * - geometry: Core geometry calculations and intersections
 * - centerSnapping: Advanced snapping system for canvas interactions
 *
 * This allows hooks to import only the utilities they need while maintaining
 * a clean separation of concerns across the canvas interaction system.
 */

export * from './layerUtils'
export * from './badgeUtils'
export * from './handleUtils'
export * from './geometry'
export * from './centerSnapping'
export * from './viewportUtils'
