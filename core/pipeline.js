/**
 * 万象阁 · 更新流水（世界状态＋角色七格＋平行事件＋编年）
 *
 * 一次更新＝**一个请求**（十几个角色合并成一次结构化输出），⛔ 不许一轮各发一个请求。
 * 规矩都写在这里：
 *   · 单请求 ≤ 2 分钟（超时如实报错）；
 *   · 失败看得见、重试有**上限**（⛔ 不无限重试）；
 *   · 更新前留快照（能撤回）；
 *   · 手改过的字段⛔ 不许无脑冲掉（以她的版本为准，并记一条冲突说明）；
 *   · 在正文现场的角色只做"总结正文里已写的"，不在场的才靠推演；
 *   · 暗线按**世界钟**推进（⛔ 不按回合数）；
 *   · 补推历史分批、可取消、⛔ 不卡界面；隐藏楼层照读。
 */

import { CALLS_PER_TURN, RETRY_LIMIT } from './config.js';
import { getChat } from './adapter.js';
import { getSettings, effectivePrompt, fillTemplate } from './settings.js';
import {
    loadState, saveState, takeSnapshot, addChronicle, pushPast, pushStep, upsertHidden, setEvents,
    updateWorld, upsertQuest,
} from './state.js';
import { callModelJson } from './apiclient.js';
import { cleanMessages, isHiddenMessage } from './extract.js';
import { isLineDue, nextStage, isLineDone, clockWentBackwards } from './clock.js';
import { markBookDirty } from './book.js';
import { trimText, asText, clampNumber, uniqueBy, floorLabel } from './utils.js';
import { mentionedCharacters } from './recall.js';

let running = false;
let cancelRequested = false;

/** 正在跑吗 */
export function isRunning() {
    return running;
}

/** 请求取消（跑完当前这一小步就停） */
export function cancelUpdate() {
    cancelRequested = true;
    const state = loadState();
    state.pipeline = Object.assign({}, state.pipeline, {
        cancelRequested: true,
        text: '收到取消请求，跑完当前这一小步就停',
    });
    saveState();
}

/**
 * 这句话里有没有"下一步动作／预判"的写法（需求书点名的污染源）。
 * ⚠️ 只用于"标记成不可靠"，⛔ 不擅自改她的字、也不静默丢掉。
 */
const PREDICT_PAT = /下一步|接下来(?:要|会|去|就)|后续(?:预测|会|将)|准备(?:去|要|着)|即将(?:去|要|会)|打算(?:去|要)|等下(?:要|去)|待会儿(?:要|去)|然后(?:就)?(?:去|要)|明天(?:要|会|去)|稍后(?:要|会)/;

/** 文案里是否含"下一步／预判" */
export function looksLikePrediction(text) {
    return PREDICT_PAT.test(asText(text));
}

/**
 * 这段"正在经历"能不能在正文里找到依据（现场角色专用）。
 *
 * ⚠️ 判定口径要**宽**：同一件事换个说法（"在码头清点货物" vs "码头清点着货物"）必须算通过，
 *    否则天天误报，她会把这个提醒当噪音。所以不看"逐字包含"，而看**二元组覆盖率**：
 *    把这一段切成两字一组，数有多少组也出现在正文里；覆盖不到 34% 才判"正文里没有"。
 */
