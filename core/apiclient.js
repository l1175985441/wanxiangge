/**
 * 万象阁 · 模型调用（自带 API，⛔ 不锁死在酒馆默认连接上）
 *
 * 两条通道：
 *   ① proxy＝经酒馆服务器转发（云酒馆最稳：密钥留服务器侧，也绕开跨域）；
 *   ② direct＝浏览器直连（用户明确选它才走）。
 *
 * 硬约束（需求书第一号）：**单次请求 ≤ 2 分钟**。这里：
 *   · 每次请求带超时（默认 100 秒，可调）；
 *   · 超时／失败一律**如实返回失败原因**（⛔ 不静默、⛔ 不假装成功）；
 *   · 重试由上层（pipeline）管，且有**上限**。
 */

import { REQUEST_TIMEOUT_MS } from './config.js';
import { getSettings } from './settings.js';
import { getCtx } from './adapter.js';
import { trimText, asText } from './utils.js';

/** 从 start 位置起用栈扫描与首括号配对的闭合位置（忽略字符串内的括号；未闭合返回 -1） */
function findBalancedEnd(str, start) {
    let inStr = false;
    let esc = false;
    const stack = [];
    for (let i = start; i < str.length; i += 1) {
        const ch = str[i];
        if (inStr) {
            if (esc) {
                esc = false;
            } else if (ch === '\\') {
                esc = true;
            } else if (ch === '"') {
                inStr = false;
            }
            continue;
        }
        if (ch === '"') {
            inStr = true;
        } else if (ch === '{' || ch === '[') {
            stack.push(ch);
        } else if (ch === '}' || ch === ']') {
            const last = stack[stack.length - 1];
            if ((ch === '}' && last === '{') || (ch === ']' && last === '[')) {
                stack.pop();
                if (stack.length === 0) {
                    return i;
                }
            }
        }
    }
    return -1;
}

/** 从模型输出里抠出 JSON（容错：```json 包裹、前后带 [标签] 废话、尾随文字、截断收尾） */
/** 原始文本（报错时一起带出去给人看） */
function raw0(t) {
    return typeof t === 'string' ? t : String(t === undefined || t === null ? '' : t);
}

