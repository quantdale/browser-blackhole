/**
 * Full-screen TSL hyperspace star-streak tunnel pass (CA1-04).
 *
 * Spec sources:
 * - docs/cosmic-atlas/PRODUCT_UX_AND_TRANSITIONS.md §5 (hyperspace render design)
 * - docs/cosmic-atlas/WORK_PACKETS.md CA1-04
 * - docs/cosmic-atlas/DECISIONS.md CA-ADR-004 (loading boundary), CA-ADR-009
 *   (fragment/full-screen passes preferred for transition effects), CA-ADR-020.
 *
 * FIDELITY CLASS: CINEMATIC.
 * Disclosure (must be surfaced by any About/Fidelity UI that presents this
 * effect): the hyperspace tunnel is a cinematic navigation effect. It is NOT a
 * relativistically correct faster-than-light travel model and makes no
 * physical claim whatsoever (CA-ADR-020).
 *
 * Implementation notes:
 * - One full-screen quad (three/webgpu `QuadMesh`) with a TSL node material;
 *   no streak meshes, no per-frame CPU geometry (per PRODUCT_UX §5).
 * - Rendered into an internal offscreen `RenderTarget`; `texture` is handed to
 *   the shared post as `transitionOverlay` and composited with an opacity via
 *   `ISharedPost.present(overlay, opacity)`.
 * - All randomness is derived from a seeded uniform (`uSeed`) fed from the
 *   director's mulberry32 PRNG; travel is integrated on the CPU from
 *   deterministic frame deltas, never from wall-clock shader time.
 * - Works on both WebGPU and WebGL2 backends because three r180 drives both
 *   through `WebGPURenderer` and TSL compiles to WGSL/GLSL from one graph
 *   (CA-ADR-008 graceful fallback); no separate fallback path is required.
 */

import {
  ClampToEdgeWrapping,
  LinearFilter,
  RGBAFormat,
  RenderTarget,
  UnsignedByteType,
  type Texture,
} from 'three';
import { MeshBasicNodeMaterial, QuadMesh } from 'three/webgpu';
import {
  atan2,
  clamp,
  exp,
  floor,
  fract,
  hash,
  length,
  max,
  mix,
  mx_fractal_noise_float,
  oneMinus,
  pow,
  smoothstep,
  step,
  sub,
  add,
  div,
  mul,
  uv,
  uniform,
  vec2,
  vec3,
  vec4,
  type ShaderNodeObject,
} from 'three/tsl';
import type { RendererLike } from './types';

/** Human-readable fidelity disclosure for this effect (CA-ADR-006/020). */
export const HYPERSPACE_DISCLOSURE =
  'Cinematic navigation effect (FidelityClass: CINEMATIC). ' +
  'Not a relativistically correct faster-than-light model.';

/** Visual presentation style of the overlay. */
export type HyperspaceStyle = 'streaks' | 'crossfade';

export interface HyperspacePassOptions {
  /** Deterministic seed for the in-shader hash field (from host PRNG). */
  seed?: number;
  /** Initial offscreen size in pixels; clamped internally. */
  width?: number;
  height?: number;
}

/**
 * Canonical node-expression type produced by TSL operators. Every value this
 * file stores or passes between helpers is an operator result, so a single
 * alias keeps the graph code assignment-safe under strict TypeScript.
 */
type Fx = ReturnType<typeof add>;

type TravelUniform = ReturnType<typeof uniform<number>>;

/** Hard cap so the transition can never allocate an oversized target. */
const MAX_DIMENSION_PX = 2048;
const MIN_DIMENSION_PX = 2;

/** Number of unrolled streak layers (fixed at graph-build time). */
const STREAK_LAYERS = 3;

/** Deep-space fade color used by the reduced-motion crossfade style. */
const CROSSFADE_COLOR: readonly [number, number, number] = [0.015, 0.017, 0.038];

/**
 * Procedural radial star-streak tunnel.
 *
 * The pass is deliberately "dumb": the TransitionDirector owns all envelopes
 * (opacity ramp, speed ramp, crossfade bump) and pushes plain uniforms each
 * frame. Travel distance is CPU-integrated (`advance`) so speed changes never
 * cause discontinuities in the flow field.
 */
export class HyperspacePass {
  /** Latest rendered overlay texture, or null before the first render. */
  get texture(): Texture | null {
    return this.disposed ? null : (this.target?.texture ?? null);
  }

  /**
   * Conservative GPU byte estimate for the offscreen target (RGBA8), used by
   * ResourceScope accounting and the debug inventory.
   */
  get byteEstimate(): number {
    if (this.disposed || !this.target) return 0;
    return this.target.width * this.target.height * 4;
  }

  /** Fidelity disclosure string for About/Fidelity UI (CA-ADR-006). */
  readonly disclosure = HYPERSPACE_DISCLOSURE;

  private readonly quad: QuadMesh;
  private readonly material: MeshBasicNodeMaterial;
  private target: RenderTarget | null;

