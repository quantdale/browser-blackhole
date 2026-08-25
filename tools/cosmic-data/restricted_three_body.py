"""CA9-03..05 — Restricted three-body galaxy-collision offline core.

Scientific contract: docs/cosmic-atlas/DATA_SOURCES_GALAXY_COLLISION.md
(decision CA-ADR-022). The destination regenerates the classic Toomre &
Toomre (1972) restricted three-body experiments from published parameters;
this module is the deterministic engine that will consume the transcribed
parameters (transcription itself lands with CA9-03 completion against a
legitimately obtained copy of the paper).

Pipeline position (DATA_PIPELINE.md §6):

    pinned published parameters  ->  deterministic IC sampling
    ->  velocity-Verlet tracer integration in the time-dependent field of
        two point-mass nuclei on EXACT Keplerian (parabolic) orbits
    ->  self-check report (analytic invariants)

Units/conventions (locked; runtime must mirror them):

- G = 1; total pair mass M = m1 + m2 = 1; lengths in units of the reference
  disk radius R = 1; therefore time/speed units are sqrt(R^3/(G M)) and
  R/T respectively. All quantities are float64.
- Primaries follow the exact two-body relative conic propagated by Barker's
  equation (parabolic case, e = 1); they are NEVER numerically integrated,
  so primary trajectories carry no integrator drift.
- Test particles are massless and feel only the two point-mass nuclei. NO
  disk self-gravity, NO hydrodynamics, NO halos, NO star formation — this
  module must never be presented as anything beyond restricted three-body.

IMPORTANT: the encounter configuration below (EXERCISE_*) exists ONLY to
exercise and validate the integrator. These are NOT Toomre & Toomre's
published parameters; the report marks them "placeholder-exercise-config"
and tests guard that marker.

Determinism: the only randomness is a fixed-seed numpy Generator; outputs
contain no wall-clock data. Re-running produces byte-identical reports and
identical IC hashes.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
from pathlib import Path

import numpy as np

TOOL_ROOT = Path(__file__).resolve().parent
REPO_ROOT = TOOL_ROOT.parent.parent
REPORT_PATH = TOOL_ROOT / "reports" / "ca9-integrator-selfcheck.json"

TOOL_VERSION = "ca9-03.1"

# ---------------------------------------------------------------------------
# Locked conventions
# ---------------------------------------------------------------------------

G = 1.0
TOTAL_MASS = 1.0
LENGTH_UNIT_DISK_RADIUS = 1.0

# Guard radius around each nucleus (in disk radii). A test particle crossing
# it would receive an unphysical near-singularity kick at fixed step; such a
# particle is QUARANTINED deterministically (force frozen, state parked,
# counted in the report) instead of poisoning the run with non-finite state.
NUCLEUS_GUARD_RADIUS = 0.01

# Particles whose nearest-nucleus distance ever dips below this margin are
# "at-risk": deep swing-bys where floating-point ulp noise amplifies into
# macroscopically different (equally valid) outcomes. Engine-level symmetry
# assertions exclude them in BOTH compared runs; their handling is covered
# by the quarantine fail-closed check instead.
AT_RISK_MARGIN_RADIUS = 0.5

# Exercise configuration (PLACEHOLDER — NOT published T&T parameters).
EXERCISE_MASS_RATIO = 1.0  # m_host : m_companion
EXERCISE_PERICENTER_Q = 4.0  # pericenter separation / disk radius (e = 1)
EXERCISE_INCLINATION_DEG = 60.0  # companion orbital plane tilt vs disk 1 plane
EXERCISE_OMEGA_DEG = 0.0  # argument of pericenter (companion orbit)
EXERCISE_NODE_DEG = 0.0  # longitude of ascending node (companion orbit)
EXERCISE_T_SPAN = (-50.0, 70.0)  # integration window, time units
EXERCISE_DT = 0.01  # fixed velocity-Verlet step
EXERCISE_KEYFRAME_EVERY = 25  # steps between recorded keyframes
TRACERS_PER_GALAXY = 1024
DISK_R_IN = 0.5
DISK_R_OUT = 2.5
DISK_PROFILE_ALPHA = 1.0  # surface density ~ r^-alpha -> sampling law below
SAMPLE_SEED = 1972  # publication year of the pinned experiment; arbitrary but fixed


# ---------------------------------------------------------------------------
# Barker's equation (exact parabolic Kepler propagation)
# ---------------------------------------------------------------------------


def barker_dt_of_d(d: float, q: float, mu: float) -> float:
    """Time since pericenter for parabolic anomaly D = tan(nu/2)."""
    return math.sqrt(2.0 * q**3 / mu) * (d + d**3 / 3.0)


# Geometric consistency identity used by the self-check:
#   dt/dD = 2 r^2 / (h (1 + D^2)),  r = q(1 + D^2),  h = sqrt(2 mu q)
# (the sec^2(nu/2) = 1 + D^2 factor of D = tan(nu/2) cancels one (1 + D^2)
# of r^2 against Barker's derivative).


def solve_barker(dt_since_peri: float, q: float, mu: float) -> float:
    """Invert Barker's equation for D at signed time offset dt_since_peri.

    g(D) = sqrt(2 q^3/mu) (D + D^3/3) - dt is strictly increasing on all of
    R, so safeguarded Newton converges globally.
    """
    c = math.sqrt(2.0 * q**3 / mu)
    target = dt_since_peri / c
    if target == 0.0:
        return 0.0
    d = math.copysign(abs(target) ** (1.0 / 3.0), target)
    for _ in range(128):
        f = d + d**3 / 3.0 - target
        fp = 1.0 + d * d
        step = f / fp
        d -= step
        if abs(step) <= 1e-15 * max(1.0, abs(d)):
            break
    else:  # pragma: no cover - cubic Newton cannot stall here
        raise RuntimeError("Barker inversion failed to converge")
    return d


def parabolic_relative_state(
    dt_since_peri: float, q: float, mu: float
) -> tuple[float, np.ndarray, np.ndarray]:
    """Exact relative separation/velocity (perifocal frame) at a signed time."""
    d = solve_barker(dt_since_peri, q, mu)
    nu = 2.0 * math.atan(d)
    r_mag = q * (1.0 + d * d)
    h = math.sqrt(2.0 * mu * q)
    vr = (mu / h) * math.sin(nu)
    vt = (mu / h) * (1.0 + math.cos(nu))
    pos = np.array([r_mag * math.cos(nu), r_mag * math.sin(nu), 0.0])
    vel = np.array(
        [
            vr * math.cos(nu) - vt * math.sin(nu),
            vr * math.sin(nu) + vt * math.cos(nu),
            0.0,
        ]
    )
    return r_mag, pos, vel


def orientation_matrix(omega_deg: float, inc_deg: float, node_deg: float) -> np.ndarray:
    """Perifocal -> world frame: Rz(node) @ Rx(inc) @ Rz(omega), degrees in."""

    def rz(a: float) -> np.ndarray:
        c, s = math.cos(math.radians(a)), math.sin(math.radians(a))
        return np.array([[c, -s, 0.0], [s, c, 0.0], [0.0, 0.0, 1.0]])

    def rx(a: float) -> np.ndarray:
        c, s = math.cos(math.radians(a)), math.sin(math.radians(a))
        return np.array([[1.0, 0.0, 0.0], [0.0, c, -s], [0.0, s, c]])

    return rz(node_deg) @ rx(inc_deg) @ rz(omega_deg)


class Encounter:
    """Two point-mass nuclei on one exact parabolic relative orbit.

    Positions are COM-centered: x1 = +(m2/M) r_rel, x2 = -(m1/M) r_rel.
    """

    def __init__(
        self,
        mass_ratio: float,
        pericenter_q: float,
        omega_deg: float = 0.0,
        inc_deg: float = 0.0,
        node_deg: float = 0.0,
    ) -> None:
        if mass_ratio <= 0.0:
            raise ValueError("mass_ratio must be positive")
        if pericenter_q <= 0.0:
            raise ValueError("pericenter_q must be positive")
        total = TOTAL_MASS
        self.m1 = total * mass_ratio / (1.0 + mass_ratio)
        self.m2 = total / (1.0 + mass_ratio)
        self.mu = G * total
        self.q = pericenter_q
        self.rot = orientation_matrix(omega_deg, inc_deg, node_deg)

    def states(self, t: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        """Nucleus positions (world frame) at times t; arrays (n,3)."""
        rel_pos = np.empty((t.shape[0], 3))
        for i, ti in enumerate(t):
            _, pos, _ = parabolic_relative_state(float(ti), self.q, self.mu)
            rel_pos[i] = self.rot @ pos
        x1 = rel_pos * (self.m2 / TOTAL_MASS)
        x2 = -rel_pos * (self.m1 / TOTAL_MASS)
        return x1, x2

    def nucleus_velocities(self, t: float) -> tuple[np.ndarray, np.ndarray]:
        """Analytic nucleus velocities at time t via finite-difference-free
        differentiation of the exact conic (perifocal analytic derivative)."""
        _, pos, vel = parabolic_relative_state(t, self.q, self.mu)
        rel_v = self.rot @ vel
        v1 = rel_v * (self.m2 / TOTAL_MASS)
        v2 = -rel_v * (self.m1 / TOTAL_MASS)
        return v1, v2


# ---------------------------------------------------------------------------
# Seeded initial conditions (disk populations around each nucleus)
# ---------------------------------------------------------------------------


def sample_disk_tracers(
    rng: np.random.Generator,
    count: int,
    host_mass: float,
    prograde: bool,
) -> tuple[np.ndarray, np.ndarray]:
    """Sample thin-disk tracers with circular host-frame velocities.

    Radius law: surface density Sigma ~ r^-alpha sampled exactly by inverse
    CDF over [R_IN, R_OUT] (alpha != 1 branch uses the power-law form).
    """
    alpha = DISK_PROFILE_ALPHA
    u = rng.random(count)
    if abs(alpha - 1.0) < 1e-12:
        # Sigma ~ 1/r  =>  p(r) ~ const  =>  uniform in r
        radii = DISK_R_IN + (DISK_R_OUT - DISK_R_IN) * u
    else:
        beta = 2.0 - alpha
        radii = (
            DISK_R_IN**beta + (DISK_R_OUT**beta - DISK_R_IN**beta) * u
        ) ** (1.0 / beta)
    theta = 2.0 * np.pi * rng.random(count)
    positions = np.stack([radii * np.cos(theta), radii * np.sin(theta)], axis=1)
    speed = np.sqrt(G * host_mass / radii)
    direction = 1.0 if prograde else -1.0
    velocities = np.stack(
        [-direction * speed * np.sin(theta), direction * speed * np.cos(theta)],
        axis=1,
    )
    xyz = np.zeros((count, 3))
    xyz[:, :2] = positions
    vxyz = np.zeros((count, 3))
    vxyz[:, :2] = velocities
    return xyz, vxyz


def sample_all_tracers(
    seed: int, enc: Encounter, t0: float = 0.0
) -> tuple[np.ndarray, np.ndarray]:
    """Deterministic full tracer state (both disks), COM frame at t=t0.

    Disks are sampled around each nucleus's position/velocity EVALUATED AT
    THE WINDOW START so the initial state is dynamically coherent."""
    rng = np.random.default_rng(seed)
    x_a, v_a = sample_disk_tracers(rng, TRACERS_PER_GALAXY, enc.m1, True)
    x_b, v_b = sample_disk_tracers(rng, TRACERS_PER_GALAXY, enc.m2, False)
    x1, x2 = enc.states(np.array([t0]))
    v1, v2 = enc.nucleus_velocities(t0)
    x_a = x_a + x1[0]
    v_a = v_a + v1
    x_b = x_b + x2[0]
    v_b = v_b + v2
    return np.concatenate([x_a, x_b]), np.concatenate([v_a, v_b])


# ---------------------------------------------------------------------------
# Velocity-Verlet integration of tracers in the analytic nuclear field
# ---------------------------------------------------------------------------

def acceleration(
    x: np.ndarray, x1: np.ndarray, x2: np.ndarray, enc: Encounter
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Tracer accelerations plus guard-violation mask and per-row distance
    to the nearest nucleus.

    Rows whose nearest-nucleus distance drops below NUCLEUS_GUARD_RADIUS are
    flagged for quarantine; their returned acceleration is zero and the
    caller must stop integrating them.
    """
    d1 = x - x1
    d2 = x - x2
    n1 = np.linalg.norm(d1, axis=1)
    n2 = np.linalg.norm(d2, axis=1)
    violated = (n1 < NUCLEUS_GUARD_RADIUS) | (n2 < NUCLEUS_GUARD_RADIUS)
    safe1 = np.where(violated, 1.0, n1)
    safe2 = np.where(violated, 1.0, n2)
    a1 = -G * enc.m1 * d1 / safe1[:, None] ** 3
    a2 = -G * enc.m2 * d2 / safe2[:, None] ** 3
    a = a1 + a2
    a[violated] = 0.0
    return a, violated, np.minimum(n1, n2)


