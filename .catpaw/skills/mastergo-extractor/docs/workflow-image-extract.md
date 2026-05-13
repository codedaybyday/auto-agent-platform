# 图片节点提取模式

当用户想获取设计稿中的图片资源（而非文字规范）时走此流程。

MasterGo 的图片节点在 `fills` 数组中以 `type === "IMAGE"` 标识，**关键字段是 `imageRef`**（不是 `imageHash`，后者可能为 null）。`imageRef` 是图片在 MasterGo 存储中的路径，可通过 `exportAsync` 将图片数据导出为 PNG 文件。

---

## 触发场景

- 用户说"我想看图片"、"能拿到图片链接吗"、"帮我下载设计稿里的图片"
- 用户想批量导出某个节点或整页的所有图片资源
- 用户想获取一个**内网可用的图片 URL**（用于文档引用、代码嵌入等）

---

## 工作流

### 第一步：扫描图片节点

用 `imageRef` 字段（而非 `imageHash`）扫描目标节点下所有图片 fill：

```bash
~/.catpaw/bin/catdesk browser-action '{"action":"evaluate","script":"(function(){var root=window.mg.getNodeById(\"LAYER_ID\");if(!root)return \"node not found\";var results=[];function scan(node){if(node.isVisible===false)return;if(node.fills&&node.fills.length>0){node.fills.forEach(function(f){if(f.type===\"IMAGE\"&&f.imageRef){results.push({id:node.id,name:node.name,type:node.type,w:node.width,h:node.height,imageRef:f.imageRef,scaleMode:f.scaleMode});}});}if(node.children)node.children.forEach(scan);}scan(root);return JSON.stringify(results);})()"}'
```

> ⚠️ **必须用 `imageRef` 而非 `imageHash`**：`imageHash` 在分享只读模式下可能为 `null`，`imageRef` 才是实际可用的图片路径标识。

输出示例：
```json
[
  {
    "id": "259:36956",
    "name": "图片",
    "type": "RECTANGLE",
    "w": 718,
    "h": 318,
    "imageRef": "64361742742805/92818808244083/57c7381a861808391d3942df3df6ffde.png",
    "scaleMode": "FILL"
  }
]
```

若扫描整页（无 layer_id），将 `getNodeById("LAYER_ID")` 替换为遍历当前页面：

```bash
~/.catpaw/bin/catdesk browser-action '{"action":"evaluate","script":"(function(){var page=window.mg.document.children.find(function(p){return p.id===\"PAGE_ID\";});if(!page)return \"page not found\";var results=[];function scan(node){if(node.isVisible===false)return;if(node.fills&&node.fills.length>0){node.fills.forEach(function(f){if(f.type===\"IMAGE\"&&f.imageRef){results.push({id:node.id,name:node.name,type:node.type,w:node.width,h:node.height,imageRef:f.imageRef});}});}if(node.children)node.children.forEach(scan);}scan(page);return JSON.stringify(results);})()"}'
```

---

### 第二步：用 exportAsync 导出图片

`imageRef` 本身不是可直接访问的公开 URL（需要鉴权），**正确做法是用 `exportAsync` 将节点渲染为 PNG 并下载**：

```bash
# 将 NODE_ID 替换为实际节点 id，FILENAME 替换为文件名
~/.catpaw/bin/catdesk browser-action '{"action":"evaluate","script":"(function(){window.mg.getNodeById(\"NODE_ID\").exportAsync({format:\"PNG\",constraint:{type:\"SCALE\",value:2}}).then(function(bytes){var blob=new Blob([bytes],{type:\"image/png\"});var url=URL.createObjectURL(blob);var a=document.createElement(\"a\");a.href=url;a.download=\"FILENAME.png\";document.body.appendChild(a);a.click();document.body.removeChild(a);URL.revokeObjectURL(url);});return \"downloading...\"})()"}'

# 等待落盘后移动到工作区
sleep 3 && mv ~/Downloads/FILENAME.png /path/to/workspace/FILENAME.png
```

> **exportAsync 说明**：
> - `constraint.type: "SCALE", value: 2` → 导出 2x 分辨率（推荐）
> - 文件固定落盘到 `~/Downloads/`，导出后必须 `mv` 到工作区
> - 导出的是节点的**渲染结果**（含背景、圆角裁剪等），不是原始图片文件

---

### 第三步：批量导出（多张图片）

扫描到多个图片节点时，逐个触发下载，每次 sleep 2 等待落盘：

