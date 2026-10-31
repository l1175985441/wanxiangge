/**
 * 万象阁 · 人物状态表（好感）（阿砚第三批 新活 · 她 14:02 批、14:28 定数值）
 *
 * 她的话：10-25 04:16「不管出没出场，都能知道好感」→ 14:02「我觉得可以的。不错」→
 *   14:28「数值的话按照好感手机，然后更新按照好感手机更新。**自己不更新**。」
 *
 * 一句话口径：**表是 U 盘，不是计算器**（她 10-05 那张卡原文：「本后台变量仅作为存档U盘进行绝对同步与长线记忆，你不需要进行任何计算」）。
 *
 * 硬规矩（照单子逐条落实）：
 *   ① 存在**聊天级账本**里（`state.affinityTable`），⛔ 不放任何一楼的回复末尾（楼层会被隐藏，表不会）；
 *      ⛔ 也不放 `phone`（预设 `[9] 📜获取变量` 每轮把它清空）。
 *   ② 只有手机 `<status>` 的「好感指数」能写进来，**原封不动抄**（⛔ 换算、⛔ 补零、⛔ 四舍五入）；
 *      手机里没这个人 ⇒ **那行不动**；表里没这个人 ⇒ 建行，好感写 `未建立`、来源写 `从未出场`。
 *   ③ 自己**什么都不算**：⛔ 不推算、⛔ 不插值、⛔ 不衰减、⛔ 不按剧情估、⛔ 不加自己的上限判断。
 *   ④ 值域由手机/世界设定管（-100~100，可被世界书覆盖，初始值禁止为 0，一位小数）—— 我们只**抄**，不校验。
 */

/** 表里“还没有数”的两种占位（人话，⛔ 数值） */
export const AFFINITY_UNSET = '未建立';
export const SOURCE_NEVER = '从未出场';

/** 表长什么样：名字｜好感｜关系｜最后更新｜来源 */
export const COLUMNS = ['名字', '好感', '关系', '最后更新', '来源'];

/** 从一段文本里找出所有「好感指数：X」── 值**原样**取，不做任何数值处理 */
export function scanAffinityValues(text) {
    const s = String(text == null ? '' : text);
    const out = [];
    const re = /好感(?:指数|值)\s*[:：]\s*([+\-−]?\d+(?:\.\d+)?(?:\s*[%％])?)/g;
    let m = null;
    while ((m = re.exec(s))) {
        out.push({ raw: m[1].trim(), at: m.index });
    }
    return out;
}

/**
 * 从手机文本里配对「谁 → 多少好感」。
 * 配对规则（保守）：取「好感指数」之前、同一自然段内最近的一个**短行**当名字；
 * 找不到名字就**跳过这一条**（⛔ 猜一个人名塞进去）。
 * @returns {Array<{name:string, raw:string}>}
 */
export function extractAffinityPairs(text) {
    const raw = String(text == null ? '' : text);
    /* 129：只读《角色手机》的 <status> 块；没有块 ⇒ 一条都不抄 */
    const mBlock = /<status>([\s\S]*?)<\/status>/i.exec(raw) || /【角色手机】([\s\S]*?)(?=【|$)/.exec(raw);
    if (!mBlock) {
        return [];
    }
    const s = mBlock[1];
    const pairs = [];
    const re = /好感(?:指数|值)\s*[:：]\s*([+\-−]?\d+(?:\.\d+)?(?:\s*[%％])?)/g;
    let m = null;
    while ((m = re.exec(s))) {
        const before = s.slice(0, m.index);
        const cut = Math.max(before.lastIndexOf('\n\n'), before.lastIndexOf('\uff1b'), before.lastIndexOf(';'));
        const block = before.slice(cut + 1);
        const lines = block.split('\n').map((x) => x.trim()).filter(Boolean);
        let name = '';
        for (let i = lines.length - 1; i >= 0; i -= 1) {
            const ln = lines[i];
            const isHeader = /^[【<\[].*[】>\]]$/.test(ln) || /^(角色手机|status|char\d|SNS)/i.test(ln);
                if (ln.length > 0 && ln.length <= 24 && !isHeader && !/好感|指数|关系|状态|当前/.test(ln)) {
                name = ln.replace(/^[\-\*\u00b7\u2022\s]+/, '').replace(/[:：]$/, '');
                break;
            }
        }
        if (name) {
            pairs.push({ name, raw: m[1].trim() });
        }
    }
    return pairs;
}

/** 取表（没有就是空数组；⛔ 顺手造表） */
export function affinityTable(state) {
    const st = state || {};
    return Array.isArray(st.affinityTable) ? st.affinityTable : [];
}

/**
 * 按手机文本更新表。**只增/只改有数的行**，没提到的行一动不动。
 * @param {object} state 账本（会被就地修改）
 * @param {string} phoneText
 * @param {number} now
 * @returns {{added:number, updated:number, rows:Array}}
 */
