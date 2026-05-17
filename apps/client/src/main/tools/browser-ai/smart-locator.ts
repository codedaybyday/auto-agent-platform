/**
 * 智能元素定位器
 * 基于 ref + 语义描述的多策略回退定位
 *
 * 定位优先级：
 * 1. data-ref 属性（精确匹配）
 * 2. getByRole + name（ARIA 语义）
 * 3. getByPlaceholder（输入框）
 * 4. getByText（通用文本）
 * 5. getByLabel（表单标签）
 * 6. CSS 选择器（id/class/tag）
 * 7. 坐标定位（最后手段）
 */

import { Page, Locator } from 'playwright'

export interface ElementDescription {
  ref?: number
  tag?: string
  role?: string
  name?: string
  placeholder?: string
  text?: string
  type?: string
  id?: string
  className?: string
  ariaLabel?: string
  bbox?: {
    x: number
    y: number
    width: number
    height: number
  }
}

export interface LocationResult {
  locator: Locator
  strategy: string
  confidence: number
}

export class SmartLocator {
  /**
   * 查找元素 - 多重回退策略
   * @param page Playwright Page
   * @param desc 元素描述（包含 ref 和语义信息）
   * @param autoInjectRef 是否自动重新注入 data-ref
   */
  async locate(
    page: Page,
    desc: ElementDescription,
    autoInjectRef?: (ref: number) => Promise<boolean>
  ): Promise<LocationResult | null> {
    // 策略 0: 尝试 data-ref（如果提供了 ref）
    if (desc.ref !== undefined) {
      const result = await this.tryDataRef(page, desc.ref)
      if (result) return result

      // ref 失效，尝试重新注入
      if (autoInjectRef) {
        console.log(`[SmartLocator] ref=${desc.ref} not found, trying to re-inject...`)
        const injected = await autoInjectRef(desc.ref)
        if (injected) {
          const retry = await this.tryDataRef(page, desc.ref)
          if (retry) return retry
        }
      }
    }

    // 语义回退策略
    const strategies: Array<() => Promise<LocationResult | null>> = [
      () => this.tryRoleAndName(page, desc),
      () => this.tryPlaceholder(page, desc),
      () => this.tryText(page, desc),
      () => this.tryLabel(page, desc),
      () => this.tryCSSSelector(page, desc),
      () => this.tryTagAndType(page, desc),
      () => this.tryCoordinate(page, desc)
    ]

    for (const strategy of strategies) {
      const result = await strategy()
      if (result && await this.validateLocator(result.locator)) {
        console.log(`[SmartLocator] Found using ${result.strategy} (confidence: ${result.confidence})`)
        return result
      }
    }

    console.warn(`[SmartLocator] Failed to locate element:`, desc)
    return null
  }

  /**
   * 验证定位器是否有效且可见
   */
  private async validateLocator(locator: Locator): Promise<boolean> {
    try {
      const count = await locator.count()
      if (count === 0) return false
      // 检查是否至少有一个可见
      for (let i = 0; i < Math.min(count, 3); i++) {
        const visible = await locator.nth(i).isVisible().catch(() => false)
        if (visible) return true
      }
      return count > 0 // 都不可见但存在，也返回true（可能是隐藏菜单）
    } catch {
      return false
    }
  }

  /**
   * 策略 0: 通过 data-ref 定位
   */
  private async tryDataRef(page: Page, ref: number): Promise<LocationResult | null> {
    try {
      const locator = page.locator(`[data-ref="${ref}"]`)
      const count = await locator.count()
      if (count > 0) {
        return { locator: locator.first(), strategy: 'data-ref', confidence: 0.98 }
      }
    } catch {
      // ignore
    }
    return null
  }

  /**
   * 策略 1: 通过 role + name 定位（最可靠的 ARIA 方案）
   */
  private async tryRoleAndName(page: Page, desc: ElementDescription): Promise<LocationResult | null> {
    if (!desc.role) return null

    const name = desc.name || desc.ariaLabel || desc.text
    if (!name) return null

    try {
      // 精确匹配
      let locator = page.getByRole(desc.role as any, { name, exact: true })
      let count = await locator.count()
      if (count === 1) {
        return { locator, strategy: 'role+name(exact)', confidence: 0.95 }
      }

      // 模糊匹配
      locator = page.getByRole(desc.role as any, { name, exact: false })
      count = await locator.count()
      if (count >= 1) {
        return { locator: locator.first(), strategy: 'role+name(fuzzy)', confidence: 0.85 }
      }
    } catch {
      // 失败继续
    }

    return null
  }

  /**
   * 策略 2: 通过 placeholder 定位（输入框专用）
   */
  private async tryPlaceholder(page: Page, desc: ElementDescription): Promise<LocationResult | null> {
    if (!desc.placeholder) return null

    try {
      // 精确匹配
      let locator = page.getByPlaceholder(desc.placeholder, { exact: true })
      let count = await locator.count()
      if (count === 1) {
        return { locator, strategy: 'placeholder(exact)', confidence: 0.92 }
      }

      // 模糊匹配
      locator = page.getByPlaceholder(desc.placeholder, { exact: false })
      count = await locator.count()
      if (count >= 1) {
        return { locator: locator.first(), strategy: 'placeholder(fuzzy)', confidence: 0.82 }
      }
    } catch {
      // 失败继续
    }

    return null
  }

