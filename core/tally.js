/**
 * 万象阁 · 自证闸印给玩家（阿砚第三批 C 档 P2 · F3）
 *
 * 依据＝F3「自证闸印给玩家（总数对得上，且印出来）」；挡的风险：
 *   呈现层加一层组织（分页/筛选/截断）就开始丢东西，而没人发现——因为屏幕上不印“本该有多少”。
 *
 * 这一层只做两件事：
 *   1. `tally(label, total, shown)` —— 算“库里共几条 / 这次画了几条”，对不上就 ok:false
 *   2. `tallyLine(...)`            —— 把那两个数**印出来**给玩家看（⛔ 只写进 console）
 */

/**
 * @param {string} label 这一块叫什么（编年/名册/事件池…）
 * @param {number} total 库里共几条
 * @param {number} shown 这次画出来几条
 * @returns {{label:string, total:number, shown:number, hidden:number, ok:boolean, line:string}}
 */
export function tally(label, total, shown) {
    const t = Number.isFinite(Number(total)) ? Math.max(0, Number(total)) : 0;
    const s = Number.isFinite(Number(shown)) ? Math.max(0, Number(shown)) : 0;
    const hidden = Math.max(0, t - s);
    return {
        label: String(label || ''),
        total: t,
        shown: s,
        hidden,
        ok: s <= t,
        line: tallyLine(label, t, s),
    };
}

/**
 * 印给人看的那一行：**总数必须出现**（⛔ 只印“显示 N 条”那种没法对账的话）。
 */
export function tallyLine(label, total, shown) {
    const t = Number.isFinite(Number(total)) ? Math.max(0, Number(total)) : 0;
    const s = Number.isFinite(Number(shown)) ? Math.max(0, Number(shown)) : 0;
    const name = String(label || '');
    if (s > t) {
        return name + '：显示 ' + String(s) + ' / 共 ' + String(t) + '（⚠ 显示比库里还多，有东西重复了）';
    }
    if (s < t) {
        return name + '：显示 ' + String(s) + ' / 共 ' + String(t) + '（还有 ' + String(t - s) + ' 条没画出来）';
    }
    return name + '：显示 ' + String(s) + ' / 共 ' + String(t) + '（全在这儿）';
}
