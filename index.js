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

import { APP_NAME } from './core/config.js';
import { setContext, getCtx } from './core/adapter.js';
import { resetCache, loadState, migrateInferToChronicle } from './core/state.js';
import { injectBeforeGenerate } from './core/engine.js';
import {
    planRecall, afterMessageReceived, onChatSwitched, reconcileAfterDelete, onFloorEdited, restoreCards,
} from './core/actions.js';
import { mountPanel, renderPanel, mountAllCards } from './ui/render.js';
import { openPanel, closePanel, isPanelOpen } from './ui/shell.js';
import { openWorkspace, isWorkspaceOpen, refreshWorkspace } from './ui/workspace.js';
import { mountMini, refreshMini } from './ui/mini.js';
import { ensureWandEntry, syncEntryState } from './ui/wand.js';
import { getSettings, reloadSettings } from './core/settings.js';
import { runReconcile } from './core/pipeline.js';
import { markBookDirty, flushBook } from './core/book.js';

const VERSION = '0.2.50';

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
    });

    // 正文生成完：卡片、面板、（按频率）后台更新世界与角色
    // ⭐ 故意传 floor - 1（停在上一层已落定的楼）：刚生成的 AI 楼可能还要重 roll／改字，
    //    留一层缓冲等下一轮推进再进账（想当场算最新这楼可点面板/悬浮球上的「立刻更新」）。
    on(types.MESSAGE_RECEIVED, (index) => {
        const chat = (getCtx() && getCtx().chat) || [];
        const floor = Number.isFinite(Number(index)) ? Number(index) : chat.length - 1;
        afterMessageReceived(floor - 1 >= 0 ? floor - 1 : lastUserFloor);
        markBookDirty();
    });

    // 某条消息画到界面上：补挂卡片（刷新后消息是分几拍渲染的）
    on(types.USER_MESSAGE_RENDERED, () => {
        mountAllCards(2, 900);
        renderPanel();
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
    if (typeof types.MESSAGE_DELETED === 'string') {
        on(types.MESSAGE_DELETED, () => {
            reconcileAfterDelete();
        });
    }

    // 换聊天／新开档：新聊天＝新世界
    on(types.CHAT_CHANGED, () => {
        lastUserFloor = -1;
        resetCache();
        onChatSwitched();
        mountAllCards(2, 900);
        renderPanel();
    });

    // 酒馆自己的世界书变了：下次把我们的记录刷一遍（只写自己那本，⛔ 不碰她的）
    if (typeof types.WORLDINFO_UPDATED === 'string') {
        on(types.WORLDINFO_UPDATED, () => {
            markBookDirty();
        });
    }

    // 页面要关了：把排队中的世界书写入做掉（能做完就做完）
    if (typeof window !== 'undefined') {
        window.addEventListener('beforeunload', () => {
            try {
                flushBook();
            } catch (e) {
                // 关页面时尽力而为
            }
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

export function onDelete() {
    // 卸载不毁数据：这里什么都不删（账本在聊天档案与世界书里，插件删了也还在）
    console.info('[' + APP_NAME + '] 已卸载，数据原样留着');
}

export function onEnable() {
    console.info('[' + APP_NAME + '] 已启用');
    // 停用时拆过 ⇒ 启用要把事件挂回去（⛔ 不然启用之后就没反应了）
    try {
        const ctx = getCtx();
        if (ctx && !eventsBound) {
            bindEvents(ctx);
        }
    } catch (e) {
        console.warn('[' + APP_NAME + '] 启用时重挂事件出错：', e);
    }
}

export function onDisable() {
    /*
     * ⭐ 停用＝**整台歇着**（她的需求 基础件 #4 原话），不只是"引擎不干活"：
     * 把长命监听真拆掉。⛔ 数据一个字节都不动（账本照旧在聊天档案与世界书里）。
     */
    const n = teardownListeners();
    console.info('[' + APP_NAME + '] 已停用：拆掉 ' + n + ' 个监听（数据保留）');
}

/* ---------- 启动 ---------- */

let booted = false;

function boot() {
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
                mountAllCards(3, 1200);
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

        // ④ 面板开关状态跟着入口高亮
        setInterval(() => {
            try {
                syncEntryState();
            } catch (e) {
                // 忽略
            }
        }, 3000);
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
        source.on(types.APP_READY, () => startOnce('app-ready-event'));
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
