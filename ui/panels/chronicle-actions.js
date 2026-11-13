/* 编-2＋清空世界：从 sections.js 抽出（206 后） */
import { getChronicle, removeChronicleAt, clearChronicle, clearWorldLedger, takeSnapshot } from '../../core/state.js';
import { setClearWorldOpen, CLEAR_WORD } from './shared.js';
import { toast } from '../toast.js';


export const CHRONICLE_ACTION_SET = new Set(['clear-world-open', 'clear-world-cancel', 'clear-world-do', 'del-chronicle', 'clear-chronicle']);


export async function handleChronicleAction(action, target, rerender) {
    switch (action) {
    case 'clear-world-open':
        setClearWorldOpen(true);
        rerender();
        break;
    case 'clear-world-cancel':
        setClearWorldOpen(false);
        toast.info('没清，原样都在');
        rerender();
        break;
    case 'clear-world-do': {
        /*
         * ⭐ 从**点击按钮所在的那个确认盒**里读输入框。
         *   为什么：「清空这个世界」现在**总控与状态页各有一份**（她要的"双重保险"），
         *   而原来是按**写死的 id** 取 ⇒ 两份在一起时会读到**错的那个输入框**
         *   （`getElementById` 只给文档里第一个）⇒ 她打了字却被判"打错字了"。
         */
        const near = target && typeof target.closest === 'function'
            ? target.closest('.wxg-danger-box') : null;
        const box = (near && typeof near.querySelector === 'function'
            ? near.querySelector('input') : null) || document.getElementById('wxg-clear-typing-general');
        const typed = box && typeof box.value === 'string' ? box.value.trim() : '';
        if (typed !== CLEAR_WORD) {
            toast.fail('打错字了：要一字不差地打「' + CLEAR_WORD + '」才让清');
            break;
        }
        const counts = await clearWorldLedger();
        setClearWorldOpen(false);
        const parts = Object.keys(counts).map((k) => k + ' ' + String(counts[k]) + ' 条');
        toast.ok('这个聊天的世界已清空：' + parts.join('、') + '（世界书没动）');
        rerender();
        break;
    }
    /*
     * ⭐ 删编年一条。⛔ 只删这一条，别的一律不碰；删完给回执（她要知道删掉了什么）。
     */
    case 'del-chronicle': {
        const idx = Number(target.getAttribute('data-index'));
        if (await removeChronicleAt(idx)) {
            toast.ok('删掉一条编年');
        } else {
            toast.fail('没删掉（下标对不上，可能列表刚刷新过）');
        }
        rerender();
        break;
    }
    /*
     * ⭐ 清空编年：按她的规矩来——**写明条数**再动手，⛔ 不静默。
     */
    case 'clear-chronicle': {
        /* ⭐ 材料 06【6】②之二：**大动作先留快照** ✓
         *   （旧：清空编年不留快照 ✗ ⇒ 误操作无法用「撤回上一次」恢复 ✗） */
        takeSnapshot('清空编年前');
        const n = getChronicle().length;
        if (!n) {
            toast.info('编年本来就是空的');
            break;
        }
        if (typeof window !== 'undefined' && typeof window.confirm === 'function' && !window.confirm('要把编年全部清掉吗？\n\n将清掉：编年 ' + String(n) + ' 条\n'
            + '（只清编年；名册、世界状态、暗线、世界书都不动）\n\n清掉就回不来了。')) {
            break;
        }
        const done = await clearChronicle();
        toast.ok('编年已清空（' + String(done) + ' 条）');
        rerender();
        break;
    }
    }
}

