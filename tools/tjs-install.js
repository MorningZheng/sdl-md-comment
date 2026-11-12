// 悬浮批注 一键安装器（tjs 版）—— 自动寻找已安装的 Trados Studio，安装对应版本的插件
//
// 编译为独立 exe 分发（用户无需装任何运行时）：
//   tjs compile tools/tjs-install.js dist/install-sdl-md-comment.exe
// 终端用户：把 exe 和 dist\*.sdlplugin 放同一目录，双击即可。
//
// 用法：install-sdl-md-comment.exe [--force] [--uninstall] [--dist <目录>] [--no-pause]
//
// 本构建 tjs 的三个实测约定（2026-11-12，tjs-lite-min v26.6.0）：
//   1) 文件 API 只认正斜杠：stat('D:\\x') 报 ENOENT，'D:/x' 正常 —— 路径一律 '/'；
//   2) spawn 会吞参数里的单个反斜杠（HKLM\A → HKLMA），双写 \\ 能保真且 reg 接受 ——
//      注册表键一律经 bs() 双写；spawn 只认数组形式 spawn(['prog','arg'...], {stdio})；
//   3) TextDecoder 不认 utf-16le —— plugin.xml 用手写 dec16 解码。
//
// 机制要点（前期全部实测）：
//   - 插件无"注册"环节，Studio 纯目录扫描发现插件：Packages 里的 .sdlplugin 在启动时
//     自动解包到 Unpacked（仅当 Unpacked 不存在）。安装 = 删旧 Unpacked + 拷包进 Packages。
//   - 找 Trados：注册表 InstallLocation 反查 SDLTradosStudio.exe，失败退回默认目录。
//   - 每个大版本一个包（产品名 17 起改名 + 程序集按版本抬号），包文件名里的年份即路由。

const tjs = globalThis.tjs;
const dec = new TextDecoder();

const PLUGIN_ID = 'SdlMdComment';

// 双写反斜杠：spawn 传参会吞单个 \，双写后 reg.exe 收到归一化的单 \（实测通过）
const bs = s => s.replace(/\\/g, '\\\\');
// tjs 文件 API 用正斜杠（反斜杠路径会 ENOENT）
const fwd = s => s.replace(/\\/g, '/');

// 年份 → 注册表键 / AppData 相对路径 / 默认安装目录兜底
const TARGETS = [
	{ year: '2021', reg: 'HKLM\\SOFTWARE\\WOW6432Node\\SDL\\Studio16',    fallback: 'C:\\Program Files (x86)\\SDL\\SDL Trados Studio\\Studio16',    appData: 'SDL/SDL Trados Studio/16' },
	{ year: '2022', reg: 'HKLM\\SOFTWARE\\WOW6432Node\\Trados\\Studio17', fallback: 'C:\\Program Files (x86)\\Trados\\Trados Studio\\Studio17',    appData: 'Trados/Trados Studio/17' },
	{ year: '2024', reg: 'HKLM\\SOFTWARE\\WOW6432Node\\Trados\\Studio18', fallback: 'C:\\Program Files (x86)\\Trados\\Trados Studio\\Studio18',    appData: 'Trados/Trados Studio/18' },
	{ year: '2026', reg: 'HKLM\\SOFTWARE\\Trados\\Studio19',              fallback: 'C:\\Program Files\\Trados\\Trados Studio\\Studio19',          appData: 'Trados/Trados Studio/19' },
];

// ---------- 基础能力 ----------

async function runCapture(args) {
	const p = tjs.spawn(args, { stdout: 'pipe', stderr: 'pipe' });
	let out = '';
	if (p.stdout) for await (const c of p.stdout) out += dec.decode(c, { stream: true });
	if (p.stderr) for await (const c of p.stderr) out += dec.decode(c, { stream: true });
	const st = await p.wait();
	return { code: st.exit_status, out };
}

async function exists(path) {
	try { await tjs.stat(fwd(path)); return true; } catch { return false; }
}