```bash
# 示例：导出 3 个节点
for NODE_ID in "259:36956" "259:36957" "259:36958"; do
  ~/.catpaw/bin/catdesk browser-action "{\"action\":\"evaluate\",\"script\":\"(function(){window.mg.getNodeById(\\\"${NODE_ID}\\\").exportAsync({format:\\\"PNG\\\",constraint:{type:\\\"SCALE\\\",value:2}}).then(function(bytes){var blob=new Blob([bytes],{type:\\\"image/png\\\"});var url=URL.createObjectURL(blob);var a=document.createElement(\\\"a\\\");a.href=url;a.download=\\\"img_${NODE_ID//:/_}.png\\\";document.body.appendChild(a);a.click();document.body.removeChild(a);URL.revokeObjectURL(url);});return \\\"downloading...\\\"})()\"}";
  sleep 2;
done
```

实际使用时建议用 Python 脚本循环，避免 shell 转义问题。

---

### 第四步：验证图片内容

下载完成后用 `mcp_tool_sdk-image-reader_image_read` 读取图片，确认内容符合预期：

```
mcp_tool_sdk-image-reader_image_read(path="/Users/chris/Downloads/FILENAME.png")
```

---

## 获取内网可用 URL（通过学城 KM 附件上传）

`imageRef` 不是公开 URL，直接拼接 CDN 域名无法访问。如果需要一个**可在文档/代码中长期引用、仅内网可用**的图片 URL，正确方式是通过 **citadel skill 的 `uploadImageToDocument`** 将图片上传到学城文档，获取 `km.sankuai.com/api/file/cdn/...` 格式的内网 URL。

> ⚠️ **大象不可用**：`catdesk daxiang send --file` 是发消息，不是上传图床，发完后无法获取图片 URL。

### 前置：确保 citadel CLI 最新

```bash
npm list -g @it/oa-skills --depth=0 --registry=http://r.npm.sankuai.com 2>/dev/null | grep oa-skills
# 如未安装或非最新：
npm install -g @it/oa-skills@latest --registry=http://r.npm.sankuai.com
```

### 上传图片到学城文档

```bash
# CONTENT_ID 为目标学城文档 ID（规范文档的 contentId）
# IMAGE_PATH 为本地图片绝对路径
# ALT 为图片描述（可选）
oa-skills citadel uploadImageToDocument \
  --contentId CONTENT_ID \
  --image /path/to/image.png \
  --alt "图片描述"
```

返回示例：
```
✅ 图片上传成功！
学城图片 URL：https://km.sankuai.com/api/file/2748397739/123456789
图片尺寸：750 × 300 px

CitadelMD 图片语法（可直接插入文档）：
![图片描述](https://km.sankuai.com/api/file/2748397739/123456789){width=750 height=300}
```

- `学城图片 URL`：内网可访问的图片 URL，可直接在学城文档、内部系统中引用
- `CitadelMD 图片语法`：可直接插入规范文档的 Markdown 语法片段

### 完整链路总结

```
exportAsync 导出 PNG
    ↓ mv 到工作区
oa-skills citadel uploadImageToDocument --contentId <规范文档ID> --image <路径>
    ↓ 返回「学城图片 URL」
内网可用 URL（https://km.sankuai.com/api/file/<contentId>/<attachmentId>）
    ↓ 可直接在规范 MD 中引用
```

> **内网访问说明**：学城图片 URL 仅内网/VPN 可访问，天然满足内网隔离需求，且与规范文档绑定，便于统一管理。

---

## 注意事项

- **`imageRef` vs `imageHash`**：`imageRef` 是实际可用的图片路径标识；`imageHash` 在只读分享模式下为 `null`，不可用
- **`imageRef` 不是公开 URL**：直接拼接 CDN 域名（如 `p0.meituan.net/`、`imd.sankuai.com/image/`）均无法访问，必须通过 `exportAsync` 导出
- **exportAsync 导出的是渲染结果**：如果节点有圆角、蒙版、混合模式等，导出图片会包含这些效果；若需要原始图片，需找到实际的 RECTANGLE/IMAGE 子节点再导出
- **整页扫描可能很慢**：页面节点数量大时，scan 递归遍历可能耗时较长，建议先缩小范围到目标 layer_id
- **隐藏节点默认跳过**：`isVisible === false` 的节点不会被扫描；如需包含隐藏节点，删除 `if(node.isVisible===false)return;` 这行
- **上传目标文档**：`uploadImageToDocument` 需要指定一个已存在的学城文档 ID，图片会作为该文档的附件存储；建议上传到规范文档本身，便于管理
