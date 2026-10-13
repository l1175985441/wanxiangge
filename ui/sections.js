/**
 * 万象阁 · 面板内容（一份内容，两处使用）
 *
 * 同一套分节既渲染进**独立面板**（ui/shell.js 开的窗口），也渲染进**扩展设置区**里那一块。
 * ⛔ 不各写一套，免得两边长歪。
 * 事件一律**委托**绑在宿主上：每次重画都不丢监听，也不会重复绑。
 */

import {
    TIERS, ROSTER_PRESET, STAGES_CONFLICT, STAGES_PROGRESS, DEFAULT_JAILBREAK,
} from '../core/config.js';
import { storageReport, formatStamp } from '../core/adapter.js';
import { getSettings, patchSettings, effectivePrompt, setAllPromptsDefault } from '../core/settings.js';
import {
    getRoster, loadState, saveState, addCharacter, addCharacters, removeCharacter, updateCharacter, findCharacterByName,
    applyRosterPreset, describeRoster, describeWorld, recentRecallRecords, getChronicle,
    removeHidden, addHiddenManually, rollbackLast, snapshotCount, exportState, updateWorld,
    updateQuest, removeQuest, addChronicle,
} from '../core/state.js';
import { receiptText, ledgerText } from '../core/ledger.js';
import { toList, trimText, asText, asArray, countChars, floorLabel, FLOOR_NOTE } from '../core/utils.js';
import {
    PALETTE_KEYS, PALETTE_NAMES, resolveAppearance, applyAppearance, palettePatch,
} from './theme.js';
import { questStats } from '../core/summary.js';
import { replanCurrentFloor } from '../core/actions.js';
import { listWorldbookNames, collectPeopleFromBook, getEntries } from '../core/worldbook.js';
import { clockWentBackwards } from '../core/clock.js';
import { publishToBook } from '../core/book.js';
import { runUpdate, cancelUpdate, runReconcile } from '../core/pipeline.js';
import { mergeCharacters, autoDetectDuplicates } from '../core/merge.js';
import { toast } from './toast.js';

/* ------------------------------ 元素小件 ------------------------------ */

function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) {
        node.className = cls;
    }
    if (text !== undefined && text !== null) {
        node.textContent = asText(text);
    }
    return node;
}

/**
 * 一段 = 一个**酒馆原生折叠抽屉**（inline-drawer）。
 *
 * 为什么这么改：原来 12 段 <h4> 全平铺，一打开就是 200 多个控件的墙
 * ⇒ 用酒馆自己的抽屉写法：她看着眼熟，窄栏里还能收起来。
 *
 * ⚠️ 挂载口径（这里连踩两次坑，写清楚）：
 *   返回的是**正文层**（内容都加在它上面，各处一行都不用改）。
 *   壳（标题＋小摘要＋箭头）挂在正文层自己的 `__wxgDrawer` 属性上 —— 一个直接属性引用，
 *   ⛔ 不用 WeakMap、不用临时中转对象（那些要么认不出、要么容易出岔子）。
 *   挂载时 `hangUp` 取出壳、把正文层放回壳里、整壳挂到宿主。
 */
function section(title, hint, opts) {
    const o = opts || {};
    const drawer = el('div', 'wxg-sec inline-drawer');
    const head = el('div', 'wxg-sec-head inline-drawer-toggle inline-drawer-header');
    const titleWrap = el('div', 'wxg-sec-titlewrap');
    titleWrap.appendChild(el('b', 'wxg-sec-title', title));
    titleWrap.appendChild(el('span', 'wxg-sec-sum', o.summary ? asText(o.summary) : ''));
    head.appendChild(titleWrap);
    head.appendChild(el('div', 'inline-drawer-icon fa-solid fa-circle-chevron-down down'));
    drawer.appendChild(head);

    const body = el('div', 'wxg-sec-body inline-drawer-content');
    if (hint) {
        body.appendChild(el('div', 'wxg-note', hint));
    }
    drawer.appendChild(body);
    if (o.open) {
        drawer.setAttribute('data-wxg-open', '1');
    }
    // 壳记在正文层自己的属性上（直接引用，零魔法）
    body.__wxgDrawer = drawer;
    // ⚠️ 这两个标记只给**离线预览页**用（它没有酒馆那套 JS，得照标记判断哪几段是展开的）：
    //    ⛔ 不参与任何逻辑判断；我上一版把标记弄丢过，结果预览把每段正文都跳过了（只剩标题连成一坨）。
    body.setAttribute('data-wxg-sec', title);
    if (o.open) {
        body.setAttribute('data-wxg-open', '1');
    }
    return body;
}

/** 改一段标题旁的小摘要（⛔ 不放正文里占地方） */
export function setSectionSummary(box, text) {
    const drawer = box ? box.__wxgDrawer : null;
    const sum = drawer ? drawer.querySelector('.wxg-sec-sum') : null;
    if (sum) {
        sum.textContent = asText(text);
    }
}

/**
 * 一个"带标签的字段"：真 label（点标签能聚焦到输入框）＋ 控件。
 * ⭐ 原来是一堆 `span«世界钟»` + 裸 input 挤在一行，读起来像没做完的表单。
 */
function field(labelText, control) {
    const wrap = el('label', 'wxg-field');
    wrap.appendChild(el('span', 'wxg-field-label', labelText));
    wrap.appendChild(control || el('span', 'wxg-note', '（缺控件）'));
    return wrap;
}

function row(host, ...children) {
    const r = el('div', 'wxg-row');
    for (const c of children) {
        if (c) {
            r.appendChild(c);
        }
    }
    host.appendChild(r);
    return r;
}

function checkbox(id, label, checked, action) {
    const wrap = el('label', 'checkbox_label');
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.id = id;
    box.checked = checked === true;
    box.setAttribute('data-action', action);
    wrap.appendChild(box);
    wrap.appendChild(el('span', null, label));
    return wrap;
}

/** 颜色选择器（type=color），旁边给个"当前值"的小方块，她一眼看得出选了啥 */
function colorInput(id, value, action) {
    const box = document.createElement('input');
    box.type = 'color';
    box.id = id;
    box.className = 'wxg-color';
    box.value = asText(value) || '#000000';
    box.setAttribute('data-action', action);
    return box;
}

function textInput(id, value, placeholder, action, cls) {    const input = document.createElement('input');
    input.type = 'text';
    input.id = id;
    input.className = 'text_pole ' + (cls || '');
    input.value = asText(value);
    if (placeholder) {
        input.placeholder = placeholder;
    }
    input.setAttribute('data-action', action || 'noop');
    return input;
}

function numberInput(id, value, min, max, action) {
    const input = document.createElement('input');
    input.type = 'number';
    input.id = id;
    input.className = 'text_pole';
    input.min = String(min);
    input.max = String(max);
    input.step = '1';
    input.value = String(value);
    input.setAttribute('data-action', action);
    return input;
}

function textarea(id, value, placeholder, action, rows) {
    const box = document.createElement('textarea');
    box.id = id;
    box.className = 'text_pole textarea_compact';
    box.rows = String(rows || 4);
    box.value = asText(value);
    if (placeholder) {
        box.placeholder = placeholder;
    }
    box.setAttribute('data-action', action);
    return box;
}

function button(label, action, cls, id) {
    const b = el('button', 'menu_button ' + (cls || ''), label);
    b.setAttribute('data-action', action);
    if (id) {
        b.setAttribute('data-id', id);
    }
    return b;
}

function select(id, options, value, action, id2) {
    const s = document.createElement('select');
    s.id = id;
    s.className = 'text_pole';
    s.setAttribute('data-action', action);
    if (id2) {
        s.setAttribute('data-id', id2);
    }
    for (const opt of options) {
        const o = document.createElement('option');
        o.value = asText(opt.value);
        o.textContent = asText(opt.label);
        if (asText(opt.value) === asText(value)) {
            o.selected = true;
        }
        s.appendChild(o);
    }
    return s;
}

function foldable(summaryText, open) {
    const d = document.createElement('details');
    d.className = 'wxg-report';
    const s = document.createElement('summary');
    s.appendChild(el('span', null, summaryText));
    d.appendChild(s);
    if (open) {
        d.open = true;
    }
    return d;
}

/* ------------------------------ 分节 ------------------------------ */

function secStatus(host) {
    const box = section('账本状态', null, { open: true });
    const report = storageReport();
    const line = el('div', 'wxg-store', report.text);
    line.setAttribute('data-tone', report.tone);
    box.appendChild(line);
    box.appendChild(el('div', 'wxg-ledger', '上次更新：' + ledgerText()));
    const world = describeWorld();
    box.appendChild(el('div', 'wxg-note',
        '世界钟：' + world.clock
        + (world.place ? ' · ' + world.place : '')
        + ' ｜ 局势 ' + String(world.situations)
        + ' ｜ 暗线 ' + String(world.hidden) + '（在走 ' + String(world.advancing) + '）'
        + ' ｜ 编年 ' + String(world.chronological)
        + ' ｜ 可撤回 ' + String(snapshotCount()) + ' 版'));
    row(box, button('立刻更新', 'update-now'), button('撤回上一次', 'rollback'), button('重算本楼', 'replan'));
    row(box, button('对账（账与楼对齐）', 'reconcile'), button('写入世界书', 'publish-book'),
        button('补推历史', 'backfill'));

    const p = loadState().pipeline || {};
    if (p.status && p.status !== 'idle') {
        const tone = p.status === 'failed' ? 'bad' : (p.status === 'running' ? 'idle' : 'ok');
        const msg = el('div', 'wxg-store', '更新流水：' + (p.text || p.status)
            + (p.error ? '（' + p.error + '）' : '')
            + (p.tries ? ' · 已试 ' + String(p.tries) + ' 次' : '')
            + (p.cursor ? ' · 进度 ' + String(p.cursor) : ''));
        msg.setAttribute('data-tone', tone);
        box.appendChild(msg);

        // ⭐ 与"她手改过的版本"冲突时，把那几条**具体写出来**（自审修正·条 16）
        //    原来只报"有 N 处冲突"，她看不到到底哪儿冲突、引擎保留了哪个版本。
        if (Array.isArray(p.conflicts) && p.conflicts.length) {
            const warn = el('div', 'wxg-store', '与你的手改冲突（引擎**按你的版本保留**，内容没被冲掉）：');
            warn.setAttribute('data-tone', 'bad');
            box.appendChild(warn);
            for (const c of p.conflicts) {
                box.appendChild(el('div', 'wxg-fact', '· ' + asText(c)));
            }
        }
        row(box,
            p.status === 'running' ? button('取消这次更新', 'cancel-update') : null,
            p.status === 'failed' ? button('重试（有上限）', 'update-now') : null);
    }
    host.appendChild(box);
}

/**
 * 总控：只放"整台怎么跑"的开关。
 * ⚠️ 原来这里第一个是「启用万象阁」——**冗余**（她点出来的）：酒馆扩展列表里勾上了，
 *    插件就是启用的；再放一个总闸＝两个开关管同一件事，关哪个都容易搞混。⇒ **去掉**。
 *    想停就在酒馆的扩展列表里关它。
 * 卡片那两个开关搬到「召回」段（那是卡片自己的事），这里只留"更新"有关的。
 */
function secGeneral(host) {
    const SECID = 'general';
    const s = getSettings();
    const box = section('总控', '整台怎么跑：自动更新、频率、启动行为。'
        + '（要停用整个插件 ⇒ 去酒馆的扩展列表里关它，这里⛔ 不再放第二个总闸）',
        { open: true });
    box.appendChild(checkbox('wxg-auto-update', '新楼生成后自动更新（关掉＝只手动更新）', s.autoUpdate, 'stage-auto-update'));
    row(box,
        el('span', 'wxg-note', '频率：每'),
        numberInput('wxg-update-every', s.updateEvery, 1, 10, 'stage-update-every'),
        el('span', 'wxg-note', '回合更新一次（1＝每回合都在动；2＝两格停在上一轮）'));
    box.appendChild(checkbox('wxg-protected', '现场保护：正文刚演过的人，本轮只带状态、不重复推演', s.protectedBypass, 'stage-protected'));
    box.appendChild(checkbox('wxg-strict', '严格模式：只带本轮点名的人', s.strictMention, 'stage-strict'));
    box.appendChild(checkbox('wxg-panel-open', '打开酒馆时自动弹出工作台／面板', s.showPanelOnStart, 'stage-panel-on-start'));
    box.appendChild(saveBar('general'));
    host.appendChild(box);
}

