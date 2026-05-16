/**
 * Browser 安全层
 * 参考 OpenClaw 设计，实现 SSRF 防护、URL 校验、私有网络阻断
 */

export interface SecurityPolicy {
  // 允许的主机名白名单（空数组表示允许所有）
  allowedHostnames?: string[]

  // 允许的协议
  allowedProtocols?: string[]

  // 禁止的协议
  blockedProtocols?: string[]

  // 是否允许私有网络访问
  allowPrivateNetworks?: boolean

  // 私有网络 CIDR 列表
  privateNetworkCIDRs?: string[]

  // 允许的端口列表（空数组表示允许所有）
  allowedPorts?: number[]

  // 禁止的端口列表
  blockedPorts?: number[]

  // 是否检查重定向链
  checkRedirectChain?: boolean

  // 最大重定向深度
  maxRedirects?: number
}

export interface NavigationContext {
  url: string
  redirectChain?: string[]
  initiator?: string
  timestamp?: number
}

export interface SecurityCheckResult {
  allowed: boolean
  reason?: string
  code?: string
}

/**
 * 安全错误类型
 */
export class SecurityError extends Error {
  constructor(
    message: string,
    public code: string,
    public url: string
  ) {
    super(message)
    this.name = 'SecurityError'
  }
}

/**
 * 浏览器安全守卫
 */
export class BrowserSecurityGuard {
  private policy: SecurityPolicy

  constructor(policy: SecurityPolicy = {}) {
    this.policy = {
      allowedProtocols: ['http:', 'https:'],
      blockedProtocols: ['file:', 'javascript:', 'data:', 'vbscript:'],
      allowPrivateNetworks: false,
      privateNetworkCIDRs: [
        '127.0.0.0/8',      // Loopback
        '10.0.0.0/8',       // Private Class A
        '172.16.0.0/12',    // Private Class B
        '192.168.0.0/16',   // Private Class C
        '169.254.0.0/16',   // Link-local
        '::1/128',          // IPv6 Loopback
        'fc00::/7',         // IPv6 Unique Local
        'fe80::/10'         // IPv6 Link-local
      ],
      blockedPorts: [
        1,      // tcpmux
        7,      // echo
        9,      // discard
        11,     // systat
        13,     // daytime
        15,     // netstat
        17,     // qotd
        19,     // chargen
        20,     // ftp-data
        21,     // ftp
        22,     // ssh
        23,     // telnet
        25,     // smtp
        37,     // time
        42,     // name
        43,     // nicname
        53,     // domain
        77,     // priv-rjs
        79,     // finger
        87,     // ttylink
        95,     // supdup
        101,    // hostriame
        102,    // iso-tsap
        103,    // gppitnp
        104,    // acr-nema
        109,    // pop2
        110,    // pop3
        111,    // sunrpc
        113,    // auth
        115,    // sftp
        117,    // uucp-path
        119,    // nntp
        123,    // ntp
        135,    // loc-srv / epmap
        139,    // netbios
        143,    // imap2
        179,    // bgp
        389,    // ldap
        465,    // smtp+ssl
        512,    // print / exec
        513,    // login
        514,    // shell
        515,    // printer
        526,    // tempo
        530,    // courier
        531,    // conference
        532,    // netnews
        540,    // uucp
        556,    // remotefs
        563,    // nntp+ssl
        587,    // smtp
        601,    // syslog-conn
        636,    // ldap+ssl
        993,    // imap+ssl
        995,    // pop3+ssl
        2049,   // nfs
        3659,   // apple-sasl
        4045,   // lockd
        6000,   // x11
        6665,   // irc (alternate)
        6666,   // irc (alternate)
        6667,   // irc (default)
        6668,   // irc (alternate)
        6669    // irc (alternate)
      ],
      checkRedirectChain: true,
      maxRedirects: 10,
      ...policy
    }
  }

