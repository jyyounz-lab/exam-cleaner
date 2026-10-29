"""Convert MIT PHTI Keras HDF5 weights to a plain NCHW ONNX inference graph.

No TensorFlow/Keras needed. Install h5py, onnx, onnxruntime into python-deps.
Run this file with the bundled Python. See MODEL-CARD.md for provenance.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import sys
import time

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "python-deps"))
import h5py
import numpy as np
import onnx
from onnx import TensorProto, helper, numpy_helper
import onnxruntime as ort
from PIL import Image, ImageDraw

SOURCE_COMMIT = "b23f26c2490e55fea64bc1e9b5676bf07fbb2f9b"
SOURCE_SHA256 = "a4fbfc32291159114f7d65014ac9fa33c0f3e296e3271b136fa2d3152d8b2f00"
SOURCE = ROOT / "fcnn_bin.h5"
OUT = ROOT.parent / "public" / "models"
MODEL = OUT / "phti-fcnn.onnx"


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def convert() -> tuple[list[dict], dict[str, np.ndarray]]:
    if digest(SOURCE) != SOURCE_SHA256:
        raise ValueError("Unexpected source H5 hash; refusing to convert")
    nodes, tensors, weights = [], [], {}
    with h5py.File(SOURCE) as f:
        config = json.loads(f.attrs["model_config"])["config"]
        layers = config["layers"]
        for layer in layers:
            name, cls, cfg = layer["name"], layer["class_name"], layer["config"]
            parents = [x[0] for x in layer["inbound_nodes"][0]] if layer["inbound_nodes"] else []
            if cls == "InputLayer":
                nodes.append(helper.make_node("Identity", ["image"], [name], name=name))
                continue
            if cls in ("Conv2D", "Conv2DTranspose"):
                group = f["model_weights"][name][name]
                kernel = np.asarray(group["kernel:0"], dtype=np.float32)
                weights[name + ".kernel"] = kernel
                # Keras Conv HWIO -> ONNX OIHW; transpose-conv HWOI -> IOHW.
                transformed = kernel.transpose(3, 2, 0, 1).copy()
                kernel_name = name + ".weight"
                tensors.append(numpy_helper.from_array(transformed, kernel_name))
                inputs = parents + [kernel_name]
                if cfg["use_bias"]:
                    bias = np.asarray(group["bias:0"], dtype=np.float32)
                    weights[name + ".bias"] = bias
                    bias_name = name + ".bias"
                    tensors.append(numpy_helper.from_array(bias, bias_name))
                    inputs.append(bias_name)
                op = "Conv" if cls == "Conv2D" else "ConvTranspose"
                attrs = {"kernel_shape": cfg["kernel_size"], "strides": cfg["strides"], "dilations": cfg["dilation_rate"]}
                if cfg["padding"] == "same":
                    if cfg["strides"] != [1, 1]:
                        raise ValueError("Only the source model's stride-1 SAME conv is supported")
                    kh, kw = cfg["kernel_size"]
                    attrs["pads"] = [kh // 2, kw // 2, kh // 2, kw // 2]
                elif cfg["padding"] != "valid":
                    raise ValueError("Unsupported padding")
                raw = name + ".linear" if cfg["activation"] != "linear" else name
                nodes.append(helper.make_node(op, inputs, [raw], name=name + ".op", **attrs))
                if cfg["activation"] == "relu":
                    nodes.append(helper.make_node("Relu", [raw], [name], name=name + ".relu"))
                elif cfg["activation"] != "linear":
                    raise ValueError("Unsupported activation")
            elif cls == "MaxPooling2D":
                assert cfg["padding"] == "valid"
                nodes.append(helper.make_node("MaxPool", parents, [name], name=name,
                                              kernel_shape=cfg["pool_size"], strides=cfg["strides"]))
            elif cls == "Dropout":
                nodes.append(helper.make_node("Identity", parents, [name], name=name))
            elif cls == "Add":
                assert len(parents) == 2
                nodes.append(helper.make_node("Add", parents, [name], name=name))
            elif cls == "Activation" and cfg["activation"] == "softmax":
                nodes.append(helper.make_node("Softmax", parents, [name], name=name, axis=1))
            else:
                raise ValueError("Unsupported layer: " + cls)
    last = config["output_layers"][0][0]
    nodes.append(helper.make_node("Identity", [last], ["probabilities"], name="output"))
    graph = helper.make_graph(nodes, "PHTI-FCNN-light-2",
        [helper.make_tensor_value_info("image", TensorProto.FLOAT, [1, 3, 256, 256])],
        [helper.make_tensor_value_info("probabilities", TensorProto.FLOAT, [1, 3, 256, 256])], tensors)
    model = helper.make_model(graph, producer_name="exam-cleaner-phti-converter", opset_imports=[helper.make_opsetid("", 13)])
    model.ir_version = 8
    helper.set_model_props(model, {"source": "Jumpst3r/printed-hw-segmentation", "source_commit": SOURCE_COMMIT,
                                  "license": "MIT", "classes": "printed,handwritten,background"})
    onnx.checker.check_model(model, full_check=True)
    model = onnx.shape_inference.infer_shapes(model, strict_mode=True)
    OUT.mkdir(exist_ok=True, parents=True)
    onnx.save(model, MODEL)
    return layers, weights


def reference(x: np.ndarray, layers: list[dict], weights: dict[str, np.ndarray]) -> dict[str, np.ndarray]:
    """Independent NHWC NumPy reference matching original Keras layer semantics."""
    values = {}
    for layer in layers:
        name, cls, cfg = layer["name"], layer["class_name"], layer["config"]
        parents = [values[p[0]] for p in layer["inbound_nodes"][0]] if layer["inbound_nodes"] else []
        if cls == "InputLayer":
            y = x
        elif cls == "Conv2D":
            a, kernel = parents[0], weights[name + ".kernel"]
            kh, kw = cfg["kernel_size"]
            if cfg["padding"] == "same":
                a = np.pad(a, ((0, 0), (kh // 2, kh // 2), (kw // 2, kw // 2), (0, 0)))
            windows = np.lib.stride_tricks.sliding_window_view(a, (kh, kw), axis=(1, 2))
            windows = windows.transpose(0, 1, 2, 4, 5, 3)
            y = np.tensordot(windows, kernel, axes=((3, 4, 5), (0, 1, 2)))
            if cfg["use_bias"]:
                y += weights[name + ".bias"]
            if cfg["activation"] == "relu":
                y = np.maximum(y, 0)
        elif cls == "Conv2DTranspose":
            a, kernel = parents[0], weights[name + ".kernel"]
            kh, kw = cfg["kernel_size"]
            sh, sw = cfg["strides"]
            n, h, w, _ = a.shape
            y = np.zeros((n, (h - 1) * sh + kh, (w - 1) * sw + kw, cfg["filters"]), np.float32)
            for ky in range(kh):
                for kx in range(kw):
                    y[:, ky:ky + h * sh:sh, kx:kx + w * sw:sw] += np.tensordot(a, kernel[ky, kx], axes=((-1,), (-1,)))
        elif cls == "MaxPooling2D":
            a = parents[0]
            assert cfg["pool_size"] == cfg["strides"] == [2, 2]
            n, h, w, c = a.shape
            y = a.reshape(n, h // 2, 2, w // 2, 2, c).max(axis=(2, 4))
        elif cls == "Dropout":
            y = parents[0]
        elif cls == "Add":
            y = parents[0] + parents[1]
        elif cls == "Activation":
            a = parents[0] - parents[0].max(axis=-1, keepdims=True)
            y = np.exp(a)
            y /= y.sum(axis=-1, keepdims=True)
        else:
            raise ValueError(cls)
        values[name] = y.astype(np.float32)
    return values


def synthetic_input() -> np.ndarray:
    """Self-authored mixed document input, not a real-world quality benchmark."""
    image = Image.new("L", (256, 256), 255)
    draw = ImageDraw.Draw(image)
    draw.text((12, 15), "MATH WORKSHEET", fill=0)
    draw.text((12, 45), "1.  8 + 3 =", fill=0)
    draw.text((12, 82), "2.  9 - 4 =", fill=0)
    draw.line([(115, 40), (121, 34), (122, 55)], fill=0, width=2)
    draw.line([(129, 35), (137, 35), (130, 55), (139, 55)], fill=0, width=2)
    draw.line([(20, 115), (230, 115)], fill=0, width=1)
    draw.ellipse((115, 76, 126, 95), outline=0, width=2)
    ink = (np.asarray(image) < 128).astype(np.float32)
    std = float(ink.std()) or 1.0
    normalized = (ink - ink.mean()) / std
    return np.repeat(normalized[None, None], 3, axis=1)


def sauvola_rgb(image: Image.Image) -> np.ndarray:
    rgb = np.asarray(image.convert("RGB"), dtype=np.float64) / 255
    gray = rgb @ np.array([0.2125, 0.7154, 0.0721])
    padded = np.pad(gray, 7, mode="reflect")
    def average(a):
        integral = np.pad(a, ((1, 0), (1, 0))).cumsum(axis=0).cumsum(axis=1)
        return (integral[15:, 15:] - integral[:-15, 15:] - integral[15:, :-15] + integral[:-15, :-15]) / 225
    mean, second = average(padded), average(padded * padded)
    std = np.sqrt(np.maximum(second - mean * mean, 0))
    # Original rgb2gray yields float; skimage float dtype limits are [-1, 1], so R=1.
    threshold = mean * (1 + 0.2 * (std - 1))
    return (gray < threshold).astype(np.float32)


def source_example_validation(session: ort.InferenceSession) -> dict:
    source = ROOT / "upstream-example.png"
    if not source.exists():
        return {"executed": False, "reason": "Optional source example not downloaded"}
    image = Image.open(source).convert("RGB")
    ink = sauvola_rgb(image)
    samples = {}
    for name, x, y in [("printed_region", 1000, 400), ("handwritten_region", 1000, 1000)]:
        tile = ink[y:y+256, x:x+256]
        z = (tile - tile.mean()) / (float(tile.std()) or 1)
        data = np.repeat(z[None, None], 3, axis=1)
        out = session.run(["probabilities"], {"image": data})[0][0]
        assert np.isfinite(out).all()
        foreground = tile > 0
        samples[name] = {"x": x, "y": y, "ink_pixels": int(foreground.sum()),
                         "mean_handwriting_probability_on_ink": float(out[1][foreground].mean()),
                         "class_counts_on_ink": np.bincount(out.argmax(axis=0)[foreground], minlength=3).tolist()}
    return {"executed": True, "file": "upstream-example.png", "source_sha256": digest(source),
            "size": list(image.size), "samples": samples,
            "limitation": "Author's public example; not independent Chinese exam evaluation"}


def test(layers: list[dict], weights: dict[str, np.ndarray]) -> dict:
    options = ort.SessionOptions()
    options.intra_op_num_threads = 2
    session = ort.InferenceSession(str(MODEL), options, providers=["CPUExecutionProvider"])
    x = synthetic_input()
    started = time.perf_counter()
    out = session.run(["probabilities"], {"image": x})[0]
    elapsed = time.perf_counter() - started
    assert out.shape == (1, 3, 256, 256)
    assert np.isfinite(out).all()
    assert float(out.min()) >= 0 and float(out.max()) <= 1.000001
    sum_error = float(np.max(np.abs(out.sum(axis=1) - 1)))
    assert sum_error < 1e-5
    other = session.run(["probabilities"], {"image": np.zeros_like(x)})[0]
    difference = float(np.max(np.abs(out - other)))
    assert difference > 1e-3, "Output is unexpectedly constant"
    # Compare independent full NumPy NHWC graph with exported ONNX CPU graph.
    ref = reference(x.transpose(0, 2, 3, 1), layers, weights)
    expected = ref[layers[-1]["name"]].transpose(0, 3, 1, 2)
    max_error = float(np.max(np.abs(expected - out)))
    mean_error = float(np.mean(np.abs(expected - out)))
    np.testing.assert_allclose(out, expected, rtol=2e-3, atol=3e-4)
    results = {"onnx_checker": True, "input_shape": list(x.shape), "output_shape": list(out.shape),
               "finite_probabilities": True, "softmax_sum_max_error": sum_error,
               "different_input_max_output_change": difference, "numpy_reference_max_error": max_error,
               "numpy_reference_mean_error": mean_error, "cpu_seconds": elapsed,
               "quality_benchmark": "No independent exam benchmark; synthetic and author's public example smoke tests only",
               "environment": {"numpy": np.__version__, "onnx": onnx.__version__, "onnxruntime": ort.__version__, "h5py": h5py.__version__}}
    results["source_example"] = source_example_validation(session)
    (ROOT / "conversion-validation.json").write_text(json.dumps(results, indent=2), encoding="utf-8")
    return results


def metadata(results: dict) -> None:
    info = {
      "id": "phti-fcnn-light-2", "name": "PHTI FCNN 筆跡分割（實驗模型）", "version": "2019-onnx-1",
      "file": "phti-fcnn.onnx", "bytes": MODEL.stat().st_size, "sha256": digest(MODEL), "license": "MIT",
      "licenseFile": "PHTI-LICENSE.txt", "sourceRepository": "https://github.com/Jumpst3r/printed-hw-segmentation",
      "sourceCommit": SOURCE_COMMIT, "sourceFile": "FCN/models/fcnn_bin.h5", "sourceSha256": SOURCE_SHA256,
      "input": {"name": "image", "type": "float32", "shape": [1, 3, 256, 256], "layout": "NCHW"},
      "output": {"name": "probabilities", "type": "float32", "shape": [1, 3, 256, 256], "layout": "NCHW",
                 "classes": ["printed", "handwritten", "background"], "handwritingChannel": 1, "printedChannel": 0},
      "preprocessing": {"grayscale": "sRGB luminance (original skimage rgb2gray)", "binarization": "Sauvola, ink = grayscale < local threshold",
                        "sauvolaWindow": 15, "sauvolaK": 0.2, "sauvolaR": 1.0,
                        "inkValue": 1, "paperValue": 0, "normalization": "per-tile population mean/std of binary ink image; std=0 uses 1",
                        "channels": "replicate normalized binary image into 3 identical channels",
                        "tileSize": 256, "suggestedOverlap": 10},
      "status": "experimental", "verified": {"conversion": True, "onnxCpu": True, "numpyReference": True, "browserWasm": False, "realExamQuality": False},
      "limitations": ["Trained on the author's private dataset; no verified Chinese children's exam benchmark", "Handwriting overlapping printed content cannot recover hidden original pixels", "Probability values are not calibrated quality guarantees", "Browser/mobile speed and quality require separate validation"],
      "conversionValidation": results,
    }
    (OUT / "metadata.json").write_text(json.dumps(info, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    layers, weights = convert()
    results = test(layers, weights)
    metadata(results)
    print(json.dumps({"model": str(MODEL), "bytes": MODEL.stat().st_size, "sha256": digest(MODEL), "validation": results}, ensure_ascii=False, indent=2))
