/* 公-4 片段：世界条目浮层。从 sections.js 抽出（206 后） */
import { el, button, select, lastSectionsHost, bindPersonCardDrag, shortTime } from './shared.js';
import { trimText } from '../../core/utils.js';
import {  } from '../../core/timefmt.js';
import { loadState, describeWorld } from '../../core/state.js';
import {  } from '../../core/schedule.js';
import { stageProgress, stageTone } from '../stage-progress.js';
import { agendaOriginPanel, originPanel, STAGES_PROGRESS, STAGES_CONFLICT, TIERS } from '../../core/config.js';


export let openWorldEntry = null;      // { kind: 'situation' | 'hidden', idx }
/** 这个浮层在编辑态吗（默认 false＝只读） */
export let openWorldEntryEditing = false;

export function closeWorldEntryCard() {
    openWorldEntry = null;
    const old = document.getElementById('wxg-world-entry');
    if (old && typeof old.remove === 'function') {
        old.remove();
    }
}

export function openWorldEntryCard(kind, idx) {
    openWorldEntry = { kind: kind === 'hidden' ? 'hidden' : 'situation', idx: Math.max(0, Math.round(Number(idx) || 0)) };
    renderWorldEntryCard();
}

/** 世界账里跟这一条有关的记录（⛔ 一个字都不另编：只在账里找） */
function entryCausalRows(label) {
    const want = trimText(label);
    if (!want) {
        return [];
    }
    const chron = typeof getChronicle === 'function' ? getChronicle() : [];
    const list = Array.isArray(chron) ? chron : [];
    /* ⭐ C12（材料 13）：**先看这条自己记的因果** ✓（旧：只搜编年 ⇒ 局势从不写编年 ⇒ 永远空 ✗） */
    const ownRows = [];
    try {
        const st0 = loadState();
        const w0 = (st0 && st0.world) || {};
        const pool = [].concat(Array.isArray(w0.situations) ? w0.situations : [],
            Array.isArray(w0.hidden) ? w0.hidden : []);
        const hit0 = pool.find((x) => x && trimText(x.title || x.name) === want);
        if (hit0) {
            if (trimText(hit0.cause)) {
                ownRows.push({ text: '上承（怎么来的）：' + trimText(hit0.cause), who: '', at: 0 });
            }
            if (trimText(hit0.effect)) {
                ownRows.push({ text: '下沿（往哪边走）：' + trimText(hit0.effect), who: '', at: 0 });
            }
        }
    } catch (eC12) { /* 拿不到只剩编年那一路 ✓ */ }
    const chronRows = list
        .filter((c) => {
            const t = String((c && c.text) || '') + ' ' + String((c && c.who) || '');
            return t.includes(want);
        })
        .sort((a, b) => Number(a.at || 0) - Number(b.at || 0));
    return ownRows.concat(chronRows);
}

