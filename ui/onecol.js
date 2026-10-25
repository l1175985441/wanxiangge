/**
 * 万象阁 · 单卡页标记（阿砚九格 · 一）
 *
 * 整页只有一个主卡时，宽屏那套 `display:grid` 仍按多列排 ⇒ 主卡占一轨、右半屏空着。
 * 这里在**整页 DOM 建完、挂上去之前**数一次：每段 `.wxg-sec-body` 的直属 `.wxg-card` 正好 1 个
 * ⇒ 给那段盖 `data-wxg-onecol="1"`；否则摘掉。CSS 里靠这个标记改单列。
 *
 * ⚠️ ⛔ 不用 `:has(:only-of-type)`：`:only-of-type` 按**标签名**算，编年页子元素全是 div，永远不成立。
 *
 * @param {{stageEl:HTMLElement, asArray:Function}} args
 */
export function markOneCol(args) {
    const a = args || {};
    const stageEl = a.stageEl;
    const asArray = a.asArray;
    if (!stageEl || typeof asArray !== 'function' || typeof stageEl.querySelectorAll !== 'function') {
        return;
    }
    for (const sec of asArray(stageEl.querySelectorAll('.wxg-sec'))) {
        const body = sec.querySelector ? sec.querySelector('.wxg-sec-body') : null;
        if (!body) {
            continue;
        }
        const cards = asArray(body.children || []).filter((n) => n && n.classList && n.classList.contains('wxg-card'));
        if (cards.length === 1) {
            sec.setAttribute('data-wxg-onecol', '1');
        } else if (sec.removeAttribute) {
            sec.removeAttribute('data-wxg-onecol');
        }
    }
}
