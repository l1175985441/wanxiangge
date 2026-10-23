/**
 * 万象阁 · 补⑤ 体检报告（一键自检）
 *
 * 她 2026-10-15 拍的：出问题时她**截图就能说清**；也让"退化要出声"有个总览。
 *
 * ⛔ 两条铁律（写死在代码里，⛔ 不靠"我记得"）：
 *   ① **不含正文内容**——只报条数、长度、时间那些"骨架数字"。
 *   ② **不含钥匙与地址的"值"**——只报「有／没填」（钥匙串、网址串一律不进报告）。
 *   ⚠️ 这里连**示例地址**都⛔ 写：自审里有一条静态红线「⛔ 硬写地址」，
 *     写个例子都会被它当真（我刚踩过）。
 *   另：失败只记**类别**（网络／超时／截断／格式／其它），⛔ 不记 error 原文。
 */

// ⭐ L1：版本兜底用它（调用方不传 opts.version 时，不该报「未知」）
import { LEDGER_VERSION, APP_VERSION } from './config.js';
import { loadState } from './state.js';
import { getChat } from './adapter.js';
import { getSettings } from './settings.js';
import { buildStateSummary } from './summary.js';
import { floorLabel, trimText } from './utils.js';
// ⭐ 验收自检要用：四格清洗 + 在场判定（⛔ 这两个文件都不 import health，不会绕成环）
import { cleanMessages } from './extract.js';
import { mentionedCharacters } from './recall.js';
// ⭐ 体检要报"几组可并"（她 [18]「合并一键解决」）—— merge.js 只依赖 state/utils，⛔ 不会绕成环
import { autoDetectDuplicates } from './merge.js';

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
 * ⭐ 修复单 #4①：**结果**别虚报。
 *   原来写的是 `status === 'failed' ? '失败' : '成功'`——**只要不是 failed 就报"成功"**，
 *   于是"从没跑过"（idle）／"她中途取消"（cancelled）／状态缺失，全被报成**成功**。
 *   ⇒ 按真实状态分档；**认不出的状态如实说"未知"**（⛔ 不许替它说成功）。
 */
function resultText(lastUpdate, pipe) {
    const s = String((lastUpdate && lastUpdate.status) || '').trim();
    if (s === 'failed') {
        return '失败';
    }
    if (s === 'cancelled') {
        return '已取消';
    }
    if (s === 'ok') {
        return '成功';
    }
    /*
     * ⚠️ 真机抓到的不一致：这里只看持久化的 status ⇒ 一轮中途死了就**永远说“正在跑”** ✗
     *   而界面（v0.3.80 起）只认“本会话真的在跑”⇒ 两处**互相矛盾** ✗
     *   ⇒ 这里也认同一个内存标记（window.__wxgLiveRun ✓）：真在跑⇒“正在跑”；否则⇒“**上次没跑完**” ✓
     */
    if (String((pipe && pipe.status) || '').trim() === 'running') {
        const live = (typeof window !== 'undefined') && window.__wxgLiveRun;
        return live ? '正在跑' : '上次没跑完';
    }
    // ⭐ 复审追加 A5②：`pending`（刚发消息、AI 还没生成完）不能露英文
    if (s === 'pending') {
        return '待送';
    }
    if (!s || s === 'idle') {
        return '还没跑过';
    }
    return '未知（' + s + '）';
}

/**
 * ⭐ 修复单 #4②：**"停在哪楼"要过得硬的判据**。
 *   两个坑：
 *     · `Number(null)`／`Number('')` 都是 **0** ⇒ 老账里 floor 是 null/空串时会**虚报"停在 #0"**；
 *     · 只看 `lastUpdate.floor`、不看账里那份（`sum`）⇒ 跟界面别处口径不一致。
 *   ⇒ 先把"不是数"的掐掉，再退回 `sum.lastUpdate.floor`（那份带 atFloor 兜底）。
 */
