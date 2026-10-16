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
    /*
     * ⭐ 修复单 #2：**先定"外层"是哪个括号，并在进候选循环之前判一次截断。**
     *   病根：原来直接进循环——外层 `{` 被截断时，`findBalancedEnd` 会**往里找到某个闭合的子数组**
     *   （例 `{"chars":[{"name":"a"}]` 里那个 `[...]`）并解析成功 ⇒
     *   把"写了一半"当成成功，还可能把**内层数组当整份结果**交上去（形状都不对）。
     *   判据：外层括号**找不到配对** ＋ 从它起 `looksCut` ⇒ 这一份就是截断。
     *   ⚠️ 完整的 JSON（哪怕后面跟着饰文）外层能找到配对 ⇒ 不误判。
     */
    const mainStart = firstObj >= 0 ? firstObj : firstBrace;
    if (findBalancedEnd(body, mainStart) <= mainStart && looksCut(body, mainStart)) {
        return {
            ok: false,
            truncated: true,
            reason: '输出被截断（写到一半就断了，没闭合）',
            value: null,
            text: raw,
        };
    }
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
    // ⚠️ `mainStart` 已在上面（修复单 #2 的截断判定处）算好，这里⛔ 别重复声明（会 SyntaxError）。
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
        /*
         * ⭐ 目标核对 3②：**拆开说清缺哪一个**，并把**面板读到的现值**带出来。
         *   她报过："模型名字填了，sk也填了"却仍看到这句 ⇒
         *   原来那句话只说"没配好"⇒ **她无法判断到底是没保存上、还是填错格**。
         */
        const miss = [];
        if (!url) {
            miss.push('接口地址为空');
        }
        if (!model) {
            miss.push('模型名为空');
        }
        return {
            ok: false,
            reason: '没配好自定义 API：' + miss.join('、')
                + '｜面板现在读到的是：地址=' + (url || '（空）')
                + '、模型=' + (model || '（空）')
                + '（去面板「自定义 API」里看看是不是没保存上）',
        };
    }

    const body = {
        model,
        messages: [],
        temperature: Number.isFinite(Number(api.temperature)) ? Number(api.temperature) : 0.4,
        max_tokens: Number.isFinite(Number(o.maxTokens)) ? Number(o.maxTokens)
            : (Number.isFinite(Number(api.maxTokens)) ? Number(api.maxTokens) : 1600),
        stream: true,   /* ⭐ 流式（阿砚：长请求被掉是因为“长时间零输出” ✗ ⇒ 改成一直滚 ✓） */
    };
    const system = trimText(o.system);
    if (system) {
        body.messages.push({ role: 'system', content: system });
    }
    body.messages.push({ role: 'user', content: prompt });

    const timeoutMs = Number.isFinite(Number(o.timeoutMs)) ? Number(o.timeoutMs) : REQUEST_TIMEOUT_MS;
    const started = Date.now();
    const timeout = withTimeout(timeoutMs);
    let autoVia = '';
    /*
     * ⭐⭐ 真机对照实验得到的通关组合：**假流式-**前缀的模型名 ＋ **走流式** ✓
     *   实测：普通名＋非流式 ⇒ Bad Request ✗；普通名＋流式 ⇒ 400 INVALID_ARGUMENT ✗；
     *         **假流式-**名＋流式 ⇒ **HTTP 200、真数据回来了** ✓✓
     *   ⇒ 失败且看到 Bad Request／INVALID_ARGUMENT 时，**自动加上这个前缀重试** ✓（⏔ 让她去改模型名 ✗）
     */
    let modelTry = model;
   /* ⭐ 直连被挡、自动改走转发时记下来 ✓ */

    try {
        /*
         * ⭐⭐ 她 15:xx：「**你不会修 api 连接吗**？还一直叫我换」
         *   真机取证：「直连」发 **POST** 时会被挡（CORS/网络层）⇒ `Failed to fetch` / `ERR_CONNECTION_RESET` ✗
         *   而「经酒馆转发」那条是能走的（只是慢 ✗）⇒ 原来直连一抛**直接判失败**，根本没去试转发 ✗
         *   ⇒ 现在：**直连抛了就自动改走转发再试一次** ✓（⏔ 让她手动切 ✗），并记下 via='proxy-auto' ✓
         */
        let res = null;
        if (api.mode === 'direct') {
            try {
                res = await callDirect(url, key, modelTry, body, timeout.signal);
            } catch (eDirect) {
                /* ⚠️ 已经超时/取消就不再重试（重试也是白跑 ✗） */
                const aborted2 = eDirect && (eDirect.name === 'AbortError' || /abort/i.test(asText(eDirect && eDirect.message)));
                if (aborted2) { throw eDirect; }
                res = await callViaServer(url, key, modelTry, body, timeout.signal, o.cheap === true);
                if (res && res.ok) { autoVia = 'proxy-auto'; }
            }
        } else {
            res = await callViaServer(url, key, modelTry, body, timeout.signal, o.cheap === true);
        }
        /*
         * ⭐⭐ 真机一试便知（第 51 轮）：正文喂小之后请求**真的到得了对面** ✓
         *   对面回：“The requested max_tokens (2560) exceeds the maximum output tokens allowed for model …” ✗
         *   ⇒ 只差一个数字：**输出上限超了** ⇒ 不推给她去猜 ✗
         *   ⇒ 现在：**对方说超了就自动砍半重试**（最多 2 次 ✓）
         */
        /* ⭐ 前缀重试：对方说 Bad Request／INVALID_ARGUMENT 且还没加前缀 ⇒ 加上再试一次 ✓ */
        if (res && res.ok === false && !/^假流式-/.test(modelTry)
            && /Bad Request|INVALID_ARGUMENT|invalid argument/i.test(String(res.reason || ''))) {
            modelTry = '假流式-' + modelTry;
            try {
                if (api.mode === 'direct') {
                    try { res = await callDirect(url, key, modelTry, body, timeout.signal); }
                    catch (eP1) { res = await callViaServer(url, key, modelTry, body, timeout.signal, o.cheap === true); }
                } else {
                    res = await callViaServer(url, key, modelTry, body, timeout.signal, o.cheap === true);
                }
                if (res && res.ok) { autoVia = autoVia || 'prefix-auto'; }
            } catch (eP2) { /* 保持原结果 ✓ */ }
        }
        let loweredTo = 0;
        for (let guard = 0; guard < 3 && res && res.ok === false
            && /exceeds the maximum output tokens|max_tokens|maximum context length|too many tokens/i.test(String(res.reason || '')); guard += 1) {
            const cur = Number(body.max_tokens);
            if (guard === 2) {
                /* ⭐ 最后一招：**干脆不传 max_tokens** ✓（有些中转只在“字段存在”时才校验 ✓）
                 *   ⏔ JSON.stringify 会丢掉 undefined 属性 ⇒ 这个字段就不会出现在请求里 ✓ */
                delete body.max_tokens;
                loweredTo = -1;
            } else {
                const next = Math.max(256, Math.floor((Number.isFinite(cur) ? cur : 1024) / 2));
                if (!Number.isFinite(next) || (Number.isFinite(cur) && next >= cur)) { break; }
                body.max_tokens = next;
                loweredTo = next;
            }
            if (api.mode === 'direct') {
                try {
                    res = await callDirect(url, key, modelTry, body, timeout.signal);
                } catch (eAgain) {
                    res = await callViaServer(url, key, modelTry, body, timeout.signal, o.cheap === true);
                }
            } else {
                res = await callViaServer(url, key, modelTry, body, timeout.signal, o.cheap === true);
            }
        }
        const ms = Date.now() - started;
        if (!res.ok) {
            return { ok: false, reason: String(res.reason || '')
                + (loweredTo === -1 ? '（已自动改成**不传输出上限**再试过 ✓）'
                    : (loweredTo ? ('（已自动把输出上限降到 ' + String(loweredTo) + ' 再试过 ✓）') : '')), ms };
        }
        const text = trimText(res.text);
        if (!text) {
            return { ok: false, reason: '模型回了空内容（可以试试调大输出上限或换模型）', ms };
        }
        return { ok: true, text, ms, via: (autoVia || res.via), finish: res.finish };
        /* ⭐ 走了自动转发时，via 会是 'proxy-auto' ⇒ 上层可以告诉她“直连被挡，已自动改走转发” ✓ */
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

/**
 * ⭐ 目标核对 3①：**拉取模型列表**。
 *   她原话："这个 api 没有拉取模型的键，只能自己输名字太麻烦"。
 *   做法照酒馆连接页：向 `<url>/models` 要一份清单（带上密钥）。
 *   ⚠️ 拉不到（站不通／没开这个接口／没埋地址）⇒ **如实说原因**，且**不影响手输**（她随时可以自己填）。
 *   ⚠️ 这条路**不走酒馆转发**（ST 那个端口是聊天用的，没有 models）⇒ 只能直连拉。
 */
export async function fetchModels(opts) {
    const api = (opts && opts.api) || (getSettings().api || {});
    const url = trimText(api.url);
    if (!url) {
        return { ok: false, reason: '没填接口地址（先把地址填上才能拉）' };
    }
    const base = url.replace(/\/+$/, '');
    const key = trimText(api.key);
    // ⚠️ 不能跟用户填的 `…/chat/completions` 拼错：把尾部那段切掉再接 `/models`
    const root = base.replace(/\/(chat\/)?completions$/i, '');
    const ep = root + '/models';
    try {
        const res = await fetch(ep, {
            method: 'GET',
            headers: key ? { Authorization: 'Bearer ' + key } : {},
        });
        const rawText = await res.text().catch(() => '');
        if (!res.ok) {
            return {
                ok: false,
                reason: 'HTTP ' + String(res.status) + '｜' + rawText.slice(0, 200),
            };
        }
        let data = null;
        try {
            data = JSON.parse(rawText);
        } catch (e) {
            return { ok: false, reason: '回的不是 JSON (' + rawText.slice(0, 120) + ')' };
        }
        const arr = data && (data.data || data.models);
        const list = (Array.isArray(arr) ? arr : []).map((m) => trimText(m && (m.id || m.name)))
            .filter(Boolean);
        if (!list.length) {
            return { ok: false, reason: '拉到了但里面一个模型名都没有' };
        }
        return { ok: true, list };
    } catch (e) {
        return { ok: false, reason: '连不上：' + String((e && e.message) || e).slice(0, 160) };
    }
}

/*
 * ⭐⭐ 真机取证（第 48 轮）：有些报错**是对面服务自己吐的**，⏔ 我们的 bug ✗
 *   例：她那个中转（stapi.cc.cd）返回 500 “No environment variable set for provider: self-dploy”
 *   已证：酒馆源码里**没有**这句话 ✓、我们的 payload 全对（custom_url／密钥头）✓ ⇒ 只能是它报的 ✓
 *   ⇒ 把它翻译成人话，省得她（和我）去追自己的代码 ✓
 */
function providerHint(txt) {
    const s = String(txt == null ? '' : txt);
    if (/No environment variable set for provider/i.test(s)) {
        return '（⚠ 这是**对方服务自己**的报错：它内部那个 provider 没配密钥 —— 要修在它那边，⏔ 不是万象阁的问题）';
    }
    return '';
}

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
        stream: true,   /* ⭐ 流式（阿砚：长请求被掉是因为“长时间零输出” ✗ ⇒ 改成一直滚 ✓） */
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
        /* ⭐她 15:xx：失败时要把“真因”点名（⏔ 让她以为是本地的毛病 ✗） */
        const resetLike = res.status === 502 || /ECONNRESET|ETIMEDOUT|socket hang up|aborted/i.test(String(detail || ''));
        const hint = res.status === 404
            ? '（接口没找到：如果酒馆挂在子路径下，或"自定义 URL"被服务器关了，就会这样）'
            : '';
        return { ok: false, reason: '酒馆转发失败（HTTP ' + String(res.status) + '）' + hint + providerHint(detail) + (resetLike ? '（对方站点把连接掉了 —— 不是你本地的毛病：可以少推几楼／换个模型或站点／过会儿再试）' : '')
            + (detail ? '：' + detail : '') };
    }
    /*
     * ⭐⭐真凶（阿砚定位 ✓）：v0.3.85 发了流式、**读取端忘了接线** ✗
     *   ⇒ `res.json()` 解流式必失败 ⇒ catch(()=>null) ⇒ 空 ⇒ 报“怪东西：null” ✗（结构性 100% 复现 ✓）
     */
    const rmsA = await readMaybeStream(res);
    const data = rmsA.raw;
    const text = rmsA.text;
    if (rmsA.error) {
        return { ok: false, reason: '转发通道上游报错（HTTP ' + String(res.status) + ' 流内错误）：' + rmsA.error };
    }
    if (text === null) {
        /*
         * ⭐ 目标核对 3②：失败时**把 ST 的原始回体带出来**。
         *   病根：原来只有一句"回了怪东西（不是标准格式）"⇒ 她那边（云酒馆）**根本没法排查**
         *   （实测 ST 转发回的是 `{"error":{"message":"Not Found"}}` 这种，看得见才能定位）。
         */
        let raw = '';
        try {
            raw = (typeof data === 'string') ? data : JSON.stringify(data);
        } catch (e) {
            raw = String(data);
        }
        return {
            ok: false,
            reason: '转发通道回了怪东西（不是标准格式）｜HTTP ' + String(res.status)
                + '｜原始回体前 200 字：' + raw.slice(0, 200),
        };
    }
    return { ok: true, text, via: 'server', finish: (rmsA.finish || readFinishReason(data)) };
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
        return { ok: false, reason: ('直连失败（HTTP ' + String(res.status) + '）' + providerHint(detail)) + (detail ? '：' + detail : '') };
    }
    const rmsB = await readMaybeStream(res);
    const text = rmsB.text;
    if (rmsB.error) {
        return { ok: false, reason: '直连上游报错（HTTP ' + String(res.status) + '）：' + rmsB.error };
    }
    if (text === null) {
        return { ok: false, reason: '直连回了怪东西（不是标准格式）' };
    }
    return { ok: true, text, via: 'direct', finish: (rmsB.finish || readFinishReason(rmsB.raw)) };
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
/*
 * ⭐⭐ 阿砚复核后的一枪：**回包可能是流式**
 *   他发现：同一台机器上，**酒馆本体跑的长请求（上下文比这两步还大）是通的** ✓
 *   差别就在它走 **流式**（数据一直滚 ✓），而我们这两步是**非流式**（一次等一个大回包 ✗）
 *   ⇒ 若那站只是不爱“长时间零输出的连接”，**这一枪就能过** ✓（一试便知 ✓）
 *   ⏔ 不能只会流式：有站不支持流式、直接回 JSON ✗ ⇒ 那就退回原来的读法 ✓
 */
