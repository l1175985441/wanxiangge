/**
 * 万象阁 · 提取与清洗（读取控制四格 ＋ 隐私剥壳）
 *
 * 铁律（需求书）：
 *   · 排除靠**结构**判（成对的开闭标签整块剥 ＋ HTML 注释），⛔ 不靠维护一份标签名名单；
 *   · 剥完为空 ⇒ **退回原文**（⛔ 不比剥之前更坏）；
 *   · 留一个总开关（有的卡把正文整个包在成对块里）；
 *   · 提取标签＝只读这些块（留空＝读整条）。
 */

import { getSettings } from './settings.js';
import { toList, trimText, asText, floorLabel } from './utils.js';

/** 在一段文本里找"一起匹配的"第 k 组（同一对标记、同一层） */
function findPair(text, re, k) {
    const all = [];
    const rx = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
    let m = rx.exec(text);
    while (m) {
        all.push([m.index, m.index + m[0].length]);
        m = rx.exec(text);
    }
    const left = all.filter((x) => x[0] === all[k][0]);
    const idx = all.indexOf(all.slice().filter((x) => x[0] > all[k][0] && x[1] <= (left[left.length - 1] || [0, text.length])[1])[0] || all[k]);
    return idx >= 0 ? all[idx] : all[k];
}

/**
 * 按结构剥掉成对的机器块（整块剥，含标记本身）。
 * 不维护标签名名单：只认"开标记 … 对应的闭标记"这种结构。
 * 标记名认：拉丁字母／下划线／连字符，**也认中文**（例：[状态栏]…[/状态栏]、【正文】…【/正文】）。
 */
const TAG_CHARS = '[A-Za-z_\\u4e00-\\u9fff\\u3040-\\u30ff\\uac00-\\ud7af][\\w\\-\\u4e00-\\u9fff\\u3040-\\u30ff\\uac00-\\ud7af]*';
const PAIR_RULES = [
    { open: new RegExp('\\[(' + TAG_CHARS + ')\\]', 'g'), closeOf: (n) => '[/' + n + ']' },
    { open: new RegExp('<(' + TAG_CHARS + ')>', 'g'), closeOf: (n) => '</' + n + '>' },
    { open: new RegExp('\\{\\{(' + TAG_CHARS + ')\\}\\}', 'g'), closeOf: (n) => '{{/' + n + '}}' },
    { open: new RegExp('【(' + TAG_CHARS + ')】', 'g'), closeOf: (n) => '【/' + n + '】' },
];

export function stripPairedBlocks(text) {
    let out = asText(text);
    let removed = 0;

    for (const rule of PAIR_RULES) {
        let guard = 0;
        let again = true;
        while (again && guard < 200) {
            again = false;
            guard += 1;
            const rx = new RegExp(rule.open.source, 'g');
            let m = rx.exec(out);
            while (m) {
                const name = m[1];
                const closeTag = rule.closeOf(name);
                const from = m.index + m[0].length;
                const at = out.indexOf(closeTag, from);
                if (at >= 0) {
                    out = out.slice(0, m.index) + out.slice(at + closeTag.length);
                    removed += 1;
                    again = true;
                    break;
                }
                m = rx.exec(out);
            }
        }
    }
    return { text: out, removed };
}

/** 剥 HTML 注释 */
export function stripHtmlComments(text) {
    const before = asText(text);
    const after = before.replace(/<!--[\s\S]*?-->/g, '');
    return { text: after, removed: before === after ? 0 : 1 };
}

/** 把用户填的标签名洗干净（⚠️ 中文也算合法标签名：JS 的 \w 不认中文，别用它） */
function safeTagName(raw) {
    return trimText(raw).replace(/[^\w\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af-]/g, '');
}

