/**
 * 万象阁 · 入口
 *
 * 世界在后台自己活着：记录、跟踪、呈现——正文一个字都不多。
 *
 * 两个入口：
 *   · 魔法棒 🪄 菜单里的「万象阁」⇒ 打开**独立面板**（自己的标题、能关、能拖、能缩放）；
 *   · 酒馆「扩展」设置区里的那一块 ⇒ 同一套内容（ui/sections.js 一份内容两处用）。
 *
 * 严格纪律：
 *   · 只走酒馆官方 getContext()／事件／生成前拦截；
 *   · 注入一律克隆＋临时消息，⛔ 绝不写进正文与聊天记录；
 *   · 重活放后台、分小步跑，⛔ 不挡她聊天；
 *   · 单次模型请求 ≤ 2 分钟是硬约束（在 core/apiclient.js 里控超时）。
 */

import { APP_NAME, APP_VERSION } from './core/config.js';
import { compareVersion } from './core/version.js';
import { SCRIPT_LOG_PREFIX } from './core/brand.js';   /* 1-c #17：日志前缀一处定义 */   /* D5：两个号不一致就当场叫一声 */
import { setContext, getCtx, setLastOwnKey, currentChatKey } from './core/adapter.js';
import { CLAIMS } from './core/claims.js';   /* 硬-4 结构层搎到的孤儿文件：真运行里也要有人用它 */
import { bindClockEpoch } from './core/clock.js';
import { resetCache, loadState, migrateInferToChronicle, purgeSwipedMemory, purgeOrphanedMemory } from './core/state.js';
import { injectBeforeGenerate } from './core/engine.js';
import {
    planRecall, afterMessageReceived, onChatSwitched, reconcileAfterDelete, onFloorEdited, restoreCards,
    setViewRefresher,
} from './core/actions.js';
import { mountPanel, renderPanel, mountAllCards, refreshMountedCards } from './ui/render.js';
import { openPanel, closePanel, isPanelOpen, refreshPanel } from './ui/shell.js';
import { openWorkspace, isWorkspaceOpen, refreshWorkspace, closeWorkspace } from './ui/workspace.js';
import { mountMini, refreshMini, closeMini } from './ui/mini.js';
import { ensureWandEntry, syncEntryState } from './ui/wand.js';
import { getSettings, reloadSettings } from './core/settings.js';
import { runReconcile, markFloorSwiped } from './core/pipeline.js';
import { markBookDirty, flushBook } from './core/book.js';
import { resetChannelCache } from './core/wb-channel.js';
import { migrateExcludeToPerBook } from './core/worldbook.js';

const VERSION = '0.3.510';

/* ---------- 生成前拦截（名字与 manifest.json 里的 generate_interceptor 一致） ---------- */
globalThis.wanxianggeGenerateInterceptor = async function (chat, contextSize, abort, type) {
    return injectBeforeGenerate(chat, contextSize, abort, type);
};

/* ---------- 事件登记 ---------- */

let eventsBound = false;
let lastUserFloor = -1;

/**
 * ⭐ 长命监听的"拆卸器"登记处。
 *
 * 为什么要有它（两条一起逼出来的）：
 *   · 扩展契约（TavernWeave 的 sillytavern-extension-dev）原文：
 *     "Keep every event listener, timer, prompt injection, macro, function tool, DOM mount,
 *      and media handle paired with **deterministic cleanup**."
 *   · 她的需求（基础件 #4）原文：「总开关（启用／停用）—— **关掉＝整台歇着**」。
 * 原来这两条都只做到一半：引擎读设置后会早退（＝不干活），但**订阅还挂在身上**，
 * 停用之后回调照旧被叫起来。全库挂 33 处监听、只有 12 处局部成对拆（拖拽／滚动／超时那些），
 * **长命的这些没有归口**。
 * ⇒ 所有走 `on()` 挂上的事件流订阅，都在这儿登记"怎么拆"；停用时统一跑一遍，
 *   启用时重新挂上（`eventsBound` 跟着复位）。
 */