// makeDir 不保证递归，一层层建；路径一律正斜杠
async function ensureDir(dir) {
	const norm = fwd(dir).replace(/\/+$/, '');
	const parts = norm.split('/');
	let cur = parts[0];
	for (let i = 1; i < parts.length; i++) {
		cur += '/' + parts[i];
		if (parts[i] === '' ) continue;
		if (cur.length === 2 && cur[1] === ':') continue; // 盘符根
		if (!(await exists(cur))) { try { await tjs.makeDir(cur); } catch { /* 已存在 */ } }
	}
}

async function rmRf(path) {
	const p = fwd(path);
	let st;
	try { st = await tjs.stat(p); } catch { return; }
	if (!st.isDirectory) { await tjs.remove(p); return; }
	for await (const entry of await tjs.readDir(p)) {
		await rmRf(p + '/' + entry.name);
	}
	await tjs.remove(p);
}

async function readReg(regKey, valueName) {
	const { code, out } = await runCapture(['reg', 'query', bs(regKey), '/v', valueName]);
	if (code !== 0) return null;
	const line = out.split('\n').find(l => l.includes(valueName));
	if (!line) return null;
	return line.split('REG_SZ')[1]?.trim() ?? null;
}

// ---------- 业务 ----------

async function detectStudio(t) {
	const loc = (await readReg(t.reg, 'InstallLocation')) ?? t.fallback;
	const exe = loc.replace(/[\\/]+$/, '') + '\\SDLTradosStudio.exe';
	return (await exists(exe)) ? exe : null;
}

async function studioRunning() {
	const { out } = await runCapture(['tasklist', '/FI', 'IMAGENAME eq SDLTradosStudio.exe']);
	return out.toLowerCase().includes('sdltradosstudio');
}

// plugin.xml 是 UTF-16LE；这版 TextDecoder 不认，手写解码
const dec16 = bytes => {
	let start = bytes[0] === 0xFF && bytes[1] === 0xFE ? 2 : 0;
	let s = '';
	for (let i = start; i + 1 < bytes.length; i += 2) s += String.fromCharCode(bytes[i] | (bytes[i + 1] << 8));
	return s;
};

async function installedVersion(unpackedDir) {
	const xml = fwd(unpackedDir) + '/' + PLUGIN_ID + '.plugin.xml';
	if (!(await exists(xml))) return null;
	try {
		const m = dec16(await tjs.readFile(xml)).match(/<plugin [^>]*version="([^"]+)"/);
		return m ? m[1] : null;
	} catch { return null; }
}

function parseArgs(argv) {
	const o = { force: false, uninstall: false, dist: null, noPause: false };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--force') o.force = true;
		else if (a === '--uninstall') o.uninstall = true;
		else if (a === '--no-pause') o.noPause = true;
		else if (a === '--dist') o.dist = argv[++i];
	}
	return o;
}

// ---------- 主流程 ----------

const args = parseArgs(tjs.args);
const dirname = p => p.replace(/[\\/][^\\/]+$/, '');