  /**
   * 检查导航是否允许
   */
  checkNavigation(context: NavigationContext): SecurityCheckResult {
    try {
      // 1. 解析 URL
      const url = new URL(context.url)

      // 2. 检查协议
      const protocolCheck = this.checkProtocol(url.protocol)
      if (!protocolCheck.allowed) {
        return protocolCheck
      }

      // 3. 检查主机名白名单
      const hostnameCheck = this.checkHostname(url.hostname)
      if (!hostnameCheck.allowed) {
        return hostnameCheck
      }

      // 4. 检查端口
      const portCheck = this.checkPort(parseInt(url.port) || (url.protocol === 'https:' ? 443 : 80))
      if (!portCheck.allowed) {
        return portCheck
      }

      // 5. 检查私有网络
      const privateNetworkCheck = this.checkPrivateNetwork(url.hostname)
      if (!privateNetworkCheck.allowed) {
        return privateNetworkCheck
      }

      // 6. 检查重定向链
      if (this.policy.checkRedirectChain && context.redirectChain) {
        const redirectCheck = this.checkRedirectChain(context.redirectChain)
        if (!redirectCheck.allowed) {
          return redirectCheck
        }
      }

      return { allowed: true }
    } catch (error) {
      return {
        allowed: false,
        reason: `Invalid URL: ${error instanceof Error ? error.message : String(error)}`,
        code: 'INVALID_URL'
      }
    }
  }

  /**
   * 检查协议
   */
  private checkProtocol(protocol: string): SecurityCheckResult {
    // 检查禁止的协议
    if (this.policy.blockedProtocols?.includes(protocol)) {
      return {
        allowed: false,
        reason: `Protocol '${protocol}' is blocked for security reasons`,
        code: 'BLOCKED_PROTOCOL'
      }
    }

    // 检查允许的协议
    if (this.policy.allowedProtocols && this.policy.allowedProtocols.length > 0) {
      if (!this.policy.allowedProtocols.includes(protocol)) {
        return {
          allowed: false,
          reason: `Protocol '${protocol}' is not in the allowed list`,
          code: 'DISALLOWED_PROTOCOL'
        }
      }
    }

    return { allowed: true }
  }

  /**
   * 检查主机名
   */
  private checkHostname(hostname: string): SecurityCheckResult {
    if (!this.policy.allowedHostnames || this.policy.allowedHostnames.length === 0) {
      return { allowed: true }
    }

    const isAllowed = this.policy.allowedHostnames.some((allowed) => {
      // 完全匹配
      if (allowed === hostname) return true

      // 通配符匹配 (*.example.com)
      if (allowed.startsWith('*.')) {
        const domain = allowed.slice(2)
        return hostname === domain || hostname.endsWith('.' + domain)
      }

      return false
    })

    if (!isAllowed) {
      return {
        allowed: false,
        reason: `Hostname '${hostname}' is not in the allowed list`,
        code: 'DISALLOWED_HOSTNAME'
      }
    }

    return { allowed: true }
  }

  /**
   * 检查端口
   */
  private checkPort(port: number): SecurityCheckResult {
    // 检查禁止的端口
    if (this.policy.blockedPorts?.includes(port)) {
      return {
        allowed: false,
        reason: `Port ${port} is blocked for security reasons`,
        code: 'BLOCKED_PORT'
      }
    }

    // 检查允许的端口
    if (this.policy.allowedPorts && this.policy.allowedPorts.length > 0) {
      if (!this.policy.allowedPorts.includes(port)) {
        return {
          allowed: false,
          reason: `Port ${port} is not in the allowed list`,
          code: 'DISALLOWED_PORT'
        }
      }
    }

    return { allowed: true }
  }

  /**
   * 检查是否为私有网络
   */
  private checkPrivateNetwork(hostname: string): SecurityCheckResult {
    if (this.policy.allowPrivateNetworks) {
      return { allowed: true }
    }

    // 检查本地主机名
    const localhostNames = ['localhost', '127.0.0.1', '::1', '[::1]']
    if (localhostNames.includes(hostname.toLowerCase())) {
      return {
        allowed: false,
        reason: `Access to localhost is not allowed`,
        code: 'LOCALHOST_ACCESS_DENIED'
      }
    }

    // 检查私有 IP
    if (this.isPrivateIP(hostname)) {
      return {
        allowed: false,
        reason: `Access to private network addresses is not allowed`,
        code: 'PRIVATE_NETWORK_ACCESS_DENIED'
      }
    }

    return { allowed: true }
  }

