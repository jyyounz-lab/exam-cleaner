"""Generate deterministic, synthetic worksheet/reference pairs for repair QA.

Uses Pillow/NumPy and local system fonts. No exam photos, external datasets, or
font files are redistributed. Ground-truth layers are saved independently so
tests can measure residual ink and damage to printed content separately.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "tests" / "fixtures"
WIDTH, HEIGHT, SCALE = 900, 1240, 3


def local_font(candidates: list[str], size: int) -> ImageFont.FreeTypeFont:
    for candidate in candidates:
        path = Path(candidate)
        if path.exists():
            return ImageFont.truetype(str(path), size * SCALE)
    raise FileNotFoundError("A local CJK/Latin system font is required for QA fixtures")


CJK = ["C:/Windows/Fonts/mingliu.ttc", "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"]
LATIN = ["C:/Windows/Fonts/arial.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"]


def line(draw: ImageDraw.ImageDraw, points: list[tuple[float, float]], fill, width: float = 2) -> None:
    draw.line([(round(x * SCALE), round(y * SCALE)) for x, y in points], fill=fill, width=max(1, round(width * SCALE)), joint="curve")


def text(draw: ImageDraw.ImageDraw, at: tuple[int, int], value: str, size: int, fill=(30, 34, 31, 255), cjk=True) -> None:
    draw.text((at[0] * SCALE, at[1] * SCALE), value, font=local_font(CJK if cjk else LATIN, size), fill=fill)


def paper(gradient: bool) -> Image.Image:
    yy, xx = np.mgrid[0:HEIGHT, 0:WIDTH]
    if gradient:
        # Warm paper, a left-edge shadow and gentle illumination slope.
        shadow = 17 * np.exp(-xx / 135) + 6 * yy / HEIGHT
        base = np.stack([253 - shadow, 251 - shadow, 244 - shadow * 0.92], axis=2)
    else:
        base = np.broadcast_to(np.array([255, 254, 250]), (HEIGHT, WIDTH, 3))
    return Image.fromarray(np.rint(base).clip(0, 255).astype(np.uint8), "RGB")


def printed_layer() -> Image.Image:
    layer = Image.new("RGBA", (WIDTH * SCALE, HEIGHT * SCALE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    text(draw, (70, 55), "數學小練習・第三單元", 33)
    text(draw, (70, 115), "姓名：____________　日期：____________", 17)
    line(draw, [(70, 158), (830, 158)], (55, 61, 53, 255), 1.4)
    text(draw, (70, 195), "一、計算答案，保留題目與符號。", 23)

    rows = [
        ("1.   24 + 18 =", 308),
        ("2.   56 − 29 =", 498),
        ("3.   81 ÷ 9 =", 688),
        ("4.   7 × 8 =", 878),
    ]
    for expression, baseline in rows:
        text(draw, (90, baseline - 30), expression, 25, cjk=False)
        line(draw, [(320, baseline + 6), (530, baseline + 6)], (48, 52, 46, 255), 1.5)
        text(draw, (580, baseline - 20), "答案區", 14, (82, 88, 78, 255))

    text(draw, (70, 1005), "二、圖表與印刷內容保護測試", 22)
    for x in [90, 330, 570, 810]:
        line(draw, [(x, 1060), (x, 1160)], (55, 60, 52, 255), 1.4)
    for y in [1060, 1110, 1160]:
        line(draw, [(90, y), (810, y)], (55, 60, 52, 255), 1.4)
    text(draw, (115, 1073), "印刷中文", 18)
    text(draw, (355, 1073), "負號", 18)
    text(draw, (403, 1073), "−", 18, cjk=False)
    text(draw, (429, 1073), "分數", 18)
    text(draw, (477, 1073), "½", 18, cjk=False)
    text(draw, (595, 1073), "7 × 8 = 56", 18, cjk=False)
    text(draw, (70, 1195), "合成測試素材・由程式產生・非真實兒童考卷", 12, (110, 116, 105, 255))
    return layer.resize((WIDTH, HEIGHT), Image.Resampling.LANCZOS)


def handwritten_layer() -> tuple[Image.Image, list[dict]]:
    layer = Image.new("RGBA", (WIDTH * SCALE, HEIGHT * SCALE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    regions: list[dict] = []

    def digit_42(x: int, y: int, color, width=3):
        # Hand-authored polylines, not a handwritten-font training sample.
        line(draw, [(x + 24, y), (x + 2, y + 31), (x + 36, y + 28)], color, width)
        line(draw, [(x + 26, y + 2), (x + 24, y + 48)], color, width)
        line(draw, [(x + 46, y + 9), (x + 51, y + 1), (x + 64, y - 1), (x + 73, y + 6), (x + 73, y + 15), (x + 45, y + 47), (x + 79, y + 43)], color, width)

    digit_42(365, 255, (28, 74, 170, 245), 3.4)
    regions.append({"name": "blue_pen", "kind": "blue", "roi": [355, 245, 452, 309]})

    # A thin, faint blue word has anti-aliased pixels well below a strong-color threshold.
    digit_42(367, 445, (78, 121, 190, 125), 2.4)
    regions.append({"name": "faint_blue_pen", "kind": "faint_blue", "roi": [357, 435, 454, 499]})

    # Pencil lies immediately above, and one descender overlaps, the answer rule.
    line(draw, [(392, 644), (380, 636), (367, 641), (363, 654), (372, 663), (387, 659), (394, 646), (392, 676), (382, 698)], (72, 72, 72, 178), 2.8)
    regions.append({"name": "gray_pencil", "kind": "pencil", "roi": [353, 626, 405, 703]})

    # Red answer plus a teacher's check beside it.
    line(draw, [(368, 823), (395, 819), (382, 841), (388, 858), (373, 868), (360, 863)], (177, 42, 38, 235), 3)
    line(draw, [(415, 820), (401, 825), (399, 838), (415, 844), (424, 833), (417, 822), (404, 847), (402, 862), (417, 869), (429, 859), (423, 847), (407, 844)], (177, 42, 38, 235), 3)
    regions.append({"name": "red_pen", "kind": "red", "roi": [350, 809, 440, 880]})
    line(draw, [(672, 276), (690, 295), (730, 246)], (186, 49, 40, 235), 4.2)
    regions.append({"name": "red_check", "kind": "red", "roi": [660, 234, 742, 307]})

    return layer.resize((WIDTH, HEIGHT), Image.Resampling.LANCZOS), regions


def make_fixture(name: str, gradient: bool) -> dict:
    background = paper(gradient)
    printed = printed_layer()
    ink, regions = handwritten_layer()
    clean = Image.alpha_composite(background.convert("RGBA"), printed).convert("RGB")
    marked = Image.alpha_composite(clean.convert("RGBA"), ink).convert("RGB")
    paths = {
        "clean": f"tests/fixtures/{name}-clean.png",
        "marked": f"tests/fixtures/{name}-marked.png",
        "inkMask": f"tests/fixtures/{name}-ink-mask.png",
        "printMask": f"tests/fixtures/{name}-print-mask.png",
        "paper": f"tests/fixtures/{name}-paper.png",
    }
    clean.save(ROOT / paths["clean"])
    marked.save(ROOT / paths["marked"])
    ink.getchannel("A").save(ROOT / paths["inkMask"])
    printed.getchannel("A").save(ROOT / paths["printMask"])
    background.save(ROOT / paths["paper"])

    ia = np.asarray(ink.getchannel("A"))
    pa = np.asarray(printed.getchannel("A"))
    changed = np.any(np.asarray(marked) != np.asarray(clean), axis=2)
    assert np.all(~changed | (ia > 0)), "All modifications must be represented in the ink layer"
    assert np.sum(changed) > 2500
    assert np.sum(pa > 16) > 10000
    return {
        "id": name,
        **paths,
        "gradient": gradient,
        "size": [WIDTH, HEIGHT],
        "regions": regions,
        "printedProtectedRois": [
            {"name": "chinese_title", "roi": [65, 45, 600, 100]},
            {"name": "instruction", "roi": [65, 185, 670, 230]},
            {"name": "math_operators", "roi": [82, 265, 305, 915]},
            {"name": "table_and_chinese", "roi": [80, 1050, 820, 1170]},
        ],
        "groundTruth": {
            "inkAlphaPixels": int(np.sum(ia > 0)),
            "visibleInkPixels": int(np.sum(changed)),
            "printedAlphaPixels": int(np.sum(pa > 0)),
            "inkPrintOverlapPixels": int(np.sum((ia > 8) & (pa > 8))),
        },
    }


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    fixtures = [make_fixture("flat", False), make_fixture("shadow", True)]
    metadata = {
        "schema": 1,
        "synthetic": True,
        "description": "Independent clean reference, marked input, alpha ink mask, printed alpha mask and paper-only background. No real children or external exam materials.",
        "coordinates": "Source-image pixels; roi=[left, top, right, bottom], right/bottom exclusive.",
        "maskSemantics": "PNG grayscale alpha 0..255. Very low alpha captures anti-aliased fringes; quality tests should state an alpha floor. Ink overlapping print is recorded separately and cannot be assumed recoverable from marked input.",
        "seed": "Deterministic vector paths; no random generation",
        "fixtures": fixtures,
    }
    (OUT / "quality-fixtures.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"generated": len(fixtures), "directory": str(OUT), "fixtures": fixtures}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
