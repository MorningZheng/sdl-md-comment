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
//   2) 找 Trados 双通道：注册表（InstallLocation 反查 SDLTradosStudio.exe）优先，
//      未命中则文件路径扫描（各盘符 × 已知安装目录形状）。
//   3) 每个大版本一个包（产品名 17 起改名 + 程序集按版本抬号），内嵌表按年份路由。
//   4) 这版 tjs（tjs-lite-min v26.6.0）实测约定：文件 API 只认正斜杠；spawn 只认数组形式
//      且吞参数里的单个反斜杠（注册表键经 bs() 双写）；TextDecoder 不认 utf-16le；
//      **compile 态进程写 %AppData% 会被火绒等按调用链拦截（EPERM，D 盘不受影响）——
//      写包走 writeFile 字节流 + guardedWrite 加白引导**。

const tjs = globalThis.tjs;
const dec = new TextDecoder();

const PLUGIN_ID = 'SdlMdComment';
const EMBEDDED = globalThis.__PKGS__ || {};
const T0 = Date.now();

// 双写反斜杠：spawn 传参会吞单个 \，双写后 reg.exe 收到归一化的单 \（实测通过）
const bs = s => s.replace(/\\/g, '\\\\');
// tjs 文件 API 用正斜杠（反斜杠路径会 ENOENT）
const fwd = s => s.replace(/\\/g, '/');
const mb = n => (n / 1048576).toFixed(2) + ' MB';
const secs = () => ((Date.now() - T0) / 1000).toFixed(1) + 's';

// 年份 → 注册表键 / AppData 相对路径 / 目录扫描形状（N = Studio 内部版本）
const TARGETS = [
	{ year: '2021', n: '16', reg: 'HKLM\\SOFTWARE\\WOW6432Node\\SDL\\Studio16',    appData: 'SDL/SDL Trados Studio/16' },
	{ year: '2022', n: '17', reg: 'HKLM\\SOFTWARE\\WOW6432Node\\Trados\\Studio17', appData: 'Trados/Trados Studio/17' },
	{ year: '2024', n: '18', reg: 'HKLM\\SOFTWARE\\WOW6432Node\\Trados\\Studio18', appData: 'Trados/Trados Studio/18' },
	{ year: '2026', n: '19', reg: 'HKLM\\SOFTWARE\\Trados\\Studio19',              appData: 'Trados/Trados Studio/19' },
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
	// 链接防护：junction/symlink 只删链接本身，绝不递归进目标（踩过：顺着 Unpacked 里的
	// ui\dist junction 把仓库前端产物删光）。readLink 能读出目标即为链接。
	try { await tjs.readLink(p); await tjs.remove(p); return; } catch { /* 不是链接，走正常删除 */ }
	if (!st.isDirectory) { await tjs.remove(p); return; }
	for await (const entry of await tjs.readDir(p)) {
		await rmRf(p + '/' + entry.name);
	}
	await tjs.remove(p);
}

// ---------- 注册表读取（reg.exe 子进程，参数风格按宿主形态自动探测） ----------
// 实测：run 态 spawn 吞单个反斜杠（需 bs 双写）；compile 态参数原样传递（单反斜杠才通，
// 双反斜杠反而 exit 1）。首次探测记忆当前形态，之后全走记忆值。

let regStyle = null; // 'raw' | 'bs'
async function detectRegStyle() {
	if (regStyle) return regStyle;
	const key = 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion';
	for (const style of ['raw', 'bs']) {
		const r = await runCapture(['reg', 'query', style === 'bs' ? bs(key) : key, '/v', 'ProgramFilesPath']);
		if (r.code === 0) { regStyle = style; return style; }
	}
	regStyle = 'raw';
	return regStyle;
}

async function regQuery(key, valueArgs) {
	await detectRegStyle();
	const keyArg = regStyle === 'bs' ? bs(key) : key;
	return runCapture(['reg', 'query', keyArg, ...(valueArgs ?? [])]);
}

async function readReg(regKey, valueName) {
	const r = await regQuery(regKey, ['/v', valueName]);
	if (r.code !== 0) return null;
	const line = r.out.split('\n').find(l => l.includes(valueName));
	if (!line) return null;
	return line.split('REG_SZ')[1]?.trim() ?? null;
}

