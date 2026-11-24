'use strict';
/** Bundle + minify office3d and minify pipeline assets at process start. */
const fs = require('fs');
const path = require('path');

const root = __dirname;
const outDir = path.join(root, '.cache');
const sources = {
  office: path.join(root, 'public', 'office3d.js'),
  pipelineJs: path.join(root, 'public', 'pipeline.js'),
  pipelineCss: path.join(root, 'public', 'pipeline.css'),
  record: path.join(root, 'public', 'record.js'),
  site: path.join(root, 'public', 'site.js'),
};

function stamp() {
  let max = 0;
  for (const p of Object.values(sources)) {
    try { max = Math.max(max, fs.statSync(p).mtimeMs); } catch {}
  }
  return String(Math.round(max));
}

async function build() {
  fs.mkdirSync(outDir, { recursive: true });
  const esbuild = require('esbuild');
  const threeAddons = path.join(root, 'node_modules', 'three', 'examples', 'jsm');
  await esbuild.build({
    entryPoints: [sources.office],
    bundle: true,
    format: 'esm',
    minify: true,
    legalComments: 'none',
    outfile: path.join(outDir, 'office3d.bundle.js'),
    absWorkingDir: root,
    logLevel: 'warning',
    plugins: [{
      name: 'three-addons',
      setup(build) {
        build.onResolve({ filter: /^three\/addons\// }, (args) => ({
          path: path.join(threeAddons, args.path.replace(/^three\/addons\//, '')),
        }));
      },
    }],
  });
  for (const [name, src] of Object.entries({
    'pipeline.js': sources.pipelineJs,
    'pipeline.css': sources.pipelineCss,
    'record.js': sources.record,
    'site.js': sources.site,
  })) {
    const loader = name.endsWith('.css') ? 'css' : 'js';
    await esbuild.build({
      entryPoints: [src],
      outfile: path.join(outDir, name),
      minify: true,
      legalComments: 'none',
      loader: { ['.' + loader]: loader },
      logLevel: 'warning',
      allowOverwrite: true,
    });
  }
  fs.writeFileSync(path.join(outDir, 'stamp'), stamp());
  return {
    dir: outDir,
    stamp: stamp(),
    office: path.join(outDir, 'office3d.bundle.js'),
    files: {
      '/office3d.bundle.js': path.join(outDir, 'office3d.bundle.js'),
      '/pipeline.js': path.join(outDir, 'pipeline.js'),
      '/pipeline.css': path.join(outDir, 'pipeline.css'),
      '/record.js': path.join(outDir, 'record.js'),
      '/site.js': path.join(outDir, 'site.js'),
    },
  };
}

module.exports = { build, stamp, outDir, sources };
if (require.main === module) {
  build().then((r) => {
    console.log('bundled HQ assets', r.stamp, fs.statSync(r.office).size, 'bytes');
  }).catch((e) => { console.error(e); process.exit(1); });
}
