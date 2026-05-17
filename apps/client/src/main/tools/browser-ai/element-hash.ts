/**
 * Element Hash 定位器
 * 参考 browser-use 的 hash-based 定位策略
 *
 * 核心概念：
 * - Element Hash: 基于元素完整属性的哈希，用于精确定位
 * - Stable Hash: 过滤动态类名后的哈希，DOM 样式变化后仍有效
 * - 多层回退: hash → stable hash → semantic → coordinate
 */

import { createHash } from 'crypto'

export interface ElementBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface ElementSignature {
  // 精确哈希（包含所有属性）
  hash: string
  // 稳定哈希（过滤动态类名）
  stableHash: string
  // 语义属性
  tag: string
  role?: string
  id?: string
  name?: string
  type?: string
  ariaLabel?: string
  placeholder?: string
  text?: string
  // 位置
  bounds: ElementBounds
  // XPath 作为后备
  xpath?: string
}

// 动态类名模式（过滤掉这些，因为会频繁变化）
const DYNAMIC_CLASS_PATTERNS = [
  'focus',
  'hover',
  'active',
  'selected',
  'disabled',
  'animation',
  'transition',
  'loading',
  'open',
  'closed',
  'expanded',
  'collapsed',
  'visible',
  'hidden',
  'pressed',
  'checked',
  'highlighted',
  'current',
  'entering',
  'leaving',
]

/**
 * 检查类名是否包含动态模式
 */
function isDynamicClass(className: string): boolean {
  const lower = className.toLowerCase()
  return DYNAMIC_CLASS_PATTERNS.some(pattern => lower.includes(pattern))
}

/**
 * 过滤动态类名
 */
function filterStableClasses(className: string | null): string {
  if (!className) return ''
  return className
    .split(/\s+/)
    .filter(c => c.length > 0 && !isDynamicClass(c))
    .sort() // 排序确保一致性
    .join(' ')
}

/**
 * 计算字符串哈希
 */
function computeHash(input: string): string {
  return createHash('md5').update(input).digest('hex').substring(0, 16)
}

/**
 * 计算元素哈希
 */
export function computeElementHash(el: Element): Pick<ElementSignature, 'hash' | 'stableHash'> {
  const rect = el.getBoundingClientRect()

  // 基础属性
  const tag = el.tagName.toLowerCase()
  const id = el.id || ''
  const name = el.getAttribute('name') || ''
  const type = (el as HTMLInputElement).type || ''
  const ariaLabel = el.getAttribute('aria-label') || ''
  const placeholder = el.getAttribute('placeholder') || ''

  // 原始类名（用于精确哈希）
  const rawClass = el.className || ''

  // 稳定类名（过滤动态类名）
  const stableClass = filterStableClasses(rawClass)

  // 位置（四舍五入确保一致性）
  const x = Math.round(rect.x)
  const y = Math.round(rect.y)

  // 计算精确哈希（包含所有属性）
  const hashInput = [
    tag,
    id,
    name,
    type,
    ariaLabel,
    placeholder,
    rawClass,
    x,
    y,
  ].join('|')

  // 计算稳定哈希（过滤动态类名）
  const stableHashInput = [
    tag,
    id,
    name,
    type,
    ariaLabel,
    placeholder,
    stableClass,
    x,
    y,
  ].join('|')

  return {
    hash: computeHash(hashInput),
    stableHash: computeHash(stableHashInput),
  }
}

/**
 * 提取元素完整签名
 */
export function extractElementSignature(el: Element, index: number): ElementSignature {
  const rect = el.getBoundingClientRect()
  const { hash, stableHash } = computeElementHash(el)

  // 获取文本内容
  let text = ''
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    text = el.placeholder || el.value || ''
  } else if (el instanceof HTMLButtonElement) {
    text = el.textContent?.trim() || ''
  } else {
    text = el.textContent?.trim().substring(0, 100) || ''
  }

  return {
    hash,
    stableHash,
    tag: el.tagName.toLowerCase(),
    id: el.id || undefined,
    name: el.getAttribute('name') || undefined,
    type: (el as HTMLInputElement).type || undefined,
    ariaLabel: el.getAttribute('aria-label') || undefined,
    placeholder: el.getAttribute('placeholder') || undefined,
    text: text || undefined,
    bounds: {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    },
  }
}

/**
 * 计算 XPath（后备定位用）
 */
export function getXPath(el: Element): string {
  const parts: string[] = []
  let current: Element | null = el

  while (current && current.nodeType === Node.ELEMENT_NODE) {
    let index = 1
    let sibling = current.previousElementSibling

    while (sibling) {
      if (sibling.tagName === current.tagName) {
        index++
      }
      sibling = sibling.previousElementSibling
    }

    const tagName = current.tagName.toLowerCase()
    const part = index > 1 ? `${tagName}[${index}]` : tagName
    parts.unshift(part)

    current = current.parentElement
  }

  return '/' + parts.join('/')
}

/**
 * 元素哈希映射表
 * 用于快速查找元素
 */
export class ElementHashMap {
  private byHash = new Map<string, ElementSignature>()
  private byStableHash = new Map<string, ElementSignature[]>()
  private byIndex = new Map<number, ElementSignature>()

  constructor(elements: ElementSignature[], startIndex: number = 0) {
    for (let i = 0; i < elements.length; i++) {
      const el = elements[i]
      const index = startIndex + i
      this.byIndex.set(index, el)
      this.byHash.set(el.hash, el)

      // 一个 stable hash 可能对应多个元素
      const existing = this.byStableHash.get(el.stableHash) || []
      existing.push(el)
      this.byStableHash.set(el.stableHash, existing)
    }
  }

  getByIndex(index: number): ElementSignature | undefined {
    return this.byIndex.get(index)
  }

  getByHash(hash: string): ElementSignature | undefined {
    return this.byHash.get(hash)
  }

  getByStableHash(stableHash: string): ElementSignature[] {
    return this.byStableHash.get(stableHash) || []
  }

  getAllElements(): ElementSignature[] {
    return Array.from(this.byIndex.values())
  }
}
