# 节点属性参考

---

## dumpTree 输出属性说明

| 属性 | 含义 |
|------|------|
| `w` / `h` | 宽高（px） |
| `x` / `y` | 在画布中的绝对坐标 |
| `rotation` | 旋转角度（仅非 0 时输出） |
| `text` | 文字内容（TEXT 节点） |
| `fills` | 填充色数组，`color.r/g/b/a` 为 0-1 范围，需转换为 `#HEX` |
| `padding` | 内边距 `{l, r, t, b}`（px），对应 CSS `padding` |
| `gap` | 主轴子元素间距 `itemSpacing`（px），对应 CSS `gap` |
| `crossGap` | 交叉轴间距 `counterAxisSpacing`（px），换行布局时生效 |
| `layout` | 自动布局方向（`HORIZONTAL` / `VERTICAL`） |
| `layoutWrap` | 是否换行（`WRAP` / `NO_WRAP`） |
| `mainAlign` | 主轴对齐 `primaryAxisAlignItems`（`MIN`/`CENTER`/`MAX`/`SPACE_BETWEEN`） |
| `crossAlign` | 交叉轴对齐 `counterAxisAlignItems`（`MIN`/`CENTER`/`MAX`/`BASELINE`） |
| `sizingH` / `sizingV` | 水平/垂直尺寸模式（`FIXED`/`HUG`/`FILL`） |
| `grow` | flex grow，`layoutGrow=1` 时输出 |
| `minW` / `maxW` / `minH` / `maxH` | 最小/最大宽高约束（仅非 0 时输出） |
| `radius` | 圆角值（px）；四角相同时为数字，不同时为 `{tl,tr,bl,br}` |
| `strokeWeight` | 描边粗细（px），有描边时才输出 |
| `strokeAlign` | 描边位置（`INSIDE`/`OUTSIDE`/`CENTER`） |
| `strokes` | 描边颜色数组，格式同 `fills` |
| `constraints` | 约束方式 `{horizontal, vertical}`，值为 `START`/`END`/`CENTER`/`SCALE`/`STRETCH` |
| `blendMode` | 混合模式（仅非 NORMAL/PASS_THROUGH 时输出） |
| `clipsContent` | 是否裁剪子内容（Frame 的溢出隐藏） |
| `isMask` | 是否为蒙版 |
| `fontSize` | 字号（px） |
| `fontWeight` | 字重 |
| `fontFamily` | 字体族名称 |
| `lineHeight` | 行高 |
| `letterSpacing` | 字间距（仅非 0 时输出） |
| `textAlign` | 水平对齐（`LEFT`/`CENTER`/`RIGHT`/`JUSTIFIED`） |
| `textDecoration` | 文字装饰（`UNDERLINE`/`STRIKETHROUGH`，仅非 NONE 时输出） |
| `textCase` | 大小写转换（仅非 ORIGINAL 时输出） |
| `opacity` | 透明度（仅非 1 时输出） |
| `effects` | 阴影/模糊等效果数组 |

> **隐藏节点**：`isVisible === false` 的节点会被跳过（连同其所有子节点）。如需提取隐藏节点，删除 dumpTree 脚本中 `if(node.isVisible===false)return null;` 这一行即可。

> **字体属性缺失**：`fontSize`、`fontWeight` 等属性在 INSTANCE/FRAME 节点上不存在，需深入到 TEXT 子节点才能获取。

---

## 颜色值转换

MasterGo 节点中 `fills[].color` 的 r/g/b/a 均为 0-1 浮点数：

```javascript
function toHex(c) {
  return '#' + [c.r, c.g, c.b].map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
}
// {r:0.067, g:0.067, b:0.067} → #111111
// {r:1, g:1, b:1}             → #ffffff
// 带透明度：rgba(Math.round(r*255), Math.round(g*255), Math.round(b*255), a)
```

---

## 节点类型

| type | 说明 |
|------|------|
| `PAGE` | 页面 |
| `FRAME` | 画框（相当于容器/区块） |
| `GROUP` | 组 |
| `TEXT` | 文字节点，`characters` 属性为文字内容，含 `fontSize`/`fontWeight`/`lineHeight` |
| `COMPONENT` | 组件定义 |
| `COMPONENT_SET` | 组件集（包含多个变体的组件，子节点为 COMPONENT） |
| `INSTANCE` | 组件实例，子节点 id 格式为 `instanceId/originalId` |
| `PEN` | 矢量路径（图标的实际形状） |
| `RECTANGLE` | 矩形 |
| `ELLIPSE` | 椭圆/圆形 |
| `BOOLEAN_OPERATION` | 布尔运算（联集/减去/相交/排除） |

---

## 文字过滤模板

提取时排除常见无意义占位文字（**注意：不要过滤规格标注**）：

```javascript
var t = node.characters.trim();
// 只过滤纯占位词，不过滤规格数值（96px、30号、中黑体、二级分割线色 等都应保留）
var skip = /^(选项|文字|标题|副标题|内容|按钮|图标|标签|推荐|不推荐|暂无|待补充|image|同上)$/.test(t);
if (!skip && t.length > 0) { /* 保留 */ }
```

**常见误杀场景**：`\d+px`、`\d+号`、`中黑体`、`常规体` 这类正则会把设计规范中的规格标注（如 `96px`、`30号 中黑体`、`二级分割线色`）一并过滤掉，导致关键数值丢失。应避免用这类正则过滤。
