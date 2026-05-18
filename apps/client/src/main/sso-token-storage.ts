import keytar from 'keytar';
import EncryptedStore from 'encrypted-electron-store/main';

/**
 * SSO Token 安全存储器示例，仅供参考
 * 请务必自行实现 SSOTokenStorageInterface 接口，确保安全存储
 * 推荐使用操作系统原生密钥链进行最高级别的安全存储，如：
 * - macOS: Keychain
 * - Windows: Credential Vault
 * - Linux: libsecret
 */
class SSOTokenStorage {
  private serviceName: string;
  private store: ReturnType<typeof EncryptedStore.create<any>>;
  private TOKEN_KEY: string;

  constructor() {
    // 应用服务名称，用于在系统密钥链中标识
    this.serviceName = 'sso-electron-auto-agent';
    this.store = EncryptedStore.create<any>();
    // Token 存储的键名
    this.TOKEN_KEY = '';
    this.store.set(this.TOKEN_KEY, {});
  }

  /**
   * 检查 keytar 是否可用
   */
  isAvailable() {
    try {
      return typeof keytar.setPassword === 'function';
    } catch (error) {
      console.error('keytar 不可用:', error);
      return false;
    }
  }

  /**
   * 获取 SSO token 信息
   * 实现 SSOTokenStorageInterface.get()
   * @returns {Promise<Object>} Token 信息对象
   */
  async get() {
    try {
      let tokenData = null;

      if (this.isAvailable()) {
        // 从系统密钥链读取
        const encryptedData = await keytar.getPassword(this.serviceName, this.TOKEN_KEY);
        if (encryptedData) {
          tokenData = JSON.parse(encryptedData);
        }
      } else {
        // 降级方案：从 electron-store 读取（不推荐用于生产环境）
        console.warn('keytar 不可用，使用明文存储（不推荐）');
        tokenData = this.store.get(this.TOKEN_KEY);
      }

      // 返回 token 信息，如果不存在则返回空对象
      return tokenData || {};
    } catch (error) {
      console.error('读取 SSO Token 失败:', error);
      return {};
    }
  }

  /**
   * 设置 SSO token 信息
   * 实现 SSOTokenStorageInterface.set()
   * @param {Object} token - Token 信息对象
   * @param {string} [token.access_token] - 访问令牌
   * @param {string} [token.refresh_token] - 刷新令牌
   * @param {string} [token.token_exchange_attestation] - 换票证明
   * @param {number} [token.modified_at] - 更新时间戳
   * @returns {Promise<void>}
   */
  async set(token: Record<string, any>) {
    try {
      if (!token) {
        console.warn('尝试存储空的 token 信息');
        return;
      }

      // 序列化 token 数据
      const tokenData = JSON.stringify(token);

      if (this.isAvailable()) {
        // 存储到系统密钥链
        await keytar.setPassword(this.serviceName, this.TOKEN_KEY, tokenData);

        // 在元数据中记录更新时间
        this.store.set(`_meta_${this.TOKEN_KEY}`, {
          exists: true,
          updatedAt: new Date().toISOString(),
        });
      } else {
        // 降级方案：存储到 electron-store（不推荐用于生产环境）
        console.warn('keytar 不可用，使用明文存储（不推荐）');
        this.store.set(this.TOKEN_KEY, token);
      }
    } catch (error) {
      console.error('存储 SSO Token 失败:', error);
      throw error;
    }
  }

  /**
   * 清除 SSO token 信息
   * @returns {Promise<boolean>} 是否清除成功
   */
  async clear() {
    try {
      if (this.isAvailable()) {
        // 从系统密钥链删除
        const deleted = await keytar.deletePassword(this.serviceName, this.TOKEN_KEY);

        // 删除元数据
        this.store.delete(`_meta_${this.TOKEN_KEY}`);

        return deleted;
      } else {
        // 从 electron-store 删除
        this.store.delete(this.TOKEN_KEY);
        return true;
      }
    } catch (error) {
      console.error('清除 SSO Token 失败:', error);
      return false;
    }
  }
}

// 导出单例
export default new SSOTokenStorage();