export function renderWorldEntryCard() {
    const old = document.getElementById('wxg-world-entry');
    if (old && typeof old.remove === 'function') {
        old.remove();
    }
    if (!openWorldEntry) {
        return;
    }
    const w = describeWorld();
    const isHidden = openWorldEntry.kind === 'hidden';
    /*
     * ⚠️ 字段在 **`state.world.*`**，⛔ `state.*`（我写错过：取不到 ⇒
     *   被下面那句防御性 `return` **静静吃掉**：不报错、也不弹。）
     */
    const raw = isHidden
        ? ((loadState().world || {}).hidden || [])
        : ((loadState().world || {}).situations || []);
    const item = Array.isArray(raw) ? raw[openWorldEntry.idx] : null;
    if (!item) {
        openWorldEntry = null;
        return;
    }
    const title = isHidden ? trimText(item.name) : trimText(item.title);
    const pillText = isHidden ? (trimText(item.stage) || '萌芽') : (trimText(item.tier) || '几天内');
    const pillCls = isHidden ? stageTone(item.stage) : (pillText === TIERS[0] ? 'is-warn' : 'is-info');

    const pop = el('div', 'wxg-pc wanxiangge');
    pop.id = 'wxg-world-entry';
    pop.setAttribute('role', 'dialog');
    const head = el('div', 'wxg-pc-head');
    head.appendChild(el('span', 'wxg-pc-grip', '⠿'));
    const who = el('div', 'wxg-pc-who');
    who.appendChild(el('div', 'wxg-pc-name', title || '（没名字）'));
    who.appendChild(el('div', 'wxg-pc-alias', '世界账 · ' + (isHidden ? '暗线' : '局势')));
    head.appendChild(who);
    const badges = el('div', 'wxg-pc-badges');
    badges.appendChild(el('span', 'wxg-badge ' + (pillCls || ''), pillText));
    if (isHidden) {
        /* 只有暗线的阶段才有 n/4 或 n/5；局势没这等枚举 ⇒ 不出数字 */
        const prog2 = stageProgress(item.stage, item.kind);
        if (prog2) { badges.appendChild(el('span', 'wxg-badge is-soft wxg-stage-num', prog2.text)); }
    }
    head.appendChild(badges);
    const kebab = button('⋮', 'we-edit', 'wxg-pc-kebab');
    kebab.title = openWorldEntryEditing ? '正在编辑（点一下收起）' : '编辑这一条（点了才可改，不点只读）';
    head.appendChild(kebab);
    head.appendChild(button('✕', 'we-close', 'wxg-pc-x'));
    pop.appendChild(head);
    const sec1 = el('div', 'wxg-pc-sec');
    sec1.appendChild(el('div', 'wxg-pc-sech', '这一条'));
    const kv = el('div', 'wxg-pc-kv');
    const put = (k, v, empty) => {
        kv.appendChild(el('div', 'wxg-pc-k', k));
        const box2 = el('div', 'wxg-pc-v');
        /*
         * ⭐ S3 后半（材料 05 自查）：**长文本格占满整行** ✓
         *   网格是 4 列（每行 2 格 ✓）⇒ 编辑态放 5 格会出现 2+2+1 的半行空缺 ✗
         *   而「名称／标题」与「走到／哪几方」（现状长句 ✗）塞在半宽列里太挤 ✗
         *   ⇒ 这四个格加 「wxg-pc-full」占满整行 ✓（CSS 里早就有这个类 ✓）
         */
        if (k === '名称' || k === '标题' || k === '走到' || k === '哪几方' || k === '上承' || k === '下沿') {
            box2.className = 'wxg-pc-v wxg-pc-full';
        }
        /*
         * ⚠️ 暗线**没有"改名字/改到点/改走到"的已有动作**（现有的只有 `set-hidden-stage` 与 `del-hidden`）
         *   ⇒ ⛔ 给它造一个不存在的 action（那样点了没反应）：暗线的可改项就是底部那个**阶段下拉**（已接）。
         *   ❌ 不能只图"看着像可改"而摆一个点不动的框。
         */
        /*
         * ⭐ 修复单 #37：
         *   ① 原来条件是 `openWorldEntryEditing && !isHidden` ⇒
         *     **暗线（isHidden）永远进不了编辑态**（她点 ⋮ 没反应）⇒ 把 `!isHidden` 去掉；
         *   ② 「火候」原来是**裸文本框** ⇒ 她只能自己打字、打错就不在枚举里（#27 同族）
         *     ⇒ 局势里给 **TIERS 下拉**；暗线那边是 `stage`（另一套枚举），保持文本框但**写对字段**。
         *   ⚠️ 暗线跟局势存在**两个不同的表**（`world.hidden` / `world.situations`）
         *     ⇒ 用 `data-hidden="1"` 告诉动作写回哪一张表。
         */
        if (openWorldEntryEditing) {
            /* ⭐⭐ 材料 03 定稿：**「阶段(stage)」与「火候(tier)」拆成两格、各叫各的真名** ✓
             *   旧：暗线那一格写成 `put('火候', item.stage, '萌芽')` ✗
             *        ⇒ **标签叫“火候”、值却是 stage** ✗（名不符实 ✗），而且暗线**没有 tier 那一格** ✗
             *   新：火候 ⇒ **TIERS 下拉**（暗线也用，标 `data-hidden` ✓）；阶段（暗线）⇒
             *        按 `item.kind` 给 **STAGES_PROGRESS / STAGES_CONFLICT 下拉** ✓（⛔ 手打错别字破坏 isLineDone 判定 ✗）
             *   ⛔ 不删 stage ✓（只读态下两栏信息区一格都不少 ✓） */
            /* ★ [318]/[325]：标签→字段显式对照（旧：暗线「名称」会误写成 stage ✗） */
            const fieldKey = isHidden
                ? ({ '名称': 'name', '到点': 'trigger', '走到': 'note', '阶段': 'stage', '火候': 'tier', '上承': 'cause', '下沿': 'effect', '线源': 'agendaOrigin', '线源挂接': 'agendaRef' }[k] || '')
                : ({ '标题': 'title', '哪几方': 'sides', '火候': 'tier', '上承': 'cause', '下沿': 'effect', '来路': 'origin', '预期': 'expected', '实果': 'result', '余波': 'consequence' }[k] || '');
            if (k === '火候') {
                const sel = select(null, TIERS.map((x) => ({ value: x, label: x })), trimText(v) || TIERS[1], 'set-situation');
                sel.setAttribute('data-index', String(openWorldEntry.idx));
                if (isHidden) {
                    sel.setAttribute('data-hidden', '1');
                }
                sel.setAttribute('data-key', 'tier');
                box2.appendChild(sel);
            } else if (k === '阶段' && isHidden) {
                const stages = item.kind === 'progress' ? STAGES_PROGRESS : STAGES_CONFLICT;
                const sel2 = select(null, stages.map((x) => ({ value: x, label: x })), trimText(v) || stages[0], 'set-situation');
                sel2.setAttribute('data-index', String(openWorldEntry.idx));
                sel2.setAttribute('data-hidden', '1');
                sel2.setAttribute('data-key', 'stage');
                box2.appendChild(sel2);
            } else if (k === '来路' && !isHidden) {
                const originOpts = [
                    { value: 'plot', label: 'plot·盘算挂接' },
                    { value: 'ripple', label: 'ripple·上游波及' },
                    { value: 'state', label: 'state·局势自变' },
                    { value: '', label: '（未标）' },
                ];
                const selO = select(null, originOpts, trimText(v) || '', 'set-situation');
                selO.setAttribute('data-index', String(openWorldEntry.idx));
                selO.setAttribute('data-key', 'origin');
                box2.appendChild(selO);
            } else {
                const inp = el('input', 'wxg-pc-input');
                inp.type = 'text';
                inp.value = trimText(v);
                inp.setAttribute('data-action', 'set-situation');
                inp.setAttribute('data-index', String(openWorldEntry.idx));
                if (isHidden) {
                    inp.setAttribute('data-hidden', '1');
                }
                inp.setAttribute('data-key', fieldKey || (isHidden ? 'note' : 'title'));
                box2.appendChild(inp);
            }
        } else {
            const txt = trimText(v);
            box2.appendChild(el('div', 'wxg-pc-text' + (txt ? '' : ' is-empty'), txt || (empty || '未知')));
        }
        kv.appendChild(box2);
    };
    if (isHidden) {
        /* ⭐修复 15（材料 02）：编辑态**补上「改暗线名字」** ✓
         *   （旧：只能改到点/走到/阶段/火候，**名字没得改** ✗） */
        if (openWorldEntryEditing) {
            put('名称', item.name, '未命名暗线');
        }
        put('到点', item.trigger, '未定时间');
        put('走到', item.note, '还没走到');
        /* ⭐材料 03：**阶段与火候各归各位** ✓（旧：火候那格里装的是 stage ✗） */
        put('阶段', item.stage, '萌芽');
        put('火候', item.tier, '几天内');
        /* ★ [580] B6：暗线来源三型 */
        {
            const ao = String(trimText(item.agendaOrigin) || '').toLowerCase();
            const aoLabel = agendaOriginPanel(ao);   /* I4：标签从同一张表来 */
            put('线源', openWorldEntryEditing ? (trimText(item.agendaOrigin) || '') : aoLabel, '未标');
            put('线源挂接', item.agendaRef, '无');
        }
        /* ★ [318]/[322]：点进去要看得见因果；⋮ 编辑态可改 ✓ */
        put('上承', item.cause, '未写');
        put('下沿', item.effect, '未写');
    } else {
        /* ⭐修复 15：编辑态**补上「改局势标题」** ✓ */
        if (openWorldEntryEditing) {
            put('标题', item.title, '未命名局势');
        }
        put('哪几方', item.sides, '未写');
        put('火候', item.tier, '几天内');
        /* ★ [318]/[322]／B1：来路分型＋因果两格 ✓ */
        {
            const oLabel = originPanel(item.origin);   /* I4：面板标签从同一张表来（⛔ 各写一份枚举） */
            put('来路', openWorldEntryEditing ? (trimText(item.origin) || '') : oLabel, '未标');
        }
        put('上承', item.cause, '未写');
        put('下沿', item.effect, '未写');
        /* ★ [580] A6：预期／实果／余波（⋮ 可改） */
        put('预期', item.expected, '未写');
        put('实果', item.result, '未写');
        put('余波', item.consequence, '未写');
    }
    sec1.appendChild(kv);
    pop.appendChild(sec1);
    const sec2 = el('div', 'wxg-pc-sec');
    sec2.appendChild(el('div', 'wxg-pc-sech', '因果（照世界账的记录摆 · 不另编）'));
    const rows = entryCausalRows(title);
    if (!rows.length) {
        sec2.appendChild(el('div', 'wxg-empty',
            openWorldEntryEditing
                ? '还没记因果 —— 可在上方「上承／下沿」格手填，或等引擎更新'
                : '世界账里还没记到这一条（点右上 ⋮ 可手填上承／下沿，或等更新几轮）'));
    } else {
        const first = rows[0];
        const rest = rows.slice(1);
        const up = el('div', 'wxg-pc-quote');
        const t1 = el('div', null, trimText(first.text) || '（没写字）');
        t1.insertBefore(el('span', 'wxg-pc-when', '▲ 来路 · ' + shortTime(first.at)), t1.firstChild);
        up.appendChild(t1);
        sec2.appendChild(el('div', 'wxg-pc-k', '上承（向更早）'));
        sec2.appendChild(up);
        if (rest.length) {
            const down = el('div', 'wxg-pc-quote');
            for (const r of rest.slice(-3)) {
                const line2 = el('div', null, trimText(r.text) || '（没写字）');
                line2.insertBefore(el('span', 'wxg-pc-when', '▼ ' + shortTime(r.at) + ' · ' + (trimText(r.kind) || '记录')), line2.firstChild);
                down.appendChild(line2);
            }
            sec2.appendChild(el('div', 'wxg-pc-k', '下沿（向未来）'));
            sec2.appendChild(down);
        }
    }
    pop.appendChild(sec2);
    const foot = el('div', 'wxg-pc-foot');
    foot.appendChild(button('关闭', 'we-close', 'wxg-pc-nav'));
    foot.appendChild(el('span', 'wxg-pc-counter', '来自世界账 · 改动走右上 ⋮ → 编辑'));
    if (isHidden && !openWorldEntryEditing) {
        const sel = select('wxg-we-stage-' + String(openWorldEntry.idx),
            (item.kind === 'progress' ? STAGES_PROGRESS : STAGES_CONFLICT).map((x) => ({ value: x, label: x })),
            item.stage, 'set-hidden-stage', item.id);
        sel.className = 'wxg-pole wxg-btn-sm';
        foot.appendChild(sel);
    }
    pop.appendChild(foot);

    (lastSectionsHost || document.body).appendChild(pop);
    bindPersonCardDrag(pop);
}

/*
 * ⭐ 补⑤ 体检报告：面板上一个入口，点一下出一份自检。
 *
 * 放**状态页**顶栏（那颗「功能 ⋮」旁边）——状态页本来就是"看账"的地方，
 * ⛔ 不动「总控」那三张卡（那是目标包里定死的版式）。
 *
 * ⛔ 报告里不含正文、不含钥匙与地址的"值"（见 core/health.js 的铁律）。
 */

export function setOpenWorldEntry(v) { openWorldEntry = v; }
export function setOpenWorldEntryEditing(v) { openWorldEntryEditing = v; }

export const WORLD_ENTRY_ACTION_SET = new Set(['open-world-entry', 'we-close', 'we-edit']);

export function handleWorldEntryAction(action, target, id, host, isChange, rerender) {
    switch (action) {
                case 'open-world-entry':
                    openWorldEntryCard(
                        target.getAttribute('data-kind') || 'situation',
                        target.getAttribute('data-index') || '0');
                    break;
                case 'we-close':
                    openWorldEntryEditing = false;
                    closeWorldEntryCard();
                    break;
                case 'we-edit':
                    openWorldEntryEditing = !openWorldEntryEditing;
                    renderWorldEntryCard();
                    break;
    }
}
