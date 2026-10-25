/**
 * 万象阁 · 重画时把焦点还给同一个控件（阿砚实机：点完 select 焦点掉回 BODY）
 *
 * 根因不是 select 本身，是**整页重画**把元素替换掉了。
 * 做法：重画前记下“谁有焦点”（id／tag／类名），重画后按 id 找回来 focus。
 * ⛔ 不抢 activeElement 的默认行为，只在重画这一瞬间补回来。
 */

/** 记下当前焦点（没有就 null） */
export function rememberFocus(doc) {
    try {
        const d = doc || (typeof document !== 'undefined' ? document : null);
        if (!d) {
            return null;
        }
        const a = d.activeElement;
        if (!a || a === d.body || !a.tagName) {
            return null;
        }
        return { id: a.id || '', tag: a.tagName, cls: a.className || '' };
    } catch (e) {
        return null;
    }
}

/** 按 id 把焦点还回去（找不回来就安静放弃） */
export function restoreFocus(snap, doc) {
    if (!snap || !snap.id) {
        return;
    }
    try {
        const d = doc || (typeof document !== 'undefined' ? document : null);
        const el = d && d.getElementById ? d.getElementById(snap.id) : null;
        if (el && typeof el.focus === 'function') {
            el.focus();
        }
    } catch (e) {
        /* 找不回来也不能拦着重画 */
    }
}