function secWorld(host) {
    const state = loadState();
    const w = state.world;
    const box = section('世界状态',
        '世界局势＝势力的所有碰撞；暗线＝还没浮上台面的事，按阶段走、挂世界钟（⛔ 不按回合数推，世界钟没到点不许提前冒头）。',
        { open: true, summary: trimText(w.clock) || '世界钟未知' });

    row(box,
        field('世界钟', textInput('wxg-world-clock', w.clock, '例：第二天 上午 10:20（读不出来写未知）', 'set-world-clock', 'wxg-short')),
        field('地点', textInput('wxg-world-place', w.place, '例：四夷馆', 'set-world-place', 'wxg-short')));
    box.appendChild(textarea('wxg-world-big', w.bigPicture, '从高处看一眼：这个世界现在什么样', 'set-world-big', 3));

    box.appendChild(el('div', 'wxg-report-h', '局势（势力的碰撞）'));
    const sit = el('div', 'wxg-list');
    if (!w.situations.length) {
        sit.appendChild(el('div', 'wxg-empty', '还没有局势记录（点「立刻更新」让引擎算一次）'));
    } else {
        // ⭐ 局势也能手改（条 22）：她看得见就该能改——改字、换火候、删掉，都行
        w.situations.forEach((item, idx) => {
            const r = el('div', 'wxg-rowitem');
            const head = el('div', 'wxg-rowname');
            head.appendChild(el('span', 'wxg-name', trimText(item.title) || '（未记名）'));
            if (item.manual) {
                head.appendChild(el('span', 'wxg-badge wxg-badge-warn', '已手动修改'));
            }
            const del = button('删', 'del-situation', 'wxg-btn-sm');
            del.setAttribute('data-index', String(idx));
            head.appendChild(del);
            r.appendChild(head);

            const line = el('div', 'wxg-row');
            const title = textInput('wxg-sit-title-' + String(idx), item.title, '这一条局势是什么', 'set-situation', 'wxg-short');
            title.setAttribute('data-index', String(idx));
            title.setAttribute('data-key', 'title');
            line.appendChild(title);
            const sides = textInput('wxg-sit-sides-' + String(idx), item.sides, '哪几方', 'set-situation', 'wxg-short');
            sides.setAttribute('data-index', String(idx));
            sides.setAttribute('data-key', 'sides');
            line.appendChild(sides);
            const tierSel = select('wxg-sit-tier-' + String(idx),
                [{ value: '', label: '（火候）' }].concat(TIERS.map((x) => ({ value: x, label: x }))),
                item.tier, 'set-situation');
            tierSel.setAttribute('data-index', String(idx));
            tierSel.setAttribute('data-key', 'tier');
            line.appendChild(tierSel);
            r.appendChild(line);
            sit.appendChild(r);
        });
    }
    box.appendChild(sit);
    row(box,
        textInput('wxg-new-situation', '', '自己加一条局势（例：商会与教会在争港口税）', 'noop', 'wxg-short'),
        button('加一条局势', 'add-situation'));

    box.appendChild(el('div', 'wxg-report-h', '暗线（自己有时间表，到点才动）'));
    const hid = el('div', 'wxg-list');
    if (!w.hidden.length) {
        hid.appendChild(el('div', 'wxg-empty', '还没有暗线（引擎会在更新时排出来）'));
    } else {
        for (const h of w.hidden) {
            const r = el('div', 'wxg-rowitem');
            const head = el('div', 'wxg-rowname');
            head.appendChild(el('span', 'wxg-name', trimText(h.name) || '（未记名）'));
            head.appendChild(el('span', 'wxg-badge wxg-badge-soft', trimText(h.stage) || '萌芽'));
            if (trimText(h.tier)) {
                head.appendChild(el('span', 'wxg-badge wxg-badge-soft', trimText(h.tier)));
            }
            if (h.manual) {
                head.appendChild(el('span', 'wxg-badge wxg-badge-warn', '已手动修改'));
            }
            head.appendChild(button('删', 'del-hidden', 'wxg-btn-sm', h.id));
            r.appendChild(head);
            if (trimText(h.trigger)) {
                r.appendChild(el('div', 'wxg-fact', '到点条件：' + trimText(h.trigger)));
            }
            if (trimText(h.note)) {
                r.appendChild(el('div', 'wxg-fact', '现在到哪一步：' + trimText(h.note)));
            }
            r.appendChild(select('hid-stage-' + h.id,
                (h.kind === 'progress' ? STAGES_PROGRESS : STAGES_CONFLICT).map((x) => ({ value: x, label: x })),
                h.stage, 'set-hidden-stage', h.id));
            hid.appendChild(r);
        }
    }
    box.appendChild(hid);

    row(box,
        textInput('wxg-new-hidden', '', '新暗线名字', 'noop', 'wxg-short'),
        textInput('wxg-new-hidden-trigger', '', '挂在什么时间／条件（例：晚上／三天后）', 'noop', 'wxg-short'),
        // ⭐ 火候与族类**给她选**（原来写死"几天内／冲突型"）——近的快推、远的慢炖，是她自己的节奏
        select('wxg-new-hidden-tier', TIERS.map((x) => ({ value: x, label: x })), '几天内', 'noop'),
        select('wxg-new-hidden-kind', [
            { value: 'conflict', label: '冲突型（萌芽→发酵→逼近→爆发→消散）' },
            { value: 'progress', label: '推进型（筹备→执行→关键→完成）' },
        ], 'conflict', 'noop'),
        button('加一条暗线', 'add-hidden'));
    host.appendChild(box);
}

/**
 * 角色状态：**一行一个人，七列各就各位**（她点名要的形态）。
 * 她原话："不是应该七列？几个小标题然后名字各就各位然后每一列各自填各自的？而且最上面还要加上搜索，
 * 否则人物一多就哈哈哈。"
 *
 * 排布：名字（＋徽章＋明细开关）｜年龄｜身份｜所在势力｜好感｜时间・地点｜正在经历
 *   点「明细」展开那一行：过去经历／日程／任务／合并与收下按钮（⛔ 不占表宽）。
 */
