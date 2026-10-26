/**
 * 万象阁 · 「这一轮没进账」提示（阿砚 71 号：红框不许常驻）
 *
 * 她：那条「本轮有 2 条没进账 · 酒馆转发失败（HTTP 530）」是常驻大块，噗在脸上。
 *   ⇒ 改成**一颗小红点 ＋ 一行摘要**（默认只有摘要那 6–10 个字），点开才看是哪几条。
 *
 * ⛔ toast；⛔ 大块常驻。数据判定仍在 `core/runwarn.js`。
 */

/**
 * @param {object} args { box, warn, el, doc }
 * @returns {HTMLElement|null}
 */
export function renderRunWarn(args) {
    const a = args || {};
    const warn = a.warn || { count: 0, reasons: [], title: '', line: '' };
    if (!warn.count || !a.box || typeof a.el !== 'function') {
        return null;
    }
    const el = a.el;
    const doc = a.doc;
    const wrap = el('div', 'wxg-runwarn');
    wrap.setAttribute('data-tone', 'bad');
    wrap.setAttribute('data-wxg-runwarn', String(warn.count));
    /* 小红点：一眼看出"有事"，但不占地方 */
    wrap.appendChild(el('span', 'wxg-runwarn-dot', ''));
    if (doc && typeof doc.createElement === 'function') {
        const det = doc.createElement('details');
        det.className = 'wxg-runwarn-more';
        const sum = doc.createElement('summary');
        sum.className = 'wxg-runwarn-sum';
        sum.textContent = '本轮 ' + String(warn.count) + ' 条没进账';
        det.appendChild(sum);
        for (const why of (warn.reasons || []).slice(0, 20)) {
            det.appendChild(el('div', 'wxg-note', '· ' + why));
        }
        wrap.appendChild(det);
    } else {
        wrap.appendChild(el('span', 'wxg-runwarn-sum', '本轮 ' + String(warn.count) + ' 条没进账'));
    }
    a.box.appendChild(wrap);
    return wrap;
}
