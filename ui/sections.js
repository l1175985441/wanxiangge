/**
 * 万象阁 · 面板内容（一份内容，两处使用）
 *
 * 同一套分节既渲染进**独立面板**（ui/shell.js 开的窗口），也渲染进**扩展设置区**里那一块。
 * ⛔ 不各写一套，免得两边长歪。
 * 事件一律**委托**绑在宿主上：每次重画都不丢监听，也不会重复绑。
 */

import {
    ROSTER_PRESET, STAGES_CONFLICT, STAGES_PROGRESS, DEFAULT_JAILBREAK,
} from '../core/config.js';
import { storageReport, formatStamp } from '../core/adapter.js';
import { getSettings, patchSettings, effectivePrompt, setAllPromptsDefault } from '../core/settings.js';
import {
    getRoster, loadState, addCharacter, addCharacters, removeCharacter, updateCharacter,
    applyRosterPreset, describeRoster, describeWorld, recentRecallRecords, getChronicle,
    removeHidden, addHiddenManually, rollbackLast, snapshotCount, exportState, updateWorld,
} from '../core/state.js';
import { receiptText, ledgerText } from '../core/ledger.js';
import { toList, trimText, asText, countChars } from '../core/utils.js';
import { replanCurrentFloor } from '../core/actions.js';
import { listWorldbookNames, collectPeopleFromBook } from '../core/worldbook.js';
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

function section(title, hint) {
    const box = el('section', 'wxg-sec');
    box.appendChild(el('h4', null, title));
    if (hint) {
        box.appendChild(el('div', 'wxg-note', hint));
    }
    return box;
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

function textInput(id, value, placeholder, action, cls) {
    const input = document.createElement('input');
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
    const box = section('账本状态');
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
        row(box,
            p.status === 'running' ? button('取消这次更新', 'cancel-update') : null,
            p.status === 'failed' ? button('重试（有上限）', 'update-now') : null);
    }
    host.appendChild(box);
}

function secGeneral(host) {
    const s = getSettings();
    const box = section('总控');
    box.appendChild(checkbox('wxg-enabled', '启用万象阁', s.enabled, 'set-enabled'));
    box.appendChild(checkbox('wxg-card-enabled', '在你每条发言后面显示召回卡片', s.cardEnabled, 'set-card'));
    box.appendChild(checkbox('wxg-show-empty', '没有召回时也显示空态卡片', s.showEmptyCard, 'set-show-empty'));
    box.appendChild(checkbox('wxg-panel-open', '打开酒馆时自动弹出面板', s.showPanelOnStart, 'set-panel-on-start'));
    box.appendChild(checkbox('wxg-protected', '现场保护：正文刚演过的人，本轮只带状态、不重复推演', s.protectedBypass, 'set-protected'));
    box.appendChild(checkbox('wxg-strict', '严格模式：只带本轮点名的人', s.strictMention, 'set-strict'));
    box.appendChild(checkbox('wxg-auto-update', '新楼生成后自动更新（关掉＝只手动更新）', s.autoUpdate, 'set-auto-update'));
    row(box,
        el('span', 'wxg-note', '频率：每'),
        numberInput('wxg-update-every', s.updateEvery, 1, 10, 'set-update-every'),
        el('span', 'wxg-note', '回合更新一次（1＝每回合都在动；2＝两格停在上一轮）'));
    host.appendChild(box);
}

function secWorld(host) {
    const state = loadState();
    const w = state.world;
    const box = section('世界状态',
        '世界局势＝势力的所有碰撞；暗线＝还没浮上台面的事，按阶段走、挂世界钟（⛔ 不按回合数推，世界钟没到点不许提前冒头）。');

    row(box,
        el('span', 'wxg-note', '世界钟'),
        textInput('wxg-world-clock', w.clock, '例：第二天 上午 10:20（读不出来写未知）', 'set-world-clock', 'wxg-short'),
        el('span', 'wxg-note', '地点'),
        textInput('wxg-world-place', w.place, '例：四夷馆', 'set-world-place', 'wxg-short'));
    box.appendChild(textarea('wxg-world-big', w.bigPicture, '从高处看一眼：这个世界现在什么样', 'set-world-big', 3));

    box.appendChild(el('div', 'wxg-report-h', '局势（势力的碰撞）'));
    const sit = el('div', 'wxg-list');
    if (!w.situations.length) {
        sit.appendChild(el('div', 'wxg-empty', '还没有局势记录（点「立刻更新」让引擎算一次）'));
    } else {
        for (const item of w.situations) {
            const r = el('div', 'wxg-rowitem');
            r.appendChild(el('div', 'wxg-rowname', trimText(item.title) || '（未记名）'));
            const bits = [];
            if (trimText(item.sides)) {
                bits.push('各方：' + trimText(item.sides));
            }
            if (trimText(item.tier)) {
                bits.push('火候：' + trimText(item.tier));
            }
            if (bits.length) {
                r.appendChild(el('div', 'wxg-fact', bits.join(' ｜ ')));
            }
            sit.appendChild(r);
        }
    }
    box.appendChild(sit);

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
            head.appendChild(button('删', 'del-hidden', 'wxg-mini', h.id));
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
        textInput('wxg-new-hidden-trigger', '', '挂在什么时间／条件（例：晚上）', 'noop', 'wxg-short'),
        button('加一条暗线', 'add-hidden'));
    host.appendChild(box);
}

