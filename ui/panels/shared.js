/* 公-1 基础构件：从 ui/sections.js 抽出（206 后第一批公共件），逻辑一字未改 */
import { asText, trimText, toList, floorLabel, asArray } from '../../core/utils.js';
import { iconSvg } from '../icons.js';
import { titleNode, tidyText } from '../tidy-heads.js';
import { formatStamp } from '../../core/adapter.js';
import { getSettings } from '../../core/settings.js';
import { createCache } from '../../core/cache.js';



/* ------------------------------ 元素小件 ------------------------------ */

/**
 * 文案里的 `**这样**` → 真·粗体。
 *
 * 为什么：她的界面文案一直写着 `**整套**` 这种标记（我从注释一路带进正文了），
 * 真机上就**露出两个星号**，看着像没做完。
 * ⚠️ 用 createTextNode／strong 拼，⛔ 绝不用 innerHTML（文案里有她填的内容，不能当 HTML 解析）。
 */
const FMT_SPLIT = /\*\*([^*]+)\*\*/g;

/**
 * 把文案填进节点（`**这样**` → 真粗体）。
 * ⚠️ 导出是给**页头副题**用的（workspace.js 那份副题也要走这里，
 *    不然会露出 `**` 星号——真机截图看到过）。
 */
export function fillText(node, text) {
    const s = asText(text);
    node.textContent = '';
    if (typeof node.removeChild === 'function') {
        while (node.firstChild) {
            node.removeChild(node.firstChild);
        }
    }
    if (s.indexOf('**') < 0) {
        node.textContent = s;
        return;
    }
    let last = 0;
    FMT_SPLIT.lastIndex = 0;
    let m = FMT_SPLIT.exec(s);
    while (m) {
        if (m.index > last) {
            node.appendChild(document.createTextNode(s.slice(last, m.index)));
        }
        const strong = document.createElement('strong');
        strong.textContent = m[1];
        node.appendChild(strong);
        last = m.index + m[0].length;
        m = FMT_SPLIT.exec(s);
    }
    if (last < s.length) {
        node.appendChild(document.createTextNode(s.slice(last)));
    }
    FMT_SPLIT.lastIndex = 0;
}

export function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) {
        node.className = cls;
    }
    if (text !== undefined && text !== null) {
        fillText(node, text);
    }
    return node;
}

/**
 * 列表内空态块：带单色线条空盒 SVG 图标与一句话说明。
 *   依据＝阿砚第三批 质感 A8（空态不给话术）：第二个参数是「**为什么会自动有**」那句，她看一眼就知道不用自己填。
 */
export function emptyBlock(text, why) {
    const box = el('div', 'wxg-empty', text);
    if (trimText(why)) {
        box.appendChild(el('div', 'wxg-empty-why', trimText(why)));
    }
    const ico = document.createElement('span');
    ico.className = 'wxg-empty-ico';
    ico.setAttribute('aria-hidden', 'true');
    ico.innerHTML = iconSvg('empty-box');
    if (box.firstChild) {
        box.insertBefore(ico, box.firstChild);
    } else {
        box.appendChild(ico);
    }
    return box;
}

/** 整页作品化空态（参照构画／千千结）：单色线条图标 ＋ 一句话 ＋ 一个实心主按钮，居中留白 */
export function heroEmpty(text, btnLabel, btnAction, why) {
    const box = el('div', 'wxg-empty is-hero', text);
    if (trimText(why)) {
        box.appendChild(el('div', 'wxg-empty-why', trimText(why)));
    }
    const ico = document.createElement('span');
    ico.className = 'wxg-empty-ico';
    ico.setAttribute('aria-hidden', 'true');
    ico.innerHTML = iconSvg('empty-box');
    if (box.firstChild) {
        box.insertBefore(ico, box.firstChild);
    } else {
        box.appendChild(ico);
    }
    if (btnLabel && btnAction) {
        const act = el('div', 'wxg-empty-act');
        act.appendChild(button(btnLabel, btnAction, 'wxg-primary'));
        box.appendChild(act);
    }
    return box;
}

/**
 * 一段 = 一个**酒馆原生折叠抽屉**（inline-drawer）。
 *
 * 为什么这么改：原来 12 段 <h4> 全平铺，一打开就是 200 多个控件的墙
 * ⇒ 用酒馆自己的抽屉写法：她看着眼熟，窄栏里还能收起来。
 *
 * ⚠️ 挂载口径（这里连踩两次坑，写清楚）：
 *   返回的是**正文层**（内容都加在它上面，各处一行都不用改）。
 *   壳（标题＋小摘要＋箭头）挂在正文层自己的 `__wxgDrawer` 属性上 —— 一个直接属性引用，
 *   ⛔ 不用 WeakMap、不用临时中转对象（那些要么认不出、要么容易出岔子）。
 *   挂载时 `hangUp` 取出壳、把正文层放回壳里、整壳挂到宿主。
 */
