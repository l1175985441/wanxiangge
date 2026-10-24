/**
 * 万象阁 · 召回引擎
 *
 * ⭐ 口径：召回是**一个动作**——她发消息 → 当场算一次"这轮该带什么" →
 *    跟着她这条消息一起进请求。同一份东西，两个面：给主模型的是文字，给她看的是卡片。
 *
 * 分两档（需求书第 4 节）：
 *   · 角色状态（好感等）＝**必带那一档**（说到谁带谁）；
 *   · 世界状态／平行事件＝**自动筛**：以她的最新发言为线索，相关的进、其余排后台。
 */

import { clampNumber, countChars, matchKey, trimText, uniqueBy, eventTitle } from './utils.js';
import { isHiddenMessage } from './extract.js';
import { getRoster, loadState } from './state.js';
import { getChat } from './adapter.js';   /* ★ A3-③：分支情形要知道当前楼数 */
import { getSettings, effectivePrompt } from './settings.js';
import { entityKey, noteAmbiguity } from './identity.js';
import { sourceOk } from './provenance.js';   /* 硬-2：源指纹对不上就⏔当事实 */   /* 硬-5：名字→实体只有一处解析，歧义即未定 */
import { originFeed } from './config.js';   /* I4：来路枚举只有一张表 */

/** 注入总量封顶（硬上限，防越跑越灌） */
/**
 * ★ 补单 1（她 20:25）：**注入字数不该写死**。
 *   1400 只是默认值；真正生效的是她在面板上填的 `injectCharCap`（1–5000，上限是她亲口给的）。
 */
export const INJECT_CHAR_CAP = 1400;
export function injectCharCap() {
    const n = Number((getSettings() || {}).injectCharCap);
    if (!Number.isFinite(n)) { return INJECT_CHAR_CAP; }
    return Math.max(1, Math.min(5000, Math.round(n)));
}

/** 一人一块，封顶条数在代码里再夹一次 */
/*
 * ★ 20261024 依据＝阿砚 24 号（她的口径：召回条数由用户自己填、⏔ 设上限）：
 *   原来这里有个硬顶 8 的常量，她填 20、填 50 都被 Math.min 夹回 8 ⇒ **设置项是摆设** ✗
 *   现在：默认仍是 8，但**不再封顶**；填不合法（0／负数／非数）才回退到 8。代价提示放在面板上，⏔ 在代码里偷偷夹。
 */
const DEFAULT_CHAR_LIMIT = 8;

/** 召回人物条数：她填多少就用多少（只防不合法的值） */
export function charLimitOf(settings) {
    const raw = Number(settings && settings.maxChars);
    return Number.isFinite(raw) && raw > 0 ? Math.trunc(raw) : DEFAULT_CHAR_LIMIT;
}

/** 聊天里最后一条用户消息所在的楼层号 */
export function findLastUserFloor(chat) {
    const list = Array.isArray(chat) ? chat : [];
    for (let i = list.length - 1; i >= 0; i -= 1) {
        const m = list[i];
        if (m && m.is_user && !m.is_system) {
            return i;
        }
    }
    return -1;
}

/** 聊天里锚点楼（含）之前最近一条消息的标识（卡片挂载用；不传 maxFloor 则从末尾找） */
export function findLastMesId(chat, maxFloor) {
    const list = Array.isArray(chat) ? chat : [];
    const start = Number.isFinite(Number(maxFloor)) && Number(maxFloor) >= 0
        ? Math.min(list.length - 1, Math.trunc(Number(maxFloor)))
        : list.length - 1;
    for (let i = start; i >= 0; i -= 1) {
        const m = list[i];
        if (m && trimText(m.mesId)) {
            return trimText(m.mesId);
        }
    }
    return '';
}

export function getMessageText(chat, floor) {
    const list = Array.isArray(chat) ? chat : [];
    const m = list[floor];
    return m ? trimText(m.mes) : '';
}

/**
 * 按名字与别名造索引。
 *
 * ⭐ 口径（自审修正）：**精确全名不限长度**（"晓""Q"这种单字名是她的角色名，⛔ 不许因为
 *    "怕误撞"就把人整个丢掉）；只有**别名**（容易撞车的昵称）才要求 2 个字以上。
 */
export function buildNameIndex(roster) {
    const index = new Map();   // key → { character, exact }
    const put = (key, c, exact) => {
        if (!key) {
            return;
        }
        const old = index.get(key);
        if (!old) {
            index.set(key, { character: c, exact, ambiguous: false, candidates: [c.id] });
            return;
        }
        /*
         * 依据＝阿砚第三批 硬-5（实体身份协议）：
         *   旧：同名第二个角色会**静默覆盖**第一个⇒ 同名两人必然串。
         *   新：撞名 ⇒ 标 ambiguous 并记候选，解析时一律不认（歧义即未定）。
         */
        if (trimText(old.character && old.character.id) !== trimText(c.id)) {
            old.ambiguous = true;
            if (!Array.isArray(old.candidates)) { old.candidates = []; }
            for (const id of [trimText(old.character && old.character.id), trimText(c.id)]) {
                if (id && !old.candidates.includes(id)) { old.candidates.push(id); }
            }
            noteAmbiguity(key, old.candidates);
            return;
        }
        if (exact && !old.exact) {
            old.exact = true;
        }
    };
    for (const c of Array.isArray(roster) ? roster : []) {
        /*
         * ⚠️ Q3（材料 05）**未采纳（前半）**：它要求“玩家自己不进召回” ✗
         *   但 run-tests-g10 的 10.8 当场红：那条用例的夹具就叫「月野兔」，
         *   而 mock 的 Persona 名也是它 ⇒ 她被判为玩家 ⇒ 排掉就认不出别名了 ✗
         *   （审计所盯的正是她报的病，两边冲突 ⇒ ⏔ 擅改 ✗ ⇒ 列口径 ✓）
         */
        /*
         * ⭐ 材料 10 · 第 5 组裁定（她 10-17 授权代拍）：**Q3 前半不动** ✓
         *   定案：**维持“玩家棋子可被召回”** ✓（⏔ 排掉 ✗）
         *   理由：跟 `run-tests-g10` 的 10.8 用例正面冲突（排掉就认不出别名 ✗）；
         *     她的核心诉求「不能把我当普通角色推演」**已由 P4 解决** ✓
         *   带确认：**“不给他建推演行、不替他行动说话决定”这条一字不动** ✓
         */
        if (!c || c.ignored) {
            continue;
        }
        const full = entityKey(c.name);
        if (full) {
            put(full, c, true);          // 全名：多长都收（含单字）
        }
        for (const alias of Array.isArray(c.aliases) ? c.aliases : []) {
            const key = entityKey(alias);
            if (key.length >= 2) {
                put(key, c, false);      // 别名：2 字以上才收（防误撞）
            }
        }
    }
    return index;
}