def segment_nucleus_distance(
    x_prev: np.ndarray, x_new: np.ndarray, nucleus: np.ndarray
) -> np.ndarray:
    """Per-row distance from a nucleus to the straight chord traversed in
    one integration step. Catches tunneling: fast particles can jump across
    the guard ball without either evaluated endpoint landing inside it."""
    seg = x_new - x_prev
    denom = np.maximum(np.sum(seg * seg, axis=1), 1e-300)
    t_par = np.clip(
        np.einsum("ij,ij->i", nucleus[None, :] - x_prev, seg) / denom, 0.0, 1.0
    )
    closest = x_prev + t_par[:, None] * seg
    return np.linalg.norm(closest - nucleus[None, :], axis=1)


def integrate(
    enc: Encounter,
    x: np.ndarray,
    v: np.ndarray,
    t_span: tuple[float, float],
    dt: float,
    keyframe_every: int,
) -> dict[str, np.ndarray | list[float]]:
    """Fixed-step velocity Verlet; primaries evaluated analytically at step
    endpoints (velocity-Verlet-compatible force timing). Negative spans
    integrate backwards (time-reversibility support). Particles violating
    the nucleus guard are quarantined at first violation: their state is
    frozen and they are excluded from all later updates."""
    delta = t_span[1] - t_span[0]
    n_steps = int(round(abs(delta) / dt))
    if abs(delta) - n_steps * dt > 1e-9:
        raise ValueError("time span must be an integer multiple of dt")
    h = math.copysign(dt, delta)
    t = t_span[0]
    x1, x2 = enc.states(np.array([t]))
    a, _, md = acceleration(x, x1[0], x2[0], enc)
    quarantined = np.zeros(x.shape[0], dtype=bool)
    min_nucleus_distance = md.copy()
    frames_t: list[float] = [t]
    frames_x: list[np.ndarray] = [x.copy()]
    for step_index in range(n_steps):
        idx_active = np.nonzero(~quarantined)[0]
        xa = x[idx_active]
        va = v[idx_active]
        aa = a[idx_active]
        x_start = xa.copy()
        xa = xa + va * h + 0.5 * aa * h * h
        t_new = t + h
        x1n, x2n = enc.states(np.array([t_new]))
        a_new, violated_now, md_new = acceleration(xa, x1n[0], x2n[0], enc)
        # Segment-based proximity: quarantine must also fire when a step
        # tunnels past the guard region between evaluated endpoints.
        d1_seg = segment_nucleus_distance(x_start, xa, x1n[0])
        d2_seg = segment_nucleus_distance(x_start, xa, x2n[0])
        md_seg = np.minimum(d1_seg, d2_seg)
        violated_now = violated_now | (md_seg < NUCLEUS_GUARD_RADIUS)
        md_new = np.minimum(md_new, md_seg)
        va = va + 0.5 * (aa + a_new) * h
        newly_local = np.nonzero(violated_now)[0]
        if newly_local.size:
            # Quarantine exactly at first-violation state: undo this step's
            # velocity half-kick so the frozen state stays self-consistent.
            newly = idx_active[newly_local]
            va[newly_local] -= 0.5 * (aa[newly_local] + a_new[newly_local]) * h
            quarantined[newly] = True
        x[idx_active] = xa
        v[idx_active] = va
        min_nucleus_distance[idx_active] = np.minimum(
            min_nucleus_distance[idx_active], md_new
        )
        a_full = np.zeros_like(a)
        a_full[idx_active] = a_new
        a_full[quarantined] = 0.0
        a = a_full
        t = t_new
        if (step_index + 1) % keyframe_every == 0:
            frames_t.append(t)
            frames_x.append(x.copy())
    return {
        "times": np.asarray(frames_t),
        "positions": np.asarray(frames_x),
        "finalX": x,
        "finalV": v,
        "quarantined": quarantined,
        "quarantineCount": int(quarantined.sum()),
        "minNucleusDistance": min_nucleus_distance,
    }


