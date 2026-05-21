/**
 * Robust Element Locator
 * 4-layer fallback strategy (browser-use style)
 *
 * Layer 1: Element Hash (most precise)
 * Layer 2: Stable Hash (survives DOM style changes)
 * Layer 3: Semantic Match (attributes + text)
 * Layer 4: Coordinate (last resort)
 */

import { Page, Locator } from 'playwright'
import { ElementSignature, ElementHashMap, computeElementHash, extractElementSignature, getXPath } from '../dom/element-hash.js'

export interface LocationResult {
  locator: Locator
  strategy: 'hash' | 'stable-hash' | 'semantic' | 'coordinate'
  confidence: number
  signature?: ElementSignature
}

export class RobustLocator {
  private hashMap: ElementHashMap | null = null
  private currentPage: Page | null = null

  /**
   * Build hash map from current page
   * Call this before locating elements
   */
  async buildHashMap(page: Page): Promise<void> {
    this.currentPage = page

    // Get all interactive elements from page
    const signatures = await page.evaluate(() => {
      interface ElementData {
        index: number
        tag: string
        id?: string
        name?: string
        type?: string
        ariaLabel?: string
        placeholder?: string
        hashInput: string
        stableHashInput: string
        bounds: {
          x: number
          y: number
          width: number
          height: number
        }
      }

      const results: ElementData[] = []

      // Find all interactive elements
      const selectors = [
        'button',
        'a[href]',
        'input',
        'textarea',
        'select',
        '[role="button"]',
        '[role="link"]',
        '[role="textbox"]',
        '[role="searchbox"]',
        '[role="combobox"]',
        '[role="checkbox"]',
        '[role="radio"]',
        '[contenteditable="true"]',
        '[tabindex]:not([tabindex="-1"])',
      ]

      const seen = new Set<Element>()
      let index = 0

      for (const selector of selectors) {
        const elements = document.querySelectorAll(selector)
        for (const el of elements) {
          if (seen.has(el)) continue
          seen.add(el)

          // Check visibility
          const rect = el.getBoundingClientRect()
          if (rect.width === 0 || rect.height === 0) continue

          // Check if in viewport (with some margin)
          const viewportHeight = window.innerHeight
          const viewportWidth = window.innerWidth
          if (rect.bottom < -viewportHeight ||
              rect.top > viewportHeight * 2 ||
              rect.right < -viewportWidth ||
              rect.left > viewportWidth * 2) {
            continue
          }

          // Extract signature
          const sig: ElementData = {
            index: index++,
            tag: el.tagName.toLowerCase(),
            id: el.id || undefined,
            name: el.getAttribute('name') || undefined,
            type: (el as HTMLInputElement).type || undefined,
            ariaLabel: el.getAttribute('aria-label') || undefined,
            placeholder: el.getAttribute('placeholder') || undefined,
            // Compute hash using element properties
            hashInput: [
              el.tagName.toLowerCase(),
              el.id,
              el.getAttribute('name'),
              (el as HTMLInputElement).type,
              el.getAttribute('aria-label'),
              el.getAttribute('placeholder'),
              el.className,
              Math.round(rect.x),
              Math.round(rect.y),
            ].join('|'),
            stableHashInput: [
              el.tagName.toLowerCase(),
              el.id,
              el.getAttribute('name'),
              (el as HTMLInputElement).type,
              el.getAttribute('aria-label'),
              el.getAttribute('placeholder'),
              // Filter dynamic classes
              el.className?.split(/\s+/).filter(c => {
                const lower = c.toLowerCase()
                return c.length > 0 && ![
                  'focus', 'hover', 'active', 'selected', 'disabled',
                  'loading', 'open', 'expanded', 'visible', 'hidden'
                ].some(p => lower.includes(p))
              }).sort().join(' '),
              Math.round(rect.x),
              Math.round(rect.y),
            ].join('|'),
            bounds: {
              x: Math.round(rect.x),
              y: Math.round(rect.y),
              width: Math.round(rect.width),
              height: Math.round(rect.height),
            },
          }

          results.push(sig)
        }
      }

      return results
    })

    // Convert to ElementSignature with computed hashes
    const elements: ElementSignature[] = signatures.map((sig, idx) => ({
      hash: this.computeHash(sig.hashInput),
      stableHash: this.computeHash(sig.stableHashInput),
      tag: sig.tag,
      role: sig.tag, // Use tag as default role
      id: sig.id,
      name: sig.name,
      type: sig.type,
      ariaLabel: sig.ariaLabel,
      placeholder: sig.placeholder,
      text: sig.ariaLabel || sig.placeholder || sig.name,
      bounds: sig.bounds,
    }))

    this.hashMap = new ElementHashMap(elements)
    console.log(`[RobustLocator] Built hash map with ${elements.length} elements`)
  }

  private computeHash(input: string): string {
    let hash = 0
    for (let i = 0; i < input.length; i++) {
      const char = input.charCodeAt(i)
      hash = ((hash << 5) - hash) + char
      hash = hash & hash
    }
    return hash.toString(16)
  }

