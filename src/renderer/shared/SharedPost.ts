/**
 * SharedPost — shared HDR post-processing and presentation service.
 *
 * Spec sources:
 * - docs/cosmic-atlas/RENDERING_SERVICES.md §9 (SharedPost centralizes HDR
 *   target format, exposure, tone mapping, bloom, color conversion and final
 *   compositing; destinations supply physical radiance, cinematic multipliers
 *   live in visual state)
 * - docs/RENDERING_PIPELINE.md §5 (display chain: radiance -> bloom ->
 *   exposure/tone mapping -> output color space) and §6 (TSL strategy with
 *   explicit fallback behavior)
 *
 * Implementation contract (src/atlas/types.ts `ISharedPost`):
 * - Half-float (RGBA16F) HDR render target sized cssSize x renderScale,
 *   recreated on change; the old target is disposed and ownership is tracked
 *   via the injected ResourceScope ('shared-post').
 * - Exposure and tone mapping are applied by the renderer's automatic
 *   canvas-present path (`renderer.toneMapping` / `renderer.toneMappingExposure`).
 *   three.js applies those only when presenting to the default framebuffer
 *   (see WebGPURenderer `_getFrameBufferTarget` / `_renderOutput`), so renders
 *   into the HDR target always stay linear HDR. SharedPost therefore owns the
 *   presentation transform: setExposure()/setToneMapping() intentionally write
 *   renderer presentation state (RENDERING_SERVICES §9 assigns exactly these
 *   concerns to this service).
 * - Bloom uses the three.js TSL `bloom` node (UnrealBloom-style), computed on
 *   linear HDR values before exposure/tone mapping. Disclosure: this is a
 *   display-side visual effect, not a physical PSF model. With threshold 1.0
 *   only radiance above 1.0 contributes, so it never feeds back into physics.
 *   When disabled the node graph is rebuilt without it, so no bloom cost is
 *   paid while off.
 * - Transition overlays are blended in linear HDR before tone mapping so the
 *   outgoing/incoming cross-fade stays photometrically consistent.
 * - The same TSL graph runs on both backends of WebGPURenderer (WebGPU and
 *   WebGL2); there is no backend branch in this module (RENDERING_PIPELINE §6:
 *   "same algorithm can compile/run on WebGL2").
 */

import * as THREE from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { mix, texture, uniform, vec4 } from 'three/tsl';
import { bloom } from 'three/examples/jsm/tsl/display/BloomNode.js';

import type { ISharedPost, RendererLike, ResourceScope } from '../../atlas/types';

/** Tone-mapping enum -> THREE constant applied to the canvas-present path. */
const TONE_MAPPING_CONSTANTS = {
	'aces-filmic': THREE.ACESFilmicToneMapping,
	'agx': THREE.AgXToneMapping,
	'neutral': THREE.NeutralToneMapping,
	'linear': THREE.LinearToneMapping,
} as const;

/**
 * Bloom radius (blur spread, node-internal 0..1 scale) and luminance
 * threshold in linear HDR units. Threshold 1.0 restricts bloom to radiance
 * above diffuse-white so it reads as an HDR highlight effect.
 */
const BLOOM_RADIUS = 0.5;
const BLOOM_THRESHOLD = 1.0;

type BloomNodeObject = ReturnType<typeof bloom>;

export class SharedPost implements ISharedPost {

	private readonly renderer: RendererLike;
	private readonly scope: ResourceScope;

	private hdrTarget: THREE.WebGLRenderTarget | null = null;
	private snapshotTarget: THREE.WebGLRenderTarget | null = null;

	private cssWidth = 0;
	private cssHeight = 0;
	private renderScale = 1;

	private exposure = 1;
	private toneMappingMode: keyof typeof TONE_MAPPING_CONSTANTS = 'linear';
	private bloomEnabled = false;
	private bloomStrength = 0;

	/** Cached composite inputs; rebuilds the TSL graphs when any part changes. */
	private graphKey: string | null = null;
	private overlayTexture: THREE.Texture | null = null;
	private bloomNode: BloomNodeObject | null = null;

	private readonly overlayOpacityU = uniform(0);

	private readonly scene = new THREE.Scene();
	/** Orthographic camera matching three's QuadMesh: NDC-space pass-through. */
	private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
	private readonly triangleGeometry = SharedPost.createFullscreenTriangleGeometry();
	private readonly mesh = new THREE.Mesh(this.triangleGeometry);
	private readonly presentMaterial = new MeshBasicNodeMaterial();
	private readonly copyMaterial = new MeshBasicNodeMaterial();