const rot13 = s => s.replace(/[A-Za-z]/g, c => {
	const base = c <= 'Z' ? 65 : 97;
	return String.fromCharCode((c.charCodeAt(0) - base + 13) % 26 + base);
});

// ---------- 安装路径双通道检测 ----------

// 盘符探测：C~Z 逐个 stat 根目录
async function drives() {
	const out = [];
	for (const L of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
		if (await exists(L + ':/')) out.push(L + ':');
	}
	return out;
}

async function detectStudio(t, driveList) {
	// 通道一：SDL 专属注册表键（覆盖自定义安装目录；编译态参数修正后实测可通）
	const regLoc = await readReg(t.reg, 'InstallLocation');
	if (regLoc) {
		const exe = regLoc.replace(/[\\/]+$/, '') + '\\SDLTradosStudio.exe';
		if (await exists(exe)) {
			console.log(`  [检测] Studio ${t.year}: 注册表命中  ${exe}`);
			return { exe: fwd(exe), via: '注册表' };
		}
		console.log(`  [检测] Studio ${t.year}: 注册表有键但 exe 不在（${exe}），继续扫描`);
	} else {
		console.log(`  [检测] Studio ${t.year}: 注册表未命中，继续扫描`);
	}
	// 通道二：文件路径扫描（盘符 × 已知目录形状；16=SDL 品牌在 x86，17+ = Trados 品牌，19 在 64 位 Program Files）
	const shapes = [
		'/Program Files (x86)/SDL/SDL Trados Studio/Studio' + t.n,
		'/Program Files (x86)/Trados/Trados Studio/Studio' + t.n,
		'/Program Files/Trados/Trados Studio/Studio' + t.n,
		'/Program Files/SDL/SDL Trados Studio/Studio' + t.n,
	];
	for (const drive of driveList) {
		for (const shape of shapes) {
			const dir = drive + shape;
			if (await exists(dir + '/SDLTradosStudio.exe')) {
				console.log(`  [检测] Studio ${t.year}: 文件扫描命中  ${dir}`);
				return { exe: dir + '/SDLTradosStudio.exe', via: '文件扫描' };
			}
		}
	}
	// 通道三：Windows 已知路径（MuiCache/UserAssist/App Paths/Uninstall/最近访问/任务栏固定/start2.bin）
	const known = await getKnownHits();
	if (known.has(t.n)) {
		const exe = known.get(t.n);
		console.log(`  [检测] Studio ${t.year}: 已知路径命中  ${exe}`);
		return { exe, via: '已知路径' };
	}
	// 通道四：快捷方式扫描（桌面/开始菜单的 .lnk 能暴露任意自定义安装目录）
	const viaLnk = (await getShortcutHits()).get(t.n);
	if (viaLnk) {
		console.log(`  [检测] Studio ${t.year}: 快捷方式命中  ${viaLnk}`);
		return { exe: viaLnk, via: '快捷方式' };
	}
	// 通道五：有界深度扫描（最后兜底；限深 3，跳过系统/大目录）
	const viaDeep = (await getDeepHits(driveList)).get(t.n);
	if (viaDeep) {
		console.log(`  [检测] Studio ${t.year}: 深度扫描命中  ${viaDeep}`);
		return { exe: viaDeep, via: '深度扫描' };
	}
	console.log(`  [检测] Studio ${t.year}: 未安装`);
	return null;
}

// ---------- 通道三：Windows 已知路径（MuiCache/UserAssist/App Paths/Uninstall/Recent/固定项/start2.bin，结果缓存） ----------

