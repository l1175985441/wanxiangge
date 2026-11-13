/**
 *
 * 同一套分节既渲染进**独立面板**（ui/shell.js 开的窗口），也渲染进**扩展设置区**里那一块。
 * ⛔ 不各写一套，免得两边长歪。
 * 事件一律**委托**绑在宿主上：每次重画都不丢监听，也不会重复绑。
 */

import { STAGES_CONFLICT, STAGES_PROGRESS, TIERS, ROSTER_PRESET } from '../core/config.js';
import {  } from './controls-note.js';   /* 六：全展全收；八：开关状态句 */
import { rememberFocus, restoreFocus } from './focus-keep.js';   /* 三：重画后把焦点还回去 */
import { markOneCol } from './onecol.js';
import {  } from './status-hero.js';
import {  } from './status-folds.js';
import {  } from './card-fold.js';
import { tidyHeadings } from './tidy-heads.js';   /* 75/77：标题与折叠条去括号（造的当下） */   /* 74/75：卡头三层＋一句话 */   /* 71：两条折叠 */
import { stageProgress, stageTone } from './stage-progress.js';   /* 阶段：数字进度＋徽章调子 */   /* 一：单卡页标记 */
import {  } from './prompt-copy.js';   /* 17-1／17-2：用途副标与变量清单 */
import {  } from './runwarn-view.js';   /* 必修 9：红条画法 */
import {  } from './chron-search.js';   /* A4：编年搜索框 */
import { bindEscClose, unbindEscClose } from './esc-close.js';   /* TW 契约：Esc 监听配对清理 */
import {  } from '../core/runwarn.js';   /* 必修 9：拒签要顶到上面（红条） */
import {  } from '../core/timefmt.js';   /* A7／A9：时间人话只留一处 */
import { getChat, currentChatKey, adoptLedgerForImport } from '../core/adapter.js';
import { buildBundle, verifyBundle, importGate } from '../core/bundle.js';
import { getSettings, patchSettings, effectivePrompt, setAllPromptsDefault, exportSettings } from '../core/settings.js';
import { shiftWorldClock } from '../core/world-events.js';
import { scheduleBadge } from '../core/schedule.js';
import { getRoster, loadState, saveState, addCharacter, addCharacters, removeCharacter, updateCharacter, findCharacterByName, findCharacter, applyRosterPreset, describeWorld, getChronicle, removeHidden, addHiddenManually, rollbackLast, exportState, updateWorld, updateQuest, removeQuest, addChronicle, removeChronicleAt, clearChronicle, clearWorldLedger, addKnow, removeKnow, importState, pushPast, ROLES, setRole, rollbackToSnapshot, acceptOverlay, dismissOverlay, removeFaction, upsertFaction } from '../core/state.js';
import { createCache } from '../core/cache.js';   /* B7：缓存坏了，⛔ 当成“没有” */
import { listPresets, buildPreset, planApply, exportPresets, importPresets } from '../core/preset.js';   /* 4-a E3：提示词预设 */
import {  } from '../core/tally.js';   /* F3：总数要印给她看，⛔ 只写 console */
import {  } from '../core/ledger.js';
import { toList, trimText, asText, asArray, floorLabel, matchKey } from '../core/utils.js';   /* ★ 20261022：重名拦截用 matchKey，之前没 import ⇒ 永远判不重名 */
import { applyAppearance, palettePatch } from './theme.js';
import { questStats } from '../core/summary.js';
import {  } from '../core/roster-cols.js';   /* 80：只用来判“身份／势力全空” */
import {  } from './cardgrid.js';   /* A6：卡头＋一句摘要＋查看全部（不搬 DOM） */
import { buildHealthReport } from '../core/health.js';
// ⭐ 版本从 config 取（⛔ 从 index.js import：那会绕成循环 index→sections→index）
import { APP_VERSION, originPanel, agendaOriginPanel } from '../core/config.js';   /* I4 */
import { replanCurrentFloor } from '../core/actions.js';
import { listWorldbookNames, getEntries, excludeTextFor } from '../core/worldbook.js';
// ⭐ 读书 v2：全读进来 → 模型自己分 → 人物→名册、势力／局势→世界状态
import { importBookWiki } from '../core/book-wiki.js';
import {  } from '../core/wb-channel.js';
import { clockWentBackwards, dueToAbsoluteMinute } from '../core/clock.js';
import { publishToBook } from '../core/book.js';
import { runUpdate, cancelUpdate, runReconcile } from '../core/pipeline.js';
import { mergeCharacters, autoDetectDuplicates, undoLastMerge } from '../core/merge.js';   /* 1-b：合并能撤了（本来是死函数） */
import { toast } from './toast.js';
// ⭐ 悬浮小框的显隐要在「总控」里能开关（那颗 ✕ 的提示一直承诺着，但控件一直没做） ⭐ 复审追加 3②：保存外观段后要**即时**刷小框（⛔ 等下次切档）
import { mountMini, closeMini, refreshMini } from './mini.js';
import { takeSnapshot } from '../core/state.js';
import { mountLedgers, deleteLedgerRow } from './ledgers.js';
import { saveLayerLimits } from './layer-limits.js';
import { secRoster } from './panels/roster.js';
import { secStatus } from './panels/status.js';
import {  } from './panels/report.js';
import {  } from './panels/steps.js';
import { secWorld } from './panels/world.js';
import { secHidden } from './panels/hidden.js';
import { secBrief } from './panels/brief.js';
import { secChronicle } from './panels/chronicle.js';
import { secSettings } from './panels/settings.js';
import {  } from './panels/general.js';
import {  } from './panels/appearance.js';
import {  } from './panels/recall.js';
import {  } from './panels/extract.js';
import { secApi } from './panels/api.js';
import { secPrompts } from './panels/prompts.js';
import { fillText, el, emptyBlock, heroEmpty, section, card, setSectionSummary, field, row, line, checkbox, colorInput, textInput, numberInput, textarea, button, select, foldOpenState, foldable } from './panels/shared.js';
import { PER_PAGE, pager, clampPage, kindTone, shortTime } from './panels/shared.js';
export { PER_PAGE, pager, clampPage, kindTone, shortTime } from './panels/shared.js';