export function section(title, hint, opts) {
    const o = opts || {};
    /*
     * ⚠️ 护栏：hint 必须是字符串（或空）。
     *    这里出过一次真事故：编年那段写成 `section('编年', '…', { open: true } + '⭐ …')`
     *    —— **对象拼字符串** ⇒ 拼出 "[object Object]⭐…"，于是
     *    ① hint 从来没显示过 ② `open` 也没传进去、"默认展开"从没生效。
     *    现在万一再写错，控制台立刻点名，⛔ 不再悄悄坏掉。
     */
    if (hint !== undefined && hint !== null && typeof hint !== 'string') {
        console.warn('[万象阁] 段「' + String(title) + '」的说明传的不是字符串（多半是把 { open: … } 拼进去了）：'
            + typeof hint);
    }
    const drawer = el('div', 'wxg-sec inline-drawer');
    /*
     * ⭐ 「调设置」那五页（外观／召回／读取控制／自定义 API／提示词）盖个标记：
     *   包里这五页的版式共同点是「**卡标题居中** ＋ 保存靠右下**」。
     *   ⛔ 给所有段都上：数据页（状态／世界／名册…）的卡标题居中反而难扫。
     */
    if (o.five) {
        drawer.setAttribute('data-wxg-five', '1');
    }
    /*
     * ⭐ 目标核对 2②：**段头不能带 ST 那两个 class**。
     *   病因：`inline-drawer-toggle` / `inline-drawer-header` 是**酒馆自带**的抽屉标记，
     *   ST 有一个**全局委托**会在点击时去翻 `.inline-drawer-content` 的**行内 display**；
     *   而我们自己的 CSS 用 `[data-wxg-open="1"] { display: block !important }` **压过行内样式**，
     *   且全库**没有任何地方会摘掉 `data-wxg-open`** ⇒ 两家抢同一次点击、
     *   **默认就开着的那几段（前 5 段）收不动**（她报的就是这个）。
     *   ⇒ 摘掉 ST 那两个 class（让它不再插手），开合**由我们自己接管**（见 `bindSectionEvents` 里的 `.wxg-sec-head` 分支）。
     *   ⚠️ `inline-drawer-content` 还留着（它只是个样式类，ST 那个处理器认的是 `-toggle`）。
     */
    const head = el('div', 'wxg-sec-head');
    head.setAttribute('data-action', 'toggle-sec');
    const titleWrap = el('div', 'wxg-sec-titlewrap');
    drawer.setAttribute('data-wxg-title', String(title));   /* 81：左栏要用原名取简称与 title */ titleWrap.appendChild(titleNode(el('b', 'wxg-sec-title'), title));   /* 81：段标题也去括号 */
    titleWrap.appendChild(el('span', 'wxg-sec-sum', o.summary ? asText(o.summary) : ''));
    head.appendChild(titleWrap);
    head.appendChild(el('div', 'inline-drawer-icon fa-solid fa-circle-chevron-down down'));
    drawer.appendChild(head);
    const body = el('div', 'wxg-sec-body inline-drawer-content');
    if (hint && typeof hint === 'string') {
        /*
         * ⭐ 段说明挂一个标记类。
         *    工作台里它是**页头的副题**（.wxg-ws-h1sub），所以这里那份要藏起来——
         *    不然同一句话会在页头和正文各出现一次（真机上截图看到过）。
         *    浮层/设置区那两个地方没有页头，这份照常显示。
         */
        body.appendChild(el('div', 'wxg-note wxg-sec-hint', hint));
    }
    drawer.appendChild(body);
    if (o.open) {
        drawer.setAttribute('data-wxg-open', '1');
    }
    // 壳记在正文层自己的属性上（直接引用，零魔法）
    body.__wxgDrawer = drawer;
    /*
     * ⭐ 副题给"页级大标题"用（工作台把这段当一页，标题＋副题挂在内容区顶上）。
     *    挂在壳上、而不是塞进正文——工作台里壳的标题行会被隐藏，副题由页头统一显示。
     */
    drawer.setAttribute('data-wxg-sub', trimText(hint));
    // ⚠️ 这两个标记只给**离线预览页**用（它没有酒馆那套 JS，得照标记判断哪几段是展开的）： ⛔ 不参与任何逻辑判断；我上一版把标记弄丢过，结果预览把每段正文都跳过了（只剩标题连成一坨）。
    body.setAttribute('data-wxg-sec', title);
    if (o.open) {
        body.setAttribute('data-wxg-open', '1');
    }
    return body;
}

/**
 * 一张卡：可选的卡头（`.wxg-card-h`）加内容。
 *   ⚠️ 上一次整块删 `compactCard` 时把它一起删了（实测 `card is not defined`，123 项真红），这里补回来。
 */

export function card(title) {
    const box = el('div', 'wxg-card');
    if (trimText(title)) {
        box.appendChild(titleNode(el('div', 'wxg-card-h'), title));   /* 81：造的当下去括号 */
    }
    return box;
}

