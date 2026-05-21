/**
 * Browser Snapshot 系统
 * 参考 OpenClaw 设计，提供三种格式的页面结构提取
 */

import { Page, Locator } from 'playwright'

export type SnapshotFormat = 'role' | 'aria' | 'ai'

export interface SnapshotOptions {
  format?: SnapshotFormat
  interactiveOnly?: boolean  // 只返回可交互元素
  compact?: boolean          // 精简输出
  maxDepth?: number          // DOM 树深度限制
  includeUrls?: boolean      // 包含链接 URL
  includeLabels?: boolean    // 包含视觉标签
}

export interface SnapshotElement {
  // 基础信息
  tag: string
  role?: string
  name?: string
  text?: string
  ariaLabel?: string
  ariaDescribedBy?: string

  // 标识
  id?: string
  ref?: string        // 稳定引用 (role format: e12, aria format: ax5)
  ariaRef?: string    // Playwright aria-ref

  // 状态
  disabled?: boolean
  checked?: boolean
  selected?: boolean
  expanded?: boolean
  level?: number      // 标题级别 (h1=1, h2=2...)

  // 输入元素
  inputType?: string
  placeholder?: string
  value?: string
  required?: boolean

  // 链接
  href?: string
  target?: string

  // 视觉信息
  boundingBox?: {
    x: number
    y: number
    width: number
    height: number
  }

  // 子元素
  children?: SnapshotElement[]
}

export interface PageSnapshot {
  url: string
  title: string
  format: SnapshotFormat
  timestamp: number
  elements: SnapshotElement[]
  stats: {
    totalElements: number
    interactiveElements: number
    links: number
    buttons: number
    inputs: number
    forms: number
  }
}

/**
 * Snapshot 管理器
 */
export class SnapshotManager {
  private refCounter = new Map<SnapshotFormat, number>()
  private ariaRefMap = new Map<string, string>()  // aria-ref -> stable ref

  constructor() {
    this.refCounter.set('role', 0)
    this.refCounter.set('aria', 0)
  }

  /**
   * 生成稳定的元素引用
   */
  private generateRef(format: SnapshotFormat): string {
    const counter = (this.refCounter.get(format) || 0) + 1
    this.refCounter.set(format, counter)

    switch (format) {
      case 'role':
        return `e${counter}`
      case 'aria':
        return `ax${counter}`
      default:
        return `${counter}`
    }
  }

