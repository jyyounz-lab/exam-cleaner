"""Prepare LOCAL comparison pairs and cache the unchanged PHTI inference.

Targets from another eraser are weak evidence, never clean ground truth.
All outputs belong under ignored test-results/. No image is uploaded.
"""
from pathlib import Path
import argparse
import hashlib
import json
import time
import cv2
import numpy as np
import onnxruntime as ort
from PIL import Image, ImageOps


def read(path):
    return np.asarray(ImageOps.exif_transpose(Image.open(path)).convert('RGB'))


def contrast(rgb):
    paper = cv2.morphologyEx(rgb, cv2.MORPH_CLOSE, np.ones((31, 31), np.uint8))
    paper = cv2.GaussianBlur(paper, (0, 0), 5)
    return np.maximum(0, (1 - (rgb.astype(float) / np.maximum(paper, 40)).mean(2)) * 255).astype(np.float32)


def align(source, target):
    def gray(rgb):
        return cv2.createCLAHE(2, (8, 8)).apply(cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY))
    a, b = gray(source), gray(target)
    sift = cv2.SIFT_create(nfeatures=7000)
    ka, da = sift.detectAndCompute(a, None)
    kb, db = sift.detectAndCompute(b, None)
    matches = cv2.BFMatcher().knnMatch(db, da, k=2)
    good = [m for m, n in matches if m.distance < .7 * n.distance]
    if len(good) < 30:
        raise ValueError('Insufficient reliable pair matches')
    pts_b = np.float32([kb[m.queryIdx].pt for m in good])
    pts_a = np.float32([ka[m.trainIdx].pt for m in good])
    matrix, inliers = cv2.findHomography(pts_b, pts_a, cv2.RANSAC, 4)
    h, w = source.shape[:2]
    warped = cv2.warpPerspective(target, matrix, (w, h), borderValue=(255, 255, 255))
    valid = cv2.warpPerspective(np.ones(target.shape[:2], np.uint8), matrix, (w, h))
    # Book curvature differs across the photographs; register low-frequency print locally.
    dis = cv2.DISOpticalFlow_create(cv2.DISOPTICAL_FLOW_PRESET_MEDIUM)
    flow = dis.calc(cv2.GaussianBlur(a, (5, 5), 0), cv2.GaussianBlur(gray(warped), (5, 5), 0), None)
    flow = cv2.GaussianBlur(flow, (0, 0), 12)
    yy, xx = np.mgrid[:h, :w].astype(np.float32)
    aligned = cv2.remap(warped, xx + flow[:, :, 0], yy + flow[:, :, 1], cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=(255, 255, 255))
    valid = cv2.remap(valid, xx + flow[:, :, 0], yy + flow[:, :, 1], cv2.INTER_NEAREST)
    return aligned, valid, {'matches': len(good), 'inliers': int(inliers.sum()), 'medianFlow': float(np.median(np.linalg.norm(flow, axis=2)))}


def binary(rgb):
    gray = rgb.astype(np.float64) @ np.array([.2125, .7154, .0721]) / 255
    mean = cv2.boxFilter(gray, -1, (15, 15), borderType=cv2.BORDER_REFLECT_101)
    second = cv2.boxFilter(gray * gray, -1, (15, 15), borderType=cv2.BORDER_REFLECT_101)
    sd = np.sqrt(np.maximum(0, second - mean * mean))
    return (gray < mean * (1 + .2 * (sd - 1))).astype(np.uint8)


def predict(rgb, session):
    ink = binary(rgb)
    h, w = ink.shape
    def positions(size):
        out = [0]
        while out[-1] + 256 < size:
            out.append(min(out[-1] + 246, size - 256))
        return out
    yy, xx = np.mgrid[:256, :256]
    blend = np.minimum(1, (np.minimum.reduce([yy, xx, 255-yy, 255-xx]) + 1) / 6)
    out, weights = np.zeros((2, h, w), np.float32), np.zeros((h, w), np.float32)
    for y in positions(h):
        for x in positions(w):
            ih, iw = min(256, h-y), min(256, w-x)
            tile = np.zeros((256, 256), np.float32)
            tile[:ih, :iw] = ink[y:y+ih, x:x+iw]
            tile = (tile - tile.mean()) / (tile.std() or 1)
            prediction = session.run(None, {'image': np.repeat(tile[None, None], 3, axis=1)})[0][0]
            out[:, y:y+ih, x:x+iw] += prediction[:2, :ih, :iw] * blend[:ih, :iw]
            weights[y:y+ih, x:x+iw] += blend[:ih, :iw]
    return ink, out / np.maximum(weights, 1e-6)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('manifest', type=Path)
    args = parser.parse_args()
    manifest = json.loads(args.manifest.read_text(encoding='utf-8'))
    root = args.manifest.parent
    opts = ort.SessionOptions()
    opts.intra_op_num_threads = 2
    session = ort.InferenceSession(str(Path(__file__).resolve().parents[1] / 'public/models/phti-fcnn.onnx'), opts, providers=['CPUExecutionProvider'])
    for pair in manifest['pairs']:
        dest = root / pair['id']
        dest.mkdir(exist_ok=True)
        if (dest / 'meta.json').exists():
            continue
        start = time.perf_counter()
        source, target = read(pair['source']), read(pair['comparison'])
        aligned, valid, quality = align(source, target)
        ink, prediction = predict(source, session)
        for name, data in [('rgba', np.dstack([source, np.full(source.shape[:2], 255, np.uint8)])), ('binary', ink), ('print', prediction[0]), ('hand', prediction[1]), ('target-contrast', contrast(aligned)), ('source-contrast', contrast(source)), ('valid', valid)]:
            data.tofile(dest / name)
        Image.fromarray(source).save(dest / 'original.png')
        Image.fromarray(aligned).save(dest / 'aligned-comparison.png')
        Image.fromarray(target).save(dest / 'comparison.png')
        meta = {'width': source.shape[1], 'height': source.shape[0], 'split': pair['split'], 'alignment': quality, 'sourceSha256': hashlib.sha256(Path(pair['source']).read_bytes()).hexdigest(), 'comparisonSha256': hashlib.sha256(Path(pair['comparison']).read_bytes()).hexdigest(), 'seconds': round(time.perf_counter() - start, 2)}
        (dest / 'meta.json').write_text(json.dumps(meta, indent=2), encoding='utf-8')
        print(pair['id'], json.dumps(meta), flush=True)


if __name__ == '__main__':
    main()
