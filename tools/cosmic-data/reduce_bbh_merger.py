"""CA8-04..08 — Reduce the pinned SXS BBH source into the runtime asset.

Pipeline (docs/cosmic-atlas/DATA_PIPELINE.md §5, DATA_SOURCES_BBH_MERGER.md):

    fetch (fetch_sxs_record.py)  ->  scratch/<record>/*.bin
    extract metadata             ->  physical scalars (mass fractions, spins,
                                     remnant, merger anchors)
    extract trajectories         ->  horizon coordinate centers (GAUGE-
                                     DEPENDENT; recentered on the fitted
                                     binary midpoint over the window)
    extract waveform             ->  h22 = h(l=2,m=+2), Re/Im, from the N=4
                                     extrapolated asymptotic strain
    align                        ->  t=0 at the (2,2) amplitude peak
    resample                     ->  deterministic two-segment sampling:
                                     inspiral uniform in cumulative GW
                                     phase (70% of samples), ringdown
                                     uniform in time (30%)
    error report                 ->  max/RMS linear-reconstruction error per
                                     channel at dense checkpoints + peak-
                                     timing preservation
    emit                         ->  public/data/black-hole-merger/
                                       sxs-bbh-0001-lev5-bbm1-v1.bin   (BBM1)
                                       .../manifest.json
                                       .../reduction-report.json
                                     tests/unit/fixtures/bbm-parity.json

Determinism: no randomness, no wall-clock data in outputs. Running twice on
the same inputs must produce byte-identical binaries (verified by the
report's sha256 and the unit suite).

Units/conventions: geometric NR units with total mass M=1 ("M" below);
runtime timeline stores M-relative times with t=0 at the h22 peak.
"""

from __future__ import annotations

import hashlib
import json
import math
import sys
from pathlib import Path

import h5py
import numpy as np

TOOL_ROOT = Path(__file__).resolve().parent
REPO_ROOT = TOOL_ROOT.parent.parent
sys.path.insert(0, str(TOOL_ROOT))

from fetch_sxs_record import DOI, LICENSE, RECORD_ID, RECORD_URL, local_path  # noqa: E402

# ---------------------------------------------------------------------------
# Output contract (versioned; bump RUNTIME_SCHEMA together with the decoder)
# ---------------------------------------------------------------------------

RUNTIME_SCHEMA = 1
ASSET_ID = "sxs-bbh-0001-lev5"
ASSET_FILENAME = "sxs-bbh-0001-lev5-bbm1-v1.bin"
PUBLIC_DIR = REPO_ROOT / "public" / "data" / "black-hole-merger"
FIXTURE_PATH = REPO_ROOT / "tests" / "unit" / "fixtures" / "bbm-parity.json"

MAGIC = b"BBM1"
HEADER_BYTES = 160  # fixed header size; sample arrays start here

# Reduction parameters (documented in the reduction report).
INSPIRAL_PHASE_SPAN_ORBITS = 10.0  # minimum orbits in the retained inspiral
INSPIRAL_WINDOW_CAP_M = 2400.0  # earliest inspiral point (M before peak)
RINGDOWN_WINDOW_M = 250.0  # latest ringdown point (M after peak)
SAMPLE_COUNT = 2048
INSPIRAL_SAMPLE_FRACTION = 0.7
CHECKPOINTS = 8192  # dense points for error quantification
PARITY_KEYFRAMES = 24  # fixture entries for source-vs-runtime tests
MERGER_END_FRACTION = 0.35  # |h22| fraction of peak defining the merger end
RINGDOWN_END_FRACTION = 0.08  # further decay defining the ringdown end

# BBM1 channel layout: one f32 time + 6 f32 positions + 2 f32 strain per row.
FLOAT32_BYTES = 4


