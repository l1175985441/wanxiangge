/**
 *
 * 同一套分节既渲染进**独立面板**（ui/shell.js 开的窗口），也渲染进**扩展设置区**里那一块。
 * ⛔ 不各写一套，免得两边长歪。
 * 事件一律**委托**绑在宿主上：每次重画都不丢监听，也不会重复绑。
 */

import { STAGES_CONFLICT, STAGES_PROGRESS, TIERS } from '../core/config.js';
import {  } from './controls-note.js';   /* 六：全展全收；八：开关状态句 */
import { rememberFocus, restoreFocus } from './focus-keep.js';   /* 三：重画后把焦点还回去 */
import {  } from './onecol.js';
import {  } from './status-hero.js';
import {  } from './status-folds.js';
import {  } from './card-fold.js';
import {  } from './tidy-heads.js';   /* 75/77：标题与折叠条去括号（造的当下） */   /* 74/75：卡头三层＋一句话 */   /* 71：两条折叠 */
import { stageProgress, stageTone } from './stage-progress.js';   /* 阶段：数字进度＋徽章调子 */   /* 一：单卡页标记 */
import {  } from './prompt-copy.js';   /* 17-1／17-2：用途副标与变量清单 */
import {  } from './runwarn-view.js';   /* 必修 9：红条画法 */
import {  } from './chron-search.js';   /* A4：编年搜索框 */
import {  } from './esc-close.js';   /* TW 契约：Esc 监听配对清理 */
import {  } from '../core/runwarn.js';   /* 必修 9：拒签要顶到上面（红条） */
import {  } from '../core/timefmt.js';   /* A7／A9：时间人话只留一处 */
import { getChat, currentChatKey, adoptLedgerForImport } from '../core/adapter.js';
import { buildBundle, verifyBundle, importGate } from '../core/bundle.js';
import { getSettings, exportSettings, patchSettings } from '../core/settings.js';
import { shiftWorldClock } from '../core/world-events.js';
import {  } from '../core/schedule.js';
import { loadState, updateCharacter, findCharacter, describeWorld, getChronicle, rollbackLast, exportState, updateQuest, removeQuest, addChronicle, importState, setRole, rollbackToSnapshot, acceptOverlay, dismissOverlay } from '../core/state.js';
import {  } from '../core/preset.js';   /* 4-a E3：提示词预设 */
import {  } from '../core/tally.js';   /* F3：总数要印给她看，⛔ 只写 console */
import {  } from '../core/ledger.js';
import { toList, trimText, asText, asArray } from '../core/utils.js';   /* ★ 20261022：重名拦截用 matchKey，之前没 import ⇒ 永远判不重名 */
import { applyAppearance, palettePatch } from './theme.js';
import {  } from '../core/summary.js';
import {  } from '../core/roster-cols.js';   /* 80：只用来判“身份／势力全空” */
import {  } from './cardgrid.js';   /* A6：卡头＋一句摘要＋查看全部（不搬 DOM） */
import { buildHealthReport } from '../core/health.js';
// ⭐ 版本从 config 取（⛔ 从 index.js import：那会绕成循环 index→sections→index）
import { APP_VERSION, originPanel, agendaOriginPanel } from '../core/config.js';   /* I4 */
import { replanCurrentFloor } from '../core/actions.js';
import { listWorldbookNames, getEntries, excludeTextFor } from '../core/worldbook.js';
// ⭐ 读书 v2：全读进来 → 模型自己分 → 人物→名册、势力／局势→世界状态
import {  } from '../core/book-wiki.js';
import {  } from '../core/wb-channel.js';
import {  } from '../core/clock.js';
import { publishToBook } from '../core/book.js';
import { runUpdate, cancelUpdate, runReconcile } from '../core/pipeline.js';
import { mergeCharacters, autoDetectDuplicates } from '../core/merge.js';   /* 1-b：合并能撤了（本来是死函数） */
import { toast } from './toast.js';
// ⭐ 悬浮小框的显隐要在「总控」里能开关（那颗 ✕ 的提示一直承诺着，但控件一直没做） ⭐ 复审追加 3②：保存外观段后要**即时**刷小框（⛔ 等下次切档）
import { mountMini, closeMini, refreshMini } from './mini.js';
import { takeSnapshot } from '../core/state.js';
import { deleteLedgerRow } from './ledgers.js';
import { saveLayerLimits } from './layer-limits.js';
import {  } from './panels/roster.js';
import {  } from './panels/status.js';
import {  } from './panels/report.js';
import {  } from './panels/steps.js';
import {  } from './panels/world.js';
import {  } from './panels/hidden.js';
import {  } from './panels/brief.js';
import {  } from './panels/chronicle.js';
import {  } from './panels/settings.js';
import {  } from './panels/general.js';
import {  } from './panels/appearance.js';
import {  } from './panels/recall.js';
import {  } from './panels/extract.js';
import {  } from './panels/api.js';
import {  } from './panels/prompts.js';
import { fillText, el, emptyBlock, heroEmpty, section, card, setSectionSummary, field, row, line, checkbox, colorInput, textInput, numberInput, textarea, button, select, foldOpenState, foldable } from './panels/shared.js';
import { PER_PAGE, pager, clampPage, kindTone, shortTime } from './panels/shared.js';
import { stage, stagedValue, saveBar, stagingOf, modeForSection, stagingMode, setStagingMode, WXG_DBG } from './panels/shared.js';
import { rosterFilter, openChar, rosterSortDir, openRecordAt, setChronFilter, setChronPage, setStepPage, setRosterPage, setReportFilter, setStepFilter, setRosterFilter, setRosterSearch, setOpenChar, setRosterSortDir, setOpenRecordAt, setChronSearch } from './panels/shared.js';
import { effectiveAppearance, booksCache, setListBooksCache, lastGoodBooks, setLastGoodBooks } from './panels/shared.js';
import { unlockedCards } from './panels/shared.js';
import {  } from './panels/shared.js';
import { lastSectionsHost, setLastSectionsHost, bindPersonCardDrag, paintBookPicks } from './panels/shared.js';
import { jumpToSection } from './panels/nav.js';
import { pickBook, setPickBook } from './panels/locks.js';
import { renderSections as renderSectionsCore } from './panels/render.js';
import { byId } from './panels/render.js';
import { textOf, readFromBook, copyToClipboard, downloadText, renderEntryPick } from './panels/render.js';
import { personCardId, renderPersonCard, unbindPersonCardEsc, PERSON_CARD_EDIT_ACTIONS, handlePersonCardEdit, PERSON_CARD_UI_ACTIONS, handlePersonCardUi } from './panels/person-card.js';
import { handleRosterAction, ROSTER_ACTION_SET } from './panels/roster-actions.js';
import { handleWorldAction, WORLD_ACTION_SET, handleSituationAction, SITUATION_ACTION_SET, handleFactionAction, FACTION_ACTION_SET } from './panels/world-actions.js';
import { handleChronicleAction, CHRONICLE_ACTION_SET } from './panels/chronicle-actions.js';
import { handleApiAction, API_ACTION_SET } from './panels/api-actions.js';
import { handlePromptAction, PROMPT_ACTION_SET } from './panels/prompt-actions.js';
import { handleSettingsAction, SETTINGS_ACTION_SET } from './panels/settings-actions.js';
import { syncApiFromDom, API_KEYS } from './panels/api-sync.js';