/** 改一段标题旁的小摘要（⛔ 不放正文里占地方） */
export function setSectionSummary(box, text) {
    const drawer = box ? box.__wxgDrawer : null;
    const sum = drawer ? drawer.querySelector('.wxg-sec-sum') : null;
    if (sum) {
        sum.textContent = asText(text);
    }
}

/**
 * 一个"带标签的字段"：真 label（点标签能聚焦到输入框）＋ 控件。
 * ⭐ 原来是一堆 `span«世界钟»` + 裸 input 挤在一行，读起来像没做完的表单。
 */
export function field(labelText, control) {
    const wrap = el('label', 'wxg-field');
    wrap.appendChild(el('span', 'wxg-field-label', labelText));
    wrap.appendChild(control || el('span', 'wxg-note', '（缺控件）'));
    return wrap;
}


export function row(host, ...children) {
    const r = el('div', 'wxg-row');
    for (const c of children) {
        if (c) {
            r.appendChild(c);
        }
    }
    host.appendChild(r);
    return r;
}

/**
 * ⭐ 规整两列的"设置行"：**左边标签（右对齐成一条竖线）＋ 右边控件**。
 *
 * 复核方原话："「召回」那种数字行排成规整两列——左标签、右控件、对齐"。
 * 原来一行横着铺"标签 数字框 标签 数字框 标签 数字框"，眼睛得来回找。
 * ⛔ 只用于设置类行；卡片头、说明、列表照旧。
 *
 * @param {HTMLElement} host 挂到哪儿
 * @param {string} label 左列标签
 * @param {...HTMLElement} controls 右列控件（可多个，横着排）
 */
export function line(host, label, ...controls) {
    const r = el('div', 'wxg-line');
    r.appendChild(el('div', 'wxg-line-k', label));
    const v = el('div', 'wxg-line-v');
    for (const c of controls) {
        if (c) {
            v.appendChild(c);
        }
    }
    r.appendChild(v);
    host.appendChild(r);
    return r;
}

export function checkbox(id, label, checked, action) {
    const wrap = el('label', 'checkbox_label');
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.id = id;
    box.checked = checked === true;
    box.setAttribute('data-action', action);
    wrap.appendChild(box);
    wrap.appendChild(el('span', null, label));
    return wrap;
}

/** 颜色选择器（type=color），旁边给个"当前值"的小方块，她一眼看得出选了啥 */
export function colorInput(id, value, action) {
    const box = document.createElement('input');
    box.type = 'color';
    box.id = id;
    box.className = 'wxg-color';
    box.value = asText(value) || '#000000';
    box.setAttribute('data-action', action);
    return box;
}

export function textInput(id, value, placeholder, action, cls, type) {    const input = document.createElement('input');
    /* ⭐ 她 13:xx：「密钥那里不能自动隐藏」⇒ 支持传 'password'（默认遮住）✓ */
    input.type = type || 'text';
    input.id = id;
    input.className = 'wxg-pole ' + (cls || '');
    input.value = asText(value);
    if (placeholder) {
        input.placeholder = placeholder;
    }
    input.setAttribute('data-action', action || 'noop');
    return input;
}

export function numberInput(id, value, min, max, action) {
    const input = document.createElement('input');
    input.type = 'number';
    input.id = id;
    input.className = 'wxg-pole';
    input.min = String(min);
    input.max = String(max);
    input.step = '1';
    input.value = String(value);
    input.setAttribute('data-action', action);
    return input;
}

export function textarea(id, value, placeholder, action, rows) {
    const box = document.createElement('textarea');
    box.id = id;
    box.className = 'wxg-pole textarea_compact';
    box.rows = String(rows || 4);
    box.value = asText(value);
    if (placeholder) {
        box.placeholder = placeholder;
    }
    box.setAttribute('data-action', action);
    return box;
}

export function button(label, action, cls, id) {
    const b = el('button', 'menu_button ' + (cls || ''), label);
    b.setAttribute('data-action', action);
    if (id) {
        b.setAttribute('data-id', id);
    }
    return b;
}

export function select(id, options, value, action, id2) {
    const s = document.createElement('select');
    s.id = id;
    s.className = 'wxg-pole';
    s.setAttribute('data-action', action);
    if (id2) {
        s.setAttribute('data-id', id2);
    }
    for (const opt of options) {
        const o = document.createElement('option');
        o.value = asText(opt.value);
        o.textContent = asText(opt.label);
        if (asText(opt.value) === asText(value)) {
            o.selected = true;
        }
        s.appendChild(o);
    }
    return s;
}

