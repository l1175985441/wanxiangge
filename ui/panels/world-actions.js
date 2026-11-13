/* 世-2/世-3/隐-1：世界钟·地点·世界事实＋暗线事件。从 sections.js 抽出（206 后） */
import { updateWorld, loadState, saveState, takeSnapshot, removeHidden, addHiddenManually } from '../../core/state.js';
import { clockWentBackwards } from '../../core/clock.js';
import { trimText } from '../../core/utils.js';
import { byId, textOf } from './render.js';
import { toast } from '../toast.js';


export const WORLD_ACTION_SET = new Set(['set-world-clock', 'set-world-place', 'set-world-big', 'set-hidden-stage', 'del-hidden', 'add-hidden']);


export function handleWorldAction(action, target, id, host, isChange, rerender) {
    switch (action) {
                case 'set-world-clock': {
                    if (isChange) {
                        const before = loadState().world.clock;
                        const typed = trimText(target.value);
                        updateWorld({ clock: typed }, { manual: true });
                        if (typed && clockWentBackwards(before, typed)) {
                            toast.warn('这个钟比原来的早（' + (before || '未知') + ' → ' + typed + '）——已按你填的存下；如果不想让它倒退，改回来就行');
                        } else {
                            toast.ok('保存了');
                        }
                    }
                    break;
                }
                case 'set-world-place': if (isChange) { updateWorld({ place: target.value }, { manual: true }); toast.ok('保存了'); } break;
                case 'set-world-big': if (isChange) { updateWorld({ bigPicture: target.value }, { manual: true }); toast.ok('保存了'); } break;

                case 'set-hidden-stage': {
                    if (isChange) {
                        const state = loadState();
                        const h = state.world.hidden.find((x) => x.id === id);
                        if (h) {
                            h.stage = target.value;
                            h.manual = true;
                            h.updatedAt = Date.now();
                            state.world.hidden = state.world.hidden.slice();
                            /*
                             * ⭐ 修复单 #32：**补 saveState()**。
                             *   原来只 `slice()` 就直接 rerender——`slice()` 只是"改后待存"的写法，
                             *   真正的落盘得靠 saveState ⇒ 暗线阶段改完**永不落盘**，刷新就回原样。
                             *   （同文件其它同类 case 都带 saveState，就这处漏了。）
                             */
                            saveState();
                            toast.ok('暗线阶段已改成「' + String(target.value) + '」');
                            rerender();
                        }
                    }
                    break;
                }
                case 'del-hidden':
                    /* ⭐材料 06第一波：**二次确认 ＋ 快照** ✓
                     *   旧：点一下当场物理删除 ✗ 不弹确认 ✗ 不留快照 ✗
                     *        （点「撤回上一次」都撤不回来 ✗ —— 她的账不能这么掉 ✗）
                     *   新：先问一句 ✓ 再留一份快照 ✓ （沿用代码里既有的 window.confirm 写法 ✓ ⛔ 不引入新弹窗 ✗） */
                    if (typeof window !== 'undefined' && typeof window.confirm === 'function' && !window.confirm('要把这条暗线删掉吗？\n\n（会先留一份快照，点「撤回上一次」能撤回来）')) { break; }
                    takeSnapshot('删除前（这条暗线）');
                    removeHidden(id); rerender(); break;
                case 'add-hidden': {
                    const name = textOf(host, 'wxg-new-hidden');
                    if (!trimText(name)) {
                        toast.warn('先写个暗线名字');
                        break;
                    }
                    const tierSel = byId(host, 'wxg-new-hidden-tier');
                    const kindSel = byId(host, 'wxg-new-hidden-kind');
                    const tier = trimText(tierSel && tierSel.value) || '几天内';
                    const kind = trimText(kindSel && kindSel.value) || 'conflict';
                    const line = addHiddenManually({
                        name: trimText(name),
                        trigger: textOf(host, 'wxg-new-hidden-trigger'),
                        stage: kind === 'progress' ? '筹备' : '萌芽',
                        kind,
                        tier,
                    });
                    if (line) {
                        toast.ok('暗线加上了（' + tier + ' · ' + (kind === 'progress' ? '推进型' : '冲突型') + '）');
                    }
                    rerender();
                    break;
                }
    }
}

