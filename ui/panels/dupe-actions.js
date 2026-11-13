/* 设-5 查重：renderDupPicker＋dup 状态＋六条事件。从 sections.js 抽出（206 后） */
import { autoDetectDuplicates, mergeCharacters } from '../../core/merge.js';
import { byId } from './render.js';
import { el, button } from './shared.js';
import { trimText } from '../../core/utils.js';
import { toast } from '../toast.js';


let dupGroups = [];
let dupPick = new Set();

export function renderDupPicker(host) {
    const box = byId(host, 'wxg-dup-picker');
    if (!box) {
        return;
    }
    box.textContent = '';
    if (!dupGroups.length) {
        return;
    }
    box.appendChild(el('div', 'wxg-note',
        '疑似重复 ' + String(dupGroups.length) + ' 组：每组保留第一条，'
        + '勾选要并进去的（会先留快照，「撤回上一次」可反悔）'));
    dupGroups.forEach((g, gi) => {
        const wrap = el('div', 'wxg-dup-group');
        wrap.appendChild(el('div', 'wxg-note',
            '第 ' + String(gi + 1) + ' 组 · 保留：' + ((g[0] && g[0].name) || '未记名')));
        for (let i = 1; i < g.length; i += 1) {
            const m = g[i] || {};
            const lab = el('label', 'wxg-dup-item');
            const cb = el('input');
            cb.type = 'checkbox';
            cb.checked = !!(m.id && dupPick.has(m.id));
            cb.setAttribute('data-action', 'dup-toggle');
            cb.setAttribute('data-id', m.id || '');
            lab.appendChild(cb);
            lab.appendChild(el('span', '', ' ' + (m.name || '未记名')));
            wrap.appendChild(lab);
        }
        box.appendChild(wrap);
    });
    const bar = el('div', 'wxg-row');
    bar.appendChild(button('全选', 'dup-toggle-all', 'wxg-btn-sm', 'on'));
    bar.appendChild(button('全不选', 'dup-toggle-all', 'wxg-btn-sm', 'off'));
    bar.appendChild(button('合并勾选的（' + String(dupPick.size) + '）', 'merge-selected-dupes', 'wxg-btn-sm wxg-primary'));
    bar.appendChild(button('关掉这张清单', 'dup-clear', 'wxg-btn-sm'));
    box.appendChild(bar);
}



/**
 * ⭐ ST4（材料 11·设置层）：**这一段有没有没保存的草稿** ✓
 *   为什么要它：她改完直接点左栏切页／关工作台时，草稿**无声没了** ✗
 *   → 这里只回答“有没有”，⛔ 自己落盘、⛔ 拦她切页 ✗（我们不改保存语义 ✓）
 */

export const DUPE_ACTION_SET = new Set(['merge-all-dupes', 'detect-dupes', 'merge-selected-dupes', 'dup-toggle', 'dup-toggle-all', 'dup-clear']);

