#!/usr/bin/env python3
"""Explicit setup-only downloads. Inference never imports or invokes this script."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess

REPOSITORY = "aufklarer/Omnilingual-ASR-CTC-300M-CoreML-INT8-10s"
REVISION = "ce99f14bbc768d8dc6ffd3235a21cd9751ceb139"
# Non-LFS files use the pinned Git blob hash; LFS weights use SHA-256.
FILES = {
    "config.json": ("git", "23a1cc5536d4956ae8de91a9e84400dbea70fa6d"),
    "tokenizer.model": ("sha256", "8aa11a1092142ef472537476ef6e76541123e2f0d789b79f3ebd119008240b1e"),
    "omnilingual-ctc-300m-int8.mlmodelc/analytics/coremldata.bin": ("sha256", "1c9abc8c44079a78529e89be1ec61d1f7b4f8a4d29c1c6e60a661944815796a4"),
    "omnilingual-ctc-300m-int8.mlmodelc/coremldata.bin": ("sha256", "8e7eef184a78f42925af7c9b3b3b1cea18bd7743eda9c036f0eda21f2ca95e18"),
    "omnilingual-ctc-300m-int8.mlmodelc/model.mil": ("git", "16c680b924f6f603f0f690162da4eb96ae763c4a"),
    "omnilingual-ctc-300m-int8.mlmodelc/weights/weight.bin": ("sha256", "158084272159ff8b0583846782beba8b5b118aa1255528b0a21d3a77c8061612"),
}

def digest(path, algorithm):
    result = hashlib.sha256() if algorithm == "sha256" else hashlib.sha1()
    if algorithm == "git":
        result.update(f"blob {path.stat().st_size}\0".encode())
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            result.update(block)
    return result.hexdigest()

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    parser.add_argument("--check", action="store_true", help="Verify preloaded assets without network access")
    args = parser.parse_args()
    os.umask(0o077)
    for name, (algorithm, expected) in FILES.items():
        destination = args.directory / name
        if destination.exists() and digest(destination, algorithm) == expected:
            continue
        if args.check:
            raise RuntimeError("Missing or changed pilot model asset")
        destination.parent.mkdir(parents=True, exist_ok=True)
        temporary = destination.with_name(destination.name + ".partial")
        subprocess.run(["/usr/bin/curl", "--fail", "--location", "--silent", "--show-error", "--output", str(temporary),
                        f"https://huggingface.co/{REPOSITORY}/resolve/{REVISION}/{name}"], check=True)
        if digest(temporary, algorithm) != expected:
            temporary.unlink(missing_ok=True)
            raise RuntimeError("Pilot model checksum mismatch")
        temporary.replace(destination)
    if not args.check:
        (args.directory / "pilot-provenance.json").write_text(json.dumps({"repository": REPOSITORY, "revision": REVISION, "files": FILES}, indent=2))
    print("Local Omnilingual pilot assets verified.")

if __name__ == "__main__":
    main()
