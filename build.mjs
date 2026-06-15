// esbuild ビルド：src/*.ts を所定の .js へトランスパイルする。
//  - レンダラ（ブラウザ）スクリプト：src/<name>.ts → <name>.js（ルート出力。index.html が直接 <script> 読み込み）
//  - Electron メイン/プリロード：src/main.ts → main.js, src/preload.ts → preload.js（Node/CJS）
// 各ファイルは ESM/CJS の import を使わず window.* グローバルで連携するため bundle:false（個別トランスパイル）。
import * as esbuild from 'esbuild';

const RENDERER = [
  'sound', 'game', 'ai', 'mod2048',
  'puyo', 'puyo-ai', 'mod-puyo',
  'rush', 'mod-rush',
  'mod-invaders', 'mod-bomber', 'mod-tetris', 'mod-snake', 'mod-life',
  'mod-breakout', 'mod-td', 'mod-hero', 'mod-pac', 'mod-tron',
  'app',
];

const watch = process.argv.includes('--watch');

const rendererOpts = {
  entryPoints: RENDERER.map((n) => `src/${n}.ts`),
  outdir: '.',
  bundle: false,
  format: 'iife',          // 各ファイルを IIFE で包む（トップレベル const のグローバル衝突を防ぐ／window.* 代入はそのまま有効）
  target: ['chrome120'],   // Electron 同梱の Chromium 想定
  logLevel: 'info',
};

const mainOpts = {
  entryPoints: ['src/main.ts', 'src/preload.ts'],
  outdir: '.',
  bundle: false,
  platform: 'node',
  format: 'cjs',
  target: ['node18'],
  logLevel: 'info',
};

if (watch) {
  const c1 = await esbuild.context(rendererOpts);
  const c2 = await esbuild.context(mainOpts);
  await Promise.all([c1.watch(), c2.watch()]);
  console.log('[build] watching src/ …');
} else {
  await Promise.all([esbuild.build(rendererOpts), esbuild.build(mainOpts)]);
  console.log('[build] done');
}