export function textAppearsIn(text, source) {
    const a = asText(text).replace(/[\s，。、；：！？,.;:!?"'（）()【】《》…—-]/g, '');
    const b = asText(source).replace(/\s+/g, '');
    if (!a || !b) {
        return false;
    }
    if (a.length <= 2) {
        return b.includes(a);
    }
    const grams = [];
    for (let i = 0; i + 2 <= a.length; i += 1) {
        grams.push(a.slice(i, i + 2));
    }
    let hit = 0;
    for (const g of grams) {
        if (b.includes(g)) {
            hit += 1;
        }
    }
    return (hit / grams.length) >= 0.34;
}

function setPipeline(patch) {
    const state = loadState();
    state.pipeline = Object.assign({}, state.pipeline, patch);
    saveState();
}

/* ------------------------------ 取材料 ------------------------------ */

/** 最近 N 楼的正文（含隐藏楼：⛔ 不许因为被隐藏就漏掉） */
function recentMessages(floor, turns) {
    const chat = getChat();
    const n = clampNumber(turns, 1, 40, 6);
    const end = Number.isFinite(floor) && floor >= 0 ? floor + 1 : chat.length;
    const start = Math.max(0, end - n);
    const out = [];
    for (let i = start; i < end; i += 1) {
        const m = chat[i];
        if (!m || !trimText(m.mes)) {
            continue;
        }
        out.push({ floor: i, mes: m.mes, isUser: m.is_user === true, hidden: isHiddenMessage(m) });
    }
    return out;
}

/** 这一楼正文里出现了哪些名册上的人（认全名与别名；决定谁"在现场"） */
function whoIsOnStage(text, roster) {
    // ⭐ 走召回那套统一判定（漏了单字名会让前台角色被误当"不在场"去自由推演）
    return mentionedCharacters(text, roster);
}

/* ------------------------------ 世界状态那一步 ------------------------------ */

async function stepWorld(material) {
    const settings = getSettings();
    const state = loadState();
    const world = state.world || {};
    const hiddenLines = (world.hidden || [])
        .filter((h) => !isLineDone(h.stage))
        .map((h) => {
            const due = isLineDue(h, world.clock);
            return '· ' + h.name + '【' + h.stage + '】 到点条件：' + (h.trigger || '（没写）')
                + ' ｜ 火候：' + (h.tier || '几天内')
                + ' ｜ 现状：' + (h.note || '（没写）')
                + ' ｜ 现在到点了吗：' + (due.due ? '到了（可以推进）' : '没到（⛔ 保持原样）——' + due.why);
        })
        .join('\n') || '（还没有暗线）';

    const prompt = fillTemplate(effectivePrompt('world'), {
        world: [
            '世界钟：' + (trimText(world.clock) || '未知'),
            world.place ? '地点：' + trimText(world.place) : '',
            world.bigPicture ? '总览：' + trimText(world.bigPicture) : '',
            '局势：' + ((world.situations || []).map((s) => trimText(s.title)).filter(Boolean).join('；') || '（还没有）'),
        ].filter(Boolean).join('\n'),
        clock: trimText(world.clock) || '未知',
        recent: material.recentText || '（没有可读的正文）',
        hidden: hiddenLines,
    });

    const res = await callModelJson({
        prompt,
        // ⛔ 破限词必须**真的发出去**：留空时要用内置那份（原来只读了原始设置 ⇒ 留空就等于没发）
        system: effectivePrompt('jailbreak'),
        maxTokens: clampNumber((settings.api || {}).maxTokens, 200, 8000, 1600),
    });

    if (!res.ok) {
        return { ok: false, reason: res.reason };
    }
    const v = res.value || {};

    // 世界钟：只接受"往前走"的钟（模型写倒退就保留旧的并记一条）
    const notes = [];
    const newClock = trimText(v.clock);
    if (newClock && newClock !== '未知') {
        if (clockWentBackwards(world.clock, newClock)) {
            notes.push('模型给的世界钟比原来早（' + asText(world.clock) + ' → ' + newClock + '），已保留原来的，没让它倒退');
        } else {
            updateWorld({ clock: newClock }, {});
        }
    } else {
        notes.push('这次没读出世界钟，保持不变（' + (trimText(world.clock) || '未知') + '）');
    }
    if (trimText(v.place)) {
        updateWorld({ place: trimText(v.place) }, {});
    }
    if (trimText(v.bigPicture)) {
        updateWorld({ bigPicture: trimText(v.bigPicture) }, {});
    }

    // 局势
    const situations = Array.isArray(v.situations) ? v.situations : [];
    if (situations.length) {
        const fresh = situations.map((s) => ({
            title: trimText(s && (s.title || s.text)),
            sides: trimText(s && s.sides),
            tier: trimText(s && s.tier),
            at: Date.now(),
            floor: material.floor,
        })).filter((s) => s.title);
        if (fresh.length) {
            updateWorld({ situations: fresh }, {});
        }
    }

    // 暗线：到点才推进（⛔ 不看回合数）
    const hiddenIn = Array.isArray(v.hidden) ? v.hidden : [];
    let advanced = 0;
    let blocked = 0;
    const currentClock = loadState().world.clock;
    for (const raw of hiddenIn) {
        const name = trimText(raw && raw.name);
        if (!name) {
            continue;
        }
        const existing = loadState().world.hidden.find((h) => h.name === name);
        const stageIn = trimText(raw.stage);
        if (existing) {
            const due = isLineDue(existing, currentClock);
            const wantsAdvance = raw.advance === true || (stageIn && stageIn !== existing.stage);
            if (wantsAdvance && !due.due) {
                blocked += 1;
                existing.note = trimText(raw.note) || existing.note;
                continue;   // 没到点：⛔ 不许提前冒头
            }
            upsertHidden({
                name,
                stage: stageIn || (wantsAdvance ? nextStage(existing.stage, existing.kind) : existing.stage),
                trigger: trimText(raw.trigger) || existing.trigger,
                tier: trimText(raw.tier) || existing.tier,
                note: trimText(raw.note) || existing.note,
            });
            if (wantsAdvance && due.due) {
                advanced += 1;
                addChronicle({
                    floor: material.floor,
                    kind: '暗线推进',
                    who: name,
                    text: '「' + name + '」推进到【' + (stageIn || nextStage(existing.stage, existing.kind)) + '】（' + due.why + '）',
                    clock: currentClock,
                });
            }
        } else {
            const fresh = upsertHidden({
                name,
                stage: stageIn || '萌芽',
                trigger: trimText(raw.trigger),
                tier: trimText(raw.tier) || '几天内',
                note: trimText(raw.note),
                kind: trimText(raw.kind),
            });
            if (fresh) {
                addChronicle({
                    floor: material.floor,
                    kind: '暗线新增',
                    who: name,
                    text: '新暗线「' + name + '」：' + (fresh.note || fresh.trigger || ''),
                    clock: currentClock,
                });
            }
        }
    }

    // 派生成"世界事件"（召回用）
    const worldNow = loadState().world;
    const events = [];
    for (const s of worldNow.situations || []) {
        events.push({ title: s.title, text: s.sides, kind: 'situation', sides: s.sides, tier: s.tier, floor: material.floor });
    }
    for (const h of worldNow.hidden || []) {
        if (isLineDone(h.stage)) {
            continue;
        }
        events.push({ title: h.name, text: h.note || h.trigger, kind: 'hidden', stage: h.stage, tier: h.tier, floor: material.floor });
    }
    if (events.length) {
        setEvents(events);
    }

    const summary = '世界状态已更新：局势 ' + String((worldNow.situations || []).length)
        + ' 条、暗线 ' + String((worldNow.hidden || []).length) + ' 条'
        + (advanced ? '（推进 ' + String(advanced) + ' 条）' : '')
        + (blocked ? '（' + String(blocked) + ' 条没到点，摁住了）' : '')
        + (notes.length ? '；' + notes.join('；') : '');

    return { ok: true, summary, notes, events: events.length };
}

/* ------------------------------ 角色那一步 ------------------------------ */

/** 把模型给的字符字段安全地写回（手改过的⛔ 不许冲掉） */
function applyCharacter(raw, material, conflicts) {
    const state = loadState();
    const name = trimText(raw && (raw.name || raw.character));
    if (!name) {
        return null;
    }
    let c = state.characters.find((x) => x.name === name)
        || state.characters.find((x) => (x.aliases || []).includes(name));
    let isNew = false;
    if (!c) {
        // 新认的人：自动建档（⛔ 不打扰她），但打标记让她一眼看得见
        c = {
            id: 'wxg_' + Math.random().toString(36).slice(2, 9),
            name,
            aliases: [],
            past: [],
            schedule: [],
            steps: [],
            isNew: true,
            createdAt: Date.now(),
            updatedAt: Date.now(),
        };
        state.characters.push(c);
        state.newPeople = uniqueBy((state.newPeople || []).concat([name]), (x) => x);
        isNew = true;
    }

    const onStage = raw.onStage === true;
    const patch = { lastUpdatedAt: Date.now() };
    patch.lastSeenFloor = material.floor;
    patch.inScene = onStage;

    const textFields = ['age', 'identity', 'faction', 'timePlace', 'current'];
    for (const f of textFields) {
        const incoming = trimText(raw && raw[f]);
        if (!incoming) {
            continue;
        }
        const old = trimText(c[f]);
        if (old && c.manual && old !== incoming) {
            conflicts.push(c.name + ' 的「' + f + '」她手改过，保留她的版本（模型想改成：' + incoming.slice(0, 40) + '）');
            continue;
        }
        patch[f] = incoming;
    }

    // 好感：只"读"，⛔ 不自己加减、不自己编（模型给的只当参考，若她没接数据源就照抄）
    const incomingAff = trimText(raw && raw.affinity);
    if (incomingAff && incomingAff !== '未知' && !trimText(c.affinitySource)) {
        const old = trimText(c.affinity);
        if (!(old && c.manual && old !== incomingAff)) {
            patch.affinity = incomingAff;
        }
    }

    // 世界钟的连续性：时间地点里若含时间，倒退就记一条异常（不覆盖）
    if (patch.timePlace) {
        const back = clockWentBackwards(extractClockFromPlace(c.timePlace), extractClockFromPlace(patch.timePlace));
        if (back) {
            conflicts.push(c.name + ' 的时间地点看着往回走了（' + c.timePlace + ' → ' + patch.timePlace + '），已保留原文，请你看一眼');
            delete patch.timePlace;
        }
    }

    Object.assign(c, patch);
    c.updatedAt = Date.now();
    // 正在经历：平行线的"这一步"（写进 steps 留档；旧的自然淡化）
    const cur = trimText(raw && raw.current);
    if (cur) {
        /*
         * ⭐ 污染的正门在这儿（她点名的）：模型在"正在经历"里写了**下一步动作／预判**，
         *    以前只记一条提醒、**那句话照样当成事实存下来** ⇒ 下一回合又被喂回给它，
         *    于是长出"正文里根本没有的假事件"。
         * ⛔ 现在的处理：**标记成不可靠**（suspect），并在编年里留一条可查的记录。
         *    · 不擅自改它的字（那是她的账本）；
         *    · 不静默丢掉（她要能看见"引擎自己知道这条不牢"）；
         *    · 注入时会把"⚠ 疑似越界的预判"一并写给她/模型看 ⇒ 不会被当成既定事实。
         *
         * ⭐ 现场角色再加一道（她逐字口径："正在在线的不准编造，只准写正文的"）：
         *    正文里**找不到**他这段"正在经历" ⇒ 判定为编造，一样标记不可靠。
         */
        let why = '';
        if (looksLikePrediction(cur)) {
            why = '写到了"下一步动作／预判"，按需求书不算事实（下一步该由你回话决定）';
        } else if (onStage && !textAppearsIn(cur, material.rawText || material.recentText)) {
            why = '这是现场角色，但正文里找不到这段描写 ⇒ 视为编造（现场角色只准做正文的总结）';
        }
        if (why) {
            c.currentSuspect = true;
            c.currentSuspectWhy = why;
            conflicts.push(c.name + ' 的「正在经历」：' + why + '（' + cur.slice(0, 30) + '…）');
            addChronicle({
                floor: material.floor,
                kind: onStage ? '⚠ 越界·现场编造' : '⚠ 越界·疑似预判',
                who: c.name,
                text: cur + '（' + why + '）',
                clock: loadState().world.clock,
            });
        } else {
            delete c.currentSuspect;
            delete c.currentSuspectWhy;
        }
        pushStep(c.id, cur, material.floor);
        addChronicle({
            floor: material.floor,
            kind: onStage ? '现场·总结' : '推演·这一步',
            who: c.name,
            text: cur,
            clock: loadState().world.clock,
        });
    }

    // 过去经历（第一人称，由近到远）
    // ⚠️ 模型给的是"由近到远"；而 pushPast 是往**队首**插的
    //    ⇒ 必须**倒着**推，否则顺序会被反过来（自审修正·条 10）
    // ⭐ 带上来源楼层：注入时按"楼层裁"过滤（最近 N 楼之内的不端）
    const past = Array.isArray(raw && raw.past) ? raw.past : [];
    for (const p of past.slice(0, 5).reverse()) {
        pushPast(c.id, p, 5, material.floor);
    }

    // 日程：约好的事要记下、到点跟上
    const schedule = Array.isArray(raw && raw.schedule) ? raw.schedule : [];
    if (schedule.length) {
        for (const s of schedule) {
            const what = trimText(s && (s.what || s.text));
            if (!what) {
                continue;
            }
            if (!c.schedule.some((x) => x.what === what)) {
                c.schedule.push({ what, due: trimText(s && s.due), done: false });
            }
        }
    }

    // 日程到点判断（按世界钟，⛔ 不按回合）
    const clock = loadState().world.clock;
    for (const s of c.schedule) {
        if (s.done || !trimText(s.due)) {
            continue;
        }
        const due = isLineDue({ trigger: s.due, tier: '几天内' }, clock);
        if (due.due) {
            s.done = true;
            addChronicle({ floor: material.floor, kind: '日程到点', who: c.name, text: s.what + '（' + due.why + '）', clock });
        }
    }

    // ⭐ 任务（主线／支线）：模型在 chars 里随行给的 quests（按角色名归位；也认顶层 quests）
    const quests = collectQuests(raw, c);

    return { name: c.name, isNew, quests };
}

async function stepCharacters(material) {
    const settings = getSettings();
    const state = loadState();
    const roster = state.characters.filter((c) => !c.ignored);
    if (!roster.length) {
        return { ok: true, summary: '名册是空的，角色这一步跳过（先去面板录人）' };
    }

    // ⭐ 判"谁在现场"要看**原文**（清洗可能剥掉状态栏，剥过的文本会冤枉人）
    const onStage = whoIsOnStage(material.rawText || material.recentText, roster);
    const onStageIds = new Set(onStage.map((c) => c.id));

    // 不在场的：按"轮转＋封顶"挑，省额度（⛔ 不一轮全推）
    const maxParallel = clampNumber(settings.maxParallelChars, 0, 12, 6);
    const bench = roster.filter((c) => !onStageIds.has(c.id) && !c.isPlayer);
    const rotated = bench.slice().sort((a, b) => (a.lastUpdatedAt || 0) - (b.lastUpdatedAt || 0));
    const pickedBench = rotated.slice(0, Math.max(0, maxParallel));

    // "我"（玩家棋子）**不建自己的推演行**——他的存在由**别人**的行侧面承载
    // （见提示词规矩 2／14：说话、看、递、反应）。这里的过滤是**有意保留**的（N4）。
    const picked = onStage.filter((c) => !c.isPlayer).concat(pickedBench);
    if (!picked.length) {
        return { ok: true, summary: '这一轮没有要处理的角色（都在省额度轮转里）' };
    }

    const charLines = picked.map((c) => {
        const inScene = onStageIds.has(c.id);
        const lines = [
            // c.isPlayer 不会为真（上面已过滤）；留着是为将来放开时也能显示对
            '· ' + c.name + '（' + (inScene ? '现场' : '不在场') + (c.isPlayer ? '／玩家棋子' : '') + '）',
            '  现有：年龄 ' + (trimText(c.age) || '未知')
            + ' ｜ 身份 ' + (trimText(c.identity) || '未知')
            + ' ｜ 势力 ' + (trimText(c.faction) || '未知')
            + ' ｜ 好感 ' + (trimText(c.affinity) || '未接入')
            + ' ｜ 时间地点 ' + (trimText(c.timePlace) || '未知'),
        ];
        if (trimText(c.current)) {
            lines.push('  上一轮"正在经历"：' + trimText(c.current));
        }
        if (c.past.length) {
            lines.push('  过去经历（由近到远）：' + c.past.map((p) => p.text).join('；'));
        }
        if (c.schedule.length) {
            lines.push('  日程：' + c.schedule.filter((s) => !s.done).map((s) => s.what + (s.due ? '（' + s.due + '）' : '')).join('；'));
        }
        lines.push('  ' + (inScene
            ? '⚠️ 他在正文现场：只许总结正文里已经写了的他的事，⛔ 正文没写的（尤其下一步动作）一律不许写。'
            + '✅ 可以照正文那样**侧面带"我"**（对"我"说／看向"我"／把东西放到"我"面前／对"我"的反应）；'
            + '⛔ 但"我"自己的动作、台词、神态、位置一个字都不许写。'
            : '他不在正文现场（暗地）：现状只能靠推演写，只写"这一步"（正在进行时／刚做完），⛔ 不写下一步；'
            + '⛔ 这一段里**不许出现"我"**（"我"的动静影响不到他）。'));
        return lines.join('\n');
    }).join('\n');

    const prompt = fillTemplate(effectivePrompt('chars'), {
        clock: trimText(loadState().world.clock) || '未知',
        world: [
            trimText(loadState().world.bigPicture),
            ((loadState().world.situations || []).map((s) => trimText(s.title)).filter(Boolean).join('；') || ''),
        ].filter(Boolean).join('\n') || '（还没有记录）',
        recent: material.recentText || '（没有可读的正文）',
        chars: charLines,
    });

    const res = await callModelJson({
        prompt,
        // ⛔ 破限词必须**真的发出去**：留空时用内置那份
        system: effectivePrompt('jailbreak'),
        maxTokens: clampNumber((settings.api || {}).maxTokens, 200, 8000, 1600),
    });
    if (!res.ok) {
        return { ok: false, reason: res.reason };
    }

    const v = res.value || {};
    const rows = Array.isArray(v.chars) ? v.chars : (Array.isArray(v.characters) ? v.characters : []);
    if (!rows.length) {
        return { ok: false, reason: '模型没按格式给出角色（chars 是空的）' };
    }

    const conflicts = [];
    let written = 0;
    let newPeople = 0;
    let questCount = 0;
    for (const raw of rows) {
        const row = Object.assign({}, raw);
        // 现场标记由我们决定（⛔ 不让模型自己选，免得它把在场的人当不在场去推演）
        const found = picked.find((c) => c.name === trimText(raw && raw.name));
        row.onStage = found ? onStageIds.has(found.id) : false;
        const done = applyCharacter(row, material, conflicts);
        if (done) {
            written += 1;
            if (done.isNew) {
                newPeople += 1;
            }
            // ⭐ 任务落账（主线／支线）：模型给了才写，⛔ 没给不留空壳
            if (Array.isArray(done.quests) && done.quests.length) {
                const who = loadState().characters.find((x) => x.name === done.name);
                if (who) {
                    for (const q of done.quests) {
                        upsertQuest(who.id, q);
                        questCount += 1;
                    }
                }
            }
        }
    }

    // 退化要出声：万一模型替"我"写了动作，记一条给她看（⛔ 不静默）
    const meHits = checkActingAsMe(rows, material.floor);

    // 世界钟那一步可能带回来更新过的钟，这里再补读一次
    const clockNow = trimText(v.clock);
    if (clockNow && clockNow !== '未知' && !clockWentBackwards(loadState().world.clock, clockNow)) {
        updateWorld({ clock: clockNow }, {});
    }

    if (conflicts.length) {
        setPipeline({ conflicts: conflicts.slice(0, 20) });
    }

    const summary = '角色状态＋平行事件已更新：写了 ' + String(written) + ' 人'
        + '（现场 ' + String(onStage.length) + ' 人、轮转 ' + String(pickedBench.length) + ' 人）'
        + (newPeople ? '，其中新认 ' + String(newPeople) + ' 人' : '')
        + (questCount ? '，任务 ' + String(questCount) + ' 条' : '')
        + (conflicts.length ? '；有 ' + String(conflicts.length) + ' 处与她手改的版本冲突，已按她的版本保留' : '')
        + (meHits ? '；有 ' + String(meHits) + ' 处写到"我"，请看一眼' : '');

    return { ok: true, summary, written, conflicts };
}

/**
 * 从模型回包里把这个角色的任务挑出来。
 * 两种写法都认：① 跟在角色行里（`chars[i].quests`）；② 顶层 `quests` 数组里按 `name` 归位。
 * ⛔ 没料就返回空数组（不留空壳）。
 */
function collectQuests(raw, c) {
    const mine = Array.isArray(raw && raw.quests) ? raw.quests.filter(Boolean) : [];
    const top = Array.isArray(raw && raw.allQuests) ? raw.allQuests.filter(Boolean) : [];
    const out = mine.slice();
    for (const q of top) {
        const who = trimText(q && (q.name || q.character));
        if (who && who === c.name) {
            out.push(q);
        }
    }
    return out.filter((q) => trimText(q && q.title));
}

/**
 * 退化要出声：模型万一**替"我"**写了东西，记一条说明让她看得见（⛔ 不许静默退化）。
 * 内容不动她的字。
 *
 * ⭐ 口径（条 19 她当场裁定 · 侧面式）：**"别人对'我'做的事"是允许的**——
 *    说／问／喊、看／注视／审视、递／放／推给、狐疑／担心／等着回应……现场人物这么写是对的。
 *   ⛔ 只拦三件明确的事：
 *     ① "我"当主语＋动作（我站起来／我走出门）；
 *     ② 预判"我"（我接下来…）；
 *     ③ 改"我"处境的被动句（被赶出家门的我／被带走了）。
 *   ⛔ 不做"猜动词"那套（宁可少报，也不冤枉合规的侧面写法）。
 */
export function checkActingAsMe(rows, floor) {
    const hits = [];
    for (const raw of Array.isArray(rows) ? rows : []) {
        const name = trimText(raw && raw.name);
        // 模型能写、我们会落的**全部文本字段**都过一遍（不只是 current）
        const pieces = [];
        for (const f of ['current', 'timePlace', 'identity', 'age', 'faction']) {
            const text = trimText(raw && raw[f]);
            if (text) {
                pieces.push({ f, text });
            }
        }
        if (Array.isArray(raw && raw.past)) {
            const joined = raw.past.map((x) => trimText(x)).filter(Boolean).join('；');
            if (joined) {
                pieces.push({ f: 'past', text: joined });
            }
        }
        if (Array.isArray(raw && raw.schedule)) {
            const joined = raw.schedule
                .map((s) => [trimText(s && s.what), trimText(s && s.due)].filter(Boolean).join(' '))
                .filter(Boolean).join('；');
            if (joined) {
                pieces.push({ f: 'schedule', text: joined });
            }
        }
        // ⭐ 任务也算"模型写下的字"：子项里要是写了"下一步／明天去…"这种，
        //    跟"只写这一步"的规矩是同一个禁区 ⇒ 一样要拦住、要出声（⛔ 不静默）
        if (Array.isArray(raw && raw.quests)) {
            const joined = raw.quests.filter(Boolean).map((q) => {
                const items = Array.isArray(q && q.items)
                    ? q.items.map((i) => trimText(i && i.text)).filter(Boolean).join('、')
                    : '';
                return [trimText(q && q.title), items, trimText(q && q.note)].filter(Boolean).join(' ｜ ');
            }).filter(Boolean).join('；');
            if (joined) {
                pieces.push({ f: '任务', text: joined });
            }
        }

        for (const piece of pieces) {
            const text = piece.text;
            const reasons = [];

            // ① "我"当主语＋动作
            //    ⚠️ 中文里主语和动词之间常夹时间／地点（"我昨天跑去港口"），
            //       所以中间允许一小段非动作词（自审修正：原来要求紧挨着，会漏）
            const meVerb = /我[^，。；！？\n]{0,6}?(会|要|打算|准备|决定|走向|走进|拿起|转身|站起|坐下|离开|回到|赶往|说出|喊道|跑去|走出|看着|伸手|摇头|点头)/;
            if (meVerb.test(text)) {
                reasons.push('"我"自己做了动作');
            }
            // ② 预判"我"
            if (/我(接下来|之后|下一步|等会儿|一会儿)/.test(text)) {
                reasons.push('预判"我"接下来会怎样');
            }
            // ②b 任务里写"下一步动作／后续预测"（⛔ 跟"只写这一步"同一个禁区）
            if (/下一步|接下来(去|要|会)|后续预测|准备(去|要)|即将(去|要|前)去?/.test(text)) {
                reasons.push('写了"下一步动作／后续预测"（任务是目标层，⛔ 不写下一步）');
            }
            // ③ 改"我"处境的被动句（⛔ 侧面豁免不适用这类）
            const passive = text.match(/(被|给|让|叫)([^，。；！？]{0,8})我(带|拉|推|抱|赶|送|打|抓|拽|扔|丢|抬|背)/)
                || text.match(/被[^，。；！？]{0,6}的\s*我/);
            if (passive) {
                reasons.push('改了"我"的处境（' + passive[0] + '）');
            }

            if (reasons.length) {
                hits.push(name + ' 的「' + piece.f + '」里' + reasons.join('、') + '：' + text.slice(0, 40));
            }
        }
    }
    if (hits.length) {
        setPipeline({
            conflicts: hits.slice(0, 5),
            text: '注意：这一轮推演里有 ' + String(hits.length) + ' 处写到"我"（该由你自己决定的事）——内容留着没动，但请看一眼',
        });
        addChronicle({
            floor,
            kind: '退化提醒·写到"我"',
            who: '',
            text: hits.join('；'),
        });
    }
    return hits.length;
}

/* ------------------------------ 主流程 ------------------------------ */

/** 从"时间・地点"里抠出时间部分（交给 clock 判） */
function extractClockFromPlace(text) {
    const s = trimText(text);
    if (!s) {
        return '';
    }
    const cut = s.split(/[·・|｜,，、]/)[0];
    return trimText(cut) || s;
}

/**
 * 跑一次更新。
 * @param {object} opts { manual:boolean, floor:number, turns:number }
 */
export async function runUpdate(opts) {
    const o = opts || {};
    if (running) {
        return { ok: false, reason: '上一轮还在跑' };
    }
    const settings = getSettings();
    if (!settings.enabled) {
        return { ok: false, reason: '总开关关着' };
    }

    running = true;
    cancelRequested = false;
    const chat = getChat();
    const floor = Number.isFinite(o.floor) && o.floor >= 0 ? o.floor : chat.length - 1;

    // 留一版快照（撤回用）
    takeSnapshot('更新前（' + floorLabel(floor) + '）');

    setPipeline({
        kind: 'update',
        status: 'running',
        step: '取材料',
        startedAt: Date.now(),
        endedAt: 0,
        tries: 0,
        error: '',
        text: '开始更新（' + floorLabel(floor) + '）',
        cursor: 0,
        atFloor: floor,
        cancelRequested: false,
        conflicts: [],
    });

    // 取材料：最近几楼（含隐藏楼）＋ 走四格清洗
    const msgs = recentMessages(floor, Math.max(6, settings.recentTurns * 2));
    const cleaned = cleanMessages(msgs);
    const material = {
        floor,
        recentText: cleaned.text,
        // ⭐ 另留一份"清洗前"的原文：判"谁在现场""这句正文里有没有"要用它——
        //    清洗会剥掉状态栏之类，拿剥过的文本去判会冤枉（把一个明明写到的人判成"不在场"）。
        rawText: msgs.map((m) => trimText(m && m.mes)).filter(Boolean).join('\n'),
        messages: msgs,
        fellBack: cleaned.fellBack,
    };
    if (!trimText(material.recentText)) {
        setPipeline({ status: 'failed', step: '取材料', error: '这一楼附近没有可读的正文', endedAt: Date.now(), text: '没材料可推' });
        running = false;
        return { ok: false, reason: '这一楼附近没有可读的正文' };
    }
    setPipeline({ step: '读世界状态', text: '正在算世界状态（' + floorLabel(floor) + '）' });

    let lastError = '';
    let worldRes = { ok: false, reason: '没跑' };
    let charRes = { ok: false, reason: '没跑' };

    // 世界这一步：带重试上限
    for (let attempt = 0; attempt <= RETRY_LIMIT; attempt += 1) {
        if (cancelRequested) {
            break;
        }
        setPipeline({ tries: attempt });
        worldRes = await stepWorld(material);
        if (worldRes.ok) {
            break;
        }
        lastError = worldRes.reason;
        if (attempt < RETRY_LIMIT) {
            setPipeline({ text: '世界状态这一步失败（' + lastError + '），重试第 ' + String(attempt + 1) + ' 次（最多 ' + String(RETRY_LIMIT) + ' 次）' });
            await sleep(800);
        }
    }

    if (!cancelRequested && worldRes.ok) {
        setPipeline({ step: '读角色状态与平行事件', text: '正在算角色状态与平行事件' });
        for (let attempt = 0; attempt <= RETRY_LIMIT; attempt += 1) {
            if (cancelRequested) {
                break;
            }
            charRes = await stepCharacters(material);
            if (charRes.ok) {
                break;
            }
            lastError = charRes.reason;
            if (attempt < RETRY_LIMIT) {
                setPipeline({ text: '角色这一步失败（' + lastError + '），重试第 ' + String(attempt + 1) + ' 次' });
                await sleep(800);
            }
        }
    }

    const state = loadState();
    state.stat.updates = Number(state.stat.updates || 0) + 1;
    saveState();

    // 收尾：把这一轮的结果落进世界书，并更新账本状态
    const failed = cancelRequested ? false : !(worldRes.ok && charRes.ok);
    const parts = [];
    if (worldRes.ok) {
        parts.push(worldRes.summary);
    }
    if (charRes.ok) {
        parts.push(charRes.summary);
    }
    const text = (cancelRequested ? '已取消（已跑的部分保留）' : (failed ? '有一步没成' : '更新完成'))
        + (parts.length ? '：' + parts.join('；') : (lastError ? '：' + lastError : ''));

    // ⭐ 把这一轮的"与你手改冲突"条目**留档**到更新那一刻的召回记录上，
    //    这样面板「过程报告」里那一轮点开就能看见具体哪条冲突、引擎保留了哪个版本（条 16）。
    if (Array.isArray(charRes.conflicts) && charRes.conflicts.length) {
        const list = state.recallRecords;
        let target = null;
        let bestAt = -1;
        for (const r of list) {
            if (r && r.floor === floor && (Number(r.at) || 0) > bestAt) {
                bestAt = Number(r.at) || 0;
                target = r;
            }
        }
        if (target) {
            target.conflicts = charRes.conflicts.slice(0, 20);
        }
    }

    setPipeline({
        status: cancelRequested ? 'cancelled' : (failed ? 'failed' : 'ok'),
        step: '完成',
        endedAt: Date.now(),
        error: failed ? (lastError || '未知原因') : '',
        text,
        cursor: msgs.length,
        conflicts: Array.isArray(charRes.conflicts) ? charRes.conflicts.slice(0, 20) : [],
    });
    state.lastUpdate = {
        at: Date.now(),
        status: failed ? 'failed' : 'ok',
        note: text,
    };
    saveState();
    markBookDirty();

    running = false;
    return {
        ok: !failed,
        reason: failed ? lastError : '',
        text,
        world: worldRes,
        chars: charRes,
    };
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/* ------------------------------ 补推历史 ------------------------------ */

let backfilling = false;

/**
 * 把已有聊天从头补推到现在（分批、可取消、⛔ 不卡界面）。
 * ⚠️ 识别隐藏楼层：隐藏只影响显示，照读。
 */
export async function runBackfill(opts) {
    const o = opts || {};
    if (backfilling || running) {
        return { ok: false, reason: '已经在跑了' };
    }
    const settings = getSettings();
    const chat = getChat();
    if (!chat.length) {
        return { ok: false, reason: '这个聊天还没有楼' };
    }

    // 用户楼作为分批边界（一层一层往前走）
    const userFloors = [];
    for (let i = 0; i < chat.length; i += 1) {
        const m = chat[i];
        if (m && m.is_user && !m.is_system) {
            userFloors.push(i);
        }
    }
    if (!userFloors.length) {
        return { ok: false, reason: '还没有你的发言' };
    }
    const startFrom = Number.isFinite(o.from) && o.from >= 0 ? o.from : 0;
    const todo = userFloors.filter((f) => f >= startFrom);
    if (!todo.length) {
        return { ok: true, text: '没有要补的楼了' };
    }

    backfilling = true;
    cancelRequested = false;
    setPipeline({
        kind: 'backfill',
        status: 'running',
        step: '补推历史',
        startedAt: Date.now(),
        text: '准备补推 ' + String(todo.length) + ' 个楼层',
        cursor: 0,
        atFloor: -1,
        cancelRequested: false,
        conflicts: [],
    });

    let done = 0;
    let failedAt = '';
    for (const floor of todo) {
        if (cancelRequested) {
            break;
        }
        setPipeline({ text: '补推中：' + floorLabel(floor) + '（' + String(done + 1) + '/' + String(todo.length) + '）', cursor: done });
        // 一步一步来：每一步都是独立的一次更新（每步都在 2 分钟预算内）
        // eslint-disable-next-line no-await-in-loop
        const res = await runUpdate({ manual: true, floor });
        if (!res.ok) {
            failedAt = floorLabel(floor) + '：' + (res.reason || '失败');
            break;
        }
        done += 1;
        await sleep(400);   // 让界面喘口气，⛔ 不挡她聊天
    }

    backfilling = false;
    const text = cancelRequested
        ? ('补推已取消（已完成 ' + String(done) + ' 楼，进度留着，下次接着补）')
        : (failedAt ? ('补推中断：' + failedAt + '（已完成 ' + String(done) + ' 楼）')
            : ('补推完成：共 ' + String(done) + ' 楼'));
    setPipeline({
        status: cancelRequested ? 'cancelled' : (failedAt ? 'failed' : 'ok'),
        step: '完成',
        endedAt: Date.now(),
        error: failedAt,
        text,
        cursor: done,
    });
    markBookDirty();
    return { ok: !failedAt, text, done };
}

/** 补推还在跑吗 */
export function isBackfilling() {
    return backfilling;
}

/* ------------------------------ 对账 ------------------------------ */

/**
 * 账与楼对账：楼层被删／重跑时，对不上的账跟着清；⛔ 有软保护（防误清空）。
 */
export function runReconcile() {
    const chat = getChat();
    const state = loadState();
    const notes = [];

    if (!Array.isArray(chat) || chat.length === 0) {
        return { removed: 0, note: '拿不到聊天内容，这次不动手（防误清空）' };
    }

    const before = state.recallRecords.length;
    // ⭐ 对账要按 **mesId 重新定位**（自审修正）：光过滤不重排的话，
    //    中间删一楼会让其后所有记录的 floor 全部错位，下一次对账把它们**误删**（雪崩）。
    const byMesId = new Map();
    chat.forEach((m, idx) => {
        const id = trimText(m && m.mesId);
        if (id && m && m.is_user && !m.is_system) {
            byMesId.set(id, idx);
        }
    });

    state.recallRecords = state.recallRecords.filter((r) => {
        if (!r) {
            return false;
        }
        const mesId = trimText(r.mesId);
        if (mesId) {
            const at = byMesId.get(mesId);
            if (at === undefined) {
                return false;   // 这条记录对应的那条发言真的没了
            }
            if (r.floor !== at) {
                r.floor = at;   // 位置变了 ⇒ 跟着对（⛔ 不许错位）
            }
            return true;
        }
        // 没有身份证的老记录：只能按楼层号核对
        const m = chat[r.floor];
        return !!(m && m.is_user && !m.is_system);
    });
    const removed = before - state.recallRecords.length;

    // 编年里超过现有楼的推演记录：不删，只标记"楼已不在"（软处理，她要能回看）
    let orphan = 0;
    for (const c of state.chronicle) {
        if (Number.isFinite(c.floor) && c.floor >= 0 && c.floor >= chat.length) {
            if (!c.floorGone) {
                c.floorGone = true;
                orphan += 1;
            }
        }
    }

    saveState();
    if (removed > 0) {
        notes.push('清了 ' + String(removed) + ' 条对不上的召回账');
    }
    if (orphan > 0) {
        notes.push('有 ' + String(orphan) + ' 条编年对应的楼层已经不在了（记录留着，只标了一下）');
    }
    return { removed, note: notes.join('；') || '账与楼对得上，没动' };
}

/* ------------------------------ 频率控制 ------------------------------ */

/**
 * 到该更新的回合了吗（每 N 回合）。
 * ⚠️ 注意：频率只影响"多久更新一次"，⛔ 不影响暗线推进（那个只看世界钟）。
 */
export function shouldUpdateNow(floor) {
    const settings = getSettings();
    const every = clampNumber(settings.updateEvery, 1, 10, 1);
    if (every <= 1) {
        return true;
    }
    const state = loadState();
    const last = Number(state.pipeline && state.pipeline.atFloor);
    if (!Number.isFinite(last) || last < 0) {
        return true;
    }
    return (floor - last) >= every;
}

/** 一轮最多发几次请求（预算，省额度） */
export function callBudget() {
    return CALLS_PER_TURN + 1;   // 更新那一次 ＋ 打杂（挑拣／摘要，可不用）
}
