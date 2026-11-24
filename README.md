# 菲涅尔灯塔数字展 · WebGPU + TypeScript

海事博物馆灯塔数字展项。按菲涅尔透镜的面板、焦距、有限光源直径和转速计算闪光周期、闪光时长与光束发散角；用 Allard 定律反解灯光射程；海雾体积光和透镜剖面光路均由原生 WebGPU/WGSL 绘制。

## 运行

```bash
npm install
npm run dev
```

打开 Vite 输出的本地地址（通常是 <http://localhost:5173>）。推荐最新版 Chrome / Edge，并确认 `chrome://gpu` 中 WebGPU 可用。

生产构建：

```bash
npm run build
npm run preview
```

物理一致性自检：

```bash
npm run verify
```

该脚本会扫描 424 组面板数、焦距、光源直径和转速组合，检查：

- 采样光束半高宽 vs `θ = 2atan(d / 2f)`，误差 ≤ 5%
- 时间域采样闪光周期/时长 vs 公式，误差 ≤ 5%
- 每转闪光数 = 面板数
- Allard 射程代回照度公式等于阈值 `2×10⁻⁷ lx`，误差 ≤ 5%
- SI 形式与 `E = I·Tᴿ / (1852²R²)` 海里形式一致

浏览器 WebGPU 烟测（需要本机安装 Chrome，并先启动 preview）：

```bash
npm run preview -- --port 4321 --strictPort
SMOKE_URL=http://127.0.0.1:4321/ npm run smoke
```

## 四个页面

1. **灯塔外景**：灯塔、海面、星空、旋转面板光束和海雾米氏体积光；可实时调节面板数、焦距、光源直径、转速、能见度和光强。
2. **透镜剖面**：垂直剖面展示中央菲涅尔折射环、上下 TIR 全反射棱镜、运动光子；右上角为 N 面板俯视插图，光束角宽与物理模型相同。
3. **光路讲解**：Snell 折射、TIR 临界角实验、WGSL `reflect()` 生成的反射方向，以及五步光路说明。
4. **观察点设置**：极坐标海图/拖拽设观察点，船的距离、方位、眼高、望远镜视场和时间倍率；船视角、闪光包络图、Allard 照度和真 4K 性能压测。

## 关键公式

### 光束发散角

有限尺寸光源位于焦点附近：

```text
θ = 2 · atan(d / 2f)
```

WGSL 中圆锥半角使用同一个 `θ/2`，俯视插图和船视角均使用该 uniform。

### 闪光周期与时长

N 块面板均布，转速为 `n rpm`：

```text
T旋转 = 60 / n
T闪光周期 = T旋转 / N = 60 / (Nn)
ω = 2πn / 60
T闪光时长(FWHM) = θ / ω
```

界面中的 `beamResponse` 与 WGSL 边缘包络都以 `|δ| = θ/2` 为半高点，因此画面采样出的 FWHM 等于公式发散角。

### Allard 定律与能见度

Koschmieder 消光系数：

```text
σ = 2.996 / V
```

SI 形式：

```text
E(D) = I · exp(-σD) / D²
```

海里/透射率形式：

```text
T_nm = exp(-σ · 1852)
E(R_nm) = I · T_nmᴿ / (1852² · R_nm²)
```

程序用二分/指数扩展数值反解 `E(R) = 2×10⁻⁷ lx`，并另算标准大气折射下的地理视距 `4.12(√h灯 + √h眼) km`。

## 雾中体积光与性能

着色器没有在 4K 上做长距离逐像素 ray marching，而是对每块面板的光束圆锥建立二次不等式：

```text
|q|² - (k a + r₀)² ≤ 0
```

直接求相机射线与圆锥的区间，再对 Cornette–Shanks/Mie 近似相位函数和光源/相机两段指数衰减做解析积分：

```text
∫ exp(-σa) exp(-σt) dt
```

因此每像素成本主要来自面板数，不随光线步进数或屏幕距离增长。雾越浓：

- `σ` 越大，Allard 射程和体积光可见长度越短；
- 多次散射光晕半角越大，光束视觉上越粗；
- 核心圆锥仍严格保持焦距决定的发散角，光晕单独标注为 Mie 增宽。

观察点页的 **“运行真 3840×2160 / 180 帧测试”** 会临时把 canvas backing store 强制设为真 4K。开发机 AMD Radeon 780M + 硬件加速 Chrome 的一次实测约为 **67.6 FPS / 14.8 ms 每帧**；该数字会随 GPU、驱动和浏览器变化。默认自适应模式还会根据帧时间在约 0.45–0.95 DPR 间调整 backing resolution。

## 虚构灯质数据

四座灯塔、海区和灯质均为教学虚构：

| 灯塔 | 面板 N | f | 转速 | 特征 |
|---|---:|---:|---:|---|
| 七星礁 | 12 | 1.35 m | 1.00 rpm | Fl W 5s |
| 岚屿 | 8 | 0.92 m | 1.25 rpm | Fl W 6s |
| 白矶门 | 6 | 0.70 m | 2.00 rpm | Fl W 5s |
| 南碇角 | 4 | 0.55 m | 2.00 rpm | Fl W 7.5s |

## 目录

```text
src/physics.ts          共享光学/闪光/Allard 模型与虚构灯塔
src/selfcheck.ts        ≤5% 数值与采样一致性检查
src/state.ts            全局状态
src/webgpu/device.ts    WebGPU adapter/device
src/webgpu/shaders.ts   WGSL：外景、船视角、剖面、光路、Mie 圆锥积分
src/webgpu/renderer.ts  管线、uniform、自适应分辨率、4K benchmark
src/pages/              四个页面
scripts/verify-physics.ts  Node 全参数扫描
scripts/browser-smoke.mjs  Chrome/WebGPU 截图与控制台烟测
```

## 无 WebGPU 环境

界面会显示明确的浏览器/驱动提示和 WebGPU 不可用标记。物理面板、公式、自检和极坐标设置仍可使用；三维/透镜 GPU 画面需要支持 WebGPU 的浏览器。
