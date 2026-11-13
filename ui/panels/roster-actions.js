/* 名-6：名册删除等动作。从 sections.js 抽出（206 后） */
import { takeSnapshot, removeCharacter } from '../../core/state.js';
import { personCardId, setPersonCardId } from './person-card.js';


export function handleRosterAction(action, target, id, rerender) {
    switch (action) {
                case 'del-char':
                    /* ⭐材料 06第一波：**二次确认 ＋ 快照** ✓
                     *   旧：点一下当场物理删除 ✗ 不弹确认 ✗ 不留快照 ✗
                     *        （点「撤回上一次」都撤不回来 ✗ —— 她的账不能这么掉 ✗）
                     *   新：先问一句 ✓ 再留一份快照 ✓ （沿用代码里既有的 window.confirm 写法 ✓ ⛔ 不引入新弹窗 ✗） */
                    if (typeof window !== 'undefined' && typeof window.confirm === 'function' && !window.confirm('要把这个角色删掉吗？\n\n（会先留一份快照，点「撤回上一次」能撤回来）')) { break; }
                    takeSnapshot('删除前（这个角色）');
                    /*
                     * ⭐ U18（材料 12）：**删掉的正是浮层里那个人 ⇒ 浮层也要收** ✓
                     *   旧：只 `removeCharacter` 再 `rerender()` ✗
                     *     ⇒ `personCardId` 还指着已经不存在的人 ✗
                     *     ⇒ 浮层卡还挂在屏幕上（连名字都还在 ✗）
                     *   现在：清掉 id 并把那张浮层直接拆掉 ✓
                     */
                    if (personCardId && String(personCardId) === String(id)) {
                        setPersonCardId(null);
                        try {
                            const pcU18 = document.querySelector('.wxg-pc');
                            if (pcU18 && pcU18.parentNode) {
                                pcU18.parentNode.removeChild(pcU18);
                            }
                        } catch (eU18) { /* 拆不掉也不能拦着删人 ✓ */ }
                    }
                    removeCharacter(id); rerender(); break;
    }
}

