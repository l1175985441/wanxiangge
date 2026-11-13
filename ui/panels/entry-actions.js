/* 设-4 下半：世界书条目列表/全选/过滤/切换。从 sections.js 抽出（206 后） */
import { getEntries, excludeTextFor } from '../../core/worldbook.js';
import { pickEntries, setPickEntries, setEntFilter } from './entry-state.js';
import { pickBook } from './locks.js';
import { stagedValue, stage } from './shared.js';
import { refreshSaveBar } from './savebar.js';
import { byId, renderEntryPick } from './render.js';
import { toast } from '../toast.js';
import { trimText, asText, toList } from '../../core/utils.js';


export const ENTRY_ACTION_SET = new Set(['list-entries', 'entry-all-on', 'entry-all-off', 'entry-invert', 'filter-entries', 'toggle-entry']);


export async function handleEntryAction(action, target, id, host, isChange, rerender) {
    switch (action) {
                case 'list-entries': {
                    const name = id;
                    setPickBook(trimText(name));
                    const entries = await getEntries(name);
                    setPickEntries(entries);
                    const note = byId(host, 'wxg-entnote');
                    const wrap = byId(host, 'wxg-entpick');
                    if (!note) {
                        break;
                    }
                    if (!entries.length) {
                        note.textContent = '「' + name + '」里没读到条目（或这本没开）。';
                        break;
                    }
                    const off = toList(excludeTextFor(name));
                    note.textContent = '「' + name + '」共 ' + String(entries.length)
                        + ' 条：点一下＝不读这一条（点过的不参与推演）；⛔ 不改你的世界书。';
                    if (wrap) {
                        /*
         * ⭐⭐ 材料 01（界面第 2 条）：**只清“条目区”，⛔ 清整个容器** ✓
         *   旧：`while (wrap.firstChild) removeChild` 把 `#wxg-entpick` **整个清空** ✗
         *     ⇒ 里面那些「看条目：某某书」按钮**全被冲没** ✗
         *     （她想看第二本书还得重新点一次“读世界书列表” ✗）
         *   现在：条目放进它们自己的子容器 `#wxg-entlist` ✓ ⇒ 只清它 ✓
         */
                        let box = wrap.querySelector('#wxg-entlist');
                        if (!box) {
                            box = document.createElement('div');
                            box.id = 'wxg-entlist';
                            wrap.appendChild(box);
                        }
                        while (box.firstChild) {
                            box.removeChild(box.firstChild);
                        }
                        wrap = box;
                        for (const e of entries.slice(0, 200)) {
                            const title = trimText(e && (e.comment || e.key || e.title));
                            if (!title) {
                                continue;
                            }
                            const b = document.createElement('button');
                            b.type = 'button';
                            b.className = 'wxg-pick'
                                + (off.some((x) => asText(x) === asText(title)) ? ' is-on' : '');
                            b.textContent = title;
                            b.title = off.some((x) => asText(x) === asText(title))
                                ? '已设为"不读"（再点＝恢复读它）'
                                : '点一下＝不读这一条';
                            b.setAttribute('data-action', 'toggle-entry');
                            b.setAttribute('data-entry', title);
                            wrap.appendChild(b);
                        }
                    }
                    break;
                }
                case 'entry-all-on':
                case 'entry-all-off':
                case 'entry-invert': {
                    /*
                     * ⭐ 3③：批量改（同样**只动草稿**，等段底保存）。
                     *   ⚠️ "全不读"只管**当前这本书的条目**，⛔把别的书的排除也涂了。
                     */
                    const act = action;
                    const all = pickEntries.map((e) => trimText(e && (e.comment || e.key || e.name || e.title)))
                        .filter(Boolean);
                    let offNow = toList(stagedValue('extract', 'excludeEntries', excludeTextFor(pickBook)));
                    const inOff = (x) => offNow.some((y) => asText(y) === asText(x));
                    if (act === 'entry-all-on') {
                        offNow = offNow.filter((x) => !all.some((y) => asText(y) === asText(x)));
                        toast.ok('这本书 ' + String(all.length) + ' 条全读（还没保存）');
                    } else if (act === 'entry-all-off') {
                        for (const x of all) {
                            if (!inOff(x)) {
                                offNow.push(x);
                            }
                        }
                        toast.info('这本书 ' + String(all.length) + ' 条全不读（还没保存）');
                    } else {
                        for (const x of all) {
                            if (inOff(x)) {
                                offNow = offNow.filter((y) => asText(y) !== asText(x));
                            } else {
                                offNow.push(x);
                            }
                        }
                        toast.info('反选了（还没保存）');
                    }
                    stage('extract', 'excludeEntries', offNow.join('、'));
                    renderEntryPick(host, offNow);
                    refreshSaveBar(host, 'extract');
                    break;
                }
                case 'filter-entries': {
                    setEntFilter(trimText(target.value));
                    renderEntryPick(host);
                    const back = host.querySelector('#wxg-entfilter');
                    if (back && typeof back.focus === 'function') {
                        back.focus();
                    }
                    break;
                }
                case 'toggle-entry': {
                    const title = trimText(target.getAttribute('data-entry'));
                    if (!title) {
                        break;
                    }
                    const off = toList(stagedValue('extract', 'excludeEntries', excludeTextFor(pickBook)));
                    const i = off.findIndex((x) => asText(x) === asText(title));
                    if (i >= 0) {
                        off.splice(i, 1);
                        toast.ok('「' + title + '」恢复参与（还没保存）');
                    } else {
                        off.push(title);
                        toast.info('「' + title + '」标成"不读"（还没保存）');
                    }
                    stage('extract', 'excludeEntries', off.join('、'));
                    renderEntryPick(host, off);
                    refreshSaveBar(host, 'extract');
                    break;
                }
                /* ⭐ 修复 15（材料 02）：一键合并查重出的所有重复组 ✓
                 *   为什么要有它：她能「查重」看出一堆重复，但只能一条条点「按这条合并…」✗
                 *   现在：一次确认 ⇒ 留一份快照 ⇒ 逐组逐条并（单组失败不影响其它 ✓） */
    }
}