  /**
   * 捕获页面 Snapshot
   */
  async capture(page: Page, options: SnapshotOptions = {}): Promise<PageSnapshot> {
    const {
      format = 'role',
      interactiveOnly = true,
      compact = true,
      maxDepth = 5,
      includeUrls = true,
      includeLabels = true
    } = options

    // 重置计数器
    this.refCounter.set(format, 0)
    this.ariaRefMap.clear()

    const snapshot = await page.evaluate(
      (opts) => {
        const {
          format: fmt,
          interactiveOnly: onlyInteractive,
          compact,
          maxDepth,
          includeUrls,
          includeLabels
        } = opts

        const result: PageSnapshot = {
          url: window.location.href,
          title: document.title,
          format: fmt as SnapshotFormat,
          timestamp: Date.now(),
          elements: [],
          stats: {
            totalElements: 0,
            interactiveElements: 0,
            links: 0,
            buttons: 0,
            inputs: 0,
            forms: 0
          }
        }

        // 检查元素是否可交互
        function isInteractive(el: Element): boolean {
          const tag = el.tagName.toLowerCase()
          const role = el.getAttribute('role')

          // 天然可交互元素
          if (['button', 'a', 'input', 'textarea', 'select'].includes(tag)) {
            return true
          }

          // ARIA 可交互角色
          const interactiveRoles = [
            'button', 'link', 'menuitem', 'menuitemcheckbox', 'menuitemradio',
            'option', 'radio', 'switch', 'tab', 'treeitem',
            'textbox', 'combobox', 'searchbox', 'spinbutton'
          ]
          if (role && interactiveRoles.includes(role)) {
            return true
          }

          // 点击事件
          if (el.hasAttribute('onclick') || el.getAttribute('tabindex') === '0') {
            return true
          }

          return false
        }

        // 获取元素角色
        function getRole(el: Element): string | undefined {
          const explicitRole = el.getAttribute('role')
          if (explicitRole) return explicitRole

          // 隐式角色
          const tag = el.tagName.toLowerCase()
          const implicitRoles: Record<string, string> = {
            'a': 'link',
            'button': 'button',
            'input': (el as HTMLInputElement).type === 'submit' ? 'button' :
                     (el as HTMLInputElement).type === 'checkbox' ? 'checkbox' :
                     (el as HTMLInputElement).type === 'radio' ? 'radio' :
                     (el as HTMLInputElement).type === 'text' ? 'textbox' : 'textbox',
            'textarea': 'textbox',
            'select': 'combobox',
            'h1': 'heading',
            'h2': 'heading',
            'h3': 'heading',
            'h4': 'heading',
            'h5': 'heading',
            'h6': 'heading',
            'nav': 'navigation',
            'main': 'main',
            'article': 'article',
            'section': 'region'
          }

          return implicitRoles[tag]
        }

        // 获取可访问名称
        function getAccessibleName(el: Element): string | undefined {
          // 1. aria-label
          const ariaLabel = el.getAttribute('aria-label')
          if (ariaLabel) return ariaLabel.trim()

          // 2. aria-labelledby
          const labelledBy = el.getAttribute('aria-labelledby')
          if (labelledBy) {
            const labelEl = document.getElementById(labelledBy)
            if (labelEl) return labelEl.textContent?.trim()
          }

          // 3. 文本内容（按钮、链接）
          if (['BUTTON', 'A'].includes(el.tagName)) {
            return el.textContent?.trim()
          }

          // 4. value (input)
          if (el.tagName === 'INPUT') {
            const input = el as HTMLInputElement
            if (input.type === 'submit' || input.type === 'button') {
              return input.value || undefined
            }
          }

          // 5. title
          const title = el.getAttribute('title')
          if (title) return title.trim()

          // 6. placeholder (输入框)
          const placeholder = el.getAttribute('placeholder')
          if (placeholder) return placeholder.trim()

          return undefined
        }

        // 提取元素信息
        function extractElement(el: Element, depth: number): SnapshotElement | null {
          if (depth > maxDepth) return null

          const rect = el.getBoundingClientRect()
          if (rect.width === 0 || rect.height === 0) return null // 不可见

          const tag = el.tagName.toLowerCase()
          const role = getRole(el)

          // 如果只提取可交互元素，跳过不可交互的
          if (onlyInteractive && !isInteractive(el)) {
            return null
          }

          // 统计
          result.stats.totalElements++
          if (isInteractive(el)) {
            result.stats.interactiveElements++
          }
          if (tag === 'a') result.stats.links++
          if (tag === 'button' || role === 'button') result.stats.buttons++
          if (['input', 'textarea', 'select'].includes(tag)) result.stats.inputs++
          if (tag === 'form') result.stats.forms++

          const element: SnapshotElement = {
            tag,
            role,
            name: compact ? undefined : getAccessibleName(el),
            text: el.textContent?.trim().substring(0, 100),
            ariaLabel: el.getAttribute('aria-label') || undefined,
            id: el.id || undefined,
            boundingBox: {
              x: Math.round(rect.x),
              y: Math.round(rect.y),
              width: Math.round(rect.width),
              height: Math.round(rect.height)
            }
          }

          // 输入元素特有属性
          if (tag === 'input' || tag === 'textarea') {
            const input = el as HTMLInputElement
            element.inputType = input.type
            element.placeholder = input.placeholder || undefined
            element.value = input.value || undefined
            element.required = input.required || undefined
            element.disabled = input.disabled || undefined
          }

          // 复选框/单选框状态
          if (element.inputType === 'checkbox' || element.inputType === 'radio') {
            element.checked = (el as HTMLInputElement).checked
          }

          // 展开状态
          const expanded = el.getAttribute('aria-expanded')
          if (expanded !== null) {
            element.expanded = expanded === 'true'
          }

          // 选中状态
          const selected = el.getAttribute('aria-selected')
          if (selected !== null) {
            element.selected = selected === 'true'
          }

          // 链接属性
          if (tag === 'a' && includeUrls) {
            const anchor = el as HTMLAnchorElement
            element.href = anchor.href
            element.target = anchor.target || undefined
          }

          // 标题级别
          if (role === 'heading') {
            const match = tag.match(/h(\d)/)
            if (match) {
              element.level = parseInt(match[1])
            }
          }

          // 递归提取子元素（如果不是 compact 模式）
          if (!compact && depth < maxDepth) {
            const children: SnapshotElement[] = []
            Array.from(el.children).forEach((child) => {
              const childElement = extractElement(child, depth + 1)
              if (childElement) {
                children.push(childElement)
              }
            })
            if (children.length > 0) {
              element.children = children
            }
          }

          return element
        }

        // 提取主要内容区域
        const mainSelectors = [
          'main',
          'article',
          '[role="main"]',
          '.content',
          '#content',
          '.main',
          '#main',
          'body'
        ]

        let rootElement: Element | null = null
        for (const selector of mainSelectors) {
          rootElement = document.querySelector(selector)
          if (rootElement) break
        }

        if (rootElement) {
          // 提取所有可交互元素
          const interactiveElements = rootElement.querySelectorAll(
            'button, a[href], input, textarea, select, [role="button"], [role="link"], [onclick], [tabindex="0"]'
          )

          interactiveElements.forEach((el) => {
            const element = extractElement(el, 0)
            if (element) {
              result.elements.push(element)
            }
          })

          // 如果没有可交互元素，提取一些结构元素
          if (result.elements.length === 0) {
            const headings = rootElement.querySelectorAll('h1, h2, h3, h4, h5, h6')
            headings.forEach((el) => {
              const element = extractElement(el, 0)
              if (element) {
                result.elements.push(element)
              }
            })
          }
        }

        return result
      },
      { format, interactiveOnly, compact, maxDepth, includeUrls, includeLabels }
    )

    // 为每个元素生成稳定引用
    snapshot.elements.forEach((el) => {
      el.ref = this.generateRef(format)

      // 如果是 aria 格式，记录 aria-ref 映射
      if (format === 'aria' && el.ariaRef) {
        this.ariaRefMap.set(el.ariaRef, el.ref!)
      }
    })

    return snapshot
  }

