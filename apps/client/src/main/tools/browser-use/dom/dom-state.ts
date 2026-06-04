/**
 * DOMState - 对齐 browser-use 的页面状态表示
 *
 * 参考: browser_use/dom/state.py
 *
 * 核心设计:
 * 1. ElementNode - 每个可交互元素的完整信息
 * 2. DOMState - 页面的完整状态快照
 * 3. SelectorMap - 索引到元素的快速查找
 */

export interface BoundingBox {
  x: number
  y: number
  width: number
  height: number
}

export interface Point {
  x: number
  y: number
}

/**
 * 单个元素节点
 * 对应 browser-use 的 ElementNode 类
 */
export interface ElementNode {
  // 基本标识
  index: number
  backendNodeId: number
  tagName: string

  // 语义信息（来自 AX Tree）
  role?: string
  name?: string
  description?: string
  value?: string

  // DOM 属性
  id?: string
  className?: string
  type?: string
  placeholder?: string
  ariaLabel?: string
  ariaRole?: string
  href?: string
  src?: string

  // 状态
  isVisible: boolean
  isEnabled: boolean
  isReadOnly?: boolean
  isChecked?: boolean

  // 交互性
  isInteractive: boolean
  isClickable: boolean
  isEditable: boolean
  isFocusable: boolean

  // 位置和尺寸
  bounds: BoundingBox
  center: Point

  // 树结构（子元素索引）
  children: number[]
  parent?: number

  // 文本内容
  text?: string

  // 事件监听（来自 DOMDebugger）
  hasClickListener?: boolean
  hasInputListener?: boolean
  hasKeyListener?: boolean

  // 哈希（用于稳定性检测）
  hash: string
}

/**
 * 元素类型分类
 */
export type ElementType =
  | 'text_input'      // 文本输入框
  | 'search'          // 搜索框
  | 'password'        // 密码输入框
  | 'email'           // 邮箱输入框
  | 'number'          // 数字输入框
  | 'textarea'        // 多行文本
  | 'select'          // 下拉选择
  | 'checkbox'        // 复选框
  | 'radio'           // 单选框
  | 'button'          // 按钮
  | 'submit'          // 提交按钮
  | 'link'            // 链接
  | 'image'           // 图片
  | 'file'            // 文件上传
  | 'date'            // 日期选择
  | 'other'           // 其他

/**
 * 页面 DOM 状态
 * 对应 browser-use 的 DOMState 类
 */
export interface DOMState {
  // 页面信息
  url: string
  title: string
  timestamp: number

  // 元素数据
  elementTree: ElementNode[]
  selectorMap: Map<number, ElementNode>

  // 统计信息
  stats: {
    totalElements: number
    interactiveElements: number
    visibleElements: number
  }

  // 截图（可选）
  screenshot?: string
}

/**
 * 可执行的动作类型
 * 对齐 browser-use 的 Action 类
 */
export type BrowserAction =
  | { type: 'navigate'; url: string }
  | { type: 'click'; index?: number; ref?: number }
  | { type: 'type'; index?: number; ref?: number; text?: string; value?: string; clearFirst?: boolean }
  | { type: 'select'; index?: number; ref?: number; option: string }
  | { type: 'scroll'; direction: 'up' | 'down' | 'bottom' | 'top' | string; amount?: number }
  | { type: 'scroll_to'; index?: number; ref?: number }
  | { type: 'wait'; ms: number }
  | { type: 'screenshot'; fullPage?: boolean }
  | { type: 'back' }
  | { type: 'forward' }
  | { type: 'refresh' }
  | { type: 'hover'; index?: number; ref?: number }
  | { type: 'close' }

/**
 * 动作执行结果
 */
export interface ActionResult {
  success: boolean
  message: string
  newState?: DOMState
  error?: string
  screenshot?: string
}

/**
 * 查找元素的结果
 */
export interface ElementLookup {
  element: ElementNode
  strategy: 'index' | 'id' | 'role_name' | 'placeholder' | 'text' | 'coordinates'
  confidence: number
}

/**
 * 生成元素哈希（用于稳定性检测）
 */
export function computeElementHash(element: Omit<ElementNode, 'hash'>): string {
  const input = [
    element.tagName,
    element.role,
    element.name,
    element.id,
    Math.round(element.center.x / 10),  // 降低位置敏感度
    Math.round(element.center.y / 10),
  ].join('|')

  let hash = 0
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash
  }
  return hash.toString(16)
}

