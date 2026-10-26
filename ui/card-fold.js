/**
 * 万象阁 · 卡头三层 ＋ 右侧一个 ∨（阿砚 74 号）
 *
 * 她：每张卡默认只给——badge（状态）／标题 17–18px／一句话正文 14px，
 *   其余（明细、时间、后果、次要按钮）折进**标题行右侧的 ∨**，⛔ 卡底再加一个“展开”。
 *
 * 做法：把 `.wxg-card` 的头变成 `<details>` 的 `<summary>`，其余子节点搬进内部容器。
 *   ⛔ 改卡本身的结构（卡仍然是卡，只是内容收起来）。
 */

/**
 * @param {object} args { card, doc }
 * @returns {HTMLElement|null} 新建的 details；没头就返回 null（⛔ 硬造一个）
 */
export function foldCard(args) {
    const a = args || {};
    const card = a.card;
    const doc = a.doc;
    if (!card || !doc || !card.querySelector) {
        return null;
    }
    const head = card.querySelector('.wxg-card-h');
    if (!head) {
        return null;
    }
    const det = doc.createElement('details');
    det.className = 'wxg-card-fold';
    const sum = doc.createElement('summary');
    sum.className = 'wxg-card-sum';
    sum.textContent = String(head.textContent || '').trim();
    det.appendChild(sum);
    head.remove();
    const body = doc.createElement('div');
    body.className = 'wxg-card-body';
    while (card.firstChild) {
        body.appendChild(card.firstChild);
    }
    det.appendChild(body);
    card.appendChild(det);
    card.classList.add('is-fold');
    return det;
}