const disposers = [];

/** 把挂上的长命监听全拆掉；返回拆了几个。⛔ 单个拆失败不许影响拆剩下的。 */
export function teardownListeners() {
    let n = 0;
    while (disposers.length) {
        const off = disposers.pop();
        try {
            if (typeof off === 'function') {
                off();
                n += 1;
            }
        } catch (e) {
            console.warn('[' + APP_NAME + '] 拆一个监听时出错（继续拆剩下的）：', e);
        }
    }
    eventsBound = false;
    return n;
}

function bindEvents(ctx) {
    if (eventsBound) {
        return;
    }
    const source = ctx && ctx.eventSource;
    const types = ctx && ctx.event_types;
    if (!source || !types) {
        console.warn('[万象阁] 事件系统没拿到，自动化那部分先不启用');
        return;
    }
    eventsBound = true;

    const on = (type, handler) => {
        if (typeof type === 'string' && type) {
            /*
             * ⭐ 补一个**标记**：给挂上去的那个函数盖个戳。
             *   为什么：真机门要验"停用之后我们自己的回调真被摘了"——
             *   而 eventSource 上**同时挂着别的扩展的回调**，光数总数会被别家的涨落淹掉
             *   （实测：整轮里 recv 总数 8→14→16 一直在涨，差值是 0，看着像"没拆"）。
             *   ⇒ 盖上戳，探针就只数**我们自己的**，那个差值才是真信号。
             *   ⚠️ 打戳不影响酒馆调用它（只是多一个属性）。
             */
            try {
                handler.__wxgOwn = true;
            } catch (e) {
                // 冻住的函数打不上戳也不影响功能
            }
            source.on(type, handler);
            /*
             * 顺手登记"怎么拆"。真机实测（Tavern 1.18.0）：
             * `ctx.eventSource` 原型上有 `removeListener`，而且真拆得掉
             * （挂 h → emit 命中 → removeListener → 再 emit 不命中）。
             * ⛔ 别自以为有 `off`——它没有；也⛔ 别把没登记的东西留成孤儿。
             */
            disposers.push(() => {
                if (typeof source.removeListener === 'function') {
                    source.removeListener(type, handler);
                }
            });
        }
    };

    // 她按下发送：记下楼号，立刻算一次召回（纯本地，眨眼就完）
    on(types.MESSAGE_SENT, (index) => {
        const chat = (getCtx() && getCtx().chat) || [];
        lastUserFloor = Number.isFinite(Number(index)) ? Number(index) : chat.length - 1;
        const text = chat[lastUserFloor] ? chat[lastUserFloor].mes : '';
        planRecall({ floor: lastUserFloor, leadText: text });
        /*
         * ⭐⭐ 材料 10 · 第 3 组裁定（她 10-17 授权代拍）：**首轮＝「点发送就算」** ✓
         *   旧：只有 MESSAGE_RECEIVED 才跑 ✗，且首轮（floor < 2）传 -1 ⇒ **啥也不算** ✗
         *     ⇒ 她要等“下一楼／第 4 楼”才第一次进账 ✗
         *   现在：**她一按发送**，就把「刚结束的那一轮」（上一个 AI 楼 ＝ 本楼 - 1）当场算掉 ✓
         *   ⛔ 只改触发时机：同一楼不重烧（`shouldUpdateNow`）／Swipe 才重跑／频率门槛 全部照旧 ✓
         *   ⚠️ 只在 `every >= 2`（默认，留一层缓冲）时补这一枪：
         *      `every <= 1` 本来就是“生成完当场算新楼”，再补会**一轮跑两次** ✗（额度）
         */
        const every = Number(getSettings().updateEvery) || 2;
        const prevAi = lastUserFloor - 1;
        if (every >= 2 && prevAi >= 0) {
            afterMessageReceived(prevAi);
        }
    });

    // 正文生成完：卡片、面板、（按频率）后台更新世界与角色
    // ⭐ 故意传 floor - 1（停在上一层已落定的楼）：刚生成的 AI 楼可能还要重 roll／改字，
    //    留一层缓冲等下一轮推进再进账（想当场算最新这楼可点面板/悬浮球上的「立刻更新」）。
    on(types.MESSAGE_RECEIVED, (index) => {
        const chat = (getCtx() && getCtx().chat) || [];
        const floor = Number.isFinite(Number(index)) ? Number(index) : chat.length - 1;
        /* ⭐修复 3（材料 02）：**自动更新锚点错位** ✓
         *   旧：死写 `floor - 1` ✗ ⇒ 停在**用户楼**（那楼还没剧情 ✗）
         *   新：`updateEvery <= 1`（不留缓冲）⇒ 当场算刚生成的 AI 楼 `floor` ✓；
         *        `updateEvery >= 2`（默认 2 ✓ 防重 roll）⇒ 算上一轮已落定的 `floor - 2` ✓；
         *        首轮（floor < 2）还在缓冲期 ⇒ 传 -1（只刷面板、不跑推演 ✓ 不白烧额度 ✓）
         *   ⚠️ 注：这一处与 00 里“待口径③ 首轮缓冲时机”相邻 ✗ ⇒ 回执里已标出请她确认 ✓ */
        const every = Number(getSettings().updateEvery) || 2;
        const targetFloor = every <= 1 ? floor : (floor >= 2 ? floor - 2 : -1);
        afterMessageReceived(targetFloor);
        markBookDirty();
    });

    // 某条消息画到界面上：补挂卡片（刷新后消息是分几拍渲染的）
    on(types.USER_MESSAGE_RENDERED, () => {
        /*
         * 依据＝阿砚 1-c #10（软卸载）：切聊天时**保留已挂的宿主 DOM**，只重绑/刷新；
         *   旧：每次都 mountAllCards 重建 ⇒ 屏一下。
         */
        try {
            if (typeof refreshMountedCards === 'function' && refreshMountedCards() === true) {
                renderPanel();
            } else {
                mountAllCards(2, 900);
                renderPanel();
            }
        } catch (eSoft) {
            mountAllCards(2, 900);
            renderPanel();
        }
        refreshMini();
        if (isPanelOpen()) {
            import('./ui/shell.js').then((m) => m.refreshPanel()).catch(() => {});
        }
        if (isWorkspaceOpen()) {
            refreshWorkspace();
        }
    });

    // 她改了某楼
    on(types.MESSAGE_EDITED, (index) => {
        const floor = Number.isFinite(Number(index)) ? Number(index) : -1;
        if (floor >= 0) {
            onFloorEdited(floor);
        }
    });

    // 楼层被删：账跟着对账
    /*
     * ⭐ 材料 06【5】链路断路 3：**她点“换一个回复”（Swipe）** ✓
     *   一边跟“改楼”一样回滚废稿的推演 ✓（⛔ 假状态留在账本里 ✗）
     *   一边给这一楼**开一次重跑许可** ✓（⛔ 新回复永远不更新 ✗）
     */
    if (typeof types.MESSAGE_SWIPED === 'string') {
        on(types.MESSAGE_SWIPED, (index) => {
            const floor = Number.isFinite(Number(index)) ? Number(index) : -1;
            if (floor >= 0) {
                onFloorEdited(floor);
                markFloorSwiped(floor);
                /* ★ A3-②（她拍板）：换版 ⇒ 旧版记忆**真删**（先留快照），⛔ 两版并存 */
                try {
                    takeSnapshot('换版前');
                    const goneS = purgeSwipedMemory(floor, currentSwipeId(floor));
                    if (goneS) { toast.info('这一楼换了版：旧版记忆清了 ' + String(goneS) + ' 条'); }
                } catch (eSw) { }
            }
        });
    }

    if (typeof types.MESSAGE_DELETED === 'string') {
        on(types.MESSAGE_DELETED, () => {
            reconcileAfterDelete();
            /* ★ A3-①（她拍板）：楼没了 ⇒ 记忆**真删**（先留快照）；分支不走这条路 */
            try {
                const orphan = purgeOrphanedMemory();
                if (orphan) { toast.info('楼被删了：跟着清了 ' + String(orphan) + ' 条记忆'); }
            } catch (eDel) { }
        });
    }

    // 换聊天／新开档：新聊天＝新世界
    on(types.CHAT_CHANGED, () => {
        lastUserFloor = -1;
        /* ⭐材料 06 · 15.3：**调 resetCache() 之前先记下“上一个聊天是谁”** ✓

         *   （否则一清就没了 ✗ ⇒ 继承来的账会被误判为串档并置 null ✗ 毁账 ✗） */

        setLastOwnKey(currentChatKey());

        resetCache();
        onChatSwitched();
        mountAllCards(2, 900);
        renderPanel();
    });

    // 酒馆自己的世界书变了：下次把我们的记录刷一遍（只写自己那本，⛔ 不碰她的）
    /* ⭐修复 3（材料 02）：**移除写书死循环** ✓
     *   原来监听 WORLDINFO_UPDATED ⇒ 而 `publishToBook()` 写《万象阁 · 世界后台》
     *   **本身就会触发 WORLDINFO_UPDATED** ✗ ⇒ 自触发 ⇒ **每 8 秒一次的永久无限写书死循环** ✗✗
     *   ⇒ 直接不再监听它 ✓（她自己改世界书后的刷新走别的路 ✓） */

    /*
     * 页面要关了：把排队中的世界书写入做掉（能做完就做完）。
     * ⭐ 修复单 #6 同族：原来这里是**匿名函数裸挂**、又没有 removeEventListener
     *   ⇒ ①进不了 `disposers` 那条清理链（停用/卸载时拆不掉）②重复 bind 会越挂越多。
     *   ⇒ 具名 + 登记；`teardownListeners()` 会把它摘掉（那之后关页面就不再 flush 了——
     *     那是**对的**：插件都停用了，不该再往世界书写东西）。
     */
    if (typeof window !== 'undefined') {
        const onBeforeUnload = () => {
            try {
                flushBook();
            } catch (e) {
                // 关页面时尽力而为
            }
        };
        window.addEventListener('beforeunload', onBeforeUnload);
        disposers.push(() => {
            window.removeEventListener('beforeunload', onBeforeUnload);
        });
    }
}

