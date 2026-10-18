import { defineConfig } from 'tsdown'

const id = 'dsh-aha-tutor'

// Host side: DSH packages come from the runtime; parsing libraries are
// installed as dependencies (pdf.js needs its character maps on disk).
const hostExternal = [
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-credentials',
  '@deepseek-ai/dsh-tools',
  'pdfjs-dist',
  'pdfjs-dist/legacy/build/pdf.mjs',
  'mammoth',
  'jszip',
  'linkedom',
  '@mozilla/readability',
]

// Browser side: React and the platform modules are provided by DSH's module
// loader; everything else (KaTeX included) is bundled.
const clientExternal = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-primitives',
]

export default defineConfig([
  {
    name: id,
    entry: { index: 'src/index.js', agent: 'src/agent.js' },
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: true,
    deps: { neverBundle: hostExternal },
  },
  {
    name: `${id}/client`,
    entry: { client: 'src/client.jsx' },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    dts: false,
    sourcemap: true,
    minify: true,
    clean: false,
    deps: { neverBundle: clientExternal, onlyBundle: false },
    define: { 'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production') },
    // The tip codes on the About page are bundled, so they need no host route.
    loader: { '.png': 'dataurl' },
    outputOptions: {
      entryFileNames: 'client.js',
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
])
