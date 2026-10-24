/**
 * 万象阁 · 构建号升位判据（阿砚第三批 C 档 P1 · D5）
 *
 * 依据＝D5「构建号升位判据（四个号各自的‘何时升／不许升’）」；挡的风险：
 *   用户分不清“我拿到的是新版还是缓存”。
 *
 * 我们的四个号（现读）：
 *   · `manifest.json` 的 `version`        —— 酒馆读它认扩展版本
 *   · `index.js` 的 `VERSION`           —— 面板/日志里自称的版本
 *   · `core/config.js` 的 `APP_VERSION` —— 契约层/体检读它
 *   · `README.md` / `使用说明.md` 标题里的 `v0.3.x` —— 她下载后第一眼看到的
 *
 * 这张表管两件事：
 *   1. **四个号必须一致**（不一致 ⇒ 她看到的是“假版本”，排查会被带偏）
 *   2. **什么时候可以升／不许升**（改代码必升；只改文档不许单升；同一版不许回头降）
 */

/** 四个号在哪、代表什么、什么时候该跟着动 */
export const VERSION_SLOTS = [
    {
        id: 'manifest',
        where: 'manifest.json 的 version',
        role: '酒馆认的扩展版本（装/更新都看它）',
        bumpWhen: '任何进入包的代码/样式/文档改动',
        mustNot: '只改注释、只改自测时⛔ 单独动它（会被误当成新版）',
    },
    {
        id: 'index',
        where: 'index.js 的 VERSION',
        role: '面板与日志里自称的版本',
        bumpWhen: '与 manifest 同一次提交一起升',
        mustNot: '⛔ 落后于 manifest（会显示假版本）',
    },
    {
        id: 'app',
        where: 'core/config.js 的 APP_VERSION',
        role: '契约层/体检/自测读的版本',
        bumpWhen: '与 manifest 同一次提交一起升',
        mustNot: '⛔ 与 manifest 不同步（体检会报假版本）',
    },
    {
        id: 'docs',
        where: 'README.md 与 使用说明.md 的标题',
        role: '她下载后第一眼看到的版本',
        bumpWhen: '发版时一起写',
        mustNot: '⛔ 只升文档不升代码（文档说了新版、包里还是旧的）',
    },
];

/** 语义化补丁号比较：a > b ⇒ 1，相等 ⇒ 0，a < b ⇒ -1（只比 x.y.z 数字段） */
export function compareVersion(a, b) {
    const pa = String(a || '').replace(/[^0-9.]/g, '').split('.').map((x) => Number(x) || 0);
    const pb = String(b || '').replace(/[^0-9.]/g, '').split('.').map((x) => Number(x) || 0);
    const n = Math.max(pa.length, pb.length);
    for (let i = 0; i < n; i += 1) {
        const x = pa[i] || 0;
        const y = pb[i] || 0;
        if (x > y) { return 1; }
        if (x < y) { return -1; }
    }
    return 0;
}

/**
 * 四个号对不对得上。
 * @param {{manifest:string, index:string, app:string, docs:string}} got
 * @returns {{ok:boolean, base:string, mismatched:Array<{slot:string, got:string, expect:string}>}}
 */
export function checkVersionSync(got) {
    const g = got || {};
    const base = String(g.manifest || '');
    const mismatched = [];
    for (const slot of ['index', 'app', 'docs']) {
        const v = String(g[slot] || '');
        if (!v) {
            mismatched.push({ slot, got: '(没读到)', expect: base });
            continue;
        }
        if (compareVersion(v, base) !== 0) {
            mismatched.push({ slot, got: v, expect: base });
        }
    }
    return { ok: mismatched.length === 0 && Boolean(base), base, mismatched };
}

/**
 * 这次改动的“能不能不升版”。
 * @param {{prev:string, next:string, codeChanged:boolean, docsOnly:boolean}} p
 * @returns {{ok:boolean, action:'bump'|'keep'|'reject', reason:string}}
 */
export function decideBump(p) {
    const prev = String((p && p.prev) || '');
    const next = String((p && p.next) || '');
    const docsOnly = p && p.docsOnly === true;
    const codeChanged = p && p.codeChanged === true;
    const cmp = compareVersion(next, prev);
    if (cmp < 0) {
        return { ok: false, action: 'reject', reason: '版本只许往上：' + prev + ' → ' + next + ' 是往回降' };
    }
    if (cmp === 0) {
        if (codeChanged) {
            return { ok: false, action: 'reject', reason: '改了代码却沿用旧号（' + next + '）——她分不清新版还是缓存' };
        }
        return { ok: true, action: 'keep', reason: '只动文档/自测，沿用 ' + next + ' 可以' };
    }
    if (docsOnly) {
        return { ok: true, action: 'bump', reason: '发版级改动，四个号一起抬到 ' + next };
    }
    return { ok: true, action: 'bump', reason: '有代码改动 ⇒ 抬版本；四个号一起到 ' + next };
}

/** 给人看的一行 */
export function versionLine(got) {
    const r = checkVersionSync(got);
    if (r.ok) { return '版本四个号一致：v' + r.base; }
    return '版本四个号不一致（以 manifest v' + r.base + '为准）：'
        + r.mismatched.map((m) => m.slot + '=' + m.got).join('、');
}