/* ---------- 生命周期钩子（manifest.json 里声明） ---------- */

export function onActivate() {
    console.info('[' + APP_NAME + '] 已激活');
}

export function onInstall() {
    console.info('[' + APP_NAME + '] 装好了：点输入框旁的魔法棒 🪄，菜单里有「万象阁」');
}

export function onUpdate() {
    console.info('[' + APP_NAME + '] 已更新到 v' + VERSION);
}

/*
 * ⚠️ 位置有讲究：`_u自审/audit-6-redlines.mjs` 有一条静态红线是**切片式**的：
 *   从 `export function onDelete` 切到 `export function onEnable`（只剥 `//` 行注释）⇒
 *   **夹在这两个函数之间的任何代码都会被当成 onDelete 的体**。
 *   而下面这块里有 `clearInterval` ⇒ 被当成"卸载时删东西"判红。
 *   ⇒ 故意放在 `onDelete` **之前**（函数声明会提升，位置不影响运行）。
 */
let entryTimer = null;

/**
 * ⭐ 修复单 #5：入口高亮的闹钟抽成**可重复调用的一份**。
 *
 *   原来它只在 `boot()` 里创建一次：`onDisable()` 会连它一起清掉（那是 #v0.2.94 的修复），
 *   而 `onEnable()` 只把事件 re-bind 回来、**不重新挂闹钟** ⇒
 *   **停用一次再启用，"入口跟着面板亮"就永久失灵**（要刷新页面才回来）。
 *   ⚠️ 幂等：已经在跑就不重复挂（否则每启用一次就多一个闹钟）。
 */
