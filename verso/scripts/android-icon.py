"""把安卓自适应图标的前景图缩进「安全区」。

## 为什么需要这一步

`tauri icon` 生成的 `ic_launcher_foreground.png` 是**满幅的整张图标**。而安卓的
自适应图标只保证 108dp 画布中间的 72dp 可见 —— 等于把前景放大 1.5 倍再按
启动器的形状裁一刀。满幅图进去的结果就是：自己的圆角被切掉、图案显得特别大、
角上的元素只剩一点点。

所以前景要**先缩到 72/108 ≈ 66.7% 再居中**，四周留透明。背景层给一块纯色，
取图标自身的底色 —— 两者同色时，缩小后那张图的方形边缘看不出来，视觉上就是
一整块底色上放着图案。

## 什么时候要重跑

**每次跑完 `tauri icon` 都要重跑一遍**，因为那条命令会把这里的成果覆盖回
满幅版本。用法：

    python scripts/android-icon.py
"""

import pathlib
import re
import sys

from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
ICONS = ROOT / "src-tauri" / "icons" / "android"

# 安卓自适应图标：108dp 画布，中间 72dp 是保证可见的安全区
SAFE = 72 / 108


def main() -> int:
    dirs = sorted(ICONS.glob("mipmap-*dpi"))
    if not dirs:
        print(f"找不到 {ICONS}，先跑一次 `tauri icon`", file=sys.stderr)
        return 1

    color = None
    for d in dirs:
        src = d / "ic_launcher_foreground.png"
        if not src.exists():
            continue
        img = Image.open(src).convert("RGBA")
        w, h = img.size

        # **按图案自己的包围盒缩，不是按画布缩。**
        #
        # 图标四周本来就有一圈透明（圆角 + 投影）。照画布比例缩的话，图案会比
        # 安全区再小一圈 —— 结果是「启动器的方块里套着一个更小的圆角方块，
        # 中间夹一圈底色」，比不缩还难看。
        #
        # 按包围盒缩，图案的边正好落在遮罩边上，被启动器的形状裁掉，接缝就
        # 不存在了。
        box = img.getbbox()
        if not box:
            continue
        bw = box[2] - box[0]
        target = w * SAFE
        if abs(bw - target) <= 2:
            print(f"跳过（已经是安全区大小）：{src.relative_to(ROOT)}")
            continue

        # 底色取图案里出现最多的那个不透明颜色 —— 定点采样会踩到高光或阴影
        if color is None:
            counts = {}
            for px in list(img.crop(box).convert("RGB").resize((64, 64)).getdata()):
                counts[px] = counts.get(px, 0) + 1
            color = max(counts, key=counts.get)

        scale = target / bw
        small = img.resize((round(w * scale), round(h * scale)), Image.LANCZOS)
        out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        out.paste(small, ((w - small.size[0]) // 2, (h - small.size[1]) // 2), small)
        out.save(src)
        print(f"{src.relative_to(ROOT)}：图案 {bw}px → {round(target)}px（画布 {w}px）")

    if color:
        hexcolor = "#{:02x}{:02x}{:02x}".format(*color)
        bg = ICONS / "values" / "ic_launcher_background.xml"
        text = bg.read_text(encoding="utf-8")
        bg.write_text(
            re.sub(r'(name="ic_launcher_background">)[^<]*', rf"\g<1>{hexcolor}", text),
            encoding="utf-8",
        )
        print(f"背景色 → {hexcolor}（取自图标自身的底色）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