export { unbindPersonCardEsc } from './panels/person-card.js';




export { jumpToSection } from './panels/nav.js';







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
export let pickEntries = [];
/** 读到的世界书名单（画小块用，⛔ 不反复读世界书） */

/* ⭐ RD1-3（材料 11）：**拉过的模型列表要存下来** ✓（旧：直接塞 DOM，重绘变空盒 ✗） */

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

/** 每页几条（名册 20＝差不多一屏；编年 30＝够看一段） */



/**
 * ⭐ 外观：我们自己的配色（工作台是自己的地盘，不必迁就酒馆主题）
 * 预设色板 + 四个槽位可单独改；文字色留空＝按底面亮度自动算。
 */





/* ---------------------------------------------------------------------------
   ⭐ 只读默认 ＋ 「编辑」（复核方第四条：不点是只读，改不了，免得弄错）
   --------------------------------------------------------------------------- */

/** 现在开着编辑的数据卡（键是卡名；⛔ 不落设置——「正在编辑」不是一种设置） */

/**
 * 把一张数据卡做成「只读默认」：锁着的时候看着就是文字，不是一堆空框。
 *
 * @param {Element} cardEl 卡（就是 card() 返回的那个）
 * @param {string} key 卡名（同一页里唯一即可）
 */

/**
 * 把「锁着的卡」里的字段真正设成只读（在整页 DOM 建完之后调）。
 * ⏐ 不能只靠 CSS：样式挡不住键盘输入和脚本赋值。
 * ⏐ 也不锁控制项（开关／颜色）——那些本来就是拿来点的。
 */

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
/* ⭐ B8（材料 13）：当前正在选“并进哪一位”的角色 id（⛔ 再弹 window.prompt ✗） */
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