function secCharacters(host) {
    const state = loadState();
    const box = section('角色状态',
        '每人七格：年龄／身份／过去经历／正在经历／所在势力／好感／时间・地点。'
        + '内容可以直接改字；改过的会显示「已手动修改」，下一轮更新⛔ 不许冲掉。');

    if (!state.characters.length) {
        box.appendChild(el('div', 'wxg-empty', '名册还是空的：下面「人物名册」里加人，或点「一键盘入预设名册」。'));
        host.appendChild(box);
        return;
    }

    for (const c of state.characters) {
        const det = foldable(trimText(c.name)
            + (c.isPlayer ? '（玩家棋子）' : '')
            + (trimText(c.identity) ? ' · ' + trimText(c.identity) : '')
            + (trimText(c.affinity) ? ' · 好感 ' + trimText(c.affinity) : ' · 好感未接'), false);
        const body = el('div', 'wxg-report-body');
        const grid = el('div', 'wxg-grid');

        const field = (label, key, value, placeholder) => {
            const f = el('div', 'wxg-field');
            f.appendChild(el('label', null, label));
            const input = textInput('wxg-c-' + key + '-' + c.id, value, placeholder, 'set-char-field', 'wxg-short');
            input.setAttribute('data-id', c.id);
            input.setAttribute('data-key', key);
            f.appendChild(input);
            return f;
        };
        grid.appendChild(field('年龄', 'age', c.age, ''));
        grid.appendChild(field('身份', 'identity', c.identity, ''));
        grid.appendChild(field('所在势力', 'faction', c.faction, ''));
        grid.appendChild(field('好感（读自"手机"）', 'affinity', c.affinity, '未接入就留空'));
        grid.appendChild(field('时间・地点', 'timePlace', c.timePlace, '例：第二天 上午 · 学校'));
        body.appendChild(grid);

        const cur = el('div', 'wxg-field');
        cur.appendChild(el('label', null, '正在经历'));
        const curInput = textarea('wxg-c-current-' + c.id, c.current, '本回合正在发生的事（只写这一步、只写他自己）', 'set-char-field', 2);
        curInput.setAttribute('data-id', c.id);
        curInput.setAttribute('data-key', 'current');
        cur.appendChild(curInput);
        body.appendChild(cur);

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
        body.appendChild(past);

        const infer = el('div', 'wxg-field');
        infer.appendChild(el('label', null, '推断（与事实分开）'));
        const inferInput = textarea('wxg-c-infer-' + c.id, c.infer, '为什么这样／可能会怎样——只作为推断，⛔ 不当事实', 'set-char-field', 2);
        inferInput.setAttribute('data-id', c.id);
        inferInput.setAttribute('data-key', 'infer');
        infer.appendChild(inferInput);
        body.appendChild(infer);

        if (c.schedule.length) {
            const sch = el('div', 'wxg-field');
            sch.appendChild(el('label', null, '日程（到点要跟上）'));
            const schBox = el('div', 'wxg-list');
            for (const s of c.schedule) {
                schBox.appendChild(el('div', 'wxg-fact', '· ' + s.what + (s.due ? '（' + s.due + '）' : '') + (s.done ? ' ✓已到' : '')));
            }
            sch.appendChild(schBox);
            body.appendChild(sch);
        }

        const badges = el('div', 'wxg-row');
        if (c.manual) {
            badges.appendChild(el('span', 'wxg-badge wxg-badge-soft', '已手动修改'));
        }
        if (c.isNew) {
            badges.appendChild(el('span', 'wxg-badge wxg-badge-soft', '新认的人'));
        }
        if (c.inScene) {
            badges.appendChild(el('span', 'wxg-badge wxg-badge-soft', '本轮在现场'));
        }
        badges.appendChild(button('按这条合并…', 'merge-into', 'wxg-mini', c.id));
        if (c.isNew) {
            badges.appendChild(button('名字对，收下', 'accept-new', 'wxg-mini', c.id));
            badges.appendChild(button('忽略这条', 'ignore-char', 'wxg-mini', c.id));
        }
        body.appendChild(badges);

        det.appendChild(body);
        box.appendChild(det);
    }
    host.appendChild(box);
}

