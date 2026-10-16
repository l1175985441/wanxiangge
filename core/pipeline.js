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
/* ⭐修复 2（材料 02）：解除写死的 Token 枷锁 ✗
 *   旧：推演请求输出上限写死 8000（重试时 4000）✗ ⇒ 长思考模型思考吃完就没正文 ✗
 *   新：上限 65536 ✓（材料 03 定稿：32000→65536 ✓） */
/* ⏔ 它不是用户可调的那个：这是**重试时**的内部封顶 ✓ */
const RETRY_TOKEN_CAP = 65536;

/** 重试时追加的一句（只在第 2 次起才发） */
const RETRY_TIGHTEN = '【重试提醒】上一次的输出被截断了（JSON 没写完）。'
    + '这一次请**精简**：只写变化最大、最重要的几条，'
    + '每个字段尽量短，**必须保证 JSON 完整闭合**（宁可少写几条，也不要写到一半断掉）。';

/** 按重试次数算输出额度（⏔ 超帽子） */
function retryTokens(base, attempt) {
    const b = clampNumber(base, 200, RETRY_TOKEN_CAP, 1600);
    const a = Math.max(0, Math.round(Number(attempt) || 0));
    if (a <= 0) {
        return b;
    }
    /* ⭐ 重试时**只增不减** ✓（旧：底下限 200 ⇒ 会把用户额度倒扣砍半 ✗） */
    return clampNumber(Math.round(b * 1.5), b, RETRY_TOKEN_CAP, b);
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
    capList,
    beginSaveBatch, endSaveBatch
} from './state.js';
import { callModelJson } from './apiclient.js';
import { cleanMessages, isHiddenMessage } from './extract.js';
import { isLineDue, nextStage, isLineDone, clockWentBackwards } from './clock.js';
import { markBookDirty } from './book.js';
import { trimText, asText, clampNumber, uniqueBy, floorLabel, matchKey } from './utils.js';
import { mentionedCharacters } from './recall.js';

let running = false;
/*
 * ⭐⭐ 真机抓到：那个持久化的 step 会**卡死**（一轮中途死了没清标记 ✗）
 *   ⇒ 之后每次进来都说“正在跑” ⇒ **重活按钮永久禁用** ✗✗
 *   ⇒ 这里把“本会话真的在跑”暴露成 window 标记（**内存态** ✓ 重载即失效 ✓）
 *   ⇒ 界面只认它（⏔ 只认持久化那个 ✗）：卡死的标记就不再欺骗她了 ✓
 */
function markLive() {
    try { if (typeof window !== 'undefined') { window.__wxgLiveRun = Boolean(running || backfilling); } } catch (e) { /* ⏔ 影响主流程 */ }
}
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
/*
 * ⭐ 10-16 用她给的「世界背面」例子校准：例子里四张人物卡都是**正在进行时**（⛔ 没误伤 ✓），
 *   但发现一处**漏**：「她**即将**走进教室」—— 原来写的是 `即将(?:去|要|会)`，跟不上"即将走"。
 *   需求书 §5 明写：「⛔ 也不写"未来进行时"」⇒ 补全未来进行时的标记词。
 *   ⚠️ 只加"未来进行时"那几个（即将／就要／快要／马上要／正要），⛔ 不把"正在做什么"也当成未来。
 */
const PREDICT_PAT = /下一步|接下来(?:要|会|去|就)|后续(?:预测|会|将)|准备(?:去|要|着)|即将|就要|快要|马上(?:要|就)|正要|打算(?:去|要)|等下(?:要|去)|待会儿(?:要|去)|然后(?:就)?(?:去|要)|明天(?:要|会|去)|稍后(?:要|会)/;

/** 文案里是否含"下一步／预判" */
/**
 * ⭐⭐ 她 [18]/[3] ＋ 10-16 实锤：**暗线 note 的核闸**。
 *   她报的原句：「露娜因额头被恶作剧划上创口贴而丧失说话与变身指引能力，
 *   **正被困于学校围墙外的空草地中急待解救**」
 *   —— 书里、正文里：「困／解救／围墙／恶作剧」**四词零出处**；
 *   正文里露娜是**主动潜伏、正面接近**（方向正好相反）。
 *   她的口径：暗线**只该写"谁在什么方向上活动、挂在什么时间条件"**，
 *   ⏔ 许发明**具体事件／处境**（⏔"被困在…待解救"式事故叙述）。
 *   ⚠️ 只拦**事故／待救／未来态**；正常的冲突（对峙／较量／追查）不拦。
 * @returns 空串＝没问题；非空＝拦下来的理由
 */
