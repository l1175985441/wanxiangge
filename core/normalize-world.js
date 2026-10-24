/**
 * 万象阁 · 世界侧的归一化（阿砚 1-c #7／#2 的前置：把 state.js 里成族的函数搬出来）
 *
 * 为什么搬：`core/state.js` 已经贴着硬线（3045 行 / 硬 3000+），而 1-c #2「迁移即 schema」
 *   还要在 loadState/saveState 两端加 parse —— 不先腾地方，下一步就没处落脚。
 *
 * 这次只搬**依赖最少**的两个（都只用到 `trimText`），先验证“搬出去 + 在 state.js 里 re-export”
 *   这条路是通的；其余几个（normalizeFaction／normalizeWorldPulse 等）依赖 `makeId`／`worldFactKey`，
 *   等这一笔绿了再搬。
 */

import { trimText, matchKey, makeId } from './utils.js';

export function normalizeFactionPillars(raw) {
    const list = Array.isArray(raw) ? raw : (trimText(raw) ? [raw] : []);
    const out = [];
    for (const p of list) {
        const name = typeof p === 'string' ? trimText(p) : trimText(p && p.name);
        if (!name) continue;
        out.push(name.length > 4 ? name.slice(0, 4) : name);
        if (out.length >= 3) break;
    }
    return out;
}

export function normalizeWind(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const topic = trimText(src.topic || src.title || src.name);
    const text = trimText(src.text || src.content || src.note || src.rumor);
    if (!topic && !text) { return null; }
    let kind = String(trimText(src.kind || src.type) || 'rumor').toLowerCase();
    if (!WIND_KINDS.includes(kind)) { kind = 'rumor'; }
    /* 风声层＝未证实传闻：announcement 也只当「有人说有通报」级别，注入侧仍标风声 ⛔ 不当已证实新闻 */
    return {
        topic: topic || (text ? text.slice(0, 24) : ''),
        text: text || topic,
        kind,
        source: trimText(src.source) || 'engine',
        at: Number(src.at) || 0,
        floor: Number.isFinite(Number(src.floor)) ? Number(src.floor) : -1,
    };
}

export function worldFactKey(subject, field) {
    const s = matchKey(subject) || '世界';
    const f = matchKey(field);
    return f ? (s + '｜' + f) : '';
}

export function normalizeWorldFact(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const subject = trimText(src.subject) || '世界';
    const field = trimText(src.field);
    const value = trimText(src.value);
    const key = trimText(src.key) || worldFactKey(subject, field);
    if (!key || !value) {
        return null;
    }
    let source = trimText(src.source) || 'engine';
    if (!['engine', 'book', 'manual', 'narrative'].includes(source)) {
        source = 'engine';
    }
    return {
        key,
        subject,
        field: field || key,
        value,
        source,
        at: Number(src.at) || 0,
        floor: Number.isFinite(Number(src.floor)) ? Number(src.floor) : -1,
    };
}

/* ---- 脉动与可见度（连同它们用到的三个常量一起搬，避免跨文件引用） ---- */
const STRONG_PUBLIC_CUE = /公告|通报|报道|新闻|媒体|记者|电视台|广播|报纸|官方|政府|警方|消防|医院|学校|发布会|公开声明|新闻发布|公示|通知|预警|热搜|全城|全网|通缉/;
const TRACE_CUE = /传闻|风声|小道消息|有人看见|有人发现|路人|邻居|附近的人|外界察觉|可疑迹象|异常迹象|消息称|街边|人们都在议论/;
const VIS_OK = new Set(['public', 'trace', 'private']);

export function normalizePulseDomain(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const label = trimText(src.label || src.name || src.title);
    if (!label) { return null; }
    const kind = trimText(src.kind) || 'other';
    let trend = String(trimText(src.trend) || 'steady').toLowerCase();
    if (trend === 'stable' || trend === '持平') { trend = 'steady'; }
    if (trend === '上升' || trend === '升温') { trend = 'rising'; }
    if (trend === '下降' || trend === '降温') { trend = 'falling'; }
    if (!PULSE_TRENDS.has(trend)) { trend = 'steady'; }
    const pressureRaw = Number(src.pressure);
    const pressure = Number.isFinite(pressureRaw) ? Math.max(0, Math.min(5, pressureRaw)) : 0;
    const visibility = resolveVisibility(
        trimText(src.state) + ' ' + trimText(src.evidence),
        src.visibility,
    );
    return {
        id: trimText(src.id) || makeId('pulse'),
        label,
        kind,
        scope: trimText(src.scope),
        state: trimText(src.state || src.note || src.text),
        pressure,
        trend,
        visibility,
        evidence: trimText(src.evidence),
        at: Number(src.at) || 0,
        floor: Number.isFinite(Number(src.floor)) ? Number(src.floor) : -1,
    };
}

