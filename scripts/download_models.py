"""Public model download only. User images are never uploaded."""
from pathlib import Path
import hashlib
import json
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
MODELS = ROOT / "models"

def main():
    MODELS.mkdir(exist_ok=True)
    dest = MODELS / "anime-seg.onnx"
    revision = '493cb60893f47441b26ec4fb9a306bce9e342982'
    url = f"https://huggingface.co/skytnt/anime-seg/resolve/{revision}/isnetis.onnx"
    if not dest.exists():
        print("Downloading AnimeSeg ONNX (~176 MB)...", flush=True)
        temporary = dest.with_suffix('.download')
        urllib.request.urlretrieve(url, temporary)
        temporary.replace(dest)
    checksum = hashlib.sha256(dest.read_bytes()).hexdigest()
    if checksum != 'f15622d853e8260172812b657053460e20806f04b9e05147d49af7bed31a6e99':
        raise RuntimeError('AnimeSeg checksum mismatch. Download was not accepted.')
    metadata = {"repo": "skytnt/anime-seg", "revision": revision, "license": "Apache-2.0", "sha256": checksum, "bytes": dest.stat().st_size}
    (MODELS / "manifest.json").write_text(json.dumps(metadata, indent=2), encoding="utf-8")
    print(json.dumps(metadata), flush=True)

if __name__ == '__main__':
    main()
