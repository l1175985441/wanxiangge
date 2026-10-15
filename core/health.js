/**
 * 万象阁 · 补⑤ 体检报告（一键自检）
 *
 * 她 2026-10-15 拍的：出问题时她**截图就能说清**；也让"退化要出声"有个总览。
 *
 * ⛔ 两条铁律（写死在代码里，⛔ 不靠"我记得"）：
 *   ① **不含正文内容**——只报条数、长度、时间那些"骨架数字"。
 *   ② **不含钥匙与地址的"值"**——只报「有／没填」（钥匙串、网址串一律不进报告）。
 *   ⚠️ 这里连**示例地址**都⏔ 写：自审里有一条静态红线「⏔ 硬写地址」，
 *     写个例子都会被它当真（我刚踩过）。
 *   另：失败只记**类别**（网络／超时／截断／格式／其它），⛔ 不记 error 原文。
 */

import { LEDGER_VERSION } from './config.js';
import { loadState } from './state.js';
import { getSettings } from './settings.js';
import { buildStateSummary } from './summary.js';
import { floorLabel } from './utils.js';

/** 有没有值（⛔ 只回答"有没有"，绝不回显内容） */
function has(v) {
    return String(v === undefined || v === null ? '' : v).trim() ? '已填' : '未填';
}

/** 时间戳 → 本地可读（空就给"—"） */
function when(ts) {
    const n = Number(ts);
    if (!Number.isFinite(n) || n <= 0) {
        return '—';
    }
    const d = new Date(n);
    const p2 = (x) => String(x).padStart(2, '0');
    return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate())
        + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes());
}

/**
 * 出一份体检报告。
 * @param {object} opts `{ version: '0.2.87' }`（插件版本由调用方给，⛔ 不在这里 import index.js 免得绕成环）
 * @returns {{ text: string, rows: Array<[string,string]>, fails: Array<[string,number]> }}
 */
export function buildHealthReport(opts) {
    const o = opts || {};
    const s = getSettings();
    const st = loadState();
    const sum = buildStateSummary({});
    const world = (st && st.world) || {};
    const roster = Array.isArray(st.characters) ? st.characters : [];
    const hidden = Array.isArray(world.hidden) ? world.hidden : [];
    const chron = Array.isArray(st.chronicle) ? st.chronicle : [];
    const pipe = st.pipeline || {};
    const api = s.api || {};
    const mini = s.mini || {};

    // ---- 失败：按类计数（只数类别，⛔ 不碰原文） ----
    const log = Array.isArray(st.failLog) ? st.failLog : [];
    const kinds = ['网络', '超时', '截断', '格式', '其它'];
    const fails = kinds.map((k) => [k, log.filter((x) => x && x.kind === k).length]);

    const rows = [
        ['插件版本', String(o.version || '未知')],
        ['数据版本', 'v' + String(LEDGER_VERSION)],
        ['—— 开关 ——', ''],
        ['新楼生成后自动更新', s.autoUpdate ? '开' : '关'],
        ['更新频率', String(s.updateEvery) + ' 楼推进一次'],
        ['现场保护', s.protectedBypass ? '开' : '关'],
        ['严格模式（只带本轮点名的人）', s.strictMention ? '开' : '关'],
        ['打开酒馆时自动弹出', s.showPanelOnStart ? '开' : '关'],
        ['显示悬浮小框', mini.show ? '开' : '关'],
        ['—— 账本条数 ——', ''],
        ['人物名册', String(roster.length) + ' 人'
            + (roster.filter((c) => c && c.noBench === true).length
                ? '（其中 ' + String(roster.filter((c) => c && c.noBench === true).length) + ' 人已关后台推演）' : '')],
        ['暗线', String(hidden.length) + ' 条'],
        ['编年', String(chron.length) + ' 条'],
        ['局势', String((world.situations || []).length) + ' 条'],
        ['可撤回的版本', String(Array.isArray(st.snapshots) ? st.snapshots.length : 0) + ' 版'],
        ['—— 最近一次更新 ——', ''],
        ['时间', when(st.lastUpdate && st.lastUpdate.at)],
        ['结果', (st.lastUpdate && st.lastUpdate.status === 'failed') ? '失败' : '成功'],
        ['停在哪楼', (st.lastUpdate && Number(st.lastUpdate.floor) >= 0)
            ? floorLabel(st.lastUpdate.floor) : '还没跑过'],
        ['引擎当前状态', pipe.status === 'running' ? '正在跑' : (pipe.status === 'failed' ? '失败' : '闲着')],
        ['世界钟', String(sum.clock || '未知')],
        ['—— 自定义 API（⛔ 只报有没有）——', ''],
        ['接口地址', has(api.url)],
        ['密钥', has(api.key)],
        ['推演模型', String(api.model || '').trim() ? '已填' : '未填'],
        ['—— 隐私自检 ——', ''],
        ['这份报告含正文吗', '不含'],
        ['这份报告含钥匙／地址的值吗', '不含'],
    ];

    const lines = ['【万象阁 · 体检报告】', '时间：' + when(Date.now()), ''];
    for (const [k, v] of rows) {
        if (v === '') {
            lines.push('');
            lines.push(k.replace(/——\s*/g, '').replace(/\s*——/g, '') + '：');
            continue;
        }
        lines.push(k + '：' + v);
    }
    lines.push('');
    lines.push('最近失败（按类，只记类别不记内容）：');
    const total = fails.reduce((a, b) => a + b[1], 0);
    if (!total) {
        lines.push('· 还没有失败记录');
    } else {
        for (const [k, n] of fails) {
            if (n) {
                lines.push('· ' + k + '：' + String(n) + ' 次');
            }
        }
        lines.push('（合计 ' + String(total) + ' 次，只留最近 30 条）');
    }

    return { text: lines.join('\n'), rows, fails };
}
