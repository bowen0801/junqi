# -*- coding: utf-8 -*-
"""清理头像右下角水印并输出上传用副本。"""
import glob
import os
from PIL import Image, ImageFilter

SRC = sorted(glob.glob(r"D:\githubSVN\junqi\assets\brand\微信小程序头像图标*.png"))[-1]
OUT_DIR = r"D:\githubSVN\junqi\assets\brand"

img = Image.open(SRC).convert("RGB")
w, h = img.size

# 水印区域：右下角约 30% 宽、12% 高
patch_w, patch_h = int(w * 0.32), int(h * 0.13)
# 从左下角取同样大小、左右镜像的补丁（织纹背景相似）
donor = img.crop((0, h - patch_h, patch_w, h)).transpose(Image.FLIP_LEFT_RIGHT)
# 轻微模糊边缘以融合，直接粘贴先简单处理：多取一点区域并羽化
donor = donor.filter(ImageFilter.GaussianBlur(0.6))
img.paste(donor, (w - patch_w, h - patch_h))

# 输出：原图尺寸 PNG + 微信头像常用 144x144
clean_path = os.path.join(OUT_DIR, "avatar_clean.png")
img.save(clean_path)
small = img.resize((288, 288), Image.LANCZOS)
small_path = os.path.join(OUT_DIR, "avatar_288.png")
small.save(small_path)

for p in (clean_path, small_path):
    print(p, os.path.getsize(p) // 1024, "KB")
