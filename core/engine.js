/**
 * 万象阁 · 注入执行层（正文生成前，把这一轮的召回内容送进请求）
 *
 * ⭐ 口径：召回是一个动作、两个面——发消息那一刻算一次，这里把**同一份内容**
 *    作为临时消息送进请求，位置就在她这条消息前面 ⇒ 主模型读到她这条回复时，等于"附在她的消息里"。
 *
 * ⚠️ 关于"改数组会不会污染聊天记录"（条 8 校订过的说法·含实测源码）：
 *   · 酒馆在 `Generate()` 里先 `let coreChat = chat.filter(...)` —— **它自己做的就是一份副本**，
 *     然后把这份副本交给拦截器（`runGenerationInterceptors(coreChat, …)`），
 *     拦截器**必须原地改它**才生效（酒馆不再接收返回值）。
 *   · ⇒ 结论：**原地 splice 是唯一正确的做法**，⛔ 不能改成"拷贝一份再改"（那样注入直接失效）。
 *   · 同时我们也**绝不改任何原有消息对象**（只 splice 自己新造的那一条），
 *     并且清场时只摘"自己上一轮留下的那条注记"⇒ 真实聊天记录一个字都不多（有断言把关）。
 *
 * ⭐ 身份：打上 narrator 标记 ⇒ 请求里是正牌 **system** 消息（不做成 assistant，免得被当角色发言）。
 */

import { getChat, now } from './adapter.js';
import { findLastUserFloor } from './recall.js';
import { getSettings } from './settings.js';
import { putRecallRecord, getRecallRecord, getRecallRecordById } from './state.js';
import { countChars, trimText } from './utils.js';
import { commitLedger } from './ledger.js';
import { planRecall, enqueue } from './actions.js';
import { refreshCardOnFloor, renderPanel } from '../ui/render.js';

const NOTE_NAME = '万象阁';

/** 找上一轮遗留的注入块 */
function findOwnNote(list) {
    for (let i = list.length - 1; i >= 0; i -= 1) {
        const m = list[i];
        if (m && m.is_system === true && m.is_user === false && m.name === NOTE_NAME) {
            return i;
        }
    }
    return -1;
}

/** 两条消息是不是同一条 */
function isSameMessage(list, lead) {
    if (!Array.isArray(list) || !lead) {
        return false;
    }
    const mesId = trimText(lead.mesId);
    if (mesId) {
        for (const m of list) {
            if (m && m.is_user && !m.is_system && trimText(m.mesId) === mesId) {
                return true;
            }
        }
    }
    const text = trimText(lead.mes);
    if (!text) {
        return false;
    }
    for (const m of list) {
        if (m && m.is_user && !m.is_system && trimText(m.mes) === text) {
            return true;
        }
    }
    return false;
}

/** 她这条发言在副本里的位置 */
function locateLead(list, lead) {
    if (!lead) {
        return -1;
    }
    const mesId = trimText(lead.mesId);
    if (mesId) {
        for (let i = list.length - 1; i >= 0; i -= 1) {
            const m = list[i];
            if (m && m.is_user && !m.is_system && trimText(m.mesId) === mesId) {
                return i;
            }
        }
    }
    const text = trimText(lead.mes);
    if (text) {
        for (let i = list.length - 1; i >= 0; i -= 1) {
            const m = list[i];
            if (m && m.is_user && !m.is_system && trimText(m.mes) === text) {
                return i;
            }
        }
    }
    return findLastUserFloor(list);
}

function recordEmpty(floor, rec, reason) {
    putRecallRecord(Object.assign({}, rec, {
        injectStatus: 'empty',
        injectNote: reason,
        injectedAt: now(),
        injectedChars: 0,
    }));
    commitLedger();
    refreshCardOnFloor(floor);
    renderPanel();
}

/**
 * 正文生成前的拦截（manifest 里声明的全局函数调用它）。
 */