export function extractJson(text, opts) {
    const o = opts || {};
    /*
     * ⭐⭐ 补④：**最先**看接口自己报的完成原因。
     *   为什么必须在最前面：下面会先试"找一个平衡的整体"——
     *   而**被截断的 JSON 也可能恰好在某处闭合了一小段**（比如 `{"a":"b"}` 后面还有没写完的），
     *   那样会先被当成成功解析 ⇒ **截断漏判**（我的用例抓到了）。
     *   ⏔ `finish_reason === length` 是硬证据 ⇒ 它说了算，⏔ 再去猜结构。
     */
    const fin = String(o.finish || '').toLowerCase();
    if (/length|max_tokens|max_output_tokens/.test(fin)) {
        return {
            ok: false,
            truncated: true,
            reason: '输出被截断（接口报了输出到顶）',
            value: null,
            text: raw0(text),
        };
    }
    const raw = asText(text);
    if (!raw.trim()) {
        return { ok: false, reason: '模型没输出内容', value: null };
    }
    // ① 去掉围栏
    const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const body = fence ? fence[1] : raw;

    // ② 收集候选起点（优先尝试完整配对的 {…} 或 [… ]，跳过像 [结果] 这种非 JSON 方括号前缀）
    const firstBrace = body.search(/[[{]/);
    if (firstBrace < 0) {
        return { ok: false, reason: '模型输出里没有 JSON', value: null, text: raw };
    }
    const starts = [];
    const firstObj = body.indexOf('{');
    const firstArr = body.indexOf('[');
    if (firstArr >= 0 && firstArr < firstObj) {
        starts.push(firstArr);
    }
    if (firstObj >= 0) {
        starts.push(firstObj);
    }
    if (firstArr >= 0 && !starts.includes(firstArr)) {
        starts.push(firstArr);
    }

    for (const st of starts) {
        const balancedEnd = findBalancedEnd(body, st);
        if (balancedEnd > st) {
            const span = body.slice(st, balancedEnd + 1);
            try {
                return { ok: true, value: JSON.parse(span), text: raw };
            } catch (e) {
                const rep = repairJson(span);
                try {
                    return { ok: true, value: JSON.parse(rep), text: raw, repaired: true };
                } catch (e2) {
                    // 继续试下一个起点
                }
            }
        }
    }

    // ③ 截断收尾兜底：按与首括号同类的闭合符截取并补全（优先 {…}，防被前缀 [标签] 带偏）
    const mainStart = firstObj >= 0 ? firstObj : firstBrace;
    /*
     * ⭐⭐ 补④：**先认截断，⏔ 先补全**。
     *
     * 为什么要改：下面那一段 `repairJson` 会**自己把没闭合的括号补上**
     * （见 `repairJson` 尾部）。对"被截掉一半"的输出用它，等于**替她猜着补全**——
     * 而她定的规矩是：**截断就算这一轮失败，账保持原样，⏔ 许猜着补全、⏔ 半份写进账**。
     *
     * 判据两条（有哪条算哪条）：
     *   ① 接口自己告诉我们"输出到顶了"（`finish_reason === length`）——最硬；
     *   ② 它没说 ⇒ 看**没闭合**（引号没收／括号没闭）。
     * ⚠️ 只有"连一个平衡的整体都找不到"时才走到这里 ⇒ 完整的 JSON 被饰文包着
     *   不会误判（那种情况在上面 ①② 就解决了）。
     */
    const cutByFinish = String(o.finish || '').toLowerCase();
    const isCut = /length|max_tokens|max_output_tokens/.test(cutByFinish)
        || looksCut(body, mainStart);
    if (isCut) {
        return {
            ok: false,
            truncated: true,
            reason: '输出被截断（写到一半就断了，没闭合）',
            value: null,
            text: raw,
        };
    }
    const closeCh = body[mainStart] === '{' ? '}' : ']';
    const lastClose = body.lastIndexOf(closeCh);
    const candidate = lastClose > mainStart ? body.slice(mainStart, lastClose + 1) : body.slice(mainStart);

    try {
        return { ok: true, value: JSON.parse(candidate), text: raw };
    } catch (e) {
        const repaired = repairJson(candidate);
        try {
            return { ok: true, value: JSON.parse(repaired), text: raw, repaired: true };
        } catch (e2) {
            const loose = repairJson(String(body.slice(mainStart)).trim());
            try {
                return { ok: true, value: JSON.parse(loose), text: raw, repaired: true };
            } catch (e3) {
                return { ok: false, reason: 'JSON 解析不了（' + (e2 && e2.message ? e2.message : '格式不对') + '）', value: null, text: raw };
            }
        }
    }
}

/** 给截断的 JSON 补收尾（只做最保守的补全） */
function repairJson(text) {
    let s = asText(text).trim();
    // 去掉尾部多余的逗号
    s = s.replace(/,\s*$/, '');
    // 数一数没闭合的括号
    let inStr = false;
    let esc = false;
    const stack = [];
    for (let i = 0; i < s.length; i += 1) {
        const ch = s[i];
        if (inStr) {
            if (esc) {
                esc = false;
            } else if (ch === '\\') {
                esc = true;
            } else if (ch === '"') {
                inStr = false;
            }
            continue;
        }
        if (ch === '"') {
            inStr = true;
        } else if (ch === '{' || ch === '[') {
            stack.push(ch);
        } else if (ch === '}' || ch === ']') {
            stack.pop();
        }
    }
    if (inStr) {
        s += '"';
    }
    while (stack.length) {
        const open = stack.pop();
        s += open === '{' ? '}' : ']';
    }
    return s;
}

/** 组装一次请求的超时控制 */
function withTimeout(ms) {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = setTimeout(() => {
        if (controller) {
            controller.abort();
        }
    }, ms);
    return {
        signal: controller ? controller.signal : undefined,
        done: () => clearTimeout(timer),
    };
}

/**
 * 调一次模型。
 * @param {object} opts
 *   prompt    用户那段（必填）
 *   system    系统提示（可空）
 *   cheap     是否用"打杂"那个便宜模型
 *   maxTokens 覆盖默认输出上限
 *   timeoutMs 覆盖默认超时
 * @returns {Promise<{ok:boolean, text?:string, reason?:string, ms?:number}>}
 */
export async function callModel(opts) {
    const o = opts || {};
    const prompt = trimText(o.prompt);
    if (!prompt) {
        return { ok: false, reason: '没给提示词' };
    }
    const settings = getSettings();
    const api = settings.api || {};
    const url = trimText(api.url);
    const key = trimText(api.key);
    const model = trimText(o.cheap ? (api.modelCheap || api.model) : api.model);
    if (!url || !model) {
        return { ok: false, reason: '没配好自定义 API（地址／模型名）——去面板「自定义 API」里填上' };
    }

    const body = {
        model,
        messages: [],
        temperature: Number.isFinite(Number(api.temperature)) ? Number(api.temperature) : 0.4,
        max_tokens: Number.isFinite(Number(o.maxTokens)) ? Number(o.maxTokens)
            : (Number.isFinite(Number(api.maxTokens)) ? Number(api.maxTokens) : 1600),
        stream: false,
    };
    const system = trimText(o.system);
    if (system) {
        body.messages.push({ role: 'system', content: system });
    }
    body.messages.push({ role: 'user', content: prompt });

    const timeoutMs = Number.isFinite(Number(o.timeoutMs)) ? Number(o.timeoutMs) : REQUEST_TIMEOUT_MS;
    const started = Date.now();
    const timeout = withTimeout(timeoutMs);

    try {
        const res = api.mode === 'direct'
            ? await callDirect(url, key, model, body, timeout.signal)
            : await callViaServer(url, key, model, body, timeout.signal, o.cheap === true);
        const ms = Date.now() - started;
        if (!res.ok) {
            return { ok: false, reason: res.reason, ms };
        }
        const text = trimText(res.text);
        if (!text) {
            return { ok: false, reason: '模型回了空内容（可以试试调大输出上限或换模型）', ms };
        }
        return { ok: true, text, ms, via: res.via };
    } catch (e) {
        const ms = Date.now() - started;
        const aborted = e && (e.name === 'AbortError' || /abort/i.test(asText(e && e.message)));
        return {
            ok: false,
            reason: aborted ? ('超过 ' + String(Math.round(timeoutMs / 1000)) + ' 秒没回（这一站的限时）') : ('请求出错：' + (e && e.message ? e.message : String(e))),
            ms,
        };
    } finally {
        timeout.done();
    }
}

/**
 * 酒馆"服务器转发"那条接口的地址。
 *
 * ⚠️ 云酒馆**可以整个挂在子路径下**（例：域名后面还跟一层目录）——那种情况下
 *    写死 `/api/backends/...` 会打到**根域**、直接 404（本地酒馆看不出来，因为就在根上）。
 *    办法：拿页面自己的 `location` 推。酒馆的前端页面在 `<挂载点>/` 或 `<挂载点>/index.html`：
 *      · 结尾是 /index.html ⇒ 去掉它；
 *      · 结尾是别的 .html（例如 login 页）⇒ 退回上一级；
 *      · 推不出来（拿不到 location）⇒ 退回绝对路径，跟以前一样。
 */
export function tavernApiPath() {
    const fallback = '/api/backends/chat-completions/generate';
    let loc = null;
    try {
        loc = typeof window !== 'undefined' && window.location ? window.location : null;
    } catch (e) {
        loc = null;
    }
    if (!loc || !loc.pathname) {
        return fallback;
    }
    let dir = String(loc.pathname);
    if (/\/index\.html?$/i.test(dir)) {
        dir = dir.replace(/\/index\.html?$/i, '');
    } else if (/\.html?$/i.test(dir)) {
        dir = dir.replace(/\/[^/]*$/, '');
    } else if (!/\/$/.test(dir)) {
        // 没有文件名也没斜杠（少见）⇒ 当成目录
        dir = dir.replace(/\/[^/]*$/, '');
    }
    dir = dir.replace(/\/+$/, '');
    return dir + fallback;
}

/** ① 经酒馆服务器转发 */
async function callViaServer(url, key, model, body, signal, cheap) {
    const ctx = getCtx();
    const headers = { 'Content-Type': 'application/json' };
    try {
        if (ctx && typeof ctx.getRequestHeaders === 'function') {
            Object.assign(headers, ctx.getRequestHeaders());
        }
    } catch (e) {
        // 拿不到就只用基础头
    }
    const payload = {
        chat_completion_source: 'custom',
        custom_url: url,
        custom_include_headers: key ? JSON.stringify({ Authorization: 'Bearer ' + key }) : '',
        model,
        messages: body.messages,
        temperature: body.temperature,
        max_tokens: body.max_tokens,
        stream: false,
    };
    const endpoint = tavernApiPath();
    let res = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal,
    });
    // ⚠️ 404 兜底：推出来的路径万一不对（她那台环境的挂法不同），退回绝对路径再试一次
    if (res.status === 404 && endpoint !== '/api/backends/chat-completions/generate') {
        res = await fetch('/api/backends/chat-completions/generate', {
            method: 'POST',
            headers,
            body: JSON.stringify(payload),
            signal,
        });
    }
    if (!res.ok) {
        let detail = '';
        try {
            const err = await res.json();
            detail = asText(err && err.error && (typeof err.error === 'string' ? err.error : err.error.message));
        } catch (e) {
            detail = '';
        }
        // 404 时把话说到位：云酒馆挂在子路径上、或酒馆没开这条接口
        const hint = res.status === 404
            ? '（接口没找到：如果酒馆挂在子路径下，或"自定义 URL"被服务器关了，就会这样）'
            : '';
        return { ok: false, reason: '酒馆转发失败（HTTP ' + String(res.status) + '）' + hint + (detail ? '：' + detail : '') };
    }
    const data = await res.json().catch(() => null);
    const text = readCompletionText(data);
    if (text === null) {
        return { ok: false, reason: '转发通道回了怪东西（不是标准格式）' };
    }
    return { ok: true, text, via: 'server', finish: readFinishReason(data) };
}