export function looksLikeFabricatedTrouble(text) {
    const t = trimText(text);
    if (!t) {
        return '';
    }
    /*
     * ⭐ 她 10-16 给的“世界背面”例子里，合法的暗流写法是：
     *   「…在樱花树上密切观察初二教室，**准备趁午休寻机接触目标**」
     *   —— 这是**意图／方向**（需求书：任务＝目标层，"意图／方向可以写"）⇒ **⏔ 误拦**。
     *   ← 我上一版把裸词「准备去」也列进了禁区 ⇒ **会把这种合法写法拦下来**（真踩）。⇒ 只留**具体事故／待救／明显未来态**。
     */
    const FUTURE = ['待解救', '等待解救', '急待', '即将发生', '将会发生', '明天就要', '待救'];
    const ACCIDENT = ['被困', '困于', '被绑架', '遭绑架', '昏迷', '重伤', '奄奄一息', '命悬一线', '急需救助'];
    for (const w of FUTURE) {
        if (t.indexOf(w) >= 0) {
            return '写到了"未来／待救"（' + w + '）——暗线只写现在的动向';
        }
    }
    for (const w of ACCIDENT) {
        if (t.indexOf(w) >= 0) {
            return '发明了具体事故处境（' + w + '）——暗线只写"谁在什么方向上活动"';
        }
    }
    return '';
}

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

/**
 * ⭐ 她 [5]/[7] 的原话口径（10-16 用她的例子校准出来的）：
 *   「这个正文**写了他的事情**。这就叫不能编造」／「正文**没有描写**的，比如下一步动作……那就叫**污染正文**了」
 *   ⇒ 她叫"编造"的是**"正文没有描写的事"**，**⛔ 不是"把正文有的事换个说法"**。
 *   而 `textAppearsIn` 只有一条线（≥34%）⇒ **改写幅度一大就掉到线下、被一口咬成"编造"**（她的例子正是这种写法）。
 *   本函数给出**重合度**，让上层能分开两种情况：
 *     · 完全找不到依据（0）⇒ 才叫「越界·现场编造」；
 *     · 有部分依据但达不到线 ⇒ 「正文里找不到依据（可能是换个说法的总结，也可能是编的）」——**照样出声、照样留档**，⛔ 不一嘴定性。
 */
