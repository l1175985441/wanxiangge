/**
 * 万象阁 · 动作层
 *
 * 把"发消息 → 算一次召回 → 存账 → 挂卡片 → 刷新面板"这条线串起来。
 * 所有重活都排进同一个队里按顺序跑，不并发抢写账本，也不挡酒馆界面。
 */

import { getChat, now } from './adapter.js';
import { buildRecall, assembleInjectText, findLastUserFloor } from './recall.js';
import { getSettings } from './settings.js';
import { putRecallRecord, getRecallRecord, dropRecallRecord, pruneRecallRecords } from './state.js';
import { commitLedger } from './ledger.js';
import { countChars, trimText } from './utils.js';
import { mountAllCards, refreshCardOnFloor, renderPanel } from '../ui/render.js';

/** 全局任务队：同一个时刻只有一件后台活在跑 */
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
    return enqueue(() => {
        const settings = getSettings();
        // 用传进来的这份聊天（拦截器给的是"请求副本"）；没传就用当前聊天记录
        const chat = Array.isArray(opts.chat) ? opts.chat : getChat();
        const floor = Number.isFinite(opts.floor) ? opts.floor : findLastUserFloor(chat);
        if (floor < 0) {
            return null;
        }
        const leadText = trimText(opts.leadText) || trimText(chat[floor] && chat[floor].mes);

        const recall = buildRecall({ chat, leadFloor: floor, leadText });
        const text = settings.enabled ? assembleInjectText(recall.items, settings.injectHeader) : '';

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
            injectedChars: countChars(text),
            injectedAt: 0,
            injectStatus: 'pending',
            injectNote: '',
            injectType: '',
            shown: false,
        });

        commitLedger();
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

/** 新楼生成完：刷新一次（卡片＋面板） */
export function afterMessageReceived() {
    return enqueue(() => {
        commitLedger();
        mountAllCards();
        renderPanel();
    });
}

/** 切聊天／新开档：账本换一份，卡片按新账本重挂 */
export function onChatSwitched() {
    return enqueue(() => {
        mountAllCards();
        renderPanel();
    });
}

/** 楼层删掉：账跟着对账（软保护：拿不到聊天长度就不动手） */
export function reconcileAfterDelete() {
    return enqueue(() => {
        const chat = getChat();
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
        mountAllCards();
        renderPanel();
        const latest = getChat();
        if (Array.isArray(latest) && latest.length) {
            pruneRecallRecords(latest.length, findLastUserFloor(latest));
        }
    });
}

/** 面板上那行"上次更新"用得到的时间戳 */
export function lastActivityAt() {
    const rec = getRecallRecord(findLastUserFloor(getChat()));
    return rec ? rec.at : now();
}
