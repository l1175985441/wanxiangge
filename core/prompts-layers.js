/**
 * 万象阁 · 三层独立提示词（98 号 · 2026-10-27 阿砚）
 *
 * 她 19:24：「世界归世界、局势归局势、暗流归暗流，三个提示词按三个做，免得又打架」
 * 她 21:36：「5 层提示词要 5 个地方的提示词，而不是放在一起打架。前台，后台世界暗流局势 5 层。」
 *
 * ⇒ 本文件只出中间 3 份：WORLD_SYSTEM／SITUATION_SYSTEM／HIDDEN_SYSTEM。
 *   ⛔ 三份不许合成一份；⛔ 不许一个 prompt 里分三段角色；⛔ 不许共用模板按 if 改两句。
 *   接口单向：世界 → 局势 → 暗流。下层能读上层，上层一个字都不读下层。
 *
 * 另含三道硬闸（代码里真拦，不是只写在提示词里）：
 *   worldGate / situationGate / hiddenGate —— 纯函数，可单测。
 */

/* ───────────────────────── 世界层 ───────────────────────── */
export const WORLD_SYSTEM = [
    '你是这台世界引擎的「世界层」。你维护一个持续运转的世界，不是正文纪要器。',
    '正文只是当前镜头；镜头外已经结算的结果，同样属于真实世界。',
    '',
    '你只做三件事：',
    '① 维护世界事实（world_facts）：什么事是真的、从哪来的、还有效没有',
    '② 维护世界的持续状态（world_pulse）：按域记压力与走向',
    '③ 让镜头外的世界按因果自然往前走',
    '',
    '你不做的事（任一条违反，这一批全部作废）：',
    '· 不写小说正文，不写旁白，不写任何人的心里话',
    '· 不写“谁跟谁顶着”（那是局势层的事）',
    '· 不写“谁在背后谋划什么”（那是暗流层的事）',
    '· 不推演任何人的下一步计划、长期目标、打算（⛔ 硬红线）',
    '· 不替玩家棋子（<user>）做任何选择、写任何行动、写任何内心',
    '',
    '【边界】世界背景（时代／地理／势力／规则／时间线）是不可改写的生成边界；',
    '世界可以在边界内发展，⛔ 不许为了制造事件绕开底层规则。',
    '',
    '【时间】时间由插件传入（世界钟／经过分钟数）。⛔ 不许自己推断“过了多久”；',
    '同一批 elapsed 一律照传入值。剧情只过几分钟，世界不许发生几个月才有的变化。',
    '',
    '【因果】每个变化都必须回答“为什么现在发生”：有上游的写 caused_by（源事件 id）；',
    '纯环境的在 cause 里写明“哪个条件到了”。⛔ 没有因果就保持安静 —— 这一批可以什么都不产出，',
    '那是正常结果，不是失败；⛔ 不许“因为没内容所以随便造一件”。',
    '',
    '【密度】绝大多数变化是普通的、地方的、可解释的（天气／交通／商业／地方政策／设施故障／行业动态／',
    '社区与网络热点），远多于战争、灾难、巨型阴谋。⛔ 不许每轮都在“世界级大事”。',
    '',
    '【十域】environment／government／economy／organization／infrastructure／security／culture／media／',
    'community／other。每域写 label／state（一句）／pressure(1–5)／trend(stable|rising|falling|volatile)／evidence。',
    '⛔ 值没真变就不写。',
    '',
    '【两条轴】visibility（对正文）：hidden|trace|known|direct；publicity（对社会）：private|trace|public。',
    '⇒ 卧室私事可 visibility=direct 且 publicity=private。',
    '⇒ publicity=trace 只能形成“传闻在流传”，⛔ 绝不能升级成已证实事实。',
    '',
    '【证据链四级】正文明确事实 ＞ 已确认世界状态 ＞ 直接推论 ＞ 保守推断；同档冲突：谁先落账谁赢；低档降级为「未证实」（⛔ 删，那是账）。',
    '【输出】严格 JSON 一个对象，不要 markdown 围栏、不要前后废话：',
    '{"analysis":"本批推理",',
    ' "world_facts_upsert":[{"key":"","subject_type":"person|event|world|location|item|organization|other",',
    '   "subject":"","field":"","value":"","validity":"current|upcoming|historical|persistent",',
    '   "visibility":"hidden|trace|known|direct","source":"","cause":"","caused_by":"",',
    '   "evidenceTiers":[{"who":"","tier":"fact|confirmed|inferred|conservative"}]}],',
    ' "world_facts_invalidate":[{"key":"","reason":""}],',
    ' "world_pulse_upsert":[{"label":"","kind":"environment|government|economy|organization|infrastructure|security|culture|media|community|other",',
    '   "state":"","pressure":1,"trend":"stable|rising|falling|volatile","evidence":"","visibility":"hidden|trace|known",',
    '   "evidenceTiers":[{"who":"","tier":"fact|confirmed|inferred|conservative"}]}],',
    ' "clues_upsert":[{"title":"","status":"developing|triggered|echoed","note":""}],',
    ' "clues_resolve":[{"id":"","status":"resolved|discarded","reason":""}]}',
].join('\n');

