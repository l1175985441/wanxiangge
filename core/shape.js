/**
 * 万象阁 · 形状收口（阿砚第三批 硬-1 · 选的 ②「旧形永远合法 ＋ 幂等收口」）
 *
 * 依据（他拍板，2026-10-24）：
 *   · 结构只到 v3、两次演进只产出一个迁移函数 ⇒ 写逐版本迁移链等于写两个空壳（正是硬-4 要抓的“看着有其实没接上”）
 *   · 我们一直**是加字段、不是改语义** ⇒ 旧形本来就能活，缺的是“别删”不是“搬”
 *   · 只有她一本账，没有多人多版本并存的压力 ⇒ 不需要确定性重放
 *
 * 三条必须一起成立（他点的洞）：
 *   1) 旧形准入：不认识的字段**保留**，⛔“读一次写一次当场永久删”
 *   2) 幂等收口 ＋ 漂移上报：洗过打标不再洗；这轮补了什么/改了什么类型都要报得出；
 *      洗不干净要能看出来（本轮补的条数 ≠ 上轮 ⇒ 不算收过，再来一次）
 *   3) 升级闸补一半：老包（v < 当前）导入时走收口并记 `migratedFrom`
 *
 * 这一层只改“形状”，⛔ 改业务语义、⛔ 删数据。
 */

import { LEDGER_VERSION } from './config.js';

/** 当前结构版本（与账本同源） */
export const SHAPE_VERSION = Number(LEDGER_VERSION) || 3;

/**
 * 收口规则：只声明“这条路径上应该是什么类型、缺了默认是什么”。
 * 加规则时只加行；⛔ 在这里写删除逻辑（删除属“迁移”，我们这条路线不做）。
 */
export const COLLAPSE_RULES = [
    { path: 'characters', type: 'array' },
    { path: 'chronicle', type: 'array' },
    { path: 'snapshots', type: 'array' },
    { path: 'events', type: 'array' },
    { path: 'recallRecords', type: 'array' },
    { path: 'world', type: 'object' },
    { path: 'world.situations', type: 'array' },
    { path: 'world.hidden', type: 'array' },
    { path: 'world.facts', type: 'array' },
    { path: 'world.winds', type: 'array' },
    { path: 'lastUpdate', type: 'object' },
    { path: 'pipeline', type: 'object' },
];

function getPath(obj, path) {
    const parts = String(path).split('.');
    let cur = obj;
    for (const p of parts) {
        if (cur == null || typeof cur !== 'object') { return undefined; }
        cur = cur[p];
    }
    return cur;
}

function setPath(obj, path, value) {
    const parts = String(path).split('.');
    let cur = obj;
    for (let i = 0; i < parts.length - 1; i += 1) {
        const p = parts[i];
        if (cur[p] == null || typeof cur[p] !== 'object') { cur[p] = {}; }
        cur = cur[p];
    }
    cur[parts[parts.length - 1]] = value;
}

/**
 * 幂等收口：把形状补齐/归正，**保留所有不认识的字段**。
 * @returns {{value:object, report:{at:number, version:number, scanned:number, filled:string[], retyped:string[], dropped:string[], changed:number}}}
 */
export function collapseShape(raw) {
    const value = (raw && typeof raw === 'object') ? raw : {};
    const filled = [];
    const retyped = [];
    for (const rule of COLLAPSE_RULES) {
        const cur = getPath(value, rule.path);
        const isEmpty = cur === undefined || cur === null;
        if (isEmpty) {
            setPath(value, rule.path, rule.type === 'array' ? [] : {});
            filled.push(rule.path);
            continue;
        }
        if (rule.type === 'array' && !Array.isArray(cur)) {
            /* 旧形可能是对象/字符串 ⇒ 包成一条，⛔ 丢掉 */
            setPath(value, rule.path, [cur]);
            retyped.push(rule.path);
        } else if (rule.type === 'object' && (typeof cur !== 'object' || Array.isArray(cur))) {
            setPath(value, rule.path, {});
            retyped.push(rule.path);
        }
    }
    const report = {
        at: Date.now(),
        version: SHAPE_VERSION,
        scanned: COLLAPSE_RULES.length,
        filled,
        retyped,
        dropped: [],           // 这条路线不做删除；字段留着由业务层决定读不读
        changed: filled.length + retyped.length,
    };
    value.shapeReport = report;
    if (value.migratedFrom === undefined) { value.migratedFrom = null; }
    return { value, report };
}

/**
 * 漂移判定（照观棋那条）：这轮“要补的”与账上报告的**不一样** ⇒ 不算收过，再收一次。
 * @returns {boolean}
 */
export function shouldRecollapse(prev, next) {
    if (!prev || typeof prev !== 'object') { return true; }
    if (!next || typeof next !== 'object') { return false; }
    const a = (prev.filled || []).length + (prev.retyped || []).length;
    const b = (next.filled || []).length + (next.retyped || []).length;
    if (a !== b) { return true; }
    /* 同一批问题反复出现也算没收干净（说明有上游每次都在破坏形状） */
    if (b > 0 && (next.at || 0) - (prev.at || 0) > 0 && (prev.version !== next.version)) { return true; }
    return false;
}

/** 记旧版本号（老包导入/旧账读入时用；⛔ 覆盖已有的更早记录） */
export function markMigratedFrom(state, fromVersion) {
    const v = Number(fromVersion);
    if (!state || !Number.isFinite(v) || v <= 0) { return state; }
    if (state.migratedFrom === undefined || state.migratedFrom === null) {
        state.migratedFrom = v;
    } else if (v < Number(state.migratedFrom)) {
        state.migratedFrom = v;   // 记住**最早**那一版
    }
    return state;
}

/** 给人看的一行（面板/诊断用） */
export function shapeLine(state) {
    const r = (state && state.shapeReport) || null;
    if (!r) { return '形状：还没收过'; }
    const bits = [];
    if ((r.filled || []).length) { bits.push('补 ' + String(r.filled.length) + ' 处'); }
    if ((r.retyped || []).length) { bits.push('归正 ' + String(r.retyped.length) + ' 处'); }
    return '形状 v' + String(r.version)
        + (bits.length ? '（' + bits.join('／') + '）' : '（本来就正）')
        + String((state && state.migratedFrom) ? ' · 从 v' + String(state.migratedFrom) + ' 升上来' : '');
}
