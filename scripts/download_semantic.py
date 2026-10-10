from pathlib import Path
import hashlib
import json
import urllib.request

ROOT=Path(__file__).resolve().parents[1]
SOURCE_COMMIT='df019de5129d6c4b406587a14c3501669441a783'
MODEL_REPO='24yearsold/l2d_sam_iter2'
MODEL_REVISION='0b0608310fb7a89e32ecd7397147a249540cf1e7'

def main():
    source=ROOT/'third_party/see-through'
    if not (source/'common/modules/semanticsam.py').exists():
        raise RuntimeError('The vendored SemanticSam runtime is missing. Restore the application source before setup.')
    model=ROOT/'models/semantic-sam.pt'
    model.parent.mkdir(exist_ok=True)
    if not model.exists():
        print('Downloading SemanticSam checkpoint (~1.29 GB)...',flush=True)
        urllib.request.urlretrieve(f"https://huggingface.co/{MODEL_REPO}/resolve/{MODEL_REVISION}/checkpoint-18000.pt",model.with_suffix('.download'))
        model.with_suffix('.download').replace(model)
    digest=hashlib.sha256()
    with model.open('rb') as handle:
        for chunk in iter(lambda:handle.read(8*1024*1024),b''):
            digest.update(chunk)
    if digest.hexdigest() != 'dda82b916f6c340bc5a6c3a077ff1214f9906906abe3707b1076d55b508f253f':
        raise RuntimeError('SemanticSam checksum mismatch. Download was not accepted.')
    record={'repository':MODEL_REPO,'revision':MODEL_REVISION,'source_commit':SOURCE_COMMIT,'license':'Apache-2.0','bytes':model.stat().st_size,'sha256':digest.hexdigest()}
    (ROOT/'models/semantic-manifest.json').write_text(json.dumps(record,indent=2),encoding='utf-8')
    print(json.dumps(record),flush=True)

if __name__=='__main__':
    main()
