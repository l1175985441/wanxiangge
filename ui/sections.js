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
import { getChat } from '../core/adapter.js';
import {  } from '../core/bundle.js';
import { getSettings, patchSettings } from '../core/settings.js';
import { shiftWorldClock } from '../core/world-events.js';
import {  } from '../core/schedule.js';
import { loadState, describeWorld, getChronicle, setRole } from '../core/state.js';
import {  } from '../core/preset.js';   /* 4-a E3：提示词预设 */
import {  } from '../core/tally.js';   /* F3：总数要印给她看，⛔ 只写 console */
import {  } from '../core/ledger.js';
import { trimText, asText, asArray } from '../core/utils.js';   /* ★ 20261022：重名拦截用 matchKey，之前没 import ⇒ 永远判不重名 */
import { palettePatch } from './theme.js';
import {  } from '../core/summary.js';
import {  } from '../core/roster-cols.js';   /* 80：只用来判“身份／势力全空” */
import {  } from './cardgrid.js';   /* A6：卡头＋一句摘要＋查看全部（不搬 DOM） */
import { buildHealthReport } from '../core/health.js';
// ⭐ 版本从 config 取（⛔ 从 index.js import：那会绕成循环 index→sections→index）
import { APP_VERSION, originPanel, agendaOriginPanel } from '../core/config.js';   /* I4 */
import {  } from '../core/actions.js';
import {  } from '../core/worldbook.js';
// ⭐ 读书 v2：全读进来 → 模型自己分 → 人物→名册、势力／局势→世界状态
import {  } from '../core/book-wiki.js';
import {  } from '../core/wb-channel.js';
import {  } from '../core/clock.js';
import {  } from '../core/book.js';
import {  } from '../core/pipeline.js';
import {  } from '../core/merge.js';   /* 1-b：合并能撤了（本来是死函数） */
import { toast } from './toast.js';
// ⭐ 悬浮小框的显隐要在「总控」里能开关（那颗 ✕ 的提示一直承诺着，但控件一直没做） ⭐ 复审追加 3②：保存外观段后要**即时**刷小框（⛔ 等下次切档）
import {  } from './ledgers.js';
import {  } from './layer-limits.js';
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
import { stage, stagingOf, stagingMode, setStagingMode } from './panels/shared.js';
import { openChar, openRecordAt, setOpenChar, setOpenRecordAt } from './panels/shared.js';
import { effectiveAppearance } from './panels/shared.js';
import { unlockedCards } from './panels/shared.js';
import {  } from './panels/shared.js';
import { lastSectionsHost, setLastSectionsHost, bindPersonCardDrag } from './panels/shared.js';
import { jumpToSection } from './panels/nav.js';
import {  } from './panels/locks.js';
import { renderSections as renderSectionsCore } from './panels/render.js';
import {  } from './panels/entry-state.js';
import {  } from './panels/render.js';
import {  } from './panels/render.js';
import { personCardId, renderPersonCard, unbindPersonCardEsc, PERSON_CARD_EDIT_ACTIONS, handlePersonCardEdit, PERSON_CARD_UI_ACTIONS, handlePersonCardUi } from './panels/person-card.js';
import { handleRosterAction, ROSTER_ACTION_SET } from './panels/roster-actions.js';
import { handleWorldAction, WORLD_ACTION_SET, handleSituationAction, SITUATION_ACTION_SET, handleFactionAction, FACTION_ACTION_SET } from './panels/world-actions.js';
import { handleChronicleAction, CHRONICLE_ACTION_SET } from './panels/chronicle-actions.js';
import { handleApiAction, API_ACTION_SET } from './panels/api-actions.js';
import { handlePromptAction, PROMPT_ACTION_SET } from './panels/prompt-actions.js';
import { handleSettingsAction, SETTINGS_ACTION_SET, commitSection } from './panels/settings-actions.js';
import { handleBookAction, BOOK_ACTION_SET } from './panels/book-actions.js';
import { handleEntryAction, ENTRY_ACTION_SET } from './panels/entry-actions.js';
import { handleIoAction, IO_ACTION_SET } from './panels/io-actions.js';
import { handleDupeAction, DUPE_ACTION_SET } from './panels/dupe-actions.js';
import { handleAppearanceAction, APPEARANCE_ACTION_SET, refreshAppearancePreview } from './panels/appearance-actions.js';
import { handleQuestAction, QUEST_ACTION_SET } from './panels/quest-actions.js';
import { handleActionAction, ACTION_ACTION_SET } from './panels/action-actions.js';
import { handleFilterAction, FILTER_ACTION_SET } from './panels/filter-actions.js';
import { charSearch } from './panels/shared.js';