/** 在一段文字里找出提到了哪些人（按出现位置排序） */
export function findMentions(text, index) {
    const hay = entityKey(text);
    if (!hay) {
        return [];
    }
    const hits = [];
    for (const pair of index.entries()) {
        const key = pair[0];
        const entry = pair[1];
        if (entry && entry.ambiguous) {
            /* 歧义即未定：宁可不认，不拿两个里的一个凑数 */
            noteAmbiguity(key, entry.candidates);
            continue;
        }
        const pos = hay.indexOf(key);
        if (pos >= 0) {
            hits.push({ character: entry.character, pos, exact: entry.exact !== false });
        }
    }
    hits.sort((a, b) => a.pos - b.pos);
    return uniqueBy(hits, (h) => h.character.id);
}

/**
 * 这段正文里出现了名册上的哪些人（＝"谁在现场／前台"）。
 *
 * ⭐ 与召回共用同一套名字判定，另外**多认一层"主名"**：
 *    正文里常写简称（例：名册上是"某某·某某"，正文只写"某某"）——
 *    只认全名会把明明演到的人判成"不在场"，那就等于放他去自由推演（她最在意的污染）。
 *   · 主名＝中圆点/空格前那一段（≥2 字才用，免得"雷"这种一个字乱撞）；
 *   · 单字全名（如"晓"）照旧算。
 */
export function mentionedCharacters(text, roster) {
    const hay = entityKey(text);
    if (!hay) {
        return [];
    }
    const found = new Map();
    const add = (c) => {
        if (c && !found.has(c.id)) {
            found.set(c.id, c);
        }
    };
    for (const c of findMentions(text, buildNameIndex(roster)).map((h) => h.character)) {
        add(c);
    }
    for (const c of Array.isArray(roster) ? roster : []) {
        /*
         * ⚠️ Q3（材料 05）**未采纳（前半）**：它要求“玩家自己不进召回” ✗
         *   但 run-tests-g10 的 10.8 当场红：那条用例的夹具就叫「月野兔」，
         *   而 mock 的 Persona 名也是它 ⇒ 她被判为玩家 ⇒ 排掉就认不出别名了 ✗
         *   （审计所盯的正是她报的病，两边冲突 ⇒ ⏔ 擅改 ✗ ⇒ 列口径 ✓）
         */
        if (!c || c.ignored) {
            continue;
        }
        const name = trimText(c.name);
        const head = name.split(/[·・\s]/)[0];
        if (head && head !== name && head.length >= 2 && hay.includes(matchKey(head))) {
            add(c);
        }
    }
    return Array.from(found.values());
}

function recentContext(chat, leadFloor, turns) {
    const list = Array.isArray(chat) ? chat : [];
    const n = clampNumber(turns, 1, 10, 3);
    const start = Math.max(0, leadFloor - n);
    const parts = [];
    for (let i = start; i < leadFloor; i += 1) {
        const text = getMessageText(list, i);
        if (text) {
            parts.push(text);
        }
    }
    return parts.join('\n');
}

/** 一个人的状态块（给主模型看的那份） */
/**
 * 任务的注入块（主体／支线）。
 *
 * 口径（她与我方复核方一起拍的）：
 *   · 任务＝**目标层**（在追什么），⛔ 不是"下一步动作"；
 *   · **不在场**的角色：带全（主线＋支线＋子项）——正文里没有，这是他"还活着"的证据；
 *   · **现场**的角色：只带主线与"在进行中的子项"（正文正在演，别重复占篇幅）；
 *   · 完成／搁置的只在**主线**里留个痕，支线不占篇幅。
 *
 * @param {object} c 角色
 * @param {boolean} inScene 是否在正文现场
 * @returns {string[]} 要追加的行（没有任务就返回空数组）
 */
function questBlock(c, inScene) {
    const list = Array.isArray(c.quests) ? c.quests : [];
    if (!list.length) {
        return [];
    }
    const kindText = (k) => (trimText(k) === 'main' ? '主线' : '支线');
    const picked = inScene
        ? list.filter((q) => trimText(q.kind) === 'main' && trimText(q.status) !== '搁置')
        : list.filter((q) => trimText(q.status) !== '搁置' || trimText(q.kind) === 'main');
    if (!picked.length) {
        return [];
    }
    const out = ['  任务：'];
    for (const q of picked) {
        const bits = [kindText(q.kind) + '·' + trimText(q.title)];
        if (trimText(q.status)) {
            bits.push(trimText(q.status));
        }
        if (!inScene && trimText(q.note)) {
            bits.push(trimText(q.note));
        }
        const items = Array.isArray(q.items) ? q.items : [];
        const shown = inScene ? items.filter((i) => i && !i.done) : items;
        if (shown.length) {
            bits.push(shown.map((i) => (i.done ? '☑' : '▶') + trimText(i.text)).join(' '));
        }
        out.push('    ' + bits.join(' ｜ '));
    }
    return out;
}

/**
 * 一个角色的注入块。
 * @param {object} item { character, reason, inScene, protected }
 * @param {object} [opts] { anchorFloor } —— 本回合锚点楼（"楼层裁"要有它才算得出距离）
 */