export function handleDupeAction(action, target, id, host, isChange, rerender) {
    switch (action) {
                case 'merge-all-dupes': {
                    const groups = autoDetectDuplicates();
                    if (!groups.length) {
                        toast.ok('没发现疑似重复的记录');
                        break;
                    }
                    const msg = '要把查重出的 ' + String(groups.length) + ' 组重复全部合并吗？\n\n'
                        + '（每组保留第一条，其余并进去；会先留一份快照，「撤回上一次」能撤回来）';
                    const askOk = (typeof window !== 'undefined' && typeof window.confirm === 'function')
                        ? window.confirm(msg)
                        : true;
                    if (!askOk) {
                        break;
                    }
                    takeSnapshot('批量合并重复前');
                    let merged = 0;
                    for (const g of groups) {
                        if (!Array.isArray(g) || g.length < 2) {
                            continue;
                        }
                        const keep = g[0] || {};
                        for (let i = 1; i < g.length; i += 1) {
                            const from = g[i] || {};
                            if (!keep.id || !trimText(from.name)) {
                                continue;
                            }
                            try {
                                /* ⚠️ `mergeCharacters` 返回的是**对象**（{ ok, reason }）✗
                                 *   ⇒ ⛔ 不能直接 if(…)（对象永远为真 ✗ 会把失败当成功 ✗） */
                                const mres = mergeCharacters(keep.id, from.name);
                                if (mres === true || (mres && mres.ok === true)) {
                                    merged += 1;
                                }
                            } catch (e) {
                                /* 单组失败不影响其它 ✓ */
                            }
                        }
                    }
                    toast.ok('合并完成：并掉了 ' + String(merged) + ' 条重复 ✓');
                    rerender();
                    break;
                }
                case 'detect-dupes': {
                    /*
                     * ★ 她 22:1x：**查完重要能勾选**——否则查出重复也没法用，只能一条条手动"按这条合并"。
                     *   现在：结果存进 dupGroups，并在名册页下方渲染一张可勾选清单（每组先勾"并进去的那些"），
                     *   右下角一个「合并勾选的（N）」⇒ 一键只并她勾的那几条 ✓
                     */
                    dupGroups = autoDetectDuplicates();
                    dupPick = new Set();
                    for (const g of dupGroups) {
                        for (let i = 1; i < g.length; i += 1) {
                            if (g[i] && g[i].id) {
                                dupPick.add(g[i].id);
                            }
                        }
                    }
                    const box = byId(host, 'wxg-book-list');
                    if (!dupGroups.length) {
                        toast.ok('没发现疑似重复的记录');
                        if (box) {
                            box.textContent = '';
                        }
                    } else {
                        toast.info('发现 ' + String(dupGroups.length) + ' 组疑似重复，下面勾选要并的');
                        /* 备注区那句话保留（她习惯在那里看一眼；审计也盯着它） ✓ */
                        if (box) {
                            box.textContent = '疑似重复：' + dupGroups.map((d) => d.map((x) => x.name).join(' ⇄ ')).join(' ｜ ')
                                + '（在下面勾选后点「合并勾选的」）';
                        }
                    }
                    renderDupPicker(host);
                    break;
                }
                case 'merge-selected-dupes': {
                    const picks = Array.from(dupPick);
                    if (!picks.length) {
                        toast.warn('先勾选要并进去的人');
                        break;
                    }
                    let done = 0;
                    let failed = 0;
                    for (const g of dupGroups) {
                        if (!g || !g.length || !g[0]) {
                            continue;
                        }
                        const keep = g[0];
                        for (let i = 1; i < g.length; i += 1) {
                            const m = g[i];
                            if (!m || !m.id || !dupPick.has(m.id)) {
                                continue;
                            }
                            try {
                                if (mergeCharacters(keep.id, m.name)) {
                                    done += 1;
                                } else {
                                    failed += 1;
                                }
                            } catch (eM) {
                                failed += 1;
                            }
                        }
                    }
                    dupGroups = [];
                    dupPick = new Set();
                    if (done) {
                        toast.ok('合并了 ' + String(done) + ' 条' + (failed ? ('（' + String(failed) + ' 条没成功）') : ''));
                    } else {
                        toast.warn('一条都没并成');
                    }
                    rerender();
                    break;
                }
                case 'dup-toggle': {
                    const cid = trimText(id);
                    if (cid) {
                        if (dupPick.has(cid)) {
                            dupPick.delete(cid);
                        } else {
                            dupPick.add(cid);
                        }
                        renderDupPicker(host);
                    }
                    break;
                }
                case 'dup-toggle-all': {
                    const on = id === 'on';
                    dupPick = new Set();
                    if (on) {
                        for (const g of dupGroups) {
                            for (let i = 1; i < g.length; i += 1) {
                                if (g[i] && g[i].id) {
                                    dupPick.add(g[i].id);
                                }
                            }
                        }
                    }
                    renderDupPicker(host);
                    break;
                }
                case 'dup-clear': {
                    dupGroups = [];
                    dupPick = new Set();
                    renderDupPicker(host);
                    break;
                }
                /* ---- 召回 ---- */
    }
}