function secChronicle(host) {
    const list = getChronicle();
    const box = section('编年',
        '每回合推演出来的东西**全部按时间攒在这里**（过去经历／正在经历是滚动更新的，旧的只有这儿能回看）。'
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
            line.appendChild(el('span', 'wxg-report-floor', '第 ' + String(c.floor + 1) + ' 楼'));
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
        '名册按聊天各分各的（开新档＝新世界，数据不串）。别名表由你自己维护——正文里叫昵称也能召回上。');
    const d = describeRoster();
    box.appendChild(el('div', 'wxg-note', d.total
        ? '现有 ' + String(d.total) + ' 人' + (d.players ? '（其中玩家棋子 ' + String(d.players) + ' 人）' : '')
        : '还没有人物。'));

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
        actions.appendChild(button('删除', 'del-char', 'wxg-mini', c.id));
        r.appendChild(actions);

        list.appendChild(r);
    }
    box.appendChild(list);
    host.appendChild(box);
}

function secRecall(host) {
    const s = getSettings();
    const box = section('召回',
        '她发消息时当场算一次"这轮该带什么"：好感必带；世界与平行事件按她最新发言的相关度筛，相关的进、其余排后台。');
    row(box,
        el('span', 'wxg-note', '线索回溯'),
        numberInput('wxg-recent-turns', s.recentTurns, 1, 10, 'set-recent-turns'),
        el('span', 'wxg-note', '楼 ｜ 人物封顶'),
        numberInput('wxg-max-chars', s.maxChars, 1, 8, 'set-max-chars'),
        el('span', 'wxg-note', '｜ 事件封顶'),
        numberInput('wxg-max-events', s.maxEvents, 0, 20, 'set-max-events'));
    row(box,
        el('span', 'wxg-note', '排序'),
        select('wxg-sort-mode', [
            { value: 'related', label: '按相关度（先说到的排前面）' },
            { value: 'name', label: '按名册顺序' },
        ], s.sortMode, 'set-sort-mode'));
    row(box,
        el('span', 'wxg-note', '一轮最多推演'),
        numberInput('wxg-max-parallel', s.maxParallelChars, 0, 12, 'set-max-parallel'),
        el('span', 'wxg-note', '个不在场的角色（省额度：其余下一轮轮转）'));
    host.appendChild(box);
}

function secExtract(host) {
    const s = getSettings();
    const box = section('读取控制（提取／排除四格）',
        '四格改完即时保存，刷新、重开都在。默认按结构剥掉成对的机器块与 HTML 注释——剥完为空会自动退回原文，⛔ 不会比剥之前更坏。');
    row(box, el('span', 'wxg-note', '提取标签'), textInput('wxg-extract-tags', s.extractTags, '例：正文, content', 'set-extract-tags', 'wxg-short'));
    row(box, el('span', 'wxg-note', '排除标签'), textInput('wxg-exclude-tags', s.excludeTags, '例：状态栏, 变量（留空＝只按结构剥）', 'set-exclude-tags', 'wxg-short'));
    box.appendChild(checkbox('wxg-strip-paired', '按结构剥掉成对的机器块（配对的开闭标签，整块剥）', s.stripPairedBlocks, 'set-strip-paired'));
    box.appendChild(checkbox('wxg-strip-comments', '剥掉 HTML 注释（<!-- … -->）', s.stripHtmlComments, 'set-strip-comments'));
    row(box, el('span', 'wxg-note', '提取世界书'), textInput('wxg-extract-books', s.extractBooks, '读哪些世界书（逗号分开；留空＝角色卡绑定那本）', 'set-extract-books', 'wxg-short'));
    row(box, el('span', 'wxg-note', '排除世界书'), textInput('wxg-exclude-books', s.excludeBooks, '哪些世界书不读、不参与', 'set-exclude-books', 'wxg-short'));
    box.appendChild(checkbox('wxg-only-enabled', '只读开启着的条目（不选世界书时＝角色卡绑定世界里开启的条目）', s.onlyEnabledEntries, 'set-only-enabled'));
    row(box, el('span', 'wxg-note', '"手机"好感的数据源（世界书名或条目关键词；留空＝不接，界面如实写"未接入"）'),
        textInput('wxg-affinity-source', s.affinitySource, '例：手机 或 关系表', 'set-affinity-source', 'wxg-short'));
    host.appendChild(box);
}