/*
 * ⭐⭐ RD1（材料 11·渲染层）：**重绘不能把她正看着的折叠屎屉全关上** ✓
 *   旧：`foldable(..., false)` 硬编码 open=false ✗
 *     ⇒ 一发消息／一次后台更新，她在「提示词」里点开的「展开看这套」、
 *       在「人物名册」点开的「展开录入」、在「状态 → 进度」点开的「展开看是哪几楼」
 *       ⇒ **啪一下全关上** ✗
 *   现在：按**标题**记住展开与否 ✓，重绘时还原 ✓
 *   （空标题的不记：它们同名、会互串 ✗）
 */
export const foldOpenState = new Map();

export function foldable(summaryText, open) {
    const d = document.createElement('details');
    /*
     * 依据＝阿砚第三批 N1（召回页折叠后下半屏全白）——上一版把 min-height 挂错了地方：
     *   `<details>` 收起时仍在文档流里 ⇒ 三个收起的折叠头各被撑成 96px 空盒子（实机 369px 的来历）。
     *   现在：`<details>` 什么都不挂；最小高度交给内容容器（展开时才在文档里，见 mkFold）。
     */
    d.className = 'wxg-report';
    const s = document.createElement('summary');
    s.appendChild(el('span', null, summaryText));
    if (summaryText) {
        const chev = el('span', 'wxg-card-chevron wxg-fold-chevron', '▾');
        chev.setAttribute('aria-hidden', 'true');
        s.appendChild(chev);
    }
    d.appendChild(s);
    tidyText(s);   /* 77 号：折叠条标题也当场去括号（原文进 title） */
    const foldKey = trimText(summaryText);
    const rememberedOpen = foldKey ? foldOpenState.get(foldKey) : null;
    if (open === true || rememberedOpen === true) {
        d.open = true;
    }
    if (foldKey) {
        d.addEventListener('toggle', () => {
            foldOpenState.set(foldKey, d.open === true);
        });
    }
    return d;
}

export const PER_PAGE = { roster: 15, chron: 20, steps: 20 };

/**
 * ⭐ 翻页条（对照观棋那张：`‹ 上一页 ｜ 第 1-20 条 · 共 54 条 ｜ 下一页 ›`）。
 *
 * 为什么需要：名册灌到 54 个人之后，一长条滚到底**根本找不着人**——
 * 分页＋筛选＋搜索才是台账该有的用法。编年同理（越攒越多）。
 */
export function pager(action, page, per, total) {
    const pages = Math.max(1, Math.ceil(total / per));
    const cur = Math.min(Math.max(1, Math.round(page) || 1), pages);
    const bar = el('div', 'wxg-pager');

    const prev = button('‹ 上一页', action, 'wxg-btn-xs', String(cur - 1));
    if (cur <= 1) {
        prev.disabled = true;
    }
    bar.appendChild(prev);

    const from = total ? (cur - 1) * per + 1 : 0;
    const to = Math.min(total, cur * per);
    bar.appendChild(el('span', 'wxg-pager-info',
        total ? ('第 ' + String(from) + '–' + String(to) + ' 条 · 共 ' + String(total) + ' 条')
            : '一条都没有'));

    const next = button('下一页 ›', action, 'wxg-btn-xs', String(cur + 1));
    if (cur >= pages) {
        next.disabled = true;
    }
    bar.appendChild(next);

    if (pages > 1 && pages <= 12) {
        const nums = el('div', 'wxg-pager-nums');
        for (let i = 1; i <= pages; i += 1) {
            const b = button(String(i), action, 'wxg-btn-xs' + (i === cur ? ' is-on' : ''), String(i));
            nums.appendChild(b);
        }
        bar.appendChild(nums);
    }
    return bar;
}

/**
 * 把"目标页"夹到合法范围。
 * ⚠️ 夹在这里、不在处理器里（处理器只管存）：免得出现 page=0 或超出最后一页的空屏。
 */
export function clampPage(target, total, per) {
    const pages = Math.max(1, Math.ceil((Number(total) || 0) / per));
    const n = Number(target);
    return Math.min(Math.max(1, Number.isFinite(n) ? Math.round(n) : 1), pages);
}

/**
 * 种类 → 胶囊样式（⛔ 不按颜色名，按语义）：
 *   推演＝中性分类章 ｜ 暗线＝要注意 ｜ 警戒／越界＝警告 ｜ 其它＝中性
 */
export function kindTone(kind) {
    const k = asText(kind);
    if (k.includes('暗线')) {
        return 'is-warn';
    }
    if (k.includes('警戒') || k.includes('越界') || k.includes('退化')) {
        return 'is-warn';
    }
    return 'is-info';
}

/** 只取时分（列表里"哪条新"靠它，日期放到分组头；⛔ 不用完整时间戳占地方） */
export function shortTime(at) {
    const s = formatStamp(at);
    const m = s.match(/(\d{1,2}:\d{2})/);
    return m ? m[1] : s;
}

export function setStagingMode(v) { stagingMode = v; }

