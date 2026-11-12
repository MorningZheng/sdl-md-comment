// 悬浮批注 一键安装器（tjs 内嵌版）—— 自动寻找已安装的 Trados Studio，安装对应版本的插件
//
// 包数据内嵌（globalThis.__PKGS__，由 tools/gen-embed.js 生成），单文件分发：
//   node tools/gen-embed.js                      # dist 出新包后重跑
//   详见 tools/make-installer.ps1                # 拼接 + tjs compile 出 dist\install-sdl-md-comment.exe
// 终端用户：双击 exe 即可，无需任何运行时。
//
// 用法：install-sdl-md-comment.exe [--force] [--uninstall] [--no-pause]
//
// 机制要点（全部实测）：
//   1) 插件无"注册"环节——Studio 纯目录扫描发现：Packages 里的 .sdlplugin 启动时自动解包
//      到 Unpacked（仅当 Unpacked 不存在时）。安装 = 删旧 Unpacked + 写包进 Packages。
//   2) 找 Trados：读注册表（InstallLocation 反查 SDLTradosStudio.exe），失败退回默认目录。
//   3) 每个大版本一个包（产品名 17 起改名 + 程序集按版本抬号），内嵌表按年份路由。
//   4) 这版 tjs（tjs-lite-min v26.6.0）实测约定：文件 API 只认正斜杠；spawn 只认数组形式
//      且吞参数里的单个反斜杠（注册表键经 bs() 双写）；TextDecoder 不认 utf-16le；
//      **compile 态 copyFile 覆盖已存在文件会 EPERM（run 态正常）——所以写包走 writeFile 字节流**。

const tjs = globalThis.tjs;
const dec = new TextDecoder();

const PLUGIN_ID = 'SdlMdComment';
const EMBEDDED = globalThis.__PKGS__ || {};

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

// base64 → Uint8Array（QuickJS 无 atob；包数据约 3.3MB/个，一次性解码可接受）
function b64decode(s) {
	const T = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
	const clean = s.replace(/[^A-Za-z0-9+/]/g, '');
	const len = clean.length;
	const pad = len % 4 === 0 ? 0 : 4 - (len % 4);
	const bytes = new Uint8Array((len + pad) / 4 * 3 - pad);
	let p = 0;
	for (let i = 0; i < len; i += 4) {
		const n = (T.indexOf(clean[i]) << 18) | (T.indexOf(clean[i + 1] ?? 'A') << 12)
			| ((clean[i + 2] ? T.indexOf(clean[i + 2]) : 0) << 6)
			| (clean[i + 3] ? T.indexOf(clean[i + 3]) : 0);
		bytes[p++] = (n >> 16) & 0xFF;
		if (i + 2 < len) bytes[p++] = (n >> 8) & 0xFF;
		if (i + 3 < len) bytes[p++] = n & 0xFF;
	}
	return bytes;
}

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
	const o = { force: false, uninstall: false, noPause: false };
	for (const a of argv) {
		if (a === '--force') o.force = true;
		else if (a === '--uninstall') o.uninstall = true;
		else if (a === '--no-pause') o.noPause = true;
	}
	return o;
}

// ---------- 安全软件拦截引导 ----------
// 实测（2026-11-12）：新编译 exe 及其全部子进程写 %AppData% 被火绒按调用链拦截（EPERM），
// D 盘不受影响；把 exe 加入火绒信任区后即放行。无法程序化绕过（子进程继承拦截），
// 所以只能引导用户加白后重试。

let avName = '';
async function detectAv() {
	const { out } = await runCapture(['tasklist']);
	if (/HipsTray/i.test(out)) avName = '火绒安全';
}

function printGuide() {
	const who = avName || '安全软件';
	console.error('');
	console.error('[x] 写入被拦截（EPERM）—— 这是 ' + who + ' 在保护 AppData 目录，不是权限问题。');
	console.error('    请将本程序加入 ' + who + ' 信任区（一次性）：');
	console.error('      打开 ' + who + ' → 信任区 → 添加文件 → 选择本 exe → 保存');
	console.error('    然后按回车重试……');
}

async function pauseRetry() {
	try { await tjs.stdin.read(new Uint8Array(64)); } catch { /* 管道无输入 */ }
}

// 编译态写 AppData 会被安全软件拦（EPERM）→ 引导加白 → 按回车后重试（最多 3 轮）
async function guardedWrite(path, bytes) {
	for (let attempt = 0; ; attempt++) {
		try { await tjs.writeFile(path, bytes); return; }
		catch (e) {
			if (!/EPERM/i.test(e.message) || attempt >= 2) throw e;
			printGuide();
			await pauseRetry();
		}
	}
}

async function guardedRemove(path) {
	for (let attempt = 0; ; attempt++) {
		try { await tjs.remove(path); return; }
		catch (e) {
			if (!/EPERM/i.test(e.message) || attempt >= 2) throw e;
			printGuide();
			await pauseRetry();
		}
	}
}

// ---------- 主流程 ----------

const args = parseArgs(tjs.args);

if (!Object.keys(EMBEDDED).length) {
	console.error('[x] 内嵌包数据缺失（__PKGS__ 未注入）——构建产物不完整。');
	tjs.exit(1);
}

if (await studioRunning()) {
	console.error('[x] Trados Studio 正在运行，请先全部关闭再执行。');
	tjs.exit(1);
}
await detectAv();

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
		if (await exists(pkg)) await guardedRemove(pkg);
		console.log(`卸载: Studio ${t.year}  (${exe})`);
		done++;
		continue;
	}

	const pkg = EMBEDDED[t.year];
	if (!pkg) { console.log(`跳过: Studio ${t.year} —— 内嵌数据里没有 ${t.year} 年份的包`); continue; }

	const cur = await installedVersion(unpacked);
	if (!args.force && cur === pkg.version) {
		console.log(`跳过: Studio ${t.year} 已是 ${pkg.version}`);
		continue;
	}

	// 清旧是硬要求：Unpacked 不清，Studio 不会重新解包；残留两份会崩启动
	await rmRf(unpacked);
	await ensureDir(packagesDir);
	// compile 态进程写 AppData 会被火绒拦（dbg4/dbg5 实锤，子进程也继承拦截），写包走 writeFile 字节流 + 加白引导
	const bytes = b64decode(pkg.b64);
	try {
		await guardedWrite(packagesDir + '/' + PLUGIN_ID + '.sdlplugin', bytes);
	} catch (e) {
		console.error(`[x] 写入失败（Studio ${t.year}）: ${e.message}`);
		console.error('    若上面没有出现加白指引，请检查磁盘空间/文件占用后重试。');
		tjs.exit(1);
	}
	console.log(`安装: Studio ${t.year}  ${cur ?? '无'} -> ${pkg.version}  (内嵌 ${pkg.name})`);
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
