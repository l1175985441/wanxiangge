/**
 * 万象阁 · 状态页的两条折叠（阿砚 71 号）
 *
 * 她：状态页默认只留 hero 一句 ＋ 进度一张主卡；技术串（HTTP 530／重试／#0／楼号）不许出现在正文区。
 *   两处折叠抽出来的原因：`ui/sections.js` 贴着行数硬线。
 */

/**
 * 存档／上次更新：屏上只留一行标题，点开才看原文（技术串都在里面）。
 * @param {object} args { el, doc, line, ledgerLine }
 * @returns {HTMLElement}
 */
export function foldStore(args) {
    const a = args || {};
    const doc = a.doc;
    const det = doc.createElement('details');
    det.className = 'wxg-status-detail';
    const sum = doc.createElement('summary');
    sum.textContent = '存档 · 上次更新';
    det.appendChild(sum);
    if (a.line) { det.appendChild(a.line); }
    if (a.ledgerLine) { det.appendChild(a.ledgerLine); }
    return det;
}

/**
 * 每轮记录：整张卡默认折起（标题行右侧一个 ∨），展开才看列表。
 * @param {object} args { el, doc }
 * @returns {{wrap: HTMLElement, body: HTMLElement, summary: HTMLElement}}
 */
export function foldReport(args) {
    const a = args || {};
    const doc = a.doc;
    const el = a.el;
    const wrap = doc.createElement('details');
    wrap.className = 'wxg-rep-fold';
    const summary = doc.createElement('summary');
    summary.textContent = '每轮记录（展开看每一轮送进去什么）';
    wrap.appendChild(summary);
    const body = el('div', 'wxg-plain');
    wrap.appendChild(body);
    return { wrap: wrap, body: body, summary: summary };
}
