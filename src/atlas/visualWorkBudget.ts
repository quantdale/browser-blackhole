/**
 * Global visual-work budget. Destinations consume this resolved object; they
 * do not create private quality governors. Values are bounded normalized
 * controls so a service can map them to its own compile-time upper bound.
 */

import type { GovernorActivityMode, QualityTier, VisualWorkBudget } from './types';

const BASE_BY_TIER: Readonly<Record<QualityTier, Omit<VisualWorkBudget, 'tier' | 'activityMode'>>> =
  {
    low: {
      renderScale: 0.6,
      temporalEnabled: false,
      temporalHistoryFrames: 1,
      temporalJitterScale: 0,
      volumeActiveSteps: 0.5,
      volumeInternalScale: 0.5,
      volumeDetailOctaves: 1,
      volumeLightingTaps: 0,
      particlePopulationScale: 0.45,
      particleProfileQuality: 0.25,
      strandQuality: 0,
      environmentDetail: 0.35,
      bloomResolutionScale: 0.35,
      glareEnabled: false,
      lensingSupersampleQuality: 0
    },
    medium: {
      renderScale: 0.8,
      temporalEnabled: false,
      temporalHistoryFrames: 2,
      temporalJitterScale: 0,
      volumeActiveSteps: 0.72,
      volumeInternalScale: 0.6,
      volumeDetailOctaves: 2,
      volumeLightingTaps: 0,
      particlePopulationScale: 0.7,
      particleProfileQuality: 0.5,
      strandQuality: 0.25,
      environmentDetail: 0.55,
      bloomResolutionScale: 0.5,
      glareEnabled: false,
      lensingSupersampleQuality: 0.25
    },
    high: {
      renderScale: 1,
      temporalEnabled: true,
      temporalHistoryFrames: 8,
      temporalJitterScale: 0.5,
      volumeActiveSteps: 0.88,
      volumeInternalScale: 0.75,
      volumeDetailOctaves: 3,
      volumeLightingTaps: 1,
      particlePopulationScale: 1,
      particleProfileQuality: 0.8,
      strandQuality: 0.75,
      environmentDetail: 0.8,
      bloomResolutionScale: 0.65,
      glareEnabled: false,
      lensingSupersampleQuality: 0.6
    },
    ultra: {
      renderScale: 1,
      temporalEnabled: true,
      temporalHistoryFrames: 16,
      temporalJitterScale: 0.75,
      volumeActiveSteps: 1,
      volumeInternalScale: 1,
      volumeDetailOctaves: 5,
      volumeLightingTaps: 2,
      particlePopulationScale: 1,
      particleProfileQuality: 1,
      strandQuality: 1,
      environmentDetail: 1,
      bloomResolutionScale: 0.75,
      glareEnabled: true,
      lensingSupersampleQuality: 1
    }
  };

/**
 * Resolve the bounded budget for a tier/activity pair. Interaction reduces
 * expensive detail once, settling restores a middle budget, and stable uses
 * the tier's full values. The tier ladder remains the only adaptive authority.
 */
export function resolveVisualWorkBudget(
  tier: QualityTier,
  activityMode: GovernorActivityMode
): VisualWorkBudget {
  const base = BASE_BY_TIER[tier];
  const factor = activityMode === 'interaction' ? 0.65 : activityMode === 'settling' ? 0.85 : 1;
  const historyFrames =
    activityMode === 'interaction'
      ? 1
      : Math.max(
          1,
          Math.floor(base.temporalHistoryFrames * (activityMode === 'settling' ? 0.5 : 1))
        );
  return {
    tier,
    activityMode,
    ...base,
    volumeActiveSteps: Math.max(0.35, base.volumeActiveSteps * factor),
    volumeInternalScale: Math.max(
      0.5,
      base.volumeInternalScale * (activityMode === 'interaction' ? 0.8 : 1)
    ),
    volumeDetailOctaves: Math.max(1, Math.floor(base.volumeDetailOctaves * factor)),
    volumeLightingTaps: Math.floor(base.volumeLightingTaps * factor),
    particlePopulationScale: Math.max(0.3, base.particlePopulationScale * factor),
    particleProfileQuality: Math.max(0.25, base.particleProfileQuality * factor),
    strandQuality: base.strandQuality * factor,
    environmentDetail: Math.max(0.25, base.environmentDetail * factor),
    bloomResolutionScale: Math.max(
      0.35,
      base.bloomResolutionScale * (activityMode === 'interaction' ? 0.7 : 1)
    ),
    glareEnabled: base.glareEnabled && activityMode === 'stable',
    lensingSupersampleQuality: base.lensingSupersampleQuality * factor,
    temporalEnabled: base.temporalEnabled,
    temporalHistoryFrames: historyFrames,
    temporalJitterScale: base.temporalJitterScale * (activityMode === 'interaction' ? 0.35 : 1)
  };
}