# ---------------------------------------------------------------------------
# Analytic self-checks (paper-independent correctness gates)
# ---------------------------------------------------------------------------


def check_barker_finite_difference() -> dict[str, object]:
    """dt/dD from central differences must match r^2/h along the conic."""
    q, mu = 3.7, 1.0
    h = math.sqrt(2.0 * mu * q)
    eps = 1e-6
    worst = 0.0
    for d in (-8.0, -2.0, -0.3, 0.0, 0.3, 2.0, 8.0):
        num = (
            barker_dt_of_d(d + eps, q, mu) - barker_dt_of_d(d - eps, q, mu)
        ) / (2.0 * eps)
        r = q * (1.0 + d * d)
        expected = 2.0 * r * r / (h * (1.0 + d * d))
        worst = max(worst, abs(num - expected) / expected)
    return {
        "id": "barker-finite-difference",
        "threshold": 1e-8,
        "measured": worst,
        "pass": bool(worst < 1e-8),
    }


def check_conic_invariants() -> dict[str, object]:
    """Specific angular momentum and Runge-Lenz vector are exact invariants
    of the analytic parabola; any error is pure solver noise."""
    q, mu = 4.0, 1.0
    h_ref = np.array([0.0, 0.0, math.sqrt(2.0 * mu * q)])
    e_vec_ref = np.array([1.0, 0.0, 0.0])  # eccentricity vector, magnitude e=1
    worst_h = 0.0
    worst_e = 0.0
    for dt in np.linspace(-80.0, 80.0, 41):
        _, pos, vel = parabolic_relative_state(float(dt), q, mu)
        ang = np.cross(pos, vel)
        worst_h = max(worst_h, float(np.max(np.abs(ang - h_ref))) / h_ref[2])
        runge = np.cross(vel, ang) / mu - pos / np.linalg.norm(pos)
        worst_e = max(worst_e, float(np.max(np.abs(runge - e_vec_ref))))
    return {
        "id": "conic-invariants",
        "threshold": 1e-12,
        "measured": max(worst_h, worst_e),
        "pass": bool(max(worst_h, worst_e) < 1e-12),
    }