export const stagingByMode = {};
/* 110：上一次没保存的草稿（浏览器里那份） */
try {
    if (typeof localStorage !== 'undefined') {
        const rawDrafts = localStorage.getItem('wxg-drafts-v1');
        if (rawDrafts) {
            const parsed = JSON.parse(rawDrafts);
            for (const k of Object.keys(parsed || {})) { stagingByMode[k] = parsed[k]; }
        }
    }
} catch (eLS2) { /* 坏了就当没有 */ }

/** 当前正在画／正在处理的是哪一个宿主（⛔ 只用来分草稿，不参与别的判断） */
/**
 * 依据＝阿砚 3-d：偶发红要能在一次失败里拿到时序。默认静默；
 * 显式开关（WXG_DEBUG=1 或 globalThis.__WXG_DEBUG__）才打日志。
 */
export const WXG_DBG = (typeof process !== 'undefined' && process && process.env && process.env.WXG_DEBUG === '1')
    || (typeof globalThis !== 'undefined' && globalThis.__WXG_DEBUG__ === true);

export let stagingMode = 'settings';
/*
 * 依据＝阿砚 3-d: 偶发红取证（[pick]/[commit] 日志）：点击链本身对，红在“保存没写进去”。
 *   根因假设：`stage()` 用的池由当次事件的 host 决定，而 `commitSection()` 用的是**保存那一刻**的全局
 *   `stagingMode` —— 两处若落在不同池，保存就“读到空 box、写完什么也没有”，而且行为随重画时机漂移。
 *   ⇒ 记下“这一段草稿是在哪个池里建的”，保存与读值都认这个记录（⛔ 再各自读全局）。
 */
const stageModeOf = new Map();   // secId -> 建草稿时用的池

/** 这一段该用哪个池：有记录就按记录，没有才退回当前全局 */
export function modeForSection(secId) {
    const m = stageModeOf.get(secId);
    return m || stagingMode;
}

export function stagingOf(mode) {
    const m = asText(mode) || 'settings';
    if (!stagingByMode[m]) {
        stagingByMode[m] = {};
    }
    return stagingByMode[m];
}

/** 记一笔草稿（⛔ 不落设置）；同一段同一键只留最后一次 */
export function stage(secId, key, value) {
    const store = stagingOf(stagingMode);
    const box = store[secId] || (store[secId] = {});
    box[key] = value;
    stageModeOf.set(secId, stagingMode);
    /* 110：草稿也存一份在浏览器里 ⇒ 刷新不丢（落盘仍只靠「保存」） */
    try {
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem('wxg-drafts-v1', JSON.stringify(stagingByMode));
        }
    } catch (eLS) { /* 存不了也不能拦着画界面 */ }
}

/** 这一段草稿里有几处改动 */
export function stagedCount(secId) {
    const box = stagingOf(modeForSection(secId))[secId];
    return box ? Object.keys(box).length : 0;
}

/** 这一段某个键的"当前显示值"（草稿优先，其次已存） */
export function stagedValue(secId, key, fallback) {
    const box = stagingOf(modeForSection(secId))[secId];
    return box && Object.prototype.hasOwnProperty.call(box, key) ? box[key] : fallback;
}

/**
 * 段底那条"保存"（每段都有）。
 * @param {string} secId 段的标识（见各段自己的 id）
 * @param {string} label 按钮文字（默认"保存"）
 */
export function saveBar(secId, label) {
    const n = stagedCount(secId);
    const bar = el('div', 'wxg-savebar' + (n ? ' has-changes' : ''));
    bar.setAttribute('data-id', secId);
    const note = el('span', 'wxg-savebar-note',
        n ? ('改了 ' + String(n) + ' 处（还没保存）') : '这一段没有未保存的改动');
    bar.appendChild(note);
    if (n) {
        bar.appendChild(button('撤销', 'discard-section', 'wxg-btn-sm', secId));
    }
    bar.appendChild(button(label || '保存', 'save-section', n ? 'wxg-primary' : 'wxg-btn-sm', secId));
    return bar;
}

export let chronFilter = 'all';
export function setChronFilter(v) { chronFilter = v; }
export function setChronPage(v) { chronPage = v; }
/*
 * 依据＝阿砚第三批 质感 A4（编年没有搜索）：编年越攒越多，只能靠翻页找。
 *   加一个搜索词（搜正文／类型／人）；⛔ 落设置，只是“看的姿势”。
 */
export let chronSearch = '';
/**
 * ⭐「清空这个世界」的确认盒开着没有。
 * 她拍的：不可逆操作要**写明条数** ＋ **手打「确认清空」**才让点（防误点）。
 */
export let clearWorldOpen = false;
/** ⭐ 她 13:xx：钥匙默认遮住；点了「显示」就记住（模块级！⛔ 放进函数里 handler 看不见 ✗） */
export let apiKeyShown = false;
/** 要她手打的那四个字（打错就点不动） */
export const CLEAR_WORD = '确认清空';
/** 哪一条局势正展开着编辑（-1＝都没展开；行化之后默认收起，⛔ 不再一条占两行） */
export let openSituation = -1;

