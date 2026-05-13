import { Browser, BrowserContext, Page, chromium } from 'playwright'
import { BrowserState } from '../agent/types'

export class BrowserTool {
  name = 'browser'
  description = `Control a web browser to navigate websites, interact with web pages, and extract information.
Available actions:
- navigate: Go to a URL
- click: Click on an element by selector
- type: Type text into an input field
- screenshot: Take a screenshot of the current page
- get_text: Get text content of the page or an element
- scroll: Scroll the page
- wait: Wait for a specified time or selector
- back: Go back to the previous page
- forward: Go forward to the next page`

  input_schema = {
    type: 'object' as const,
    properties: {
      action: {
        type: 'string',
        enum: ['navigate', 'click', 'type', 'screenshot', 'get_text', 'scroll', 'wait', 'back', 'forward', 'close'],
        description: 'The browser action to perform'
      },
      url: {
        type: 'string',
        description: 'URL to navigate to (for navigate action)'
      },
      selector: {
        type: 'string',
        description: 'CSS selector for the target element'
      },
      text: {
        type: 'string',
        description: 'Text to type (for type action)'
      },
      direction: {
        type: 'string',
        enum: ['up', 'down'],
        description: 'Scroll direction'
      },
      amount: {
        type: 'number',
        description: 'Scroll amount in pixels or wait time in ms'
      },
      wait_for: {
        type: 'string',
        enum: ['load', 'networkidle', 'domcontentloaded'],
        description: 'When to consider navigation complete'
      }
    },
    required: ['action']
  }

  private state: BrowserState = {
    page: null,
    browser: null,
    context: null,
    currentUrl: null
  }

  async initialize(): Promise<void> {
    if (!this.state.browser) {
      this.state.browser = await chromium.launch({
        headless: false
      })
      this.state.context = await (this.state.browser as Browser).newContext({
        viewport: { width: 1280, height: 720 }
      })
      this.state.page = await (this.state.context as BrowserContext).newPage()
    }
  }

  async execute(args: {
    action: string
    url?: string
    selector?: string
    text?: string
    direction?: 'up' | 'down'
    amount?: number
    wait_for?: 'load' | 'networkidle' | 'domcontentloaded'
  }): Promise<string> {
    try {
      await this.initialize()
      const page = this.state.page as Page

      switch (args.action) {
        case 'navigate':
          if (!args.url) return 'Error: URL is required for navigate action'
          await page.goto(args.url, {
            waitUntil: args.wait_for || 'load'
          })
          this.state.currentUrl = page.url()
          return `Navigated to ${this.state.currentUrl}`

        case 'click':
          if (!args.selector) return 'Error: selector is required for click action'
          await page.click(args.selector)
          return `Clicked element: ${args.selector}`

        case 'type':
          if (!args.selector || args.text === undefined) {
            return 'Error: selector and text are required for type action'
          }
          await page.fill(args.selector, args.text)
          return `Typed text into ${args.selector}`

        case 'screenshot':
          const screenshot = await page.screenshot({
            type: 'png',
            fullPage: args.amount === -1
          })
          const base64Screenshot = screenshot.toString('base64')
          return `Screenshot captured (base64): ${base64Screenshot.substring(0, 100)}...`

        case 'get_text':
          if (args.selector) {
            const element = await page.locator(args.selector).first()
            const text = await element.textContent()
            return text || 'No text found'
          } else {
            const body = await page.locator('body').textContent()
            return body?.substring(0, 5000) || 'No text found'
          }

        case 'scroll':
          const direction = args.direction === 'up' ? -1 : 1
          const amount = args.amount || 300
          type ScrollCallback = (scrollY: number) => void
          const scrollPage: ScrollCallback = (scrollY) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (globalThis as any).scrollBy(0, scrollY)
          }
          await page.evaluate(scrollPage, direction * amount)
          return `Scrolled ${args.direction || 'down'} by ${amount}px`

        case 'wait':
          if (args.selector) {
            await page.waitForSelector(args.selector, { timeout: args.amount || 5000 })
            return `Waited for selector: ${args.selector}`
          } else {
            await page.waitForTimeout(args.amount || 1000)
            return `Waited ${args.amount || 1000}ms`
          }

        case 'back':
          await page.goBack()
          return 'Navigated back'

        case 'forward':
          await page.goForward()
          return 'Navigated forward'

        case 'close':
          await this.close()
          return 'Browser closed'

        default:
          return `Unknown action: ${args.action}`
      }
    } catch (error) {
      return `Browser error: ${error instanceof Error ? error.message : String(error)}`
    }
  }

  async close(): Promise<void> {
    if (this.state.browser) {
      await (this.state.browser as Browser).close()
      this.state = { page: null, browser: null, context: null, currentUrl: null }
    }
  }

  getCurrentUrl(): string | null {
    return this.state.currentUrl
  }
}

export const browserTool = new BrowserTool()
