/* 名-6：名册删除等动作。从 sections.js 抽出（206 后） */
import { takeSnapshot, removeCharacter } from '../../core/state.js';
import { personCardId, setPersonCardId } from './person-card.js';
import { getRoster, updateCharacter, addCharacter, addCharacters, applyRosterPreset, saveState, loadState, findCharacterByName } from '../../core/state.js';
import { mergeCharacters } from '../../core/merge.js';
import { ROSTER_PRESET } from '../../core/config.js';
import { el, button } from './shared.js';
import { trimText } from '../../core/utils.js';
import { byId, textOf } from './render.js';
import { toast } from '../toast.js';


export let mergePickFor = null;
export const ROSTER_ACTION_SET = new Set(['accept-new', 'accept-new-all', 'ignore-char', 'unignore-char', 'merge-into', 'merge-into-cancel', 'merge-into-confirm', 'add-char', 'preset-roster', 'import-roster', 'del-char']);

export function handleRosterAction(action, target, id, host, rerender) {
    switch (action) {
                case 'accept-new': updateCharacter(id, { isNew: false }); toast.ok('收下了'); rerender(); break;
                case 'accept-new-all': {
                    const st = loadState();
                    const names = Array.isArray(st.newPeople) ? st.newPeople.slice() : [];
                    let n = 0;
                    for (const nm of names) {
                        const c = findCharacterByName(nm);
                        if (c && c.isNew) {
                            updateCharacter(c.id, { isNew: false });
                            n += 1;
                        }
                    }
                    st.newPeople = [];
                    saveState();
                    toast.ok(n ? ('收下了 ' + String(n) + ' 个新认的人') : '没有待处理的新认的人');
                    rerender();
                    break;
                }
                case 'ignore-char': updateCharacter(id, { ignored: true }); rerender(); break;
                /* ⭐ 材料 06【4】#4：**被忽略了也要能恢复** ✓ */
                case 'unignore-char': updateCharacter(id, { ignored: false }); toast.ok('恢复了：他又能参与推演与召回了'); rerender(); break;
                case 'merge-into': {
                    /*
                     * ⭐ B8（材料 13）：**不再弹 window.prompt，就地展开下拉选项** ✓
                     *   ⛔ 走 rerender：浮层人物卡**不在段容器里** ⇒ 重画拿不到它 ✗
                     *   所以直接往卡底那一行里插 ✓
                     */
                    mergePickFor = id || null;
                    try {
                        const footEl = document.querySelector('.wxg-pc-foot');
                        if (footEl) {
                            const oldEl = footEl.querySelector('.wxg-merge-pick');
                            if (oldEl && oldEl.parentNode) {
                                oldEl.parentNode.removeChild(oldEl);
                            }
                            const rowEl = el('div', 'wxg-row wxg-merge-pick');
                            rowEl.appendChild(el('span', 'wxg-note', '并进：'));
                            const others = (getRoster() || []).filter((x) => x && String(x.id) !== String(id));
                            if (others.length) {
                                const selEl = document.createElement('select');
                                selEl.id = 'wxg-merge-target';
                                selEl.className = 'wxg-pole';
                                for (const x of others) {
                                    const o = document.createElement('option');
                                    o.value = String(x.name || '');
                                    const al2 = Array.isArray(x.aliases) && x.aliases.length ? '（' + x.aliases.slice(0, 2).join('／') + '）' : '';
                                    o.textContent = String(x.name || '') + al2;
                                    selEl.appendChild(o);
                                }
                                rowEl.appendChild(selEl);
                                rowEl.appendChild(button('确认并进', 'merge-into-confirm', 'wxg-btn-sm wxg-primary', id));
                                rowEl.appendChild(button('取消', 'merge-into-cancel', 'wxg-btn-sm', id));
                            } else {
                                rowEl.appendChild(el('span', 'wxg-note', '名册里没别人可并了'));
                                rowEl.appendChild(button('取消', 'merge-into-cancel', 'wxg-btn-sm'));
                            }
                            footEl.appendChild(rowEl);
                        }
                    } catch (eB8) { /* 插不进去也不能报错 ✓ */ }
                    break;
                }
                case 'merge-into-cancel': {
                    mergePickFor = null;
                    try {
                        const rowOld = document.querySelector('.wxg-merge-pick');
                        if (rowOld && rowOld.parentNode) {
                            rowOld.parentNode.removeChild(rowOld);
                        }
                    } catch (eB8c) { }
                    break;
                }
                case 'merge-into-confirm': {
                    const selNow = byId(host, 'wxg-merge-target');
                    const target = selNow ? trimText(selNow.value) : '';
                    if (!target) {
                        toast.warn('先在下拉框里选一个要并进来的名字');
                        break;
                    }
                    const result = mergeCharacters(id, target);
                    mergePickFor = null;
                    if (result && result.ok) {
                        toast.ok('合并完成：别名、数据、历史都归到一条上了');
                    } else {
                        toast.warn('没找到叫「' + target + '」的另一条记录');
                    }
                    rerender();
                    break;
                }
                /* ---- 名册 ---- */
                case 'add-char': {
                    const name = trimText(textOf(host, 'wxg-new-name'));
                    if (!name) {
                        toast.warn('先写个名字');
                        break;
                    }
                    addCharacter(name, { manual: true });
                    rerender();
                    break;
                }
                case 'preset-roster': {
                    const added = applyRosterPreset(ROSTER_PRESET);
                    toast.ok(added ? '加了 ' + String(added) + ' 个占位角色（名字随时改）' : '预设名册已经在里面了');
                    rerender();
                    break;
                }
                case 'import-roster': {
                    const added = addCharacters(textOf(host, 'wxg-import-roster'), { manual: true });
                    toast.ok(added ? '导入 ' + String(added) + ' 人' : '这些名字名册里已经有了');
                    rerender();
                    break;
                }
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

