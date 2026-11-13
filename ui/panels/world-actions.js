/* 世-2/世-3/隐-1：世界钟·地点·世界事实＋暗线事件。从 sections.js 抽出（206 后） */
import { updateWorld, loadState, saveState, takeSnapshot, removeHidden, addHiddenManually, addChronicle, removeFaction, upsertFaction } from '../../core/state.js';
import { openSituation, setOpenSituation } from './shared.js';
import { clockWentBackwards } from '../../core/clock.js';
import { shiftWorldClock } from '../../core/world-events.js';
import { trimText } from '../../core/utils.js';
import { byId, textOf } from './render.js';
import { toast } from '../toast.js';


export const WORLD_ACTION_SET = new Set(['set-world-clock', 'set-world-place', 'set-world-big', 'shift-world-clock','set-hidden-stage', 'del-hidden', 'add-hidden']);


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

export const SITUATION_ACTION_SET = new Set(['add-situation', 'del-situation', 'set-situation', 'edit-situation']);

export function handleSituationAction(action, target, id, host, isChange, rerender) {
    switch (action) {
                case 'add-situation': {
                    const title = trimText(textOf(host, 'wxg-new-situation'));
                    if (!title) {
                        toast.warn('先写一句这条局势是什么');
                        break;
                    }
                    const list = (loadState().world.situations || []).slice();
                    list.push({ title, sides: '', tier: '几天内', at: Date.now(), floor: -1, manual: true, source: 'manual' });
                    updateWorld({ situations: list }, { manual: true });
                    toast.ok('加上了');
                    rerender();
                    break;
                }
                case 'del-situation': {
                    /* ⭐材料 06第一波：**二次确认 ＋ 快照** ✓
                     *   旧：点一下当场物理删除 ✗ 不弹确认 ✗ 不留快照 ✗
                     *        （点「撤回上一次」都撤不回来 ✗ —— 她的账不能这么掉 ✗）
                     *   新：先问一句 ✓ 再留一份快照 ✓ （沿用代码里既有的 window.confirm 写法 ✓ ⛔ 不引入新弹窗 ✗） */
                    if (typeof window !== 'undefined' && typeof window.confirm === 'function' && !window.confirm('要把这条局势删掉吗？\n\n（会先留一份快照，点「撤回上一次」能撤回来）')) { break; }
                    takeSnapshot('删除前（这条局势）');
                    const idx = Number(target.getAttribute('data-index'));
                    const list = (loadState().world.situations || []).slice();
                    if (Number.isFinite(idx) && list[idx]) {
                        const gone = list.splice(idx, 1)[0];
                        updateWorld({ situations: list }, { manual: true });
                        addChronicle({ floor: -1, kind: '局势·手动删除', who: '', text: trimText(gone.title) || '未记名' });
                        toast.ok('删掉了（已在编年里留痕）');
                        rerender();
                    }
                    break;
                }
                case 'set-situation': {
                    if (!isChange) {
                        break;
                    }
                    const idx = Number(target.getAttribute('data-index'));
                    const wkey = target.getAttribute('data-key') || '';
                    const newVal = trimText(target.value);
                    const state = loadState();
                    /*
                     * \u2b50\u2b50 \u6750\u6599 04\uff1a\u6539\u540d\u7684**\u4e09\u5904\u8fde\u9501\u5f15\u7528**\u4e00\u6b21\u540c\u6b65\u5230\u4f4d \u2713
                     *   \u4e3a\u4ec0\u4e48\u5fc5\u987b\u663e\u5f0f\u540c\u6b65\uff1a`recallRecords` \u662f**\u5386\u53f2\u65e5\u5fd7**\uff0c\u53ea\u4f1a\u8ffd\u52a0\u3001\u4e0d\u4f1a\u91cd\u7b97\u65e7\u8f6e\u6b21 \u2717
                     *   \u4e0d\u540c\u6b65\u7684\u540e\u679c\uff1a\u67d0\u6761\u4e8b\u4ef6\u5df2\u56e0\u201c\u8fde\u7eed 3 \u8f6e\u6ca1\u8fdb\u6b63\u6587\u201d\u8f6c\u5165\u7f16\u5e74\uff08`archived: true`\uff09\u540e \u2717
                     *     \u4f60\u5728\u6d6e\u5c42\u91cc\u6539\u4e86\u540d\u5b57 \u21d2 `archivedTitles` \u91cc\u5b58\u7684\u8fd8\u662f**\u65e7\u540d\u5b57** \u2717\n                     *     \u21d2 \u6539\u540d\u540e\u7684\u8fd9\u6761\u4e8b\u4ef6**\u5f53\u573a\u9003\u51fa\u5c01\u9501\u3001\u91cd\u65b0\u6324\u5360\u6bcf\u8f6e\u7684\u6ce8\u5165\u4f4d** \u2717
                     *   \u540c\u7406\uff1a\u524d 1\uff5e2 \u8f6e\u521a\u6ce8\u5165\u3001\u6b63\u5728\u7b49 `markArrivals` \u6838\u5bf9\u201c\u8fdb\u6ca1\u8fdb\u65b0\u6b63\u6587\u201d\u7684\u5019\u8865\u8bb0\u5f55\uff0c\u4e5f\u662f\u4ece `rec.events` \u91cc\u8bfb `eventTitle(x)` \u7684 \u2717
                     */
                    const syncRenamedWorldEntry = (oldName, newName) => {
                        if (!oldName || !newName || oldName === newName) {
                            return;
                        }
                    /* S4（材料 05）：同步收窄 ＋ 重名拦截 ✓ */
                    const worldish = (row) => /\u6697\u7ebf|\u5c40\u52bf|\u5f52\u5e76|\u5019\u8865/.test(String((row && row.kind) || ''));
                    const dupName = (nm) => {
                        try {
                            const st2 = loadState();
                            const w2 = st2.world || {};
                            const inH = (Array.isArray(w2.hidden) ? w2.hidden : []).some((h) => h && matchKey(h.name) === matchKey(nm) && trimText(h.name) !== oldName);
                            const inS = (Array.isArray(w2.situations) ? w2.situations : []).some((x) => x && matchKey(x.title) === matchKey(nm) && trimText(x.title) !== oldName);
                            return inH || inS;
                        } catch (eDup) {
                            return false;
                        }
                    };
                    if (dupName(newName)) {
                        toast.warn('已经有同名的暗线／局势了，换个名字吧（⛔ 两条撞名会找错 ✗）');
                        return false;
                    }
                        for (const c of (state.chronicle || [])) {
                            if (!c) continue;
                            if (trimText(c.who) === oldName) {
                                c.who = newName;
                            }
                            if (typeof c.text === 'string' && c.text.includes(oldName)
                                && (trimText(c.who) === oldName || worldish(c))) {
                                c.text = c.text.split(oldName).join(newName);
                            }
                        }
                        for (const ev of (state.events || [])) {
                            if (ev && trimText(ev.title) === oldName) {
                                ev.title = newName;
                            }
                        }
                        for (const rec of (state.recallRecords || [])) {
                            if (!rec || !Array.isArray(rec.events)) continue;
                            rec.events = rec.events.map((ev) => {
                                if (typeof ev === 'string') {
                                    return trimText(ev) === oldName ? newName : ev;
                                }
                                if (ev && typeof ev === 'object') {
                                    const copy = Object.assign({}, ev);
                                    if (trimText(copy.title) === oldName) copy.title = newName;
                                    if (trimText(copy.name) === oldName) copy.name = newName;
                                    return copy;
                                }
                                return ev;
                            });
                        }
                    };
                    if (target.getAttribute('data-hidden') === '1') {
                        const hlist = (state.world.hidden || []).slice();
                        if (Number.isFinite(idx) && hlist[idx]) {
                            if (wkey === 'name' && !newVal) {
                                toast.warn('\u6697\u7ebf\u540d\u79f0\u4e0d\u80fd\u4e3a\u7a7a');
                                break;
                            }
                            const oldName = trimText(hlist[idx].name);
                            hlist[idx] = Object.assign({}, hlist[idx], {
                                [wkey]: newVal, manual: true, updatedAt: Date.now(),
                            });
                            if (wkey === 'name') {
                                syncRenamedWorldEntry(oldName, newVal);
                            }
                            updateWorld({ hidden: hlist }, { manual: true });
                            saveState();
                            toast.ok('\u6697\u7ebf\u6539\u597d\u4e86');
                            rerender();
                            if (openWorldEntry) {
                                renderWorldEntryCard();
                            }
                        }
                        break;
                    }
                    const list = (state.world.situations || []).slice();
                    if (Number.isFinite(idx) && list[idx]) {
                        if (wkey === 'title' && !newVal) {
                            toast.warn('\u5c40\u52bf\u6807\u9898\u4e0d\u80fd\u4e3a\u7a7a');
                            break;
                        }
                        const oldTitle = trimText(list[idx].title);
                        list[idx] = Object.assign({}, list[idx], { [wkey]: newVal, manual: true });
                        if (wkey === 'title') {
                            syncRenamedWorldEntry(oldTitle, newVal);
                        }
                        updateWorld({ situations: list }, { manual: true });
                        saveState();
                        toast.ok('\u5c40\u52bf\u6539\u597d\u4e86');
                        rerender();
                        if (openWorldEntry) {
                            renderWorldEntryCard();
                        }
                    }
                    break;
                }
                case 'edit-situation': {
                    const idx = Number(target.getAttribute('data-index'));
                    setOpenSituation(String(openSituation) === String(idx) ? -1 : idx);
                    rerender();
                    break;
                }
    }
}