function stopFloorText(lastUpdate, sum) {
    /* 依据＝第 7 问 D1 / 阿砚 49 号：sum 那边已改走 pipeline.atFloor；⏔ 先读原始 lastUpdate.floor（那是已处理水位） */
    const sumFloor = Number(sum && sum.lastUpdate && sum.lastUpdate.floor);
    if (Number.isFinite(sumFloor) && sumFloor >= 0) {
        return '第 ' + String(sumFloor) + ' 楼';
    }
    const raw = lastUpdate ? lastUpdate.floor : null;
    let n = -1;
    if (raw !== null && raw !== '' && raw !== undefined) {
        const v = Number(raw);
        if (Number.isFinite(v) && v >= 0) {
            n = v;
        }
    }
    if (n < 0) {
        const v2 = Number(sum && sum.lastUpdate && sum.lastUpdate.floor);
        if (Number.isFinite(v2) && v2 >= 0) {
            n = v2;
        }
    }
    return n >= 0 ? floorLabel(n) : '还没跑过';
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
        /* ⭐ L1：调用方没传就用自己的版本号（防御） */
        ['插件版本', String(o.version || APP_VERSION || '未知')],
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
        ['结果', resultText(st.lastUpdate, pipe)],
        ['停在哪楼', stopFloorText(st.lastUpdate, sum)],
        ['引擎当前状态', pipe.status === 'running'
            ? (((typeof window !== 'undefined') && window.__wxgLiveRun) ? '正在跑' : '上次没跑完')
            : (pipe.status === 'failed' ? '失败' : '闲着')],
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

    /*
     * ⭐⭐ 把她点名的那几条"真机复看"做成**体检里的一键自检**（点一下就能看，不用来问我）：
     *   · 好感到底读到没读到（她 [2]）
     *   · 名册里的别名／身份有没有落上（她 [18]：一人一条、身份带上）
     *   · 上一轮读到的正文多长（她那条卡把正文包在成对块里，读不到就什么都白搭）
     * ⚠️ 全部**同步**（这个函数是同步的、调用方也是同步的——⛔ 不许在这里 await，今晚踩过）
     * ⚠️ 全部 **try/catch**：体检本身绝不能被探针弄挂（否则本末倒置）
     */
    try {
        const st = loadState();
        const roster = Array.isArray(st.characters) ? st.characters : [];
        lines.push('');
        lines.push('【验收自检】（她点名要看的，点一下就有）');

        // ① 好感：从状态里已经读到的数值看（每回合 refreshAffinity 会写进来）
        try {
            /*
             * ⭐ 10-16 真机实测（她那台酒馆）：好感那格里**混着文字** ——
             *   「月野兔 = 未接入」「月野兔 = 本人」「杰戴特 = 敌对」⇒ 那不是数值，读不进注入。
             *   ⛔ 不擅自改她的数据；**把是文字的那几个点名报出来**，她自己定。
             */
            const withAff = roster.filter((c) => trimText(c.affinity));
            const numAff = withAff.filter((c) => /^-?\d+(\.\d+)?$/.test(trimText(c.affinity)));
            const txtAff = withAff.filter((c) => !/^-?\d+(\.\d+)?$/.test(trimText(c.affinity)));
            lines.push('· 好感：名册 ' + String(roster.length) + ' 人里，'
                + String(numAff.length) + ' 个是**数字**'
                + (numAff.length
                    ? '（例：' + numAff.slice(0, 4).map((c) => c.name + ' ' + trimText(c.affinity)).join('、') + '）'
                    : ' ⇒ ⚠ 一个数字都没有：看一下你那条「手机」里有没有 名字/数字，或「好感数据源」那格填没填'));
            if (txtAff.length) {
                lines.push('   ⚠ 另有 ' + String(txtAff.length) + ' 个格子里是**文字不是数字**（不是数值、进不了注入）：'
                    + txtAff.slice(0, 6).map((c) => c.name + ' = ' + trimText(c.affinity)).join('、')
                    + ' ⇒ 要么手工改成数字，要么让「手机」那条读一遍覆盖掉（⛔ 引擎不擅自改）');
            }
        } catch (e) {
            lines.push('· 好感：自检没跑成（' + String(e && e.message ? e.message : e) + '）');
        }

        // ② 名册：别名／身份落上没有（她 [18] 的"一人一条、身份带上"）
        try {
            const withAlias = roster.filter((c) => Array.isArray(c.aliases) && c.aliases.length);
            const withIdent = roster.filter((c) => trimText(c.identity));
            lines.push('· 名册：带别名 ' + String(withAlias.length) + ' 个、身份非空 ' + String(withIdent.length) + ' 个'
                + (withAlias.length
                    ? '（例：' + withAlias.slice(0, 3).map((c) => c.name + '=' + c.aliases.join('／')).join('、') + '）'
                    : ''));
            /*
             * ⭐ 10-16 真机取证：她名册里 **水手月亮/水手水星/… 被当独立人物**（旧账）⇒ 她 [18]：「同一角色被拆成两条记录？**合并一键解决**」。
             *   ⇒ 这里先让她**看见有几对**（形态名 ↔ 已在场的人）；⛔ 不自动并（那是她的账）。
             */
            const FORM = /^(?:水手[\u4e00-\u9fa5]{1,4}|夜礼服假面|.*假面|.*形态)$/;
            const forms = roster.filter((c) => FORM.test(trimText(c.name)));
            if (forms.length) {
                lines.push('   ⚠ 疑似"真身／形态"被拆成两个人物：' + String(forms.length) + ' 个（例：'
                    + forms.slice(0, 6).map((c) => c.name).join('、') + '）'
                    + ' ⇒ 点名册的「自动找重复」并掉，或手工作并（⛔ 引擎不替她并）');
            }
            /*
             * ⭐ 顺手把「现在能并几组」也算出来（她 [18]：合并一键解决）——
             *   ⛔ 只报数，⛔ 不自动并；她自己点按钮。
             */
            try {
                const groups = autoDetectDuplicates();
                if (Array.isArray(groups) && groups.length) {
                    const sample = groups.slice(0, 3)
                        .map((g) => (g && g.length ? g.map((x) => x.name).join('⇄') : ''))
                        .filter(Boolean);
                    lines.push('   ⭐ 现在点「自动找重复」能并出 ' + String(groups.length) + ' 组'
                        + (sample.length ? '（例：' + sample.join('；') + '）' : '') + ' ✓');
                } else {
                    lines.push('   ⭐ 现在没有可并的重复组 ✓');
                }
            } catch (e) {
                lines.push('   ⭐ 并组统计没跑成（' + String(e && e.message ? e.message : e) + '）');
            }
        } catch (e) {
            lines.push('· 名册：自检没跑成（' + String(e && e.message ? e.message : e) + '）');
        }

        // ③ 正文：上一轮引擎实际读到多少字（读不到＝引擎在瞎干）
        try {
            /*
             * ⚠️ 10-16 真机自查：我原来读的是 `st.ledger.records` —— **那儿没有记录** ⇒
             *   体检一直报"正文 0 字"，**是我的探针读错字段**（⛔ 不是她那边没跑）。
             *   记录实际在 **`state.recallRecords`**（`ledger.js:commitLedger` 用的就是它）。
             */
            const lg = Array.isArray(st.recallRecords) ? st.recallRecords.filter(Boolean) : [];
            let last = null;
            for (const r of lg) {           // 按"注入时刻"取最新（⛔ 不按数组顺序）
                if (!last || (Number(r.at) || 0) >= (Number(last.at) || 0)) {
                    last = r;
                }
            }
            if (!last) {
                lines.push('· 正文：还没有本回合记录（这一局还没跑过更新）');
            } else {
                /*
                 * ⭐ U2（材料 12·未覆盖死角）：**这里量的必须是 AI 正文** ✓
                 *   旧：`last.lead`（＝**她自己发的那句**，且根本没经过四格清洗 ✗）
                 *     ⇒ 只要她自己打字不到 200 字，体检就**永远谎报**“被四格剥太狠” ✗
                 *   现在：从聊天里取**最后一条非用户、非系统消息**的长度 ✓
                 */
                let n = 0;
                try {
                    const chatU2 = getChat() || [];
                    for (let iU2 = chatU2.length - 1; iU2 >= 0; iU2 -= 1) {
                        const mU2 = chatU2[iU2];
                        if (!mU2 || mU2.is_user || mU2.is_system) {
                            continue;
                        }
                        n = String(mU2.mes == null ? '' : mU2.mes).length;
                        break;
                    }
                } catch (eU2) {
                    n = 0;
                }
                const inj = Number(last.injectedChars) || 0;
                /*
                 * ⚠️ 真机上看到的：`from` 会把**整段 HTML 注释＋后面正文**都打出来（一行刷半屏）✗
                 *   ⇒ 只留"从哪条路来的"这一小截：先剥注释/标签，再压成一行、截 24 字。
                 */
                const src = String(last.from || '')
                    .replace(/<!--[\s\S]*?-->/g, ' ')
                    .replace(/<[^>]{1,80}>/g, ' ')
                    .replace(/\s+/g, ' ')
                    .trim()
                    .slice(0, 24);
                lines.push('· 正文：上一楼 AI 正文 ' + String(n) + ' 字，注入 ' + String(inj) + ' 字'
                    + (src ? '（来源：' + src + '）' : '')
                    + (n >= 200 ? ' ✓' : ' ⇒ ⚠ 上一楼 AI 正文偏少：可能被「四格」剥太狠，去读取控制看看'));
            }
        } catch (e) {
            lines.push('· 正文：自检没跑成（' + String(e && e.message ? e.message : e) + '）');
        }
    } catch (e) {
        lines.push('· 验收自检整体没跑成：' + String(e && e.message ? e.message : e));
    }

    /*
     * ⭐ 第四条：她 [5]/[7] 那条最在意的 —— **上一轮判了谁在场**（在场的只准总结正文有的；没露面的走推演）。
     *   同步算：走四格清洗得正文 ⇒ mentionedCharacters ⇒ 报出来。
     *   ⛔ 同样全 try/catch（体检绝不能被探针弄挂）。
     */
    try {
        const chat = (opts && Array.isArray(opts.chat)) ? opts.chat : [];
        const last = chat.length ? chat[chat.length - 1] : null;
        if (last) {
            const c = cleanMessages([{ mes: String(last.mes || ''), floor: chat.length - 1, is_user: !!last.is_user }]);
            const body = String(c.text || '');
            const roster2 = (loadState().characters || []);
            const on = mentionedCharacters(body, roster2).map((x) => x.name);
            lines.push('· 在场（上一楼）：' + (on.length ? (on.join('、') + '（' + String(on.length) + ' 人）') : '没认出名册里的人')
                + (c.fellBack ? ' ｜⚠ 正文被剥得太狠、已退回原文' : '')
                + ' —— 在场的只准总结正文有的；其余走推演（放行）');
        }
    } catch (e) {
        lines.push('· 在场：自检没跑成（' + String(e && e.message ? e.message : e) + '）');
    }

    /*
     * ⭐ 第五条：她 [18]/[3] 那条 —— **暗线有没有被判编造、判了几条**（只读状态，⛔ 不新引任何东西）。
     *   她原话：「编的。根本没有要我救」⇒ 被判过的那几条，在这里点名给她看。
     */
    try {
        const hid = (loadState().world && Array.isArray(loadState().world.hidden)) ? loadState().world.hidden : [];
        const bad = hid.filter((h) => h && h.suspect === true);
        lines.push('· 暗线：共 ' + String(hid.length) + ' 条'
            + (bad.length
                ? '，其中 **' + String(bad.length) + ' 条被判过编造**（例：' + bad.slice(0, 2).map((h) => h.name).join('、') + '）⇒ 这几条的"现状"不进注入，等你处理'
                : '，没被判过编造 ✓'));
    } catch (e) {
        lines.push('· 暗线：自检没跑成（' + String(e && e.message ? e.message : e) + '）');
    }

    return { text: lines.join('\n'), rows, fails };
}