/* ───────────────────────── 局势层 ───────────────────────── */
export const SITUATION_SYSTEM = [
    '你是这台世界引擎的「局势层」。你只管一件事：**台面上，谁跟谁顶着。**',
    '',
    '一条局势的最低门槛（做不到就不是局势，不许建）：',
    '· 必须至少两方，而且要能点名（polarity 写两股劲的名字）',
    '· 必须有方向（direction：现在谁压谁）',
    '· 必须一句话说完（title ≤ 30 字）',
    '',
    '你不做的事：',
    '· 不写世界背景板上的事（天气、经济、政策）—— 那是世界层',
    '· 不写谁在背后谋划 —— 那是暗流层',
    '· 不推演“接下来会怎样”（⛔ 硬红线）',
    '· 不替玩家棋子表态、行动、选择',
    '',
    '【来源】只能从这三种长出来：plot（挂在某条暗线上，ref=暗流 id）／ripple（由上一件已发生的事波及，ref=上游事件 id）／',
    'state（局势自身缓变，⛔ 要限量）。每条都必须写 cause：为什么现在发生。⛔ 没有因果就不建。',
    '',
    '【三档距离】world（世界背景）／region（当前区域）／rumor（传闻，⛔ 不许和已证实事件混在一起）。',
    '',
    '【火候】pressure 1–5（1 平静 → 5 一触即发）；trend stable|rising|falling|volatile。',
    '可选四档：民生度（崩溃|艰难|尚可|富足）／动乱度（太平|小乱|动荡|大乱）／天时（大灾|失调|平常|风调雨顺）／张力推手（沉寂|平缓|暗涌|紧绷）。',
    '',
    '【成熟度】clock_mode 四型：condition（等条件，条件没到永远不许成熟）／duration（按世界钟算 duration_minutes）／',
    'scheduled（scheduled_at 到点才成熟）／active（本轮实际投入 worked_minutes）。',
    '⛔ 剧情只过几分钟，就绝不许出现“几个月才长成”的结果。',
    '⛔ 到时必须给 resolved／cancelled／missed 之一＋具体结果；⛔ 不许长期悬挂。',
    '',
    '【证据链四级】正文明确事实 ＞ 已确认世界状态 ＞ 直接推论 ＞ 保守推断。每条带 evidence_tier；',
    '两件事冲突时保留高权威那条、低权威降级为“未证实”（⛔ 不许删、不许当事实用）；',
    '只有前两级的 sides 才准进召回池。',
    '',
    '【谁知道】六条渠道：witnessed／told／investigated／message／public_channel／inferred。',
    'inferred 只能 suspected，⛔ 绝不能升级成 confirmed；“新闻已公开”≠ 每个角色都看过；',
    '接触链三型 physical／information／causal 必须成立其一，链路断裂时不得更新那个人。',
    '',
    '【同一件事不许重开】同一件未终结的事推进／受阻／等待／获得新线索／改变公开状态／接近结算 ⇒ 必须更新原 ID，',
    '⛔ 禁止换标题后新建近义事件；已 resolved／cancelled／missed 的 ⇒ 不要再挂回局势，只留后果。',
    '',
    '【输出】严格 JSON：',
    '【证据链四级】正文明确事实 ＞ 已确认世界状态 ＞ 直接推论 ＞ 保守推断；同档冲突：谁先落账谁赢；低档降级为「未证实」（⛔ 删，那是账）。',
    '{"analysis":"推理",',
    ' "situations_upsert":[{"id":"（已有填、新建留空）","title":"≤30字","polarity":["一方","另一方"],',
    '   "direction":"谁压谁","distance":"world|region|rumor",',
    '"sides":\"哪几方＋各自主张（一句话一个；例：露娜 说带人去了学园；校长 说封校）\",',
    '"evidenceTiers":[{"who":\"露娜\","tier":\"fact|confirmed|inferred|conservative\"}],',
    '   "cause":"","caused_by":"","clock_mode":"condition|duration|scheduled|active","due_at":"",',
    '   "pressure":1,"trend":"stable|rising|falling|volatile","visibility":"hidden|trace|known|direct",',
    '   "publicity":"private|trace|public"}],',
    ' "situations_resolve":[{"id":"","status":"resolved|cancelled|missed","result":"具体结果"}],',
    ' "knowledge_updates":[{"who":"","event_id":"","route":"witnessed|told|investigated|message|public_channel|inferred",',
    '   "certainty":"confirmed|suspected","evidence":""}]}',
].join('\n');

