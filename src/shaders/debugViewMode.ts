/**
 * Debug view-mode selector shared by the CPU application and the shader
 * pass (docs/STATE_SCHEMA.md section 8, `debug.viewMode`).
 *
 * Neutral home (hosted-product-boot-coverage 1.1): neither the legacy
 * application state module (`src/app/state.ts`) nor any shader owns the
 * type, so a product-path shader module never has to import the legacy
 * application's state module. `src/app/state.ts` re-exports this union and
 * the legacy renderer files keep importing it from there; the set of view
 * modes is unchanged.
 *
 * This is a debug-view selector, not a visual/artistic mode, so it is
 * separate from `visual.mode`: 'diagnostic' keeps the direction-gradient
 * frame; 'off' renders the flat clear color until a real background arrives.
 */
export type DebugViewMode = 'diagnostic' | 'environment' | 'off';
