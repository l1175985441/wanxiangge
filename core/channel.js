/**
 * 万象阁 · 通道形态隔离（阿砚第三批 C 档 P1 · G3）
 *
 * 依据＝G3「通道形态隔离（宿主 API 被第三方污染 ⇒ 换一套 API）」；
 *   风险：请求体被别的扩展塞了料，而**搜代码永远搜不到**（不是我们写的）。
 *
 * 我们的两条通道（现读 apiclient）：
 *   · proxy  —— 经酒馆服务器转发 `/api/backends/chat-completions/generate`（酒馆形态）
 *   · direct —— 直连她填的地址（OpenAI 形态）
 *
 * 这一层做三件事（⛔ 不改请求内容、⛔ 不偷偷切通道）：
 *   1. `inspectBody(shape, body)` —— 按“我们自己会写哪些键”的清单查**多出来的键**（＝污染）
 *   2. `notePollution()`          —— 记一笔（同形态只留最近 5 条）
 *   3. `channelPlan(channel, streak)` —— 连续两次被污染 ⇒ 建议换另一条通道（明确说“建议”，
 *      真切换仍由她在面板上点，因为直连要她自己填地址/密钥）
 */

/** 两条通道的形态 */
export const CHANNELS = {
    proxy: {
        id: 'proxy',
        label: '经酒馆服务器转发',
        apiSet: '/api/backends/chat-completions/generate',
        /**
         * 我们自己会往请求体里写的键（白名单）。
         * 出现清单外的键 ⇒ 有别人在塞料（或我们升级时漏登记）。
         */
        ownKeys: [
            'chat_completion_source', 'model', 'messages', 'temperature', 'max_tokens',
            'max_completion_tokens', 'stream', 'custom_url', 'custom_include_body',
            'custom_exclude_body', 'custom_include_headers', 'reverse_proxy',
            'proxy_password', 'proxy_url', 'top_p', 'presence_penalty', 'frequency_penalty',
        ],
    },
    direct: {
        id: 'direct',
        label: '直连她填的地址',
        apiSet: '<custom>/chat/completions',
        ownKeys: [
            'model', 'messages', 'temperature', 'max_tokens', 'stream', 'top_p',
            'presence_penalty', 'frequency_penalty',
        ],
    },
};

const pollutionLog = [];

/** 这次请求体里有没有“不是我们写的键” */
export function inspectBody(shape, body) {
    const ch = CHANNELS[String(shape || '')];
    if (!ch) {
        return { ok: false, shape: String(shape || ''), extra: [], reason: '不认识的通道形态' };
    }
    const obj = (body && typeof body === 'object') ? body : {};
    const own = new Set(ch.ownKeys);
    const extra = Object.keys(obj).filter((k) => !own.has(k));
    return {
        ok: extra.length === 0,
        shape: ch.id,
        extra,
        reason: extra.length ? ('请求体里有 ' + String(extra.length) + ' 个不是我们写的键：' + extra.join('、')) : '',
    };
}

/** 记一次污染（同形态只留最近 5 条） */
export function notePollution(shape, extra) {
    const id = String(shape || '');
    if (!id) { return null; }
    const row = { shape: id, extra: (Array.isArray(extra) ? extra : []).slice(0, 20), at: Date.now() };
    pollutionLog.push(row);
    const same = pollutionLog.filter((x) => x.shape === id);
    while (same.length > 5) {
        const drop = same.shift();
        const i = pollutionLog.indexOf(drop);
        if (i >= 0) { pollutionLog.splice(i, 1); }
    }
    return row;
}

/** 清空留痕（自测用；也可供她在面板上“清掉这些记录”） */
export function resetPollution() {
    pollutionLog.length = 0;
}

/** 最近污染记录（诊断用） */
export function pollutions() {
    return pollutionLog.slice();
}

/** 同一形态连续被污染几次了（中间没插别的形态） */
export function pollutionStreak(shape) {
    const id = String(shape || '');
    let n = 0;
    for (let i = pollutionLog.length - 1; i >= 0; i -= 1) {
        if (pollutionLog[i].shape !== id) { break; }
        n += 1;
    }
    return n;
}

/**
 * 该不该换通道。
 * @returns {{action:'keep'|'advise-switch', to:string, reason:string}}
 */
export function channelPlan(shape) {
    const id = String(shape || '');
    const other = id === 'proxy' ? 'direct' : (id === 'direct' ? 'proxy' : '');
    const streak = pollutionStreak(id);
    if (!other) {
        return { action: 'keep', to: '', reason: '认不出当前通道' };
    }
    if (streak >= 2) {
        return {
            action: 'advise-switch',
            to: other,
            reason: '通道 ' + id + ' 连续 ' + String(streak) + ' 次被塞了不是我们写的键 ⇒ 建议换到 ' + other
                + '（' + CHANNELS[other].label + '）；直连要你在面板里填地址与密钥',
        };
    }
    return { action: 'keep', to: '', reason: '当前通道没被连续污染（' + String(streak) + ' 次）' };
}

/** 给人看的一行 */
export function channelLine() {
    const p = pollutions();
    if (!p.length) { return '通道：没发现被塞料'; }
    const last = p[p.length - 1];
    const plan = channelPlan(last.shape);
    return '通道：' + last.shape + ' 被塞过 ' + String(p.length) + ' 次（最近多出：'
        + (last.extra.slice(0, 4).join('、') || '—') + '）'
        + (plan.action === 'advise-switch' ? '；建议换 ' + plan.to : '');
}