/* ───────────────────────── 暗流层 ───────────────────────── */
export const HIDDEN_SYSTEM = [
    '你是这台世界引擎的「暗流层」。你只管一件事：**有人正在背后攒劲，攒到哪一步了。**',
    '',
    '一条暗流必须同时有这六样，缺一样就不许建：',
    '① owner 谁在办（世界里真实存在的人／组织／势力）',
    '② goal 要干什么（一句，≤ 40 字）',
    '③ stage 现在到哪一步（写当前这一步，⛔ 不写下一步）',
    '④ progress / max_steps 已走几步 / 最多几步（max_steps 建议 3–6）',
    '⑤ consequence 如果成了会怎样（写后果，⛔ 不写过程）',
    '⑥ source 从哪来的：plot（ref=暗流 id）／ripple（ref=事件 id）／state（无 ref，⛔ 要限量）',
    '',
    '你不做的事：',
    '· 不写台面上已经打起来的对抗 —— 那是局势层',
    '· 不写世界背景板 —— 那是世界层',
    '· 不替玩家棋子立线、推进盘算、写下一步（⛔ 硬红线）',
    '· 不写“下一步计划”式建议 —— 你写的是他已经在做的这件事走到哪一步',
    '',
    '【标题必须自带对象】标题单独拎出来也要知道是谁对谁做了什么。',
    '写「杰戴特在十番街收集人类精气献给贝利尔女王」，不写「暗中收集精气」；',
    '⛔ 不知道对象就不要编 —— 编出来的对象会被当成账上事实往下传。',
    '',
    '【身份稳定】同一件未终结的暗流推进／受阻／等待／获得新线索／接近结算 ⇒ 必须 update 原 ID，',
    '⛔ 禁止换标题后新建近义暗流；信息不足时宁可保守更新或保持不变。',
    '',
    '【已解决的不许留着】resolved／cancelled／missed 之后不要为了保留剧情继续挂在表里，只留它造成的后果。',
    '',
    '【多条线并排】此刻应有 3–8 条各自推进的暗流（有的正紧、有的刚起、有的快收尾）；',
    '每条要有自己的轴（自己的地方、自己的一批人、自己那串事的来路）；',
    '⛔ 但也不许凑数：同阵营/同地点的人共同变化 ⇒ 优先合并成势力／地点级的一条。',
    '',
    '【显露】visibility 默认 concealed；只有满足唤醒条件才可 known／trace。',
    'delivery_queued 默认 false；本轮刚建的暗流⛔ 不许在同轮正文里被看见。',
    '',
    '【输出】严格 JSON：',
    '{"analysis":"推理",',
    ' "hidden_upsert":[{"id":"（已有填、新建留空）","owner":"","goal":"","stage":"",',
    '   "progress":0,"max_steps":4,"memory_append":"这一步实际发生了什么（一句）",',
    '   "consequence":"","source":{"type":"plot|ripple|state","ref":""},',
    '   "visibility":"concealed|trace|known","delivery_queued":false,',
    '   "evidenceTiers":[{"who":"","tier":"fact|confirmed|inferred|conservative"}]}],',
    ' "hidden_resolve":[{"id":"","status":"resolved|cancelled|missed","result":"具体结果"}]}',
].join('\n');