/** 按名单剥指定标签块（认 [标签]…[/标签]、<标签>…</标签>、{{标签}}…{{/标签}}、【标签】…【/标签】） */
export function stripNamedBlocks(text, names) {
    let out = asText(text);
    let removed = 0;
    for (const raw of toList(names)) {
        const name = safeTagName(raw);
        if (!name) {
            continue;
        }
        const pairs = [
            ['[' + name + ']', '[/' + name + ']'],
            ['<' + name + '>', '</' + name + '>'],
            ['{{' + name + '}}', '{{/' + name + '}}'],
            ['【' + name + '】', '【/' + name + '】'],
        ];
        for (const pair of pairs) {
            let guard = 0;
            let at = out.indexOf(pair[0]);
            while (at >= 0 && guard < 200) {
                guard += 1;
                const end = out.indexOf(pair[1], at + pair[0].length);
                if (end < 0) {
                    break;
                }
                out = out.slice(0, at) + out.slice(end + pair[1].length);
                removed += 1;
                at = out.indexOf(pair[0]);
            }
        }
    }
    return { text: out, removed };
}

/** 只取名单里的标签块内容（留空＝读整条） */
export function pickNamedBlocks(text, names) {
    const list = toList(names);
    if (!list.length) {
        return asText(text);
    }
    const src = asText(text);
    const parts = [];
    for (const raw of list) {
        const name = safeTagName(raw);
        if (!name) {
            continue;
        }
        const pairs = [
            ['[' + name + ']', '[/' + name + ']'],
            ['<' + name + '>', '</' + name + '>'],
            ['{{' + name + '}}', '{{/' + name + '}}'],
            ['【' + name + '】', '【/' + name + '】'],
        ];
        for (const pair of pairs) {
            let guard = 0;
            let at = src.indexOf(pair[0]);
            while (at >= 0 && guard < 200) {
                guard += 1;
                const end = src.indexOf(pair[1], at + pair[0].length);
                if (end < 0) {
                    break;
                }
                const body = trimText(src.slice(at + pair[0].length, end));
                if (body) {
                    parts.push(body);
                }
                at = src.indexOf(pair[0], end + pair[1].length);
            }
        }
    }
    return parts.length ? parts.join('\n') : asText(text);
}

/**
 * 一条楼正文 → 引擎实际读到的内容（走四格里那两格）。
 * 顺序：排除标签 → 结构剥成对块（可控）→ 剥注释（可控）→ 提取标签 → 剥空退回原文。
 */
export function cleanMessageText(raw) {
    const settings = getSettings();
    const original = asText(raw);
    if (!trimText(original)) {
        return { text: '', removed: 0, fellBack: false };
    }
    let text = original;
    let removed = 0;

    // ① 提取标签（留空＝读整条；先提取目标块，免得目标块本身被后面的结构剥壳提前吞掉）
    const picked = pickNamedBlocks(text, settings.extractTags);
    if (trimText(picked)) {
        text = picked;
    }

    // ② 用户点名的排除标签
    const excl = stripNamedBlocks(text, settings.excludeTags);
    text = excl.text;
    removed += excl.removed;

    // ③ 结构剥成对机器块（总开关）
    if (settings.stripPairedBlocks !== false) {
        const paired = stripPairedBlocks(text);
        text = paired.text;
        removed += paired.removed;
    }

    // ④ 剥 HTML 注释（总开关）
    if (settings.stripHtmlComments !== false) {
        const cmt = stripHtmlComments(text);
        text = cmt.text;
        removed += cmt.removed;
    }

    // ⑤ 剥完为空 ⇒ 退回原文（⛔ 不比剥之前更坏）
    if (!trimText(text)) {
        return { text: original, removed, fellBack: true };
    }

    return { text, removed, fellBack: false };
}

/** 一串楼 → 拼成一段上下文（带楼层号，模型好认） */
export function cleanMessages(messages) {
    const list = Array.isArray(messages) ? messages : [];
    const parts = [];
    let fellBack = 0;
    for (const item of list) {
        const cleaned = cleanMessageText(item && item.mes);
        if (cleaned.fellBack) {
            fellBack += 1;
        }
        const body = trimText(cleaned.text);
        if (body) {
            parts.push('【' + floorLabel(item.floor) + '】\n' + body);
        }
    }
    return { text: parts.join('\n\n'), fellBack };
}

/** 楼层是不是隐藏的（酒馆里隐藏楼不显示，但我们要照读） */
export function isHiddenMessage(message) {
    if (!message || typeof message !== 'object') {
        return false;
    }
    return message.is_hidden === true || message.hidden === true;
}