  /**
   * 检查重定向链
   */
  private checkRedirectChain(redirectChain: string[]): SecurityCheckResult {
    // 检查重定向深度
    if (redirectChain.length > (this.policy.maxRedirects || 10)) {
      return {
        allowed: false,
        reason: `Redirect chain too long (${redirectChain.length} redirects)`,
        code: 'REDIRECT_CHAIN_TOO_LONG'
      }
    }

    // 检查链中的每个 URL
    for (const url of redirectChain) {
      const check = this.checkNavigation({ url })
      if (!check.allowed) {
        return {
          allowed: false,
          reason: `Redirect chain contains blocked URL: ${check.reason}`,
          code: 'REDIRECT_CHAIN_BLOCKED'
        }
      }
    }

    return { allowed: true }
  }

  /**
   * 检查是否为私有 IP
   */
  private isPrivateIP(ip: string): boolean {
    // 移除 IPv6 括号
    ip = ip.replace(/^\[|\]$/g, '')

    // 检查 IPv4
    if (this.isIPv4(ip)) {
      return this.isPrivateIPv4(ip)
    }

    // 检查 IPv6
    if (this.isIPv6(ip)) {
      return this.isPrivateIPv6(ip)
    }

    // 不是 IP，可能是域名
    return false
  }

  /**
   * 检查是否为 IPv4 地址
   */
  private isIPv4(ip: string): boolean {
    const parts = ip.split('.')
    if (parts.length !== 4) return false

    return parts.every((part) => {
      const num = parseInt(part)
      return !isNaN(num) && num >= 0 && num <= 255 && part === num.toString()
    })
  }

  /**
   * 检查 IPv4 是否为私有地址
   */
  private isPrivateIPv4(ip: string): boolean {
    const parts = ip.split('.').map((p) => parseInt(p))

    // 127.0.0.0/8 - Loopback
    if (parts[0] === 127) return true

    // 10.0.0.0/8 - Private Class A
    if (parts[0] === 10) return true

    // 172.16.0.0/12 - Private Class B
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true

    // 192.168.0.0/16 - Private Class C
    if (parts[0] === 192 && parts[1] === 168) return true

    // 169.254.0.0/16 - Link-local
    if (parts[0] === 169 && parts[1] === 254) return true

    // 0.0.0.0/8 - Current network
    if (parts[0] === 0) return true

    return false
  }

  /**
   * 检查是否为 IPv6 地址
   */
  private isIPv6(ip: string): boolean {
    // 简化检查：包含冒号且符合基本格式
    return ip.includes(':') && /^[0-9a-fA-F:]+$/.test(ip)
  }

  /**
   * 检查 IPv6 是否为私有地址
   */
  private isPrivateIPv6(ip: string): boolean {
    // ::1/128 - Loopback
    if (ip === '::1' || ip === '0:0:0:0:0:0:0:1') return true

    // fc00::/7 - Unique Local
    if (ip.toLowerCase().startsWith('fc') || ip.toLowerCase().startsWith('fd')) return true

    // fe80::/10 - Link-local
    if (ip.toLowerCase().startsWith('fe8') ||
        ip.toLowerCase().startsWith('fe9') ||
        ip.toLowerCase().startsWith('fea') ||
        ip.toLowerCase().startsWith('feb')) return true

    return false
  }

  /**
   * 执行安全检查，失败时抛出异常
   */
  assertNavigationAllowed(context: NavigationContext): void {
    const result = this.checkNavigation(context)
    if (!result.allowed) {
      throw new SecurityError(
        result.reason || 'Navigation not allowed',
        result.code || 'SECURITY_ERROR',
        context.url
      )
    }
  }

  /**
   * 更新安全策略
   */
  updatePolicy(policy: Partial<SecurityPolicy>): void {
    this.policy = { ...this.policy, ...policy }
  }

  /**
   * 获取当前策略
   */
  getPolicy(): SecurityPolicy {
    return { ...this.policy }
  }
}

/**
 * 默认安全守卫（严格模式）
 */
export const defaultSecurityGuard = new BrowserSecurityGuard({
  allowPrivateNetworks: false,
  allowedProtocols: ['http:', 'https:'],
  checkRedirectChain: true
})

/**
 * 宽松模式安全守卫（仅阻止危险协议）
 */
export const permissiveSecurityGuard = new BrowserSecurityGuard({
  allowPrivateNetworks: true,
  allowedProtocols: ['http:', 'https:'],
  blockedProtocols: ['file:', 'javascript:', 'data:', 'vbscript:'],
  checkRedirectChain: false
})
