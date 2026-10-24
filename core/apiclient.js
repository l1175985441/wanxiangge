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
import { inspectBody, notePollution, channelPlan } from './channel.js';   /* G3：通道形态隔离 */
import { getSettings, resolveApi } from './settings.js';
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
     *   ⛔ `finish_reason === length` 是硬证据 ⇒ 它说了算，⛔ 再去猜结构。
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
    /*
     * ⭐ U9（材料 12·未覆盖死角）：**围栏不止一个时，要挑能解析出 JSON 的那个** ✓
     *   旧：`/```(?:json)?\s*([\s\S]*?)```/i` 只抓**第一个**围栏 ✗
     *     ⇒ 模型先吐一段 ```thinking…``` 或普通说明，真 JSON 在后面 ✗
     *     ⇒ 拿到的是废话，真 JSON 被丢 ✗
     *   现在：列出所有围栏块 ✓ 优先「标了 json 且看起来是 JSON」
     *     → 标了 json → **长得像 JSON 的** → 只有一个围栏时照旧用它 ✓
     */
    let body = raw;
    try {
        const fences = [];
        const rxAll = /```([A-Za-z0-9_+-]*)[ \t]*\r?\n?([\s\S]*?)```/g;
        let fm = rxAll.exec(raw);
        while (fm) {
            fences.push({ tag: String(fm[1] || '').toLowerCase(), body: fm[2] });
            fm = rxAll.exec(raw);
        }
        const looksJson = (s2) => /^[\s\r\n]*[\[{]/.test(String(s2 == null ? '' : s2));
        const pick = fences.find((x) => x.tag === 'json' && looksJson(x.body))
            || fences.find((x) => x.tag === 'json')
            || fences.find((x) => looksJson(x.body));
        if (pick) {
            body = pick.body;
        } else if (fences.length === 1) {
            body = fences[0].body;
        }
    } catch (eU9) {
        body = raw;
    }

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
     * ⭐⭐ 补④：**先认截断，⛔ 先补全**。
     *
     * 为什么要改：下面那一段 `repairJson` 会**自己把没闭合的括号补上**
     * （见 `repairJson` 尾部）。对"被截掉一半"的输出用它，等于**替她猜着补全**——
     * 而她定的规矩是：**截断就算这一轮失败，账保持原样，⛔ 许猜着补全、⛔ 半份写进账**。
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
/* ⭐ U16：本会话内“已知能走通”的路径提示（⛔ 落设置 ✗） */
let sessionViaHint = '';
let viaHintTold = false;

/**
 * ★ 20261023：附加请求头一行一个 Header: Value。
 */
export function parseApiHeaders(raw) {
    const out = {};
    for (const line of String(raw || '').split(/\r?\n/)) {
        const s0 = line.trim();
        if (!s0 || s0.charAt(0) === '#') { continue; }
        const i0 = s0.indexOf(':');
        if (i0 <= 0) { continue; }
        out[s0.slice(0, i0).trim()] = s0.slice(i0 + 1).trim();
    }
    return out;
}


/**
 * ★ 20261023：把“附加主体参数 / 排除主体参数”应用到请求体上（抽成可测的纯函数）。
 *   排除先做（⛔ 让“加”的被“排”的盖掉）。
 */
export function applyRequestTweaks(body, api) {
    const target = (body && typeof body === 'object') ? body : {};
    const a = api || {};

    const add = (function parseLineMap(raw) {
        const out = {};
        for (const line of String(raw || '').split(/\r?\n/)) {
            const s0 = line.trim();
            if (!s0 || s0.charAt(0) === '#') { continue; }
            const m0 = s0.match(/^([^:=\s]+)\s*[:=]\s*(.+)$/);
            if (!m0) { continue; }
            let v = m0[2].trim();
            if (/^".*"$/.test(v) || /^'.*'$/.test(v)) { v = v.slice(1, -1); }
            out[m0[1].trim()] = v;
        }
        return out;
    })(a.extraBody);
    for (const k of Object.keys(add)) {
        const v = add[k];
        if (/^-?\d+(\.\d+)?$/.test(v)) { target[k] = Number(v); }
        else if (v === 'true' || v === 'false') { target[k] = (v === 'true'); }
        else if (/^[\[{]/.test(v)) { try { target[k] = JSON.parse(v); } catch (eJ) { target[k] = v; } }
        else { target[k] = v; }
    }
    const exKeys = String(a.excludeBody || '').split(/[,\s]+/).map((x) => x.trim()).filter(Boolean);
    for (const k of exKeys) { delete target[k]; }
    return target;
}

/*
 * 依据＝阿砚第四批 4-b #3（记账三格）：
 *   `apiAttemptCount`（这一轮发了几次请求）、`apiAcceptedAttempt`（哪一份算数）、
 *   `apiAttemptFailures`（中途失败过几次——**后面成功了也照留**）。
 *   不改重试逻辑，只加计数；回答“这一轮花了几份、哪一份算数”。
 */
let apiAttemptCount = 0;
let apiAttemptFailures = 0;
function noteApiAttempt() {
    apiAttemptCount += 1;
    return apiAttemptCount;
}
export function lastApiAttempts() {
    return { count: apiAttemptCount, failures: apiAttemptFailures, accepted: apiAttemptCount > 0 ? apiAttemptCount : 0 };
}
export function resetApiAttempts() {
    apiAttemptCount = 0;
    apiAttemptFailures = 0;
}

export async function callModel(opts) {
    const o = opts || {};
    const prompt = trimText(o.prompt);
    if (!prompt) {
        return { ok: false, reason: '没给提示词' };
    }
    const settings = getSettings();
    const api = resolveApi();   /* ★ 20261023：书签选了就用那套（⛔ 用基础配置） */
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

    /*
     * ★ 20261023（阿砚 14 号）：proxy 路要能带三格。
     *   证据（ST 服务端）：chat-completions.js:2319 mergeObjectWithYaml(custom_include_body)、:2573 excludeKeysByYaml(custom_exclude_body) ✓
     *   ⚙ 关键：**三格全空就不加键** ⇒ payload 形状不变（不打扰已有形状校验），填了才加 ✓
     */
    const pExtraBody = String(api.extraBody || '');
    const pExtraHeaders = String(api.extraHeaders || '');
    const pExclude = String(api.excludeBody || '').split(/[,\s]+/).map((x) => x.trim()).filter(Boolean);
    const hasProxyTweaks = !!(pExtraBody || pExtraHeaders || pExclude.length);

    const body = {
        model,
        messages: [],
        temperature: Number.isFinite(Number(api.temperature)) ? Number(api.temperature) : 0.4,
        max_tokens: Number.isFinite(Number(o.maxTokens)) ? Number(o.maxTokens)
            : (Number.isFinite(Number(api.maxTokens)) ? Number(api.maxTokens) : 1600),
        stream: true,   /* ⭐ 流式（阿砚：长请求被掉是因为“长时间零输出” ✗ ⇒ 改成一直滚 ✓） */
    };
    /* G3：拼完就检一遍“有没有不是我们写的键”（被别的插件塞料时能看见，⛔ 永远搜不到） */
    try {
        const insp = inspectBody('proxy', body);
        if (!insp.ok) {
            notePollution('proxy', insp.extra);
            const plan = channelPlan('proxy');
            console.warn('[万象阁] ' + insp.reason + (plan.action === 'advise-switch' ? '｜' + plan.reason : ''));
        }
    } catch (eIns) { /* 自检不能拦发请求 */ }

    if (hasProxyTweaks) {
        /* ★ 只在她填了三格时才加这三个键（⛔ 动 payload 形状） */
        if (pExtraBody) { body.custom_include_body = pExtraBody; }
        if (pExclude.length) { body.custom_exclude_body = pExclude.map((k) => '- ' + k).join('\n'); }
        if (pExtraHeaders) {
            let hdrMap = {};
            try { hdrMap = JSON.parse(body.custom_include_headers || '{}') || {}; } catch (eH) { hdrMap = {}; }
            for (const k2 of Object.keys(parseApiHeaders(pExtraHeaders))) { hdrMap[k2] = parseApiHeaders(pExtraHeaders)[k2]; }
            body.custom_include_headers = JSON.stringify(hdrMap);
        }
    }
    /* ★ 20261023：一行一个 Key:Value / Key="Value；#开头为注释 */
    const parseLineMap = (raw) => {
        const out = {};
        for (const line of String(raw || '').split(/\r?\n/)) {
            const s0 = line.trim();
            if (!s0 || s0.charAt(0) === '#') { continue; }
            const m0 = s0.match(/^([^:=\s]+)\s*[:=]\s*(.+)$/);
            if (!m0) { continue; }
            let v = m0[2].trim();
            if (/^".*"$/.test(v) || /^'.*'$/.test(v)) { v = v.slice(1, -1); }
            out[m0[1].trim()] = v;
        }
        return out;
    };
    applyRequestTweaks(body, api);    const system = trimText(o.system);
    if (system) {
        body.messages.push({ role: 'system', content: system });
    }
    body.messages.push({ role: 'user', content: prompt });

    const timeoutMs = Number.isFinite(Number(o.timeoutMs)) ? Number(o.timeoutMs) : REQUEST_TIMEOUT_MS;
    const started = Date.now();
    const timeout = withTimeout(timeoutMs);
    let autoVia = '';
    /*
     * ⭐ U16（材料 12·未覆盖死角）：**自动切换要记住、也要告诉她** ✓
     *   旧：直接被挡 ⇒ 自动改走转发成功（或自动加前缀成功）✗
     *     但只把它藏在返回值的 `via` 里，上层没人读 ✗
     *     ⇒ 提点不告诉她、下一轮又从直连开始 ⇒ **每轮都先白撞一次墙** ✗
     *   现在：记进会话内的 `sessionViaHint` ✓，并弹**一次**提示 ✓
     *   （⛔ 改她的设置：只在本会话内生效，刷新页面就重置 ✓）
     */
    /*
     * ⭐⭐ 真机对照实验得到的通关组合：**假流式-**前缀的模型名 ＋ **走流式** ✓
     *   实测：普通名＋非流式 ⇒ Bad Request ✗；普通名＋流式 ⇒ 400 INVALID_ARGUMENT ✗；
     *         **假流式-**名＋流式 ⇒ **HTTP 200、真数据回来了** ✓✓
     *   ⇒ 失败且看到 Bad Request／INVALID_ARGUMENT 时，**自动加上这个前缀重试** ✓（⛔ 让她去改模型名 ✗）
     */
    let modelTry = model;
   /* ⭐ 直连被挡、自动改走转发时记下来 ✓ */

    try {
        /*
         * ⭐⭐ 她 15:xx：「**你不会修 api 连接吗**？还一直叫我换」
         *   真机取证：「直连」发 **POST** 时会被挡（CORS/网络层）⇒ `Failed to fetch` / `ERR_CONNECTION_RESET` ✗
         *   而「经酒馆转发」那条是能走的（只是慢 ✗）⇒ 原来直连一抛**直接判失败**，根本没去试转发 ✗
         *   ⇒ 现在：**直连抛了就自动改走转发再试一次** ✓（⛔ 让她手动切 ✗），并记下 via='proxy-auto' ✓
         */
        let res = null;
        /* ⭐ U16：上次已知直连会被挡 ⇒ **这次直接走转发**（⛔ 再白撞一次 ✗） */
        const preferProxy = (api.mode === 'direct' && sessionViaHint === 'proxy-auto');
        /* ⭐ U16：已知要加前缀 ⇒ 一开始就带上（⛔ 先撞一次再重试 ✗） */
        if (sessionViaHint === 'prefix-auto' && !/^假流式-/.test(modelTry)) {
            modelTry = '假流式-' + modelTry;
        }
        if (api.mode === 'direct' && !preferProxy) {
            try {
                res = await callDirect(url, key, modelTry, body, timeout.signal);
            } catch (eDirect) {
                /* ⚠️ 已经超时/取消就不再重试（重试也是白跑 ✗） */
                const aborted2 = eDirect && (eDirect.name === 'AbortError' || /abort/i.test(asText(eDirect && eDirect.message)));
                if (aborted2) { throw eDirect; }
                res = await callViaServer(url, key, modelTry, body, timeout.signal, o.cheap === true);
                if (res && res.ok) { autoVia = 'proxy-auto'; sessionViaHint = 'proxy-auto'; }
            }
            /*
             * ★ 20261022 ⑤（22 单）：**直连返回 HTTP 4xx/5xx（不是抛错）也要降级**。
             *   原来只有 catch 里才走转发 ⇒ callDirect 把 HTTP 错误变成返回值 ⇒ catch 不执行
             *   ⇒ **永远不降级**，白烧一次。
             */
            if (res && res.ok === false && /HTTP\s*[45]\d\d|直连失败/.test(String(res.reason || ''))) {
                const resVia = await callViaServer(url, key, modelTry, body, timeout.signal, o.cheap === true);
                if (resVia && resVia.ok) {
                    autoVia = 'proxy-auto';
                    sessionViaHint = 'proxy-auto';
                    res = resVia;
                }
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
            await retryPause(0);
            try {
                if (api.mode === 'direct') {
                    try { res = await callDirect(url, key, modelTry, body, timeout.signal); }
                    catch (eP1) {
                        /* ★ §④：已经超时／取消就⛔ 再打一次转发（白跑一趟） */
                        if (isAbortError(eP1)) { throw eP1; }
                        res = await callViaServer(url, key, modelTry, body, timeout.signal, o.cheap === true);
                    }
                } else {
                    res = await callViaServer(url, key, modelTry, body, timeout.signal, o.cheap === true);
                }
                if (res && res.ok) { autoVia = autoVia || 'prefix-auto'; sessionViaHint = sessionViaHint || 'prefix-auto'; }
            } catch (eP2) {
            /* ★ §④：不能空 catch（异常无声消失就没法查）；保持原结果，但留一行痕迹 */
            try { console.warn('[api] 重试路径异常（保持原结果）：' + asText(eP2 && eP2.message)); } catch (eW2) { }
        }
        }
        let loweredTo = 0;
        for (let guard = 0; guard < 3 && res && res.ok === false
            && /exceeds the maximum output tokens|max_tokens|maximum context length|too many tokens/i.test(String(res.reason || '')); guard += 1) {
            const cur = Number(body.max_tokens);
            if (guard === 2) {
                /* ⭐ 最后一招：**干脆不传 max_tokens** ✓（有些中转只在“字段存在”时才校验 ✓）
                 *   ⛔ JSON.stringify 会丢掉 undefined 属性 ⇒ 这个字段就不会出现在请求里 ✓ */
                delete body.max_tokens;
                loweredTo = -1;
            } else {
                const next = Math.max(256, Math.floor((Number.isFinite(cur) ? cur : 1024) / 2));
                if (!Number.isFinite(next) || (Number.isFinite(cur) && next >= cur)) { break; }
                body.max_tokens = next;
                loweredTo = next;
            }
            await retryPause(guard + 1);
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
            return { ok: false, reason: '模型回了空内容（可以试试调大输出上限或换模型）', ms, apiAttemptCount, apiAttemptFailures };
        }
        /* ⭐ U16：自动切换成功 ⇒ **告诉她一次**（同一会话只叫一次 ✓） */
        if (autoVia && !viaHintTold) {
            viaHintTold = true;
            try {
                const msgU16 = autoVia === 'proxy-auto'
                    ? '这一轮直连被挡，已自动改走转发并成功；今天这个会话里以后直接走转发（不再白撞一次）'
                    : '对面不认普通模型名，已自动加上前缀并成功；这个会话里以后直接带前缀发送'
                import('../ui/toast.js').then((m) => {
                    if (m && m.toast && typeof m.toast.info === 'function') { m.toast.info(msgU16); }
                }).catch(() => {});
            } catch (eU16) { /* 提示弹不出来也不能影响这一轮 ✓ */ }
        }
        return {
        ok: true, text, ms, via: (autoVia || res.via), finish: res.finish,
        apiAttemptCount, apiAttemptFailures, apiAcceptedAttempt: apiAttemptCount,
    };
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
/*
 * ⭐⭐ 修复 10（材料 01/06：12.3／12.4）：**地址后缀拼接对称化** ✓
 *   旧：直连模式填了**没带 /v1 的根域名**（只写到主机名、后面没有路径）⇒ **漏 /v1** ✗ ⇒ 拉不出模型/连不上 ✗
 *   现在：只对**纯根域名**（后面没有任何路径）补 `/v1` ✓
 *   ⛔ 带了路径的（如 /v1beta／/v1／自定义路径）**一律不碰** ✓（她填什么就是什么 ✓）
 */
function withVersionIfBareRoot(u) {
    const s = trimText(u);
    if (!/^https?:\/\/[^\/]+$/i.test(s)) {
        return s;
    }
    return s + '/v1';
}

/*
 * ⭐⭐ 材料 01（界面第 1 条）：**重试之间要有小退避** ✓
 *   她的原话：「一口气四连动」✗
 *   旧：直连失败⇒切转发⇒加假流式-前缀⇒砍 max_tokens 连试 3 次，**中间零间隔** ✗
 *     ⇒ 一秒内对公益站连打 3～5 枪 ✗ ⇒ 触发防刷限流、返回 null ✗
 *   现在：每一步重试前先等 ≈600ms / 1300ms / 2000ms ✓（不到一秒一枪 ✓）
 */
function retryPause(step) {
    const ms = 600 + Math.max(0, Number(step) || 0) * 700;
    return new Promise((resolve) => {
        try { setTimeout(resolve, ms); } catch (e) { resolve(); }
    });
}

export async function fetchModels(opts) {
    const api = (opts && opts.api) || resolveApi();
    const url = trimText(api.url);
    if (!url) {
        return { ok: false, reason: '没填接口地址（先把地址填上才能拉）' };
    }
    const base = url.replace(/\/+$/, '');
    const key = trimText(api.key);
    // ⚠️ 不能跟用户填的 `…/chat/completions` 拼错：把尾部那段切掉再接 `/models`
    const root = withVersionIfBareRoot(base.replace(/\/(chat\/)?completions$/i, ''));
    const ep = root + '/models';
    try {
        const res = await fetch(ep, {
            method: 'GET',
            headers: Object.assign({}, parseApiHeaders(api.extraHeaders), key ? { Authorization: 'Bearer ' + key } : {}),
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
 * ⭐⭐ 真机取证（第 48 轮）：有些报错**是对面服务自己吐的**，⛔ 我们的 bug ✗
 *   例：她那个中转（stapi.cc.cd）返回 500 “No environment variable set for provider: self-dploy”
 *   已证：酒馆源码里**没有**这句话 ✓、我们的 payload 全对（custom_url／密钥头）✓ ⇒ 只能是它报的 ✓
 *   ⇒ 把它翻译成人话，省得她（和我）去追自己的代码 ✓
 */
function providerHint(txt) {
    const s = String(txt == null ? '' : txt);
    if (/No environment variable set for provider/i.test(s)) {
        return '（⚠ 这是**对方服务自己**的报错：它内部那个 provider 没配密钥 —— 要修在它那边，⛔ 不是万象阁的问题）';
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
    noteApiAttempt();
    const ctx = getCtx();
    const headers = { 'Content-Type': 'application/json' };
    try {
        if (ctx && typeof ctx.getRequestHeaders === 'function') {
            Object.assign(headers, ctx.getRequestHeaders());
        }
    } catch (e) {
        // 拿不到就只用基础头
    }
    /*
     * ⭐⭐ 材料 01（界面第 1 条／06的 12.4）：**转发时把已带的后缀先切掉** ✓
     *   旧：`custom_url: url` 原样送给酒馆 ✗
     *     ⇒ 她若填了带 `/chat/completions` 的完整地址，酒馆会**再拼一次后缀** ✗ ⇒ 404 ✗
     *   现在：先把尾部那段切掉再交给酒馆 ✓（她填哪种写法都能跑 ✓）
     */
    const urlForServer = trimText(url).replace(/\/(chat\/)?completions$/i, '').replace(/\/+$/, '');
    const payload = {
        chat_completion_source: 'custom',
        custom_url: urlForServer || url,
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
        /* ⭐她 15:xx：失败时要把“真因”点名（⛔ 让她以为是本地的毛病 ✗） */
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
    noteApiAttempt();
    const base = url.replace(/\/+$/, '');
    const baseNorm = withVersionIfBareRoot(base);
    const endpoint = /\/chat\/completions$/.test(baseNorm) ? baseNorm : baseNorm + '/chat/completions';
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
 *   ⛔ 不能只会流式：有站不支持流式、直接回 JSON ✗ ⇒ 那就退回原来的读法 ✓
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
        const thought = asText(d.reasoning_content || d.reasoning || d.thought);
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
        /* ⭐修复 10（材料 02）：**认出“只在吐思考”** ✓
         *   有些模型（Gemini 3.x／DeepSeek R1 等）把思考放在 reasoning_content 里 ✗
         *   ⇒ 思考吃完额度就没正文 ✗ ⇒ 这里把它标出来、供下游报人话 ✓ */
        return { piece, finish, error: '', hadThought: Boolean(thought) };
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
 * ⭐ 自适应读取响应（⛔ 不看 Content-Type 头：酒馆 forwardFetchResponse 转发流式时不带该头）：
 *   1. 优先用 reader 边收边拼（真流式保活），无 reader 时退回 res.text() / res.json()（兼容离线自测）；
 *   2. 按内容自身特征判：含 `data:` 行或 SSE 事件流 ⇒ 逐行解析拼合 delta；否则走整包 JSON.parse（失败再回退逐行扫）；
 *   3. 若上游在 HTTP 200 流内塞了 {"error":...}，直接拎出真实错误原因。
 */
/** ★ §④：超时／取消的统一判定 */
function isAbortError(e) {
    return !!(e && (e.name === 'AbortError' || /abort/i.test(asText(e.message))));
}

export async function readMaybeStream(res) {
    let streamInterrupted = '';   /* ★ §②：非空 ⇒ 这段是残的（上层要能看到） */
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
            /*
             * ★ 20261023 依据＝阿砚 20 号 §②：**收到一半断连不能当“正常完成”**。
             *   ① 一字未收 ＋ AbortError ⇒ 仍 throw；
             *   ② 已收到内容 ＋ 异常 ⇒ 不抛，但返回值带 error（上层能显示“这段是残的”）；
             *   ③ 真的空 ⇒ 保持原来的空包处理。
             */
            const aborted = !!(eStream && (eStream.name === 'AbortError' || /abort/i.test(asText(eStream.message))));
            if (aborted && !trimText(rawText)) {
                throw eStream;
            }
            if (trimText(rawText)) {
                streamInterrupted = '流中断（已收 ' + String(rawText.length) + ' 字）';
                try { console.warn('[api] ' + streamInterrupted + '：' + asText(eStream && eStream.message)); } catch (eW) { }
            }
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
        return { text: null, finish: '', error: streamInterrupted || '响应体为空（0 字节）', raw: '' };
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
    let sawThought = false;

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
            const pieceRes = extractChunkPiece(j);
            const piece = pieceRes.piece;
            const finish = pieceRes.finish;
            const error = pieceRes.error;
            if (pieceRes.hadThought) { sawThought = true; }
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

    /* ⭐修复 10：收集“看到过思考块”的标志 ✓ */
    const out = trimText(acc);
    if (out) {
        return { text: out, finish: fin, error: streamInterrupted || '', raw: trimmed };
    }
    /* ⭐⭐ 修复 10：**“思考把额度吐完了”要报成人话** ✓
     *   旧：只回个 null ✗ ⇒ 她看到“怪东西”根本不知道去哪调 ✗ */
    if (sawThought || /length|max_tokens/i.test(fin)) {
        return {
            text: null,
            finish: fin || 'length',
            error: '模型在思考阶段就把「单次最多输出（max_tokens）」额度用光了，还没来得及输出正文 ⇒ 请去「自定义 API」把「单次最多输出」调大（建议 8000～16000）',
            raw: trimmed,
        };
    }
    if (streamErr) {
        return { text: null, finish: fin, error: streamErr, raw: trimmed };
    }
    // 兜底：若 SSE 没抠出内容，再试一次是不是单块 JSON 被误判
    if (looksLikeSse && !validFrames) {
        try {
            const data = JSON.parse(trimmed);
            return { text: readCompletionText(data), finish: readFinishReason(data), error: streamInterrupted || '', raw: trimmed };
        } catch (e) { /* 忽略 */ }
    }
    return { text: null, finish: fin, error: streamInterrupted || '', raw: trimmed };
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

/**
 * 依据＝阿砚第四批 4-b #2（结构化输出三级判定）：
 *   ① 严格解析成功 ⇒ strict
 *   ② 严格解析失败，但**整块完整**（括号配平且没被截断）⇒ raw-ok（收原始文本）
 *   ③ 否则 ⇒ soft-fail，带一句 `retryHint`（告诉模型下次该怎么改格式）
 * ⛔ 把 soft-fail 当硬错：带 retryHint 的失败，上游可以据此决定重试而⛔ 是直接判“格式坏”。
 */
export function diagnoseParse(text, opts) {
    const raw = asText(text);
    const parsed = extractJson(raw, opts);
    if (parsed.ok) {
        return { level: 'strict', retryHint: '', value: parsed.value, repaired: parsed.repaired === true };
    }
    const fin = String((opts && opts.finish) || '').toLowerCase();
    const truncated = parsed.truncated === true || /length|max_tokens|max_output_tokens/.test(fin);
    const body = raw.trim();
    const balanced = (() => {
        let curly = 0;
        let square = 0;
        let inStr = false;
        let esc = false;
        for (const ch of body) {
            if (inStr) {
                if (esc) { esc = false; } else if (ch === '\\') { esc = true; } else if (ch === '"') { inStr = false; }
                continue;
            }
            if (ch === '"') { inStr = true; continue; }
            if (ch === '{') { curly += 1; }
            if (ch === '}') { curly -= 1; }
            if (ch === '[') { square += 1; }
            if (ch === ']') { square -= 1; }
        }
        return curly === 0 && square === 0 && (curly + square) === 0;
    })();
    const looksWhole = body.length > 0 && !truncated && balanced && /[}\]]\s*$/.test(body);
    if (looksWhole) {
        return { level: 'raw-ok', retryHint: '', value: null, repaired: false, raw: body };
    }
    const retryHint = truncated
        ? '输出被截断：下次只给 JSON 本体、不要开场白；字段能短就短'
        : '输出不是完整 JSON：下次只输出一个从 { 开头、到 } 结尾的 JSON，⛔ 混说明文字、⛔ 截断';
    return { level: 'soft-fail', retryHint, value: null, repaired: false, truncated, raw: body };
}

export async function callModelJson(opts) {
    const res = await callModel(opts);
    if (!res.ok) {
        return { ok: false, reason: res.reason, retryHint: res.retryHint || '', ms: res.ms };
    }
    /*
     * 依据＝阿砚第四批 4-b #2（三级判定）：
     *   strict ⇒ 用解析值；raw-ok ⇒ **整块完整就收原始文本**；
     *   soft-fail ⇒ 失败并带 `retryHint`（告诉模型下次怎么改格式）。
     */
    const diag = diagnoseParse(res.text, { finish: res.finish });
    if (diag.level === 'strict') {
        return { ok: true, value: diag.value, ms: res.ms, repaired: diag.repaired === true, parseLevel: 'strict' };
    }
    if (diag.level === 'raw-ok') {
        return { ok: true, value: null, raw: diag.raw, ms: res.ms, parseLevel: 'raw-ok' };
    }
    return {
        ok: false,
        reason: diag.retryHint,
        retryHint: diag.retryHint,
        truncated: diag.truncated === true,
        raw: res.text,
        ms: res.ms,
        parseLevel: 'soft-fail',
    };
}
