/**
 * 万象阁 · 更新流水（世界状态＋角色七格＋平行事件＋编年）
 *
 * 一次更新＝**两小步请求**（世界状态 1 次 ＋ 十几个角色合并成 1 次结构化输出，由 callBudget 把关上限），
 * ⛔ 不许十几个角色一轮各发一个请求。
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

/*
 * ⭐ 补④：输出被截断之后的重试策略。
 *
 *   她定的规矩：截断 ⇒ **这一轮算失败、账保持原样**，⏔ 猜着补全；
 *   重试时**加大输出额度**（但要有帽子）。
 *
 *   帽子怎么定的：基数（她设的 maxTokens）的 1.6 倍、且**不超 4000**。
 *     为什么是 4000：再高就只是提高费用与等待，而"截断"的根因多半是
 *     **模型写啰嗦**，不是额度不够 ⇒ 重试时一并要求它精简（见下面那句）。
 */
const RETRY_TOKEN_CAP = 4000;

/** 重试时追加的一句（只在第 2 次起才发） */
const RETRY_TIGHTEN = '【重试提醒】上一次的输出被截断了（JSON 没写完）。'
    + '这一次请**精简**：只写变化最大、最重要的几条，'
    + '每个字段尽量短，**必须保证 JSON 完整闭合**（宁可少写几条，也不要写到一半断掉）。';

/** 按重试次数算输出额度（⏔ 超帽子） */
function retryTokens(base, attempt) {
    const b = clampNumber(base, 200, 8000, 1600);
    const a = Math.max(0, Math.round(Number(attempt) || 0));
    if (a <= 0) {
        return b;
    }
    return clampNumber(Math.round(b * 1.6), 200, RETRY_TOKEN_CAP, b);
}
import { getChat } from './adapter.js';
import { getSettings, effectivePrompt, fillTemplate } from './settings.js';
// ⭐ 补② 送达回执用 markArrivals：对着新正文核上一轮注入的条目
import {
    loadState, saveState, takeSnapshot, addChronicle, pushPast, pushStep, upsertHidden, setEvents,
    updateWorld, upsertQuest,
    markArrivals,
    addKnow,
    restoreSnapshot,
    dropSnapshot,
} from './state.js';
import { callModelJson } from './apiclient.js';
import { cleanMessages, isHiddenMessage } from './extract.js';
import { isLineDue, nextStage, isLineDone, clockWentBackwards } from './clock.js';
import { markBookDirty } from './book.js';
import { trimText, asText, clampNumber, uniqueBy, floorLabel, matchKey } from './utils.js';
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