  /**
   * Locate element using 4-layer fallback strategy
   */
  async locate(
    page: Page,
    signature: Partial<ElementSignature> & { index?: number }
  ): Promise<LocationResult | null> {
    // Ensure hash map is built
    if (!this.hashMap || this.currentPage !== page) {
      await this.buildHashMap(page)
    }

    if (!this.hashMap) return null

    // Layer 1: Find by index (if provided)
    if (signature.index !== undefined) {
      const el = this.hashMap.getByIndex(signature.index)
      if (el) {
        const locator = await this.findElementBySignature(page, el)
        if (locator) {
          return {
            locator,
            strategy: 'hash',
            confidence: 0.98,
            signature: el,
          }
        }
      }
    }

    // Layer 2: Find by exact hash
    if (signature.hash) {
      const el = this.hashMap.getByHash(signature.hash)
      if (el) {
        const locator = await this.findElementBySignature(page, el)
        if (locator) {
          return {
            locator,
            strategy: 'hash',
            confidence: 0.95,
            signature: el,
          }
        }
      }
    }

    // Layer 3: Find by stable hash
    if (signature.stableHash) {
      const candidates = this.hashMap.getByStableHash(signature.stableHash)
      if (candidates.length > 0) {
        // Pick the one with closest bounds
        const best = candidates[0]
        const locator = await this.findElementBySignature(page, best)
        if (locator) {
          return {
            locator,
            strategy: 'stable-hash',
            confidence: candidates.length === 1 ? 0.85 : 0.75,
            signature: best,
          }
        }
      }
    }

    // Layer 4: Semantic match
    const semanticResult = await this.findBySemantic(page, signature)
    if (semanticResult) {
      return semanticResult
    }

    // Layer 5: Coordinate (last resort)
    if (signature.bounds) {
      const locator = page.locator('*').filter({
        has: page.locator(`:near(:point(${signature.bounds.x + signature.bounds.width / 2}, ${signature.bounds.y + signature.bounds.height / 2}), 30)`)
      })
      const count = await locator.count()
      if (count > 0) {
        return {
          locator: locator.first(),
          strategy: 'coordinate',
          confidence: 0.4,
        }
      }

      // Raw coordinate click
      await page.mouse.click(
        signature.bounds.x + signature.bounds.width / 2,
        signature.bounds.y + signature.bounds.height / 2
      )
      return {
        locator: page.locator('body'),
        strategy: 'coordinate',
        confidence: 0.25,
      }
    }

    return null
  }

  /**
   * Find element by its full signature
   */
  private async findElementBySignature(page: Page, sig: ElementSignature): Promise<Locator | null> {
    // Try multiple strategies in order

    // 1. By ID (most reliable)
    if (sig.id) {
      const locator = page.locator(`#${CSS.escape(sig.id)}`)
      if (await locator.count() > 0) return locator
    }

    // 2. By role + name
    if (sig.ariaLabel || sig.text) {
      const name = sig.ariaLabel || sig.text
      if (sig.role) {
        const locator = page.getByRole(sig.role as any, { name, exact: false })
        if (await locator.count() > 0) return locator.first()
      }
    }

    // 3. By placeholder (input fields)
    if (sig.placeholder) {
      const locator = page.getByPlaceholder(sig.placeholder, { exact: false })
      if (await locator.count() > 0) return locator.first()
    }

    // 4. By tag + type
    if (sig.tag) {
      let selector = sig.tag
      if (sig.type) selector += `[type="${CSS.escape(sig.type)}"]`
      const locator = page.locator(selector)
      if (await locator.count() > 0) return locator.first()
    }

    return null
  }

  /**
   * Find by semantic attributes
   */
  private async findBySemantic(
    page: Page,
    signature: Partial<ElementSignature>
  ): Promise<LocationResult | null> {
    const { tag, role, name, ariaLabel, placeholder, type } = signature

    // Try role + name
    if (role && (name || ariaLabel)) {
      const locator = page.getByRole(role as any, { name: name || ariaLabel, exact: false })
      const count = await locator.count()
      if (count > 0) {
        return {
          locator: locator.first(),
          strategy: 'semantic',
          confidence: 0.8,
        }
      }
    }

    // Try placeholder
    if (placeholder) {
      const locator = page.getByPlaceholder(placeholder, { exact: false })
      const count = await locator.count()
      if (count > 0) {
        return {
          locator: locator.first(),
          strategy: 'semantic',
          confidence: 0.75,
        }
      }
    }

    // Try tag + type
    if (tag) {
      let selector = tag
      if (type) selector += `[type="${CSS.escape(type)}"]`
      const locator = page.locator(selector)
      const count = await locator.count()
      if (count === 1) {
        return {
          locator,
          strategy: 'semantic',
          confidence: 0.6,
        }
      }
    }

    return null
  }

  /**
   * Get current hash map for debugging
   */
  getHashMap(): ElementHashMap | null {
    return this.hashMap
  }
}

// Default instance
export const robustLocator = new RobustLocator()