// dist 定位：--dist > exe 同级（编译态；tjs run 时 exePath 是 tjs.exe，不命中）> 脚本同级 > 脚本上级 > 当前目录。
// 多个候选目录可能都存在（别的项目的 dist），取第一个真的装着 sdlplugin 的；都没有则报错并列出试过的目录。
const candidates = [];
if (args.dist) candidates.push(fwd(args.dist));
// 编译态：exe 和 *.sdlplugin 同目录分发 → exe 所在目录本身就是包目录；run 态 tjs.exe 目录无意义，两条都给，靠"含 sdlplugin"筛选
const exeDir = fwd(dirname(tjs.exePath));
candidates.push(exeDir);
candidates.push(exeDir + '/dist');
// 脚本定位：run 模式下 import.meta.url 指向脚本；编译态是裸文件名（无路径分隔符），跳过
try {
	const scriptUrl = import.meta.url.replace(/^file:\/\//, '');
	if (/[/\\]/.test(scriptUrl) && /\.js$/i.test(scriptUrl)) {
		const scriptDir = fwd(dirname(scriptUrl));
		candidates.push(scriptDir + '/dist');
		candidates.push(scriptDir + '/../dist');
	}
} catch { /* 无 import.meta 的环境忽略 */ }
candidates.push(fwd(tjs.cwd) + '/dist');

let distDir = null;
const tried = [];
for (const d of candidates) {
	if (!(await exists(d))) { tried.push(d + '（不存在）'); continue; }
	let has = false;
	for await (const e of await tjs.readDir(d)) {
		if (/\.sdlplugin$/i.test(e.name)) { has = true; break; }
	}
	if (has) { distDir = d; break; }
	tried.push(d + '（无 .sdlplugin）');
}
if (!distDir) {
	console.error('[x] 这些目录里都没找到 .sdlplugin：\n  ' + tried.join('\n  ') + '\n用 --dist 指定包目录。');
	tjs.exit(1);
}

if (await studioRunning()) {
	console.error('[x] Trados Studio 正在运行，请先全部关闭再执行。');
	tjs.exit(1);
}

// 找包：悬浮批注-0.7.3.0-studio2022.sdlplugin → 年份路由
const packages = {};
if (await exists(distDir)) {
	for await (const e of await tjs.readDir(distDir)) {
		const m = e.name.match(/-(\d+\.\d+\.\d+\.\d+)-studio(\d{4})\.sdlplugin$/);
		if (m) packages[m[2]] = { name: e.name, path: distDir + '/' + e.name, version: m[1] };
	}
} else {
	console.error('[x] 找不到包目录 ' + distDir + '，用 --dist 指定。');
	tjs.exit(1);
}

let found = 0, done = 0;
for (const t of TARGETS) {
	const exe = await detectStudio(t);
	if (!exe) continue;
	found++;
	const pluginsRoot = fwd(tjs.env.APPDATA) + '/' + t.appData + '/Plugins';
	const packagesDir = pluginsRoot + '/Packages';
	const unpacked = pluginsRoot + '/Unpacked/' + PLUGIN_ID;

	if (args.uninstall) {
		await rmRf(unpacked);
		const pkg = packagesDir + '/' + PLUGIN_ID + '.sdlplugin';
		if (await exists(pkg)) await tjs.remove(pkg);
		console.log(`卸载: Studio ${t.year}  (${exe})`);
		done++;
		continue;
	}

	const pkg = packages[t.year];
	if (!pkg) { console.log(`跳过: Studio ${t.year} —— 没有 ${t.year} 年份的包`); continue; }

	const cur = await installedVersion(unpacked);
	if (!args.force && cur === pkg.version) {
		console.log(`跳过: Studio ${t.year} 已是 ${pkg.version}`);
		continue;
	}

	// 清旧是硬要求：Unpacked 不清，Studio 不会重新解包；残留两份会崩启动
	await rmRf(unpacked);
	await ensureDir(packagesDir);
	await tjs.copyFile(pkg.path, packagesDir + '/' + PLUGIN_ID + '.sdlplugin');
	console.log(`安装: Studio ${t.year}  ${cur ?? '无'} -> ${pkg.version}  (${pkg.name})`);
	done++;
}

if (!found) {
	console.error('[x] 注册表和默认目录里都没找到已安装的 Trados Studio。');
	tjs.exit(1);
}
console.log(done > 0
	? `完成（处理 ${done} 个版本）。重启 Trados Studio 后生效：附加功能 → 悬浮批注。`
	: '所有已装 Studio 都已是最新，无需操作。');

// 双击场景停一下让人看清结果
if (!args.noPause) {
	console.log('\n按回车键退出...');
	try { await tjs.stdin.read(new Uint8Array(16)); } catch { /* 非交互管道 */ }
}
