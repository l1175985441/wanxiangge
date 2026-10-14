/**
 * 万象阁 · 动作层
 *
 * "发消息 → 算一次召回 → 存账 → 挂卡片 →（生成完）后台更新"这条线串在这里。
 * 重活排进同一个队里按顺序跑：不并发抢写账本，也不挡酒馆界面。
 */

import { getChat, now } from './adapter.js';
import { buildRecall, assembleInjectText, findLastUserFloor, injectSize } from './recall.js';
import { getSettings, effectivePrompt } from './settings.js';
import { putRecallRecord, dropRecallRecord, pruneRecallRecords, getRecallRecord, loadState } from './state.js';
import { commitLedger } from './ledger.js';
import { trimText } from './utils.js';
import { mountAllCards, refreshCardOnFloor, renderPanel } from '../ui/render.js';
import { runUpdate, shouldUpdateNow, isRunning as isUpdating, runReconcile } from './pipeline.js';
import { refreshAffinity } from './worldbook.js';
import { markBookDirty } from './book.js';

let queue = Promise.resolve();

/** 排队执行（出错只记日志，不让整个插件停摆） */
export function enqueue(task) {
    const run = () => Promise.resolve()
        .then(task)
        .catch((e) => {
            console.warn('[万象阁] 后台任务出错：', e);
            return null;
        });
    queue = queue.then(run, run);
    return queue;
}

/**
 * 算一次召回并存账。
 * ⭐ 这一次算出来的东西同时供两处用：注入给主模型（文字面）＋ 卡片给她看（显示面）。
 */
export function planRecall(options) {
    const opts = options || {};
    return enqueue(async () => {
        const settings = getSettings();
        const chat = Array.isArray(opts.chat) ? opts.chat : getChat();
        const floor = Number.isFinite(opts.floor) ? opts.floor : findLastUserFloor(chat);
        if (floor < 0) {
            return null;
        }
        const leadText = trimText(opts.leadText) || trimText(chat[floor] && chat[floor].mes);

        // 顺手把"手机"里的好感读一遍（源更新了，读到的就是新的）
        try {
            await refreshAffinity();
        } catch (e) {
            console.warn('[万象阁] 读好感出错：', e);
        }

        const recall = buildRecall({ chat, leadFloor: floor, leadText });
        // ⚠️ 送进去的和记下来的必须是**同一串**（免得字数对不上）
        // ⭐ anchorFloor：本回合锚点楼 —— 过去经历的"楼层裁"按它算距离
        const text = settings.enabled
            ? trimText(assembleInjectText(recall.items, recall.events, effectivePrompt('header'), { anchorFloor: floor }))
            : '';

        const rec = putRecallRecord({
            floor,
            mesId: recall.mesId,
            at: recall.at,
            lead: leadText,
            from: recall.from,
            items: recall.items,
            events: recall.events,
            chars: recall.chars,
            notes: recall.notes,
            injectedText: text,
            injectedChars: injectSize(text),
            injectedAt: 0,
            injectStatus: 'pending',
            injectNote: '',
            injectType: '',
            shown: false,
        });

        commitLedger(rec);
        refreshCardOnFloor(floor);
        renderPanel();
        return rec;
    });
}

/** 手动"重算本楼" */
export function replanCurrentFloor() {
    const chat = getChat();
    const floor = findLastUserFloor(chat);
    if (floor < 0) {
        return Promise.resolve(null);
    }
    return planRecall({ floor });
}

/**
 * 新楼生成完：刷新卡片与面板，然后（按频率）在后台更新世界与角色状态。
 * ⛔ 更新一定不挡她聊天：先返回，活交给后台。
 */
export function afterMessageReceived(floor) {
    return enqueue(() => {
        commitLedger();
        mountAllCards(2, 900);
        renderPanel();

        const settings = getSettings();
        if (!settings.enabled || !settings.autoUpdate) {
            return null;
        }
        const chat = getChat();
        const at = Number.isFinite(floor) ? floor : chat.length - 1;
        if (at < 0) {
            return null;
        }
        if (!shouldUpdateNow(at)) {
            return null;   // 频率没到（每 N 回合）
        }
        if (isUpdating()) {
            return null;   // 上一轮还没跑完
        }
        // 放后台跑，不 await（免得挡住界面）
        setTimeout(() => {
            runUpdate({ manual: false, floor: at }).then(() => {
                markBookDirty();
                mountAllCards(1, 600);
                renderPanel();
            }).catch((e) => console.warn('[万象阁] 后台更新出错：', e));
        }, 1200);
        return null;
    });
}

/** 切聊天／新开档 */
export function onChatSwitched() {
    return enqueue(() => {
        mountAllCards(2, 900);
        renderPanel();
    });
}

/** 楼层删掉：账跟着对账（重定位楼号＋软保护） */
export function reconcileAfterDelete() {
    return enqueue(() => {
        const chat = getChat();
        runReconcile();
        pruneRecallRecords(chat.length);
        mountAllCards();
        renderPanel();
    });
}

/** 某楼被编辑：这一楼如果带账，就把卡片撤掉重算 */
export function onFloorEdited(floor) {
    return enqueue(() => {
        if (dropRecallRecord(floor)) {
            refreshCardOnFloor(floor);
        }
        renderPanel();
    });
}

/** 首屏／重开酒馆：按账本把卡片挂回去 */
export function restoreCards() {
    return enqueue(() => {
        mountAllCards(3, 1200);
        renderPanel();
        const chat = getChat();
        if (Array.isArray(chat) && chat.length) {
            pruneRecallRecords(chat.length, findLastUserFloor(chat));
        }
    });
}

/** 面板上那行"上次更新"用得到的时间戳 */
export function lastActivityAt() {
    const rec = getRecallRecord(findLastUserFloor(getChat()));
    return rec ? rec.at : now();
}

/** 顺手暴露一下状态（面板用） */
export function pipelineState() {
    return loadState().pipeline || {};
}
