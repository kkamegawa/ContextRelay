// @ts-check
import * as esbuild from 'esbuild';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/** @type {esbuild.BuildOptions} */
const webviewConfig = {
  entryPoints: ['src/webview/main.ts'],
  bundle: true,
  outfile: 'dist/webview/main.js',
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  sourcemap: !production,
  minify: production,
};

async function main() {
  if (watch) {
    const webCtx = await esbuild.context(webviewConfig);
    await webCtx.watch();
    console.log('Watching webview bundle...');
  } else {
    await esbuild.build(webviewConfig);
    console.log('Webview build complete.');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
