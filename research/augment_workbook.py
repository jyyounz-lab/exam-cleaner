"""Build local resolution variants; page splits and sparse labels stay together."""
from pathlib import Path
import argparse
import json
import shutil
import numpy as np
import onnxruntime as ort
from PIL import Image
from prepare_pairs import predict


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('source', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--overrides', type=Path, required=True)
    args = parser.parse_args()
    if args.source.resolve() == args.output.resolve():
        raise ValueError('Use a separate output dataset to preserve the training record')
    args.output.mkdir(parents=True, exist_ok=True)
    manifest = json.loads((args.source / 'manifest.json').read_text(encoding='utf-8'))
    opts = ort.SessionOptions()
    opts.intra_op_num_threads = 2
    session = ort.InferenceSession('public/models/phti-fcnn.onnx', opts, providers=['CPUExecutionProvider'])
    variants = []
    for pair in manifest['pairs']:
        source = args.source / pair['id']
        image = Image.open(source / 'original.png').convert('RGB')
        labels = np.fromfile(source / 'labels', np.uint8).reshape(image.height, image.width).copy()
        override_path = args.overrides / (pair['id'] + '.png')
        verified = np.full(labels.shape, 255, np.uint8)
        if override_path.exists():
            verified = np.asarray(Image.open(override_path))
            assert verified.shape == labels.shape and set(np.unique(verified)) <= {0, 1, 255}
            labels[verified != 255] = verified[verified != 255]
        for width in [image.width, 900, 1500]:
            name = f"{pair['id']}-w{width}"
            dest = args.output / name
            dest.mkdir(exist_ok=True)
            size = (width, round(image.height * width / image.width))
            if not (dest / 'meta.json').exists():
                rgb = image.resize(size, Image.Resampling.LANCZOS)
                rgb.save(dest / 'original.png')
                if size == image.size:
                    for field in ['rgba', 'binary', 'hand', 'print']:
                        shutil.copy2(source / field, dest / field)
                else:
                    ink, pred = predict(np.asarray(rgb), session)
                    np.asarray(rgb.convert('RGBA')).tofile(dest / 'rgba')
                    ink.tofile(dest / 'binary')
                    pred[0].tofile(dest / 'print')
                    pred[1].tofile(dest / 'hand')
                (dest / 'meta.json').write_text(json.dumps({'width': size[0], 'height': size[1], 'split': pair['split'], 'sourcePage': pair['id']}), encoding='utf-8')
            for field, array in [('labels', labels), ('verified', verified)]:
                np.asarray(Image.fromarray(array).resize(size, Image.Resampling.NEAREST)).tofile(dest / field)
            variants.append({'id': name, 'sourcePage': pair['id'], 'split': pair['split']})
            print(name, flush=True)
    (args.output / 'manifest.json').write_text(json.dumps({'pairs': variants}, indent=2), encoding='utf-8')


if __name__ == '__main__':
    main()
