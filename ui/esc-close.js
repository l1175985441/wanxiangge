/**
 * 万象阁 · 人物浮层的 Esc 关闭（TW 扩展契约：监听必须有确定的清理）
 *
 * 为什么单独一件：`ui/sections.js` 贴着 8200 行硬线；把“挂一个全局 keydown 并能在停用时卸掉”
 *   这件小事抽出来，既配对清理、又给主文件腾地方。
 *
 * 口径：**只挂一次**；`unbind()` 之后可以再 `bind()`（停用 → 再启用）。
 */

let handler = null;

/**
 * 挂上 Esc 监听（重复调用安全）。
 * @param {{ isActive: () => boolean, onEsc: () => void }} hooks
 */
export function bindEscClose(hooks) {
    if (handler) {
        return;
    }
    if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') {
        return;
    }
    const isActive = (hooks && hooks.isActive) || (() => false);
    const onEsc = (hooks && hooks.onEsc) || (() => {});
    handler = (ev) => {
        const key = ev && (ev.key || ev.code);
        if (String(key || '') !== 'Escape') {
            return;
        }
        if (!isActive()) {
            return;
        }
        onEsc();
        if (typeof ev.preventDefault === 'function') {
            ev.preventDefault();
        }
    };
    document.addEventListener('keydown', handler, true);
}

/** 卸掉（停用／卸载时调）；没挂过就什么也不做 */
export function unbindEscClose() {
    if (!handler) {
        return;
    }
    try {
        document.removeEventListener('keydown', handler, true);
    } catch (e) {
        /* 卸不掉也不能拦着停用 */
    }
    handler = null;
}