/** ② 浏览器直连 */
async function callDirect(url, key, model, body, signal) {
    const base = url.replace(/\/+$/, '');
    const endpoint = /\/chat\/completions$/.test(base) ? base : base + '/chat/completions';
    const headers = { 'Content-Type': 'application/json' };
    if (key) {
        headers.Authorization = 'Bearer ' + key;
    }
    const res = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body), signal });
    if (!res.ok) {
        let detail = '';
        try {
            const err = await res.json();
            detail = asText(err && err.error && (err.error.message || err.error));
        } catch (e) {
            detail = '';
        }
        return { ok: false, reason: '直连失败（HTTP ' + String(res.status) + '）' + (detail ? '：' + detail : '') };
    }
    const data = await res.json().catch(() => null);
    const text = readCompletionText(data);
    if (text === null) {
        return { ok: false, reason: '直连回了怪东西（不是标准格式）' };
    }
    return { ok: true, text, via: 'direct', finish: readFinishReason(data) };
}

/**
 * ⭐ 补④：把**完成原因**也拀出来（有就用，没有就空字符串）。
 *   为什么要它：`finish_reason === 'length'` 是"输出被截"**最硬的证据**——
 *   比"我们自己猜它没闭合"可靠得多。
 *   ⚠️ 不同中转叫法不一（length／max_tokens／max_output_tokens）⇒ 都算截断。
 */
