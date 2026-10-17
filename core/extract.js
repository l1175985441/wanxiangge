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

/*
 * ⚠️ U5（材料 12）：这里原本有一个 `findPair()`，**算错括号且全库从未调用** ✗
 *   代码里只剩它自己那一处定义（grep 全库 0 处使用）⇒ 按 U5 清掉 ✓
 *   ── 下面直接是真正在用的「按结构剥层」实现 ✓
 */

/**
 * 按结构剥掉成对的机器块（整块剥，含标记本身）。
 * 不维护标签名名单：只认"开标记 … 对应的闭标记"这种结构。
 * 标记名认：拉丁字母／下划线／连字符，**也认中文**（例：[状态栏]…[/状态栏]、【正文】…【/正文】）。
 */
const TAG_CHARS = '[A-Za-z_\\u4e00-\\u9fff\\u3040-\\u30ff\\uac00-\\ud7af][\\w\\-\\u4e00-\\u9fff\\u3040-\\u30ff\\uac00-\\ud7af]*';
/*
 * ⭐ U10（材料 12·未覆盖死角）：**纯排版 HTML 标签不能当机器块整块剥** ✓
 *   旧：`<center>—— 十分钟后 ——</center>` 这类过场正文 ✗
 *     内容没句读、也不是台账 ⇒ `looksLikeMachineBlock` 判真 ✗ ⇒ **整块被当机器块删掉** ✗
 *   现在：这些标签只管排版，**不参与整块剥** ✓（内容与标签都留着 ✓）
 */
/*
 * ⚠️ 收紧：只收**纯排版的行内标签** ✓
 *   我上一版把 `var`、`code`、`pre`、`table`、`div` 这些也放进来了 ✗
 *   ⇒ 撞了既有用例（`A<var>x=1</var>B` 本该剥成 `AB` ✗）
 *   现在：只留材料点名的那几个＋同类行内排版标签 ✓
 */
const LAYOUT_TAGS = new Set([
    'b', 'i', 'u', 's', 'em', 'strong', 'span', 'font', 'center', 'p', 'br', 'ruby', 'rt', 'rp',
    'small', 'big', 'sub', 'sup', 'mark', 'del', 'ins', 'q', 'cite', 'abbr', 'wbr', 'hr', 'img',
    'a',
]);

const PAIR_RULES = [
    { open: new RegExp('\\[(' + TAG_CHARS + ')\\]', 'g'), closeOf: (n) => '[/' + n + ']' },
    { open: new RegExp('<(' + TAG_CHARS + ')>', 'g'), closeOf: (n) => '</' + n + '>', html: true },
    { open: new RegExp('\\{\\{(' + TAG_CHARS + ')\\}\\}', 'g'), closeOf: (n) => '{{/' + n + '}}' },
    { open: new RegExp('【(' + TAG_CHARS + ')】', 'g'), closeOf: (n) => '【/' + n + '】' },
];

/**
 * ⭐⭐ 10-16 拿她 **11 层真语料**跑出来的根治：**这个块是“台账”还是“正文”**。
 *   她那张卡把**正文整个包在成对块里** ⇒ 旧逻辑"见块就整块剥"
 *   把正文也剥了（**6675 字 → 30 字**）。而她 §8 要剥的是“**机器块**”，⛔叙述正文。
 *   判据（两边都不误伤）：
 *     · 整块**大多数行是「名字：值」**（且没句读）⇒ **台账块** ⇒ 剥；
 *     · 整块**长且有句读**（，。！？）⇒ **叙述块** ⇒ **留**；
 *     · 拿不准 ⇒ 按老规矩当机器块（保守，⛔ 把不该留的留下来）。
 */
