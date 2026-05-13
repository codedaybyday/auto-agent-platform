#!/usr/bin/env python3
"""
mg_extract_region.py — 从完整节点树中提取指定坐标区域的子树

基于坐标匹配，从 dumpTree JSON 中提取落在指定矩形区域内的节点。
适用于：截图分析后，获取截图区块对应的节点树。

用法：
    python3 mg_extract_region.py <json_file> --region x,y,w,h [options]
    python3 mg_extract_region.py <json_file> --slice slice.json [options]

选项：
    --region x,y,w,h    指定区域坐标（原图坐标系）
    --slice FILE        从切片信息文件读取坐标（由切片脚本生成）
    --output FILE       输出文件路径（默认 stdout）
    --min-overlap RATIO 最小重叠比例（默认 0.5，即节点至少 50% 在区域内）
    --include-partial   包含部分重叠的节点（默认只包含完全在区域内的节点）

示例：
    # 从完整树中提取指定区域
    python3 mg_extract_region.py full_tree.json --region 100,200,800,600 -o region_tree.json

    # 从切片信息提取（切片脚本会生成 slice_info.json）
    python3 mg_extract_region.py full_tree.json --slice slice_info.json -o region_tree.json

    # 允许部分重叠（节点只要有 30% 在区域内就包含）
    python3 mg_extract_region.py full_tree.json --region 100,200,800,600 --min-overlap 0.3
"""

import sys
import json
import argparse
from pathlib import Path


def parse_region(region_str):
    """解析区域坐标字符串 x,y,w,h"""
    parts = region_str.split(',')
    if len(parts) != 4:
        raise ValueError(f"区域格式错误: {region_str}，应为 x,y,w,h")
    return {
        'x': float(parts[0]),
        'y': float(parts[1]),
        'w': float(parts[2]),
        'h': float(parts[3])
    }


