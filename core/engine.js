/**
 * 万象阁 · 注入执行层（就一件事：正文生成前，把这一轮的召回内容送进请求）
 *
 * ⭐ 口径：召回是一个动作、两个面——
 *    发消息那一刻算一次（core/actions.js），这里把**同一份内容**作为临时消息送进请求，
 *    位置就在她这条消息前面 ⇒ 主模型读到她这条回复时，等于"附在她的消息里"。
 *
 * ⚠️ 酒馆官方文档明确：拦截器拿到的 chat 数组是活引用，直接改会写进真实聊天记录；
 *    所以这里一律用克隆，正文一个字都不多。
 */

import { getChat, now } from './adapter.js';
import { findLastUserFloor } from './recall.js';
import { getSettings } from './settings.js';
import { putRecallRecord, getRecallRecord, getRecallRecordById } from './state.js';
import { countChars, trimText } from './utils.js';
import { commitLedger } from './ledger.js';
import { planRecall, enqueue } from './actions.js';
import { refreshCardOnFloor, renderPanel } from '../ui/render.js';

/** 全局设置里注入块的落款名（她说"别出现第三方名字"，这里只用本插件自己的名字） */
const NOTE_NAME = '万象阁';

/** 找出上一轮遗留的注入块（从后往前找最近的一条） */
function findOwnNote(list) {
    for (let i = list.length - 1; i >= 0; i -= 1) {
        const m = list[i];
        if (m && m.is_system === true && m.is_user === false && m.name === NOTE_NAME) {
            return i;
        }
    }
    return -1;
}

/** 两条消息是不是同一条（先看身份证，再看内容） */
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

/**
 * 找她这条发言在副本里的位置（清场后位置可能变了，所以按内容重认一次）。
 * 先按 mesId 认，再按内容认，最后退回"最后一条用户消息"。
 */
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

/** 记一次"空注入"，把原因写清楚（⛔ 不许静默退化） */
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
 * 正文生成前的拦截（由 manifest 声明的全局函数调用）。
 * @param {Array} chat 本次请求用的聊天数组（活引用，改前必克隆）
 * @param {number} contextSize 上下文长度
 * @param {Function} abort 中止生成
 * @param {string} type 触发类型（normal／regenerate／swipe／quiet 等）
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

    const list = Array.isArray(chat) ? chat : getChat();
    if (!Array.isArray(list) || !list.length) {
        return;
    }

    // 打杂生成（摘要、翻译、举手发言这类后台任务）不掺和，免得把召回声东击西带进去
    const kind = trimText(type).toLowerCase();
    if (kind === 'quiet' || kind === 'dryrun' || kind === 'dry_run') {
        return;
    }

    // 楼层号以**真实聊天记录**为准（请求副本里可能带着上一轮的临时消息，位置会错开）
    const real = getChat();
    const realFloor = Array.isArray(real) && real.length ? findLastUserFloor(real) : -1;
    const copyFloor = findLastUserFloor(list);
    if (realFloor < 0 && copyFloor < 0) {
        return;
    }

    // 清场：上一次没回滚干净留下的注入块（连续重抽时会有）先摘掉，保证同一时刻只有一份
    const existing = findOwnNote(list);
    if (existing >= 0) {
        list.splice(existing, 1);
    }

    // 她这条发言：副本里那一条是本次生成的对象（新发的消息一定在副本里）
    const realLead = realFloor >= 0 ? real[realFloor] : null;
    const copyLead = copyFloor >= 0 ? list[copyFloor] : null;

    let floor = -1;
    let lead = null;
    if (copyLead && (!realLead || isSameMessage([copyLead], realLead))) {
        // 两边是同一条 ⇒ 楼层以真实聊天记录为准（账本、卡片都按它挂）
        floor = realLead ? realFloor : copyFloor;
        lead = realLead || copyLead;
    } else if (copyLead) {
        // 副本跟真实聊天记录对不上（极少见）⇒ 就用副本自己算，别乱挂到别的楼上
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

        // 没算过（例如她直接点了重跑、换页重来）就现算一次
        if (!rec) {
            rec = await planRecall({ floor, leadText: trimText(lead && lead.mes), chat: list });
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

        // 插一条独立注记，位置就在她这条消息前面（只进本次请求，不碰聊天记录）
        //
        // ⭐ 为什么这么写（已对试验田 v1.18.0 源码逐条核过）：
        //   · openai.js `setOpenAIMessages`：role 只看 is_user（false ⇒ assistant），
        //     但紧接着有官方注释 `// 100% legal way to send a message as system`：
        //         if (chat[j].extra?.type === system_message_types.NARRATOR) role = 'system';
        //     ⇒ 打上 narrator 标记，请求里它就是一条正牌 **system** 消息，不会被当成
        //       "模型自己说过的话"或"一个叫万象阁的角色"（这正是 bug2）。
        //   · 同一段代码：names_behavior 加 `名字:` 前缀时会**跳过** narrator 类型
        //     ⇒ 不会出现 "万象阁:" 这种落款，内容干净。
        //   · 这条注记是**开关式**的：只存在于本次请求的副本里，**不留任何平台状态**
        //     （不用 setExtensionPrompt 那种"要记得清掉"的常驻位），下一轮/重抽都自洽。
        //   · 字段写干净、不从她那条消息克隆（免得把她的头像、名字、甚至是 user 身份带进来）。
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
            putRecallRecord(Object.assign({}, rec, {
                floor,
                injectStatus: 'ok',
                injectNote: '已附在本轮你的消息前面（请求里身份＝系统）',
                injectedAt: now(),
                injectedChars: countChars(text),
                injectType: trimText(type) || 'normal',
                injectAs: 'system',
            }));
            commitLedger();
            refreshCardOnFloor(floor);
            renderPanel();
        });
    } catch (e) {
        console.warn('[万象阁] 注入出错：', e);
        try {
            const rec = getRecallRecordById(leadMesId) || getRecallRecord(floor);
            if (rec) {
                await enqueue(() => {
                    putRecallRecord(Object.assign({}, rec, {
                        injectStatus: 'error',
                        injectNote: '注入时出错：' + (e && e.message ? e.message : String(e)),
                    }));
                    commitLedger();
                    refreshCardOnFloor(floor);
                    renderPanel();
                });
            }
        } catch (inner) {
            console.warn('[万象阁] 回执写入也失败了：', inner);
        }
    }
}