export function textCoverage(text, source) {
    const a = asText(text).replace(/[\s，。、；：！？,.;:!?"'（）()【】《》…—-]/g, '');
    const b = asText(source).replace(/\s+/g, '');
    if (!a || !b) {
        return 0;
    }
    if (a.length <= 2) {
        return b.includes(a) ? 1 : 0;
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
    return grams.length ? (hit / grams.length) : 0;
}

function setPipeline(patch) {
    const state = loadState();
    state.pipeline = Object.assign({}, state.pipeline, patch);
    saveState();
}

/* ------------------------------ 取材料 ------------------------------ */

/** 最近 N 楼的正文（含隐藏楼：⛔ 不许因为被隐藏就漏掉） */
/*
 * ⭐⭐ 谷歌复核（一）：滑动字数窗分批 ✓
 *   病灶：补推原来**逐楼调一整轮 runUpdate** ✗ ⇒ 60 楼＝60 次完整更新 ✗（抽风站必断 ✗）
 *   现在：按字数装桶（默认 ≤3000 字）、满 6 楼就封包 ✓；单楼本身超长 ⇒ **该楼独占一批** ✓
 */
function buildScanBatches(floors, maxChars) {
    const cap = clampNumber(maxChars, 500, 20000, 3000);
    const list = (Array.isArray(floors) ? floors : [])
        .map((x) => Number(x))
        .filter((x) => Number.isFinite(x) && x >= 0);
    const chat = getChat();
    const sizeOf = (i) => {
        try { return trimText(chat[i] && chat[i].mes).length; } catch (e) { return 0; }
    };
    const out = [];
    let bucket = [];
    let chars = 0;
    for (const i of list) {
        const len = sizeOf(i);
        if (len > cap) {
            if (bucket.length) { out.push(bucket); bucket = []; chars = 0; }
            out.push([i]);
            continue;
        }
        if (bucket.length && (chars + len > cap || bucket.length >= 6)) {
            out.push(bucket); bucket = []; chars = 0;
        }
        bucket.push(i); chars += len;
    }
    if (bucket.length) { out.push(bucket); }
    return out;
}

/** 按**指定楼层**拼材料（形状与 recentMessages 一致 ✓）；单楼超长时保尾：**前 1000 ＋ 后 2000** ✓ */
function messagesOfFloors(floors, capChars) {
    const cap = clampNumber(capChars, 500, 20000, 3000);
    const chat = getChat();
    const out = [];
    for (const i of (Array.isArray(floors) ? floors : [])) {
        const m = chat[i];
        if (!m || !trimText(m.mes)) { continue; }
        let mes = String(m.mes);
        if (mes.length > cap) {
            mes = mes.slice(0, 1000) + '\n…（中间省略）…\n' + mes.slice(-2000);
        }
        out.push({ floor: i, mes, isUser: m.is_user === true, hidden: isHiddenMessage(m) });
    }
    return out;
}

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

/*
 * ⭐⭐ 拆小（她的话：「每个都是一下子弄一点点，然后继续下一轮」）
 *   真机取证：她那站对长请求一律掉线（直连 reset、转发 502+ECONNRESET、**连流式也照掉** ✗）；短请求通 ✓
 *   ⇒ 让请求**本身就短**：喂进去的正文超长时，**只带最近一段** ✓（最近的才是当前世界状态最需要的 ✓）
 *   ⏔ 不动结构：世界钟／地点／总览／局势／暗线照旧全给 ✓（只缩正文那一块 ✓）
 */
const WORLD_MATERIAL_CAP = 6000;   /* 默认值；真正用的是她在面板里填的那个数 ✓ */
function worldMaterialCap() {
    let v = WORLD_MATERIAL_CAP;
    try {
        const a = getSettings().api || {};
        const num = Number(a.materialCap);
        if (Number.isFinite(num) && num >= 500) { v = num; }
    } catch (e) { /* ⏔ 影响主流程 */ }
    return Math.min(Math.max(Math.round(v), 500), 40000);
}
/*
 * ⭐⭐ 谷歌复核（三）：局势**增量归并** ✓（照此落码、一个字不动 ✓）
 *   病灶：原来 `if (fresh.length) { updateWorld({ situations: fresh }, {}) }`
 *         ⇒ **用本批产出的几条势局把旧数组整锅端了** ✗（逐批补扫时后批冲掉前批 ✗）
 *   ⇒ 现在：同名／二元组覆盖率≥0.45 认作同一场局势演进 ⇒ 原地更新 ✓；
 *         **`manual`（她手改锁定的）不覆盖** ✓；新的才 push ✓
 */
function mergeSituations(oldList, freshList) {
    const merged = (Array.isArray(oldList) ? oldList : []).map((s) => Object.assign({}, s));
    for (const inc of Array.isArray(freshList) ? freshList : []) {
        const title = trimText(inc && inc.title);
        if (!title) continue;
        // 按标题同名或二元组覆盖率 >= 0.45 认出是不是同一场局势演进
        const idx = merged.findIndex((old) => old && (
            matchKey(old.title) === matchKey(title)
            || textAppearsIn(title, old.title)
            || textAppearsIn(old.title, title)
        ));
        if (idx >= 0) {
            if (merged[idx].manual) continue; // 她手改锁定的局势不覆盖
            merged[idx] = Object.assign({}, merged[idx], {
                title,
                sides: trimText(inc.sides) || merged[idx].sides,
                tier: trimText(inc.tier) || merged[idx].tier,
                at: Date.now(),
                floor: inc.floor,
            });
        } else {
            merged.push(inc);
        }
    }
    return merged;
}

function capWorldMaterial(txt, attempt) {
    /* ⭐⭐ 链路是抽风型的（一会儿 400、一会儿回体 null ✗）
     *   ⇒ **每多试一次，就把喂进去的正文再缩一档** ✓（下限 600 字，⏔ 缩到没东西可看 ✗）
     *   ⏔ 不动结构：局势／暗线照旧全给 ✓（只缩正文那一块 ✓） */
    let cap = worldMaterialCap();
    if (Number(attempt) > 0) { cap = Math.max(600, Math.floor(cap / (Number(attempt) + 1))); }
    const s = String(txt == null ? '' : txt);
    if (!s.trim()) { return '（没有可读的正文）'; }
    if (s.length <= cap) { return s; }
    return '（前文太长，只带最近 ' + String(cap) + ' 字 ✓）\n' + s.slice(-cap);
}

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
                + ' ｜ 现状：' + (h.suspect === true
                    /*
                     * ⭐⭐ 她 [18]/[3]：**判过编造的"现状"⛔ 进注入**（她：「根本没有要我救」）。
                     *   原来 `h.note` 原样喂 ⇒ 那句"被困围墙外急待解救"会被**当成现状反复回喂**、越滚越真。
                     *   现在：只把**那一句现状**换成不可作据的标记，**名字／阶段／到点条件照旧给**
                     *   （⛔ 不整条删：那是她的账，且删了模型会乱重建）。
                     */
                    ? '（⚠ 上一版这段被判编造、已剔除：' + trimText(h.suspectWhy).slice(0, 40) + '）'
                    : (h.note || '（没写）'))
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
        recent: capWorldMaterial(material.recentText, attempt),   /* ⭐ 拆小：超长只带最近一段 ✓ */
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
            /* ⭐谷歌复核（三）：增量归并（⏔ 用本批几条把旧数组整锅端 ✗），归并后再走容量锁归档 ✓ */
            const mergedSits = mergeSituations((loadState().world || {}).situations, fresh);
            updateWorld({ situations: mergedSits }, {});
            capList((loadState().world || {}).situations, 'capEvents', (s) => s.title, (s) => s.manual);
            saveState();   /* capList 是原地改，这里保险落盘 ✓ */
        }
    }

    // 暗线：到点才推进（⛔ 不看回合数）
    const hiddenIn = Array.isArray(v.hidden) ? v.hidden : [];
    let advanced = 0;
    let blocked = 0;
    // ⭐ 她 [18]/[3]：暗线里"发明具体事件／处境、写到未来态"被核闸拦下的条数
    let flagged = 0;
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
            /*
             * ⭐ 她 [18]/[3]：**推进时也过核闸**（⏔ 只拦新建那一条）。
             */
            const noteUp = trimText(raw.note) || existing.note;
            const badUp = looksLikeFabricatedTrouble(noteUp);
            upsertHidden({
                name,
                stage: stageIn || (wantsAdvance ? nextStage(existing.stage, existing.kind) : existing.stage),
                trigger: trimText(raw.trigger) || existing.trigger,
                tier: trimText(raw.tier) || existing.tier,
                note: noteUp,
                suspect: !!badUp || existing.suspect === true,
                suspectWhy: badUp || existing.suspectWhy || '',
            });
            if (badUp) {
                flagged += 1;
                addChronicle({
                    floor: material.floor,
                    kind: '⚠ 越界·暗线编造',
                    who: name,
                    text: noteUp.slice(0, 80) + '（' + badUp + '）',
                    clock: currentClock,
                });
            }
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
            const noteNew = trimText(raw.note);
            const badNew = looksLikeFabricatedTrouble(noteNew);
            const fresh = upsertHidden({
                name,
                stage: stageIn || '萌芽',
                trigger: trimText(raw.trigger),
                tier: trimText(raw.tier) || '几天内',
                note: noteNew,
                kind: trimText(raw.kind),
                suspect: !!badNew,
                suspectWhy: badNew,
            });
            if (badNew) {
                flagged += 1;
                addChronicle({
                    floor: material.floor,
                    kind: '⚠ 越界·暗线编造',
                    who: name,
                    text: noteNew.slice(0, 80) + '（' + badNew + '）',
                    clock: currentClock,
                });
            }
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
        events.push({ title: h.name, /*
             * ⭐⭐ 她 [18]/[3]（这是最后一条漏网的路）：暗线事件会进 `state.events`，
             *   而召回会从那里挑事件**注入给主模型**（`recall.js` 的 `pickEvents`）。
             *   ⇐ 原来直接把 `h.note`（**含“被困待救”那句**）写进去 ⇒ 标了 suspect 也照样被喂进去。
             *   ⇒ suspect 的只留**名字＋到点条件**（不可作据），⏔ 把那句编造带进去。
             */
            text: (h.suspect === true ? '（⚠ 这条的"现状"被判编造、已剔除）' : (h.note || h.trigger)), kind: 'hidden', stage: h.stage, tier: h.tier, floor: material.floor });
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
    /* ⭐修复 4（材料 02）并按材料 03 定稿修正 ✓
     *   病根：旧条件只排除 `'未知'` ✗ ⇒ 推演模型把“未接入/敌对/本人”这类**文字**
     *         写进好感格也照单全收 ✗（好感格污染 ✗）
     *   现在：**必须是合法数字** 才收 ✓（纯数字正则 ⇒ “未接入/敌对/本人”100% 进不来 ✓）
     *   ⚠️材料 03 明确修正：**去掉 `&& !trimText(c.affinity)`** ✓
     *      （那是“空值锁”✗ ⇒ 只要格子里有初始值，后续正文里读到的更新就**永远写不进去** ✗）
     *   保留的三个条件：合法数字 ✓ ＋ 未接外部数据源 ✓ ＋ 该格未被手动锁定 ✓ */
    const incomingAff = trimText(raw && raw.affinity);
    if (/^-?\d+(?:\.\d+)?$/.test(incomingAff) && !trimText(c.affinitySource)) {
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
        } else if (onStage && material.fellBack !== true && !textAppearsIn(cur, material.recentText || material.rawText)) {
            /*
             * ⭐ 10-16 真语料教训：**清洗失败时⏔ 下“编造”判词**。
             *   她那张卡把正文整个包在成对块里 ⇒ 四格清洗把正文也剥了（只剩 30 字）
             *   ⇒ 这时“正文里找不到”**不能说明任何事**（我们压根没读到正文）
             *   ⇒ **⏔ 献上一排“越界·现场编造”**（那正是她 04:20 那屏噪音）。读不到就不指控。
             */
            /*
             * ⭐ 她 [5]/[7] 的原话：她叫"编造"的是**"正文没有描写的事"**，
             *   ⏔"把正文有的事换个说法"** ⇒ 分两档：
             *     · 一点依据都找不到（重合度 0）⇒ 才叫**越界·现场编造**；
             *     · 有部分依据但达不到线 ⇒ **照样出声、照样留档**，但不一嘴定性成"编造"（她说过误报会变噪音）。
             */
            const cov = textCoverage(cur, material.recentText || material.rawText);
            why = cov > 0
                ? '这段在正文里找不到依据（可能是换个说法的总结、也可能是编的——你自己看一眼）'
                : '他在正文里**露面**了，但这段正文里**一点依据都找不到** ⇒ 视为编造（她：在现场的只准出现正文的）';
        }
        if (why) {
            c.currentSuspect = true;
            c.currentSuspectWhy = why;
            conflicts.push(c.name + ' 的「正在经历」：' + why + '（' + cur.slice(0, 30) + '…）');
            addChronicle({
                floor: material.floor,
                kind: onStage ? (why.indexOf('一点依据都找不到') >= 0 ? '⚠ 越界·现场编造' : '⚠ 疑似·找不到依据') : '⚠ 越界·疑似预判',
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
    /*
     * ⭐⭐ 她原话 [5]/[7]：**在场＝"正文里露面"的**（⏔"名字被提到"）。
     *   原话：「正在在线的不准编造。后台不在线的这个是编造的，这个不要紧」
     *        ＋「如果在现场的话，只准出现正文的」。
     *   原来喂的是 `rawText`（**清洗前**，含状态栏／变量台账）⇒
     *   **只在台账里挂名的角色**（她 04:20 截图里的 美奈子／真琴／丽／亚美）
     *   也被算成"在场" ⇒ 再拿"现场只准写正文"去核它们的推演 ⇒ **一排误伤**。
     *   ⇒ 改用 `recentText`（**正文**＝走完四格清洗的那份）：正文里没露面 ⇒ 走**推演通道、放行**。
     *   ⚠️ 原注释担心"清洗会把明明写到的人判成不在场"——四格默认只剥"成对机器块＋HTML注释"，
     *     她的正文不在那两类里 ⇒ 不会误判；万一她自己把正文也列进了排除，才会退到 rawText（保底）。
     */
    /*
     * ⭐ 10-16 拿她 **11 层真语料**端到端跑出来的坑：
     *   她那条消息**原文 6675 字，四格清洗后只剩 30 字**（`【未定位】`）
     *   —— 她那张卡把**正文整个包在成对块里**（需求书 §8 早提过这种卡，还说要留总开关）。
     *   ⇒ 若直接拿清洗后的去判“谁在场”，**一个人都判不出来** ⇒ 那 6 方全被当“不在场”、该做总结的没做总结。
     *   ⇒ **兜底**：清洗后**一个名字都没了**就退回原文（宁可多算、⏔ 全判不在场）。
     */
    const bodyForStage = (() => {
        const cleaned = material.recentText || '';
        if (!trimText(cleaned)) {
            return material.rawText || '';
        }
        return whoIsOnStage(cleaned, roster).length ? cleaned : (material.rawText || cleaned);
    })();
    const onStage = whoIsOnStage(bodyForStage, roster);
    const onStageIds = new Set(onStage.map((c) => c.id));

    // 不在场的：按"轮转＋封顶"挑，省额度（⛔ 不一轮全推）
    // ⭐ 现场保护（protectedBypass）：同楼已算过的不再重推；上一轮刚在现场演过（inScene）的排到轮转队尾，优先推久未露面的人
    const maxParallelSetting = clampNumber(settings.maxParallelChars, 0, 12, 6);
    /* ⭐谷歌复核（四）：重试时**角色数临时减半** ✓（避开中转站的瞬时抽风波峰 ✓）下限 2 ✓ */
    const maxParallel = (Number(attempt) >= 1)
        ? Math.max(2, Math.floor(maxParallelSetting / 2))
        : maxParallelSetting;
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
    /*
     * ⭐ 复审追加 B3：无主的顶层任务（没写名字）**只报一次**，⏔ 每行都报一遍。
     *   用法：把它们归到"第一行"身上（归属口径统一）。
     */
    const rowsArr = Array.isArray(rows) ? rows : [];
    const unownedTop = [];
    for (const r of rowsArr) {
        for (const q of (Array.isArray(r && r.allQuests) ? r.allQuests : [])) {
            if (q && !trimText(q.name || q.character)) {
                unownedTop.push(q);
            }
        }
    }
    const firstRow = rowsArr.length ? rowsArr[0] : null;
    if (firstRow && unownedTop.length) {
        firstRow.quests = (Array.isArray(firstRow.quests) ? firstRow.quests : []).concat(unownedTop);
    }

    for (const raw of rowsArr) {
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
            /*
             * ⭐ 复审追加 B3：**顶层任务只取"属于本行的"**。
             *   上一轮我把 `allQuests`（**全员的**顶层任务）原样拼进每一行
             *   ⇒ 一处越界会被**放大成 N 处**（每个角色行各报一条），
             *   而且 `hits.push(name + ...)` 里的 name 是**当前行角色名** ⇒ **张冠李戴**；编年里还重复落 N 遍。
             *   ⚠️ 无主的（没写名字）不在这里报——统一到**循环外只报一次**（见下面）。
             */
            const myName = trimText(raw && raw.name);
            const mineTop = (Array.isArray(raw.allQuests) ? raw.allQuests : []).filter((q) => {
                const who = trimText(q && (q.name || q.character));
                return !!who && !!myName && matchKey(who) === matchKey(myName);
            });
            const qsAll = [].concat(raw.quests || []).concat(mineTop);
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
    /* ⭐ R1（材料 05）：**这一轮里的几十次写盘合并成一批** ✓
     *   批内只记账 ⇒ 批收尾写一次 ✓（⏔ 改变批外行为 ✗）
     *   try/finally 保证：即使中间抛错，批也一定收尾、该落的盘照落 ✓ */
    beginSaveBatch();
    try {
        return await runUpdateInner(opts);
    } finally {
        endSaveBatch();
    }
}

async function runUpdateInner(opts) {
    const o = opts || {};
    if (running) {
        return { ok: false, reason: '上一轮还在跑' };
    }
    const settings = getSettings();
    if (!settings.enabled) {
        return { ok: false, reason: '总开关关着' };
    }

    running = true;
    markLive();
    /*
     * ⭐ L3（防御性）：**补批调进来时⏔ 重置取消标记**。
     *   她按取消后，补批循环会在**每楼开跑前**检查一次（当前路径靠那个检查兜住，所以现在不可达）；
     *   但只要将来有人在入口前面加一个 await，这里就会**把那次取消吞掉**。
     */
    if (o.keepCancel !== true) {
        cancelRequested = false;
    }
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
    /* ⭐ 谷歌（一）：分批时按**这一批楼层**拼材料 ✓；单楼旧行为照旧 ✓ */
    const msgs = (Array.isArray(o.batchFloors) && o.batchFloors.length)
        ? messagesOfFloors(o.batchFloors)
        : recentMessages(floor, Math.max(6, settings.recentTurns * 2));
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
    markLive();
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
                /* ⭐谷歌复核（二）：世界状态成功 ⇒ **立刻落盘** ✓ + 记下 worldAtFloor ✓
                 *   ⇒ 之后角色步挂了，**绝不回滚它** ✓（下次从这批的角色步接着跑 ✓） */
                try {
                    const stW = loadState();
                    stW.pipeline = Object.assign({}, stW.pipeline || {}, { worldAtFloor: floor });
                    saveState();
                } catch (eW) { /* ⏔ 影响主流程 */ }
                break;
            }
            lastError = worldRes.reason;
            /* ⭐ 业务层别瞎试：参数级的错（你再试一百次也一样 ✗）⇒ 直接放弃重试 ✓
             *   ⏔ 网络级（reset／超时／回体是 null）照旧多试 ✓；⏔ 402／额度类也照旧多试（免费站会恢复 ✓） */
            if (/INVALID_ARGUMENT|Model not found|Bad Request/i.test(String(lastError || ''))
                && !/ECONNRESET|Failed to fetch|ETIMEDOUT|socket hang up|\u8d85\u65f6|\u6ca1\u56de|Failed to Load/i.test(String(lastError || ''))) {
                break;
            }
            if (attempt < RETRY_LIMIT) {
                /* ⭐ 小退避：链路是“机场＋免费公益站”⇒ 抽风是常态 ✓ */
                /* 越试越等一会儿（第1次 300ms、第2次 600ms…✓）比连着猛敲更容易过 ✓ */
                setPipeline({ text: '世界状态这一步失败（' + lastError + '），重试第 ' + String(attempt + 1) + ' 次（最多 ' + String(RETRY_LIMIT) + ' 次）' });
                await sleep(2500 * Math.max(1, attempt));
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
            /* ⭐ 业务层别瞎试：参数级的错（你再试一百次也一样 ✗）⇒ 直接放弃重试 ✓
             *   ⏔ 网络级（reset／超时／回体是 null）照旧多试 ✓；⏔ 402／额度类也照旧多试（免费站会恢复 ✓） */
            if (/INVALID_ARGUMENT|Model not found|Bad Request/i.test(String(lastError || ''))
                && !/ECONNRESET|Failed to fetch|ETIMEDOUT|socket hang up|\u8d85\u65f6|\u6ca1\u56de|Failed to Load/i.test(String(lastError || ''))) {
                break;
            }
            if (attempt < RETRY_LIMIT) {
                /* ⭐ 小退避：链路是“机场＋免费公益站”⇒ 抽风是常态 ✓ */
                /* 越试越等一会儿（第1次 300ms、第2次 600ms…✓）比连着猛敲更容易过 ✓ */
                setPipeline({ text: '角色这一步失败（' + lastError + '），重试第 ' + String(attempt + 1) + ' 次' });
                await sleep(2500 * Math.max(1, attempt));
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
    const text = (cancelRequested ? '已取消（已跑的部分保留）' : (failed ? ('有一步没成'
        /* ⭐ 失败也别慌：链路＝“机场＋免费公益站”⇒ 偶发掉线是常态 ✓ */
        + (/ECONNRESET|Failed to fetch|ETIMEDOUT|socket hang up|超时|没回|null/i.test(String(lastError || ''))
            ? '（这次像是链路掉线 —— 等会儿再点一次「立刻更新」，会从停下的那楼接着走 ✓）'
            : ''))
        : '更新完成'))
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
            /* ⭐谷歌复核（二）：**世界状态也没成才整轮回滚** ✓；
         *   世界状态已成功并已落盘（见上方）⇒ **只回滚角色步**（角色状态本来就没脏 ✓） */
        if (!worldRes || worldRes.ok !== true) {
            restoreSnapshot(preSnap);
        }
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
    markLive();
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

    /* ⭐修复 1（材料 02）：扫描对象从“只读用户楼”改为“**全部有效正文楼**” ✓
     *   旧：只收 `is_user` 楼 ✗ ⇒ **AI 正文楼全部漏读** ✗（它们才是剧情主体 ✗）
     *   新：收所有非系统且有正文的楼（含 AI 楼、用户楼、**隐藏楼** ✓） */
    const validFloors = [];
    for (let i = 0; i < chat.length; i += 1) {
        const m = chat[i];
        if (m && !m.is_system && trimText(m.mes)) {
            validFloors.push(i);
        }
    }
    if (!validFloors.length) {
        return { ok: false, reason: '还没有可读的正文楼层' };
    }
    /* ⭐修复 1：**断点续跑** ✓
     *   未显式给 from/limit、且上次已推到某楼（还没追平末尾）⇒ 自动从 `atFloor + 1` 接着补 ✓ */
    const lastAt = Number((loadState().pipeline || {}).atFloor);
    const limEarly = Number.isFinite(o.limit) ? Math.floor(o.limit) : 0;
    let startFrom = 0;
    if (Number.isFinite(o.from) && o.from >= 0) {
        startFrom = o.from;
    } else if (limEarly <= 0 && Number.isFinite(lastAt) && lastAt >= 0 && lastAt < validFloors[validFloors.length - 1]) {
        startFrom = lastAt + 1;
    }
    const todo = validFloors.filter((f) => f >= startFrom);
    /*
     * ⭐ 首夜实测单第 3 条（她原话：「这旁边也没有自己设定的，我可以自己设定要补齐多少楼层」）：
     *   `opts.from` 早就有（从第 X 楼起补），缺的是**"就补最近 N 楼"** ⇒ 这里从**队尾往前数**取 N 个。
     *   ⚠️ 默认（不传 limit）＝照旧**全部补**（向后兼容，⛔ 不改老行为）。
     */
    const lim = Number.isFinite(o.limit) ? Math.floor(o.limit) : 0;
    // ⭐修复 1：修掉 TDZ 崩溃 ✓（原来在初始化前就读 `todo2.length` ✗ ⇒ 填范围必崩 ✗）
    const todo2 = lim > 0 ? todo.slice(Math.max(0, todo.length - lim)) : todo;
    if (!todo2.length) {
        return { ok: true, text: '没有要补的楼了' };
    }

    backfilling = true;
    markLive();
    cancelRequested = false;
    setPipeline({
        kind: 'backfill',
        status: 'running',
        step: '补推历史',
        startedAt: Date.now(),
        text: '准备补推 ' + String(todo2.length) + ' 个楼层',
        cursor: 0,
        /* ⭐修复 1：**去掉 `atFloor: -1`** ✓
         *   旧：每次补推开头把水位抹成 -1 ✗ ⇒ 上次停在哪楼就丢了 ✗（断点续跑失效 ✗）
         *   新：不碰它 ⇒ 下次点「补推历史」能从停下的楼接着走 ✓ */
        cancelRequested: false,
        conflicts: [],
    });

    let done = 0;
    let failedAt = '';
    /* ⭐ 谷歌（一）：**滑动字数窗分批** ✓（⏔ 逐楼一整轮 ✗） */
    // ⭐修复 1：修掉“传错变量” ✓（旧：传 `todo` ✗ ⇒ 她填的“只补最近 N 楼”**生效不了** ✗）
    //   并把“每轮最多喂多少字正文”的上限一并传进去 ✓
    const batches = buildScanBatches(todo2, worldMaterialCap());
    for (const batch of batches) {
        const floor = batch[batch.length - 1];
        if (cancelRequested) {
            break;
        }
        setPipeline({ text: '补推中：' + floorLabel(batch[0]) + '→' + floorLabel(floor) + '（已完成 ' + String(done) + '/' + String(todo2.length) + '）', cursor: done });
        // 一步一步来：每一步都是独立的一次更新（每步都在 2 分钟预算内）
        // eslint-disable-next-line no-await-in-loop
        // ⭐ L3：补批循环**传 keepCancel** ⇒ 入口不会把她刚按的"取消"吞掉（防御性）
        const res = await runUpdate({ manual: true, floor, batchFloors: batch, keepCancel: true });
        if (!res.ok) {
            failedAt = floorLabel(floor) + '：' + (res.reason || '失败');
            break;
        }
        done += batch.length;   /* ⭐ 一批算几楼 ✓（⏔ 按 1 楼加 ✗） */
        await sleep(400);   // 让界面喘口气，⛔ 不挡她聊天
    }

    backfilling = false;
    markLive();
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