/** 从单个已解析的 JSON 块（SSE 帧或整包）里提取增量正文与完成原因 */
function extractChunkPiece(j) {
    if (!j || typeof j !== 'object') {
        return { piece: '', finish: '', error: '' };
    }
    if (j.error) {
        const errText = typeof j.error === 'string'
            ? j.error
            : asText((j.error && (j.error.message || j.error.code)) || JSON.stringify(j.error));
        return { piece: '', finish: '', error: errText };
    }
    // ① OpenAI 兼容流式 / 非流式（含 delta.content / message.content / text，自动忽略 reasoning_content 思考过程）
    const ch = (Array.isArray(j.choices) && j.choices[0]) || null;
    if (ch) {
        const d = ch.delta || ch.message || {};
        let piece = '';
        if (typeof d.content === 'string') {
            piece = d.content;
        } else if (typeof ch.text === 'string') {
            piece = ch.text;
        } else if (typeof d.text === 'string') {
            piece = d.text;
        } else if (Array.isArray(d.content)) {
            piece = d.content
                .filter((p) => p && !p.thinking && !p.thought)
                .map((p) => asText(p.text || p.content))
                .join('');
        }
        const finish = asText(ch.finish_reason || ch.stop_reason || ch.finishReason);
        return { piece, finish, error: '' };
    }
    // ② Gemini 原生流式格式兜底（candidates[0].content.parts，跳过 thought 思考块，参照 sse-stream.js）
    const cand = (Array.isArray(j.candidates) && j.candidates[0]) || null;
    if (cand) {
        const parts = (cand.content && Array.isArray(cand.content.parts)) ? cand.content.parts : [];
        const piece = parts
            .filter((p) => p && p.thought !== true && typeof p.text === 'string')
            .map((p) => p.text)
            .join('');
        const finish = asText(cand.finishReason || cand.finish_reason);
        return { piece, finish, error: '' };
    }
    // ③ Claude / 其它中转格式兜底
    if (j.delta && typeof j.delta.text === 'string') {
        return { piece: j.delta.text, finish: asText(j.stop_reason || (j.delta && j.delta.stop_reason)), error: '' };
    }
    const direct = readCompletionText(j);
    return { piece: typeof direct === 'string' ? direct : '', finish: readFinishReason(j), error: '' };
}

