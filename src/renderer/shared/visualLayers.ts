/**
 * Shared presentation-layer tags. Layers are renderer plumbing, not physics:
 * an emissive object may be rendered into the selective-highlight auxiliary
 * target without changing the scene's authoritative radiance or visibility.
 */

/** Reserved camera layer for the SharedPost selective-highlight pass. */
export const CINEMATIC_EMISSIVE_LAYER = 30;