let knownHitsCache = null;
async function getKnownHits() {
	if (knownHitsCache) return knownHitsCache;
	console.log('      已知路径扫描（MuiCache/UserAssist/App Paths/Uninstall/最近访问/任务栏固定）…');
	const map = new Map();
	const add = async (p) => {
		if (!p) return false;
		const n = studioNOf(p);
		if (!n || map.has(n) || !(await exists(p))) return false;
		map.set(n, fwd(p));
		return true;
	};
	await detectRegStyle();
	// MuiCache：系统记录的"运行过的 exe"友好名缓存，值名里就有完整路径
	{
		const r = await regQuery('HKCU\\Software\\Classes\\Local Settings\\Software\\Microsoft\\Windows\\Shell\\MuiCache');
		for (const line of r.out.split('\n')) {
			const m = line.match(/^\s{2,}(.+?SDLTradosStudio\.exe)\./i);
			if (m) await add(m[1]);
		}
	}
	// UserAssist：资源管理器启动记录（值名 ROT13 编码）
	{
		const r = await regQuery('HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\UserAssist\\{CEBFF5CD-ACE2-4F4F-9178-9926F776EE77}\\Count');
		for (const line of r.out.split('\n')) {
			const m = rot13(line).match(/[A-Za-z]:\\[^<>|*?"\r\n]{0,220}?SDLTradosStudio\.exe/i);
			if (m) await add(m[0]);
		}
	}
	// App Paths（两个注册表视图）
	for (const k of [
		'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\SDLTradosStudio.exe',
		'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\App Paths\\SDLTradosStudio.exe',
	]) {
		const r = await regQuery(k, ['/ve']);
		const v = r.out.split('REG_SZ')[1]?.trim();
		if (v && v !== '(value not set)') await add(v);
	}
	// Uninstall 卸载信息（/f 全树搜索后逐键取 InstallLocation）
	for (const root of [
		'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
		'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
	]) {
		const r = await regQuery(root, ['/s', '/f', 'SDLTradosStudio', '/d']);
		const heads = [...new Set(r.out.split('\n').map(l => l.trim()).filter(l => l.startsWith('HKEY_')))];
		for (const h of heads) {
			const d = await regQuery(h.replace(/^HKEY_LOCAL_MACHINE/, 'HKLM'), ['/v', 'InstallLocation']);
			const v = d.out.split('REG_SZ')[1]?.trim();
			if (v) await add(v.replace(/[\\/]+$/, '') + '\\SDLTradosStudio.exe');
		}
	}
	// 最近访问 + 任务栏/开始菜单固定项的 .lnk
	const lnkDirs = [
		fwd(tjs.env.APPDATA) + '/Microsoft/Windows/Recent',
		fwd(tjs.env.APPDATA) + '/Microsoft/Internet Explorer/Quick Launch/User Pinned/TaskBar',
		fwd(tjs.env.APPDATA) + '/Microsoft/Internet Explorer/Quick Launch/User Pinned/StartMenu',
	];
	const lnks = [];
	async function walk(dir, depth) {
		if (depth > 2) return;
		let entries;
		try { entries = await tjs.readDir(dir); } catch { return; }
		for await (const e of entries) {
			if (e.isDirectory) await walk(dir + '/' + e.name, depth + 1);
			else if (/\.lnk$/i.test(e.name)) lnks.push(dir + '/' + e.name);
		}
	}
	for (const d of lnkDirs) await walk(d, 1);
	for (const lnk of lnks) {
		try { for (const c of extractExeFromLnk(await tjs.readFile(lnk))) await add(c); } catch { /* 忽略 */ }
	}
	// Win11 开始菜单数据库（start2.bin，UTF-16 路径启发式）
	try {
		const s2 = fwd(tjs.env.LOCALAPPDATA) + '/Packages/Microsoft.Windows.StartMenuExperienceHost_cw5n1h2txyewy/LocalState/start2.bin';
		const m = dec16(await tjs.readFile(s2)).match(/[A-Za-z]:\\[^<>|*?"]{0,200}?SDLTradosStudio\.exe/gi);
		if (m) for (const c of [...new Set(m)]) await add(c);
	} catch { /* 无该文件忽略 */ }
	knownHitsCache = map;
	return map;
}

// ---------- 残留清扫：自动卸载"版本不对/落点不标准"的本插件副本 ----------
// 背景（2026-11-12 实战案例，另一台机器）：官方安装器按 PlugInName 建 Unpacked\悬浮批注，
// 本安装器写的包被 Studio 解到 Unpacked\SdlMdComment —— 两份同 action id 的 plugin.xml
// 并存 → Studio 启动 IActionService 重复键直接崩。所以安装前必须把本插件的所有落点
// 清成"唯一标准位置"，版本不匹配的（比如 16 的包留在 17 上）也一并卸掉。

// 判断一个 Unpacked 目录是否本插件：manifest 的 PlugInName 是"悬浮批注"，或存在 SdlMdComment.plugin.xml
async function isOurPluginDir(dir) {
	if (await exists(dir + '/' + PLUGIN_ID + '.plugin.xml')) return true;
	try {
		const m = dec.decode(await tjs.readFile(dir + '/pluginpackage.manifest.xml')).match(/<PlugInName>([^<]+)<\/PlugInName>/);
		return !!m && m[1].includes('悬浮批注');
	} catch { return false; }
}

async function sanitizePlugin(t, pluginsRoot) {
	const unpackedRoot = pluginsRoot + '/Unpacked';
	const packagesDir = pluginsRoot + '/Packages';
	const removals = [];
	// Unpacked：所有本插件落点
	if (await exists(unpackedRoot)) {
		for await (const e of await tjs.readDir(unpackedRoot)) {
			if (!e.isDirectory) continue;
			const dir = unpackedRoot + '/' + e.name;
			if (!(await isOurPluginDir(dir))) continue;
			let verdict = '';
			if (e.name !== PLUGIN_ID) verdict = '非标准落点（重复注册风险）';
			else {
				// 标准落点：比对 manifest 版本区间与当前 Studio 大版本
				try {
					const xml = dec.decode(await tjs.readFile(dir + '/pluginpackage.manifest.xml'));
					const m = xml.match(/<RequiredProduct name="([^"]*)" minversion="(\d+)\./);
					if (m) {
						const productOk = (t.n === '16' && m[1] === 'SDLTradosStudio') || (t.n !== '16' && m[1] === 'TradosStudio');
						const majorOk = m[2] === t.n;
						if (!productOk || !majorOk) verdict = `版本不对（包为 Studio ${m[2]}，宿主是 ${t.n}）`;
					}
				} catch { verdict = 'manifest 不可读'; }
			}
			if (verdict) removals.push({ dir, verdict });
		}
	}
	// Packages：本插件的所有包文件（官方安装器保留发布名"悬浮批注-*"，我们写 SdlMdComment.sdlplugin）
	const pkgFiles = [];
	if (await exists(packagesDir)) {
		for await (const e of await tjs.readDir(packagesDir)) {
			if (/\.sdlplugin$/i.test(e.name) && (e.name.includes('悬浮批注') || e.name === PLUGIN_ID + '.sdlplugin')) pkgFiles.push(packagesDir + '/' + e.name);
		}
	}
	for (const r of removals) {
		console.log(`  [清扫] 卸载 ${r.dir.replace(/^.*Unpacked\//, 'Unpacked/')} —— ${r.verdict}`);
		await guardedRmRf(r.dir);
	}
	for (const f of pkgFiles) {
		console.log(`  [清扫] 移除旧包 ${f.replace(/^.*Packages\//, 'Packages/')}`);
		await guardedRemove(f);
	}
	return removals.length + pkgFiles.length;
}

// ---------- 通道三/四：快捷方式扫描 + 有界深度扫描（结果按 StudioNN 缓存） ----------

// plugin.xml 同款 UTF-16 手解，读 .lnk 里的 UTF-16 路径段
const dec16 = bytes => {
	let start = bytes[0] === 0xFF && bytes[1] === 0xFE ? 2 : 0;
	let s = '';
	for (let i = start; i + 1 < bytes.length; i += 2) s += String.fromCharCode(bytes[i] | (bytes[i + 1] << 8));
	return s;
};

// 从 .lnk 字节启发式提取指向 SDLTradosStudio.exe 的盘符路径（UTF-16 段 + ANSI 段各扫一遍）
function extractExeFromLnk(bytes) {
	const texts = [dec16(bytes), String.fromCharCode(...bytes.slice(0, 65536))];
	const found = [];
	for (const text of texts) {
		if (!text) continue;
		const re = /[A-Za-z]:\\[^<>|*?"\r\n]{0,220}?SDLTradosStudio\.exe/gi;
		let m;
		while ((m = re.exec(text)) !== null) found.push(m[0]);
	}
	return [...new Set(found)];
}

// 指向 exe 的路径 → '16'/'17'/… 版本号（父目录必须是 StudioNN，否则无法映射版本）
function studioNOf(exePath) {
	const m = exePath.match(/[/\\]Studio(\d{1,2})[/\\]SDLTradosStudio\.exe$/i);
	return m ? m[1] : null;
}

let shortcutHitsCache = null;
async function getShortcutHits() {
	if (shortcutHitsCache) return shortcutHitsCache;
	console.log('      快捷方式扫描（桌面/开始菜单）…');
	const map = new Map();
	const roots = [
		fwd(tjs.env.USERPROFILE) + '/Desktop',
		'C:/Users/Public/Desktop',
		fwd(tjs.env.APPDATA) + '/Microsoft/Windows/Start Menu/Programs',
		'C:/ProgramData/Microsoft/Windows/Start Menu/Programs',
	];
	const lnks = [];
	async function walk(dir, depth) {
		if (depth > 4) return;
		let entries;
		try { entries = await tjs.readDir(dir); } catch { return; }
		for await (const e of entries) {
			if (e.isDirectory) await walk(dir + '/' + e.name, depth + 1);
			else if (/\.lnk$/i.test(e.name)) lnks.push(dir + '/' + e.name);
		}
	}
	for (const r of roots) await walk(r, 1);
	for (const lnk of lnks) {
		try {
			for (const c of extractExeFromLnk(await tjs.readFile(lnk))) {
				const n = studioNOf(c);
				if (n && !map.has(n) && await exists(c)) map.set(n, fwd(c));
			}
		} catch { /* 不可读的 lnk 忽略 */ }
	}
	shortcutHitsCache = map;
	return map;
}

let deepHitsCache = null;
async function getDeepHits(driveList) {
	if (deepHitsCache) return deepHitsCache;
	console.log('      深度扫描 ' + driveList.join(' ') + '（限深3，跳过系统/大目录）…');
	const map = new Map();
	// 跳过：系统目录 + 海量用户目录（后两者的标准安装位置已由形状扫描覆盖）
	const SKIP = new Set(['Windows', 'Program Files', 'Program Files (x86)', 'ProgramData', 'Users', '$Recycle.Bin', 'System Volume Information', 'PerfLogs', 'Recovery', 'node_modules', '.git']);
	async function walk(dir, depth) {
		if (depth > 3) return;
		let entries;
		try { entries = await tjs.readDir(dir); } catch { return; }
		for await (const e of entries) {
			if (!e.isDirectory) continue;
			if (SKIP.has(e.name) || e.name.startsWith('$') || e.name.startsWith('.')) continue;
			const child = dir + '/' + e.name;
			if (await exists(child + '/SDLTradosStudio.exe')) {
				const n = studioNOf(child + '/SDLTradosStudio.exe');
				if (n && !map.has(n)) map.set(n, child + '/SDLTradosStudio.exe');
			}
			await walk(child, depth + 1);
		}
	}
	for (const drive of driveList) await walk(drive, 1);
	deepHitsCache = map;
	return map;
}

async function studioRunning() {
	const { out } = await runCapture(['tasklist', '/FI', 'IMAGENAME eq SDLTradosStudio.exe']);
	return out.toLowerCase().includes('sdltradosstudio');
}

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
	if (/HipsTray|usysdiag/i.test(out)) avName = '火绒安全';
}

let guideShown = false;
function printGuide() {
	if (guideShown) return;
	guideShown = true;
	const who = avName || '安全软件';
	console.error('');
	console.error('[!] 写入被拦截（EPERM）—— 这是 ' + who + ' 在保护 AppData 目录，不是权限问题。');
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

// 目录级删除的引导环：EPERM 时引导加白后重试整个 rmRf（递归内部不逐个重试）
async function guardedRmRf(path) {
	for (let attempt = 0; ; attempt++) {
		try { await rmRf(path); return; }
		catch (e) {
			if (!/EPERM/i.test(e.message) || attempt >= 2) throw e;
			printGuide();
			await pauseRetry();
		}
	}
}

// ---------- 主流程 ----------

const args = parseArgs(tjs.args);
const years = Object.keys(EMBEDDED).sort();

console.log(`悬浮批注安装器  内嵌 ${years.length} 个包（${years.map(y => y + ' → v' + EMBEDDED[y].version).join('，')}）`);

if (!years.length) {
	console.error('[x] 内嵌包数据缺失（__PKGS__ 未注入）——构建产物不完整。');
	tjs.exit(1);
}

if (await studioRunning()) {
	console.error('[x] Trados Studio 正在运行，请先全部关闭再执行。');
	tjs.exit(1);
}
await detectAv();

console.log(`[1/2] 检测已安装的 Trados Studio（注册表 + 文件路径扫描）…`);
const driveList = await drives();
console.log(`      盘符：${driveList.join(' ')}`);

// 阶段一：全量检测——先扫完所有版本再动手，单个失败不影响其它版本的呈现
const hits = [];
for (const t of TARGETS) {
	const hit = await detectStudio(t, driveList);
	if (hit) hits.push({ t, hit });
}

if (!hits.length) {
	console.error(`[x] ${secs()}：注册表和文件扫描都没找到已安装的 Trados Studio。`);
	tjs.exit(1);
}

// 阶段二：逐个处理；单版本失败记录后继续，不让一个版本拖死全部
const failures = [];
let done = 0;
for (const { t, hit } of hits) {
	const pluginsRoot = fwd(tjs.env.APPDATA) + '/' + t.appData + '/Plugins';
	const packagesDir = pluginsRoot + '/Packages';
	const unpacked = pluginsRoot + '/Unpacked/' + PLUGIN_ID;

	// 先清扫：卸掉版本不对的/落点不标准的副本与旧包（防 IActionService 重复键崩溃）
	try {
		await sanitizePlugin(t, pluginsRoot);
	} catch (e) {
		console.error(`[失败] Studio ${t.year} 清扫被拦（${e.message}）—— 该版本未处理，继续其余版本`);
		failures.push(`Studio ${t.year}: 清扫失败 ${e.message}`);
		continue;
	}

	if (args.uninstall) {
		console.log(`[2/2] 卸载 Studio ${t.year}（${hit.via}）…`);
		await guardedRmRf(unpacked);
		const pkg = packagesDir + '/' + PLUGIN_ID + '.sdlplugin';
		if (await exists(pkg)) await guardedRemove(pkg);
		console.log(`      已移除 ${packagesDir}/${PLUGIN_ID}.sdlplugin 及 Unpacked`);
		done++;
		continue;
	}

	const pkg = EMBEDDED[t.year];
	if (!pkg) { console.log(`[跳过] Studio ${t.year} —— 内嵌数据里没有 ${t.year} 年份的包`); continue; }

	// 清扫后重读：标准落点若版本正确会被保留（removals 不含它），否则为 null
	const cur = await installedVersion(unpacked);
	if (!args.force && cur === pkg.version) {
		// Unpacked 已是最新但 Packages 的包刚被清扫移除——补写回去保持一致
		await ensureDir(packagesDir);
		await guardedWrite(packagesDir + '/' + PLUGIN_ID + '.sdlplugin', b64decode(pkg.b64));
		console.log(`[跳过] Studio ${t.year}（${hit.via}）已是 ${pkg.version}（包文件已补齐）`);
		continue;
	}

	console.log(`[2/2] Studio ${t.year}（${hit.via}）: ${cur ?? '无'} -> ${pkg.version}，解码内嵌包 ${pkg.name}（${mb(pkg.b64.length)}）…`);
	const bytes = b64decode(pkg.b64);
	await guardedRmRf(unpacked);                                   // 清旧是硬要求：不清则 Studio 不重新解包，残留两份会崩启动
	await ensureDir(packagesDir);
	const target = packagesDir + '/' + PLUGIN_ID + '.sdlplugin';
	try {
		await guardedWrite(target, bytes);
	} catch (e) {
		console.error(`[失败] Studio ${t.year}: ${e.message} —— 继续处理其余版本`);
		failures.push(`Studio ${t.year}: ${e.message}`);
		continue;
	}
	// 写后校验：字节数一致才算数
	let ok = false;
	try { ok = (await tjs.stat(fwd(target))).size === bytes.length; } catch {}
	console.log(`      写入 ${fwd(target)}`);
	console.log(`      ${bytes.length} 字节，校验${ok ? '一致 ✓' : '不一致 ✗'}`);
	if (!ok) { failures.push(`Studio ${t.year}: 写后校验不一致`); continue; }
	done++;
}

if (failures.length) {
	for (const f of failures) console.error('[x] ' + f);
	if (!guideShown) console.error('    若未见加白指引，请检查磁盘空间/文件占用后重试。');
	tjs.exit(1);
}
console.log(done > 0
	? `[完成] 处理 ${done} 个版本，耗时 ${secs()}。重启 Trados Studio 后生效：附加功能 → 悬浮批注。`
	: `[完成] 所有已装 Studio 都已是最新，无需操作（耗时 ${secs()}）。`);

// 双击场景停一下让人看清结果
if (!args.noPause) {
	console.log('\n按回车键退出...');
	try { await tjs.stdin.read(new Uint8Array(16)); } catch { /* 非交互管道 */ }
}