  private readonly uTravel: TravelUniform;
  private readonly uIntensity: TravelUniform;
  private readonly uAlpha: TravelUniform;
  private readonly uAspect: TravelUniform;
  private readonly uSeed: TravelUniform;
  private readonly uChroma: TravelUniform;
  private readonly uCrossfade: TravelUniform;

  private disposed = false;

  constructor(options: HyperspacePassOptions = {}) {
    const width = clampDimension(options.width ?? 640);
    const height = clampDimension(options.height ?? 360);

    this.uTravel = uniform(0);
    this.uIntensity = uniform(0);
    this.uAlpha = uniform(0);
    this.uAspect = uniform(width / height);
    // Fold the host-provided seed into a stable non-degenerate range.
    this.uSeed = uniform(((options.seed ?? 1) % 1000) + 0.123);
    this.uChroma = uniform(0);
    this.uCrossfade = uniform(0);

    this.material = new MeshBasicNodeMaterial();
    this.material.colorNode = this.buildColorGraph();

    this.quad = new QuadMesh(this.material);
    this.quad.frustumCulled = false;

    this.target = new RenderTarget(width, height, {
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      wrapS: ClampToEdgeWrapping,
      wrapT: ClampToEdgeWrapping,
      format: RGBAFormat,
      type: UnsignedByteType,
    });
  }

  /**
   * Build the full TSL fragment graph:
   *
   *   final = exposure(vignette * (chromaticStreaks + nebula + coreGlow))
   *           mixed toward a flat fade color in crossfade mode.
   *
   * Output alpha is a dedicated uniform so the director fully controls the
   * composite envelope independent of the RGB content.
   */
  private buildColorGraph(): ShaderNodeObject<ReturnType<typeof vec4>> {
    const uv01 = uv();
    const centered = sub(uv01, 0.5);
    const p = mul(centered, vec2(this.uAspect, 1.0));

    const r = add(length(p), 1e-4);

    // Restrained chromatic separation: R sampled slightly outward, B inward.
    // Amount scales with intensity so it vanishes when the effect is idle.
    const chroma = mul(this.uChroma, this.uIntensity);
    const pR = mul(p, add(1.0, chroma));
    const pB = mul(p, sub(1.0, chroma));

    const streakR = this.streakField(pR);
    const streakG = this.streakField(p);
    const streakB = this.streakField(pB);
    const streaks = mul(vec3(streakR, streakG, streakB), this.uIntensity);

    // Per-pixel tone sample drives the star palette (ice blue -> warm white).
    const tone = this.streakField(p, 53.17);
    const tinted = mul(streaks, mix(vec3(0.58, 0.7, 1.0), vec3(1.0, 0.97, 0.9), tone));
    // Restrained violet bloom on high-tone regions.
    const bloomed = add(
      tinted,
      mul(vec3(0.42, 0.28, 0.85), mul(pow(tone, 2.0), 0.2)),
    );

    // Domain-warped nebula wisps drifting slowly down the tunnel.
    const noisePos = vec3(
      mul(p.x, 2.3),
      mul(p.y, 2.3),
      add(mul(this.uTravel, 0.06), mul(this.uSeed, 0.37)),
    );
    const wisp = mx_fractal_noise_float(noisePos, 3, 2.0, 0.5);
    const withWisps = add(
      bloomed,
      mul(max(wisp, 0.0), mul(vec3(0.45, 0.35, 0.85), mul(this.uIntensity, 0.16))),
    );

    // Tunnel-end core glow: soft light at the convergence point.
    const glow = mul(exp(mul(r, -4.2)), 0.55);
    const withGlow = add(withWisps, mul(glow, vec3(0.65, 0.75, 1.0)));

    // Vignette keeps the frame edges calm during motion.
    const vignetted = mul(withGlow, oneMinus(smoothstep(0.42, 1.25, r)));

    // Filmic-style exposure shoulder.
    const exposed = oneMinus(exp(mul(vignetted, -1.35)));

    // Reduced-motion / crossfade presentation: flat dim field, no motion.
    const fadeColor = vec3(CROSSFADE_COLOR[0], CROSSFADE_COLOR[1], CROSSFADE_COLOR[2]);
    const finalCol = mix(exposed, fadeColor, this.uCrossfade);

    return vec4(finalCol, this.uAlpha);
  }