function secCharacters(host) {
    const state = loadState();
    // ⚠️ 真机截图暴露：段说明挤在搜索框上面、把工具条压下去了 ⇒ 说明挪到表格**下面**（读的时候不挡事）
    const box = section('角色状态', null, { open: true });

    if (!state.characters.length) {
        box.appendChild(el('div', 'wxg-empty', '名册还是空的：下面「人物名册」里加人，或点「一键盘入预设名册」。'));
        host.appendChild(box);
        return;
    }

    /* ---- 工具条：搜索 ＋ 排序 ＋ 计数 ---- */
    const tools = el('div', 'wxg-ctools');
    const search = document.createElement('input');
    search.type = 'search';
    search.id = 'wxg-char-search';
    search.className = 'text_pole wxg-search';
    search.placeholder = '搜人：名字／别名／身份／势力／时间地点／正在经历／任务';
    search.value = charSearch.query;
    search.setAttribute('data-live-action', 'char-search');
    tools.appendChild(search);
    tools.appendChild(select('wxg-char-sort', [
        { value: 'recent', label: '按最近更新' },
        { value: 'name', label: '按名字' },
        { value: 'affinity', label: '按好感' },
        { value: 'scene', label: '本轮在现场的优先' },
    ], charSearch.sort, 'char-sort'));
    const countChip = el('span', 'wxg-note', String(state.characters.length) + ' 人');
    countChip.setAttribute('data-role', 'char-count');
    tools.appendChild(countChip);
    box.appendChild(tools);

    /* ---- 排序 ---- */
    const rows = state.characters.slice();
    if (charSearch.sort === 'name') {
        rows.sort((a, b) => asText(a.name).localeCompare(asText(b.name), 'zh'));
    } else if (charSearch.sort === 'affinity') {
        rows.sort((a, b) => affinityNum(b.affinity) - affinityNum(a.affinity));
    } else if (charSearch.sort === 'scene') {
        rows.sort((a, b) => (b.inScene === true ? 1 : 0) - (a.inScene === true ? 1 : 0)
            || Number(b.lastSeenFloor || 0) - Number(a.lastSeenFloor || 0));
    } else {
        rows.sort((a, b) => Number(b.lastSeenFloor || 0) - Number(a.lastSeenFloor || 0)
            || Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
    }

    /* ---- 表 ---- */
    const table = document.createElement('table');
    table.className = 'wxg-ctable';
    const thead = document.createElement('thead');
    const htr = document.createElement('tr');
    for (const h of ['名字', '年龄', '身份', '所在势力', '好感', '时间・地点', '正在经历']) {
        const th = document.createElement('th');
        th.textContent = h;
        htr.appendChild(th);
    }
    thead.appendChild(htr);
    table.appendChild(thead);
    const tbody = document.createElement('tbody');

    /** 表格里的一个可改格子 */
    const cell = (c, key, placeholder, isArea) => {
        const td = document.createElement('td');
        if (key === 'current') {
            td.className = 'wxg-cur-cell';
        }
        const input = isArea
            ? textarea('wxg-c-' + key + '-' + c.id, c[key], placeholder, 'set-char-field', 2)
            : textInput('wxg-c-' + key + '-' + c.id, c[key], placeholder, 'set-char-field');
        input.setAttribute('data-id', c.id);
        input.setAttribute('data-key', key);
        td.appendChild(input);
        return td;
    };

    for (const c of rows) {
        const tr = document.createElement('tr');
        // 搜索用的"底稿"（搜的时候只切 class，⛔ 不重画页面，才不会打断她打字）
        tr.setAttribute('data-search', asText([
            c.name, (c.aliases || []).join(' '), c.identity, c.faction, c.timePlace, c.current, c.affinity,
            (c.quests || []).map((q) => q.title).join(' '),
        ].join(' ')).toLowerCase());
        tr.setAttribute('data-id', c.id);

        /* 名字这一格：名字 ＋ 徽章 ＋ 明细开关 */
        const nameTd = document.createElement('td');
        const nameCell = el('div', 'wxg-cname-cell');
        nameCell.appendChild(el('span', 'wxg-cname', trimText(c.name) || '（没名字）'));
        if (c.isPlayer) {
            nameCell.appendChild(el('span', 'wxg-badge wxg-badge-soft', '玩家棋子'));
        }
        if (c.inScene) {
            nameCell.appendChild(el('span', 'wxg-badge wxg-badge-soft', '在现场'));
        }
        if (c.isNew) {
            nameCell.appendChild(el('span', 'wxg-badge', '新认的人'));
        }
        if (c.manual) {
            nameCell.appendChild(el('span', 'wxg-badge wxg-badge-warn', '已手动修改'));
        }
        if (c.currentSuspect) {
            nameCell.appendChild(el('span', 'wxg-badge wxg-badge-warn', '⚠ 不可靠'));
        }
        if (c.ignored) {
            nameCell.appendChild(el('span', 'wxg-badge wxg-badge-soft', '已忽略'));
        }
        const more = button('明细', 'toggle-cdetail', 'wxg-btn-sm', c.id);
        nameCell.appendChild(more);
        nameTd.appendChild(nameCell);
        tr.appendChild(nameTd);

        tr.appendChild(cell(c, 'age', '几岁'));
        tr.appendChild(cell(c, 'identity', '是什么'));
        tr.appendChild(cell(c, 'faction', '所属'));
        const affTd = cell(c, 'affinity', '未接入就留空');
        // 好感只能"读"——接入数据源时提示她这是读来的
        affTd.title = trimText(c.affinitySource) ? ('读自：' + trimText(c.affinitySource)) : '没接数据源（引擎不自己编）';
        tr.appendChild(affTd);
        tr.appendChild(cell(c, 'timePlace', '例：第二天 上午 · 学校'));
        tr.appendChild(cell(c, 'current', '本回合正在发生的事（只写这一步、只写他自己）', true));
        tbody.appendChild(tr);

        /* ---- 明细行（默认收起） ---- */
        const dtr = document.createElement('tr');
        dtr.className = 'wxg-cdetail-row';
        dtr.setAttribute('data-detail-of', c.id);
        dtr.setAttribute('data-hide', '1');
        const dtd = document.createElement('td');
        dtd.setAttribute('colspan', '7');
        const detail = el('div', 'wxg-cdetail');
        if (detail.style) {
            detail.style.display = 'none';
        }

        if (c.currentSuspect) {
            const warn = el('div', 'wxg-store', '⚠ 这条「正在经历」引擎判定**不可靠**：'
                + (trimText(c.currentSuspectWhy) || '疑似越界')
                + '　⇒ 已标出来、但没擅自改它，你看着办（下一步该由你回话决定）');
            warn.setAttribute('data-tone', 'bad');
            detail.appendChild(warn);
        }

        // 过去经历
        const past = el('div', 'wxg-field');
        past.appendChild(el('label', null, '过去经历（由近到远，旧的自然淡化）'));
        const pastBox = el('div', 'wxg-list');
        if (!c.past.length) {
            pastBox.appendChild(el('div', 'wxg-empty', '还没有'));
        } else {
            for (const p of c.past) {
                pastBox.appendChild(el('div', 'wxg-fact', '· ' + p.text + (p.manual ? '（已手动修改）' : '')));
            }
        }
        past.appendChild(pastBox);
        detail.appendChild(past);

        // 日程
        if (c.schedule.length) {
            const sch = el('div', 'wxg-field');
            sch.appendChild(el('label', null, '日程（到点要跟上）'));
            const schBox = el('div', 'wxg-list');
            for (const s of c.schedule) {
                schBox.appendChild(el('div', 'wxg-fact', '· ' + s.what + (s.due ? '（' + s.due + '）' : '') + (s.done ? ' ✓已到' : '')));
            }
            sch.appendChild(schBox);
            detail.appendChild(sch);
        }

        // 任务（主线／支线）：目标层——"他在追什么"，⛔ 不是"下一步做什么"
        // 整理规则（我定的）：进行中的排前面，完成/搁置的收进折叠里（不占地方，但一条不丢）
        if (Array.isArray(c.quests) && c.quests.length) {
            const qBox = el('div', 'wxg-list');
            const open = c.quests.filter((q) => !['完成', '搁置'].includes(trimText(q.status)));
            const over = c.quests.filter((q) => ['完成', '搁置'].includes(trimText(q.status)));
            const stat = questStats(c.quests);
            qBox.appendChild(el('div', 'wxg-report-h',
                '任务（在追的目标 · ⛔ 不是"下一步做什么"）'
                + '　主线 ' + String(stat.main) + ' · 支线 ' + String(stat.side)
                + (over.length ? '（已结束 ' + String(over.length) + '）' : '')));

            const makeQuestRow = (q) => {
                const row2 = el('div', 'wxg-rowitem');
                const head = el('div', 'wxg-rowname');
                head.appendChild(el('span', 'wxg-badge wxg-badge-soft', trimText(q.kind) === 'main' ? '主线' : '支线'));
                head.appendChild(el('span', 'wxg-name', trimText(q.title)));
                const st = select('wxg-q-' + c.id + '-' + trimText(q.title), [
                    { value: '活跃', label: '活跃' },
                    { value: '完成', label: '完成' },
                    { value: '搁置', label: '搁置' },
                ], trimText(q.status), 'set-quest-status', c.id);
                st.setAttribute('data-title', trimText(q.title));
                st.className = 'text_pole wxg-mini';
                head.appendChild(st);
                if (q.manual) {
                    head.appendChild(el('span', 'wxg-badge wxg-badge-warn', '已手动修改'));
                }
                const del = button('删', 'del-quest', 'wxg-btn-sm', c.id);
                del.setAttribute('data-title', trimText(q.title));
                head.appendChild(del);
                row2.appendChild(head);
                if (trimText(q.note)) {
                    row2.appendChild(el('div', 'wxg-fact', trimText(q.note)));
                }
                if (Array.isArray(q.items) && q.items.length) {
                    row2.appendChild(el('div', 'wxg-fact', q.items.map((i) => (i.done ? '☑ ' : '▶ ') + trimText(i.text)).join('　')));
                }
                return row2;
            };

            if (!open.length) {
                qBox.appendChild(el('div', 'wxg-empty', '没有在追的任务了（已结束的都收在下面）'));
            }
            for (const q of open) {
                qBox.appendChild(makeQuestRow(q));
            }
            if (over.length) {
                const fold = foldable('已结束 ' + String(over.length) + ' 条（完成／搁置，点开看）', false);
                const inner = el('div', 'wxg-list');
                for (const q of over) {
                    inner.appendChild(makeQuestRow(q));
                }
                fold.appendChild(inner);
                qBox.appendChild(fold);
            }
            detail.appendChild(qBox);
        }

        // 合并与收下
        const badges = el('div', 'wxg-row');
        badges.appendChild(button('按这条合并…', 'merge-into', 'wxg-btn-sm', c.id));
        if (c.isNew) {
            badges.appendChild(button('名字对，收下', 'accept-new', 'wxg-btn-sm', c.id));
            badges.appendChild(button('忽略这条', 'ignore-char', 'wxg-btn-sm', c.id));
        }
        detail.appendChild(badges);

        dtd.appendChild(detail);
        dtr.appendChild(dtd);
        tbody.appendChild(dtr);
    }

    table.appendChild(tbody);
    // 7 列装不下时横向滚，⛔ 不硬挤成一团
    const twrap = el('div', 'wxg-ctablewrap');
    twrap.appendChild(table);
    box.appendChild(twrap);
    box.appendChild(el('div', 'wxg-note',
        '一行一个人：名字／年龄／身份／所在势力／好感／时间・地点／正在经历，格子里直接改字；'
        + '改过的会显示「已手动修改」，下一轮更新⛔ 不许冲掉。点「明细」看过去经历、日程与任务。'
        + '搜索只筛显示，⛔ 不动数据。'));
    host.appendChild(box);

    // 按当前的搜索词先筛一遍
    applyCharSearch(host, charSearch.query);
}

/**
 * ⭐ 每段一个保存（她拍的："每个大标题的这个地方直接加一个保存得了，弄完设定整页保存"）。
 *
 * 为什么要这样：原来一个段里散着好几个"保存"（提取名单／排除名单／条目名单…），
 * 点一下还立刻生效 ⇒ 点错、面板跳、按钮一片。现在：
 *   · 段里所有改动先落进**这一段的草稿**（`staging[段] = {键: 值}`）；
 *   · 段底**一个**「保存这一段」把它整段提交；旁边显示"改了几处"；
 *   · 想退回 ⇒「撤销这一段」把草稿丢掉（回到已存的）。
 */
const staging = {};

/** 记一笔草稿（⛔ 不落设置）；同一段同一键只留最后一次 */
function stage(secId, key, value) {
    const box = staging[secId] || (staging[secId] = {});
    box[key] = value;
}

/** 这一段草稿里有几处改动 */
function stagedCount(secId) {
    const box = staging[secId];
    return box ? Object.keys(box).length : 0;
}

/** 这一段某个键的"当前显示值"（草稿优先，其次已存） */
function stagedValue(secId, key, fallback) {
    const box = staging[secId];
    return box && Object.prototype.hasOwnProperty.call(box, key) ? box[key] : fallback;
}

/**
 * 段底那条"保存"（每段都有）。
 * @param {string} secId 段的标识（见各段自己的 id）
 * @param {string} label 按钮文字（默认"保存这一段"）
 */
function saveBar(secId, label) {
    const n = stagedCount(secId);
    const bar = el('div', 'wxg-savebar' + (n ? ' has-changes' : ''));
    bar.setAttribute('data-id', secId);
    const note = el('span', 'wxg-savebar-note',
        n ? ('改了 ' + String(n) + ' 处（还没保存）') : '这一段没有未保存的改动');
    bar.appendChild(note);
    if (n) {
        bar.appendChild(button('撤销这一段', 'discard-section', 'wxg-btn-sm', secId));
    }
    bar.appendChild(button(label || '保存这一段', 'save-section', n ? '' : 'wxg-btn-sm', secId));
    return bar;
}

/** 把这一段的草稿落进设置 */
function commitSection(secId) {
    const box = staging[secId];
    if (!box || !Object.keys(box).length) {
        return 0;
    }
    const patch = {};
    for (const k of Object.keys(box)) {
        // 整块外观（色板＋四个颜色槽）
        if (k === 'appearance' && box[k] && typeof box[k] === 'object') {
            patch.appearance = Object.assign({}, getSettings().appearance || {}, box[k]);
            continue;
        }
        // 走 api 那一格的键：**逐键合并**，⛔ 不整块替换
        // （整块替换会把她存好的书签 `profiles` 一起冲掉）
        if (API_KEYS.includes(k)) {
            patch.api = Object.assign({}, patch.api || {}, { [k]: box[k] });
        } else {
            patch[k] = box[k];
        }
    }
    // ⚠️ 顺序：**先把草稿摘掉，再落盘**。
    //    patchSettings 会触发重画（重画又从草稿读值）⇒ 反过来写的话，
    //    这一段刚保存的值会被"还留着的旧草稿"覆盖回去（真踩过）。
    delete staging[secId];
    patchSettings(patch);
    return Object.keys(box).length;
}

/** 走 api 那一格的键（保存时归到 api 下面） */
const API_KEYS = ['mode', 'url', 'key', 'model', 'modelCheap', 'temperature', 'maxTokens'];

/**
 * ⭐ `stage-*` 动作总表：动作名 → [这一段, 设置键, 取值方式]。
 * 有了它，各处控件只要把 `set-xxx` 写成 `stage-xxx` 就进了草稿，⛔ 不用每个都写一个 case。
 */
const STAGE_MAP = {
    // 总控
    'stage-auto-update': ['general', 'autoUpdate', 'checked'],
    'stage-update-every': ['general', 'updateEvery', 'value'],
    'stage-protected': ['general', 'protectedBypass', 'checked'],
    'stage-strict': ['general', 'strictMention', 'checked'],
    'stage-panel-on-start': ['general', 'showPanelOnStart', 'checked'],
    // 外观
    'stage-app-to-panel': ['appearance', 'applyToPanel', 'checked'],
    'stage-layout-mode': ['appearance', 'layoutMode', 'value'],
    // 召回
    'stage-recent-turns': ['recall', 'recentTurns', 'value'],
    'stage-max-chars': ['recall', 'maxChars', 'value'],
    'stage-max-events': ['recall', 'maxEvents', 'value'],
    'stage-past-floor-cut': ['recall', 'pastFloorCut', 'value'],
    'stage-max-parallel': ['recall', 'maxParallelChars', 'value'],
    'stage-sort-mode': ['recall', 'sortMode', 'value'],
    'stage-card': ['recall', 'cardEnabled', 'checked'],
    'stage-show-empty': ['recall', 'showEmptyCard', 'checked'],
    // 自定义 API
    'stage-api-mode': ['api', 'mode', 'value'],
    'stage-api-url': ['api', 'url', 'value'],
    'stage-api-key': ['api', 'key', 'value'],
    'stage-api-model': ['api', 'model', 'value'],
    'stage-api-model-cheap': ['api', 'modelCheap', 'value'],
    'stage-api-temp': ['api', 'temperature', 'value'],
    'stage-api-maxtok': ['api', 'maxTokens', 'value'],
    // 读取控制（四格）
    'stage-extract-tags': ['extract', 'extractTags', 'value'],
    'stage-exclude-tags': ['extract', 'excludeTags', 'value'],
    'stage-extract-books': ['extract', 'extractBooks', 'value'],
    'stage-exclude-books': ['extract', 'excludeBooks', 'value'],
    'stage-affinity-source': ['extract', 'affinitySource', 'value'],
    // 提示词
    'stage-inject-header': ['prompts', 'injectHeader', 'value'],
    'stage-prompt-world': ['prompts', 'promptWorld', 'value'],
    'stage-prompt-chars': ['prompts', 'promptChars', 'value'],
    'stage-jailbreak': ['prompts', 'jailbreak', 'value'],
};

/** 把一处改动收进草稿（通用入口；⛔ 不落设置） */
function stageOne(action, target) {
    // 外观那块是整块存的（色板＋四个颜色槽）
    if (action === 'stage-appearance') {
        const key = target.id;                        // wxg-app-xxx → 槽位名
        const slot = key.replace('wxg-app-', '');
        const cur = getSettings().appearance || {};
        if (slot === 'palette') {
            stage('appearance', 'appearance', Object.assign({}, cur, palettePatch(trimText(target.value))));
        } else {
            stage('appearance', 'appearance', Object.assign({}, cur, { [slot]: trimText(target.value), palette: 'custom' }));
        }
        return 'appearance';
    }
    const row = STAGE_MAP[action];
    if (!row) {
        return null;
    }
    const [secId, key, how] = row;
    stage(secId, key, how === 'checked' ? target.checked === true : target.value);
    return secId;
}

/** 保存之后说一声（说清"到底存了几处"，⛔ 不静默） */
function refreshToastSection(secId, n) {
    if (!n) {
        toast.info('这一段没有未保存的改动');
        return;
    }
    toast.ok('存好了：这一段改了 ' + String(n) + ' 处');
}

/**
 * 只把"保存这条"就地重画一下（⛔ 不整页重画 ⇒ 她还能接着点）。
 * ⚠️ 要整条重画：改动数一变，「撤销这一段」这颗按钮也得跟着出现／消失。
 */
function refreshSaveBar(host, secId) {
    const bar = host && host.querySelector ? host.querySelector('.wxg-savebar[data-id="' + secId + '"]') : null;
    if (!bar || !bar.parentNode) {
        return;
    }
    // ⚠️ 用"插新的、删旧的"（不依赖 replaceChild：假 DOM 上不稳）
    const parent = bar.parentNode;
    const fresh = saveBar(secId);
    parent.insertBefore(fresh, bar);
    parent.removeChild(bar);
}

/** ⭐ 读取控制：正在看哪本书的条目（重画后要能自动摆回来，否则点一条之后就没得点了） */
export let pickBook = '';
export let pickEntries = [];
/** 读到的世界书名单（画小块用，⛔ 不反复读世界书） */
let listBooksCache = [];

/** 角色状态：搜索与排序的"记忆"（重画之后还在，不会因为改一个字就被清空） */
export const charSearch = { query: '', sort: 'recent' };

/** 把好感写成能排序的数字（"62"／"62(+0.5)"／"未知" 都能认） */
function affinityNum(v) {
    const m = asText(v).match(/-?\d+(\.\d+)?/);
    return m ? Number(m[0]) : -Infinity;
}

/**
 * 按搜索词筛行：只切 css 类，⛔ 不重画页面
 * （重画会把她正在打的字、正在看的滚动位置全弄没）。
 */
export function applyCharSearch(root, query) {
    if (!root || typeof root.querySelectorAll !== 'function') {
        return;
    }
    const q = asText(query).trim().toLowerCase();
    const rows = asArray(root.querySelectorAll('.wxg-ctable tbody tr[data-search]'));
    let shown = 0;
    for (const tr of rows) {
        const hit = !q || asText(tr.getAttribute('data-search')).includes(q);
        if (tr.classList) {
            tr.classList.toggle('wxg-rowfiltered', !hit);
        }
        if (hit) {
            shown += 1;
        }
        // 明细行跟着主人一起藏
        const id = tr.getAttribute('data-id');
        const detail = root.querySelector('.wxg-cdetail-row[data-detail-of="' + id + '"]');
        if (detail && detail.classList && !hit) {
            detail.classList.add('wxg-rowfiltered');
        }
    }
    const chip = root.querySelector('[data-role="char-count"]');
    if (chip) {
        chip.textContent = q ? ('筛出 ' + String(shown) + ' 人') : (String(rows.length) + ' 人');
    }
}

function secChronicle(host) {
    const list = getChronicle();
    const box = section('编年',
        '每回合推演出来的东西**全部按时间攒在这里**（过去经历／正在经历是滚动更新的，旧的只有这儿能回看）。',
        { open: true }
        + '⭐ 编年**只给你看**：不注入、不喂模型。');
    if (!list.length) {
        box.appendChild(el('div', 'wxg-empty', '还没有记录（更新几轮就有了）'));
        host.appendChild(box);
        return;
    }
    const wrap = el('div', 'wxg-report-list');
    const recent = list.slice(-120).reverse();
    for (const c of recent) {
        const line = el('div', 'wxg-chron');
        line.appendChild(el('span', 'wxg-report-time', formatStamp(c.at)));
        if (Number.isFinite(c.floor) && c.floor >= 0) {
            line.appendChild(el('span', 'wxg-report-floor', floorLabel(c.floor)));
        }
        line.appendChild(el('span', 'wxg-badge wxg-badge-soft', c.kind || '推演'));
        if (trimText(c.who)) {
            line.appendChild(el('span', 'wxg-name', c.who));
        }
        if (c.manual) {
            line.appendChild(el('span', 'wxg-badge wxg-badge-warn', '已手动修改'));
        }
        line.appendChild(el('div', 'wxg-fact', c.text));
        wrap.appendChild(line);
    }
    box.appendChild(wrap);
    box.appendChild(el('div', 'wxg-note', '共 ' + String(list.length) + ' 条，这里显示最近 120 条（更早的仍在账本与世界书归档里）'));
    host.appendChild(box);
}

function secRoster(host) {
    const roster = getRoster();
    const box = section('人物名册',
        '名册按聊天各分各的（开新档＝新世界，数据不串）。别名表由你自己维护——正文里叫昵称也能召回上。',
        { open: true });
    const d = describeRoster();
    const state = loadState();
    const fresh = Array.isArray(state.newPeople) ? state.newPeople.filter(Boolean) : [];
    box.appendChild(el('div', 'wxg-note', d.total
        ? '现有 ' + String(d.total) + ' 人' + (d.players ? '（其中玩家棋子 ' + String(d.players) + ' 人）' : '')
        : '还没有人物。'));
    // ⭐「新认的人」接上显示（条 12：这个数组原来只写不读）。
    //    她最需要知道的恰恰是"引擎自己认了谁"——认错了要能一眼看见并处理。
    if (fresh.length) {
        const line = el('div', 'wxg-store', '引擎新认了 ' + String(fresh.length) + ' 个人：' + fresh.join('、')
            + '（名字对不对？不对就点「按这条合并…」并进老记录，或「忽略这条」）');
        line.setAttribute('data-tone', 'bad');
        box.appendChild(line);
        row(box, button('一键收下这些新认的人', 'accept-new-all'));
    }

    row(box, textInput('wxg-new-name', '', '新人物名字', 'noop'), button('加入名册', 'add-char'), button('一键盘入预设名册', 'preset-roster'));
    row(box, textInput('wxg-import-roster', '', '批量导入：名字一行一个（也认逗号、顿号）', 'noop'), button('批量导入', 'import-roster'));
    row(box,
        textInput('wxg-book-name', '', '从世界书读人：填世界书名（留空＝角色卡绑定那本）', 'noop', 'wxg-short'),
        button('从世界书读人', 'read-book'),
        button('列出世界书', 'list-books'));
    const bookList = el('div', 'wxg-note', '');
    bookList.id = 'wxg-book-list';
    box.appendChild(bookList);
    row(box, button('查重（找出被拆成两条的）', 'detect-dupes'), button('导出备份（JSON）', 'export-data'));

    const list = el('div', 'wxg-roster');
    for (const c of roster) {
        const r = el('div', 'wxg-char');
        const main = el('div', 'wxg-char-main');
        main.appendChild(el('div', 'wxg-char-name', c.name));
        if (c.isPlayer) {
            main.appendChild(el('span', 'wxg-badge wxg-badge-warn', '玩家棋子'));
        }
        if (c.isNew) {
            main.appendChild(el('span', 'wxg-badge wxg-badge-soft', '新认的人'));
        }
        if (c.manual) {
            main.appendChild(el('span', 'wxg-badge wxg-badge-soft', '已手动修改'));
        }
        r.appendChild(main);

        const fields = el('div', 'wxg-char-fields');
        const alias = textInput('wxg-alias-' + c.id, c.aliases.join('、'), '别名／昵称（顿号或逗号分开）', 'set-alias', 'wxg-alias');
        alias.setAttribute('data-id', c.id);
        fields.appendChild(alias);
        const aff = textInput('wxg-aff-' + c.id, c.affinity, '好感（读自"手机"，未接入先空着）', 'set-affinity', 'wxg-affinity');
        aff.setAttribute('data-id', c.id);
        fields.appendChild(aff);
        r.appendChild(fields);

        const actions = el('div', 'wxg-char-actions');
        const playerLabel = el('label', 'checkbox_label wxg-mini');
        const pbox = document.createElement('input');
        pbox.type = 'checkbox';
        pbox.checked = c.isPlayer === true;
        pbox.setAttribute('data-action', 'set-player');
        pbox.setAttribute('data-id', c.id);
        playerLabel.appendChild(pbox);
        playerLabel.appendChild(el('span', null, '玩家棋子'));
        actions.appendChild(playerLabel);
        actions.appendChild(button('删除', 'del-char', 'wxg-btn-sm', c.id));
        r.appendChild(actions);

        list.appendChild(r);
    }
    box.appendChild(list);
    host.appendChild(box);
}

/**
 * ⭐ 外观：我们自己的配色（工作台是自己的地盘，不必迁就酒馆主题）
 * 预设色板 + 四个槽位可单独改；文字色留空＝按底面亮度自动算。
 */
function secAppearance(host) {
    const SECID = 'appearance';
    const s = getSettings();
    const app = resolveAppearance(s.appearance || {});
    const box = section('外观（工作台配色）',
        '工作台是**我们自己的整页窗口**，配色自己定，⛔ 不用迁就酒馆主题；'
        + '设置抽屉那边仍跟随酒馆主题。文字色留空＝按底面亮度自动算（浅底深字／深底浅字）。',
        { open: false, summary: PALETTE_NAMES[app.palette] || '' });

    row(box, field('色板', select('wxg-app-palette',
        PALETTE_KEYS.map((k) => ({ value: k, label: PALETTE_NAMES[k] })),
        app.palette, 'stage-appearance')));

    row(box,
        field('强调色', colorInput('wxg-app-accent', app.accent, 'stage-appearance')),
        field('底面', colorInput('wxg-app-surface', app.surface, 'stage-appearance')),
        field('页面底色', colorInput('wxg-app-bg', app.bg, 'stage-appearance')));
    row(box,
        field('描边', colorInput('wxg-app-border', app.border, 'stage-appearance')),
        field('文字（可留空）', colorInput('wxg-app-text', app.text, 'stage-appearance')));
    row(box,
        button('恢复这个色板', 'reset-appearance'),
        el('span', 'wxg-note', '（只把四个槽位退回所选色板；你手改的颜色会被覆盖）'));
    box.appendChild(checkbox('wxg-app-to-panel', '浮层面板与悬浮小框也用这套配色（不勾＝它们跟随酒馆主题）',
        app.applyToPanel, 'stage-app-to-panel'));

    // 实时预览：四个槽位长什么样，直接给她看
    const pv = el('div', 'wxg-app-preview');
    pv.setAttribute('data-role', 'app-preview');
    applyAppearance(pv, s.appearance || {});
    pv.appendChild(el('div', 'wxg-app-pv-name', '万象阁 · 预览'));
    const pvRow = el('div', 'wxg-row');
    pvRow.appendChild(el('span', 'wxg-badge', '强调色'));
    pvRow.appendChild(el('span', 'wxg-badge wxg-badge-soft', '淡底'));
    const pvBtn = el('button', 'menu_button', '按钮长这样');
    pvBtn.type = 'button';
    pvRow.appendChild(pvBtn);
    pv.appendChild(pvRow);
    pv.appendChild(el('div', 'wxg-fact', '这一块用的是你选的配色——不用打开工作台就能看出效果。'));
    box.appendChild(pv);

    row(box, field('打开方式', select('wxg-layout-mode', [
        { value: 'workspace', label: '整页工作台（推荐：自己的配色＋左栏导航）' },
        { value: 'panel', label: '浮层面板（老样子，能拖能缩放）' },
    ], s.layoutMode, 'stage-layout-mode')));
    box.appendChild(el('div', 'wxg-note', '悬浮小框的开关在「总控」里；它在聊天时常驻，点一下就进工作台。'));

    box.appendChild(saveBar('appearance'));
    host.appendChild(box);
}

function secRecall(host) {
    const SECID = 'recall';
    const s = getSettings();
    const box = section('召回',
        '她发消息时当场算一次"这轮该带什么"：好感必带；世界与平行事件按她最新发言的相关度筛，相关的进、其余排后台。',
        { open: false });
    row(box,
        el('span', 'wxg-note', '线索回溯'),
        numberInput('wxg-recent-turns', s.recentTurns, 1, 10, 'stage-recent-turns'),
        el('span', 'wxg-note', '楼 ｜ 人物封顶'),
        numberInput('wxg-max-chars', s.maxChars, 1, 8, 'stage-max-chars'),
        el('span', 'wxg-note', '｜ 事件封顶'),
        numberInput('wxg-max-events', s.maxEvents, 0, 20, 'stage-max-events'));
    row(box,
        el('span', 'wxg-note', '排序'),
        select('wxg-sort-mode', [
            { value: 'related', label: '按相关度（先说到的排前面）' },
            { value: 'name', label: '按名册顺序' },
        ], s.sortMode, 'stage-sort-mode'));
    row(box,
        el('span', 'wxg-note', '过去经历只端'),
        numberInput('wxg-past-floor-cut', s.pastFloorCut, 0, 50, 'stage-past-floor-cut'),
        el('span', 'wxg-note', '楼之外的（最近这么多楼里的，你上下文里已有，不重复端；0＝全端）'));
    row(box,
        el('span', 'wxg-note', '一轮最多推演'),
        numberInput('wxg-max-parallel', s.maxParallelChars, 0, 12, 'stage-max-parallel'),
        el('span', 'wxg-note', '个不在场的角色（省额度：其余下一轮轮转）'));
    // 卡片那两个开关归这儿（它们是"召回之后怎么显示"的事，⛔ 不是总闸）
    box.appendChild(checkbox('wxg-card-enabled', '在你每条发言后面显示召回卡片', s.cardEnabled, 'stage-card'));
    box.appendChild(checkbox('wxg-show-empty', '没有召回时也显示空态卡片', s.showEmptyCard, 'stage-show-empty'));
    box.appendChild(saveBar('recall'));
    host.appendChild(box);
}

function secExtract(host) {
    const SECID = 'extract';
    const s = getSettings();
    const box = section('读取控制（提取／排除四格）',
        '改完按段底那颗「保存这一段」——⛔ 不用一处一处点保存，也不会点一下就跳。'
        + '世界书这一块不用手打书名：点下面的书名就进名单（再点＝排除、再点＝拿掉），'
        + '点「看条目」能一条条挑。标签那一块默认按结构剥掉成对的机器块与 HTML 注释——'
        + '剥完为空会自动退回原文，⛔ 不会比剥之前更坏。',
        { open: false });
    row(box, field('提取标签', textInput('wxg-extract-tags', stagedValue(SECID, 'extractTags', s.extractTags), '例：正文, content', 'stage-extract-tags', 'wxg-short')));
    row(box, field('排除标签', textInput('wxg-exclude-tags', stagedValue(SECID, 'excludeTags', s.excludeTags), '例：状态栏, 变量（留空＝只按结构剥）', 'stage-exclude-tags', 'wxg-short')));
    box.appendChild(checkbox('wxg-strip-paired', '按结构剥掉成对的机器块（配对的开闭标签，整块剥）', s.stripPairedBlocks, 'set-strip-paired'));
    box.appendChild(checkbox('wxg-strip-comments', '剥掉 HTML 注释（<!-- … -->）', s.stripHtmlComments, 'set-strip-comments'));

    /* ---- 世界书：点选（⛔ 不立刻存，攒到段底一起存） ---- */
    box.appendChild(el('div', 'wxg-report-h', '提取世界书（读哪些）'));
    row(box, field('', textInput('wxg-extract-books', stagedValue(SECID, 'extractBooks', s.extractBooks), '留空＝角色卡绑定那本；也可手填，逗号分开', 'stage-extract-books', 'wxg-short')));
    box.appendChild(el('div', 'wxg-report-h', '排除世界书（哪些不读）'));
    row(box, field('', textInput('wxg-exclude-books', stagedValue(SECID, 'excludeBooks', s.excludeBooks), '点下面书名也能填进来；也可手填', 'stage-exclude-books', 'wxg-short')));

    const pick = el('div', 'wxg-pickwrap');
    pick.id = 'wxg-bookpick';
    pick.appendChild(el('div', 'wxg-pick-head', '世界书（点一下＝进「提取」；再点＝进「排除」；再点＝拿掉。⛔ 都不立刻生效，最后按段底的保存）'));
    box.appendChild(pick);
    row(box,
        button('读世界书列表', 'list-books'),
        el('span', 'wxg-note', '（没读到就手填；有些酒馆版本没开这个接口）'));
    const bookList = el('div', 'wxg-note', '');
    bookList.id = 'wxg-book-list';
    box.appendChild(bookList);

    const entPick = el('div', 'wxg-pickwrap');
    entPick.id = 'wxg-entpick';
    box.appendChild(entPick);
    const entNote = el('div', 'wxg-note', '');
    entNote.id = 'wxg-entnote';
    box.appendChild(entNote);

    box.appendChild(checkbox('wxg-only-enabled', '只读开启着的条目（不选世界书时＝角色卡绑定世界里开启的条目）', s.onlyEnabledEntries, 'set-only-enabled'));
    row(box, el('span', 'wxg-note', '"手机"好感的数据源（世界书名或条目关键词；留空＝不接，界面如实写"未接入"）'),
        textInput('wxg-affinity-source', stagedValue(SECID, 'affinitySource', s.affinitySource), '例：手机 或 关系表', 'stage-affinity-source', 'wxg-short'));
    box.appendChild(saveBar(SECID));
    host.appendChild(box);
}

function secApi(host) {
    const SECID = 'api';
    const s = getSettings();
    const api = s.api || {};
    const box = section('自定义 API（后台推演走这条通道）',
        '⛔ 不锁死在酒馆默认连接上。云酒馆建议「经酒馆服务器转发」——密钥留在服务器侧，也绕开跨域。',
        { open: false });
    row(box, el('span', 'wxg-note', '连接方式'), select('wxg-api-mode', [
        { value: 'proxy', label: '经酒馆服务器转发（云酒馆最稳）' },
        { value: 'direct', label: '直连（浏览器直接请求）' },
    ], api.mode, 'stage-api-mode'));
    row(box, field('接口地址', textInput('wxg-api-url', api.url, 'https://…/v1', 'stage-api-url', 'wxg-short')));
    row(box, field('密钥', textInput('wxg-api-key', api.key, 'sk-…', 'stage-api-key', 'wxg-short')));
    row(box, field('推演模型', textInput('wxg-api-model', api.model, '例：gemini-3.8-flash', 'stage-api-model', 'wxg-short')));
    row(box, field('打杂模型（留空＝同上）', textInput('wxg-api-model-cheap', api.modelCheap, '便宜的模型', 'stage-api-model-cheap', 'wxg-short')));
    row(box,
        el('span', 'wxg-note', '温度'), numberInput('wxg-api-temp-code', api.temperature, 0, 2, 'stage-api-temp'),
        el('span', 'wxg-note', '单次最多输出'), numberInput('wxg-api-maxtok', api.maxTokens, 200, 8000, 'stage-api-maxtok'));
    row(box, button('测一下连接', 'test-api'), el('span', 'wxg-note', '（只发一句很短的话，验证地址／密钥／模型对不对）'));

    /* ⭐ 书签（她点名要的："加一个保存 API／另存为，我可以设定好几个 API 转"） */
    box.appendChild(el('div', 'wxg-report-h', '书签（存好几套通道，一键切）'));
    const profs = Array.isArray(api.profiles) ? api.profiles : [];
    if (!profs.length) {
        box.appendChild(el('div', 'wxg-empty', '还没有书签。上面填好一套，起个名字点「另存为书签」，以后一键切回来。'));
    } else {
        const listEl = el('div', 'wxg-prof-list');
        for (const p of profs) {
            const r = el('div', 'wxg-prof');
            const info = el('div', 'wxg-prof-info');
            info.appendChild(el('span', 'wxg-prof-nick', trimText(p.nick)));
            info.appendChild(el('span', 'wxg-note', (trimText(p.model) || '（没填模型）')
                + (trimText(p.url) ? ' · ' + hostOf(p.url) : '')
                + ' · ' + (p.mode === 'direct' ? '直连' : '走酒馆转发')));
            r.appendChild(info);
            const acts = el('div', 'wxg-row');
            const use = button('切到这套', 'apply-profile', 'wxg-btn-sm', trimText(p.nick));
            acts.appendChild(use);
            acts.appendChild(button('删', 'del-profile', 'wxg-btn-sm', trimText(p.nick)));
            r.appendChild(acts);
            listEl.appendChild(r);
        }
        box.appendChild(listEl);
    }
    row(box,
        textInput('wxg-profile-nick', '', '书签名（例：主站／备用站）', 'noop', 'wxg-short'),
        button('另存为书签', 'save-profile'));
    box.appendChild(el('div', 'wxg-note', '书签存的是**整套**：连接方式／地址／密钥／模型／温度／输出上限。'
        + '书签名一样就更新那一条（不会越存越多）；想现在就用它，点上面那颗「切到这套」。'));
    box.appendChild(saveBar('api'));
    host.appendChild(box);
}

/** 从 URL 里取主机名，只用于显示（⛔ 不泄露整条密钥） */
function hostOf(url) {
    const s = asText(url);
    const m = s.match(/^[a-z]+:\/\/([^/]+)/i);
    return m ? m[1] : (s.length > 24 ? s.slice(0, 24) + '…' : s);
}

function secPrompts(host) {
    const s = getSettings();
    const box = section('提示词（可看可改）',
        '留空＝用内置默认；填了＝原样用你写的。破限词同理：留空＝内置那份，填了＝整段替换。',
        { open: false });
    box.appendChild(el('div', 'wxg-report-h', '注入块开头那句'));
    box.appendChild(textarea('wxg-inject-header', s.injectHeader, '', 'stage-inject-header', 3));
    box.appendChild(el('div', 'wxg-report-h', '世界推演提示词'));
    box.appendChild(textarea('wxg-prompt-world', s.promptWorld, '（留空＝用内置）', 'stage-prompt-world', 6));
    box.appendChild(el('div', 'wxg-report-h', '角色状态／平行事件提示词'));
    box.appendChild(textarea('wxg-prompt-chars', s.promptChars, '（留空＝用内置）', 'stage-prompt-chars', 6));
    box.appendChild(el('div', 'wxg-report-h', '破限词'));
    box.appendChild(textarea('wxg-jailbreak', s.jailbreak, '（留空＝用内置那份）', 'stage-jailbreak', 4));
    row(box, button('看内置破限词', 'show-jailbreak'), button('全部恢复内置默认', 'reset-prompts'));
    const view = el('pre', 'wxg-report-text', DEFAULT_JAILBREAK);
    view.id = 'wxg-jailbreak-view';
    view.style.display = 'none';
    box.appendChild(view);
    const worldView = el('pre', 'wxg-report-text', effectivePrompt('world'));
    worldView.id = 'wxg-prompt-world-view';
    worldView.style.display = 'none';
    box.appendChild(worldView);
    box.appendChild(saveBar('prompts'));
    host.appendChild(box);
}

function secReport(host) {
    const list = recentRecallRecords(20);
    const box = section('过程报告 · 每轮到底注入了什么',
        '按时间从新到旧：① 怎么挑的 ② 实际送进请求的内容一字不差（可复制）'
        + '③ 回执（成没成、多少字、什么身份、为什么没注入）。（' + FLOOR_NOTE + '）',
        { open: false });
    if (!list.length) {
        box.appendChild(el('div', 'wxg-empty', '还没有记录：发一条消息、正文生成之后就会有了。'));
        host.appendChild(box);
        return;
    }
    for (const rec of list) {
        const shownChars = countChars(rec.injectedText);
        const statusText = rec.injectStatus === 'ok'
            ? '已注入 ' + String(shownChars) + ' 字'
            : (rec.injectStatus === 'empty' ? '未注入' : (rec.injectStatus === 'error' ? '注入失败' : '待送'));
        const det = foldable(formatStamp(rec.at) + ' · ' + floorLabel(rec.floor) + ' · ' + statusText
            + ' · ' + (rec.chars && rec.chars.length ? rec.chars.join('、') : '—'), false);
        const body = el('div', 'wxg-report-body');

        body.appendChild(el('div', 'wxg-report-h', '① 怎么挑的'));
        const lead = trimText(rec.lead);
        body.appendChild(el('div', 'wxg-fact', '你这条发言：' + (lead ? (lead.length > 80 ? lead.slice(0, 80) + '…' : lead) : '（没记到）')));
        if (Array.isArray(rec.items) && rec.items.length) {
            for (const item of rec.items) {
                const c = item && item.character ? item.character : {};
                const bits = [trimText(c.name) || '（未记名）', '理由：' + (trimText(item.reason) || '—')];
                const has = [];
                has.push(trimText(c.affinity) ? '好感 ' + trimText(c.affinity) : '好感未接入数据源');
                if (trimText(c.identity)) {
                    has.push('身份 ' + trimText(c.identity));
                }
                if (trimText(c.current)) {
                    has.push('正在经历');
                }
                if (Array.isArray(c.past) && c.past.length) {
                    has.push('过去经历 ' + String(c.past.length) + ' 条');
                }
                bits.push('带了：' + has.join('、'));
                if (item.protected) {
                    bits.push('现场保护（不重复推演）');
                }
                body.appendChild(el('div', 'wxg-fact', '· ' + bits.join(' ｜ ')));
            }
        } else {
            body.appendChild(el('div', 'wxg-empty', '本轮没有召回任何人'));
        }
        if (Array.isArray(rec.events) && rec.events.length) {
            body.appendChild(el('div', 'wxg-report-h', '本轮带上的世界事件'));
            for (const ev of rec.events) {
                body.appendChild(el('div', 'wxg-fact', '· ' + (trimText(ev.title) || '') + (trimText(ev.text) ? '：' + trimText(ev.text) : '')));
            }
        }
        if (Array.isArray(rec.notes) && rec.notes.length) {
            body.appendChild(el('div', 'wxg-notes', '说明：' + rec.notes.join('；')));
        }
        // ⭐ 这一轮更新里"与你的手改冲突"的具体条目（条 16：⛔ 不许只报个数字）
        if (Array.isArray(rec.conflicts) && rec.conflicts.length) {
            body.appendChild(el('div', 'wxg-report-h', '⚠️ 这一轮更新时与你的手改冲突'));
            body.appendChild(el('div', 'wxg-notes', '引擎按**你的版本**保留，没冲掉你改的字：'));
            for (const c of rec.conflicts) {
                body.appendChild(el('div', 'wxg-fact', '· ' + asText(c)));
            }
        }

        body.appendChild(el('div', 'wxg-report-h', '② 实际送进请求的内容'));
        const text = trimText(rec.injectedText);
        if (text) {
            body.appendChild(el('pre', 'wxg-report-text', text));
            const bar = el('div', 'wxg-row');
            const key = 'rec-' + String(rec.floor) + '-' + String(rec.at);
            bar.appendChild(button('复制这段', 'copy-text', 'wxg-btn-sm', key));
            bar.appendChild(el('span', 'wxg-note', '这段只进请求、不落正文。'));
            body.appendChild(bar);
            const holder = el('div', 'wxg-hidden-text', text);
            holder.id = 'wxg-text-' + key;
            holder.style.display = 'none';
            body.appendChild(holder);
        } else {
            body.appendChild(el('div', 'wxg-empty', '本轮没有内容送进去'));
        }

        body.appendChild(el('div', 'wxg-report-h', '③ 回执'));
        body.appendChild(el('div', 'wxg-fact', receiptText(rec)));
        if (trimText(rec.injectType)) {
            body.appendChild(el('div', 'wxg-notes', '触发方式：' + trimText(rec.injectType)));
        }
        det.appendChild(body);
        box.appendChild(det);
    }
    host.appendChild(box);
}

function secSteps(host) {
    const box = section('现在的进度', null, { open: true });
    const ul = el('ul', 'wxg-steps');
    const items = [
        '① 骨架 · 扩展能装、界面是中文',
        '② 主线 · 发消息 → 召回 → 注入 → 卡片 ＋ 回执',
        '③ 世界状态 · 势力的碰撞与暗线（阶段制，挂世界钟）',
        '④ 状态格 · 年龄／身份／经历／势力／好感／时间地点',
        '⑤ 平行事件 · 每个角色自己那条线 ＋ 编年',
        '⑥ 稳当 · 失败可见、撤回上一版、对账、补推历史',
        '⑦ 收尾 · 四格名单、自定义 API、提示词与破限词、人物合并',
    ];
    for (const label of items) {
        ul.appendChild(el('li', 'wxg-ok', label));
    }
    box.appendChild(ul);
    host.appendChild(box);
}

/* ------------------------------ 渲染与事件 ------------------------------ */

/** 把整套分节画进宿主 */
export function renderSections(host, opts) {
    if (!host) {
        return;
    }
    const mode = (opts && opts.mode) || 'settings';
    host.replaceChildren();
    host.classList.add('wanxiangge');
    host.setAttribute('data-wxg-mode', mode);

    /*
     * ⭐ 挂载口径：各节函数返回的是**正文层**（内容都在它里面），
     *    这里把"壳 ＋ 正文"合起来，**整壳**挂进宿主。
     *    ⛔ 只挂正文 = 标题全丢；只挂壳 = 内容全丢（这两种错我都犯过，别再来一次）。
     *
     * ⭐ 顺序也照"怎么用"排（原来是历史顺序，看板被埋在配置后面）：
     *    ① 现在怎么样（账本／进度）→ ② 世界与人（世界／角色／编年／名册／过程报告）
     *    → ③ 设一次就不动（总控／召回／读取控制／API／提示词）
     *
     * ⚠️ 加固（真机崩过一次）：**挂载这一步也在 try 里**——它要是抛，兜底才真的兜得住。
     *    并且 `children` 是 **HTMLCollection**（真 DOM），⛔ 没有 .slice()/.includes()，
     *    一律 `Array.from(...)` 转成数组再用（假环境把它做成数组，所以自审没抓住，已修 shim）。
     */
    const staging = el('div', 'wxg-stage');
    try {
        // ① 看板：现在怎么样
        secStatus(staging);
        secSteps(staging);
        // ② 世界与人
        secWorld(staging);
        secCharacters(staging);
        secReport(staging);
        secChronicle(staging);
        secRoster(staging);
        // ③ 配置：设一次就不动
        secGeneral(staging);
        secAppearance(staging);
        secRecall(staging);
        secExtract(staging);
        secApi(staging);
        secPrompts(staging);

        // 自检：一段都没画出来 ⇒ 也要说出来，⛔ 不留白板
        const before = asArray(host.children || []).length;
        hangUp(host, staging);
        const added = asArray(host.children || []).length - before;
        if (!added) {
            drawFailure(host, new Error('12 段一段都没画出来（可能是这一版和设置里存的老数据对不上）'));
        }
        buildJumpNav(host);
        // ⭐ 读取控制：刚才在挑某本书的条目 ⇒ 重画之后把它摆回来
        //    （⛔ 不然点一条之后列表就没了，没法接着点第二条）
        try {
            renderEntryPick(host);
        } catch (e) {
            console.warn('[万象阁] 摆回条目列表出错：', e);
        }
    } catch (e) {
        console.warn('[万象阁] 画面板出错：', e);
        drawFailure(host, e);
    }
}

/**
 * 画世界书小块（只改这几颗按钮，⛔ 不重画面板 —— 点一下面板就跳会很难连着点）。
 * @param {object} host 面板正文层
 * @param {Array<string>} ex 待保存的"提取"名单
 * @param {Array<string>} no 待保存的"排除"名单
 */
export function paintBookPicks(host, ex, no) {
    const wrap = host && host.querySelector ? host.querySelector('#wxg-bookpick') : null;
    if (!wrap) {
        return;
    }
    for (const child of asArray(wrap.childNodes)) {
        if (!String(child.className || '').includes('wxg-pick-head')) {
            wrap.removeChild(child);
        }
    }
    for (const n of listBooksCache) {
        const k = asText(n);
        const inEx = (ex || []).some((x) => asText(x) === k);
        const inNo = (no || []).some((x) => asText(x) === k);
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'wxg-pick' + (inEx ? ' is-on' : '') + (inNo ? ' is-off' : '');
        b.textContent = n + (inEx ? '（提取）' : (inNo ? '（排除）' : ''));
        b.title = inEx ? '在「提取」名单里（还没保存；再点＝改排除）'
            : (inNo ? '在「排除」名单里（还没保存；再点＝拿掉）' : '点一下＝要读它');
        b.setAttribute('data-action', 'pick-book');
        b.setAttribute('data-book', n);
        wrap.appendChild(b);
    }
}

/**
 * 把"正在看的那本书"的条目小块摆回面板（点一条之后重画，接着还能点）。
 * 数据来自 list-entries 抓到的 `pickEntries`，⛔ 不再重复读世界书。
 */
export function renderEntryPick(host, offList) {
    if (!pickBook || !pickEntries.length) {
        return;
    }
    const wrap = host.querySelector('#wxg-entpick');
    const note = host.querySelector('#wxg-entnote');
    if (!wrap) {
        return;
    }
    const off = Array.isArray(offList) ? offList : toList(stagedValue('extract', 'excludeEntries', getSettings().excludeEntries));
    while (wrap.firstChild) {
        wrap.removeChild(wrap.firstChild);
    }
    if (note) {
        note.textContent = '「' + pickBook + '」共 ' + String(pickEntries.length)
            + ' 条：点一下＝不读这一条（⛔ 不立刻保存，按上面「保存条目名单」才生效）；⛔ 不改你的世界书。';
    }
    for (const e of pickEntries.slice(0, 200)) {
        const title = trimText(e && (e.comment || e.key || e.name || e.title));
        if (!title) {
            continue;
        }
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'wxg-pick' + (off.some((x) => asText(x) === asText(title)) ? ' is-on' : '');
        b.textContent = title;
        b.title = off.some((x) => asText(x) === asText(title))
            ? '已设为"不读"（再点＝恢复读它）'
            : '点一下＝不读这一条';
        b.setAttribute('data-action', 'toggle-entry');
        b.setAttribute('data-entry', title);
        wrap.appendChild(b);
    }
}

/**
 * 顶部"快速跳转"（只在**独立面板**里画）。
 *
 * 为什么这么做（而不是分页／页签）：
 *   · 分页会把东西**藏起来**——"没完成的事""失败原因"这类她要能一眼看见；
 *   · 面板本来就能拖大，宽栏里一行放得下 ⇒ 一行"跳转条"比页签更省事、也不丢内容；
 *   · 窄栏（酒馆设置区那个抽屉）里放不下就不画，那边靠折叠＋顺序解决。
 * ⛔ 不用 anchor 链接（怕动了地址栏），走委托点击 + scrollIntoView。
 */
function buildJumpNav(host) {
    if (!host) {
        return;
    }
    const old = host.querySelector('.wxg-nav');
    if (old) {
        old.remove();
    }
    if (host.getAttribute('data-wxg-mode') !== 'panel') {
        return;   // 窄栏不画
    }
    const nav = el('div', 'wxg-nav');
    nav.appendChild(el('span', 'wxg-nav-title', '跳到'));
    const secs = asArray(host.querySelectorAll('.wxg-sec'));
    secs.forEach((sec, i) => {
        const titleEl = sec.querySelector('.wxg-sec-title');
        const name = trimText(titleEl && titleEl.textContent) || ('第 ' + String(i + 1) + ' 段');
        const btn = el('button', 'wxg-nav-btn', name);
        btn.type = 'button';
        btn.setAttribute('data-jump', String(i));
        nav.appendChild(btn);
    });
    // ⚠️ 要插在**最前面**：用 firstChild 当参照（appendChild 那样会跑到末尾去）
    const first = (host.children && host.children.length) ? host.children[0] : null;
    if (first) {
        host.insertBefore(nav, first);
    } else {
        host.appendChild(nav);
    }

    // 滚动时高亮"你现在在哪一段"（scroll-spy）
    bindNavScrollSpy(host, nav);
    markActiveNav(host, nav);
}

/**
 * 滚动时把"当前所在那一段"高亮出来。
 * ⚠️ 监听挂在**宿主**（面板正文层）上，每次重画前先解绑，⛔ 免得叠一堆监听器。
 */
function bindNavScrollSpy(host, nav) {
    if (typeof host.removeEventListener === 'function' && host.__wxgSpy) {
        host.removeEventListener('scroll', host.__wxgSpy);
        host.__wxgSpy = null;
        // 顺手把滚动动效的监听也撤掉
        if (host.__wxgEndTimer) {
            clearTimeout(host.__wxgEndTimer);
            host.__wxgEndTimer = null;
        }
    }
    if (typeof host.addEventListener !== 'function' || typeof requestAnimationFrame !== 'function') {
        return;
    }
    const spy = () => {
        if (host.__wxgSpyBusy) {
            return;
        }
        host.__wxgSpyBusy = true;
        requestAnimationFrame(() => {
            host.__wxgSpyBusy = false;
            markActiveNav(host, nav);
        });
    };
    host.__wxgSpy = spy;
    host.addEventListener('scroll', spy);
}

/** 哪一段离顶端最近，就把哪一颗点亮 */
function markActiveNav(host, nav) {
    if (!host || !nav) {
        return;
    }
    const secs = asArray(host.querySelectorAll('.wxg-sec'));
    const btns = asArray(nav.querySelectorAll('.wxg-nav-btn'));
    if (!secs.length || !btns.length) {
        return;
    }
    // 视口顶端往下一点点的位置当作"当前行"
    const hostTop = Number(host.getBoundingClientRect ? host.getBoundingClientRect().top : 0);
    const line = hostTop + 24;
    let active = 0;
    secs.forEach((sec, i) => {
        const top = sec.getBoundingClientRect ? sec.getBoundingClientRect().top : 0;
        if (top <= line) {
            active = i;
        }
    });
    btns.forEach((b, i) => {
        const on = i === active;
        if (b.classList) {
            b.classList.toggle('is-on', on);
        } else {
            b.setAttribute('class', on ? 'wxg-nav-btn is-on' : 'wxg-nav-btn');
        }
    });
}

/** 跳转条上的点击：滚到那一段，并顺手把它展开（不然滚到了还是收着的） */
export function jumpToSection(host, index) {
    if (!host) {
        return;
    }
    const secs = asArray(host.querySelectorAll('.wxg-sec'));
    const sec = secs[Number(index)];
    if (!sec) {
        return;
    }
    // 展开它（酒馆的折叠是内联样式管的，这里直接设）
    const body = sec.querySelector('.wxg-sec-body');
    if (body && body.style) {
        body.style.display = 'block';
    }
    const icon = sec.querySelector('.inline-drawer-icon');
    if (icon && icon.classList) {
        icon.classList.remove('down');
        icon.classList.add('up');
    }
    if (typeof sec.scrollIntoView === 'function') {
        try {
            sec.scrollIntoView({ block: 'start', behavior: 'smooth' });
        } catch (e) {
            sec.scrollIntoView();
        }
    }
}

/**
 * 把中转站里的正文层合回抽屉壳，整壳挂进宿主；非原生层的东西原样搬 */
function hangUp(host, staging) {
    // ⚠️ children 是 HTMLCollection：先转数组再遍历／查找（真机就栽在这里）
    for (const node of asArray(staging.children || [])) {
        const drawer = node && node.__wxgDrawer;
        if (drawer) {
            // 正文层放回壳里（它本来就在壳里，这里是幂等的），再整壳挂上去
            if (!asArray(drawer.children || []).includes(node)) {
                drawer.appendChild(node);
            }
            host.appendChild(drawer);
        } else {
            host.appendChild(node);
        }
    }
}

/**
 * 兜底：万一哪一段画不出来，⛔ 绝不让面板变成一块白板——把原因写在面板上。
 * （实图里出现过"面板全空"，没有这句话就只能靠猜。）
 */
function drawFailure(host, err) {
    try {
        const box = el('div', 'wxg-store');
        box.setAttribute('data-tone', 'bad');
        box.appendChild(el('b', null, '界面有一段没画出来（原因照抄反馈即可）：'));
        box.appendChild(el('div', 'wxg-fact', String((err && err.message) || err)));
        if (err && err.stack) {
            box.appendChild(el('div', 'wxg-fact', String(err.stack).split('\n').slice(0, 4).join(' ← ')));
        }
        host.appendChild(box);
    } catch (e) {
        // 连兜底都画不出来就只能认了
    }
}

/**
 * 在"这个宿主里"查一个 id（⛔ 不用 document.getElementById）。
 *
 * ⚠️ 为什么要这样（条 4·最重）：同一套分节会**同时**渲染在**两个地方**——
 *    扩展设置区那一块 ＋ 魔法棒打开的独立面板。两处的 id 一模一样，
 *    `document.getElementById` 永远只返回**文档里第一个**（＝设置区那份）
 *    ⇒ 面板里的"加人／加暗线／读世界书"会读到设置区的空输入框（症状："疯狂提示先写个名字"），
 *      而"写回"（世界书列表、破镜词预览、复制用的隐藏块）也会写到设置区去。
 *    ⇒ 一切读／写都改成**相对当前宿主**查。
 */
function byId(host, id) {
    if (!host || !id) {
        return null;
    }
    return host.querySelector('#' + id) || null;
}

/** 读一个输入框的值（⛔ 只读**当前这个面板**里的那个，别串到另一个面板去） */
function textOf(host, id) {
    const node = byId(host, id);
    return node ? asText(node.value) : '';
}

function patchApi(patch) {
    const s = getSettings();
    patchSettings({ api: Object.assign({}, s.api || {}, patch) });
}

async function readFromBook(book) {
    try {
        const res = await collectPeopleFromBook(book, { onlyEnabled: getSettings().onlyEnabledEntries !== false });
        if (res.blocked) {
            toast.warn('这本书在你「排除世界书」名单里，引擎不读它');
            return { added: 0, skipped: 0 };
        }
        const added = addCharacters(res.people.map((p) => p.name));
        return { added, skipped: res.skipped };
    } catch (e) {
        toast.fail('读世界书出错：' + (e && e.message ? e.message : String(e)));
        return null;
    }
}

async function testApi() {
    try {
        const { callModel } = await import('../core/apiclient.js');
        const res = await callModel({
            prompt: '只回四个字：连接正常',
            system: '你是一个测试用的助手。',
            cheap: true,
        });
        if (res && res.ok) {
            return { ok: true, note: trimText(res.text).slice(0, 40) || '（模型回了空内容，但通道是通的）' };
        }
        return { ok: false, note: (res && res.reason) || '未知原因' };
    } catch (e) {
        return { ok: false, note: e && e.message ? e.message : String(e) };
    }
}

function copyToClipboard(text, btn) {
    const done = () => {
        if (btn) {
            const old = btn.textContent;
            btn.textContent = '已复制';
            setTimeout(() => { btn.textContent = old; }, 1500);
        }
    };
    try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
            return;
        }
    } catch (e) {
        // 落到兜底
    }
    fallbackCopy(text, done);
}

