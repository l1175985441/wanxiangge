/**
 * 万象阁 · 三层执行器（98 号）
 *
 * 五份提示词里的中间三份，各自**独立调用**、各自独立输出 schema、各自硬闸：
 *   runWorldLayer()      ← WORLD_SYSTEM
 *   runSituationLayer()  ← SITUATION_SYSTEM
 *   runHiddenLayer()     ← HIDDEN_SYSTEM
 *
 * 单向：世界 → 局势 → 暗流。下层读上层；上层⛔ 一个字都不读下层。
 * 三个函数互不共享 prompt 字符串，也⛔ 不用 if 换段落（那是“合成一份”的变种）。
 */

import { callModelJson } from './apiclient.js';
import { loadState, saveState, updateWorld } from './state.js';
import {
    WORLD_SYSTEM, SITUATION_SYSTEM, HIDDEN_SYSTEM,
    worldGate, situationGate, hiddenGate,
} from './prompts-layers.js';
import { CHRONICLE_SYSTEM } from './prompts-chronicle.js';   /* 99：第六份提示词 */
import { syncMemories, ensureMilestones } from './chronicle-brief.js';
import { upsertClue, advanceClue, addEcho, upsertOpinion } from './extra-ledgers.js';
import { getSettings } from './settings.js';
import { trimText, matchKey } from './utils.js';

function stNow() { return loadState(); }

function playerNames() {
    try {
        const st = loadState();
        return (st.characters || []).filter((c) => c && c.isPlayer).map((c) => trimText(c.name)).filter(Boolean);
    } catch (e) {
        return [];
    }
}

function rosterBrief() {
    try {
        const st = loadState();
        return (st.characters || [])
            .filter((c) => c && !c.ignored)
            .slice(0, 40)
            .map((c) => trimText(c.name) + '｜' + (trimText(c.timePlace) || '未知') + '｜' + (trimText(c.current) || '暂无'))
            .join('\n');
    } catch (e) {
        return '';
    }
}

function worldBrief() {
    try {
        const w = (loadState().world) || {};
        const facs = Array.isArray(w.factions) ? w.factions.map((f) => trimText(f && f.name)).filter(Boolean).join('、') : '';
        const sits = Array.isArray(w.situations) ? w.situations.slice(0, 12).map((s) => '· ' + trimText(s && s.title)).join('\n') : '';
        return '世界钟：' + (trimText(w.clock) || '未知') + '\n地点：' + (trimText(w.place) || '未知')
            + '\n势力：' + (facs || '无') + '\n现有局势：\n' + (sits || '（无）');
    } catch (e) {
        return '';
    }
}

function hiddenBrief() {
    try {
        const w = (loadState().world) || {};
        return (Array.isArray(w.hidden) ? w.hidden : []).slice(0, 12)
            .map((h) => '· ' + trimText(h && h.name) + '：' + (trimText(h && h.stage) || '萌芽') + '（' + (trimText(h && h.goal) || '目标未记') + '）')
            .join('\n');
    } catch (e) {
        return '';
    }
}

