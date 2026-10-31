/**
 * 万象阁 · 线索账（125 号：舆情／回声／通讯三样已删，四个账只剩这一个）
 *
 * 只读列表 ＋ 每条可删 ＋ 顶部计数；空态照现有写法（"还没有线索"）。
 */

import { loadState, saveState } from '../core/state.js';
import { el, card, button, section } from './sections.js';

function timeText(at) {
    const n = Number(at);
    if (!Number.isFinite(n) || n <= 0) {
        return '——';
    }
    try {
        return new Date(n).toLocaleString('zh-CN', { hour12: false });
    } catch (e) {
        return '——';
    }
}

/** 把「线索账」这一页挂进 stage（工作台按 section 自动出导航项） */
export function mountLedgers(host) {
    const st = loadState() || {};
    const box = section('线索账',
        '线索：一件事办到第几步（新→发展→触发→余波→解决／废弃）——只读列表，每条可删。',
        { open: false, five: false });

    const clues = Array.isArray(st.clues) ? st.clues : [];
    const c = card('线索（' + String(clues.length) + ' 条）');
    c.appendChild(el('div', 'wxg-note', '新 → 发展 → 触发 → 余波 → 解决／废弃'));
    if (!clues.length) {
        c.appendChild(el('div', 'wxg-empty', '还没有线索'));
    } else {
        for (const row of clues) {
            const r = el('div', 'wxg-r');
            const main = el('div', 'wxg-r-main');
            const t = el('div', 'wxg-r-title');
            t.appendChild(el('span', 'wxg-r-who', (row && row.title) || '（未记题）'));
            if (row && row.state) {
                t.appendChild(el('span', 'wxg-badge is-soft', row.state));
            }
            main.appendChild(t);
            main.appendChild(el('div', 'wxg-r-sub',
                ((row && row.owner) ? ('持有：' + row.owner + '　') : '') + timeText(row && (row.resolvedAt || row.fromFloor))));
            r.appendChild(main);
            const act = el('div', 'wxg-r-act');
            act.appendChild(button('删', 'del-clue', 'wxg-btn-xs', String((row && row.id) || '')));
            r.appendChild(act);
            c.appendChild(r);
        }
    }
    box.appendChild(c);
    host.appendChild(box);
}

/** 删除一条线索 */
export function deleteLedgerRow(kind, id) {
    if (String(kind) !== 'clue') {
        return false;
    }
    const st = loadState() || {};
    const rid = String(id || '');
    if (!rid) {
        return false;
    }
    st.clues = (st.clues || []).filter((x) => String(x && x.id) !== rid);
    saveState();
    return true;
}
