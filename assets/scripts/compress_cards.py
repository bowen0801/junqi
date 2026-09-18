# -*- coding: utf-8 -*-
"""压缩小程序包内卡图：300x540 PNG -> 150x270 JPG(q85)，移除包内未引用的大图"""
import os
import glob
from PIL import Image

SRC = r"D:\githubSVN\junqi\miniprogram\assets\cards"

def dir_size_kb(p):
    return sum(os.path.getsize(f) for f in glob.glob(os.path.join(p, "*")) if os.path.isfile(f)) / 1024.0

before = dir_size_kb(SRC)

# 1) 卡图转 JPG
for p in sorted(glob.glob(os.path.join(SRC, "card_*.png"))):
    im = Image.open(p).convert("RGB")
    im = im.resize((150, 270), Image.LANCZOS)
    out = os.path.splitext(p)[0] + ".jpg"
    im.save(out, "JPEG", quality=85, optimize=True)
    os.remove(p)

# 2) 移除包内未引用的大图（牌背为 CSS 绘制；预览拼图仅开发用）
for f in ("contact_sheet.png", "card_back.png"):
    fp = os.path.join(SRC, f)
    if os.path.exists(fp):
        os.remove(fp)

after = dir_size_kb(SRC)
print("cards dir: %.0f KB -> %.0f KB" % (before, after))
print("files:", sorted(os.path.basename(f) for f in glob.glob(os.path.join(SRC, "*"))))