/** 世界层（⛔ 不读 situations／hidden） */
export async function runWorldLayer(material, opts) {
    const el = Number(opts && opts.elapsedMinutes);
    const res = await callModelJson({
        system: WORLD_SYSTEM,
        prompt: '世界钟：' + (trimText(material && material.clock) || '未知') + '\n'
            + '最近正文：\n' + String((material && material.rawText) || '').slice(0, 6000) + '\n\n'
            + '人物（只读名字｜在哪｜在做什么）：\n' + rosterBrief(),
        cheap: true,
    });
    if (!res || !res.ok) {
        return { ok: false, reason: (res && res.reason) || '世界层没回可用 JSON' };
    }
    const g = worldGate(res.value, { elapsedMinutes: el, playerNames: playerNames() });
    if (!g.ok) {
        return { ok: false, reason: (g.notes || []).join('；') || '世界层输出被白名单闸整批丢弃' };
    }
    try {
        const w = loadState().world || {};
        const facts = Array.isArray(w.facts) ? w.facts.slice() : [];
        const seen = new Set(facts.map((f) => matchKey(f && f.key)));
        for (const f of g.value.world_facts_upsert) {
            const k = trimText(f && f.key);
            if (k && !seen.has(matchKey(k))) {
                facts.push(f);
                seen.add(matchKey(k));
            }
        }
        updateWorld({ facts: facts.slice(0, 160) });
        saveState();
        /* 101：世界层产出的线索（人物步不许写知识面） */
        for (const c of (g.value.clues_upsert || [])) {
            upsertClue(stNow(), c);
        }
        for (const r of (g.value.clues_resolve || [])) {
            const tgt = String((r && r.status) || '') === 'discarded' ? 'discarded' : 'resolved';
            advanceClue(stNow(), r && r.id, tgt, Date.now());
        }
        saveState();
    } catch (eW) { /* 落不了也不能炸主流程 */ }
    return { ok: true, dropped: g.dropped, notes: g.notes, empty: g.empty };
}

/** 局势层（读世界 ✅，⛔ 不读 hidden） */
export async function runSituationLayer(material) {
    const res = await callModelJson({
        system: SITUATION_SYSTEM,
        prompt: worldBrief() + '\n\n人物（名字｜在哪｜在做什么）：\n' + rosterBrief()
            + '\n\n最近正文：\n' + String((material && material.rawText) || '').slice(0, 6000),
        cheap: true,
    });
    if (!res || !res.ok) {
        return { ok: false, reason: (res && res.reason) || '局势层没回可用 JSON' };
    }
    const st = loadState();
    const g = situationGate(res.value, {
        existing: (st.world && st.world.situations) || [],
        playerNames: playerNames(),
    });
    try {
        const before = (loadState().world && loadState().world.situations) || [];
        const byTitle = new Map(before.map((s) => [matchKey(s && s.title), s]));
        for (const s of g.value.situations_upsert) {
            const k = matchKey(s && s.title);
            if (!k) { continue; }
            if (!byTitle.has(k)) {
                before.push({ title: trimText(s.title), sides: trimText(s.sides), pressure: Number(s.pressure) || 1, source: 'layer' });
                byTitle.set(k, true);
            }
        }
        updateWorld({ situations: before });
        for (const r of (g.value.situations_resolve || [])) {
            const org = before.find((x) => x && (String(x.id) === String(r && r.id) || x.title === String(r && r.title)));
            if (org && (r.status === 'resolved' || r.status === 'missed' || r.status === 'cancelled')) {
                addEcho(loadState(), { eventId: String(org.id || org.title), text: String(r.result || org.title || ''), resolved: true, fromFloor: Number(org.floor) || 0 });
            }
        }
        /* 舆情：只收 publicity=public 的局势 */
        for (const s of before) {
            if (s && String(s.publicity) === 'public') {
                upsertOpinion(loadState(), { topic: String(s.title || ''), publicity: 'public', heat: Number(s.pressure) || 1, fromFloor: Number(s.floor) || 0 });
            }
        }
        saveState();
    } catch (eS) { /* 同上 */ }
    return { ok: true, dropped: g.dropped, notes: g.notes };
}

