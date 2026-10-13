/**
 * 万象阁 · 入口
 *
 * 世界在后台自己活着：记录、跟踪、呈现——正文一个字都不多。
 *
 * 这一版（第 1-2 步）跑通的主线：
 *   她发消息 → 当场算一次召回 → 跟着她这条消息一起进请求（主模型看得见）
 *                            → 同一份内容在她回复楼后面挂一张折叠卡片（她看得见）
 *                            → 卡片带一行回执：有没有注入、注入多少字、为什么没注入。
 *
 * 纪律：只走酒馆官方 getContext()／事件／生成前拦截，不深入内部结构；
 *      注入一律用克隆，⛔ 绝不写进正文与聊天记录。
 */

import { APP_NAME } from './core/config.js';
import { setContext, getCtx } from './core/adapter.js';
import { resetCache } from './core/state.js';
import { injectBeforeGenerate } from './core/engine.js';
import { planRecall, afterMessageReceived, onChatSwitched, reconcileAfterDelete, onFloorEdited, restoreCards } from './core/actions.js';
import { mountPanel, renderPanel, mountAllCards } from './ui/render.js';

const VERSION = '0.1.2';

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
        console.warn('[万象阁] 事件系统没拿到，卡片与召回会自动化的部分先不启用');
        return;
    }
    eventsBound = true;

    const on = (type, handler) => {
        if (typeof type === 'string' && type) {
            source.on(type, handler);
        }
    };

    // 她按下发送：记下楼号，立刻算一次召回（纯本地计算，眨眼就完，不挡界面）
    on(types.MESSAGE_SENT, (index) => {
        const chat = (getCtx() && getCtx().chat) || [];
        lastUserFloor = Number.isFinite(Number(index)) ? Number(index) : chat.length - 1;
        const text = chat[lastUserFloor] ? chat[lastUserFloor].mes : '';
        planRecall({ floor: lastUserFloor, leadText: text });
    });

    // 正文生成完：把回执补上、卡片挂好
    on(types.MESSAGE_RECEIVED, () => {
        afterMessageReceived();
    });

    // 某条消息画到界面上：该挂卡片就挂
    on(types.USER_MESSAGE_RENDERED, (index) => {
        const floor = Number.isFinite(Number(index)) ? Number(index) : -1;
        if (floor >= 0) {
            renderPanel();
        }
    });

    // 她改了某楼：这一楼如果带账，卡片撤掉重算
    on(types.MESSAGE_EDITED, (index) => {
        const floor = Number.isFinite(Number(index)) ? Number(index) : -1;
        if (floor >= 0) {
            onFloorEdited(floor);
        }
    });

    // 楼层被删：账跟着对账（软保护，不会误清空）
    if (typeof types.MESSAGE_DELETED === 'string') {
        on(types.MESSAGE_DELETED, () => {
            reconcileAfterDelete();
        });
    }

    // 换聊天／新开档：新聊天＝新世界，数据各分各的
    on(types.CHAT_CHANGED, () => {
        lastUserFloor = -1;
        resetCache();
        onChatSwitched();
        mountAllCards();
    });
}

/* ---------- 生命周期钩子（manifest.json 里声明） ---------- */

export function onActivate() {
    // 同步阶段只做最轻的事，别拖慢酒馆启动
    console.info('[' + APP_NAME + '] 已激活');
}

export function onInstall() {
    console.info('[' + APP_NAME + '] 装好了：去扩展设置区打开"万象阁"看看');
}

export function onUpdate() {
    console.info('[' + APP_NAME + '] 已更新到 v' + VERSION);
}

export function onDelete() {
    // 卸载不毁数据：这里什么都不删（账本在世界书／聊天元数据里，插件删了也还在）
    console.info('[' + APP_NAME + '] 已卸载，数据原样留着');
}

export function onEnable() {
    console.info('[' + APP_NAME + '] 已启用');
}

export function onDisable() {
    console.info('[' + APP_NAME + '] 已停用（数据保留）');
}

/* ---------- 启动 ---------- */

function boot() {
    try {
        const ctx = typeof SillyTavern !== 'undefined' && SillyTavern && typeof SillyTavern.getContext === 'function'
            ? SillyTavern.getContext()
            : null;
        if (!ctx) {
            console.warn('[万象阁] 没拿到酒馆上下文，插件先歇着');
            return;
        }
        setContext(ctx);
        bindEvents(ctx);

        // 面板挂进扩展设置区（异步渲染模板，不挡启动）
        mountPanel(VERSION).then(() => {
            bindEvents(ctx);
            renderPanel();
        }).catch((e) => {
            console.warn('[万象阁] 面板挂载出错：', e);
        });

        // 异步准备：把已有聊天的卡片按账本挂回去，不阻塞酒馆就绪
        setTimeout(() => {
            try {
                mountAllCards();
                renderPanel();
                restoreCards();
            } catch (e) {
                console.warn('[万象阁] 首屏同步出错：', e);
            }
        }, 800);
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
        source.on(types.APP_READY, () => {
            boot();
        });
        // 首屏已经就绪时才挂监听：APP_READY 会自动补发一次
        if (typeof ctx.isReady === 'boolean' && ctx.isReady === true) {
            boot();
        }
        return;
    }

    // 兜底：拿不到事件系统就稍后直接启动
    setTimeout(boot, 1500);
})();