function secApi(host) {
    const s = getSettings();
    const api = s.api || {};
    const box = section('自定义 API（后台推演走这条通道）',
        '⛔ 不锁死在酒馆默认连接上。云酒馆建议「经酒馆服务器转发」——密钥留在服务器侧，也绕开跨域。');
    row(box, el('span', 'wxg-note', '连接方式'), select('wxg-api-mode', [
        { value: 'proxy', label: '经酒馆服务器转发（云酒馆最稳）' },
        { value: 'direct', label: '直连（浏览器直接请求）' },
    ], api.mode, 'set-api-mode'));
    row(box, el('span', 'wxg-note', '接口地址'), textInput('wxg-api-url', api.url, 'https://…/v1', 'set-api-url', 'wxg-short'));
    row(box, el('span', 'wxg-note', '密钥'), textInput('wxg-api-key', api.key, 'sk-…', 'set-api-key', 'wxg-short'));
    row(box, el('span', 'wxg-note', '推演模型'), textInput('wxg-api-model', api.model, '例：gemini-3.8-flash', 'set-api-model', 'wxg-short'));
    row(box, el('span', 'wxg-note', '打杂模型（留空＝同上）'), textInput('wxg-api-model-cheap', api.modelCheap, '便宜的模型', 'set-api-model-cheap', 'wxg-short'));
    row(box,
        el('span', 'wxg-note', '温度'), numberInput('wxg-api-temp-code', api.temperature, 0, 2, 'set-api-temp'),
        el('span', 'wxg-note', '单次最多输出'), numberInput('wxg-api-maxtok', api.maxTokens, 200, 8000, 'set-api-maxtok'));
    row(box, button('测一下连接', 'test-api'), el('span', 'wxg-note', '（只发一句很短的话，验证地址／密钥／模型对不对）'));
    host.appendChild(box);
}

function secPrompts(host) {
    const s = getSettings();
    const box = section('提示词（可看可改）',
        '留空＝用内置默认；填了＝原样用你写的。破限词同理：留空＝内置那份，填了＝整段替换。');
    box.appendChild(el('div', 'wxg-report-h', '注入块开头那句'));
    box.appendChild(textarea('wxg-inject-header', s.injectHeader, '', 'set-inject-header', 3));
    box.appendChild(el('div', 'wxg-report-h', '世界推演提示词'));
    box.appendChild(textarea('wxg-prompt-world', s.promptWorld, '（留空＝用内置）', 'set-prompt-world', 6));
    box.appendChild(el('div', 'wxg-report-h', '角色状态／平行事件提示词'));
    box.appendChild(textarea('wxg-prompt-chars', s.promptChars, '（留空＝用内置）', 'set-prompt-chars', 6));
    box.appendChild(el('div', 'wxg-report-h', '破限词'));
    box.appendChild(textarea('wxg-jailbreak', s.jailbreak, '（留空＝用内置那份）', 'set-jailbreak', 4));
    row(box, button('看内置破限词', 'show-jailbreak'), button('全部恢复内置默认', 'reset-prompts'));
    const view = el('pre', 'wxg-report-text', DEFAULT_JAILBREAK);
    view.id = 'wxg-jailbreak-view';
    view.style.display = 'none';
    box.appendChild(view);
    const worldView = el('pre', 'wxg-report-text', effectivePrompt('world'));
    worldView.id = 'wxg-prompt-world-view';
    worldView.style.display = 'none';
    box.appendChild(worldView);
    host.appendChild(box);
}