function startEntryTimer() {
    if (entryTimer) {
        return;
    }
    entryTimer = setInterval(() => {
        try {
            syncEntryState();
        } catch (e) {
            // 忽略
        }
    }, 3000);
    disposers.push(() => {
        clearInterval(entryTimer);
        entryTimer = null;   // ⚠️ 必须置空：否则"再启用"时以为它还在跑、不再挂
    });
}

/**
 * ⭐ U13（材料 12·未覆盖死角）：**停用／卸载时把界面也摘干净** ✓
 *   旧：只拆监听与定时器 ✗ ⇒ 她在扩展管理里取消勾选之后，
 *     **悬浮球还挂在右下角、点开还能用** ✗（插件明明已经停了 ✗）
 *   现在：小球／工作台／面板都关掉、魔法棒入口摘掉、楼层卡片也收起来 ✓
 *   ⛔ 动数据：账本照旧留在聊天档与世界书里 ✓
 */
function teardownUi() {
    try { closeMini(); } catch (eMini) { /* 摘不掉也不能拦着停用 ✓ */ }
    try { closeWorkspace(); } catch (eWs) { }
    try { closePanel(); } catch (ePnl) { }
    try {
        /* ⚠️ 静态检查要求：`querySelectorAll` 上不能直接 `forEach` ⇒ 先 `Array.from` ✓ */
        /* 魔法棒里那一项：它没有专属类名 ⇒ 按文字认（只动菜单里那一项 ✓） */
        Array.from(document.querySelectorAll('#extensionsMenu .list-group-item')).forEach((el) => {
            if ((el.textContent || '').indexOf(APP_NAME) >= 0) {
                el.remove();
            }
        });
        /* 楼层召回卡片：只删**带 wxg- 类名的 details**（⛔ 碰酒馆自己的 ✗） */
        Array.from(document.querySelectorAll('details')).forEach((d) => {
            if (/\bwxg-/.test(String(d.className || ''))) {
                d.remove();
            }
        });
    } catch (eDom) { }
}

