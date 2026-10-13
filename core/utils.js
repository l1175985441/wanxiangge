/**
 * 万象阁 · 纯工具（不依赖酒馆，可单独演算测试）
 */

/** 安全转成字符串 */
export function asText(v) {
    if (v === null || v === undefined) {
        return '';
    }
    return String(v);
}

/** 去掉首尾空白 */
export function trimText(v) {
    return asText(v).trim();
}

/** 去掉所有空白（认名字、认别名时用） */
export function squeeze(v) {
    return asText(v).replace(/\s+/g, '');
}

/** 处理成用于匹配的形式：小写、只留中日韩文字与字母数字 */
export function matchKey(v) {
    return asText(v)
        .toLowerCase()
        .replace(/[^\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7afa-z0-9]/g, '');
}

/** 把可能是一串的文字拆成干净的数组（支持换行、逗号、中文顿号、分号、斜杠分隔） */
export function toList(v) {
    if (Array.isArray(v)) {
        return v.map(trimText).filter(Boolean);
    }
    return asText(v)
        .split(/[\n,，、;；/|]+/)
        .map(trimText)
        .filter(Boolean);
}

/** 数字夹取 */
export function clampNumber(v, min, max, fallback) {
    const n = Number(v);
    if (!Number.isFinite(n)) {
        return fallback;
    }
    return Math.min(max, Math.max(min, Math.trunc(n)));
}

/** 转义 HTML（手工拼字符串时兜底用） */
export function escapeHtml(v) {
    return asText(v)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/** 生成一个本地唯一 id（不依赖 crypto，老环境也能跑） */
export function makeId(prefix) {
    const rand = Math.random().toString(36).slice(2, 8);
    return asText(prefix || 'id') + '_' + Date.now().toString(36) + '_' + rand;
}

/** 数一数字符数（用于回执"注入多少字"） */
export function countChars(v) {
    return Array.from(asText(v)).length;
}

/** 数组去重（按 key 函数），保持原顺序 */
export function uniqueBy(list, keyFn) {
    const seen = new Set();
    const out = [];
    for (const item of Array.isArray(list) ? list : []) {
        const k = keyFn(item);
        if (seen.has(k)) {
            continue;
        }
        seen.add(k);
        out.push(item);
    }
    return out;
}

/**
 * 楼层号的**统一口径**（条 23）。
 *
 * 全库内部用的是**从 0 起的索引**，而酒馆界面上那条消息自己显示的编号（`.mesIDDisplay`）
 * 也是同一个值 ⇒ 直接写 `#N`，跟她看得见的编号**一一对上**，⛔ 不再各处 +1 各说各话。
 */
export function floorLabel(floor) {
    const n = Number(floor);
    if (!Number.isFinite(n) || n < 0) {
        return '未定位';
    }
    return '#' + String(n);
}

/** 楼层号的说明（面板上写一次，免得她对着 #4 发懵） */
export const FLOOR_NOTE = '楼层号 #N 与酒馆消息头上的编号一致（从 0 起）。';