function readFinishReason(data) {
    const choice = data && Array.isArray(data.choices) ? data.choices[0] : null;
    const r = choice && (choice.finish_reason || choice.stop_reason);
    return asText(r);
}

/** 这段文本从 `from` 开始是不是**没闭合**（引号没收、括号没闭） */
function looksCut(text, from) {
    const s = asText(text).slice(Math.max(0, from));
    let inStr = false;
    let esc = false;
    let depth = 0;
    for (let i = 0; i < s.length; i += 1) {
        const ch = s[i];
        if (inStr) {
            if (esc) {
                esc = false;
            } else if (ch === '\\') {
                esc = true;
            } else if (ch === '"') {
                inStr = false;
            }
            continue;
        }
        if (ch === '"') {
            inStr = true;
        } else if (ch === '{' || ch === '[') {
            depth += 1;
        } else if (ch === '}' || ch === ']') {
            depth -= 1;
        }
    }
    return inStr || depth > 0;
}

/** 从各种返回形状里把正文抠出来 */
function readCompletionText(data) {
    if (!data || typeof data !== 'object') {
        return null;
    }
    // OpenAI 兼容
    const choice = Array.isArray(data.choices) ? data.choices[0] : null;
    if (choice) {
        if (choice.message && typeof choice.message.content === 'string') {
            return choice.message.content;
        }
        if (typeof choice.text === 'string') {
            return choice.text;
        }
        if (Array.isArray(choice.message && choice.message.content)) {
            return choice.message.content.map((p) => asText(p && p.text)).join('');
        }
    }
    // 有些中转直接回 {content: "..."} / {response: "..."}
    if (typeof data.content === 'string') {
        return data.content;
    }
    if (typeof data.response === 'string') {
        return data.response;
    }
    if (typeof data.text === 'string') {
        return data.text;
    }
    return null;
}

/**
 * 调模型并要 JSON（失败会把原因说清楚，⛔ 不静默）
 * @returns {Promise<{ok:boolean, value?:object, reason?:string, ms?:number, repaired?:boolean}>}
 */
export async function callModelJson(opts) {
    const res = await callModel(opts);
    if (!res.ok) {
        return { ok: false, reason: res.reason, ms: res.ms };
    }
    const parsed = extractJson(res.text, { finish: res.finish });
    if (!parsed.ok) {
        // ⭐ 补④：把"截断"这个身份一路带上去（上游要据此报"截断"、⏔ 当普通格式错）。
        return { ok: false, reason: parsed.reason, truncated: parsed.truncated === true, raw: res.text, ms: res.ms };
    }
    return { ok: true, value: parsed.value, ms: res.ms, repaired: parsed.repaired === true };
}