	private disposed = false;

	constructor(services: { renderer: RendererLike; scope: ResourceScope }) {
		this.renderer = services.renderer;
		this.scope = services.scope;

		for (const material of [this.presentMaterial, this.copyMaterial]) {
			material.depthTest = false;
			material.depthWrite = false;
			material.blending = THREE.NoBlending;
			material.side = THREE.DoubleSide;
		}

		this.mesh.frustumCulled = false;
		this.mesh.material = this.presentMaterial;
		this.scene.add(this.mesh);
	}

	/** Single full-screen triangle covering clip space (mirrors QuadGeometry). */
	private static createFullscreenTriangleGeometry(): THREE.BufferGeometry {
		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute(
			'position',
			new THREE.Float32BufferAttribute([-1, 3, 0, -1, -1, 0, 3, -1, 0], 3),
		);
		// UVs interpolate to exactly [0,1] across the visible screen area.
		geometry.setAttribute(
			'uv',
			new THREE.Float32BufferAttribute([0, -1, 0, 1, 2, 1], 2),
		);
		return geometry;
	}

	ensureSize(widthPx: number, heightPx: number, renderScale: number): void {
		if (this.disposed) return;

		const scale = Number.isFinite(renderScale) && renderScale > 0 ? renderScale : 1;
		const width = Math.max(1, Math.floor(widthPx * scale));
		const height = Math.max(1, Math.floor(heightPx * scale));

		this.cssWidth = widthPx;
		this.cssHeight = heightPx;
		this.renderScale = scale;

		if (this.hdrTarget !== null && this.hdrTarget.width === width && this.hdrTarget.height === height) {
			return;
		}

		const previous = this.hdrTarget;
		this.hdrTarget = this.createHdrTarget(width, height);
		if (previous !== null) {
			this.releaseTarget(previous);
		}
		// Force graph rebuild against the new texture on the next present/capture.
		this.graphKey = null;
	}

	getHdrTarget(): THREE.Texture | null {
		return this.disposed || this.hdrTarget === null ? null : this.hdrTarget.texture;
	}

	setExposure(exposure: number): void {
		this.exposure = Number.isFinite(exposure) ? Math.max(0, exposure) : 1;
		// Presentation state only: renders into the HDR target are unaffected.
		this.renderer.toneMappingExposure = this.exposure;
	}

	setBloom(enabled: boolean, strength: number): void {
		const nextStrength = Number.isFinite(strength) ? Math.max(0, strength) : 0;
		if (enabled !== this.bloomEnabled) {
			this.bloomEnabled = enabled;
			// Toggle changes the graph shape (bloom cost must vanish when off).
			this.graphKey = null;
		}
		this.bloomStrength = nextStrength;
		if (this.bloomNode !== null) {
			this.bloomNode.strength.value = nextStrength;
		}
	}

	setToneMapping(mode: 'aces-filmic' | 'agx' | 'neutral' | 'linear'): void {
		this.toneMappingMode = mode;
		// Presentation state only: three invalidates its output pipeline when
		// renderer.toneMapping changes, and never applies it to off-screen targets.
		this.renderer.toneMapping = TONE_MAPPING_CONSTANTS[mode];
	}

	present(transitionOverlay: THREE.Texture | null, transitionOpacity: number): void {
		if (this.disposed || this.hdrTarget === null) return;

		this.overlayTexture = transitionOverlay;
		this.overlayOpacityU.value = clamp01(transitionOpacity);

		this.syncGraphs();

		this.mesh.material = this.presentMaterial;
		this.renderer.setRenderTarget(null);
		this.renderer.render(this.scene, this.camera);
	}

	captureSnapshot(): THREE.Texture | null {
		if (this.disposed || this.hdrTarget === null) return null;

		const width = this.hdrTarget.width;
		const height = this.hdrTarget.height;

		if (this.snapshotTarget === null) {
			this.snapshotTarget = this.createHdrTarget(width, height, 'SharedPost.Snapshot');
		} else if (this.snapshotTarget.width !== width || this.snapshotTarget.height !== height) {
			// Same tracked handle; byte estimate drifts slightly until disposal.
			this.snapshotTarget.setSize(width, height);
		}

		this.syncGraphs();

		// Raw copy: rendering into an off-screen target bypasses tone mapping
		// and color conversion, so the snapshot stays linear HDR.
		this.mesh.material = this.copyMaterial;
		this.renderer.setRenderTarget(this.snapshotTarget);
		this.renderer.render(this.scene, this.camera);
		return this.snapshotTarget.texture;
	}

