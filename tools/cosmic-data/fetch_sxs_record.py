"""CA8-03 — Offline fetch tool for the pinned Black-Hole Merger source record.

Downloads the pinned Zenodo record files into ``scratch/`` with checksum
verification. Idempotent: files already present with the correct MD5 are not
re-downloaded. No API keys or secrets are required (Zenodo public records).

Pinned provenance (docs/cosmic-atlas/DATA_SOURCES_BBH_MERGER.md,
docs/cosmic-atlas/DECISIONS.md CA-ADR-021):

    simulation : SXS:BBH:0001 (Lev5), SXS Collaboration, SpEC
    record     : https://zenodo.org/records/13166927
    DOI        : 10.5281/zenodo.13166927
    license    : CC-BY-4.0 (explicit on record)
    retrieved  : 2026-08-25 (original pin)

Usage:
    python tools/cosmic-data/fetch_sxs_record.py
    python tools/cosmic-data/fetch_sxs_record.py --list
"""

from __future__ import annotations

import argparse
import hashlib
import sys
import urllib.request
from pathlib import Path

TOOL_ROOT = Path(__file__).resolve().parent
SCRATCH = TOOL_ROOT / "scratch"

USER_AGENT = "browser-blackhole-cosmic-data/1.0 (offline scientific fetch)"

# ---------------------------------------------------------------------------
# Pinned record contract. Changing anything here is a provenance decision
# requiring a new ADR (CA-ADR-021) and a full pipeline/validation rerun.
# ---------------------------------------------------------------------------

RECORD_ID = "13166927"
RECORD_URL = f"https://zenodo.org/records/{RECORD_ID}"
DOI = "10.5281/zenodo.13166927"
LICENSE = "CC-BY-4.0"

# key -> expected MD5 (published by the Zenodo record API).
PINNED_FILES: dict[str, str] = {
    "Lev5:metadata.json": "e60290b92aae222f3a7cde9663700156",
    "Lev5:Strain_N4.h5": "11d3e0ac3628de4bf2c067064d95b4ec",
    "Lev5:Strain_N4.json": "ba8c2e346093db628509a8196e39b611",
    "Lev5:Horizons.h5": "484ea88842209e64983793159bcc7d7c",
}


def md5_of(payload: bytes) -> str:
    return hashlib.md5(payload).hexdigest()  # noqa: S324 - record publishes MD5


def local_path(key: str) -> Path:
    """Deterministic destination path for a record file key."""
    return SCRATCH / RECORD_ID / key.replace(":", "_")


def fetch_one(key: str, expected_md5: str) -> str:
    """Fetch (or validate already-fetched) one file. Returns status string."""
    dest = local_path(key)
    if dest.exists():
        digest = md5_of(dest.read_bytes())
        if digest == expected_md5:
            print(f"  ok (cached)  {key}  md5={digest}")
            return "cached"
        print(f"  re-fetching {key}: cached md5 {digest} != pinned {expected_md5}")

    url = f"https://zenodo.org/api/records/{RECORD_ID}/files/{key}/content"
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=600) as response:
            payload = response.read()
    except Exception as error:  # pragma: no cover - environment dependent
        raise SystemExit(
            f"[fetch] FAILED downloading {key} from {url}\n"
            f"        {error}\n"
            f"        Check network access to zenodo.org; the pinned record\n"
            f"        must not be substituted."
        ) from error

    digest = md5_of(payload)
    if digest != expected_md5:
        raise SystemExit(
            f"[fetch] CHECKSUM MISMATCH for {key}\n"
            f"        expected md5 {expected_md5}\n"
            f"        got      md5 {digest}\n"
            f"        Refusing to continue: the pinned source bytes changed."
        )
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(payload)
    print(f"  fetched      {key}  ({len(payload)} bytes)  md5={digest}")
    return "fetched"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--list", action="store_true", help="print pinned contract and exit")
    args = parser.parse_args()

    if args.list:
        print(f"record   {RECORD_ID}  {RECORD_URL}")
        print(f"doi      {DOI}")
        print(f"license  {LICENSE}")
        for key, digest in PINNED_FILES.items():
            print(f"file     {key}  md5={digest}")
        return 0

    print(f"[fetch] pinned record {RECORD_ID} ({DOI}, license {LICENSE})")
    SCRATCH.mkdir(parents=True, exist_ok=True)
    statuses = [fetch_one(key, digest) for key, digest in PINNED_FILES.items()]
    fetched = sum(1 for s in statuses if s == "fetched")
    print(f"[fetch] complete: {fetched} downloaded, {len(statuses) - fetched} cached-ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