/** 暗流层（读世界＋局势 ✅，⛔ 不写 situations） */
export async function runHiddenLayer(material) {
    const res = await callModelJson({
        system: HIDDEN_SYSTEM,
        prompt: worldBrief() + '\n\n现有暗流：\n' + (hiddenBrief() || '（无）')
            + '\n\n人物（名字｜在哪｜在做什么）：\n' + rosterBrief()
            + '\n\n最近正文：\n' + String((material && material.rawText) || '').slice(0, 6000),
        cheap: true,
    });
    if (!res || !res.ok) {
        return { ok: false, reason: (res && res.reason) || '暗流层没回可用 JSON' };
    }
    const st = loadState();
    const g = hiddenGate(res.value, {
        existing: (st.world && st.world.hidden) || [],
        playerNames: playerNames(),
    });
    try {
        const w = loadState().world || {};
        const hidden = Array.isArray(w.hidden) ? w.hidden.slice() : [];
        const seen = new Set(hidden.map((h) => matchKey(h && h.name)));
        for (const h of g.value.hidden_upsert) {
            const k = matchKey(h && h.owner) + '|' + matchKey(h && h.goal);
            if (!seen.has(k)) {
                hidden.push({ name: trimText(h.owner) + '·' + trimText(h.goal), stage: trimText(h.stage), goal: trimText(h.goal), progress: h.progress, maxSteps: h.max_steps, consequence: trimText(h.consequence), deliveryQueued: false });
                seen.add(k);
            }
        }
        updateWorld({ hidden });
        saveState();
    } catch (eH) { /* 同上 */ }
    return { ok: true, dropped: g.dropped, notes: g.notes };
}

/**
 * 三层顺序跑（单向）：世界 → 局势 → 暗流。
 * 开关：settings.layerPrompts === true 才跑（默认关，避免无声多烧 API）。
 */
export async function runLayers(material) {
    const on = getSettings().layerPrompts === true;
    if (!on) {
        return { ok: true, skipped: true, reason: '三层提示词开关未开（settings.layerPrompts）' };
    }
    const out = {};
    try { out.world = await runWorldLayer(material, {}); } catch (e1) { out.world = { ok: false, reason: String(e1) }; }
    try { out.situation = await runSituationLayer(material); } catch (e2) { out.situation = { ok: false, reason: String(e2) }; }
    try { out.hidden = await runHiddenLayer(material); } catch (e3) { out.hidden = { ok: false, reason: String(e3) }; }
    try { out.chronicle = await runChronicleLayer(material); } catch (e4) { out.chronicle = { ok: false, reason: String(e4) }; }
    return { ok: true, layers: out };
}

/** 编年层（第六份提示词）：只往回看；写 chronicle，同步出 memories，归类三层 */
export async function runChronicleLayer(material) {
    const res = await callModelJson({
        system: CHRONICLE_SYSTEM,
        prompt: '本轮正文：\n' + String((material && material.rawText) || '').slice(0, 6000)
            + '\n\n现有编年（最近 12 条）：\n'
            + ((loadState().chronicle || []).slice(-12).map((c) => '· ' + String((c && (c.text || c.line)) || '')).join('\n') || '（无）'),
        cheap: true,
    });
    if (!res || !res.ok) {
        return { ok: false, reason: (res && res.reason) || '编年层没回可用 JSON' };
    }
    const v = res.value || {};
    const st = loadState();
    st.chronicle = Array.isArray(st.chronicle) ? st.chronicle : [];
    for (const row of (Array.isArray(v.chronicle_append) ? v.chronicle_append : [])) {
        const line = String((row && (row.line || row.text)) || '').trim();
        if (line) {
            st.chronicle.push({ text: line, floor: Number(row && row.floor) || 0, at: Date.now() });
        }
    }
    ensureMilestones(st);
    for (const ms of (Array.isArray(v.milestones_upsert) ? v.milestones_upsert : [])) {
        const tier = String((ms && ms.tier) || '').trim();
        if (tier && Array.isArray(st.milestones[tier])) {
            st.milestones[tier].push({ title: String(ms.title || ''), text: String(ms.text || ''), fromFloor: Number(ms.fromFloor) || 0 });
        }
    }
    saveState();
    const sync = syncMemories(st, { limit: Number(getSettings().chronicleCap) || 500 });
    saveState();
    return { ok: true, appended: (v.chronicle_append || []).length, memories: sync.added };
}
