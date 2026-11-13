/* 设-6 上半：导入备份/导出聊天/导出备份。从 sections.js 抽出（206 后） */
import { importState, exportState } from '../../core/state.js';

import { downloadText } from './render.js';
import { toast } from '../toast.js';
import { getSettings, exportSettings } from '../../core/settings.js';
import { saveLayerLimits } from '../layer-limits.js';
import { deleteLedgerRow } from '../ledgers.js';
import { buildBundle, verifyBundle, importGate } from '../../core/bundle.js';
import { publishToBook } from '../../core/book.js';
import { loadState } from '../../core/state.js';
import { currentChatKey } from '../../core/adapter.js';


export const IO_ACTION_SET = new Set(['import-data', 'save-layer-limits', 'del-clue', 'export-chat', 'export-data', 'export-bundle', 'import-bundle', 'publish-book']);


export async function handleIoAction(action, target, id, host, isChange, rerender) {
    switch (action) {
                case 'import-data': {
                    /* 她选一个 .json ⇒ 先问一句 ⇒ 留快照 ⇒ 整本导入 ✓ */
                    try {
                        const inp = document.createElement('input');
                        inp.type = 'file';
                        inp.accept = '.json,application/json';
                        inp.style.display = 'none';
                        document.body.appendChild(inp);
                        inp.addEventListener('change', () => {
                            const f = inp.files && inp.files[0];
                            if (!f) { return; }
                            const rd = new FileReader();
                            rd.onload = () => {
                                try {
                                    const data = JSON.parse(String(rd.result || '{}'));
                                    const ask = (typeof window !== 'undefined' && typeof window.confirm === 'function')
                                        ? window.confirm('要把这份备份导入进来吗？\n\n（会先留一份快照，「撤回上一次」能撤回来 ✓）')
                                        : true;
                                    if (!ask) { return; }
                                    takeSnapshot('导入备份前');
                                    /* 111：备份里带设置才问一句；不带就照旧（⛔ 报错） */
                        const hasSettings = !!(data && data.settings && typeof data.settings === 'object' && Object.keys(data.settings).length);
                        let importSettings = false;
                        if (hasSettings) {
                            try {
                                importSettings = (typeof window !== 'undefined' && typeof window.confirm === 'function')
                                    ? window.confirm('这份备份里还带了设置（含 API 书签与密钥）。\n\n要连设置一起导入吗？\n⚠️ 会覆盖本机现在的设置与 API；选「取消」就只导账本。')
                                    : false;
                            } catch (eAsk2) { importSettings = false; }
                        }
                        const res = importState(data);
                                    if (!res || res.ok !== true) {
                                        toast.fail('导入没成：' + ((res && res.reason) || '不知道为什么'));
                                        return;
                                    }
                                    if (importSettings) {
                            takeSnapshot('导入设置前');
                            try {
                                patchSettings(data.settings || {});
                                toast.ok('设置也导进来了');
                            } catch (eSetImp) {
                                toast.fail('设置导入没成：' + ((eSetImp && eSetImp.message) || String(eSetImp)));
                            }
                        }
                        const cnt = (res && res.counts) || {};
                                    toast.ok('导入好了：人 ' + String(cnt.characters || 0)
                                        + ' ｜ 暗线 ' + String(cnt.hidden || 0)
                                        + ' ｜ 局势 ' + String(cnt.situations || 0)
                                        + ' ｜ 编年 ' + String(cnt.chronicle || 0));
                                    rerender();
                                } catch (eP) {
                                    toast.fail('这个文件读不成：' + ((eP && eP.message) || String(eP)));
                                } finally {
                                    try { inp.remove(); } catch (eR) { /* 删不掉也不要紧 ✓ */ }
                                }
                            };
                            rd.onerror = () => { toast.fail('读这个文件失败'); };
                            rd.readAsText(f);
                        });
                        inp.click();
                    } catch (eImp) {
                        toast.fail('打不开选文件的窗口：' + ((eImp && eImp.message) || String(eImp)));
                    }
                    break;
                }
                case 'save-layer-limits': { saveLayerLimits(hostEl || document); rerender(); break; }
    case 'del-clue': if (deleteLedgerRow('clue', target.getAttribute('data-id') || target.id)) { rerender(); } break;
    case 'export-chat': {
        /* 110：导出这段聊天原文（只读；⛔ 写回任何东西） */
        try {
            const ctx = (window.SillyTavern && typeof window.SillyTavern.getContext === 'function') ? window.SillyTavern.getContext() : null;
            const chat = (ctx && Array.isArray(ctx.chat)) ? ctx.chat : [];
            const body = chat.map((m, i) => {
                const who = (m && m.is_user) ? '你' : ((m && m.name) || '角色');
                return '#' + String(i) + ' [' + who + ']\n' + String((m && m.mes) || '');
            }).join('\n\n');
            const d0 = new Date();
            const stamp = d0.getFullYear() + '-' + String(d0.getMonth() + 1).padStart(2, '0') + '-' + String(d0.getDate()).padStart(2, '0') + '-' + String(d0.getHours()).padStart(2, '0') + String(d0.getMinutes()).padStart(2, '0');
            downloadText('万象阁聊天-' + stamp + '.txt', body || '（这段聊天还没有内容）');
            toast.ok('聊天已导出（' + chat.length + ' 条）');
        } catch (eEC) {
            toast.fail('导出聊天没成：' + ((eEC && eEC.message) || String(eEC)));
        }
        break;
    }
    case 'export-data':
                    downloadText('万象阁备份-' + (function () { /* ⭐ U19：用**本地**日期（⛔ UTC：北京凌晨 0–8 点导出会显示成“昨天” ✗） */ var d0 = new Date(); return d0.getFullYear() + '-' + String(d0.getMonth() + 1).padStart(2, '0') + '-' + String(d0.getDate()).padStart(2, '0'); })() + '.json', JSON.stringify({
            kind: 'wanxiangge-backup',
            version: String((getSettings().version || '')),
            at: Date.now(),
            state: exportState(),
            settings: exportSettings(),
        }, null, 2));
                    toast.ok('备份已导出');
                    break;
                case 'export-bundle': {
                    /* 导出：自带摘要与验签（依据＝阿砚 A 组 E4） */
                    const rB = buildBundle(loadState());
                    if (!rB.ok) { toast.bad(rB.reason); break; }
                    try {
                        const blob = new Blob([rB.text], { type: 'application/json' });
                        const aEl = document.createElement('a');
                        aEl.href = URL.createObjectURL(blob);
                        aEl.download = '万象阁-账本-' + String(rB.digest || '') + '.json';
                        document.body.appendChild(aEl);
                        aEl.click();
                        setTimeout(() => { try { URL.revokeObjectURL(aEl.href); aEl.remove(); } catch (eR) { } }, 0);
                        toast.ok('导出好了：' + String(rB.summary.chars) + ' 人物／' + String(rB.summary.chronicle) + ' 编年（包里带摘要）');
                    } catch (eExp) {
                        toast.bad('导出失败：' + (eExp && eExp.message ? eExp.message : String(eExp)));
                    }
                    break;
                }

                case 'import-bundle': {
                    /* 导入：先验签（六道拒因）→ 再看归属（⛔ 静默覆盖）→ 写完回读 */
                    const inp = document.createElement('input');
                    inp.type = 'file';
                    inp.accept = '.json,application/json';
                    inp.onchange = async () => {
                        const f = inp.files && inp.files[0];
                        if (!f) { return; }
                        let text = '';
                        try {
                            text = await f.text();
                        } catch (eRead) {
                            toast.bad('读不了这个文件');
                            return;
                        }
                        const v = verifyBundle(text);
                        if (!v.ok) { toast.bad('这份文件不能导入：' + v.reason); return; }
                        const gate = importGate(v.ledger, currentChatKey(), loadState());
                        if (!gate.ok) { toast.bad(gate.reason); return; }
                        if (gate.warn) {
                            const yes = (typeof window !== 'undefined' && window.confirm) ? window.confirm(gate.warn + '\n\n确定导入？') : false;
                            if (!yes) { return; }
                        }
                        const wB = await adoptLedgerForImport(currentChatKey(), v.ledger);
                        if (!wB.ok) { toast.bad('导入没写进去：' + wB.reason); return; }
                        toast.ok('导入完成：' + String(v.summary.chars) + ' 人物／' + String(v.summary.chronicle) + ' 编年');
                        rerender();
                    };
                    inp.click();
                    break;
                }

                case 'publish-book': {
                    const res = await publishToBook({ force: true });
                    if (res && res.ok) {
                        toast.ok('已写进世界书《' + res.book + '》：' + String(res.entries) + ' 条');
                    } else {
                        toast.fail('世界书没写成：' + ((res && res.reason) || '未知原因'));
                    }
                    break;
                }
    }
}