def load_slice_info(slice_file):
    """从切片信息文件加载坐标"""
    with open(slice_file, 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    # 支持多种格式
    if isinstance(data, dict):
        # 可能是单个切片或包含 slices 数组
        if 'slices' in data:
            return data['slices']
        elif 'x' in data and 'y' in data:
            return [data]
    elif isinstance(data, list):
        return data
    
    raise ValueError(f"不支持的切片信息格式: {slice_file}")


def calc_overlap_area(node, region):
    """计算节点与区域的重叠面积"""
    node_x2 = node['x'] + node.get('w', 0)
    node_y2 = node['y'] + node.get('h', 0)
    region_x2 = region['x'] + region['w']
    region_y2 = region['y'] + region['h']
    
    # 计算重叠区域
    overlap_x1 = max(node['x'], region['x'])
    overlap_y1 = max(node['y'], region['y'])
    overlap_x2 = min(node_x2, region_x2)
    overlap_y2 = min(node_y2, region_y2)
    
    if overlap_x2 <= overlap_x1 or overlap_y2 <= overlap_y1:
        return 0, 0  # 无重叠
    
    overlap_area = (overlap_x2 - overlap_x1) * (overlap_y2 - overlap_y1)
    node_area = node.get('w', 0) * node.get('h', 0)
    
    if node_area == 0:
        # 对于无尺寸的节点（如 TEXT），检查中心点是否在区域内
        center_x = node['x'] + node.get('w', 0) / 2
        center_y = node['y'] + node.get('h', 0) / 2
        if region['x'] <= center_x <= region_x2 and region['y'] <= center_y <= region_y2:
            return 1, 1  # 视为完全包含
        return 0, 0
    
    overlap_ratio = overlap_area / node_area
    return overlap_area, overlap_ratio


def is_node_in_region(node, region, min_overlap=1.0, include_partial=False):
    """
    判断节点是否在指定区域内
    
    Args:
        node: 节点字典，包含 x, y, w, h
        region: 区域字典，包含 x, y, w, h
        min_overlap: 最小重叠比例（默认 1.0 表示完全包含）
        include_partial: 是否包含部分重叠
    
    Returns:
        bool: 是否包含该节点
    """
    if 'x' not in node or 'y' not in node:
        return False
    
    _, overlap_ratio = calc_overlap_area(node, region)
    
    if include_partial:
        return overlap_ratio >= min_overlap
    else:
        # 默认：节点必须完全在区域内（或接近完全）
        return overlap_ratio >= min_overlap


def collect_all_nodes(node, parent_x=0, parent_y=0, result=None):
    """
    收集所有节点的绝对坐标
    
    dumpTree 中的坐标是相对于父节点的，需要转换为绝对坐标
    """
    if result is None:
        result = []
    
    # 计算绝对坐标
    abs_x = parent_x + node.get('x', 0)
    abs_y = parent_y + node.get('y', 0)
    
    # 创建带绝对坐标的节点副本
    node_with_abs = dict(node)
    node_with_abs['_abs_x'] = abs_x
    node_with_abs['_abs_y'] = abs_y
    node_with_abs['_parent_x'] = parent_x
    node_with_abs['_parent_y'] = parent_y
    
    result.append(node_with_abs)
    
    # 递归处理子节点
    if 'children' in node:
        for child in node['children']:
            collect_all_nodes(child, abs_x, abs_y, result)
    
    return result


def build_subtree_from_nodes(nodes_with_abs, region, min_overlap=1.0, include_partial=False):
    """
    从带绝对坐标的节点列表中构建子树
    
    Args:
        nodes_with_abs: 带 _abs_x, _abs_y 的节点列表
        region: 目标区域
        min_overlap: 最小重叠比例
        include_partial: 是否包含部分重叠
    
    Returns:
        提取的子树根节点，或 None
    """
    # 创建节点映射
    node_map = {n['id']: n for n in nodes_with_abs}
    
    # 找出在区域内的节点
    nodes_in_region = []
    for n in nodes_with_abs:
        # 使用绝对坐标创建临时节点用于区域判断
        temp_node = {
            'x': n['_abs_x'],
            'y': n['_abs_y'],
            'w': n.get('w', 0),
            'h': n.get('h', 0)
        }
        if is_node_in_region(temp_node, region, min_overlap, include_partial):
            nodes_in_region.append(n)
    
    if not nodes_in_region:
        return None
    
    # 找到最顶层的节点（parent 不在区域内）
    node_ids_in_region = {n['id'] for n in nodes_in_region}
    root_candidates = [n for n in nodes_in_region if n.get('parent_id') not in node_ids_in_region]
    
    if not root_candidates:
        # 如果没有明确的根节点，使用区域匹配度最高的节点
        root_candidates = [nodes_in_region[0]]
    
    # 构建子树
    def build_tree(node_id):
        if node_id not in node_map:
            return None
        
        original = node_map[node_id]
        # 创建节点副本，移除内部字段
        new_node = {k: v for k, v in original.items() 
                   if not k.startswith('_') and k != 'children'}
        
        # 更新为绝对坐标
        new_node['x'] = original['_abs_x']
        new_node['y'] = original['_abs_y']
        
        # 递归构建子节点
        children = []
        for child in original.get('children', []):
            child_id = child['id']
            if child_id in node_ids_in_region:
                child_tree = build_tree(child_id)
                if child_tree:
                    children.append(child_tree)
        
        if children:
            new_node['children'] = children
        
        return new_node
    
    # 如果有多个根候选，创建一个虚拟根节点
    if len(root_candidates) == 1:
        return build_tree(root_candidates[0]['id'])
    else:
        # 多个根节点，创建一个集合节点
        virtual_root = {
            'id': 'virtual_root',
            'name': 'Extracted Region',
            'type': 'REGION_COLLECTION',
            'children': []
        }
        for root in root_candidates:
            tree = build_tree(root['id'])
            if tree:
                virtual_root['children'].append(tree)
        return virtual_root


def extract_subtree(node, region, min_overlap=1.0, include_partial=False, parent_in_region=False):
    """
    递归提取子树中在指定区域内的节点（基于相对坐标）
    
    注意：此函数假设 node 的坐标是相对于画布的绝对坐标
    如果 dumpTree 中的坐标是相对于父节点的，请先使用 collect_all_nodes 转换
    
    Args:
        node: 当前节点
        region: 目标区域
        min_overlap: 最小重叠比例
        include_partial: 是否包含部分重叠
        parent_in_region: 父节点是否已在区域内（用于优化）
    
    Returns:
        提取的节点，或 None（如果该节点不在区域内）
    """
    # 检查当前节点是否在区域内
    in_region = parent_in_region or is_node_in_region(node, region, min_overlap, include_partial)
    
    if not in_region and not include_partial:
        # 如果当前节点不在区域内，且不允许部分重叠，直接返回 None
        return None
    
    # 创建新节点（深拷贝，避免修改原数据）
    new_node = {k: v for k, v in node.items() if k != 'children'}
    
    # 递归处理子节点
    if 'children' in node:
        new_children = []
        for child in node['children']:
            extracted = extract_subtree(
                child, region, min_overlap, include_partial, 
                parent_in_region=in_region
            )
            if extracted:
                new_children.append(extracted)
        
        if new_children:
            new_node['children'] = new_children
    
    # 如果当前节点不在区域内，但子节点在，保留该节点作为容器
    if not in_region and 'children' in new_node:
        return new_node
    
    # 如果当前节点在区域内，保留
    if in_region:
        return new_node
    
    return None


def adjust_coordinates(node, region_x, region_y):
    """
    调整节点坐标，使其相对于区域的左上角
    （可选：如果需要相对坐标）
    """
    if 'x' in node:
        node['x'] = node['x'] - region_x
    if 'y' in node:
        node['y'] = node['y'] - region_y
    
    if 'children' in node:
        for child in node['children']:
            adjust_coordinates(child, region_x, region_y)


def main():
    parser = argparse.ArgumentParser(
        description='从完整节点树中提取指定坐标区域的子树'
    )
    parser.add_argument('input', help='输入的 JSON 文件路径（完整节点树）')
    parser.add_argument('--region', help='区域坐标 x,y,w,h')
    parser.add_argument('--slice', help='切片信息文件路径')
    parser.add_argument('-o', '--output', help='输出文件路径（默认 stdout）')
    parser.add_argument('--min-overlap', type=float, default=1.0,
                        help='最小重叠比例（默认 1.0，即完全包含）')
    parser.add_argument('--include-partial', action='store_true',
                        help='包含部分重叠的节点')
    parser.add_argument('--relative-coords', action='store_true',
                        help='输出相对坐标（相对于区域左上角）')
    
    args = parser.parse_args()
    
    # 读取输入文件
    with open(args.input, 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    # 解析区域坐标
    regions = []
    if args.region:
        regions.append(parse_region(args.region))
    elif args.slice:
        regions = load_slice_info(args.slice)
        if not isinstance(regions, list):
            regions = [regions]
    else:
        print("错误：必须指定 --region 或 --slice", file=sys.stderr)
        sys.exit(1)
    
    # 首先收集所有节点的绝对坐标（因为 dumpTree 中的坐标是相对于父节点的）
    print("正在计算节点绝对坐标...", file=sys.stderr)
    nodes_with_abs = collect_all_nodes(data)
    print(f"  共 {len(nodes_with_abs)} 个节点", file=sys.stderr)
    
    # 处理每个区域
    results = []
    for i, region in enumerate(regions):
        print(f"处理区域 {i+1}/{len(regions)}: x={region['x']}, y={region['y']}, w={region['w']}, h={region['h']}", 
              file=sys.stderr)
        
        # 使用新的方法提取子树
        extracted = build_subtree_from_nodes(
            nodes_with_abs, region,
            min_overlap=args.min_overlap,
            include_partial=args.include_partial
        )
        
        if extracted:
            # 调整坐标为相对坐标（可选）
            if args.relative_coords:
                adjust_coordinates(extracted, region['x'], region['y'])
            
            # 添加区域信息到结果
            extracted['_extract_region'] = region
            results.append(extracted)
            
            # 统计节点数
            def count_nodes(node):
                count = 1
                if 'children' in node:
                    for child in node['children']:
                        count += count_nodes(child)
                return count
            
            node_count = count_nodes(extracted)
            print(f"  提取节点数: {node_count}", file=sys.stderr)
        else:
            print(f"  未找到节点", file=sys.stderr)
    
    # 输出结果
    if len(results) == 1:
        output = results[0]
    else:
        output = {
            'type': 'REGION_COLLECTION',
            'regions': results
        }
    
    output_json = json.dumps(output, ensure_ascii=False, indent=2)
    
    if args.output:
        with open(args.output, 'w', encoding='utf-8') as f:
            f.write(output_json)
        print(f"\n输出文件: {args.output}", file=sys.stderr)
    else:
        print(output_json)


if __name__ == '__main__':
    main()
