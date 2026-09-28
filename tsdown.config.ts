import type { UserConfig } from 'tsdown'

export default {
  entry: { client: 'src/client/index.tsx' },
  outDir: 'lib', format: 'cjs', platform: 'browser', dts: false, clean: false,
  deps: { neverBundle: ['react', 'react/jsx-runtime', 'cordis'] },
  outputOptions: {
    entryFileNames: 'client.js', codeSplitting: false,
    banner: 'window.__ModuleLoader__.load({ id: "dsh-model-manager", factory: (require) => {',
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
} satisfies UserConfig
