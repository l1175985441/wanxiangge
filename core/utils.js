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

/**
 * ⚠️ 把 **DOM 集合**（children／childNodes／querySelectorAll 的结果）转成真数组。
 *
 * ⛔ 不许用 `Array.from(collection)`／`[...collection]`：那些集合**有 length、有下标，
 *    但没有迭代器**（HTMLCollection/NodeList 的实测差异）⇒ `Array.from` 会直接抛
 *    "undefined is not iterable"（真机与自审里都踩过：一次是 `staging.children.slice`，
 *    一次是 `Array.from(node.childNodes)`）。
 * 这里只按下标取，任何"类数组"都能吃。
 */
export function asArray(list) {
    if (Array.isArray(list)) {
        // ⚠️ 数组里也可能有空槽位（重画／拼接时会出现 undefined）
        //    ⇒ 滤掉，别把 undefined 递给上层代码去读属性（踩过：读 undefined 的 classList 直接抛）
        return list.filter((x) => x !== undefined && x !== null);
    }
    const out = [];
    if (!list) {
        return out;
    }
    const n = Number(list.length);
    if (!Number.isFinite(n) || n <= 0) {
        return out;
    }
    for (let i = 0; i < n; i += 1) {
        const one = list[i];
        if (one !== undefined && one !== null) {
            out.push(one);
        }
    }
    return out;
}

/** 处理成用于匹配的形式：小写、只留中日韩文字与字母数字 */
/**
 * ⭐ 修复单 #7：把"世界事件"统一取成**标题字符串**。
 *
 *   为什么单开一个：`rec.events` 存的是**对象数组**（`title`/`text`），
 *   而两处代码直接对它们 `trimText()` ⇒ 拿到的是 `'[object Object]'`：
 *     · `state.js` 的送达回执拿它当 token 去正文里搜 ⇒ **永远搜不到**（事件永远算"没进"）；
 *     · `recall.js` 拿它当"已归档标题"集合 ⇒ **永远匹配不上**（该挡的没挡住）。
 *   ⇒ 一处定义、三处共用，⛔ 再各写各的。
 */
export function eventTitle(x) {
    if (x === null || x === undefined) {
        return '';
    }
    if (typeof x === 'string') {
        return trimText(x);
    }
    if (typeof x === 'object') {
        return trimText(x.title || x.text || x.name || '');
    }
    return trimText(String(x));
}

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
        .split(/[\n,，、;；|]+/)   /* 依据＝第 7 问 D5：⛔ 按 '/' 拆（「水手月亮/月野兔」会被拆成两条） */
        .map(trimText)
        .filter(Boolean);
}

/** 数字夹取 */
export function clampNumber(v, min, max, fallback) {
    const n = Number(v);
    if (!Number.isFinite(n)) {
        return fallback;
    }
    const clamped = Math.min(max, Math.max(min, n));
    /*
     * 依据＝阿砚 M 表 M14（半修补全）：
     *   上一版只做到“范围是整数才 trunc”，但**小数落在整数范围里还是被截**（temperature 0.4 ⇒ 0）。
     *   现在：只对“**人手填的字符串**”取整（表单给的是 "20.7" ⇒ 20）；
     *           程序传进来的数字原样保留（0.4 就是 0.4）。
     */
    const intRange = Number.isInteger(min) && Number.isInteger(max);
    const fromForm = typeof v === 'string';
    return (intRange && fromForm) ? Math.trunc(clamped) : clamped;
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
