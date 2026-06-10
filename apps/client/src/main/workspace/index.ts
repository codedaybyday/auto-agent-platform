/**
 * Workspace 模块 - 客户端文件沙盒
 */

export {
  WorkspaceSandbox,
  SandboxManager,
  sandboxManager,
  type SandboxConfig,
  type FileOperationResult
} from './sandbox.js'

export {
  setCurrentUser,
  getCurrentUser,
  fileReadTool,
  fileWriteTool,
  fileListTool,
  fileDeleteTool,
  fileStatsTool,
  workspaceStatsTool,
  type FileReadInput,
  type FileReadOutput,
  type FileWriteInput,
  type FileWriteOutput,
  type FileListInput,
  type FileListOutput,
  type FileDeleteInput,
  type FileDeleteOutput,
  type FileStatsInput,
  type FileStatsOutput,
  type WorkspaceStatsOutput
} from './file-tools.js'