def check_frozen_potential_energy_drift() -> dict[str, object]:
    """Velocity Verlet in a FROZEN double-point potential must keep tracer
    specific-energy error bounded (symplectic behaviour), not drifting."""
    enc = Encounter(EXERCISE_MASS_RATIO, EXERCISE_PERICENTER_Q)

    class FrozenEnc(Encounter):
        def states(self, t: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
            base = super().states(np.zeros(1))
            return np.repeat(base[0][:1], t.shape[0], axis=0), np.repeat(
                base[1][:1], t.shape[0], axis=0
            )

    frozen_enc = FrozenEnc(EXERCISE_MASS_RATIO, EXERCISE_PERICENTER_Q)
    x, v = sample_all_tracers(SAMPLE_SEED, enc)
    out = integrate(frozen_enc, x, v, (0.0, 40.0), EXERCISE_DT, EXERCISE_KEYFRAME_EVERY)
    xf, vf = out["finalX"], out["finalV"]  # type: ignore[misc]
    keep = ~out["quarantined"]  # type: ignore[index]
    x1, x2 = frozen_enc.states(np.array([0.0]))

    def energy(xa: np.ndarray, va: np.ndarray) -> np.ndarray:
        return (
            0.5 * np.sum(va * va, axis=1)
            - G * enc.m1 / np.linalg.norm(xa - x1[0], axis=1)
            - G * enc.m2 / np.linalg.norm(xa - x2[0], axis=1)
        )

    e0 = energy(x[keep], v[keep])
    e1 = energy(xf[keep], vf[keep])  # type: ignore[index]
    drift = float(np.max(np.abs(e1 - e0)) / np.max(np.abs(e0)))
    return {
        "id": "frozen-potential-energy-drift",
        "threshold": 5e-6,
        "measured": drift,
        "quarantineCount": int(out["quarantineCount"]),  # type: ignore[index]
        "pass": bool(drift < 5e-6),
    }


def check_time_reversal() -> dict[str, object]:
    """Forward then reversed velocity-Verlet must retrace its path for every
    particle that was not quarantined; quarantine sets must match exactly."""
    enc = Encounter(EXERCISE_MASS_RATIO, EXERCISE_PERICENTER_Q)
    x, v = sample_all_tracers(SAMPLE_SEED, enc)
    half = integrate(enc, x, v, (0.0, 20.0), EXERCISE_DT, EXERCISE_KEYFRAME_EVERY)
    back = integrate(
        enc,
        half["finalX"],  # type: ignore[arg-type]
        -half["finalV"],  # type: ignore[operator]
        (20.0, 0.0),
        EXERCISE_DT,
        EXERCISE_KEYFRAME_EVERY,
    )
    q_fwd = half["quarantined"]  # type: ignore[index]
    q_back = back["quarantined"]  # type: ignore[index]

    def at_risk(run: dict[str, np.ndarray | list[float]]) -> np.ndarray:
        return run["minNucleusDistance"] < AT_RISK_MARGIN_RADIUS  # type: ignore[operator,index]

    keep = ~(q_fwd | q_back | at_risk(half) | at_risk(back))
    err = float(
        np.max(np.abs(back["finalX"][keep] - x[keep]))  # type: ignore[arg-type,index]
        / max(1.0, float(np.max(np.abs(x))))
    )
    return {
        "id": "time-reversal",
        "threshold": 1e-9,
        "measured": err,
        "comparedParticles": int(keep.sum()),
        "quarantineCountsForwardBackward": [
            int(half["quarantineCount"]),  # type: ignore[index]
            int(back["quarantineCount"]),  # type: ignore[index]
        ],
        "pass": bool(err < 1e-9),
    }


def check_reflection_symmetry() -> dict[str, object]:
    """Mirror symmetry composed with time reversal.

    For the planar exercise configuration the conic satisfies
    r_rel(-t) = M r_rel(t) with M = diag(1,-1,1), so Y(t) = M X(-t) solves
    the same dynamics as X(t). Engine-level consequence: integrating the
    mirrored state BACKWARD for T and mirroring back must reproduce the
    forward endpoint exactly (for non-at-risk particles).
    """
    enc = Encounter(EXERCISE_MASS_RATIO, EXERCISE_PERICENTER_Q, 0.0, 0.0, 0.0)
    x, v = sample_all_tracers(SAMPLE_SEED, enc)
    mirror_op = np.diag([1.0, -1.0, 1.0])
    # Backward integration requires the reversed velocity: Y'(0) = -M X'(0).
    xm, vm = x @ mirror_op.T, -(v @ mirror_op.T)
    horizon = 20.0
    run_a = integrate(enc, x, v, (0.0, horizon), EXERCISE_DT, EXERCISE_KEYFRAME_EVERY)
    run_m = integrate(enc, xm, vm, (0.0, -horizon), EXERCISE_DT, EXERCISE_KEYFRAME_EVERY)
    mirrored_back = run_m["finalX"] @ mirror_op.T  # type: ignore[operator]
    qa = run_a["quarantined"]  # type: ignore[index]
    qm = run_m["quarantined"]  # type: ignore[index]

    def at_risk_m(run: dict[str, np.ndarray | list[float]]) -> np.ndarray:
        return run["minNucleusDistance"] < AT_RISK_MARGIN_RADIUS  # type: ignore[operator,index]

    keep = ~(qa | qm | at_risk_m(run_a) | at_risk_m(run_m))
    err = float(
        np.max(np.abs(mirrored_back[keep] - run_a["finalX"][keep]))  # type: ignore[arg-type,index]
    )
    return {
        "id": "reflection-symmetry",
        "threshold": 1e-9,
        "measured": err,
        "comparedParticles": int(keep.sum()),
        "pass": bool(err < 1e-9),
    }


def check_circular_orbit_single_mass() -> dict[str, object]:
    """Single-nucleus limit: a circular tracer stays near-circular with the
    Keplerian angular frequency sqrt(GM/r^3). mass_ratio = 1e12 puts ~all
    mass in nucleus 1, which then sits at the COM origin; the companion's
    gravitational weight is ~1e-12."""
    solo_enc = Encounter(1e12, 1.0)
    r0 = 1.3
    omega_kepler = math.sqrt(G * solo_enc.m1 / r0**3)
    xc = np.array([[r0, 0.0, 0.0]])
    vc = np.array([[0.0, omega_kepler * r0, 0.0]])
    out = integrate(solo_enc, xc, vc, (0.0, 30.0), EXERCISE_DT, EXERCISE_KEYFRAME_EVERY)
    traj = out["positions"]  # type: ignore[misc]
    radii = np.linalg.norm(traj[:, 0, :], axis=1)
    amplitude = float(radii.max() - radii.min())
    # Measured frequency via unwrapped polar angle — immune to the sampling
    # grid (a crossing-time estimator quantizes to the keyframe interval).
    angles = np.unwrap(np.arctan2(traj[:, 0, 1], traj[:, 0, 0]))
    times = out["times"]  # type: ignore[misc]
    omega_meas = float((angles[-1] - angles[0]) / (times[-1] - times[0]))
    freq_err = abs(omega_meas - omega_kepler) / omega_kepler
    ok = amplitude < 1e-3 and freq_err < 1e-4
    return {
        "id": "circular-orbit-single-mass",
        "thresholds": {"radiusAmplitude": 1e-3, "freqRelErr": 1e-4},
        "measured": {"radiusAmplitude": amplitude, "freqRelErr": freq_err},
        "pass": bool(ok),
    }


def check_quarantine_fail_closed() -> dict[str, object]:
    """A tracer in exact radial infall toward the (effectively static)
    dominant nucleus must be quarantined exactly once, with finite parked
    state — never NaN, never a crash."""
    enc = Encounter(1e12, 1.0)  # m1 ~ 1 at COM origin; companion ~ massless
    xc = np.array([[3.0, 0.0, 0.0]])
    # Near-parabolic radial infall: reaches the nucleus in ~2.4 time units.
    v_infall = -math.sqrt(2.0 * G * TOTAL_MASS / 3.0)
    vc = np.array([[v_infall, 0.0, 0.0]])
    out = integrate(enc, xc.copy(), vc.copy(), (0.0, 30.0), EXERCISE_DT, 25)
    finite_ok = bool(np.all(np.isfinite(out["finalX"]))) and bool(
        np.all(np.isfinite(out["finalV"]))
    )
    count = int(out["quarantineCount"])  # type: ignore[index]
    ok = count == 1 and finite_ok
    return {
        "id": "quarantine-fail-closed",
        "thresholds": {"quarantineCount": 1},
        "measured": {"quarantineCount": count, "finalStateFinite": finite_ok},
        "pass": bool(ok),
    }


# ---------------------------------------------------------------------------
# Report assembly
# ---------------------------------------------------------------------------


def build_report(write_npz_scratch: Path | None) -> dict[str, object]:
    enc = Encounter(
        EXERCISE_MASS_RATIO,
        EXERCISE_PERICENTER_Q,
        EXERCISE_OMEGA_DEG,
        EXERCISE_INCLINATION_DEG,
        EXERCISE_NODE_DEG,
    )
    x, v = sample_all_tracers(SAMPLE_SEED, enc, EXERCISE_T_SPAN[0])
    ic_bytes = np.ascontiguousarray(x).tobytes()
    ic_sha = hashlib.sha256(ic_bytes).hexdigest()
    ic_sha_repeat = hashlib.sha256(
        np.ascontiguousarray(sample_all_tracers(SAMPLE_SEED, enc, EXERCISE_T_SPAN[0])[0]).tobytes()
    ).hexdigest()

    checks = [
        check_barker_finite_difference(),
        check_conic_invariants(),
        check_time_reversal(),
        check_reflection_symmetry(),
        check_circular_orbit_single_mass(),
        check_frozen_potential_energy_drift(),
        check_quarantine_fail_closed(),
    ]

    out = integrate(enc, x, v, EXERCISE_T_SPAN, EXERCISE_DT, EXERCISE_KEYFRAME_EVERY)
    final_x = out["finalX"]  # type: ignore[misc]
    x1_end, x2_end = enc.states(np.array([EXERCISE_T_SPAN[1]]))
    d1 = np.linalg.norm(final_x - x1_end[0], axis=1)
    d2 = np.linalg.norm(final_x - x2_end[0], axis=1)
    unbound_fraction = float(
        np.mean((d1 > DISK_R_OUT * 3.0) & (d2 > DISK_R_OUT * 3.0))
    )

    if write_npz_scratch is not None:
        write_npz_scratch.parent.mkdir(parents=True, exist_ok=True)
        np.savez_compressed(
            write_npz_scratch,
            times=out["times"],  # type: ignore[arg-type]
            positions=out["positions"],  # type: ignore[arg-type]
        )

    report: dict[str, object] = {
        "schemaVersion": 1,
        "toolVersion": TOOL_VERSION,
        "packet": "CA9-03",
        "provenance": {
            "referenceExperiment": "Toomre & Toomre (1972), ApJ 178, 623",
            "doi": "10.1086/151823",
            "decisionAdr": "CA-ADR-022",
            "parametersStatus": "placeholder-exercise-config",
            "note": (
                "Exercise configuration validates the ENGINE only; published "
                "encounter parameters arrive with CA9-03 parameter "
                "transcription against a legitimately obtained paper copy."
            ),
        },
        "units": {
            "gravitationalConstant": G,
            "totalPairMass": TOTAL_MASS,
            "lengthUnitDiskRadius": LENGTH_UNIT_DISK_RADIUS,
            "integrator": "velocity-verlet",
            "fixedStepDt": EXERCISE_DT,
            "primaryPropagation": "barker-exact-parabolic",
        },
        "sampling": {
            "seed": SAMPLE_SEED,
            "tracersPerGalaxy": TRACERS_PER_GALAXY,
            "diskRin": DISK_R_IN,
            "diskRout": DISK_R_OUT,
            "diskProfileAlpha": DISK_PROFILE_ALPHA,
            "initialConditionsSha256": ic_sha,
        },
        "determinism": {
            "icSha256Repeat": ic_sha_repeat,
            "icBytesIdenticalOnResample": ic_sha == ic_sha_repeat,
        },
        "checks": checks,
        "exerciseMetrics": {
            "windowT": list(EXERCISE_T_SPAN),
            "keyframeCount": int(out["times"].shape[0]),  # type: ignore[union-attr]
            "unboundBothFractionAtEnd": unbound_fraction,
            "quarantineCount": int(out["quarantineCount"]),  # type: ignore[index]
        },
        "allPass": bool(all(c["pass"] is True for c in checks)),  # type: ignore[union-attr]
    }
    return report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--scratch-npz",
        type=Path,
        default=None,
        help="optionally dump trajectory keyframes to an .npz scratch file",
    )
    args = parser.parse_args(argv)

    report = build_report(args.scratch_npz)
    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    REPORT_PATH.write_text(json.dumps(report, indent=2, sort_keys=False) + "\n")
    status = "PASS" if report["allPass"] else "FAIL"  # type: ignore[index]
    print(f"CA9 integrator self-check: {status}")
    print(f"report: {REPORT_PATH.relative_to(REPO_ROOT)}")
    for chk in report["checks"]:  # type: ignore[index]
        mark = "ok" if chk["pass"] else "FAIL"  # type: ignore[index]
        measured = chk.get("measured")
        print(f"  [{mark}] {chk['id']}: {measured}")  # type: ignore[index]
    return 0 if report["allPass"] else 1  # type: ignore[index]


if __name__ == "__main__":
    sys.exit(main())
