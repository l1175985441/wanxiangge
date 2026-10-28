/**
 * 万象阁 · 四个账（通讯／线索／回声／舆情）—— 独立页（不塞进 sections.js：那边已贴行数硬线）
 *
 * 只读列表 ＋ 每条可删 ＋ 顶部计数；空态照现有三种写法（"还没有…"）。
 * ⚠️ 通讯这一本在引擎里暂时没有自然产生点（见交付说明）；这里仍给它页面与空态，
 *    等以后有了产生点，不用再改界面。
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

function listCard(title, hint, rows, emptyText, delAction) {
    const c = card(title + '（' + String(rows.length) + ' 条）');
    c.appendChild(el('div', 'wxg-note', hint));
    if (!rows.length) {
        c.appendChild(el('div', 'wxg-empty', emptyText));
        return c;
    }
    for (const r of rows) {
        const row = el('div', 'wxg-r');
        const main = el('div', 'wxg-r-main');
        const t = el('div', 'wxg-r-title');
        t.appendChild(el('span', 'wxg-r-who', r.main || '（未记）'));
        if (r.tag) {
            t.appendChild(el('span', 'wxg-badge is-soft', r.tag));
        }
        main.appendChild(t);
        main.appendChild(el('div', 'wxg-r-sub', (r.sub || '') + '　' + timeText(r.at)));
        row.appendChild(main);
        const act = el('div', 'wxg-r-act');
        act.appendChild(button('删', delAction, 'wxg-btn-xs', String(r.id || '')));
        row.appendChild(act);
        c.appendChild(row);
    }
    return c;
}

/** 把「四个账」这一页挂进 stage（工作台按 section 自动出导航项） */
export function mountLedgers(host) {
    const st = loadState() || {};
    const box = section('四个账',
        '通讯／线索／回声／舆情 —— 只读列表，每条可删；这一页不写回正文。',
        { open: false, five: false });

    const threads = Array.isArray(st.threads) ? st.threads : [];
    box.appendChild(listCard('通讯', '谁和谁说过话（会话列表）', threads.map((th) => ({
        id: th && th.id,
        main: (th && (th.members || []).join(' ↔ ')) || '（没有成员）',
        tag: th && th.kind === 'group' ? '群聊' : '私聊',
        sub: th && th.messages && th.messages.length ? ('最近：' + String((th.messages[th.messages.length - 1] || {}).text || '').slice(0, 40)) : '还没有消息',
        at: th && th.lastAt,
    })), '这一本暂时不由引擎产生（例：引擎还没有“谁跟谁说过话”的判定）；以后有了会自己出现', 'del-thread'));

    const clues = Array.isArray(st.clues) ? st.clues : [];
    box.appendChild(listCard('线索', '新 → 发展 → 触发 → 余波 → 解决／废弃', clues.map((c) => ({
        id: c && c.id,
        main: (c && c.title) || '（未记题）',
        tag: (c && c.state) || 'new',
        sub: (c && c.owner) ? ('持有：' + c.owner) : '',
        at: c && (c.resolvedAt || c.fromFloor),
    })), '还没有线索', 'del-clue'));

    const echoes = Array.isArray(st.echoes) ? st.echoes : [];
    box.appendChild(listCard('回声', '事完了留下的余波（只从已解决事件来）', echoes.map((e) => ({
        id: e && e.eventId,
        main: (e && e.text) || '（未记）',
        tag: e && Number.isFinite(Number(e.heat)) ? ('热度 ' + String(e.heat)) : '',
        sub: (e && Array.isArray(e.affectedIds) && e.affectedIds.length) ? ('牵动：' + e.affectedIds.join('、')) : '',
        at: e && e.fromFloor,
    })), '还没有回声', 'del-echo'));

    const opinion = Array.isArray(st.opinion) ? st.opinion : [];
    const news = (st.opinionSnapshot && Array.isArray(st.opinionSnapshot.news)) ? st.opinionSnapshot.news : [];
    const opRows = news.map((n) => ({
        id: n && (n.id || n.related_event_id),
        main: (n && n.headline) || '（未记题）',
        tag: n && n.source_type === 'official' ? '官方' : '非官方',
        sub: (n && n.scope) || '',
        at: 0,
    })).concat(opinion.map((o) => ({
        id: o && o.topic,
        main: (o && o.topic) || '（未记题）',
        tag: o && Number.isFinite(Number(o.heat)) ? ('热度 ' + String(o.heat)) : '',
        sub: (o && o.stance) || '',
        at: 0,
    })));
    box.appendChild(listCard('舆情', '新闻／论坛快照 ＋ 话题倾向（只读）', opRows, '还没有舆情', 'del-opinion'));

    host.appendChild(box);
}

/** 删除一条（按账本类型） */
export function deleteLedgerRow(kind, id) {
    const st = loadState() || {};
    const key = String(kind || '');
    const rid = String(id || '');
    if (!rid) {
        return false;
    }
    if (key === 'thread') {
        st.threads = (st.threads || []).filter((x) => String(x && x.id) !== rid);
    } else if (key === 'clue') {
        st.clues = (st.clues || []).filter((x) => String(x && x.id) !== rid);
    } else if (key === 'echo') {
        st.echoes = (st.echoes || []).filter((x) => String(x && x.eventId) !== rid);
    } else if (key === 'opinion') {
        st.opinion = (st.opinion || []).filter((x) => String(x && x.topic) !== rid);
        if (st.opinionSnapshot && Array.isArray(st.opinionSnapshot.news)) {
            st.opinionSnapshot.news = st.opinionSnapshot.news.filter((x) => String((x && (x.id || x.related_event_id)) || '') !== rid);
        }
    } else {
        return false;
    }
    saveState();
    return true;
}