function secReport(host) {
    const list = recentRecallRecords(20);
    const box = section('过程报告 · 每轮到底注入了什么',
        '按时间从新到旧：① 怎么挑的 ② 实际送进请求的内容一字不差（可复制）③ 回执（成没成、多少字、什么身份、为什么没注入）。');
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
        const det = foldable(formatStamp(rec.at) + ' · 第 ' + String((rec.floor || 0) + 1) + ' 楼 · ' + statusText
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

        body.appendChild(el('div', 'wxg-report-h', '② 实际送进请求的内容'));
        const text = trimText(rec.injectedText);
        if (text) {
            body.appendChild(el('pre', 'wxg-report-text', text));
            const bar = el('div', 'wxg-row');
            const key = 'rec-' + String(rec.floor) + '-' + String(rec.at);
            bar.appendChild(button('复制这段', 'copy-text', 'wxg-mini', key));
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
    const box = section('现在的进度');
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
    secStatus(host);
    secWorld(host);
    secCharacters(host);
    secChronicle(host);
    secReport(host);
    secRoster(host);
    secGeneral(host);
    secRecall(host);
    secExtract(host);
    secApi(host);
    secPrompts(host);
    secSteps(host);
}

function textOf(id) {
    const node = document.getElementById(id);
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

                /* ---- 世界状态 ---- */
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
                    const name = textOf('wxg-new-hidden');
                    if (!trimText(name)) {
                        toast.warn('先写个暗线名字');
                        break;
                    }
                    addHiddenManually({ name, trigger: textOf('wxg-new-hidden-trigger'), stage: '萌芽', kind: 'conflict', tier: '几天内' });
                    toast.ok('暗线加上了');
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
                    const name = trimText(textOf('wxg-new-name'));
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
                    const added = addCharacters(textOf('wxg-import-roster'), { manual: true });
                    toast.ok(added ? '导入 ' + String(added) + ' 人' : '这些名字名册里已经有了');
                    rerender();
                    break;
                }
                case 'read-book': {
                    const res = await readFromBook(trimText(textOf('wxg-book-name')));
                    if (res) {
                        toast.ok('从世界书认出 ' + String(res.added) + ' 人（跳过 ' + String(res.skipped) + ' 条不认的）');
                    }
                    rerender();
                    break;
                }
                case 'list-books': {
                    const names = await listWorldbookNames();
                    const box = document.getElementById('wxg-book-list');
                    if (box) {
                        box.textContent = names.length
                            ? '现有世界书：' + names.join(' ｜ ')
                            : '没读到世界书列表（可能这个酒馆版本没开这个接口；可以手填书名）';
                    }
                    break;
                }
                case 'detect-dupes': {
                    const dupes = autoDetectDuplicates();
                    const box = document.getElementById('wxg-book-list');
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
                case 'set-recent-turns': if (isChange) { patchSettings({ recentTurns: target.value }); rerender(); } break;
                case 'set-max-chars': if (isChange) { patchSettings({ maxChars: target.value }); rerender(); } break;
                case 'set-max-events': if (isChange) { patchSettings({ maxEvents: target.value }); rerender(); } break;
                case 'set-sort-mode': if (isChange) { patchSettings({ sortMode: target.value }); rerender(); } break;
                case 'set-max-parallel': if (isChange) { patchSettings({ maxParallelChars: target.value }); rerender(); } break;

                /* ---- 四格 ---- */
                case 'set-extract-tags': if (isChange) { patchSettings({ extractTags: target.value }); toast.ok('提取标签已保存'); } break;
                case 'set-exclude-tags': if (isChange) { patchSettings({ excludeTags: target.value }); toast.ok('排除标签已保存'); } break;
                case 'set-extract-books': if (isChange) { patchSettings({ extractBooks: target.value }); toast.ok('提取世界书已保存'); } break;
                case 'set-exclude-books': if (isChange) { patchSettings({ excludeBooks: target.value }); toast.ok('排除世界书已保存'); } break;
                case 'set-affinity-source': if (isChange) { patchSettings({ affinitySource: target.value }); toast.ok('好感数据源已保存'); } break;
                case 'set-strip-paired': patchSettings({ stripPairedBlocks: target.checked }); break;
                case 'set-strip-comments': patchSettings({ stripHtmlComments: target.checked }); break;
                case 'set-only-enabled': patchSettings({ onlyEnabledEntries: target.checked }); break;

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
                    const box = document.getElementById('wxg-jailbreak-view');
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
                    const holder = holderId ? document.getElementById('wxg-text-' + holderId) : null;
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
}