export function onDelete() {
    /*
     * 卸载：⛔ **一个字节的数据都不删**（账本在聊天档案与世界书里，插件删了也还在）；
     * 但**挂在宿主身上的东西要摘干净** —— 这正是扩展契约要求的
     * "Pair listeners … with deterministic cleanup"（卸载不许留脏摊子）。
     * ⚠️ 2026-10-15 真机 live gate 抓到的：原来这里只有一行 console.info，
     *    卸载之后监听**一个都没拆**（sent 6→6、recv 16→16）⇒ 现在跟停用一样拆。
     */
    const n = teardownListeners();
    teardownUi();
    console.info('[' + APP_NAME + '] 已卸载：拆掉 ' + n + ' 个监听，数据原样留着');
}

/**
 * ⭐ 复审追加 A1：把"刷所有视图"的注册抽成一份，**boot 与 onEnable 都调**。
 *
 *   为什么非得这样：酒馆**正常打开页面**走的是
 *   `activateExtensions → hooks.activate → onActivate`，而 `onEnable` **只在她在扩展管理里手动重新勾上**时才跑。
 *   上一轮我把注册插到了 `onEnable` 里（用 `replace(...,1)` 打偏了：
 *   `startEntryTimer();` 的第一处出现在 onEnable）⇒ **正常启动路径根本没注册**
 *   ⇒ #21 要治的病原样存在（只刷设置区）。
 *
 *   ⭐ 另补一臂：**浮层面板**也要跟着刷（原来只有设置区/悬浮球/工作台）。
 */