export { fillText, el, emptyBlock, heroEmpty, section, card, setSectionSummary, field, row, line, checkbox, colorInput, textInput, numberInput, textarea, button, select, foldOpenState, foldable } from './panels/shared.js';

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


/* ------------------------------ 分节 ------------------------------ */


/**
 * 总控：只放"整台怎么跑"的开关。
 * ⚠️ 原来这里第一个是「启用万象阁」——**冗余**（她点出来的）：酒馆扩展列表里勾上了，
 *    插件就是启用的；再放一个总闸＝两个开关管同一件事，关哪个都容易搞混。⇒ **去掉**。
 *    想停就在酒馆的扩展列表里关它。
 * 卡片那两个开关搬到「召回」段（那是卡片自己的事），这里只留"更新"有关的。
 */

/**
 * 暗线阶段 → 胶囊样式（走的是"阶段"这条线：萌芽最早、消散/完成收尾）。
 * ⛔ 按语义分档，不按颜色名——以后加阶段也不用改这里。
 */



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
export function stage(secId, key, value) {
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
export function stagedValue(secId, key, fallback) {
    const box = stagingOf(modeForSection(secId))[secId];
    return box && Object.prototype.hasOwnProperty.call(box, key) ? box[key] : fallback;
}

/**
 * 段底那条"保存"（每段都有）。
 * @param {string} secId 段的标识（见各段自己的 id）
 * @param {string} label 按钮文字（默认"保存"）
 */
export function saveBar(secId, label) {
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
export function effectiveAppearance() {
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
export const booksCache = createCache('worldbooks');   /* B7：带状态的缓存（hit/miss/empty/broken） */
export let listBooksCache = [];   /* 兼容：老代码读它；新代码读 booksCache */
let lastGoodBooks = [];   /* 上一次真读到的书单（读不到时用它先顶着，⛔ 把列表清空） */
/* 依据＝本轮查“首跑红复跑绿”：自动列书的 setTimeout 每次重画都排一个 ⇒ 旧定时器晚到也去点按钮，把列表反复刷新 */
export let autoListTimer = null;
export function setAutoListTimer(v) { autoListTimer = v; }

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
export let chronFilter = 'all';
export function setChronFilter(v) { chronFilter = v; }
/*
 * 依据＝阿砚第三批 质感 A4（编年没有搜索）：编年越攒越多，只能靠翻页找。
 *   加一个搜索词（搜正文／类型／人）；⛔ 落设置，只是“看的姿势”。
 */
export let chronSearch = '';
/**
 * ⭐「清空这个世界」的确认盒开着没有。
 * 她拍的：不可逆操作要**写明条数** ＋ **手打「确认清空」**才让点（防误点）。
 */
export let clearWorldOpen = false;
/** ⭐ 她 13:xx：钥匙默认遮住；点了「显示」就记住（模块级！⛔ 放进函数里 handler 看不见 ✗） */
export let apiKeyShown = false;
/** 要她手打的那四个字（打错就点不动） */
export const CLEAR_WORD = '确认清空';
/** 哪一条局势正展开着编辑（-1＝都没展开；行化之后默认收起，⛔ 不再一条占两行） */
let openSituation = -1;

/** 过程报告的筛选（那一排小胶囊）：全部／已注入／未注入／失败 */
export let reportFilter = 'all';

/** 现在的进度的筛选：全部／已做／还没做 */
export let stepFilter = 'all';
export let stepPage = 1;
export function setStepPage(v) { stepPage = v; }

/** 名册的筛选：全部／玩家棋子／新认的／我改过的 */
export let rosterFilter = 'all';

    /** 名册的搜索词（搜“名字或别名”；⛔ 落设置，只是看的姿势） */
    export let rosterSearch = '';

/** 名册里哪一个人正展开着编辑（''＝都没展开） */
export let openChar = '';

/** 名册/编年的翻页（第几页从 1 数；⛔ 不落设置，只是看的姿势） */
export let rosterPage = 1;
export function setRosterPage(v) { rosterPage = v; }
export let chronPage = 1;
export function setChronPage(v) { chronPage = v; }

/** 每页几条（名册 20＝差不多一屏；编年 30＝够看一段） */



/**
 * ⭐ 外观：我们自己的配色（工作台是自己的地盘，不必迁就酒馆主题）
 * 预设色板 + 四个槽位可单独改；文字色留空＝按底面亮度自动算。
 */





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
export function lockable(cardEl, key) {
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
export function hostOf(url) {
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

/**
 * 每轮记录（原「过程报告」）。同上：给了容器就摆进去，自己不开页。
 */

/**
 * 进度那一整块。
 * @param {object} host 宿主（只在需要自开一页时用）
 * @param {object} [intoBox] 给了就往这个盒子里摆（（三页并一页就是走这条），⏐ 不再开新页
 */

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
let personCardTab = 'now';

/**
 * ⭐ 「每轮记录」点开的是第几条（-1＝都没开）。
 *   照目标包：点行弹浮层，**跟名册那件同一套手法**（⛔ 行内展开）。
 */
export let openRecordAt = -1;

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
    personCardTab = 'now';
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
        const shown = f2 === 'identity'
            ? ((Array.isArray(one.identities) && one.identities.length) ? one.identities.join('；') : one[f2])
            : (f2 === 'affinity'
                ? (function () { const r = ((loadState().affinityTable) || []).filter((x) => x && x.name === one.name)[0]; return (r && trimText(r.affinity)) || one[f2]; })()
                : one[f2]);
        kv.appendChild(fieldBox(cid, f2, shown, ph2));
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
        kv.appendChild(el('div', 'wxg-pc-k', '档位'));
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
    kv.appendChild(el('div', 'wxg-pc-k', '当前地点'));
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
    {
    const sSec = el('div', 'wxg-pc-sec');
    sSec.appendChild(el('div', 'wxg-pc-sech', '日程（约好的事）'));
        if (Array.isArray(one.schedule) && one.schedule.length) {
        for (const s of one.schedule) {
            const sr = el('div', 'wxg-rowitem');
            const sh = el('div', 'wxg-rowname');
            sh.appendChild(el('span', 'wxg-name', trimText(s && (s.what || s.text)) || '（没记名）'));
            if (trimText(s && s.due)) {
                sh.appendChild(el('span', 'wxg-badge wxg-badge-soft', trimText(s.due)));
                if (trimText(s && s.due) && !Number.isFinite(s && s.dueMinute)) {
                    sh.appendChild(el('span', 'wxg-badge is-soft', '没定时间'));
                }
            }
            if (s && s.done === true) {
                sh.appendChild(el('span', 'wxg-badge is-off', '已完成'));
            } else {
                /* 146：日程徽章跟注入同一颗判据（scheduleBadge） */
                const badge = trimText(scheduleBadge(s, Number((loadState().world || {}).clockMinute)));
                if (badge) {
                    sh.appendChild(el('span', 'wxg-badge is-warn', badge.replace(/^【/, '').replace(/】$/, '').replace(/^(?:⚠️|⛔)\s*/, '')));
                }
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
        } else {
            sSec.appendChild(el('div', 'wxg-fact', '还没有约好的事'));
        }
        /* 130-7：添一条日程（仅编辑态） */
        if (personCardEditing) {
            const addRow = el('div', 'wxg-row');
            addRow.appendChild(textInput('wxg-new-sched-what-' + String(cid), '', '约好的事', 'noop', 'wxg-short'));
            addRow.appendChild(textInput('wxg-new-sched-due-' + String(cid), '', '什么时候到点', 'noop', 'wxg-short'));
            addRow.appendChild(button('加一条', 'add-sched', 'wxg-btn-xs', String(cid)));
            sSec.appendChild(addRow);
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
        qSec.appendChild(el('div', 'wxg-pc-sech', '任务（在追的目标）　共 '
            + String(Number(qStat.main) + Number(qStat.side)) + ' 个'
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
    /* 191/192：把已有内容按三页分装；字段生成逻辑一行没改，只搬家 */
    const kvBox = pop.querySelector('.wxg-pc-kv');
    const sec1Box = kvBox ? kvBox.closest('.wxg-pc-sec') : null;
    const whoAlias = pop.querySelector('.wxg-pc-alias');
    if (whoAlias) { whoAlias.remove(); }
    const pages = el('div', 'wxg-pc-pages');
    const pageEl = (key) => { const d = el('div', 'wxg-pc-page'); d.setAttribute('data-page', key); d.style.display = (personCardTab === key ? '' : 'none'); pages.appendChild(d); return d; };
    const pNow = pageEl('now');
    const pFile = pageEl('file');
    const pEdge = pageEl('edge');
    const hkv = el('div', 'wxg-pc-headkv');
    const addPair = (host, a, b) => { host.appendChild(a); if (b) { host.appendChild(b); } };
    if (kvBox) {
        /* ⚠️ 技术债：靠 label 文字匹配搬家，改标签名会让该项落进兜底（此刻页）并 warn。
         *    以后重构成"渲染时直接按页构造"，⛔ 再靠文字匹配。 */
        const kids = Array.from(kvBox.children);
        for (let i = 0; i < kids.length; i += 1) {
            const k = kids[i];
            if (!k || !k.classList || !k.classList.contains('wxg-pc-k')) { continue; }
            const v = kids[i + 1];
            const label = trimText(k.textContent);
            const isPlayerBox = v && v.querySelector && v.querySelector('[data-action="set-player"]');
            const isBenchBox = v && v.querySelector && v.querySelector('[data-action="set-bench"]');
            if (label === '\u59d3\u540d') { addPair(hkv, k, v); i += 1; continue; }
            if (label === '\u5f53\u524d\u5730\u70b9' || label === '\u522b\u540d') { addPair(hkv, k, v); i += 1; continue; }
            if (label === '\u5e74\u9f84' || label === '\u8eab\u4efd' || label === '\u6240\u5728\u52bf\u529b' || label === '\u597d\u611f') {
                addPair(label === '\u597d\u611f' ? pNow : pFile, k, v); i += 1; continue;
            }
            if (label.indexOf('\u6863\u4f4d') === 0) { k.textContent = '\u6863\u4f4d'; addPair(pFile, k, v); i += 1; continue; }
            if (label.indexOf('\u8ba4\u77e5\u8d26') === 0 || label.indexOf('\u77e5\u8bc6\u9762') === 0) { addPair(pEdge, k, v); i += 1; continue; }
            if (label === '\u6b63\u5728\u7ecf\u5386') { addPair(pNow, k, v); i += 1; continue; }
            if (label === '' && (isPlayerBox || isBenchBox)) { if (v) { pFile.appendChild(v); } i += 1; continue; }
            /* 兜底：没被任何分支接住的格子 ⇒ 此刻页，⛔ 静默丢 */
            pNow.appendChild(k);
            if (v) { pNow.appendChild(v); }
            i += 1;
            try { console.warn('[万象阁] 浮层分页未匹配项：' + (label || '（空标签）')); } catch (eW) { /* warn 不能拦着渲染 */ }
        }
    }
    if (sec1Box) { sec1Box.remove(); }
    const secs = Array.from(pop.querySelectorAll(':scope > .wxg-pc-sec'));
    let taskSec = null;
    for (const sec of secs) {
        const h = sec.querySelector('.wxg-pc-sech');
        const ht = trimText(h && h.textContent);
        if (ht.indexOf('\u4efb\u52a1') === 0) { taskSec = sec; continue; }
        if (ht.indexOf('\u8fc7\u53bb\u7ecf\u5386') === 0) { pNow.appendChild(el('div', 'wxg-pc-k', '\u8fc7\u53bb\u7ecf\u5386')); pNow.appendChild(sec); continue; }
        if (ht.indexOf('\u65e5\u7a0b') === 0) { pNow.appendChild(el('div', 'wxg-pc-k', '\u65e5\u7a0b')); pNow.appendChild(sec); continue; }
        if (ht.indexOf('\u4ed6\u77e5\u9053\u4ec0\u4e48') === 0) { pEdge.appendChild(sec); continue; }
        if (!h && String(sec.textContent).indexOf('\u4e0d\u53ef\u9760') >= 0) { pNow.appendChild(sec); continue; }
    }
    /* 卡头：姓名／当前地点／别名 三个字段标签 */
    const nameK = el('div', 'wxg-pc-k', '\u59d3\u540d');
    hkv.insertBefore(nameK, hkv.firstChild);
    hkv.insertBefore(el('span', 'wxg-pc-hv', String(c.name || '\uff08\u6ca1\u540d\u5b57\uff09')), nameK.nextSibling);
    head.appendChild(hkv);
    head.style.position = 'sticky';
    head.style.top = '0';
    head.style.zIndex = '6';
    const tabs = el('div', 'wxg-pc-tabs');
    for (const [key, label] of [['now', '\u6b64\u523b'], ['file', '\u6863\u6848'], ['edge', '\u8fb9\u754c']]) {
        const b = button(label, 'pc-tab', 'wxg-pc-tab' + (personCardTab === key ? ' is-on' : ''));
        b.setAttribute('data-page', key);
        tabs.appendChild(b);
    }
    head.parentNode.insertBefore(tabs, head.nextSibling);
    tabs.parentNode.insertBefore(pages, tabs.nextSibling);
    if (taskSec) { pop.appendChild(taskSec); }
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
export function renderRecordCard(rec, body, idx, total, statusText, tone, shownChars) {
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
secRoster(stageEl);
secStatus(stageEl);
secWorld(stageEl);
secHidden(stageEl);
secBrief(stageEl);
secChronicle(stageEl);
mountLedgers(stageEl);
secSettings(stageEl);
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
export function paintModelChips(boxEl) {
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
                case 'pc-tab': {
                    personCardTab = target.getAttribute('data-page') || 'now';
                    renderPersonCard();
                    break;
                }
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
                case 'add-sched': {
        const whatN = trimText((document.getElementById('wxg-new-sched-what-' + String(id)) || {}).value);
        const dueN = trimText((document.getElementById('wxg-new-sched-due-' + String(id)) || {}).value);
        if (!whatN) { toast.ok('先写约好的事'); break; }
        const cN = findCharacter(id);
        if (cN) {
            const dueAbsN = dueN ? dueToAbsoluteMinute(dueN, Number((loadState().world || {}).clockMinute)) : null;
            const nextN = (Array.isArray(cN.schedule) ? cN.schedule : []).concat([{ what: whatN, due: dueN, done: false, dueReached: false, dueMinute: dueAbsN, originDueMinute: dueAbsN, sinceMinutes: Number((loadState().world || {}).clockMinute), firedPoints: [] }]);
            updateCharacter(id, { schedule: nextN });
            toast.ok('加了一条日程');
            rerender();
        }
        break;
    }
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
    case 'add-faction': { const nm = window.prompt('新增势力：名字'); if (nm && trimText(nm)) { const f = upsertFaction({ name: trimText(nm), manual: true }); if (f) { openFactionEditor(f.id, rerender); } } break; }
        case 'edit-faction': openFactionEditor(target.getAttribute('data-id') || target.id, rerender); break;
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
                case 'toggle-layer-prompts': {
        patchSettings({ layerPrompts: target.checked === true });
        rerender();
        break;
    }
    case 'shift-world-clock': {
        const sd = Number(target.id);
        if (shiftWorldClock(sd)) { toast.ok('世界钟拨了 ' + (sd > 0 ? '+' : '') + String(sd) + ' 天'); rerender(); }
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



/** 181 / 5-C\uff1a\u52bf\u529b\u7f16\u8f91\u5f39\u5c42\uff08\u516b\u9879 + \u6210\u5458\uff09 */
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
