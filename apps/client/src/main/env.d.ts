/// <reference types="@electron-toolkit/preload" />

declare namespace NodeJS {
  interface ProcessEnv {
    ELECTRON_RENDERER_URL?: string
  }
}

// Ensure electron types are available
declare module 'electron' {
  export * from 'electron/main'
}