function personBlock(item, opts) {
    const c = item.character;
    const anchorFloor = Number(opts && opts.anchorFloor);
    /*
     * ★ 需求清单 [579]（她 10-19 总括原话）：**前台薄／后台厚**。
     *   前台召回＝人物属性＋读手机好感；过去经历**只**端隐藏楼的；
     *   ⛔ 正在进行时、没有被隐藏的过去经历都不召回（正文里已有／记忆插件能摘到）。
     *   后台：没进正文 ⇒ 过去经历＋正在进行＋好感＋知识面全厚。
     *   ⛔ [579]：**下一步行动／长期目标（任务 quests）前台后台都不召回、不注入**。
     *   判据（[579]）：**一直在场**＝`protected`（近几楼都在）→ 薄；
     *   **本轮刚点到、之前不在场**＝后台出场 → 厚（过去＋正在进行＋好感）。
     *   ⛔ 不能用 inScene 当薄：那会把「第一次出场」也压成一行。
     */
    const thinFront = item.protected === true;
    if (thinFront) {
        const lines = ['· ' + c.name];
        const _affOkFront = /^-?\d+(?:\.\d+)?$/.test(trimText(c.affinity));
        if (_affOkFront) {
            lines.push('  好感：' + trimText(c.affinity)
                + (trimText(c.affinitySource) ? '（读自' + trimText(c.affinitySource) + '）' : ''));
        } else {
            lines.push('  好感：未接入数据源（不显示数值）');
        }
        if (trimText(c.age)) { lines.push('  年龄：' + trimText(c.age)); }
        if (trimText(c.identity)) { lines.push('  身份：' + trimText(c.identity)); }
        if (trimText(c.faction)) { lines.push('  所在势力：' + trimText(c.faction)); }
        if (trimText(c.timePlace)) { lines.push('  时间·地点：' + trimText(c.timePlace)); }
        /* ⛔ 前台不端「正在经历」——[579]：正在进行时不召回 */
        const hidFront = new Set(Array.isArray(item && item.hiddenFloors) ? item.hiddenFloors : []);
        const pastFront = (Array.isArray(c.past) ? c.past : []).filter((p) => {
            if (!p || !trimText(p.text)) { return false; }
            const from = Number(p.fromFloor);
            /* 只认隐藏楼；没楼层号／不在隐藏集 ⇒ 不端（[579]） */
            return Number.isFinite(from) && hidFront.has(from);
        });
        if (pastFront.length) {
            lines.push('  <Historical_Occurrences>');
            lines.push('  【注意】所有回忆为过去式，请勿将回忆中的任何状态理解为当前状态，仅作剧情参考。');
            lines.push('  过去经历（隐藏楼·由近到远）：' + pastFront.map((p) => trimText(p.text)).join('；'));
            lines.push('  </Historical_Occurrences>');
        }
        return lines.join('\n') + '\n';
    }

    const lines = ['· ' + c.name];

    /*
     * ⚠️ P16（材料 07）**未采纳**：它要求“没数值就不输出这一行” ✗
     *   但 **两条用例盯着它**（run-tests-inject「好感照旧（未接入时如实说）」／
     *   run-tests「没接数据源的人如实写未接入，不填占位值」）✗
     *   —— 那是**她定的“如实说、不填占位值”** ✓ ⇒ 不擅改 ✓（列回执待口径 ✓）
     */
    /* ⭐ 同上（防御性）：内存里已经是旧值也不写出文字型好感 ✓ */
    const _affOk = /^-?\d+(?:\.\d+)?$/.test(trimText(c.affinity));
    if (_affOk) {
        lines.push('  好感：' + trimText(c.affinity) + (trimText(c.affinitySource) ? '（读自' + trimText(c.affinitySource) + '）' : ''));
    } else {
        lines.push('  好感：未接入数据源（不显示数值）');
    }
    if (trimText(c.age)) {
        lines.push('  年龄：' + trimText(c.age));
    }
    if (trimText(c.identity)) {
        lines.push('  身份：' + trimText(c.identity));
    }
    if (trimText(c.faction)) {
        lines.push('  所在势力：' + trimText(c.faction));
    }
    if (trimText(c.timePlace)) {
        lines.push('  时间·地点：' + trimText(c.timePlace));
    }

    /*
     * ⚠️ P15（材料 07）**未采纳**：它要求“被判过编造的 current 根本不注入” ✗
     *   但 run-tests-future 盯着**反面**：引擎标了不可靠的，注入时**必须带着那个标** ✓
     *   （而材料又引了 README 第七节“被判过的现状不进注入” —— **项目内部本来就自相矛盾** ✗）
     *   ⇒ 不擅改 ✓ ⇒ 列回执待她口径 ✓
     */
    /*
     * ⭐⭐ Q4（材料 05 · 她原话 [4][11][18][24][140][141]）：**现场保护名不副实** ✓
     *   她的原话：“如果前台角色每回合都在，最近几回合的东西他好像根本不需要召回…好像只有后台召回然后他的过去经历和正在进行的才有用？” ✓
     *   旧：`personBlock` **根本没看 item.protected** ✗
     *     ⇒ 照样把前台角色**上一轮的“正在经历”当系统事实**灌给主模型 ✗
     *     ⇒ 主模型让他**卡在上一轮的动作里重复打转** ✗✗
     *   现在：本轮点名且开了现场保护的（protected ✓）⇒ **只带状态、不重复灌“正在经历”** ✓
     */
    if (trimText(c.current) && item.protected !== true) {
        // 引擎自己标了"这条不牢"的，注入时也要带着标——⛔ 不能被下一轮当成既定事实
        lines.push('  正在经历：' + trimText(c.current)
            + (c.currentSuspect ? '　⚠（引擎判定这条不可靠：' + (trimText(c.currentSuspectWhy) || '疑似越界') + '，别当事实用）' : ''));
    }

    const past = Array.isArray(c.past) ? c.past : [];
    /*
     * ⭐ B5（材料 13·兑现率）：**“端过一次”不等于“以后永远不端”** ✓
     *   旧：`!p.injected` ✗ —— 只要某条过去经历被端过一次 ✗
     *     ⇒ 下一轮它就被**永久封死** ⇒ 模型第二轮就“失忆”了 ✗
     *   现在：只按**楼层裁**（pastFloorCut）避免重复 ✓
     *     ⇒ 近几楼里已经在上下文里的不端 ✓，真正老的事每轮都能被拿到 ✓
     *   （与材料 11 RD2 里卡片那边的口径一致 ✓）
     */
    /*
     * ★ 20261022 A4（设计稿·B组之前的 A 组）：**召回侧按楼层过滤**
     *   · `void === true` 的条目（将来删楼裁决会标它）⇒ ⏔ 不取；
     *   · 来源楼比当前锥点楼还靠后（未来楼）⇒ ⏔ 不取（那事还没发生）。
     */
    let chatLen = NaN;
    try { const chAt = getChat(); chatLen = Array.isArray(chAt) ? chAt.length : NaN; } catch (eCL) { chatLen = NaN; }
    const notVoid = (x) => !(x && x.void === true);
    const notFuture = (x) => {
        const f = Number(x && (x.floor !== undefined ? x.floor : x.fromFloor));
        if (!Number.isFinite(f) || f < 0) { return true; }
        /*
         * ★ A3-③（她拍板）：**分支里不存在的楼 ⇒ 只是看不见，⏔ 删**（能切回来）。
         *   所以这里按“当前聊天实际楼数”＋“锥点楼”双上限过滤。
         */
        /* 只在“超出当前楼数且也超出锥点楼”时才当分支孤儿；否则交给下面的楼层裁 ✓ */
        if (Number.isFinite(chatLen) && f >= chatLen && (!Number.isFinite(anchorFloor) || f > anchorFloor)) { return false; }
        if (!Number.isFinite(anchorFloor)) { return true; }
        return f <= anchorFloor;
    };
    const fresh = past.filter((p) => p && p.text).filter(notVoid).filter(notFuture);
    /*
     * ⭐ 楼层裁（她拍的）：来源在最近 N 楼之内的**不端**——主模型上下文里已经有那一楼了，
     *    再端一遍等于白占篇幅、还容易让人觉得"重合"；只端更老的（上下文看不到的）。
     *   · N 从设置读（面板可改），0＝不裁（全端）；
     *   · ⚠️ 老数据没有来源楼层 ⇒ 当"很老"处理，**照端**（⛔ 绝不因为缺字段就丢内容）；
     *   · 端过与否（fresh）的逻辑保留不动。
     */
    const cut = Number.isFinite(Number(getSettings().pastFloorCut)) ? Number(getSettings().pastFloorCut) : 0;
    /*
     * ★ 3-2（修复单 20261019）：过去经历**只看那一楼有没有被隐藏**。
     *   隐藏楼 ⇒ 主模型看不见 ⇒ 必须端；可见且近 ⇒ 上下文里已有 ⇒ 不端。
     *   老数据（没 fromFloor）或这一楼没有隐藏楼 ⇒ 照旧用 pastFloorCut 按距离兜底 ✓
     */
    const hidSet = new Set(Array.isArray(item && item.hiddenFloors) ? item.hiddenFloors : []);
    const keepByFloor = (p) => {
        const from = Number(p && p.fromFloor);
        if (Number.isFinite(from) && hidSet.size) {
            if (hidSet.has(from)) {
                return true;    // 隐藏楼 ⇒ 端
            }
            if (cut > 0 && Number.isFinite(anchorFloor) && (anchorFloor - from) < cut) {
                return false;   // 可见且近 ⇒ 不端
            }
        }
        if (!cut || !Number.isFinite(anchorFloor)) {
            return true;
        }
        if (!Number.isFinite(from)) {
            return true;   // 老数据：当很老
        }
        return (anchorFloor - from) >= cut;
    };
    /*
     * ★ 补单 1-④：这一段是**过去式**，不能被当成现在的状态；
     *   用成对标签整块包夹，块头固定一句声明 ✓
     */
    const PAST_HEAD = '  <Historical_Occurrences>';
    const PAST_DECL = '  【注意】所有回忆为过去式，请勿将回忆中的任何状态理解为当前状态，仅作剧情参考。';
    const PAST_TAIL = '  </Historical_Occurrences>';
    const freshByFloor = fresh.filter(keepByFloor);
    if (freshByFloor.length) {
        lines.push(PAST_HEAD, PAST_DECL);
        lines.push('  过去经历（由近到远）：' + freshByFloor.map((p) => p.text).join('；'));
        lines.push(PAST_TAIL);
    } else if (fresh.length && freshByFloor.length !== fresh.length) {
        // 全都被"楼层裁"挡下了 ⇒ 如实说明（⛔ 不静默，也不拿近处的凑数）
        /*
         * ⭐ P17（材料 07）：原句 38 字的“（最近 N 楼内的**已在你的上下文里**，不再重复；**更老的暂时没有**）” ✗
         *   是插件内部账本话，不该喂给写正文的模型 ✗ ⇒ 删掉两处黑话 ✓
         *   ⚠️ 但 run-tests-inject 盯着“要如实说明为什么不端”（子串「最近 3 楼内」✓）
         *   ⇒ 保留**一句最短的实话** ✓（不再提“你的上下文”与“更老的暂时没有” ✓）
         */
        /* ★ 补单 1-④：⏔ 把楼层号与账本黑话喂给写正文的模型 ✓ */
        lines.push(PAST_HEAD, PAST_DECL);
        lines.push('  过去经历：近处的回忆已在正文里，这里不重复。');
        lines.push(PAST_TAIL);
    } else if (past.length && trimText(past[0].text) && keepByFloor(past[0])) {
        lines.push(PAST_HEAD, PAST_DECL);
        lines.push('  过去经历（最近一条）：' + trimText(past[0].text));
        lines.push(PAST_TAIL);
    }

    // ⛔ 这里原来会把"推断"喂回模型 —— 按需求书去掉了：
    //    她定的角色字段只有七格（年龄／身份／过去经历／正在经历／所在势力／好感值／时间・地点），
    //    推断不是一格；防"推断被当成已发生"靠的是提示词硬规矩（⛔ 不写下步动作／不写预判），
    //    ⛔ 不是靠"多存一格推断再喂回去"——那反而给了模型一份"可能发生"的素材。
    /* ★ [579]：下一步行动／长期目标（quests）前台后台都不注入 ✓
     *   旧：后台厚块用 questBlock 带任务当"还活着的证据" ✗ ⇒ 与她总括冲突 ✗
     *   日程（约好的事）≠长期目标，照旧可带 ✓ */
    if (c.schedule && c.schedule.length) {
        const todo = c.schedule.filter((s) => !s.done);
        if (todo.length) {
            lines.push('  日程：' + todo.map((s) => (s.dueReached ? '【⚠️已到点·本轮应履约】' : '') + s.what + (s.due ? '（' + s.due + '）' : '')).join('；'));
        }
    }
    /*
     * ⭐ B6（材料 13·兑现率）：**认知账也要端给主模型** ✓
     *   旧：`knows` 只在后台推演的提示词里用 ✗
     *     ⇒ 写正文的模型**完全不知道“谁知道什么”** ✗ ⇒ 会把不该知道的人写成全知 ✗
     *   现在：随后台厚块一起端进去 ✓
     *   ★ 补单 1：认知账不按条数截（旧 slice(0,6) ✗ ⇒ 第 7 条以后的事主模型当他不知道）；
     *     总量仍由 injectCharCap 管 ✓。前台薄块在上面已 return，这里不进前台 ✓
     */
    /*
     * ★ 3-1：**知识面随人物块一起端**——不靠“视角纪律”，靠原料：
     *   名单上没有的事，主模型就不该写给他。beliefs 另起一行：那是“他以为”，可能是误会 ✓
     */
    const kf = Array.isArray(c.knownFactKeys) ? c.knownFactKeys.filter(Boolean) : [];
    /* ★ 补单 1：知识面是“这个人”的一部分，人带了就整份带；总量由 injectCharCap 统一管 ✓ */
    if (kf.length) {
        lines.push('知识面（他知道这些事；名单里没有的，⏔ 不许写给他）：' + kf.join('、'));
    }
    const kb = Array.isArray(c.knownFactBeliefs) ? c.knownFactBeliefs.filter((b) => b && b.key && b.belief) : [];
    if (kb.length) {
        lines.push('知识面（他以为的，可能是误会，⏔ 当事实写）：'
            + kb.map((b) => b.key + '＝' + b.belief).join('；'));
    }
    /* ★ 她 22:2x：行为边界／知识边界——事实，可喂；⏔ 写成表演描写 ✓ */
    if (trimText(c.behaviorBounds)) {
        lines.push('认知账（他会怎么做）：' + trimText(c.behaviorBounds) + '（⏔ 与这不符的演法不要）');
    }
    if (trimText(c.knowledgeBounds)) {
        lines.push('知识面（他不知道什么）：' + trimText(c.knowledgeBounds) + '（⏔ 他不知道的就别让他知道）');
    }
    if (Array.isArray(c.knows) && c.knows.length) {
        const knLines = c.knows.filter(notVoid).filter(notFuture)
            .map((k) => {
                const t = trimText(k && k.text);
                if (!t) { return ''; }
                const ch = trimText(k && k.channel);
                const chTag = ch === 'physical' ? '·亲历'
                    : ch === 'information' ? '·被告知'
                    : ch === 'causal' ? '·牵连'
                    : '';
                return t + chTag;
            })
            .filter(Boolean);
        if (knLines.length) {
            lines.push('  他知道什么：' + knLines.join('；'));
        }
    }
    if (c.isPlayer) {
        lines.push('  备注：这是玩家棋子（由她本人控制），只可作为"别人对TA做的事"出现。');
    }
    if (c.isNew) {
        /* P18 (material 07): same - internal bookkeeping must not reach the writing model. */
    }
    return lines.join('\n') + '\n';
}

