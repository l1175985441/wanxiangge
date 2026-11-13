/* 名-5 任务：子项勾选/任务状态/删除。从 sections.js 抽出（206 后） */
import { findCharacter, updateCharacter, updateQuest, removeQuest, addChronicle, takeSnapshot } from '../../core/state.js';
import { trimText } from '../../core/utils.js';
import { toast } from '../toast.js';


export const QUEST_ACTION_SET = new Set(['toggle-quest-item', 'set-quest-status', 'del-quest']);


export function handleQuestAction(action, target, id, isChange, rerender) {
    switch (action) {
                case 'toggle-quest-item': {
                    /* ⭐ 材料 06【4】：**子项打勾 / 取消** ✓ */
                    const qt = trimText(target.getAttribute('data-title'));
                    const qi = Number(target.getAttribute('data-index'));
                    const qc = findCharacter(id);
                    if (qc && Array.isArray(qc.quests)) {
                        const qs2 = qc.quests.map((q) => {
                            if (!q || trimText(q.title) !== qt || !Array.isArray(q.items)) {
                                return q;
                            }
                            const items2 = q.items.map((it, ii) => (ii === qi ? Object.assign({}, it, { done: !(it && it.done === true) }) : it));
                            return Object.assign({}, q, { items: items2 });
                        });
                        updateCharacter(id, { quests: qs2 }, { manual: true });
                        rerender();
                    }
                    break;
                }
                case 'set-quest-status': {
                    if (!isChange) {
                        break;
                    }
                    const title = target.getAttribute('data-title') || '';
                    updateQuest(id, title, { status: trimText(target.value) });
                    toast.ok('任务状态改成「' + trimText(target.value) + '」了');
                    rerender();
                    break;
                }
                case 'del-quest': {
                    /* ⭐材料 06第一波：**二次确认 ＋ 快照** ✓
                     *   旧：点一下当场物理删除 ✗ 不弹确认 ✗ 不留快照 ✗
                     *        （点「撤回上一次」都撤不回来 ✗ —— 她的账不能这么掉 ✗）
                     *   新：先问一句 ✓ 再留一份快照 ✓ （沿用代码里既有的 window.confirm 写法 ✓ ⛔ 不引入新弹窗 ✗） */
                    if (typeof window !== 'undefined' && typeof window.confirm === 'function' && !window.confirm('要把这个任务删掉吗？\n\n（会先留一份快照，点「撤回上一次」能撤回来）')) { break; }
                    takeSnapshot('删除前（这个任务）');
                    const title = target.getAttribute('data-title') || '';
                    if (removeQuest(id, title)) {
                        addChronicle({ floor: -1, kind: '任务·手动删除', who: '', text: title });
                        toast.ok('任务删掉了（已在编年里留痕）');
                    }
                    rerender();
                    break;
                }
    }
}