def sha256_of(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def md5_of(path: Path) -> str:
    return hashlib.md5(path.read_bytes()).hexdigest()  # noqa: S324 - provenance echo


# ---------------------------------------------------------------------------
# Extraction helpers
# ---------------------------------------------------------------------------


def load_strain() -> tuple[np.ndarray, np.ndarray]:
    """Decode the RPDMB strain via the official sxs package. Returns
    (times_M, h22 complex array)."""
    from sxs.waveforms import rotating_paired_diff_multishuffle_bzip2 as rpdmb

    strain_bin = local_path("Lev5:Strain_N4.h5")
    # rpdmb.load expects sibling files named <base>.h5/.json plus metadata.
    workdir = strain_bin.parent / "strain-work"
    workdir.mkdir(exist_ok=True)
    for source_key, target_name in (
        ("Lev5:Strain_N4.h5", "Strain_N4.h5"),
        ("Lev5:Strain_N4.json", "Strain_N4.json"),
        ("Lev5:metadata.json", "metadata.json"),
    ):
        source = local_path(source_key)
        target = workdir / target_name
        if not target.exists():
            target.write_bytes(source.read_bytes())

    w = rpdmb.load(str(workdir / "Strain_N4.h5"), ignore_validation=False, check_md5=True)
    times = np.asarray(w.t, dtype=np.float64)
    modes = np.asarray(w.nda if hasattr(w, "nda") else w)
    if times.ndim != 1 or modes.ndim != 2 or modes.shape[0] != times.shape[0]:
        raise SystemExit(f"[reduce] unexpected strain layout {modes.shape} vs t {times.shape}")

    ell_min = int(w.ell_min) if hasattr(w, "ell_min") else 2
    index_l2m2 = None
    idx = 0
    for ell in range(ell_min, ell_min + modes.shape[1]):
        for m in range(-ell, ell + 1):
            if (ell, m) == (2, 2):
                index_l2m2 = idx
            idx += 1
        if index_l2m2 is not None:
            break
    if index_l2m2 is None or index_l2m2 >= modes.shape[1]:
        raise SystemExit("[reduce] (2,2) mode not found in strain data")
    return times, np.asarray(modes[:, index_l2m2], dtype=np.complex128)


def load_horizons() -> dict[str, dict[str, np.ndarray]]:
    """Extract horizon coordinate centers (t,x,y,z per horizon)."""
    path = local_path("Lev5:Horizons.h5")
    out: dict[str, dict[str, np.ndarray]] = {}
    with h5py.File(path, "r") as handle:
        for key, group in (("A", "AhA.dir"), ("B", "AhB.dir"), ("C", "AhC.dir")):
            center = np.asarray(handle[f"{group}/CoordCenterInertial.dat"], dtype=np.float64)
            mass = np.asarray(handle[f"{group}/ChristodoulouMass.dat"], dtype=np.float64)
            spin = np.asarray(handle[f"{group}/chiInertial.dat"], dtype=np.float64)
            if center.ndim != 2 or center.shape[1] != 4:
                raise SystemExit(f"[reduce] unexpected CoordCenterInertial layout for {key}")
            out[key] = {
                "t": center[:, 0].copy(),
                "xyz": center[:, 1:4].copy(),
                "mass_t": mass[:, 0].copy(),
                "mass": mass[:, 1].copy(),
                "spin_xyz": spin[:, 1:4].copy(),
            }
    return out


def load_metadata() -> dict:
    return json.loads(local_path("Lev5:metadata.json").read_bytes())


# ---------------------------------------------------------------------------
# Resampling
# ---------------------------------------------------------------------------


def build_reduced_times(
    times: np.ndarray, phase: np.ndarray, peak_index: int
) -> tuple[np.ndarray, float, float, float]:
    """Deterministic two-segment reduced timeline.

    Inspiral ([t_lo, 0]) is sampled uniformly in cumulative GW phase so the
    sample density follows the physical frequency sweep; ringdown ([0,
    t_hi]) uniformly in time. One sample is placed exactly at t=0 (the
    merger anchor). Returns (times_relative_to_peak, t_lo, t_hi,
    achieved_phase_span_orbits).
    """
    peak_time = times[peak_index]
    t_end = min(peak_time + RINGDOWN_WINDOW_M, float(times[-1]))
    if t_end <= peak_time:
        raise SystemExit("[reduce] no ringdown samples after the peak")

    # Inspiral window: cap by M-before-peak AND require a minimum orbit span.
    # The h22 phase may carry either sign convention (this source decreases);
    # normalize so it increases with time. One ORBIT spans 4*pi of h22 phase
    # (m=2), verified against metadata number_of_orbits for this source.
    # np.unwrap can leave tiny DESCENTS where |h| (and thus the angle) is
    # noisy; np.interp needs an increasing abscissa, so build the sampling
    # coordinate as the cumulative |phase increment| (monotonic by
    # construction and equal to the net phase over a clean sweep).
    oriented = phase if phase[-1] >= phase[0] else -phase
    increments = np.abs(np.diff(oriented))
    phi = np.concatenate([[0.0], np.cumsum(increments)])
    phi -= phi[peak_index]
    earliest_by_orbits = None
    target_span = INSPIRAL_PHASE_SPAN_ORBITS * 4.0 * math.pi
    for i in range(peak_index, -1, -1):
        if phi[i] <= -target_span:
            earliest_by_orbits = i
            break
    if earliest_by_orbits is None:
        raise SystemExit("[reduce] insufficient inspiral phase span before the peak")
    earliest_by_cap = np.searchsorted(times, peak_time - INSPIRAL_WINDOW_CAP_M)
    start_index = max(earliest_by_orbits, int(earliest_by_cap))
    t_start = float(times[start_index])
    achieved_orbits = abs(phi[start_index]) / (4.0 * math.pi)

    n_total = SAMPLE_COUNT
    n_ring = int(round(n_total * (1.0 - INSPIRAL_SAMPLE_FRACTION)))
    n_insp = n_total - n_ring

    # Inspiral targets uniform in phase between [phi(start), phi(peak)=0].
    phi_start = phi[start_index]
    phi_targets = np.linspace(phi_start, 0.0, n_insp, endpoint=True)
    t_insp = np.interp(
        phi_targets, phi[start_index : peak_index + 1], times[start_index : peak_index + 1]
    )

    # Ringdown targets uniform in time (exclude duplicated t=0 endpoint).
    t_ring = np.linspace(peak_time, t_end, n_ring + 1, endpoint=True)[1:]

    reduced = np.concatenate([t_insp, t_ring])
    reduced = np.unique(reduced)  # exact de-dup of the merger anchor
    if reduced.size < SAMPLE_COUNT - 8:  # tolerate only trivial collisions
        raise SystemExit(f"[reduce] sample collapse: {reduced.size} unique samples")
    relative = reduced - peak_time
    merger_index = int(np.argmin(np.abs(relative)))
    if abs(relative[merger_index]) > 1e-9:
        raise SystemExit("[reduce] merger anchor sample missing from reduced timeline")
    return (
        relative.astype(np.float64),
        -relative[0],
        float(t_end - peak_time),
        float(achieved_orbits),
        merger_index,
    )


def linear_interp_rows(
    query_times: np.ndarray, src_times: np.ndarray, values: np.ndarray
) -> np.ndarray:
    """Column-wise linear interpolation (mirrors the runtime decoder)."""
    out = np.empty((query_times.size, values.shape[1]), dtype=np.float64)
    for col in range(values.shape[1]):
        out[:, col] = np.interp(query_times, src_times, values[:, col])
    return out


def reconstruction_error(
    reduced_t: np.ndarray,
    reduced_values: np.ndarray,
    src_t_window: np.ndarray,
    src_values_window: np.ndarray,
    scale: float,
) -> dict[str, float]:
    """Max/RMS error of linear reconstruction at dense checkpoints."""
    checkpoints = np.linspace(src_t_window[0], src_t_window[-1], CHECKPOINTS)
    approx = linear_interp_rows(checkpoints, reduced_t, reduced_values)
    truth = linear_interp_rows(checkpoints, src_t_window, src_values_window)
    delta = approx - truth
    rms = float(math.sqrt(float(np.mean(delta**2))))
    return {
        "maxAbsError": float(np.max(np.abs(delta))),
        "rmsError": rms,
        "normalizedBy": scale,
        "checkpoints": CHECKPOINTS,
    }


# ---------------------------------------------------------------------------
# Binary emission (BBM1 schema v1)
# ---------------------------------------------------------------------------

# Header field order (all little-endian, no implicit padding):
#   0   4s   magic "BBM1"
#   4   u32  schemaVersion
#   8   u32  headerBytes (=160)
#   12  u32  sampleCount
#   16  u32  mergerIndex
#   20  u32  reserved (0)
#   24  f64  tStartM  (<=0, relative to peak)
#   32  f64  tEndM    (>=0, relative to peak)
#   40  f64  m1OverM
#   48  f64  m2OverM
#   56  f64  chi1z
#   64  f64  chi2z
#   72  f64  remnantMassOverM
#   80  f64  remnantChiMag
#   88  f64  remnantChiZ
#   96  f64  separationStartM
#   104 f64  h22PeakAmplitude
#   112 f64  mergerEndM    (first post-peak time where |h22| <= 0.35*peak)
#   120 f64  ringdownEndM  (first later time where |h22| <= 0.08*peak)
#   128 32s  ascii assetId (NUL padded)
#   ... zero padding to headerBytes=160
# Little-endian, no implicit padding (matches the TS decoder DataView calls).
HEADER_STRUCT = "<4sIIIII13d"
HEADER_STRUCT_SIZE = 4 + 5 * 4 + 13 * 8  # 128 bytes through ringdownEndM


def emit_binary(
    times_rel: np.ndarray,
    bh_a: np.ndarray,
    bh_b: np.ndarray,
    h_re: np.ndarray,
    h_im: np.ndarray,
    merger_index: int,
    scalars: dict[str, float],
) -> bytes:
    import struct

    count = times_rel.size
    header = struct.pack(
        HEADER_STRUCT,
        MAGIC,
        RUNTIME_SCHEMA,
        HEADER_BYTES,
        count,
        merger_index,
        0,
        float(times_rel[0]),
        float(times_rel[-1]),
        scalars["m1OverM"],
        scalars["m2OverM"],
        scalars["chi1z"],
        scalars["chi2z"],
        scalars["remnantMassOverM"],
        scalars["remnantChiMag"],
        scalars["remnantChiZ"],
        scalars["separationStartM"],
        scalars["h22PeakAmplitude"],
        scalars["mergerEndM"],
        scalars["ringdownEndM"],
    )
    asset_id_field = ASSET_ID.encode("ascii")
    header += asset_id_field + b"\x00" * (160 - HEADER_STRUCT_SIZE - len(asset_id_field))
    if len(header) != HEADER_BYTES:
        raise SystemExit(f"[reduce] header size {len(header)} != {HEADER_BYTES}")

    rows = np.empty((count, 9), dtype="<f4")
    rows[:, 0] = times_rel
    rows[:, 1:4] = bh_a
    rows[:, 4:7] = bh_b
    rows[:, 7] = h_re
    rows[:, 8] = h_im
    return header + rows.tobytes()


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main() -> int:
    print("[reduce] loading source products")
    meta = load_metadata()
    times, h22 = load_strain()
    horizons = load_horizons()

    amplitude = np.abs(h22)
    peak_index = int(np.argmax(amplitude))
    peak_time = float(times[peak_index])
    phase = np.unwrap(np.angle(h22))

    print(
        f"[reduce] strain: {times.size} samples, peak amp "
        f"{amplitude[peak_index]:.6f} at t={peak_time:.3f} M"
    )
    common_horizon = float(meta["common_horizon_time"])
    print(f"[reduce] metadata common horizon t={common_horizon:.3f} M")

    reduced_t, t_lo, t_hi, orbits, merger_index = build_reduced_times(times, phase, peak_index)
    print(
        f"[reduce] window [{-t_lo:.1f}, +{t_hi:.1f}] M around peak; "
        f"inspiral spans {orbits:.2f} orbits; {reduced_t.size} samples"
    )

    # --- trajectories: recentered horizon coordinate centers ---------------
    def recentered(key: str) -> tuple[np.ndarray, np.ndarray]:
        hz = horizons[key]
        mid = (horizons["A"]["xyz"] + horizons["B"]["xyz"]) * 0.5
        # Fit a LINEAR midpoint drift over the shared support (removes the
        # constant offset + residual COM drift; disclosed transformation).
        t_shared = horizons["A"]["t"]
        mask = (t_shared >= times[0]) & (t_shared <= times[-1])
        t_fit = t_shared[mask]
        mid_fit = mid[mask]
        design = np.stack([np.ones_like(t_fit), t_fit - t_fit.mean()], axis=1)
        coef, *_ = np.linalg.lstsq(design, mid_fit, rcond=None)
        drift = design @ coef
        corrected = mid.copy()
        corrected[mask] = mid_fit - drift
        xyz = hz["xyz"] - corrected
        return hz["t"], xyz

    ta, traj_a = recentered("A")
    tb, traj_b = recentered("B")

    window_mask_src = (times >= peak_time + reduced_t[0]) & (times <= peak_time + reduced_t[-1])
    src_t_window = times[window_mask_src]

    red_a = linear_interp_rows(reduced_t + peak_time, ta, traj_a)
    red_b = linear_interp_rows(reduced_t + peak_time, tb, traj_b)
    red_h_re = np.interp(reduced_t + peak_time, times, h22.real)
    red_h_im = np.interp(reduced_t + peak_time, times, h22.imag)

    separation_start = float(np.linalg.norm(red_a[0] - red_b[0]))
    h_peak_amp = float(amplitude[peak_index])

    # Data-derived phase anchors (post-peak amplitude thresholds).
    post_amp = amplitude[peak_index:]
    merger_end_idx_rel = int(np.argmax(post_amp <= MERGER_END_FRACTION * h_peak_amp))
    after_merger = post_amp[merger_end_idx_rel:]
    ringdown_end_idx_rel = merger_end_idx_rel + int(
        np.argmax(after_merger <= RINGDOWN_END_FRACTION * h_peak_amp)
    )
    merger_end_m = float(times[peak_index + merger_end_idx_rel] - peak_time)
    ringdown_end_m = float(times[peak_index + ringdown_end_idx_rel] - peak_time)

    # Remnant metadata: late-time AhC Christodoulou mass + spin magnitude.
    c_mass = horizons["C"]
    late = slice(-100, None)
    remnant_mass_over_m = float(np.mean(c_mass["mass"][late]))
    spin_mag = np.linalg.norm(horizons["C"]["spin_xyz"], axis=1)
    remnant_chi_mag = float(np.mean(spin_mag[late]))
    remnant_chi_z = float(np.mean(horizons["C"]["spin_xyz"][late][:, 2]))

    m1_over_m = float(meta.get("reference_mass1", 0.5))
    m2_over_m = float(meta.get("reference_mass2", 0.5))
    chi1 = meta.get("reference_dimensionless_spin1", [0.0, 0.0, 0.0])
    chi2 = meta.get("reference_dimensionless_spin2", [0.0, 0.0, 0.0])

    scalars = {
        "m1OverM": m1_over_m,
        "m2OverM": m2_over_m,
        "chi1z": float(chi1[2]),
        "chi2z": float(chi2[2]),
        "remnantMassOverM": remnant_mass_over_m,
        "remnantChiMag": remnant_chi_mag,
        "remnantChiZ": remnant_chi_z,
        "separationStartM": separation_start,
        "h22PeakAmplitude": h_peak_amp,
        "mergerEndM": merger_end_m,
        "ringdownEndM": ringdown_end_m,
    }

    payload = emit_binary(
        reduced_t, red_a, red_b, red_h_re, red_h_im, merger_index, scalars
    )
    digest_sha = sha256_of(payload)
    byte_count = len(payload)

    PUBLIC_DIR.mkdir(parents=True, exist_ok=True)
    bin_path = PUBLIC_DIR / ASSET_FILENAME
    bin_path.write_bytes(payload)
    print(f"[reduce] wrote {bin_path.relative_to(REPO_ROOT)} ({byte_count} bytes)")
    print(f"[reduce] sha256 {digest_sha}")

    # --- error quantification (all abscissae ABSOLUTE source times) ---------
    red_t_abs = reduced_t + peak_time
    err_pos_a = reconstruction_error(
        red_t_abs, red_a,
        ta[(ta >= src_t_window[0]) & (ta <= src_t_window[-1])],
        traj_a[(ta >= src_t_window[0]) & (ta <= src_t_window[-1])],
        separation_start,
    )
    err_pos_b = reconstruction_error(
        red_t_abs, red_b,
        tb[(tb >= src_t_window[0]) & (tb <= src_t_window[-1])],
        traj_b[(tb >= src_t_window[0]) & (tb <= src_t_window[-1])],
        separation_start,
    )
    err_h = reconstruction_error(
        red_t_abs,
        np.stack([red_h_re, red_h_im], axis=1),
        src_t_window,
        np.stack([h22.real, h22.imag], axis=1)[window_mask_src],
        h_peak_amp,
    )
    recon_peak_shift_samples = int(
        np.argmax(red_h_re**2 + red_h_im**2)
    ) - int(np.argmin(np.abs(reduced_t)))

    report = {
        "schemaVersion": 1,
        "assetId": ASSET_ID,
        "phenomenon": "black-hole-merger",
        "source": {
            "simulation": "SXS:BBH:0001",
            "level": "Lev5",
            "recordId": RECORD_ID,
            "recordUrl": RECORD_URL,
            "doi": DOI,
            "license": LICENSE,
            "fileMd5": {
                key: md5_of(local_path(key)) for key in (
                    "Lev5:metadata.json",
                    "Lev5:Strain_N4.h5",
                    "Lev5:Strain_N4.json",
                    "Lev5:Horizons.h5",
                )
            },
        },
        "conventions": {
            "units": "geometric NR units, total mass M=1; times relative to h22 peak",
            "waveform": "h(l=2,m=+2) real/imag, r*h/M dimensionless, N=4 extrapolation",
            "trajectoryFrame": "source-inertial horizon centers, recentered on the",
            "trajectoryFrameNote": (
                "linear-fit binary midpoint over the window (gauge-dependent "
                "coordinate paths, NOT invariant observables)"
            ),
        },
        "reduction": {
            "sampleCount": int(reduced_t.size),
            "inspiralSampleFraction": INSPIRAL_SAMPLE_FRACTION,
            "inspiralSampling": "uniform in cumulative GW phase",
            "ringdownSampling": "uniform in time",
            "inspiralWindowOrbits": orbits,
            "windowM": {"start": -float(t_lo), "end": float(t_hi)},
            "mergerAnchor": "t=0 at the h22 amplitude peak",
            "toolVersions": {
                "python": sys.version.split()[0],
                "numpy": np.__version__,
                "reducer": f"reduce_bbh_merger.py@{RUNTIME_SCHEMA}",
            },
        },
        "errors": {
            "trajectoryA": err_pos_a,
            "trajectoryB": err_pos_b,
            "waveformH22": err_h,
            "peakShiftSamples": recon_peak_shift_samples,
        },
        "runtime": {
            "encoding": "bbm1",
            "schemaVersion": RUNTIME_SCHEMA,
            "filename": ASSET_FILENAME,
            "bytes": byte_count,
            "sha256": digest_sha,
        },
    }
    report_path = PUBLIC_DIR / "reduction-report.json"
    report_path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
    print(f"[reduce] wrote {report_path.relative_to(REPO_ROOT)}")

    manifest = {
        "schemaVersion": RUNTIME_SCHEMA,
        "id": ASSET_ID,
        "phenomenon": "black-hole-merger",
        "source": {
            "organization": "SXS Collaboration",
            "url": RECORD_URL,
            "datasetId": "SXS:BBH:0001",
            "level": "Lev5",
            "doi": DOI,
            "license": LICENSE,
            "licenseUrl": "https://creativecommons.org/licenses/by/4.0/legalcode",
            "retrievedAt": "2026-08-25",
            "publications": ["Mroue:2013xna", "Boyle:2019kee", "SXSCatalogWebsite"],
            "attribution": (
                "Waveform and trajectory data from the SXS Collaboration "
                "numerical-relativity catalog (SXS:BBH:0001), licensed CC-BY-4.0."
            ),
        },
        "physics": {
            "units": "geometric NR units (total mass M=1); runtime times relative to h22 peak",
            "coordinateFrame": "source-inertial horizon centers recentered on the fitted midpoint",
            "timeOrigin": "h22 amplitude peak (merger anchor)",
            "waveformMode": "l2m2-strain-real-imag",
            "scalars": scalars,
        },
        "channels": ["timeM", "bhA.xyz", "bhB.xyz", "h22Re", "h22Im"],
        "runtime": {
            "encoding": "bbm1",
            "schemaVersion": RUNTIME_SCHEMA,
            "filename": ASSET_FILENAME,
            "samples": int(reduced_t.size),
            "bytes": byte_count,
            "checksumSha256": digest_sha,
        },
        "reduction": {
            "toolVersion": f"reduce_bbh_merger.py@{RUNTIME_SCHEMA}",
            "method": "phase-uniform inspiral + time-uniform ringdown, linear interp",
            "errorReport": "./reduction-report.json",
        },
    }
    manifest_path = PUBLIC_DIR / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
    print(f"[reduce] wrote {manifest_path.relative_to(REPO_ROOT)}")

    # --- parity fixture (source-vs-runtime validation input) ----------------
    fixture_indices = np.unique(
        np.linspace(0, reduced_t.size - 1, PARITY_KEYFRAMES).astype(int)
    ).tolist()
    fixture = {
        "assetId": ASSET_ID,
        "runtimeSha256": digest_sha,
        "mergerIndex": merger_index,
        "note": "Exact float32 rows emitted into the runtime binary (source parity anchors)",
        "rows": [
            {
                "index": int(i),
                "timeM": float(reduced_t[i]),
                "bhA": [float(v) for v in red_a[i]],
                "bhB": [float(v) for v in red_b[i]],
                "h22Re": float(red_h_re[i]),
                "h22Im": float(red_h_im[i]),
            }
            for i in fixture_indices
        ],
        "sourceKeyframes": [
            {
                # Relative to the merger anchor (the runtime convention).
                "sourceTimeM": float(t - peak_time),
                "h22Re": float(np.interp(t, times, h22.real)),
                "h22Im": float(np.interp(t, times, h22.imag)),
                "toleranceFractionOfPeak": 0.02,
            }
            for t in (
                float(peak_time + reduced_t[0]),
                float(peak_time + reduced_t[int(reduced_t.size // 4)]),
                peak_time - 100.0,
                peak_time - 10.0,
                peak_time,
                peak_time + 10.0,
                peak_time + 60.0,
                float(peak_time + reduced_t[-1]),
            )
        ],
        "expectedReductionErrors": {
            "trajectoryMaxNormalizedMax": 0.004,
            "trajectoryMaxNormalizedRms": 0.0012,
            "waveformMaxNormalizedMax": 0.02,
            "waveformMaxNormalizedRms": 0.006,
        },
    }
    FIXTURE_PATH.parent.mkdir(parents=True, exist_ok=True)
    FIXTURE_PATH.write_text(json.dumps(fixture, indent=2) + "\n")
    print(f"[reduce] wrote {FIXTURE_PATH.relative_to(REPO_ROOT)}")
    print(
        "[reduce] errors: trajA max "
        f"{err_pos_a['maxAbsError'] / separation_start:.2e}, h22 max "
        f"{err_h['maxAbsError'] / h_peak_amp:.2e} (normalized)"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