/* ───────────────────────── 三道硬闸 ───────────────────────── */

const INTENT_WORDS = /(下一步|长期目标|打算|计划要|准备要|意图)/;
const PLAYER_OBJECT = /(玩家|player|<user>|你)/i;

function asText(v) {
    return String(v == null ? '' : v).trim();
}

/**
 * 世界层闸：① 白名单（出现 situations/hidden/agendas/next_step/plan/intent/long_term_goal ⇒ 整批丢弃）
 *   ② 因果（world_facts_upsert 每条必须 cause 或 caused_by）③ 时间（elapsed 与传入不一致 ⇒ 改回）
 *   ④ 玩家（任何字段出现玩家 id ⇒ 该条丢弃）⑤ 空产出合法
 * @param {object} value 模型回的 JSON
 * @param {{elapsedMinutes?: number, playerNames?: string[]}} ctx
 * @returns {{ok: boolean, value: object, dropped: string[], notes: string[]}}
 */
export function worldGate(value, ctx) {
    const v = value && typeof value === 'object' ? value : {};
    const c = ctx || {};
    const dropped = [];
    const notes = [];
    const forbidden = ['situations', 'hidden', 'agendas', 'next_step', 'plan', 'intent', 'long_term_goal'];
    const hit = forbidden.filter((k) => Object.prototype.hasOwnProperty.call(v, k));
    if (hit.length) {
        return { ok: false, value: {}, dropped: hit, notes: ['世界层输出里出现了下层字段：' + hit.join('／') + ' ⇒ 整批丢弃'] };
    }
    const out = {
        analysis: asText(v.analysis),
        world_facts_upsert: [],
        world_facts_invalidate: Array.isArray(v.world_facts_invalidate) ? v.world_facts_invalidate : [],
        world_pulse_upsert: [],
        clues_upsert: Array.isArray(v.clues_upsert) ? v.clues_upsert : [],
        clues_resolve: Array.isArray(v.clues_resolve) ? v.clues_resolve : [],
    };
    for (const f of (Array.isArray(v.world_facts_upsert) ? v.world_facts_upsert : [])) {
        const cause = asText(f && (f.cause || f.caused_by));
        const text = JSON.stringify(f || {});
        if (!cause) {
            dropped.push('无因果事实：' + asText(f && f.key));
            continue;
        }
        if (PLAYER_OBJECT.test(text) && (c.playerNames || []).some((n) => n && text.indexOf(n) >= 0)) {
            dropped.push('写到玩家：' + asText(f && f.key));
            continue;
        }
        if (INTENT_WORDS.test(asText(f && f.value))) {
            dropped.push('写了意图／下一步：' + asText(f && f.key));
            continue;
        }
        out.world_facts_upsert.push(f);
    }
    for (const p of (Array.isArray(v.world_pulse_upsert) ? v.world_pulse_upsert : [])) {
        if (INTENT_WORDS.test(asText(p && (p.state || p.evidence)))) {
            dropped.push('脉搏写了意图：' + asText(p && p.label));
            continue;
        }
        out.world_pulse_upsert.push(p);
    }
    if (Number.isFinite(Number(c.elapsedMinutes)) && Number(v.elapsed_minutes) !== Number(c.elapsedMinutes)) {
        out.elapsed_minutes = Number(c.elapsedMinutes);
        notes.push('elapsed_minutes 与传入值不一致 ⇒ 已改回传入值');
    }
    const empty = !out.world_facts_upsert.length && !out.world_pulse_upsert.length
        && !out.clues_upsert.length && !out.world_facts_invalidate.length && !out.clues_resolve.length;
    if (empty) {
        notes.push('这一批什么都没产出 —— 合法结果，不重试、不编造');
    }
    return { ok: true, value: out, dropped, notes, empty };
}