  /**
   * 策略 3: 通过文本定位（按钮、链接通用）
   */
  private async tryText(page: Page, desc: ElementDescription): Promise<LocationResult | null> {
    const text = desc.text || desc.name
    if (!text || text.length < 1) return null

    try {
      // 精确匹配
      let locator = page.getByText(text, { exact: true })
      let count = await locator.count()
      if (count === 1) {
        return { locator, strategy: 'text(exact)', confidence: 0.88 }
      }

      // 模糊匹配
      locator = page.getByText(text, { exact: false })
      count = await locator.count()
      if (count >= 1) {
        // 如果找到多个，尝试结合 tag 过滤
        if (desc.tag) {
          for (let i = 0; i < Math.min(count, 5); i++) {
            const item = locator.nth(i)
            const tagName = await item.evaluate(el => el.tagName.toLowerCase()).catch(() => '')
            if (tagName === desc.tag) {
              return { locator: item, strategy: 'text+tag', confidence: 0.78 }
            }
          }
        }
        return { locator: locator.first(), strategy: 'text(fuzzy)', confidence: 0.68 }
      }
    } catch {
      // 失败继续
    }

    return null
  }

  /**
   * 策略 4: 通过 label 定位
   */
  private async tryLabel(page: Page, desc: ElementDescription): Promise<LocationResult | null> {
    const label = desc.name || desc.ariaLabel
    if (!label) return null

    try {
      const locator = page.getByLabel(label, { exact: false })
      const count = await locator.count()
      if (count >= 1) {
        return { locator: locator.first(), strategy: 'label', confidence: 0.75 }
      }
    } catch {
      // 失败继续
    }

    return null
  }

  /**
   * 策略 5: CSS 选择器
   */
  private async tryCSSSelector(page: Page, desc: ElementDescription): Promise<LocationResult | null> {
    const selectors: string[] = []

    // 安全的 CSS escape
    const safeEscape = (str: string | undefined): string => {
      if (!str) return ''
      // 简单的 escape：只保留字母数字和连字符，其他用下划线替换
      return str.replace(/[^a-zA-Z0-9_-]/g, '_')
    }

    if (desc.id) {
      selectors.push(`#${safeEscape(desc.id)}`)
    }

    if (desc.className) {
      const classes = desc.className.split(/\s+/).filter(c => c.length > 2)
      if (classes.length > 0) {
        selectors.push(`.${safeEscape(classes[0])}`)
      }
    }

    if (desc.tag) {
      if (desc.type) {
        selectors.push(`${desc.tag}[type="${safeEscape(desc.type)}"]`)
      }
      // 只在没有其他选择器时才用纯 tag
      if (selectors.length === 0) {
        selectors.push(desc.tag)
      }
    }

    for (const selector of selectors) {
      try {
        const locator = page.locator(selector)
        const count = await locator.count()
        if (count === 1) {
          return { locator, strategy: `css:${selector}`, confidence: 0.6 }
        }
        // 多个匹配时，尝试用文本过滤
        const textFilter = desc.text || desc.name
        if (count > 1 && textFilter) {
          for (let i = 0; i < Math.min(count, 3); i++) {
            const item = locator.nth(i)
            const textContent = await item.textContent().catch(() => '')
            if (textContent?.includes(textFilter)) {
              return { locator: item, strategy: `css+text:${selector}`, confidence: 0.55 }
            }
          }
        }
      } catch {
        // 失败继续
      }
    }

    return null
  }

  /**
   * 策略 6: tag + type
   */
  private async tryTagAndType(page: Page, desc: ElementDescription): Promise<LocationResult | null> {
    if (!desc.tag) return null

    try {
      let selector = desc.tag
      if (desc.type) {
        selector += `[type="${CSS.escape(desc.type)}"]`
      }

      const locator = page.locator(selector)
      const count = await locator.count()
      if (count >= 1) {
        return { locator: locator.first(), strategy: 'tag+type', confidence: 0.45 }
      }
    } catch {
      // 失败继续
    }

    return null
  }

  /**
   * 策略 7: 坐标定位（最后手段）
   */
  private async tryCoordinate(page: Page, desc: ElementDescription): Promise<LocationResult | null> {
    if (!desc.bbox) return null

    try {
      // 先尝试在坐标位置查找元素
      const centerX = desc.bbox.x + desc.bbox.width / 2
      const centerY = desc.bbox.y + desc.bbox.height / 2

      // 使用 Playwright 的 point 定位
      const locator = page.locator('*').filter({
        has: page.locator(`:near(:point(${centerX}, ${centerY}), 50)`)
      })

      const count = await locator.count()
      if (count > 0) {
        return { locator: locator.first(), strategy: 'coordinate(near)', confidence: 0.35 }
      }

      // 如果连 near 都找不到，返回一个虚拟 locator（点击坐标）
      console.log(`[SmartLocator] Using raw coordinate click at (${centerX}, ${centerY})`)
      await page.mouse.click(centerX, centerY)
      return { locator: page.locator('body'), strategy: 'coordinate(raw)', confidence: 0.25 }
    } catch {
      return null
    }
  }
}

// 默认实例
export const smartLocator = new SmartLocator()
