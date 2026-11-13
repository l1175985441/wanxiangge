/* 变量页（变-1 快照 / 变-5 占位符清单）——从零起，先做只读可见 */
import { section, card, el, row, button, emptyBlock } from './shared.js';
import { loadState, getRoster } from '../../core/state.js';
import { promptVarRows } from '../prompt-copy.js';
import { asArray, trimText } from '../../core/utils.js';

export function secVariables(host) {
    const box = section('变量',
        '这一页只回答两件事：每个人现在的三格快照是什么，提示词里能写哪些变量。',
        { open: false, summary: '快照／能写哪些变量' });

    const cSnap = card('每层变量快照');
    const roster = asArray(getRoster ? getRoster() : loadState().roster);
    if (!roster.length) {
        cSnap.appendChild(emptyBlock('名册里还没有人（先去名册录入）'));
    } else {
        const head = el('div', 'wxg-row');
        for (const t of ['姓名', '过去经历', '正在经历']) {
            head.appendChild(el('span', 'wxg-note', t));
        }
        cSnap.appendChild(head);
        for (const c of roster) {
            const r = el('div', 'wxg-row');
            r.appendChild(el('span', 'wxg-strong', trimText(c && c.name) || '（无名）'));
            r.appendChild(el('span', '', trimText(c && c.past && c.past.length ? (c.past[c.past.length - 1].text || '') : (c && c.pastText)) || '—'));
            r.appendChild(el('span', '', trimText(c && c.current) || '—'));
            cSnap.appendChild(r);
            const past = Array.isArray(c && c.past) ? c.past.filter((x) => x && trimText(x.text)) : [];
            if (past.length) {
                const det = el('details', 'wxg-fold');
                det.appendChild(el('summary', '', '按层回看（过去经历 ' + String(past.length) + ' 条）'));
                for (const p of past.slice(-8)) {
                    const when = Number.isFinite(Number(p.fromFloor)) && Number(p.fromFloor) > 0
                        ? ('第 ' + String(Number(p.fromFloor)) + ' 层')
                        : (Number(p.at) ? new Date(Number(p.at)).toLocaleString() : '—');
                    det.appendChild(el('div', 'wxg-note', when + '：' + trimText(p.text)));
                }
                cSnap.appendChild(det);
            }
        }
    }
    box.appendChild(cSnap);

    const cVars = card('能写哪些变量（11 个占位符）');
    const list = el('div', 'wxg-list');
    for (const it of promptVarRows()) {
        const r = el('div', 'wxg-row');
        r.appendChild(el('code', 'wxg-code', it[0]));
        r.appendChild(el('span', 'wxg-note', it[1]));
        list.appendChild(r);
    }
    cVars.appendChild(list);
    box.appendChild(cVars);
    const cReserved = card('前台／后台 · A-／A+／🌙（预留）');
    cReserved.appendChild(el('div', 'wxg-note',
        '这一块的口径还没定：按哪个字段分前台/后台、三颗按钮各改什么，都等你拍板。先占位，⛔ 不猜着接行为。'));
    const rsv = el('div', 'wxg-row');
    for (const label of ['前台 FRONT', '后台 BACK', 'A-', 'A+', '🌙']) {
        const b = button(label, 'variables-reserved', 'wxg-btn-sm');
        b.disabled = true;
        b.title = '口径未定，先预留';
        rsv.appendChild(b);
    }
    cReserved.appendChild(rsv);
    box.appendChild(cReserved);
    host.appendChild(box);
}
