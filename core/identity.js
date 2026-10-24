/**
 * 万象阁 · 实体身份协议（阿砚第三批 硬-5）
 *
 * 依据＝硬-5「实体身份是本地发的 id，不是名字；模型只能原样返回已有 id 或填 null；
 *               名字→实体的解析只有一处，歧义即未定」。
 * 四家的做法都在这一层上，只是叫法不同（ENTITY_ID_PROTOCOL / entity-identity.js / normalizeId）。
 *
 * 我们的病：`buildNameIndex` 是「一个名字键 → 一个角色」，第二个同名角色会把第一个**静默覆盖** ⇒
 *   同名两人必然串；模型返回的名字/编号也没有统一收口。
 *
 * 这一层只做三件事（⛔ 不碰界面、不碰落书）：
 *   1. `entityKey`      —— 名字归一（NFKC ＋ 去空白 ＋ 小写），**只做精确匹配，不做子串**
 *   2. `resolveByName`  —— 名字 → 实体，**只有这一处**；撞名返回 ambiguous（带候选，调用方必须丢并留痕）
 *   3. `coerceModelId`  —— 模型给的 id 只允许「原样返回已有 id」或「null／空 ⇒ 新建」，
 *                          凭空造 id 一律当新建，⛔ 拿它覆盖别人的 canonical id
 */

import { trimText, makeId } from './utils.js';

/* 歧义留痕（诊断/自测用；⛔ 静默吞） */
const ambiguityLog = [];

/** 名字归一（硬-5：NFKC ⇒ 去空白 ⇒ 小写）——⛔ 拿 matchKey 代替：它不做 NFKC，全角ＡＢＣ 跟 abc 认不成一个 */
export function entityKey(name) {
    return String(name == null ? '' : name)
        .normalize('NFKC')
        .replace(/\s+/g, '')
        .toLowerCase();
}

/**
 * 建身份索引：key → { id, ambiguous, candidates[] }
 * 同一 key 撞到**两个不同 id** 就标 ambiguous（⛔ 后者覆盖前者）。
 */
export function buildIdentityIndex(roster) {
    const index = new Map();
    for (const c of Array.isArray(roster) ? roster : []) {
        if (!c || c.ignored) { continue; }
        const id = trimText(c.id);
        if (!id) { continue; }
        const keys = [trimText(c.name)].concat(Array.isArray(c.aliases) ? c.aliases : []);
        for (const raw of keys) {
            const key = entityKey(raw);
            if (!key) { continue; }
            const old = index.get(key);
            if (!old) {
                index.set(key, { id, ambiguous: false, candidates: [id] });
                continue;
            }
            if (old.id === id) { continue; }
            if (!old.candidates.includes(id)) { old.candidates.push(id); }
            old.ambiguous = true;
        }
    }
    return index;
}

/**
 * 名字 → 实体（**唯一解析点**）。
 * @returns {{status:'ok'|'ambiguous'|'missing', id:string, candidates:string[]}}
 */
export function resolveByName(name, rosterOrIndex) {
    const index = (rosterOrIndex instanceof Map) ? rosterOrIndex : buildIdentityIndex(rosterOrIndex);
    const key = entityKey(name);
    if (!key) {
        return { status: 'missing', id: '', candidates: [] };
    }
    const hit = index.get(key);
    if (!hit) {
        return { status: 'missing', id: '', candidates: [] };
    }
    if (hit.ambiguous) {
        noteAmbiguity(key, hit.candidates);
        return { status: 'ambiguous', id: '', candidates: hit.candidates.slice() };
    }
    return { status: 'ok', id: hit.id, candidates: [hit.id] };
}

/** 记一条歧义（同一个 key 只记一次，避免每轮刷屏） */
export function noteAmbiguity(key, candidates) {
    const k = String(key || '');
    if (!k) { return; }
    if (ambiguityLog.some((x) => x.key === k)) { return; }
    ambiguityLog.push({ key: k, candidates: (candidates || []).slice(), at: Date.now() });
}

/** 取走歧义记录（面板/诊断用；取完即清） */
export function drainAmbiguities() {
    const out = ambiguityLog.slice();
    ambiguityLog.length = 0;
    return out;
}

/** 只看不清 */
export function peekAmbiguities() {
    return ambiguityLog.slice();
}

/**
 * 模型返回的实体引用收口：
 *   · 命中已有 id ⇒ 原样返回（**canonical id 不许被替换**）
 *   · null／空／凭空造的 id ⇒ 返回 { id:'', isNew:true }，由调用方**本地发新 id**
 */
export function coerceModelId(raw, roster) {
    const rawId = trimText(raw && typeof raw === 'object' ? (raw.id || raw.charId) : raw);
    const list = Array.isArray(roster) ? roster : [];
    if (!rawId) {
        return { id: '', isNew: true, reason: '模型没给 id（按新建处理，本地发号）' };
    }
    const hit = list.find((c) => c && trimText(c.id) === rawId);
    if (hit) {
        return { id: rawId, isNew: false, reason: '' };
    }
    return { id: '', isNew: true, reason: '模型给了名册里没有的 id（' + rawId + '），不认，按新建发号' };
}

/** 给一个实体发本地 id（⛔ 用名字当 id） */
export function issueEntityId(prefix) {
    return makeId(prefix || 'wxe');
}