import { refreshSaveBar } from './panels/savebar.js';


export { unbindPersonCardEsc } from './panels/person-card.js';




export { jumpToSection } from './panels/nav.js';







export { PER_PAGE, pager, clampPage, kindTone, shortTime } from './panels/shared.js';

export { fillText, el, emptyBlock, heroEmpty, section, card, setSectionSummary, field, row, line, checkbox, colorInput, textInput, numberInput, textarea, button, select, foldOpenState, foldable } from './panels/shared.js';

/**
 * ★ 她 22:1x：**查重结果要能勾选**。
 *   每组：保留第一条；其余每条一个勾选框（默认勾）；底下一个「合并勾选的」。
 *   ⛔ 只给一串名字让她自己回去找人 ✓
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

/**
 * 只把"保存这条"就地重画一下（⛔ 不整页重画 ⇒ 她还能接着点）。
 * ⚠️ 要整条重画：改动数一变，「撤销」这颗按钮也得跟着出现／消失。
 */

/** ⭐ 读取控制：正在看哪本书的条目（重画后要能自动摆回来，否则点一条之后就没得点了） */
/** 读到的世界书名单（画小块用，⛔ 不反复读世界书） */

/* ⭐ RD1-3（材料 11）：**拉过的模型列表要存下来** ✓（旧：直接塞 DOM，重绘变空盒 ✗） */

/** 角色状态：搜索与排序的"记忆"（重画之后还在，不会因为改一个字就被清空） */

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
            if (BOOK_ACTION_SET.has(action)) {
                await handleBookAction(action, target, id, host, isChange, rerender);
                return;
            }
            if (ENTRY_ACTION_SET.has(action)) {
                await handleEntryAction(action, target, id, host, isChange, rerender);
                return;
            }
            if (IO_ACTION_SET.has(action)) {
                await handleIoAction(action, target, id, host, isChange, rerender);
                return;
            }
            if (DUPE_ACTION_SET.has(action)) {
                handleDupeAction(action, target, id, host, isChange, rerender);
                return;
            }
            if (APPEARANCE_ACTION_SET.has(action)) {
                handleAppearanceAction(action, target, id, host, isChange, rerender);
                return;
            }
            if (QUEST_ACTION_SET.has(action)) {
                handleQuestAction(action, target, id, isChange, rerender);
                return;
            }
            if (ACTION_ACTION_SET.has(action)) {
                await handleActionAction(action, target, id, host, isChange, rerender);
                return;
            }
            if (FILTER_ACTION_SET.has(action)) {
                handleFilterAction(action, target, id, host, isChange, rerender);
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
                case 'edit-char': {
                    setOpenChar(String(openChar) === String(id) ? '' : String(id));
                    rerender();
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
                /* ---- 任务（主线／支线）：她也能改 ---- */
                case 'set-sort-mode': if (isChange) { patchSettings({ sortMode: target.value }); rerender(); } break;
                /*
                 * ⭐ ST4-A：**这个 case 删掉了** ✓
                 *   它拦在 STAGE_MAP 前面把“人物并行封顶”**立即落盘** ✗
                 *   删掉后它会落到 `STAGE_MAP['stage-max-parallel'] = ['recall','maxParallelChars','value']` ✓
                 *   ⇒ 与同页其他格子一样走草稿 ✓（⛔ 再写一遍草稿代码 ✗）
                 */
                /* ---- 四格 ---- */
                /* ⭐ 先进草稿（等段底那颗「保存」一起存），⛔ 不再改一处存一处 */
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