export async function injectBeforeGenerate(chat, contextSize, abort, type) {
    let settings;
    try {
        settings = getSettings();
    } catch (e) {
        console.warn('[万象阁] 读设置失败，本轮不注入：', e);
        return;
    }
    if (!settings.enabled) {
        return;
    }

    // ⚠️ 条 8 的结论（实测源码后）：酒馆传进来的 `coreChat` **就是它自己 filter 出来的副本**，
    //    而且它**只认原地改动**（不接收返回值）⇒ 这里必须**原地 splice**，
    //    ⛔ 绝不能"拷贝一份再改"（那样注入等于没插，模型根本看不到）。
    //    我们只 splice 自己新造的那一条，⛔ 不动任何原有消息对象。
    const fromTavern = Array.isArray(chat);
    const list = fromTavern ? chat : getChat().slice();
    if (!Array.isArray(list) || !list.length) {
        return;
    }

    // 打杂生成（摘要、翻译这类后台任务）不掺和
    const kind = trimText(type).toLowerCase();
    if (kind === 'quiet' || kind === 'dryrun' || kind === 'dry_run') {
        return;
    }

    // 楼层号以真实聊天记录为准
    const real = getChat();
    const realFloor = Array.isArray(real) && real.length ? findLastUserFloor(real) : -1;
    if (realFloor < 0 && findLastUserFloor(list) < 0) {
        return;
    }

    // 清场：上一轮遗留的注入块先摘掉
    const existing = findOwnNote(list);
    if (existing >= 0) {
        list.splice(existing, 1);
    }
    /*
     * ⭐ 修复单 #11：`copyFloor` 必须**在摘注入块之后**才算。
     *   原来先算后 splice：若上一轮那个注入块就在最后一条用户发言**前面**，
     *   摘掉之后所有下标前移 1 ⇒ `list[copyFloor]` 指到**错的那一楼**（引用错位）。
     */
    const copyFloor = findLastUserFloor(list);

    const realLead = realFloor >= 0 ? real[realFloor] : null;
    const copyLead = copyFloor >= 0 ? list[copyFloor] : null;

    let floor = -1;
    let lead = null;
    if (copyLead && (!realLead || isSameMessage([copyLead], realLead))) {
        floor = realLead ? realFloor : copyFloor;
        lead = realLead || copyLead;
    } else if (copyLead) {
        floor = copyFloor;
        lead = copyLead;
    } else if (realLead) {
        floor = realFloor;
        lead = realLead;
    }
    if (!lead) {
        return;
    }

    const anchor = locateLead(list, lead);
    if (anchor < 0) {
        return;
    }
    const leadMesId = trimText(lead.mesId);

    try {
        let rec = getRecallRecordById(leadMesId) || getRecallRecord(floor);

        if (!rec) {
            rec = await planRecall({ floor, chat: list, leadText: trimText(lead && lead.mes) });
        }
        if (!rec) {
            return;
        }

        const text = trimText(rec.injectedText);
        if (!text) {
            const reason = Array.isArray(rec.notes) && rec.notes.length
                ? rec.notes.join('；')
                : '本轮没有要带的内容';
            await enqueue(() => recordEmpty(floor, rec, reason));
            return;
        }

        // 插一条独立注记，就在她这条消息前面
        // ⭐ 打 narrator 标记 ⇒ 请求里它就是正牌 system 消息；且不会加"万象阁:"前缀
        const note = {
            name: NOTE_NAME,
            is_user: false,
            is_system: true,
            mes: text,
            send_date: now(),
            extra: { type: 'narrator' },
        };
        list.splice(anchor, 0, note);

        await enqueue(() => {
            const saved = putRecallRecord(Object.assign({}, rec, {
                floor,
                injectStatus: 'ok',
                injectNote: '已附在本轮你的消息前面（请求里身份＝系统）',
                injectedAt: now(),
                injectedChars: countChars(text),
                injectType: trimText(type) || 'normal',
                injectAs: 'system',
            }));
            commitLedger(saved);
            refreshCardOnFloor(floor);
            renderPanel();
        });
    } catch (e) {
        console.warn('[万象阁] 注入出错：', e);
        try {
            const rec = getRecallRecordById(leadMesId) || getRecallRecord(floor);
            if (rec) {
                await enqueue(() => {
                    const saved = putRecallRecord(Object.assign({}, rec, {
                        injectStatus: 'error',
                        injectNote: '注入时出错：' + (e && e.message ? e.message : String(e)),
                    }));
                    commitLedger(saved);
                    refreshCardOnFloor(floor);
                    renderPanel();
                });
            }
        } catch (inner) {
            console.warn('[万象阁] 回执写入也失败了：', inner);
        }
    }
}