export function normalizePulseCoverageEntry(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const label = trimText(src.label || src.name);
    if (!label) { return null; }
    const kind = trimText(src.kind) || 'general';
    const scope = trimText(src.scope);
    return {
        id: trimText(src.id) || ('cov_' + matchKey(kind + ':' + label + ':' + scope)),
        label,
        kind,
        scope,
        lastCheckedAt: Number(src.lastCheckedAt) || 0,
        checks: Math.max(0, Number(src.checks) || 0),
        floor: Number.isFinite(Number(src.floor)) ? Number(src.floor) : -1,
    };
}

export function normalizeWorldPulse(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const covSrc = src.coverage && typeof src.coverage === 'object' ? src.coverage : {};
    const domains = [];
    const seenDom = new Set();
    for (const cand of (Array.isArray(src.domains) ? src.domains : [])) {
        const d = normalizePulseDomain(cand);
        if (!d) continue;
        const k = pulseDomainKey(d.label, d.kind);
        if (!k || seenDom.has(k)) continue;
        seenDom.add(k);
        domains.push(d);
        if (domains.length >= PULSE_DOMAINS_CAP) break;
    }
    const entries = [];
    const seenCov = new Set();
    for (const cand of (Array.isArray(covSrc.entries) ? covSrc.entries : [])) {
        const e = normalizePulseCoverageEntry(cand);
        if (!e) continue;
        if (seenCov.has(e.id)) continue;
        seenCov.add(e.id);
        entries.push(e);
        if (entries.length >= PULSE_COVERAGE_CAP) break;
    }
    entries.sort((a, b) => (Number(b.lastCheckedAt) || 0) - (Number(a.lastCheckedAt) || 0));
    return {
        lastSweepAt: Number(src.lastSweepAt) || 0,
        domains,
        coverage: {
            lastSweepAt: Number(covSrc.lastSweepAt) || 0,
            entries,
        },
    };
}

export function pulseDomainKey(label, kind) {
    const lb = matchKey(label);
    if (!lb) { return ''; }
    const kd = matchKey(kind) || 'other';
    return kd + ':' + lb;
}

export function resolveVisibility(text, visibilityHint) {
    const hint = String(trimText(visibilityHint) || '').toLowerCase();
    if (VIS_OK.has(hint)) {
        return hint;
    }
    /* 中文别名 */
    if (/^(公开|明)$/.test(hint)) { return 'public'; }
    if (/^(痕迹|半明|风声)$/.test(hint)) { return 'trace'; }
    if (/^(私|私域|暗)$/.test(hint)) { return 'private'; }
    const s = trimText(text);
    if (!s) { return 'private'; }
    if (STRONG_PUBLIC_CUE.test(s)) { return 'public'; }
    if (TRACE_CUE.test(s)) { return 'trace'; }
    return 'private';   /* 宁可私域 ✓ */
}

/* ---- 势力（连同两个枚举一起搬） ---- */
export const FACTION_STATUSES = Object.freeze(['鼎盛', '稳固', '倾轧', '困顿', '衰落', '瓦解']);
export const FACTION_RELATIONS = Object.freeze(['血盟', '盟友', '友好', '中立', '冷淡', '敌对', '世仇']);

export function normalizeFaction(f) {
    const src = f && typeof f === 'object' ? f : {};
    /*
     * 依据＝阿砚 3 件任务 · 渲染层 #2（数据层，比显示层更要紧）：
     *   旧：模型没写状态就被写成“稳固”、没写态度就被写成“中立” ⇒ **账上被永久造了一个假值**，
     *        她以后看到的“稳固”分不清是真推出来的还是填的。
     *   现在：没写就留空（不合法的也清成空）；“紧张”⇒“冷淡”是同义归一，保留。
     *   判据＝观棋「控件找不到就退让，不自己编一个值出来」（param-panel.js:22）
     */
    let status = trimText(src.status);
    if (status && !FACTION_STATUSES.includes(status)) { status = ''; }
    let relation = trimText(src.relation);
    if (relation === '紧张') { relation = '冷淡'; }
    if (relation && !FACTION_RELATIONS.includes(relation)) { relation = ''; }
    /*
     * ★ [580] B5：势力只认 scale（规模）；⛔ 不存 power／「实力」。
     *   模型若误把规模写进 power，且长得像规模词 ⇒ 挪进 scale；否则丢掉。
     */
    let scale = trimText(src.scale);
    const mistook = trimText(src.power);
    if (!scale && mistook && /巨型|庞大|巨大|大型|中型|小型|微型|规模|零散|个体/.test(mistook)) {
        scale = mistook;
    }
    return {
        id: trimText(src.id) || makeId('faction'),
        name: trimText(src.name),
        core_person: trimText(src.core_person),
        scale,
        note: trimText(src.note),
        status,
        relation,
        scope: trimText(src.scope),
        powerPillars: normalizeFactionPillars(src.powerPillars),
        at: Number(src.at) || 0,
        floor: Number.isFinite(Number(src.floor)) ? Number(src.floor) : -1,
    };
}
