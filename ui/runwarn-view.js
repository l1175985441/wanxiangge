/**
 * 万象阁 · 「这一轮没进账」红条（阿砚必修 9）
 *
 * 为什么单独一件：`ui/sections.js` 贴着 8200 行硬线；这里只负责**画那条红条**，
 *   数据判定在 `core/runwarn.js`（纯函数，可测）。
 */

/**
 * @param {object} args
 *   box     挂到哪（通常是那段里的卡片外框）
 *   warn    `runWarning()` 的结果
 *   el      创建元素的工具函数（由调用方传入，避免循环依赖）
 *   repo    能创建 <details>/<summary> 的宿主对象（一般就是 document）
 * @returns {HTMLElement|null} 红条；没有问题时返回 null
 */
export function renderRunWarn(args) {
    const a = args || {};
    const warn = a.warn || { count: 0, reasons: [], title: '', line: '' };
    if (!warn.count || !a.box || typeof a.el !== 'function') {
        return null;
    }
    const el = a.el;
    const doc = a.doc;
    const bar = el('div', 'wxg-banner');
    bar.setAttribute('data-tone', 'bad');
    bar.setAttribute('data-wxg-runwarn', String(warn.count));
    bar.appendChild(el('span', 'wxg-banner-k', warn.title));
    bar.appendChild(el('span', 'wxg-banner-v', warn.line));
    if (doc && typeof doc.createElement === 'function') {
        const det = doc.createElement('details');
        det.className = 'wxg-banner-more';
        const sum = doc.createElement('summary');
        sum.textContent = '展开看是哪几条';
        det.appendChild(sum);
        for (const why of (warn.reasons || []).slice(0, 20)) {
            det.appendChild(el('div', 'wxg-note', '· ' + why));
        }
        bar.appendChild(det);
    }
    a.box.appendChild(bar);
    return bar;
}
