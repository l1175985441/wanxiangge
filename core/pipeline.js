/**
 * 万象阁 · 更新流水（世界状态＋角色八格＋平行事件＋编年）
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

import { CALLS_PER_TURN, RETRY_LIMIT, originId, originFeed, agendaOriginFeed } from './config.js';

/*
 * ⭐ 补④：输出被截断之后的重试策略。
 *
 *   她定的规矩：截断 ⇒ **这一轮算失败、账保持原样**，⛔ 猜着补全；
 *   重试时**加大输出额度**（但要有帽子）。
 *
 *   帽子怎么定的：基数（她设的 maxTokens）的 1.6 倍、且**不超 4000**。
 *     为什么是 4000：再高就只是提高费用与等待，而"截断"的根因多半是
 *     **模型写啰嗦**，不是额度不够 ⇒ 重试时一并要求它精简（见下面那句）。
 */
/* ⭐修复 2（材料 02）：解除写死的 Token 枷锁 ✗
 *   旧：推演请求输出上限写死 8000（重试时 4000）✗ ⇒ 长思考模型思考吃完就没正文 ✗
 *   新：上限 65536 ✓（材料 03 定稿：32000→65536 ✓） */
/* ⛔ 它不是用户可调的那个：这是**重试时**的内部封顶 ✓ */
const RETRY_TOKEN_CAP = 65536;

/** 重试时追加的一句（只在第 2 次起才发） */
/* P8 (material 07): the old notice claimed truncation even on network retries and told
 *   the model to report only the most important few, so roles went un-updated. */
const RETRY_TIGHTEN = '【重试提醒】上一次没成功（可能是网络抖动，也可能是 JSON 没写完）：这一次请**把该报的角色一个不漏地报全**（⛔ 只写最重要的几条）；若上次是 JSON 没写完，就把每条写得短一点、确保 JSON 闭合。';

/** 按重试次数算输出额度（⛔ 超帽子） */
function retryTokens(base, attempt) {
    const b = clampNumber(base, 200, RETRY_TOKEN_CAP, 1600);
    const a = Math.max(0, Math.round(Number(attempt) || 0));
    if (a <= 0) {
        return b;
    }
    /* ⭐ 重试时**只增不减** ✓（旧：底下限 200 ⇒ 会把用户额度倒扣砍半 ✗） */
    return clampNumber(Math.round(b * 1.5), b, RETRY_TOKEN_CAP, b);
}
import { getChat, personaNames, currentChatKey } from './adapter.js';
import { refreshViewsSoon } from './viewhook.js';
import { FRONT_SYSTEM, BACK_SYSTEM } from './prompts-presence.js';   /* 96：前后台两套提示词（各自独立） */
import { timeSpanOf, isUnavailable, justLeft, hasDrive, classifyPresence } from './presence.js';
import { splitPicked, planCalls, mergeSides, sideOutcome } from './chars-split.js';
import { lifeTickDue, countdownOf, shouldRunUpdate, pointOf } from './schedule.js';   /* 102：日程四根里的生活节拍／提前量 */   /* 96：前后台判定／时间跨度 */
import { runLayers } from './layers.js';
import { screenOnStage } from './screen.js';   /* 13：在场筛选独立一步 */   /* 98：世界／局势／暗流三层独立提示词 */   /* 86#5/#6：跑完刷新界面 */
import { getSettings, effectivePrompt } from './settings.js';
import { isBlankOrUnknownish } from './rules.js';   /* 1-c #7：一句判断单独成件 */
// ⭐ 补② 送达回执用 markArrivals：对着新正文核上一轮注入的条目
import {
    loadState, saveState, takeSnapshot, addChronicle, pushPast, pushStep, upsertHidden, setEvents,
    updateWorld, upsertQuest,
    markArrivals,
    addKnow,
    restoreSnapshot,
    dropSnapshot,
    rememberRollCheckpoint,
    getRollCheckpoint,
    capList,
    getRoster,
    isPlayerCharacter,
    beginSaveBatch, endSaveBatch, bindChatForRun, unbindChatForRun, factionPassesGate, dueRollup, rollupPast, upsertFaction, upsertWorldFact, upsertPulseDomain, markPulseCoverage, upsertWind, listWindsView, ROLE_WEIGHT } from './state.js';
import { callModelJson, lastApiAttempts, resetApiAttempts } from './apiclient.js';   /* 4-b #3：记账三格 */
import { captureOwner, checkOwner } from './owner.js';
import { claim, release } from './gate.js';
import { stampSource, floorText } from './provenance.js';
import { render, noteText } from './prompt.js';
import { notePending } from './overlay.js';   /* 硬-6：锁住的格要记下“本来会改成什么” */   /* 硬-3：prompt 的唯一可审计出口 */   /* 硬-2：每条派生数据带上“从哪来” */
import { cleanMessages, isHiddenMessage } from './extract.js';
import { isLineDue, nextStage, isLineDone, clockWentBackwards, parseClock, clockDistance, dueToAbsoluteMinute } from './clock.js';
import { addElapsed, stripModelDateFields } from './world-events.js';   /* 100：走钟／模型无权写绝对时间 */
import { markBookDirty } from './book.js';
import { clockAnchor } from './gametime.js';
import { syncFromPhone, ensureRow } from './affinity.js';   /* 新活：手机里有数就原样抄进表 */   /* 决定①：世界钟先解析、能解才当锚 */
import { trimText, asText, clampNumber, uniqueBy, floorLabel, matchKey } from './utils.js';
import { lastInjectInfo, mentionedCharacters } from './recall.js';

let running = false;
/*
 * ⭐⭐ 真机抓到：那个持久化的 step 会**卡死**（一轮中途死了没清标记 ✗）
 *   ⇒ 之后每次进来都说“正在跑” ⇒ **重活按钮永久禁用** ✗✗
 *   ⇒ 这里把“本会话真的在跑”暴露成 window 标记（**内存态** ✓ 重载即失效 ✓）
 *   ⇒ 界面只认它（⛔ 只认持久化那个 ✗）：卡死的标记就不再欺骗她了 ✓
 */
