"""Download the fixed MIT PHTI source weight, verify it, and copy its license."""
from pathlib import Path
import hashlib
import urllib.request

ROOT = Path(__file__).resolve().parent
COMMIT = "b23f26c2490e55fea64bc1e9b5676bf07fbb2f9b"
BASE = f"https://raw.githubusercontent.com/Jumpst3r/printed-hw-segmentation/{COMMIT}"
EXPECTED = "a4fbfc32291159114f7d65014ac9fa33c0f3e296e3271b136fa2d3152d8b2f00"

if __name__ == "__main__":
    payload = urllib.request.urlopen(BASE + "/FCN/models/fcnn_bin.h5", timeout=60).read()
    if hashlib.sha256(payload).hexdigest() != EXPECTED:
        raise ValueError("Unexpected source hash")
    (ROOT / "fcnn_bin.h5").write_bytes(payload)
    model_dir = ROOT.parent / "public" / "models"
    model_dir.mkdir(parents=True, exist_ok=True)
    license_text = urllib.request.urlopen(BASE + "/LICENSE", timeout=60).read()
    (model_dir / "PHTI-LICENSE.txt").write_bytes(license_text)
    for remote, local in [("docker/code/input.png", "upstream-example.png"), ("docker/code/mask.png", "upstream-mask.png")]:
        (ROOT / local).write_bytes(urllib.request.urlopen(BASE + "/" + remote, timeout=60).read())
    print("Fixed source weight hash verified; source example and MIT license downloaded.")
