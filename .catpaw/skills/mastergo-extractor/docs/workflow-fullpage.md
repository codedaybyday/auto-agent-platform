# 整页文字模式（URL 无 layer_id）

URL 中不含 `layer_id` 参数时走此流程，提取整页所有文字内容。

---

## 3B-1：提取整页文字

先统计文字节点数量，再决定是否分批处理：

```bash
# 统计数量（TARGET_PAGE_ID 替换为实际页面 id）
~/.catpaw/bin/catdesk browser-action '{"action":"evaluate","script":"var page=window.mg.document.children.find(p=>p.id===`TARGET_PAGE_ID`); function countText(node){if(node.isVisible===false)return 0;var c=0;if(node.type===`TEXT`&&node.characters&&node.characters.trim().length>1)c++;if(node.children)node.children.forEach(ch=>{c+=countText(ch);});return c;} countText(page)"}'
```

数量可接受后，提取全部文字：

```bash
~/.catpaw/bin/catdesk browser-action '{"action":"evaluate","script":"var page=window.mg.document.children.find(p=>p.id===`TARGET_PAGE_ID`); function extractText(node,depth){var r=[];if(node.isVisible===false)return r;if(node.type===`TEXT`&&node.characters&&node.characters.trim().length>1){var t=node.characters.trim();r.push({depth:depth,name:node.name,text:t});}if(node.children){node.children.forEach(c=>{r=r.concat(extractText(c,depth+1));});}return r;} var texts=extractText(page,0);var unique=[];var seen=new Set();texts.forEach(t=>{if(!seen.has(t.text)){seen.add(t.text);unique.push(t);}});JSON.stringify(unique)"}'
```

输出为 JSON 数组，每项包含 `depth`（层级深度）、`name`（节点名）、`text`（文字内容）。

> 3000+ 文字节点很常见，先统计再决定是否过滤无意义占位词（见 [node-reference.md](./node-reference.md) 的过滤模板）。

---

## 3B-2：截图视觉验证

整页模式没有 `exportAsync`，截图是唯一的视觉手段，推荐执行。截图前**必须先隐藏操作面板**。

### 4-0：隐藏面板 + 缩放到全部

以下脚本一次性完成：隐藏面板 → 尝试 `⇧1` 缩放到全部 → 自动检测是否生效：

```bash
~/.catpaw/bin/catdesk browser-action '{"action":"evaluate","script":"(function(){function pressKey(opts){var e=new KeyboardEvent(\"keydown\",Object.assign({bubbles:true,cancelable:true,view:window},opts));var p=!document.dispatchEvent(e);document.dispatchEvent(new KeyboardEvent(\"keyup\",Object.assign({bubbles:true,cancelable:true,view:window},opts)));return p;} var panelOk=pressKey({key:\"\\\\\",code:\"Backslash\",metaKey:true,keyCode:220}); var zoomOk=pressKey({key:\"1\",code:\"Digit1\",shiftKey:true,keyCode:49}); return JSON.stringify({panelToggled:panelOk,zoomShift1:zoomOk});})()"}'
```

- `zoomShift1: true` → 等待 0.5s 后截图
- `zoomShift1: false` → 执行 fallback，用 `scrollAndZoomIntoView` 定位到页面所有顶层节点：

```bash
~/.catpaw/bin/catdesk browser-action '{"action":"evaluate","script":"(function(){var page=window.mg.document.children.find(function(p){return p.id===\"PAGE_ID\";});if(!page)return \"page not found\";window.mg.viewport.scrollAndZoomIntoView(page.children);return \"viewport set to page: \"+page.name;})()"}'
```

### 4-1：拖拽平移（分段截图）

对内容很长的页面，可拖拽到不同位置分段截图（`dragY` 为负数表示向上移动画布）：

```bash
~/.catpaw/bin/catdesk browser-action '{"action":"evaluate","script":"(function(){var c=document.querySelector(\"canvas\"); var r=c.getBoundingClientRect(); var cx=r.left+r.width/2; var cy=r.top+r.height/2; var kd=new KeyboardEvent(\"keydown\",{key:\" \",code:\"Space\",keyCode:32,bubbles:true,cancelable:true}); c.dispatchEvent(kd); document.dispatchEvent(kd); var dragX=0; var dragY=-500; var steps=20; var opts=function(x,y){return {bubbles:true,cancelable:true,view:window,clientX:x,clientY:y,button:0,buttons:1,pointerId:1,pointerType:\"mouse\"};}; c.dispatchEvent(new PointerEvent(\"pointerdown\",opts(cx,cy))); c.dispatchEvent(new MouseEvent(\"mousedown\",opts(cx,cy))); for(var i=1;i<=steps;i++){c.dispatchEvent(new PointerEvent(\"pointermove\",opts(cx+dragX*i/steps,cy+dragY*i/steps))); c.dispatchEvent(new MouseEvent(\"mousemove\",opts(cx+dragX*i/steps,cy+dragY*i/steps)));} c.dispatchEvent(new PointerEvent(\"pointerup\",opts(cx+dragX,cy+dragY))); c.dispatchEvent(new MouseEvent(\"mouseup\",opts(cx+dragX,cy+dragY))); c.dispatchEvent(new KeyboardEvent(\"keyup\",{key:\" \",code:\"Space\",keyCode:32,bubbles:true})); return \"dragged\";})()"}' && sleep 1
```

### 4-2：截图

```bash
~/.catpaw/bin/catdesk browser-action '{"action":"screenshot"}'
```

截图始终是全屏尺寸（约 1400×1600px），`clip` 参数无效。`image_read` 会自动缩放，不会超出视觉模型限制。

> 截图完成后执行一次 `⌘\` 恢复面板。