/** 一条世界事件的块 */
function eventBlock(ev) {
    const title = trimText(ev && ev.title);
    if (!title) {
        return '';
    }
    const bits = [];
    const text = trimText(ev.text);
    const sides = trimText(ev.sides);
    /*
     * ⚠️ 去重（逐条核验 4.7 时看出来的）：事件是更新那一步派生的，
     *    `text` 与 `sides` **大多数时候是同一个值** ⇒ 原来会输出
     *    「教会在争港口税：教会／商会 ｜ 各方：教会／商会 ｜ 火候：几天内」
     *    —— 同一串字在一行里出现两遍。这段是**模型每轮都要读**的，
     *    重复＝纯浪费上下文（4.7「⛔ 不要全量灌」）。
     */
    if (text) {
        bits.push(text);
    }
    if (sides && sides !== text) {
        bits.push('各方：' + sides);
    }
    if (trimText(ev.stage)) {
        bits.push('阶段：' + trimText(ev.stage));
    }
    if (trimText(ev.tier)) {
        bits.push('火候：' + trimText(ev.tier));
    }
    /*
     * 依据＝阿砚第三批 硬-2：带来源的条目，**每次用之前**重算指纹。
     *   原文被改过／楼被删 ⇒ 这条不再当事实喂给模型（宁可少一条，⏔ 拿旧记忆冒充）。
     */
    if (ev && ev.source && ev.source.digest) {
        const fl = Number(ev.source.floor);
        let nowText = '';
        try {
            const chat = getChat();
            nowText = (Number.isFinite(fl) && chat && chat[fl]) ? String(chat[fl].mes || '') : '';
        } catch (eCh) { nowText = ''; }
        if (!sourceOk(ev.source, nowText)) {
            return '';
        }
    }
    /* ★ [580] B1：来路三型进注入 ✓ */
    const oriEv = trimText(ev.origin);
    if (originFeed(oriEv)) { bits.push(originFeed(oriEv)); }   /* I4：与 pipeline 同一张表 */
    /* ★ R32：脉动四格进注入（事实可喂；⛔ 不写“所以接下来会…”） */
    if (Number.isFinite(Number(ev.pressure)) && ev.pressure !== null && ev.pressure !== '') {
        bits.push('压力：' + String(Number(ev.pressure)) + '/5');
    }
    if (trimText(ev.trend)) {
        bits.push('趋势：' + trimText(ev.trend));
    }
    const vis = String(trimText(ev.visibility) || '').toLowerCase();
    if (vis === 'public') {
        bits.push('可见度：公开');
    } else if (vis === 'trace') {
        bits.push('可见度：痕迹／风声（不当已证实新闻）');
    } else if (vis === 'private' || ev.public === false) {
        bits.push('可见度：私域（别当世界新闻广播）');
    } else if (trimText(ev.visibility)) {
        bits.push('可见度：' + trimText(ev.visibility));
    }
    if (trimText(ev.evidence)) {
        bits.push('原文证据：“' + trimText(ev.evidence) + '”');
    }
    /* ★ [580] A6：预期／实果／余波（事实可喂；⛔ 不写成预判表演） */
    if (trimText(ev.expected)) { bits.push('预期：' + trimText(ev.expected)); }
    if (trimText(ev.result)) { bits.push('实果：' + trimText(ev.result)); }
    if (trimText(ev.consequence)) { bits.push('余波：' + trimText(ev.consequence)); }
    /* ★ [579]/[580]：公开／痕迹／私域三态＋书源分显；不够公开的事要标出来，⛔ 让世界推演把它当“世界新闻”广播出去 ✓ */
    const src = trimText(ev.source);
    let srcTag = '';
    if (src === 'book') { srcTag = '（书里写着的）'; }
    else if (src === 'engine') { srcTag = '（引擎推出的）'; }
    else if (src === 'manual') { srcTag = '（手改）'; }
    let pubTag = '';
    if (vis === 'trace') { pubTag = '（风声：别写成已公开新闻）'; }
    else if (vis === 'private' || (ev && ev.public === false && vis !== 'public')) {
        pubTag = '（私域：别当世界新闻广播）';
    }
    return '· ' + title + srcTag + pubTag + (bits.length ? '：' + bits.join(' ｜ ') : '') + '\n';
}

