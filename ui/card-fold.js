import { tidyText } from './tidy-heads.js';

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
    /*
     * 85#4：`decorateCard()` 会把一个 `.wxg-card-sum` 塞进卡头（当年为了绕开模拟 DOM）。
     *   我们拿卡头文本做 summary 时会把它一并吃进去 ⇒ 「势力6 个在册6 个在册」。
     *   这里先把它摘掉（屏上只留标题，数字走我们自己那句话）。
     */
    const dupSum = head.querySelector ? head.querySelector('.wxg-card-sum') : null;
    if (dupSum && dupSum.remove) {
        dupSum.remove();
    }
    const det = doc.createElement('details');
    det.className = 'wxg-card-fold';
    const sum = doc.createElement('summary');
    sum.className = 'wxg-card-sum';
    sum.textContent = String(head.textContent || '').trim();
    /*
     * 77 号：**造的当下就去括号**。
     *   旧：靠 `renderSections` 末尾扫一遍 ⇒ 折叠是在那之后才发生的，
     *   summary 根本没被扫到（真机六处括号一处未动）。
     */
    tidyText(sum);
    /*
     * 75 号（她：折过头了，只剩标题）：折叠态必须带**一句话正文**（14px，≤60 字）。
     *   行文本由调用方传（`line`）——⛔ 写“展开看…”这种占位句。
     */
    const line = String(a.line == null ? '' : a.line).trim();
    if (line) {
        const ln = doc.createElement('span');
        ln.className = 'wxg-card-sum-line';
        ln.textContent = line.length > 60 ? (line.slice(0, 59) + '…') : line;
        sum.appendChild(ln);
    }
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

/**
 * 卡头一句话（折叠态那行 14px 正文）——按标题关键字取实数。
 * ⛔ 写“展开看…”这种占位句；拿不到数就返回 '”。
 * @param {string} title
 * @param {object} state
 */
export function cardLine(title, state) {
    const t = String(title || '');
    const s = state || {};
    const w = s.world || {};
    const n = (v) => (Array.isArray(v) ? v.length : 0);
    if (t.indexOf('世界钟') >= 0) {
        const clock = String((w.clock == null ? '' : w.clock)).trim() || '时间未记';
        const place = String((w.place == null ? '' : w.place)).trim() || '地点未记';
        return clock + ' · ' + place;
    }
    if (t.indexOf('时局简报') >= 0) {
        const dom = (w.pulse && Array.isArray(w.pulse.domains)) ? w.pulse.domains.length : 0;
        return n(w.situations) + ' 条局势 · ' + dom + ' 个域在压';
    }
    if (t.indexOf('人物') >= 0) { return n(s.roster || s.chars || s.characters) + ' 人在册'; }
    if (t.indexOf('势力') >= 0) { return n(w.factions) + ' 个在册'; }
    if (t.indexOf('世界事实') >= 0) { return n(w.facts) + ' 条事实'; }
    if (t.indexOf('脉动') >= 0) { return n(w.pulse) + ' 条压力'; }
    if (t.indexOf('风声') >= 0) { return n(w.winds) + ' 条风声'; }
    if (t.indexOf('局势') >= 0) { return n(w.situations) + ' 条局势'; }
    if (t.indexOf('记忆') >= 0) {
        const m = s.memory || {};
        const bits = [];
        if (Number(m.rounds) > 0) { bits.push(String(Number(m.rounds)) + ' 轮'); }
        if (String(m.promise || '').trim()) { bits.push('承诺 1'); }
        return bits.length ? bits.join(' · ') : '还没记下什么';
    }
    if (t.indexOf('暗线') >= 0) { return n(w.hidden) + ' 条暗线'; }
    return '';
}

/**
 * 状态页主卡那句话：跑到第几楼 / 这一轮有没有没进账的。
 * @param {object} state
 * @param {object} warn runWarning() 的结果
 */
export function statusCardLine(state, warn) {
    const st = state || {};
    const at = Number((st.pipeline || {}).atFloor);
    const floor = (Number.isFinite(at) && at >= 0) ? ('跑到第 ' + String(at) + ' 楼') : '还没跑过';
    const bad = warn && warn.count ? (' · 本轮 ' + String(warn.count) + ' 条没进账') : ' · 本轮全部进账';
    return floor + bad;
}
