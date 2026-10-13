/**
 * 万象阁 · 小提示（toast）
 *
 * 酒馆自带 toastr；拿不到就退回控制台，⛔ 绝不因为"弹条发不出去"把主流程弄崩。
 */

function t() {
    return typeof globalThis.toastr !== 'undefined' ? globalThis.toastr : null;
}

/** ⛔ 别刷屏：同一句话 3 秒内只弹一次 */
const lastShown = new Map();

function shouldShow(key) {
    const at = lastShown.get(key) || 0;
    const nowTs = Date.now();
    if (nowTs - at < 3000) {
        return false;
    }
    lastShown.set(key, nowTs);
    return true;
}

function fire(level, message, title) {
    const text = String(message === undefined || message === null ? '' : message);
    if (!text) {
        return;
    }
    if (!shouldShow(text)) {
        return;
    }
    const box = t();
    const head = title || '万象阁';
    try {
        if (box && typeof box[level] === 'function') {
            box[level](text, head, { timeOut: level === 'error' ? 8000 : 4000 });
            return;
        }
    } catch (e) {
        // 落到控制台
    }
    if (level === 'error') {
        console.warn('[万象阁] ' + text);
    } else {
        console.info('[万象阁] ' + text);
    }
}

export const toast = {
    info: (msg, title) => fire('info', msg, title),
    ok: (msg, title) => fire('success', msg, title),
    warn: (msg, title) => fire('warning', msg, title),
    fail: (msg, title) => fire('error', msg, title),
};
