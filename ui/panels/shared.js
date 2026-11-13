/* 公-1 基础构件：从 ui/sections.js 抽出（206 后第一批公共件），逻辑一字未改 */
import { asText, trimText } from '../../core/utils.js';
import { iconSvg } from '../icons.js';
import { titleNode, tidyText } from '../tidy-heads.js';



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
