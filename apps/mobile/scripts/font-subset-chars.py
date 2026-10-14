"""
生成叙述字体子集的字符表：ASCII 可打印字符、GB2312 全部字符和常用标点。

用法（在仓库外的临时目录里操作，完整字体约 15 MB，不进仓库）：
    python3 scripts/font-subset-chars.py chars.txt
    uvx --from fonttools pyftsubset NotoSerifSC_400Regular.ttf --text-file=chars.txt \
        --layout-features='kern,vert,vrt2,locl,palt,halt' --no-hinting \
        --output-file=assets/fonts/NotoSerifSC-Regular.ttf
完整字体来自 npm 包 @expo-google-fonts/noto-serif-sc（400Regular）。
"""

import sys
out = []
# ASCII 可打印字符
out.extend(chr(c) for c in range(0x20, 0x7F))
# GB2312 全部区位（符号区 + 一二级汉字）
for hi in range(0xA1, 0xF8):
    for lo in range(0xA1, 0xFF):
        try:
            out.append(bytes([hi, lo]).decode("gb2312"))
        except UnicodeDecodeError:
            pass
# 常用标点区段
for lo_, hi_ in [(0x2000, 0x206F), (0x3000, 0x303F), (0xFF00, 0xFFEF), (0x2E80, 0x2E99)]:
    out.extend(chr(c) for c in range(lo_, hi_ + 1))
chars = "".join(dict.fromkeys(out))
with open(sys.argv[1], "w", encoding="utf-8") as f:
    f.write(chars)
print(len(chars))