async function stepWorld(material, attempt) {
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

    // ⭐ 补④：重试时加大输出额度（带帽子）＋ 一并要求精简闭合
    const tryN = Math.max(0, Math.round(Number(attempt) || 0));
    const res = await callModelJson({
        prompt: tryN > 0 ? (prompt + '\n\n' + RETRY_TIGHTEN) : prompt,
        // ⛔ 破限词必须**真的发出去**：留空时要用内置那份（原来只读了原始设置 ⇒ 留空就等于没发）
        system: effectivePrompt('jailbreak'),
        maxTokens: retryTokens((settings.api || {}).maxTokens, tryN),
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

    // 按字段粒度判断是否手改过（若直写 c.manual=true 且未经 normalize 初始化 manualFields，则兜底视非空字段为锁定）
    const isFieldLocked = (fieldKey) => {
        if (!c.manual) {
            return false;
        }
        if (Array.isArray(c.manualFields)) {
            return c.manualFields.includes(fieldKey);
        }
        return true;
    };

    const textFields = ['age', 'identity', 'faction', 'timePlace', 'current'];
    for (const f of textFields) {
        const incoming = trimText(raw && raw[f]);
        if (!incoming) {
            continue;
        }
        const old = trimText(c[f]);
        if (old && isFieldLocked(f) && old !== incoming) {
            conflicts.push(c.name + ' 的「' + f + '」她手改过，保留她的版本（模型想改成：' + incoming.slice(0, 40) + '）');
            continue;
        }
        patch[f] = incoming;
    }

    // 好感：只"读"，⛔ 不自己加减、不自己编（模型给的只当参考，若她没接数据源就照抄）
    const incomingAff = trimText(raw && raw.affinity);
    if (incomingAff && incomingAff !== '未知' && !trimText(c.affinitySource)) {
        const old = trimText(c.affinity);
        if (!(old && isFieldLocked('affinity') && old !== incomingAff)) {
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

    /*
     * ⭐ 补③（尾巴）：模型在这一行里随行报的「他这一轮新知道了什么」。
     *   ⚠️ 必须**在这里带出去**：`applyCharacter` 是挑字段返回的（只回 name／isNew／quests），
     *     不写这一行，模型报的 knows 到了外面就没了（用例 ③-9 当场抓到：0 → 0）。
     *   ⛔ 这里**不过滤**（过滤统一在 `addKnow` 里做：没文字／没来源不收），免得两处规则分叉。
     */
    const knows = Array.isArray(raw && raw.knows)
        ? raw.knows.filter(Boolean).map((k) => ({
            text: trimText(k && k.text),
            source: trimText(k && k.source),
        })).filter((k) => k.text)
        : [];

    return { name: c.name, isNew, quests, knows };
}

async function stepCharacters(material, attempt) {
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
    // ⭐ 现场保护（protectedBypass）：同楼已算过的不再重推；上一轮刚在现场演过（inScene）的排到轮转队尾，优先推久未露面的人
    const maxParallel = clampNumber(settings.maxParallelChars, 0, 12, 6);
    const bench = roster.filter((c) => {
        if (onStageIds.has(c.id) || c.isPlayer) {
            return false;
        }
        /*
         * ⭐ 补①：她关掉「参与后台推演」的人**不进轮转名单**（不占名额）。
         *   ⚠️ 只挡**轮转**这一条路：他若在这一楼正文里出场，走的是上面的 `onStage`，
         *     照旧只做"正文里已经写了的"总结 —— 现场逻辑一点没动。
         *   ⛔ 这里只是"不挑他"，不删他任何数据。
         */
        if (c.noBench === true) {
            return false;
        }
        if (settings.protectedBypass && Number.isFinite(material.floor) && material.floor >= 0 && c.lastSeenFloor === material.floor && trimText(c.current)) {
            return false;
        }
        return true;
    });
    const rotated = bench.slice().sort((a, b) => {
        if (settings.protectedBypass && (a.inScene === true) !== (b.inScene === true)) {
            return a.inScene === true ? 1 : -1;
        }
        return (a.lastUpdatedAt || 0) - (b.lastUpdatedAt || 0);
    });
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
        /*
         * ⭐ 补③ 第二步：**防全知**——把"他该知道的"真喂进他的推演。
         *   她的原话：「推演该人物时，喂料按这份清单过滤（不在清单里的世界内幕不进他的推演上下文）」。
         *   ⚠️ 只告诉模型"他知道什么"，**⏔ 把不该知道的也列出来**（那等于换个方式泄露）。
         */
        const kn = Array.isArray(c.knows) ? c.knows : [];
        if (kn.length) {
            lines.push('  他知道的：' + kn.map((k) => trimText(k.text)
                + '（' + (trimText(k.source) || '公开')
                + (Number(k.floor) >= 0 ? '·' + floorLabel(Number(k.floor)) : '') + '）').join('；'));
            lines.push('  ⏔ **不在上面那份清单里的世界内幕，他没渠道知道⇒不许写进他的推演**。');
        } else {
            lines.push('  他还没记下知道什么（清单是空的）⇒ 世界内幕一律⏔ 给他，只能写他自己身边看得到的。');
        }
        lines.push('  ' + (inScene
            ? '⚠️ 他在正文现场：只许总结正文里已经写了的他的事，⛔ 正文没写的（尤其下一步动作）一律不许写。'
            + '✅ 可以照正文那样**侧面带"我"**（对"我"说／看向"我"／把东西放到"我"面前／对"我"的反应）；'
            + '⛔ 但"我"自己的动作、台词、神态、位置一个字都不许写。'
            : '他不在正文现场（暗地）：现状只能靠推演写，只写"这一步"（正在进行时／刚做完），⛔ 不写下一步；'
            + '⛔ 这一段里**不许出现"我"**（"我"的动静影响不到他）。'));
        return lines.join('\n');
    }).join('\n');

    /*
     * ⭐ 补③ 第二步（第二半）：模板里那块世界内幕是**所有人共用**的——
     *   那本身就是"全知"的漏点（谁都能看到）。
     *   ⇒ 只保留**至少有一个被推的人在清单里记下过**的那些；
     *     一个人都没记过的内幕 ⇒ **整块不给**（没人有渠道知道，给了就是全知）。
     *   ⚠️ 清单全空时（老账，谁都没记）⏔ 一刀切：那样老聊天的推演会突然变空。
     *     ⇒ 只要**这一批里有任何一个人填过清单**，就按清单过滤；一个都没填 ⇒ 照旧（等他开始用这个功能）。
     */
    const pickedKnows = picked.map((c) => (Array.isArray(c.knows) ? c.knows : []).map((k) => trimText(k.text)).filter(Boolean)).flat();
    const anyKnows = pickedKnows.length > 0;
    const knownBySomeone = (title) => !anyKnows || pickedKnows.some((kt) => kt.includes(title) || title.includes(kt));
    const prompt = fillTemplate(effectivePrompt('chars'), {
        clock: trimText(loadState().world.clock) || '未知',
        /*
         * ⭐ 修复单 #20：**bigPicture 也要过认知过滤**。
         *   原来 `situations` 过了（下面那行 filter），而 `bigPicture` **没过** ⇒
         *   只要"这一批里任何一个人填过清单"，整段世界总览照样漏给所有人 ⇒ 防全知那一支等于白写。
         *   ⚠️ 总览是一整段话、没法按条筛 ⇒ 用"**这批里有人记过跟它相关的东西吗**"判
         *     （`knownBySomeone` 是双向 includes：总览里提到某人记过的事 ⇒ 就照给；谁都没记过 ⇒ ⛔ 不给）。
         */
        world: [
            (trimText(loadState().world.bigPicture) && knownBySomeone(trimText(loadState().world.bigPicture)))
                ? trimText(loadState().world.bigPicture) : '',
            ((loadState().world.situations || []).map((s) => trimText(s.title)).filter((x) => x && knownBySomeone(x)).join('；') || ''),
        ].filter(Boolean).join('\n') || '（这一批里没人有渠道知道世界内幕，⏔ 给）',
        recent: material.recentText || '（没有可读的正文）',
        chars: charLines,
    });

    // ⭐ 补④：同世界步（重试加大额度 + 要求精简闭合）
    const tryN2 = Math.max(0, Math.round(Number(attempt) || 0));
    const res = await callModelJson({
        prompt: tryN2 > 0 ? (prompt + '\n\n' + RETRY_TIGHTEN) : prompt,
        // ⛔ 破限词必须**真的发出去**：留空时用内置那份
        system: effectivePrompt('jailbreak'),
        maxTokens: retryTokens((settings.api || {}).maxTokens, tryN2),
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
    let knowCount = 0;   // ⭐ 补③：这一轮往认知账里收了几条
    for (const raw of rows) {
        const row = Object.assign({}, raw);
        /*
         * ⭐ 修复单 #16：顶层 `v.quests` 之前**没喂给任何一行**——
         *   `collectQuests` 只读 `raw.allQuests`（全库只有它读、没人写），
         *   ⇒ 模型按默认格式（quests 在顶层、与 chars 并列）报的任务 **100% 静默丢失**。
         *   ⇒ 循环里补喂；`checkActingAsMe` 也会顺带读到它（下面那个字段同族加上了）。
         */
        row.allQuests = Array.isArray(v.quests) ? v.quests : [];
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
            /*
             * ⭐ 补③（尾巴）：**引擎自己维护认知账** —— 模型这一轮说他知道了什么，就收进去。
             *   规矩跟手加**同一套**（都走 `addKnow`）：**只增不编**；**没文字／没来源 ⇒ 不收**
             *   （她定的"拿不准的不进"）。
             *   ⚠️ 来源楼层＝**这一轮的楼**（他这会知道它的时刻）。
             *   ⛔ 模型没给就当"这轮没新增"，照常往下走（不当错误、不报失败）。
             */
            if (Array.isArray(done.knows) && done.knows.length) {
                const who2 = loadState().characters.find((x) => x.name === done.name);
                if (who2) {
                    for (const kk of done.knows) {
                        if (addKnow(who2.id, {
                            text: trimText(kk && kk.text),
                            source: trimText(kk && kk.source),
                            floor: Number.isFinite(Number(material.floor)) ? Number(material.floor) : -1,
                        })) {
                            knowCount += 1;
                        }
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
    /*
     * ⭐ 修复单 #16 附：顶层任务的 `name` 按**名字或别名**归位——
     *   原来只比 `who === c.name`，模型写个别名/昵称就把任务丢了。
     *   matchKey 就是全库的"名字归一"口径（去空白/小写/全角归一），跟名册检索同一把尺。
     */
    const names = [trimText(c && c.name)]
        .concat((Array.isArray(c && c.aliases) ? c.aliases : []).map((a) => trimText(a)))
        .filter(Boolean);
    for (const q of top) {
        const who = matchKey(trimText(q && (q.name || q.character)));
        if (who && names.some((n) => matchKey(n) === who)) {
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
        // ⭐ 修复单 #16：顶层 quests（喂进 row.allQuests 的那份）也**一并过禁区**——
        //    ⛔ 只查行内 quests 的话，顶层格式写的"我"字会漏检。
        if (Array.isArray(raw && raw.quests) || Array.isArray(raw && raw.allQuests)) {
            const qsAll = [].concat(raw.quests || []).concat(raw.allQuests || []);
            const joined = qsAll.filter(Boolean).map((q) => {
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

            /*
             * ① "我"当主语＋动作
             *
             * ⚠️ 原来是一张**动词表**（会|要|打算|走向|走进|拿起|转身|站起|…）——
             *    表永远列不全。逐条核验时实测：17 种常见写法**只拦得住 6 种**，
             *    「我推开门」「我冲了进去」「我笑了一下」「我把书放回架子上」全漏。
             * ⇒ 改成**按结构判**：只要"我"不是宾语／所有格，就算它当了主语（＝越界）。
             *    需求允许的只有**侧面豁免**（别人对我做／说／看），那两种在结构上有特征：
             *      · 前面几字里有介词或及物动词把它变成对象：
             *        对／给／向／跟／和／与／朝／冲／让／被／叫／看／望／等／问／帮／替
             *      · 后面紧跟"的"（"我的处境""我的反应"）
             */
            const meSubject = (() => {
                const s = String(text).replace(/["'「」『』“”‘’]/g, '');
                /*
                 * ⚠️ 这张表要包含**方向／处所类**介词（到在从往至进出回过）：
                 *    漏了"到"就会把「把煎蛋**放到我**面前的桌垫上」这种合规侧面写法误报
                 *    （真踩过：加完结构判之后 run-tests-p2 的"侧面放过"当场变红）。
                 */
                const BEFORE = /[对给向跟和与朝冲让被叫看望等问帮替自我到在从往至进出回过由于挨靠临]/;
                for (let i = 0; i < s.length; i += 1) {
                    if ('我咱俺'.indexOf(s[i]) < 0) {
                        continue;
                    }
                    if (s[i + 1] === '的') {
                        continue;                      // 所有格：侧面豁免
                    }
                    if (BEFORE.test(s.slice(Math.max(0, i - 3), i))) {
                        continue;                      // 宾语：别人对我…
                    }
                    return true;                        // 其余 ⇒ 它当了主语
                }
                return false;
            })();
            if (meSubject) {
                reasons.push('"我"自己做了动作');
            }
            // ② 预判"我"
            if (/我(接下来|之后|下一步|等会儿|一会儿)/.test(text)) {
                reasons.push('预判"我"接下来会怎样');
            }
            /*
             * ②b 任务里写"下一步动作／后续预测"（⛔ 跟"只写这一步"同一个禁区）
             *
             * ⚠️ 提示词里**明写着**「"明天去码头等船"这种点名不许」，
             *    可这条正则原来不认"明天＋动词" ⇒ **提示词说了、代码不拦**（逐条核验 5.11 抓到）。
             *    补上时间词＋意志动词那一路；⛔ 只认"时间词紧跟动词"，
             *    免得把「明天的舞会」这种名词短语误判。
             */
            if (/下一步|接下来(去|要|会)|后续预测|准备(去|要)|即将(去|要|前)去?/.test(text)
                || /(明天|后天|次日|下次|回头|待会儿|等会儿|过几天)\s*(去|要|会|准备|打算|再|得)/.test(text)) {
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
/**
 * ⭐ 补⑤：把失败原因归成几类 —— **只留类别，⛔ 不把原文带出去**。
 *
 * 为什么要在源头就分类：体检报告要"她截图就能说清"，而 error 原文里
 * 可能夹着正文片段、地址、钥匙 ⇒ ⛔ 一律不进报告、不进账。
 * 分类口径（跟体检报告的表格一一对应）：网络／超时／截断／格式／其它。
 */
export function classifyFailure(msg) {
    const s = String(msg || '');
    if (/\u622a\u65ad|\u672a\u95ed\u5408|unterminated|truncat/i.test(s)) { return '\u622a\u65ad'; }
    if (/\u8d85\u65f6|timeout|timed out|AbortError|aborted/i.test(s)) { return '\u8d85\u65f6'; }
    if (/\u7f51\u7edc|fetch|network|\u8fde\u63a5|ECONN|ENOTFOUND|HTTP 4|HTTP 5/i.test(s)) { return '\u7f51\u7edc'; }
    if (/JSON|\u683c\u5f0f|\u89e3\u6790|parse|\u4e0d\u662f\u5408\u6cd5/i.test(s)) { return '\u683c\u5f0f'; }
    return '\u5176\u5b83';
}

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
    const preSnap = takeSnapshot('更新前（' + floorLabel(floor) + '）');
    /*
     * ⭐ 修复单 #19：开跑前先把两个"锚点"记下来，失败要退回原值——
     *   · `prevAtFloor`：`shouldUpdateNow` 的判据（推进了 ⇒ 自动更新被拒）
     *   · `prevLuFloor`：进度条读的那个（"上次更新停在 #N"）
     */
    const prevAtFloor = (() => {
        try {
            const p = loadState().pipeline || {};
            return Number.isFinite(Number(p.atFloor)) ? Number(p.atFloor) : -1;
        } catch (e) {
            return -1;
        }
    })();
    const prevLuFloor = (() => {
        try {
            const lu = loadState().lastUpdate || {};
            return Number.isFinite(Number(lu.floor)) ? Number(lu.floor) : -1;
        } catch (e) {
            return -1;
        }
    })();

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
    /*
     * ⭐ 补②：对着新正文核上一轮注入的条目（到底接没接）。
     * ⚠️ 修复单 #19 联动的坑：它**会写编年**（"候补转编年"），而失败回滚**会还原编年**
     *   ⇒ 两件事会打架（回滚把编年抹了，可 `lastCheckedFloor` 已经记上、重跑不再核 ⇒ 那笔账永久丢）。
     *   ⇒ **把它挪到"回滚之后"再跑**（见下面收尾段），两个机制各自独立、不再互相踩。
     */

    if (!trimText(material.recentText)) {
        /*
         * ⭐ 修复单 #19 附注①：空跑**不该占一个快照位**（快照是有上限 SNAPSHOT_KEEP 的，
         *   占一个就挤掉一版真能用来自救的快照）。⇒ 把刚压的那版撤掉。
         */
        try {
            dropSnapshot(preSnap);
        } catch (e) {
            console.warn('[万象阁] 撤快照没做成：', e);
        }
        setPipeline({ status: 'failed', step: '取材料', error: '这一楼附近没有可读的正文', endedAt: Date.now(), text: '没材料可推' });
        running = false;
        return { ok: false, reason: '这一楼附近没有可读的正文' };
    }
    setPipeline({ step: '读世界状态', text: '正在算世界状态（' + floorLabel(floor) + '）' });

    const budget = callBudget();
    let stepsUsed = 0;
    let lastError = '';
    let worldRes = { ok: false, reason: '没跑' };
    let charRes = { ok: false, reason: '没跑' };

    // 世界这一步（占 1 步预算）：带重试上限
    if (stepsUsed < budget) {
        stepsUsed += 1;
        for (let attempt = 0; attempt <= RETRY_LIMIT; attempt += 1) {
            if (cancelRequested) {
                break;
            }
            setPipeline({ tries: attempt });
            worldRes = await stepWorld(material, attempt);
            if (worldRes.ok) {
                break;
            }
            lastError = worldRes.reason;
            if (attempt < RETRY_LIMIT) {
                setPipeline({ text: '世界状态这一步失败（' + lastError + '），重试第 ' + String(attempt + 1) + ' 次（最多 ' + String(RETRY_LIMIT) + ' 次）' });
                await sleep(800);
            }
        }
    }

    // 角色这一步（占 1 步预算，十几个角色合并成一次算）：带重试上限
    if (!cancelRequested && worldRes.ok && stepsUsed < budget) {
        stepsUsed += 1;
        setPipeline({ step: '读角色状态与平行事件', text: '正在算角色状态与平行事件' });
        for (let attempt = 0; attempt <= RETRY_LIMIT; attempt += 1) {
            if (cancelRequested) {
                break;
            }
            charRes = await stepCharacters(material, attempt);
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

    /*
     * ⭐ 修复单 #19：**失败＝账保持原样**。
     *   原来失败也照写 `atFloor` 与 `lastUpdate.floor`，后果三连：
     *     ① `shouldUpdateNow` 判据是 `cur <= atFloor ⇒ false` ⇒ **失败后自动更新被永久拒掉**（"已算过"）；
     *     ② 进度显示"走了 100%（已经追平正文）"＝**虚报**；
     *     ③ stepWorld 已经写进去的世界钟／编年**留着** ⇒ 半截脏 + 重试时重复推。
     *   ⇒ 失败时把账还原到开跑前那一版快照，锚点也退回原值（下面 setPipeline/lastUpdate 用 prev）。
     */
    if (failed) {
        try {
            restoreSnapshot(preSnap);
        } catch (e) {
            console.warn('[万象阁] 失败回滚没做成：', e);
        }
    }

    /*
     * ⭐ 补②（修复单 #17 已改口径）：对着新正文核上一轮注入的条目。
     *   放在**回滚之后**：它写的编年不会被失败回滚抹掉，两个机制不再互相踩。
     *   ⚠️ 只读与标记，不改推演结果；出错也不影响主流程。
     */
    try {
        markArrivals(material.rawText || material.recentText, floor, material.messages);
    } catch (e) {
        console.warn('[万象阁] 送达回执没算成：', e);
    }

    setPipeline({
        status: cancelRequested ? 'cancelled' : (failed ? 'failed' : 'ok'),
        step: '完成',
        endedAt: Date.now(),
        error: failed ? (lastError || '未知原因') : '',
        text,
        cursor: msgs.length,
        // ⭐ #19：失败了就把锚点退回去（⛔ 不许假装这一楼算过了）
        atFloor: failed ? prevAtFloor : floor,
        conflicts: Array.isArray(charRes.conflicts) ? charRes.conflicts.slice(0, 20) : [],
    });
    /*
     * ⭐ 补⑤：失败**按类归档**（只记类别与时间，⛔ 不记任何内容）。
     *   为什么单开一本：`pipeline.error` 只留"最近一次"，她要看的是"最近失败都是哪一类"。
     *   ⛔ 绝不把 error 原文写进来（里面可能带正文或地址/钥匙片段）。
     */
    if (failed) {
        try {
            const st2 = loadState();
            st2.failLog = Array.isArray(st2.failLog) ? st2.failLog : [];
            st2.failLog.push({ at: Date.now(), kind: classifyFailure(lastError) });
            // 只留最近 30 条（够她看趋势，⛔ 不让它长成第二个账本）
            st2.failLog = st2.failLog.slice(-30);
            saveState();
        } catch (e) {
            // 记不进就算了，⛔ 不能因为它把主流程带崩
        }
    }
    state.lastUpdate = {
        at: Date.now(),
        status: failed ? 'failed' : 'ok',
        note: text,
        /*
         * ⭐ 修复单 #19：失败时**停在原来那楼**（⛔ 不许推进）——
         *   推进了会让进度条显示"已经追平正文"，而实际上账被回滚了、这一楼根本没算。
         *   失败的"事实"仍然留着（status/note/failLog 都在），只是不冒充进度。
         */
        floor: failed ? prevLuFloor : (Number.isFinite(Number(floor)) && Number(floor) >= 0 ? Number(floor) : -1),
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
    // ⭐ 对账要按 **mesId 优先、发言文本兜底** 重新定位：光过滤不重排的话，
    //    中间删一楼会让其后所有记录的 floor 全部错位，下一次对账把它们**误删**（雪崩）。
    const byMesId = new Map();
    const userFloors = [];
    chat.forEach((m, idx) => {
        if (m && m.is_user && !m.is_system) {
            const id = trimText(m.mesId);
            if (id) {
                byMesId.set(id, idx);
            }
            userFloors.push({ idx, text: trimText(m.mes) });
        }
    });

    state.recallRecords = state.recallRecords.filter((r) => {
        if (!r) {
            return false;
        }
        const mesId = trimText(r.mesId);
        if (mesId && byMesId.size > 0) {
            const at = byMesId.get(mesId);
            if (at === undefined) {
                return false;   // 这条记录对应的那条发言真的没了
            }
            if (r.floor !== at) {
                r.floor = at;   // 位置变了 ⇒ 跟着对（⛔ 不许错位）
            }
            return true;
        }
        // 没有 mesId（或酒馆消息对象未带 mesId）：先核对原楼层，错位时按发言文本 lead 就近重定位
        const lead = trimText(r.lead);
        const m = chat[r.floor];
        if (m && m.is_user && !m.is_system && (!lead || trimText(m.mes) === lead)) {
            return true;
        }
        if (lead) {
            let bestIdx = -1;
            let bestDist = Infinity;
            for (const u of userFloors) {
                if (u.text === lead) {
                    const dist = Math.abs(u.idx - (Number(r.floor) || 0));
                    if (dist < bestDist) {
                        bestDist = dist;
                        bestIdx = u.idx;
                    }
                }
            }
            if (bestIdx >= 0) {
                r.floor = bestIdx;
                return true;
            }
            return false;
        }
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

    /*
     * ⭐ 修复单 #23：**两个锚点都要查**。
     *   原来只查 `pipeline.atFloor`，`lastUpdate.floor` 越界了没人管 ——
     *   而进度那侧读的正是 `lastUpdate.floor`（"上次更新停在 #N"＋"走了 X%"）⇒
     *   删楼之后会出现「总共 2 楼，却显示停在 #9、走了 100%（已经追平正文）」（真机截图实锤）。
     *   ⇒ 谁越界都一起对齐到"现存最后一次有效更新的楼号"。
     */
    const atFloor = Number(state.pipeline && state.pipeline.atFloor);
    const luFloor = Number(state.lastUpdate && state.lastUpdate.floor);
    const atBad = Number.isFinite(atFloor) && atFloor >= chat.length;
    const luBad = Number.isFinite(luFloor) && luFloor >= chat.length;
    if (atBad || luBad) {
        let lastValidFloor = -1;
        for (const c of state.chronicle) {
            const f = Number(c && c.floor);
            if (c && !c.floorGone && Number.isFinite(f) && f >= 0 && f < chat.length && f > lastValidFloor) {
                lastValidFloor = f;
            }
        }
        // ⚠️ 编年里一条有效楼都没有时：若 lastUpdate 那个数**本身还有效**，就保住它（别越对齐越丢）
        if (lastValidFloor < 0 && Number.isFinite(luFloor) && luFloor >= 0 && luFloor < chat.length) {
            lastValidFloor = luFloor;
        }
        if (atBad) {
            state.pipeline.atFloor = lastValidFloor;
            notes.push('更新锚点已从 ' + floorLabel(atFloor) + ' 对齐到 ' + (lastValidFloor >= 0 ? floorLabel(lastValidFloor) : '未更新状态'));
        }
        if (Number.isFinite(luFloor)) {
            state.lastUpdate.floor = lastValidFloor;
            if (luBad && !atBad) {
                notes.push('"上次更新停在"已从 ' + floorLabel(luFloor) + ' 对齐到 ' + (lastValidFloor >= 0 ? floorLabel(lastValidFloor) : '未更新状态'));
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
 * 到该更新的时刻了吗（按推进楼层差判；自动更新在 MESSAGE_RECEIVED 时传 floor - 1 留一层缓冲）。
 * ⚠️ 注意：
 *   ① 同一楼号（或更早楼号）绝不重复跑——重 roll／swipe 多少次都拦住，防白烧额度；
 *   ② 1 回合＝2 层楼（你一楼＋AI 一楼），every=1 或 2 均为每推进一轮更新一次（停在上一层已落定的楼），
 *      every>2 则隔相应楼层步长才触发；
 *   ③ 频率只影响"多久更新一次"，⛔ 不影响暗线推进（那个只看世界钟）。
 */
export function shouldUpdateNow(floor) {
    const settings = getSettings();
    const every = clampNumber(settings.updateEvery, 1, 10, 1);
    const state = loadState();
    const last = Number(state.pipeline && state.pipeline.atFloor);
    if (!Number.isFinite(last) || last < 0) {
        return true;
    }
    const cur = Number(floor);
    if (!Number.isFinite(cur)) {
        return every <= 1;
    }
    if (cur <= last) {
        return false;   // 这一楼（或更早的楼）已经算过了，重 roll 多少次都不重烧
    }
    return (cur - last) >= every;
}

/** 单轮更新最多发几次模型请求（世界状态 1 次 ＋ 角色合并推演 1 次，省额度） */
export function callBudget() {
    return CALLS_PER_TURN + 1;
}
