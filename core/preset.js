/**
 * 万象阁 · 提示词预设库（阿砚第四批 · 4-a E3；三家都有：事件计时器 ✓ 世界记忆引擎 ✓ 工作流助手 ✓）
 *
 * 依据＝4-a：**E3 是三家，不是两家**，按“三家才刚需”这条线必须做。
 *   它给的证据是工作流助手的 `taskWorkflowPresets[]`（颗粒度到**单个任务**），我们现读：**一条都没有**
 *   （全库 `preset` 只有“预设名册”和“预设色板”两种语义）。
 *
 * 要做成什么样（照抄形状、按我们自己的流程重写）：
 *   ① 多套命名：每套一个名字 ＋ 时间 ＋ 字数
 *   ② 内置不可删：内置那几套标“内置”，可以另存为副本，⛔ 不许删
 *   ③ 颗粒度可以到“单个块”：允许只存「世界推演」这一块，不必整套
 *   ④ 导入导出带 `kind` ＋ `version`（形状照 `core/bundle.js`）
 *   ⑤ **切换时不重建**：应用预设只改设置，⛔ 触发重算
 *
 * 这一层不碰 UI、不碰 pipeline：只做“预设是什么、怎么存、怎么验、怎么应用”四件事。
 */

import { trimText } from './utils.js';
import {
    DEFAULT_PROMPT_WORLD, DEFAULT_PROMPT_CHARS, DEFAULT_JAILBREAK, DEFAULT_INJECT_HEADER,
} from './config.js';

/** 导出件的形状（与 bundle.js 同一套习惯：kind ＋ version） */
export const PRESET_KIND = 'wanxiangge-prompt-presets';
export const PRESET_VERSION = 1;

/** 四个“块”：每块一个设置字段＋一个 effectivePrompt 语义＋一个人话名 */
export const PROMPT_BLOCKS = [
    { key: 'promptWorld', kind: 'world', label: '世界推演', builtin: DEFAULT_PROMPT_WORLD },
    { key: 'promptChars', kind: 'chars', label: '角色状态／平行事件', builtin: DEFAULT_PROMPT_CHARS },
    { key: 'jailbreak', kind: 'jailbreak', label: '破限词', builtin: DEFAULT_JAILBREAK },
    { key: 'injectHeader', kind: 'header', label: '注入块开头', builtin: DEFAULT_INJECT_HEADER },
];

const BLOCK_BY_KIND = new Map(PROMPT_BLOCKS.map((b) => [b.kind, b]));

/** 内置那四套（每块一份，⛔ 不可删；要改就“另存为副本”） */
export function builtinPresets() {
    return PROMPT_BLOCKS.map((b) => ({
        id: 'builtin:' + b.kind,
        name: '内置 · ' + b.label,
        builtin: true,
        at: 0,
        blocks: { [b.key]: b.builtin },
        chars: { [b.key]: String(b.builtin).length },
    }));
}

/**
 * 列出全部预设：内置在前，用户在后（用户按时间倒序）。
 * @param {object} settings
 */
export function listPresets(settings) {
    const raw = Array.isArray(settings && settings.promptPresets) ? settings.promptPresets : [];
    const user = raw
        .filter((p) => p && typeof p === 'object' && p.name && p.blocks && typeof p.blocks === 'object')
        .map((p) => ({
            id: String(p.id || ''),
            name: String(p.name),
            builtin: false,
            at: Number(p.at) || 0,
            blocks: Object.assign({}, p.blocks),
            chars: Object.fromEntries(Object.entries(p.blocks).map(([k, v]) => [k, String(v == null ? '' : v).length])),
        }))
        .sort((a, b) => Number(b.at) - Number(a.at));
    return builtinPresets().concat(user);
}

/** 某套预设一共多少字、含哪几块（人话） */
export function describePreset(p) {
    const blocks = p && p.blocks ? Object.keys(p.blocks) : [];
    const chars = blocks.reduce((n, k) => n + String((p.blocks[k] == null ? '' : p.blocks[k])).length, 0);
    const names = blocks.map((k) => {
        const b = PROMPT_BLOCKS.find((x) => x.key === k);
        return b ? b.label : k;
    });
    return String(chars) + ' 字 · ' + (names.length ? names.join('／') : '空');
}

/** 预设名不能空、不能重名（重名会让“删除/应用”分不清） */
export function checkPresetName(settings, name, ignoreId) {
    const n = trimText(name);
    if (!n) { return { ok: false, reason: '名字不能为空' }; }
    const clash = listPresets(settings).some((p) => p.id !== ignoreId && trimText(p.name) === n);
    if (clash) { return { ok: false, reason: '已经有同名的预设：' + n }; }
    return { ok: true, name: n };
}

/**
 * 存一套新预设（“另存为”）。
 * @param {object} settings
 * @param {{name:string, blocks:object}} input blocks 的键必须是 PROMPT_BLOCKS 里的 key
 * @returns {{ok:boolean, preset?:object, reason?:string}}
 */