/** 过程报告的筛选（那一排小胶囊）：全部／已注入／未注入／失败 */
export let reportFilter = 'all';

/** 现在的进度的筛选：全部／已做／还没做 */
export let stepFilter = 'all';
export let stepPage = 1;
export function setStepPage(v) { stepPage = v; }

/** 名册的筛选：全部／玩家棋子／新认的／我改过的 */
export let rosterFilter = 'all';

    /** 名册的搜索词（搜“名字或别名”；⛔ 落设置，只是看的姿势） */
    export let rosterSearch = '';

/** 名册里哪一个人正展开着编辑（''＝都没展开） */
export let openChar = '';

/** 名册/编年的翻页（第几页从 1 数；⛔ 不落设置，只是看的姿势） */
export let rosterPage = 1;
export function setRosterPage(v) { rosterPage = v; }
export let chronPage = 1;
export let rosterSortDir = 'desc';
export function setRosterSortDir(v) { rosterSortDir = v; }
export let openRecordAt = -1;

export function setClearWorldOpen(v) { clearWorldOpen = v; }

export function setApiKeyShown(v) { apiKeyShown = v; }

export function setOpenSituation(v) { openSituation = v; }

export function setReportFilter(v) { reportFilter = v; }

export function setStepFilter(v) { stepFilter = v; }

export function setRosterFilter(v) { rosterFilter = v; }

export function setRosterSearch(v) { rosterSearch = v; }

export function setOpenChar(v) { openChar = v; }

export function setOpenRecordAt(v) { openRecordAt = v; }

export function setChronSearch(v) { chronSearch = v; }

export function effectiveAppearance() {
    const box = stagingOf(stagingMode).appearance;
    const draft = box && box.appearance;
    if (draft && typeof draft === 'object') {
        return draft;
    }
    return getSettings().appearance || {};
}

export function hostOf(url) {
    const s = asText(url);
    const m = s.match(/^[a-z]+:\/\/([^/]+)/i);
    return m ? m[1] : (s.length > 24 ? s.slice(0, 24) + '…' : s);
}

export const booksCache = createCache('worldbooks');   /* B7：带状态的缓存（hit/miss/empty/broken） */
export let listBooksCache = [];   /* 兼容：老代码读它；新代码读 booksCache */
export let lastGoodBooks = [];   /* 上一次真读到的书单（读不到时用它先顶着，⛔ 把列表清空） */
/* 依据＝本轮查“首跑红复跑绿”：自动列书的 setTimeout 每次重画都排一个 ⇒ 旧定时器晚到也去点按钮，把列表反复刷新 */
export let autoListTimer = null;
export function setAutoListTimer(v) { autoListTimer = v; }
export function setListBooksCache(v) { listBooksCache = v; }
export function setLastGoodBooks(v) { lastGoodBooks = v; }

export const unlockedCards = new Set();
export function lockable(cardEl, key) {
    if (!cardEl || !cardEl.classList) {
        return cardEl;
    }
    const open = unlockedCards.has(key);
    cardEl.classList.toggle('is-locked', !open);
    const oldBtn = cardEl.querySelector('.wxg-lock-btn');
    if (oldBtn && oldBtn.parentNode) {
        oldBtn.parentNode.removeChild(oldBtn);
    }
    const head = cardEl.querySelector('.wxg-card-h') || cardEl;
    const b = button(open ? '收起' : '编辑', 'toggle-lock', 'wxg-btn-xs wxg-lock-btn', key);
    if (head.appendChild) {
        head.appendChild(b);
    }
    cardEl.setAttribute('data-lock-key', key);
    /*
     * ⚠️ 真锁（readonly）不能在这儿做：调 `lockable(card(…), …)` 的时候
     *    **卡里还是空的**（输入框是后面 row()/textInput() 才加进去的）
     *    ⇒ 扫不到任何字段、一个 readonly 都上不去。真踩过。
     *    统一放到整页建完之后的 `applyLocks()` 里做。
     */
    return cardEl;
}

export let lastModelList = [];
export function paintModelChips(boxEl) {
    if (!boxEl || !boxEl.appendChild) {
        return;
    }
    while (boxEl.firstChild) {
        boxEl.removeChild(boxEl.firstChild);
    }
    if (!Array.isArray(lastModelList) || !lastModelList.length) {
        return;
    }
    const rowEl = el('div', 'wxg-chiprow');
    for (const nm of lastModelList) {
        const chip = el('button', 'wxg-chip', nm);
        chip.type = 'button';
        chip.setAttribute('data-action', 'pick-model');
        chip.setAttribute('data-name', nm);
        rowEl.appendChild(chip);
    }
    boxEl.appendChild(rowEl);
}
export function setLastModelList(v) { lastModelList = v; }