	releaseSnapshot(): void {
		if (this.disposed || this.snapshotTarget === null) return;
		const target = this.snapshotTarget;
		this.snapshotTarget = null;
		this.releaseTarget(target);
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;

		if (this.hdrTarget !== null) {
			const target = this.hdrTarget;
			this.hdrTarget = null;
			this.releaseTarget(target);
		}
		if (this.snapshotTarget !== null) {
			const snapshot = this.snapshotTarget;
			this.snapshotTarget = null;
			this.releaseTarget(snapshot);
		}

		if (this.bloomNode !== null) {
			this.bloomNode.dispose();
			this.bloomNode = null;
		}
		this.graphKey = null;
		this.overlayTexture = null;

		this.presentMaterial.dispose();
		this.copyMaterial.dispose();
		this.triangleGeometry.dispose();
		this.scene.remove(this.mesh);
	}

	/**
	 * Rebuilds the present/copy TSL graphs when the HDR texture, overlay
	 * texture or bloom gate changed. Uniform values persist across rebuilds.
	 */
	private syncGraphs(): void {
		if (this.hdrTarget === null) return;
		const hdrTexture = this.hdrTarget.texture;
		const overlayTexture = this.overlayTexture;

		const key = `${hdrTexture.id}|${overlayTexture !== null ? overlayTexture.id : -1}|${this.bloomEnabled ? 1 : 0}`;
		if (key === this.graphKey) return;
		this.graphKey = key;

		// Raw copy graph for captureSnapshot().
		this.copyMaterial.fragmentNode = texture(hdrTexture);
		this.copyMaterial.needsUpdate = true;

		// Present graph: HDR -> (+ additive bloom) -> overlay lerp -> tonemap/sRGB
		// (the last step is the renderer's automatic canvas-present transform).
		const hdrNode = texture(hdrTexture);
		let rgb = hdrNode.rgb;

		if (this.bloomEnabled) {
			if (this.bloomNode === null) {
				this.bloomNode = bloom(hdrNode, this.bloomStrength, BLOOM_RADIUS, BLOOM_THRESHOLD);
			} else {
				this.bloomNode.inputNode = hdrNode;
			}
			this.bloomNode.strength.value = this.bloomStrength;
			this.bloomNode.radius.value = BLOOM_RADIUS;
			this.bloomNode.threshold.value = BLOOM_THRESHOLD;
			rgb = rgb.add(this.bloomNode.rgb);
		} else if (this.bloomNode !== null) {
			this.bloomNode.dispose();
			this.bloomNode = null;
		}

		if (overlayTexture !== null) {
			rgb = mix(rgb, texture(overlayTexture).rgb, this.overlayOpacityU);
		}

		this.presentMaterial.colorNode = vec4(rgb, 1);
		this.presentMaterial.needsUpdate = true;
	}

	private createHdrTarget(width: number, height: number, name = 'SharedPost.HDR'): THREE.WebGLRenderTarget {
		// WebGLRenderTarget extends RenderTarget and is accepted by both
		// WebGPURenderer and WebGLRenderer. RGBA16F is natively renderable on
		// WebGPU and on WebGL2 with float-buffer extensions (required by the
		// backend's own intermediate targets anyway).
		const target = new THREE.WebGLRenderTarget(width, height, {
			type: THREE.HalfFloatType,
			format: THREE.RGBAFormat,
			depthBuffer: true,
			stencilBuffer: false,
			generateMipmaps: false,
			minFilter: THREE.LinearFilter,
			magFilter: THREE.LinearFilter,
		});
		target.texture.name = name;
		// ~12 bytes/px: 4 channels x half float + 4-byte depth estimate.
		this.scope.track('renderTarget', target, () => target.dispose(), width * height * 12);
		return target;
	}

	private releaseTarget(target: THREE.WebGLRenderTarget): void {
		try {
			// The registered disposer calls target.dispose().
			this.scope.release(target);
		} catch {
			// Scope already disposed or handle unknown; still free the GPU object.
			target.dispose();
		}
	}

}

function clamp01(value: number): number {
	if (!Number.isFinite(value)) return 0;
	return value < 0 ? 0 : value > 1 ? 1 : value;
}