  /**
   * 将 Snapshot 转换为 AI 友好的文本格式
   */
  toAIFormat(snapshot: PageSnapshot): string {
    const lines: string[] = []

    lines.push(`Page: ${snapshot.title}`)
    lines.push(`URL: ${snapshot.url}`)
    lines.push('')
    lines.push('Available Elements:')
    lines.push('')

    snapshot.elements.forEach((el) => {
      const ref = el.ref || '?'
      const role = el.role || el.tag
      const name = el.name || el.text || el.placeholder || el.ariaLabel || '(unnamed)'

      let line = `[${ref}] ${role}`

      if (name && name !== '(unnamed)') {
        line += `: "${name.substring(0, 50)}"`
      }

      if (el.inputType) {
        line += ` (type=${el.inputType})`
      }

      if (el.href && el.href !== window.location.href) {
        line += ` -> ${el.href.substring(0, 50)}`
      }

      lines.push(line)
    })

    lines.push('')
    lines.push(`Stats: ${snapshot.stats.interactiveElements} interactive elements, ${snapshot.stats.links} links, ${snapshot.stats.buttons} buttons`)

    return lines.join('\n')
  }

  /**
   * 根据 ref 查找元素
   */
  async findByRef(page: Page, ref: string, snapshot: PageSnapshot): Promise<Locator | null> {
    // 在 snapshot 中查找元素信息
    const element = snapshot.elements.find((el) => el.ref === ref)
    if (!element) {
      return null
    }

    // 构建 Playwright locator
    // 优先级：aria-ref > id > role+name > text

    // 1. 如果有 aria-ref，使用它
    if (element.ariaRef) {
      try {
        // Playwright 的 aria-ref 格式是内部实现的，我们用其他方式
        const locator = page.locator(`[aria-ref="${element.ariaRef}"]`)
        if (await locator.count() > 0) {
          return locator.first()
        }
      } catch {}
    }

    // 2. 如果有 id，使用它
    if (element.id) {
      try {
        const locator = page.locator(`#${element.id}`)
        if (await locator.count() > 0) {
          return locator.first()
        }
      } catch {}
    }

    // 3. 使用 role 和 name
    if (element.role && element.name) {
      try {
        const locator = page.getByRole(element.role as any, { name: element.name, exact: false })
        if (await locator.count() > 0) {
          return locator.first()
        }
      } catch {}
    }

    // 4. 使用文本内容
    if (element.text) {
      try {
        const locator = page.getByText(element.text, { exact: false })
        if (await locator.count() > 0) {
          return locator.first()
        }
      } catch {}
    }

    // 5. 使用标签名
    try {
      const locator = page.locator(element.tag).nth(snapshot.elements.indexOf(element))
      return locator
    } catch {
      return null
    }
  }

  /**
   * 查找元素在 Snapshot 中的信息
   */
  findElementInfo(snapshot: PageSnapshot, ref: string): SnapshotElement | null {
    return snapshot.elements.find((el) => el.ref === ref) || null
  }
}

// 导出单例
export const snapshotManager = new SnapshotManager()