  /**
   * Sum of unrolled procedural streak layers evaluated for one channel.
   *
   * Each layer slices the tunnel into angular cells; every cell carries sparse
   * star heads whose brightness trails exponentially along the radial (depth)
   * coordinate. Depth uses 1/r so apparent streak speed increases toward the
   * screen edge — the classic warp look — while per-layer parallax factors
   * keep the field from reading as a single flat shell.
   *
   * All pseudo-randomness comes from `hash()` seeded by folded cell indices
   * plus `uSeed`, so the field is fully deterministic per seed. Callers may
   * pass a radially scaled `p` for chromatic separation, or a seed shift to
   * decorrelate the tone sample from the color channels.
   */
  private streakField(p: Fx, seedShift = 0) {
    const r = add(length(p), 1e-4);
    const angle01 = add(div(atan2(p.y, p.x), Math.PI * 2), 0.5);
    const seed = add(this.uSeed, seedShift);
    const contributions: Fx[] = [];

    for (let layer = 0; layer < STREAK_LAYERS; layer++) {
      const cells = 36 + layer * 22;
      const depthK = 2.6 + layer * 1.7;
      const speedMul = 0.85 + layer * 0.33;
      const brightness = 1.0 - layer * 0.24;
      const existThreshold = 0.8 - layer * 0.02;

      const ac = mul(angle01, cells);
      const idA = floor(ac);
      const fA = fract(ac);

      // Per-cell randoms (angular identity, depth parallax, existence).
      const h1 = hash(add(add(idA, mul(seed, 7.77)), layer * 13.13));
      const q = div(1.0, r);
      const s = add(
        add(mul(q, mul(depthK, add(0.7, mul(h1, 0.6)))), mul(this.uTravel, speedMul)),
        mul(h1, 37.7),
      );
      const zCell = floor(s);
      const fZ = fract(s);

      const h2 = hash(
        add(
          add(mul(zCell, 91.7), mul(idA, 41.3)),
          add(mul(seed, 3.1), layer * 5.9),
        ),
      );
      const exist = step(existThreshold, h2);

      // Bright head with exponential tail along the travel direction; tail
      // sharpness varies per cell so streak lengths differ.
      const head = exp(mul(fZ, add(-6.0, mul(h1, -6.0))));
      // Soft angular window per cell (varies the streak width).
      const halfWidth = add(0.1, mul(h1, 0.25));
      const angularWindow = mul(
        smoothstep(0.0, halfWidth, fA),
        oneMinus(smoothstep(sub(1.0, halfWidth), 1.0, fA)),
      );
      // Fade out the singular center and the far corners.
      const radialMask = mul(
        smoothstep(0.02, 0.2, r),
        oneMinus(smoothstep(0.55, 1.45, r)),
      );

      contributions.push(
        mul(mul(mul(mul(head, angularWindow), exist), radialMask), brightness),
      );
    }

    // STREAK_LAYERS >= 1 guarantees at least one contribution.
    let sum: Fx = contributions[0];
    for (let i = 1; i < contributions.length; i++) {
      sum = add(sum, contributions[i]);
    }
    return clamp(sum, 0.0, 1.0);
  }

  /** Resize the offscreen target (host calls on resize/render-scale change). */
  setSize(widthPx: number, heightPx: number): void {
    if (this.disposed || !this.target) return;
    const w = clampDimension(Math.max(MIN_DIMENSION_PX, Math.floor(widthPx)));
    const h = clampDimension(Math.max(MIN_DIMENSION_PX, Math.floor(heightPx)));
    if (this.target.width === w && this.target.height === h) return;
    this.target.setSize(w, h);
    this.uAspect.value = w / h;
  }

  /** Set the visual style. Crossfade mode is the reduced-motion path. */
  setStyle(style: HyperspaceStyle): void {
    if (this.disposed) return;
    this.uCrossfade.value = style === 'crossfade' ? 1 : 0;
  }

  /** Current streak strength in [0, 1]; also scales chromatic separation. */
  setIntensity(intensity01: number): void {
    if (this.disposed) return;
    this.uIntensity.value = clamp01(intensity01);
  }

  /** Final output alpha composited by `ISharedPost.present`. */
  setAlpha(alpha01: number): void {
    if (this.disposed) return;
    this.uAlpha.value = clamp01(alpha01);
  }

  /**
   * Advance the deterministic travel clock. `speed` is in tunnel-lengths per
   * second; the director derives it from its speed-ramp envelope. Called with
   * dt = 0 (or not at all) freezes the field for static capture.
   */
  advance(dtSeconds: number, speed: number): void {
    if (this.disposed) return;
    this.uTravel.value += Math.max(0, dtSeconds) * Math.max(0, speed);
  }

  /** Direct travel override (tests / deterministic resets). */
  setTravel(travel: number): void {
    if (this.disposed) return;
    this.uTravel.value = Math.max(0, travel);
  }

  /**
   * Render the effect into the internal offscreen target.
   *
   * No-op when disposed; the last valid overlay texture remains and the
   * director simply holds opacity. The previously bound render target is
   * restored so this can be called from anywhere in the frame.
   */
  render(renderer: RendererLike): void {
    if (this.disposed || !this.target) return;
    const previous = renderer.getRenderTarget();
    renderer.setRenderTarget(this.target);
    // WebGPURenderer satisfies QuadMesh's Renderer parameter; three r180
    // drives both WebGPU and WebGL2 backends through WebGPURenderer.
    (this.quad.render as (r: RendererLike) => void)(renderer);
    renderer.setRenderTarget(previous);
  }

  /** Release the render target and material. Idempotent. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.material.dispose();
    this.target?.dispose();
    this.target = null;
  }
}

function clampDimension(value: number): number {
  return Math.min(MAX_DIMENSION_PX, Math.max(MIN_DIMENSION_PX, Math.floor(value)));
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}