/** 她把"世界状态"和"平行事件"按相关度筛出来 */
function pickEvents(leadText, ctxText, events, cap) {
    const n = clampNumber(cap, 0, 20, 6);
    if (!n || !Array.isArray(events) || !events.length) {
        return { picked: [], dropped: 0 };
    }
    const lead = matchKey(leadText);
    const ctx = matchKey(ctxText);
    const scored = events.map((ev, idx) => {
        const hay = matchKey([ev.title, ev.text, ev.sides, ev.stage].filter(Boolean).join(''));
        let score = 0;
        if (lead && hay) {
            // 发言里出现同一个词就加分（粗筛：2 字以上的切片）
            /* ⭐修复 8：**步长改回 1** ✓（原 i += 2 ✗ ⇒ 奇偶位跨界的双字词漏掉 ✗） */
            for (let i = 0; i + 2 <= lead.length; i += 1) {
                const gram = lead.slice(i, i + 2);
                if (gram.length === 2 && hay.includes(gram)) {
                    score += 2;
                }
            }
        }
        if (ctx && hay) {
            /* ⭐修复 8：**步长改回 1** ✓（原 i += 4 ✗ ⇒ 漏得更多 ✗） */
            for (let i = 0; i + 2 <= ctx.length; i += 1) {
                const gram = ctx.slice(i, i + 2);
                if (gram.length === 2 && hay.includes(gram)) {
                    score += 1;
                }
            }
        }
        return { ev, idx, score };
    });
    const hot = scored.filter((s) => s.score > 0);
    /* ⭐⭐ 修复 8：与当前对话**完全无关**（score === 0）的事件里，**只允许公开局势补位** ✓
     *   ⛔ **绝不把未关联的潜伏暗线（hidden）强塞给主模型** ✗（防暗线提前冒头 ✗ 及被送达回执误拉黑 ✗） */
    const cold = scored.filter((s) => s.score === 0 && s.ev.kind !== 'hidden');
    // 相关的优先；不够封顶数就用"暗线优先、新的优先"补齐（世界不被冷落）
    hot.sort((a, b) => b.score - a.score);
    /* ⭐修复 8：冷门补位**只按新旧** ✓（旧：把 hidden 排在最前 ✗ ⇒ 暗线总冒头 ✗） */
    cold.sort((a, b) => (Number(b.ev.at) || 0) - (Number(a.ev.at) || 0));
    const merged = hot.concat(cold).slice(0, n);
    return { picked: merged.map((x) => x.ev), dropped: Math.max(0, events.length - merged.length) };
}

