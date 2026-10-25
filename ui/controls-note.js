/**
 * 万象阁 · 两个常用小控件（阿砚九格 · 六／八）
 *
 * 抽出来的原因：`ui/sections.js` 贴着行数硬线；这两块都是**纯 DOM 小拼装**。
 *
 *   六：折叠多的页给一对「全部展开／全部收起」——直接改本段里所有 `<details>.open`，
 *        ⛔ 不另写一套开合逻辑（`foldable` 的 toggle 记忆照旧生效）。
 *   八：开关下面的**当前状态句**——「现在：已开启/已关闭 —— 这个状态下会发生什么、不会发生什么」。
 *        ⛔ 写死文案；传进来的 `on` 必须是**现读的实际状态**。
 */

/**
 * @param {{el:Function, button:Function}} api
 * @returns {HTMLElement}
 */
export function expandPair(api) {
    const el = api && api.el;
    const button = api && api.button;
    const wrap = el('div', 'wxg-card-actions wxg-expandpair');
    wrap.appendChild(button('全部展开', 'expand-all', 'wxg-btn-xs'));
    wrap.appendChild(button('全部收起', 'collapse-all', 'wxg-btn-xs'));
    return wrap;
}

/**
 * @param {{el:Function, on:boolean, onText:string, offText:string}} args
 * @returns {HTMLElement}
 */
export function stateLine(args) {
    const a = args || {};
    const on = a.on === true;
    const el = a.el;
    return el('div', 'wxg-state' + (on ? ' is-on' : ' is-off'),
        '现在：' + (on ? '已开启' : '已关闭') + ' —— ' + (on ? (a.onText || '') : (a.offText || '')));
}
