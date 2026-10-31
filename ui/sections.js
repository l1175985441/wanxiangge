/**
 *
 * 同一套分节既渲染进**独立面板**（ui/shell.js 开的窗口），也渲染进**扩展设置区**里那一块。
 * ⛔ 不各写一套，免得两边长歪。
 * 事件一律**委托**绑在宿主上：每次重画都不丢监听，也不会重复绑。
 */

import {
    STAGES_CONFLICT, STAGES_PROGRESS, TIERS, ROSTER_PRESET,
} from '../core/config.js';
import { expandPair, stateLine } from './controls-note.js';   /* 六：全展全收；八：开关状态句 */
import { rememberFocus, restoreFocus } from './focus-keep.js';   /* 三：重画后把焦点还回去 */
import { markOneCol } from './onecol.js';
import { statusHero } from './status-hero.js';
import { foldStore, foldReport } from './status-folds.js';
import { foldCard, cardLine, statusCardLine } from './card-fold.js';
import { tidyHeadings, tidyText, titleNode, sanitizeTech } from './tidy-heads.js';   /* 75/77：标题与折叠条去括号（造的当下） */   /* 74/75：卡头三层＋一句话 */   /* 71：两条折叠 */
import { stageProgress, stageTone } from './stage-progress.js';   /* 阶段：数字进度＋徽章调子 */   /* 一：单卡页标记 */
import { purposeOf, promptVarRows } from './prompt-copy.js';   /* 17-1／17-2：用途副标与变量清单 */
import { renderRunWarn } from './runwarn-view.js';   /* 必修 9：红条画法 */
import { makeChronSearch } from './chron-search.js';   /* A4：编年搜索框 */
import { bindEscClose, unbindEscClose } from './esc-close.js';   /* TW 契约：Esc 监听配对清理 */
import { runWarning } from '../core/runwarn.js';   /* 必修 9：拒签要顶到上面（红条） */
import { humanStamp } from '../core/timefmt.js';   /* A7／A9：时间人话只留一处 */
import { storageReport, formatStamp, getChat, currentChatKey, adoptLedgerForImport } from '../core/adapter.js';
import { buildBundle, verifyBundle, importGate } from '../core/bundle.js';
import { getSettings, patchSettings, effectivePrompt, setAllPromptsDefault, exportSettings } from '../core/settings.js';
import {
    getRoster, loadState, saveState, addCharacter, addCharacters, removeCharacter, updateCharacter, findCharacterByName,
    findCharacter,
    applyRosterPreset, describeRoster, describeWorld, recentRecallRecords, getChronicle,
    removeHidden, addHiddenManually, rollbackLast, exportState, updateWorld,
    updateQuest, removeQuest, addChronicle,
    removeChronicleAt, clearChronicle, clearWorldLedger, ledgerClearPreview,
    addKnow, removeKnow, importState, pushPast, listWindsView, ROLES, setRole, listSnapshots, rollbackToSnapshot,
    overlayPending, acceptOverlay, dismissOverlay, removeFaction, upsertSituation, removeSituation, upsertFaction} from '../core/state.js';
import { createCache, isBroken } from '../core/cache.js';   /* B7：缓存坏了，⛔ 当成“没有” */
import { listPresets, describePreset, buildPreset, planApply, exportPresets, importPresets } from '../core/preset.js';   /* 4-a E3：提示词预设 */
import { tallyLine } from '../core/tally.js';   /* F3：总数要印给她看，⛔ 只写 console */
import { receiptText, ledgerText } from '../core/ledger.js';
import { toList, trimText, asText, asArray, countChars, floorLabel, FLOOR_NOTE, matchKey } from '../core/utils.js';   /* ★ 20261022：重名拦截用 matchKey，之前没 import ⇒ 永远判不重名 */
import {
    PALETTE_KEYS, PALETTE_NAMES, resolveAppearance, applyAppearance, palettePatch,
} from './theme.js';
import { questStats } from '../core/summary.js';
import { columnsFor } from '../core/roster-cols.js';   /* 80：只用来判“身份／势力全空” */
import { decorateCard } from './cardgrid.js';   /* A6：卡头＋一句摘要＋查看全部（不搬 DOM） */
import { buildHealthReport } from '../core/health.js';
// ⭐ 版本从 config 取（⛔ 从 index.js import：那会绕成循环 index→sections→index）
import { APP_VERSION, originPanel, agendaOriginPanel, viaLabel } from '../core/config.js';   /* I4 */
import { replanCurrentFloor } from '../core/actions.js';
import { listWorldbookNames, getEntries, excludeTextFor } from '../core/worldbook.js';
// ⭐ 读书 v2：全读进来 → 模型自己分 → 人物→名册、势力／局势→世界状态
import { importBookWiki } from '../core/book-wiki.js';
import { channelReport } from '../core/wb-channel.js';
import { clockWentBackwards } from '../core/clock.js';
import { publishToBook } from '../core/book.js';
import { runUpdate, cancelUpdate, runReconcile } from '../core/pipeline.js';
import { mergeCharacters, autoDetectDuplicates, undoLastMerge, hasMergeSnapshot } from '../core/merge.js';   /* 1-b：合并能撤了（本来是死函数） */
import { toast } from './toast.js';
// ⭐ 悬浮小框的显隐要在「总控」里能开关（那颗 ✕ 的提示一直承诺着，但控件一直没做） ⭐ 复审追加 3②：保存外观段后要**即时**刷小框（⛔ 等下次切档）
import { mountMini, closeMini, refreshMini } from './mini.js';
import { iconSvg } from './icons.js';
import { takeSnapshot, openHiddenCount, sortRosterList } from '../core/state.js';
import { mountLedgers, deleteLedgerRow } from './ledgers.js';
import { mountLayerLimits, saveLayerLimits } from './layer-limits.js';
/* ------------------------------ 元素小件 ------------------------------ */

/**
 * 文案里的 `**这样**` → 真·粗体。
 *
 * 为什么：她的界面文案一直写着 `**整套**` 这种标记（我从注释一路带进正文了），
 * 真机上就**露出两个星号**，看着像没做完。
 * ⚠️ 用 createTextNode／strong 拼，⛔ 绝不用 innerHTML（文案里有她填的内容，不能当 HTML 解析）。
 */
const FMT_SPLIT = /\*\*([^*]+)\*\*/g;

/**
 * 把文案填进节点（`**这样**` → 真粗体）。
 * ⚠️ 导出是给**页头副题**用的（workspace.js 那份副题也要走这里，
 *    不然会露出 `**` 星号——真机截图看到过）。
 */
export function fillText(node, text) {
    const s = asText(text);
    node.textContent = '';
    if (typeof node.removeChild === 'function') {
        while (node.firstChild) {
            node.removeChild(node.firstChild);
        }
    }
    if (s.indexOf('**') < 0) {
        node.textContent = s;
        return;
    }
    let last = 0;
    FMT_SPLIT.lastIndex = 0;
    let m = FMT_SPLIT.exec(s);
    while (m) {
        if (m.index > last) {
            node.appendChild(document.createTextNode(s.slice(last, m.index)));
        }
        const strong = document.createElement('strong');
        strong.textContent = m[1];
        node.appendChild(strong);
        last = m.index + m[0].length;
        m = FMT_SPLIT.exec(s);
    }
    if (last < s.length) {
        node.appendChild(document.createTextNode(s.slice(last)));
    }
    FMT_SPLIT.lastIndex = 0;
}

export function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) {
        node.className = cls;
    }
    if (text !== undefined && text !== null) {
        fillText(node, text);
    }
    return node;
}

/**
 * 列表内空态块：带单色线条空盒 SVG 图标与一句话说明。
 *   依据＝阿砚第三批 质感 A8（空态不给话术）：第二个参数是「**为什么会自动有**」那句，她看一眼就知道不用自己填。
 */
function emptyBlock(text, why) {
    const box = el('div', 'wxg-empty', text);
    if (trimText(why)) {
        box.appendChild(el('div', 'wxg-empty-why', trimText(why)));
    }
    const ico = document.createElement('span');
    ico.className = 'wxg-empty-ico';
    ico.setAttribute('aria-hidden', 'true');
    ico.innerHTML = iconSvg('empty-box');
    if (box.firstChild) {
        box.insertBefore(ico, box.firstChild);
    } else {
        box.appendChild(ico);
    }
    return box;
}

/** 整页作品化空态（参照构画／千千结）：单色线条图标 ＋ 一句话 ＋ 一个实心主按钮，居中留白 */
function heroEmpty(text, btnLabel, btnAction, why) {
    const box = el('div', 'wxg-empty is-hero', text);
    if (trimText(why)) {
        box.appendChild(el('div', 'wxg-empty-why', trimText(why)));
    }
    const ico = document.createElement('span');
    ico.className = 'wxg-empty-ico';
    ico.setAttribute('aria-hidden', 'true');
    ico.innerHTML = iconSvg('empty-box');
    if (box.firstChild) {
        box.insertBefore(ico, box.firstChild);
    } else {
        box.appendChild(ico);
    }
    if (btnLabel && btnAction) {
        const act = el('div', 'wxg-empty-act');
        act.appendChild(button(btnLabel, btnAction, 'wxg-primary'));
        box.appendChild(act);
    }
    return box;
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
export function section(title, hint, opts) {
    const o = opts || {};
    /*
     * ⚠️ 护栏：hint 必须是字符串（或空）。
     *    这里出过一次真事故：编年那段写成 `section('编年', '…', { open: true } + '⭐ …')`
     *    —— **对象拼字符串** ⇒ 拼出 "[object Object]⭐…"，于是
     *    ① hint 从来没显示过 ② `open` 也没传进去、"默认展开"从没生效。
     *    现在万一再写错，控制台立刻点名，⛔ 不再悄悄坏掉。
     */
    if (hint !== undefined && hint !== null && typeof hint !== 'string') {
        console.warn('[万象阁] 段「' + String(title) + '」的说明传的不是字符串（多半是把 { open: … } 拼进去了）：'
            + typeof hint);
    }
    const drawer = el('div', 'wxg-sec inline-drawer');
    /*
     * ⭐ 「调设置」那五页（外观／召回／读取控制／自定义 API／提示词）盖个标记：
     *   包里这五页的版式共同点是「**卡标题居中** ＋ 保存靠右下**」。
     *   ⛔ 给所有段都上：数据页（状态／世界／名册…）的卡标题居中反而难扫。
     */
    if (o.five) {
        drawer.setAttribute('data-wxg-five', '1');
    }
    /*
     * ⭐ 目标核对 2②：**段头不能带 ST 那两个 class**。
     *   病因：`inline-drawer-toggle` / `inline-drawer-header` 是**酒馆自带**的抽屉标记，
     *   ST 有一个**全局委托**会在点击时去翻 `.inline-drawer-content` 的**行内 display**；
     *   而我们自己的 CSS 用 `[data-wxg-open="1"] { display: block !important }` **压过行内样式**，
     *   且全库**没有任何地方会摘掉 `data-wxg-open`** ⇒ 两家抢同一次点击、
     *   **默认就开着的那几段（前 5 段）收不动**（她报的就是这个）。
     *   ⇒ 摘掉 ST 那两个 class（让它不再插手），开合**由我们自己接管**（见 `bindSectionEvents` 里的 `.wxg-sec-head` 分支）。
     *   ⚠️ `inline-drawer-content` 还留着（它只是个样式类，ST 那个处理器认的是 `-toggle`）。
     */
    const head = el('div', 'wxg-sec-head');
    head.setAttribute('data-action', 'toggle-sec');
    const titleWrap = el('div', 'wxg-sec-titlewrap');
    drawer.setAttribute('data-wxg-title', String(title));   /* 81：左栏要用原名取简称与 title */ titleWrap.appendChild(titleNode(el('b', 'wxg-sec-title'), title));   /* 81：段标题也去括号 */
    titleWrap.appendChild(el('span', 'wxg-sec-sum', o.summary ? asText(o.summary) : ''));
    head.appendChild(titleWrap);
    head.appendChild(el('div', 'inline-drawer-icon fa-solid fa-circle-chevron-down down'));
    drawer.appendChild(head);
    const body = el('div', 'wxg-sec-body inline-drawer-content');
    if (hint && typeof hint === 'string') {
        /*
         * ⭐ 段说明挂一个标记类。
         *    工作台里它是**页头的副题**（.wxg-ws-h1sub），所以这里那份要藏起来——
         *    不然同一句话会在页头和正文各出现一次（真机上截图看到过）。
         *    浮层/设置区那两个地方没有页头，这份照常显示。
         */
        body.appendChild(el('div', 'wxg-note wxg-sec-hint', hint));
    }
    drawer.appendChild(body);
    if (o.open) {
        drawer.setAttribute('data-wxg-open', '1');
    }
    // 壳记在正文层自己的属性上（直接引用，零魔法）
    body.__wxgDrawer = drawer;
    /*
     * ⭐ 副题给"页级大标题"用（工作台把这段当一页，标题＋副题挂在内容区顶上）。
     *    挂在壳上、而不是塞进正文——工作台里壳的标题行会被隐藏，副题由页头统一显示。
     */
    drawer.setAttribute('data-wxg-sub', trimText(hint));
    // ⚠️ 这两个标记只给**离线预览页**用（它没有酒馆那套 JS，得照标记判断哪几段是展开的）： ⛔ 不参与任何逻辑判断；我上一版把标记弄丢过，结果预览把每段正文都跳过了（只剩标题连成一坨）。
    body.setAttribute('data-wxg-sec', title);
    if (o.open) {
        body.setAttribute('data-wxg-open', '1');
    }
    return body;
}

/**
 * 一张卡：可选的卡头（`.wxg-card-h`）加内容。
 *   ⚠️ 上一次整块删 `compactCard` 时把它一起删了（实测 `card is not defined`，123 项真红），这里补回来。
 */

export function card(title) {
    const box = el('div', 'wxg-card');
    if (trimText(title)) {
        box.appendChild(titleNode(el('div', 'wxg-card-h'), title));   /* 81：造的当下去括号 */
    }
    return box;
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

/**
 * ★ 她 22:1x：**查重结果要能勾选**。
 *   每组：保留第一条；其余每条一个勾选框（默认勾）；底下一个「合并勾选的」。
 *   ⛔ 只给一串名字让她自己回去找人 ✓
 */
function renderDupPicker(host) {
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

/**
 * ⭐ 规整两列的"设置行"：**左边标签（右对齐成一条竖线）＋ 右边控件**。
 *
 * 复核方原话："「召回」那种数字行排成规整两列——左标签、右控件、对齐"。
 * 原来一行横着铺"标签 数字框 标签 数字框 标签 数字框"，眼睛得来回找。
 * ⛔ 只用于设置类行；卡片头、说明、列表照旧。
 *
 * @param {HTMLElement} host 挂到哪儿
 * @param {string} label 左列标签
 * @param {...HTMLElement} controls 右列控件（可多个，横着排）
 */
function line(host, label, ...controls) {
    const r = el('div', 'wxg-line');
    r.appendChild(el('div', 'wxg-line-k', label));
    const v = el('div', 'wxg-line-v');
    for (const c of controls) {
        if (c) {
            v.appendChild(c);
        }
    }
    r.appendChild(v);
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

function textInput(id, value, placeholder, action, cls, type) {    const input = document.createElement('input');
    /* ⭐ 她 13:xx：「密钥那里不能自动隐藏」⇒ 支持传 'password'（默认遮住）✓ */
    input.type = type || 'text';
    input.id = id;
    input.className = 'wxg-pole ' + (cls || '');
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
    input.className = 'wxg-pole';
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
    box.className = 'wxg-pole textarea_compact';
    box.rows = String(rows || 4);
    box.value = asText(value);
    if (placeholder) {
        box.placeholder = placeholder;
    }
    box.setAttribute('data-action', action);
    return box;
}

export function button(label, action, cls, id) {
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
    s.className = 'wxg-pole';
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

/*
 * ⭐⭐ RD1（材料 11·渲染层）：**重绘不能把她正看着的折叠屎屉全关上** ✓
 *   旧：`foldable(..., false)` 硬编码 open=false ✗
 *     ⇒ 一发消息／一次后台更新，她在「提示词」里点开的「展开看这套」、
 *       在「人物名册」点开的「展开录入」、在「状态 → 进度」点开的「展开看是哪几楼」
 *       ⇒ **啪一下全关上** ✗
 *   现在：按**标题**记住展开与否 ✓，重绘时还原 ✓
 *   （空标题的不记：它们同名、会互串 ✗）
 */
const foldOpenState = new Map();

/**
 * ⭐ ST4（材料 11·设置层）：**这一段有没有没保存的草稿** ✓
 *   为什么要它：她改完直接点左栏切页／关工作台时，草稿**无声没了** ✗
 *   → 这里只回答“有没有”，⛔ 自己落盘、⛔ 拦她切页 ✗（我们不改保存语义 ✓）
 */
export function hasUnsavedDraft() {
    try {
        const st = stagingOf(stagingMode) || {};
        for (const k of Object.keys(st)) {
            const v = st[k];
            if (v && typeof v === 'object') {
                if (Object.keys(v).length) {
                    return true;
                }
            } else if (v != null) {
                return true;
            }
        }
        return false;
    } catch (eDraft) {
        return false;
    }
}

function foldable(summaryText, open) {
    const d = document.createElement('details');
    /*
     * 依据＝阿砚第三批 N1（召回页折叠后下半屏全白）——上一版把 min-height 挂错了地方：
     *   `<details>` 收起时仍在文档流里 ⇒ 三个收起的折叠头各被撑成 96px 空盒子（实机 369px 的来历）。
     *   现在：`<details>` 什么都不挂；最小高度交给内容容器（展开时才在文档里，见 mkFold）。
     */
    d.className = 'wxg-report';
    const s = document.createElement('summary');
    s.appendChild(el('span', null, summaryText));
    if (summaryText) {
        const chev = el('span', 'wxg-card-chevron wxg-fold-chevron', '▾');
        chev.setAttribute('aria-hidden', 'true');
        s.appendChild(chev);
    }
    d.appendChild(s);
    tidyText(s);   /* 77 号：折叠条标题也当场去括号（原文进 title） */
    const foldKey = trimText(summaryText);
    const rememberedOpen = foldKey ? foldOpenState.get(foldKey) : null;
    if (open === true || rememberedOpen === true) {
        d.open = true;
    }
    if (foldKey) {
        d.addEventListener('toggle', () => {
            foldOpenState.set(foldKey, d.open === true);
        });
    }
    return d;
}

/* ------------------------------ 分节 ------------------------------ */

function secStatus(host, intoSelf) {
    /*
     * ⭐ 三页并一页（复核方："这三个是不是应该坐到一个地方？"）
     *    账本状态／现在的进度／过程报告 —— 原来分三页，其实是同一件事的三个切面：
     *    存没存、跑到哪楼、每轮到底送进去什么。
     *    ⏐ 内容一样不少，只是不再各占一个屏。
     */
    const box = section('状态',
        '账本存没存、引擎跑到哪楼、每轮到底送进去什么——'
        + '原来分三页，其实是同一件事。',
        { open: true });
    box.appendChild(statusHero({ el: el, state: loadState() }));   /* 71 号：一屏一句 H 档人话 */
    /* 85#11：满数据下状态页不能全空 ⇒ 给最近发生的 3 条 */
    try {
        const recent = getChronicle().slice(-3).reverse();
        if (recent.length) {
            const rc = card('最近发生');
            for (const c of recent) {
                const line = (trimText(c.who) ? trimText(c.who) + '：' : '') + (trimText(c.text) || '暂无');
            rc.appendChild(el('div', 'wxg-recent-line', line.slice(0, 30)));
            }
            box.appendChild(rc);
        }
    } catch (eRecent) { /* 拿不到编年就不印 */ }
    /*
     * ⭐ 「现在怎么样」这张卡**壳撕了**（照状态页目标态的 ⛔ 清单：
     *   它的信息＝每轮记录最新一条，重复）。
     *   ⚠️ 但里面那几行**一条都没丢**：
     *     · 存档行（✓ 已存进聊天档…）—— 目标包要它并进「进度」框的框底（下一步做）
     *     · 世界四值（局势／暗线／编年／可撤回）—— 将来是「世界」那个框
     *   ⇒ 先只把**外壳**去掉（不再是一张叫「现在怎么样」的卡），行原地留着。
     */
    /*
     * ⭐ 两框布局（照目标包：上排两框「进度｜世界」，下排整条「每轮记录」）。
     *   ⛔ 再一堆竖着摆（原来就是一堆，看不出"两件事"）。
     *   ⭐ 存档行与「上次更新」按包里要求**并进左框的框底**。
     */
    /*
     * ⭐ 右上「功能 ⋮」（照目标包：状态页页头右上也有一个）。
     *   跟名册页那颗**同一个做法**（⛔ 两套）。
     */
    const sTop = el('div', 'wxg-roster-topbar');
    const sFunc = button('功能 ⋮', 'status-func', 'wxg-btn is-func');
    sFunc.title = '导出与统计／可撤回的版本（入口位；包里就是这么标的）';
    sFunc.style.height = '28px';
    sFunc.style.minHeight = '28px';
    sFunc.style.lineHeight = '26px';
    sFunc.style.padding = '0 12px';
    sFunc.style.whiteSpace = 'nowrap';
    sTop.appendChild(sFunc);
    // ⭐ 补⑤：「体检」入口（点一下出一份自检）
    const sHeal = button('体检', 'health-open', 'wxg-btn is-func');
    sHeal.title = '出一份自检：版本／开关／条数／最近失败分类（⛔ 不含正文与钥匙）';
    sHeal.style.height = '28px';
    sHeal.style.minHeight = '28px';
    sHeal.style.lineHeight = '26px';
    sHeal.style.padding = '0 12px';
    sHeal.style.whiteSpace = 'nowrap';
    sHeal.style.marginRight = '6px';
    sTop.insertBefore(sHeal, sFunc);
    box.appendChild(sTop);

    const two = el('div', 'wxg-two');
    const colProg = el('div', 'wxg-col');
    const report = storageReport();
    const line = el('div', 'wxg-store', report.text);
    line.setAttribute('data-tone', report.tone);
    const ledgerRaw = '上次更新：' + ledgerText();
    const ledgerLine = el('div', 'wxg-ledger', sanitizeTech(ledgerRaw));
    ledgerLine.title = ledgerRaw;
        /*
         * 依据＝阿砚 3 件任务 · 渲染层 #3：这行“世界四值”已并进**顶栏第五格**（不再单占一张卡）。
         *   去向：ui/workspace.js 的 renderChips → ['可撤回', ...]（同一份数据，⛔ 再渲染一遍）。
         */
    /*
     * ⚠️ 这段原来是「现在怎么样」卡里那组操作钮（`cAct`）——**已经没人挂它了**
     *   （操作改挂总控页操作卡 ＋ 悬浮球）⇒ 留着就是**死代码**（每次重画白拼一遍）。删掉。
     */
    /*
     * ⭐ 修复单 #31(b)：这里原来还有**一份重复的「清空确认盒」**（id `wxg-clear-typing`）——
     *   但它的**入口只在总控页**（`clear-world-open` 全库只有那一处）
     *   ⇒ 状态页这份**永远没有人能点出来**（死代码），
     *   而且它那个写死的 id 还把事件处理的 fallback **引到了旧份**上（已一并修）。
     *   ⇒ 整块撕掉；她要的那份在**总控页**（输入框 id = `wxg-clear-typing-general`）。
     */
    /*
     * ⭐ 「操作」卡**撕了**（照状态页目标态的 ⛔ 清单：「操作卡」✔️ 已移出）。
     *   它改挂到**两处**，两处合起来就是原来那 7 钮、**一处不差**：
     *     · 总控页 →「操作」卡（v0.2.71）
     *     · 悬浮球 → 头部「更新」＋操作区 6 钮（v0.2.72）
     *   她 2026-10-15 00:45「设置加操作，悬浮球也加上，**双重保险**」——
     *   ⚠️ **先接住、再撕**：那两处都做好了才能撕这里（⛔ 先撕＝她摸不到）。
     */

    /*
     * ⭐ 进度（原「现在的进度」那一整块）⇒ 摆进**左框**；
     *   世界四值 ⇒ 摆进**右框**；两框并排（照目标包：上排两框）。
     */
    secSteps(host, colProg);
    /*
     * ⭐ 存档行／上次更新 ⇒ 收进**进度卡里面**（包里要的是「框底一行」，
     *   ⛔ 只是"跟在卡下面"）。
     *   做法：`secSteps` 已经把卡挂进 colProg 了 ⇒ 把这两行**挪进那张卡**。
     *   拿不到卡就退回原样（⛔ 为了排版把信息弄丢）。
     */
    const progCard = colProg.querySelector ? colProg.querySelector('.wxg-card') : null;
    (progCard || colProg).appendChild(foldStore({ el: el, doc: document, line: line, ledgerLine: ledgerLine }));
    if (progCard) { foldCard({ card: progCard, doc: document, line: statusCardLine(loadState(), runWarning(loadState())) }); }   /* 75：带一句话 */
    box.appendChild(colProg);

    const p = loadState().pipeline || {};
    /*
     * ⭐⭐「更新流水」**整块删了**（2026-10-15 她亲口定的：「那个每轮记录那里也能体现出失败的那个呀，
     *   更新流水的确重复了」）。
     *
     * ⚠️ 我上一轮多虑了：我以为它"报的是正在跑／失败／与手改冲突"、删了就违反"失败必须可见"。
     *   查证结果——**每轮记录本来就报失败**：
     *     · `statusOf()` 里就有「失败」这一档（`injectStatus === 'error'`）
     *     · 筛选胶囊里也摆着「失败」
     *   ⇒ 失败**在两处可见**，这里确实是重复的。以她的话为准。
     *
     * ⭐ 只留一样东西：**与她的手改冲突那几句**——那不是"流水"，
     *   那是"你手改的版本被保住了"的提醒，删了才是真丢信息。
     */
    /* 129-B：在场／后台位置与理由——只在已有进度卡里加一行纯文本 */
    if (Array.isArray(p.screenOn) && p.screenOn.length) {
        const onTxt = p.screenOn.map((x) => String(x.name) + '·' + String(x.place || '')).join('／');
        const offArr = Array.isArray(p.screenOff) ? p.screenOff : [];
        const offTxt = offArr.map((x) => String(x.name) + '·' + String(x.place || '') + (x.reason ? '·' + String(x.reason) : '')).join('／');
        box.appendChild(el('div', 'wxg-plain', '在场 ' + String(p.screenOn.length) + ' 人（' + onTxt + '）'
            + (offArr.length ? '｜后台 ' + String(offArr.length) + ' 人（' + offTxt + '）' : '')));
    }
    if (Array.isArray(p.conflicts) && p.conflicts.length) {
        const cWarn = el('div', 'wxg-plain');
        const warn = el('div', 'wxg-store', '与你的手改冲突（引擎**按你的版本保留**，内容没被冲掉）：');
        warn.setAttribute('data-tone', 'bad');
        cWarn.appendChild(warn);
        for (const c of p.conflicts) {
            cWarn.appendChild(el('div', 'wxg-fact', '· ' + asText(c)));
        }
        box.appendChild(cWarn);
    }
    /*
     * ⭐「每轮记录」（原「过程报告」）也并进这一页——它就是"一行一楼"那张表，
     *    跟上面的进度是同一件事的两面：一个看数量，一个看**到底送了什么**进去。
     *    ⛔ 不删内容，只是不再单占一个屏。
     */
    /* 71 号：「每轮记录」整卡默认折起（调模块） */
    const repFold = foldReport({ el: el, doc: document });
    box.appendChild(repFold.wrap);
    secReport(host, repFold.body);
    if (!intoSelf) {
        host.appendChild(box);
    }
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
        + '（要停用整个插件 ⇒ 去酒馆的扩展列表里关它，这里不再放第二个总闸）',
        { open: true });

    const cRun = card('更新与节流');
    cRun.appendChild(checkbox('wxg-auto-update', '新楼生成后自动更新（关掉＝只手动更新）', s.autoUpdate, 'stage-auto-update'));
    cRun.appendChild(stateLine({ el: el, on: s.autoUpdate, onText: '每产生新楼就会自动推一轮，你会看到状态自己变。', offText: '发消息不会自动推；要推请按「立刻更新」或工作台顶部的更新键。' }));
    row(cRun,
        field('更新频率', numberInput('wxg-update-every', s.updateEvery, 1, 10, 'stage-update-every')),
        field('晚几层再更新', numberInput('wxg-update-lag', Number.isFinite(Number(s.updateLag)) ? Number(s.updateLag) : 1, 0, 5, 'stage-update-lag')),
        el('span', 'wxg-note', '她的话：0＝每层都更；1＝生成第 N 层时更新第 N-2 层（最新那层还在被刷，先不动）；频率＝楼推进一次（1回合＝2楼）'));
    /*
     * ⭐ 自动 + 频率 1 ⇒ 明确提示"建议停在上一轮"（复核方问的就是这个）。
     *    为什么建议：新楼一出现就算它，可那时你还能改／能重 roll／能撤回，
     *    引擎先算一遍是**白烧额度**，算出来的状态还可能对应一版不存在的正文。
     *    ⛔ 不偷偷改她存的值——把话说明白＋给一颗一键改的按钮，改不改她定。
     */
    if (s.autoUpdate && Number(s.updateEvery) <= 1) {
        const tip = el('div', 'wxg-note wxg-advice');
        tip.appendChild(el('span', null, '⚠ 自动更新 + 频率 1 ⇒ 你刚发出去那楼会被**立刻**算一遍；'
            + '但那时你还能改、能重 roll、能撤回，引擎这一趟会白烧额度。建议改成 2（停在上一轮，只算落定的楼）。'));
        tip.appendChild(button('改成 2（推荐）', 'use-hold-one', 'wxg-btn-xs'));
        cRun.appendChild(tip);
    }
    cRun.appendChild(checkbox('wxg-protected', '现场保护：正文刚演过的人，本轮只带状态、不重复推演', s.protectedBypass, 'stage-protected'));
    cRun.appendChild(stateLine({ el: el, on: s.protectedBypass, onText: '正文里刚演过的人只带状态，引擎不会替他们再推一遍。', offText: '引擎可能替刚演过的人也推一遍（容易跟正文打架）。' }));
    cRun.appendChild(checkbox('wxg-strict', '严格模式：只带本轮点名的人', s.strictMention, 'stage-strict'));
    cRun.appendChild(stateLine({ el: el, on: s.strictMention, onText: '只把本轮点名的人放进注入；没点到的人不会出现。', offText: '没点到的人也可能被带进来（上下文更全，但更占篇幅）。' }));
    box.appendChild(cRun);
    mountLayerLimits(cRun);

    const cUi = card('入口与启动');
    /* 渲染层 #9：悬浮球的三个开关都在这张卡上；这里取生效值（已存＋还没保存的草稿） */
    const miniEffEarly = Object.assign({}, s.mini || {});
    cUi.appendChild(checkbox('wxg-panel-open', '打开酒馆时自动弹出工作台／面板', s.showPanelOnStart, 'stage-panel-on-start'));
    /*
     * ⭐「把悬浮小框叫回来」——补一个**早就该有**的开关：
     *    小框上那颗 ✕ 的提示一直写着"藏起来（「总控」里能再叫出来）"，
     *    但总控里根本没这个控件 ⇒ 藏了就再也回不来，
     *    连带"手动更新"也失去了唯一的就近入口（复核方问的正是这个）。
     * ⚠️ 它不在 saveBar 那一批里：勾了要**立刻挂载/收起**，⛔ 不等"保存"。
     */
    cUi.appendChild(checkbox('wxg-ball-show', '显示悬浮小框（聊天时常驻，点一下进工作台；手动更新也在它上面）',
        (s.mini && s.mini.show) === true, 'toggle-mini-show'));
    /*
     * 依据＝阿砚 3 件任务 · 渲染层 #9（悬浮球三开关收到一处）：
     *   原来「显示」在这张卡、「悬停展开／钉住」藏在「色板与颜色槽」卡里 —— 同一件事跨两页。
     *   现在三个都在这里；色板卡那边只留一行指路（⛔ 两边各一份，那正是 4-g 的根病）。
     */
    cUi.appendChild(checkbox('wxg-hover-open', '鼠标移入悬浮球就自动展开（不勾＝扫过不会弹开）',
        miniEffEarly.hoverOpen === true, 'mini-hover-toggle'));
    cUi.appendChild(checkbox('wxg-pin-ball', '钉住悬浮球（一挂上就展开）',
        miniEffEarly.pinned === true, 'mini-pin-toggle'));
    box.appendChild(cUi);

    /*
     * ⭐ ③ 操作（目标包「总控页」第三张卡）。
     *   她 2026-10-15 00:45 令：「设置加操作，悬浮球也加上，**双重保险**」——本卡＝双重保险的一半。
     *   ⚠️ 这 7 钮＝**从状态页移出的那一组**：先在本页**接住**，
     *     等悬浮球也接上了，才能把状态页那张卡撕掉（⛔ 先撕＝她就摸不到了）。
     */
    const cOps = card('操作');
    const opsRow = el('div', 'wxg-card-actions');
    /*
     * ★ 20261023（阿砚 16 号）：这颗就是“从快照恢复”——名字改成人话，动作名不动 ✓
     *   原名「撤回上一次」她不一定知道它就是回到最近一次留快照时的账。
     */
    row(opsRow, button('立刻更新', 'update-now', 'wxg-primary'), button('从快照恢复', 'rollback'),
        button('重算本楼', 'replan'));
    opsRow.appendChild(el('span', 'wxg-note', '（快照：每次更新、合并、删楼、换版前都会先留一份；这颗回到**最近一次**那份 —— 连点两次会又回到刚才那份（它自己也会先留一手））'));
    /*
     * ★ 20261023（阿砘 16 号）：快照**列表**——她可以挑一份回去，⛔ 只能撤最近一次 ✗
     */
    try {
        
const snaps = listSnapshots();
        if (snaps.length) {
            const cSnap = card('快照（可回退）');
            cSnap.appendChild(el('div', 'wxg-note', '每次更新／合并／删楼／换版前都会先留一份。选一份点右边那颗，账就回到那时候。'));
            for (const sp of snaps.slice(0, 6)) {
                const r2 = el('div', 'wxg-card-actions');
                r2.appendChild(el('span', 'wxg-name', sp.label));
                r2.appendChild(el('span', 'wxg-note', '  ' + humanStamp(sp.at) + '  · ' + String(sp.chars) + ' 人物 / ' + String(sp.events) + ' 事件'));
                const b2 = button('恢复这一份', 'rollback-to', 'wxg-btn-sm', String(sp.index));
                r2.appendChild(b2);
                cSnap.appendChild(r2);
            }
            box.appendChild(cSnap);
        }
    } catch (eSnap) { /* 列不出来也不影响主面板 */ }
    /*
     * ⭐ 首夜实测单第 3 条：补推前给**范围**（留空＝全部，向后兼容）。
     *   她原话：「我也不知道他补齐了多少楼？这旁边也没有自己设定的，我可以自己设定要补齐多少楼层。」
     */
    const bfRow = el('div', 'wxg-card-actions');
    bfRow.appendChild(el('span', 'wxg-note', '补推范围：'));
    const bfN = textInput('wxg-backfill-n', stagedValue(SECID, 'backfillN', getSettings().backfillN || ''),
        '补最近几楼（留空＝全部）', 'stage-backfill-n', 'wxg-short');
    bfN.setAttribute('title', '例：填 5 ⇒ 只补最近 5 层你的发言；留空 ⇒ 从最早补到现在（老行为）');
    bfRow.appendChild(bfN);
    opsRow.appendChild(bfRow);
    /*
     * 依据＝阿砚 53 号 M22：补推的进度/结果以前只在状态页顶栏（pipeline.text），她得翻页才看得见。
     *   这里把它**贴到操作卡旁**（同一个 opsRow，⛔ 不另起飘窗）；没有进度时这一行不出现。
     */
    {
        const pText2 = trimText(((loadState() || {}).pipeline || {}).text);
        if (pText2) {
            opsRow.appendChild(el('span', 'wxg-note', '\u8fdb\u5c55\uff1a' + pText2));
        }
    }
    row(opsRow, button('对账（账与楼对齐）', 'reconcile'), button('写入世界书', 'publish-book'),
        button('补推历史', 'backfill'));
    /* 依据＝阿砚 A 组 E4：账本导出／导入（带验签）；⛔ 碰她的书与设置，只搬这一本账 */
    row(opsRow,
        button('导出这本账', 'export-bundle'),
        button('导入账本', 'import-bundle'),
        el('span', 'wxg-note', '（包里自带摘要；被改过一个字就会拒收）'));
    /*
     * ⭐ 首夜实测单第 2 条（她原话：「我们取消的按钮都没有见到……想按个取消也没有见到」）：
     *   `cancel-update` 的 handler 一直**在**（本文件 ~L5278），但**按钮从来没被创建过**（孤儿）——
     *   而「补推」的 toast 却承诺"可随时取消" ⇒ **说了有、实际没有**。
     *   ⇒ 这里接上：**跑中就地出现**（就在这些操作钮旁边），跑完自动收起。
     *   ⚠️ 只在跑中渲染（她不用对着一个永远点不动的"取消"发呆）。
     */
    {
        const pipe = (loadState() && loadState().pipeline) || {};
        const pText = trimText(pipe.text);
        const pFail = /没成|失败|出错|不兼容/.test(pText) || /fail|error/i.test(trimText(pipe.step));
        /* ⭐ 真机抓到的卡死标记：只认“**本会话真的在跑**”（内存态 ✓），⛔ 只认持久化的 step ✗ */
        const liveRun = !!(typeof window !== 'undefined' && window.__wxgLiveRun);
        const running = !pFail && liveRun && !!pipe.step && pipe.step !== 'done' && pipe.step !== 'idle';
        if (running) {
            row(opsRow, button('取消（正在跑）', 'cancel-update', 'wxg-del'));
            /*
             * ⭐ 首夜实测单第 5 条（她 06:09「**立即更新说到了点**」＝认可"点完没有在跑的样子"）：
             *   跑中得有**样子** —— 这里挂一个「⏳ 更新中」胶囊，并把重活按钮**禁用**（点不动、也不吞连点）；
             *   跑完（running 为假）自然恢复 ⇒ 下次重绘时按钮就没有 disabled 了 ✓
             */
            const pill = el('span', 'wxg-busy-pill', '⏳ 更新中…');
            pill.id = 'wxg-ops-busy';
            pill.setAttribute('title', pText || '正在后台跑；想停就点旁边的「取消（正在跑）」');
            opsRow.appendChild(pill);
            const heavy = ['update-now', 'backfill', 'reconcile', 'publish-book', 'replan', 'rollback'];
            for (const a of heavy) {
                const b = opsRow.querySelector('[data-action="' + a + '"]');
                if (b) {
                    b.setAttribute('disabled', 'disabled');
                    b.setAttribute('title', '正在跑（上面的胶囊能看到进度）——想停就点「取消（正在跑）」');
                }
            }
        }
    }
    row(opsRow, button('清空这个世界', 'clear-world-open', 'wxg-del'));
    /*
     * ⭐ 首夜实测单第 7 条（她原话：「（总控那些操作设置）**纠结半天到底是什么意思，我也没搞懂**」）：
     *   每个操作钮给**一句人话**（鼠标悬上去就能看）—— ⛔ 再堆黑话。
     */
    {
        const HINT = {
            'update-now': '立刻把“刚落定的那一楼”算一遍（世界状态＋角色八格）。后台跑，不挡你聊天。',
            rollback: '撑回上一次更新之前的样子（撑回前那一版也留着，能再撑回来）。',
            replan: '把当前这一楼重算一遍（比如你改了字、想重算）；⛔ 重新跑整本账。',
            reconcile: '把“账”和“楼”对齐（看看哪几楼还没入账）。⛔ 改内容，只对账。',
            'publish-book': '把现在的名册／世界状态／编年／**世界状态摘要**，**另写一份**到世界书《万象阁 · 世界后台》（⛔ 动你原来的书；摘要槽常驻启用，其余备份条仍禁用）。',
            backfill: '把之前没算过的楼补算一遍；旁边可以先填“只补最近几楼”（留空＝全部）。跑中可随时取消。',
            'clear-world-open': '清空这个聊天里的世界账（会先问你一次，⛔ 直接清）。',
        };
        for (const a of Object.keys(HINT)) {
            const b = opsRow.querySelector('[data-action="' + a + '"]');
            if (b && !b.getAttribute('title')) {
                b.setAttribute('title', HINT[a]);
            }
        }
    }
    /*
     * ⭐ 首夜实测单第 4 条（她原话：「我也不知道他更新到什么东西了，**还得翻到总空那里去看看**」
     *   ＋「第一次点了一下推了八成……第二次按完才推完，还是翻到那个地方才看到他推了多少」）：
     *   progress 文案**早就存在**（`pipeline.js` 的「准备补推 N 个楼层」／「补推中：第X楼（n/total）」／
     *   「补推中断：…（已完成 X 楼）」），但**只渲在【状态】页** ⇒ 操作在总控、进度在状态，中间隔一次翻页 ✗
     *   ⇒ 这里把进度**搬到操作钮旁边就地显示**（同一个数据源 `loadState().pipeline`），
     *     并**自带一个小自刷**：跑中就每 700ms 刷一次；元素一离开 DOM 就自停（⛔ 不挂全局定时器）。
     */
    const progRow = el('div', 'wxg-note', '');
    progRow.id = 'wxg-ops-progress';
    opsRow.appendChild(progRow);
    {
        const readPipe = () => {
            try {
                return (loadState() && loadState().pipeline) || {};
            } catch (e) {
                return {};
            }
        };
        const draw = () => {
            let p2 = {};
            try {
                p2 = readPipe();
            } catch (e) {
                p2 = {};
            }
            const step = trimText(p2.step);
            const text = trimText(p2.text);
            /*
             * ⚠️ 真机上抓到：**失败/没配好**的旧消息也带着非 done/idle 的 step ⇒ 被我显示成"⏳ 正在跑" ✗
             *   ⇒ 先把"没成/失败"这类**排除出"跑中"**，单独报（她要知道"上次没成、为什么"）。
             */
            const failed = /没成|失败|出错|不兼容/.test(text) || /fail|error/i.test(step);
            /* 同上：只认本会话真在跑 ✓（卡死的旧标记会被当“上次”报出来 ✓） */
            const liveRun2 = !!(typeof window !== 'undefined' && window.__wxgLiveRun);
            const running2 = !failed && liveRun2 && !!step && step !== 'done' && step !== 'idle';
            if (failed) {
                progRow.textContent = '⚠ 上次：' + sanitizeTech(text);
        progRow.title = text;
            } else if (running2) {
                progRow.textContent = '⏳ ' + (text || '正在跑…');
            } else if (text && /补推中断|已取消/.test(text)) {
                /*
                 * 断点续跑要**露出**（她那次"推了八成→再点→推完"的静默中断，屏上根本没说过）：
                 * 留着上次那句话，并告诉她**再点一次「补推历史」就能接着补**。
                 */
                progRow.textContent = '⏸ ' + sanitizeTech(text) + '（再点「补推历史」接着补；填了范围就按范围补）';
            } else if (text) {
                progRow.textContent = '上次：' + sanitizeTech(text);   /* 83 */
            } else {
                progRow.textContent = '（还没跑过；点「补推历史」按范围补，跑中这里会显示 n/N）';
            }
            /*
             * ⭐ RD4（材料 11·渲染层）：**这个轮询不能只改文字** ✓
             *   旧：只 `progRow.textContent = ...` ✗ ⇒ 后台在你停在总控页时开始／结束，
             *     文字变了，但 6 颗操作按钮**该灰的没灰、该恢复的没恢复** ✗
             *   现在：同一个 tick 里把按钮禁用态与「取消」钮也刷一遍 ✓（只动 DOM 属性 ✓）
             */
            try {
                const opActs = ['update-now', 'rollback', 'reconcile', 'publish-book', 'backfill'];
                for (const act of opActs) {
                    const b2 = opsRow.querySelector('[data-action="' + act + '"]');
                    if (!b2) {
                        continue;
                    }
                    if (running2) {
                        b2.setAttribute('disabled', 'disabled');
                        if (b2.style) { b2.style.opacity = '0.5'; }
                    } else {
                        b2.removeAttribute('disabled');
                        if (b2.style) { b2.style.opacity = ''; }
                    }
                }
                const cxl2 = opsRow.querySelector('[data-action^="cancel"]');
                if (cxl2 && cxl2.style) {
                    cxl2.style.display = running2 ? '' : 'none';
                }
            } catch (eRD4) { /* 同步不了也不能把进度搞挂 ✓ */ }
        };
        draw();
        let n = 0;
        const timer = setInterval(() => {
            n += 1;
            if (n > 1200 || !progRow.isConnected) {   // 元素离屏就自停（⛔ 不留全局定时器）
                clearInterval(timer);
                return;
            }
            try {
                draw();
            } catch (e) {
                clearInterval(timer);
            }
        }, 700);
    }
    cOps.appendChild(opsRow);
    if (clearWorldOpen) {
        const prevG = ledgerClearPreview();
        const dangerG = el('div', 'wxg-danger-box wanxiangge');
        dangerG.appendChild(el('div', null, '⚠ 这一步**回不来**。将清掉**这个聊天的世界**：'));
        const listG = el('div', 'wxg-danger-list');
        for (const k of Object.keys(prevG)) {
            listG.appendChild(el('div', null, '· ' + k + '：' + String(prevG[k]) + ' 条'));
        }
        listG.appendChild(el('div', null, '· 世界书《万象阁 · 世界后台》：**不动**'));
        dangerG.appendChild(listG);
        const typeRowG = el('div', 'wxg-card-actions');
        typeRowG.appendChild(el('span', 'wxg-note', '把下面这四个字打进去才能点：'));
        const inpG = el('input', 'wxg-danger-typing');
        inpG.type = 'text';
        // ⚠️ ⛔ 跟状态页那份撞 id（撞了就读到错的那个输入框）
        inpG.id = 'wxg-clear-typing-general';
        inpG.placeholder = CLEAR_WORD;
        inpG.setAttribute('autocomplete', 'off');
        typeRowG.appendChild(inpG);
        typeRowG.appendChild(button('确认清空', 'clear-world-do', 'wxg-del'));
        typeRowG.appendChild(button('算了', 'clear-world-cancel'));
        dangerG.appendChild(typeRowG);
        cOps.appendChild(dangerG);
    }
    cOps.appendChild(el('div', 'wxg-note', '这些操作在悬浮球上也有（聊天时不用进工作台）。'));
    box.appendChild(cOps);

    box.appendChild(saveBar('general'));
    host.appendChild(box);
}

/**
 * 暗线阶段 → 胶囊样式（走的是"阶段"这条线：萌芽最早、消散/完成收尾）。
 * ⛔ 按语义分档，不按颜色名——以后加阶段也不用改这里。
 */

function secWorld(host) {
    const state = loadState();
    const w = state.world;
    const box = section('世界状态',
        '世界局势＝势力的所有碰撞；暗线＝还没浮上台面的事，按阶段走、挂世界钟（不按回合数推，世界钟没到点不许提前冒头）。',
        { open: true, summary: trimText(w.clock) || '世界钟未知' });

    // ⭐ 一次体检的结论：内容得**装进结构**（一个主题一块卡），别平铺在一个大平面上 ⭐ 数据卡：默认只读（复核方第四条）——点「编辑」才能改 ⭐ 页头：右上「功能 ⋮」（照包；跟状态页、名册页同一个做法）
    const wTop = el('div', 'wxg-roster-topbar');
    const wFunc = button('功能 ⋮', 'world-func', 'wxg-btn is-func');
    wFunc.style.height = '28px';
    wFunc.style.minHeight = '28px';
    wFunc.style.lineHeight = '26px';
    wFunc.style.padding = '0 12px';
    wFunc.style.whiteSpace = 'nowrap';
    wTop.appendChild(wFunc);
    box.appendChild(wTop);
    /* ★ P2-7：**面板四分区**——世界总览／人物清单与状态／活跃暗线／记忆状态 ✓ */
    box.appendChild(el('div', 'wxg-note wxg-sec-head', '① 世界总览'));
    const cWorld = lockable(card('世界钟・地点'), 'world-clock');
    /* 口径（与 core/config.js 一致）：**世界钟／地点允许写“未知”，其它格不许**；⛔ 在 UI 上教她写“未知”。 */
    line(cWorld, '世界钟', textInput('wxg-world-clock', w.clock, '例：第二天 上午 10:20', 'set-world-clock', 'wxg-short'));
    line(cWorld, '地点', textInput('wxg-world-place', w.place, '例：四夷馆', 'set-world-place', 'wxg-short'));
    line(cWorld, '这个世界现在什么样',
        textarea('wxg-world-big', w.bigPicture, '从高处看一眼：这个世界现在什么样', 'set-world-big', 3));
    /*
     * A6：两列卡片网格。卡不再一条道摊到底，而是并排；每张卡带一句摘要，长的折起来。
     */
    const wgrid = el('div', 'wxg-wgrid');
    box.appendChild(wgrid);   /* A6：先挂上去（否则「世界钟地点卡」会因为整个网格没挂而丢失） */
    wgrid.appendChild(cWorld);

    /*
     * 依据＝阿砚 3 件任务 · 渲染层 #6（四张空卡合并成一行）：
     *   势力／世界事实／脉动／风声 四张卡都是“引擎还没推出来”，各占一个卡位＋虚线大框；
     *   四个空框堆起来就是一屏“没东西”。全空时只留**一行**，有数据才展开。
     */
    const wFactions0 = Array.isArray(w.factions) ? w.factions : [];
    const wFacts0 = Array.isArray(w.facts) ? w.facts : [];
    const wPulse0 = (w.pulse && typeof w.pulse === 'object') ? w.pulse : {};
    const wPulseDom0 = Array.isArray(wPulse0.domains) ? wPulse0.domains : [];
    const wPulseCov0 = (wPulse0.coverage && Array.isArray(wPulse0.coverage.entries)) ? wPulse0.coverage.entries : [];
    const wWinds0 = Array.isArray(w.winds) ? w.winds.filter((x) => x && (trimText(x.topic) || trimText(x.text))) : [];
    /*
     * 六（阿砚件 7）：世界事实／脉动／风声 三张“引擎还没推出来”的卡，各占一格就是三块空白。
     *   ⇒ 三张都空时，把三张**装进一条折叠条**（标题写清楚、点开才看到分区）；有数据才各自展开。
     *   势力那张是独立实体，⛔ 不并进来。
     */
    const engineEmpty = !wFacts0.length && !wPulseDom0.length && !wPulseCov0.length && !wWinds0.length;
    const engineFold = engineEmpty
        ? foldable('引擎还没推出来的（世界事实／脉动／风声）', false)
        : null;

    const worldCardsEmpty = !wFactions0.length && !wFacts0.length
        && !wPulseDom0.length && !wPulseCov0.length && !wWinds0.length;
    if (worldCardsEmpty) {
        box.appendChild(emptyBlock('世界事实／脉动／风声 —— 还没有内容（引擎推出来才会展开）', '为什么会自动有：你发消息后引擎会推一次，把硬事实、压力、风声落进来。如果一直为空，先看总控「入口与启动」里自动更新有没有开着。'));
    }

    /* ★ [580] C1：势力厚度在面板上看得见（只读；改走世界步回写，⛕ 卡头再放一颗编辑） */
    const cFac = card('势力（在册）');
    const facList = Array.isArray(w.factions) ? w.factions : [];
    if (!facList.length) {
        cFac.appendChild(emptyBlock('还没有势力（从世界书读人时会一起落进来）'));
    } else {
        const fl = el('div', 'wxg-list');
        for (const f of facList) {
            const r = el('div', 'wxg-r');
            const main = el('div', 'wxg-r-main');
            const title = el('div', 'wxg-r-title');
            title.appendChild(el('span', 'wxg-r-who', trimText(f.name) || '未记名'));
            /* 依据＝渲染层 #2（显示层）：没写就**不印这个胶囊**，⛔ 拿“稳固”“中立”凑 */
            if (trimText(f.status)) {
                title.appendChild(el('span', 'wxg-badge is-info', trimText(f.status)));
            }
            if (trimText(f.relation)) {
                title.appendChild(el('span', 'wxg-badge is-soft', trimText(f.relation)));
            }
            main.appendChild(title);
            const bits = [];
            if (trimText(f.scale)) { bits.push('规模：' + trimText(f.scale)); }
            if (trimText(f.core_person)) { bits.push('核心人：' + trimText(f.core_person)); }
            if (trimText(f.scope)) { bits.push('范围：' + trimText(f.scope)); }
            const pillars = Array.isArray(f.powerPillars) ? f.powerPillars.map(trimText).filter(Boolean) : [];
            if (pillars.length) { bits.push('支柱：' + pillars.join('／')); }
            if (bits.length) { main.appendChild(el('div', 'wxg-r-sub', bits.join(' · '))); }   /* 85#9：没数据不印占位句 */
            r.appendChild(main);
            const fa = el('div', 'wxg-r-act');
            fa.appendChild(button('删', 'del-faction', 'wxg-btn-xs', String(f.id || f.name)));
            r.appendChild(fa);
            fl.appendChild(r);
        }
        cFac.appendChild(fl);
    }
    if (!worldCardsEmpty) {
        const facAdd = el('div', 'wxg-card-actions');
        facAdd.appendChild(button('＋新增势力', 'add-faction', 'wxg-btn-xs'));
        cFac.appendChild(facAdd);
        decorateCard({ el: el, box: cFac, summaryText: wFactions0.length ? (String(wFactions0.length) + ' 个在册') : '' });
        wgrid.appendChild(cFac);
    }

    /* ★ [580] A3：世界事实键值账（只读；给她核对引擎对齐用，⛔ 不当注入叙述） */
    const cFacts = card('世界事实（键值）');
    const factList = Array.isArray(w.facts) ? w.facts : [];
    if (!factList.length) {
        cFacts.appendChild(emptyBlock('还没有键值事实（世界步带回硬事实变更时会落进来）'));
    } else {
        const fl2 = el('div', 'wxg-list');
        for (const f of factList.slice(0, 40)) {
            const r = el('div', 'wxg-r');
            const main = el('div', 'wxg-r-main');
            const title = el('div', 'wxg-r-title');
            title.appendChild(el('span', 'wxg-r-who', (trimText(f.subject) || '世界') + '｜' + (trimText(f.field) || '—')));
            if (trimText(f.source)) {
                title.appendChild(el('span', 'wxg-badge is-soft', trimText(f.source)));
            }
            main.appendChild(title);
            main.appendChild(el('div', 'wxg-r-sub', trimText(f.value) || '（空）'));
            r.appendChild(main);
            fl2.appendChild(r);
        }
        cFacts.appendChild(fl2);
        if (factList.length > 40) {
            cFacts.appendChild(el('div', 'wxg-note', '共 ' + String(factList.length) + ' 条，面板只列最近 40 条'));
        }
    }
    if (!worldCardsEmpty) {
        decorateCard({ el: el, box: cFacts, summaryText: wFacts0.length ? (String(wFacts0.length) + ' 条硬事实') : '' });
        if (engineFold) { engineFold.appendChild(cFacts); } else { wgrid.appendChild(cFacts); }
    /* 世界钟与地点下面的卡片都进网格（A6） */
    }

    /* ★ [580] A4：独立脉动＋巡查覆盖（只读；与局势并行，可看镜头外） */
    const cPulse = card('世界脉动（域／巡查）');
    const pul = (w.pulse && typeof w.pulse === 'object') ? w.pulse : { domains: [], coverage: { entries: [] } };
    const domList = Array.isArray(pul.domains) ? pul.domains : [];
    const covList = (pul.coverage && Array.isArray(pul.coverage.entries)) ? pul.coverage.entries : [];
    if (!domList.length && !covList.length) {
        cPulse.appendChild(emptyBlock('还没有脉动域（世界步可带回镜头外的压力／巡查）'));
    } else {
        if (domList.length) {
            cPulse.appendChild(el('div', 'wxg-note', '域（' + String(domList.length) + '）'));
            const dl = el('div', 'wxg-list');
            for (const d of domList.slice(0, 24)) {
                const r = el('div', 'wxg-r');
                const main = el('div', 'wxg-r-main');
                const title = el('div', 'wxg-r-title');
                title.appendChild(el('span', 'wxg-r-who', trimText(d.label) || '未记名'));
                if (trimText(d.kind) && trimText(d.kind) !== 'other') {
                    title.appendChild(el('span', 'wxg-badge is-soft', trimText(d.kind)));
                }
                title.appendChild(el('span', 'wxg-badge is-info', '压' + String(Number.isFinite(Number(d.pressure)) ? Number(d.pressure) : 0)));
                if (trimText(d.trend)) { title.appendChild(el('span', 'wxg-badge is-soft', trimText(d.trend))); }
                if (trimText(d.visibility)) { title.appendChild(el('span', 'wxg-badge is-off', trimText(d.visibility))); }
                main.appendChild(title);
                const bits = [];
                if (trimText(d.scope)) { bits.push('范围：' + trimText(d.scope)); }
                if (trimText(d.state)) { bits.push(trimText(d.state)); }
                if (trimText(d.evidence)) { bits.push('证：' + trimText(d.evidence)); }
                main.appendChild(el('div', 'wxg-r-sub', bits.join(' · ') || '（尚无正文）'));
                r.appendChild(main);
                dl.appendChild(r);
            }
            cPulse.appendChild(dl);
        }
        if (covList.length) {
            cPulse.appendChild(el('div', 'wxg-note', '最近巡查（' + String(covList.length) + '）'));
            const cl = el('div', 'wxg-list');
            for (const e of covList.slice(0, 16)) {
                const r = el('div', 'wxg-r');
                const main = el('div', 'wxg-r-main');
                const title = el('div', 'wxg-r-title');
                title.appendChild(el('span', 'wxg-r-who', trimText(e.label) || '未记名'));
                if (trimText(e.kind) && trimText(e.kind) !== 'general') {
                    title.appendChild(el('span', 'wxg-badge is-soft', trimText(e.kind)));
                }
                title.appendChild(el('span', 'wxg-badge is-soft', '×' + String(Math.max(1, Number(e.checks) || 1))));
                main.appendChild(title);
                main.appendChild(el('div', 'wxg-r-sub', trimText(e.scope) || '范围未标'));
                r.appendChild(main);
                cl.appendChild(r);
            }
            cPulse.appendChild(cl);
        }
    }
    if (!worldCardsEmpty) {
        decorateCard({ el: el, box: cPulse, summaryText: wPulseDom0.length ? (String(wPulseDom0.length) + ' 个脉动域') : '' });
        if (engineFold) { engineFold.appendChild(cPulse); } else { wgrid.appendChild(cPulse); }
    }

    /* ★ [580] C3：风声＝未证实公开传闻（对齐 A1 trace；账＋局势／事件派生，去重） */
    const cWinds = card('风声与新闻');
    {
        /* 102：已公开组（publicity=public）；⛔ 不展开论坛 */
    const pubNews = (w.situations || []).filter((s2) => s2 && s2.publicity === 'public').slice(0, 6);
    if (pubNews.length) {
        const nl = el('div', 'wxg-list');
        for (const n2 of pubNews) {
            const rr = el('div', 'wxg-r');
            const mm = el('div', 'wxg-r-main');
            const tt2 = el('div', 'wxg-r-title');
            tt2.appendChild(el('span', 'wxg-r-who', trimText(n2.publicHeadline || n2.public_headline || n2.title) || '（未记题）'));
            tt2.appendChild(el('span', 'wxg-badge is-info', '已公开'));
            mm.appendChild(tt2);
            mm.appendChild(el('div', 'wxg-r-sub', (trimText(n2.publicTrace || n2.public_trace) || '公共传播') + ' ｜ 热度 ' + String(Math.max(1, Math.min(3, Number(n2.pressure) || 1)))));
            rr.appendChild(mm);
            nl.appendChild(rr);
        }
        cWinds.appendChild(el('div', 'wxg-note', '【已公开】'));
        cWinds.appendChild(nl);
    }
    const windList = listWindsView(24);
        if (!windList.length) {
            cWinds.appendChild(emptyBlock('还没有风声（局势标 trace、或世界步带回 winds 时会落进来）'));
        } else {
            const wl = el('div', 'wxg-list');
            for (const x of windList) {
                const r = el('div', 'wxg-r');
                const main = el('div', 'wxg-r-main');
                const title = el('div', 'wxg-r-title');
                title.appendChild(el('span', 'wxg-r-who', trimText(x.topic) || '（未记题）'));
                title.appendChild(el('span', 'wxg-badge is-soft', trimText(x.kind) || 'rumor'));
                const via = trimText(x.via);
                const viaLab = viaLabel(trimText(x.via));   /* I4：痕迹来源同一张表 */
                title.appendChild(el('span', viaLab === '风声账' ? 'wxg-badge is-off' : 'wxg-badge is-info', viaLab));
                main.appendChild(title);
                main.appendChild(el('div', 'wxg-r-sub', trimText(x.text) || '（空）'));
                r.appendChild(main);
                wl.appendChild(r);
            }
            cWinds.appendChild(wl);
            cWinds.appendChild(el('div', 'wxg-note', '未证实传闻；⛔ 别当成已公开新闻。与 visibility=trace 对齐，同题只列一次。'));
        }
    }
    if (!worldCardsEmpty) {
        decorateCard({ el: el, box: cWinds, summaryText: wWinds0.length ? (String(wWinds0.length) + ' 条风声') : '' });
        if (engineFold) { engineFold.appendChild(cWinds); } else { wgrid.appendChild(cWinds); }
        /* 六：三张“引擎还没推出来”的卡合成一条折叠条（有数据时才各自展开） */
        if (engineFold) { wgrid.appendChild(engineFold); }
    }

    /*
     * ★ [580]／工作流 D1：**时局简报成套骨架（只取面板分区）** ✓
     *   驱动力／格局／酝酿 —— 全从已有账派生，⛔ 不新开叙述字段、⛔ 不进注入
     *   （工作流那套「时代快讯」叙述／下一步／心理／民生 一律不取）
     */
    box.appendChild(el('div', 'wxg-note wxg-sec-head', '② 时局简报（只读派生·不注入）'));
    const cBrief = card('时局简报');
    {
        const sits = Array.isArray(w.situations) ? w.situations : [];
        const facs = Array.isArray(w.factions) ? w.factions : [];
        const hids = Array.isArray(w.hidden) ? w.hidden : [];
        const domains = (w.pulse && Array.isArray(w.pulse.domains)) ? w.pulse.domains : [];

        const driveLines = [];
        sits.slice()
            .filter((s) => s && trimText(s.title))
            .sort((a, b) => (Number(b.pressure) || 0) - (Number(a.pressure) || 0))
            .forEach((s) => {
                const p = Number.isFinite(Number(s.pressure)) ? ('压 ' + String(Number(s.pressure)) + ' 成') : '';
                driveLines.push((p ? p + ' · ' : '') + trimText(s.title)
                    + (trimText(s.sides) ? '（' + trimText(s.sides) + '）' : '')
        + (trimText(s.basis) === '未证实' ? '「低档未采信」' : ''));
            });
        domains.slice()
            .filter((d) => d && trimText(d.label) && Number(d.pressure) >= 2)
            .slice(0, 3)
            .forEach((d) => {
                driveLines.push('域·' + trimText(d.label) + '（压 ' + String(Number(d.pressure) || 0) + ' 成）'
                    + (trimText(d.state) ? '：' + trimText(d.state) : ''));
            });

        const brewLines = [];
        sits.filter((s) => s && trimText(s.title) && (
            String(trimText(s.trend) || '').toLowerCase() === 'rising'
            || (trimText(s.expected) && !trimText(s.result))
        )).slice(0, 4).forEach((s) => {
            brewLines.push(trimText(s.title)
                + (trimText(s.expected) ? '（预期：' + trimText(s.expected) + '）' : '')
                + (trimText(s.consequence) ? '（余波：' + trimText(s.consequence) + '）' : ''));
        });
        hids.filter((h) => h && trimText(h.name)
            && trimText(h.stage) !== '消散' && trimText(h.stage) !== '完成')
            .slice(0, 4)
            .forEach((h) => {
                brewLines.push('暗线·' + trimText(h.name) + '【' + (trimText(h.stage) || '萌芽') + '】'
                    + (trimText(h.goal) ? '→' + trimText(h.goal) : ''));
            });

        const putBrief = (label, lines, emptyHint) => {
            cBrief.appendChild(el('div', 'wxg-note', label));
            if (!lines.length) {
                cBrief.appendChild(el('div', 'wxg-empty', emptyHint));
                return;
            }
            const ul = el('div', 'wxg-list');
            for (const t of lines) {
                /* 渲染层第 1 条：单子元素的行不进三列网格（否则挤成竖条） */
                const r = el('div', 'wxg-r is-solo');
                r.appendChild(el('div', 'wxg-r-main', trimText(t)));
                ul.appendChild(r);
            }
            cBrief.appendChild(ul);
        };
        putBrief('驱动力（高压局势／脉动域）', driveLines, '还没有可派生的驱动力');
        putBrief('酝酿中（升温／未结／活跃暗线）', brewLines, '还没有酝酿中的线');
        cBrief.appendChild(el('div', 'wxg-note', '本卡只给人看；内容来自局势／势力／暗线／脉动账，⛔ 不另写叙述、不进主模型注入。'));
    }
    box.appendChild(cBrief);

    /*
     * ⭐ 局势／暗线这两张卡**不套 `lockable`**（照 `[321]`：「有悬浮框的旁边不需要编辑」）。
     *   `lockable` 会在卡头右上加一颗「编辑」并把卡标成 `is-locked`；
     *   不套它 ⇒ 无那颗钮、也没有 `is-locked`（**内容照常可见**）。
     *   ⚙️ 编辑走**点行弹出的浮层右上 ⋮**（`open-world-entry`／`we-edit`）✓
     */
    const cSit = card('局势（势力的碰撞）');
    const sit = el('div', 'wxg-list');
    if (!w.situations.length) {
        sit.appendChild(emptyBlock('还没有局势记录（点「立刻更新」让引擎算一次）'));
    } else {
        // ⭐ 局势也能手改（条 22）：她看得见就该能改——改字、换火候、删掉，都行 ⭐ 行化：`火候胶囊 ｜ 局势名 ＋ 哪几方 ｜ 右侧改 ＋ 删`（一行一条）
        w.situations.forEach((item, idx) => {
            const r = el('div', 'wxg-r is-rowlink');
            /*
             * ⭐ 点行开浮层（照目标包）。
             *   ⚠️ 用**自己的类名** `is-rowlink`，⛔ 蹭 `.is-click`：
             *     `.wxg-r.is-click` 带着一条老规矩 `grid-template-columns: 1fr auto`
             *     （那是给名册行用的两列）⇒ 套上它会把本行变成两列
             *     （胶囊被拉成通栏、「删」掉到下一行）——真机截图里我看到了。
             *   ⛔ 行内展开编辑也撤了（她 01:33 划：那种"连框都没有"的行内小控件不要）
             *   —— 编辑一律从浮层右上 ⋮ 进。
             *   ⚠️ 行里的下拉/按钮各自有 data-action ⇒ closest 会先命中它们（点控件不会误开浮层）。
             */
            r.setAttribute('data-action', 'open-world-entry');
            r.setAttribute('data-kind', 'situation');
            r.setAttribute('data-index', String(idx));
            const tierW = el('span', 'wxg-badge ' + (trimText(item.tier) === TIERS[0] ? 'is-warn' : 'is-info'),
                trimText(item.tier) || '几天内');
            r.appendChild(tierW);
            const main = el('div', 'wxg-r-main');
            const title = el('div', 'wxg-r-title');
            title.appendChild(el('span', 'wxg-r-who', trimText(item.title) || '未记名'));
            if (item.manual) {
                title.appendChild(el('span', 'wxg-badge is-warn', '已手动修改'));
            }
            /* ★ P2-7：**引擎推的 / 书里写着的 / 你改的**——三者分开显示 ✓ */
            {
                const srcTag = (item.source === 'book') ? '书里写着的'
                    : (item.source === 'manual') ? '你改的' : '引擎推的';
                title.appendChild(el('span', 'wxg-badge is-soft', srcTag));
            }
            main.appendChild(title);
            main.appendChild(el('div', 'wxg-r-sub', '哪几方：' + (trimText(item.sides) || '暂无')));
            r.appendChild(main);

            const act = el('div', 'wxg-r-act');
            /*
             * ⛔ 行内那颗「改」**撤了**（照目标包：她 01:33 划的原则——那种"连框都没有"的
             *   行内小控件不要；**编辑一律从浮层右上 ⋮ 进**）。
             *   行本身可点（`open-world-entry`）⇒ 点一下弹浮层，那里改。
             * ✅ 只留「删」：它是**减少**类操作，摆行上最直接，且浮层里再放一个反而绕。
             */
            const del = button('删', 'del-situation', 'wxg-btn-xs');
            del.setAttribute('data-index', String(idx));
            act.appendChild(del);
            r.appendChild(act);

            sit.appendChild(r);
        });
    }
    cSit.appendChild(sit);
    const addSitRow = row(cSit,
        textInput('wxg-new-situation', '', '自己加一条局势（例：商会与教会在争港口税）', 'noop', 'wxg-short'),
        button('加一条局势', 'add-situation', 'wxg-primary'));
    if (addSitRow.classList && typeof addSitRow.classList.add === 'function') {
        addSitRow.classList.add('wxg-add-row');
    } else {
        addSitRow.className += ' wxg-add-row';
    }
    addSitRow.setAttribute('data-no-lock', '1');
    box.appendChild(cSit);

    // 同上：暗线卡也不套 `lockable`（⛔ 卡头留一颗「编辑」）
    /* ③ 人物清单与状态（只给汇总＋入口，⛔ 在这里再列一遍名册） */
    box.appendChild(el('div', 'wxg-note wxg-sec-head', '③ 人物清单与状态'));
    const cPeople = card('人物');
    {
        const rosterAll = getRoster();
        /* ★ [580] A7：在场记录看 presentFloor（正文在场），不是 lastSeenFloor（后台推演也会写） */
        const onStageN = rosterAll.filter((c) => c
            && Number.isFinite(Number(c.presentFloor)) && Number(c.presentFloor) >= 0).length;
        cPeople.appendChild(el('div', 'wxg-note', '在册 ' + String(rosterAll.length) + ' 人；有过正文在场 ' + String(onStageN) + ' 人。状态与过去经历在名册里逐人看。'));
        row(cPeople, button('去人物名册', 'goto-roster'));
    }
    box.appendChild(cPeople);
    /* ④ 活跃暗线（带未完计数） */
    box.appendChild(el('div', 'wxg-note wxg-sec-head', '④ 活跃暗线（未完 ' + String(openHiddenCount()) + ' 条）'));
    const cHid = card('暗线（自己有时间表，到点才动）');
    const hid = el('div', 'wxg-list');
    if (!w.hidden.length) {
        hid.appendChild(emptyBlock('还没有暗线（引擎会在更新时排出来）'));
    } else {
        /*
         * ⭐ 行化（有数据排版术第七条）：一行一条暗线
         *    `阶段胶囊 ｜ 名字 ＋（到点条件／现在到哪一步） ｜ 右侧改阶段 ＋ 删`
         * ⚠️ 原来每个字段各占一行（到点条件一行、现在到哪一步一行、下拉一行）
         *    ⇒ 6 条暗线就是一屏半。
         */
        for (let hidIdx = 0; hidIdx < w.hidden.length; hidIdx += 1) {
                const h = w.hidden[hidIdx];
            const r = el('div', 'wxg-r is-rowlink');
                // ⭐ 点行开浮层（同局势）；行内下拉与「删」各自有 data-action。 ⚠️ 用**自己的类名** `is-rowlink`，⛔ 蹭 `.is-click`（它带着两列的规矩）
                r.setAttribute('data-action', 'open-world-entry');
                r.setAttribute('data-kind', 'hidden');
                r.setAttribute('data-index', String(hidIdx));
            r.appendChild(el('span', 'wxg-badge ' + stageTone(h.stage), trimText(h.stage) || '萌芽'));
    {
        /* 阶段数字（同行同字号）；空／乱写不出数字 */
        const prog = stageProgress(h.stage, h.kind);
        if (prog) { r.appendChild(el('span', 'wxg-badge is-soft wxg-stage-num', prog.text)); }
    }
            const main = el('div', 'wxg-r-main');
            const title = el('div', 'wxg-r-title');
            title.appendChild(el('span', 'wxg-r-who', trimText(h.name) || '未记名'));
            if (trimText(h.tier)) {
                title.appendChild(el('span', 'wxg-badge is-off', trimText(h.tier)));
            }
            if (h.manual) {
                title.appendChild(el('span', 'wxg-badge is-warn', '已手动修改'));
            }
            /* 102：回声台账里有这条 ⇒ 行尾一个「已承接」（⛔ 单开卡） */
            if ((loadState().echoes || []).some((e2) => e2 && (String(e2.eventId) === String(h.id) || String(e2.title || '').indexOf(trimText(h.name)) >= 0))) {
                title.appendChild(el('span', 'wxg-badge is-ok', '已承接'));
            }
            main.appendChild(title);
            // 第二行：到点条件 ／ 现在到哪一步（空值写"暂无"，⛔ 不隐身）
            const bits = [];
            bits.push('到点：' + (trimText(h.trigger) || '暂无'));
            bits.push('走到：' + (trimText(h.note) || '暂无'));
            main.appendChild(el('div', 'wxg-r-sub', bits.join(' · ')));
            r.appendChild(main);
            const act = el('div', 'wxg-r-act');
            /*
             * ★ [321]：有悬浮框的旁边不需要编辑 —— 行上只留「删」（与局势行同）。
             *   改阶段／因果一律进浮层右上 ⋮（或浮层底阶段下拉）✓
             */
            act.appendChild(button('删', 'del-hidden', 'wxg-btn-xs', h.id));
            r.appendChild(act);
            hid.appendChild(r);
        }
    }
    cHid.appendChild(hid);

    const addHidRow = row(cHid,
        textInput('wxg-new-hidden', '', '新暗线名字', 'noop', 'wxg-short'),
        textInput('wxg-new-hidden-trigger', '', '挂在什么时间／条件（例：晚上／三天后）', 'noop', 'wxg-short'),
        // ⭐ 火候与族类**给她选**（原来写死"几天内／冲突型"）——近的快推、远的慢炖，是她自己的节奏
        select('wxg-new-hidden-tier', TIERS.map((x) => ({ value: x, label: x })), '几天内', 'noop'),
        select('wxg-new-hidden-kind', [
            { value: 'conflict', label: '冲突型（萌芽→发酵→逼近→爆发→消散）' },
            { value: 'progress', label: '推进型（筹备→执行→关键→完成）' },
        ], 'conflict', 'noop'),
        button('加一条暗线', 'add-hidden', 'wxg-primary'));
    if (addHidRow.classList && typeof addHidRow.classList.add === 'function') {
        addHidRow.classList.add('wxg-add-row');
    } else {
        addHidRow.className += ' wxg-add-row';
    }
    /*
     * ⭐ LY7（材料 11·布局层）：**这一行单独给个类，好把它排成两栏** ✓
     *   旧：5 个控件（名字／条件／火候／族类／按钮）塞在同一个 .wxg-row 里 ✗
     *     ⇒ 常规宽度下必然断成两行，且第二行与第一行**左边缘不对齐** ✗
     *   现在：给它一个独有类 ✓（⛔ 动 .wxg-add-row 本身 ✗ —— 那会连带别的“加一条”行 ✗）
     */
    if (addHidRow.classList && typeof addHidRow.classList.add === 'function') {
        addHidRow.classList.add('wxg-add-row-hidden');
    }
    addHidRow.setAttribute('data-no-lock', '1');
    box.appendChild(cHid);
    /* ⑤ 记忆状态（只给数字与容量，⛔ 把正文搬进来 ✗） */
    box.appendChild(el('div', 'wxg-note wxg-sec-head', '⑤ 记忆状态'));
    const cMem = card('记忆');
    {
        const st2 = loadState();
        const chronN = (st2.chronicle || []).length;
        const tombN = (st2.world.hiddenTombstones || []).length;
        const atF = Number((st2.pipeline || {}).atFloor);
        const luF = Number((st2.lastUpdate || {}).floor);
        cMem.appendChild(el('div', 'wxg-note',
            '编年 ' + String(chronN) + ' 条（容量锁 ' + String(getSettings().capChronicle) + '）'
            + '；暗线碑 ' + String(tombN) + ' 条'
            + '；上次更新停在第 ' + String(Number.isFinite(luF) ? luF : -1) + ' 楼'
            + '（流水锚点第 ' + String(Number.isFinite(atF) ? atF : -1) + ' 楼）。'));
    }
    box.appendChild(cMem);
    /* 74：世界状态页每张卡默认只给标题行 */
    const stW = loadState();
    for (const c of asArray(box.querySelectorAll('.wxg-card'))) {
        foldCard({ card: c, doc: document, line: cardLine((c.querySelector('.wxg-card-h') || {}).textContent || '', stW) });
    }
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
        box.appendChild(heroEmpty('名册还是空的：去「人物名册」从世界书读人，或点下面一键立起预设名册。', '一键盘入预设名册', 'preset-roster', '为什么会自动有：每次更新会把正文里出场的人认进来，也会从世界书读一遍。'));
        host.appendChild(box);
        return;
    }

    /* ---- 工具条：搜索 ＋ 排序 ＋ 计数 ---- */
    const tools = el('div', 'wxg-ctools');
    const search = document.createElement('input');
    search.type = 'search';
    search.id = 'wxg-char-search';
    search.className = 'wxg-pole wxg-search';
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

    /*
     * ⭐ 表格里的一个格子：**只读文字**（复核方："不点是只读，改不了免得弄错"）。
     *    改在哪儿？⏐ 在明细行里（点行才出来）—— 跟她自家「记忆图鉴」一个路子。
     *    ⏐ 不能再把输入框摆在格子里：七列全是一模一样的空框 ⇒ 看着像没填完的表单。
     */
    const cell = (c, key, fallback) => {
        const td = document.createElement('td');
        if (key === 'current') {
            td.className = 'wxg-cur-cell';
        }
        const v = trimText(c[key]);
        td.appendChild(el('span', v ? 'wxg-cellv' : 'wxg-cellv wxg-none', v || (fallback || '暂无')));
        return td;
    };

    for (const c of rows) {
        const tr = document.createElement('tr');
        /*
         * ⭐ 整行可点 ⇒ 展开明细（那儿才能改）。
         *    ⏐ 不在行里摆编辑框：表格一眼扫过去要能读，不是一堆空框。
         */
        tr.setAttribute('data-action', 'toggle-cdetail');
        tr.className = 'wxg-crow is-click';
        tr.setAttribute('data-id', c.id);
        // 搜索用的"底稿"（搜的时候只切 class，⛔ 不重画页面，才不会打断她打字）
        tr.setAttribute('data-search', asText([
            c.name, (c.aliases || []).join(' '), c.identity, c.faction, c.timePlace, c.current, c.affinity,
            (c.quests || []).map((q) => q.title).join(' '),
        ].join(' ')).toLowerCase());
        tr.setAttribute('data-id', c.id);

        /*
         * 名字这一格：**名字一行、状态章一行**（参照观棋「角色与势力」：名字底下挂章）。
         *    ⏐ 原来名字、四五个章、一颗「明细」按钮全挤在一行 ⇒ 挤成一团。
         */
        const nameTd = document.createElement('td');
        const nameCell = el('div', 'wxg-cname-cell');
        const nameLine = el('div', 'wxg-cname-line');
        nameLine.appendChild(el('span', 'wxg-cname', trimText(c.name) || '（没名字）'));
        nameLine.appendChild(el('span', 'wxg-r-caret', '›'));
        nameCell.appendChild(nameLine);
        const chipLine = el('div', 'wxg-cchips');
        if (c.isPlayer) {
            chipLine.appendChild(el('span', 'wxg-badge is-ok', '玩家棋子'));
            /* ★ B1：六档名册——名册行上就能看出他算哪一档（可改：浮层人物卡里的「档位（六档）」下拉） */
            {
                const roleNow = trimText(c.role);
                if (roleNow) {
                    const roleTone = (roleNow === '主要' || roleNow === '常联系') ? 'is-ok'
                        : (roleNow === '路过' || roleNow === '不用') ? 'is-off' : 'is-info';
                    chipLine.appendChild(el('span', 'wxg-badge ' + roleTone, roleNow));
                }
            }
        }
        if (c.inScene) {
            chipLine.appendChild(el('span', 'wxg-badge is-info', '在现场'));
        }
        if (c.isNew) {
            chipLine.appendChild(el('span', 'wxg-badge is-warn', '新认的人'));
        }
        if (c.manual) {
            chipLine.appendChild(el('span', 'wxg-badge is-warn', '已手动修改'));
        }
        /* ⚠️ 材料 06【4】#4 的“看得见”那半**本来就有** ✓
         *   （下面那行 `.wxg-badge is-off` 就是它 ✗ → 我刚才重复加了一颗，已删 ✓）
         *   剩下的“**没有任何按钮能把 ignored 改回 false**”那半留到下一步 ✓ */
        if (c.currentSuspect) {
            chipLine.appendChild(el('span', 'wxg-badge is-warn', '⚠ 不可靠'));
        }
        if (c.ignored) {
            chipLine.appendChild(el('span', 'wxg-badge is-off', '已忽略'));
        }
        /*
         * ⭐ 材料 06【4】#3＋#4：**「收下／忽略／恢复」要摆在她点得到的地方** ✓
         *   旧：这三个动作（accept-new／ignore-char／merge-into）只写在**已停用的旧「角色状态」页**里 ✗
         *     ⇒ 她在新名册里**根本点不到「收下」「忽略」** ✗；被忽略了也**没有任何按钮能恢复** ✗
         */
        if (c.isNew) {
            chipLine.appendChild(button('收下', 'accept-new', 'wxg-btn-xs', c.id));
        }
        if (c.ignored) {
            chipLine.appendChild(button('恢复参与推演', 'unignore-char', 'wxg-btn-xs', c.id));
        } else {
            chipLine.appendChild(button('忽略这条', 'ignore-char', 'wxg-btn-xs', c.id));
        }
        if (chipLine.childNodes && chipLine.childNodes.length) {
            nameCell.appendChild(chipLine);
        }
        nameTd.appendChild(nameCell);
        tr.appendChild(nameTd);

        tr.appendChild(cell(c, 'age'));
        tr.appendChild(cell(c, 'identity'));
        tr.appendChild(cell(c, 'faction'));
        const affTd = cell(c, 'affinity');
        affTd.title = trimText(c.affinitySource) ? ('读自：' + trimText(c.affinitySource)) : '没接数据源（引擎不自己编）';
        tr.appendChild(affTd);
        tr.appendChild(cell(c, 'timePlace'));
        tr.appendChild(cell(c, 'current', '（本回合没写他）'));
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

        /*
         * ⭐ 可改的五个字段在**这儿**（点开这一行才出来）。
         *    主行那八格已经改成只读文字：表格一眼扫过去要能读。
         *    ⏐ 这里的 id / data-action / data-key 跟以前一模一样（用例和事件都不用改）。
         */
        const editBox = el('div', 'wxg-field');
        editBox.appendChild(el('label', null, '改他的状态（改完自动存）'));
        const editGrid = el('div', 'wxg-cedit');
        const mkEdit = (key, placeholder, isArea) => {
            const wrap = el('div', 'wxg-cedit-item');
            wrap.appendChild(el('span', 'wxg-cedit-k', key === 'timePlace' ? '时间・地点' : ({
                age: '年龄', identity: '身份', faction: '所在势力', current: '正在经历',
            }[key] || key)));
            const inp = isArea
                ? textarea('wxg-c-' + key + '-' + c.id, c[key], placeholder, 'set-char-field', 2)
                : textInput('wxg-c-' + key + '-' + c.id, c[key], placeholder, 'set-char-field');
            inp.setAttribute('data-id', c.id);
            inp.setAttribute('data-key', key);
            wrap.appendChild(inp);
            return wrap;
        };
        editGrid.appendChild(mkEdit('age', '几岁'));
        editGrid.appendChild(mkEdit('identity', '是什么'));
        editGrid.appendChild(mkEdit('faction', '所属'));
        editGrid.appendChild(mkEdit('timePlace', '例：第二天 上午 · 学校'));
        editBox.appendChild(editGrid);
        const curWrap = el('div', 'wxg-cedit-item is-wide');
        curWrap.appendChild(el('span', 'wxg-cedit-k', '正在经历'));
        const curArea = textarea('wxg-c-current-' + c.id, c.current,
            '本回合正在发生的事（只写这一步、只写他自己）', 'set-char-field', 2);
        curArea.setAttribute('data-id', c.id);
        curArea.setAttribute('data-key', 'current');
        curWrap.appendChild(curArea);
        editGrid.appendChild(curWrap);
        detail.appendChild(editBox);
        /*
         * 依据＝阿砚第三批 硬-6：锁住的格不让改，但要**就地看见“本来会改成什么”**，
         *   ⛔ 只在 console/一句 conflicts 里丢掉。看完她可以选“用它的”（采用）或“不用”（丢掉这条待定），锁不解除。
         */
        {
            const pend = overlayPending(c.id);
            if (pend.length) {
                const ob = el('div', 'wxg-field');
                ob.appendChild(el('label', null, '引擎想改但被你锁着的格（它没动）'));
                for (const pd of pend.slice(0, 4)) {
                    const r = el('div', 'wxg-card-actions');
                    const where = (Number(pd.floor) >= 0) ? '（第 ' + String(pd.floor) + ' 楼）' : '';
                    r.appendChild(el('span', 'wxg-note', String(pd.field) + ' → ' + String(pd.wouldBe).slice(0, 60) + where));
                    r.appendChild(button('用它的', 'accept-overlay', 'wxg-btn-sm', String(c.id) + '|' + String(pd.field)));
                    r.appendChild(button('不用', 'dismiss-overlay', 'wxg-btn-xs', String(c.id) + '|' + String(pd.field)));
                    ob.appendChild(r);
                }
                detail.appendChild(ob);
            }
        }

        if (c.currentSuspect) {
            const warn = el('div', 'wxg-store', '⚠ 这条「正在经历」引擎判定**不可靠**：'
                + (trimText(c.currentSuspectWhy) || '疑似越界')
                + '　⇒ 已标出来、但没擅自改它，你看着办（下一步该由你回话决定）');
            warn.setAttribute('data-tone', 'bad');
            detail.appendChild(warn);
        }
        /* 102：最近和谁通过消息（≤5 条；没有就不显示这块） */
        {
            const myThreads = (loadState().threads || []).filter((th) => th && (th.members || []).includes(trimText(c.name)));
            const msgs = [];
            for (const th of myThreads) {
                for (const m of (th.messages || [])) {
                    if (m && (m.from === trimText(c.name) || (th.members || []).includes(m.from))) { msgs.push(m); }
                }
            }
            msgs.sort((a2, b2) => (Number(b2.at) || 0) - (Number(a2.at) || 0));
            if (msgs.length) {
                const mb = el('div', 'wxg-field');
                mb.appendChild(el('label', null, '最近和谁通过消息'));
                for (const m of msgs.slice(0, 5)) {
                    const th = myThreads.find((x) => (x.messages || []).includes(m)) || {};
                    const other = (th.members || []).find((x) => x !== trimText(c.name)) || '';
                    mb.appendChild(el('div', 'wxg-fact', '· ' + (other || m.from) + '　「' + trimText(m.text).slice(0, 40) + '」'));
                }
                detail.appendChild(mb);
            }
        }
        const past = el('div', 'wxg-field');
        past.appendChild(el('label', null, '过去经历（由近到远，旧的自然淡化）'));
        const pastBox = el('div', 'wxg-list');
        if (!c.past.length) {
            pastBox.appendChild(el('div', 'wxg-empty', '还没有'));
        } else {
            /* ⭐ 材料 06【4】：**过去经历要能改能删** ✓（编辑态每条带「删」 ✓） */
            c.past.forEach((p, pi) => {
                const prow = el('div', 'wxg-fact', '· ' + p.text + (p.manual ? '（已手动修改）' : ''));
                if (personCardEditing) {
                    const pdel = button('删', 'del-past', 'wxg-btn-xs', c.id);
                    pdel.setAttribute('data-index', String(pi));
                    prow.appendChild(pdel);
                }
                pastBox.appendChild(prow);
            });
        }
        past.appendChild(pastBox);
        if (personCardEditing) {
            const pAdd = el('div', 'wxg-rowitem');
            const pTxt = el('input', 'wxg-pc-input');
            pTxt.type = 'text';
            pTxt.id = 'wxg-past-text';
            pTxt.placeholder = '加一条过去经历（一句话）';
            pAdd.appendChild(pTxt);
            pAdd.appendChild(button('加一条', 'add-past', 'wxg-btn-sm', c.id));
            past.appendChild(pAdd);
        }
        detail.appendChild(past);

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
                st.className = 'wxg-pole wxg-btn-sm';
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
                /* ⭐ 材料 06【4】：**任务子项要能勾 / 取消** ✓
                 *   旧：子项一次性拼成**一段文字** ✗ ⇒ 点不了、改不了 ✗
                 *   现在：编辑态下**每个子项一颗可点的钮** ✓（▶ ⇄ ☑）；只读态照旧只看 ✓ */
                if (Array.isArray(q.items) && q.items.length) {
                    const qiRow = el('div', 'wxg-fact');
                    q.items.forEach((it, ii) => {
                        const mark = it.done ? '☑ ' : '▶ ';
                        if (personCardEditing) {
                            const qib = button(mark + trimText(it.text), 'toggle-quest-item', 'wxg-btn-xs', one.id);
                            qib.setAttribute('data-title', trimText(q.title));
                            qib.setAttribute('data-index', String(ii));
                            qib.title = it.done ? '点一下：取消已完成' : '点一下：标成已完成';
                            qiRow.appendChild(qib);
                        } else {
                            qiRow.appendChild(el('span', null, mark + trimText(it.text) + '　'));
                        }
                    });
                    qr.appendChild(qiRow);
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
    const twrap = el('div', 'wxg-ctablewrap');
    twrap.appendChild(table);
    box.appendChild(twrap);
    box.appendChild(el('div', 'wxg-note',
        '一行一个人：名字／年龄／身份／所在势力／好感／时间・地点／正在经历，点行展开明细即可修改；'
        + '改过的会显示「已手动修改」，下一轮更新不许冲掉。'
        + '搜索只筛显示，不动数据。'));
    host.appendChild(box);

    applyCharSearch(host, charSearch.query);
}

/**
 * ⭐ 每段一个保存（她拍的："每个大标题的这个地方直接加一个保存得了，弄完设定整页保存"）。
 *
 * 为什么要这样：原来一个段里散着好几个"保存"（提取名单／排除名单／条目名单…），
 * 点一下还立刻生效 ⇒ 点错、面板跳、按钮一片。现在：
 *   · 段里所有改动先落进**这一段的草稿**（`staging[段] = {键: 值}`）；
 *   · 段底**一个**「保存」把它整段提交；旁边显示"改了几处"；
 *   · 想退回 ⇒「撤销」把草稿丢掉（回到已存的）。
 */
/*
 * ⚠️ 草稿**按宿主各存一份**（'workspace' / 'panel' / 'settings'）。
 *    原来是全局共用一个 staging ⇒ 工作台和浮层面板**互相冲**：
 *    在工作台填好地址、却点了面板那份「保存」⇒ 面板那份草稿是空的，
 *    提交下去就把刚填的**冲成空值**（真机上量到过 api.url 变 ""）。
 */
const stagingByMode = {};
/* 110：上一次没保存的草稿（浏览器里那份） */
try {
    if (typeof localStorage !== 'undefined') {
        const rawDrafts = localStorage.getItem('wxg-drafts-v1');
        if (rawDrafts) {
            const parsed = JSON.parse(rawDrafts);
            for (const k of Object.keys(parsed || {})) { stagingByMode[k] = parsed[k]; }
        }
    }
} catch (eLS2) { /* 坏了就当没有 */ }

/** 当前正在画／正在处理的是哪一个宿主（⛔ 只用来分草稿，不参与别的判断） */
/**
 * 依据＝阿砚 3-d：偶发红要能在一次失败里拿到时序。默认静默；
 * 显式开关（WXG_DEBUG=1 或 globalThis.__WXG_DEBUG__）才打日志。
 */
const WXG_DBG = (typeof process !== 'undefined' && process && process.env && process.env.WXG_DEBUG === '1')
    || (typeof globalThis !== 'undefined' && globalThis.__WXG_DEBUG__ === true);

let stagingMode = 'settings';
/*
 * 依据＝阿砚 3-d: 偶发红取证（[pick]/[commit] 日志）：点击链本身对，红在“保存没写进去”。
 *   根因假设：`stage()` 用的池由当次事件的 host 决定，而 `commitSection()` 用的是**保存那一刻**的全局
 *   `stagingMode` —— 两处若落在不同池，保存就“读到空 box、写完什么也没有”，而且行为随重画时机漂移。
 *   ⇒ 记下“这一段草稿是在哪个池里建的”，保存与读值都认这个记录（⛔ 再各自读全局）。
 */
const stageModeOf = new Map();   // secId -> 建草稿时用的池

/** 这一段该用哪个池：有记录就按记录，没有才退回当前全局 */
function modeForSection(secId) {
    const m = stageModeOf.get(secId);
    return m || stagingMode;
}

function stagingOf(mode) {
    const m = asText(mode) || 'settings';
    if (!stagingByMode[m]) {
        stagingByMode[m] = {};
    }
    return stagingByMode[m];
}

/** 记一笔草稿（⛔ 不落设置）；同一段同一键只留最后一次 */
function stage(secId, key, value) {
    const store = stagingOf(stagingMode);
    const box = store[secId] || (store[secId] = {});
    box[key] = value;
    stageModeOf.set(secId, stagingMode);
    /* 110：草稿也存一份在浏览器里 ⇒ 刷新不丢（落盘仍只靠「保存」） */
    try {
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem('wxg-drafts-v1', JSON.stringify(stagingByMode));
        }
    } catch (eLS) { /* 存不了也不能拦着画界面 */ }
}

/** 这一段草稿里有几处改动 */
function stagedCount(secId) {
    const box = stagingOf(modeForSection(secId))[secId];
    return box ? Object.keys(box).length : 0;
}

/** 这一段某个键的"当前显示值"（草稿优先，其次已存） */
function stagedValue(secId, key, fallback) {
    const box = stagingOf(modeForSection(secId))[secId];
    return box && Object.prototype.hasOwnProperty.call(box, key) ? box[key] : fallback;
}

/**
 * 段底那条"保存"（每段都有）。
 * @param {string} secId 段的标识（见各段自己的 id）
 * @param {string} label 按钮文字（默认"保存"）
 */
function saveBar(secId, label) {
    const n = stagedCount(secId);
    const bar = el('div', 'wxg-savebar' + (n ? ' has-changes' : ''));
    bar.setAttribute('data-id', secId);
    const note = el('span', 'wxg-savebar-note',
        n ? ('改了 ' + String(n) + ' 处（还没保存）') : '这一段没有未保存的改动');
    bar.appendChild(note);
    if (n) {
        bar.appendChild(button('撤销', 'discard-section', 'wxg-btn-sm', secId));
    }
    bar.appendChild(button(label || '保存', 'save-section', n ? 'wxg-primary' : 'wxg-btn-sm', secId));
    return bar;
}

/** 把这一段的草稿落进设置 */
function commitSection(secId) {
    const box = stagingOf(modeForSection(secId))[secId];
    if (WXG_DBG) {
        try {
            console.info('[wanxiangge][commit] sec=' + String(secId) + ' mode=' + String(stagingMode)
                + ' keys=' + JSON.stringify(box ? Object.keys(box) : [])
                + ' vals=' + JSON.stringify(box ? Object.keys(box).reduce((o, k) => { o[k] = String(box[k] == null ? '' : box[k]).slice(0, 30); return o; }, {}) : {}));
        } catch (eDbg2) { /* 日志不影响保存 */ }
    }
    if (!box || !Object.keys(box).length) {
        return 0;
    }
    const patch = {};
    for (const k of Object.keys(box)) {
        if (k === 'appearance' && box[k] && typeof box[k] === 'object') {
            /*
             * ⭐ 复审追加 3①：**这里得用 `patch.appearance` 打底**，而且**关键序**。
             *   病根：同一轮草稿里**先取消勾选、再改色板**时，循环先走 `applyToPanel` 分支
             *   （折好了 `patch.appearance.applyToPanel=false`），紧接着走这个分支——
             *   原来直接 `getSettings().appearance` 做底 ⇒ **把刚折好的那一笔盖回去**；
             *   而 `box[k]`（改色板时的基底）里还带着旧的 `applyToPanel: true`。
             *   ⇒ 用 `patch.appearance ||` 打底，并**只要 box 里有 `applyToPanel` 就再校正一次**（⛔ 论键序）。
             */
            patch.appearance = Object.assign({},
                patch.appearance || getSettings().appearance || {},
                box[k]);
            if (Object.prototype.hasOwnProperty.call(box, 'applyToPanel')) {
                patch.appearance.applyToPanel = box.applyToPanel === true;
            }
            continue;
        }
        /*
         * ⭐ 复审追加 2（A3 写入层）：**`applyToPanel` 要折进 `appearance` 里**，⛔ 落顶层。
         *   根因：读侧 `theme.resolveAppearance()` 读的是 **`settings.appearance.applyToPanel`**，
         *   而这里原来走 `patch[k] = box[k]` ⇒ 写进了**顶层** `settings.applyToPanel`（**没人读的那格**）
         *   ⇒ 她「取消勾选 + 保存」后，读侧那格**仍是 true** ⇒ 小框照样被染色（"跟随酒馆主题"实际不生效）。
         *   ⚠️ 正因为读不到，我 A3 那次修的"清除"**根本没被触发**——两轮人工复核都漏了这一格，
         *     最后是**真机 playwright 实点**才抓出来的（所以"假机全绿"不等于"真机对"）。
         *   ⛔ 不动顶层那个历史遗留字段（留着无副作用，属清单外）。
         */
        if (k === 'applyToPanel') {
            patch.appearance = Object.assign({},
                patch.appearance || getSettings().appearance || {},
                { applyToPanel: box[k] === true });
            continue;
        }
        if (k === 'api' && box[k] && typeof box[k] === 'object') {
            patch.api = Object.assign({}, getSettings().api || {}, box[k], patch.api || {});
            continue;
        }
        /*
         * ⭐ B10（材料 14 · 代拍 A）：**「不读」表落盘时写进「当前这本书」那一格** ✓
         *   随点随存会串味：换过书之后行为不对，几乎想不到是上一本的不读表还在 ✗
         *   同时把老的共用表清空 ✓（迁移已在 worldbook.migrateExcludeToPerBook 做过 ✓）
         */
        if (k === 'excludeEntries' && secId === 'extract') {
            const bookNow = trimText(pickBook);
            if (bookNow) {
                const byBookOld = (getSettings().excludeEntriesByBook && typeof getSettings().excludeEntriesByBook === 'object')
                    ? getSettings().excludeEntriesByBook : {};
                patch.excludeEntriesByBook = Object.assign({}, byBookOld, { [bookNow]: asText(box[k]) });
                patch.excludeEntries = '';
            } else {
                patch[k] = box[k];
            }
            continue;
        }
        if (API_KEYS.includes(k)) {
            patch.api = Object.assign({}, getSettings().api || {}, patch.api || {}, { [k]: box[k] });
        } else {
            patch[k] = box[k];
        }
    }
    delete stagingOf(modeForSection(secId))[secId];
    patchSettings(patch);
    /*
     * ⭐ 复审追加 3②：**外观段存完立刻刷小框**。
     *   病根：这里只 `patchSettings`（重画走的是工作台／设置区那条路），而 `closeWorkspace()`
     *   也只把 `mini.style.display` 放回来——**两边都没人碰小框** ⇒ 她「取消勾选 + 保存」后
     *   **不动任何东西**读小框，`--wxg-surface` 还是旧的（要等下次切档／发消息才清）。
     *   ⇒ 这一段存完就补一次（⛔ 不是每个段都刷：别的段跟小框无关，白刷一遍）。
     */
    if (secId === 'appearance') {
        try {
            refreshMini();
        } catch (e) {
            console.warn('[万象阁] 存完外观没刷上小框：', e);
        }
    }
    return Object.keys(box).length;
}

/** 走 api 那一格的键（保存时归到 api 下面） */
const API_KEYS = ['mode', 'url', 'key', 'model', 'modelCheap', 'temperature', 'maxTokens', 'materialCap', 'autoRetryMax', 'currentProfile'];

/**
 * ⭐⭐ 谷歌方案 A（她 2026-10-17 选定）：**DOM 即真相** ✓
 *   把当前面板 DOM 里填着的 API 各项**直接收拢并落盘** ✓
 *   为什么要有它：她填完地址/密钥/模型，可能还没点空白处失焦（或面板刚重画过 ✗），
 *   就直接点「测一下连接」「拉取模型」「另存为书签」或「保存」——
 *   这时候直接从当前面板的输入框读现值并落盘，100% 所见即所得，绝不绕弯 ✓
 *   （⛔ 不能只依赖“失焦时的 change 事件”——那只覆盖一种情形 ✗）
 */
function syncApiFromDom(host) {
    if (!host || typeof host.querySelector !== 'function') {
        return;
    }
    const cur = Object.assign({}, getSettings().api || {});
    const draft = (stagingOf(stagingMode) && stagingOf(stagingMode).api) || {};
    for (const k of Object.keys(draft)) {
        if (k === 'api' && draft.api && typeof draft.api === 'object') {
            Object.assign(cur, draft.api);
        } else if (API_KEYS.includes(k)) {
            cur[k] = draft[k];
        }
    }
    const readVal = (id) => {
        const elNode = host.querySelector('#' + id);
        return elNode && typeof elNode.value === 'string' ? elNode.value : null;
    };
    const modeVal = readVal('wxg-api-mode');
    if (modeVal !== null && modeVal.indexOf('profile:') !== 0) {
        cur.mode = trimText(modeVal) === 'direct' ? 'direct' : 'proxy';
    }
    const urlVal = readVal('wxg-api-url');
    if (urlVal !== null) { cur.url = trimText(urlVal); }
    const keyVal = readVal('wxg-api-key');
    if (keyVal !== null) { cur.key = trimText(keyVal); }
    const modelVal = readVal('wxg-api-model');
    if (modelVal !== null) { cur.model = trimText(modelVal); }
    const cheapVal = readVal('wxg-api-model-cheap');
    if (cheapVal !== null) { cur.modelCheap = trimText(cheapVal); }
    const tempVal = readVal('wxg-api-temp-code');
    if (tempVal !== null && trimText(tempVal) !== '') { cur.temperature = Number(tempVal); }
    const maxTokVal = readVal('wxg-api-maxtok');
    if (maxTokVal !== null && trimText(maxTokVal) !== '') { cur.maxTokens = Number(maxTokVal); }
    const matCapVal = readVal('wxg-api-material-cap');
    if (matCapVal !== null && trimText(matCapVal) !== '') { cur.materialCap = Number(matCapVal); }
    const retryVal = readVal('wxg-auto-retry-max');
    if (retryVal !== null && trimText(retryVal) !== '') { cur.autoRetryMax = Number(retryVal); }
    /* ★ 20261023 她拍板的三格：不读的话存不进去 ✗ */
    const extraBodyVal = readVal('wxg-api-extra-body');
    if (extraBodyVal !== null) { cur.extraBody = String(extraBodyVal); }
    const excludeBodyVal = readVal('wxg-api-exclude-body');
    if (excludeBodyVal !== null) { cur.excludeBody = String(excludeBodyVal); }
    const extraHeadersVal = readVal('wxg-api-extra-headers');
    if (extraHeadersVal !== null) { cur.extraHeaders = String(extraHeadersVal); }

    for (const m of Object.keys(stagingByMode)) {
        if (stagingByMode[m]) {
            delete stagingByMode[m].api;
        }
    }
    patchSettings({ api: cur });
}

/**
 * ⭐ `stage-*` 动作总表：动作名 → [这一段, 设置键, 取值方式]。
 * 有了它，各处控件只要把 `set-xxx` 写成 `stage-xxx` 就进了草稿，⛔ 不用每个都写一个 case。
 */
const STAGE_MAP = {
    'stage-auto-update': ['general', 'autoUpdate', 'checked'],
    'stage-update-every': ['general', 'updateEvery', 'value'],
    /* 补推范围也走草稿；这个键必须在表里，否则输入先被通用分支接走、switch 里那段永远走不到 ✓ */
    'stage-backfill-n': ['general', 'backfillN', 'value'],
    'stage-protected': ['general', 'protectedBypass', 'checked'],
    'stage-strict': ['general', 'strictMention', 'checked'],
    'stage-panel-on-start': ['general', 'showPanelOnStart', 'checked'],
    'stage-app-to-panel': ['appearance', 'applyToPanel', 'checked'],
    'stage-layout-mode': ['appearance', 'layoutMode', 'value'],
    'stage-recent-turns': ['recall', 'recentTurns', 'value'],
    'stage-cap-people': ['recall', 'capPeople', 'value'],
    'stage-max-events': ['recall', 'maxEvents', 'value'],
    'stage-cap-past': ['recall', 'capPast', 'value'],
    'stage-cap-events': ['recall', 'capEvents', 'value'],
    'stage-cap-hidden': ['recall', 'capHidden', 'value'],
    'stage-cap-chronicle': ['recall', 'capChronicle', 'value'],
    'stage-past-floor-cut': ['recall', 'pastFloorCut', 'value'],
    'stage-inject-cap': ['recall', 'injectCharCap', 'value'],   /* ★ 20261022 回归：这格被洗掉过，改了不保存 */
    'stage-max-parallel': ['recall', 'maxParallelChars', 'value'],
    'stage-sort-mode': ['recall', 'sortMode', 'value'],
    'stage-card': ['recall', 'cardEnabled', 'checked'],
    'stage-show-empty': ['recall', 'showEmptyCard', 'checked'],
    'stage-api-mode': ['api', 'mode', 'value'],
    'stage-api-url': ['api', 'url', 'value'],
    'stage-api-key': ['api', 'key', 'value'],
    'stage-api-model': ['api', 'model', 'value'],
    'stage-api-model-cheap': ['api', 'modelCheap', 'value'],
    'stage-api-temp': ['api', 'temperature', 'value'],
    'stage-api-maxtok': ['api', 'maxTokens', 'value'],
    'stage-api-extra-body': ['api', 'extraBody', 'value'],
    'stage-api-exclude-body': ['api', 'excludeBody', 'value'],
    'stage-api-extra-headers': ['api', 'extraHeaders', 'value'],
    'stage-api-material-cap': ['api', 'materialCap', 'value'],
    'stage-auto-retry-max': ['api', 'autoRetryMax', 'value'],
    'stage-extract-tags': ['extract', 'extractTags', 'value'],
    'stage-exclude-tags': ['extract', 'excludeTags', 'value'],
    'stage-extract-books': ['extract', 'extractBooks', 'value'],
    'stage-exclude-books': ['extract', 'excludeBooks', 'value'],
    'stage-affinity-source': ['extract', 'affinitySource', 'value'],
    /* ⭐ ST4-A：剥壳两个勾选框也归草稿 ✓ */
    'stage-strip-paired': ['extract', 'stripPairedBlocks', 'checked'],
    'stage-strip-comments': ['extract', 'stripHtmlComments', 'checked'],
    'stage-only-enabled': ['extract', 'onlyEnabledEntries', 'checked'],
    'stage-inject-header': ['prompts', 'injectHeader', 'value'],
    'stage-prompt-world': ['prompts', 'promptWorld', 'value'],
    'stage-prompt-chars': ['prompts', 'promptChars', 'value'],
    'stage-jailbreak': ['prompts', 'jailbreak', 'value'],
};

/** 把一处改动收进草稿（通用入口；⛔ 不落设置） */
/**
 * ⭐ 修复单 #35：当前**生效**的外观——草稿优先、没草稿才用已存的。
 *   为什么要这么一个口径：外观是"整块存"的，而她**连改几槽**时
 *   每一槽都得以**前面那几槽的草稿值**为基底 ⇒ ⛔ 就会互冲。
 */
function effectiveAppearance() {
    const box = stagingOf(stagingMode).appearance;
    const draft = box && box.appearance;
    if (draft && typeof draft === 'object') {
        return draft;
    }
    return getSettings().appearance || {};
}

/** 把页面上已经在的预览盒重新上色（⛔ 重画整页：那会把她正在拖的滑杆弄没） */
function refreshAppearancePreview() {
    try {
        const nodes = document.querySelectorAll('[data-role="app-preview"]');
        for (const node of Array.from(nodes)) {
            applyAppearance(node, effectiveAppearance());
        }
    } catch (e) {
        console.warn('[万象阁] 预览盒没刷新：', e);
    }
}

/**
 * ⭐ ST4-A：走草稿的同时，**少数几个开关仍要给一句反馈** ✓
 *   （p3 字面要求：剥壳两个开关“也有反馈” ✓；其余格子靠保存条变色就够 ✓）
 *   ⛔ 每个格子都弹一句（那样弹得没完没了 ✗）
 */
function stageFeedback(action, target) {
    if (action === 'stage-strip-paired') {
        /* ⚠️ 消息里带上控件名：toast 有防抖（同文案会被吞 ✗），两个开关共用一句就会只响一次 ✗ */
        toast.info('按结构剥壳：' + (target.checked === true
            ? '已勾上（点段底「保存」生效）'
            : '已取消（点段底「保存」生效）'));
        return;
    }
    if (action === 'stage-only-enabled') {
        toast.info('只读开启着的条目：' + (target.checked === true
            ? '已勾上（点段底「保存」生效）'
            : '已取消（点段底「保存」生效）'));
        return;
    }
    if (action === 'stage-strip-comments') {
        toast.info('剥 HTML 注释：' + (target.checked === true
            ? '已勾上（点段底「保存」生效）'
            : '已取消（点段底「保存」生效）'));
        return;
    }
}

function stageOne(action, target) {
    /*
     * ⚠️ 真机探针定案（第 21 轮）：这段原本挂在 STAGE_MAP 那行之前 ✗，
     *   而 stageOne 里更早的一处分支已经把 stage-api-mode 处理完并 return 了 ✗
     *   ⇒ 改了三版都没生效，就是因为改的是执行不到的代码 ✗
     *   ⇒ 现在放到函数最前面，一定会被执行到 ✓
     */
    if (action === 'stage-api-mode' && trimText(target.value).indexOf('profile:') === 0) {
        const wantNick = trimText(target.value).slice('profile:'.length);
        const curApi = getSettings().api || {};
        const one = (Array.isArray(curApi.profiles) ? curApi.profiles : []).find((x) => (trimText(x && x.nick) || trimText(x && x.name)) === wantNick);
        if (one) {
            const copy = {};
            for (const k of Object.keys(one)) {
                if (k !== 'nick') { copy[k] = one[k]; }
            }
            stage('api', 'api', Object.assign({}, curApi, copy, { currentProfile: wantNick }));
            commitSection('api');
            toast.ok('已切到书签「' + wantNick + '」（连接方式／地址／模型都换成它那一套了）');
        } else {
            toast.warn('没找到书签「' + wantNick + '」（可能刚被删了）');
        }
        /* ⚠️ 这里⛔ 不能调 rerender：它是 bindSectionEvents 里的局部函数，stageOne 看不见 ✗
         *   （真机抓到：rerender is not defined ⇒ 被吞 ⇒ 界面毫无反应）
         *   ⇒ 改成返回哨兵值，由 handler（它能看见 rerender ✓）去重画 ✓ */
        return 'api-profile-switched';
    }
    /*
     * ⭐ 选的是内置两条（直连／经酒馆转发）⇒ 只把“当前书签”清掉（下拉框就不再显示旧书签了 ✓）
     *   ⛔ 不碰老路：mode 的暂存照旧走下去（测试也照旧 ✓）
     */
    if (action === 'stage-api-mode' && trimText((getSettings().api || {}).currentProfile)) {
        stage('api', 'api', Object.assign({}, getSettings().api || {}, { currentProfile: '' }));
    }
    if (action === 'stage-appearance') {
        const key = target.id;                        // wxg-app-xxx → 槽位名
        const slot = key.replace('wxg-app-', '');
        /*
         * ⭐ 修复单 #35①：**基底用"草稿里那份"**，⛔ 已存的那份。
         *   原来一律 `getSettings().appearance`：她**连改两槽**（先改色板、再改强调色）时，
         *   第二槽以**不含第一槽暂存**的旧值为基底算 ⇒ **第一槽的改动被冲掉**。
         */
        const cur = effectiveAppearance();
        if (slot === 'palette') {
            stage('appearance', 'appearance', Object.assign({}, cur, palettePatch(trimText(target.value))));
            /*
             * ⭐ ST7（材料 11·设置层）：**换色板 ⇒ 上面 5 个颜色格当场跟着变** ✓
             *   旧：只存草稿 ✗ ⇒ 下拉框切成「暖灯」了、下面预览盒变了 ✗
             *     而上面 5 个颜色框**还显示着砚墨的旧颜色** ✗
             *   现在：把生效值回填进那几个框格 ✓（⛔ 整页重画 ✗ ⇒ 不打断她的操作 ✓）
             */
            try {
                const effNow = effectiveAppearance();
                for (const slotName of ['accent', 'surface', 'bg', 'border', 'text']) {
                    const boxEl = document.getElementById('wxg-app-' + slotName);
                    if (boxEl && typeof boxEl.value === 'string') {
                        boxEl.value = (effNow[slotName] == null ? '' : String(effNow[slotName]));
                    }
                }
            } catch (eSt7a) { /* 回填不了也不能让换色板失效 ✓ */ }
        } else {
            stage('appearance', 'appearance', Object.assign({}, cur, { [slot]: trimText(target.value), palette: 'custom' }));
            /* ⭐ ST7 反向：手改任一槽 ⇒ 色板下拉框**当场切到 custom** ✓ */
            try {
                const palSel = document.getElementById('wxg-app-palette');
                if (palSel && typeof palSel.value === 'string') {
                    palSel.value = 'custom';
                }
            } catch (eSt7b) { /* 同上 ✓ */ }
        }
        /*
         * ⭐ 修复单 #35②：**预览盒要跟着变**。
         *   原来改完只存草稿、预览盒还是旧颜色 ⇒ 她以为"没生效"。
         */
        refreshAppearancePreview();
        return 'appearance';
    }
    /*
     * ⭐⭐ 她 13:xx：在「连接方式」下拉框里选中一个**书签** ⇒ 立刻切到那一套 ✓
     *   （等同点书签卡片上的「切到这套」；两个入口都给，⛔ 不删她已有的路）
     */
    if (action === 'stage-api-mode') {
        const pick = trimText(target.value);
        if (pick.indexOf('profile:') === 0) {
            const wantNick = pick.slice('profile:'.length);
            const cur = getSettings().api || {};
            const one = (Array.isArray(cur.profiles) ? cur.profiles : []).find((x) => (trimText(x && x.nick) || trimText(x && x.name)) === wantNick);
            if (one) {
                const copy = {};
                for (const k of Object.keys(one)) {
                    if (k !== 'nick') { copy[k] = one[k]; }
                }
                stage('api', 'api', Object.assign({}, getSettings().api || {}, copy));
                commitSection('api');
                toast.ok('已切到书签「' + wantNick + '」（连接方式／地址／模型都换成它那一套了）');
            } else {
                toast.warn('没找到书签「' + wantNick + '」（可能刚被删了）');
            }
            rerender();
            return 'api';
        }
    }
    /*
     * ⭐⭐ 在“连接方式”里选中一个**书签** ⇒ 当场切到那一套，并记下“当前就是它” ✓
     *   其余值（direct／proxy）**一律落回原来的暂存路** ✓（⛔ 改老路：上一版就是改了才红的 ✗）
     */
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
 * ⚠️ 要整条重画：改动数一变，「撤销」这颗按钮也得跟着出现／消失。
 */
function refreshSaveBar(host, secId) {
    const bar = host && host.querySelector ? host.querySelector('.wxg-savebar[data-id="' + secId + '"]') : null;
    if (!bar || !bar.parentNode) {
        return;
    }
    const parent = bar.parentNode;
    const fresh = saveBar(secId);
    parent.insertBefore(fresh, bar);
    parent.removeChild(bar);
}

/** ⭐ 读取控制：正在看哪本书的条目（重画后要能自动摆回来，否则点一条之后就没得点了） */
export let pickBook = '';
export let pickEntries = [];
/** 读到的世界书名单（画小块用，⛔ 不反复读世界书） */
const booksCache = createCache('worldbooks');   /* B7：带状态的缓存（hit/miss/empty/broken） */
let listBooksCache = [];   /* 兼容：老代码读它；新代码读 booksCache */
let lastGoodBooks = [];   /* 上一次真读到的书单（读不到时用它先顶着，⛔ 把列表清空） */
/* 依据＝本轮查“首跑红复跑绿”：自动列书的 setTimeout 每次重画都排一个 ⇒ 旧定时器晚到也去点按钮，把列表反复刷新 */
let autoListTimer = null;

/* ⭐ RD1-3（材料 11）：**拉过的模型列表要存下来** ✓（旧：直接塞 DOM，重绘变空盒 ✗） */
let lastModelList = [];

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

/**
 * 编年的筛选（那一排小胶囊）。放在模块级：点一下只重画，不落设置。
 * （"筛选带计数"是跟参照学的**做法**；文案是我们自己的——⛔ 别照抄别家的字。）
 */
let chronFilter = 'all';
/*
 * 依据＝阿砚第三批 质感 A4（编年没有搜索）：编年越攒越多，只能靠翻页找。
 *   加一个搜索词（搜正文／类型／人）；⛔ 落设置，只是“看的姿势”。
 */
let chronSearch = '';
/**
 * ⭐「清空这个世界」的确认盒开着没有。
 * 她拍的：不可逆操作要**写明条数** ＋ **手打「确认清空」**才让点（防误点）。
 */
let clearWorldOpen = false;
/** ⭐ 她 13:xx：钥匙默认遮住；点了「显示」就记住（模块级！⛔ 放进函数里 handler 看不见 ✗） */
let apiKeyShown = false;
/** 要她手打的那四个字（打错就点不动） */
const CLEAR_WORD = '确认清空';
/** 哪一条局势正展开着编辑（-1＝都没展开；行化之后默认收起，⛔ 不再一条占两行） */
let openSituation = -1;

/** 过程报告的筛选（那一排小胶囊）：全部／已注入／未注入／失败 */
let reportFilter = 'all';

/** 现在的进度的筛选：全部／已做／还没做 */
let stepFilter = 'all';
let stepPage = 1;

/** 名册的筛选：全部／玩家棋子／新认的／我改过的 */
let rosterFilter = 'all';

    /** 名册的搜索词（搜“名字或别名”；⛔ 落设置，只是看的姿势） */
    let rosterSearch = '';

/** 名册里哪一个人正展开着编辑（''＝都没展开） */
let openChar = '';

/** 名册/编年的翻页（第几页从 1 数；⛔ 不落设置，只是看的姿势） */
let rosterPage = 1;
let chronPage = 1;

/** 每页几条（名册 20＝差不多一屏；编年 30＝够看一段） */
const PER_PAGE = { roster: 15, chron: 20, steps: 20 };

/**
 * ⭐ 翻页条（对照观棋那张：`‹ 上一页 ｜ 第 1-20 条 · 共 54 条 ｜ 下一页 ›`）。
 *
 * 为什么需要：名册灌到 54 个人之后，一长条滚到底**根本找不着人**——
 * 分页＋筛选＋搜索才是台账该有的用法。编年同理（越攒越多）。
 */
function pager(action, page, per, total) {
    const pages = Math.max(1, Math.ceil(total / per));
    const cur = Math.min(Math.max(1, Math.round(page) || 1), pages);
    const bar = el('div', 'wxg-pager');

    const prev = button('‹ 上一页', action, 'wxg-btn-xs', String(cur - 1));
    if (cur <= 1) {
        prev.disabled = true;
    }
    bar.appendChild(prev);

    const from = total ? (cur - 1) * per + 1 : 0;
    const to = Math.min(total, cur * per);
    bar.appendChild(el('span', 'wxg-pager-info',
        total ? ('第 ' + String(from) + '–' + String(to) + ' 条 · 共 ' + String(total) + ' 条')
            : '一条都没有'));

    const next = button('下一页 ›', action, 'wxg-btn-xs', String(cur + 1));
    if (cur >= pages) {
        next.disabled = true;
    }
    bar.appendChild(next);

    if (pages > 1 && pages <= 12) {
        const nums = el('div', 'wxg-pager-nums');
        for (let i = 1; i <= pages; i += 1) {
            const b = button(String(i), action, 'wxg-btn-xs' + (i === cur ? ' is-on' : ''), String(i));
            nums.appendChild(b);
        }
        bar.appendChild(nums);
    }
    return bar;
}

/**
 * 把"目标页"夹到合法范围。
 * ⚠️ 夹在这里、不在处理器里（处理器只管存）：免得出现 page=0 或超出最后一页的空屏。
 */
function clampPage(target, total, per) {
    const pages = Math.max(1, Math.ceil((Number(total) || 0) / per));
    const n = Number(target);
    return Math.min(Math.max(1, Number.isFinite(n) ? Math.round(n) : 1), pages);
}

/**
 * 种类 → 胶囊样式（⛔ 不按颜色名，按语义）：
 *   推演＝中性分类章 ｜ 暗线＝要注意 ｜ 警戒／越界＝警告 ｜ 其它＝中性
 */
function kindTone(kind) {
    const k = asText(kind);
    if (k.includes('暗线')) {
        return 'is-warn';
    }
    if (k.includes('警戒') || k.includes('越界') || k.includes('退化')) {
        return 'is-warn';
    }
    return 'is-info';
}

/** 只取时分（列表里"哪条新"靠它，日期放到分组头；⛔ 不用完整时间戳占地方） */
function shortTime(at) {
    const s = formatStamp(at);
    const m = s.match(/(\d{1,2}:\d{2})/);
    return m ? m[1] : s;
}

function secChronicle(host) {
    const list = getChronicle();
    /*
     * ⚠️ 这里原来是 `{ open: true } + '⭐ …'` —— **对象拼字符串**，两个后果：
     *    · 拼出来的是 "[object Object]⭐ …" ⇒ hint 从来没显示过；
     *    · `open` 也没传进去 ⇒ "默认展开"从来没生效（编年一直是收起的）。
     *    ⇒ 改成独立传参（复核方指出）。
     */
    const box = section('编年',
        '每回合推演出来的东西**全部按时间攒在这里**（过去经历／正在经历是滚动更新的，旧的只有这儿能回看）。'
        + '编年**只给你看**：不注入、不喂模型。',
        { open: true });
    if (!list.length) {
        box.appendChild(heroEmpty('还没有记录（更新几轮就有了）', '立刻更新', 'update-now', '为什么会自动有：每次推演都会往这里记一条，你不用手填。'));
        host.appendChild(box);
        return;
    }
    /*
     * ⭐ 行化一切（有数据排版术第七条）：
     *    `时间（骨架列）｜ 谁 ＋ 正文 ｜ 种类胶囊`，一行一件事；
     *    按**楼层分组**（数字当骨架），顶部一排**筛选带计数**。
     * ⚠️ 原来每条摊成 5 行（时间／楼层／胶囊／人／正文），9 条就一屏多——
     *    真机截图里一排胶囊还被 flex 列拉成了通栏长条（见 CSS 里的说明）。
     */
    const KINDS = ['推演', '暗线', '警戒', '越界'];
    const countOf = (k) => list.filter((c) => String(c.kind || '推演').includes(k)).length;
    const all = list.slice(-120).reverse();
    let matched = chronFilter === 'all' ? all : all.filter((c) => String(c.kind || '推演').includes(chronFilter));
    /* A4：搜索词叠在筛选之上（先筛类型、再搜字，顺序不影响结果，但口径要固定） */
    const chronKw = trimText(chronSearch).toLowerCase();
    if (chronKw) {
        matched = matched.filter((c) => {
            const hay = [c.text, c.title, c.kind, c.time, c.people, c.who]
                .map((x) => (Array.isArray(x) ? x.join(' ') : String(x == null ? '' : x)))
                .join(' ')
                .toLowerCase();
            return hay.includes(chronKw);
        });
    }
    chronPage = clampPage(chronPage, matched.length, PER_PAGE.chron);
    const shown = matched.slice((chronPage - 1) * PER_PAGE.chron, chronPage * PER_PAGE.chron);

    const bar = el('div', 'wxg-filters');
    const mkFilter = (key, label, n) => {
        const b = el('button', 'wxg-filter' + (chronFilter === key ? ' is-on' : ''), label);
        b.type = 'button';
        b.setAttribute('data-action', 'chron-filter');
        b.setAttribute('data-id', key);
        b.appendChild(el('span', 'wxg-filter-n', String(n)));
        return b;
    };
    bar.appendChild(mkFilter('all', '全部', all.length));
    for (const k of KINDS) {
        const n = countOf(k);
        if (n) {
            bar.appendChild(mkFilter(k, k, n));
        }
    }
    if (chronFilter !== 'all' && !countOf(chronFilter)) {
        chronFilter = 'all';
    }
    box.appendChild(bar);
    /* A4：搜索框（和名册那个同款；⛔ 每敲一个字都重画，change 才筛） */
    /* A4：搜索框（构造在 ui/chron-search.js，主文件别再长） */
    box.appendChild(makeChronSearch(el, chronSearch));

    /*
     * 三（阿砚九格）：编年顶部一条统计——按**我们自己的分类**算，⛔ 套它的 7 类。
     *   「已归档」＝这本账里比当前可见范围（最近 120 条）更早的那些。
     */
    const archived = Math.max(0, list.length - all.length);
    const stat = el('div', 'wxg-statbar');
    stat.appendChild(el('span', 'wxg-statbar-k', '共 ' + String(list.length) + ' 条'));
    stat.appendChild(el('span', null, '暗线 ' + String(countOf('暗线')) + ' 条'));
    stat.appendChild(el('span', null, '已归档 ' + String(archived) + ' 条（早于可见的最近 ' + String(all.length) + ' 条）'));
    box.appendChild(stat);

    const hit = el('div', 'wxg-hitbar');
    hit.appendChild(el('span', null, '这一筛 ' + String(matched.length) + ' 条'
        + (matched.length === list.length ? '' : '（全账本 ' + String(list.length) + ' 条）')));
    hit.appendChild(el('span', null, '新的在上面 · 按楼层分组'));
    /*
     * ⭐ 「清空编年」放在这一条小结行上（不单开一段，照"一屏一个焦点"）。
     *    ⛔ 不做成显眼的大按钮——清空是**刻意**才点的操作，点之前会先弹条数给她看。
     */
    const clearBtn = el('button', 'wxg-btn-xs wxg-del', '清空编年');
    clearBtn.type = 'button';
    clearBtn.setAttribute('data-action', 'clear-chronicle');
    clearBtn.title = '把编年全部清掉（只清编年，别的都不动）';
    hit.appendChild(clearBtn);
    box.appendChild(hit);
    if (matched.length > PER_PAGE.chron) {
        box.appendChild(pager('chron-page', chronPage, PER_PAGE.chron, matched.length));
    }

    const cChron = card(chronFilter === 'all' ? '热账与旧卷（按回合攒）' : ('只看「' + chronFilter + '」'));
    cChron.classList.add('wxg-wide');   /* 81：卡片横向铺满（她：要么铺满、要么居中） */
    const byFloor = new Map();
    for (const c of shown) {
        const f = Number.isFinite(c.floor) && c.floor >= 0 ? Number(c.floor) : -1;
        if (!byFloor.has(f)) {
            byFloor.set(f, []);
        }
        byFloor.get(f).push(c);
    }
    const groups = Array.from(byFloor.entries())
        .map(([floor, items]) => ({
            floor,
            items: items.slice().sort((a, b) => (Number(b && b.at) || 0) - (Number(a && a.at) || 0)),
        }))
        .sort((a, b) => {
            if (a.floor === b.floor) {
                return 0;
            }
            if (a.floor < 0) {
                return 1;
            }
            if (b.floor < 0) {
                return -1;
            }
            return b.floor - a.floor;
        });
    /*
     * 四（阿砚九格）：冷热分开命名——最新那一组叫「热账」，更早的都叫「旧卷」。
     *   这不是纯视觉：她流程第⑤条“几百楼就把前面的剪出来单独封存”——这里是同一件事的可视化。
     */
    const hotFloor = groups.length ? groups[0].floor : null;
    for (const g of groups) {
        const isHot = g.floor === hotFloor;
        const showHead = g.items.length > 1;   /* 85#10：单条不印卷头（但行还要画） */
        if (showHead) {
            const head = el('div', 'wxg-grouphead');
            head.appendChild(el('b', null, (isHot ? '热账 · ' : '旧卷 · ')
                + (g.floor >= 0 ? floorLabel(g.floor) : '未记楼层')));
            head.appendChild(el('span', null, '共 ' + String(g.items.length) + ' 条'));
            cChron.appendChild(head);
        }
        for (const c of g.items) {
            const r = el('div', 'wxg-r');
            r.appendChild(el('div', 'wxg-r-k wxg-num', shortTime(c.at)));
            const main = el('div', 'wxg-r-main');
            const title = el('div', 'wxg-r-title');
            if (trimText(c.who)) {
                title.appendChild(el('span', 'wxg-r-who', c.who));
            } else {
                title.appendChild(el('span', 'wxg-none', '这轮没点到名'));   /* A3：占位词改人话 */
            }
            if (c.manual) {
                title.appendChild(el('span', 'wxg-badge is-warn', '已手动修改'));
            }
            main.appendChild(title);
            main.appendChild(el('div', 'wxg-r-sub', trimText(c.text) || '暂无'));
            r.appendChild(main);
            const act = el('div', 'wxg-r-act');
            act.appendChild(el('span', 'wxg-badge ' + kindTone(c.kind), String(c.kind || '推演')));
            /*
             * ⭐ 删这一条。编年原来是**只增不减**的（`addChronicle`／`getChronicle`，没有任何删的口子）
             *    ⇒ 写错了、或者早期测试数据混进去了，她自己在界面上**删不掉**
             *      （真机上真卡过一批合成文本）。
             * ⚠️ 下标按**账本里的原始位置**算：这里渲染的是"最近 120 条倒序＋筛选＋翻页"之后的行，
             *    ⛔ 不能拿循环下标当账本下标（会删错人）。用对象身份回查最稳。
             */
            const at = list.indexOf(c);
            const del = el('button', 'wxg-btn-xs wxg-del wxg-row-del', '删');   /* 五：hover 才现，屏上可见按钮减半 */
            del.type = 'button';
            del.setAttribute('data-action', 'del-chronicle');
            del.setAttribute('data-index', String(at));
            del.title = '删掉这一条（只删编年这一条，别的不动）';
            act.appendChild(del);
            r.appendChild(act);
            cChron.appendChild(r);
        }
    }
    box.appendChild(cChron);
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
    if (fresh.length) {
        const line = el('div', 'wxg-store', '引擎新认了 ' + String(fresh.length) + ' 个人：' + fresh.join('、')
            + '（名字对不对？不对就点「按这条合并…」并进老记录，或「忽略这条」）');
        line.setAttribute('data-tone', 'bad');
        box.appendChild(line);
        row(box, button('一键收下这些新认的人', 'accept-new-all'));
    }

    /*
     * ⭐ 装盒：录入 一块、名册 一块（体检第一条）
     * ⭐ 一屏一个焦点：**名册里已经有人了 ⇒ 录入默认收起**。
     *    68 个人的时候它还占着半屏上半部分，名单要往下滚才看得见——
     *    她天天要看的是名单，录入一个月用一次。⛔ 不删，点一下就展开。
     */
    const hasPeople = roster.length > 0;
    const cIn = card('录入');
    cIn.classList.add('wxg-wide');
    let inTarget = cIn;
    if (hasPeople) {
        inTarget = foldable('展开录入（加人／导入／从世界书读人）', false);
        cIn.appendChild(inTarget);
    }
    row(inTarget, textInput('wxg-new-name', '', '新人物名字', 'noop'), button('加入名册', 'add-char', 'wxg-primary'), button('一键盘入预设名册', 'preset-roster'));
    row(inTarget, textInput('wxg-import-roster', '', '批量导入：名字一行一个（也认逗号、顿号）', 'noop'), button('批量导入', 'import-roster'));
    row(inTarget,
        textInput('wxg-book-name', '', '从世界书读人：填世界书名（留空＝角色卡绑定那本）', 'noop', 'wxg-short'),
        button('从世界书读人', 'read-book', 'wxg-primary'),
        button('列出世界书', 'list-books'));
    const bookList = el('div', 'wxg-note', '');
    bookList.id = 'wxg-book-list';
    inTarget.appendChild(bookList);
    const dupBox = el('div', 'wxg-note', '');
    dupBox.id = 'wxg-dup-picker';
    inTarget.appendChild(dupBox);
    row(inTarget, button('查重（找出被拆成两条的）', 'detect-dupes'),
                /* ⭐修复 15（材料 02）：**一键合并查重出的所有重复组** ✓ */
                button('一键合并重复组', 'merge-all-dupes'),
                /*
                 * 依据＝阿砚任务 1-b（M05）：`undoLastMerge` 写了但**全库 0 个调用点**；
                 *   选项②——真接上它，且没有「合并前」快照时直接置灰（⛔ 点了才告诉她没得撤）。
                 */
                (() => {
                    const b = button('撤销上次合并', 'undo-last-merge', 'wxg-btn-xs');
                    if (!hasMergeSnapshot()) {
                        b.disabled = true;
                        b.title = '没有「合并前」的快照（已被快照上限挤掉）';
                    }
                    return b;
                })(),
                button('导出备份（JSON）', 'export-data'),
        button('导出聊天原文', 'export-chat'),
                /* ⭐ 材料 06【4】#1：**导入／恢复备份** ✓（她只能导出、不能导回 ✗） */
                button('导入备份（JSON）', 'import-data'));
    box.appendChild(cIn);

    /*
     * ⭐ 世界书**通道**那一行（必须看得见）：
     *    真机踩过"点读人 → 0 人"，根因是 ST 1.18 原版**没有** `ctx.getLorebookEntries` 那一组，
     *    而我们只认它 ⇒ 静默读出 0 条、她完全没法自己判断原因。
     *    现在：走哪条通道、缺什么，直接写在读人按钮旁边。
     */
    const chRep = channelReport();
    const chLine = el('div', 'wxg-store', chRep.text
        + (chRep.ok ? '' : '　⇒ 不知道书名就下面手填一下（也能读）'));
    chLine.setAttribute('data-tone', chRep.ok ? 'ok' : 'bad');
    box.appendChild(chLine);

    const cList = card('名册');
    cList.classList.add('wxg-wide');   /* 82：名册表铺满（卡只占左半，右半空） */
    /*
     * ⭐ 行化（有数据排版术第七条）：**一个人一行**。
     *    `名字 ＋ 胶囊（玩家棋子/新认/已手改）｜ 别名·好感 灰字 ｜ 右侧 改 · 删`
     * ⚠️ 原来一个人一张卡（名字行＋两个输入框行＋开关行 ≈ 135px）：
     *    真机灌了 47 人之后一屏只看得到 3 个人——"有哪些条"根本扫不出来，
     *    正好撞在验收口径上（三秒要能抓住有哪些人）。
     * 改/删都在行上；点「改」才展开三个输入框（⛔ 不用为编辑把每行都撑开）。
     */
    /*
     * ⭐ 筛选行 —— **照目标包**：`全部｜创建时间｜修改时间｜玩家棋子｜名字` ＋ 右侧**搜索框**（搜“名字或别名”）。
     *   原来是“全部／玩家棋子／新认的／我改过的”四个胶囊（那是早期自己想的）。
     *   ⚠️ “我改过的”这个**筛选**去了，但它的信息没丢：行上的「已手改」辨识还在（新认的人也还有那条提示带）。
     */
    const isFresh = (c) => fresh.some((n) => trimText(n) === trimText(c.name));
    const kw = trimText(rosterSearch).toLowerCase();
    const hitKw = (c) => !kw
        || String(c.name || '').toLowerCase().includes(kw)
        || (Array.isArray(c.aliases) ? c.aliases.some((a) => String(a || '').toLowerCase().includes(kw)) : false);
    let shownRoster = roster.filter(hitKw);
    if (rosterFilter === 'player') {
        shownRoster = shownRoster.filter((c) => c.isPlayer);
    }
    /* ★ R62：排序交给纯函数（可测），并带正反序 ✓ */
    if (rosterFilter === 'created' || rosterFilter === 'changed' || rosterFilter === 'name') {
        shownRoster = sortRosterList(shownRoster, rosterFilter, rosterSortDir);
    /*
     * 依据＝阿砚第三批 C 档 P2 · F3：总数要印出来。
     *   名册有筛选与搜索；不印总数，她就分不清“筛没了”还是“本来就这么多”。
     */
    const tallyRoster = tallyLine('名册', roster.length, shownRoster.length);
    cList.appendChild(el('div', 'wxg-note', tallyRoster));   /* F3：把“显示 N / 共 M”印出来 */
    }
    const rf = el('div', 'wxg-filters');
    const mkR = (key, label, n) => {
        const b = el('button', 'wxg-filter' + (rosterFilter === key ? ' is-on' : ''), label);
        b.type = 'button';
        b.setAttribute('data-action', 'roster-filter');
        b.setAttribute('data-id', key);
        if (n !== null) {
            b.appendChild(el('span', 'wxg-filter-n', String(n)));
        }
        return b;
    };
    const dirMark = (k) => (rosterFilter === k ? (rosterSortDir === 'desc' ? ' ▼' : ' ▲') : '');
    rf.appendChild(mkR('all', '全部', roster.length));
    rf.appendChild(mkR('created', '创建时间' + dirMark('created'), null));
    rf.appendChild(mkR('changed', '修改时间' + dirMark('changed'), null));
    rf.appendChild(mkR('player', '玩家棋子', roster.filter((c) => c.isPlayer).length));
    rf.appendChild(mkR('name', '名字' + dirMark('name'), null));
    const sw = el('div', 'wxg-searchwrap');
    sw.appendChild(el('span', 'wxg-searchico', '⌕'));
    const si = el('input', 'wxg-searchbox');
    si.type = 'search';
    si.placeholder = '搜：名字 或 别名';
    si.value = rosterSearch;
    si.setAttribute('data-action', 'roster-search');
    sw.appendChild(si);
    rf.appendChild(sw);
    cList.appendChild(rf);

    rosterPage = clampPage(rosterPage, shownRoster.length, PER_PAGE.roster);
    const pageList = shownRoster;   /* 85#1：全部渲染（不再分页） */
    /*
     * ⭐ 翻页条：**挪到页底**（照目标包：分页贴页底）。
     *    原来放在**列表上方**——那是早期参照的做法；包里明确要"贴页底"。
     *    ⛔ 改回上面（虽然长列表里"翻页在下头"要滑到底才看得到）——**以包为准**。
     */
    const pagerAtBottom = null;   /* 85#1：不再分页 */
    const topbar = el('div', 'wxg-roster-topbar');
    const funcBtn = button('功能 ⋮', 'roster-func', 'wxg-btn is-func');
    funcBtn.style.height = '28px';
    funcBtn.style.minHeight = '28px';
    funcBtn.style.lineHeight = '26px';
    funcBtn.style.padding = '0 12px';
    funcBtn.style.whiteSpace = 'nowrap';
    funcBtn.title = '去重合并／删除／清空（入口位；包里就是这么标的）';
    topbar.appendChild(funcBtn);
    /*
     * ⭐ LY5（材料 11·布局层）：**页头那颗 ⋮ 要在页面最顶端** ✓
     *   旧：`cList.appendChild(topbar)` ⇒ 被塞进「名册」卡**内部** ✗
     *     ⇒ 夹在筛选胶囊条与表头**正中间** ✗（酒馆里看着很突兀 ✗）
     *   现在：插到**第一张卡之前** ✓（与状态页／世界状态页同一个做法 ✓）
     */
    box.insertBefore(topbar, cIn);
    /*
     * A5：**空列不占位** —— 整列没值（典型：势力）就连表头带单元格一起藏；
     *   好感列空时去好感表取（有数就有内容）。
     */
    const cols = columnsFor(roster, state);
    /*
     * 80 号：这块卡只有 461px（5 列必然挤：末列算出 0px、act 压进名字格 22px）
     *   ⇒ 固定 **2 列**：名称｜操作。身份／势力并进名字格**第二行小灰字**，取不到就不显示。
     */
    const allEmpty = !cols.showId && !cols.showFac;
    const list = el('div', 'wxg-roster wxg-table-2');
    const rhead = el('div', 'wxg-thead wxg-table-2');
    rhead.appendChild(el('div', 'wxg-th', '角色名称'));
    rhead.appendChild(el('div', 'wxg-th', ''));   /* 操作列无标题（⛔ 填字） */
    list.appendChild(rhead);
    for (const c of pageList) {
        const open = String(openChar) === String(c.id);
        /*
         * ⭐ **整行可点展开**（复核方："每个角色下面一个按钮好像是有点奇怪"——对）。
         *    68 个人的名单上糊 136 个按钮，名单就不成名单了；
         *    而且「删」摆在密集列表里太容易误点 ⇒ 收进展开区。
         *    行的右侧留一个 `›` 提示"这行能点"。
         * ⚠️ 行上挂 data-action 是安全的：里面的输入框/开关/删除**各自都有 data-action**，
         *    事件的 closest 会先命中它们（点输入框不会把行收起来）。
         */
        const r = el('div', 'wxg-r is-click' + (open ? ' is-open' : ''));
        r.setAttribute('data-action', 'open-person-card');
        r.setAttribute('data-id', c.id);
        /*
         * ⭐ 照目标包改成**四列表**：`角色名称｜好感｜身份｜势力`，列间**竖实线**，空值写 `—`。
         *    为什么：原来是"名字 + 一行灰字（别名/好感）"，48 个人扫不动；
         *    包里是列对齐的账本样子（四列等宽、看得见的竖线）。
         *    ⚠️ 别名没丢：它在浮层里（点开就看得到）。
         */
        const main = el('div', 'wxg-td wxg-c-name');
        const title = el('div', 'wxg-r-title');
        title.appendChild(el('span', 'wxg-r-who', c.name));
        if (c.isYou || c.isPlayer) {
            title.appendChild(el('span', 'wxg-badge is-ok', '你'));
        }
        title.appendChild(el('span', 'wxg-badge ' + (c.offstage === true ? 'is-soft' : 'is-ok'), c.offstage === true ? '后台' : '前台'));
        if (isFresh(c)) {   /* 85#12：只认 newPeople */
            title.appendChild(el('span', 'wxg-badge is-warn', '新认的人'));
        }
    /* 67 号：两颗挤在一行会裁掉第二颗 ⇒ **合成一颗**，细节进 title（⛔ 调 min-width） */
    const flags = [];
    if (c.manual) { flags.push('已手改'); }
    if (c.noBench === true) { flags.push('不推'); }
    if (flags.length) {
        const badge = el('span', 'wxg-badge ' + (c.manual ? 'is-info' : ''), flags.join(' · '));
        if (flags.length === 2) {
            badge.title = '这一位你手动改过，且已关掉「推演／平行事件」';
        }
        title.appendChild(badge);
    }
        main.appendChild(title);
        r.appendChild(main);
        /* 80 号：身份／势力不再占独立列，并进名字格第二行（小灰字） */
        {
            const meta = [];
            if (trimText(c.identity)) { meta.push('身份 · ' + trimText(c.identity)); }
            if (trimText(c.faction)) { meta.push('势力 · ' + trimText(c.faction)); }
            if (meta.length) { main.appendChild(el('div', 'wxg-c-meta', meta.join('　'))); }
        }
        if (open) {
            r.classList.add('is-sel');
        }

        const act = el('div', 'wxg-r-act');
        /*
         * 新认的人与手动忽略的人，各给一颗当场处置的钮：
         * · 新认的「收下／忽略」——认错了要能当面否掉，不必进卡再找；
         * · 已忽略的「恢复」——否则关了就只能改账本才能放回来。
         * 只在这两种行上挂 ✓ 名单不会糊满按钮 ✓
         */
        if (c.ignored === true) {
            act.appendChild(button('恢复参与推演', 'unignore-char', 'wxg-btn-xs', c.id));
        } else if (isFresh(c)) {
            act.appendChild(button('收下', 'accept-new', 'wxg-btn-xs', c.id));
            /* 79 ：忽略搬进 ⋯ */
        }
        act.appendChild(el('span', 'wxg-r-caret' + (open ? ' is-open' : ''), open ? '⌄' : '›'));
        /*
         * ⭐ 行上留一个「⋯」＝还开**老的完整编辑器**（删除／收下／忽略／合并那些都在里头）。
         *    为什么留：浮层这一版先做"看＋改八格＋别名＋玩家棋子"，老编辑器里还有几样没搬过去；
         *    ⛔ 不能因为换交互就把她的功能摸不到（audit-3 红了 4 条就是提醒这个）。
         *    等浮层把老编辑器的活全接手了，再撤这个入口（那时才叫"只删入口"）。
         */
        const moreBtn = button('⋯', 'edit-char', 'wxg-btn-xs wxg-r-more', c.id);
        moreBtn.title = '更多（删除／收下／忽略／合并等）';
        /*
         * ⭐ 行高真凶（第 6 轮真机量出来的）：这颗按钮被酒馆全局 `.menu_button`
         *   撑到 **36px**，而同行别的格子才 30～35 ⇒ 行高 = max + 内边距 = 63px。
         *   屝过两回 CSS 都压不过（它是酒馆自己的类）⇒ **直接写内联**（内联必胜，且只影响这一颗）。
         */
        moreBtn.style.height = '22px';
        moreBtn.style.minHeight = '22px';
        moreBtn.style.lineHeight = '20px';
        moreBtn.style.padding = '0 7px';
        moreBtn.style.fontSize = '13px';
        act.appendChild(moreBtn);
        r.appendChild(act);

        if (open) {
            const fields = el('div', 'wxg-char-fields');
            const alias = textInput('wxg-alias-' + c.id, c.aliases.join('、'), '别名／昵称（顿号或逗号分开）', 'set-alias', 'wxg-alias');
            alias.setAttribute('data-id', c.id);
            fields.appendChild(alias);
            const aff = textInput('wxg-aff-' + c.id, c.affinity, '好感（读自手机；没有就空着）', 'set-affinity', 'wxg-affinity');
            aff.setAttribute('data-id', c.id);
            fields.appendChild(aff);
            r.appendChild(fields);
            const actions = el('div', 'wxg-char-actions');
            const playerLabel = el('label', 'checkbox_label wxg-chip-sm');
            const pbox = document.createElement('input');
            pbox.type = 'checkbox';
            pbox.checked = c.isPlayer === true;
            pbox.setAttribute('data-action', 'set-player');
            pbox.setAttribute('data-id', c.id);
            playerLabel.appendChild(pbox);
            playerLabel.appendChild(el('span', null,
                c.isYou ? '玩家棋子（照酒馆里的人设名自动认的；不想算就取消勾）' : '玩家棋子'));
            actions.appendChild(playerLabel);
            if (isFresh(c)) {
                actions.appendChild(button('忽略这条', 'ignore-char', 'wxg-btn-xs', c.id));
            }
            actions.appendChild(button('删', 'del-char', 'wxg-btn-xs', c.id));
            r.appendChild(actions);
        }
        list.appendChild(r);
    }
    if (allEmpty) {
        list.appendChild(el('div', 'wxg-note wxg-roster-blank',
            '还没有身份／势力／好感——等正文回写，或从世界书读人时带进来。'));
    }
    cList.appendChild(list);
    if (pagerAtBottom) {
        const pw = el('div', 'wxg-roster-pager');
        pw.appendChild(pagerAtBottom());
        cList.appendChild(pw);
    }
    box.appendChild(cList);
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
        '工作台是**我们自己的整页窗口**，配色自己定，不用迁就酒馆主题；'
        + '设置抽屉那边仍跟随酒馆主题。文字色留空＝按底面亮度自动算（浅底深字／深底浅字）。',
        { open: false, summary: PALETTE_NAMES[app.palette] || '', five: true });

    const cTheme = card('色板与颜色槽');
    row(cTheme, field('色板', select('wxg-app-palette',
        PALETTE_KEYS.map((k) => ({ value: k, label: PALETTE_NAMES[k] })),
        app.palette, 'stage-appearance')));

    row(cTheme,
        field('强调色', colorInput('wxg-app-accent', app.accent, 'stage-appearance')),
        field('底面', colorInput('wxg-app-surface', app.surface, 'stage-appearance')),
        field('页面底色', colorInput('wxg-app-bg', app.bg, 'stage-appearance')));
    row(cTheme,
        field('描边', colorInput('wxg-app-border', app.border, 'stage-appearance')),
        /*
         * ⭐ ST6（材料 11·设置层）：**文字色要真的能留空** ✓
         *   旧：`<input type="color">` ✗ —— 规范强制它的值**永远不可能是空串** ✗
         *     ⇒ 说明写着“留空＝自动”却永远留不了空 ✗ ⇒ 点过一次就锁死 ✗
         *   现在：**文本框** ✓＋一颗「自动」按钮 ✓。槽位认法不变（仍看 `target.id` 的 `wxg-app-` 后缀 ✓）
         */
        field('文字（可留空）', (() => {
            const wrapT = el('div', 'wxg-row');
            const txT = document.createElement('input');
            txT.type = 'text';
            txT.id = 'wxg-app-text';
            txT.className = 'wxg-colortext';
            txT.placeholder = '留空＝自动（浅底深字／深底浅字）';
            txT.value = (app.text == null ? '' : String(app.text));
            txT.setAttribute('data-action', 'stage-appearance');
            wrapT.appendChild(txT);
            const autoBtn = button('自动', 'app-text-auto', 'wxg-btn-sm');
            autoBtn.title = '清空文字色 ⇒ 按底面亮度自动算';
            wrapT.appendChild(autoBtn);
            return wrapT;
        })()));
    row(cTheme,
        button('恢复这个色板', 'reset-appearance'),
        el('span', 'wxg-note', '（只把四个槽位退回所选色板；你手改的颜色会被覆盖）'));
    cTheme.appendChild(checkbox('wxg-app-to-panel', '浮层面板与悬浮小框也用这套配色（不勾＝它们跟随酒馆主题）',
        app.applyToPanel, 'stage-app-to-panel'));

    /*
     * ⭐ ST2（材料 11·设置层）：**悬浮球那两个行为终于有开关了** ✓
     *   旧：`pinned`（挂载就展开）与 `hoverOpen`（鼠标移入展开）在代码里写了逻辑 ✗
     *     但界面上**一个开关都没给** ✗ ⇒ 她只能被鼠标路过就弹开，关不掉 ✗
     *   现在：两个勾选框 ✓（立即落盘 ✓ ⛔ 走草稿 ✗ —— mini 不在暂存表里）
     */
    /*
     * ⭐⭐ 真机自查抳回：**两个勾选框恒为真** ✗
     *   旧：`getSettings().mini || {}.hoverOpen === true` ✗
     *     优先级：`===` 先结合 ⇒ `mini || (undefined === true)` ⇒ **mini 对象本身（恒为真）** ✗
     *     ⇒ 她不管怎么取消，重开面板两个勾**又都是勾上的** ✗
     *   现在：先合并出生效值（已存＋草稿），再考量它是不是 `=== true` ✓
     */
    const miniEff = Object.assign({}, getSettings().mini || {}, stagedValue(SECID, 'mini', null) || {});
    /* 渲染层 #9：两个开关已移到「总控 → 入口与启动」，这里只留指路（⛔ 两边各一份） */
    cTheme.appendChild(el('div', 'wxg-note', '悬浮球的「悬停展开」「钉住」已并到「总控 → 入口与启动」（一个概念只留一个界面）。'));

    const pv = el('div', 'wxg-app-preview');
    pv.setAttribute('data-role', 'app-preview');
    applyAppearance(pv, effectiveAppearance());
    pv.appendChild(el('div', 'wxg-app-pv-name', '万象阁 · 预览'));
    const pvRow = el('div', 'wxg-row');
    pvRow.appendChild(el('span', 'wxg-badge', '强调色'));
    pvRow.appendChild(el('span', 'wxg-badge wxg-badge-soft', '淡底'));
    const pvBtn = el('button', 'menu_button', '按钮长这样');
    pvBtn.type = 'button';
    pvRow.appendChild(pvBtn);
    pv.appendChild(pvRow);
    pv.appendChild(el('div', 'wxg-fact', '这一块用的是你选的配色——不用打开工作台就能看出效果。'));
    cTheme.appendChild(pv);
    box.appendChild(cTheme);

    const cMode = card('打开方式');
    row(cMode, field('打开方式', select('wxg-layout-mode', [
        { value: 'workspace', label: '整页工作台（推荐：自己的配色＋左栏导航）' },
        { value: 'panel', label: '浮层面板（老样子，能拖能缩放）' },
    ], s.layoutMode, 'stage-layout-mode')));
    cMode.appendChild(el('div', 'wxg-note', '悬浮小框的开关在「总控」里；它在聊天时常驻，点一下就进工作台。'));
    box.appendChild(cMode);

    box.appendChild(saveBar('appearance'));
    host.appendChild(box);
}

function secRecall(host) {
    const SECID = 'recall';
    const s = getSettings();
    const box = section('召回',
        '她发消息时当场算一次"这轮该带什么"：好感必带；世界与平行事件按她最新发言的相关度筛，相关的进、其余排后台。',
        { open: false, five: true });
    box.appendChild(expandPair({ el: el, button: button }));   /* 六：全部展开／全部收起 */
    const cPick = card('每一轮怎么挑');
    /*
     * ★ 20261023（阿砚 15 号）：三项一行的**组**。
     *   在 `line()`（左标签右控件）上面加一层：一个组里放三个小格，窄屏退回一列 ✓
     */
    const lineCell = (label, control) => {
        const cell = el('div', 'wxg-line-cell');
        cell.appendChild(el('div', 'wxg-line-k', label));
        const v = el('div', 'wxg-line-v');
        v.appendChild(control);
        cell.appendChild(v);
        return cell;
    };
    const lineGroup = (cells, target) => {
        const g = el('div', 'wxg-line-group');
        for (const c2 of cells) {
            if (c2) { g.appendChild(c2); }
        }
        /* 渲染层 #7：数值行挂到**它自己那一组**（⛔ 全挂到第一组） */
        (target || bPick).appendChild(g);
        return g;
    };
    /*
     * 依据＝阿砚 3 件任务 · 渲染层 #7（设置按用途分组折叠）：
     *   召回 11 个控件原来平铺在一张卡里（世界背面有 9 个子组）⇒ 按「挑谁／容量锁／篇幅」分三组，默认收起。
     *   开合记在 foldOpenState（同一会话内重画不丢；⛔ 跨重启保存——那要另开一次 schema）。
     */
    const mkFold = (title, open) => {
        const f = foldable(title, open === true);
        const b = el('div', 'wxg-sec-body');
        /* N1：最小高度挂这里——收起时整块不在文档里，就不会撑出空盒子 */
        b.style.minHeight = 'var(--wxg-fold-min, 96px)';
        f.appendChild(b);
        cPick.appendChild(f);
        return b;
    };
    const bPick = mkFold('挑谁（回溯大小／人物与事件封顶／排序）', true);   /* N1：首组默认展开，那片空白自然没了 */
    const bCap = mkFold('容量锁（到顶怎么归并／淡出）', false);
    const bSize = mkFold('篇幅（注入字数／一轮推演几个）', false);
        lineGroup([
            lineCell('线索回溯', numberInput('wxg-recent-turns', s.recentTurns, 1, 10, 'stage-recent-turns')),
            lineCell('人物封顶（建议 8–20，太大占上下文）', numberInput('wxg-cap-people', s.capPeople, 1, 99, 'stage-cap-people')),
            lineCell('事件封顶', numberInput('wxg-max-events', s.maxEvents, 0, 20, 'stage-max-events')),
        ]);
        lineGroup([
            lineCell('世界事件上限', numberInput('wxg-cap-events', s.capEvents, 10, 300, 'stage-cap-events')),
            lineCell('暗线上限', numberInput('wxg-cap-hidden', s.capHidden, 5, 200, 'stage-cap-hidden')),
            lineCell('编年上限', numberInput('wxg-cap-chronicle', s.capChronicle, 100, 5000, 'stage-cap-chronicle')),
        ], bCap);
        /*
         * ⭐ ST1（材料 11·设置层）：**4 个容量锁设置，面板上终于有输入框了** ✓
         *   旧：capPast／capEvents／capHidden／capChronicle 在 DEFAULT_SETTINGS、loadSettings、
         *     patchSettings、applyLimits 里全套齐全 ✓ 但面板上**一个输入框都没画** ✗
         *     ⇒ 她永远改不了它们 ✗（她原话 [54] 专门要过“保留几条过去经历” ✓）
         */
        line(bCap, '过去经历留几条',
            numberInput('wxg-cap-past', s.capPast, 2, 20, 'stage-cap-past'),
            el('span', 'wxg-note', '条（每个角色；超出的旧自然淡出）'));
        line(bCap, '排序', select('wxg-sort-mode', [
            { value: 'related', label: '按相关度（先说到的排前面）' },
            { value: 'name', label: '按名册顺序' },
        ], s.sortMode, 'stage-sort-mode'));
        line(bCap, '过去经历只端',
            numberInput('wxg-past-floor-cut', s.pastFloorCut, 0, 50, 'stage-past-floor-cut'),
            el('span', 'wxg-note', '楼之外的（最近这么多楼里的，你上下文里已有，不重复端；0＝全端）'));
        line(bSize, '注入字数上限',
            numberInput('wxg-inject-cap', s.injectCharCap, 1, 5000, 'stage-inject-cap'),
            el('span', 'wxg-note', '字符（1–5000，不填默认 1400）'));
        line(bSize, '一轮最多推演',
            numberInput('wxg-max-parallel', s.maxParallelChars, 0, 12, 'stage-max-parallel'),
            el('span', 'wxg-note', '个不在场的角色（省额度：其余下一轮轮转）'));
    /*
     * 依据＝阿砚 3 件任务 · 渲染层 #10（超出建议值给提示，不拦）：
     *   人物封顶建议 8–20，实际填 50 界面一声不吭；而总控那边同类情况会弹黄条。
     *   照总控那条写法：把话说清楚＋一颗一键改的按钮，改不改她定（⛔ 偷偷截断）。
     */
    if (Number(s.capPeople) > 20) {
        const tipCap = el('div', 'wxg-note wxg-advice');
        tipCap.appendChild(el('span', null, '⚠ 人物封顶现在是 ' + String(s.capPeople)
            + '，超出建议值（8–20）：每轮会多吃上下文，也更容易把不相关的人带进正文。'));
        tipCap.appendChild(button('改成 12（推荐）', 'use-cap-people-12', 'wxg-btn-xs'));
        cPick.appendChild(tipCap);
    }
    box.appendChild(cPick);

    const cCard = card('召回卡片');
    cCard.appendChild(checkbox('wxg-card-enabled', '在你每条发言后面显示召回卡片', s.cardEnabled, 'stage-card'));
    cCard.appendChild(checkbox('wxg-show-empty', '没有召回时也显示空态卡片', s.showEmptyCard, 'stage-show-empty'));
    box.appendChild(cCard);
    box.appendChild(saveBar('recall'));
    host.appendChild(box);
}

function secExtract(host) {
    const SECID = 'extract';
    const s = getSettings();
    const box = section('读取控制（提取／排除四格）',
        '文本名单与点选的世界书／条目改完按段底那颗「保存」一起存（三个规则开关拨动即生效）。'
        + '世界书这一块不用手打书名：点下面的书名就进名单（再点＝排除、再点＝拿掉），'
        + '点「看条目」能一条条挑。标签那一块默认按结构剥掉成对的机器块与 HTML 注释——'
        + '剥完为空会自动退回原文，不会比剥之前更坏。',
        { open: false, five: true });
    const cTag = card('标签与剥壳');
    line(cTag, '提取标签', textInput('wxg-extract-tags', stagedValue(SECID, 'extractTags', s.extractTags), '例：正文, content', 'stage-extract-tags', 'wxg-short'));
    line(cTag, '排除标签', textInput('wxg-exclude-tags', stagedValue(SECID, 'excludeTags', s.excludeTags), '例：状态栏, 变量（留空＝只按结构剥）', 'stage-exclude-tags', 'wxg-short'));
    cTag.appendChild(checkbox('wxg-strip-paired', '按结构剥掉成对的机器块（配对的开闭标签，整块剥）',
        stagedValue(SECID, 'stripPairedBlocks', s.stripPairedBlocks), 'stage-strip-paired'));
    cTag.appendChild(checkbox('wxg-strip-comments', '剥掉 HTML 注释（<!-- … -->）',
        stagedValue(SECID, 'stripHtmlComments', s.stripHtmlComments), 'stage-strip-comments'));
    box.appendChild(cTag);

    /* ---- 世界书：点选（⛔ 不立刻存，攒到段底一起存） ---- */
    const cBook = card('世界书名单（读哪些／哪些不读）');
    line(cBook, '提取（要读的）',
        textInput('wxg-extract-books', stagedValue(SECID, 'extractBooks', s.extractBooks), '留空＝角色卡绑定那本；也可手填，逗号分开', 'stage-extract-books', 'wxg-short'));
    line(cBook, '排除（不读的）',
        textInput('wxg-exclude-books', stagedValue(SECID, 'excludeBooks', s.excludeBooks), '点下面书名也能填进来；也可手填', 'stage-exclude-books', 'wxg-short'));

    const pick = el('div', 'wxg-pickwrap');
    pick.id = 'wxg-bookpick';
        const pickHead = el('div', 'wxg-pick-head', '世界书');   /* 81：41 字说明进 title */
    pickHead.title = '点一下＝进「提取」；再点＝进「排除」；再点＝拿掉；最后按段底的保存';
    pick.appendChild(pickHead);
    cBook.appendChild(pick);
    row(cBook,
        button('读世界书列表', 'list-books', 'wxg-primary'),
        el('span', 'wxg-note', '（没读到就手填；有些酒馆版本没开这个接口）'));
    const bookList = el('div', 'wxg-note', '');
    bookList.id = 'wxg-book-list';
    cBook.appendChild(bookList);

    const entPick = el('div', 'wxg-pickwrap');
    entPick.id = 'wxg-entpick';
    cBook.appendChild(entPick);
    /*
     * ⭐⭐ 材料 01（界面第 2 条）：**打开这一页就自动列世界书** ✓
     *   旧：打开时区域是**空的** ✗ ⇒ 必须手动先点一次「读世界书列表」才出按钮 ✗
     *   现在：渲染完就自己去点一下那颗按钮 ✓（复用现成的 list-books 路，⛔ 重写逻辑 ✗）
     *   ⛔ 只在“还没列过”时发 ✓（避免每次重画都去读一遍世界书 ✗）
     */
    /*
     * 依据＝本轮查“首跑红、复跑绿”（run-tests-pick 偎发）：
     *   旧：每次重画都排一个 setTimeout(0) ✗ ⇒ 重画多次后有多个定时器，
     *        它们都会去点当前的「list-books」按钮 ⇒ 列表被反复刷新、
     *        卡片短暂为空 ⇒ 夹具正好在那一瞬查不到控件。
     *   现在：只保留最新那一个定时器；回调里先看 host 还在不在、按钮还在不在。
     */
    if (autoListTimer) {
        try { clearTimeout(autoListTimer); } catch (eClear) { }
        autoListTimer = null;
    }
    autoListTimer = setTimeout(() => {
        autoListTimer = null;
        try {
            if (!host || host.isConnected === false) { return; }   /* 旧页面已被换掉 ⇒ ⛔ 再去点它 */
            const snap = booksCache.get();
            if (isBroken(snap)) { return; }   /* B7：读不到就不要反复去叫（⛔ 死循环） */
            if (Array.isArray(listBooksCache) && listBooksCache.length) {
                /* ⭐ RD1-2：缓存里有 ⇒ **直接把芯片画回来** ✓（旧：直接 return ⇒ 重绘后全没 ✗） */
                try { paintBookPicks(host); } catch (ePB) { /* 画不出来也不能把这一页搞挂 ✓ */ }
                return;
            }
            const btn = host.querySelector('[data-action="list-books"]');
            if (btn && btn.click && btn.isConnected !== false) {
                btn.click();
            }
        } catch (e) { /* 列不出来也不能把这一页搞挂 ✓ */ }
    }, 0);
    const entNote = el('div', 'wxg-note', '');
    entNote.id = 'wxg-entnote';
    cBook.appendChild(entNote);

    cBook.appendChild(checkbox('wxg-only-enabled', '只读开启着的条目（不选世界书时＝角色卡绑定世界里开启的条目）',
        stagedValue(SECID, 'onlyEnabledEntries', s.onlyEnabledEntries), 'stage-only-enabled'));
    line(cBook, '好感来源（"手机"）',
        textInput('wxg-affinity-source', stagedValue(SECID, 'affinitySource', s.affinitySource), '例：手机 或 关系表', 'stage-affinity-source', 'wxg-short'),
        el('span', 'wxg-note', '留空＝还没有数（表里写「未建立」）'));
    box.appendChild(cBook);
    box.appendChild(saveBar(SECID));
    host.appendChild(box);
}

function secApi(host) {
    const SECID = 'api';
    const s = getSettings();
    const api = s.api || {};
    const box = section('自定义 API（后台推演走这条通道）',
        '不锁死在酒馆默认连接上。云酒馆建议「经酒馆服务器转发」——密钥留在服务器侧，也绕开跨域。',
        { open: false, five: true });
    box.appendChild(expandPair({ el: el, button: button }));   /* 六：全部展开／全部收起 */
    const cCh = card('通道');
    /*
     * ⭐⭐ 她 13:xx 澄清后的真需求（我上一版 v0.3.71 修错了地方 ✗）：
     *   「我说的是**连接方式**……那个**下拉框**我保存了书签以后**没有出现在这里面**。
     *     最普通的插件不是都有这种的吗？」
     *   ⇒ 把「连接方式」做成**通道选择器**：两种连接方式 ＋ **她存的书签**（每条一个选项）✓
     *   ⚠️ 选中的值仍是 api.mode（direct／proxy）⇒ 旧数据照读 ✓（书签那几条是临时选项，选中即切走）
     */
    const modeOpts = [
        { value: 'proxy', label: '经酒馆服务器转发（云酒馆最稳）' },
        { value: 'direct', label: '直连（浏览器直接请求）' },
    ];
    for (const pf of (Array.isArray(api.profiles) ? api.profiles : [])) {
        const pfNick = trimText(pf && pf.nick);
        if (pfNick) {
            modeOpts.push({ value: 'profile:' + pfNick, label: '书签：' + pfNick + '（' + (pf.mode === 'direct' ? '直连' : '经酒馆转发') + '）' });
        }
    }
    /*
     * ⭐⭐ 当前用的是哪套通道（她 13:xx 报的“切完就回弹、两处对不上”）：
     *   有 `api.currentProfile` ⇒ 下拉框当前值就显示**她正在用的那个书签** ✓
     *   没有（老数据）⇒ 照旧显示 `api.mode` ✓（旧账照读）
     *   ⛔ 不动 direct／proxy 的老路（她的两段式 ✓ 测试也照旧 ✓）
     */
    /*
     * ⚠️ 修上一版的不一致：下拉框里**没有这个书签时**，`<select>` 会自动落回第一项（proxy），
     *   而人话行与「删」却还按 currentProfile 说话 ⇒ **三处不一致** ✗
     *   ⇒ 现在统一：**只有那个书签真的在选项里**，才算“当前这套” ✓
     */
    const curNick = (function () {
        /*
         * ⚠️ 真机复核抓到（第 11 轮）：选完书签重绘时，这里读的**还是旧快照** ✗
         *   ⇒ 算出空 ⇒ 「删」不渲染、人话回落到 mode ✗（两处同一个根因）
         *   ⇒ 现在：**草稿与已存两边都看**（草稿优先 ✓），
         *        并且只要它**在任一边的书签列表里存在**，就算“当前这套” ✓
         *   ⛔ 两段式架构不动（只是读的时候多看一眼已存那份 ✓）
         */
        const savedPick = getSettings().api || {};
        const want = trimText(api.currentProfile) || trimText(savedPick.currentProfile);
        if (!want) { return ''; }
        const draftList = Array.isArray(api.profiles) ? api.profiles : [];
        const savedList = Array.isArray(savedPick.profiles) ? savedPick.profiles : [];
        const hit = draftList.some((x) => (trimText(x && x.nick) || trimText(x && x.name)) === want) || savedList.some((x) => (trimText(x && x.nick) || trimText(x && x.name)) === want);
        return hit ? want : '';
    })();
    const curPick = curNick ? ('profile:' + curNick) : api.mode;
    /*
     * ⭐⭐ 照她 14:xx 发的截图（SP数据库的「当前 API 预设」：下拉框 ＋ 加/删）把形状对齐：
     *   「连接方式」这一行＝下拉框（列全部可用套路）＋「＋」（存成书签）＋「删」（删当前书签）✓
     *   ⛔ 纯加法、零新逻辑：「＋」复用原来的 save-profile（它自会去读书签名输入框）；
     *        「删」复用原来的 del-profile（把当前书签名当 data-id 传过去）✓
     */
    const modeRow = el('div', 'wxg-row');
    modeRow.appendChild(select('wxg-api-mode', modeOpts, curPick, 'stage-api-mode'));
    const plusBtn = button('＋', 'save-profile', 'wxg-btn-sm');
    plusBtn.setAttribute('title', '把下面「书签名」里填的名字，存成一套（同名就更新）');
    modeRow.appendChild(plusBtn);
    const curNickForDel = curNick;   /* 与下拉框同源 ✓（修上一版的不一致） */
    if (curNickForDel) {
        const delBtn = button('删', 'del-profile', 'wxg-btn-sm', curNickForDel);
        delBtn.setAttribute('title', '删掉当前这个书签「' + curNickForDel + '」');
        modeRow.appendChild(delBtn);
    }
    const modeLine = el('div', 'wxg-line');
    modeLine.appendChild(el('span', 'wxg-line-k', '连接方式'));
    /*
     * ⭐ LY6（材料 11·布局层）：**「连接方式」那一行要套 .wxg-line-v** ✓
     *   旧：把 .wxg-row 直接挂在 .wxg-line 下 ✗ ⇒ 少了标准的 .wxg-line-v 包装层 ✗
     *     ⇒ `.wxg-line > .wxg-line-v > select.wxg-pole` 的宽度样式**完全没命中** #wxg-api-mode ✗
     *     ⇒ 而 .wxg-row 自带 margin:7px 0 ⇒ 这一行的上下间距比别的行大一圈 ✗
     */
    const modeWrap = el('div', 'wxg-line-v');
    modeWrap.appendChild(modeRow);
    modeLine.appendChild(modeWrap);
    cCh.appendChild(modeLine);
    /* 一句人话：现在走的是哪条 ✓（照世界背面那句“我跟着…”的写法） */
    cCh.appendChild(el('div', 'wxg-note', '现在走的是：' + (curNickForDel
        ? ('书签「' + curNickForDel + '」那一套')
        : (api.mode === 'direct' ? '直连（浏览器直接请求）' : '经酒馆服务器转发'))
        + '。想换别的就在上面选；想存成一套，先填下面的「书签名」再点「＋」。'));
    /*
     * 依据＝阿砚 3 件任务 · 渲染层 #7（自定义 API 分组）：
     *   11 个控件原来平铺在一张卡里 ⇒ 按「连接／生成／测试」分三组，默认收起（连接组常开，因为地址/密钥要看得见）。
     */
    const mkApiFold = (title, open) => {
        const f = foldable(title, open === true);
        const b = el('div', 'wxg-sec-body');
        f.appendChild(b);
        cCh.appendChild(f);
        return b;
    };
    const bConn = mkApiFold('连接（地址／密钥／模型）', false);
    const bGen = mkApiFold('生成（打杂模型／温度／喂多少字／重试）', false);
    const bTest = mkApiFold('测一下连接', false);

    line(bConn, '接口地址', textInput('wxg-api-url', api.url, 'https://…/v1', 'stage-api-url', 'wxg-short'));
    /* ⭐ 她 13:xx：「密钥那里不能自动隐藏」⇒ 默认 password（遮住）＋ 旁边一个「显示」开关 ✓ */
    /* 九（阿砚九格）：密钥框补三句口径（本机读取·不离库·不打印），框里⛔ 回显 */
    line(bConn, '密钥', textInput('wxg-api-key', api.key, '（本机读取，不打印）', 'stage-api-key', 'wxg-short', (apiKeyShown ? 'text' : 'password')),
        button(apiKeyShown ? '隐藏' : '显示', 'toggle-api-key', 'wxg-btn-sm'));
    bConn.appendChild(el('div', 'wxg-note', '本机读取 · 不离库 · 不打印；只有你点「显示」才在框里露出来。'));
    line(bConn, '推演模型', textInput('wxg-api-model', api.model, '例：gemini-3.8-flash', 'stage-api-model', 'wxg-short'));
    /*
     * ⭐ 目标核对 3①：**拉取模型列表**（她："只能自己输名字太麻烦"）。
     *   点一下拉回来 ⇒ 列成一排可点的小片 ⇒ 点一个就填进「推演模型」（走同一条草稿，照旧要点段底保存）。
     *   ⚠️ 拉不到就**如实说原因**，**⛔ 影响手输**。
     */
    line(bConn, '', button('拉取模型列表', 'fetch-models', 'wxg-btn-sm'),
        el('span', 'wxg-note', '（向地址 + /models 要一份清单；拉不到也可以自己填）'));
    const modelBoxEl = el('div', 'wxg-chipwrap', '');
    modelBoxEl.id = 'wxg-api-modellist';
    cCh.appendChild(modelBoxEl);
    /* ⭐ RD1-3：拉过就画回来 ✓（旧：重绘变空盒 ✗） */
    try { paintModelChips(modelBoxEl); } catch (eMP) { /* 同上 ✓ */ }
    line(bGen, '打杂模型', textInput('wxg-api-model-cheap', api.modelCheap, '留空＝同上', 'stage-api-model-cheap', 'wxg-short'));
    /* ⭐修复 15（材料 02）：**温度框设 step="0.1"** ✓
     *   （旧：步长默认 1 ✗ ⇒ 她想填 0.6 这种小数很别扭 ✗） */
    const tempInput = numberInput('wxg-api-temp-code', api.temperature, 0, 2, 'stage-api-temp');
    tempInput.step = '0.1';
    line(bGen, '温度',
        tempInput,
        el('span', 'wxg-note', '单次最多输出'),
        numberInput('wxg-api-maxtok', api.maxTokens, 200, 65536, 'stage-api-maxtok'));
    /*
     * ⭐⭐ 她可调的一个旋钮（真机取证后才明白它有多重要）：
     *   她那个中转对**长请求**一律掉线（直连 reset、转发 502+ECONNRESET、连流式也照掉 ✗）；
     *   而**只有她知道那站能收多大的请求** ⇒ 把上限交给她，一档一档往下试 ✓
     */
    line(bGen, '每轮最多喂多少字正文', numberInput('wxg-api-material-cap', Number(api.materialCap) || 6000, 500, 40000, 'stage-api-material-cap'));
    line(bGen, '链路掉线后自己再试几次',
        numberInput('wxg-auto-retry-max', Number(api.autoRetryMax) || 2, 0, 5, 'stage-auto-retry-max'));
    cCh.appendChild(el('div', 'wxg-note', '链路掉线（reset／超时／回体空）时，它会自己等一会儿再试：这里填它最多自己试几次（0＝不自动试 ✓；默认 2 ✓）'));
    cCh.appendChild(el('div', 'wxg-note', '这个数**越小越容易穿过慢或爱掉线的站**（每轮只带最近这么多字），但模型看到的上下文也越少。卡住时可以一档一档往下试：6000 → 3000 → 1500 ✓'));

    /*
     * ⭐ 目标核对 3②：**把"已保存的地址/模型"摆出来**。
     *   她报过"模型名字填了、sk也填了"却仍报"没配好" ⇒
     *   光看输入框里的字**分不清是没保存上还是没填**。
     *   这行读的是**已落盘的设置值**（⛔ 输入框）⇒ 一眼就知道存没存上。
     */
    const savedApi = getSettings().api || {};
    cCh.appendChild(el('div', 'wxg-note wxg-api-savedline',
        '已保存的：地址 ' + (trimText(savedApi.url) || '（空）')
        + '｜推演模型 ' + (trimText(savedApi.model) || '（空）')
        + '｜模式 ' + (savedApi.mode === 'direct' ? '直连' : '经酒馆转发')));
    row(bTest, button('测一下连接', 'test-api', 'wxg-primary'), el('span', 'wxg-note', '（只发一句很短的话，验证地址／密钥／模型对不对）'));
    box.appendChild(cCh);

    /* ⭐ 书签（她点名要的："加一个保存 API／另存为，我可以设定好几个 API 转"） */
    const cProf = card('书签（存好几套通道，一键切）');
    const profs = Array.isArray(api.profiles) ? api.profiles : [];
    if (!profs.length) {
        cProf.appendChild(emptyBlock('还没有书签。上面填好一套，起个名字点「另存为书签」，以后一键切回来。'));
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
            const use = button('切到这套', 'apply-profile', 'wxg-btn-sm wxg-primary', trimText(p.nick));
            acts.appendChild(use);
            acts.appendChild(button('删', 'del-profile', 'wxg-btn-sm', trimText(p.nick)));
            r.appendChild(acts);
            listEl.appendChild(r);
        }
        cProf.appendChild(listEl);
    }
    row(cProf,
        textInput('wxg-profile-nick', '', '书签名（例：主站／备用站）', 'noop', 'wxg-short'),
        button('另存为书签', 'save-profile', 'wxg-primary'));
    cProf.appendChild(el('div', 'wxg-note', '书签存的是**整套**：连接方式／地址／密钥／模型／温度／输出上限。'
        + '书签名一样就更新那一条（不会越存越多）；想现在就用它，点上面那颗「切到这套」。'));
    box.appendChild(cProf);
    /* ★ 20261023 她拍板：附加主体参数／排除主体参数／附加请求头（不靠酒馆也能自己调） */
    /* ★ 20261023 她拍板：附加主体参数／排除主体参数／附加请求头（不靠酒馆也能自己调） */
    const cParams = card('请求参数（不靠酒馆也能自己调）');
    line(cParams, '附加主体参数',
        textarea('wxg-api-extra-body', stagedValue('api', 'extraBody', s.api.extraBody),
            '一行一个：key: value（合并进请求体）', 'stage-api-extra-body', 3));
    line(cParams, '排除主体参数',
        textInput('wxg-api-exclude-body', stagedValue('api', 'excludeBody', s.api.excludeBody),
            '一行一个字段名（默认 top_p）', 'stage-api-exclude-body'));
    line(cParams, '附加请求头',
        textarea('wxg-api-extra-headers', stagedValue('api', 'extraHeaders', s.api.extraHeaders),
            '一行一个：Header: Value', 'stage-api-extra-headers', 2));
    cParams.appendChild(el('div', 'wxg-note',
        '默认已排除 top_p：有些模型不收它，会被它拖成 400。附加主体参数一行一个 key: value，值会自动认数字／true false／JSON；附加请求头同样一行一个。'));
    box.appendChild(cParams);
    box.appendChild(saveBar('api'));
    host.appendChild(box);
}

/* ---------------------------------------------------------------------------
   ⭐ 只读默认 ＋ 「编辑」（复核方第四条：不点是只读，改不了，免得弄错）
   --------------------------------------------------------------------------- */

/** 现在开着编辑的数据卡（键是卡名；⛔ 不落设置——「正在编辑」不是一种设置） */
const unlockedCards = new Set();

/**
 * 把一张数据卡做成「只读默认」：锁着的时候看着就是文字，不是一堆空框。
 *
 * @param {Element} cardEl 卡（就是 card() 返回的那个）
 * @param {string} key 卡名（同一页里唯一即可）
 */
function lockable(cardEl, key) {
    if (!cardEl || !cardEl.classList) {
        return cardEl;
    }
    const open = unlockedCards.has(key);
    cardEl.classList.toggle('is-locked', !open);
    const oldBtn = cardEl.querySelector('.wxg-lock-btn');
    if (oldBtn && oldBtn.parentNode) {
        oldBtn.parentNode.removeChild(oldBtn);
    }
    const head = cardEl.querySelector('.wxg-card-h') || cardEl;
    const b = button(open ? '收起' : '编辑', 'toggle-lock', 'wxg-btn-xs wxg-lock-btn', key);
    if (head.appendChild) {
        head.appendChild(b);
    }
    cardEl.setAttribute('data-lock-key', key);
    /*
     * ⚠️ 真锁（readonly）不能在这儿做：调 `lockable(card(…), …)` 的时候
     *    **卡里还是空的**（输入框是后面 row()/textInput() 才加进去的）
     *    ⇒ 扫不到任何字段、一个 readonly 都上不去。真踩过。
     *    统一放到整页建完之后的 `applyLocks()` 里做。
     */
    return cardEl;
}

/**
 * 把「锁着的卡」里的字段真正设成只读（在整页 DOM 建完之后调）。
 * ⏐ 不能只靠 CSS：样式挡不住键盘输入和脚本赋值。
 * ⏐ 也不锁控制项（开关／颜色）——那些本来就是拿来点的。
 */
export function applyLocks(root) {
    if (!root || typeof root.querySelectorAll !== 'function') {
        return;
    }
    for (const cardEl of asArray(root.querySelectorAll('.wxg-card[data-lock-key]'))) {
        const locked = cardEl.classList && cardEl.classList.contains('is-locked');
        for (const f of asArray(cardEl.querySelectorAll('input, textarea, select'))) {
            if (!f || !f.setAttribute) {
                continue;
            }
            if (f.type === 'color' || f.type === 'checkbox') {
                continue;
            }
            let noLock = typeof f.closest === 'function' && !!f.closest('[data-no-lock]');
            if (!noLock) {
                for (let p = f.parentNode; p && p !== cardEl; p = p.parentNode) {
                    if (typeof p.getAttribute === 'function' && p.getAttribute('data-no-lock')) {
                        noLock = true;
                        break;
                    }
                }
            }
            if (noLock) {
                f.removeAttribute('readonly');
                f.removeAttribute('tabindex');
                continue;
            }
            if (locked) {
                f.setAttribute('readonly', 'readonly');
                f.setAttribute('tabindex', '-1');
            } else {
                f.removeAttribute('readonly');
                f.removeAttribute('tabindex');
            }
        }
    }
}

/** 从 URL 里取主机名，只用于显示（⛔ 不泄露整条密钥） */
function hostOf(url) {
    const s = asText(url);
    const m = s.match(/^[a-z]+:\/\/([^/]+)/i);
    return m ? m[1] : (s.length > 24 ? s.slice(0, 24) + '…' : s);
}

/**
 * 提示词：**折叠条 ＋ 当前用的那份直接预览**。
 *
 * 体检结论点名这里最重："世界推演／角色状态／破限词三个大空框叠着，像没做完的草稿"。
 * 改法：一套提示词一块卡 —— 先给她看**当前实际会用的那份**（留空就是内置的，直接摊开读），
 * 想改才点「改这套」展开输入框。⛔ 空框不再当主角。
 */
function secPrompts(host) {
    const s = getSettings();
    const box = section('提示词（可看可改）',
        '留空＝用内置默认；填了＝原样用你写的。破限词同理。'
        + '下面每块先显示**当前实际用的那份**（留空就是内置的），想改再点「改这套」。',
        { open: false, five: true });

    /*
     * ⭐ 一屏一个焦点（复核方第一条）：**只把第一块摊开**，其余三块收起。
     *    四块内容差不多、都很长 ⇒ 全摊开就是"一屏四张卡"，正是他说要避免的。
     *    收起不等于藏起来：卡头那行字还在，点一下就展开（⛔ 不丢任何东西）。
     */
    const cHead = card('注入块开头那句');
    cHead.appendChild(el('div', 'wxg-note', '每轮注入的最前面那一行，声明"这是引擎附注"。'));
    cHead.appendChild(el('pre', 'wxg-prompt-cur', effectivePrompt('header')));
    const editHead = foldable('改这套（留空＝用内置）', false);
    editHead.appendChild(textarea('wxg-inject-header', s.injectHeader, '（留空＝用内置那份）', 'stage-inject-header', 3));
    cHead.appendChild(editHead);
        box.appendChild(expandPair({ el: el, button: button }));   /* 六：全部展开／全部收起 */
box.appendChild(cHead);

    const cMore = card('后台推演与破限提示词（按需展开）');
    const addFoldedPrompt = (title, keyVal, kind, id, rows, hint) => {
        /* 17-1：用途副标（文案在 ui/prompt-copy.js，主文件别再长） */
    /* 81：折叠行只留名词；用途与字数进 title */
    const fold = foldable(title, false);
    fold.title = (purposeOf(kind).replace(/^ · /, '') + ' · 展开看这套（' + String(effectivePrompt(kind).length) + ' 字）').trim();
        const body = el('div', 'wxg-report-body');
        body.appendChild(el('div', 'wxg-note', hint));
        body.appendChild(el('pre', 'wxg-prompt-cur', effectivePrompt(kind)));
        const edit = foldable('改这套（留空＝用内置）', false);
        edit.appendChild(textarea(id, keyVal, '（留空＝用内置那份）', 'stage-' + id.replace('wxg-', ''), rows));
        body.appendChild(edit);
        fold.appendChild(body);
        cMore.appendChild(fold);
    };

    /*
     * 17-2：她改提示词时要知道能引用什么（全库此前 0 个变量清单）。
     *   清单在 ui/prompt-copy.js；这里只负责装进卡里。
     */
    const cVars = foldable('能写哪些变量', false);
    for (const row of promptVarRows()) {
        cVars.appendChild(el('div', 'wxg-note', row[0] + '  ' + row[1]));
    }
    cMore.appendChild(cVars);

    addFoldedPrompt('世界推演提示词', s.promptWorld, 'world', 'wxg-prompt-world', 8,
        '让模型推"世界现在什么样"时用的那套规矩。');
    addFoldedPrompt('角色状态／平行事件提示词', s.promptChars, 'chars', 'wxg-prompt-chars', 8,
        '让模型写每个角色的平行线时用的那套规矩。');
    addFoldedPrompt('前台人物层提示词', s.promptFront, 'front', 'wxg-prompt-front', 8,
        '只管正文里在场的人；不许推演、不许编。留空＝用内置。');
    addFoldedPrompt('后台人物层提示词', s.promptBack, 'back', 'wxg-prompt-back', 8,
        '没出场的人：允许推演，但不当实锤。留空＝用内置。');
    addFoldedPrompt('世界层提示词', s.promptWorldLayer, 'worldLayer', 'wxg-prompt-worldlayer', 8,
        '背景板：天气、经济、政策、组织压力。留空＝用内置。');
    addFoldedPrompt('局势层提示词', s.promptSituation, 'situation', 'wxg-prompt-situation', 8,
        '台面上谁跟谁顶着（至少两方）。留空＝用内置。');
    addFoldedPrompt('暗流层提示词', s.promptHiddenLayer, 'hiddenLayer', 'wxg-prompt-hidden', 8,
        '背后攒劲：谁在办、办到第几步。留空＝用内置。');
    addFoldedPrompt('编年层提示词', s.promptChronicle, 'chronicle', 'wxg-prompt-chronicle', 8,
        '往回看：之前发生过什么。留空＝用内置。');
    addFoldedPrompt('舆情层提示词', s.promptOpinion, 'opinion', 'wxg-prompt-opinion', 8,
        '外面在怎么说（新闻／论坛，只读）。留空＝用内置。');
    addFoldedPrompt('破限词', s.jailbreak, 'jailbreak', 'wxg-jailbreak', 6,
        '模型有时候"不填东西"——这一段是逼它老实填字段用的。');
    const resetRow = el('div', 'wxg-card-actions');
    row(resetRow, button('全部恢复内置默认', 'reset-prompts'),
        el('span', 'wxg-note', '（只清提示词，不动你的开关）'));
    cMore.appendChild(resetRow);
    box.appendChild(cMore);
    /*
     * 依据＝阿砚第四批 4-a E3（三家都有的提示词预设库）：
     *   ① 多套命名（名字＋时间＋字数） ② 内置不可删，只能另存为副本
     *   ③ 颗粒度可以到**单个块** ④ 导入导出带 kind/version ⑤ 应用时⛔ 重建现场
     */
    const cPreset = card('提示词预设（可只存一块）');
    cPreset.appendChild(el('div', 'wxg-note', '内置那几套不能删（要改就另存为副本）；"应用"只改提示词，不会重算。'));
    const presets = listPresets(s);
    const presetOpts = presets.map((pp) => ({ value: pp.id, label: pp.name + '（' + describePreset(pp) + '）' }));
    if (!presetOpts.length) {
        presetOpts.push({ value: '', label: '（还没有预设）' });
    }
    const presetRow = el('div', 'wxg-card-actions');
    presetRow.appendChild(select('wxg-preset-sel', presetOpts, presets.length ? presets[0].id : '', 'noop'));
    presetRow.appendChild(button('应用', 'apply-preset', 'wxg-btn-sm'));
    presetRow.appendChild(button('删除', 'delete-preset', 'wxg-btn-xs'));
    cPreset.appendChild(presetRow);
    const blockRow = el('div', 'wxg-card-actions');
    blockRow.appendChild(el('span', 'wxg-note', '另存为副本时存哪一块：'));
    blockRow.appendChild(select('wxg-preset-block', [
        { value: 'all', label: '整套（四块）' },
        { value: 'world', label: '只存「世界推演」' },
        { value: 'chars', label: '只存「角色状态／平行事件」' },
        { value: 'jailbreak', label: '只存「破限词」' },
        { value: 'header', label: '只存「开头那句」' },
    ], 'all', 'noop'));
    blockRow.appendChild(textInput('wxg-preset-name', '', '新预设的名字', 'noop'));
    blockRow.appendChild(button('另存为副本', 'save-preset', 'wxg-btn-sm'));
    cPreset.appendChild(blockRow);
    const ioRow = el('div', 'wxg-card-actions');
    ioRow.appendChild(button('导出整包', 'export-presets', 'wxg-btn-xs'));
    ioRow.appendChild(button('导入整包', 'import-presets', 'wxg-btn-xs'));
    cPreset.appendChild(ioRow);
    const ioBox = textarea('wxg-preset-io', '', '导出的 JSON 就在这里（复制走）；导入就把 JSON 粘进来再点导入', 'noop', 4);
    cPreset.appendChild(ioBox);
    box.appendChild(cPreset);

    box.appendChild(saveBar('prompts'));
    host.appendChild(box);
}

/**
 * 每轮记录（原「过程报告」）。同上：给了容器就摆进去，自己不开页。
 */
function secReport(host, intoBox) {
    const list = recentRecallRecords(20);
    const box = intoBox || section('过程报告 · 每轮到底注入了什么', '每轮注入了什么，可回看',
        { open: false });
    const noteText = '按时间从新到旧：① 怎么挑的 ② 实际送进请求的内容一字不差（可复制）'
        + '③ 回执（成没成、多少字、什么身份、为什么没注入）。（' + FLOOR_NOTE + '）';
    if (!list.length) {
        /*
         * ⚠️ 空的时候**也要有标题**（并页之后更明显）：原来整块都不画 ⇒
         *    她在「状态」页上根本不知道这儿将来会出一条"每轮记录"。
         *    现在就一句「还没有记录」，标题留着。
         */
        const cEmpty = card('每轮记录');
        cEmpty.appendChild(el('div', 'wxg-note', noteText));
        cEmpty.appendChild(el('div', 'wxg-empty', '还没有记录：发一条消息、正文生成之后就会有了。'
        + '如果发过了还是没有，去「自定义 API」看通道与地址填了没。'));
        box.appendChild(cEmpty);
        if (!intoBox) {
            host.appendChild(box);
        }
        return;
    }
    /* 必修 9：这一轮没进账就在卡头下面放红条（⛔ toast／⛔ 埋在列表里）；画法在 ui/runwarn-view.js */
    try {
        renderRunWarn({ box: box, warn: runWarning(loadState()), el: el, doc: document });
    } catch (eWarn) { /* 红条画不出来也不能拦着这页 */ }

    /*
     * ⭐ 有数据排版术：顶部一排**筛选胶囊带计数**（这一页天生带状态：成没成／注入没注入），
     *    每条的状态做成**胶囊**（原来埋在文字里，"哪条没成"得逐字读）。
     */
    const statusOf = (r) => (r.injectStatus === 'ok' ? '已注入'
        : (r.injectStatus === 'empty' ? '未注入' : (r.injectStatus === 'error' ? '失败' : '待送')));
    const statusTone = (r) => (r.injectStatus === 'ok' ? 'is-ok'
        : (r.injectStatus === 'error' ? 'is-warn' : 'is-off'));
    const shownList = reportFilter === 'all' ? list : list.filter((r) => statusOf(r) === reportFilter);
    const fbar = el('div', 'wxg-filters');
    const mkF = (key, label, n) => {
        const b = el('button', 'wxg-filter' + (reportFilter === key ? ' is-on' : ''), label);
        b.type = 'button';
        b.setAttribute('data-action', 'report-filter');
        b.setAttribute('data-id', key);
        b.appendChild(el('span', 'wxg-filter-n', String(n)));
        return b;
    };
    fbar.appendChild(mkF('all', '全部', list.length));
    for (const st of ['已注入', '未注入', '失败']) {
        const n = list.filter((r) => statusOf(r) === st).length;
        if (n) {
            fbar.appendChild(mkF(st, st, n));
        }
    }

    const cRep = card('每轮记录（从新到旧）');
    cRep.appendChild(el('div', 'wxg-note', noteText));
    cRep.appendChild(fbar);
    for (let idx = 0; idx < shownList.length; idx += 1) {
        const rec = shownList[idx];
        const shownChars = countChars(rec.injectedText);
        const statusText = statusOf(rec);
        /* ⭐ LY8（材料 11）：传空字符串就不加展开箭头 ⇒ 整行看不出可点 ✗
     *   现在传一个空格（有值但不显字 ✓）⇒ chevron 会加上 ✓ */
    const det = foldable(' ', false);
        if (det.classList) {
            det.classList.add('is-row');
        }
        const sum = det.querySelector('summary');
        if (sum) {
            sum.textContent = '';
            sum.appendChild(el('span', 'wxg-r-k wxg-num', shortTime(rec.at)));
            sum.appendChild(el('span', 'wxg-badge ' + statusTone(rec), statusText));
            sum.appendChild(el('span', 'wxg-note', floorLabel(rec.floor)
                + (rec.injectStatus === 'ok' ? ' · ' + String(shownChars) + ' 字' : '')));
            sum.appendChild(el('span', 'wxg-r-who', rec.chars && rec.chars.length
                    ? rec.chars.map((x) => trimText(x && x.name) || trimText(x)).filter(Boolean).join('、')
                    : '暂无'));   /* 86：对象数组直接 join 会出 [object Object] */
        }
        const body = el('div', 'wxg-report-body');

        body.appendChild(el('div', 'wxg-report-h', '① 怎么挑的'));
        const lead = trimText(rec.lead);
        body.appendChild(el('div', 'wxg-fact', '你这条发言：' + (lead ? (lead.length > 80 ? lead.slice(0, 80) + '…' : lead) : '（没记到）')));
        if (Array.isArray(rec.items) && rec.items.length) {
            for (const item of rec.items) {
                const c = item && item.character ? item.character : {};
                const bits = [trimText(c.name) || '未记名', '理由：' + (trimText(item.reason) || '暂无')];
                const has = [];
                has.push(trimText(c.affinity) ? '好感 ' + trimText(c.affinity) : '好感未建立');
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
        /*
         * ⭐ 补②「送达回执」：**发出去了 ≠ 正文接到了**。这一行就是那后半句。
         *   · 已进正文（#N）／候补（第 k/3 轮没进）／已转编年（不再占注入位）
         *   ⛔ 只如实报，不替正文辩解；没标记的老记录就写「还没核过」。
         */
        const arriveLine = trimText(rec.arrivedNote)
            || (rec.injectStatus === 'ok' ? '还没核过（下次更新时会对着正文核一遍）' : '');
        if (arriveLine) {
            const aRow = el('div', 'wxg-notes', '送达：' + arriveLine);
            if (rec.archived === true) {
                aRow.setAttribute('data-tone', 'bad');
            }
            body.appendChild(aRow);
        }
        det.appendChild(body);
        /*
         * ⭐ 点行弹浮层（照目标包：跟名册那件**同一套手法**）。
         *   做法刻意保守：**正文那 ①②③ 一个字没改**——原来拼进 `det`（行内折叠条），
         *   现在**把它整块搬进浮层**（DOM 搬移），所以不存在"浮层里跟行内不一样"。
         *   ⛔ 没开任何一条时，行为跟以前一模一样（照旧挂回列表）。
         */
        /* Q2（材料 05）：**先把行挂上（永远挂 ✓）**，再决定要不要弹浮层 ✓
         *   旧：只有 else 才 appendChild ✗ ⇒ 开浮层时那一行从列表里消失 ✗（与人物名册不一致 ✗） */
        if (sum) {
            sum.setAttribute('data-action', 'open-record');
            sum.setAttribute('data-id', String(idx));
        }
        cRep.appendChild(det);
        if (openRecordAt === idx) {
            renderRecordCard(rec, body, idx, shownList.length, statusText, statusTone(rec), shownChars);
        }
    }
    box.appendChild(cRep);
    if (!intoBox) {
        host.appendChild(box);
    }
}

/**
 * 进度那一整块。
 * @param {object} host 宿主（只在需要自开一页时用）
 * @param {object} [intoBox] 给了就往这个盒子里摆（（三页并一页就是走这条），⏐ 不再开新页
 */
function secSteps(host, intoBox) {
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
    stepPage = clampPage(stepPage, shown.length, PER_PAGE.steps);
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

/* ------------------------------ 渲染与事件 ------------------------------ */

/** 把整套分节画进宿主 */
/* ------------------------------ ⭐ 浮层人物卡（② 名册点开详情） ------------------------------ */

/**
 * 为什么做成浮层（她 2026-10-14 点名的）：
 *   原来点一行的做法是**行内展开**——一个巨大表单把后面 40 行全推下去，左边还挂个
 *   「改他的状态」标签跟输入框对不齐（真机截图里很难看）。
 *   ⇒ 照目标包 `目标-名册浮层人物卡-20261014/目标-名册浮层人物卡-目标态.html` 改成**可拖浮层**：
 *     覆盖层，表格**原地不动**；大名字做锚；两栏标签值；底部长条换人。
 *
 * ⚠️ 关键决定：**沿用同一套控件与动作名**（`set-char-field` / `merge-into` / `data-id` / `data-key`）
 *   ⇒ 数据层**一行不改**（保存路径、手改锁、快照都还是原来那条），⛔ 不另起一套。
 */
let personCardId = null;
/* ⭐ B8（材料 13）：当前正在选“并进哪一位”的角色 id（⛔ 再弹 window.prompt ✗） */
let mergePickFor = null;
/* ★ 她 22:1x：查重结果与勾选（可勾选后一键合并） */
let dupGroups = [];
let dupPick = new Set();
/*
 * ⭐ 浮层要挂在**段容器里**而不是 body：
 *   点击处理器只绑在段容器上（`bindSectionEvents(host)`）⇒
 *   挂 body 上的话，浮层里的「下一位」「×」「保存」「改字」**全都点不动**
 *   （真机门当场抓到：下一位没反应、关不掉）。
 *   用 `position: fixed` 照样浮在最上层，不受宿主滚动影响。
 */
let lastSectionsHost = null;

/* ------------------------- 页头「功能 ⋮」的真菜单 ------------------------- */
/*
 * ⭐⭐ 材料 10 · 第 1 组裁定（她 10-17 10:07 授权代拍）：**三颗假「功能 ⋮」⇒ 接真菜单** ✓
 *   旧：三处点下去只弹一句 toast.info 指路（“导出在…”／“入口位…”）✗ = **假按钮** ✗
 *   现在：点开是一张**真菜单**，每一项都直接调**现成动作** ✓（⛔ 一句“开发中”都没有 ✗）
 *   菜单挂在 `lastSectionsHost` 里 ✓ ⇒ 复用页面既有的点击委派 ✓（⛔ 另写一套监听 ✗）
 */
let funcMenuEl = null;
function closeFuncMenu() {
    if (funcMenuEl && funcMenuEl.parentNode) {
        funcMenuEl.parentNode.removeChild(funcMenuEl);
    }
    funcMenuEl = null;
}
function openFuncMenu(anchorEl, items) {
    const wasOpen = !!(funcMenuEl && funcMenuEl.__owner === anchorEl);
    closeFuncMenu();
    if (wasOpen) {
        return;   // 再点一下收起 ✓
    }
    /*
     * ⭐⭐ 定位：**挂成按钮的兄弟，用 CSS 贴住它** ✓
     *   为什么不用矩形算：真机探针里这些按钮报回的矩形是 **0×0** ✗
     *   （而它们明明画在屏上）⇒ 用矩形算出来的坐标必然是乱的 ✗
     *   现在：放到按钮的父节点里（层级变一级），`top:100%; right:0` ⇒ 永远贴在它下面 ✓
     *   ⛔ 改回 body：那样就吃不到宿主的事件委托（菜单项点不了 ✗）
     */
    const anchorParent = (anchorEl && anchorEl.parentNode) ? anchorEl.parentNode : null;
    /*
     * ⭐ 真机第 4 次抳回：**父节点是 static ⇒ 绝对定位会跑去更远的祖先** ✗
     *   真机量到：按钮在 (1350,153)，菜单却落在 **y=956** ✗
     *   现在：父节点没有定位就给它补一个 `relative` ✓（不改任何偏移量 ✓）
     */
    if (anchorParent && anchorParent.style) {
        const posNow = (typeof window !== 'undefined' && window.getComputedStyle)
            ? window.getComputedStyle(anchorParent).position
            : 'relative';
        if (posNow === 'static' || !posNow) {
            anchorParent.style.position = 'relative';
        }
    }
    const host = anchorParent || lastSectionsHost || document.body;
    const menu = el('div', 'wxg-funcmenu' + (anchorParent ? ' wxg-funcmenu-anchored' : ''));
    menu.__owner = anchorEl;
    for (const it of items) {
        const b = button(it.label, it.action, 'wxg-funcmenu-item', it.id);
        if (it.title) {
            b.title = it.title;
        }
        menu.appendChild(b);
    }
    host.appendChild(menu);
    /*
     * ⭐ 只有“没有父节点”时才用矩形兜底 ✓
     *   有父节点时靠 `wxg-funcmenu-anchored`（absolute + top:100% + right:0）贴住按钮 ✓
     *   ⛔ 两套同时跑：内联 left/top 会把 CSS 那式盖掉 ✗（v0.3.259 真犯过 ✗）
     */
    if (!anchorParent) {
        try {
            const r = anchorEl.getBoundingClientRect();
            menu.style.left = String(Math.max(8, Math.round(r.right - 200))) + 'px';
            menu.style.top = String(Math.round(r.bottom + 6)) + 'px';
        } catch (ePos) { /* 实在拿不到就用 CSS 默认位置 ✓ */ }
    }
    funcMenuEl = menu;
    /* 点别处收起（捕获阶段先跑，但不拦菜单里的点击 ✓） */
    setTimeout(() => {
        const off = (ev) => {
            if (menu && ev && ev.target && menu.contains && menu.contains(ev.target)) {
                return;
            }
            document.removeEventListener('click', off, true);
            closeFuncMenu();
        };
        document.addEventListener('click', off, true);
    }, 0);
}
/**
 * 浮层在**编辑态**吗？默认 false＝**只读**；点右上「⋮」才进编辑。
 * （她的原话：不点是只读改不了免得弄错；目标包：⋮点开＝编辑这一位）
 */
let personCardEditing = false;

/**
 * ⭐ 「每轮记录」点开的是第几条（-1＝都没开）。
 *   照目标包：点行弹浮层，**跟名册那件同一套手法**（⛔ 行内展开）。
 */
let openRecordAt = -1;

/**
 * ★ 20261022 §五 5（真）：**浮层按 Esc 要能关**。
 *   只挂一次全局监听（⛔ 每开一次就挂一个）。
 */
/*
 * Esc 关人物浮层：挂一次全局监听（TW 契约：配对清理）。
 *   实现搬到 `ui/esc-close.js`（主文件贴着 8200 行硬线）；这里只管“现在有没有开着的卡”。
 */
let personCardEscBound = false;
function bindPersonCardEsc() {
    if (personCardEscBound) { return; }
    bindEscClose({
        isActive: () => Boolean(personCardId),
        onEsc: () => closePersonCard(),
    });
    personCardEscBound = true;
}

/** 卸掉 Esc 监听（停用／卸载时调） */
export function unbindPersonCardEsc() {
    unbindEscClose();
    personCardEscBound = false;
}

export function openPersonCard(id) {
    personCardId = id || null;
    personCardEditing = false;   // 开卡／换人：一律先回到**只读**态
    bindPersonCardEsc();
    renderPersonCard();
}

export function closePersonCard() {
    personCardId = null;
    personCardEditing = false;
    const old = document.getElementById('wxg-person-card');
    if (old && typeof old.remove === 'function') {
        old.remove();
    }
}

/** 把浮层画出来（挂在 body 上＝真浮层，⛔ 不塞进段里免得被重画冲掉） */
function renderPersonCard() {
    const host = document.getElementById('wxg-person-card');
    if (host && typeof host.remove === 'function') {
        host.remove();
    }
    if (!personCardId) {
        return;
    }
    const roster = getRoster();
    const at = roster.findIndex((c) => c.id === personCardId);
    if (at < 0) {
        personCardId = null;
        return;
    }
    const c = roster[at];
    const one = findCharacter(personCardId) || c;

    const pop = el('div', 'wxg-pc wanxiangge');
    pop.id = 'wxg-person-card';
    pop.setAttribute('role', 'dialog');

    const head = el('div', 'wxg-pc-head');
    head.appendChild(el('span', 'wxg-pc-grip', '⠿'));
    const who = el('div', 'wxg-pc-who');
    who.appendChild(el('div', 'wxg-pc-name', c.name || '（没名字）'));
    who.appendChild(el('div', 'wxg-pc-alias', '别名 · ' + (one.aliases && one.aliases.length ? one.aliases.join('、') : '暂无')));
    head.appendChild(who);
    const badges = el('div', 'wxg-pc-badges');
    if (one.inScene) {
        badges.appendChild(el('span', 'wxg-badge is-ok', '在场'));
    }
    /* ★ [580] A7：在场原料一眼可见 */
    if (Number.isFinite(Number(one.presentFloor)) && Number(one.presentFloor) >= 0) {
        badges.appendChild(el('span', 'wxg-badge is-soft', '在场楼 #' + String(one.presentFloor)));
    }
    {
        const rel = Number.isFinite(Number(one.relevance)) ? Number(one.relevance) : 1;
        const relBadge = el('span', 'wxg-badge is-soft', '相关度 ' + String(rel) + '/3');
    relBadge.title = '相关度：当前正文提到他的强弱，从 0（没提到）到 3（正在跟他对戏）';   /* 六-4：1/3 是什么要能问到 */
    badges.appendChild(relBadge);
    }
    if (one.manual) {
        badges.appendChild(el('span', 'wxg-badge is-warn', '已手动修改'));
    }
    if (one.isPlayer) {
        badges.appendChild(el('span', 'wxg-badge is-info', '玩家棋子'));
    }
    head.appendChild(badges);
    const kebab = button('⋮', 'card-edit', 'wxg-pc-kebab');
    kebab.title = personCardEditing ? '正在编辑（点一下收起）' : '编辑这一位（点了才可改，不点只读）';
    head.appendChild(kebab);
    const x = button('×', 'card-close', 'wxg-pc-x');
    x.title = '关掉（Esc 也行）';
    head.appendChild(x);
    pop.appendChild(head);

    const sec1 = el('div', 'wxg-pc-sec');
    sec1.appendChild(el('div', 'wxg-pc-sech', '基础信息'));
    const kv = el('div', 'wxg-pc-kv');
    const row2 = (k1, f1, ph1, k2, f2, ph2) => {
        kv.appendChild(el('div', 'wxg-pc-k', k1));
        kv.appendChild(fieldBox(cid, f1, one[f1], ph1));
        kv.appendChild(el('div', 'wxg-pc-k', k2));
        kv.appendChild(fieldBox(cid, f2, one[f2], ph2));
    };
    /*
     * ⚠️ 一律用 **state 那份**的 id（`one.id`）去挂 data-id：
     *   名册那份（`c.id`）跟 state 那份**类型可能不一样**（数字 vs 字符串），
     *   而外面点这些格子的人（用例、以后的代码）拿的是 state 那份 ⇒ 不一致就"找不到输入框"。
     */
    const cid = one.id !== undefined && one.id !== null ? one.id : c.id;

    row2('年龄', 'age', '—', '身份', 'identity', '—');
    row2('所在势力', 'faction', '—', '好感', 'affinity', '—');   /* 六-3：内部状态词不印给她 */
    /* ★ B1（六档名册）：档位可看可改，改了记手改锁 ✓ */
    {
        kv.appendChild(el('div', 'wxg-pc-k', '档位（六档）'));
        const roleNow = trimText(one.role);
        const roleSel = select('wxg-pc-role-' + cid, ROLES.map((r) => ({ value: r, label: r })), roleNow, 'set-role', cid);
        roleSel.setAttribute('data-id', cid);
        kv.appendChild(roleSel);
    }
    /* ★ 她 22:2x 点头加的两格（事实，不是表演层）✓ */
    row2('认知账（他会怎么做）', 'behaviorBounds', '（还没记）', '知识面（他不知道什么）', 'knowledgeBounds', '（还没记）');   /* 六-1：⛔ 拿字段名当内容 */
    /*
     * ⭐ 别名／玩家棋子也放进来。
     * ⚠️ 它们原来只在**行内展开**里（`set-alias` / `set-player`）——把行改成开浮层之后
     *    那两个开关就摸不到了（audit-3 当场红了 4 条）⇒ 补进浮层，动作名沿用同一套。
     */
    kv.appendChild(el('div', 'wxg-pc-k', '别名'));
    const aliasWrap = el('div', 'wxg-pc-v');
    aliasWrap.classList.add('wxg-pc-full');
    if (!personCardEditing) {
        const al = (one.aliases || []).join('、');
        aliasWrap.appendChild(el('div', 'wxg-pc-text' + (al ? '' : ' is-empty'), al || '暂无'));
    } else {
        const aliasInput = textInput('wxg-pc-alias-' + cid, (one.aliases || []).join('、'),
            '别名／昵称（顿号或逗号分开）', 'set-alias');
        aliasInput.setAttribute('data-id', cid);
        aliasWrap.appendChild(aliasInput);
    }
    kv.appendChild(aliasWrap);
    const pbox = el('label', 'wxg-pc-player');
    const pchk = el('input', null);
    pchk.type = 'checkbox';
    pchk.checked = one.isPlayer === true;
    pchk.setAttribute('data-action', 'set-player');
    pchk.setAttribute('data-id', cid);
    pbox.appendChild(pchk);
    pbox.appendChild(el('span', null, '这是玩家棋子（AI 不扮演、不推演）'));
    kv.appendChild(el('div', 'wxg-pc-k', ''));
    const pwrap = el('div', 'wxg-pc-v');
    pwrap.classList.add('wxg-pc-full');
    pwrap.appendChild(pbox);
    kv.appendChild(pwrap);

    /*
     * ⭐ 补①：「参与后台推演」开关（默认开）。
     *   说人话：**关掉＝后台不再推他**（不占轮转名额）；他仍在名册里，
     *   正文写到他的时候**照旧更新**（现场那套不变）。⛔ 关掉不删任何历史。
     *   ⚠️ 这里**用"关"来描述**（`noBench` 存的是"关"），因为默认是开——
     *     勾选框的措辞要是反的，她会勾错（"勾上＝不推"最容易看反）。
     */
    const bbox = el('label', 'wxg-pc-player');
    const bchk = el('input', null);
    bchk.type = 'checkbox';
    bchk.checked = one.noBench !== true;
    bchk.setAttribute('data-action', 'set-bench');
    bchk.setAttribute('data-id', cid);
    bbox.appendChild(bchk);
    bbox.appendChild(el('span', null, '参与后台推演（不勾＝只在正文写到他时才更新，不占轮转名额）'));
    kv.appendChild(el('div', 'wxg-pc-k', ''));
    const bwrap = el('div', 'wxg-pc-v');
    bwrap.classList.add('wxg-pc-full');
    bwrap.appendChild(bbox);
    kv.appendChild(bwrap);
    kv.appendChild(el('div', 'wxg-pc-k', '时间·地点'));
    const tp = fieldBox(cid, 'timePlace', one.timePlace, '未知');
    tp.classList.add('wxg-pc-full');
    kv.appendChild(tp);
    kv.appendChild(el('div', 'wxg-pc-k', '正在经历'));
    const cur = fieldBox(cid, 'current', one.current, '本回合没写他');
    cur.classList.add('wxg-pc-full');
    kv.appendChild(cur);
    sec1.appendChild(kv);
    pop.appendChild(sec1);
    const sec2 = el('div', 'wxg-pc-sec');
    sec2.appendChild(el('div', 'wxg-pc-sech', '过去经历（由近到远，旧的自然淡化）'));
    const past = Array.isArray(one.past) ? one.past.slice(0, 6) : [];
    if (!past.length) {
        sec2.appendChild(el('div', 'wxg-empty', '还没有过去经历（更新几轮就有了）'));
    } else {
        const q = el('div', 'wxg-pc-quote');
        for (const p of past) {
            const line = el('div', null, trimText(p && p.text) || '暂无');
            /*
             * ⭐ 修复单 #36a：**字段名写错了**——
             *   `past[]` 里存的是 `fromFloor`（见 `core/state.js` 的规范），`p.floor` **永远是 undefined**
             *   ⇒ `Number(undefined)` 不是有限数 ⇒ 条件永远不成立 ⇒ **楼号从来没显示过**。
             */
            if (p && Number.isFinite(Number(p.fromFloor)) && Number(p.fromFloor) >= 0) {
                line.insertBefore(el('span', 'wxg-pc-when', floorLabel(p.fromFloor)), line.firstChild);
            }
            /*
             * ⭐ 新增件 1（材料 13）：**过去经历逐条就地改与删** ✓
             *   旧：浮层卡这块**只读** ✗（只有旧角色状态页那份有删与加 ✗）
             *   现在：编辑态下每条带一个就地输入框＋存＋删 ✓
             *   （用**真实下标**定位：`past` 是 slice，用 `one.past.indexOf(p)` 回去对 ✓）
             */
            if (personCardEditing) {
                const ridx = (one.past || []).indexOf(p);
                if (ridx >= 0) {
                    const ep = document.createElement('input');
                    ep.type = 'text';
                    ep.className = 'wxg-pc-input';
                    ep.id = 'wxg-past-edit-' + String(ridx);
                    ep.value = trimText(p && p.text);
                    const sbtn = button('保存', 'past-save', 'wxg-btn-xs', c.id);
                    sbtn.setAttribute('data-idx', String(ridx));
                    const dbtn = button('删', 'past-del', 'wxg-btn-xs', c.id);
                    dbtn.setAttribute('data-idx', String(ridx));
                    line.appendChild(ep);
                    line.appendChild(sbtn);
                    line.appendChild(dbtn);
                }
            }
            q.appendChild(line);
        }
        sec2.appendChild(q);
    }
    pop.appendChild(sec2);
    /*
     * ⭐「不可靠」提醒（原本**只在角色状态页**）——她点名的污染就是这个，得当场说出来。
     *   它本来就是"某个人的某一格不可靠" ⇒ 摆进**这个人的卡片**最合适。
     */
    if (one.currentSuspect) {
        const warnBox = el('div', 'wxg-pc-sec');
        const w = el('div', 'wxg-store', '⚠ 这条「正在经历」引擎判定**不可靠**：'
            + (trimText(one.currentSuspectWhy) || '疑似越界'));
        w.setAttribute('data-tone', 'bad');
        warnBox.appendChild(w);
        pop.appendChild(warnBox);
    }
    /*
     * ⭐ 补③ 认知账（最小形态・第一步）：他**该知道的**清单。
     *   她当初只能靠提示词纪律（"每个角色只知道他自己该知道的"），现在**落成账**。
     *   ⚠️ 本步只做「清单 ＋ 界面可见＋能手加能手删」；
     *     "推演时只喂清单里的"是**第二步**（她允许分两步）。
     */
    const kSec = el('div', 'wxg-pc-sec');
    kSec.appendChild(el('div', 'wxg-pc-sech', '他知道什么（只收发生过的、他碰得到的；**不许编**）'));
    const kList = Array.isArray(one.knows) ? one.knows : [];
    if (!kList.length) {
        kSec.appendChild(el('div', 'wxg-empty', '还没记他知道什么（下面可以手加一条）'));
    } else {
        kList.forEach((k, ki) => {
            const rowK = el('div', 'wxg-fact');
            rowK.appendChild(el('span', 'wxg-badge wxg-badge-soft', trimText(k.source) || '公开'));
            rowK.appendChild(el('span', null, ' ' + trimText(k.text)));
            if (Number(k.floor) >= 0) {
                rowK.appendChild(el('span', 'wxg-note', ' · ' + floorLabel(Number(k.floor))));
            }
            const delK = button('删', 'del-know', 'wxg-btn-xs', cid);
            delK.setAttribute('data-index', String(ki));
            rowK.appendChild(delK);
            kSec.appendChild(rowK);
        });
    }
    const kAdd = el('div', 'wxg-row');
    const kTxt = el('input', 'wxg-pc-input');
    kTxt.type = 'text';
    kTxt.id = 'wxg-know-text';
    kTxt.placeholder = '他知道了什么（一句话）';
    kAdd.appendChild(kTxt);
    const kSrc = select('wxg-know-source', [
        { value: '亲眼', label: '亲眼' },
        { value: '被告知', label: '被告知' },
        { value: '公开', label: '公开' },
    ], '亲眼', 'noop');
    kAdd.appendChild(kSrc);
    const kBtn = button('加一条', 'add-know', 'wxg-btn-sm', cid);
    kAdd.appendChild(kBtn);
    kSec.appendChild(kAdd);
    pop.appendChild(kSec);
    /*
     * ⭐⭐ 材料 06【4】#6：**「日程」整块在人物卡上消失了** ✗
     *   她的原话：把旧「角色状态」页并进浮层卡时，**只搬了八格、认知账和任务，漏搬了 c.schedule** ✗
     *   ⇒ 约好的事（出差几天后回来等）在卡上**看不到也改不了** ✗
     *   现在：把日程块搬回来 ✓（只读展示；改动走后台推演，⛔ 让她手改算账 ✗）
     */
    if (Array.isArray(one.schedule) && one.schedule.length) {
        const sSec = el('div', 'wxg-pc-sec');
        sSec.appendChild(el('div', 'wxg-pc-sech', '日程（约好的事）'));
        for (const s of one.schedule) {
            const sr = el('div', 'wxg-rowitem');
            const sh = el('div', 'wxg-rowname');
            sh.appendChild(el('span', 'wxg-name', trimText(s && (s.what || s.text)) || '（没记名）'));
            if (trimText(s && s.due)) {
                sh.appendChild(el('span', 'wxg-badge wxg-badge-soft', trimText(s.due)));
            }
            if (s && s.done === true) {
                sh.appendChild(el('span', 'wxg-badge is-off', '已完成'));
            } else if (s && s.dueReached === true) {
                sh.appendChild(el('span', 'wxg-badge is-warn', '已到点·本轮应履约'));
            }
            sr.appendChild(sh);
            /* ⭐ 新增件 1（材料 13）：**日程也能她自己了结或删掉** ✓（仅编辑态出现 ✓） */
            if (personCardEditing) {
                const acts2 = el('div', 'wxg-rowacts');
                const what2 = trimText(s && (s.what || s.text));
                if (s && s.done !== true) {
                    const doneBtn = button('了结', 'sched-done', 'wxg-btn-xs', c.id);
                    if (doneBtn && doneBtn.setAttribute) { doneBtn.setAttribute('data-what', what2); }
                    acts2.appendChild(doneBtn);
                }
                const delBtn2 = button('删', 'sched-del', 'wxg-btn-xs', c.id);
                if (delBtn2 && delBtn2.setAttribute) { delBtn2.setAttribute('data-what', what2); }
                acts2.appendChild(delBtn2);
                sr.appendChild(acts2);
            }
            sSec.appendChild(sr);
        }
        pop.appendChild(sSec);
    }

    /*
     * ⭐「任务」块（原本**只在角色状态页**）。
     *   任务是**挂在人身上**的（`c.quests`）⇒ 跟着人走才对。
     *   ⛔ 丢下它：她要能看到"他在追什么"、能改状态、能删。
     */
    if (Array.isArray(one.quests) && one.quests.length) {
        const qSec = el('div', 'wxg-pc-sec');
        const qOpen = one.quests.filter((q) => !['完成', '搁置'].includes(trimText(q.status)));
        const qOver = one.quests.filter((q) => ['完成', '搁置'].includes(trimText(q.status)));
        const qStat = questStats(one.quests);
        qSec.appendChild(el('div', 'wxg-pc-sech', '任务（在追的目标）　主线 '
            + String(qStat.main) + ' · 支线 ' + String(qStat.side)
            + (qOver.length ? '（已结束 ' + String(qOver.length) + '）' : '')));
        const mkQ = (q) => {
            const qr = el('div', 'wxg-rowitem');
            const qh = el('div', 'wxg-rowname');
            qh.appendChild(el('span', 'wxg-badge wxg-badge-soft', trimText(q.kind) === 'main' ? '主线' : '支线'));
            qh.appendChild(el('span', 'wxg-name', trimText(q.title)));
            const st = select('wxg-pcq-' + one.id + '-' + trimText(q.title), [
                { value: '活跃', label: '活跃' },
                { value: '完成', label: '完成' },
                { value: '搁置', label: '搁置' },
            ], trimText(q.status), 'set-quest-status', one.id);
            st.setAttribute('data-title', trimText(q.title));
            st.className = 'wxg-pole wxg-btn-sm';
            qh.appendChild(st);
            const qd = button('删', 'del-quest', 'wxg-btn-sm', one.id);
            qd.setAttribute('data-title', trimText(q.title));
            qh.appendChild(qd);
            qr.appendChild(qh);
            if (trimText(q.note)) {
                qr.appendChild(el('div', 'wxg-fact', trimText(q.note)));
            }
            /* ⭐ 材料 06【4】（对齐）：**浮层卡片里的任务子项也要能勾** ✓
             *   （v0.3.208 只改了名册行那一份 ✗ ⇒ 两处表现不一致 ✗ ⇒ 这里对齐 ✓） */
            if (Array.isArray(q.items) && q.items.length) {
                const qiRow2 = el('div', 'wxg-fact');
                q.items.forEach((it, ii) => {
                    const mark2 = it.done ? '☑ ' : '▶ ';
                    if (personCardEditing) {
                        const qib2 = button(mark2 + trimText(it.text), 'toggle-quest-item', 'wxg-btn-xs', one.id);
                        qib2.setAttribute('data-title', trimText(q.title));
                        qib2.setAttribute('data-index', String(ii));
                        qiRow2.appendChild(qib2);
                    } else {
                        qiRow2.appendChild(el('span', null, mark2 + trimText(it.text) + '　'));
                    }
                });
                qr.appendChild(qiRow2);
            }
            return qr;
        };
        if (!qOpen.length) {
            qSec.appendChild(el('div', 'wxg-empty', '没有在追的任务了（已结束的收在下面）'));
        }
        for (const q of qOpen) {
            qSec.appendChild(mkQ(q));
        }
        if (qOver.length) {
            const fold = foldable('已结束 ' + String(qOver.length) + ' 条（完成／搁置，点开看）', false);
            const inner = el('div', 'wxg-list');
            for (const q of qOver) {
                inner.appendChild(mkQ(q));
            }
            fold.appendChild(inner);
            qSec.appendChild(fold);
        }
        pop.appendChild(qSec);
    }
    const foot = el('div', 'wxg-pc-foot');
    const prev = button('← 上一位', 'card-prev', 'wxg-pc-nav');
    prev.disabled = at <= 0;
    const next = button('下一位 →', 'card-next', 'wxg-pc-nav');
    next.disabled = at >= roster.length - 1;
    foot.appendChild(prev);
    foot.appendChild(el('span', 'wxg-pc-counter', '第 ' + String(at + 1) + ' / ' + String(roster.length) + ' 位'));
    foot.appendChild(next);
    foot.appendChild(button('按这条合并…', 'merge-into', 'wxg-btn-sm', c.id));
    /*
     * 底部那颗：只读态下叫「编辑这一位」；编辑态下叫「收起编辑」。
     * ⚠️ 不叫「保存」是诚实：改字是**改哪格存哪格**（立即落账），⛔ 做假的"取消"骗人。
     */
    const save = button(personCardEditing ? '收起编辑' : '编辑这一位',
        personCardEditing ? 'card-view' : 'card-edit', personCardEditing ? 'wxg-primary' : '');
    foot.appendChild(save);
    pop.appendChild(foot);

    (lastSectionsHost || document.body).appendChild(pop);

    /*
     * ⭐⭐ 材料 06【4】#6：**只读态下那几格不该裸露可点** ✓
     *   旧：没点 ⋮（只读态）时，「这是玩家棋子」「参与后台推演」两个勾选框、
     *     「他知道什么」的加／删、以及任务的状态下拉与删除按钮**全都裸露可点** ✗
     *     ⇒ 误触一下就直接改账 ✗
     *   现在：只读态 ⇒ 这几类控件**统一禁用** ✓（看得见、点不动 ✓）；点 ⋮ 进编辑态就能点 ✓
     *   （审计 audit-3-panel 也是先点 card-edit 才改 ✓ ⇒ 不冲突 ✓）
     */
    if (!personCardEditing) {
        try {
            /* 这五类控件在只读态下必须点不动；选择器用双引号写在单引号里 ✓ */
            const lockSel = '[data-action="set-player"],[data-action="add-know"],[data-action="del-know"],'
                + '[data-action="set-quest-status"],[data-action="del-quest"]';
            const lockables = pop.querySelectorAll(lockSel);
            for (const el2 of Array.from(lockables)) {
                if (el2 && el2.setAttribute) {
                    el2.setAttribute('disabled', 'disabled');
                    if (el2.style) { el2.style.opacity = '0.45'; }
                }
            }
        } catch (eLock) { /* 锁不上也不能把卡片搞挂 ✓ */ }
    }
    bindPersonCardDrag(pop);
}

/**
 * 一个格：**默认只读文本**，点 ⋮ 进了编辑态才变输入框。
 *
 * 为什么（她自己说过两回，目标包里也写着）：
 *   · 她：「为什么现在每个页面的内容比如这个都是直接就能按的，而不是旁边有一个编辑按钮，
 *     点了才能按，不点是只读改不了免得弄错」
 *   · 目标包说明：「浮层右上 ⋮（三个点，**点开＝编辑这一位**）」
 *   ⇒ 默认**只读**；⋮ 就是那个“编辑按钮”。
 *
 * ⚠️ 编辑态里改字是**改哪格存哪格**（沿用 `set-char-field` ⇒ 保存路径与手改锁都不变），
 *   ⛔ 做假“取消”骗人（改了就已经落账了）。底部那颗叫「收起编辑」。
 */
function fieldBox(charId, field, value, placeholder) {
    const wrap = el('div', 'wxg-pc-v');
    const long = field === 'current' || field === 'timePlace';
    if (!personCardEditing) {
        const txt = trimText(value);
        wrap.appendChild(el('div', 'wxg-pc-text' + (txt ? '' : ' is-empty'), txt || (placeholder || '—')));
        return wrap;
    }
    const input = long ? el('textarea', 'wxg-pc-input') : el('input', 'wxg-pc-input');
    if (!long) {
        input.type = 'text';
    }
    input.value = trimText(value);
    input.placeholder = placeholder || '—';
    input.setAttribute('data-action', 'set-char-field');
    input.setAttribute('data-id', charId);
    input.setAttribute('data-key', field);
    if (long) {
        input.rows = 2;
    }
    wrap.appendChild(input);
    return wrap;
}

/** 拖标题栏移浮层（做法跟 mini.js 那套一致：⛔ 不引库） */
function bindPersonCardDrag(pop) {
    const grip = pop.querySelector('.wxg-pc-head');
    if (!grip || typeof grip.addEventListener !== 'function') {
        return;
    }
    let sx = 0;
    let sy = 0;
    let ox = 0;
    let oy = 0;
    let on = false;
    const move = (e) => {
        if (!on) {
            return;
        }
        const t = e.touches ? e.touches[0] : e;
        /*
         * ⭐ LY3（材料 11·布局层）：**拖拽要夹在屏幕里** ✓
         *   旧：直接赋值 ✗ ⇒ 一旦把标题栏拖出屏幕顶边／侧边 ✗
         *     ⇒ **再也点不到标题栏拖回来**（卡片就困在外面 ✗）
         *   现在：至少留 80px 在屏幕内 ✓（⛔ 全部禁止拖出去——那样反而拖不动 ✓）
         */
        const vw = window.innerWidth || 1000;
        const vh = window.innerHeight || 800;
        const cardW = pop.offsetWidth || 560;
        const keepX = 80;
        const keepY = 40;
        const nx = ox + (t.clientX - sx);
        const ny = oy + (t.clientY - sy);
        pop.style.left = String(Math.max(keepX - cardW, Math.min(vw - keepX, nx))) + 'px';
        /* 五：拖拽也要夹在视口里（⌊L实际高算底边） */
        const cardH = pop.getBoundingClientRect ? pop.getBoundingClientRect().height : 0;
        const maxTop = Math.max(12, vh - 12 - (cardH || 0));
        pop.style.top = String(Math.max(12, Math.min(maxTop, ny))) + 'px';
        e.preventDefault();
    };
    const up = () => {
        on = false;
        document.removeEventListener('mousemove', move);
        document.removeEventListener('touchmove', move);
        document.removeEventListener('mouseup', up);
        document.removeEventListener('touchend', up);
    };
    grip.addEventListener('mousedown', (e) => {
        if (e.target && e.target.closest && e.target.closest('button, input, textarea')) {
            return;   // 点按钮／输入框不算拖
        }
        const r = pop.getBoundingClientRect ? pop.getBoundingClientRect() : { left: 0, top: 0 };
        on = true;
        sx = e.clientX;
        sy = e.clientY;
        ox = r.left;
        oy = r.top;
        pop.style.left = String(ox) + 'px';
        pop.style.top = String(oy) + 'px';
        pop.style.right = 'auto';
        document.addEventListener('mousemove', move);
        document.addEventListener('mouseup', up);
    });
    grip.addEventListener('touchstart', (e) => {
        if (e.target && e.target.closest && e.target.closest('button, input, textarea')) {
            return;
        }
        const t = e.touches[0];
        const r = pop.getBoundingClientRect ? pop.getBoundingClientRect() : { left: 0, top: 0 };
        on = true;
        sx = t.clientX;
        sy = t.clientY;
        ox = r.left;
        oy = r.top;
        pop.style.left = String(ox) + 'px';
        pop.style.top = String(oy) + 'px';
        pop.style.right = 'auto';
        document.addEventListener('touchmove', move);
        document.addEventListener('touchend', up);
    });
}

/**
 * ⭐ 「每轮记录」的浮层（照目标包：跟名册人物卡**同一套手法**）。
 *   标题栏＝⏿ 把手＋标题＋状态胶囊＋✕；
 *   正文＝已经拼好的那三块（①怎么挑的 ②实际送进请求的内容 ③回执）**原样搬过来**；
 *   底部＝关闭｜第 N 条 / 共 M 条｜下一条 ›。
 *   ⛔ 重写一份正文构造（那样两边会分叉）。
 */
function renderRecordCard(rec, body, idx, total, statusText, tone, shownChars) {
    const host = document.getElementById('wxg-record-card');
    if (host && typeof host.remove === 'function') {
        host.remove();
    }
    const pop = el('div', 'wxg-pc wanxiangge');
    pop.id = 'wxg-record-card';
    pop.setAttribute('role', 'dialog');

    const head = el('div', 'wxg-pc-head');
    head.appendChild(el('span', 'wxg-pc-grip', '⏿'));
    const who = el('div', 'wxg-pc-who');
    who.appendChild(el('div', 'wxg-pc-name', shortTime(rec.at) + ' · ' + floorLabel(rec.floor)));
    who.appendChild(el('div', 'wxg-pc-alias', rec.injectStatus === 'ok'
        ? ('已注入 ' + String(shownChars) + ' 字')
        : '这一轮没注入'));
    head.appendChild(who);
    const badges = el('div', 'wxg-pc-badges');
    badges.appendChild(el('span', 'wxg-badge ' + (tone || ''), statusText));
    head.appendChild(badges);
    head.appendChild(button('✕', 'record-close', 'wxg-pc-x'));
    pop.appendChild(head);

    const sec = el('div', 'wxg-pc-sec');
    sec.appendChild(body);
    pop.appendChild(sec);

    const foot = el('div', 'wxg-pc-foot');
    foot.appendChild(button('关闭', 'record-close', 'wxg-pc-nav'));
    foot.appendChild(el('span', 'wxg-pc-counter', '第 ' + String(idx + 1) + ' 条 / 共 ' + String(total) + ' 条'));
    const prev = button('‹ 上一条', 'record-prev', 'wxg-pc-nav');
    prev.disabled = idx <= 0;
    foot.appendChild(prev);
    const next = button('下一条 ›', 'record-next', 'wxg-pc-nav');
    next.disabled = idx >= total - 1;
    foot.appendChild(next);
    pop.appendChild(foot);

    (lastSectionsHost || document.body).appendChild(pop);
    bindPersonCardDrag(pop);
}

/*
 * ⭐ 世界状态页的「点条目弹浮层」（照目标包 目标-世界状态页-20261015）。
 *
 * 包里要的：
 *   · 点**局势行／暗线行** ⇒ 弹白卡浮层（跟名册"点行开卡片"**同一套手法**）
 *   · 头部：大标题＋「世界账 · 局势／暗线」＋当前胶囊＋**⋮＝编辑**＋✕
 *   · 信息区（键值两栏）：局势＝`哪几方／火候`；暗线＝`到点／走到／火候`
 *   · **「因果」区**：**来路＝上承（向更早）**（这条从哪来）／**牵动＝下沿（向未来）**（它的走向）
 *     节点小徽章 `源`（淡青）／`进·走向`（灰）；小标题注明「**照世界账的记录摆·不另编**」
 *   · 底部：`关闭 ｜ 来自世界账 · 改动走右上 ⋮ → 编辑`
 *   · ⛔ 行内不再有展开编辑（编辑一律从浮层右上 ⋮ 进）
 */
let openWorldEntry = null;      // { kind: 'situation' | 'hidden', idx }
/** 这个浮层在编辑态吗（默认 false＝只读） */
let openWorldEntryEditing = false;

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

function renderWorldEntryCard() {
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
let healthOpen = false;

export function closeHealthCard() {
    healthOpen = false;
    const old = document.getElementById('wxg-health-card');
    if (old && typeof old.remove === 'function') {
        old.remove();
    }
}

function renderHealthCard() {
    const old = document.getElementById('wxg-health-card');
    if (old && typeof old.remove === 'function') {
        old.remove();
    }
    if (!healthOpen) {
        return;
    }
    let report = { text: '（体检报告没生成出来）', fails: [] };
    try {
        report = buildHealthReport({ version: APP_VERSION, chat: getChat() });
    } catch (e) {
        report = { text: '体检报告生成失败：' + ((e && e.message) || '未知原因'), fails: [] };
    }

    const pop = el('div', 'wxg-pc wanxiangge');
    pop.id = 'wxg-health-card';
    pop.setAttribute('role', 'dialog');

    const head = el('div', 'wxg-pc-head');
    head.appendChild(el('span', 'wxg-pc-grip', '⠿'));
    const who = el('div', 'wxg-pc-who');
    who.appendChild(el('div', 'wxg-pc-name', '体检报告'));
    who.appendChild(el('div', 'wxg-pc-alias', '版本／开关／条数／最近失败（⛔ 不含正文与钥匙）'));
    head.appendChild(who);
    head.appendChild(button('✕', 'health-close', 'wxg-pc-x'));
    pop.appendChild(head);

    const sec = el('div', 'wxg-pc-sec');
    const pre = el('pre', 'wxg-health-pre', report.text);
    sec.appendChild(pre);
    pop.appendChild(sec);
    const foot = el('div', 'wxg-pc-foot');
    foot.appendChild(button('关闭', 'health-close', 'wxg-pc-nav'));
    foot.appendChild(button('复制这份', 'health-copy', 'wxg-pc-nav'));
    pop.appendChild(foot);
    (lastSectionsHost || document.body).appendChild(pop);
    bindPersonCardDrag(pop);
}
export function renderSections(host, opts) {
    /*
     * ⭐ 复审追加 B2：**台前有窗口时，后台那次画不该抢挂载点**。
     *   原来无条件赋值：她开着工作台、点开人物卡，
     *   后台一次 `renderPanel()`（注入完成／后台更新完／她发消息…都会调）
     *   就把挂载点改指到**隐藏抽屉** ⇒ 人物卡被"偷"进去（从工作台消失）。
     *   ⚠️ `handler` 里"点击拨正 lastSectionsHost"那半是好的，⛔ 动它。
     */
    const hasFgWindow = typeof document !== 'undefined'
        && !!(document.getElementById('wanxiangge-workspace') || document.getElementById('wanxiangge-panel'));
    const isSettingsDraw = ((opts && opts.mode) || 'workspace') === 'settings';   /* ★ 依据＝阿砚 17 号 §一-1：默认＝工作台整套，只有显式 settings 才是抽屉 */
    if (!isSettingsDraw || !hasFgWindow || !lastSectionsHost) {
        lastSectionsHost = host || lastSectionsHost;   // 浮层要挂在它里才收得到点击
    }
    if (!host) {
        return;
    }
    const mode = (opts && opts.mode) || 'workspace';   /* ★ 同上：不带 mode 的老调用照旧整套 ✓ */
    host.replaceChildren();
    /*
     * ★ 20261023（依据＝阿砚 17 号  §一-1）：**设置抽屉里只画总控＋一个入口**。
     *   旧：抽屉里也画**整套面板**（mode 传了没分支 ✗）
     *   新：`mode === 'settings'` 只画小卡＋「打开工作台」；不带 mode 的老调用**照旧整套** ✓
     */
    if (mode === 'settings') {
        host.classList.add('wanxiangge');
        host.setAttribute('data-wxg-mode', mode);
        const entry = section('万象阁', '设置区只放入口：完整面板在「工作台」里。',
            { open: true, five: false });
        const cEntry = card('打开');
        const rowE = el('div', 'wxg-card-actions');
        rowE.appendChild(button('打开工作台', 'open-workspace-btn', 'wxg-primary'));
        cEntry.appendChild(rowE);
        entry.appendChild(cEntry);
        host.appendChild(entry);
        return;
    }
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
    const prevStagingMode = stagingMode;
    stagingMode = mode;
    const stageEl = el('div', 'wxg-stage');
    try {
        /*
         * ① 状态：账本／进度／每轮记录 —— **三页已并成一页**
         *    （复核方："这三个是不是应该坐到一个地方？"）
         *    ⏐ secSteps／secReport 不再各自开页，改成往状态页里摆（见 secStatus）。
         */
        secStatus(stageEl);
        secWorld(stageEl);
        /*
         * ⚠️⚠️ 「角色状态」这一页**暂时留着**（2026-10-15 第 11 轮退回）。
         *
         * 她确实说过「跟名册重复了删掉吧？一模一样」，但她同时两度亲定边界：
         *   **只删目录入口，页面内容与引用 0 动**。
         * 而我试着只从目录里撕掉它之后，**真机上这些东西就真摸不到了**（页面不渲染＝内容没了），
         * 实测有 **16 条用例变红**，它们点名的是：
         *   · `run-tests-chartable`：七列表格／搜索框／点开改字（整套）
         *   · `run-tests-inject`：任务（主线／支线）显示、改状态、删任务
         *   · `run-tests-future`：「不可靠」提醒
         *   · `run-tests-dualpanel`：面板里改角色字段
         * ⇒ 这些**名册与浮层里都还没有**。先把它们搬过去，才能撕这一页；
         *   ⛔ 为了"看着像做完了"而提前撕（她的话：别真的不行还打钩）。
         */
        /*
         * ⭐⭐ 「角色状态」**撕了**（她 2026-10-15：「角色名册/人物名册不就是角色状态」
         *   「这两个有啥区别？」「我刚刚就说两个都是一模一样来着」）。
         *   → 它的职分（呈现人物状态、可改）**全归名册**：名册即角色状态。
         *
         * ⛔ 先撕后接——撕之前已逐样搬完（这一步是硬前提）：
         *   · **八格**（年龄/身份/势力/时间地点/正在经历/好感/别名）⇒ 名册的**浮层人物卡**（默认只读，点 ⋮ 可改）
         *   · **任务（主线／支线）**（可改状态、可删）⇒ 浮层里的「任务」块（v0.2.80）
         *   · **「不可靠」提醒** ⇒ 浮层里的警告行（v0.2.80）
         *   · **一键合并（merge-into）** ⇒ 浮层底栏（早已在）
         *
         * ⚠️ 边界（她 02:01／02:05 两度亲定）：**只撕目录入口**；
         *   ⛔ 凡别处“引用人物”的显示（如世界状态里出现的人名）＝引用名册，**不动**。
         * （`secCharacters` 函数体先留着：删代码要单独过门；这里只是不摆进目录。）
         */
        secChronicle(stageEl);
        secRoster(stageEl);
    mountLedgers(stageEl);
        secGeneral(stageEl);
        secAppearance(stageEl);
        secRecall(stageEl);
        secExtract(stageEl);
        secApi(stageEl);
        secPrompts(stageEl);
        /*
         * ⭐ 重画之后把世界条目的浮层**画回来**（浮层挂在段容器里，重画会冲掉它）。
         *   ⛔ 写在每个动作里（那样漏一个就没了）。
         * ⭐ 复审追加 B2（乙）：**同一前提**（后台那一次画 + 台前有窗口）下⛔ 重挂——
         *   否则后台刷一下就把她工作台里开着的卡**拆下来重挂到隐藏抽屉**里（"被偷走"）。
         */
        const canRemount = !(isSettingsDraw && hasFgWindow);
        if (openWorldEntry && canRemount) {
            renderWorldEntryCard();
        }
        if (healthOpen && canRemount) {
            renderHealthCard();
        }
        /*
         * ⭐ 修复单 #33（后半）：**人物卡也要画回来**。
         *   她点开人物卡之后，任何一次重画（比如后台刷了一下设置区）都会把浮层冲掉；
         *   上面两处都补了、就这处漏了 ⇒ 表现是"人物卡自己没了"。
         *   ⛔ 别再写在每个动作里（漏一个就没一个）——统一听这里。
         */
        if (personCardId && canRemount) {
            try {
                renderPersonCard();
            } catch (e) {
                console.warn('[万象阁] 摆回人物卡出错：', e);
            }
        }
        const before = asArray(host.children || []).length;
        /* 一：整页只有一个主卡 ⇒ 盖 `data-wxg-onecol`（实现在 ui/onecol.js） */
        try { markOneCol({ stageEl: stageEl, asArray: asArray }); } catch (eOnecol) { console.warn('[万象阁] 标单卡页出错：', eOnecol); }
    try { tidyHeadings(stageEl); }   /* 77：必须扫 stageEl（此时内容还在 stageEl 里，⛔ host） */ catch (eTidy) { console.warn('[万象阁] 标题去括号出错：', eTidy); }   /* 75 */
        hangUp(host, stageEl);
        const added = asArray(host.children || []).length - before;
        if (!added) {
            drawFailure(host, new Error('12 段一段都没画出来（可能是这一版和设置里存的老数据对不上）'));
        }
        buildJumpNav(host);
        /*
         * ⭐ 只读卡的"真锁"在这儿上（整页 DOM 已建完）：
         *    `lockable()` 是在 `card()` 刚 new 出来、**里面还空着**的时候调的，
         *    那一刻扫不到任何字段——真踩过（readonly 一个都没上）。
         */
        try {
            applyLocks(host);
        } catch (e) {
            console.warn('[万象阁] 上只读锁出错：', e);
        }
        try {
            renderEntryPick(host);
        } catch (e) {
            console.warn('[万象阁] 摆回条目列表出错：', e);
        }
    } catch (e) {
        /*
         * ⚠️ 兜底要**出声**（光 console.warn 不够：真机／自审里都可能没人看控制台，
         *    表现就变成"界面莫名其妙空了一半"，查都没法查）。
         *    这里同时打控制台；界面上的那句话由 drawFailure 写。
         */
        console.warn('[万象阁] 画面板出错：', e);
        console.error('[万象阁] 画面板出错（照抄这句反馈即可）：' + String((e && e.message) || e));
        drawFailure(host, e);
    } finally {
        stagingMode = prevStagingMode;
    }
}
/**
 * 画世界书小块（只改这几颗按钮，⛔ 不重画面板 —— 点一下面板就跳会很难连着点）。
 * @param {object} host 面板正文层
 * @param {Array<string>} ex 待保存的"提取"名单
 * @param {Array<string>} no 待保存的"排除"名单
 */
/**
 * ⭐ RD1-3（材料 11）：把 `lastModelList` 画成芯片 ✓
 *   （重建与拉取两边共用同一份标记 ✓，⛔ 两套写法 ✗）
 */
function paintModelChips(boxEl) {
    if (!boxEl || !boxEl.appendChild) {
        return;
    }
    while (boxEl.firstChild) {
        boxEl.removeChild(boxEl.firstChild);
    }
    if (!Array.isArray(lastModelList) || !lastModelList.length) {
        return;
    }
    const rowEl = el('div', 'wxg-chiprow');
    for (const nm of lastModelList) {
        const chip = el('button', 'wxg-chip', nm);
        chip.type = 'button';
        chip.setAttribute('data-action', 'pick-model');
        chip.setAttribute('data-name', nm);
        rowEl.appendChild(chip);
    }
    boxEl.appendChild(rowEl);
}
const lastPaintSig = new WeakMap();   /* host ⇒ 上次画的签名（同签名就不重建） */
export function paintBookPicks(host, ex, no) {
    /*
     * 依据＝阿砚任务 3-d（连跑不稳要盯住）＋本轮实测 5/20 仍红：
     *   此前是“删掉全部芯片 → 重新建” ⇒ 重画窗口里她点下去会点在**已经被换掉的节点**上（事件不冒泡）⇒ 点了没反应。
     *   现在改成**原地更新**：按 data-book 找到已有按钮，改 class／文字／title；多的删、缺的补。
     *   ⇒ 重画期间按钮节点始终存在，点击不会丢。
     */
    if (ex === undefined || no === undefined) {
        const exDraft = toList(stagedValue('extract', 'extractBooks', getSettings().extractBooks));
        const noDraft = toList(stagedValue('extract', 'excludeBooks', getSettings().excludeBooks));
        if (ex === undefined) { ex = exDraft; }
        if (no === undefined) { no = noDraft; }
    }
    const wrap = host && host.querySelector ? host.querySelector('#wxg-bookpick') : null;
    if (!wrap) {
        return;
    }
    const exSet = new Set((ex || []).map((x) => asText(x)));
    const noSet = new Set((no || []).map((x) => asText(x)));
    const want = (Array.isArray(listBooksCache) ? listBooksCache : []).map((x) => asText(x));
    const wantSet = new Set(want);
    /* 先删掉不该在的（只在书单真的变少时才动，避免无谓重建） */
    for (const child of asArray(wrap.querySelectorAll ? wrap.querySelectorAll('[data-action="pick-book"]') : [])) {
        const book = String(child.getAttribute && child.getAttribute('data-book') || '');
        if (!wantSet.has(book)) {
            wrap.removeChild(child);
        }
    }
    /* 再原地更新/补齐（顺序按 want，把节点挪到正确位置） */
    let anchor = wrap.querySelector ? wrap.querySelector('.wxg-pick-head') : null;
    for (const n of want) {
        let b = wrap.querySelector ? wrap.querySelector('[data-action="pick-book"][data-book="' + n.replace(/"/g, '\\"') + '"]') : null;
        if (!b) {
            b = document.createElement('button');
            b.type = 'button';
            b.setAttribute('data-action', 'pick-book');
            b.setAttribute('data-book', n);
        /*
         * 依据＝本轮取证（pick 失败点已从“找不到控件”变为“草稿状态”）：
         *   芯片只带 `data-book`，而全站其他控件都用 `data-id` 做身份；
         *   按 `data-id` 取芯片的代码（含自测）会落到“第一颗”上 ⇒ 点的不是同一本书。
         *   这里把同一个名字同时写进 data-id（不改 data-book，⛔ 打破旧选择器）。
         */
        b.setAttribute('data-id', n);
        }
        const inEx = exSet.has(n);
        const inNo = noSet.has(n);
        b.className = 'wxg-pick' + (inEx ? ' is-on' : '') + (inNo ? ' is-off' : '');
        b.textContent = n + (inEx ? '（提取）' : (inNo ? '（排除）' : ''));
        b.title = inEx ? '在「提取」名单里（还没保存；再点＝改排除）'
            : (inNo ? '在「排除」名单里（还没保存；再点＝拿掉）' : '点一下＝要读它');
        /* 位置对齐：如果它不在 anchor 后面，就挪过去 */
        if (anchor) {
            if (anchor.nextSibling !== b) {
                wrap.insertBefore(b, anchor.nextSibling);
            }
            anchor = b;
        } else {
            if (b.parentNode !== wrap) { wrap.appendChild(b); }
            anchor = b;
        }
    }
}
/**
 * 把"正在看的那本书"的条目小块摆回面板（点一条之后重画，接着还能点）。
 * 数据来自 list-entries 抓到的 `pickEntries`，⛔ 不再重复读世界书。
 */
/** ⭐ 3③：条目列表的筛选词（她输什么就只显示带它的） */
let entFilter = '';
export function renderEntryPick(host, offList) {
    if (!pickBook || !pickEntries.length) {
        return;
    }
    const wrap = host.querySelector('#wxg-entpick');
    const note = host.querySelector('#wxg-entnote');
    if (!wrap) {
        return;
    }
    const off = Array.isArray(offList) ? offList : toList(stagedValue('extract', 'excludeEntries', excludeTextFor(pickBook)));
    while (wrap.firstChild) {
        wrap.removeChild(wrap.firstChild);
    }
    if (note) {
        note.textContent = '「' + pickBook + '」共 ' + String(pickEntries.length)
            + ' 条：点一下＝不读这一条（⛔ 不立刻保存，按段底那颗「保存」才生效）；⛔ 不改你的世界书。';
    }
    /*
     * ⭐ 目标核对 3③：**批量键 + 筛选**（照她点的参照物：
     *   TavernHelper 世界书面板的「整本＋全选／全不选＋逐条勾＋筛选」）。
     *   逐条点"不读"原来已经有（`toggle-entry`），差的就是**一次处理一整本**的那几颗。
     */
    const bar = el('div', 'wxg-chiprow wxg-entbar');
    const mkBtn = (label, act) => {
        const b2 = document.createElement('button');
        b2.type = 'button';
        b2.className = 'wxg-btn-sm';
        b2.textContent = label;
        b2.setAttribute('data-action', act);
        return b2;
    };
    bar.appendChild(mkBtn('全读', 'entry-all-on'));
    bar.appendChild(mkBtn('全不读', 'entry-all-off'));
    bar.appendChild(mkBtn('反选', 'entry-invert'));
    const fInp = el('input', 'wxg-pick-filter');
    fInp.type = 'text';
    fInp.id = 'wxg-entfilter';
    fInp.placeholder = '筛选名字…';
    fInp.value = entFilter;
    fInp.setAttribute('data-action', 'filter-entries');
    bar.appendChild(fInp);
    wrap.appendChild(bar);
    const shown = pickEntries.filter((e) => {
        if (!entFilter) {
            return true;
        }
        const title = trimText(e && (e.comment || e.key || e.name || e.title));
        return title.toLowerCase().indexOf(entFilter.toLowerCase()) >= 0;
    });
    if (!shown.length) {
        wrap.appendChild(el('div', 'wxg-empty', '没有名字里带「' + entFilter + '」的条目'));
    }
    for (const e of shown.slice(0, 200)) {
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
    const first = (host.children && host.children.length) ? host.children[0] : null;
    if (first) {
        host.insertBefore(nav, first);
    } else {
        host.appendChild(nav);
    }
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
    for (const node of asArray(staging.children || [])) {
        const drawer = node && node.__wxgDrawer;
        if (drawer) {
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
        /* 20261022 ⑤：⛔ 把 err.stack（函数名／路径／行号）画到屏上；只进控制台 */
            try { console.error('[wxg] 界面段渲染失败', err); } catch (eC) { }
            box.appendChild(el('div', 'wxg-fact', '这一段没画出来：把这句反馈给我们就行'));
        host.appendChild(box);
    } catch (e) {
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
/**
 * ⭐「从世界书读人」v2：**全读进来 → 模型自己分 → 各归各位**
 *
 * 她的口径（2026-10-14 19:3x）：读取世界书**全出来**，写提示词让模型自己分，
 * ⛔ 别按名单拦着读；人物→名册、势力／局势→世界状态建档。
 *
 * ⚠️ 老口径（纯规则剥 `[角色]` 前缀）会把 `[势力][地点]` 当人收、其余前缀全丢，
 *    所以只在**模型不可用时**当兜底，而且必须明说"这次是规则版、没分类"。
 */
async function readFromBook(book) {
    try {
        const res = await importBookWiki(book, { allowRuleFallback: true });
        if (!res.ok) {
            toast.fail('读世界书没成：' + (res.reason || '未知原因'));
            return { added: 0, skipped: 0 };
        }
        if (res.fellBack) {
            /*
             * 87#4：不能只说“配好 API 再点”（她被这句害白试两次：API 已配好，是输入太长）。
             *   必须说清“这次没分类，势力／局势都没读”，并给出兜底到了几条。
             */
            const num0 = (v) => (Number.isFinite(Number(v)) ? String(Number(v)) : '0');
            toast.warn('模型这条线没通（' + (res.reason || '未知') + '）⇒ **这次没分类，势力／局势都没读**。'
                + '人物按名字收了 ' + num0(res.added) + ' 人；势力／局势／地点按条目前缀兜底：'
                + '势力 ' + num0(res.factions) + ' · 局势 ' + num0(res.situations) + ' · 地点 ' + num0(res.places) + '。'
                + '下次点一次会从断点接着读。');
            return { added: res.added, skipped: 0 };
        }
        return res;
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
/**
 * ⭐⭐ R5（材料 05）：**改完一格别当场重画** ✓
 *   旧：change（鼠标按下失焦就触发）里**当场** rerender() ✗
 *     ⇒ 把她正按着的那颗按钮连同整个浮层 DOM 销毁重建 ✗
 *     ⇒ mouseup 时 click 凭空蒸发 ✗ ⇒ **第一次点击必然失效** ✗
 *   现在：**状态照旧同步写** ✓，只把**重画推迟 ~260ms** ✓，并**记住浮层位置**、重画完还回去 ✓
 *   ⚠️ 只用在**改字段**这类地方 ✓（⛔ 往别的流程里套 ✗：
 *     “名字跟人设名一样⇒自动认玩家棋子”那条审计就靠**同步重画** ✗）
 */
function scheduleCardRerender() {
    let keep = null;
    try {
        const old = document.querySelector('.wxg-pc');
        if (old && old.style) {
            keep = { left: old.style.left, top: old.style.top };
        }
    } catch (e0) { keep = null; }
    try {
        setTimeout(() => {
            try {
                rerender();
                if (personCardId) { renderPersonCard(); }
                if (openWorldEntry) { renderWorldEntryCard(); }
            } catch (e1) { /* 重画出错也不能把这一页搞挂 ✓ */ }
            try {
                const now = document.querySelector('.wxg-pc');
                if (now && now.style && keep) {
                    if (keep.left) { now.style.left = keep.left; }
                    if (keep.top) { now.style.top = keep.top; }
                }
            } catch (e2) { /* 位置回不去也不要紧 ✓ */ }
        }, 260);
    } catch (e3) { /* 定时器都起不来就只剩状态写入 ✓ */ }
}
export function bindSectionEvents(host, refresh) {
    /*
     * ⭐ U17（材料 12·交互与边缘）：**「新增」输入框按回车＝点它旁边那颗按钮** ✓
     *   旧：那批输入框的 data-action 是 noop，也没监听回车 ✗
     *     ⇒ 她打完名字习惯性按 Enter，**什么都不发生** ✗
     *   现在：回车 ⇒ 在同一行里找第一颗真有动作的按钮并点它 ✓
     *   ⛔ 改按钮行为；⛔ 弄文本框（只接 input）；拿不到按钮就什么都不做 ✓
     */
    try {
        host.addEventListener('keydown', (ev) => {
            if (!ev || ev.key !== 'Enter' || ev.shiftKey || ev.ctrlKey || ev.altKey || ev.metaKey) {
                return;
            }
            const el = ev.target;
            if (!el || el.tagName !== 'INPUT') {
                return;
            }
            if ((el.getAttribute('data-action') || '') !== 'noop') {
                return;
            }
            const row = el.closest('.wxg-row') || el.closest('.wxg-line') || el.parentElement;
            if (!row || !row.querySelector) {
                return;
            }
            const btn = row.querySelector('button[data-action]');
            if (btn && (btn.getAttribute('data-action') || '') !== 'noop') {
                ev.preventDefault();
                btn.click();
            }
        });
    } catch (eU17) { /* 加不上也不能拦着整段绑定 ✓ */ }
    if (!host || host.__wxgBound) {
        return;
    }
    host.__wxgBound = true;
    /* 三：重画会把元素换掉 ⇒ 焦点会丢；记下/还回的实现在 ui/focus-keep.js（主文件行数硬线） */
    const rerender = () => {
        const focusSnap = rememberFocus(document);
        const mode = host.getAttribute('data-wxg-mode') || 'settings';
        /* ⚠️ 工作台模式下 refresh() 自己会重画 ⇒ 这里再 renderSections 就是连画两次（实测控件 80→20） */
        if (mode === 'workspace' && typeof refresh === 'function') {
            refresh();
            restoreFocus(focusSnap, document);
            return;
        }
        renderSections(host, { mode });
        if (typeof refresh === 'function') {
            refresh();
        }
        restoreFocus(focusSnap, document);
    };
    const handler = async (e) => {
        /*
         * ⭐ 修复单 #33（前半）：**handler 入口把挂载点对齐到"这次点击所在的 host"**。
         *   为什么：`renderSections(host)` 既被**看得见的工作台**调、也被**藏在抽屉里的设置区**
         *   （后台 renderPanel）调，而 `lastSectionsHost` 记的是"最后一次调用者"——
         *   后台一刷就把指针改指到**隐藏抽屉** ⇒ 浮层被塞进看不见的地方＝"点了没反应"（浮层隐身）。
         *   点击一定发生在某个 host 上 ⇒ 以它为准，指针就不会再被后台带偏。
         */
        if (host) {
            lastSectionsHost = host;
        }
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
        stagingMode = (host && typeof host.getAttribute === 'function' && host.getAttribute('data-wxg-mode')) || 'settings';
        try {
            if (action.indexOf('stage-') === 0) {
                if (!isChange) { return; }
                const which = stageOne(action, target);
                if (which === 'api-profile-switched') { rerender(); return; }
                /*
                 * ⭐⭐ 她 15:xx：「api 保存还是有问题，**好绕**，绕的手感一点都不好」
                 *   ⇒ 「自定义 API」这一节改成**防抖自动保存**：她停下手 ~0.8 秒就自己存一次 ✓
                 *   ⛔ **不能每改一格就提交**：已验证那样会丢项（commit 会清草稿，而 stage 以草稿为基底 ✗）
                 *   ⇒ 防抖 = **一次连续填完才提交一次**（基底是完整的 ✓）⛔ 其它节照旧 ✓
                 */
                if (which === 'api') {
                    try {
                        /* Google fix 3 (culprit 2): drop the 800ms debounce. Cause: her Save click
                     *   raced it and got "nothing unsaved". Now change commits at once. */
                    try { commitSection('api'); refreshSaveBar(host, 'api'); } catch (e1) { }                    } catch (e2) { /* ⛔ 影响输入 */ }
                }
                /* ⭐ ST4-A：个别开关仍要一句回执 ✓（一般格子看保存条 has-changes 就够 ✓） */
                try { stageFeedback(action, target); } catch (eFb) { /* 回执报不出来也不能影响草稿 ✓ */ }
                if (which) {
                    refreshSaveBar(host, which);
                    const bar = host.querySelector('.wxg-savebar[data-id="' + which + '"]');
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
                /*
                 * ⚠️ v0.3.257 我在这里加过一条“已存”回执 ✗
                 *   但真机核对发现：界面上挂的是 `stage-update-every`（走草稿）✓
                 *   ⇒ 这个 `set-update-every` **永远不会被执行** ✗ ⇒ 那句回执从未生效 ✗
                 *   现在：删掉（它本就是我自己加的 ✓），不留误导代码 ✓
                 */
                /* ⭐ ST4（材料 11）：补推范围这格早就写了 data-action，但**没接上** ⇒ 填了也存不住 ✗ */
                case 'chron-filter': {
                    chronFilter = trimText(id) || 'all';
                    chronPage = 1; // ⚠️ 换了筛选要回第一页（不然可能停在一个空页上）
                    rerender();
                    break;
                }
                case 'report-filter': {
                    reportFilter = trimText(id) || 'all';
                    rerender();
                    break;
                }
                case 'step-filter': {
                    stepFilter = trimText(id) || 'all';
                    stepPage = 1;
                    rerender();
                    break;
                }
                case 'step-page': {
                    stepPage = Math.max(1, Math.round(Number(id) || 1));
                    rerender();
                    break;
                }
                case 'roster-filter': {
                    /* ★ R62：点已选中的创建/修改时间 ⇒ 切正反序 ✓ */
                    const wantR = trimText(id) || 'all';
                    if (wantR === rosterFilter && (wantR === 'created' || wantR === 'changed' || wantR === 'name')) {
                        rosterSortDir = rosterSortDir === 'desc' ? 'asc' : 'desc';
                    } else {
                        rosterFilter = wantR;
                        rosterSortDir = wantR === 'name' ? 'asc' : 'desc';
                    }
                    rosterPage = 1; // 同上
                    rerender();
                    break;
                }
                case 'open-record':
                    openRecordAt = Math.max(0, Math.round(Number(id) || 0));
                    rerender();
                    break;
                case 'record-close':
                    openRecordAt = -1;
                    rerender();
                    break;
                case 'record-prev':
                case 'record-next':
                    if (openRecordAt >= 0) {
                        openRecordAt = action === 'record-next' ? openRecordAt + 1 : openRecordAt - 1;
                        if (openRecordAt < 0) { openRecordAt = 0; }
                    }
                    rerender();
                    break;
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
                case 'world-func': {
                    /* 材料 10 · 第 1 组裁定：真菜单（每项都是现成动作 ✓） */
                    openFuncMenu(target, [
                        { label: '立刻更新（重算世界账）', action: 'update-now' },
                        { label: '写入世界书', action: 'publish-book' },
                        { label: '对账（账与楼对齐）', action: 'reconcile' },
                        { label: '清空这个世界…', action: 'clear-world-open' },
                    ]);
                    break;
                }
                case 'health-open':
                    healthOpen = true;
                    renderHealthCard();
                    break;
                case 'health-close':
                    closeHealthCard();
                    break;
                case 'health-copy': {
                    const pre = document.querySelector('#wxg-health-card pre');
                    const txt = pre ? String(pre.textContent || '') : '';
                    try {
                        if (navigator.clipboard && navigator.clipboard.writeText) {
                            navigator.clipboard.writeText(txt);
                            toast.ok('体检报告已复制（直接粘给我就行）');
                        } else {
                            toast.info('浏览器不让自动复制，你手选一下吧');
                        }
                    } catch (e) {
                        toast.info('复制没成（浏览器限制），你手选一下吧');
                    }
                    break;
                }
                case 'status-func': {
                    /* 材料 10 · 第 1 组裁定：真菜单（每项都是现成动作 ✓） */
                    openFuncMenu(target, [
                        { label: '体检（跑一遍自检）', action: 'health-open' },
                        { label: '立刻更新（跑一轮）', action: 'update-now' },
                        { label: '补推历史（分批跑）', action: 'backfill' },
                        { label: '撤回上一次', action: 'rollback' },
                        { label: '导出备份（JSON）', action: 'export-data' },
                    ]);
                    break;
                }
                case 'roster-func': {
                    /* 材料 10 · 第 1 组裁定：真菜单（每项都是现成动作 ✓） */
                    openFuncMenu(target, [
                        { label: '查重（找出被拆成两条的）', action: 'detect-dupes' },
                        { label: '一键合并重复组', action: 'merge-all-dupes' },
                        { label: '导出备份（JSON）', action: 'export-data' },
                        { label: '导入备份（JSON）', action: 'import-data' },
                    ]);
                    break;
                }
                case 'expand-all':
            case 'collapse-all': {
                /*
                 * 六：本段里所有 <details> 一起开/收。
                 *   ⛔ 不改 foldable 自己的记忆逻辑（toggle 事件会照常把状态记进 foldOpenState）。
                 */
                const secOf = target.closest && target.closest('.wxg-sec');
                const open = action === 'expand-all';
                if (secOf) {
                    for (const d of asArray(secOf.querySelectorAll('details'))) {
                        d.open = open;
                    }
                }
                break;
            }
            case 'chron-search':
                /* A4：编年搜索（change 才重画） */
                if (isChange) {
                    chronSearch = trimText(target.value);
                    chronPage = 1;
                    rerender();
                }
                break;
            case 'roster-search':
                    if (isChange) {
                        rosterSearch = trimText(target.value);
                        rosterPage = 1;
                        rerender();
                    }
                    break;
                case 'roster-page': {
                    rosterPage = Math.max(1, Math.round(Number(id) || 1));
                    rerender();
                    break;
                }
                case 'chron-page': {
                    chronPage = Math.max(1, Math.round(Number(id) || 1));
                    rerender();
                    break;
                }
                /*
                 * ⭐ 名册点一行 ⇒ **开浮层**（她 2026-10-14 点名：⛔ 行内展开把表格推下去）。
                 *    旧的行内编辑器（case 'edit-char' 那段）**先留着**：
                 *    等浮层距离验收了再说，⛔ 一步到位地把能用的东西换掉。
                 */
                case 'open-person-card':
                    openPersonCard(id);
                    break;
                case 'card-close':
                    closePersonCard();
                    break;
                case 'card-prev':
                case 'card-next': {
                    /*
                     * 上／下一位：按**当前浮层里那位**在名册里的下标推一格。
                     * ⛔ 别自己造一个 personCardNowId()——`personCardId` 就是模块级那个变量，直接用。
                     */
                    /*
                     * Q6（材料 05）：**上／下一位跟着“当前显示顺序”走** ✓
                     *   旧：按 getRoster() 原始下标 ✗ ⇒ 筛过排过之后会跳到看不见的人 ✗
                     *   现在：从名册表可见行取顺序 ✓（自动跟随筛选与排序 ✓），拿不到就回退 ✓
                     */
                    const visibleIds = (() => {
                        try {
                            const rows = document.querySelectorAll('.wxg-ctable tbody tr[data-id]');
                            const out = [];
                            for (const tr of Array.from(rows)) {
                                if (tr.classList && tr.classList.contains('wxg-rowfiltered')) {
                                    continue;
                                }
                                const idv = tr.getAttribute('data-id');
                                if (idv && out.indexOf(idv) < 0) {
                                    out.push(idv);
                                }
                            }
                            return out;
                        } catch (eVis) {
                            return [];
                        }
                    })();
                    const list = visibleIds.length
                        ? visibleIds.map((idv) => ({ id: idv }))
                            : getRoster();
                    const at = list.findIndex((x) => x.id === personCardId);
                    if (at >= 0) {
                        const to = action === 'card-next' ? at + 1 : at - 1;
                        if (to >= 0 && to < list.length) {
                            openPersonCard(list[to].id);
                        }
                    }
                    break;
                }
                /*
                 * ⭐ `card-edit` 是**幂等**的：点多少下都是"进编辑态"，⛔ 翻转。
                 *   为什么：翻转式开关**不可重入**——前面一条用例把它留在开着，
                 *   后面一条再点一下反而**关上了**（真踩：「找不到字段输入框：age」，
                 *   但按钮明明点到了）。退出编辑独立成 `card-view`。
                 */
                case 'card-edit':
                    /*
                     * ⭐ 材料 06【4】#5：**⋮ 进得去也要出得来** ✓
                     *   旧：data-action 写死 'card-edit'、case 里写死 `= true`（⛔ 翻转 ✗）
                     *     ⇒ 再点 ⋮ 收不起编辑态 ✗（只能去点最底部的「收起编辑」✗）
                     *   现在：**翻转** ✓（开着就收、收着就开 ✓）
                     */
                    personCardEditing = !personCardEditing;
                    renderPersonCard();
                    break;
                case 'card-view':
                    personCardEditing = false;
                    renderPersonCard();
                    break;
                case 'card-save':
                    /*
                     * ⛔ 关掉浮层！她要的是"改完收起来"，不是"把卡片也关了"。
                     * （原来这里叫 closePersonCard－点一下连卡都没了，下一位都点不到。）
                     */
                    personCardEditing = false;
                    /*
                     * ⚠️ 顺序很要紧：浮层是**挂在段容器里**的（为了收得到点击），
                     *   而 `rerender()` 会重画段 ⇒ **顺手把浮层也冲掉**（真机门当场抓到：
                     *   点「收起编辑」连卡片一起没了）。
                     *   ⇒ **先重画段，再把卡片画回来**。
                     */
                    rerender();
                    renderPersonCard();
                    toast.ok('已收起编辑（改哪格存哪格，引擎不会冲掉）');
                    break;
                case 'edit-char': {
                    openChar = String(openChar) === String(id) ? '' : String(id);
                    rerender();
                    break;
                }
                case 'edit-situation': {
                    const idx = Number(target.getAttribute('data-index'));
                    openSituation = String(openSituation) === String(idx) ? -1 : idx;
                    rerender();
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
                case 'goto-roster': {
                    /* ★ P2-7：人物那一区只给汇总，要看细节去名册（⛔ 在这里再列一遍 ✗） */
                    try {
                        const items = Array.from(document.querySelectorAll('button.wxg-ws-side-item'));
                        const hit = items.find((b2) => (b2.textContent || '').indexOf('人物名册') >= 0);
                        if (hit && typeof hit.click === 'function') {
                            hit.click();
                        } else {
                            toast.info('在左侧切到「人物名册」');
                        }
                    } catch (eGo) { toast.info('在左侧切到「人物名册」'); }
                    break;
                }
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
                case 'set-role': {
                    /* ★ B1：她手改六档 ⇒ 落库 + 记手改锁（autoRoster 不再动它） */
                    const okRole = setRole(id, String(target.value || ''));
                    if (okRole) {
                        toast.ok('档位已改为「' + String(target.value || '') + '」');
                        rerender();
                    } else {
                        toast.warn('这个档位不认识');
                    }
                    break;
                }
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
                /* ---- 角色 ---- */
                case 'set-char-field':
                    if (isChange) {
                        updateCharacter(id, { [key]: target.value, manual: true });
                        /*
                         * ⭐ 改完一格 ⇒ 重画段，但 `rerender()` 会**顺手把浮层也冲掉**
                         *   （浮层挂在段容器里）⇒ 真机上就是"改一格、整张卡没了"。
                         *   ⇒ **重画完再把卡片画回来**（跟 `card-save` 同一个道理）。
                         */
            scheduleCardRerender();   /* R5：推迟重画 ✓（⛔ 把她正按的按钮销毁掉 ✗） */
                    }
                    break;
                case 'set-alias':
                    if (isChange) {
                        updateCharacter(id, { aliases: toList(target.value), manual: true });
                        toast.ok('别名保存了');
                        rerender();
                        if (personCardId) {
                            renderPersonCard();   // 同上：别把卡片带走
                        }
                    }
                    break;
                case 'set-affinity':
                    if (isChange) {
                        updateCharacter(id, { affinity: trimText(target.value), manual: true });
                        rerender();
                    }
                    break;
                case 'sched-done': {
                    /* ⭐ 新增件 1：**把这条日程标成已了结** ✓ */
                    const whatA = trimText(target.getAttribute('data-what'));
                    const cA = findCharacter(id);
                    if (cA && Array.isArray(cA.schedule) && whatA) {
                        const nextA = cA.schedule.map((x) => (trimText(x && (x.what || x.text)) === whatA
                            ? Object.assign({}, x, { done: true })
                            : x));
                        updateCharacter(id, { schedule: nextA });
                        toast.ok('这条日程标成已了结了');
                        rerender();
                    }
                    break;
                }
                case 'sched-del': {
                    /* ⭐ 新增件 1：**删掉这条日程** ✓ */
                    const whatB = trimText(target.getAttribute('data-what'));
                    const cB = findCharacter(id);
                    if (cB && Array.isArray(cB.schedule) && whatB) {
                        const nextB = cB.schedule.filter((x) => trimText(x && (x.what || x.text)) !== whatB);
                        updateCharacter(id, { schedule: nextB });
                        toast.ok('这条日程删掉了');
                        rerender();
                    }
                    break;
                }
                case 'past-save': {
                    /* ⭐ 新增件 1：**就地改一条过去经历** ✓ */
                    const pi = Number(target.getAttribute('data-idx'));
                    const cPs = findCharacter(id);
                    const inpPs = document.getElementById('wxg-past-edit-' + String(pi));
                    if (cPs && Array.isArray(cPs.past) && Number.isFinite(pi) && cPs.past[pi] && inpPs) {
                        const nextPs = cPs.past.map((x, xi) => (xi === pi
                            ? Object.assign({}, x, { text: trimText(inpPs.value), manual: true })
                            : x));
                        updateCharacter(id, { past: nextPs });
                        toast.ok('这条过去经历改好了');
                        rerender();
                    }
                    break;
                }
                case 'past-del': {
                    /* ⭐ 新增件 1：**删一条过去经历** ✓ */
                    const pp = Number(target.getAttribute('data-idx'));
                    const cPd = findCharacter(id);
                    if (cPd && Array.isArray(cPd.past) && Number.isFinite(pp)) {
                        const nextPd = cPd.past.filter((x, xi) => xi !== pp);
                        updateCharacter(id, { past: nextPd });
                        toast.ok('这条过去经历删掉了');
                        rerender();
                    }
                    break;
                }
                case 'del-past': {
                    const pi2 = Number(target.getAttribute('data-index'));
                    const pc2 = findCharacter(id);
                    if (pc2 && Array.isArray(pc2.past) && Number.isFinite(pi2) && pc2.past[pi2]) {
                        takeSnapshot('删过去经历前');
                        const arr2 = pc2.past.slice();
                        arr2.splice(pi2, 1);
                        updateCharacter(id, { past: arr2 }, { manual: true });
                        toast.ok('删了一条过去经历');
                        rerender();
                    }
                    break;
                }
                case 'add-past': {
                    const inp2 = document.getElementById('wxg-past-text');
                    const txt2 = trimText(inp2 && inp2.value);
                    if (!txt2) {
                        toast.info('先写一句话再点加 ✓');
                        break;
                    }
                    takeSnapshot('手加过去经历前');
                    pushPast(id, txt2, Number(getSettings().capPast) || 5, -1);
                    toast.ok('加上了');
                    rerender();
                    break;
                }
                case 'add-know': {
                    /*
                     * ⭐ 补③：手加一条"他该知道的"。
                     *   来源必选（亲眼／被告知／公开）；来源楼层用**当前停在的楼**（她手加时就是在看那一楼）。
                     *   ⛔ 自己造来源类型；⛔ 改已有的（只增）。
                     */
                    const box = document.getElementById('wxg-know-text');
                    const txt = box && typeof box.value === 'string' ? box.value.trim() : '';
                    const srcEl = document.getElementById('wxg-know-source');
                    const src = srcEl && typeof srcEl.value === 'string' ? srcEl.value : '亲眼';
                    if (!txt) {
                        toast.fail('先写一句"他知道了什么"');
                        break;
                    }
                    const chatNow = getChat();
                    const floorNow = (Array.isArray(chatNow) ? chatNow.length : 1) - 1;
                    const got = addKnow(id, { text: txt, source: src, floor: floorNow, manual: true });
                    if (!got) {
                        toast.info('这条没收（要么已经有了，要么没填来源）');
                        break;
                    }
                    toast.ok('记下了（' + got.source + '）');
                    rerender();
                    if (personCardId) {
                        renderPersonCard();
                    }
                    break;
                }
                case 'del-know': {
                    /* ⭐材料 06第一波：**二次确认 ＋ 快照** ✓
                     *   旧：点一下当场物理删除 ✗ 不弹确认 ✗ 不留快照 ✗
                     *        （点「撤回上一次」都撤不回来 ✗ —— 她的账不能这么掉 ✗）
                     *   新：先问一句 ✓ 再留一份快照 ✓ （沿用代码里既有的 window.confirm 写法 ✓ ⛔ 不引入新弹窗 ✗） */
                    if (typeof window !== 'undefined' && typeof window.confirm === 'function' && !window.confirm('要把这条认知删掉吗？\n\n（会先留一份快照，点「撤回上一次」能撤回来）')) { break; }
                    takeSnapshot('删除前（这条认知）');
                    const ki = Math.round(Number(target.getAttribute('data-index')));
                    if (removeKnow(id, ki)) {
                        toast.ok('删了一条');
                    }
                    rerender();
                    if (personCardId) {
                        renderPersonCard();
                    }
                    break;
                }
                case 'set-bench':
                    /*
                     * ⭐ 补①：勾上＝**参与**后台推演；不勾＝不进轮转名单。
                     *   存的是**反的**（`noBench`）：老数据缺字段 ⇒ 默认"参与"，跟升级前一模一样。
                     */
                    if (isChange) {
                        updateCharacter(id, { noBench: target.checked !== true });
                        toast.ok(target.checked === true
                            ? '他会跟其他人一起轮转'
                            : '已关掉后台推演（不占名额；正文写到他时照常更新）');
                        rerender();
                        if (personCardId) {
                            renderPersonCard();
                        }
                    }
                    break;
                case 'set-player':
                    if (!isChange) { break; }   /* R6（材料 05）：⛔ 让 click 与 change 各跑一遍 ✗ */
                    /*
                     * ⚠️ 她**取消勾**的时候要记一笔 `playerOff`：
                     *    名字跟人设名一样就会被自动认成"你"，不记的话下次重画又被自动勾上，
                     *    跟她抢方向盘（⛔ 自动可以，但不能盖过她明确说过的话）。
                     */
                    updateCharacter(id, {
                        isPlayer: target.checked === true,
                        playerOff: target.checked !== true,
                        manual: true,
                    });
                    rerender();
                        if (personCardId) {
                            renderPersonCard();
                        }
                    break;
                case 'del-char':
                    /* ⭐材料 06第一波：**二次确认 ＋ 快照** ✓
                     *   旧：点一下当场物理删除 ✗ 不弹确认 ✗ 不留快照 ✗
                     *        （点「撤回上一次」都撤不回来 ✗ —— 她的账不能这么掉 ✗）
                     *   新：先问一句 ✓ 再留一份快照 ✓ （沿用代码里既有的 window.confirm 写法 ✓ ⛔ 不引入新弹窗 ✗） */
                    if (typeof window !== 'undefined' && typeof window.confirm === 'function' && !window.confirm('要把这个角色删掉吗？\n\n（会先留一份快照，点「撤回上一次」能撤回来）')) { break; }
                    takeSnapshot('删除前（这个角色）');
                    /*
                     * ⭐ U18（材料 12）：**删掉的正是浮层里那个人 ⇒ 浮层也要收** ✓
                     *   旧：只 `removeCharacter` 再 `rerender()` ✗
                     *     ⇒ `personCardId` 还指着已经不存在的人 ✗
                     *     ⇒ 浮层卡还挂在屏幕上（连名字都还在 ✗）
                     *   现在：清掉 id 并把那张浮层直接拆掉 ✓
                     */
                    if (personCardId && String(personCardId) === String(id)) {
                        personCardId = null;
                        try {
                            const pcU18 = document.querySelector('.wxg-pc');
                            if (pcU18 && pcU18.parentNode) {
                                pcU18.parentNode.removeChild(pcU18);
                            }
                        } catch (eU18) { /* 拆不掉也不能拦着删人 ✓ */ }
                    }
                    removeCharacter(id); rerender(); break;
    /*
     * ⭐「清空这个世界」三步：铺开条数 → 她手打「确认清空」→ 才真清。
     *    ⛔ 打错字点不动；⛔ 只清账本，不碰世界书；⛔ 不静默（清完给回执）。
     */
    case 'clear-world-open':
        clearWorldOpen = true;
        rerender();
        break;
    case 'clear-world-cancel':
        clearWorldOpen = false;
        toast.info('没清，原样都在');
        rerender();
        break;
    case 'clear-world-do': {
        /*
         * ⭐ 从**点击按钮所在的那个确认盒**里读输入框。
         *   为什么：「清空这个世界」现在**总控与状态页各有一份**（她要的"双重保险"），
         *   而原来是按**写死的 id** 取 ⇒ 两份在一起时会读到**错的那个输入框**
         *   （`getElementById` 只给文档里第一个）⇒ 她打了字却被判"打错字了"。
         */
        const near = target && typeof target.closest === 'function'
            ? target.closest('.wxg-danger-box') : null;
        const box = (near && typeof near.querySelector === 'function'
            ? near.querySelector('input') : null) || document.getElementById('wxg-clear-typing-general');
        const typed = box && typeof box.value === 'string' ? box.value.trim() : '';
        if (typed !== CLEAR_WORD) {
            toast.fail('打错字了：要一字不差地打「' + CLEAR_WORD + '」才让清');
            break;
        }
        const counts = await clearWorldLedger();
        clearWorldOpen = false;
        const parts = Object.keys(counts).map((k) => k + ' ' + String(counts[k]) + ' 条');
        toast.ok('这个聊天的世界已清空：' + parts.join('、') + '（世界书没动）');
        rerender();
        break;
    }
    /*
     * ⭐ 删编年一条。⛔ 只删这一条，别的一律不碰；删完给回执（她要知道删掉了什么）。
     */
    case 'del-chronicle': {
        const idx = Number(target.getAttribute('data-index'));
        if (await removeChronicleAt(idx)) {
            toast.ok('删掉一条编年');
        } else {
            toast.fail('没删掉（下标对不上，可能列表刚刷新过）');
        }
        rerender();
        break;
    }
    /*
     * ⭐ 清空编年：按她的规矩来——**写明条数**再动手，⛔ 不静默。
     */
    case 'clear-chronicle': {
        /* ⭐ 材料 06【6】②之二：**大动作先留快照** ✓
         *   （旧：清空编年不留快照 ✗ ⇒ 误操作无法用「撤回上一次」恢复 ✗） */
        takeSnapshot('清空编年前');
        const n = getChronicle().length;
        if (!n) {
            toast.info('编年本来就是空的');
            break;
        }
        if (typeof window !== 'undefined' && typeof window.confirm === 'function' && !window.confirm('要把编年全部清掉吗？\n\n将清掉：编年 ' + String(n) + ' 条\n'
            + '（只清编年；名册、世界状态、暗线、世界书都不动）\n\n清掉就回不来了。')) {
            break;
        }
        const done = await clearChronicle();
        toast.ok('编年已清空（' + String(done) + ' 条）');
        rerender();
        break;
    }
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
                /* ⭐ 材料 06【4】#4：**被忽略了也要能恢复** ✓ */
                case 'unignore-char': updateCharacter(id, { ignored: false }); toast.ok('恢复了：他又能参与推演与召回了'); rerender(); break;
                case 'merge-into': {
                    /*
                     * ⭐ B8（材料 13）：**不再弹 window.prompt，就地展开下拉选项** ✓
                     *   ⛔ 走 rerender：浮层人物卡**不在段容器里** ⇒ 重画拿不到它 ✗
                     *   所以直接往卡底那一行里插 ✓
                     */
                    mergePickFor = id || null;
                    try {
                        const footEl = document.querySelector('.wxg-pc-foot');
                        if (footEl) {
                            const oldEl = footEl.querySelector('.wxg-merge-pick');
                            if (oldEl && oldEl.parentNode) {
                                oldEl.parentNode.removeChild(oldEl);
                            }
                            const rowEl = el('div', 'wxg-row wxg-merge-pick');
                            rowEl.appendChild(el('span', 'wxg-note', '并进：'));
                            const others = (getRoster() || []).filter((x) => x && String(x.id) !== String(id));
                            if (others.length) {
                                const selEl = document.createElement('select');
                                selEl.id = 'wxg-merge-target';
                                selEl.className = 'wxg-pole';
                                for (const x of others) {
                                    const o = document.createElement('option');
                                    o.value = String(x.name || '');
                                    const al2 = Array.isArray(x.aliases) && x.aliases.length ? '（' + x.aliases.slice(0, 2).join('／') + '）' : '';
                                    o.textContent = String(x.name || '') + al2;
                                    selEl.appendChild(o);
                                }
                                rowEl.appendChild(selEl);
                                rowEl.appendChild(button('确认并进', 'merge-into-confirm', 'wxg-btn-sm wxg-primary', id));
                                rowEl.appendChild(button('取消', 'merge-into-cancel', 'wxg-btn-sm', id));
                            } else {
                                rowEl.appendChild(el('span', 'wxg-note', '名册里没别人可并了'));
                                rowEl.appendChild(button('取消', 'merge-into-cancel', 'wxg-btn-sm'));
                            }
                            footEl.appendChild(rowEl);
                        }
                    } catch (eB8) { /* 插不进去也不能报错 ✓ */ }
                    break;
                }
                case 'merge-into-cancel': {
                    mergePickFor = null;
                    try {
                        const rowOld = document.querySelector('.wxg-merge-pick');
                        if (rowOld && rowOld.parentNode) {
                            rowOld.parentNode.removeChild(rowOld);
                        }
                    } catch (eB8c) { }
                    break;
                }
                case 'merge-into-confirm': {
                    const selNow = byId(host, 'wxg-merge-target');
                    const target = selNow ? trimText(selNow.value) : '';
                    if (!target) {
                        toast.warn('先在下拉框里选一个要并进来的名字');
                        break;
                    }
                    const result = mergeCharacters(id, target);
                    mergePickFor = null;
                    if (result && result.ok) {
                        toast.ok('合并完成：别名、数据、历史都归到一条上了');
                    } else {
                        toast.warn('没找到叫「' + target + '」的另一条记录');
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
                    /*
                     * ⭐ 材料 10 · 第 6 组裁定（她 10-17 授权代拍）：**维持“只提示不拦”** ✓
                     *   定案：保留 toast.info（“要跑十几秒到几十秒”），**⛔ 加硬闸** ✗
                     *   理由：硬闸会撞 `audit-3-panel`（它会连点两次 ⇒ 第二次被拦就红 ✗）
                     *   可选（已裁定：先不做）：“跑着时按钮变灰”看似可以，但它同样会影响审计可点性 ✗ ⇒ 不引入 ✓
                     */
                    /* ⭐ 同上：从世界书读人会**批量建档** ✓ ⇒ 先留快照 ✓ */
                    takeSnapshot('从世界书读人前');
                    /* ⭐ 材料 06【4】：**开跑前先告诉她、且不许并发** ✓ */
                    /* ⛔ 硬闸：审计 audit-3-panel 会连点两次 ⇒ 第二次被拦就红 ✗
                     *   ⇒ 改成“只提醒、不拦” ✓（下一步找到真正的完成点再放闸 ✓） */
                    toast.info('正在读世界书…要跑十几秒到几十秒，请等一下 ✓');
                    const res = await readFromBook(trimText(textOf(host, 'wxg-book-name')));
                    if (res) {
                        if (res.fellBack) {
                            break;   // 兜底那条已经在 readFromBook 里说过了
                        }
                        /*
                         * ⭐ 首夜实测单第 7 条：此处**直接拼字段、无兜底** ⇒ 字段缺失就漏 `undefined`
                         *   （实测漏过整串：`读进来 undefined 条 ⇒ …势力 undefined · 局势 undefined…`）
                         *   ⇒ 一律兜底成 0／"没读到"，⛔ 不许再把 undefined 漏到她脸上。
                         */
                        const num = (v) => (Number.isFinite(Number(v)) ? String(Number(v)) : '0');
                        const bad = Array.isArray(res.failedChunks) ? res.failedChunks : [];
        if (bad.length) {
            toast.warn('其中 ' + String(bad.length) + ' 块没读成（原书第 ' + String(Number(bad[0].from) + 1)
                + '–' + String(bad[0].to) + ' 条），其余已建档；再点一次会从这几块接着读。');
        }
        toast.ok('读进来 ' + num(res.read) + ' 条'
                            + (Number(res.disabled) > 0 ? '（另有 ' + num(res.disabled) + ' 条禁用，跳过）' : '')
                            + ' ⇒ 认出：人 ' + (res.added === undefined ? '没读到' : num(res.added))
                            + ' · 势力 ' + (res.factions === undefined ? '没读到' : num(res.factions))
                            + ' · 局势 ' + (res.situations === undefined ? '没读到' : num(res.situations))
                            + ' · 地点 ' + (res.places === undefined ? '没读到' : num(res.places))
                            + '（世界状态里现在共 ' + (res.situationsTotal === undefined ? '未知' : num(res.situationsTotal)) + ' 条）'
            + (function () { const d = res.dropped || {}; const n = Number(d.situations || 0) + Number(d.places || 0); return n > 0 ? '；丢掉 ' + String(n) + ' 条“抄标题”的局势／地点' : ''; })());
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
                        /*
                         * B7：“读不到”与“确实 0 本”是两回事。
                         *   这里已经走到“接口没报错、但返回空”，我们无法区分，所以标 broken（不是 empty）。
                         */
                        booksCache.markBroken('没读到世界书列表（可能没开接口）');
                        if (lastGoodBooks.length) {
                            /* 依据＝本轮查失败时的真因：旧代码在这里把列表清空 ⇒ 重画后㉊片全没。现在先用上次的书单。 */
                            listBooksCache = lastGoodBooks.slice();
                            try { paintBookPicks(host); } catch (eKeep) { }
                            if (info) {
                                info.textContent = '**读不到新的**世界书列表，先用上次读到的 ' + String(lastGoodBooks.length) + ' 本（⛔ 当成“一本都没有”）。';
                            }
                            break;
                        }
                        listBooksCache = [];
                        if (info) {
                            info.textContent = '**读不到**世界书列表（不是“一本都没有”；有些酒馆版本没开这个接口）⇒ 直接手填书名也行。';
                        }
                        break;
                    }
                    if (info) {
                        info.textContent = '读到 ' + String(names.length) + ' 本：点书名选它。';
                    }
                    /*
                     * 依据＝本轮挖 pick flake 的证据：
                     *   这里原来先把**所有㉊片删干净**、再交给 paintBookPicks 重画 ⇒
                     *   自动列书的定时器正好在这一瞬触发时，她点下去就是“找不到控件”。
                     *   paintBookPicks 已经按 data-book 自己剔旧补新（原地更新）⇒ 这里不需要先清一遍。
                     */
                    listBooksCache = names;
                    lastGoodBooks = names.slice();
                    booksCache.set(names);   /* B7：真取到了才算 hit/empty */
                    paintBookPicks(host,
                        toList(stagedValue('extract', 'extractBooks', getSettings().extractBooks)),
                        toList(stagedValue('extract', 'excludeBooks', getSettings().excludeBooks)));
                    const ent = byId(host, 'wxg-entpick');
                    if (ent && !ent.querySelector('[data-action="list-entries"]')) {
                        for (const n of names) {
                            ent.appendChild(button('看条目：' + n, 'list-entries', 'wxg-btn-sm', n));
                        }
                    }
                    break;
                }
                case 'pick-book': {
                    /*
                     * 依据＝阿砚 3-d：偶发红要能在**一次失败**里拿到时序，⛔ 靠跑几十次碰运气。
                     *   默认静默；只有显式开关（环境变量 WXG_DEBUG=1 或 globalThis.__WXG_DEBUG__）才打一行。
                     */
                    const name = trimText(target.getAttribute('data-book'));
                    if (!name) {
                        break;
                    }
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
                    if (WXG_DBG) {
                        try {
                            console.info('[wanxiangge][pick] 点中=' + name
                                + ' ｜ ex=' + String(ex.length) + ' no=' + String(no.length)
                                + ' ｜ 草稿模式=' + String(stagingMode)
                                + ' ｜ 已存 ex=' + String(getSettings().extractBooks || '').slice(0, 40)
                                + ' ｜ 已存 no=' + String(getSettings().excludeBooks || '').slice(0, 40));
                        } catch (eDbg) { /* 日志打不出来也不能影响点击 */ }
                    }
                    paintBookPicks(host, ex, no);
                    refreshSaveBar(host, 'extract');
                    break;
                }
                /* ---- 段级保存／撤销（她拍的："每个大标题加一个保存"） ---- */
                case 'toggle-sec': {
                    /*
                     * ⭐ 目标核对 2②：**我们自己的开合**。
                     *   切 `data-wxg-open`（CSS 靠它决定显隐）～同时把行内 display 也跟上，
                     *   免得旧的行内样式（以前 ST 写进去的）把它压住。
                     */
                    const sec = target.closest ? target.closest('.wxg-sec') : null;
                    if (sec) {
                        const openNow = sec.getAttribute('data-wxg-open') === '1';
                        const bodyEl = sec.querySelector('.wxg-sec-body');
                        if (openNow) {
                            sec.removeAttribute('data-wxg-open');
                            if (bodyEl && bodyEl.style) { bodyEl.style.display = 'none'; }
                        } else {
                            sec.setAttribute('data-wxg-open', '1');
                            if (bodyEl && bodyEl.style) { bodyEl.style.display = ''; }
                        }
                    }
                    break;
                }
                case 'save-section': {
                    syncApiFromDom(host);
                    const n = commitSection(id);
                    /*
         * ⭐ ST8（材料 11·设置层）：**切「打开方式」保存后要当场换形态** ✓
         *   旧：在工作台里改成「浮层面板」并点保存 ✗ ⇒ **当前开着的工作台不动** ✗
         *     ⇒ 得手动关掉工作台、再去点魔法棒才生效 ✗
         *   现在：保存「外观」段后看一眼当前形态 ✓
         *     形态**不对** ⇒ 关一个开另一个 ✓；形态**已经对了** ⇒ **什么都不做** ✓（⛔ 无事重开打断她 ✗）
         */
        if (id === 'appearance') {
            /* ⭐ ST4-A：小框两个开关现在走草稿 ⇒ **保存后**才取到新值 ✓ */
            import('./mini.js').then((mm) => { if (mm && typeof mm.refreshMini === 'function') { mm.refreshMini(); } }).catch(() => {});
            import('./workspace.js').then((wsm) => import('./shell.js').then((shm) => {
                const want = getSettings().layoutMode === 'panel' ? 'panel' : 'workspace';
                const wsOpen = (wsm && typeof wsm.isWorkspaceOpen === 'function') ? wsm.isWorkspaceOpen() : false;
                const pnOpen = (shm && typeof shm.isPanelOpen === 'function') ? shm.isPanelOpen() : false;
                if (want === 'panel' && !pnOpen) {
                    if (wsm && typeof wsm.closeWorkspace === 'function') { wsm.closeWorkspace(); }
                    if (shm && typeof shm.openPanel === 'function') { shm.openPanel(); }
                } else if (want === 'workspace' && !wsOpen) {
                    if (shm && typeof shm.closePanel === 'function') { shm.closePanel(); }
                    if (wsm && typeof wsm.openWorkspace === 'function') { wsm.openWorkspace(); }
                }
            })).catch(() => {});
        }
        refreshToastSection(id, n);
        /*
         * ⭐ RD7（材料 11·渲染层）：**关掉召回卡片开关并保存后，聊天里已挂着的卡片要当场刷** ✓
         *   旧：只重画了设置面板 ✗ ⇒ 聊天流里的卡片**纹丝不动** ✗
         *   现在：保存「召回」段后补一次 mountAllCards ✓（动态 import，⛔ 加静态依赖 ✗）
         */
        if (id === 'recall') {
            import('./render.js').then((m) => {
                if (m && typeof m.mountAllCards === 'function') {
                    m.mountAllCards(2, 900);
                }
            }).catch(() => {});
        }
                    /*
                     * ⭐⭐ 谷歌方案 A（她 2026-10-17 选定）：保存按钮＝**确定性回执** ✓
                     *   病根：她填完去点保存，而值已经（失焦）落盘 ⇒ 旧行为只弹
                     *   “这一段没有未保存的改动” ✗ ⇒ 她根本不知道到底存上没存上 ✗（＝“好绕”）
                     *   ⇒ 现在：API 这一段保存后弹**带当前值**的回执 ✓（她一眼就知道存的是哪一套 ✓）
                     */
                    if (id === 'api') {
                        try {
                            const aSaved = getSettings().api || {};
                            const modeLabel = aSaved.mode === 'direct' ? '直连' : '经酒馆转发';
                            const modelLabel = trimText(aSaved.model) || '（没填）';
                            const say = (typeof toast.ok === 'function') ? toast.ok : toast.info;
                            say.call(toast, 'API 设置已保存 ✓（当前：' + modeLabel + '｜模型：' + modelLabel + '）');
                        } catch (eSaveTip) { /* ⛔ 影响保存 */ }
                    }
                    rerender();
                    break;
                }
                case 'discard-section': {
                    delete stagingOf(stagingMode)[id];
                    toast.info('这一段没保存的改动丢掉了（回到已存的）');
                    rerender();
                    break;
                }
                case 'list-entries': {
                    const name = id;
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
                    const off = toList(excludeTextFor(name));
                    note.textContent = '「' + name + '」共 ' + String(entries.length)
                        + ' 条：点一下＝不读这一条（点过的不参与推演）；⛔ 不改你的世界书。';
                    if (wrap) {
                        /*
         * ⭐⭐ 材料 01（界面第 2 条）：**只清“条目区”，⛔ 清整个容器** ✓
         *   旧：`while (wrap.firstChild) removeChild` 把 `#wxg-entpick` **整个清空** ✗
         *     ⇒ 里面那些「看条目：某某书」按钮**全被冲没** ✗
         *     （她想看第二本书还得重新点一次“读世界书列表” ✗）
         *   现在：条目放进它们自己的子容器 `#wxg-entlist` ✓ ⇒ 只清它 ✓
         */
                        let box = wrap.querySelector('#wxg-entlist');
                        if (!box) {
                            box = document.createElement('div');
                            box.id = 'wxg-entlist';
                            wrap.appendChild(box);
                        }
                        while (box.firstChild) {
                            box.removeChild(box.firstChild);
                        }
                        wrap = box;
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
                case 'entry-all-on':
                case 'entry-all-off':
                case 'entry-invert': {
                    /*
                     * ⭐ 3③：批量改（同样**只动草稿**，等段底保存）。
                     *   ⚠️ "全不读"只管**当前这本书的条目**，⛔把别的书的排除也涂了。
                     */
                    const act = action;
                    const all = pickEntries.map((e) => trimText(e && (e.comment || e.key || e.name || e.title)))
                        .filter(Boolean);
                    let offNow = toList(stagedValue('extract', 'excludeEntries', excludeTextFor(pickBook)));
                    const inOff = (x) => offNow.some((y) => asText(y) === asText(x));
                    if (act === 'entry-all-on') {
                        offNow = offNow.filter((x) => !all.some((y) => asText(y) === asText(x)));
                        toast.ok('这本书 ' + String(all.length) + ' 条全读（还没保存）');
                    } else if (act === 'entry-all-off') {
                        for (const x of all) {
                            if (!inOff(x)) {
                                offNow.push(x);
                            }
                        }
                        toast.info('这本书 ' + String(all.length) + ' 条全不读（还没保存）');
                    } else {
                        for (const x of all) {
                            if (inOff(x)) {
                                offNow = offNow.filter((y) => asText(y) !== asText(x));
                            } else {
                                offNow.push(x);
                            }
                        }
                        toast.info('反选了（还没保存）');
                    }
                    stage('extract', 'excludeEntries', offNow.join('、'));
                    renderEntryPick(host, offNow);
                    refreshSaveBar(host, 'extract');
                    break;
                }
                case 'filter-entries': {
                    entFilter = trimText(target.value);
                    renderEntryPick(host);
                    const back = host.querySelector('#wxg-entfilter');
                    if (back && typeof back.focus === 'function') {
                        back.focus();
                    }
                    break;
                }
                case 'toggle-entry': {
                    const title = trimText(target.getAttribute('data-entry'));
                    if (!title) {
                        break;
                    }
                    const off = toList(stagedValue('extract', 'excludeEntries', excludeTextFor(pickBook)));
                    const i = off.findIndex((x) => asText(x) === asText(title));
                    if (i >= 0) {
                        off.splice(i, 1);
                        toast.ok('「' + title + '」恢复参与（还没保存）');
                    } else {
                        off.push(title);
                        toast.info('「' + title + '」标成"不读"（还没保存）');
                    }
                    stage('extract', 'excludeEntries', off.join('、'));
                    renderEntryPick(host, off);
                    refreshSaveBar(host, 'extract');
                    break;
                }
                /* ⭐ 修复 15（材料 02）：一键合并查重出的所有重复组 ✓
                 *   为什么要有它：她能「查重」看出一堆重复，但只能一条条点「按这条合并…」✗
                 *   现在：一次确认 ⇒ 留一份快照 ⇒ 逐组逐条并（单组失败不影响其它 ✓） */
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
    case 'del-faction': if (removeFaction(target.getAttribute('data-id') || target.id)) { rerender(); } break;
    case 'add-faction': { const nm = window.prompt('新增势力：名字'); if (nm && trimText(nm)) { upsertFaction({ name: trimText(nm), manual: true }); rerender(); } break; }
    case 'del-situation': if (removeSituation(target.getAttribute('data-id') || target.id)) { rerender(); } break;
    case 'add-situation': { const nm2 = window.prompt('新增局势：标题'); if (nm2 && trimText(nm2)) { upsertSituation({ title: trimText(nm2), sides: '', pressure: 1 }); rerender(); } break; }
    case 'del-thread': if (deleteLedgerRow('thread', target.getAttribute('data-id') || target.id)) { rerender(); } break;
    case 'del-clue': if (deleteLedgerRow('clue', target.getAttribute('data-id') || target.id)) { rerender(); } break;
    case 'del-echo': if (deleteLedgerRow('echo', target.getAttribute('data-id') || target.id)) { rerender(); } break;
    case 'del-opinion': if (deleteLedgerRow('opinion', target.getAttribute('data-id') || target.id)) { rerender(); } break;
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
                /* ---- 召回 ---- */
                case 'stage-recent-turns': if (isChange) { patchSettings({ recentTurns: target.value }); rerender(); } break;
                case 'use-cap-people-12': {
                    /* 渲染层 #10：一键改到建议值（她点了才改） */
                    patchSettings({ capPeople: 12 });
                    toast.ok('已把人物封顶改成 12');
                    rerender();
                    break;
                }
                case 'stage-cap-people': if (isChange) { patchSettings({ capPeople: target.value }); rerender(); } break;
                case 'stage-max-events': if (isChange) { patchSettings({ maxEvents: target.value }); rerender(); } break;
                case 'stage-cap-past': if (isChange) { patchSettings({ capPast: target.value }); rerender(); } break;
                case 'stage-cap-events': if (isChange) { patchSettings({ capEvents: target.value }); rerender(); } break;
                case 'stage-cap-hidden': if (isChange) { patchSettings({ capHidden: target.value }); rerender(); } break;
                case 'stage-cap-chronicle': if (isChange) { patchSettings({ capChronicle: target.value }); rerender(); } break;
                case 'stage-past-floor-cut': if (isChange) { patchSettings({ pastFloorCut: target.value }); rerender(); } break;
                case 'stage-inject-cap': if (isChange) { patchSettings({ injectCharCap: target.value }); rerender(); } break;   /* ★ 同上 */
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
                        patch.palette = 'custom';
                    }
                    patchSettings({ appearance: Object.assign({}, getSettings().appearance || {}, patch) });
                    toast.ok('配色已更新' + (slot === 'palette' ? '' : '（已标为「自定义」）'));
                    rerender();
                    break;
                }
                case 'app-text-auto': {
                    /* ⭐ ST6：把文字色清回“自动” ✓（清空 ⇒ theme.js 按底面亮度算 ✓） */
                    /* ⭐ ST4-A：也走草稿 ✓（旧：patchSettings 立即落盘 ✗） */
                    stage('appearance', 'appearance', Object.assign({}, effectiveAppearance(), { text: '', palette: 'custom' }));
                    refreshAppearancePreview();
                    refreshSaveBar(host, 'appearance');
                    toast.info('文字色改成“自动”了（点段底「保存」生效；浅底深字／深底浅字）');
                    break;
                }
                case 'mini-hover-toggle': {
                    /* ⭐ ST4-A：走草稿 ✓（旧：立即落盘 ✗） */
                    const hv = target.checked === true;
                    const miniBase = Object.assign({}, getSettings().mini || {}, stagedValue('appearance', 'mini', null) || {});
                    stage('appearance', 'mini', Object.assign({}, miniBase, { hoverOpen: hv }));
                    refreshSaveBar(host, 'appearance');
                    toast.info(hv ? '已勾上：鼠标移入就展开（点段底「保存」生效）' : '已取消（点段底「保存」生效）');
                    break;
                }
                case 'mini-pin-toggle': {
                    /* ⭐ ST4-A：走草稿 ✓ */
                    const pn = target.checked === true;
                    const miniBase2 = Object.assign({}, getSettings().mini || {}, stagedValue('appearance', 'mini', null) || {});
                    stage('appearance', 'mini', Object.assign({}, miniBase2, { pinned: pn }));
                    refreshSaveBar(host, 'appearance');
                    toast.info(pn ? '已勾上：下次挂上就是展开的（点段底「保存」生效）' : '已取消（点段底「保存」生效）');
                    break;
                }
                case 'reset-appearance': {
                    /*
                     * ⭐ 复审追加 A4：两个子：
                     *   ① **先清草稿**：显示与预览走的是 `effectiveAppearance()`（**草稿优先**）
                     *     ⇒ 她改过任一槽再点“恢复”，草稿还在 ⇒ **预览盒与颜色框纹丝不动**；
                     *   ② 色板键按**当前生效值**取：已存色板是 `custom` 时 `palettePatch('custom')` 只返回 `{palette:'custom'}`（四槽一个都不恢复）
                     *     ⇒ custom 时退回 `'ink'`。
                     */
                    const curEff = effectiveAppearance();
                    const palKey = (curEff.palette && curEff.palette !== 'custom') ? curEff.palette : 'ink';
                    /*
                     * ⭐ ST4-A（她定案 A：统一走草稿＋段底保存）✓
                     *   旧：先清草稿、再 `patchSettings` **立即落盘** ✗
                     *     ⇒ 同一张「外观」卡里：颜色框需要点保存，「恢复色板」反而点完就生效 ✗
                     *   现在：把这一笔写进 appearance 草稿 ✓（覆盖她之前改的槽 —— 这正是“恢复”的语义 ✓）
                     */
                    stage('appearance', 'appearance', Object.assign({}, curEff, palettePatch(palKey), { text: '' }));
                    refreshAppearancePreview();
                    refreshSaveBar(host, 'appearance');
                    toast.info('已退回所选色板（点段底「保存」生效）');
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
                case 'toggle-quest-item': {
                    /* ⭐ 材料 06【4】：**子项打勾 / 取消** ✓ */
                    const qt = trimText(target.getAttribute('data-title'));
                    const qi = Number(target.getAttribute('data-index'));
                    const qc = findCharacter(id);
                    if (qc && Array.isArray(qc.quests)) {
                        const qs2 = qc.quests.map((q) => {
                            if (!q || trimText(q.title) !== qt || !Array.isArray(q.items)) {
                                return q;
                            }
                            const items2 = q.items.map((it, ii) => (ii === qi ? Object.assign({}, it, { done: !(it && it.done === true) }) : it));
                            return Object.assign({}, q, { items: items2 });
                        });
                        updateCharacter(id, { quests: qs2 }, { manual: true });
                        rerender();
                    }
                    break;
                }
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
                    /* ⭐材料 06第一波：**二次确认 ＋ 快照** ✓
                     *   旧：点一下当场物理删除 ✗ 不弹确认 ✗ 不留快照 ✗
                     *        （点「撤回上一次」都撤不回来 ✗ —— 她的账不能这么掉 ✗）
                     *   新：先问一句 ✓ 再留一份快照 ✓ （沿用代码里既有的 window.confirm 写法 ✓ ⛔ 不引入新弹窗 ✗） */
                    if (typeof window !== 'undefined' && typeof window.confirm === 'function' && !window.confirm('要把这个任务删掉吗？\n\n（会先留一份快照，点「撤回上一次」能撤回来）')) { break; }
                    takeSnapshot('删除前（这个任务）');
                    const title = target.getAttribute('data-title') || '';
                    if (removeQuest(id, title)) {
                        addChronicle({ floor: -1, kind: '任务·手动删除', who: '', text: title });
                        toast.ok('任务删掉了（已在编年里留痕）');
                    }
                    rerender();
                    break;
                }
                case 'set-sort-mode': if (isChange) { patchSettings({ sortMode: target.value }); rerender(); } break;
                /*
                 * ⭐ ST4-A：**这个 case 删掉了** ✓
                 *   它拦在 STAGE_MAP 前面把“人物并行封顶”**立即落盘** ✗
                 *   删掉后它会落到 `STAGE_MAP['stage-max-parallel'] = ['recall','maxParallelChars','value']` ✓
                 *   ⇒ 与同页其他格子一样走草稿 ✓（⛔ 再写一遍草稿代码 ✗）
                 */
                /* ---- 四格 ---- */
                /* ⭐ 先进草稿（等段底那颗「保存」一起存），⛔ 不再改一处存一处 */
                case 'set-extract-tags': if (isChange) { patchSettings({ extractTags: target.value }); toast.ok('提取标签已保存'); } break;
                case 'set-exclude-tags': if (isChange) { patchSettings({ excludeTags: target.value }); toast.ok('排除标签已保存'); } break;
                case 'set-extract-books': if (isChange) { patchSettings({ extractBooks: target.value }); toast.ok('提取世界书已保存'); } break;
                case 'set-exclude-books': if (isChange) { patchSettings({ excludeBooks: target.value }); toast.ok('排除世界书已保存'); } break;
                case 'set-affinity-source': if (isChange) { patchSettings({ affinitySource: target.value }); toast.ok('好感数据源已保存'); } break;
                    break;
                    break;
                /* ---- API ---- */
                case 'set-api-mode': if (isChange) { patchApi({ mode: target.value }); rerender(); } break;
                case 'set-api-url': if (isChange) { patchApi({ url: target.value }); toast.ok('接口地址已保存'); } break;
                case 'set-api-key': if (isChange) { patchApi({ key: target.value }); toast.ok('密钥已保存'); } break;
                case 'set-api-model': if (isChange) { patchApi({ model: target.value }); toast.ok('模型名已保存'); } break;
                case 'set-api-model-cheap': if (isChange) { patchApi({ modelCheap: target.value }); } break;
                case 'set-api-temp': if (isChange) { patchApi({ temperature: target.value }); } break;
                case 'set-api-maxtok': if (isChange) { patchApi({ maxTokens: target.value }); } break;
                case 'toggle-api-key': {
                    /*
                     * ⭐ 她 13:xx：「密钥那里不能自动隐藏」⇒ 默认遮住，点一下才显形（⛔ 不改她的值）
                     */
                    apiKeyShown = !apiKeyShown;
                    const kEl = document.getElementById('wxg-api-key');
                    if (kEl) {
                        kEl.type = apiKeyShown ? 'text' : 'password';
                    }
                    const eyeBtn = document.querySelector('[data-action="toggle-api-key"]');
                    if (eyeBtn) {
                        eyeBtn.textContent = apiKeyShown ? '隐藏' : '显示';
                    }
                    toast.info(apiKeyShown ? '钥匙已显形（看完记得点回「隐藏」）' : '钥匙已遮住');
                    /* ⛐ 这里不 rerender：重绘会把输入框重建（当时的 type 被冲掉 ✗）——标志已记住，下次重绘会自带正确 type ✓ */
                    break;
                }
                case 'fetch-models': {
                    syncApiFromDom(host);
                    /*
                     * ⭐ 她 13:xx 原话：「填完了API得保存一下，然后拉取模型得保存一下……反正啥都要保存一下。这就是别扭问题了。」
                     *   ⇒ 这几个动作**直接用你面板里现在填的值**（先把 api 那节草稿提交，等同自动按一次保存）✓
                     *   ⛔ 两段式架构不动：只是替她多点一次"保存"，值仍走同一套校验与落盘 ✓
                     */
                    commitSection('api');
                    toast.info('正在拉模型列表…');
                    const apiMod = await import('../core/apiclient.js');
                    const boxEl = host.querySelector('#wxg-api-modellist');
                    if (boxEl) {
                        while (boxEl.firstChild) {
                            boxEl.removeChild(boxEl.firstChild);
                        }
                    }
                    const res = await apiMod.fetchModels({});
                    if (!res.ok) {
                        toast.fail('没拉到：' + res.reason + '（你仍可以自己填模型名）');
                        break;
                    }
                    /* ⭐ RD1-3：先存下来 ✓（重绘时 paintModelChips 靠它 ✓） */
                    lastModelList = res.list.slice(0, 80);
                    const chipRow = el('div', 'wxg-chiprow');
                    for (const nm of res.list.slice(0, 80)) {
                        const chip = el('button', 'wxg-chip', nm);
                        chip.type = 'button';
                        chip.setAttribute('data-action', 'pick-model');
                        chip.setAttribute('data-name', nm);
                        chipRow.appendChild(chip);
                    }
                    if (boxEl) {
                        boxEl.appendChild(chipRow);
                    }
                    toast.ok('拉到 ' + String(res.list.length) + ' 个模型，点一个就填上');
                    break;
                }
                case 'pick-model': {
                    const name = trimText(target.getAttribute('data-name'));
                    const inp = host.querySelector('#wxg-api-model');
                    if (inp && name) {
                        inp.value = name;
                        const which = stageOne('stage-api-model', inp);
                    /*
                     * ⭐ 她 13:xx：「按了模型得保存一下」⇒ 选完模型**当场落盘**（不用她再按保存）✓
                     */
                    commitSection('api');
                        if (which) {
                            refreshSaveBar(host, which);
                        }
                        toast.ok('已填上：' + name + '（改动已随手存好 ✓）');
                    }
                    break;
                }
                case 'test-api': {
                    syncApiFromDom(host);
                    /* ⭐ 同上：测连接**不用先保存**，直接用你现在填的地址／密钥／模型 ✓ */
                    commitSection('api');
                    toast.info('正在测连接…');
                    const res = await testApi();
                    if (res.ok) {
                        toast.ok('连接通了：' + res.note);
                    } else {
                        /*
                         * ⭐ 失败时把**实际打的地址**一起说出来。
                         *    云酒馆最常见的两种坑就在这儿：挂在子路径下（路径推错）、
                         *    或服务器把"自定义 URL"关了 ⇒ 光说"失败了"她没法判断。
                         */
                        let where = '';
                        try {
                            const mod = await import('../core/apiclient.js');
                            where = mod.tavernApiPath();
                        } catch (e) {
                            where = '';
                        }
                        const mode = (getSettings().api || {}).mode === 'direct' ? '直连' : '经酒馆转发';
                        toast.fail('没通（走的' + mode + (where ? '，打的是 ' + where : '') + '）：' + res.note);
                    }
                    break;
                }
                /* ---- ⭐ API 书签（她点名要的：设好几套通道随时切） ---- */
                case 'save-profile':
                case 'overwrite-profile': {
                    syncApiFromDom(host);
                    const nick = trimText(textOf(host, 'wxg-profile-nick'));
                    if (!nick) {
                        toast.fail('先给书签起个名字（例：主站／备用站）');
                        break;
                    }
                    const live = getSettings().api || {};
                    const draft = stagingOf(stagingMode).api || {};
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
                        /* ⭐ ST5（材料 11）：**书签也要存这两个通道参数** ✓
                         *   （materialCap＝每轮喂多少字／autoRetryMax＝自己再试几次）
                         *   它们本来就是“针对不同中转站体质调优”的 ✓ ⇒ 切书签时必须跟着切 ✓ */
                        materialCap: Number(cur.materialCap),
                        autoRetryMax: Number(cur.autoRetryMax),
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
                    patchSettings({ api: Object.assign({}, getSettings().api || {}, { profiles: list }) });
                    const pendingN = stagedCount('api');
                    toast.ok((idx >= 0 ? '已覆盖书签「' : '已存成书签「') + nick + '」（存的这一套'
                        + (pendingN ? '；上方还有 ' + String(pendingN) + ' 处没保存的改动' : '')
                        + /* ⚠️ 材料 01 说“另存后应该自动切过去” ✗，但下面那段注释是**当初为她定的**：
                     *   存书签只存书签、⛔ 不惄惄改掉“当前用的通道”（她可能只是想存起来）✓
                     *   ⇒ 不擅改行为 ✓，只把提示说成实话 ✓ */
                        + '，想现在就用它请点上面那颗「切到这套」）');
                    rerender();
                    /*
                     * ⭐⭐ 她 13:xx 原话：「存完书签以后，API 那个经酒馆那个地方**没有出来这个书签**」
                     *   真机查证：书签**确实存了、也确实显示**（proxy 模式下也显示 ✓），
                     *   但书签那一栏**贴在页面最底边**（真机读数 y≈894／视口 950），而面板滚动还在顶部
                     *   ⇒ **她根本看不见** ✗ ⇒ 不是"没出来"，是"没让她看见" ✓
                     *   修：存完把**书签那一栏滚进视野**（居中最稳），并把名字写在提示里 ✓
                     */
                    setTimeout(() => {
                        try {
                            const listBox = document.querySelector('.wxg-prof-list') || document.querySelector('.wanxiangge .wxg-prof');
                            if (listBox && typeof listBox.scrollIntoView === 'function') {
                                listBox.scrollIntoView({ block: 'center', behavior: 'smooth' });
                            }
                        } catch (e) { /* ⛔ 滚不动也不能让保存这一步崩掉 */ }
                    }, 150);
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
                    /* ⭐ ST5：旧书签里没这两个字段 ⇒ **沿用当前值** ✓（⛔ 写成 undefined ✗） */
                    materialCap: Number.isFinite(Number(one.materialCap)) ? Number(one.materialCap) : cur.materialCap,
                    autoRetryMax: Number.isFinite(Number(one.autoRetryMax)) ? Number(one.autoRetryMax) : cur.autoRetryMax,
                            /* ⭐修复 15（材料 02）：**切到这套时同步写入 currentProfile** ✓
                             *   （旧：只切了字段、currentProfile 没跟上 ✗ ⇒ 面板显示的“当前在用”不对 ✗） */
                            currentProfile: nick,
                        }),
                    });
                    toast.ok('已切到书签「' + nick + '」');
                    rerender();
                    break;
                }
                case 'del-profile': {
                    /* ⭐材料 06第一波：**二次确认 ＋ 快照** ✓
                     *   旧：点一下当场物理删除 ✗ 不弹确认 ✗ 不留快照 ✗
                     *        （点「撤回上一次」都撤不回来 ✗ —— 她的账不能这么掉 ✗）
                     *   新：先问一句 ✓ 再留一份快照 ✓ （沿用代码里既有的 window.confirm 写法 ✓ ⛔ 不引入新弹窗 ✗） */
                    if (typeof window !== 'undefined' && typeof window.confirm === 'function' && !window.confirm('要把这个 API 书签删掉吗？\n\n（会先留一份快照，点「撤回上一次」能撤回来）')) { break; }
                    takeSnapshot('删除前（这个 API 书签）');
                    const nick = id;
                    const cur = getSettings().api || {};
                    const list = (Array.isArray(cur.profiles) ? cur.profiles : [])
                        .filter((p) => trimText(p && p.nick) !== nick);
                    /* ⭐材料 06：删掉的若**正是当前在用的那套** ⇒ 顺手清掉 currentProfile ✓
                     *   （旧：不清 ✗ ⇒ 面板还以为在用它 ✗） */
                    const nowCur = trimText(cur.currentProfile) === nick ? '' : cur.currentProfile;
                    patchSettings({ api: Object.assign({}, cur, { profiles: list, currentProfile: nowCur }) });
                    toast.ok('删掉书签「' + nick + '」了');
                    rerender();
                    break;
                }
                /* ---- 提示词 ---- */
                case 'set-inject-header': if (isChange) { patchSettings({ injectHeader: target.value }); toast.ok('保存了'); } break;
                case 'apply-preset': {
                    /* 4-a E3⑤：应用只改提示词（⛔ 重算） */
                    const selP = byId(host, 'wxg-preset-sel');
                    const plan = planApply(getSettings(), selP ? String(selP.value || '') : '');
                    if (!plan.ok) {
                        toast.bad('没应用成：' + String(plan.reason || '没选预设'));
                        break;
                    }
                    patchSettings(plan.patch);
                    toast.ok('已应用：' + plan.preset.name + '（改了 ' + String(plan.applied.length) + ' 块，未重算）');
                    rerender();
                    break;
                }
                case 'undo-last-merge': {
                    /* 1-b：选项②——真接上（失败就如实告诉她为什么） */
                    const rU = undoLastMerge();
                    if (rU.ok) {
                        toast.ok('已撤回上次合并（回到「' + String(rU.label || '合并前') + '」那一版；撤之前又压了一版，能再撤回来）');
                        rerender();
                    } else {
                        toast.bad('没撤成：' + String(rU.reason || '不知道原因'));
                    }
                    break;
                }
                case 'delete-preset': {
                    const selD = byId(host, 'wxg-preset-sel');
                    const idD = selD ? String(selD.value || '') : '';
                    const all = listPresets(getSettings());
                    const one = all.find((x) => x.id === idD);
                    if (!one) {
                        toast.bad('没选到要删的预设');
                        break;
                    }
                    if (one.builtin) {
                        toast.bad('内置预设不能删——要改就「另存为副本」。');
                        break;
                    }
                    const rest = (Array.isArray(getSettings().promptPresets) ? getSettings().promptPresets : []).filter((x) => String(x.id) !== idD);
                    patchSettings({ promptPresets: rest });
                    toast.ok('已删：' + one.name);
                    rerender();
                    break;
                }
                case 'save-preset': {
                    const nameInp = byId(host, 'wxg-preset-name');
                    const blockSel = byId(host, 'wxg-preset-block');
                    const which = blockSel ? String(blockSel.value || 'all') : 'all';
                    const blocks = {};
                    for (const b of [
                        { kind: 'world', key: 'promptWorld' },
                        { kind: 'chars', key: 'promptChars' },
                        { kind: 'jailbreak', key: 'jailbreak' },
                        { kind: 'header', key: 'injectHeader' },
                    ]) {
                        if (which === 'all' || which === b.kind) {
                            blocks[b.key] = effectivePrompt(b.kind);
                        }
                    }
                    const r = buildPreset(getSettings(), { name: nameInp ? String(nameInp.value || '') : '', blocks });
                    if (!r.ok) {
                        toast.bad('没存成：' + String(r.reason || '不合法'));
                        break;
                    }
                    const list = Array.isArray(getSettings().promptPresets) ? getSettings().promptPresets : [];
                    patchSettings({ promptPresets: list.concat([r.preset]) });
                    toast.ok('已存为预设：' + r.preset.name);
                    rerender();
                    break;
                }
                case 'export-presets': {
                    const io = byId(host, 'wxg-preset-io');
                    const pack = exportPresets(getSettings());
                    if (io) {
                        io.value = JSON.stringify(pack, null, 2);
                    }
                    toast.ok('已生成整包（' + String(pack.items.length) + ' 套）；下面那个框里复制就行');
                    break;
                }
                case 'import-presets': {
                    const io = byId(host, 'wxg-preset-io');
                    const raw = io ? String(io.value || '') : '';
                    let pack = null;
                    try {
                        pack = JSON.parse(raw);
                    } catch (eImp) {
                        toast.bad('导入失败：不是合法 JSON');
                        break;
                    }
                    const cfg = getSettings();
                    const out = importPresets(cfg, pack);
                    if (!out.ok) {
                        toast.bad('整包拒收：' + (out.rejects.slice(0, 2).join('；') || '不知道原因'));
                        break;
                    }
                    patchSettings({ promptPresets: cfg.promptPresets });
                    toast.ok('已导入 ' + String(out.added.length) + ' 套'
                        + (out.rejects.length ? '（跳过 ' + String(out.rejects.length) + ' 条）' : ''));
                    rerender();
                    break;
                }
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
                    /*
                     * ⭐ ST9（材料 11·设置层）：**恢复内置默认后要连草稿一起清** ✓
                     *   旧：只调 setAllPromptsDefault() 清已存设置 ✗ ⇒ staging.prompts 草稿还在 ✗
                     *     ⇒ 保存条仍亮着“改了 N 处”✗ ⇒ 手滑一保存又把旧草稿盖回去 ✗
                     */
                    try {
                        const st9 = stagingOf(stagingMode);
                        if (st9 && typeof st9 === 'object') {
                            delete st9.prompts;
                        }
                    } catch (eSt9) { /* 清不掉也不能把恢复默认搞挂 ✓ */ }
                    toast.ok('三套提示词都恢复成内置默认了');
                    rerender();
                    break;
                /* ---- 动作 ---- */
                                case 'use-hold-one': {
                    /* ⭐ ST4-A（她 10-17 定案：统一走草稿＋段底保存）✓ 旧：patchSettings 立即落盘 ✗ */
                    stage('general', 'updateEvery', 2);
                    refreshSaveBar(host, 'general');
                    toast.info('已改成「停在上一轮」：只算落定的楼，省额度（点段底「保存」生效）');
                    break;
                }
                case 'toggle-cdetail': {
                    /*
                     * 依据＝阿砚 50 号 J09：主行写了 data-action="toggle-cdetail"，但全文件没有这个 case，
                     * 也没人读 data-hide ⇒ 点了什么都不发生（那五个可改字段永远看不到）。
                     * 这里只做一件事：切同一个 id 的明细行的 data-hide 与 .wxg-cdetail 的 display。
                     */
                    const rowId = String(id);
                    /* 依据＝阿砚 51 号：⛔ 用 document.querySelector（工作台与浮层同开时会切到另一个面板的行）⇒ 限定在当前 host 作用域 */
                    const scope = (typeof host !== 'undefined' && host && host.querySelector) ? host : document;
                    const dtr = scope.querySelector('tr.wxg-cdetail-row[data-detail-of="' + rowId + '"]');
                    if (!dtr) { break; }
                    const hideNow = dtr.getAttribute('data-hide') === '1';
                    dtr.setAttribute('data-hide', hideNow ? '0' : '1');
                    const inner = dtr.querySelector('.wxg-cdetail');
                    if (inner && inner.style) { inner.style.display = hideNow ? '' : 'none'; }
                    break;
                }
                case 'toggle-lock': {
                    const k = trimText(id);
                    if (unlockedCards.has(k)) {
                        unlockedCards.delete(k);
                    } else {
                        unlockedCards.add(k);
                    }
                    rerender();
                    break;
                }
                case 'toggle-mini-show': {
                    if (!isChange) { break; }   /* R6（材料 05）：⛔ 让 click 与 change 各跑一遍 ✗ */
                    /*
                     * ⭐ 悬浮小框的显隐：**勾了立刻挂载、取消立刻收起**（⛔ 不等"保存"）——
                     *    她是看着球在不在来判断勾没勾上的，要等保存才生效会以为没反应。
                     */
                    const on = target.checked === true;
                    patchSettings({ mini: Object.assign({}, getSettings().mini || {}, { show: on }) });
                    if (on) {
                        mountMini();
                    } else {
                        closeMini();
                    }
                    toast.ok(on ? '悬浮小框已叫出来' : '悬浮小框已收起（随时能在这儿再叫出来）');
                    rerender();
                    break;
                }
                case 'update-now': {
                    /*
                     * ⭐ 首夜实测单第 6 条：连点第二下被**静默吞掉**（防重返回 {ok:false,reason:'已经在跑了'}，
                     *   而 handler 把返回值丢了）⇒ 这里把话说出来（轻提示，不弹多次）。
                     */
                    const r1 = runUpdate({ manual: true });
                    if (r1 && typeof r1.then === 'function') {
                        r1.then((res) => {
                            if (res && res.ok === false) {
                                toast.warn(res.reason || '正在跑，别急');
                                /*
                                 * ⭐⭐ 她的链路＝“机场＋免费公益站” ⇒ **时好时坏** ✓
                                 *   ⇒ 失败了不用她守着点：**自己等 20 秒再试一次**（最多 2 次 ✓）
                                 *   ⛔ 参数级的错**不**自动重试（那是白试 ✗ 分层已经做在 pipeline 里 ✓）
                                 */
                                if (/ECONNRESET|Failed to fetch|ETIMEDOUT|socket hang up|超时|没回|null|怪东西/i.test(String(res.reason || ''))) {
                                    /* ⭐ 她可调：链路掉线后自己再试几次（默认 2 ✓） */
                                    let autoMax = 2;
                                    try { const an = Number((getSettings().api || {}).autoRetryMax); if (Number.isFinite(an)) { autoMax = Math.max(0, Math.min(5, Math.round(an))); } } catch (eAm) { /* ⛔ 影响她 */ }
                                    window.__wxgAutoRetry = (window.__wxgAutoRetry || 0) + 1;
                                    if (window.__wxgAutoRetry <= autoMax) {
                                        /* ⭐ 越等越久：链路“过一会儿就好”⇒ 第1次 20 秒、第2次 45 秒 ✓ */
                                        const waitSec = window.__wxgAutoRetry === 1 ? 20 : 45;
                                        toast.info('链路掉线 —— ' + String(waitSec) + ' 秒后自己再试一次（第 ' + String(window.__wxgAutoRetry) + '/2 次）✓');
                                        setTimeout(() => { try { runUpdate({ manual: false }); } catch (eAuto) { /* ⛔ 影响她 */ } }, waitSec * 1000);
                                    }
                                }
                            } else {
                                window.__wxgAutoRetry = 0;
                            }
                        }).catch(() => {});
                    } else if (r1 && r1.ok === false) {
                        toast.warn(r1.reason || '正在跑，别急');
                    } else {
                        toast.info('开始更新世界与角色状态（后台跑，不挡你聊天）');
                    }
                    rerender();
                    break;
                }
                case 'cancel-update':
                    cancelUpdate();
                    toast.warn('已请求取消：跑完当前这一小步就停');
                    rerender();
                    break;
                case 'open-workspace-btn': {
                    /* ★ 依据＝阿砚 17 号 §一-1：抽屉里那颗入口 ⇒ 打开工作台 */
                    Promise.resolve()
                        .then(() => import('./workspace.js'))
                        .then((m) => { if (m && typeof m.openWorkspace === 'function') { m.openWorkspace(); } })
                        .catch(() => { });
                    break;
                }
                case 'rollback-to': {
                    const okRb = rollbackToSnapshot(Number(id));
                    if (okRb && okRb.ok) {
                        toast.info('已恢复到：' + String(okRb.label || '那份快照'));
                        rerender();
                    } else {
                        toast.warn('这份快照恢复不了');
                    }
                    break;
                }
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
                case 'accept-overlay': {
                    /* 硬-6：采用引擎那一版（锁不解除） */
                    const partsA = String(id).split('|');
                    const rA = acceptOverlay(partsA[0], partsA[1]);
                    if (rA.ok) {
                        toast.ok('已采用：' + String(rA.field) + ' → ' + String(rA.value).slice(0, 40));
                        rerender();
                    } else {
                        toast.bad('没采用成：' + String(rA.reason || '没有这条待定'));
                    }
                    break;
                }
                case 'dismiss-overlay': {
                    const partsD = String(id).split('|');
                    const rD = dismissOverlay(partsD[0], partsD[1]);
                    if (rD.ok) {
                        toast.info('已丢掉这条待定（锁照旧）');
                        rerender();
                    } else {
                        toast.bad('丢不掉：可能已经不在了');
                    }
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
                    /*
                     * ⭐ 第 3 条：把"补最近几楼"读出来传进去；留空＝全部（老行为）。
                     *   ⭐ 第 4 条：toast 里**直接说清这次补的范围**（不用她再翻到状态页）。
                     */
                    const rawN = trimText((byId(host, 'wxg-backfill-n') || {}).value || '');
                    const lim = Number.parseInt(rawN, 10);
                    const useLim = Number.isFinite(lim) && lim > 0 ? lim : 0;
                    const rB = runBackfill(useLim ? { limit: useLim } : {});
                    if (rB && typeof rB.then === 'function') {
                        rB.then((res) => {
                            if (res && res.ok === false) {
                                toast.warn(res.reason || '正在跑，别急');
                                /*
                                 * ⭐她最实用的那条路（少量多次）也该会自救 ✓
                                 *   链路级失败 ⇒ **自己再接着补**（20 秒、45 秒 ✓）⛔ 她守着点 ✗
                                 */
                                if (/ECONNRESET|Failed to fetch|ETIMEDOUT|socket hang up|超时|没回|null|怪东西/i.test(String(res.reason || ''))) {
                                    /* ⭐ 她可调：链路掉线后自己再试几次（默认 2 ✓） */
                                    let autoMax = 2;
                                    try { const an = Number((getSettings().api || {}).autoRetryMax); if (Number.isFinite(an)) { autoMax = Math.max(0, Math.min(5, Math.round(an))); } } catch (eAm) { /* ⛔ 影响她 */ }
                                    window.__wxgAutoRetryB = (window.__wxgAutoRetryB || 0) + 1;
                                    if (window.__wxgAutoRetryB <= autoMax) {
                                        const wSec = window.__wxgAutoRetryB === 1 ? 20 : 45;
                                        toast.info('链路掉线 —— ' + String(wSec) + ' 秒后自己接着补（第 ' + String(window.__wxgAutoRetryB) + '/2 次）✓');
                                        setTimeout(() => {
                                            try { runBackfill(useLim ? { limit: useLim } : {}); } catch (eAutoB) { /* ⛔ 影响她 */ }
                                        }, wSec * 1000);
                                    }
                                }
                            } else {
                                window.__wxgAutoRetryB = 0;
                            }
                        }).catch(() => {});
                    } else if (rB && rB.ok === false) {
                        toast.warn(rB.reason || '正在跑，别急');
                        break;
                    }
                    toast.info(useLim
                        ? ('开始补推历史：只补**最近 ' + String(useLim) + ' 楼**（分批跑，可随时取消）')
                        : '开始补推历史：**全部楼层**（分批跑，可随时取消）');
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