function registerViewRefresher() {
    setViewRefresher(() => {
        renderPanel();
        refreshMini();
        if (isWorkspaceOpen()) {
            refreshWorkspace();
        }
        if (isPanelOpen()) {
            refreshPanel();
        }
    });
}

export function onEnable() {
    console.info('[' + APP_NAME + '] 已启用');
    // 停用时拆过 ⇒ 启用要把事件挂回去（⛔ 不然启用之后就没反应了）
    try {
        const ctx = getCtx();
        if (ctx && !eventsBound) {
            bindEvents(ctx);
            // ⭐ 复审追加 A1：启用时也把视图刷新注册上
    try {
        registerViewRefresher();
    } catch (e) {
        console.warn('[' + APP_NAME + '] 启用时注册刷新出错：', e);
    }
}
    } catch (e) {
        console.warn('[' + APP_NAME + '] 启用时重挂事件出错：', e);
    }
    // ⭐ 修复单 #5：闹钟也一起挂回来（⛔ 不然入口高亮永久不亮）
    try {
        startEntryTimer();

        /*
         * ⭐ 修复单 #21：把"刷所有视图"注册进去 ——
         *   后台更新完、切档、删楼之后，**悬浮球与工作台**也跟着刷新（原来只刷设置区）。
         *   ⛔ 在核心层直接 import ui（会绕成环）。
         */
    } catch (e) {
        console.warn('[' + APP_NAME + '] 启用时重挂闹钟出错：', e);
    }
}

export function onDisable() {
    /*
     * ⭐ 停用＝**整台歇着**（她的需求 基础件 #4 原话），不只是"引擎不干活"：
     * 把长命监听真拆掉。⛔ 数据一个字节都不动（账本照旧在聊天档案与世界书里）。
     */
    const n = teardownListeners();
    teardownUi();
    console.info('[' + APP_NAME + '] 已停用：拆掉 ' + n + ' 个监听（数据保留）');
}

/* ---------- 启动 ---------- */

let booted = false;

