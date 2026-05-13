/**
 * mg_save_dump.js - 在浏览器中执行，将 dumpTree 数据保存到文件
 * 
 * 使用方法：
 * 1. 在 MasterGo 页面打开浏览器控制台
 * 2. 粘贴此代码
 * 3. 调用 saveDumpTree(pageId, layerId, fileName)
 * 
 * 或者通过 catdesk browser-action 执行
 */

// dumpTree 函数定义
function dumpTree(node, depth) {
    if (node.isVisible === false) return null;
    
    var info = {
        id: node.id,
        name: node.name,
        type: node.type
    };
    
    if (node.width !== undefined) info.w = node.width;
    if (node.height !== undefined) info.h = node.height;
    if (node.x !== undefined) info.x = node.x;
    if (node.y !== undefined) info.y = node.y;
    if (node.rotation !== undefined && node.rotation !== 0) info.rotation = node.rotation;
    if (node.characters) info.text = node.characters.trim();
    if (node.fills && node.fills.length > 0) info.fills = node.fills;
    if (node.paddingLeft !== undefined) info.padding = {
        l: node.paddingLeft,
        r: node.paddingRight,
        t: node.paddingTop,
        b: node.paddingBottom
    };
    if (node.itemSpacing !== undefined) info.gap = node.itemSpacing;
    if (node.counterAxisSpacing !== undefined && node.counterAxisSpacing !== 0) info.crossGap = node.counterAxisSpacing;
    if (node.layoutMode && node.layoutMode !== "NONE") info.layout = node.layoutMode;
    if (node.layoutWrap) info.layoutWrap = node.layoutWrap;
    if (node.primaryAxisAlignItems) info.mainAlign = node.primaryAxisAlignItems;
    if (node.counterAxisAlignItems) info.crossAlign = node.counterAxisAlignItems;
    if (node.layoutSizingHorizontal) info.sizingH = node.layoutSizingHorizontal;
    if (node.layoutSizingVertical) info.sizingV = node.layoutSizingVertical;
    if (node.layoutGrow !== undefined && node.layoutGrow !== 0) info.grow = node.layoutGrow;
    if (node.minWidth !== undefined && node.minWidth !== 0) info.minW = node.minWidth;
    if (node.maxWidth !== undefined && node.maxWidth !== 0) info.maxW = node.maxWidth;
    if (node.minHeight !== undefined && node.minHeight !== 0) info.minH = node.minHeight;
    if (node.maxHeight !== undefined && node.maxHeight !== 0) info.maxH = node.maxHeight;
    
    var tl = node.topLeftRadius, tr = node.topRightRadius, bl = node.bottomLeftRadius, br = node.bottomRightRadius;
    if (tl !== undefined && tr !== undefined && bl !== undefined && br !== undefined) {
        if (tl === tr && tr === bl && bl === br) {
            if (tl !== 0) info.radius = tl;
        } else {
            info.radius = { tl: tl, tr: tr, bl: bl, br: br };
        }
    } else if (node.cornerRadius !== undefined && node.cornerRadius !== 0) {
        info.radius = node.cornerRadius;
    }
    
    if (node.strokeWeight !== undefined && node.strokes && node.strokes.length > 0) {
        info.strokeWeight = node.strokeWeight;
        info.strokeAlign = node.strokeAlign;
    }
    if (node.strokes && node.strokes.length > 0) info.strokes = node.strokes;
    if (node.constraints) info.constraints = node.constraints;
    if (node.blendMode && node.blendMode !== "PASS_THROUGH" && node.blendMode !== "NORMAL") info.blendMode = node.blendMode;
    if (node.clipsContent) info.clipsContent = node.clipsContent;
    if (node.isMask) info.isMask = node.isMask;
    if (node.fontSize !== undefined) info.fontSize = node.fontSize;
    if (node.fontWeight !== undefined) info.fontWeight = node.fontWeight;
    if (node.fontFamily !== undefined) info.fontFamily = node.fontFamily;
    if (node.lineHeight !== undefined) info.lineHeight = node.lineHeight;
    if (node.letterSpacing !== undefined && node.letterSpacing !== 0) info.letterSpacing = node.letterSpacing;
    if (node.textAlignHorizontal) info.textAlign = node.textAlignHorizontal;
    if (node.textDecoration && node.textDecoration !== "NONE") info.textDecoration = node.textDecoration;
    if (node.textCase && node.textCase !== "ORIGINAL") info.textCase = node.textCase;
    if (node.opacity !== undefined && node.opacity !== 1) info.opacity = node.opacity;
    if (node.effects && node.effects.length > 0) info.effects = node.effects;
    
    if (node.children && node.children.length > 0) {
        var kids = node.children.map(function(c) {
            return dumpTree(c, depth + 1);
        }).filter(function(c) {
            return c !== null;
        });
        if (kids.length > 0) info.children = kids;
    }
    
    return info;
}

// 查找节点
function findNode(node, id) {
    if (node.id === id) return node;
    if (node.children) {
        for (var i = 0; i < node.children.length; i++) {
            var r = findNode(node.children[i], id);
            if (r) return r;
        }
    }
    return null;
}

// 保存 dumpTree 到文件
function saveDumpTree(pageId, layerId, fileName) {
    var page = window.mg.document.children.find(function(p) {
        return p.id === pageId;
    });
    
    if (!page) {
        console.error("Page not found:", pageId);
        return null;
    }
    
    var node = findNode(page, layerId);
    if (!node) {
        console.error("Node not found:", layerId);
        return null;
    }
    
    var result = dumpTree(node, 0);
    var jsonStr = JSON.stringify(result);
    
    // 创建下载
    var blob = new Blob([jsonStr], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = fileName || ("mg_dump_" + layerId.replace(/:/g, "_") + ".json");
    document.body.appendChild(a);
    a.click();
    
    // 延迟清理
    setTimeout(function() {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, 1000);
    
    console.log("Saved:", a.download, "Size:", jsonStr.length, "chars");
    return {
        fileName: a.download,
        size: jsonStr.length,
        nodeCount: countNodes(result)
    };
}

// 统计节点数
function countNodes(node) {
    var count = 1;
    if (node.children) {
        for (var i = 0; i < node.children.length; i++) {
            count += countNodes(node.children[i]);
        }
    }
    return count;
}

// 导出到全局
window.mgSaveDump = {
    saveDumpTree: saveDumpTree,
    dumpTree: dumpTree,
    findNode: findNode
};

console.log("mgSaveDump loaded. Usage: mgSaveDump.saveDumpTree(pageId, layerId, fileName)");
