import { runWarning } from '../core/runwarn.js';

/**
 * 万象阁 · 状态页「一屏一句话」（阿砚 71 号）
 *
 * 她的原话：打开一个界面**一堆文字噗在脸上**，你点都不愿意点；世界背面点开就算有文字也很素雅——
 *   因为它把"这一屏在讲什么"用**大字**先告诉你（实测它整屏有 28 个字符是 18px，我们只有 2 个）。
 *
 * 这里只报两件真事：引擎跑到第几楼、这一轮有没有没进账的。⛔ 形容词、⛔ 解释。
 *
 * @param {object} args { el, state, warn }
 * @returns {HTMLElement}
 */
export function statusHero(args) {
    const a = args || {};
    const el = a.el;
    const st = a.state || {};
    let warn = {};
    try { warn = runWarning(st) || {}; } catch (e) { warn = {}; }
    const atFloor = Number((st.pipeline || {}).atFloor);
    const floorTxt = (Number.isFinite(atFloor) && atFloor >= 0)
        ? ('引擎跑到第 ' + String(atFloor) + ' 楼')
        : '引擎还没跑过';
    const warnTxt = warn.count ? ('本轮 ' + String(warn.count) + ' 条没进账') : '这一轮全部进账';
    return el('div', 'wxg-sec-hero', floorTxt + ' · ' + warnTxt);
}