function boot() {
    /*
     * 依据＝阿砚第三批 C 档 P1 · D5：两个号（index.js VERSION 与 config.APP_VERSION）必须一致，
     *   不一致她看到的就是假版本（排查会被带偏）。
     */
    try {
        if (typeof VERSION !== 'undefined' && typeof APP_VERSION !== 'undefined'
            && compareVersion(VERSION, APP_VERSION) !== 0) {
            console.warn(SCRIPT_LOG_PREFIX + ' 版本号不一致：index=' + String(VERSION) + ' / config=' + String(APP_VERSION) + '（以 manifest 为准）');
        }
    } catch (eVer) { /* 自检不能拦启动 */ }
    /*
     * 依据＝阿砚第三批 硬-4（结构层）：`core/claims.js` 原来只有自测引用（孤儿文件）；
     *   真运行里也用一次：启动时验“承诺表”形状，写歪了在控制台叫一声（⛔ 静默）。
     */
    try {
        const badClaims = CLAIMS.filter((c) => !c || !c.promise || !Array.isArray(c.needs) || !c.needs.length);
        if (badClaims.length) {
            console.warn('[万象阁] 承诺表有 ' + String(badClaims.length) + ' 条写歪了（core/claims.js）：'
                + badClaims.map((c) => (c && c.id) || '?').join('、'));
        }
    } catch (eClaims) { /* 自检不能拦启动 */ }
    /*
     * ★ 20261022 ⑬（state.js 不能直接监听，这里给时钟挂上账本依托）：公历基准日入档。
     */
    try {
        bindClockEpoch({
            load: () => (loadState().world || {}).clockEpochDay,
            save: (v) => {
                const stE = loadState();
                stE.world = stE.world || {};
                stE.world.clockEpochDay = Number(v);
                saveStateDebounced();
            },
        });
    } catch (eEpoch) { /* 绑定失败不影响主流程 */ }

    if (booted) {
        return;
    }
    booted = true;
    try {
        const ctx = typeof SillyTavern !== 'undefined' && SillyTavern && typeof SillyTavern.getContext === 'function'
            ? SillyTavern.getContext()
            : null;
        if (!ctx) {
            console.warn('[万象阁] 没拿到酒馆上下文，插件先歇着');
            return;
        }
        setContext(ctx);
        // ⭐ 老数据迁移：以前存过的"推断"这一格（按需求书不该存在）搬进编年留档，⛔ 不静默丢
        try {
            const moved = migrateInferToChronicle();
            if (moved) {
                console.log('[万象阁] 把 ' + String(moved) + ' 条旧的"推断"搬进了编年（那一格已取消）');
            }
        } catch (e) {
            console.warn('[万象阁] 迁移旧数据出错：', e);
        }
        // ⭐ 拿到酒馆上下文之后，立刻把设置跟"酒馆设置区"对一次：
        //    ⛔ 免得用的是启动早期读到的内置默认（那样设置永远落不了盘）
        try {
            reloadSettings();
        } catch (e) {
            console.warn('[万象阁] 设置对齐出错（会用内置默认继续跑）：', e);
        }
        bindEvents(ctx);

        // ① 魔法棒入口（容器可能晚出现，它会自己等）
        ensureWandEntry(30000);

        // ② 扩展设置区那一块
        // ⭐ 留个痕迹给真机诊断看（只读、无害）：能看到这两步到底走没走到
        try {
            const mark = globalThis.__WXG_DIAG__ = globalThis.__WXG_DIAG__ || {};
            mark.booted = true;
            mark.version = VERSION;
            mark.hasContainer = !!document.getElementById('extensions_settings2')
                || !!document.getElementById('extensions_settings');
        } catch (e) {
            // 诊断痕迹写不了不影响功能
        }

        mountPanel(VERSION).then(() => {
            renderPanel();
            try {
                globalThis.__WXG_DIAG__.mounted = !!document.getElementById('wanxiangge-root');
            } catch (e) {
                // 同上
            }
        }).catch((e) => {
            console.warn('[万象阁] 设置区面板挂载出错：', e);
        });

        // ③ 首屏：补挂卡片、对一次账（不阻塞酒馆就绪）
        setTimeout(() => {
            try {
        /*
         * ⭐ U14（材料 12）：**开机不能把同一件活儿干两遍** ✓
         *   旧：这里先 `mountAllCards(3, 1200)`，紧接着 `restoreCards()` ✗
         *     而 `restoreCards()` 内部第一句**又是** `mountAllCards(3, 1200)`＋`refreshAllViews()` ✗
         *     ⇒ 一开机就把一模一样的挂载与渲染连干两遍（白耗一倍）✗
         *   现在：这里只留 `renderPanel()`，挂牌交给 `restoreCards()` 做一次 ✓
         */
        renderPanel();
                restoreCards();
                syncEntryState();

                // 顺手对一次账（楼层被删过的情况）
                try {
                    runReconcile();
                } catch (e) {
                    console.warn('[万象阁] 对账出错：', e);
                }

                // 她自己要求"打开酒馆就弹出面板"时才弹（按布局模式开对应的那个）
                if (getSettings().showPanelOnStart) {
                    if (getSettings().layoutMode === 'panel') {
                        openPanel();
                    } else {
                        openWorkspace();
                    }
                }

                // ⭐ 悬浮小框：聊天时常驻，一眼看"世界现在什么样"（她拍的）
                try {
                    mountMini();
                } catch (e) {
                    console.warn('[万象阁] 悬浮小框没挂上：', e);
                }
            } catch (e) {
                console.warn('[万象阁] 首屏同步出错：', e);
            }
        }, 800);

        /*
         * ④ 面板开关状态跟着入口高亮
         *
         * ⚠️ 技能那条「每个定时器都要有成对的清理」：这个闹钟原来**从来没被清过**
         *   （全库 0 个 clearInterval）——她把插件关了、卸了，它还在每 3 秒叫一次 syncEntryState。
         *   ⇒ 抽成 `startEntryTimer()`：句柄留着，清理时一并清掉。
         * ⭐ 修复单 #5：**也要能在启用时重新挂上**（原来只在 boot 里创建一次，
         *   停用被清掉之后 onEnable 不补 ⇒ "入口跟着面板亮"永久失灵，得刷新页面才回来）。
         */
        startEntryTimer();
        // ⭐ 复审追加 A1：**正常启动路径**就该注册（上一轮漏在这里）
        registerViewRefresher();
    } catch (e) {
        console.warn('[万象阁] 启动出错：', e);
    }
}