export function syncFromPhone(state, phoneText, now) {
    const st = state;
    if (!st || typeof st !== 'object') {
        return { added: 0, updated: 0, rows: [] };
    }
    if (!Array.isArray(st.affinityTable)) {
        st.affinityTable = [];
    }
    const pairs = extractAffinityPairs(phoneText);
    let added = 0;
    let updated = 0;
    const stamp = Number(now) || Date.now();
    for (const pair of pairs) {
        const hit = st.affinityTable.find((r) => r && String(r.name) === pair.name);
        if (!hit) {
            /* 表里没这个人：建行，但**不编数值** */
            st.affinityTable.push({
                name: pair.name,
                affinity: pair.raw,
                relation: '',
                updatedAt: stamp,
                source: '手机',
            });
            added += 1;
            continue;
        }
        /* 手机里提到他 ⇒ 原封不动抄；⛔ 自己算、⛔ 自己夹范围 */
        hit.affinity = pair.raw;
        hit.updatedAt = stamp;
        hit.source = '手机';
        updated += 1;
    }
    return { added, updated, rows: st.affinityTable.slice() };
}

/** 表里登记一个人但还没数（她手动加人时用）：好感=未建立、来源=从未出场 */
export function ensureRow(state, name, now) {
    const st = state;
    if (!st || !String(name || '').trim()) {
        return null;
    }
    if (!Array.isArray(st.affinityTable)) {
        st.affinityTable = [];
    }
    const hit = st.affinityTable.find((r) => r && String(r.name) === String(name).trim());
    if (hit) {
        return hit;
    }
    const row = {
        name: String(name).trim(),
        affinity: AFFINITY_UNSET,
        relation: '',
        updatedAt: Number(now) || Date.now(),
        source: SOURCE_NEVER,
    };
    st.affinityTable.push(row);
    return row;
}

/** 一行：名字｜好感｜关系｜最后更新｜来源 */
export function rowLine(row) {
    const r = row || {};
    const t = Number(r.updatedAt);
    const stamp = t ? new Date(t).toISOString().slice(0, 10) : '—';
    return [r.name || '—', r.affinity == null || r.affinity === '' ? AFFINITY_UNSET : r.affinity,
        r.relation || '—', stamp, r.source || SOURCE_NEVER].join('｜');
}

/**
 * 进提示词用的表（**每层都发**，不管出没出场）。
 * @param {object} state
 * @param {number} maxChars 上限（默认 1500，验收要求 20 人 ≤ 1,500 字）
 */
export function affinityPromptBlock(state, maxChars) {
    const rows = affinityTable(state);
    if (!rows.length) {
        return '';
    }
    const cap = Number(maxChars) > 0 ? Number(maxChars) : 1500;
    const head = '【人物状态·好感】（只读，数值与你手机里的一致；没有数的写「' + AFFINITY_UNSET + '」）';
    const lines = [head];
    let used = head.length;
    for (const row of rows) {
        const line = '· ' + rowLine(row);
        if (used + line.length + 1 > cap) {
            lines.push('· …（还有 ' + String(rows.length - (lines.length - 1)) + ' 人未列出，篇幅所限）');
            break;
        }
        lines.push(line);
        used += line.length + 1;
    }
    return lines.join('\n');
}

/** 一行人话（诊断用） */
export function affinityLine(state) {
    const rows = affinityTable(state);
    const withNum = rows.filter((r) => r && r.affinity && r.affinity !== AFFINITY_UNSET).length;
    return '好感表：' + String(rows.length) + ' 人（有数 ' + String(withNum) + ' 人）';
}

/**
 * 95 号：**好感表块**——每层都进（不分前后台），一人一行约 60 字。
 *   她：「好感那几行每层都进 prompt（不管出没出场）；人物资料仍按前后台分」。
 *   ⛔ 不算、⛔ 不插值；表里是什么就写什么（没数 ⇒ 「未建立」）。
 * @param {object} state
 * @returns {string} 空字符串＝表里一个人都没有
 */
export function affinityTableBlock(state) {
    const rows = Array.isArray(state && state.affinityTable) ? state.affinityTable : [];
    if (!rows.length) {
        return '';
    }
    const lines = ['【好感表（只读：数值只能从手机抄，本表不算）】'];
    for (const r of rows) {
        const name = String((r && r.name) || '').trim();
        if (!name) {
            continue;
        }
        const val = String((r && r.affinity) || '').trim() || AFFINITY_UNSET;
        const at = Number(r && r.updatedAt);
        const when = Number.isFinite(at) && at > 0 ? ('最后更新 ' + new Date(at).toLocaleString('zh-CN', { hour12: false })) : '最后更新 ——';
        const src = String((r && r.source) || '').trim() || '从未出场';
        lines.push('· ' + name + ' ｜ 好感 ' + val + ' ｜ ' + when + ' ｜ ' + src);
    }
    return lines.length > 1 ? (lines.join('\n') + '\n') : '';
}
