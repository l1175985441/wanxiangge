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