export function buildPreset(settings, input) {
    const name = trimText(input && input.name);
    const nameOk = checkPresetName(settings, name);
    if (!nameOk.ok) { return { ok: false, reason: nameOk.reason }; }
    const raw = (input && input.blocks) || {};
    const blocks = {};
    for (const b of PROMPT_BLOCKS) {
        if (Object.prototype.hasOwnProperty.call(raw, b.key)) {
            const v = String(raw[b.key] == null ? '' : raw[b.key]);
            /* 只存“有内容”的块：空块等于没说，存了反而会被误当成“空白覆盖” */
            if (trimText(v)) { blocks[b.key] = v; }
        }
    }
    if (!Object.keys(blocks).length) {
        return { ok: false, reason: '一套里至少要有一块有内容' };
    }
    const at = Date.now();
    const preset = {
        id: 'p' + String(at) + '-' + String(Math.floor(Math.random() * 1e6)),
        name: nameOk.name,
        at,
        blocks,
    };
    return { ok: true, preset };
}

/** 应用一套预设：只改设置里“它带的那几块”，返回改了哪几块（⛔ 触发重算） */
export function planApply(settings, presetId) {
    const p = listPresets(settings).find((x) => x.id === presetId);
    if (!p) { return { ok: false, reason: '没有这套预设' }; }
    const patch = {};
    const applied = [];
    for (const b of PROMPT_BLOCKS) {
        if (Object.prototype.hasOwnProperty.call(p.blocks, b.key)) {
            patch[b.key] = String(p.blocks[b.key]);
            applied.push(b.key);
        }
    }
    if (!applied.length) { return { ok: false, reason: '这套预设是空的' }; }
    return { ok: true, preset: p, patch, applied };
}

/** 导出（形状照 bundle.js：kind ＋ version ＋ items） */
export function exportPresets(settings) {
    const user = listPresets(settings).filter((p) => !p.builtin);
    return {
        kind: PRESET_KIND,
        version: PRESET_VERSION,
        at: Date.now(),
        items: user.map((p) => ({ name: p.name, at: p.at, blocks: Object.assign({}, p.blocks) })),
    };
}

/** 收一圈：kind/version/items/块键 全部要合法（⛔ 静默半收） */
export function verifyPresets(payload) {
    const rejects = [];
    const p = payload && typeof payload === 'object' ? payload : null;
    if (!p) { return { ok: false, rejects: ['不是对象'] }; }
    if (p.kind !== PRESET_KIND) { rejects.push('kind 不是 ' + PRESET_KIND); }
    if (Number(p.version) !== PRESET_VERSION) { rejects.push('version 不是 ' + String(PRESET_VERSION)); }
    if (!Array.isArray(p.items)) { rejects.push('items 不是数组'); }
    const items = Array.isArray(p.items) ? p.items : [];
    const seen = new Set();
    for (const [i, it] of items.entries()) {
        if (!it || typeof it !== 'object') { rejects.push('第 ' + String(i + 1) + ' 条不是对象'); continue; }
        if (!trimText(it.name)) { rejects.push('第 ' + String(i + 1) + ' 条没有名字'); }
        if (seen.has(trimText(it.name))) { rejects.push('名字重复：' + trimText(it.name)); }
        seen.add(trimText(it.name));
        const blocks = it.blocks && typeof it.blocks === 'object' ? it.blocks : null;
        if (!blocks || !Object.keys(blocks).length) { rejects.push('第 ' + String(i + 1) + ' 条没有块'); continue; }
        for (const k of Object.keys(blocks)) {
            if (!PROMPT_BLOCKS.some((b) => b.key === k)) { rejects.push('第 ' + String(i + 1) + ' 条里有不认识的块：' + k); }
        }
    }
    return { ok: rejects.length === 0, rejects };
}

/** 导入：只收合法的，逐条给结果（⛔ 一条坏就整包拒） */
export function importPresets(settings, payload) {
    const v = verifyPresets(payload);
    if (!v.ok) { return { ok: false, rejects: v.rejects, added: [] }; }
    const added = [];
    const rejects = [];
    for (const it of payload.items) {
        const r = buildPreset(settings, { name: it.name, blocks: it.blocks });
        if (r.ok) {
            added.push(r.preset);
            /* 让后面的重名检查能看到前面刚加的 */
            settings.promptPresets = (Array.isArray(settings.promptPresets) ? settings.promptPresets : []).concat([r.preset]);
        } else {
            rejects.push(it.name + '：' + r.reason);
        }
    }
    return { ok: added.length > 0, added, rejects };
}

/** 给人看的一行 */
export function presetLine(settings, presetId) {
    const p = listPresets(settings).find((x) => x.id === presetId);
    if (!p) { return '预设：没选'; }
    return p.name + '（' + describePreset(p) + (p.builtin ? '，内置' : '') + '）';
}
