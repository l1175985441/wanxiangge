/**
 * 万象阁 · 世界状态卡片的“卡头＋一句摘要＋查看全部”（阿砚第三批 质感 A6）
 *
 * 为什么单独一件：`ui/sections.js` 已经贴着硬线（8200 行），再往里塞结构就超。
 *   这里只做**装饰**：给一张已有的 `.wxg-card` 补一行摘要与一颗「查看全部」，
 *   折起来靠 CSS（`is-compact` / `is-open`），**不搬动 DOM 节点**——
 *   搬节点在自测的模拟 DOM 里会把内容弄丢（实锤：审计找不到 `set-world-clock`）。
 */

import { shouldCompact, summarise } from '../core/wgrid.js';

/**
 * @param {object} args
 *   box         要装饰的卡片元素（`.wxg-card`）
 *   summaryText 摘要原文（会被掐到 34 字）
 *   el          创建元素的工具函数（由调用方传入，避免循环依赖）
 *   button      创建按钮的工具函数
 * @returns {HTMLElement} 同一张卡
 */
export function decorateCard(args) {
    const box = args && args.box;
    if (!box) {
        return box;
    }
    const el = args.el;
    const button = args.button;
    if (typeof el !== 'function') {
        return box;
    }
    const head = box.querySelector ? box.querySelector('.wxg-card-h') : null;
    const sum = el('div', 'wxg-card-sum', summarise(args.summaryText));
    /*
     * ⚠️ 为什么塞进卡头、而不用 `insertBefore`：
     *   自测的模拟 DOM 有个已知缺陷——**重画几次之后会丢段里的叶子节点**，
     *   实测表现是审计报“找不到 set-world-clock”。塞进已存在的卡头不挪节点，就绕开了它。
     */
    const holder = head || box;
    if (holder.appendChild) {
        holder.appendChild(sum);
    }
    /*
     * ⚠️ 「查看全部」折叠暂时**没上**（实话）：
     *   自测的模拟 DOM 有个已知缺陷（重画几次会丢段里的叶子节点），
     *   加上展开/收起后审计报“找不到 set-world-clock”；不愿在没有真机手测时强行推。
     *   ⇒ 这一笔先交「两列网格 ⮕ 委托卡头加一句摘要」，折叠功能单独排。
     */
    return box;
}

export { shouldCompact, summarise };
