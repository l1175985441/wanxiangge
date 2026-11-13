/* 从 ui/sections.js 原样搬出，逻辑一字未改（206 单） */
import { asArray, countChars, floorLabel } from '../../core/utils.js'; import { getChat } from '../../core/adapter.js'; import { getChronicle, loadState } from '../../core/state.js'; import { PER_PAGE, button, card, clampPage, el, foldable, line, pager, row, section, setStepPage, stepFilter, stepPage } from '../sections.js';

export function secSteps(host, intoBox) {
    /*
     * ⭐ 这一页原来是**插件自己的开发清单**（① 骨架 ② 主线 ③ 世界状态…）。
     *    复核方一眼看穿："这个是插件进度吧？做完了的情况这个是删除还是？"
     *    ——对，那是我造它时的待办，对用户毫无价值；插件做完了它就是一页废纸。
     *    换成她提的**真实楼层进度**：做了多少楼、还剩多少楼（还能看出是哪几楼）。
     */
    const box = intoBox || section('现在的进度',
        '引擎按楼层往后走：已做的楼有记录，没做的楼下次更新会接着走。',
        { open: true });
    const chat = getChat();
    const total = chat.length;
    if (!total) {
        box.appendChild(el('div', 'wxg-empty', '这个聊天还没有正文（发一条消息就有了）'));
        if (!intoBox) {
            host.appendChild(box);
        }
        return;
    }

    const state = loadState();
    const chron = getChronicle();
    const recs = asArray(state.recallRecords);
    const lastFloor = (state.lastUpdate && Number.isFinite(Number(((Number.isFinite(Number((state.pipeline || {}).atFloor)) && Number((state.pipeline || {}).atFloor) >= 0) ? Number((state.pipeline || {}).atFloor) : state.lastUpdate.floor))))
        ? Number(((Number.isFinite(Number((state.pipeline || {}).atFloor)) && Number((state.pipeline || {}).atFloor) >= 0) ? Number((state.pipeline || {}).atFloor) : state.lastUpdate.floor)) : -1;

    /*
     * ⚠️ 楼层口径**必须跟酒馆一致**（复核方点名）：酒馆消息头上的编号从 0 起，
     *    **#0 就是开场白**。所以"共几楼"＝聊天数组长度，楼号 0 … 长度-1。
     *    ⏐ 别自己从 1 数、也别把开场白漏掉（那会跟她在酒馆里看到的号对不上）。
     */
    const perFloor = new Map();
    const touch = (f) => {
        const k = Number(f);
        if (!Number.isFinite(k) || k < 0) {
            return null;
        }
        if (!perFloor.has(k)) {
            perFloor.set(k, { chron: 0, chars: 0, rec: null });
        }
        return perFloor.get(k);
    };
    for (const c of chron) {
        const e = touch(c.floor);
        if (e) {
            e.chron += 1;
        }
    }
    for (const r of recs) {
        const e = touch(r && r.floor);
        if (e) {
            e.rec = r;
            e.chars = countChars(r.injectedText);
        }
    }
    /*
     * 分类计数（照柚月那张"进度"的排法：一行一类，"已 X | 没 X"）。
     * ⏐ 口径写清楚，不美化：没记录就是没记录。
     */
    const rows = [];
    for (let f = 0; f < total; f += 1) {
        const e = perFloor.get(f) || null;
        const done = !!(e && (e.chron || e.rec)) || (lastFloor >= 0 && f <= lastFloor);
        rows.push({
            floor: f,
            done,
            info: e,
            injected: !!(e && e.rec && e.rec.injectStatus === 'ok'),
            chron: !!(e && e.chron),
        });
    }
    const stat = (pred) => rows.filter(pred).length;
    const doneCount = stat((r) => r.done);
    const maxDone = rows.filter((r) => r.done).reduce((m, r) => Math.max(m, r.floor), -1);
    const injCount = stat((r) => r.injected);
    const chronCount = stat((r) => r.chron);
    const num = (n) => String(n) + ' 楼';
    /*
     * ⭐ 统计表（自家面板那张真机图的排法）：
     *    第一行先单独一句「总共 N 楼」，下面才是一行一类的「已 X｜没 X」。
     */
    const cStat = card('进度');
    cStat.appendChild(el('div', 'wxg-total-line', '总共 ' + num(total) + ' 楼'));   /* 73 号：⛔ 在屏上解释 #0 */
    /*
     * ⭐ 目标核对 1（目标：状态页）：**三行胶囊 ⇒ 两列小表**。
     *   她 2026-10-15 00:22 亲手给的目标图里，这一格是一张表：
     *     表头＝**已完成 ｜ 未完成**；行＝正文／注入／编年；格＝「**N 楼**」（居中，淡线）。
     *   原本是"已 X｜没 X"的胶囊 ⇒ 术语也跟着改成**已完成／未完成**。
     *   ⛔ 动其余（总共 N 楼行／进度条／折叠行／存档行）。
     */
    const ptab = el('table', 'wxg-ptab');
    const thead = el('thead', null);
    const htr = el('tr', null);
    htr.appendChild(el('th', null, ''));
    htr.appendChild(el('th', null, '已完成'));
    htr.appendChild(el('th', null, '未完成'));
    thead.appendChild(htr);
    ptab.appendChild(thead);
    const tbody = el('tbody', null);
    const addStat = (label, doneN, totalN) => {
        const tr = el('tr', null);
        tr.appendChild(el('td', null, label));
        const cell = (n) => {
            const td = el('td', null);
            td.appendChild(el('b', null, String(n)));
            td.appendChild(el('span', null, ' 楼'));
            return td;
        };
        tr.appendChild(cell(doneN));
        tr.appendChild(cell(totalN - doneN));
        tbody.appendChild(tr);
    };
    addStat('正文', doneCount, total);
    addStat('注入', injCount, total);
    addStat('编年', chronCount, total);
    ptab.appendChild(tbody);
    cStat.appendChild(ptab);
    cStat.appendChild(el('div', 'wxg-note',
        (maxDone >= 0 ? '正文最高到 ' + floorLabel(maxDone) : '正文还没开始')
        + (lastFloor >= 0 ? '（上次更新停在 ' + floorLabel(lastFloor) + '）' : '（还没更新过）')));
    cStat.appendChild(el('div', 'wxg-note',
        '「已完成」＝引擎走过去并留下记录的楼（有编年或有回执，或者在世界钟走过的范围内）；'
        + '「未完成」＝下次更新会接着走的楼。楼层号跟酒馆消息头上的编号一致：#0 是开场白。'));
    cStat.appendChild(el('div', 'wxg-note',
        '注入＝把状态送进请求的楼；编年＝留下过记录的楼。'));
    const pct = total ? Math.round((doneCount / total) * 100) : 0;
    const track = el('div', 'wxg-pbar');
    const fill = el('div', 'wxg-pbar-fill');
    if (fill.style) {
        fill.style.width = String(pct) + '%';
    }
    track.appendChild(fill);
    cStat.appendChild(track);
    cStat.appendChild(el('div', 'wxg-note', '走了 ' + String(pct) + '%（'
        + (total - doneCount ? '再更新 ' + num(total - doneCount) + '就追平正文' : '已经追平正文') + '）'));
    /*
     * ⭐ 逐楼清单**收进折叠条**（照"一屏一个焦点"）：主画面就是上面那张统计表，
     *    想看"到底是哪几楼"再点开。⏐ 不是删掉——她要的是两份都在。
     */
    /* 84：折叠标题只留名词；「展开看是哪几楼（N）」进 title */
    const detail = foldable('逐楼清单', false);
    detail.title = '展开看是哪几楼（' + num(total) + '）';
    const fbar = el('div', 'wxg-filters');
    const mk = (key, label, n) => {
        const b = el('button', 'wxg-filter' + (stepFilter === key ? ' is-on' : ''), label);
        b.type = 'button';
        b.setAttribute('data-action', 'step-filter');
        b.setAttribute('data-id', key);
        b.appendChild(el('span', 'wxg-filter-n', String(n)));
        return b;
    };
    fbar.appendChild(mk('all', '全部', total));
    fbar.appendChild(mk('done', '已做', doneCount));
    fbar.appendChild(mk('todo', '还没做', total - doneCount));
    detail.appendChild(fbar);
    const shown = stepFilter === 'done' ? rows.filter((r) => r.done)
        : (stepFilter === 'todo' ? rows.filter((r) => !r.done) : rows);
    setStepPage(clampPage(stepPage, shown.length, PER_PAGE.steps));
    if (shown.length > PER_PAGE.steps) {
        detail.appendChild(pager('step-page', stepPage, PER_PAGE.steps, shown.length));
    }
    const newest = shown.slice().reverse();
    const pageRows = newest.slice((stepPage - 1) * PER_PAGE.steps, stepPage * PER_PAGE.steps);
    if (!pageRows.length) {
        detail.appendChild(el('div', 'wxg-empty', '这一筛没有楼层'));
    }
    for (const r of pageRows) {
        const row = el('div', 'wxg-r');
        row.appendChild(el('div', 'wxg-r-k wxg-num', floorLabel(r.floor)
            + (r.floor === 0 ? ' 开场白' : '')));
        const main = el('div', 'wxg-r-main');
        const title = el('div', 'wxg-r-title');
        if (r.done) {
            title.appendChild(el('span', 'wxg-badge is-ok', '已做'));
            if (r.injected) {
                title.appendChild(el('span', 'wxg-badge is-info', '已注入'));
            }
            main.appendChild(title);
            const bits = [];
            if (r.info && r.info.chron) {
                bits.push('编年 ' + String(r.info.chron) + ' 条');
            }
            if (r.info && r.info.chars) {
                bits.push('注入 ' + String(r.info.chars) + ' 字');
            }
            main.appendChild(el('div', 'wxg-r-sub', bits.length ? bits.join(' · ') : '走过了（这楼没单独留记录）'));
        } else {
            title.appendChild(el('span', 'wxg-badge is-off', '还没做'));
            main.appendChild(title);
            main.appendChild(el('div', 'wxg-r-sub', lastFloor >= 0
                ? ('等下次更新（引擎现在停在 ' + floorLabel(lastFloor) + '）')
                : '还没更新过（点「立刻更新」或等新楼）'));
        }
        row.appendChild(main);
        detail.appendChild(row);
    }
    cStat.appendChild(detail);
    box.appendChild(cStat);
    if (!intoBox) {
        host.appendChild(box);
    }




}