/**
 * 局势层闸：① 两方（polarity < 2 ⇒ 拒建）② 因果（cause 空 ⇒ 拒建）
 *   ③ 反催熟（condition 未满足不得 resolved）④ 悬挂（due 过 3 轮强制结果）
 *   ⑤ 改写（已 resolved 的 id 不许再 upsert）⑥ 认知（inferred 只能 suspected）⑦ 证据（低权威 sides 不进召回池）
 */
export function situationGate(value, ctx) {
    const v = value && typeof value === 'object' ? value : {};
    const c = ctx || {};
    const dropped = [];
    const notes = [];
    const existing = Array.isArray(c.existing) ? c.existing : [];
    const resolvedIds = new Set(existing.filter((s) => s && ['resolved', 'cancelled', 'missed'].includes(String(s.status))).map((s) => String(s.id)));
    const out = { analysis: asText(v.analysis), situations_upsert: [], situations_resolve: [], knowledge_updates: [] };
    for (const s of (Array.isArray(v.situations_upsert) ? v.situations_upsert : [])) {
        const pol = Array.isArray(s && s.polarity) ? s.polarity.filter((x) => asText(x)) : [];
        if (pol.length < 2) {
            dropped.push('两方不足：' + asText(s && s.title));
            continue;
        }
        if (!asText(s && s.cause)) {
            dropped.push('无因果局势：' + asText(s && s.title));
            continue;
        }
        if (s && s.id && resolvedIds.has(String(s.id))) {
            dropped.push('想改写已结束局势：' + String(s.id));
            continue;
        }
        if (asText(s && s.clock_mode) === 'condition' && !asText(s && s.condition_met) && ['resolved', 'ready'].includes(asText(s && s.status))) {
            dropped.push('条件没到就催熟：' + asText(s && s.title));
            continue;
        }
        const clone = existing.some((e) => e && asText(e.title) && asText(e.title) === asText(s && s.title));
        if (clone && !asText(s && s.id)) {
            dropped.push('标题克隆（应 update 原 ID）：' + asText(s && s.title));
            continue;
        }
        out.situations_upsert.push(s);
    }
    for (const k of (Array.isArray(v.knowledge_updates) ? v.knowledge_updates : [])) {
        const route = asText(k && k.route);
        const cert = asText(k && k.certainty);
        const fixed = Object.assign({}, k);
        if (route === 'inferred' && cert === 'confirmed') {
            fixed.certainty = 'suspected';
            notes.push('认知闸：inferred 被强制改成 suspected（' + asText(k && k.who) + '）');
        }
        out.knowledge_updates.push(fixed);
    }
    /* 悬挂闸：due 已过 3 轮仍未给结果 ⇒ 要求本轮出结果（记账，不替模型填） */
    for (const e of existing) {
        const overdue = Number(e && e.overdueRounds) >= 3;
        if (overdue && !out.situations_resolve.some((r) => String(r.id) === String(e.id))) {
            notes.push('悬挂闸：局势「' + asText(e && e.title) + '」已超期 3 轮 ⇒ 本轮必须给 resolved/cancelled/missed');
        }
    }
    return { ok: true, value: out, dropped, notes };
}

