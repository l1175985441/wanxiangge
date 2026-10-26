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
    for (const n of host.querySelectorAll('.wxg-card-h, .wxg-card-title, .wxg-card-sum, .wxg-sec-title, .wxg-report-h')) {
        tidyText(n);
    }
}
