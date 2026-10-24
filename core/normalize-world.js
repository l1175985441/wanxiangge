/**
 * 万象阁 · 世界侧的归一化（阿砚 1-c #7／#2 的前置：把 state.js 里成族的函数搬出来）
 *
 * 为什么搬：`core/state.js` 已经贴着硬线（3045 行 / 硬 3000+），而 1-c #2「迁移即 schema」
 *   还要在 loadState/saveState 两端加 parse —— 不先腾地方，下一步就没处落脚。
 *
 * 这次只搬**依赖最少**的两个（都只用到 `trimText`），先验证“搬出去 + 在 state.js 里 re-export”
 *   这条路是通的；其余几个（normalizeFaction／normalizeWorldPulse 等）依赖 `makeId`／`worldFactKey`，
 *   等这一笔绿了再搬。
 */

import { trimText } from './utils.js';

export function normalizeFactionPillars(raw) {
    const list = Array.isArray(raw) ? raw : (trimText(raw) ? [raw] : []);
    const out = [];
    for (const p of list) {
        const name = typeof p === 'string' ? trimText(p) : trimText(p && p.name);
        if (!name) continue;
        out.push(name.length > 4 ? name.slice(0, 4) : name);
        if (out.length >= 3) break;
    }
    return out;
}

export function normalizeWind(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const topic = trimText(src.topic || src.title || src.name);
    const text = trimText(src.text || src.content || src.note || src.rumor);
    if (!topic && !text) { return null; }
    let kind = String(trimText(src.kind || src.type) || 'rumor').toLowerCase();
    if (!WIND_KINDS.includes(kind)) { kind = 'rumor'; }
    /* 风声层＝未证实传闻：announcement 也只当「有人说有通报」级别，注入侧仍标风声 ⛔ 不当已证实新闻 */
    return {
        topic: topic || (text ? text.slice(0, 24) : ''),
        text: text || topic,
        kind,
        source: trimText(src.source) || 'engine',
        at: Number(src.at) || 0,
        floor: Number.isFinite(Number(src.floor)) ? Number(src.floor) : -1,
    };
}

export function worldFactKey(subject, field) {
    const s = matchKey(subject) || '世界';
    const f = matchKey(field);
    return f ? (s + '｜' + f) : '';
}

export function normalizeWorldFact(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const subject = trimText(src.subject) || '世界';
    const field = trimText(src.field);
    const value = trimText(src.value);
    const key = trimText(src.key) || worldFactKey(subject, field);
    if (!key || !value) {
        return null;
    }
    let source = trimText(src.source) || 'engine';
    if (!['engine', 'book', 'manual', 'narrative'].includes(source)) {
        source = 'engine';
    }
    return {
        key,
        subject,
        field: field || key,
        value,
        source,
        at: Number(src.at) || 0,
        floor: Number.isFinite(Number(src.floor)) ? Number(src.floor) : -1,
    };
}