function markLive() {
    try { if (typeof window !== 'undefined') { window.__wxgLiveRun = Boolean(running || backfilling); } } catch (e) { /* ⛔ 影响主流程 */ }
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
 *   ⛔ 许发明**具体事件／处境**（⛔"被困在…待解救"式事故叙述）。
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
     *   —— 这是**意图／方向**（需求书：任务＝目标层，"意图／方向可以写"）⇒ **⛔ 误拦**。
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
 * ★ [579]：有没有「替我做决定」的写法（正文还在等表态，却写成我已选／已答）。
 *   ⚠️ 只标不可靠；「待我做决定」本身不算违规。
 */
/* 125：只剥“归别人”的直接引语（引号前 ~14 字有别人当主语的转述动词）；
 * 裸引语（没归属）与“我说：…”一律照判 —— 26 格那个洞就在裸引语。 */
function stripOtherQuotes(text) {
    return String(text).replace(/[“「『"]([^”」』"]{0,120})[”」』"]/g, (m, inner, offset, whole) => {
        const pre = String(whole).slice(Math.max(0, offset - 14), offset);
        const verbEnd = /(?:说|问|喊|道|答|嘟囕|低声|开口|笑道)\s*[：:]?\s*$/.test(pre);
        const mine = /我\s*(?:说|问|喊|道|答|嘟囕|低声|开口|笑道)\s*[：:]?\s*$/.test(pre);
        const other = verbEnd && !mine;
        return other ? ' ' : m;
    });
}
const DECIDE_FOR_ME_PAT = /我(?:已经)?(?:答应|同意|决定|选择|选定|点头|拒绝)(?:了|过)?|让我(?:选|决定|答应)|替我(?:选|决定)|我选了|我答(?:应|道了)/;
export function looksLikeDecidingForMe(text, opts) {
    const t = asText(text);
    if (!t) return false;
    /*
     * ★ 20261022 B3（设计稿·六档名册）：**「路过」与「不用」的卡，模型给它写任何动作/台词都算越界**。
     *   档位权重 0 ⇒ 不该被描写（他们只在被找时回应，或根本不属于这个故事）。
     *   ⛔ 影响高档：只有 role 权重 0 才走这条 ✓
     */
    const role = trimText(opts && opts.role);
    if (role) {
        const w = Number(ROLE_WEIGHT[role]);
        if (Number.isFinite(w) && w === 0) {
            return true;
        }
    }
    /* ★ 20261022 ⑦：豁免词不能整句短路（否则「我答应了她，等她回话」整句放过）⇒ 先摘掉豁免片段再判 */
    const STRIPPED = stripOtherQuotes(t).replace(/待我做决定|待我决定|等她回话|待玩家表态|等你回话|待你决定/g, '');
    /* ★ ⑥：模型用她真名当主语写动作，也当代控拦下 ✓ */
    if (looksLikeDecidingByName(t)) { return true; }
    return DECIDE_FOR_ME_PAT.test(STRIPPED);
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
function buildScanBatches(floors, charBudget) {
    /* 渲染层 #8：这个参数数的是**字符数**（与 capPeople 同名两义时就是这里出错），改名 charBudget */
    const cap = clampNumber(charBudget, 500, 20000, 3000);
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
/**
 * ⭐⭐ 修复 5（材料 02）并按材料 03 定稿改造 ✓：**剥掉“不在现场”的人** ✓
 *   病根：卡面 <meow_FM> 里的 `archived:`（后台归档角色）与标了 `已离场` 的人没被剥掉 ✗
 *         ⇒ **哪怕只看最新 1 楼**，露娜／地场卫／妖魔也会被判成“在场” ✗ ⇒ 刷屏报「现场编造」✗
 */
function stripOffStageSections(text) {
    let s = asText(text);
    s = s.replace(/\n\s*archived\s*[:：][\s\S]*?(?=\n[a-zA-Z_]+\s*[:：]|\n<\/|\n\[\/|$)/gi, '\n');
    s = s.replace(/◈\s*[^\n]+\n(?:[├│└][^\n]*\n){0,3}?[├│└][^\n]*?(?:已离场|不在场|未出场)[^\n]*/g, '');
    s = s.replace(/^.*(?:已离场|不在场|镜头外).*$/gm, '');
    return s;
}
/** 这一楼正文里出现了哪些名册上的人（认全名与别名；决定谁"在现场"） */
function whoIsOnStage(text, roster) {
    return mentionedCharacters(stripOffStageSections(text), roster);
}
/* 世界步的 system 尾巴（硬-3：它也要进同一条记账，⛔ 只记 prompt） */
const WORLD_SYS_TAIL = '\n\n⛔ 因果（每条新变化都必须回答）：为什么是**现在**发生？前因／诱因／到点，必须指得出；说不清就保持安静，⛔ 为了有事发生而编一个。'
    + '\n\n⛔ 若上文里出现「摘要／前情提要／剧情梗概」这类段落，一律**当背景参考**，不许把其中的字句当成**本轮正文发生过的事实**；拿不准就只说现在能确认的那部分。';
/* ------------------------------ 世界状态那一步 ------------------------------ */
/*
 * ⭐⭐ 拆小（她的话：「每个都是一下子弄一点点，然后继续下一轮」）
 *   真机取证：她那站对长请求一律掉线（直连 reset、转发 502+ECONNRESET、**连流式也照掉** ✗）；短请求通 ✓
 *   ⇒ 让请求**本身就短**：喂进去的正文超长时，**只带最近一段** ✓（最近的才是当前世界状态最需要的 ✓）
 *   ⛔ 不动结构：世界钟／地点／总览／局势／暗线照旧全给 ✓（只缩正文那一块 ✓）
 */
const WORLD_MATERIAL_CAP = 6000;   /* 默认值；真正用的是她在面板里填的那个数 ✓ */
function worldMaterialCap() {
    let v = WORLD_MATERIAL_CAP;
    try {
        const a = getSettings().api || {};
        const num = Number(a.materialCap);
        if (Number.isFinite(num) && num >= 500) { v = num; }
    } catch (e) { /* ⛔ 影响主流程 */ }
    return Math.min(Math.max(Math.round(v), 500), 40000);
}
/*
 * ⭐⭐ 谷歌复核（三）：局势**增量归并** ✓（照此落码、一个字不动 ✓）
 *   病灶：原来 `if (fresh.length) { updateWorld({ situations: fresh }, {}) }`
 *         ⇒ **用本批产出的几条势局把旧数组整锅端了** ✗（逐批补扫时后批冲掉前批 ✗）
 *   ⇒ 现在：同名／二元组覆盖率≥0.45 认作同一场局势演进 ⇒ 原地更新 ✓；
 *         **`manual`（她手改锁定的）不覆盖** ✓；新的才 push ✓
 */
/**
 * ★ 需求清单 [579]：世界钟几乎没走 ⇒ 局势**不轻易成熟**（压力不能每回合乱跳）。
 *   「一看时间过去不到几分钟所以这个事件不会轻易成熟」
 *   · 钟读不出／过去不到 30 分钟 ⇒ 压力只许持平或下降，不许涨
 *   · 过去不到 3 小时 ⇒ 一次最多 +1
 *   · 再久才允许模型给的涨幅
 */
function dampenSituationPressure(oldP, newP, deltaMin) {
    if (!Number.isFinite(Number(newP))) {
        return Number.isFinite(Number(oldP)) ? Number(oldP) : null;
    }
    const np = Math.max(0, Math.min(5, Number(newP)));
    if (!Number.isFinite(Number(oldP))) {
        return np;
    }
    const op = Number(oldP);
    if (np <= op) {
        return np;
    }
    const d = Number(deltaMin);
    if (!Number.isFinite(d) || d < 30) {
        return op;
    }
    if (d < 180) {
        return Math.min(np, op + 1);
    }
    return np;
}
const EVIDENCE_RANK = { fact: 3, confirmed: 2, inferred: 1, conservative: 0 };
function topTierOf(list) {
    let best = -1;
    let tier = '';
    for (const x of (Array.isArray(list) ? list : [])) {
        const r = Object.prototype.hasOwnProperty.call(EVIDENCE_RANK, String(x && x.tier)) ? EVIDENCE_RANK[String(x.tier)] : -1;
        if (r > best) { best = r; tier = String(x.tier || ''); }
    }
    return { rank: best, tier };
}
export function mergeSituationFields(old, inc, clockDeltaMin, layer) {
    /* 108：低档不覆盖高档（同档比先落账）；低档那条留成 basis:未证实 */
    {
        const oldTop = topTierOf(old && old.evidenceTiers);
        const incTop = topTierOf(inc && inc.evidenceTiers);
        if (oldTop.rank >= 0 && incTop.rank >= 0 && incTop.rank < oldTop.rank) {
            return Object.assign({}, old, { basis: '未证实', lowEvidence: incTop.tier, lowEvidenceAt: Date.now() });
        }
        /* 同档：先落账的赢 ⇒ 不覆盖（不要一直刷新同一条） */
        if (oldTop.rank >= 0 && incTop.rank === oldTop.rank) {
            /* 114：同档分两种——A 同层同档：**新的赢**；B 跨层同档：**先落账的赢**（⛔ 按哪层重要） */
            const oldLayer = String((old && old.evidenceLayer) || '');
            const incLayer = String(layer || '');
            if (oldLayer && incLayer && oldLayer !== incLayer) {
                return Object.assign({}, old);
            }
        }
    }
    const nextP = dampenSituationPressure(old && old.pressure, inc && inc.pressure, clockDeltaMin);
    return Object.assign({}, old, {
        title: trimText(inc.title) || old.title,
        sides: trimText(inc.sides) || old.sides,
        tier: trimText(inc.tier) || old.tier,
        cause: trimText(inc.cause) || old.cause,
        effect: trimText(inc.effect) || old.effect,
        /* ★ [580] A6：预期／实果／余波（空不冲掉旧值） */
        expected: trimText(inc.expected || inc.expectedResult) || old.expected,
        result: trimText(inc.result) || old.result,
        consequence: trimText(inc.consequence) || old.consequence,
        origin: (() => {
            const o = String(trimText(inc.origin) || '').toLowerCase();
            const okOrigin = originId(o);
    if (okOrigin) { return okOrigin; }
            return trimText(old.origin) || '';
        })(),
        pressure: nextP,
        trend: trimText(inc.trend) || old.trend,
        /* visibility 归一在落 events 时再走 resolveVisibility；这里先留模型／旧值 */
        visibility: trimText(inc.visibility) || old.visibility,
        evidence: trimText(inc.evidence) || old.evidence,
        evidenceTiers: (Array.isArray(inc.evidenceTiers) && inc.evidenceTiers.length) ? inc.evidenceTiers : (Array.isArray(old.evidenceTiers) ? old.evidenceTiers : []),
        evidenceLayer: String(layer || (old && old.evidenceLayer) || 'situation'),
        at: Date.now(),
        floor: Number.isFinite(Number(inc.floor)) ? Number(inc.floor) : old.floor,
        source: trimText(inc.source) || old.source,
    });
}
function mergeSituations(oldList, freshList, clockDeltaMin, layer) {
    const merged = (Array.isArray(oldList) ? oldList : []).map((s) => Object.assign({}, s));
    const delta = Number.isFinite(Number(clockDeltaMin)) ? Number(clockDeltaMin) : null;
    for (const inc of Array.isArray(freshList) ? freshList : []) {
        const title = trimText(inc && inc.title);
        if (!title) continue;
        const idx = merged.findIndex((old) => old && (
            matchKey(old.title) === matchKey(title)
            || textAppearsIn(title, old.title)
            || textAppearsIn(old.title, title)
        ));
        if (idx >= 0) {
            if (merged[idx].manual) continue; // 她手改锁定的局势不覆盖
        /* ⭐ Q1（材料 05 · 她原话 [318]–[322]）：局势推进也要留编年 ✓
         *   旧：引擎只给「暗线新增」与「暗线推进」写编年 ✗
         *     ⇒ **所有局势点开浮层「因果」永远是空的** ✗
         *     （“世界账里还没记到这一条” ✗） */
        try {
            addChronicle({
                floor: Number.isFinite(Number(inc.floor)) ? Number(inc.floor) : -1,
                kind: '局势·推进',
                who: '',
                text: trimText(merged[idx].title) + '（' + trimText(title) + '）',
            });
        } catch (eCh1) { /* 记不上也不能把世界步搞挂 ✓ */ }
            merged[idx] = mergeSituationFields(merged[idx], Object.assign({}, inc, { title }), delta, layer);
        } else {
            /*
             * ⭐⭐ R12（材料 05）：**合不上时先找最像的那条并进去** ✓
             *   旧：二元组重合度低于阈值就当**新局势 push** ✗
             *     ⇒ 模型换个措辞（主谓语一变）就合不上 ✗
             *     ⇒ 塞满 60 条（capEvents）才开始淘汰 ✗ ⇒ 面板与每轮提示词越来越臃肿 ✗
             *   现在：先算“跟现有哪条最像”（双字重合率 ✓），
             *     ≥ 0.25 就**并进去（保留原标题 ✓）**；真不像才 push ✓
             */
            const gramsOf = (txt) => {
                const s2 = matchKey(txt);
                const g2 = [];
                for (let i = 0; i + 2 <= s2.length; i += 1) {
                    g2.push(s2.slice(i, i + 2));
                }
                return g2;
            };
            const gNew = gramsOf(title);
            let bestIdx = -1;
            let bestScore = 0;
            if (gNew.length) {
                for (let k = 0; k < merged.length; k += 1) {
                    const old = merged[k];
                    if (!old || old.manual) {
                        continue;   /* 她手改锁定的不动 ✓ */
                    }
                    const gOld = gramsOf(old.title || '');
                    if (!gOld.length) {
                        continue;
                    }
                    const seen = new Set(gOld);
                    let hit = 0;
                    for (const g of gNew) {
                        if (seen.has(g)) {
                            hit += 1;
                        }
                    }
                    const score = hit / Math.max(1, Math.min(gNew.length, gOld.length));
                    if (score > bestScore) {
                        bestScore = score;
                        bestIdx = k;
                    }
                }
            }
            if (bestIdx >= 0 && bestScore >= 0.25) {
                /* 并进去：**标题保留原来那个** ✓（⛔ 让列表越来越长 ✗） */
                const keepTitle = trimText(merged[bestIdx].title);
                merged[bestIdx] = mergeSituationFields(
                    merged[bestIdx],
                    Object.assign({}, inc, { title: keepTitle }),
                    delta,
                );
            } else {
                /* 新建：首轮压力照收（还没有“上一拍”可比） */
                merged.push(inc);
                /* Q1：新增局势也留一条编年 ✓（⛔ ℱ果区空着 ✗） */
                try {
                    addChronicle({
                        floor: Number.isFinite(Number(inc.floor)) ? Number(inc.floor) : -1,
                        kind: '局势·新增',
                        who: '',
                        text: trimText(inc.title),
                    });
                } catch (eCh2) { /* 同上 ✓ */ }
            }
        }
    }
    return merged;
}
/**
 * ⭐ 材料 11 · 零（P4 补充）：**把「user 是谁」真的喂进提示词** ✓
 *   来源：`personaNames()`（酒馆当前人设名 ✓）＋ 名册里**标了玩家棋子**的名字与别名 ✓
 *   去重后拼成一串 ✓；一个都没有 ⇒ 回「玩家」 ✓（⛔ 回空字串 ✗）
 */
/**
 * ★ 20261022 ⑥ ＋ 20261023 §①：代控门要认得她的真名与别名（自称字不是全部）。
 */
function playerNamesArr() {
    try {
        const out = [];
        const seen = new Set();
        const push = (raw) => {
            const nm = trimText(raw);
            const k = matchKey(nm);
            if (!nm || !k || seen.has(k)) { return; }
            seen.add(k);
            out.push(nm);
        };
        for (const nm of (personaNames() || [])) { push(nm); }
        for (const c of (loadState().characters || [])) {
            if (!c || (c.isPlayer !== true && c.isYou !== true)) { continue; }
            push(c.name);
            for (const al of (Array.isArray(c.aliases) ? c.aliases : [])) { push(al); }
        }
        return out;
    } catch (e) {
        return [];
    }
}
/** 她名字后面跟着这些动词 ⇒ 算“替她行动”（只列常见的，⛔ 无限铺） */
const ME_ACTION_VERBS = ['答应', '答了', '说', '问', '喊', '笑', '点头', '摇头', '转身', '走', '跑', '跨', '坐', '站', '拿', '推', '括', '伸手', '抬起', '决定', '同意', '拒绝', '答应了', '出门', '回屋'];
/** 名字当主语且后面跟动词 ⇒ true（宾语位／所有格不算） */
function looksLikeDecidingByName(text) {
    const t = asText(text);
    if (!t) { return false; }
    for (const nm of playerNamesArr()) {
        if (!nm) { continue; }
        let from = 0;
        for (;;) {
            const at = t.indexOf(nm, from);
            if (at < 0) { break; }
            from = at + nm.length;
            const next = t.charAt(at + nm.length);
            if (next === '的') { continue; }
            const before = t.slice(Math.max(0, at - 4), at);
            if (/[对给向跟和与朝冲让被叫看望等问帮替自我到在从往至进出回过]/.test(before)) { continue; }
            const after = t.slice(at + nm.length, at + nm.length + 6);
            if (ME_ACTION_VERBS.some((v) => after.indexOf(v) >= 0)) { return true; }
        }
    }
    return false;
}
/**
 * ★ 20261022 ⑧：上一轮被判“不可靠”（似嫌编造／越界）的正在经历，⛔ 当既定事实喂回去。
 *   做法：不屏蔽（屏蔽会让上下文断），但前面挂一行明确警示 ✓
 */
export function currentPromptLine(c) {
    const cur = trimText(c && c.current);
    if (!cur) { return ''; }
    if (c && c.currentSuspect === true) {
        const why = trimText(c.currentSuspectWhy) || '疑似越界';
        return '⚠ 上一轮这段被判不可靠（' + why + '），⛔ 当既定事实写：' + cur;
    }
    return cur;
}
function playerNamesForPrompt() {
    try {
        const out = [];
        const seen = new Set();
        const push = (raw) => {
            const nm = trimText(raw);
            const k = matchKey(nm);
            if (!nm || !k || seen.has(k)) {
                return;
            }
            seen.add(k);
            out.push(nm);
        };
        for (const nm of (personaNames() || [])) {
            push(nm);
        }
        for (const c of (loadState().characters || [])) {
            if (!c || (c.isPlayer !== true && c.isYou !== true)) {
                continue;
            }
            push(c.name);
            for (const al of (Array.isArray(c.aliases) ? c.aliases : [])) {
                push(al);
            }
        }
        return out.length ? out.join('／') : '玩家';
    } catch (eUser) {
        return '玩家';
    }
}
function capWorldMaterial(txt, attempt) {
    /* ⭐⭐ 链路是抽风型的（一会儿 400、一会儿回体 null ✗）
     *   ⇒ **每多试一次，就把喂进去的正文再缩一档** ✓（下限 600 字，⛔ 缩到没东西可看 ✗）
     *   ⛔ 不动结构：局势／暗线照旧全给 ✓（只缩正文那一块 ✓） */
    let cap = worldMaterialCap();
    if (Number(attempt) > 0) { cap = Math.max(600, Math.floor(cap / (Number(attempt) + 1))); }
    const s = String(txt == null ? '' : txt);
    if (!s.trim()) { return '（没有可读的正文）'; }
    if (s.length <= cap) { return s; }
    return '（前文太长，只带最近 ' + String(cap) + ' 字 ✓）\n' + s.slice(-cap);
}
/**
 * ★ R32（第二批 1019）：**世界脉动四格要真的喂给主模型**，不能只存在账里。
 *   pressure（压力 0-5）／trend（趋势）／visibility（可见度）／evidence（**原文引用**，不是评语）。
 *   ⛔ 这里只排事实：不写“所以接下来会…”——那是抢主模型的活 ✓
 */
export function situationLineForPrompt(s) {
    const src = s && typeof s === 'object' ? s : {};
    const bits = [];
    if (trimText(src.sides)) { bits.push('哪几方：' + trimText(src.sides)); }
    if (trimText(src.tier)) { bits.push('火候：' + trimText(src.tier)); }
    /* ★ [580] B1：来路三型进推演喂料 ✓ */
    const ori = String(trimText(src.origin) || '').toLowerCase();
    /* I4：喂料文案从 ORIGIN_TYPES 派生（⛔ 这里再写一份枚举） */
    if (originFeed(ori)) { bits.push(originFeed(ori)); }
    if (Number.isFinite(Number(src.pressure)) && src.pressure !== null && src.pressure !== '') {
        bits.push('压力：' + String(Number(src.pressure)) + '/5');
    }
    if (trimText(src.trend)) { bits.push('趋势：' + trimText(src.trend)); }
    if (trimText(src.visibility)) { bits.push('可见度：' + trimText(src.visibility)); }
    if (trimText(src.evidence)) { bits.push('原文证据：“' + trimText(src.evidence) + '”'); }
    if (Number.isFinite(Number(src.floor)) && Number(src.floor) >= 0) {
        bits.push('上次动：第' + String(Number(src.floor)) + '楼');
    }
    return trimText(src.title) + (bits.length ? '（' + bits.join('；') + '）' : '');
}
/**
 * ★ 补单 1-⑤：**不额外调一次模型**——就在本来就要跑的那一轮里，顺手要一条 L1 阶段小结。
 *   剪刀规则照世界背面：180–320 字；只留会影响未来理解的事，枝节可以主动放下 ✓
 */
export function rollupInstructionFor(c) {
    const victims = dueRollup(c);
    if (!victims.length) {
        return '';
    }
    const oldest = victims.map((v) => trimText(v.text)).filter(Boolean).slice(0, 12);
    return '  【压缩】这个人已攒了 ' + String(victims.length) + ' 条逐轮摘要，请压成**一条**阶段小结（180–320 字），'
        + '只留会影响未来理解的事，枝节可以主动放下；输出字段 rollup（就这一条）。原句：' + oldest.join('；');
}
/**
 * ★ 20261022 ⑫（22 单）：**世界钟要在 stepWorld 之前就更新**。
 *   原来从正文抽 time: 是**角色步收尾**写的 ⇒ stepWorld 用的是上一轮旧钟（首轮空钟）
 *   ⇒ `clockDeltaMin` 恒为 0 ⇒ 局势压力永远算不出时间差、暗线到点也推不动。
 *   这里把它提前跑一次（只读 rawText，⛔ 请模型）。
 */
export function prefillClockFromBody(material) {
    try {
        const rawNow = String(material && material.rawText ? material.rawText : '');
        if (!rawNow) { return false; }
        const mTime = rawNow.match(/(?:time|时间)\s*[:：]\s*([^\n]{3,60})/i);
        const got = mTime && trimText(mTime[1]);
        if (!got) { return false; }
        const oldClock = loadState().world.clock;
        if (clockWentBackwards(oldClock, got)) { return false; }
        updateWorld({ clock: got }, {});
        return true;
    } catch (e) {
        return false;
    }
}
async function stepWorld(material, attempt) {
    const settings = getSettings();
    const state = loadState();
    const world = state.world || {};
    const hiddenLines = (world.hidden || [])
        .filter((h) => !isLineDone(h.stage))
        .map((h) => {
            const due = isLineDue(h, world.clock);
            const ao = trimText(h.agendaOrigin);
            const aoTag = agendaOriginFeed(ao);   /* I4：暗线来源也只有一张表 */
            return '· ' + h.name + '【' + h.stage + '】'
                + (trimText(h.owner) ? '（盘算人：' + trimText(h.owner) + '）' : '')
                + (trimText(h.goal) ? '（目标：' + trimText(h.goal) + '）' : '')
                + (aoTag ? '（' + aoTag + (trimText(h.agendaRef) ? '→' + trimText(h.agendaRef) : '') + '）' : '')
                + '到点条件：' + (h.trigger || '（没写）')
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
    /*
     * ★ P1-1：**已知势力随世界步一起给模型**（它看不见这张名单，但它要用同一个名字）。
     *   只给名字与核心人；⛔ 给它编造势力的机会 ✓
     */
    /* ★ P1-2：小分量势力不进推演名单（⛔ 丢它的账，只是不每轮喂 ✓） */
    /* ★ [580] C1：喂运势／对玩家态度／范围／支柱（事实可喂，⛔ 表演） */
    const knownFactions = (loadState().world.factions || [])
        .filter((f) => f && trimText(f.name) && factionPassesGate(f))
        .map((f) => {
            const bits = [];
            if (trimText(f.core_person)) { bits.push('核心人：' + trimText(f.core_person)); }
            if (trimText(f.scale)) { bits.push('规模：' + trimText(f.scale)); }
            if (trimText(f.status)) { bits.push('运势：' + trimText(f.status)); }
            if (trimText(f.relation)) { bits.push('对玩家：' + trimText(f.relation)); }
            if (trimText(f.scope)) { bits.push('范围：' + trimText(f.scope)); }
            const pillars = Array.isArray(f.powerPillars) ? f.powerPillars.map(trimText).filter(Boolean) : [];
            if (pillars.length) { bits.push('支柱：' + pillars.join('／')); }
            return trimText(f.name) + (bits.length ? '（' + bits.join('；') + '）' : '');
        })
        .filter(Boolean);
    const prompt = render('world', effectivePrompt('world'), {   /* 硬-3：唯一组装入口 */
        user: playerNamesForPrompt(),
        world: [
            '世界钟：' + (trimText(world.clock) || '未知'),
            world.place ? '地点：' + trimText(world.place) : '',
            world.bigPicture ? '总览：' + trimText(world.bigPicture) : '',
            /* ★ [580]／观棋 B4：上轮点名名单真喂进提示词（提示词已写「必须解锁」） */
            (Array.isArray(world.spotlight) && world.spotlight.length
                ? '【上轮点名·本轮必须有下文】' + world.spotlight.map(trimText).filter(Boolean).join('／')
                : ''),
            /* P10b (material 07): feed sides + tier too, and tell it to keep unchanged titles. */
            '局势（**没变的就沿用原标题、原样写回去**，⛔ 换句式重写）：'
                + ((world.situations || []).map((s) => situationLineForPrompt(s))
                    .filter(Boolean).join('；') || '（还没有）'),
        ].filter(Boolean).join('\n'),
        clock: trimText(world.clock) || '未知',
        recent: capWorldMaterial(material.recentText, attempt),   /* ⭐ 拆小：超长只带最近一段 ✓ */
        hidden: hiddenLines,
        factions: knownFactions.join('；') || '（还没登记势力）',
        /* ★ [580] A3：键值事实给引擎对齐用（短列表；⛔ 不当叙述长文） */
        worldFacts: ((loadState().world.facts || [])
            .map((f) => trimText(f && f.subject) + '｜' + trimText(f && f.field) + '＝' + trimText(f && f.value))
            .filter(Boolean)
            .slice(0, 24)
            .join('；')) || '（还没有）',
        /* ★ [580] C3：风声短列表（未证实；对齐 A1 trace） */
        worldWinds: (listWindsView(12).map((x) => trimText(x.topic) + (trimText(x.text) && trimText(x.text) !== trimText(x.topic) ? '＝' + trimText(x.text) : '')).filter(Boolean).join('；')) || '（还没有）',
        /* ★ [580] A4：独立脉动域＋最近巡查（短列表；可巡镜头外） */
        worldPulse: (() => {
            const pul = (loadState().world && loadState().world.pulse) || {};
            const doms = (Array.isArray(pul.domains) ? pul.domains : []).map((d) => {
                if (!d || !trimText(d.label)) { return ''; }
                const bits = [trimText(d.label)];
                if (trimText(d.kind) && trimText(d.kind) !== 'other') { bits.push(trimText(d.kind)); }
                if (Number.isFinite(Number(d.pressure))) { bits.push('压' + String(d.pressure)); }
                if (trimText(d.trend)) { bits.push(trimText(d.trend)); }
                if (trimText(d.visibility)) { bits.push(trimText(d.visibility)); }
                if (trimText(d.state)) { bits.push(trimText(d.state).slice(0, 40)); }
                return bits.join('·');
            }).filter(Boolean).slice(0, 12);
            const cov = (((pul.coverage || {}).entries) || []).map((e) => trimText(e && e.label)).filter(Boolean).slice(0, 8);
            const parts = [];
            parts.push(doms.length ? ('域：' + doms.join('；')) : '域：（还没有）');
            if (cov.length) { parts.push('最近巡查：' + cov.join('／')); }
            return parts.join(' ｜ ');
        })(),
        blastMax: String(clampNumber(settings.blastRadiusMax, 1, 20, 3)),
    });
    const tryN = Math.max(0, Math.round(Number(attempt) || 0));
    const res = await callModelJson({
        prompt: tryN > 0 ? (prompt + '\n\n' + RETRY_TIGHTEN) : prompt,
        /*
         * 依据＝第 7 问 P3（她 [594]「真的得因果关系」）：世界步每个新变化都要说得出「为什么现在发生」。
         * 硬-3 收尾：破限词与尾巴也进同一条记账（⛔ 只记用户提示词）。
         */
        system: noteText('system-world', effectivePrompt('jailbreak') + WORLD_SYS_TAIL),
        maxTokens: retryTokens((settings.api || {}).maxTokens, tryN),
    });
    if (!res.ok) {
        return { ok: false, reason: res.reason };
    }
    const v = res.value || {};
    /*
     * ★ [580]／观棋 B2：提示词已写「省键＝白跑」，引擎必须**真拒** ✓
     *   旧：缺 clock／place／bigPicture／situations／hidden 仍照单更新 ✗ ⇒ 世界半截动、额度白烧 ✗
     *   现在：少一组键 ⇒ ok:false（上层重试）；空串／空数组算齐 ✓，⛔ 整组省掉不算 ✓
     */
    {
        const WORLD_KEYS = ['clock', 'place', 'bigPicture', 'situations', 'hidden'];
        const missing = WORLD_KEYS.filter((k) => !Object.prototype.hasOwnProperty.call(v, k));
        const badType = [];
        if (Object.prototype.hasOwnProperty.call(v, 'situations') && !Array.isArray(v.situations)) {
            badType.push('situations（必须是数组）');
        }
        if (Object.prototype.hasOwnProperty.call(v, 'hidden') && !Array.isArray(v.hidden)) {
            badType.push('hidden（必须是数组）');
        }
        if (missing.length || badType.length) {
            const bits = [];
            if (missing.length) { bits.push('少了键：' + missing.join('／')); }
            if (badType.length) { bits.push('类型不对：' + badType.join('／')); }
            return {
                ok: false,
                reason: '输出不全（' + bits.join('；') + '）——省键＝这轮白跑，世界原地不动',
            };
        }
    }
    /* 100：**走钟**——只累加模型给的 elapsed_minutes（⛔ 模型无权重栰绝对日期） */
    {
        /* 100：模型无权写绝对时间（⛔ clockMinute／clock_anchor） */
        const clean = stripModelDateFields(v);
        const el = Number(clean.elapsed_minutes);
        if (Number.isFinite(el) && el > 0) {
            const r = addElapsed(loadState(), el, material.rawText || '');
            if (r.reason) {
                conflicts.push(r.reason);
            }
            saveState();
        }
    }
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
    /*
     * ★ [580] C1：势力厚度可选回写。
     *   五组必须键不动；没带 factions 键＝这轮没改势力，不算省键白跑。
     *   只更新已在册的名字（⛕ 模型现造新势力）。
     */
    if (Array.isArray(v.factions)) {
        let facN = 0;
        const knownNames = (loadState().world.factions || [])
            .map((f) => matchKey(f && f.name)).filter(Boolean);
        for (const raw of v.factions) {
            const nm = trimText(raw && (raw.name || raw.title));
            if (!nm) { continue; }
            if (!knownNames.includes(matchKey(nm))) {
                notes.push('势力「' + nm + '」不在册，没新建');
                continue;
            }
            /* ★ [580] B5：势力只写 scale；误来的 power 交给 normalizeFaction 辨是否规模词 */
            upsertFaction({
                name: nm,
                status: trimText(raw && raw.status),
                relation: trimText(raw && raw.relation),
                scope: trimText(raw && raw.scope),
                core_person: trimText(raw && raw.core_person),
                scale: trimText(raw && raw.scale),
                power: trimText(raw && raw.power),
                note: trimText(raw && raw.note),
                powerPillars: raw && raw.powerPillars,
                floor: material.floor,
            });
            facN += 1;
        }
        if (facN) { notes.push('势力厚度更新 ' + String(facN) + ' 条'); }
    }
    const situations = Array.isArray(v.situations) ? v.situations : [];
    if (situations.length) {
        const fresh = situations.map((s) => ({
            title: trimText(s && (s.title || s.text)),
            sides: trimText(s && s.sides),
            tier: trimText(s && s.tier),
            /* ⭐ C12（材料 13）：**因果两格要存下来** ✓（旧：没这两格 ⇒ 因果永远空 ✗） */
            cause: trimText(s && (s.cause || s.from || s.起因)),
            effect: trimText(s && (s.effect || s.to || s.走向)),
            /* ★ [580] A6：后果三格 */
            expected: trimText(s && (s.expected || s.expectedResult || s.预期)),
            result: trimText(s && (s.result || s.实际 || s.实果)),
            consequence: trimText(s && (s.consequence || s.余波 || s.后果)),
            /* ★ [580] B1：来路三型 */
            origin: (() => {
                const o = String(trimText(s && (s.origin || s.originKind)) || '').toLowerCase();
                return originId(o);
            })(),
            /* ★ P1-7：世界脉动四格 ✓ */
            pressure: Number.isFinite(Number(s && s.pressure)) ? Math.max(0, Math.min(5, Number(s.pressure))) : null,
            trend: trimText(s && s.trend),
            visibility: trimText(s && s.visibility),
            evidence: trimText(s && (s.evidence || s.quote)),
            source: 'engine',
            at: Date.now(),
            floor: material.floor,
        })).filter((s) => s.title);
        if (fresh.length) {
            /* ⭐谷歌复核（三）：增量归并（⛔ 用本批几条把旧数组整锅端 ✗），归并后再走容量锁归档 ✓ */
            /* ★ [579]：用本步世界钟过了几分钟，压住局势压力乱涨 ✓（world.clock＝步前旧钟） */
            const clockDeltaMin = clockDistance(trimText(world.clock), trimText(loadState().world.clock));
            const mergedSits = mergeSituations((loadState().world || {}).situations, fresh, clockDeltaMin, 'world');
            /*
     * 依据＝阿砚第三批 硬-2：局势带上“来自第几楼 ＋ 那楼原文指纹”。
     *   用之前（recall）会重算指纹：对不上 = stale，⛔ 当事实用。
     */
    /*
     * 依据＝阿砚第三批口径修正：指纹取**那一楼的原文**（与 recall 核验端同一取法）。
     *   旧：拿 material.recentText（cleanMessages 清洗后的多楼拼接）⇒ 两端算的不是同一段文字
     *       ⇒ 所有带来源的局势全部判过期、全部不进注入（把“不许当事实”做成了“所有记忆都不当事实”）。
     */
    {
        const chatNow = getChat();
        for (const s of (Array.isArray(mergedSits) ? mergedSits : [])) {
            stampSource(s, {
                kind: 'situation',
                floor: material.floor,
                text: floorText(chatNow, material.floor),
                title: (s && s.title) || '',
            });
        }
    }
    updateWorld({ situations: mergedSits }, {});
            capList((loadState().world || {}).situations, 'capEvents', (s) => s.title, (s) => s.manual);
            saveState();   /* capList 是原地改，这里保险落盘 ✓ */
        }
    }
    /* ★ [580] A3：可选 facts 回写（省掉不算白跑；按 key 去重，容量锁在 upsertWorldFact）✓ */
    if (Array.isArray(v.facts)) {
        const fl = Number.isFinite(Number(material.floor)) ? Number(material.floor) : -1;
        for (const raw of v.facts) {
            if (!raw) continue;
            try {
                upsertWorldFact({
                    subject: trimText(raw.subject) || '世界',
                    field: trimText(raw.field || raw.key),
                    value: trimText(raw.value),
                    source: 'engine',
                    floor: fl,
                });
            } catch (eFact) { /* 一条事实写不进不能弄挂整步 ✓ */ }
        }
    }
    /* ★ [580] A4：可选脉动／巡查回写（省掉不算白跑；与局势并行，可记镜头外）✓ */
    {
        const fl = Number.isFinite(Number(material.floor)) ? Number(material.floor) : -1;
        const pulseIn = Array.isArray(v.pulse) ? v.pulse
            : (v.pulse && typeof v.pulse === 'object' && Array.isArray(v.pulse.domains) ? v.pulse.domains : null);
        if (Array.isArray(pulseIn)) {
            for (const raw of pulseIn) {
                if (!raw) continue;
                try {
                    upsertPulseDomain({
                        label: trimText(raw.label || raw.name || raw.title),
                        kind: trimText(raw.kind),
                        scope: trimText(raw.scope),
                        state: trimText(raw.state || raw.note || raw.text),
                        pressure: raw.pressure,
                        trend: trimText(raw.trend),
                        visibility: trimText(raw.visibility),
                        evidence: trimText(raw.evidence),
                        floor: fl,
                    }, { floor: fl });
                } catch (ePulse) { /* 一条域写不进不能弄挂整步 ✓ */ }
            }
        }
        const covIn = Array.isArray(v.coverage) ? v.coverage
            : (v.pulse && typeof v.pulse === 'object' && Array.isArray(v.pulse.coverage) ? v.pulse.coverage : null);
        if (Array.isArray(covIn)) {
            for (const raw of covIn) {
                if (!raw) continue;
                try {
                    markPulseCoverage({
                        label: trimText(raw.label || raw.name),
                        kind: trimText(raw.kind),
                        scope: trimText(raw.scope),
                        floor: fl,
                    });
                } catch (eCov) { /* 一条巡查写不进不能弄挂整步 ✓ */ }
            }
        }
    }
    /* ★ [580] C3：可选 winds 回写（省掉不算白跑；＝未证实传闻，对齐 A1 trace）✓ */
    if (Array.isArray(v.winds)) {
        const fl = Number.isFinite(Number(material.floor)) ? Number(material.floor) : -1;
        for (const raw of v.winds) {
            if (!raw) continue;
            try {
                upsertWind({
                    topic: trimText(raw.topic || raw.title || raw.name),
                    text: trimText(raw.text || raw.content || raw.note),
                    kind: trimText(raw.kind || raw.type),
                    source: 'engine',
                    floor: fl,
                }, { floor: fl });
            } catch (eWind) { /* 一条风声写不进不能弄挂整步 ✓ */ }
        }
    }
    const hiddenIn = Array.isArray(v.hidden) ? v.hidden : [];
    let advanced = 0;
    let blocked = 0;
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
             * ⭐ 她 [18]/[3]：**推进时也过核闸**（⛔ 只拦新建那一条）。
             */
            const noteUp = trimText(raw.note) || existing.note;
            const badUp = looksLikeFabricatedTrouble(noteUp);
            upsertHidden({
                name,
                stage: stageIn || (wantsAdvance ? nextStage(existing.stage, existing.kind) : existing.stage),
                trigger: trimText(raw.trigger) || existing.trigger,
                tier: trimText(raw.tier) || existing.tier,
                note: noteUp,
                /* ★ [580] B6 */
                agendaOrigin: raw.agendaOrigin || (raw.source && raw.source.type) || raw.sourceKind,
                agendaRef: raw.agendaRef || (raw.source && raw.source.ref) || raw.sourceRef,
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
                /* ★ [580] B6：新建暗线必带来源三型 */
                agendaOrigin: raw.agendaOrigin || (raw.source && raw.source.type) || raw.sourceKind,
                agendaRef: raw.agendaRef || (raw.source && raw.source.ref) || raw.sourceRef,
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
             *   ⇒ suspect 的只留**名字＋到点条件**（不可作据），⛔ 把那句编造带进去。
             */
            text: (h.suspect === true ? (trimText(h.trigger) || '') : (h.note || h.trigger)), kind: 'hidden', stage: h.stage, tier: h.tier, floor: material.floor });
    }
    if (events.length) {
        setEvents(events);
    }
    /* ★ [580]／观棋 B4：本轮正文点到的角色／势力 → 记下，下轮喂「必须有下文」 */
    try {
        const bodySpot = material.recentText || material.rawText || '';
        const named = whoIsOnStage(bodySpot, loadState().characters || [])
            .map((c) => trimText(c && c.name)).filter(Boolean);
        const facHit = (loadState().world.factions || [])
            .map((f) => trimText(f && f.name))
            .filter((nm) => nm && bodySpot.indexOf(nm) >= 0);
        const spot = Array.from(new Set(named.concat(facHit))).slice(0, 12);
        updateWorld({ spotlight: spot }, {});
    } catch (eSpot) { /* 点名名单记不上也不能拦世界步 ✓ */ }
    const summary = '世界状态已更新：局势 ' + String((worldNow.situations || []).length)
        + ' 条、暗线 ' + String((worldNow.hidden || []).length) + ' 条'
        + (advanced ? '（推进 ' + String(advanced) + ' 条）' : '')
        + (blocked ? '（' + String(blocked) + ' 条没到点，摁住了）' : '')
        + (notes.length ? '；' + notes.join('；') : '');
    return { ok: true, summary, notes, events: events.length };
}
/* ------------------------------ 角色那一步 ------------------------------ */
/**
 * 107-B：处理一批 rows（一次调用的结果）。⛔ 不改调用顺序、⛔ 不改 applyCharacter 语义。
 * 原样从 stepCharacters 搬出来（行为一字未变），只把外部变量换成 ctx。
 */
export function applyCharRows(rows, ctx) {
    const c = ctx || {};
    const v = c.v || {};
    const picked = Array.isArray(c.picked) ? c.picked : [];
    const onStageIds = c.onStageIds || new Set();
    const material = c.material || {};
    const conflicts = Array.isArray(c.conflicts) ? c.conflicts : [];
    let written = 0;
    let newPeople = 0;
    let questCount = 0;
    let knowCount = 0;
    for (const raw of rows) {
        const row = Object.assign({}, raw);
        /*
         * ⭐ 修复单 #16：顶层 `v.quests` 之前**没喂给任何一行**——
         *   `collectQuests` 只读 `raw.allQuests`（全库只有它读、没人写），
         *   ⇒ 模型按默认格式（quests 在顶层、与 chars 并列）报的任务 **100% 静默丢失**。
         *   ⇒ 循环里补喂；`checkActingAsMe` 也会顺带读到它（下面那个字段同族加上了）。
         */
        row.allQuests = Array.isArray(v.quests) ? v.quests : [];
        const found = picked.find((c) => c.name === trimText(raw && raw.name));
        row.onStage = found ? onStageIds.has(found.id) : false;
        const done = applyCharacter(row, material, conflicts);
        if (done) {
            written += 1;
            if (done.isNew) {
                newPeople += 1;
            }
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
                            channel: trimText(kk && kk.channel),
                            floor: Number.isFinite(Number(material.floor)) ? Number(material.floor) : -1,
                        })) {
                            knowCount += 1;
                        }
                    }
                }
            }
        }
    }
    return { written, newPeople, questCount, knowCount };
}
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
    /*
     * ⭐⭐ R11（材料 05）：**别因为模型多写个括号就造新角色** ✓
     *   旧：只按**精确字符串**找人 ✗ ⇒ 名册里叫「奈鲁」、
     *     模型写了「大阪奈鲁」或「月野育子（母亲）」⇒ **当场另建一个 isNew 的残缺重复角色** ✗
     *     （新建那个还没过 normalizeCharacter ✗ ⇒ 缺 quests／knows 等格 ✗）
     *   现在：先试**规范化名／去括号名／双向包含／别名** ✓
     *     找到就用它，并把新写法**记成别名** ✓（下次就能直接认出 ✓）
     */
    if (!c) {
        const keyFull = matchKey(name);
        const bare = trimText(String(name).replace(/[（(][^）)]*[）)]/g, ''));
        const keyBare = matchKey(bare);
        const hit = state.characters.find((x) => {
            const kx = matchKey(x.name || '');
            if (!kx) {
                return false;
            }
            if (kx === keyFull || (keyBare && kx === keyBare)) {
                return true;
            }
            if (kx.length >= 2 && keyBare.length >= 2 && (kx.includes(keyBare) || keyBare.includes(kx))) {
                return true;
            }
            return (Array.isArray(x.aliases) ? x.aliases : []).some((a) => {
                const ka = matchKey(a);
                return ka && (ka === keyFull || (keyBare && ka === keyBare));
            });
        });
        if (hit) {
            c = hit;
            try {
                const al = Array.isArray(c.aliases) ? c.aliases.slice() : [];
                const nm = trimText(name);
                if (nm && !al.some((a) => matchKey(a) === matchKey(nm))) {
                    al.push(nm);
                    c.aliases = al;
                }
            } catch (eAlias) { /* 记不上别名也不能把这一步搞挂 ✓ */ }
        }
    }
    if (!c) {
        c = {
            id: 'wxg_' + Math.random().toString(36).slice(2, 9),
            name,
            aliases: [],
            past: [],
            schedule: [],
            steps: [],
            identities: [],
            isPlayer: isPlayerCharacter({ name }),
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
    /* ★ [580] A7：lastSeen＝引擎碰过；presentFloor＝正文在场才写（⛔ 后台推演楼冒充一直在场） */
    patch.lastSeenFloor = material.floor;
    patch.inScene = onStage;
    if (onStage && Number.isFinite(Number(material.floor)) && Number(material.floor) >= 0) {
        patch.presentFloor = Number(material.floor);
        /* 在场至少相关度 2（模型另给更高数才抬） */
        const relIn = Number(raw && raw.relevance);
        const baseRel = Number.isFinite(Number(c.relevance)) ? Number(c.relevance) : 1;
        patch.relevance = Math.max(2, baseRel, Number.isFinite(relIn) ? Math.round(relIn) : 0);
        if (patch.relevance > 3) { patch.relevance = 3; }
    } else if (Number.isFinite(Number(raw && raw.relevance))) {
        patch.relevance = Math.max(0, Math.min(3, Math.round(Number(raw.relevance))));
    }
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
    /* 身份可多条（她定的 8 格之一）：数组单独走一遍，⛔ 混进 textFields（那个循环用 trimText，数组会变字符串） */
    {
        const incIds = Array.isArray(raw && raw.identities)
            ? raw.identities.map((x) => trimText(x)).filter(Boolean)
            : [];
        if (incIds.length) {
            if (isFieldLocked('identities')) {
                notePending(c, 'identities', incIds.join('；'), { floor: material.floor, why: '模型推演', from: 'chars-step' });
                conflicts.push(c.name + ' 的「身份」她手改过，保留她的版本（模型想改成：' + incIds.join('；').slice(0, 40) + '）');
            } else {
                patch.identities = incIds;
                patch.identity = incIds[0];
            }
        }
    }
    /* ⭐⭐ 材料 07 · P5（第一波·“未知”覆盖 ✗）：**占位词不能当真值写回** ✓
     *   病根：T1（system 破限词）强令“一个字段都不许空着…没有的写'未知'” ✗
     *         ⇒ 模型不敢留空，全填 “未知” ✗ 而这里**只跳空串** ✗
     *         ⇒ 把角色**原本已读出来的**身份/势力**覆盖成 “未知”** ✗✗
     *         （空白格也被塞满 “未知” ⇒ 体检误判“身份非空” ✗ 名册显示不出 — ✗）
     *   现在：占位词一律**当作没说** ⇒ skip ✓（⛔ 拿它覆盖已有的好数据 ✗）
     *   ⛔ 只列明确的占位词：**不收“无”“没有”**（它们可能是有意义的值 ✓） */
    /* 1-c #7：占位词判断已搬到 core/rules.js（isUnknownish），这里不再留第二份 */
    for (const f of textFields) {
        const incoming = trimText(raw && raw[f]);
        if (!incoming || isBlankOrUnknownish(incoming)) {
            continue;
        }
        const old = trimText(c[f]);
        if (old && isFieldLocked(f) && old !== incoming) {
            /*
             * 依据＝阿砚第三批 硬-6：锁住的格不让改，但要把“本来会改成什么”记下来，
             *   她能看一眼再决定（⛔ 只在 conflicts 里丢一句话、看不到具体值）。
             */
            notePending(c, f, incoming, { floor: material.floor, why: '模型推演', from: 'chars-step' });
            conflicts.push(c.name + ' 的「' + f + '」她手改过，保留她的版本（模型想改成：' + incoming.slice(0, 40) + '）');
            continue;
        }
        patch[f] = incoming;
        /* 116：单数身份也要让 identities 至少有一条 */
        if (f === 'identity' && !Array.isArray(patch.identities)) {
            patch.identities = [incoming];
        }
    }
    /* ⭐修复 4（材料 02）并按材料 03 定稿修正 ✓
     *   病根：旧条件只排除 `'未知'` ✗ ⇒ 推演模型把“未接入/敌对/本人”这类**文字**
     *         写进好感格也照单全收 ✗（好感格污染 ✗）
     *   现在：**必须是合法数字** 才收 ✓（纯数字正则 ⇒ “未接入/敌对/本人”100% 进不来 ✓）
     *   ⚠️材料 03 明确修正：**去掉 `&& !trimText(c.affinity)`** ✓
     *      （那是“空值锁”✗ ⇒ 只要格子里有初始值，后续正文里读到的更新就**永远写不进去** ✗）
     *   保留的三个条件：合法数字 ✓ ＋ 未接外部数据源 ✓ ＋ 该格未被手动锁定 ✓ */
    /*
     * 95 号（她 10-25 14:28：「数值按好感手机，更新按好感手机，**自己不更新**」）：
     *   模型/正文写出的数值型好感一律**剔掉**（不落盘），只留表里从手机抄来的值；
     *   若与表里旧值不符 ⇒ 当“编的”，留一条冲突给她看。
     */
    const incomingAff = trimText(raw && raw.affinity);
    if (/^-?\d+(?:\.\d+)?$/.test(incomingAff)) {
        const rowA = (loadState().affinityTable || []).find((r) => r && matchKey(r.name) === matchKey(c.name));
        const tableVal = rowA ? trimText(rowA.affinity) : '';
        if (tableVal && tableVal !== incomingAff) {
            conflicts.push(c.name + ' 的好感：正文写了 ' + incomingAff + '，但表里是 ' + tableVal + '（以手机为准，已剔掉正文那个）');
        }
        delete patch.affinity;
    }
    if (patch.timePlace) {
        const back = clockWentBackwards(extractClockFromPlace(c.timePlace), extractClockFromPlace(patch.timePlace));
        if (back) {
            conflicts.push(c.name + ' 的时间地点看着往回退了（' + c.timePlace + ' → ' + patch.timePlace + '），已保留原文，请你看一眼');
            delete patch.timePlace;
        }
    }
    Object.assign(c, patch);
    c.updatedAt = Date.now();
    c.settledRun = Number((loadState().pipeline || {}).runs || 0);   /* 94：保底结算的时间戳 */
    let cur = trimText(raw && raw.current);
    /* 86#3：元描述（推演位／观察位／静止观察）→ 视为没写：不落库、不进编年 */
    if (cur && /推演位|观察位|静止观察|待推演/.test(cur)) {
        c.current = '';
        delete c.currentSuspect;
        delete c.currentSuspectWhy;
        cur = '';
    }
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
        } else if (looksLikeDecidingForMe(cur, { role: c.role })) {
            why = '替"我"做了决定（[579]：只写他做的那一半，⛔ 替我答／替我选）';
        } else if (onStage && material.fellBack !== true && !textAppearsIn(cur, material.recentText || material.rawText)) {
            /*
             * ⭐ 10-16 真语料教训：**清洗失败时⛔ 下“编造”判词**。
             *   她那张卡把正文整个包在成对块里 ⇒ 四格清洗把正文也剥了（只剩 30 字）
             *   ⇒ 这时“正文里找不到”**不能说明任何事**（我们压根没读到正文）
             *   ⇒ **⛔ 献上一排“越界·现场编造”**（那正是她 04:20 那屏噪音）。读不到就不指控。
             */
            /*
             * ⭐ 她 [5]/[7] 的原话：她叫"编造"的是**"正文没有描写的事"**，
             *   ⛔"把正文有的事换个说法"** ⇒ 分两档：
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
    const past = Array.isArray(raw && raw.past) ? raw.past : [];
    /* P22 (material 07): honour the capPast setting (2-20) - it used to be hardcoded to 5,
     *   so whatever the user configured was silently ignored. */
    const capPastNow = clampNumber(Number(getSettings().capPast) || 5, 2, 20, 5);
    let pastChain = (Array.isArray(c.past) && c.past[0] && trimText(c.past[0].text)) || '';
    for (const p of past.slice(0, capPastNow).reverse()) {
        /* 129：每层那条＝到这一层为止的累积摘要（她 [650]：取最老一层就够） */
        const body = trimText(p && (p.text || p));
        const cum = pastChain ? (pastChain + '；' + body) : body;
        pushPast(c.id, cum, capPastNow, material.floor);
        pastChain = cum;
        /* ★ 补单 1-⑤：模型交了 rollup 就地压成一条 L1 ✓ */
        if (p && trimText(p.rollup)) {
            try { rollupPast(c.id, p.rollup); } catch (eRoll) { }
        }
    }
    /* ⭐修复 7 后半：**记下建日程时的世界钟**（起算日 ✓）
     *   旧：只记 `{what, due, done}` ✗ ⇒ 到点判断无从算起 ✗；而且一到点就 `done = true` ✗
     *        ⇒ 她根本没机会履约 ✗（约定默默消失 ✗）
     *   新：当时的世界钟存 `sinceDay` / `sinceMinutes` ✓；到点分两步：
     *        **本轮刚到点** ⇒ `dueReached = true`（留着注入给模型让角色履约 ✓）；**下一轮**才归档 done ✓ */
    const parsedClock = parseClock(loadState().world.clock);
    const curDay = parsedClock.has ? (parsedClock.day === null ? 1 : parsedClock.day) : null;
    const curMin = parsedClock.has ? ((curDay || 1) * 1440 + (parsedClock.minutesOfDay || 0)) : null;
    const schedule = Array.isArray(raw && raw.schedule) ? raw.schedule : [];
    if (schedule.length) {
        for (const s of schedule) {
            const what = trimText(s && (s.what || s.text));
            if (!what) {
                continue;
            }
            if (!c.schedule.some((x) => x.what === what)) {
                const dueAbs = dueToAbsoluteMinute(trimText(s && s.due), curMin);   /* 864：写入时算一次 */
                c.schedule.push({
                    what,
                    due: trimText(s && s.due),
                    done: false,
                    dueReached: false,
                    swipe: currentSwipeId(material.floor),   /* ★ A1：日程也要认得是第几版 */
            sinceDay: curDay,
                    sinceMinutes: curMin,
                    originDueMinute: dueAbs,
                    dueMinute: dueAbs,
                    firedPoints: [],
                });
            }
        }
    }
    const clock = loadState().world.clock;
    for (const s of c.schedule) {
        if (s.done) {
            continue;
        }
        if (s.dueReached) {
            /*
             * ⭐ B4（材料 13·兑现率）：**到点不等于办完** ✓
             *   旧：这里立刻 `s.done = true` ✗
             *     而两处注入（personBlock 与 chars）只发 `!s.done` 的 ✗
             *     ⇒ 日程好不容易到点，**到点那一刻就从提示里消失了** ✗
             *   现在：保留“已到点”这个标记 ✓（不重复记账 ✓）但**不置 done** ✓
             *     ⇒ 她与主模型都能看到“这件事到点了、还没了结” ✓
             */
            continue;
        }
        if (!trimText(s.due)) {
            continue;
        }
        if (!Number.isFinite(Number(s.sinceDay)) && Number.isFinite(curDay)) {
            s.sinceDay = curDay;
        }
        if (!Number.isFinite(Number(s.sinceMinutes)) && Number.isFinite(curMin)) {
            s.sinceMinutes = curMin;
        }
        const due = isLineDue({ trigger: s.due, tier: '几天内', sinceDay: s.sinceDay, sinceMinutes: s.sinceMinutes }, clock);
        if (due.due) {
            s.dueReached = true;
            addChronicle({ floor: material.floor, kind: '日程到点', who: c.name, text: s.what + '（' + due.why + '）', clock });
        }
    }
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
            /* ★ [580] A2：接触链随行带出（公开时必填／可推） */
            channel: trimText(k && k.channel),
        })).filter((k) => k.text)
        : [];
    /* ★ [580] A5：模型若冒出 known_* 壳字段 ⇒ 丢弃（只认 knows→addKnow）✓ */
    if (raw && typeof raw === 'object') {
        delete raw.knownFactKeys;
        delete raw.knownEventIds;
        delete raw.knownClueIds;
        delete raw.knownFactBeliefs;
    }
    return { name: c.name, isNew, quests, knows };
}
async function stepCharacters(material, attempt, screenRes) {
    const settings = getSettings();
    const state = loadState();
    const roster = getRoster().filter((c) => !c.ignored);   /* 107-B：走 getRoster，她才会被标 isPlayer */
    if (!roster.length) {
        return { ok: true, summary: '名册是空的，角色这一步跳过（先去面板录人）' };
    }
    /*
     * ⭐⭐ 她原话 [5]/[7]：**在场＝"正文里露面"的**（⛔"名字被提到"）。
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
     *   ⇒ **兜底**：清洗后**一个名字都没了**就退回原文（宁可多算、⛔ 全判不在场）。
     */
    /*
     * ⭐⭐ 修复 5（材料 02）并按材料 03 定稿：**在场判定的窗口尺度** ✓
     *   旧：拿 6–12 楼历史拼合全文去扫 ✗ ⇒ 跳场景后旧场景人物还在窗口里 ✗（误报 ✗）
     *   新：窗口＝**最近 4 楼**（当前回合＋上一回合 ✓）
     *        但若**最新一楼带明确的 <meow_FM> 状态块**（含 scene: 与 relation: ✓）
     *        ⇒ 卡面已给出本回合精确的在场名单 ⇒ **只取最新 2 楼** ✓（切场景当场切干净 ✓）
     *   ⛔ 普通卡（没有状态栏）照旧用 4 楼 ⇒ 不会漏掉“上一回合还在说话、这回合沉默旁听”的同场角色 ✓
     */
    const stageMsgsAll = Array.isArray(material.messages) ? material.messages : [];
    const lastMsgText = trimText(stageMsgsAll.length ? (stageMsgsAll[stageMsgsAll.length - 1] || {}).mes : (material.rawText || ''));
    const hasStatusBlock = /<meow_FM>|scene\s*[:：]|relation\s*[:：]/i.test(lastMsgText);
    /*
     * ⭐⭐ S2（材料 05 自查）：**补推整批时看全部楼层** ✓
     *   旧：不管单轮还是补推，一律只看最后 2 楼（有状态卡）或 4 楼 ✗
     *     ⇒ 一批 #0～#5 里，在 #1～#3 出场、#4 离场的人（吃早饭的育子、谦之 ✗）
     *     被标成**不在场** ✗ ⇒ 模型总结他们做的事时违反“不在场不准带我”的规矩 ✗
     *   现在：整批 ⇒ 用该批**全部楼层** ✓；日常单轮 ⇒ 照旧（状态卡优先／4 楼窗口 ✓）
     */
    const stageMsgs = material.batch === true
        ? stageMsgsAll
        : (hasStatusBlock ? stageMsgsAll.slice(-2) : stageMsgsAll.slice(-4));
    const stageCleaned = cleanMessages(stageMsgs).text;
    const stageRaw = stageMsgs.map((m) => trimText(m && m.mes)).filter(Boolean).join('\n');
    const bodyForStage = (() => {
        if (trimText(stageCleaned) && whoIsOnStage(stageCleaned, roster).length) {
            return stageCleaned;
        }
        return stageRaw || material.recentText || material.rawText || '';
    })();
        /* 13：世界层模型给的名单优先（语义）；没给才回落“名字＋词表”，并标来源 */
    const modelList = Array.isArray(screenRes && screenRes.onStageList)
        ? screenRes.onStageList.map((x) => matchKey(x && x.name ? x.name : x)).filter(Boolean) : null;
    let onStage;
    let stageSource;
    if (screenRes && screenRes.ok && screenRes.empty === true) {
        onStage = [];   /* 1：空名单是合法结果（她一个人待着） */
        stageSource = 'model';
    } else if (modelList && modelList.length) {
        onStage = roster.filter((c) => c && !c.isPlayer && !isUnavailable(c) && modelList.indexOf(matchKey(c.name)) >= 0);
        stageSource = 'model';
    } else {
        onStage = whoIsOnStage(bodyForStage, roster).filter((c) => !justLeft(bodyForStage, c.name));   /* 107：刚离场就算后台 */
        stageSource = 'wordlist';
    }
    const onStageIds = new Set(onStage.map((c) => c.id));
    try { setPipeline({ stageSource }); } catch (eSS) { /* 记不上不影响主流程 */ }
    if (Array.isArray(screenRes && screenRes.leftList) && screenRes.leftList.length) {
        try {
            for (const lf of screenRes.leftList) { setPipeline({ offStageReason: String(trimText(lf.name)) + '：' + String(trimText(lf.reason)) }); }
        } catch (eLF) { /* 不影响主流程 */ }
    }
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
    /* ★ [580]／观棋 B4：上轮点名的人优先进轮转（提示词说了解锁，门控也要放行） */
    const spotKeys = new Set(
        (Array.isArray(loadState().world.spotlight) ? loadState().world.spotlight : [])
            .map((n) => matchKey(n)).filter(Boolean),
    );
    /* 107：驱动力校验（A 契约／B 剧情／C 局势）：只在名额不够时才筛，不够就全推 */
    try {
        const stD = loadState();
        const driveCtx = {
            quests: (stD.characters || []).flatMap((c) => (Array.isArray(c.quests) ? c.quests : [])),
            situations: (stD.world && stD.world.situations) || [],
        };
        if (bench.length > Math.max(0, Number(maxParallelSetting) || 6) * 2) {
            for (let bi = bench.length - 1; bi >= 0; bi -= 1) {
                if (!hasDrive(bench[bi], driveCtx)) { bench.splice(bi, 1); }
            }
        }
    } catch (eDrive) { /* 筛不了就不筛，⛔ 把人搞没 */ }
    const rotated = bench.slice().sort((a, b) => {
        const aSpot = spotKeys.has(matchKey(a.name)) ? 1 : 0;
        const bSpot = spotKeys.has(matchKey(b.name)) ? 1 : 0;
        if (aSpot !== bSpot) {
            return bSpot - aSpot;
        }
        /* ★ [580] A7：相关度高的优先进轮转（点名／在场抬过的人别被冷落太久） */
        const aRel = Number.isFinite(Number(a.relevance)) ? Number(a.relevance) : 1;
        const bRel = Number.isFinite(Number(b.relevance)) ? Number(b.relevance) : 1;
        if (aRel !== bRel) {
            return bRel - aRel;
        }
        if (settings.protectedBypass && (a.inScene === true) !== (b.inScene === true)) {
            return a.inScene === true ? 1 : -1;
        }
        return (a.lastUpdatedAt || 0) - (b.lastUpdatedAt || 0);
    });
    const pickedBench = rotated.slice(0, Math.max(0, maxParallel));
    const picked = onStage.filter((c) => !c.isPlayer).concat(pickedBench);
    /* 107：兜底汇总（不另判一次；只用来记“这轮谁算后台、谁静滞”） */
    let presenceInfo = null;
    try { presenceInfo = classifyPresence({ roster, bodyText: bodyForStage, playerName: '', settings, quests: loadState().characters.flatMap((c) => c.quests || []), situations: (loadState().world && loadState().world.situations) || [] }); } catch (ePres) { presenceInfo = null; }
    /* 94 号（世界背面 starvation-guard）：连续 3 个周期没结算 ⇒ 强制结算一次 */
    {
        const runSeq = Number((loadState().pipeline || {}).runs || 1);
        const pickedIds = new Set(picked.map((c) => c.id));
        const starving = roster.filter((c) => c && !c.isPlayer && c.ignored !== true && c.noBench !== true
            && !pickedIds.has(c.id) && (runSeq - Number(c.settledRun || 0)) >= 3
            && (trimText(c.current) || (Array.isArray(c.past) && c.past.length)));
        for (const c of starving) {
            picked.push(c);
            pickedIds.add(c.id);
            try {
                addChronicle({ floor: material.floor, kind: '保底结算·三个周期未结算', who: c.name, text: '连续 3 个周期没结算，强制结算一次' });
            } catch (eStarve) { /* 留痕失败不能拦着推演 */ }
        }
    }
    if (!picked.length) {
        return { ok: true, summary: '这一轮没有要处理的角色（都在省额度轮转里）' };
    }
    /* P4 part 2 (material 07): tell the model WHO the player is - see the note below. */
    /* P19 (material 07): say the in-scene / off-scene rules once, not once per character. */
    /* 96：两块独立提示词——前台一块、后台一块（⛔ 合成一份） */
    const charsHeader = [
        '【每个角色都适用的两条硬规矩】',
        '· **标了“现场”的**：只许总结正文里已经写了的他的事，⛔ 正文没写的（尤其下一步动作）一律不许写；✅ 可以照正文那样**侧面带“我”**（对“我”说／看向“我”／把东西放到“我”面前／对“我”的反应），⛔ 但“我”自己的动作、台词、神态、位置一个字都不许写；⛔ 替他答／替他选／替他点头；写得出具体动作的那句本身就是「待我做决定」，⛔ 只写这四个字。',
        '· **标了“不在场（暗地）”的**：现状只靠推演写、只写“这一步”（正在进行时／刚做完），⛔ 不写下一步；⛔ 这一段里**不许出现“我”**（“我”的动静影响不到他）。',
    ];
    const playerHintLines = (() => {
        const me = (Array.isArray(roster) ? roster : []).find((c) => c && c.isPlayer);
        if (!me || !trimText(me.name)) {
            return [];
        }
        return [
            '· ' + trimText(me.name) + '（**玩家棋子 ＝ 提示词里说的“我”／user／玩家**）',
            '  ⛔ 不给他建推演行、不替他行动／说话／决定；他的存在只由**别人**的行侧面承载 ✓',
        ];
    })();
    const charLineArr = picked.map((c) => {
        const inScene = onStageIds.has(c.id);
        /* 96：死亡／昏迷／被封印 ⇒ 不算人（两侧都不写） */
        if (isUnavailable(c)) { return ''; }
        const lines = [
            '· ' + c.name + '（' + (inScene ? '现场' : '不在场') + (c.isPlayer ? '／玩家棋子' : '') + '）',
            '  现有：年龄 ' + (trimText(c.age) || '未知')
            + ' ｜ 身份 ' + (trimText(c.identity) || '未知')
            + ' ｜ 势力 ' + (trimText(c.faction) || '未知')
            + ' ｜ 好感 ' + (trimText(c.affinity) || '未接入')
            + ' ｜ 时间地点 ' + (trimText(c.timePlace) || '未知'),
        ];
        if (inScene) { lines.push('  时间跨度：' + timeSpanOf(c, (loadState().world || {}).clock)); }
        /* 102：生活节拍（到期就提一句；没大事也要给自然状态） */
        {
            const w0 = loadState().world || {};
            const tick = lifeTickDue(c, w0.clockMinute);
            if (tick.due) {
                lines.push('  生活结算：距上次已 ' + Math.floor(tick.waitedMinutes / 60) + ' 小时（节拍 ' + tick.cadenceHours + ' 小时）');
            }
            /* 106：四时点优先，countdownOf 兜底 */
            let cd = { phrase: '' };
            {
                const soon = (Array.isArray(c.schedule) ? c.schedule : []).filter((s2) => s2 && !s2.done && Number.isFinite(Number(s2.dueMinute)));
            soon.sort((a2, b2) => Number(a2.dueMinute) - Number(b2.dueMinute));
            const it0 = soon[0] || {};
            const pt = pointOf(it0, { nowMinute: w0.clockMinute, createdAtMinute: c.lastSettledMinute });
                if (pt === 'due') { cd = { phrase: '已到点·本轮应履约' }; }
                else if (pt === 'origin') { cd = { phrase: '原定期限已过（被顺延过）' }; }
                else if (pt === 'late') { cd = { phrase: '快到时间了' }; }
                else if (pt === 'mid') { cd = { phrase: '进展中' }; }
                else { cd = countdownOf(it0.dueMinute, w0.clockMinute); }
            }
            if (cd.phrase) {
                lines.push('  日子：' + cd.phrase);
            }
        }
        if (trimText(c.current)) {
            const curLine = currentPromptLine(c);
            if (curLine) { lines.push('  上一轮"正在经历"：' + curLine); }
        }
        if (c.past.length) {
            lines.push('  过去经历（由近到远）：' + c.past.map((p) => p.text).join('；'));
        }
        {
            const rollHint = rollupInstructionFor(c);
            if (rollHint) { lines.push(rollHint); }
        }
        if (c.schedule.length) {
            lines.push('  日程：' + c.schedule.filter((s) => !s.done).map((s) => { const wNow = (loadState().world || {}).clockMinute;
                const ph = countdownOf(s.dueMinute, wNow).phrase; return s.what + (s.due ? '（' + s.due + '）' : '') + (ph ? '·' + ph : ''); }).join('；'));
        }
        /* ★ [579]：长期目标／quests 前台后台都不需要 ⇒ 不再喂「现有任务」给模型 ✓
         *   （旧账里的 quests 仍可在面板看／手删；⛔ 不进推演提示词、不进注入） */
        /*
         * ⭐ 补③ 第二步：**防全知**——把"他该知道的"真喂进他的推演。
         *   她的原话：「推演该人物时，喂料按这份清单过滤（不在清单里的世界内幕不进他的推演上下文）」。
         *   ⚠️ 只告诉模型"他知道什么"，**⛔ 把不该知道的也列出来**（那等于换个方式泄露）。
         */
        const kn = Array.isArray(c.knows) ? c.knows : [];
        if (kn.length) {
            lines.push('  他知道的：' + kn.map((k) => trimText(k.text)
                + '（' + (trimText(k.source) || '公开')
                + (trimText(k.channel) ? '·' + trimText(k.channel) : '')
                + (Number(k.floor) >= 0 ? '·' + floorLabel(Number(k.floor)) : '') + '）').join('；'));
            lines.push('  ⛔ **不在上面那份清单里的世界内幕，他没渠道知道⇒不许写进他的推演**。');
        } else {
            /* P21 (material 07): this used to gag brand-new characters completely - a villain
     *   imported from the world book could not even know his own faction's business. */
        lines.push('  他还没记下知道什么（清单是空的）⇒ **除他所属势力与自身身份分内的事、以及公开新闻之外**，别的世界内幕⛔ 不给他，只能写他自己身边看得到的。');
        }
        /* P19 (material 07): the long in-scene / off-scene warning used to be copied once
         *   per character (N times per prompt); it now lives once in the header. */
        return lines.join('\n');
    });
    const charLines = charLineArr.join('\n');
    /*
     * ⭐ 补③ 第二步（第二半）：模板里那块世界内幕是**所有人共用**的——
     *   那本身就是"全知"的漏点（谁都能看到）。
     *   ⇒ 只保留**至少有一个被推的人在清单里记下过**的那些；
     *     一个人都没记过的内幕 ⇒ **整块不给**（没人有渠道知道，给了就是全知）。
     *   ⚠️ 清单全空时（老账，谁都没记）⛔ 一刀切：那样老聊天的推演会突然变空。
     *     ⇒ 只要**这一批里有任何一个人填过清单**，就按清单过滤；一个都没填 ⇒ 照旧（等他开始用这个功能）。
     */
    /* ⭐⭐ 修复 14（材料 02）：**防全知的认知账不能用整句字面互含** ✗
     *   病根：只要记了 1 条 knows，`kt.includes(title) || title.includes(kt)` 几乎总不成立 ✗
     *         ⇒ **一旦启用认知账就把全部世界局势与总览按下去** ✗（她看不到世界了 ✗）
     *   新：先过 `matchKey` 规范化 ✓；整句互含不成就走**2 字滑动重合** ✓
     *        （命中 **≥ 2 个双字词组** 即视为该角色已知晓相关风声 ✓） */
    const pickedKnows = picked.map((c) => (Array.isArray(c.knows) ? c.knows : []).map((k) => matchKey(k.text)).filter(Boolean)).flat();
    const anyKnows = pickedKnows.length > 0;
    const knownBySomeone = (title, visibility) => {
        /* ★ 20261022 ⑩：没认知 ≠ 全知（原来直接 return true ⇒ private 局势也全员可见） */
        if (!anyKnows) return String(visibility || '') !== 'private';
        const tKey = matchKey(title);
        if (!tKey) return false;
        return pickedKnows.some((kt) => {
            if (kt.includes(tKey) || tKey.includes(kt)) return true;
            let hits = 0;
            for (let i = 0; i + 2 <= tKey.length; i += 1) {
                if (kt.includes(tKey.slice(i, i + 2))) {
                    hits += 1;
                    if (hits >= 2) return true;
                }
            }
            return false;
        });
    };
    /*
     * 107-B（方案 B）：真拆两次请求 —— 前台 FRONT_SYSTEM／后台 BACK_SYSTEM。
     *   空边跳过（planCalls）；前台先跑；合并前台优先（mergeSides）；一侧失败不牵连（sideOutcome）。
     *   `settings.splitChars === false` 时退化成单路（all），行为与旧版一致。
     */
    const buildCharsPrompt = (lines) => render('chars', effectivePrompt('chars'), {
        user: playerNamesForPrompt(),
        clock: trimText(loadState().world.clock) || '未知',
        world: [
            (trimText(loadState().world.bigPicture) && knownBySomeone(trimText(loadState().world.bigPicture)))
                ? trimText(loadState().world.bigPicture) : '',
            ((loadState().world.situations || []).filter((s) => s && trimText(s.title) && knownBySomeone(trimText(s.title), trimText(s.visibility))).map((s) => '· ' + trimText(s.title)).join('\n')),
        ].filter(Boolean).join('\n') || '（这一批里没人有渠道知道世界内幕，⛔ 给）',
        recent: material.recentText || '（没有可读的正文）',
        chars: lines,
    });
    const lineById = new Map(picked.map((c2, i2) => [c2.id, charLineArr[i2]]));
    const splitPlan = planCalls(splitPicked(picked, onStageIds), {
        splitOn: settings.splitChars !== false,
        frontSystem: effectivePrompt('front') || FRONT_SYSTEM,
        backSystem: effectivePrompt('back') || BACK_SYSTEM,
    });
    const tryN2 = Math.max(0, Math.round(Number(attempt) || 0));
    const sideResults = [];
    for (const g of splitPlan) {
        const gLines = g.tag === 'all' ? charLines : g.list.map((c2) => lineById.get(c2.id)).filter(Boolean);
        const gPrompt = buildCharsPrompt(charsHeader.concat(playerHintLines).concat(gLines).join('\n'));   /* 121-3：数组先 join('换行') ，⛔ 让模板拿数组变逗号 */
        const sysBase = effectivePrompt('jailbreak');
        const gRes = await callModelJson({
            prompt: tryN2 > 0 ? (gPrompt + '\n\n' + RETRY_TIGHTEN) : gPrompt,
            system: noteText('system-chars-' + g.tag, g.sys ? (sysBase + '\n\n' + g.sys) : sysBase),
            maxTokens: (() => { const lm = ((settings.layerLimits || {})[g.tag] || {}).maxTokens; const n2 = Number(lm); return (Number.isFinite(n2) && n2 > 0) ? n2 : retryTokens((settings.api || {}).maxTokens, tryN2); })(),
            model: trimText((((settings.layerLimits || {})[g.tag] || {}).model)) || undefined,
        });
        if (gRes && gRes.ok) {
            const gv = gRes.value || {};
            sideResults.push({
                tag: g.tag,
                ok: true,
                value: gv,
                rows: Array.isArray(gv.chars) ? gv.chars : (Array.isArray(gv.characters) ? gv.characters : []),
                quests: Array.isArray(gv.quests) ? gv.quests : [],
            });
        } else {
            sideResults.push({ tag: g.tag, ok: false, reason: (gRes && gRes.reason) || '没回可用 JSON' });
        }
    }
    const sideState = sideOutcome(sideResults);
    if (!sideState.ok) {
        return { ok: false, reason: sideState.fails.join('；') || '角色步没回可用 JSON' };
    }
    const okSides = sideResults.filter((x) => x.ok);
    const merged = mergeSides(okSides.map((x) => ({ rows: x.rows, quests: x.quests })));
    const rows = merged.rows;
    if (!rows.length) {
        return { ok: false, reason: '模型没按格式给出角色（chars 是空的）' };
    }
    const v = Object.assign({}, ...okSides.map((x) => x.value || {}), { quests: merged.quests });
    if (sideState.fails.length) {
        try { setPipeline({ text: '部分人物没算成：' + sideState.fails.join('；') }); } catch (ePF) { /* 不能拦主流程 */ }
    }
    const conflicts = [];
    let written = 0;
    let newPeople = 0;
    let questCount = 0;
    let knowCount = 0;   // ⭐ 补③：这一轮往认知账里收了几条
    const applied = applyCharRows(rows, { v, picked, onStageIds, material, conflicts });
    written += applied.written;
    newPeople += applied.newPeople;
    questCount += applied.questCount;
    knowCount += applied.knowCount;
    const meHits = checkActingAsMe(rows, material.floor);
    /*
     * ⭐⭐ Q5（材料 05 · 她原话 [150][151]）：**世界钟要有保底** ✓
     *   旧：完全靠模型从清洗后的 {{recent}} 里找 ✗
     *     ❤️ 她若在「读取控制」里把 <meow_FM> 设为排除标签 ✗
     *     （或被成对机器块规则剥掉 ✗）⇒ 清洗后的文本里就没了 time: 那一行 ✗
     *     ⇒ 模型读不到时间就回“未知” ✗ ⇒ **所有挂了世界钟的暗线全部停摆** ✗✗
     *   现在：模型没给（空／未知）时，从**清洗前**的 rawText 里直接抓 time: ／【时间】 ✓
     */
    let clockNow = trimText(v.clock);
    if (!clockNow || clockNow === '未知') {
        try {
            const rawNow = String(material && material.rawText ? material.rawText : '');
            /* 放宽到整行：把紧跟的时刻（如 07:45）也带上 ✓
         *   （parseClock 会自己从里面认日期与时刻 ✓，多余的词它不理 ✓） */
        const mTime = rawNow.match(/(?:time|时间)\s*[:：]\s*([^\n]{3,60})/i);
            if (mTime && trimText(mTime[1])) {
                clockNow = trimText(mTime[1]);
            }
        } catch (eClk) { /* 抓不到就算了 ✓ */ }
    }
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
 *     ③ 改"我"处境的被动句（被赶出家门的我／被带走）。
 *   ⛔ 不做"猜动词"那套（宁可少报，也不冤枉合规的侧面写法）。
 */
export function checkActingAsMe(rows, floor) {
    const hits = [];
    /*
     * ⭐ 复审追加 B3：无主的顶层任务（没写名字）**只报一次**，⛔ 每行都报一遍。
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
        const pieces = [];
        for (const f of ['current', 'timePlace', 'identity', 'age', 'faction']) {
            const text = trimText(raw && raw[f]);
            if (text) {
                pieces.push({ f, text });
            }
        }
        /*
         * ⭐⭐ 修复 6（材料 02）：**`past` 不纳入抓捕** ✓
         *   提示词里**明确要求 past（过去经历）按角色第一人称视角记事** ✓（如“我那天去了…”）
         *   ⇒ 拿它去判“扮演玩家”**必然误报** ✗ ⇒ 不再塞进 pieces ✓（其余字段照旧 ✓）
         */
        if (Array.isArray(raw && raw.schedule)) {
            const joined = raw.schedule
                .map((s) => [trimText(s && s.what), trimText(s && s.due)].filter(Boolean).join(' '))
                .filter(Boolean).join('；');
            if (joined) {
                pieces.push({ f: 'schedule', text: joined });
            }
        }
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
                /* ⭐⭐ 修复 6（材料 02）：**先剥掉角色台词，再判“我”** ✓
             *   旧：只删了**引号字符** ✗ ⇒ 台词内容还在 ✗
             *     （角色说「**我**不去！」里的“我”照样被当成“扮演玩家” ✗）
             *   现在：先把**直接引语整段**换成空格 ✓，再把含“我”的**固定词**换成空格 ✓ */
    const s = stripOtherQuotes(String(text))
        .replace(/自我|忘我|本我|超我|大我|小我|我方|我行我素|依然故我/g, ' ');
                /*
                 * ⚠️ 这张表要包含**方向／处所类**介词（到在从往至进出回过）：
                 *    漏了"到"就会把「把煎蛋**放到我**面前的桌垫上」这种合规侧面写法误报
                 *    （真踩过：加完结构判之后 run-tests-p2 的"侧面放过"当场变红）。
                 */
                const BEFORE = /[对给向跟和与朝冲让被叫看望等问帮替自我到在从往至进出回过由于挨靠临]/;
                /*
                 * ★ 20261023 依据＝阿砚 20 号 §①：主语判定**不能只认三个自称字**。
                 *   旧：字面表只有三个字 ⇒ 模型把主角写成真名时**整条链一次都不进** ✗
                 *   新：自称字 ＋ 她的真名与别名（personaNames／玩家棋子）一起当候选；长名优先；
                 *        命中后仍走原来两道豁免（后面跟「的」／前面是介词）✓
                 */
                const ME_NAMES = ['我', '咱', '俺'].concat(playerNamesArr()).filter(Boolean)
                    .sort((a, b) => b.length - a.length);
                for (let i = 0; i < s.length; i += 1) {
                    const hit = ME_NAMES.find((nm) => s.startsWith(nm, i));
                    if (!hit) {
                        continue;
                    }
                    const end = i + hit.length;
                    if (s[end] === '的') {
                        i = end - 1;
                        continue;                      // 所有格：侧面豁免
                    }
                    if (BEFORE.test(s.slice(Math.max(0, i - 4), i))) {
                        i = end - 1;
                        continue;                      // 宾语：别人对我／对她…
                    }
                    return true;                       // 其余 ⇒ 它当了主语
                }
                return false;
            })();
            if (meSubject) {
                reasons.push('"我"自己做了动作');
            }
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
        /* 86#4：体检结果只进 pipeline.conflicts，⛔ 当世界事件写编年 */
    }
    return hits.length;
}
/* ------------------------------ 主流程 ------------------------------ */
/** 从"时间·地点"里抠出时间部分（交给 clock 判） */
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
    /*
     * 依据＝阿砚 A 组 H4：**闸要在第一个 await 之前**就抢。
     *   旧：抢闸写在 runUpdateInner 里 ⇒ 前面已经 await 了 worldbook 动态 import 与 refreshAffinity ✗
     *     ⇒ 连点两下时，第二下能从那两个 await 里滑进去，两份一起跑 ✗
     *   闸不依赖 DOM（按钮灰不灰是另一回事，挡不住键盘/悬浮球/魔法棒各点一次）。
     */
    if (!claim('update')) {
        return { ok: false, reason: '上一轮还在跑（同一份不跑第二遍；要停就点取消）' };
    }
    /* 依据＝阿砚 A 组 H2：**第一个 await 之前**先抓归属（下面 `await import('./worldbook.js')` 就是一个 await） */
    const runOwner = captureOwner();
    /* ⭐ R1（材料 05）：**这一轮里的几十次写盘合并成一批** ✓
     *   批内只记账 ⇒ 批收尾写一次 ✓（⛔ 改变批外行为 ✗）
     *   try/finally 保证：即使中间抛错，批也一定收尾、该落的盘照落 ✓ */
    /*
     * ⭐⭐ 材料 06【5】链路断路 2：**“立刻更新”与“补推历史”也要读好感** ✓
     *   旧：`refreshAffinity()` **只在她发消息触发 planRecall 时调用一次** ✗
     *     ⇒ 拿已有的十几层聊天记录去点“补推历史”时 ✗
     *     ⇒ 整个推演过程**根本不去读 <meow_FM> 或手机世界书里的好感** ✗
     *     ⇒ 跑完一看，名册里全部人的好感还是空的（“未接入”）✗✗
     *   现在：每次跑更新（含补推）前先读一次 ✓（读不到就算了 ✓ ⛔ 拦主流程 ✗）
     *   （用动态 import ✓ ⛔ 在模块顶部引入 worldbook，避开环依赖 ✗）
     */
    try {
        const _wbMod = await import('./worldbook.js');
        if (_wbMod && typeof _wbMod.refreshAffinity === 'function') {
            await _wbMod.refreshAffinity();
        }
    } catch (eAff) { /* 好感读不到 ⛔ 能拦着不更新 ✓ */ }
    bindChatForRun();   /* R3：记下开跑时的聊天档 ✓ */
    beginSaveBatch();
    try {
        const res = await runUpdateInner(opts);
        /* H2：await 回来先问“还是不是这本”（⛔ 把旧档结果当成新档的） */
        const own = checkOwner(runOwner);
        if (!own.ok) {
            return { ok: false, reason: own.reason };
        }
        return res;
    } finally {
        /* ★ 20261022：中间任何一步抛错也要把灯关掉，
         *   否则 running 永远为 true ⇒ 之后每次都回“上一轮还在跑” ⇒ 整个会话用不了 */
        running = false;
        markLive();
        endSaveBatch();
        unbindChatForRun();   /* R3：收尾解绑 ✓ */
        release('update');    /* H4：放闸必须在 finally 里（⛔ 中间报错就把闸卡死） */
    }
}
async function runUpdateInner(opts) {
    const o = opts || {};
    /* H4：闸已在 runUpdate 入口抢过（这里不再抢、也不再报“还在跑”，⛔ 把自己卡死） */
    const settings = getSettings();
    if (!settings.enabled) {
        return { ok: false, reason: '总开关关着' };
    }
    running = true;
    markLive();
    /*
     * ⭐ L3（防御性）：**补批调进来时⛔ 重置取消标记**。
     *   她按取消后，补批循环会在**每楼开跑前**检查一次（当前路径靠那个检查兜住，所以现在不可达）；
     *   但只要将来有人在入口前面加一个 await，这里就会**把那次取消吞掉**。
     */
    if (o.keepCancel !== true) {
        cancelRequested = false;
    }
    const chat = getChat();
    const floor = Number.isFinite(o.floor) && o.floor >= 0 ? o.floor : chat.length - 1;
    /* ★ P1-5：同一楼同一版已经成功算过 ⇒ **不再发请求**（她随便刷多少次都不烧额度 ✓） */
    const swipeId = currentSwipeId(floor);
    const commitKey = commitKeyOf(floor, swipeId);
    if (o.force !== true && alreadyCommitted(loadState(), floor, swipeId)) {
        running = false;
        markLive();   /* ★ 20261022：提前返回也要关灯，否则界面按钮永久禁用 */
        return { ok: true, skipped: true, reason: '这一楼的这一版已经算过了（重刷同一版不重复烧额度）' };
    }
    resetApiAttempts();   /* 4-b #3：这一轮从零开始数（花了几份） */
    /*
     * 依据＝阿砚 1-c #9（记录要带 chatKey，订阅方据它丢弃过期事件）：
     *   我们不自建 emit（全库 0 处），但每一轮的记账里必须能看出“这是哪个聊天”——
     *   切聊天后旧轮次的迟到结果即使写错也能被认出来。
     */
    const chatKeyNow = currentChatKey();
    /*
     * 依据＝阿砚 1-c #3（游戏时间调度）里最便宜、也最要紧的一条：
     *   **⛔ 只存 ms**——编码升级后毫秒会与新区错位；要存“当时的游戏时间原文”＋“哪个聊天”。
     *   这一笔只做**记账**（调度判别联合 TimeSource 尚未做），但把两把锚先立住：
     *     `lastRunChatKey`＝这一轮算的是哪个聊天；
     *     `lastRunGameTimeRaw`＝这一轮看到的**世界钟原文**（原样，⛔ 不转 ms）。
     */
    let gameTimeRawNow = '';
    try {
        gameTimeRawNow = String((loadState().world || {}).clock || '');
    } catch (eClock) { gameTimeRawNow = ''; }
    /*
     * ★ [580]／世界记忆引擎 C2：**换版本／强制重算 ⇒ 先回这一楼的存档点** ✓
     *   旧：同楼换 swipe 直接在已落账上叠推 ✗（暗线连跳、局势叠层 ✗）
     *   现：有 rollCheckpoint 且楼号对得上 ⇒ restore 再算；没有 ⇒ **拒绝**（对照 C：redo 无 cp 拒）✓
     *   同楼同版已在上面 alreadyCommitted 跳过；force 同版也走回档（替换重算，不是叠算）✓
     */
    {
        const lu0 = loadState().lastUpdate || {};
        /*
         * 依据＝阿砚任务 1-a 的连体修正：
         *   `lastUpdate.floor` 现在写的是**本轮楼**（为了显示对），
         *   但“这一楼是不是已经算过”要看**增量水位** `pipeline.atFloor`（与 shouldUpdateNow 同一个水位）；
         *   否则一轮刚落账就会被当成“同楼重算但没存档点” ⇒ 直接拒跑（实测：整条链路不发请求）。
         */
        const anchorFloor0 = Number((loadState().pipeline || {}).atFloor);
        const priorOkSameFloor = lu0.status === 'ok'
            && Number.isFinite(anchorFloor0) && anchorFloor0 >= 0 && anchorFloor0 === Number(floor);
        const swipeChanged = String(lu0.commitKey || '') !== commitKey;
        const needRedoBase = priorOkSameFloor && (o.force === true || swipeChanged);
        if (needRedoBase) {
            const cp = getRollCheckpoint(floor);
            if (cp && cp.data) {
                restoreSnapshot({ data: cp.data });
            } else if (swipeChanged) {
                /* 换版本且无存档点 ⇒ 拒（对照 C：redo 无 cp 拒）；force 同版无 cp 降级续跑（升级旧账）✓ */
                running = false;
        markLive();   /* ★ 20261022：拒重叠也要关灯（否则按钮永久禁用） */
                return {
                    ok: false,
                    reason: '这一楼换了版本，但没有存档点可回滚——拒着重叠推演（请先成功更新过这一楼，或清空后重来）',
                };
            }
        }
    }
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
        const prevRuns = Number((loadState().pipeline || {}).runs || 0);   /* 94：保底结算用的轮次 */
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
        runs: prevRuns + 1,
    });
    /* ⭐ 谷歌（一）：分批时按**这一批楼层**拼材料 ✓；单楼旧行为照旧 ✓ */
    const msgs = (Array.isArray(o.batchFloors) && o.batchFloors.length)
        ? messagesOfFloors(o.batchFloors)
        : recentMessages(floor, Math.max(6, settings.recentTurns * 2));
    const cleaned = cleanMessages(msgs);
    const material = {
        /* ⭐ S2（材料 05 自查）：**这一回是整批补推吗** ✓
         *   补推时 material.messages 就是**该批全部楼层** ✓
         *   （她一批可能 #0～#5 共 6 层 ✓）
         *   ⇒ 在场判定必须看**整批**，⛔ 只看最后 2 楼 ✗ */
        batch: Array.isArray(o.batchFloors) && o.batchFloors.length > 0,
        floor,
        recentText: cleaned.text,
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
    const runStartTs = Date.now();   /* 864：本轮更新过谁（生活节拍用） */
    let stepsUsed = 0;
    let lastError = '';
    let worldRes = { ok: false, reason: '没跑' };
    let charRes = { ok: false, reason: '没跑' };
    let lastLayers = null;   /* 98：三层跑完的回执（供回执／自测看） */
    /*
     * ⭐⭐ R4（材料 05）：**让 worldAtFloor 真正被读** ✓
     *   旧：只写不读 ✗ ⇒ 世界步成功（暗线萌芽⇒发酵）、紧接着角色步失败时 ✗
     *     重试同一楼会**对着已经到“发酵”的暗线再跑一遍世界步** ✗
     *     ⇒ 同一楼里暗线**连跳两级** ✗（萌芽⇒逼近 ✗）
     *   现在：上一轮世界步已经成功过**而整楼还没跑完**（atFloor < floor ✓）⇒ **跳过世界步、直接接角色步** ✓
     *   （她若事后手动重刷同一楼，atFloor 已等于 floor ⇒ 不跳、照常重跑 ✓）
     */
    const worldStepDone = (() => {
        try {
            const p = loadState().pipeline || {};
            return Number(p.worldAtFloor) === Number(floor) && Number(p.atFloor) < Number(floor);
        } catch (eDone) {
            return false;
        }
    })();
    if (worldStepDone) {
        worldRes = { ok: true, reason: '这一楼的世界步上一轮已经成功过 ⇒ 跳过，直接接着跑角色步 ✓' };
    }
    if (!worldStepDone && stepsUsed < budget) {
        stepsUsed += 1;
        for (let attempt = 0; attempt <= RETRY_LIMIT; attempt += 1) {
            if (cancelRequested) {
                break;
            }
            setPipeline({ tries: attempt });
            /* ★ ⑫：先把正文里的时间写进世界钟，再让 stepWorld 用它 ✓ */
        if (attempt === 0) {
            try { prefillClockFromBody(material); } catch (ePF) { }
        }
        worldRes = await stepWorld(material, attempt);
            if (worldRes.ok) {
        /* 98：三层独立提示词（世界→局势→暗流）——开关在 settings.layerPrompts，默认关 */
        try {
            const layerOut = await runLayers(material);
            if (layerOut && layerOut.layers) { lastLayers = layerOut.layers; }
        } catch (eLayers) { console.warn('[万象阁] 三层提示词没跑成：', eLayers); }
                /* ⭐谷歌复核（二）：世界状态成功 ⇒ **立刻落盘** ✓ + 记下 worldAtFloor ✓
                 *   ⇒ 之后角色步挂了，**绝不回滚它** ✓（下次从这批的角色步接着跑 ✓） */
                try {
                    const stW = loadState();
                    stW.pipeline = Object.assign({}, stW.pipeline || {}, { worldAtFloor: floor });
                    saveState();
                } catch (eW) { /* ⛔ 影响主流程 */ }
                break;
            }
            lastError = worldRes.reason;
            /* ⭐ 业务层别瞎试：参数级的错（你再试一百次也一样 ✗）⇒ 直接放弃重试 ✓
             *   ⛔ 网络级（reset／超时／回体是 null）照旧多试 ✓；⛔ 402／额度类也照旧多试（免费站会恢复 ✓） */
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
    /* 13：角色筛选——独立一步；默认隔 2 层跑（场景有人离场时强制跑） */
    let screenRes = { ok: false, reason: '没跑' };
    try {
        const nowPlace = String((loadState().world || {}).place || '');
        /* 129-A：⛔ 不再按楼层／离场／场景挑；有正文就跑 —— 少跑一次＝整楼退回词表（词表实测漏 4/7） */
        const needScreen = !!String(material.recentText == null ? '' : material.recentText).trim();
        if (needScreen && !cancelRequested && stepsUsed < budget) {
            stepsUsed += 1;
            const rosterNow = loadState().characters || [];
            const nowOn = rosterNow.filter((c) => c && !c.isPlayer && !c.offstage).map((c) => c.name);
            const nowOff = rosterNow.filter((c) => c && !c.isPlayer && c.offstage).map((c) => c.name);
            screenRes = await screenOnStage({ recentText: material.recentText, onNames: nowOn, offNames: nowOff });
            if (screenRes.ok) {
                try {
                    setPipeline({
                        screenFloor: Number(material.floor),
                        screenLeft: screenRes.leftList || [],
                        screenPlace: nowPlace,
                        /* 129-B/C：位置、理由、cutList 进账（诊断对账用） */
                        screenOn: (screenRes.onStageList || []).map((x) => ({ name: x.name, place: x.place || '' })),
                        screenOff: (screenRes.leftList || []).map((x) => ({ name: x.name, place: x.place || '', reason: x.reason || '' })),
                        screenAt: Number(material.floor),
                        screenCut: (screenRes.cutList || []).map((x) => ({ name: x.name, place: x.place || '', reason: x.reason || '' })),
                    });
                    if (screenRes.empty === true) { setPipeline({ text: '本轮无人在场（筛选步给的）' }); }
                    if (Array.isArray(screenRes.cutList) && screenRes.cutList.length) { setPipeline({ text: '后台砍了 ' + String(screenRes.cutList.length) + ' 人' }); }
                } catch (eSF) { /* 不影响 */ }
            }   /* 筛选失败不写 lastError：那会把世界／角色步的真错因盖掉 */
        }
    } catch (eScreen) { screenRes = { ok: false, reason: String(eScreen && eScreen.message) }; }
    if (!cancelRequested && worldRes.ok && stepsUsed < budget) {
        stepsUsed += 1;
        setPipeline({ step: '读角色状态与平行事件', text: '正在算角色状态与平行事件' });
        for (let attempt = 0; attempt <= RETRY_LIMIT; attempt += 1) {
            if (cancelRequested) {
                break;
            }
            charRes = await stepCharacters(material, attempt, screenRes);
            if (charRes.ok) {
                /* 94：离场的人转后台（保留 current，不清空）；在场的标回前台 */
                try {
                    const st4 = loadState();
                    for (const c4 of (st4.characters || [])) {
                        if (!c4 || c4.isPlayer) { continue; }
                        const pf = Number(c4.presentFloor);
                        if (Number.isFinite(pf) && pf >= Number(material.floor)) {
                            c4.offstage = false;
                            delete c4.offstageSince;
                        } else if (Number.isFinite(pf) && pf >= 0) {
                            c4.offstage = true;
                            if (!Number.isFinite(Number(c4.offstageSince))) { c4.offstageSince = Number(material.floor); }
                        }
                    }
                } catch (eOff) { /* 标不了也不能拦着主流程 */ }
                break;
            }
            lastError = charRes.reason;
            /* ⭐ 业务层别瞎试：参数级的错（你再试一百次也一样 ✗）⇒ 直接放弃重试 ✓
             *   ⛔ 网络级（reset／超时／回体是 null）照旧多试 ✓；⛔ 402／额度类也照旧多试（免费站会恢复 ✓） */
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
        /* 6：本轮真被更新过的人，才记“上次生活结算”（⛔ 全名册刷） */
        if (charRes.ok) {
            const wMin = Number((state.world || {}).clockMinute);
            if (Number.isFinite(wMin)) {
                for (const cc of (state.characters || [])) {
                    if (cc && Number(cc.lastUpdatedAt) >= runStartTs) { cc.lastSettledMinute = wMin; }
                }
            }
        }
    state.stat.updates = Number(state.stat.updates || 0) + 1;
    saveState();
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
     *     ② 进度显示"进度 100%（已经追平正文）"＝**虚报**；
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
    refreshViewsSoon();   /* 86#5/#6：跑完先排一次界面刷新 */
    setPipeline({
        status: cancelRequested ? 'cancelled' : (failed ? 'failed' : 'ok'),
        step: '完成',
        /* 4-b #3：三格记账（中途失败后面成功了也照留） */
        apiAttempts: lastApiAttempts(),
        chatKey: chatKeyNow,
        lastRunChatKey: chatKeyNow,
        lastRunGameTimeRaw: gameTimeRawNow,
        /* 决定①：能解出「日期＋时段」才当锚用，否则退化为普通文本锚（⛔ 改调度语义） */
        lastRunGameTimeAnchor: clockAnchor(gameTimeRawNow),
        /* 新活：好感表只跟手机走（⛔ 自己算）；手机里没提到的人一动不动 */
        affinitySync: (function () {
            try {
                /* 95：先把**名册里每个人**都建行（没数 ⇒ 「未建立」），再按手机抄 */
                {
                    const stA = loadState();
                    for (const cA of (stA.characters || [])) {
                        if (cA && cA.name) {
                            ensureRow(stA, cA.name, Date.now());
                        }
                    }
                    saveState();
                }
                const r = syncFromPhone(loadState(), String((material && material.rawText) || ''), Date.now());   /* 6：只读正文，⛔ 拿状态文案当手机 */
                return { added: r.added, updated: r.updated };
            } catch (eAff) {
                return { added: 0, updated: 0, error: String(eAff && eAff.message) };
            }
        })(),
        lastInject: lastInjectInfo(),
        endedAt: Date.now(),
        error: failed ? (lastError || '未知原因') : '',
        text,
        cursor: msgs.length,
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
            st2.failLog = st2.failLog.slice(-30);
            saveState();
        } catch (e) {
        }
    }
    state.lastUpdate = {
        at: Date.now(),
        status: failed ? 'failed' : 'ok',
        note: text,
        /* ★ P1-5：这笔提交属于哪一楼的第几版（失败不记，不占用提交身份 ✓） */
        swipeId: failed ? null : swipeId,
        commitKey: failed ? '' : commitKey,
        /*
         * ⭐ 修复单 #19：失败时**停在原来那楼**（⛔ 不许推进）——
         *   推进了会让进度条显示"已经追平正文"，而实际上账被回滚了、这一楼根本没算。
         *   失败的"事实"仍然留着（status/note/failLog 都在），只是不冒充进度。
         */
        floor: failed ? prevLuFloor : (Number.isFinite(Number(floor)) && Number(floor) >= 0 ? Number(floor) : -1),
    };
    /* ★ [580] C2：成功落账后记存档点（同楼首次写入；换 swipe 不覆盖基底）✓ */
    if (!failed && preSnap && preSnap.data) {
        try { rememberRollCheckpoint(floor, preSnap.data); } catch (eCp) { /* 存档点写失败不挡主流程 ✓ */ }
    }
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
    /* ⭐ 谷歌（一）：**滑动字数窗分批** ✓（⛔ 逐楼一整轮 ✗） */
    const batches = buildScanBatches(todo2, worldMaterialCap());
    for (const batch of batches) {
        const floor = batch[batch.length - 1];
        if (cancelRequested) {
            break;
        }
        setPipeline({ text: '补推中：' + floorLabel(batch[0]) + '→' + floorLabel(floor) + '（已完成 ' + String(done) + '/' + String(todo2.length) + '）', cursor: done });
        const res = await runUpdate({ manual: true, floor, batchFloors: batch, keepCancel: true });
        if (!res.ok) {
            failedAt = floorLabel(floor) + '：' + (res.reason || '失败');
            break;
        }
        done += batch.length;   /* ⭐ 一批算几楼 ✓（⛔ 按 1 楼加 ✗） */
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
     *   而进度那侧读的正是 `lastUpdate.floor`（"上次更新停在 #N"＋"进度 X%"）⇒
     *   删楼之后会出现「总共 2 楼，却显示停在 #9、进度 100%（已经追平正文）」（真机截图实锤）。
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
/**
 * ⭐⭐ 材料 06【5】链路断路 3：**换一个回复（Swipe）后这一楼要能重跑** ✓
 *   旧：`cur <= atFloor` 一律拒绝 ✗（注释写着“重 roll 多少次都不重烧” ✓ = 省额度的故意设计 ✓）
 *     ⇒ 但你**真的换了一个回复**时，旧推演结果留在账本里、新回复反而永远不更新 ✗
 *   现在：只在**真的 Swipe 过的那一楼**放行一次 ✓
 *     ⛔ 改“没 Swipe 就不重烧”的原设计 ✗（它照旧生效 ✓）
 */
/**
 * ★ P1-5（修复单 20261019）：**重 roll 解耦** —— 每笔提交都记下「哪一楼的第几版」。
 *   为什么：同一楼同一版重算一次 = 白烧一轮额度；而她真切了 swipe 又必须重算。
 */
export function currentSwipeId(floor) {
    try {
        const chat = getChat();
        const m = chat[Number(floor)];
        const s = Number(m && m.swipe_id);
        return Number.isFinite(s) ? s : 0;
    } catch (e) {
        return 0;
    }
}
export function commitKeyOf(floor, swipeId) {
    return String(Number(floor)) + ':' + String(Number(swipeId) || 0);
}
export function alreadyCommitted(state, floor, swipeId) {
    const lu = (state && state.lastUpdate) || {};
    if (lu.status !== 'ok') { return false; }
    const key = commitKeyOf(floor, swipeId);
    return String(lu.commitKey || '') === key;
}
export function markFloorSwiped(floor) {
    const f = Number(floor);
    if (!Number.isFinite(f) || f < 0) {
        return;
    }
    try {
        setPipeline({ swipedFloor: f });
        /* 切了版本 ⇒ 这一楼的提交身份作废，下次必须重算 ✓ */
        const st = loadState();
        const lu = st.lastUpdate || {};
        if (Number(lu.floor) === f) {
            st.lastUpdate = Object.assign({}, lu, { commitKey: '', swipeStale: true });
            saveState();
        }
    } catch (eSw) { /* 记不上也不能把事件处理搞挂 ✓ */ }
}
export function shouldUpdateNow(floor) {
    const settings = getSettings();
    const state = loadState();
    const last = Number(state.pipeline && state.pipeline.atFloor);
    const cur = Number(floor);
    /*
     */
    const lag = Math.max(0, Math.floor(Number(settings.updateLag)));
    const r = shouldRunUpdate({ curFloor: cur, lastUpdatedFloor: last, lag: Number.isFinite(lag) ? lag : 1 });
    if (!Number.isFinite(cur)) {
        return false;
    }
    /* ⭐ 链路断路 3：她**真的 Swipe 过**这一楼 ⇒ 放行一次 ✓（其余照旧不重烧 ✓） */
    const swiped = Number(state.pipeline && state.pipeline.swipedFloor);
    if (cur === last && Number.isFinite(swiped) && swiped === cur) {
        try { setPipeline({ swipedFloor: -1 }); } catch (eClear) { /* 清不掉也能继续 ✓ */ }
        /* 24：原来 every 全树未定义 ⇒ swipe 一次就 ReferenceError；从设置读（默认 2） */
        const everyN = Math.max(1, Math.floor(Number(settings.updateEvery) || 2));
        return everyN <= 1;
    }
    return r.run;
}
/** 单轮更新最多发几次模型请求（世界状态 1 次 ＋ 角色合并推演 1 次，省额度） */
export function callBudget() {
    return CALLS_PER_TURN + 1;
}