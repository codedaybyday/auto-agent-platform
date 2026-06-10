/**
 * News API 工具
 * 用于获取实时新闻信息
 */

import { log } from '@auto-agent/shared-utils'

// NewsAPI 配置（从环境变量获取 API Key）
const NEWS_API_KEY = process.env.NEWS_API_KEY || ''
const NEWS_API_BASE = 'https://newsapi.org/v2'

export interface NewsQueryParams {
  q?: string              // 关键词
  category?: string       // 分类: business, entertainment, general, health, science, sports, technology
  sources?: string        // 新闻源
  from?: string           // 开始日期 (YYYY-MM-DD)
  to?: string             // 结束日期 (YYYY-MM-DD)
  language?: string       // 语言: en, zh, etc.
  sortBy?: string         // 排序: relevancy, popularity, publishedAt
  pageSize?: number       // 每页数量 (1-100)
}

export interface NewsResult {
  success: boolean
  articles?: Array<{
    title: string
    description: string
    url: string
    publishedAt: string
    source: { name: string }
  }>
  error?: string
  totalResults?: number
}

/**
 * 搜索新闻
 */
export async function searchNews(params: NewsQueryParams): Promise<NewsResult> {
  try {
    if (!NEWS_API_KEY) {
      return {
        success: false,
        error: 'NEWS_API_KEY 未配置，请在 .env 文件中设置'
      }
    }

    // 构建查询参数
    const queryParams = new URLSearchParams({
      apiKey: NEWS_API_KEY,
      language: params.language || 'zh',
      sortBy: params.sortBy || 'publishedAt',
      pageSize: String(params.pageSize || 10),
      ...params.q && { q: params.q },
      ...params.category && { category: params.category },
      ...params.from && { from: params.from },
      ...params.to && { to: params.to }
    })

    const url = `${NEWS_API_BASE}/everything?${queryParams.toString()}`
    log.info('NewsTool', `Searching news: ${params.q || 'latest'}`)

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'AutoAgent/1.0'
      }
    })

    if (!response.ok) {
      const errorText = await response.text()
      log.error('NewsTool', `News API error: ${response.status}`, errorText)
      return {
        success: false,
        error: `News API 请求失败: ${response.status}`
      }
    }

    const data = await response.json()

    if (data.status === 'error') {
      log.error('NewsTool', 'News API returned error:', data.message)
      return {
        success: false,
        error: data.message || 'News API 返回错误'
      }
    }

    // 格式化结果
    const articles = data.articles?.map((article: any) => ({
      title: article.title || '无标题',
      description: article.description || '无描述',
      url: article.url || '',
      publishedAt: article.publishedAt || '',
      source: {
        name: article.source?.name || '未知来源'
      }
    })) || []

    log.info('NewsTool', `Found ${articles.length} articles`)

    return {
      success: true,
      articles,
      totalResults: data.totalResults || 0
    }
  } catch (error) {
    log.error('NewsTool', 'Search news failed:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : '搜索新闻失败'
    }
  }
}

/**
 * 获取热门新闻
 */
export async function getTopHeadlines(params: NewsQueryParams): Promise<NewsResult> {
  try {
    if (!NEWS_API_KEY) {
      return {
        success: false,
        error: 'NEWS_API_KEY 未配置，请在 .env 文件中设置'
      }
    }

    // 构建查询参数
    const queryParams = new URLSearchParams({
      apiKey: NEWS_API_KEY,
      language: params.language || 'zh',
      pageSize: String(params.pageSize || 10),
      ...params.q && { q: params.q },
      ...params.category && { category: params.category }
    })

    const url = `${NEWS_API_BASE}/top-headlines?${queryParams.toString()}`
    log.info('NewsTool', `Fetching top headlines: ${params.q || 'general'}`)

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'AutoAgent/1.0'
      }
    })

    if (!response.ok) {
      const errorText = await response.text()
      log.error('NewsTool', `News API error: ${response.status}`, errorText)
      return {
        success: false,
        error: `News API 请求失败: ${response.status}`
      }
    }

    const data = await response.json()

    if (data.status === 'error') {
      log.error('NewsTool', 'News API returned error:', data.message)
      return {
        success: false,
        error: data.message || 'News API 返回错误'
      }
    }

    // 格式化结果
    const articles = data.articles?.map((article: any) => ({
      title: article.title || '无标题',
      description: article.description || '无描述',
      url: article.url || '',
      publishedAt: article.publishedAt || '',
      source: {
        name: article.source?.name || '未知来源'
      }
    })) || []

    log.info('NewsTool', `Found ${articles.length} headlines`)

    return {
      success: true,
      articles,
      totalResults: data.totalResults || 0
    }
  } catch (error) {
    log.error('NewsTool', 'Get headlines failed:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : '获取头条新闻失败'
    }
  }
}

/**
 * 格式化新闻结果为文本
 */
export function formatNewsResult(result: NewsResult): string {
  if (!result.success) {
    return `❌ ${result.error || '获取新闻失败'}`
  }

  if (!result.articles || result.articles.length === 0) {
    return '未找到相关新闻'
  }

  const lines: string[] = []
  lines.push(`找到 ${result.totalResults} 条新闻，显示前 ${result.articles.length} 条：\n`)

  result.articles.forEach((article, index) => {
    const date = article.publishedAt
      ? new Date(article.publishedAt).toLocaleString('zh-CN')
      : '未知时间'

    lines.push(`${index + 1}. ${article.title}`)
    lines.push(`   来源：${article.source.name} | 时间：${date}`)
    if (article.description) {
      lines.push(`   ${article.description}`)
    }
    lines.push(`   链接：${article.url}`)
    lines.push('')
  })

  return lines.join('\n')
}