/** 拖标题栏移浮层（做法跟 mini.js 那套一致：⛔ 不引库） */


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
    const o = Object.assign({}, opts, { hooks: {
        renderWorldEntryCard, renderHealthCard, renderPersonCard,
        getOpenWorldEntry: () => openWorldEntry,
        getHealthOpen: () => healthOpen,
        getPersonCardId: () => personCardId,
    } });
    return renderSectionsCore(host, o);
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
            setLastSectionsHost(host);
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
        setStagingMode((host && typeof host.getAttribute === 'function' && host.getAttribute('data-wxg-mode')) || 'settings');
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
            if (PERSON_CARD_EDIT_ACTIONS.has(action)) {
                handlePersonCardEdit(action, target, id, key, isChange, rerender);
                return;
            }
            if (PERSON_CARD_UI_ACTIONS.has(action)) {
                handlePersonCardUi(action, target, id, rerender);
                return;
            }
            if (ROSTER_ACTION_SET.has(action)) {
                handleRosterAction(action, target, id, host, rerender);
                return;
            }
            if (WORLD_ACTION_SET.has(action)) {
                handleWorldAction(action, target, id, host, isChange, rerender);
                return;
            }
            if (SITUATION_ACTION_SET.has(action)) {
                handleSituationAction(action, target, id, host, isChange, rerender);
                return;
            }
            if (FACTION_ACTION_SET.has(action)) {
                handleFactionAction(action, target, id, rerender);
                return;
            }
            if (CHRONICLE_ACTION_SET.has(action)) {
                await handleChronicleAction(action, target, rerender);
                return;
            }
            if (API_ACTION_SET.has(action)) {
                await handleApiAction(action, target, id, host, isChange, rerender);
                return;
            }
            if (PROMPT_ACTION_SET.has(action)) {
                handlePromptAction(action, target, id, host, isChange, rerender);
                return;
            }
            if (SETTINGS_ACTION_SET.has(action)) {
                handleSettingsAction(action, target, id, host, isChange, rerender);
                return;
            }
            switch (action) {
                /* ---- 总控 ---- */
                /*
                 * ⚠️ v0.3.257 我在这里加过一条“已存”回执 ✗
                 *   但真机核对发现：界面上挂的是 `stage-update-every`（走草稿）✓
                 *   ⇒ 这个 `set-update-every` **永远不会被执行** ✗ ⇒ 那句回执从未生效 ✗
                 *   现在：删掉（它本就是我自己加的 ✓），不留误导代码 ✓
                 */
                /* ⭐ ST4（材料 11）：补推范围这格早就写了 data-action，但**没接上** ⇒ 填了也存不住 ✗ */
                case 'chron-filter': {
                    setChronFilter(trimText(id) || 'all');
                    setChronPage(1); // ⚠️ 换了筛选要回第一页（不然可能停在一个空页上）
                    rerender();
                    break;
                }
                case 'report-filter': {
                    setReportFilter(trimText(id) || 'all');
                    rerender();
                    break;
                }
                case 'step-filter': {
                    setStepFilter(trimText(id) || 'all');
                    setStepPage(1);
                    rerender();
                    break;
                }
                case 'step-page': {
                    setStepPage(Math.max(1, Math.round(Number(id) || 1)));
                    rerender();
                    break;
                }
                case 'roster-filter': {
                    /* ★ R62：点已选中的创建/修改时间 ⇒ 切正反序 ✓ */
                    const wantR = trimText(id) || 'all';
                    if (wantR === rosterFilter && (wantR === 'created' || wantR === 'changed' || wantR === 'name')) {
                        setRosterSortDir(rosterSortDir === 'desc' ? 'asc' : 'desc');
                    } else {
                        setRosterFilter(wantR);
                        setRosterSortDir(wantR === 'name' ? 'asc' : 'desc');
                    }
                    setRosterPage(1); // 同上
                    rerender();
                    break;
                }
                case 'open-record':
                    setOpenRecordAt(Math.max(0, Math.round(Number(id) || 0)));
                    rerender();
                    break;
                case 'record-close':
                    setOpenRecordAt(-1);
                    rerender();
                    break;
                case 'record-prev':
                case 'record-next':
                    if (openRecordAt >= 0) {
                        setOpenRecordAt(action === 'record-next' ? openRecordAt + 1 : openRecordAt - 1);
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
                    setChronSearch(trimText(target.value));
                    setChronPage(1);
                    rerender();
                }
                break;
            case 'roster-search':
                    if (isChange) {
                        setRosterSearch(trimText(target.value));
                        setRosterPage(1);
                        rerender();
                    }
                    break;
                case 'roster-page': {
                    setRosterPage(Math.max(1, Math.round(Number(id) || 1)));
                    rerender();
                    break;
                }
                case 'chron-page': {
                    setChronPage(Math.max(1, Math.round(Number(id) || 1)));
                    rerender();
                    break;
                }
                /*
                 * ⭐ 名册点一行 ⇒ **开浮层**（她 2026-10-14 点名：⛔ 行内展开把表格推下去）。
                 *    旧的行内编辑器（case 'edit-char' 那段）**先留着**：
                 *    等浮层距离验收了再说，⛔ 一步到位地把能用的东西换掉。
                 */
                case 'edit-char': {
                    setOpenChar(String(openChar) === String(id) ? '' : String(id));
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
                /* ---- 角色 ---- */
    /*
     * ⭐「清空这个世界」三步：铺开条数 → 她手打「确认清空」→ 才真清。
     *    ⛔ 打错字点不动；⛔ 只清账本，不碰世界书；⛔ 不静默（清完给回执）。
     */
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
                            setListBooksCache(lastGoodBooks.slice());
                            try { paintBookPicks(host); } catch (eKeep) { }
                            if (info) {
                                info.textContent = '**读不到新的**世界书列表，先用上次读到的 ' + String(lastGoodBooks.length) + ' 本（⛔ 当成“一本都没有”）。';
                            }
                            break;
                        }
                        setListBooksCache([]);
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
                    setListBooksCache(names);
                    setLastGoodBooks(names.slice());
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
                    setPickBook(trimText(name));
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
                /* ---- 提示词 ---- */
    case 'shift-world-clock': {
        const sd = Number(target.id);
        if (shiftWorldClock(sd)) { toast.ok('世界钟拨了 ' + (sd > 0 ? '+' : '') + String(sd) + ' 天'); rerender(); }
        break;
    }
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