/**
 * 把召回的条目拼成给主模型的注入块。
 * @param {object} [opts] { anchorFloor } —— 本回合锚点楼（"楼层裁"用；不传就不裁）
 */
export function assembleInjectText(items, events, headerText, opts) {
    const header = trimText(headerText) || effectivePrompt('header');
    const anchorFloor = opts && Number.isFinite(Number(opts.anchorFloor)) ? Number(opts.anchorFloor) : NaN;
    /*
     * ★ 补单 1：人物块**按“谁更该被看见”排**，⏔ 按数组自然序（否则总是先入库的几个人被保住）。
     *   优先级：在场（2）> 最近动过（1）> 其他（0）；同级里“最近出现的楼更大”在前 ✓
     */
    const entries = [];
    for (const item of Array.isArray(items) ? items : []) {
        if (item && item.character) {
            const c0 = item.character;
            /* ★ [579]：**一直在场**（protected）正文里已有 → 可先砍；
             *   **刚出场／后台厚块**记忆插件抓不到 → 优先保住 */
            /* ★ [580] A7：砍序用的「最近在场」优先 presentFloor */
            let recent = Number(c0.presentFloor);
            if (!Number.isFinite(recent) || recent < 0) { recent = Number(c0.lastSeenFloor); }
            const pr = item.protected === true ? 0 : 2;
            entries.push({ item, pr, floor: Number.isFinite(recent) ? recent : -1, text: personBlock(item, { anchorFloor }) });
        }
    }
    entries.sort((a, b) => (b.pr - a.pr)
        || (b.floor - a.floor)
        || String((a.item.character && a.item.character.name) || '').localeCompare(String((b.item.character && b.item.character.name) || ''), 'zh'));
    const blocks = entries.map((e) => e.text).filter(Boolean);
    const evBlocks = (Array.isArray(events) ? events : []).map(eventBlock).filter(Boolean);

    const state = loadState();
    const windOnly = (Array.isArray(state.world && state.world.winds) ? state.world.winds : []).some((x) => x && trimText(x.topic));
    // ⭐ 没有人物也没有事件也没有风声账 ⇒ 一个字都不注入（免得只灌一段世界钟，白占上下文）
    if (!blocks.length && !evBlocks.length && !windOnly) {
        return '';
    }
    const worldLines = [];
    if (trimText(state.world.clock)) {
        worldLines.push('世界钟：' + trimText(state.world.clock));
    }
    if (trimText(state.world.place)) {
        worldLines.push('地点：' + trimText(state.world.place));
    }
    if (trimText(state.world.bigPicture)) {
        worldLines.push(trimText(state.world.bigPicture));
    }

    let text = header + '\n';
    if (worldLines.length) {
        text += '【世界】' + worldLines.join(' ｜ ') + '\n';
    }
    if (blocks.length) {
        text += '\n【人物】\n' + blocks.join('\n');
    }
    if (evBlocks.length) {
        text += '\n【世界上正在发生的事】\n' + evBlocks.join('');
    }
    /* ★ [580] C3：账上 winds 单独成段（未证实）；局势／事件里已标 trace 的走上面事件块，⛔ 不在这里再抄一遍 */
    const windRows = (Array.isArray(state.world.winds) ? state.world.winds : []).filter((x) => x && trimText(x.topic)).slice(0, 6);
    if (windRows.length) {
        text += '\n【风声（未证实·别写成已公开新闻）】\n'
            + windRows.map((x) => '· ' + trimText(x.topic)
                + (trimText(x.text) && trimText(x.text) !== trimText(x.topic) ? '：' + trimText(x.text) : '')
                + '\n').join('');
    }

    const cap = injectCharCap();
    if (countChars(text) > cap) {
        // 超了就砍尾巴，并如实说明砍了多少条
        // ⭐【世界】那一段（世界钟／地点／总览）**必须保住**：它是防"时间瞎"的底，
        //    ⛔ 不能因为篇幅先从它身上砍（自审修正：原来重组时把它整个弄丢了）。
        const worldBlock = worldLines.length ? '【世界】' + worldLines.join(' ｜ ') + '\n' : '';
        let kept = worldBlock;
        let keptChars = countChars(header) + countChars(worldBlock) + 8;
        let keptPeople = 0;
        let keptEvents = 0;
        /*
         * ⭐⭐ R9（材料 05）：**截断分支也要带上两个分节标题** ✓
         *   旧：未超 1400 字时正常拼了 「【人物】」与「【世界上正在发生的事】」 ✓
         *     一旦超了走重组分支，直接 kept += b ✗ ⇒ **两个大标题全丢** ✗
         *     ⇒ 人物块与世界事件块**糊在一起** ✗
         */
        if (blocks.length) {
            kept += '\n【人物】\n';
            keptChars += 4;
        }
        for (const b of blocks) {
            if (keptChars + countChars(b) > cap) {
                break;
            }
            kept += b;
            keptChars += countChars(b);
            keptPeople += 1;
        }
        if (evBlocks.length) {
            kept += '\n【世界上正在发生的事】\n';
            keptChars += 4;
        }
        for (const b of evBlocks) {
            if (keptChars + countChars(b) > cap) {
                break;
            }
            kept += b;
            keptChars += countChars(b);
            keptEvents += 1;
        }
        const droppedP = blocks.length - keptPeople;
        const droppedE = evBlocks.length - keptEvents;
        if (!keptPeople && !keptEvents && !worldBlock) {
            return '';
        }
        text = header + '\n' + kept;
        const note = [];
        if (droppedP) {
            note.push(String(droppedP) + ' 人');
        }
        if (droppedE) {
            note.push(String(droppedE) + ' 条世界事件');
        }
        if (note.length) {
            text += '\n（本轮另有 ' + note.join('、') + ' 因篇幅上限未列入）\n';
        }
    }
    return trimText(text) + '\n';
}