export let lastSectionsHost = null;
export function setLastSectionsHost(v) { lastSectionsHost = v; }

export function bindPersonCardDrag(pop) {
    const grip = pop.querySelector('.wxg-pc-head');
    if (!grip || typeof grip.addEventListener !== 'function') {
        return;
    }
    let sx = 0;
    let sy = 0;
    let ox = 0;
    let oy = 0;
    let on = false;
    const move = (e) => {
        if (!on) {
            return;
        }
        const t = e.touches ? e.touches[0] : e;
        /*
         * ⭐ LY3（材料 11·布局层）：**拖拽要夹在屏幕里** ✓
         *   旧：直接赋值 ✗ ⇒ 一旦把标题栏拖出屏幕顶边／侧边 ✗
         *     ⇒ **再也点不到标题栏拖回来**（卡片就困在外面 ✗）
         *   现在：至少留 80px 在屏幕内 ✓（⛔ 全部禁止拖出去——那样反而拖不动 ✓）
         */
        const vw = window.innerWidth || 1000;
        const vh = window.innerHeight || 800;
        const cardW = pop.offsetWidth || 560;
        const keepX = 80;
        const keepY = 40;
        const nx = ox + (t.clientX - sx);
        const ny = oy + (t.clientY - sy);
        pop.style.left = String(Math.max(keepX - cardW, Math.min(vw - keepX, nx))) + 'px';
        /* 五：拖拽也要夹在视口里（⌊L实际高算底边） */
        const cardH = pop.getBoundingClientRect ? pop.getBoundingClientRect().height : 0;
        const maxTop = Math.max(12, vh - 12 - (cardH || 0));
        pop.style.top = String(Math.max(12, Math.min(maxTop, ny))) + 'px';
        e.preventDefault();
    };
    const up = () => {
        on = false;
        document.removeEventListener('mousemove', move);
        document.removeEventListener('touchmove', move);
        document.removeEventListener('mouseup', up);
        document.removeEventListener('touchend', up);
    };
    grip.addEventListener('mousedown', (e) => {
        if (e.target && e.target.closest && e.target.closest('button, input, textarea')) {
            return;   // 点按钮／输入框不算拖
        }
        const r = pop.getBoundingClientRect ? pop.getBoundingClientRect() : { left: 0, top: 0 };
        on = true;
        sx = e.clientX;
        sy = e.clientY;
        ox = r.left;
        oy = r.top;
        pop.style.left = String(ox) + 'px';
        pop.style.top = String(oy) + 'px';
        pop.style.right = 'auto';
        document.addEventListener('mousemove', move);
        document.addEventListener('mouseup', up);
    });
    grip.addEventListener('touchstart', (e) => {
        if (e.target && e.target.closest && e.target.closest('button, input, textarea')) {
            return;
        }
        const t = e.touches[0];
        const r = pop.getBoundingClientRect ? pop.getBoundingClientRect() : { left: 0, top: 0 };
        on = true;
        sx = t.clientX;
        sy = t.clientY;
        ox = r.left;
        oy = r.top;
        pop.style.left = String(ox) + 'px';
        pop.style.top = String(oy) + 'px';
        pop.style.right = 'auto';
        document.addEventListener('touchmove', move);
        document.addEventListener('touchend', up);
    });
}

/**
 * ⭐ 「每轮记录」的浮层（照目标包：跟名册人物卡**同一套手法**）。
 *   标题栏＝⏿ 把手＋标题＋状态胶囊＋✕；
 *   正文＝已经拼好的那三块（①怎么挑的 ②实际送进请求的内容 ③回执）**原样搬过来**；
 *   底部＝关闭｜第 N 条 / 共 M 条｜下一条 ›。
 *   ⛔ 重写一份正文构造（那样两边会分叉）。
 */
export function renderRecordCard(rec, body, idx, total, statusText, tone, shownChars) {
    const host = document.getElementById('wxg-record-card');
    if (host && typeof host.remove === 'function') {
        host.remove();
    }
    const pop = el('div', 'wxg-pc wanxiangge');
    pop.id = 'wxg-record-card';
    pop.setAttribute('role', 'dialog');

    const head = el('div', 'wxg-pc-head');
    head.appendChild(el('span', 'wxg-pc-grip', '⏿'));
    const who = el('div', 'wxg-pc-who');
    who.appendChild(el('div', 'wxg-pc-name', shortTime(rec.at) + ' · ' + floorLabel(rec.floor)));
    who.appendChild(el('div', 'wxg-pc-alias', rec.injectStatus === 'ok'
        ? ('已注入 ' + String(shownChars) + ' 字')
        : '这一轮没注入'));
    head.appendChild(who);
    const badges = el('div', 'wxg-pc-badges');
    badges.appendChild(el('span', 'wxg-badge ' + (tone || ''), statusText));
    head.appendChild(badges);
    head.appendChild(button('✕', 'record-close', 'wxg-pc-x'));
    pop.appendChild(head);

    const sec = el('div', 'wxg-pc-sec');
    sec.appendChild(body);
    pop.appendChild(sec);

    const foot = el('div', 'wxg-pc-foot');
    foot.appendChild(button('关闭', 'record-close', 'wxg-pc-nav'));
    foot.appendChild(el('span', 'wxg-pc-counter', '第 ' + String(idx + 1) + ' 条 / 共 ' + String(total) + ' 条'));
    const prev = button('‹ 上一条', 'record-prev', 'wxg-pc-nav');
    prev.disabled = idx <= 0;
    foot.appendChild(prev);
    const next = button('下一条 ›', 'record-next', 'wxg-pc-nav');
    next.disabled = idx >= total - 1;
    foot.appendChild(next);
    pop.appendChild(foot);

    (lastSectionsHost || document.body).appendChild(pop);
    bindPersonCardDrag(pop);
}