function openFactionEditor(id, after) {
    const f = (loadState().world.factions || []).find((x) => x && x.id === id);
    if (!f) { return; }
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;';
    const panel = document.createElement('div');
    panel.style.cssText = 'background:var(--SmartThemeBlurTintColor,#fff);color:var(--SmartThemeBodyColor,#222);padding:16px;border-radius:10px;max-width:520px;width:92%;max-height:88vh;overflow:auto;';
    const mk = (label, value, tag) => {
        const row = document.createElement('label');
        row.style.cssText = 'display:block;margin:6px 0;font-size:13px;';
        row.textContent = label + '\uff1a';
        const inp = document.createElement(tag || 'input');
        if (tag === 'select') {
            const opts = ['', '\u9f0e\u76db', '\u7a33\u56fa', '\u503e\u8f67', '\u56f0\u987f', '\u8870\u843d', '\u74e6\u89e3'];
            for (const v of opts) { const o = document.createElement('option'); o.value = v; o.textContent = v || '\uff08\u7a7a\uff09'; inp.appendChild(o); }
        } else if (tag === 'textarea') {
            inp.rows = 3;
        }
        inp.value = value == null ? '' : String(value);
        inp.style.cssText = 'display:block;width:100%;margin-top:2px;';
        row.appendChild(inp); panel.appendChild(row);
        return inp;
    };
    mk('\u540d\u5b57', f.name);
    const core = mk('\u6838\u5fc3\u4eba', f.core_person);
    const status = mk('\u72b6\u6001', f.status, 'select');
    const relation = mk('\u5bf9\u73a9\u5bb6', f.relation);
    const scope = mk('\u8303\u56f4', f.scope);
    const scale = mk('\u89c4\u6a21', f.scale);
    const note = mk('\u63cf\u8ff0', f.note, 'textarea');
    const pillars = mk('\u652f\u67f1\uff08\u9017\u53f7\u5206\u9694\uff09', (f.powerPillars || []).join('\uff0c'));
    const members = mk('\u6210\u5458\uff08\u6bcf\u884c\u4e00\u4e2a\uff1a\u540d\u5b57 \u6216 \u540d\u5b57|\u4eba\u7269id\uff09', (f.members || []).map((m) => m.id ? m.name + '|' + m.id : m.name).join('\n'), 'textarea');
    const btns = document.createElement('div');
    btns.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;margin-top:10px;';
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = '\u53d6\u6d88';
    const save = document.createElement('button'); save.type = 'button'; save.textContent = '\u4fdd\u5b58'; save.className = 'wxg-btn';
    btns.appendChild(cancel); btns.appendChild(save); panel.appendChild(btns); wrap.appendChild(panel); document.body.appendChild(wrap);
    cancel.onclick = () => wrap.remove();
    save.onclick = () => {
        const oldP = (f.powerPillars || []).join('\uff0c');
        const oldM = (f.members || []).map((m) => (m.id ? m.name + '|' + m.id : m.name)).join('\n');
        const patch = {
            id: f.id, name: trimText(name.value), core_person: trimText(core.value),
            status: trimText(status.value), relation: trimText(relation.value),
            scope: trimText(scope.value), scale: trimText(scale.value), note: trimText(note.value),
            powerPillars: pillars.value.split(/[\uff0c,\u3001]/).map(trimText).filter(Boolean),
            members: members.value.split('\n').map((line) => {
                const s = trimText(line); if (!s) { return null; }
                const k = s.indexOf('|');
                if (k < 0) { return { name: s }; }
                const nm = trimText(s.slice(0, k)); const cid = trimText(s.slice(k + 1));
                return cid ? { id: cid, name: nm } : { name: nm };
            }).filter(Boolean),
        };
        const touched = [];
        if (patch.core_person !== trimText(f.core_person)) { touched.push('core_person'); }
        if (patch.status !== trimText(f.status)) { touched.push('status'); }
        if (patch.relation !== trimText(f.relation)) { touched.push('relation'); }
        if (patch.scope !== trimText(f.scope)) { touched.push('scope'); }
        if (patch.scale !== trimText(f.scale)) { touched.push('scale'); }
        if (patch.note !== trimText(f.note)) { touched.push('note'); }
        if (patch.powerPillars.join('\uff0c') !== oldP) { touched.push('powerPillars'); }
        if (members.value.replace(/\r/g, '') !== oldM) { touched.push('members'); }
        upsertFaction(patch, { manual: true, manualFields: touched });
        wrap.remove();
        if (typeof after === 'function') { after(); }
    };
}

export const FACTION_ACTION_SET = new Set(['del-faction','add-faction','edit-faction']);

export function handleFactionAction(action, target, id, rerender) {
    switch (action) {
    case 'del-faction': if (removeFaction(target.getAttribute('data-id') || target.id)) { rerender(); } break;
    case 'add-faction': { const nm = window.prompt('新增势力：名字'); if (nm && trimText(nm)) { const f = upsertFaction({ name: trimText(nm), manual: true }); if (f) { openFactionEditor(f.id, rerender); } } break; }
        case 'edit-faction': openFactionEditor(target.getAttribute('data-id') || target.id, rerender); break;
    case 'shift-world-clock': {
        const sd = Number(target.id);
        if (shiftWorldClock(sd)) { toast.ok('世界钟拨了 ' + (sd > 0 ? '+' : '') + String(sd) + ' 天'); rerender(); }
        break;
    }
    }
}
