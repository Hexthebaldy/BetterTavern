# BetterTavern 标志 · 错版

这是 BetterTavern 的正式标志，名字叫“错版”。构成如下：

- 两个三角外框互相错开，像一次没对准的套印；
- 里面一层规整的三角框，位置不动；
- 中间一块实心的蓝色三角。

在线画布：第 06 节“Logo”的“定稿 · 错版”画板，需要 BetterTavern 作者的账号访问。
https://claude.ai/artifact/X9AHDCGAN7fs7mCHEUUvZc

## 目录

| 路径 | 内容 |
| --- | --- |
| `svg/logo.svg` | 标志，浅色底用：墨色线、蓝色内核，透明底，视窗紧贴标志 |
| `svg/logo-dark.svg` | 标志，深色底用：浅色线、浅蓝内核 |
| `svg/logo-mono.svg` | 单色版，颜色用 `currentColor` |
| `svg/logo-small.svg` | 线条加粗的版本，用在 36–55 像素 |
| `svg/app-icon.svg` | App 图标原稿：1024 白底，线条按主屏尺寸加粗 |
| `png/` | 标志位图、1024 的 App 图标、规范画板截图 `LogoSpec.png` |
| `source/LogoSpec.dc.html` | 规范画板的源码 |

App 用到的图标文件已经放在 `apps/mobile/assets/`，见下面的“App 里”一节。

## 构造（120 栅格）

| 部分 | 规格 |
| --- | --- |
| 栅格 | 120 × 120，所有三角形的重心都在 (60, 66) |
| 外框 | 两个边长 86 的正三角形，线宽 2.4 |
| 错开 | 两条外框沿右上方向（单位向量 0.768, −0.640）各偏 3.9，合计 7.8，是第一版的 2 倍 |
| 旋转 | 上面那条外框再绕重心顺时针转 3.5° |
| 内框 | 边长 56，线宽 2.6，不动 |
| 内核 | 边长 26，实心 |
| 尖角 | 直角斜接（miter），不做圆角 |

精确坐标以 `svg/logo.svg` 为准。`packages/design/src/logo.ts` 里的四条路径和它完全一致（手机端和网页端都从这里取）。

## 颜色

| 用途 | 线 | 内核 | 底 |
| --- | --- | --- | --- |
| 浅色 | 墨 `#1A1A1A` | 蓝 `#2F55F4` | 白 `#FFFFFF` |
| 深色 | `#F2F2F0` | `#8597FF` | `#111113` |
| 单色 | 一种颜色 | 同一种颜色 | 任意 |

App 里不写死颜色：线条用主题的 `ink`，内核用 `acc`，跟着浅色和夜间主题自动切换。

## 越小线越粗（光学尺寸）

小尺寸下两条外框容易糊成一条，所以线宽按显示尺寸放大：

| 图标边长 | 标志自身边长（App 内） | 线宽倍数 |
| --- | --- | --- |
| ≥ 100 | ≥ 72 | ×1 |
| 56–99 | 40–71 | ×1.35 |
| 36–55 | 26–39 | ×1.6 |
| 更小 | 更小 | ×2 |

App 图标原稿按主屏尺寸调过，用的是 ×1.35。`Logo` 组件会根据 `size` 自动选倍数。

## 留白、组合、最小尺寸

- **留白：** 标志四周至少留出内核边长那么宽的空白，也就是 26 个栅格单位。
- **和字标组合：** 字标是“BetterTavern”，系统字体、粗体。字标与标志并排，间距等于标志宽度的 30%，字标垂直居中。
- **最小尺寸：** 标志 16 像素，App 图标 20pt。

## App 里

已经接好的部分：

- **`apps/mobile/src/components/Logo.tsx`：** 换成了新标志，接口不变（`<Logo size={…} />`），几何在 `packages/design/src/logo.ts`。用到它的地方：
  - 恢复登录状态时的闪屏 `app/index.tsx`，56；
  - 登录页，48；
  - 宽屏登录的插画区，40；
  - 平板左侧导航栏，40。
- **`apps/mobile/app.config.ts`：**
  - 顶层 `icon`；
  - `ios.icon` 的浅色、深色、着色三套（iOS 18 起跟随系统外观）；
  - `android.adaptiveIcon`：前景、单色版和白色背景。
- **`apps/mobile/assets/`：**

  | 文件 | 用途 |
  | --- | --- |
  | `icon.png` | 1024，白底、不透明，iOS 浅色和 Android 旧版启动器用 |
  | `icon-dark.png` | 1024，透明底，iOS 深色图标，背景由系统画 |
  | `icon-tinted.png` | 1024，透明底、纯白，iOS 着色图标，系统按用户选的色调上色 |
  | `adaptive-icon.png` | 1024，透明底，Android 自适应图标的前景，标志缩在 66dp 安全区里 |
  | `adaptive-icon-monochrome.png` | Android 13+ 主题图标用的单色前景 |
  | `splash-icon.png`、`splash-icon-dark.png` | 启动图，已经备好，但还没接上，见下 |

还没做的部分：

- **启动图（splash）：** 项目里没有装 `expo-splash-screen`，所以原生启动图还是 Expo 的默认样式。要接上，步骤是：
  1. `npx expo install expo-splash-screen`；
  2. 在 `app.config.ts` 的 `plugins` 里加：
     ```ts
     ["expo-splash-screen", {
       image: "./assets/splash-icon.png",
       imageWidth: 120,
       backgroundColor: "#FFFFFF",
       dark: { image: "./assets/splash-icon-dark.png", backgroundColor: "#111113" },
     }]
     ```
- **生效时机：** 图标和启动图都要重新 prebuild 或打包后才会生效，Expo Go 里看不到。

## 不要这样用

- 不要旋转、翻转，也不要改错开的方向和角度。
- 不要给外框填色，不要把蓝色挪到线条上。
- 不要给标志加阴影、描边或渐变。
- 不要把标志直接放在照片或花纹背景上。需要时先垫一块纯色底。
