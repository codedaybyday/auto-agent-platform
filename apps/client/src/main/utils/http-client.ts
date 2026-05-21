/**
 * HTTP 客户端工具
 * 提供统一的 HTTP 请求接口
 */

const HTTP_BASE_URL = (process.env.VITE_SERVER_URL || 'ws://localhost:3001')
  .replace(/^ws/, 'http')
  .replace(/\/ws$/, '')

const DEFAULT_HEADERS = {
  'x-user-id': 'desktop-user'
}

export async function httpGet(path: string) {
  const response = await fetch(`${HTTP_BASE_URL}${path}`, {
    headers: DEFAULT_HEADERS
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`)
  return response.json()
}

export async function httpPost(path: string, body?: any) {
  const response = await fetch(`${HTTP_BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...DEFAULT_HEADERS
    },
    body: body ? JSON.stringify(body) : undefined
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`)
  return response.json()
}

export async function httpDelete(path: string) {
  const response = await fetch(`${HTTP_BASE_URL}${path}`, {
    method: 'DELETE',
    headers: DEFAULT_HEADERS
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`)
  return response.json()
}
