/**
 * 万象阁 · 编年简报（99 号）：编年（给她看） ⇄ 往事（喂模型）两本账
 *
 * 取观棋 `chronicle-brief.js` 的四条：
 *   ① 只搬不改写（编年一个字不改）
 *   ② 五类判据锚**行首**（⛔ 不许扫全行关键词——实测有 5 行因“理由里的词”误判）
 *   ③ 收场（OUTCOME）必须单列保住（结局只写在编年这一行里）
 *   ④ 机械记账（LEDGER）是唯一允许弃的类
 * 再取世界背面：`deliveryState=expired` 的条目进往事要标「未显露」。
 * 归类照工作流：正史／特异点／母题。
 */

/* 行首模板（只锚行首；⛔ 不许改成全文搜索） */
const RE_CAUSE = /^(?:\u4e8b\u4ef6|\u76d8\u7b97)?\s*\u300c[^\u300d]+\u300d\s*\u2014\u2014\s*(?:\u6cbf\u300c[^\u300d]+\u300d\u800c\u6765|\u7531\u76d8\u7b97\u300c[^\u300d]+\u300d\u800c\u751f|\u7531\u4e16\u754c\u5904\u5883\u800c\u751f)/;
const RE_STEP = /^盘算「[^」]+」\s*推进[：:]/;
/* 收场：取消/收场都要保住——注意“理由里出现规则词”不能影响判定，所以只认行首那半句 */
const RE_OUTCOME = /^(?:盘算「[^」]+」\s*(?:取消|终结|收场|落定)[（(][^）)]*[）)]?\s*[：:]|事件「[^」]+」\s*(?:这一段收场了|收场|结清)[：:])/;
/* 机械记账：唯一允许弃的一类 */
const RE_LEDGER = /^(?:盘算「[^」]+」\s*满步结算|事件「[^」]+」\s*(?:涟漪平息|闭环|结清入账)|入局[·・]离场|离场[·・]入局)/;

function asText(v) {
    return String(v == null ? '' : v).trim();
}

/**
 * 行首判定（判据 3：给她看的就是这几行）
 * @param {string} line
 * @returns {'cause'|'step'|'outcome'|'ledger'|'other'}
 */
export function classifyLine(line) {
    const s = asText(line);
    if (!s) {
        return 'other';
    }
    /* ⚠️ 判定只看行首模板：先 outcome（最不能丢），再 ledger，再 cause／step */
    if (RE_OUTCOME.test(s)) {
        return 'outcome';
    }
    if (RE_LEDGER.test(s)) {
        return 'ledger';
    }
    if (RE_CAUSE.test(s)) {
        return 'cause';
    }
    if (RE_STEP.test(s)) {
        return 'step';
    }
    return 'other';
}

/** 这一行要不要进往事（LEDGER 才弃；other 默认留） */
export function keepsInMemories(kind) {
    return kind !== 'ledger';
}

/**
 * 从编年里挑往事（判据 4：容量不够时先砍 LEDGER、再砍 OTHER，**⛔ 不许砍 outcome**）
 * @param {Array} chronicle 编年行（{line|text, floor, expired?}）
 * @param {{limit:number, hints?:string[]}} opts
 */
export function pickMemories(chronicle, opts) {
    const limit = Math.max(1, Number(opts && opts.limit) || 40);
    const hints = (Array.isArray(opts && opts.hints) ? opts.hints : []).map(asText).filter(Boolean);
    const rows = (Array.isArray(chronicle) ? chronicle : [])
        .map((r, i) => {
            const line = asText(r && (r.line || r.text));
            const kind = classifyLine(line);
            const floor = Number(r && r.floor);
            return { line, kind, floor: Number.isFinite(floor) ? floor : -1, expired: !!(r && r.expired), i };
        })
        .filter((r) => r.line && keepsInMemories(r.kind));
    const scored = rows.map((r) => {
        let score = 0;
        if (hints.some((h) => h && r.line.indexOf(h) >= 0)) {
            score += 5;
        }
        if (r.kind === 'outcome') {
            score += 3;
        }
        if (r.kind === 'cause') {
            score += 2;
        }
        if (r.expired) {
            score += 1;
        }
        return Object.assign(r, { score });
    });
    const order = { outcome: 0, cause: 1, step: 2, other: 3 };
    scored.sort((a, b) => (b.score - a.score)
        || ((order[a.kind] || 9) - (order[b.kind] || 9))
        || (b.i - a.i));
    /* 硬保：outcome 先占位；剩下按分补；LEDGER 根本不在 rows 里 */
    const picked = scored.slice(0, limit);
    const outcomeRows = scored.filter((r) => r.kind === 'outcome');
    const missing = outcomeRows.filter((r) => !picked.includes(r));
    if (missing.length) {
        /* 位置不够时，用 outcome 顶掉分数最低的非 outcome */
        for (const m of missing) {
            let worst = -1;
            for (let k = picked.length - 1; k >= 0; k -= 1) {
                if (picked[k].kind !== 'outcome') {
                    worst = k;
                    break;
                }
            }
            if (worst >= 0) {
                picked[worst] = m;
            } else {
                picked.push(m);
            }
        }
    }
    return picked;
}

/** 往事块（进注入；判据 7：expired 标「未显露」） */
export function memoryBlock(chronicle, opts) {
    const rows = pickMemories(chronicle, opts);
    if (!rows.length) {
        return '';
    }
    rows.sort((a, b) => a.floor - b.floor || a.i - b.i);
    const lines = ['【往事（编年里挑出来的；只有这些能当“之前发生过”）】'];
    for (const r of rows) {
        lines.push('· ' + r.line + (r.expired ? '（未显露）' : ''));
    }
    return lines.join('\n') + '\n';
}

/** 归类三层（正史／特异点／母题）——只往上提，不改写原行 */
export function ensureMilestones(state) {
    const st = state || {};
    const cur = st.milestones && typeof st.milestones === 'object' ? st.milestones : {};
    const out = { 正史: [], 特异点: [], 母题: [] };
    for (const k of Object.keys(out)) {
        out[k] = Array.isArray(cur[k]) ? cur[k] : [];
    }
    st.milestones = out;
    return out;
}

/** 把编年同步进 memories（两本账分开存；⛔ 不覆盖编年） */
export function syncMemories(state, opts) {
    const st = state || {};
    const chronicle = Array.isArray(st.chronicle) ? st.chronicle : [];
    const limit = Math.max(1, Number(opts && opts.limit) || 200);
    const exist = new Set((Array.isArray(st.memories) ? st.memories : []).map((m) => asText(m && (m.text || m.line))));
    const added = [];
    for (const r of chronicle) {
        const line = asText(r && (r.line || r.text));
        if (!line || exist.has(line)) {
            continue;
        }
        const kind = classifyLine(line);
        if (!keepsInMemories(kind)) {
            continue;
        }
        st.memories = Array.isArray(st.memories) ? st.memories : [];
        st.memories.push({ text: line, kind, floor: Number(r && r.floor) || 0, expired: !!(r && r.expired) });
        exist.add(line);
        added.push(line);
    }
    st.memories = (st.memories || []).slice(-limit);
    return { added: added.length };
}