/**
 * ⭐ 自适应读取响应（⏔ 不看 Content-Type 头：酒馆 forwardFetchResponse 转发流式时不带该头）：
 *   1. 优先用 reader 边收边拼（真流式保活），无 reader 时退回 res.text() / res.json()（兼容离线自测）；
 *   2. 按内容自身特征判：含 `data:` 行或 SSE 事件流 ⇒ 逐行解析拼合 delta；否则走整包 JSON.parse（失败再回退逐行扫）；
 *   3. 若上游在 HTTP 200 流内塞了 {"error":...}，直接拎出真实错误原因。
 */
async function readMaybeStream(res) {
    let rawText = '';
    // ① 先把字节流稳妥读成文本（支持分块流式消费，且兼容假机 mock）
    if (res && res.body && typeof res.body.getReader === 'function') {
        try {
            const reader = res.body.getReader();
            const dec = new TextDecoder('utf-8');
            for (;;) {
                const step = await reader.read();
                if (step.done) {
                    rawText += dec.decode(); // ⭐ 冲刷尾部残留字节
                    break;
                }
                if (step.value) {
                    rawText += dec.decode(step.value, { stream: true });
                }
            }
        } catch (eStream) {
            // 流中途断开：保住已收到的 rawText 供后续判断
        }
    } else if (res && typeof res.text === 'function') {
        rawText = await res.text().catch(() => '');
    } else if (res && typeof res.json === 'function') {
        const data = await res.json().catch(() => null);
        const extracted = extractChunkPiece(data);
        return {
            text: extracted.piece ? extracted.piece : readCompletionText(data),
            finish: extracted.finish || readFinishReason(data),
            error: extracted.error,
            raw: data,
        };
    }

    const trimmed = String(rawText || '').trim();
    if (!trimmed) {
        return { text: null, finish: '', error: '响应体为空（0 字节）', raw: '' };
    }

    // ② 内容判据：像不像 SSE 流（含 data: 前缀行）？
    const looksLikeSse = /^data\s*:/m.test(trimmed);

    // ②a 若不含 data: 前缀，先试整包 JSON.parse（兼容不支持流式、直接回完整 JSON 的中转站）
    if (!looksLikeSse) {
        try {
            const data = JSON.parse(trimmed);
            const extracted = extractChunkPiece(data);
            const text = extracted.piece ? extracted.piece : readCompletionText(data);
            return {
                text: text !== null && text !== '' ? text : null,
                finish: extracted.finish || readFinishReason(data),
                error: extracted.error,
                raw: trimmed,
            };
        } catch (eJson) {
            // 整包 JSON 解析失败 ⇒ 继续往下走逐行扫描兜底（例如 NDJSON 多行 JSON）
        }
    }

    // ②b 逐行解析 SSE（data: {...}）或 NDJSON
    const lines = trimmed.split(/\r\n|\r|\n/);
    let acc = '';
    let fin = '';
    let streamErr = '';
    let validFrames = 0;

    for (const rawLine of lines) {
        const line = String(rawLine || '').trim();
        if (!line || line.startsWith(':') || /^(event|id|retry)\s*:/i.test(line)) {
            continue;
        }
        const payload = /^data\s*:/i.test(line) ? line.replace(/^data\s*:\s*/i, '').trim() : line;
        if (!payload || payload === '[DONE]') {
            continue;
        }
        try {
            const j = JSON.parse(payload);
            validFrames += 1;
            const { piece, finish, error } = extractChunkPiece(j);
            if (error) {
                streamErr = error;
            }
            if (piece) {
                acc += piece;
            }
            if (finish) {
                fin = finish;
            }
        } catch (eFrame) {
            // 单行非 JSON 忽略，继续扫下一行
        }
    }

    const out = trimText(acc);
    if (out) {
        return { text: out, finish: fin, error: '', raw: trimmed };
    }
    if (streamErr) {
        return { text: null, finish: fin, error: streamErr, raw: trimmed };
    }
    // 兜底：若 SSE 没抠出内容，再试一次是不是单块 JSON 被误判
    if (looksLikeSse && !validFrames) {
        try {
            const data = JSON.parse(trimmed);
            return { text: readCompletionText(data), finish: readFinishReason(data), error: '', raw: trimmed };
        } catch (e) { /* 忽略 */ }
    }
    return { text: null, finish: fin, error: '', raw: trimmed };
}

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
