/**
 * 万象阁 · 人物步拆分（107-B 的纯函数层）
 *
 * 目的：把「谁在前台、谁在后台、空边跳过、前台优先合并」做成**可单测**的纯函数。
 * ⚠️ 尚未接进 stepCharacters 的调用链（接一次崩一次，见回执）；本文件只保证逻辑正确。
 */

/**
 * 按「正文里有没有出场」分两堆。⛔ 不推演、⛔ 不改 picked 本身。
 * @param {Array} picked 本轮要处理的人
 * @param {Set|Array} onStageIds 在场的人 id
 * @returns {{front: Array, back: Array}}
 */
export function splitPicked(picked, onStageIds) {
    const set = onStageIds instanceof Set ? onStageIds : new Set(Array.isArray(onStageIds) ? onStageIds : []);
    const list = Array.isArray(picked) ? picked : [];
    return {
        front: list.filter((c) => c && set.has(c.id)),
        back: list.filter((c) => c && !set.has(c.id)),
    };
}

/**
 * 该发几次、各带谁。
 * @param {{front:Array, back:Array}} sides
 * @param {{splitOn:boolean, frontSystem:string, backSystem:string}} opts
 * @returns {Array<{tag:string, list:Array, sys:string}>} 空边会被跳过
 */
export function planCalls(sides, opts) {
    const s = sides || { front: [], back: [] };
    const o = opts || {};
    if (!o.splitOn) {
        return [{ tag: 'all', list: (s.front || []).concat(s.back || []), sys: '' }];
    }
    const out = [];
    if ((s.front || []).length) {
        out.push({ tag: 'front', list: s.front, sys: o.frontSystem || '' });
    }
    if ((s.back || []).length) {
        out.push({ tag: 'back', list: s.back, sys: o.backSystem || '' });
    }
    return out;
}

/**
 * 合并两侧的 rows：**前台优先**（同一名字两边都出现 ⇒ 后台那条丢）。
 * @param {Array<{rows:Array, quests?:Array}>} sideResults 按调用顺序（前台先）
 * @returns {{rows:Array, quests:Array, dropped:number}}
 */
export function mergeSides(sideResults) {
    const out = [];
    const seen = new Set();
    const quests = [];
    let dropped = 0;
    for (const side of (Array.isArray(sideResults) ? sideResults : [])) {
        for (const row of (Array.isArray(side && side.rows) ? side.rows : [])) {
            const nm = String((row && row.name) || '').trim();
            if (nm && seen.has(nm)) {
                dropped += 1;
                continue;
            }
            if (nm) {
                seen.add(nm);
            }
            out.push(row);
        }
        for (const q of (Array.isArray(side && side.quests) ? side.quests : [])) {
            quests.push(q);
        }
    }
    return { rows: out, quests, dropped };
}

/**
 * 一侧失败也要能继续：只要有一侧成功就 ok。
 * @param {Array<{tag:string, ok:boolean, reason?:string}>} results
 */
export function sideOutcome(results) {
    const list = Array.isArray(results) ? results : [];
    const okSides = list.filter((x) => x && x.ok);
    const fails = list.filter((x) => !x || !x.ok).map((x) => (x && x.tag ? x.tag + '：' : '') + String((x && x.reason) || '没回可用 JSON'));
    return {
        ok: okSides.length > 0,
        fails,
        allFailed: list.length > 0 && okSides.length === 0,
    };
}
