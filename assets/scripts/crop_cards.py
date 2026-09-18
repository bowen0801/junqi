# -*- coding: utf-8 -*-
"""
军旗纸牌切图脚本
从整版扫描图按 5x5 网格自动检测卡片边界并裁切 25 张卡面，
归一化为 300x540（白底居中），并生成牌背 card_back.png 与预览拼图 contact_sheet.png。
"""
import math
import os

from PIL import Image, ImageDraw, ImageFont

SRC = r"C:\Users\a\.workbuddy\clipboard-images\clipboard-2026-09-17T03-24-23-714Z-af11d4ef.png"
OUT_DIR = r"D:\githubSVN\junqi\assets\cards"
TARGET_W, TARGET_H = 300, 540

# 5x5 网格对应的卡名（行优先），side: r=红 b=蓝 n=中立
GRID = [
    [("r", "siling"), ("r", "junzhang"), ("r", "shizhang"), ("r", "lvzhang"), ("r", "tuanzhang")],
    [("r", "yingzhang"), ("r", "lianzhang"), ("r", "paizhang"), ("r", "banzhang"), ("r", "gongbing")],
    [("r", "dilei"), ("r", "zhadan"), ("n", "junqi"), ("b", "siling"), ("b", "junzhang")],
    [("b", "shizhang"), ("b", "lvzhang"), ("b", "tuanzhang"), ("b", "yingzhang"), ("b", "lianzhang")],
    [("b", "paizhang"), ("b", "banzhang"), ("b", "gongbing"), ("b", "dilei"), ("b", "zhadan")],
]

SIDE_NAME = {"r": "red", "b": "blue", "n": "flag"}


def filename_for(side, name):
    if side == "n":
        return "card_flag.png"
    return "card_%s_%s.png" % (SIDE_NAME[side], name)


def find_bands(profile, min_len, min_val):
    """返回一维投影中连续非零段 [(start,end),...]，段长 >= min_len 且段内峰值 >= min_val"""
    bands = []
    start = None
    for i, v in enumerate(profile):
        if v >= min_val:
            if start is None:
                start = i
        else:
            if start is not None:
                if i - start >= min_len:
                    bands.append((start, i))
                start = None
    if start is not None and len(profile) - start >= min_len:
        bands.append((start, len(profile)))
    return bands


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    img = Image.open(SRC).convert("RGB")
    W, H = img.size
    gray = img.convert("L")
    px = gray.load()

    # 行投影（非白像素计数），跳过标题区：先找所有行带，再取最高的 5 个长带
    row_prof = [sum(1 for x in range(W) if px[x, y] < 245) for y in range(H)]
    row_bands = find_bands(row_prof, min_len=int(H * 0.08), min_val=8)
    # 按带高排序取 5 个（标题带较矮会被过滤），再按 y 排序
    row_bands = sorted(sorted(row_bands, key=lambda b: b[1] - b[0], reverse=True)[:5], key=lambda b: b[0])
    if len(row_bands) != 5:
        raise SystemExit("row band detection failed: %s" % row_bands)

    crops = []  # (filename, cell_img)
    for ri, (y0, y1) in enumerate(row_bands):
        col_prof = [sum(1 for y in range(y0, y1) if px[x, y] < 245) for x in range(W)]
        col_bands = find_bands(col_prof, min_len=int(W * 0.05), min_val=8)
        col_bands = sorted(sorted(col_bands, key=lambda b: b[1] - b[0], reverse=True)[:5], key=lambda b: b[0])
        if len(col_bands) != 5:
            raise SystemExit("col band detection failed at row %d: %s" % (ri, col_bands))
        for ci, (x0, x1) in enumerate(col_bands):
            side, name = GRID[ri][ci]
            # 先粗裁，再在格子内做非白 bbox 精裁（去掉残余白边）
            cell = img.crop((x0, y0, x1, y1))
            bbox = cell.convert("L").point(lambda v: 0 if v < 245 else 255).getbbox()
            if bbox:
                cell = cell.crop(bbox)
            crops.append((filename_for(side, name), cell, ri, ci))

    # 归一化：等比缩放至 300x540 内，白底居中
    normalized = []
    for fn, cell, ri, ci in crops:
        w, h = cell.size
        scale = min(TARGET_W / w, TARGET_H / h)
        nw, nh = max(1, round(w * scale)), max(1, round(h * scale))
        cell2 = cell.resize((nw, nh), Image.LANCZOS)
        canvas = Image.new("RGB", (TARGET_W, TARGET_H), "white")
        canvas.paste(cell2, ((TARGET_W - nw) // 2, (TARGET_H - nh) // 2))
        path = os.path.join(OUT_DIR, fn)
        canvas.save(path)
        normalized.append((fn, path))
        print("saved %s  (src row %d col %d, raw %dx%d)" % (fn, ri, ci, w, h))

    # ---------- 牌背 ----------
    make_card_back(os.path.join(OUT_DIR, "card_back.png"))

    # ---------- 预览拼图（5 列 x 6 行：25 张卡 + 牌背） ----------
    sheet = Image.new("RGB", (TARGET_W * 5 + 60, TARGET_H * 6 + 140), "#2f3b2f")
    d = ImageDraw.Draw(sheet)
    for i, (fn, path) in enumerate(normalized):
        r, c = divmod(i, 5)
        sheet.paste(Image.open(path), (10 + c * (TARGET_W + 10), 50 + r * (TARGET_H + 10)))
    sheet.paste(Image.open(os.path.join(OUT_DIR, "card_back.png")), (10 + 2 * (TARGET_W + 10), 50 + 5 * (TARGET_H + 10)))
    d.text((12, 12), "junqi cards contact sheet (25 + back)", fill="white")
    sheet.save(os.path.join(OUT_DIR, "contact_sheet.png"))
    print("contact sheet saved.")


def make_card_back(path):
    W, H = TARGET_W, TARGET_H
    img = Image.new("RGB", (W, H), "#7a1f1f")
    d = ImageDraw.Draw(img)
    # 斜向织纹（深红）
    dark = "#6b1a1a"
    for i in range(-H, W + H, 18):
        d.line([(i, 0), (i + H, H)], fill=dark, width=3)
        d.line([(i + H, 0), (i, H)], fill=dark, width=3)
    # 双层金边
    d.rectangle([6, 6, W - 7, H - 7], outline="#d9a441", width=4)
    d.rectangle([16, 16, W - 17, H - 17], outline="#d9a441", width=2)
    # 中央五角星
    cx, cy, R, r = W // 2, H // 2 - 60, 70, 28
    pts = []
    for k in range(10):
        ang = -math.pi / 2 + k * math.pi / 5
        rad = R if k % 2 == 0 else r
        pts.append((cx + rad * math.cos(ang), cy + rad * math.sin(ang)))
    d.polygon(pts, fill="#e8b84b", outline="#f4d98a")
    # 星下圆环 + 军旗字样
    try:
        font = ImageFont.truetype(r"C:\Windows\Fonts\simhei.ttf", 64)
    except OSError:
        font = ImageFont.truetype(r"C:\Windows\Fonts\msyh.ttc", 64)
    text = "军旗"
    bbox = d.textbbox((0, 0), text, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    d.text(((W - tw) // 2, cy + R + 60), text, font=font, fill="#f2d98d")
    d.ellipse([cx - 90, cy + R + 40, cx + 90, cy + R + 40 + th + 40], outline="#d9a441", width=3)
    img.save(path)
    print("card back saved.")


if __name__ == "__main__":
    main()