export function looksLikeMachineBlock(inner) {
    const t = asText(inner).trim();
    if (!t) {
        return true;                       // 空块 ⇒ 当机器块
    }
    const hasSentence = /[，。！？；…]/.test(t);
    const lines = t.split(/\n+/).map((x) => x.trim()).filter(Boolean);
    let ledger = 0;
    for (const ln of lines) {
        if (/^[^\s：:]{1,20}\s*[：:＝=]\s*\S{0,24}$/.test(ln)) {
            ledger += 1;
        }
    }
    const ratio = lines.length ? (ledger / lines.length) : 0;
    if (ratio >= 0.6 && !hasSentence) {
        return true;                       // 台账
    }
    if (hasSentence && (t.length >= 60 || lines.length >= 2)) {
        return false;                      // 叙述
    }
    return true;
}

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
                /* ⭐ U10：纯排版标签 ⇒ **不参与整块剥** ✓ */
                if (rule.html && LAYOUT_TAGS.has(String(name || '').toLowerCase())) {
                    m = rx.exec(out);
                    continue;
                }
                const closeTag = rule.closeOf(name);
                const from = m.index + m[0].length;
                const at = out.indexOf(closeTag, from);
                if (at >= 0) {
                    /*
                     * ⭐她 11 层真语料：**台账块才剥，叙述正文块要留**
                     *   ← 旧逻辑“见块就整块剥”把她那张卡的**正文**也剥了（6675 字 → 30 字）。
                     */
                    const inner = out.slice(from, at);
                    if (!looksLikeMachineBlock(inner)) {
                        m = rx.exec(out);
                        continue;   // 叙述块：留着（⛔ 再往下找别的块）
                    }
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
        /*
         * ⭐⭐ 修复 12（材料 02）：**认“带属性的开标签”** ✓
         *   旧：只认精确的 `<name>` ✗ ⇒ 遇到 `<name 属性="x">…</name>` 就**匹配不上** ✗
         *   新：只给 `<…>` 这一对**允许开标签带属性** ✓（其余三种写法一字不动 ✓）
         */
        try {
            const reAttr = new RegExp('<' + name + '(?:\\s[^>]*)?>[\\s\\S]*?<\\/' + name + '>', 'gi');
            out = out.replace(reAttr, () => { removed += 1; return ''; });
        } catch (eAttr) { /* 名字异常就跳过 ✓ */ }
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
        /* ⭐修复 12：同样认**带属性的开标签** ✓（只针对 <…> 这一对 ✓） */
        try {
            const reAttr = new RegExp('<' + name + '(?:\\s[^>]*)?>([\\s\\S]*?)<\\/' + name + '>', 'gi');
            let mmAttr = reAttr.exec(src);
            let gAttr = 0;
            while (mmAttr && gAttr < 200) {
                gAttr += 1;
                const bodyAttr = trimText(mmAttr[1]);
                if (bodyAttr) {
                    parts.push(bodyAttr);
                }
                mmAttr = reAttr.exec(src);
            }
        } catch (eAttr2) { /* 跳过 ✓ */ }
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

    // ② 用户点名的排除标签（**显式排除，绝不回退** ✓）
    const excl = stripNamedBlocks(text, settings.excludeTags);
    text = excl.text;
    removed += excl.removed;
    const exclRemoved = Number(excl.removed) || 0;   /* ⭐修复 12：排除过没排除过，兜底时要分开看 ✓ */

    // ③ 剥 HTML 注释（总开关）
    if (settings.stripHtmlComments !== false) {
        const cmt = stripHtmlComments(text);
        text = cmt.text;
        removed += cmt.removed;
    }

    /*
     * ⭐⭐ 修复 12（材料 02）：**保住“显式排除后”的安全基准** ✓
     *   病根：下面第④步（剥成对机器块）一旦把**包在块里的正文误剥光** ✗
     *         旧代码会退回**原文** ✗ ⇒ **连她明明排除掉的标签内容也一起回来了** ✗✗
     *         （她原话：「我明明排除了那个标签，它还是冒出来」✗）
     *   现在：基准取在**排除与注释都剥完之后** ✓ ⇒ 兜底只能退到这里 ✓
     */
    const safeBaseline = text;
    const baseLen = trimText(safeBaseline).length;

    // ④ 结构剥成对机器块（总开关）
    if (settings.stripPairedBlocks !== false) {
        const paired = stripPairedBlocks(text);
        text = paired.text;
        removed += paired.removed;
    }

    /*
     * ⑤ 剥完（几乎）为空 ⇒ 退回原文（⛔ 不比剥之前更坏）
     *
     * ⭐ 10-16 **拿她 11 层真语料跑出来的坑**：那条消息**原文 6675 字、剥完只剩 30 字**（`【未定位】`）
     *   —— 她那张卡把**正文整个包在成对块里**（§8 早提过这种卡、还说要留总开关）。
     *   原来只判"**全空**"才退回 ⇒ **剩 30 字不算空、兜底不触发** ⇒ 引擎拿 30 个字干活（等于没读到）。
     *   ⇒ 改成"**剩得太少也算被剥没**"：剥完不足原文的 **15%**（且原文够长 ≥200 字）就退回原文。
     */
    const leftLen = trimText(text).length;
    /* ⭐修复 12：阈值改看 **安全基准**（⛔ 原文）✓；且退回的是 safeBaseline ✓ */
    if (!leftLen || (baseLen >= 120 && leftLen < baseLen * 0.15)) {
        /* ⭐修复 12（两全版）：
         *   · **没排除过任何标签** ⇒ 照旧退**原文** ✓（她的老规矩：不许把整楼读成空 ✓）
         *   · **排除过** ⇒ 只能退到 `safeBaseline` ✓
         *     （⛔ 把她明明排除掉的标签内容又放回来 ✗ —— 那正是她报的病 ✗） */
        const backTo = (baseLen > 0 && exclRemoved > 0) ? safeBaseline : original;
        return { text: backTo, removed, fellBack: true };
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