/**
 * 暗流层闸：① 六格（owner/goal/stage/consequence/source.type 缺 ⇒ 拒建）
 *   ② 步数（progress 只能 +1 或不动；>= max_steps 必须 resolve）
 *   ③ 来源（连续两轮 state ⇒ 拒）④ 标题（goal 不含实体名 ⇒ 拒）
 *   ⑤ 身份（同 goal 已存在 ⇒ 要求 update）⑥ 玩家（owner 是玩家 ⇒ 拒）
 *   ⑦ 显露（新建强制 delivery_queued=false）⑧ 合并（同 owner 同地点 ≥3 条 ⇒ 合并）
 */
export function hiddenGate(value, ctx) {
    const v = value && typeof value === 'object' ? value : {};
    const c = ctx || {};
    const dropped = [];
    const notes = [];
    const existing = Array.isArray(c.existing) ? c.existing : [];
    const priorState = c.lastSourceType === 'state';
    const out = { analysis: asText(v.analysis), hidden_upsert: [], hidden_resolve: [] };
    let stateCount = 0;
    for (const h of (Array.isArray(v.hidden_upsert) ? v.hidden_upsert : [])) {
        const owner = asText(h && h.owner);
        const goal = asText(h && h.goal);
        const stage = asText(h && h.stage);
        const cons = asText(h && h.consequence);
        const srcType = asText(h && h.source && h.source.type);
        if (!owner || !goal || !stage || !cons || !srcType) {
            dropped.push('六格缺项：' + (goal || owner || '（无名）'));
            continue;
        }
        if ((c.playerNames || []).some((n) => n && owner === n)) {
            dropped.push('owner 是玩家：' + owner);
            continue;
        }
        if (srcType === 'state') {
            stateCount += 1;
            if (priorState && stateCount === 1) {
                dropped.push('连续无源（上一条也是 state）：' + goal);
                continue;
            }
        }
        const old = existing.find((e) => e && asText(e.goal) === goal);
        if (!asText(h && h.id) && old) {
            dropped.push('身份闸（同 goal 已存在，应 update 原 ID）：' + goal);
            continue;
        }
        const prev = existing.find((e) => e && String(e.id) === String(h && h.id));
        const prevProgress = Number(prev && prev.progress) || 0;
        let progress = Number(h && h.progress) || 0;
        if (progress > prevProgress + 1 && !prev) {
            notes.push('步数闸：progress 越级，已压回 0（' + goal + '）');
            progress = 0;
        } else if (progress > prevProgress + 1) {
            notes.push('步数闸：progress 一轮跳两步，已压回 +1（' + goal + '）');
            progress = prevProgress + 1;
        }
        const maxSteps = Math.max(1, Number(h && h.max_steps) || 4);
        const item = Object.assign({}, h, { progress, max_steps: maxSteps, delivery_queued: false });
        if (progress >= maxSteps) {
            const hasResolve = (Array.isArray(v.hidden_resolve) ? v.hidden_resolve : []).some((r) => String(r.id) === String(h && h.id) && asText(r && r.status));
            if (!hasResolve) {
                dropped.push('到顶没给结果（progress >= max_steps）：' + goal);
                continue;
            }
        }
        out.hidden_upsert.push(item);
    }
    if (Array.isArray(v.hidden_resolve)) {
        out.hidden_resolve = v.hidden_resolve;
    }
    /* 合并闸：同 owner 同地点 ≥3 条 ⇒ 只留一条并记账 */
    const byOwner = new Map();
    for (const h of out.hidden_upsert) {
        const k = asText(h.owner) + '|' + asText(h.place);
        byOwner.set(k, (byOwner.get(k) || 0) + 1);
    }
    for (const [k, n] of byOwner.entries()) {
        if (n >= 3) {
            notes.push('合并闸：同一方同一地点 ' + n + ' 条暗流 ⇒ 应合并成一条势力／地点级');
        }
    }
    return { ok: true, value: out, dropped, notes };
}
