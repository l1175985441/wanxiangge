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
import { resetCache, loadState } from './core/state.js';
import { injectBeforeGenerate } from './core/engine.js';
import {
    planRecall, afterMessageReceived, onChatSwitched, reconcileAfterDelete, onFloorEdited, restoreCards,
} from './core/actions.js';
import { mountPanel, renderPanel, mountAllCards } from './ui/render.js';
import { openPanel, closePanel, isPanelOpen } from './ui/shell.js';
import { ensureWandEntry, syncEntryState } from './ui/wand.js';
import { getSettings, reloadSettings } from './core/settings.js';
import { runReconcile } from './core/pipeline.js';
import { markBookDirty, flushBook } from './core/book.js';

const VERSION = '0.2.3';

/* ---------- 生成前拦截（名字与 manifest.json 里的 generate_interceptor 一致） ---------- */
globalThis['万象阁_生成前拦截'] = async function (chat, contextSize, abort, type) {
    return injectBeforeGenerate(chat, contextSize, abort, type);
};

/* ---------- 事件登记 ---------- */

let eventsBound = false;
let lastUserFloor = -1;

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
        if (isPanelOpen()) {
            import('./ui/shell.js').then((m) => m.refreshPanel()).catch(() => {});
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
}

export function onDisable() {
    console.info('[' + APP_NAME + '] 已停用（数据保留）');
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
        mountPanel(VERSION).then(() => {
            renderPanel();
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

                // 她自己要求"打开酒馆就弹出面板"时才弹
                if (getSettings().showPanelOnStart) {
                    openPanel();
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

(function start() {
    const ctx = typeof SillyTavern !== 'undefined' && SillyTavern && typeof SillyTavern.getContext === 'function'
        ? SillyTavern.getContext()
        : null;
    const source = ctx && ctx.eventSource;
    const types = ctx && ctx.event_types;

    if (source && types && typeof types.APP_READY === 'string') {
        source.on(types.APP_READY, () => boot());
        if (typeof ctx.isReady === 'boolean' && ctx.isReady === true) {
            boot();
        }
        return;
    }
    setTimeout(boot, 1500);
})();

export { openPanel, closePanel, isPanelOpen, loadState };