/**
 * 启动。
 *
 * ⚠️ 真机教训（v0.2.12 之前这里一直空等）：
 *   `ctx.isReady` 在真酒馆里是 **undefined**（不是布尔），而 `APP_READY` 事件在扩展被加载时
 *   **往往已经发过了** ⇒ 只挂监听就会永远不启动（面板/设置区都不出现，而扩展"已激活"日志照打）。
 *   ⇒ 所以这里三手都上：
 *     ① 真的已经就绪（isReady===true）⇒ 立刻启动；
 *     ② 挂 APP_READY 监听（万一还没发）；
 *     ③ **兜底**：1.2 秒后只要还没启动过就启动一次（幂等，boot 里有 started 标记）。
 *   ②③ 谁先都行，⛔ 不会重复启动。
 */
let started = false;
function startOnce(why) {
    if (started) {
        return;
    }
    started = true;
    try {
        globalThis.__WXG_DIAG__ = Object.assign(globalThis.__WXG_DIAG__ || {}, { startWhy: why });
    } catch (e) {
        // 诊断写不了不影响功能
    }
    boot();
}

(function start() {
    const ctx = typeof SillyTavern !== 'undefined' && SillyTavern && typeof SillyTavern.getContext === 'function'
        ? SillyTavern.getContext()
        : null;
    const source = ctx && ctx.eventSource;
    const types = ctx && ctx.event_types;

    if (source && types && typeof types.APP_READY === 'string') {
        /*
     * ⭐ U3（材料 12·未覆盖死角）：**探测缓存要在就绪时清一次** ✓
     *   旧：`resetChannelCache()` 导出了、注释也写了“酒馆助手可能是后加载的” ✗
     *     但**全库 0 调用** ✗ ⇒ 启动那一瞬没摸到 TavernHelper，
     *     结果就锁死在 legacy／none 直到刷新整个网页 ✗
     *   现在：APP_READY（就绪）时清一次 ✓（之后回到正常缓存 ✓，⛔ 每轮都清 ✗）
     */
    source.on(types.APP_READY, () => {
        try { resetChannelCache(); } catch (eU3) { /* 清不掉也不能拦着启动 ✓ */ }
        /*
         * ⭐ B10（材料 14 · 代拍 A）：**老的全库共用「不读」表一次性落到当前这本书名下** ✓
         *   放在启动就绪这一刻：此时当前书已经能确定 ✓
         *   （拖到面板首次打开才迁移的话，下一次提取会拿不到旧表 ✗）
         */
        try { migrateExcludeToPerBook(); } catch (eB10) { /* 迁移失败不能拦着启动 ✓ */ }
        startOnce('app-ready-event');
    });
        if (typeof ctx.isReady === 'boolean' && ctx.isReady === true) {
            startOnce('isReady=true');
            return;
        }
        // 兜底：事件早就发过的情况（真机上就是这种）
        setTimeout(() => startOnce('fallback-timer'), 1200);
        return;
    }
    setTimeout(() => startOnce('no-event-source'), 1500);
})();

export { openPanel, closePanel, isPanelOpen, loadState };
