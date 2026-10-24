/**
 * 万象阁 · prompt 组装的单一可审计出口（阿砚第三批 硬-3）
 *
 * 依据＝硬-3「递给模型的文本只能从一个函数出去，每一段都能回看‘它怎么来的’」。
 * 四家做法：事件计时器一个函数同时产模板态/渲染态；世界记忆引擎 12 段镜像；世界背面 buildBackstageMessages 唯一出口；
 * 观棋 assembleMainPrompt ＋ 形状住零依赖叶子 ＋ 注入面另有一条。
 *
 * 我们的病（改前）：`pipeline.js` 两处 `fillTemplate(effectivePrompt(...))` 现拼现发；
 *   注入头在 `recall.js` 另起一条；**拼错了没有任何一处能看出来**（未知占位符被 settings.fillTemplate 静默清空）。
 *
 * 这一层做两件事（⛔ 不改模板内容、⛔ 不改提示词措辞）：
 *   1. `render(kind, template, values)` —— **唯一的组装入口**：填占位、算指纹、记下"用了哪些占位/哪些没填上"
 *   2. `noteText(kind, text, extra)`    —— 不是模板拼出来的文本（如注入头）也走同一条记账
 *   3. 读：`sentTraces()` / `lastSent(kind)` / `promptLine()` —— 面板与自测都读它
 */

import { fillTemplate } from './settings.js';
import { digestOf } from './provenance.js';

const MAX_TRACES = 40;
const traces = [];

/** 从模板里挑出所有占位符名字 */
export function placeholdersIn(template) {
    const names = [];
    const s = String(template == null ? '' : template);
    const re = /\{\{([a-zA-Z0-9_]+)\}\}/g;
    let m = re.exec(s);
    while (m) {
        if (!names.includes(m[1])) { names.push(m[1]); }
        m = re.exec(s);
    }
    return names;
}

function pushTrace(trace) {
    traces.push(trace);
    while (traces.length > MAX_TRACES) { traces.shift(); }
    return trace;
}

/**
 * 组装 ＋ 记账（**唯一入口**）。
 * @param {string} kind   'world' | 'chars' | 'inject-header' | …
 * @param {string} template 模板（含 {{占位}}）
 * @param {object} values   填进去的值
 * @returns {string} 真正递出去的文本
 */
export function render(kind, template, values) {
    const tpl = String(template == null ? '' : template);
    const map = (values && typeof values === 'object') ? values : {};
    const text = String(fillTemplate(tpl, map));
    const names = placeholdersIn(tpl);
    const filled = names.filter((n) => Object.prototype.hasOwnProperty.call(map, n));
    const leftover = names.filter((n) => !Object.prototype.hasOwnProperty.call(map, n));
    pushTrace({
        kind: String(kind || 'unknown'),
        at: Date.now(),
        via: 'template',
        chars: Array.from(text).length,
        templateChars: Array.from(tpl).length,
        digest: digestOf(text),
        placeholders: names,
        filled,
        leftover,
        /* 这是"拼错了有没有人看得见"的那一格：未填占位 = 模型将看不到这段内容 */
        hasLeftover: leftover.length > 0,
    });
    return text;
}

/**
 * 不是模板拼出来的文本（注入头、system 等）也走同一条记账。
 * @returns {string} 原样返回，方便内联使用
 */
export function noteText(kind, text, extra) {
    const s = String(text == null ? '' : text);
    const e = (extra && typeof extra === 'object') ? extra : {};
    pushTrace({
        kind: String(kind || 'unknown'),
        at: Date.now(),
        via: String(e.via || 'plain'),
        chars: Array.from(s).length,
        templateChars: Number.isFinite(Number(e.templateChars)) ? Number(e.templateChars) : 0,
        digest: digestOf(s),
        placeholders: [],
        filled: [],
        leftover: [],
        hasLeftover: false,
        note: String(e.note || ''),
    });
    return s;
}

/** 全部记账（最新在最后） */
export function sentTraces() {
    return traces.slice();
}

/** 某一类最近一次 */
export function lastSent(kind) {
    const k = String(kind || '');
    for (let i = traces.length - 1; i >= 0; i -= 1) {
        if (traces[i].kind === k) { return traces[i]; }
    }
    return null;
}

/** 有没有"拼错了但没人知道"的（未填占位） */
export function leftovers() {
    return traces.filter((t) => t.hasLeftover);
}

/** 给人看的一行（面板/诊断） */
export function promptLine(kind) {
    const t = lastSent(kind);
    if (!t) { return String(kind || '提示词') + '：还没有递出去过'; }
    const when = new Date(t.at).toLocaleTimeString('zh-CN', { hour12: false });
    return String(kind) + '：' + String(t.chars) + ' 字 · ' + when
        + (t.hasLeftover ? ' · ⚠ 有 ' + String(t.leftover.length) + ' 个占位没填上' : '');
}

/** 清空（自测用） */
export function resetTraces() {
    traces.length = 0;
}