function fallbackCopy(text, done) {
    try {
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
        done();
    } catch (e) {
        toast.fail('复制失败，可以手动选中复制');
    }
}

function downloadText(filename, text) {
    try {
        const blob = new Blob([text], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch (e) {
        toast.fail('导出失败：' + (e && e.message ? e.message : String(e)));
    }
}

/** 把事件委托绑到宿主上（只绑一次） */
export function bindSectionEvents(host, refresh) {
    if (!host || host.__wxgBound) {
        return;
    }
    host.__wxgBound = true;

    const rerender = () => {
        const mode = host.getAttribute('data-wxg-mode') || 'settings';
        renderSections(host, { mode });
        if (typeof refresh === 'function') {
            refresh();
        }
    };

    const handler = async (e) => {
        // ⭐ 顶部"快速跳转"：它没有 data-action（那是给会改数据的东西用的）
        const jump = e.target.closest && e.target.closest('[data-jump]');
        if (jump) {
            jumpToSection(host, jump.getAttribute('data-jump'));
            return;
        }
        const target = e.target.closest('[data-action]');
        if (!target) {
            return;
        }
        const action = target.getAttribute('data-action');
        if (!action || action === 'noop') {
            return;
        }
        const id = target.getAttribute('data-id') || '';
        const key = target.getAttribute('data-key') || '';
        const isChange = e.type === 'change';

        try {
            // ⭐ 通用草稿入口：凡是 `stage-*` 的控件，一律只进草稿（段底一起保存）
            if (action.indexOf('stage-') === 0) {
                const which = stageOne(action, target);
                if (which) {
                    refreshSaveBar(host, which);
                }
                return;
            }
            switch (action) {
                /* ---- 总控 ---- */
                case 'set-enabled': patchSettings({ enabled: target.checked }); rerender(); break;
                case 'set-card': patchSettings({ cardEnabled: target.checked }); rerender(); break;
                case 'set-show-empty': patchSettings({ showEmptyCard: target.checked }); rerender(); break;
                case 'set-panel-on-start': patchSettings({ showPanelOnStart: target.checked }); break;
                case 'set-protected': patchSettings({ protectedBypass: target.checked }); break;
                case 'set-strict': patchSettings({ strictMention: target.checked }); break;
                case 'set-auto-update': patchSettings({ autoUpdate: target.checked }); break;
                case 'set-update-every': if (isChange) { patchSettings({ updateEvery: target.value }); } break;
                /* ---- 角色状态：明细开关 / 排序 ---- */
                case 'toggle-cdetail': {
                    // 点「明细」展开那一行（只切显示，⛔ 不重画，免得丢她正在改的字）
                    const drow = host.querySelector('.wxg-cdetail-row[data-detail-of="' + id + '"]');
                    if (drow) {
                        const openNow = drow.getAttribute('data-hide') !== '1';
                        drow.setAttribute('data-hide', openNow ? '1' : '0');
                        const inner = drow.querySelector('.wxg-cdetail');
                        if (inner && inner.style) {
                            inner.style.display = openNow ? 'none' : 'block';
                        }
                        if (target.textContent === '明细' || target.textContent === '收起') {
                            target.textContent = openNow ? '明细' : '收起';
                        }
                    }
                    break;
                }
                case 'char-sort':
                    if (isChange) {
                        charSearch.sort = trimText(target.value) || 'recent';
                        rerender();
                    }
                    break;

                /* ---- 世界状态 ---- */
                case 'set-situation': {
                    if (!isChange) {
                        break;
                    }
                    const idx = Number(target.getAttribute('data-index'));
                    const wkey = target.getAttribute('data-key') || '';
                    const state = loadState();
                    const list = (state.world.situations || []).slice();
                    if (Number.isFinite(idx) && list[idx]) {
                        list[idx] = Object.assign({}, list[idx], { [wkey]: trimText(target.value), manual: true });
                        updateWorld({ situations: list }, { manual: true });
                        toast.ok('局势改好了');
                        rerender();
                    }
                    break;
                }
                case 'del-situation': {
                    const idx = Number(target.getAttribute('data-index'));
                    const list = (loadState().world.situations || []).slice();
                    if (Number.isFinite(idx) && list[idx]) {
                        const gone = list.splice(idx, 1)[0];
                        updateWorld({ situations: list }, { manual: true });
                        addChronicle({ floor: -1, kind: '局势·手动删除', who: '', text: trimText(gone.title) || '（未记名）' });
                        toast.ok('删掉了（已在编年里留痕）');
                        rerender();
                    }
                    break;
                }
                case 'add-situation': {
                    const title = trimText(textOf(host, 'wxg-new-situation'));
                    if (!title) {
                        toast.warn('先写一句这条局势是什么');
                        break;
                    }
                    const list = (loadState().world.situations || []).slice();
                    list.push({ title, sides: '', tier: '几天内', at: Date.now(), floor: -1, manual: true });
                    updateWorld({ situations: list }, { manual: true });
                    toast.ok('加上了');
                    rerender();
                    break;
                }
                case 'set-world-clock': {
                    if (isChange) {
                        const before = loadState().world.clock;
                        const typed = trimText(target.value);
                        updateWorld({ clock: typed }, { manual: true });
                        // 她手填的钟咱照用（她的字最大），但**要出声**：万一填倒退了呢
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
                            rerender();
                        }
                    }
                    break;
                }
                case 'del-hidden': removeHidden(id); rerender(); break;
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

                /* ---- 角色 ---- */
                case 'set-char-field':
                    if (isChange) {
                        updateCharacter(id, { [key]: target.value, manual: true });
                        rerender();
                    }
                    break;
                case 'set-alias':
                    if (isChange) {
                        updateCharacter(id, { aliases: toList(target.value), manual: true });
                        toast.ok('别名保存了');
                        rerender();
                    }
                    break;
                case 'set-affinity':
                    if (isChange) {
                        updateCharacter(id, { affinity: trimText(target.value), manual: true });
                        rerender();
                    }
                    break;
                case 'set-player': updateCharacter(id, { isPlayer: target.checked, manual: true }); rerender(); break;
                case 'del-char': removeCharacter(id); rerender(); break;
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
                case 'merge-into': {
                    const name = window.prompt('把哪一条合并进这一条？（写要并掉的那个名字）');
                    if (!trimText(name)) {
                        break;
                    }
                    const result = mergeCharacters(id, trimText(name));
                    if (result && result.ok) {
                        toast.ok('合并完成：别名、数据、历史都归到一条上了');
                    } else {
                        toast.warn('没找到叫「' + trimText(name) + '」的另一条记录');
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
                case 'read-book': {
                    const res = await readFromBook(trimText(textOf(host, 'wxg-book-name')));
                    if (res) {
                        toast.ok('从世界书认出 ' + String(res.added) + ' 人（跳过 ' + String(res.skipped) + ' 条不认的）');
                    }
                    rerender();
                    break;
                }
                case 'list-books': {
                    const names = await listWorldbookNames();
                    const wrap = byId(host, 'wxg-bookpick');
                    const info = byId(host, 'wxg-book-list');
                    if (!wrap) {
                        break;
                    }
                    if (!names.length) {
                        if (info) {
                            info.textContent = '没读到世界书列表（有些酒馆版本没开这个接口）⇒ 直接手填书名也行。';
                        }
                        break;
                    }
                    if (info) {
                        info.textContent = '读到 ' + String(names.length) + ' 本：点书名选它。';
                    }
                    // 表头留着，小块交给 paintBookPicks 统一画
                    for (const child of asArray(wrap.childNodes)) {
                        if (!String(child.className || '').includes('wxg-pick-head')) {
                            wrap.removeChild(child);
                        }
                    }
                    listBooksCache = names;
                    // ⚠️ 从"草稿优先、否则已存"里取（⛔ 重画时别把还没保存的点选冲掉）
                    paintBookPicks(host,
                        toList(stagedValue('extract', 'extractBooks', getSettings().extractBooks)),
                        toList(stagedValue('extract', 'excludeBooks', getSettings().excludeBooks)));
                    // 顺手把每本书的"看条目"也摆出来
                    const ent = byId(host, 'wxg-entpick');
                    if (ent && !ent.querySelector('[data-action="list-entries"]')) {
                        for (const n of names) {
                            ent.appendChild(button('看条目：' + n, 'list-entries', 'wxg-btn-sm', n));
                        }
                    }
                    break;
                }
                case 'pick-book': {
                    const name = trimText(target.getAttribute('data-book'));
                    if (!name) {
                        break;
                    }
                    // ⭐ 只改这一段草稿：画面不动、⛔ 不存盘、⛔ 不重画
                    const ex = toList(stagedValue('extract', 'extractBooks', getSettings().extractBooks));
                    const no = toList(stagedValue('extract', 'excludeBooks', getSettings().excludeBooks));
                    const key = (x) => asText(x);
                    const iEx = ex.findIndex((x) => key(x) === key(name));
                    const iNo = no.findIndex((x) => key(x) === key(name));
                    if (iEx >= 0) {
                        ex.splice(iEx, 1);
                        no.push(name);
                        toast.info('「' + name + '」改成"排除"（还没保存）');
                    } else if (iNo >= 0) {
                        no.splice(iNo, 1);
                        toast.info('「' + name + '」从"排除"里拿掉（还没保存）');
                    } else {
                        ex.push(name);
                        toast.ok('「' + name + '」要"提取"（还没保存）');
                    }
                    stage('extract', 'extractBooks', ex.join('、'));
                    stage('extract', 'excludeBooks', no.join('、'));
                    paintBookPicks(host, ex, no);
                    refreshSaveBar(host, 'extract');
                    break;
                }
                /* ---- 段级保存／撤销（她拍的："每个大标题加一个保存"） ---- */
                case 'save-section': {
                    const n = commitSection(id);
                    refreshToastSection(id, n);
                    rerender();
                    break;
                }
                case 'discard-section': {
                    delete staging[id];
                    toast.info('这一段没保存的改动丢掉了（回到已存的）');
                    rerender();
                    break;
                }
                case 'list-entries': {
                    const name = id;
                    // ⭐ 记住"正在看哪本书"，重画之后自动摆回来
                    //    （⛔ 不然她点一条之后列表就没了，没法接着点第二条）
                    pickBook = trimText(name);
                    const entries = await getEntries(name);
                    pickEntries = entries;
                    const note = byId(host, 'wxg-entnote');
                    const wrap = byId(host, 'wxg-entpick');
                    if (!note) {
                        break;
                    }
                    if (!entries.length) {
                        note.textContent = '「' + name + '」里没读到条目（或这本没开）。';
                        break;
                    }
                    const off = toList(getSettings().excludeEntries);
                    note.textContent = '「' + name + '」共 ' + String(entries.length)
                        + ' 条：点一下＝不读这一条（点过的不参与推演）；⛔ 不改你的世界书。';
                    if (wrap) {
                        const head = wrap.querySelector('.wxg-pick-head');
                        while (wrap.firstChild) {
                            wrap.removeChild(wrap.firstChild);
                        }
                        if (head) {
                            wrap.appendChild(head);
                        }
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
                case 'toggle-entry': {
                    const title = trimText(target.getAttribute('data-entry'));
                    if (!title) {
                        break;
                    }
                    // ⭐ 同样只改"待保存"缓冲（她拍的：别点一下就生效、面板别跳）
                    const off = toList(stagedValue('extract', 'excludeEntries', getSettings().excludeEntries));
                    const i = off.findIndex((x) => asText(x) === asText(title));
                    if (i >= 0) {
                        off.splice(i, 1);
                        toast.ok('「' + title + '」恢复参与（还没保存）');
                    } else {
                        off.push(title);
                        toast.info('「' + title + '」标成"不读"（还没保存）');
                    }
                    // ⭐ 进这一段的草稿（等段底那颗保存一起存）
                    stage('extract', 'excludeEntries', off.join('、'));
                    renderEntryPick(host, off);
                    refreshSaveBar(host, 'extract');
                    break;
                }
                case 'detect-dupes': {
                    const dupes = autoDetectDuplicates();
                    const box = byId(host, 'wxg-book-list');
                    if (!dupes.length) {
                        toast.ok('没发现疑似重复的记录');
                        if (box) {
                            box.textContent = '';
                        }
                    } else {
                        toast.info('发现 ' + String(dupes.length) + ' 组疑似重复');
                        if (box) {
                            box.textContent = '疑似重复：' + dupes.map((d) => d.map((x) => x.name).join(' ⇄ ')).join(' ｜ ')
                                + '（用「按这条合并…」处理）';
                        }
                    }
                    break;
                }
                case 'export-data':
                    downloadText('万象阁备份-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify(exportState(), null, 2));
                    toast.ok('备份已导出');
                    break;

                /* ---- 召回 ---- */
                case 'stage-recent-turns': if (isChange) { patchSettings({ recentTurns: target.value }); rerender(); } break;
                case 'stage-max-chars': if (isChange) { patchSettings({ maxChars: target.value }); rerender(); } break;
                case 'stage-max-events': if (isChange) { patchSettings({ maxEvents: target.value }); rerender(); } break;
                case 'stage-past-floor-cut': if (isChange) { patchSettings({ pastFloorCut: target.value }); rerender(); } break;
                /* ---- 外观（我们自己的配色） ---- */
                case 'set-appearance': {
                    if (!isChange) {
                        break;
                    }
                    const key = target.id;   // wxg-app-xxx → 槽位名
                    const slot = key.replace('wxg-app-', '');
                    const patch = {};
                    if (slot === 'palette') {
                        Object.assign(patch, palettePatch(trimText(target.value)));
                    } else {
                        patch[slot] = trimText(target.value);
                        // 手改了槽位 ⇒ 色板显示为"自定义"（⛔ 不假装还是预设）
                        patch.palette = 'custom';
                    }
                    patchSettings({ appearance: Object.assign({}, getSettings().appearance || {}, patch) });
                    toast.ok('配色已更新' + (slot === 'palette' ? '' : '（已标为「自定义」）'));
                    rerender();
                    break;
                }
                case 'reset-appearance': {
                    patchSettings({ appearance: Object.assign({}, getSettings().appearance || {}, palettePatch(trimText(getSettings().appearance && getSettings().appearance.palette))) });
                    toast.ok('已退回所选色板');
                    rerender();
                    break;
                }
                case 'set-app-to-panel':
                    patchSettings({ appearance: Object.assign({}, getSettings().appearance || {}, { applyToPanel: target.checked }) });
                    toast.ok(target.checked ? '浮层与小框也跟着这套配色' : '浮层与小框改为跟随酒馆主题');
                    rerender();
                    break;
                case 'set-layout-mode':
                    patchSettings({ layoutMode: trimText(target.value) === 'panel' ? 'panel' : 'workspace' });
                    toast.ok(trimText(target.value) === 'panel' ? '以后点入口＝开浮层面板' : '以后点入口＝开整页工作台');
                    rerender();
                    break;
                /* ---- 任务（主线／支线）：她也能改 ---- */
                case 'set-quest-status': {
                    if (!isChange) {
                        break;
                    }
                    const title = target.getAttribute('data-title') || '';
                    updateQuest(id, title, { status: trimText(target.value) });
                    toast.ok('任务状态改成「' + trimText(target.value) + '」了');
                    rerender();
                    break;
                }
                case 'del-quest': {
                    const title = target.getAttribute('data-title') || '';
                    if (removeQuest(id, title)) {
                        addChronicle({ floor: -1, kind: '任务·手动删除', who: '', text: title });
                        toast.ok('任务删掉了（已在编年里留痕）');
                    }
                    rerender();
                    break;
                }
                case 'set-sort-mode': if (isChange) { patchSettings({ sortMode: target.value }); rerender(); } break;
                case 'stage-max-parallel': if (isChange) { patchSettings({ maxParallelChars: target.value }); rerender(); } break;

                /* ---- 四格 ---- */
                /* ⭐ 先进草稿（等段底那颗「保存这一段」一起存），⛔ 不再改一处存一处 */




                case 'set-extract-tags': if (isChange) { patchSettings({ extractTags: target.value }); toast.ok('提取标签已保存'); } break;
                case 'set-exclude-tags': if (isChange) { patchSettings({ excludeTags: target.value }); toast.ok('排除标签已保存'); } break;
                case 'set-extract-books': if (isChange) { patchSettings({ extractBooks: target.value }); toast.ok('提取世界书已保存'); } break;
                case 'set-exclude-books': if (isChange) { patchSettings({ excludeBooks: target.value }); toast.ok('排除世界书已保存'); } break;
                case 'set-affinity-source': if (isChange) { patchSettings({ affinitySource: target.value }); toast.ok('好感数据源已保存'); } break;
                case 'set-strip-paired':
                    patchSettings({ stripPairedBlocks: target.checked });
                    toast.ok(target.checked ? '会按结构剥掉成对的机器块' : '不再按结构剥（只用你点名的排除标签）');
                    break;
                case 'set-strip-comments':
                    patchSettings({ stripHtmlComments: target.checked });
                    toast.ok(target.checked ? '会剥掉 HTML 注释' : '不再剥 HTML 注释');
                    break;
                case 'set-only-enabled':
                    patchSettings({ onlyEnabledEntries: target.checked });
                    toast.ok(target.checked ? '只读开启着的条目' : '连关掉的条目也一起读');
                    break;

                /* ---- API ---- */
                case 'set-api-mode': if (isChange) { patchApi({ mode: target.value }); rerender(); } break;
                case 'set-api-url': if (isChange) { patchApi({ url: target.value }); toast.ok('接口地址已保存'); } break;
                case 'set-api-key': if (isChange) { patchApi({ key: target.value }); toast.ok('密钥已保存'); } break;
                case 'set-api-model': if (isChange) { patchApi({ model: target.value }); toast.ok('模型名已保存'); } break;
                case 'set-api-model-cheap': if (isChange) { patchApi({ modelCheap: target.value }); } break;
                case 'set-api-temp': if (isChange) { patchApi({ temperature: target.value }); } break;
                case 'set-api-maxtok': if (isChange) { patchApi({ maxTokens: target.value }); } break;
                case 'test-api': {
                    toast.info('正在测连接…');
                    const res = await testApi();
                    if (res.ok) {
                        toast.ok('连接通了：' + res.note);
                    } else {
                        toast.fail('没通：' + res.note);
                    }
                    break;
                }

                /* ---- ⭐ API 书签（她点名要的：设好几套通道随时切） ---- */
                case 'save-profile':
                case 'overwrite-profile': {
                    const nick = trimText(textOf(host, 'wxg-profile-nick'));
                    if (!nick) {
                        toast.fail('先给书签起个名字（例：主站／备用站）');
                        break;
                    }
                    // ⭐ 存书签时把**这一段草稿里的改动也算上**（地址刚改、还没按保存也能存进书签）
                    // ⚠️ 顺序要紧：**先**把 one 和 list 算好、**再** commitSection ——
                    //    commitSection 会把草稿删掉，反过来写就只能拿到空的（这个坑真踩过）。
                    const live = getSettings().api || {};
                    const draft = staging.api || {};
                    // ⚠️ 草稿里的 profiles 是**打开面板那一刻的旧值**（甚至空的）
                    //    ⇒ 合并时不许认它，否则会把刚存的书签冲掉。书签只认设置里那一份。
                    const cur = Object.assign({}, live, draft);
                    delete cur.profiles;
                    const one = {
                        nick,
                        mode: cur.mode,
                        url: trimText(cur.url),
                        key: trimText(cur.key),
                        model: trimText(cur.model),
                        modelCheap: trimText(cur.modelCheap),
                        temperature: Number(cur.temperature),
                        maxTokens: Number(cur.maxTokens),
                        at: Date.now(),
                    };
                    const list = (Array.isArray(live.profiles) ? live.profiles : []).slice();
                    const idx = list.findIndex((p) => trimText(p && p.nick) === nick);
                    /*
                     * ⭐ 同名＝更新那一条（她改完地址再存同名，本来就想把这条更新掉）。
                     *    以前这里拦下来让她去点另一颗「覆盖同名书签」——太绕，去掉那颗按钮了。
                     *    ⛔ 仍然不会"悄悄多出一条"。
                     */
                    if (idx >= 0) {
                        list[idx] = one;
                    } else {
                        list.push(one);
                    }
                    /*
                     * ⚠️ 存书签**只存书签**：⛔ 不顺手把草稿落盘。
                     *    否则"当前用的通道"会被悄悄改掉（她只是想把这一套存起来，未必想现在就用）。
                     *    想让它当当前通道 ⇒ 明确点「切到这套」。
                     */
                    // ⚠️ 落盘要用**当下**的 api（`live` 是重画前取的快照，profiles 可能还旧）
                    patchSettings({ api: Object.assign({}, getSettings().api || {}, { profiles: list }) });
                    const pendingN = stagedCount('api');
                    toast.ok((idx >= 0 ? '已覆盖书签「' : '已存成书签「') + nick + '」（存的这一套'
                        + (pendingN ? '；上方还有 ' + String(pendingN) + ' 处没保存的改动' : '')
                        + '，想现在就用它请点「切到这套」）');
                    rerender();
                    break;
                }
                case 'apply-profile': {
                    const nick = id;
                    const cur = getSettings().api || {};
                    const one = (Array.isArray(cur.profiles) ? cur.profiles : []).find((p) => trimText(p && p.nick) === nick);
                    if (!one) {
                        toast.fail('找不到书签「' + nick + '」');
                        break;
                    }
                    patchSettings({
                        api: Object.assign({}, cur, {
                            mode: one.mode,
                            url: one.url,
                            key: one.key,
                            model: one.model,
                            modelCheap: one.modelCheap,
                            temperature: one.temperature,
                            maxTokens: one.maxTokens,
                        }),
                    });
                    toast.ok('已切到书签「' + nick + '」');
                    rerender();
                    break;
                }
                case 'del-profile': {
                    const nick = id;
                    const cur = getSettings().api || {};
                    const list = (Array.isArray(cur.profiles) ? cur.profiles : [])
                        .filter((p) => trimText(p && p.nick) !== nick);
                    patchSettings({ api: Object.assign({}, cur, { profiles: list }) });
                    toast.ok('删掉书签「' + nick + '」了');
                    rerender();
                    break;
                }

                /* ---- 提示词 ---- */
                case 'set-inject-header': if (isChange) { patchSettings({ injectHeader: target.value }); toast.ok('保存了'); } break;
                case 'set-prompt-world': if (isChange) { patchSettings({ promptWorld: target.value }); toast.ok('保存了'); } break;
                case 'set-prompt-chars': if (isChange) { patchSettings({ promptChars: target.value }); toast.ok('保存了'); } break;
                case 'set-jailbreak':
                    if (isChange) {
                        patchSettings({ jailbreak: target.value });
                        toast.ok(trimText(target.value) ? '破限词保存了' : '破限词清空了，会用内置那份');
                    }
                    break;
                case 'show-jailbreak': {
                    const box = byId(host, 'wxg-jailbreak-view');
                    if (box) {
                        box.style.display = box.style.display === 'none' ? 'block' : 'none';
                    }
                    break;
                }
                case 'reset-prompts':
                    setAllPromptsDefault();
                    toast.ok('三套提示词都恢复成内置默认了');
                    rerender();
                    break;

                /* ---- 动作 ---- */
                case 'update-now':
                    runUpdate({ manual: true });
                    toast.info('开始更新世界与角色状态（后台跑，不挡你聊天）');
                    rerender();
                    break;
                case 'cancel-update':
                    cancelUpdate();
                    toast.warn('已请求取消：跑完当前这一小步就停');
                    rerender();
                    break;
                case 'rollback': {
                    const snap = rollbackLast();
                    toast.ok(snap ? '已撤回上一次更新（撤回前那一版也留着，能再撤回来）' : '没有可撤回的版本');
                    rerender();
                    break;
                }
                case 'replan':
                    replanCurrentFloor();
                    toast.info('本楼重新算好了');
                    break;
                case 'reconcile': {
                    const res = runReconcile();
                    toast.ok('对账完成：清了 ' + String(res.removed) + ' 条对不上的账' + (res.note ? '（' + res.note + '）' : ''));
                    rerender();
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
                case 'backfill': {
                    const { runBackfill } = await import('../core/pipeline.js');
                    runBackfill();
                    toast.info('开始补推历史（分批跑，可随时取消）');
                    rerender();
                    break;
                }
                case 'copy-text': {
                    const holderId = target.getAttribute('data-id');
                    const holder = holderId ? byId(host, 'wxg-text-' + holderId) : null;
                    if (holder) {
                        copyToClipboard(holder.textContent, target);
                    }
                    break;
                }
                default:
                    break;
            }
        } catch (err) {
            console.warn('[万象阁] 面板操作出错：', err);
            toast.fail('操作出错：' + (err && err.message ? err.message : String(err)));
        }
    };

    host.addEventListener('click', handler);
    host.addEventListener('change', handler);
    // ⭐ 角色搜索要"边打边筛"：只切显示、⛔ 不重画
    //    （重画会把她正在打的字和滚动位置全弄没）
    host.addEventListener('input', (e) => {
        const t = e && e.target;
        if (!t || typeof t.getAttribute !== 'function') {
            return;
        }
        if (t.getAttribute('data-live-action') === 'char-search') {
            charSearch.query = asText(t.value);
            applyCharSearch(host, charSearch.query);
        }
    });
}
