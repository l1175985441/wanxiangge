/**
 * 万象阁 · 标题去括号（阿砚 74 号）
 *
 * 她：标题只留**名词**；括号里的解释（“局势（势力的碰撞）”“每轮记录（展开看…）”）
 *   搬到 `title=` 属性（悬停才看）。
 *
 * 只动**展示文本**：不改 DOM 结构、不改任何 data-* 与事件。
 */

/** 抽出第一对中文括号里的内容；没有就返回 '' */
export function parenText(s) {
    const m = String(s == null ? '' : s).match(/（([^）]*)）/);
    return m ? m[1] : '';
}

/** 把标题里的（…）摘掉（只去第一对，保留后面的文字） */
export function stripParen(s) {
    return String(s == null ? '' : s)
        .replace(/（[^）]*）/g, '')
        .replace(/\s{2,}/g, ' ')
        .trim();
}

/**
 * 把一个元素的文本去括号；被去掉的那句进 `title`。
 * @param {HTMLElement} el
 */
export function tidyText(el) {
    if (!el) { return; }
    /*
     * 75 号：`<summary>` 里除了标题还有一句话行（`.wxg-card-sum-line`）。
     *   直接用 textContent 会连一句话一起拆 ⇒ 只动**标题那个文本节点**。
     */
    const isSummary = String(el.tagName || '').toUpperCase() === 'SUMMARY';
    if (isSummary) {
        /*
         * summary 里的标题可能是**文本节点**（foldCard）也可能是**<span>**（foldable）。
         *   ⛔ 只认 nodeType === 3：真机上对，但模拟宿主里节点常带不全 nodeType ⇒ 误以为“不是文本”直接跳过。
         */
        const first = el.firstChild;
        if (!first) {
            /* 場景：宿主/DOM 实现不给 firstChild（模拟环境就这样）⇒ 退回整句处理，⛔ 直接丢弃 */
            const rawAll = String(el.textContent == null ? '' : el.textContent);
            const pAll = parenText(rawAll);
            const cAll = stripParen(rawAll);
            if (cAll && cAll !== rawAll.trim()) {
                el.textContent = cAll;
                if (pAll && !el.getAttribute('title')) { el.setAttribute('title', pAll); }
            }
            return;
        }
        const isText = (first.nodeType === 3) || (typeof first.nodeValue === 'string' && !first.tagName);
        const raw0 = isText ? String(first.nodeValue == null ? '' : first.nodeValue) : String(first.textContent == null ? '' : first.textContent);
        const paren0 = parenText(raw0);
        const clean0 = stripParen(raw0);
        if (clean0 && clean0 !== raw0.trim()) {
            if (isText) { first.nodeValue = clean0; } else { first.textContent = clean0; }
            if (paren0 && !el.getAttribute('title')) {
                el.setAttribute('title', paren0);
            }
        }
        return;
    }
    const raw = String(el.textContent == null ? '' : el.textContent);
    const paren = parenText(raw);
    const clean = stripParen(raw);
    if (clean && clean !== raw.trim()) {
        el.textContent = clean;
        if (paren && !el.getAttribute('title')) {
            el.setAttribute('title', paren);
        }
    }
}

/**
 * 扫一遍卡头与折叠标题（只动展示文本）。
 * @param {HTMLElement} host
 */
export function tidyHeadings(host) {
    if (!host || typeof host.querySelectorAll !== 'function') { return; }
    /*
     * 77 号：**一个选择器一次查**。
     *   旧：逗号列表一条 querySelectorAll ⇒ 宿主/模拟 DOM 不支持多选择器时**整条丢异常**，
     *   外层 catch 一吞 ⇒ 看上去“代码在、屏上没变”（真机六处括号就是这么活下来的）。
     */
    const sels = ['.wxg-card-h', '.wxg-card-title', '.wxg-card-sum', '.wxg-sec-title', '.wxg-report-h', 'summary'];
    for (const sel of sels) {
        let list = [];
        try { list = Array.from(host.querySelectorAll(sel)); } catch (e) { list = []; }
        for (const n of list) { tidyText(n); }
    }
}

/**
 * 把一个已建好的标题元素去括号：屏上留名词，括注进 `title`。
 * 用在“造的当下”（card() 与 section()）——靠事后扫一遍会漏时序。
 * @param {HTMLElement} el
 * @param {string} raw
 */
export function titleNode(el, raw) {
    const s = String(raw == null ? '' : raw);
    const paren = parenText(s);
    el.textContent = stripParen(s);
    if (paren) { el.setAttribute('title', paren); }
    return el;
}

/**
 * 83 号：**屏上不出技术串**（HTTP 530／重试）。
 *   原文留给 `title=`（悬停看）与「⭘ 说明」里的「每轮记录」；屏上只留人话。
 *   ⛔ 改楼号：`#0` 是酒馆楼号（她定的口径），保留。
 * @param {string} s
 */
export function sanitizeTech(s) {
    return String(s == null ? '' : s)
        .replace(/（?HTTP\s*\d+[^）]*）?/gi, '')
        .replace(/HTTP/gi, '')
        .replace(/重试/g, '再跑')
        .replace(/[ 	]{2,}/g, ' ')
        .replace(/[  ]+·/g, ' ·')
        .trim();
}