/**
 * 计算中心点
 */
export function computeCenter(bounds: BoundingBox): Point {
  return {
    x: Math.round(bounds.x + bounds.width / 2),
    y: Math.round(bounds.y + bounds.height / 2)
  }
}

/**
 * 检查两个边界框是否重叠
 */
export function doBoundsOverlap(a: BoundingBox, b: BoundingBox, threshold: number = 0.8): boolean {
  const overlapX = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x))
  const overlapY = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))
  const overlapArea = overlapX * overlapY
  const aArea = a.width * a.height
  const bArea = b.width * b.height

  if (aArea === 0 || bArea === 0) return false

  return overlapArea > aArea * threshold && overlapArea > bArea * threshold
}

/**
 * 分类元素类型
 */
export function classifyElementType(node: ElementNode): ElementType {
  const tag = node.tagName.toLowerCase()
  const type = node.type?.toLowerCase()
  const role = node.role?.toLowerCase()

  // 基于 role 分类（AX Tree 最可靠）
  if (role === 'searchbox') return 'search'
  if (role === 'textbox') return tag === 'textarea' ? 'textarea' : 'text_input'
  if (role === 'button') return 'button'
  if (role === 'link') return 'link'

  // 基于 tag 和 type 分类
  if (tag === 'input' && type) {
    switch (type) {
      case 'search': return 'search'
      case 'text': return 'text_input'
      case 'password': return 'password'
      case 'email': return 'email'
      case 'number': return 'number'
      case 'submit': return 'submit'
      case 'button': return 'button'
      case 'checkbox': return 'checkbox'
      case 'radio': return 'radio'
      case 'file': return 'file'
      case 'date':
      case 'datetime-local': return 'date'
    }
  }

  if (tag === 'textarea') return 'textarea'
  if (tag === 'select') return 'select'
  if (tag === 'button') return 'button'
  if (tag === 'a') return 'link'
  if (tag === 'img') return 'image'

  return 'other'
}

/**
 * 获取元素简短描述（用于 LLM）
 */
export function getElementDescription(element: ElementNode): string {
  const parts: string[] = [`[${element.index}]`]

  const type = classifyElementType(element)
  parts.push(type)

  if (element.name) {
    parts.push(`"${element.name.substring(0, 30)}"`)
  } else if (element.placeholder) {
    parts.push(`placeholder="${element.placeholder.substring(0, 25)}"`)
  }

  if (element.text && element.text !== element.name) {
    parts.push(`text="${element.text.substring(0, 30)}"`)
  }

  return parts.join(' ')
}

/**
 * 将 DOMState 格式化为 LLM 友好的文本
 */
export function formatDOMStateForLLM(state: DOMState, maxElements: number = 50): string {
  const lines: string[] = []

  lines.push(`Page: ${state.title}`)
  lines.push(`URL: ${state.url}`)
  lines.push('')

  // 按类型分组
  const byType = new Map<ElementType, ElementNode[]>()
  for (const element of state.elementTree) {
    if (!element.isVisible || !element.isInteractive) continue

    const type = classifyElementType(element)
    if (!byType.has(type)) {
      byType.set(type, [])
    }
    byType.get(type)!.push(element)
  }

  // 优先显示输入框和按钮
  const priorityTypes: ElementType[] = ['search', 'text_input', 'submit', 'button', 'link']

  for (const type of priorityTypes) {
    const elements = byType.get(type)
    if (!elements || elements.length === 0) continue

    lines.push(`${type.toUpperCase()}:`)
    for (const el of elements.slice(0, 10)) {
      lines.push(`  ${getElementDescription(el)}`)
    }
    if (elements.length > 10) {
      lines.push(`  ... and ${elements.length - 10} more`)
    }
    lines.push('')
  }

  // 其他类型
  const otherTypes = Array.from(byType.keys()).filter(t => !priorityTypes.includes(t))
  if (otherTypes.length > 0) {
    lines.push('OTHER:')
    for (const type of otherTypes) {
      const elements = byType.get(type)!
      lines.push(`  ${type}: ${elements.length} elements`)
    }
  }

  lines.push('')
  lines.push(`Total: ${state.stats.interactiveElements} interactive elements`)

  return lines.join('\n')
}
