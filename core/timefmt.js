/**
 * 万象阁 · 时间为人话（阿砚第三批 质感 A7／A9）
 *
 * 依据＝A7（屏上露机器串 `1792783180646`）与 A9（每页要有状态带，里面要有人话时间）：
 *   两处都要“把毫秒变人话”，所以收在**一处**（⛔ 各写一份，A11 的老毛病）。
 */

/** 毫秒 → 「今天 14:05」／「10-24 22:10」；认不出就「—」（⛔ 把数字原样贴出来） */
export function humanStamp(at) {
    const n = Number(at);
    if (!Number.isFinite(n) || n <= 0) {
        return '—';
    }
    const d = new Date(n);
    if (Number.isNaN(d.getTime())) {
        return '—';
    }
    const pad = (x) => (x < 10 ? '0' + String(x) : String(x));
    const hhmm = pad(d.getHours()) + ':' + pad(d.getMinutes());
    const now = new Date();
    const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
    if (sameDay) {
        return '今天 ' + hhmm;
    }
    return pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + hhmm;
}

/** 相对多久以前（状态带用）：「刚刚」／「12 分钟前」／「3 小时前」／「昨天」；认不出就空串 */
export function agoText(at) {
    const n = Number(at);
    if (!Number.isFinite(n) || n <= 0) {
        return '';
    }
    const diff = Date.now() - n;
    if (diff < 0) {
        return '';
    }
    const min = Math.floor(diff / 60000);
    if (min < 1) {
        return '刚刚';
    }
    if (min < 60) {
        return String(min) + ' 分钟前';
    }
    const hr = Math.floor(min / 60);
    if (hr < 24) {
        return String(hr) + ' 小时前';
    }
    const day = Math.floor(hr / 24);
    if (day === 1) {
        return '昨天';
    }
    return String(day) + ' 天前';
}
