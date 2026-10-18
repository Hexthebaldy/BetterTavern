"""
生成叙述字体子集的字符表。中文、日文各一份字体，字符集分开（docs/i18n.md 第 3 节“字体”）：

- gb2312（默认，思源宋体简体中文版）：ASCII 可打印字符、GB2312 全部字符和常用标点。
- jis（思源宋体日文版）：ASCII 可打印字符、JIS X 0208 全部字符（假名、符号、第一和第二水准汉字）、
  2010 年版常用汉字表里不在 JIS X 0208 中的 4 个字、完整的平假名和片假名区段、常用标点。

用法（在仓库外的临时目录里操作，完整字体不进仓库）：
    python3 scripts/font-subset-chars.py chars.txt                 # 中文
    python3 scripts/font-subset-chars.py --set jis chars-ja.txt    # 日文
    uvx --from fonttools pyftsubset NotoSerifSC_400Regular.ttf --text-file=chars.txt \
        --layout-features='kern,vert,vrt2,locl,palt,halt' --no-hinting \
        --output-file=assets/fonts/NotoSerifSC-Regular.ttf
    （日文把字体换成 NotoSerifJP_400Regular.ttf、字符表换成 chars-ja.txt，
      输出 assets/fonts/NotoSerifJP-Regular.ttf）
完整字体来自 npm 包 @expo-google-fonts/noto-serif-sc、@expo-google-fonts/noto-serif-jp（400Regular）。
"""

import argparse

# 常用标点区段：通用标点、中日文标点、全角和半角形式、部首补充
PUNCTUATION = [(0x2000, 0x206F), (0x3000, 0x303F), (0xFF00, 0xFFEF), (0x2E80, 0x2E99)]
# 2010 年版常用汉字表新增、JIS X 0208 里只有另一种写法的字（JIS 里是 叱 填 剥 頬）
JOYO_OUTSIDE_JIS = "𠮟塡剝頰"


def double_byte(codec: str) -> list[str]:
    """按区位遍历一种双字节编码，取出全部字符（GB2312 和 JIS X 0208 都在 A1–FE 区间）。"""
    out = []
    for hi in range(0xA1, 0xFF):
        for lo in range(0xA1, 0xFF):
            try:
                out.append(bytes([hi, lo]).decode(codec))
            except UnicodeDecodeError:
                pass
    return out


def chars_for(charset: str) -> str:
    out = [chr(c) for c in range(0x20, 0x7F)]
    ranges = list(PUNCTUATION)
    if charset == "jis":
        out.extend(double_byte("euc_jp"))
        out.extend(JOYO_OUTSIDE_JIS)
        ranges.append((0x3040, 0x30FF))  # 平假名、片假名的整个区段（含 ゔ、ヷ 这类少见的）
    else:
        out.extend(double_byte("gb2312"))
    for lo, hi in ranges:
        out.extend(chr(c) for c in range(lo, hi + 1))
    return "".join(dict.fromkeys(out))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--set", choices=("gb2312", "jis"), default="gb2312")
    parser.add_argument("output")
    args = parser.parse_args()
    chars = chars_for(args.set)
    with open(args.output, "w", encoding="utf-8") as f:
        f.write(chars)
    print(len(chars))


if __name__ == "__main__":
    main()
