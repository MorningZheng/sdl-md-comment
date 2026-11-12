// 生成内嵌包数据：读 dist\*-studioYYYY.sdlplugin → base64 → tools/packages.data.js
// 用法：node tools/gen-embed.js   （每次出新包后重跑，再重新 compile exe）
const fs = require('fs');
const path = require('path');

const root = 'D:/Object/dotNet/sdl-md-comment';
const dist = path.join(root, 'dist');
const out = path.join(root, 'tools', 'packages.data.js');

const files = fs.readdirSync(dist).filter(f => /-(\d+\.\d+\.\d+\.\d+)-studio(\d{4})\.sdlplugin$/.test(f));
if (!files.length) { console.error('dist 里没有 *-studioYYYY.sdlplugin'); process.exit(1); }

const entries = [];
for (const f of files.sort()) {
	const m = f.match(/-(\d+\.\d+\.\d+\.\d+)-studio(\d{4})\.sdlplugin$/);
	const buf = fs.readFileSync(path.join(dist, f));
	entries.push({ year: m[2], version: m[1], name: f, bytes: buf.length, b64: buf.toString('base64') });
	console.log(`${f}  ${buf.length} bytes`);
}

const body = entries.map(e => `\t'${e.year}': { version: '${e.version}', name: '${e.name}', b64: '${e.b64}' },`).join('\n');
fs.writeFileSync(out, `// 自动生成：node tools/gen-embed.js —— 不要手改；换包后重跑生成器再重新 compile\nglobalThis.__PKGS__ = {\n${body}\n};\n`);
console.log(`written: ${out} (${(fs.statSync(out).size / 1048576).toFixed(1)} MB)`);