/**
 * 算一次召回（纯本地，不发请求）。
 * @returns {object} { floor, mesId, lead, from, items, events, chars, notes, at }
 */
/**
 * ★ P1-4（修复单 20261019）：**已结的只带最近 N 条**，未结的全带。
 *   为什么：已结的事是“背景库”，越堆越多但越堆越不相关；
 *   把它们全塞进每一轮，会把真正进行中的事挤掉名额。
 *   排序：已结按时间从新到旧，取前 N 条；未结一条不动 ✓
 */
export function usableEvents(events, keepClosed) {
    const list = Array.isArray(events) ? events.filter(Boolean) : [];
    const open = list.filter((e) => e.closed !== true);
    const closed = list.filter((e) => e.closed === true)
        .slice()
        .sort((a, b) => Number(b.at || 0) - Number(a.at || 0));
    const n = Math.max(0, Math.floor(Number(keepClosed) || 0));
    return open.concat(n > 0 ? closed.slice(0, n) : []);
}

export function buildRecall(input) {
    const opts = input || {};
    const settings = getSettings();
    const chat = Array.isArray(opts.chat) ? opts.chat : [];
    const leadFloor = Number.isFinite(opts.leadFloor) ? opts.leadFloor : findLastUserFloor(chat);
    const leadText = trimText(opts.leadText);

    const notes = [];
    const result = {
        floor: leadFloor,
        mesId: findLastMesId(chat, leadFloor),
        lead: leadText,
        from: '',
        at: Date.now(),
        items: [],
        events: [],
        chars: [],
        notes,
    };

    if (!settings.enabled) {
        notes.push('总开关关着');
        return result;
    }
    if (leadFloor < 0) {
        notes.push('还没找到你的发言');
        return result;
    }

    const roster = getRoster().filter((c) => c && !c.ignored);
    const index = buildNameIndex(roster);
    const ctxText = recentContext(chat, leadFloor, settings.recentTurns);
    result.from = ctxText;

    /* ★ 3-2：这一楼哪些楼层是隐藏的（归一次算好，随 item 带给 personBlock ✓） */
    const hiddenFloors = (() => {
        const arr = [];
        for (let i = 0; i < chat.length; i += 1) {
            try { if (isHiddenMessage(chat[i])) { arr.push(i); } } catch (eH) { }
        }
        return arr;
    })();
    const leadHits = findMentions(leadText, index);
    let picked = leadHits;
    if (!settings.strictMention) {
        const ctxHits = findMentions(ctxText, index);
        picked = uniqueBy(leadHits.concat(ctxHits), (h) => h.character.id);
    }
    if (settings.sortMode === 'name') {
        const order = new Map(roster.map((c, i) => [c.id, i]));
        picked = picked.slice().sort((a, b) => (order.get(a.character.id) || 0) - (order.get(b.character.id) || 0));
    }

    const limit = charLimitOf(settings);   /* ★ 依据＝阿砚 24 号：不再封顶 */
    const kept = picked.slice(0, limit);
    if (picked.length > kept.length) {
        notes.push('名册里共说到 ' + String(picked.length) + ' 人，按封顶取了 ' + String(kept.length) + ' 人');
    }

    const leadKeys = new Set(leadHits.map((h) => h.character.id));
    /*
     * ★ P0-1（修复单 20261019）：**“在场”看的是他最近几楼是不是都在，——不是这一句点没点到名**。
     *   为什么：本轮点名的人里大多数是后台的人**第一次被提到**，
     *   若把“点名”当“在场”，他们就会丢掉“正在经历”——与“后台人出场要带全”恰恰相反。
     *   取数：★ [580] A7 用 `presentFloor`（正文在场楼），不是 `lastSeenFloor`（后台推演也会写）。
     *   与当前楼相差 ≤ ONSTAGE_RECENT_FLOORS ⇒ 算一直在场。
     */
    const ONSTAGE_RECENT_FLOORS = 2;
    const nowFloor = chat.length - 1;
    const onStageRecently = (c) => {
        if (!c) { return false; }
        let seen = Number(c.presentFloor);
        /* 旧账还没 presentFloor：退回 lastSeenFloor（迁移前行为） */
        if (!Number.isFinite(seen) || seen < 0) { seen = Number(c.lastSeenFloor); }
        if (!Number.isFinite(seen) || seen < 0) { return false; }
        if (!Number.isFinite(nowFloor) || nowFloor < 0) { return false; }
        return (nowFloor - seen) <= ONSTAGE_RECENT_FLOORS;
    };
    result.chars = kept.map((h) => h.character.name);
    result.items = kept.map((h) => ({
        /*
         * ⭐ RD3（材料 11·渲染层）：**记录里存快照，⏔ 存活对象引用** ✓
         *   旧：`character: h.character` 直接指向 `state.characters` 里的活对象 ✗
         *     ⇒ 同一会话里第 #5 楼改了她的 current／affinity ✗
         *     ⇒ 你回头看第 #1 楼的召回记录，看到的已经是**第 #5 楼的新状态** ✗
         *   现在：存一份**深拷贝快照** ✓（拷不成就退回原引用，⏔ 因此抛错 ✗）
         */
        character: (() => {
            try {
                return JSON.parse(JSON.stringify(h.character));
            } catch (eSnap) {
                return h.character;
            }
        })(),
        reason: leadKeys.has(h.character.id) ? '本轮点名' : '最近正文提到',
        inScene: leadKeys.has(h.character.id),
        hiddenFloors,
        protected: settings.protectedBypass === true && onStageRecently(h.character),
    }));

    // 世界事件：按她最新发言相关度筛
    const evPool = usableEvents(loadState().events || [], settings.closedEventKeep);
    const evRes = pickEvents(leadText, ctxText, evPool, settings.maxEvents);
    /*
     * ⭐ 补②：**转入编年的条目 ⛔ 不再塞进去**（她：「连续 3 轮没进 ⇒ 转编年留档、不再占注入位、不再强塞」）。
     *   为什么在这一层做：这里才是"这一轮到底带什么进去"的**唯一出口**；
     *   在别处过滤都会漏（这也是唯一能被用例验到的地方）。
     *   ⚠️ 只挡**事件**这一路：人物是按"她这条发言里点到谁"挑的，
     *     若因为"转过编年"就把人挡掉，那她真点到时反而召回不上来 —— 那是帮倒忙。
     */
    const archivedTitles = new Set(
        (loadState().recallRecords || [])
            .filter((r) => r && r.archived === true)
            .reduce((acc, r) => acc.concat(Array.isArray(r.events) ? r.events : []), [])
            // ⭐ 修复单 #7：这里原来也是 `trimText(x)` ⇒ 对象变 `'[object Object]'`
            //   ⇒ "已归档标题"集合永远匹配不上真标题。用同一个 `eventTitle()`。
            .map((x) => eventTitle(x))
            .filter(Boolean)
    );
    const pickedEvents = Array.isArray(evRes.picked)
        ? evRes.picked.filter((e) => {
            const title = eventTitle(e);
            return !title || !archivedTitles.has(title);
        })
        : evRes.picked;
    result.events = pickedEvents;
    const heldBack = (Array.isArray(evRes.picked) ? evRes.picked.length : 0) - pickedEvents.length;
    if (heldBack > 0) {
        notes.push('有 ' + String(heldBack) + ' 条世界事件连续几轮没进正文，已转编年留档 ⇒ 这轮不再带它们');
    }
    if (evRes.dropped > 0) {
        notes.push('世界事件共 ' + String((loadState().events || []).length) + ' 条，按相关度取了 ' + String(evRes.picked.length) + ' 条，其余排后台');
    }

    if (!kept.length && !evRes.picked.length) {
        notes.push('本轮没有说到名册里的人，也没有相关的世界事件');
    } else if (!kept.length) {
        notes.push('本轮没说到名册里的人（只带了世界事件）');
    }
    if (settings.protectedBypass && leadKeys.size) {
        notes.push('现场保护：本轮点名的 ' + String(leadKeys.size) + ' 人只带状态、不重复推演');
    }

    return result;
}

/** 这一轮注入了多少字（给回执用，与送进去的那一串同源） */
export function injectSize(text) {
    return countChars(trimText(text));
}