const lastPaintSig = new WeakMap();   /* host ⇒ 上次画的签名（同签名就不重建） */
export function paintBookPicks(host, ex, no) {
    /*
     * 依据＝阿砚任务 3-d（连跑不稳要盯住）＋本轮实测 5/20 仍红：
     *   此前是“删掉全部芯片 → 重新建” ⇒ 重画窗口里她点下去会点在**已经被换掉的节点**上（事件不冒泡）⇒ 点了没反应。
     *   现在改成**原地更新**：按 data-book 找到已有按钮，改 class／文字／title；多的删、缺的补。
     *   ⇒ 重画期间按钮节点始终存在，点击不会丢。
     */
    if (ex === undefined || no === undefined) {
        const exDraft = toList(stagedValue('extract', 'extractBooks', getSettings().extractBooks));
        const noDraft = toList(stagedValue('extract', 'excludeBooks', getSettings().excludeBooks));
        if (ex === undefined) { ex = exDraft; }
        if (no === undefined) { no = noDraft; }
    }
    const wrap = host && host.querySelector ? host.querySelector('#wxg-bookpick') : null;
    if (!wrap) {
        return;
    }
    const exSet = new Set((ex || []).map((x) => asText(x)));
    const noSet = new Set((no || []).map((x) => asText(x)));
    const want = (Array.isArray(listBooksCache) ? listBooksCache : []).map((x) => asText(x));
    const wantSet = new Set(want);
    /* 先删掉不该在的（只在书单真的变少时才动，避免无谓重建） */
    for (const child of asArray(wrap.querySelectorAll ? wrap.querySelectorAll('[data-action="pick-book"]') : [])) {
        const book = String(child.getAttribute && child.getAttribute('data-book') || '');
        if (!wantSet.has(book)) {
            wrap.removeChild(child);
        }
    }
    /* 再原地更新/补齐（顺序按 want，把节点挪到正确位置） */
    let anchor = wrap.querySelector ? wrap.querySelector('.wxg-pick-head') : null;
    for (const n of want) {
        let b = wrap.querySelector ? wrap.querySelector('[data-action="pick-book"][data-book="' + n.replace(/"/g, '\\"') + '"]') : null;
        if (!b) {
            b = document.createElement('button');
            b.type = 'button';
            b.setAttribute('data-action', 'pick-book');
            b.setAttribute('data-book', n);
        /*
         * 依据＝本轮取证（pick 失败点已从“找不到控件”变为“草稿状态”）：
         *   芯片只带 `data-book`，而全站其他控件都用 `data-id` 做身份；
         *   按 `data-id` 取芯片的代码（含自测）会落到“第一颗”上 ⇒ 点的不是同一本书。
         *   这里把同一个名字同时写进 data-id（不改 data-book，⛔ 打破旧选择器）。
         */
        b.setAttribute('data-id', n);
        }
        const inEx = exSet.has(n);
        const inNo = noSet.has(n);
        b.className = 'wxg-pick' + (inEx ? ' is-on' : '') + (inNo ? ' is-off' : '');
        b.textContent = n + (inEx ? '（提取）' : (inNo ? '（排除）' : ''));
        b.title = inEx ? '在「提取」名单里（还没保存；再点＝改排除）'
            : (inNo ? '在「排除」名单里（还没保存；再点＝拿掉）' : '点一下＝要读它');
        /* 位置对齐：如果它不在 anchor 后面，就挪过去 */
        if (anchor) {
            if (anchor.nextSibling !== b) {
                wrap.insertBefore(b, anchor.nextSibling);
            }
            anchor = b;
        } else {
            if (b.parentNode !== wrap) { wrap.appendChild(b); }
            anchor = b;
        }
    }
}
/**
 * 把"正在看的那本书"的条目小块摆回面板（点一条之后重画，接着还能点）。
 * 数据来自 list-entries 抓到的 `pickEntries`，⛔ 不再重复读世界书。
 */
/** ⭐ 3③：条目列表的筛选词（她输什么就只显示带它的） */
