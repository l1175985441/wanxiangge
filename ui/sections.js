/**
 * 万象阁 · 面板内容（一份内容，两处使用）
 *
 * 同一套分节既渲染进**独立面板**（ui/shell.js 开的窗口），也渲染进**扩展设置区**里那一块。
 * ⛔ 不各写一套，免得两边长歪。
 * 事件一律**委托**绑在宿主上：每次重画都不丢监听，也不会重复绑。
 */

import {
    STAGES_CONFLICT, STAGES_PROGRESS, TIERS, ROSTER_PRESET,
} from '../core/config.js';
import { storageReport, formatStamp, getChat } from '../core/adapter.js';
import { getSettings, patchSettings, effectivePrompt, setAllPromptsDefault } from '../core/settings.js';
// ⭐ 删／清空那一组（她自己按的）：编年单条删、清空编年、清空这个聊天的世界。
//    ⚠️ 注释要写在 import **外面**——写进名单里会被"import 名字都对得上"那条静态检查当成名字（它逮过我一次）。
// ⭐ 浮层人物卡要用 findCharacter（按 id 取那一位；⛔ 不是 findCharacterByName）
import {
    getRoster, loadState, saveState, addCharacter, addCharacters, removeCharacter, updateCharacter, findCharacterByName,
    findCharacter,
    applyRosterPreset, describeRoster, describeWorld, recentRecallRecords, getChronicle,
    removeHidden, addHiddenManually, rollbackLast, snapshotCount, exportState, updateWorld,
    updateQuest, removeQuest, addChronicle,
    removeChronicleAt, clearChronicle, clearWorldLedger, ledgerClearPreview,
    addKnow, removeKnow,
} from '../core/state.js';
import { receiptText, ledgerText } from '../core/ledger.js';
import { toList, trimText, asText, asArray, countChars, floorLabel, FLOOR_NOTE } from '../core/utils.js';
import {
    PALETTE_KEYS, PALETTE_NAMES, resolveAppearance, applyAppearance, palettePatch,
} from './theme.js';
import { questStats } from '../core/summary.js';
// ⭐ 补⑤ 体检报告（自检）
import { buildHealthReport } from '../core/health.js';
// ⭐ 版本从 config 取（⏔ 从 index.js import：那会绕成循环 index→sections→index）
import { APP_VERSION } from '../core/config.js';
import { replanCurrentFloor } from '../core/actions.js';
import { listWorldbookNames, getEntries } from '../core/worldbook.js';
// ⭐ 读书 v2：全读进来 → 模型自己分 → 人物→名册、势力／局势→世界状态
import { importBookWiki } from '../core/book-wiki.js';
import { channelReport } from '../core/wb-channel.js';
import { clockWentBackwards } from '../core/clock.js';
import { publishToBook } from '../core/book.js';
import { runUpdate, cancelUpdate, runReconcile } from '../core/pipeline.js';
import { mergeCharacters, autoDetectDuplicates } from '../core/merge.js';
import { toast } from './toast.js';
// ⭐ 悬浮小框的显隐要在「总控」里能开关（那颗 ✕ 的提示一直承诺着，但控件一直没做）
// ⭐ 复审追加 3②：保存外观段后要**即时**刷小框（⏔ 等下次切档）
import { mountMini, closeMini, refreshMini } from './mini.js';
import { iconSvg } from './icons.js';

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

function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) {
        node.className = cls;
    }
    if (text !== undefined && text !== null) {
        fillText(node, text);
    }
    return node;
}

/** 列表内空态块：带单色线条空盒 SVG 图标与一句话说明 */
function emptyBlock(text) {
    const box = el('div', 'wxg-empty', text);
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
function heroEmpty(text, btnLabel, btnAction) {
    const box = el('div', 'wxg-empty is-hero', text);
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
function section(title, hint, opts) {
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
     *   ⏔ 给所有段都上：数据页（状态／世界／名册…）的卡标题居中反而难扫。
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
    titleWrap.appendChild(el('b', 'wxg-sec-title', title));
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
    // ⚠️ 这两个标记只给**离线预览页**用（它没有酒馆那套 JS，得照标记判断哪几段是展开的）：
    //    ⛔ 不参与任何逻辑判断；我上一版把标记弄丢过，结果预览把每段正文都跳过了（只剩标题连成一坨）。
    body.setAttribute('data-wxg-sec', title);
    if (o.open) {
        body.setAttribute('data-wxg-open', '1');
    }
    return body;
}

/**
 * ⭐ 一个"块"（卡片）—— 体检结论说得很对：**壳是设计过的、里子跌回表单**。
 * 内容得先装进结构：一个主题一块卡（浅描边＋块头一行小字），别全都平铺在一个大平面上。
 *
 * @param {string} title 块头那行小字（例："世界钟" / "好感来源"）；留空＝不带块头
 * @returns {HTMLElement} 往它上面加东西即可
 */
function card(title) {
    const box = el('div', 'wxg-card');
    if (trimText(title)) {
        box.appendChild(el('div', 'wxg-card-h', title));
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
function field(labelText, control) {
    const wrap = el('label', 'wxg-field');
    wrap.appendChild(el('span', 'wxg-field-label', labelText));
    wrap.appendChild(control || el('span', 'wxg-note', '（缺控件）'));
    return wrap;
}

function row(host, ...children) {
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
function line(host, label, ...controls) {
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

function checkbox(id, label, checked, action) {
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
function colorInput(id, value, action) {
    const box = document.createElement('input');
    box.type = 'color';
    box.id = id;
    box.className = 'wxg-color';
    box.value = asText(value) || '#000000';
    box.setAttribute('data-action', action);
    return box;
}

function textInput(id, value, placeholder, action, cls) {    const input = document.createElement('input');
    input.type = 'text';
    input.id = id;
    input.className = 'text_pole ' + (cls || '');
    input.value = asText(value);
    if (placeholder) {
        input.placeholder = placeholder;
    }
    input.setAttribute('data-action', action || 'noop');
    return input;
}

function numberInput(id, value, min, max, action) {
    const input = document.createElement('input');
    input.type = 'number';
    input.id = id;
    input.className = 'text_pole';
    input.min = String(min);
    input.max = String(max);
    input.step = '1';
    input.value = String(value);
    input.setAttribute('data-action', action);
    return input;
}

function textarea(id, value, placeholder, action, rows) {
    const box = document.createElement('textarea');
    box.id = id;
    box.className = 'text_pole textarea_compact';
    box.rows = String(rows || 4);
    box.value = asText(value);
    if (placeholder) {
        box.placeholder = placeholder;
    }
    box.setAttribute('data-action', action);
    return box;
}

function button(label, action, cls, id) {
    const b = el('button', 'menu_button ' + (cls || ''), label);
    b.setAttribute('data-action', action);
    if (id) {
        b.setAttribute('data-id', id);
    }
    return b;
}

function select(id, options, value, action, id2) {
    const s = document.createElement('select');
    s.id = id;
    s.className = 'text_pole';
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

function foldable(summaryText, open) {
    const d = document.createElement('details');
    d.className = 'wxg-report';
    const s = document.createElement('summary');
    s.appendChild(el('span', null, summaryText));
    if (summaryText) {
        const chev = el('span', 'wxg-card-chevron wxg-fold-chevron', '▾');
        chev.setAttribute('aria-hidden', 'true');
        s.appendChild(chev);
    }
    d.appendChild(s);
    if (open) {
        d.open = true;
    }
    return d;
}

/* ------------------------------ 分节 ------------------------------ */

function secStatus(host, intoSelf) {
    /*
     * ⭐ 三页并一页（复核方："这三个是不是应该坐到一个地方？"）
     *    账本状态／现在的进度／过程报告 —— 原来分三页，其实是同一件事的三个切面：
     *    存没存、跑到哪楼、每轮到底送进去什么。
     *    ⏐ 内容一样不少，只是不再各占一个屏。
     */
    const box = section('状态',
        '账本存没存、引擎跑到哪楼、每轮到底送进去什么——'
        + '原来分三页，其实是同一件事。',
        { open: true });
    /*
     * ⭐ 「现在怎么样」这张卡**壳撕了**（照状态页目标态的 ⏔ 清单：
     *   它的信息＝每轮记录最新一条，重复）。
     *   ⚠️ 但里面那几行**一条都没丢**：
     *     · 存档行（✓ 已存进聊天档…）—— 目标包要它并进「进度」框的框底（下一步做）
     *     · 世界四值（局势／暗线／编年／可撤回）—— 将来是「世界」那个框
     *   ⇒ 先只把**外壳**去掉（不再是一张叫「现在怎么样」的卡），行原地留着。
     */
    /*
     * ⭐ 两框布局（照目标包：上排两框「进度｜世界」，下排整条「每轮记录」）。
     *   ⏔ 再一堆竖着摆（原来就是一堆，看不出"两件事"）。
     *   ⭐ 存档行与「上次更新」按包里要求**并进左框的框底**。
     */
    /*
     * ⭐ 右上「功能 ⋮」（照目标包：状态页页头右上也有一个）。
     *   跟名册页那颗**同一个做法**（⏔ 两套）。
     */
    const sTop = el('div', 'wxg-roster-topbar');
    const sFunc = button('功能 ⋮', 'status-func', 'wxg-func-btn');
    sFunc.title = '导出与统计／可撤回的版本（入口位；包里就是这么标的）';
    sFunc.style.height = '28px';
    sFunc.style.minHeight = '28px';
    sFunc.style.lineHeight = '26px';
    sFunc.style.padding = '0 12px';
    sFunc.style.whiteSpace = 'nowrap';
    sTop.appendChild(sFunc);
    // ⭐ 补⑤：「体检」入口（点一下出一份自检）
    const sHeal = button('体检', 'health-open', 'wxg-func-btn');
    sHeal.title = '出一份自检：版本／开关／条数／最近失败分类（⏔ 不含正文与钥匙）';
    sHeal.style.height = '28px';
    sHeal.style.minHeight = '28px';
    sHeal.style.lineHeight = '26px';
    sHeal.style.padding = '0 12px';
    sHeal.style.whiteSpace = 'nowrap';
    sHeal.style.marginRight = '6px';
    sTop.insertBefore(sHeal, sFunc);
    box.appendChild(sTop);

    const two = el('div', 'wxg-two');
    const colProg = el('div', 'wxg-col');
    const report = storageReport();
    const line = el('div', 'wxg-store', report.text);
    line.setAttribute('data-tone', report.tone);
    const ledgerLine = el('div', 'wxg-ledger', '上次更新：' + ledgerText());
    const world = describeWorld();
    // ⭐ 目标核对 4：这一行是**数据标签**（世界钟／局势／暗线／编年／可撤回），⏔ 说明小字
    //   ⇒ 单独给一个类，强调里把它**升到接近正文**（见 css 的 .wxg-wsum）。
    const worldNote = el('div', 'wxg-note wxg-wsum',
        '世界钟：' + world.clock
        + (world.place ? ' · ' + world.place : '')
        + ' ｜ 局势 ' + String(world.situations)
        + ' ｜ 暗线 ' + String(world.hidden) + '（在走 ' + String(world.advancing) + '）'
        + ' ｜ 编年 ' + String(world.chronological)
        + ' ｜ 可撤回 ' + String(snapshotCount()) + ' 版');
    /*
     * ⚠️ 这段原来是「现在怎么样」卡里那组操作钮（`cAct`）——**已经没人挂它了**
     *   （操作改挂总控页操作卡 ＋ 悬浮球）⇒ 留着就是**死代码**（每次重画白拼一遍）。删掉。
     */
    /*
     * ⭐ 修复单 #31(b)：这里原来还有**一份重复的「清空确认盒」**（id `wxg-clear-typing`）——
     *   但它的**入口只在总控页**（`clear-world-open` 全库只有那一处）
     *   ⇒ 状态页这份**永远没有人能点出来**（死代码），
     *   而且它那个写死的 id 还把事件处理的 fallback **引到了旧份**上（已一并修）。
     *   ⇒ 整块撕掉；她要的那份在**总控页**（输入框 id = `wxg-clear-typing-general`）。
     */
    /*
     * ⭐ 「操作」卡**撕了**（照状态页目标态的 ⛔ 清单：「操作卡」✔️ 已移出）。
     *   它改挂到**两处**，两处合起来就是原来那 7 钮、**一处不差**：
     *     · 总控页 →「操作」卡（v0.2.71）
     *     · 悬浮球 → 头部「更新」＋操作区 6 钮（v0.2.72）
     *   她 2026-10-15 00:45「设置加操作，悬浮球也加上，**双重保险**」——
     *   ⚠️ **先接住、再撕**：那两处都做好了才能撕这里（⛔ 先撕＝她摸不到）。
     */

    /*
     * ⭐ 进度（原「现在的进度」那一整块）⇒ 摆进**左框**；
     *   世界四值 ⇒ 摆进**右框**；两框并排（照目标包：上排两框）。
     */
    secSteps(host, colProg);
    /*
     * ⭐ 存档行／上次更新 ⇒ 收进**进度卡里面**（包里要的是「框底一行」，
     *   ⏔ 只是"跟在卡下面"）。
     *   做法：`secSteps` 已经把卡挂进 colProg 了 ⇒ 把这两行**挪进那张卡**。
     *   拿不到卡就退回原样（⏔ 为了排版把信息弄丢）。
     */
    const progCard = colProg.querySelector ? colProg.querySelector('.wxg-card') : null;
    if (progCard) {
        progCard.appendChild(line);
        progCard.appendChild(ledgerLine);
    } else {
        colProg.appendChild(line);
        colProg.appendChild(ledgerLine);
    }
    two.appendChild(colProg);
    /*
     * ⭐ 修复单 #31(a)：右框补**对称的标题结构**。
     *   原来它只是 `wxg-plain` 里孤零零一行小灰字，而左框是**一张带标题的卡** ⇒
     *   上排两框看着不像一对（真机截图 01-状态 可证：右上只有两条小灰字、没卡片标题）。
     *   ⇒ 用跟左框**同一个** `.wxg-card`＋`.wxg-card-h` 结构（⏔ 自己发明新样式）。
     *   ⚠️ 标题用她熟的叫法「世界四值」（跟页内其他地方一致）。
     */
    const cWorld = card('世界四值');
    cWorld.appendChild(worldNote);
    two.appendChild(cWorld);
    box.appendChild(two);

    const p = loadState().pipeline || {};
    /*
     * ⭐⭐「更新流水」**整块删了**（2026-10-15 她亲口定的：「那个每轮记录那里也能体现出失败的那个呀，
     *   更新流水的确重复了」）。
     *
     * ⚠️ 我上一轮多虑了：我以为它"报的是正在跑／失败／与手改冲突"、删了就违反"失败必须可见"。
     *   查证结果——**每轮记录本来就报失败**：
     *     · `statusOf()` 里就有「失败」这一档（`injectStatus === 'error'`）
     *     · 筛选胶囊里也摆着「失败」
     *   ⇒ 失败**在两处可见**，这里确实是重复的。以她的话为准。
     *
     * ⭐ 只留一样东西：**与她的手改冲突那几句**——那不是"流水"，
     *   那是"你手改的版本被保住了"的提醒，删了才是真丢信息。
     */
    if (Array.isArray(p.conflicts) && p.conflicts.length) {
        const cWarn = el('div', 'wxg-plain');
        const warn = el('div', 'wxg-store', '与你的手改冲突（引擎**按你的版本保留**，内容没被冲掉）：');
        warn.setAttribute('data-tone', 'bad');
        cWarn.appendChild(warn);
        for (const c of p.conflicts) {
            cWarn.appendChild(el('div', 'wxg-fact', '· ' + asText(c)));
        }
        box.appendChild(cWarn);
    }
    /*
     * ⭐「每轮记录」（原「过程报告」）也并进这一页——它就是"一行一楼"那张表，
     *    跟上面的进度是同一件事的两面：一个看数量，一个看**到底送了什么**进去。
     *    ⛔ 不删内容，只是不再单占一个屏。
     */
    secReport(host, box);
    if (!intoSelf) {
        host.appendChild(box);
    }
}

/**
 * 总控：只放"整台怎么跑"的开关。
 * ⚠️ 原来这里第一个是「启用万象阁」——**冗余**（她点出来的）：酒馆扩展列表里勾上了，
 *    插件就是启用的；再放一个总闸＝两个开关管同一件事，关哪个都容易搞混。⇒ **去掉**。
 *    想停就在酒馆的扩展列表里关它。
 * 卡片那两个开关搬到「召回」段（那是卡片自己的事），这里只留"更新"有关的。
 */
function secGeneral(host) {
    const SECID = 'general';
    const s = getSettings();
    const box = section('总控', '整台怎么跑：自动更新、频率、启动行为。'
        + '（要停用整个插件 ⇒ 去酒馆的扩展列表里关它，这里不再放第二个总闸）',
        { open: true });

    const cRun = card('更新与节流');
    cRun.appendChild(checkbox('wxg-auto-update', '新楼生成后自动更新（关掉＝只手动更新）', s.autoUpdate, 'stage-auto-update'));
    row(cRun,
        field('更新频率', numberInput('wxg-update-every', s.updateEvery, 1, 10, 'stage-update-every')),
        el('span', 'wxg-note', '楼推进一次（1回合＝2楼；自动更新默认留一层缓冲只算已落定的楼，重 roll 同楼不重跑；想当场算最新楼点「立刻更新」）'));
    /*
     * ⭐ 自动 + 频率 1 ⇒ 明确提示"建议停在上一轮"（复核方问的就是这个）。
     *    为什么建议：新楼一出现就算它，可那时你还能改／能重 roll／能撤回，
     *    引擎先算一遍是**白烧额度**，算出来的状态还可能对应一版不存在的正文。
     *    ⛔ 不偷偷改她存的值——把话说明白＋给一颗一键改的按钮，改不改她定。
     */
    if (s.autoUpdate && Number(s.updateEvery) <= 1) {
        const tip = el('div', 'wxg-note wxg-advice');
        tip.appendChild(el('span', null, '⚠ 自动更新 + 频率 1 ⇒ 你刚发出去那楼会被**立刻**算一遍；'
            + '但那时你还能改、能重 roll、能撤回，引擎这一趟会白烧额度。建议改成 2（停在上一轮，只算落定的楼）。'));
        tip.appendChild(button('改成 2（推荐）', 'use-hold-one', 'wxg-btn-xs'));
        cRun.appendChild(tip);
    }
    cRun.appendChild(checkbox('wxg-protected', '现场保护：正文刚演过的人，本轮只带状态、不重复推演', s.protectedBypass, 'stage-protected'));
    cRun.appendChild(checkbox('wxg-strict', '严格模式：只带本轮点名的人', s.strictMention, 'stage-strict'));
    box.appendChild(cRun);

    const cUi = card('入口与启动');
    cUi.appendChild(checkbox('wxg-panel-open', '打开酒馆时自动弹出工作台／面板', s.showPanelOnStart, 'stage-panel-on-start'));
    /*
     * ⭐「把悬浮小框叫回来」——补一个**早就该有**的开关：
     *    小框上那颗 ✕ 的提示一直写着"藏起来（「总控」里能再叫出来）"，
     *    但总控里根本没这个控件 ⇒ 藏了就再也回不来，
     *    连带"手动更新"也失去了唯一的就近入口（复核方问的正是这个）。
     * ⚠️ 它不在 saveBar 那一批里：勾了要**立刻挂载/收起**，⛔ 不等"保存"。
     */
    cUi.appendChild(checkbox('wxg-ball-show', '显示悬浮小框（聊天时常驻，点一下进工作台；手动更新也在它上面）',
        (s.mini && s.mini.show) === true, 'toggle-mini-show'));
    box.appendChild(cUi);

    /*
     * ⭐ ③ 操作（目标包「总控页」第三张卡）。
     *   她 2026-10-15 00:45 令：「设置加操作，悬浮球也加上，**双重保险**」——本卡＝双重保险的一半。
     *   ⚠️ 这 7 钮＝**从状态页移出的那一组**：先在本页**接住**，
     *     等悬浮球也接上了，才能把状态页那张卡撕掉（⏔ 先撕＝她就摸不到了）。
     */
    const cOps = card('操作');
    const opsRow = el('div', 'wxg-card-actions');
    row(opsRow, button('立刻更新', 'update-now', 'wxg-primary'), button('撤回上一次', 'rollback'),
        button('重算本楼', 'replan'));
    /*
     * ⭐ 首夜实测单第 3 条：补推前给**范围**（留空＝全部，向后兼容）。
     *   她原话：「我也不知道他补齐了多少楼？这旁边也没有自己设定的，我可以自己设定要补齐多少楼层。」
     */
    const bfRow = el('div', 'wxg-card-actions');
    bfRow.appendChild(el('span', 'wxg-note', '补推范围：'));
    const bfN = textInput('wxg-backfill-n', stagedValue(SECID, 'backfillN', getSettings().backfillN || ''),
        '补最近几楼（留空＝全部）', 'stage-backfill-n', 'wxg-short');
    bfN.setAttribute('title', '例：填 5 ⇒ 只补最近 5 层你的发言；留空 ⇒ 从最早补到现在（老行为）');
    bfRow.appendChild(bfN);
    opsRow.appendChild(bfRow);
    row(opsRow, button('对账（账与楼对齐）', 'reconcile'), button('写入世界书', 'publish-book'),
        button('补推历史', 'backfill'));
    /*
     * ⭐ 首夜实测单第 2 条（她原话：「我们取消的按钮都没有见到……想按个取消也没有见到」）：
     *   `cancel-update` 的 handler 一直**在**（本文件 ~L5278），但**按钮从来没被创建过**（孤儿）——
     *   而「补推」的 toast 却承诺"可随时取消" ⇒ **说了有、实际没有**。
     *   ⇒ 这里接上：**跑中就地出现**（就在这些操作钮旁边），跑完自动收起。
     *   ⚠️ 只在跑中渲染（她不用对着一个永远点不动的"取消"发呆）。
     */
    {
        const pipe = (loadState() && loadState().pipeline) || {};
        const running = !!pipe.step && pipe.step !== 'done' && pipe.step !== 'idle';
        if (running) {
            row(opsRow, button('取消（正在跑）', 'cancel-update', 'wxg-del'));
        }
    }
    row(opsRow, button('清空这个世界', 'clear-world-open', 'wxg-del'));
    /*
     * ⭐ 首夜实测单第 4 条（她原话：「我也不知道他更新到什么东西了，**还得翻到总空那里去看看**」
     *   ＋「第一次点了一下推了八成……第二次按完才推完，还是翻到那个地方才看到他推了多少」）：
     *   progress 文案**早就存在**（`pipeline.js` 的「准备补推 N 个楼层」／「补推中：第X楼（n/total）」／
     *   「补推中断：…（已完成 X 楼）」），但**只渲在【状态】页** ⇒ 操作在总控、进度在状态，中间隔一次翻页 ✗
     *   ⇒ 这里把进度**搬到操作钮旁边就地显示**（同一个数据源 `loadState().pipeline`），
     *     并**自带一个小自刷**：跑中就每 700ms 刷一次；元素一离开 DOM 就自停（⛔ 不挂全局定时器）。
     */
    const progRow = el('div', 'wxg-note', '');
    progRow.id = 'wxg-ops-progress';
    opsRow.appendChild(progRow);
    {
        const readPipe = () => {
            try {
                return (loadState() && loadState().pipeline) || {};
            } catch (e) {
                return {};
            }
        };
        const draw = () => {
            let p2 = {};
            try {
                p2 = readPipe();
            } catch (e) {
                p2 = {};
            }
            const step = trimText(p2.step);
            const text = trimText(p2.text);
            /*
             * ⚠️ 真机上抓到：**失败/没配好**的旧消息也带着非 done/idle 的 step ⇒ 被我显示成"⏳ 正在跑" ✗
             *   ⇒ 先把"没成/失败"这类**排除出"跑中"**，单独报（她要知道"上次没成、为什么"）。
             */
            const failed = /没成|失败|出错|不兼容/.test(text) || /fail|error/i.test(step);
            const running2 = !failed && !!step && step !== 'done' && step !== 'idle';
            if (failed) {
                progRow.textContent = '⚠ 上次：' + text;
            } else if (running2) {
                progRow.textContent = '⏳ ' + (text || '正在跑…');
            } else if (text && /补推中断|已取消/.test(text)) {
                /*
                 * 断点续跑要**露出**（她那次"推了八成→再点→推完"的静默中断，屏上根本没说过）：
                 * 留着上次那句话，并告诉她**再点一次「补推历史」就能接着补**。
                 */
                progRow.textContent = '⏸ ' + text + '（再点「补推历史」接着补；填了范围就按范围补）';
            } else if (text) {
                progRow.textContent = '上次：' + text;
            } else {
                progRow.textContent = '（还没跑过；点「补推历史」按范围补，跑中这里会显示 n/N）';
            }
        };
        draw();
        let n = 0;
        const timer = setInterval(() => {
            n += 1;
            if (n > 1200 || !progRow.isConnected) {   // 元素离屏就自停（⛔ 不留全局定时器）
                clearInterval(timer);
                return;
            }
            try {
                draw();
            } catch (e) {
                clearInterval(timer);
            }
        }, 700);
    }
    cOps.appendChild(opsRow);
    if (clearWorldOpen) {
        const prevG = ledgerClearPreview();
        const dangerG = el('div', 'wxg-danger-box wanxiangge');
        dangerG.appendChild(el('div', null, '⚠ 这一步**回不来**。将清掉**这个聊天的世界**：'));
        const listG = el('div', 'wxg-danger-list');
        for (const k of Object.keys(prevG)) {
            listG.appendChild(el('div', null, '· ' + k + '：' + String(prevG[k]) + ' 条'));
        }
        listG.appendChild(el('div', null, '· 世界书《万象阁 · 世界后台》：**不动**（她选的②）'));
        dangerG.appendChild(listG);
        const typeRowG = el('div', 'wxg-card-actions');
        typeRowG.appendChild(el('span', 'wxg-note', '把下面这四个字打进去才能点：'));
        const inpG = el('input', 'wxg-danger-typing');
        inpG.type = 'text';
        // ⚠️ ⏔ 跟状态页那份撞 id（撞了就读到错的那个输入框）
        inpG.id = 'wxg-clear-typing-general';
        inpG.placeholder = CLEAR_WORD;
        inpG.setAttribute('autocomplete', 'off');
        typeRowG.appendChild(inpG);
        typeRowG.appendChild(button('确认清空', 'clear-world-do', 'wxg-del'));
        typeRowG.appendChild(button('算了', 'clear-world-cancel'));
        dangerG.appendChild(typeRowG);
        cOps.appendChild(dangerG);
    }
    cOps.appendChild(el('div', 'wxg-note', '这些操作在悬浮球上也有（聊天时不用进工作台）。'));
    box.appendChild(cOps);

    box.appendChild(saveBar('general'));
    host.appendChild(box);
}

/**
 * 暗线阶段 → 胶囊样式（走的是"阶段"这条线：萌芽最早、消散/完成收尾）。
 * ⛔ 按语义分档，不按颜色名——以后加阶段也不用改这里。
 */
function stageTone(stage) {
    const s = asText(stage);
    if (s === '消散' || s === '完成') {
        return 'is-off';
    }
    if (s === '爆发' || s === '关键' || s === '逼近') {
        return 'is-warn';
    }
    if (s === '发酵' || s === '执行') {
        return 'is-info';
    }
    return 'is-info'; // 萌芽／筹备
}

function secWorld(host) {
    const state = loadState();
    const w = state.world;
    const box = section('世界状态',
        '世界局势＝势力的所有碰撞；暗线＝还没浮上台面的事，按阶段走、挂世界钟（不按回合数推，世界钟没到点不许提前冒头）。',
        { open: true, summary: trimText(w.clock) || '世界钟未知' });

    // ⭐ 一次体检的结论：内容得**装进结构**（一个主题一块卡），别平铺在一个大平面上
    // ⭐ 数据卡：默认只读（复核方第四条）——点「编辑」才能改
    // ⭐ 页头：右上「功能 ⋮」（照包；跟状态页、名册页同一个做法）
    const wTop = el('div', 'wxg-roster-topbar');
    const wFunc = button('功能 ⋮', 'world-func', 'wxg-func-btn');
    wFunc.style.height = '28px';
    wFunc.style.minHeight = '28px';
    wFunc.style.lineHeight = '26px';
    wFunc.style.padding = '0 12px';
    wFunc.style.whiteSpace = 'nowrap';
    wTop.appendChild(wFunc);
    box.appendChild(wTop);
    const cWorld = lockable(card('世界钟・地点'), 'world-clock');
    line(cWorld, '世界钟', textInput('wxg-world-clock', w.clock, '例：第二天 上午 10:20（读不出来写未知）', 'set-world-clock', 'wxg-short'));
    line(cWorld, '地点', textInput('wxg-world-place', w.place, '例：四夷馆', 'set-world-place', 'wxg-short'));
    line(cWorld, '这个世界现在什么样',
        textarea('wxg-world-big', w.bigPicture, '从高处看一眼：这个世界现在什么样', 'set-world-big', 3));
    box.appendChild(cWorld);

    /*
     * ⭐ 局势／暗线这两张卡**不套 `lockable`**（照目标包的 ⏔ 规矩：
     *   「**有悬浮框的旁边不留编辑**」——她 10-15 01:34 划的原则）。
     *   `lockable` 会在卡头右上加一颗「编辑」并把卡标成 `is-locked`；
     *   不套它 ⇒ 无那颗钮、也没有 `is-locked`（**内容照常可见**，⏔ 会被锁死）。
     *   ⚙️ 编辑将来走**点行弹出的浮层 ⋮**（尚未做）。
     */
    const cSit = card('局势（势力的碰撞）');
    const sit = el('div', 'wxg-list');
    if (!w.situations.length) {
        sit.appendChild(emptyBlock('还没有局势记录（点「立刻更新」让引擎算一次）'));
    } else {
        // ⭐ 局势也能手改（条 22）：她看得见就该能改——改字、换火候、删掉，都行
        // ⭐ 行化：`火候胶囊 ｜ 局势名 ＋ 哪几方 ｜ 右侧改 ＋ 删`（一行一条）
        w.situations.forEach((item, idx) => {
            const r = el('div', 'wxg-r is-rowlink');
            /*
             * ⭐ 点行开浮层（照目标包）。
             *   ⚠️ 用**自己的类名** `is-rowlink`，⏔ 蹭 `.is-click`：
             *     `.wxg-r.is-click` 带着一条老规矩 `grid-template-columns: 1fr auto`
             *     （那是给名册行用的两列）⇒ 套上它会把本行变成两列
             *     （胶囊被拉成通栏、「删」掉到下一行）——真机截图里我看到了。
             *   ⛔ 行内展开编辑也撤了（她 01:33 划：那种"连框都没有"的行内小控件不要）
             *   —— 编辑一律从浮层右上 ⋮ 进。
             *   ⚠️ 行里的下拉/按钮各自有 data-action ⇒ closest 会先命中它们（点控件不会误开浮层）。
             */
            r.setAttribute('data-action', 'open-world-entry');
            r.setAttribute('data-kind', 'situation');
            r.setAttribute('data-index', String(idx));
            const tierW = el('span', 'wxg-badge ' + (trimText(item.tier) === TIERS[0] ? 'is-warn' : 'is-info'),
                trimText(item.tier) || '几天内');
            r.appendChild(tierW);
            const main = el('div', 'wxg-r-main');
            const title = el('div', 'wxg-r-title');
            title.appendChild(el('span', 'wxg-r-who', trimText(item.title) || '（未记名）'));
            if (item.manual) {
                title.appendChild(el('span', 'wxg-badge is-warn', '已手动修改'));
            }
            main.appendChild(title);
            main.appendChild(el('div', 'wxg-r-sub', '哪几方：' + (trimText(item.sides) || '暂无')));
            r.appendChild(main);

            const act = el('div', 'wxg-r-act');
            /*
             * ⛔ 行内那颗「改」**撤了**（照目标包：她 01:33 划的原则——那种"连框都没有"的
             *   行内小控件不要；**编辑一律从浮层右上 ⋮ 进**）。
             *   行本身可点（`open-world-entry`）⇒ 点一下弹浮层，那里改。
             * ✅ 只留「删」：它是**减少**类操作，摆行上最直接，且浮层里再放一个反而绕。
             */
            const del = button('删', 'del-situation', 'wxg-btn-xs');
            del.setAttribute('data-index', String(idx));
            act.appendChild(del);
            r.appendChild(act);

            sit.appendChild(r);
        });
    }
    cSit.appendChild(sit);
    const addSitRow = row(cSit,
        textInput('wxg-new-situation', '', '自己加一条局势（例：商会与教会在争港口税）', 'noop', 'wxg-short'),
        button('加一条局势', 'add-situation', 'wxg-primary'));
    if (addSitRow.classList && typeof addSitRow.classList.add === 'function') {
        addSitRow.classList.add('wxg-add-row');
    } else {
        addSitRow.className += ' wxg-add-row';
    }
    addSitRow.setAttribute('data-no-lock', '1');
    box.appendChild(cSit);

    // 同上：暗线卡也不套 `lockable`（⏔ 卡头留一颗「编辑」）
    const cHid = card('暗线（自己有时间表，到点才动）');
    const hid = el('div', 'wxg-list');
    if (!w.hidden.length) {
        hid.appendChild(emptyBlock('还没有暗线（引擎会在更新时排出来）'));
    } else {
        /*
         * ⭐ 行化（有数据排版术第七条）：一行一条暗线
         *    `阶段胶囊 ｜ 名字 ＋（到点条件／现在到哪一步） ｜ 右侧改阶段 ＋ 删`
         * ⚠️ 原来每个字段各占一行（到点条件一行、现在到哪一步一行、下拉一行）
         *    ⇒ 6 条暗线就是一屏半。
         */
        for (let hidIdx = 0; hidIdx < w.hidden.length; hidIdx += 1) {
                const h = w.hidden[hidIdx];
            const r = el('div', 'wxg-r is-rowlink');
                // ⭐ 点行开浮层（同局势）；行内下拉与「删」各自有 data-action。
                // ⚠️ 用**自己的类名** `is-rowlink`，⛔ 蹭 `.is-click`（它带着两列的规矩）
                r.setAttribute('data-action', 'open-world-entry');
                r.setAttribute('data-kind', 'hidden');
                r.setAttribute('data-index', String(hidIdx));
            r.appendChild(el('span', 'wxg-badge ' + stageTone(h.stage), trimText(h.stage) || '萌芽'));
            const main = el('div', 'wxg-r-main');
            const title = el('div', 'wxg-r-title');
            title.appendChild(el('span', 'wxg-r-who', trimText(h.name) || '（未记名）'));
            if (trimText(h.tier)) {
                title.appendChild(el('span', 'wxg-badge is-off', trimText(h.tier)));
            }
            if (h.manual) {
                title.appendChild(el('span', 'wxg-badge is-warn', '已手动修改'));
            }
            main.appendChild(title);
            // 第二行：到点条件 ／ 现在到哪一步（空值写"暂无"，⛔ 不隐身）
            const bits = [];
            bits.push('到点：' + (trimText(h.trigger) || '暂无'));
            bits.push('走到：' + (trimText(h.note) || '暂无'));
            main.appendChild(el('div', 'wxg-r-sub', bits.join(' · ')));
            r.appendChild(main);
            const act = el('div', 'wxg-r-act');
            act.appendChild(select('hid-stage-' + h.id,
                (h.kind === 'progress' ? STAGES_PROGRESS : STAGES_CONFLICT).map((x) => ({ value: x, label: x })),
                h.stage, 'set-hidden-stage', h.id));
            act.appendChild(button('删', 'del-hidden', 'wxg-btn-xs', h.id));
            r.appendChild(act);
            hid.appendChild(r);
        }
    }
    cHid.appendChild(hid);

    const addHidRow = row(cHid,
        textInput('wxg-new-hidden', '', '新暗线名字', 'noop', 'wxg-short'),
        textInput('wxg-new-hidden-trigger', '', '挂在什么时间／条件（例：晚上／三天后）', 'noop', 'wxg-short'),
        // ⭐ 火候与族类**给她选**（原来写死"几天内／冲突型"）——近的快推、远的慢炖，是她自己的节奏
        select('wxg-new-hidden-tier', TIERS.map((x) => ({ value: x, label: x })), '几天内', 'noop'),
        select('wxg-new-hidden-kind', [
            { value: 'conflict', label: '冲突型（萌芽→发酵→逼近→爆发→消散）' },
            { value: 'progress', label: '推进型（筹备→执行→关键→完成）' },
        ], 'conflict', 'noop'),
        button('加一条暗线', 'add-hidden', 'wxg-primary'));
    if (addHidRow.classList && typeof addHidRow.classList.add === 'function') {
        addHidRow.classList.add('wxg-add-row');
    } else {
        addHidRow.className += ' wxg-add-row';
    }
    addHidRow.setAttribute('data-no-lock', '1');
    box.appendChild(cHid);
    host.appendChild(box);
}

/**
 * 角色状态：**一行一个人，七列各就各位**（她点名要的形态）。
 * 她原话："不是应该七列？几个小标题然后名字各就各位然后每一列各自填各自的？而且最上面还要加上搜索，
 * 否则人物一多就哈哈哈。"
 *
 * 排布：名字（＋徽章＋明细开关）｜年龄｜身份｜所在势力｜好感｜时间・地点｜正在经历
 *   点「明细」展开那一行：过去经历／日程／任务／合并与收下按钮（⛔ 不占表宽）。
 */
function secCharacters(host) {
    const state = loadState();
    // ⚠️ 真机截图暴露：段说明挤在搜索框上面、把工具条压下去了 ⇒ 说明挪到表格**下面**（读的时候不挡事）
    const box = section('角色状态', null, { open: true });

    if (!state.characters.length) {
        box.appendChild(heroEmpty('名册还是空的：去「人物名册」从世界书读人，或点下面一键立起预设名册。', '一键盘入预设名册', 'preset-roster'));
        host.appendChild(box);
        return;
    }

    /* ---- 工具条：搜索 ＋ 排序 ＋ 计数 ---- */
    const tools = el('div', 'wxg-ctools');
    const search = document.createElement('input');
    search.type = 'search';
    search.id = 'wxg-char-search';
    search.className = 'text_pole wxg-search';
    search.placeholder = '搜人：名字／别名／身份／势力／时间地点／正在经历／任务';
    search.value = charSearch.query;
    search.setAttribute('data-live-action', 'char-search');
    tools.appendChild(search);
    tools.appendChild(select('wxg-char-sort', [
        { value: 'recent', label: '按最近更新' },
        { value: 'name', label: '按名字' },
        { value: 'affinity', label: '按好感' },
        { value: 'scene', label: '本轮在现场的优先' },
    ], charSearch.sort, 'char-sort'));
    const countChip = el('span', 'wxg-note', String(state.characters.length) + ' 人');
    countChip.setAttribute('data-role', 'char-count');
    tools.appendChild(countChip);
    box.appendChild(tools);

    /* ---- 排序 ---- */
    const rows = state.characters.slice();
    if (charSearch.sort === 'name') {
        rows.sort((a, b) => asText(a.name).localeCompare(asText(b.name), 'zh'));
    } else if (charSearch.sort === 'affinity') {
        rows.sort((a, b) => affinityNum(b.affinity) - affinityNum(a.affinity));
    } else if (charSearch.sort === 'scene') {
        rows.sort((a, b) => (b.inScene === true ? 1 : 0) - (a.inScene === true ? 1 : 0)
            || Number(b.lastSeenFloor || 0) - Number(a.lastSeenFloor || 0));
    } else {
        rows.sort((a, b) => Number(b.lastSeenFloor || 0) - Number(a.lastSeenFloor || 0)
            || Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
    }

    /* ---- 表 ---- */
    const table = document.createElement('table');
    table.className = 'wxg-ctable';
    const thead = document.createElement('thead');
    const htr = document.createElement('tr');
    for (const h of ['名字', '年龄', '身份', '所在势力', '好感', '时间・地点', '正在经历']) {
        const th = document.createElement('th');
        th.textContent = h;
        htr.appendChild(th);
    }
    thead.appendChild(htr);
    table.appendChild(thead);
    const tbody = document.createElement('tbody');

    /*
     * ⭐ 表格里的一个格子：**只读文字**（复核方："不点是只读，改不了免得弄错"）。
     *    改在哪儿？⏐ 在明细行里（点行才出来）—— 跟她自家「记忆图鉴」一个路子。
     *    ⏐ 不能再把输入框摆在格子里：七列全是一模一样的空框 ⇒ 看着像没填完的表单。
     */
    const cell = (c, key, fallback) => {
        const td = document.createElement('td');
        if (key === 'current') {
            td.className = 'wxg-cur-cell';
        }
        const v = trimText(c[key]);
        td.appendChild(el('span', v ? 'wxg-cellv' : 'wxg-cellv wxg-none', v || (fallback || '暂无')));
        return td;
    };

    for (const c of rows) {
        const tr = document.createElement('tr');
        /*
         * ⭐ 整行可点 ⇒ 展开明细（那儿才能改）。
         *    ⏐ 不在行里摆编辑框：表格一眼扫过去要能读，不是一堆空框。
         */
        tr.setAttribute('data-action', 'toggle-cdetail');
        tr.className = 'wxg-crow is-click';
        tr.setAttribute('data-id', c.id);
        // 搜索用的"底稿"（搜的时候只切 class，⛔ 不重画页面，才不会打断她打字）
        tr.setAttribute('data-search', asText([
            c.name, (c.aliases || []).join(' '), c.identity, c.faction, c.timePlace, c.current, c.affinity,
            (c.quests || []).map((q) => q.title).join(' '),
        ].join(' ')).toLowerCase());
        tr.setAttribute('data-id', c.id);

        /*
         * 名字这一格：**名字一行、状态章一行**（参照观棋「角色与势力」：名字底下挂章）。
         *    ⏐ 原来名字、四五个章、一颗「明细」按钮全挤在一行 ⇒ 挤成一团。
         */
        const nameTd = document.createElement('td');
        const nameCell = el('div', 'wxg-cname-cell');
        const nameLine = el('div', 'wxg-cname-line');
        nameLine.appendChild(el('span', 'wxg-cname', trimText(c.name) || '（没名字）'));
        nameLine.appendChild(el('span', 'wxg-r-caret', '›'));
        nameCell.appendChild(nameLine);
        const chipLine = el('div', 'wxg-cchips');
        if (c.isPlayer) {
            chipLine.appendChild(el('span', 'wxg-badge is-ok', '玩家棋子'));
        }
        if (c.inScene) {
            chipLine.appendChild(el('span', 'wxg-badge is-info', '在现场'));
        }
        if (c.isNew) {
            chipLine.appendChild(el('span', 'wxg-badge is-warn', '新认的人'));
        }
        if (c.manual) {
            chipLine.appendChild(el('span', 'wxg-badge is-warn', '已手动修改'));
        }
        if (c.currentSuspect) {
            chipLine.appendChild(el('span', 'wxg-badge is-warn', '⚠ 不可靠'));
        }
        if (c.ignored) {
            chipLine.appendChild(el('span', 'wxg-badge is-off', '已忽略'));
        }
        if (chipLine.childNodes && chipLine.childNodes.length) {
            nameCell.appendChild(chipLine);
        }
        nameTd.appendChild(nameCell);
        tr.appendChild(nameTd);

        tr.appendChild(cell(c, 'age'));
        tr.appendChild(cell(c, 'identity'));
        tr.appendChild(cell(c, 'faction'));
        const affTd = cell(c, 'affinity');
        // 好感只能"读"——接入数据源时提示她这是读来的
        affTd.title = trimText(c.affinitySource) ? ('读自：' + trimText(c.affinitySource)) : '没接数据源（引擎不自己编）';
        tr.appendChild(affTd);
        tr.appendChild(cell(c, 'timePlace'));
        tr.appendChild(cell(c, 'current', '（本回合没写他）'));
        tbody.appendChild(tr);

        /* ---- 明细行（默认收起） ---- */
        const dtr = document.createElement('tr');
        dtr.className = 'wxg-cdetail-row';
        dtr.setAttribute('data-detail-of', c.id);
        dtr.setAttribute('data-hide', '1');
        const dtd = document.createElement('td');
        dtd.setAttribute('colspan', '7');
        const detail = el('div', 'wxg-cdetail');
        if (detail.style) {
            detail.style.display = 'none';
        }

        /*
         * ⭐ 可改的五个字段在**这儿**（点开这一行才出来）。
         *    主行那七格已经改成只读文字：表格一眼扫过去要能读。
         *    ⏐ 这里的 id / data-action / data-key 跟以前一模一样（用例和事件都不用改）。
         */
        const editBox = el('div', 'wxg-field');
        editBox.appendChild(el('label', null, '改他的状态（改完自动存）'));
        const editGrid = el('div', 'wxg-cedit');
        const mkEdit = (key, placeholder, isArea) => {
            const wrap = el('div', 'wxg-cedit-item');
            wrap.appendChild(el('span', 'wxg-cedit-k', key === 'timePlace' ? '时间・地点' : ({
                age: '年龄', identity: '身份', faction: '所在势力', current: '正在经历',
            }[key] || key)));
            const inp = isArea
                ? textarea('wxg-c-' + key + '-' + c.id, c[key], placeholder, 'set-char-field', 2)
                : textInput('wxg-c-' + key + '-' + c.id, c[key], placeholder, 'set-char-field');
            inp.setAttribute('data-id', c.id);
            inp.setAttribute('data-key', key);
            wrap.appendChild(inp);
            return wrap;
        };
        editGrid.appendChild(mkEdit('age', '几岁'));
        editGrid.appendChild(mkEdit('identity', '是什么'));
        editGrid.appendChild(mkEdit('faction', '所属'));
        editGrid.appendChild(mkEdit('timePlace', '例：第二天 上午 · 学校'));
        editBox.appendChild(editGrid);
        const curWrap = el('div', 'wxg-cedit-item is-wide');
        curWrap.appendChild(el('span', 'wxg-cedit-k', '正在经历'));
        // ⚠️ 别用 `mkEdit(...).lastChild`（假 DOM 的 shim 不保证有 lastChild）——直接建
        const curArea = textarea('wxg-c-current-' + c.id, c.current,
            '本回合正在发生的事（只写这一步、只写他自己）', 'set-char-field', 2);
        curArea.setAttribute('data-id', c.id);
        curArea.setAttribute('data-key', 'current');
        curWrap.appendChild(curArea);
        // ⚠️ 必须挂进 editGrid（网格）——挂到 editBox 上的话它成了 flex 项，
        //    会并排飘在右边，`grid-column: 1/-1` 根本不生效（真机截图里看出来的）
        editGrid.appendChild(curWrap);
        detail.appendChild(editBox);

        if (c.currentSuspect) {
            const warn = el('div', 'wxg-store', '⚠ 这条「正在经历」引擎判定**不可靠**：'
                + (trimText(c.currentSuspectWhy) || '疑似越界')
                + '　⇒ 已标出来、但没擅自改它，你看着办（下一步该由你回话决定）');
            warn.setAttribute('data-tone', 'bad');
            detail.appendChild(warn);
        }

        // 过去经历
        const past = el('div', 'wxg-field');
        past.appendChild(el('label', null, '过去经历（由近到远，旧的自然淡化）'));
        const pastBox = el('div', 'wxg-list');
        if (!c.past.length) {
            pastBox.appendChild(el('div', 'wxg-empty', '还没有'));
        } else {
            for (const p of c.past) {
                pastBox.appendChild(el('div', 'wxg-fact', '· ' + p.text + (p.manual ? '（已手动修改）' : '')));
            }
        }
        past.appendChild(pastBox);
        detail.appendChild(past);

        // 日程
        if (c.schedule.length) {
            const sch = el('div', 'wxg-field');
            sch.appendChild(el('label', null, '日程（到点要跟上）'));
            const schBox = el('div', 'wxg-list');
            for (const s of c.schedule) {
                schBox.appendChild(el('div', 'wxg-fact', '· ' + s.what + (s.due ? '（' + s.due + '）' : '') + (s.done ? ' ✓已到' : '')));
            }
            sch.appendChild(schBox);
            detail.appendChild(sch);
        }

        // 任务（主线／支线）：目标层——"他在追什么"，⛔ 不是"下一步做什么"
        // 整理规则（我定的）：进行中的排前面，完成/搁置的收进折叠里（不占地方，但一条不丢）
        if (Array.isArray(c.quests) && c.quests.length) {
            const qBox = el('div', 'wxg-list');
            const open = c.quests.filter((q) => !['完成', '搁置'].includes(trimText(q.status)));
            const over = c.quests.filter((q) => ['完成', '搁置'].includes(trimText(q.status)));
            const stat = questStats(c.quests);
            qBox.appendChild(el('div', 'wxg-report-h',
                '任务（在追的目标 · ⛔ 不是"下一步做什么"）'
                + '　主线 ' + String(stat.main) + ' · 支线 ' + String(stat.side)
                + (over.length ? '（已结束 ' + String(over.length) + '）' : '')));

            const makeQuestRow = (q) => {
                const row2 = el('div', 'wxg-rowitem');
                const head = el('div', 'wxg-rowname');
                head.appendChild(el('span', 'wxg-badge wxg-badge-soft', trimText(q.kind) === 'main' ? '主线' : '支线'));
                head.appendChild(el('span', 'wxg-name', trimText(q.title)));
                const st = select('wxg-q-' + c.id + '-' + trimText(q.title), [
                    { value: '活跃', label: '活跃' },
                    { value: '完成', label: '完成' },
                    { value: '搁置', label: '搁置' },
                ], trimText(q.status), 'set-quest-status', c.id);
                st.setAttribute('data-title', trimText(q.title));
                st.className = 'text_pole wxg-btn-sm';
                head.appendChild(st);
                if (q.manual) {
                    head.appendChild(el('span', 'wxg-badge wxg-badge-warn', '已手动修改'));
                }
                const del = button('删', 'del-quest', 'wxg-btn-sm', c.id);
                del.setAttribute('data-title', trimText(q.title));
                head.appendChild(del);
                row2.appendChild(head);
                if (trimText(q.note)) {
                    row2.appendChild(el('div', 'wxg-fact', trimText(q.note)));
                }
                if (Array.isArray(q.items) && q.items.length) {
                    row2.appendChild(el('div', 'wxg-fact', q.items.map((i) => (i.done ? '☑ ' : '▶ ') + trimText(i.text)).join('　')));
                }
                return row2;
            };

            if (!open.length) {
                qBox.appendChild(el('div', 'wxg-empty', '没有在追的任务了（已结束的都收在下面）'));
            }
            for (const q of open) {
                qBox.appendChild(makeQuestRow(q));
            }
            if (over.length) {
                const fold = foldable('已结束 ' + String(over.length) + ' 条（完成／搁置，点开看）', false);
                const inner = el('div', 'wxg-list');
                for (const q of over) {
                    inner.appendChild(makeQuestRow(q));
                }
                fold.appendChild(inner);
                qBox.appendChild(fold);
            }
            detail.appendChild(qBox);
        }

        // 合并与收下
        const badges = el('div', 'wxg-row');
        badges.appendChild(button('按这条合并…', 'merge-into', 'wxg-btn-sm', c.id));
        if (c.isNew) {
            badges.appendChild(button('名字对，收下', 'accept-new', 'wxg-btn-sm', c.id));
            badges.appendChild(button('忽略这条', 'ignore-char', 'wxg-btn-sm', c.id));
        }
        detail.appendChild(badges);

        dtd.appendChild(detail);
        dtr.appendChild(dtd);
        tbody.appendChild(dtr);
    }

    table.appendChild(tbody);
    // 7 列装不下时横向滚，⛔ 不硬挤成一团
    const twrap = el('div', 'wxg-ctablewrap');
    twrap.appendChild(table);
    box.appendChild(twrap);
    box.appendChild(el('div', 'wxg-note',
        '一行一个人：名字／年龄／身份／所在势力／好感／时间・地点／正在经历，点行展开明细即可修改；'
        + '改过的会显示「已手动修改」，下一轮更新不许冲掉。'
        + '搜索只筛显示，不动数据。'));
    host.appendChild(box);

    // 按当前的搜索词先筛一遍
    applyCharSearch(host, charSearch.query);
}

/**
 * ⭐ 每段一个保存（她拍的："每个大标题的这个地方直接加一个保存得了，弄完设定整页保存"）。
 *
 * 为什么要这样：原来一个段里散着好几个"保存"（提取名单／排除名单／条目名单…），
 * 点一下还立刻生效 ⇒ 点错、面板跳、按钮一片。现在：
 *   · 段里所有改动先落进**这一段的草稿**（`staging[段] = {键: 值}`）；
 *   · 段底**一个**「保存」把它整段提交；旁边显示"改了几处"；
 *   · 想退回 ⇒「撤销」把草稿丢掉（回到已存的）。
 */
/*
 * ⚠️ 草稿**按宿主各存一份**（'workspace' / 'panel' / 'settings'）。
 *    原来是全局共用一个 staging ⇒ 工作台和浮层面板**互相冲**：
 *    在工作台填好地址、却点了面板那份「保存」⇒ 面板那份草稿是空的，
 *    提交下去就把刚填的**冲成空值**（真机上量到过 api.url 变 ""）。
 */
const stagingByMode = {};

/** 当前正在画／正在处理的是哪一个宿主（⛔ 只用来分草稿，不参与别的判断） */
let stagingMode = 'settings';

function stagingOf(mode) {
    const m = asText(mode) || 'settings';
    if (!stagingByMode[m]) {
        stagingByMode[m] = {};
    }
    return stagingByMode[m];
}

/** 记一笔草稿（⛔ 不落设置）；同一段同一键只留最后一次 */
function stage(secId, key, value) {
    const store = stagingOf(stagingMode);
    const box = store[secId] || (store[secId] = {});
    box[key] = value;
}

/** 这一段草稿里有几处改动 */
function stagedCount(secId) {
    const box = stagingOf(stagingMode)[secId];
    return box ? Object.keys(box).length : 0;
}

/** 这一段某个键的"当前显示值"（草稿优先，其次已存） */
function stagedValue(secId, key, fallback) {
    const box = stagingOf(stagingMode)[secId];
    return box && Object.prototype.hasOwnProperty.call(box, key) ? box[key] : fallback;
}

/**
 * 段底那条"保存"（每段都有）。
 * @param {string} secId 段的标识（见各段自己的 id）
 * @param {string} label 按钮文字（默认"保存"）
 */
function saveBar(secId, label) {
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

/** 把这一段的草稿落进设置 */
function commitSection(secId) {
    const box = stagingOf(stagingMode)[secId];
    if (!box || !Object.keys(box).length) {
        return 0;
    }
    const patch = {};
    for (const k of Object.keys(box)) {
        // 整块外观（色板＋四个颜色槽）
        if (k === 'appearance' && box[k] && typeof box[k] === 'object') {
            /*
             * ⭐ 复审追加 3①：**这里得用 `patch.appearance` 打底**，而且**关键序**。
             *   病根：同一轮草稿里**先取消勾选、再改色板**时，循环先走 `applyToPanel` 分支
             *   （折好了 `patch.appearance.applyToPanel=false`），紧接着走这个分支——
             *   原来直接 `getSettings().appearance` 做底 ⇒ **把刚折好的那一笔盖回去**；
             *   而 `box[k]`（改色板时的基底）里还带着旧的 `applyToPanel: true`。
             *   ⇒ 用 `patch.appearance ||` 打底，并**只要 box 里有 `applyToPanel` 就再校正一次**（⏔ 论键序）。
             */
            patch.appearance = Object.assign({},
                patch.appearance || getSettings().appearance || {},
                box[k]);
            if (Object.prototype.hasOwnProperty.call(box, 'applyToPanel')) {
                patch.appearance.applyToPanel = box.applyToPanel === true;
            }
            continue;
        }
        /*
         * ⭐ 复审追加 2（A3 写入层）：**`applyToPanel` 要折进 `appearance` 里**，⛔ 落顶层。
         *   根因：读侧 `theme.resolveAppearance()` 读的是 **`settings.appearance.applyToPanel`**，
         *   而这里原来走 `patch[k] = box[k]` ⇒ 写进了**顶层** `settings.applyToPanel`（**没人读的那格**）
         *   ⇒ 她「取消勾选 + 保存」后，读侧那格**仍是 true** ⇒ 小框照样被染色（"跟随酒馆主题"实际不生效）。
         *   ⚠️ 正因为读不到，我 A3 那次修的"清除"**根本没被触发**——两轮人工复核都漏了这一格，
         *     最后是**真机 playwright 实点**才抓出来的（所以"假机全绿"不等于"真机对"）。
         *   ⛔ 不动顶层那个历史遗留字段（留着无副作用，属清单外）。
         */
        if (k === 'applyToPanel') {
            patch.appearance = Object.assign({},
                patch.appearance || getSettings().appearance || {},
                { applyToPanel: box[k] === true });
            continue;
        }
        // 走 api 那一格的键：**逐键合并**，⛔ 不整块替换
        // （整块替换会把她存好的书签 `profiles` 一起冲掉）
        if (API_KEYS.includes(k)) {
            patch.api = Object.assign({}, patch.api || {}, { [k]: box[k] });
        } else {
            patch[k] = box[k];
        }
    }
    // ⚠️ 顺序：**先把草稿摘掉，再落盘**。
    //    patchSettings 会触发重画（重画又从草稿读值）⇒ 反过来写的话，
    //    这一段刚保存的值会被"还留着的旧草稿"覆盖回去（真踩过）。
    delete stagingOf(stagingMode)[secId];
    patchSettings(patch);
    /*
     * ⭐ 复审追加 3②：**外观段存完立刻刷小框**。
     *   病根：这里只 `patchSettings`（重画走的是工作台／设置区那条路），而 `closeWorkspace()`
     *   也只把 `mini.style.display` 放回来——**两边都没人碰小框** ⇒ 她「取消勾选 + 保存」后
     *   **不动任何东西**读小框，`--wxg-surface` 还是旧的（要等下次切档／发消息才清）。
     *   ⇒ 这一段存完就补一次（⛔ 不是每个段都刷：别的段跟小框无关，白刷一遍）。
     */
    if (secId === 'appearance') {
        try {
            refreshMini();
        } catch (e) {
            console.warn('[万象阁] 存完外观没刷上小框：', e);
        }
    }
    return Object.keys(box).length;
}

/** 走 api 那一格的键（保存时归到 api 下面） */
const API_KEYS = ['mode', 'url', 'key', 'model', 'modelCheap', 'temperature', 'maxTokens'];

/**
 * ⭐ `stage-*` 动作总表：动作名 → [这一段, 设置键, 取值方式]。
 * 有了它，各处控件只要把 `set-xxx` 写成 `stage-xxx` 就进了草稿，⛔ 不用每个都写一个 case。
 */
const STAGE_MAP = {
    // 总控
    'stage-auto-update': ['general', 'autoUpdate', 'checked'],
    'stage-update-every': ['general', 'updateEvery', 'value'],
    'stage-protected': ['general', 'protectedBypass', 'checked'],
    'stage-strict': ['general', 'strictMention', 'checked'],
    'stage-panel-on-start': ['general', 'showPanelOnStart', 'checked'],
    // 外观
    'stage-app-to-panel': ['appearance', 'applyToPanel', 'checked'],
    'stage-layout-mode': ['appearance', 'layoutMode', 'value'],
    // 召回
    'stage-recent-turns': ['recall', 'recentTurns', 'value'],
    'stage-max-chars': ['recall', 'maxChars', 'value'],
    'stage-max-events': ['recall', 'maxEvents', 'value'],
    'stage-past-floor-cut': ['recall', 'pastFloorCut', 'value'],
    'stage-max-parallel': ['recall', 'maxParallelChars', 'value'],
    'stage-sort-mode': ['recall', 'sortMode', 'value'],
    'stage-card': ['recall', 'cardEnabled', 'checked'],
    'stage-show-empty': ['recall', 'showEmptyCard', 'checked'],
    // 自定义 API
    'stage-api-mode': ['api', 'mode', 'value'],
    'stage-api-url': ['api', 'url', 'value'],
    'stage-api-key': ['api', 'key', 'value'],
    'stage-api-model': ['api', 'model', 'value'],
    'stage-api-model-cheap': ['api', 'modelCheap', 'value'],
    'stage-api-temp': ['api', 'temperature', 'value'],
    'stage-api-maxtok': ['api', 'maxTokens', 'value'],
    // 读取控制（四格）
    'stage-extract-tags': ['extract', 'extractTags', 'value'],
    'stage-exclude-tags': ['extract', 'excludeTags', 'value'],
    'stage-extract-books': ['extract', 'extractBooks', 'value'],
    'stage-exclude-books': ['extract', 'excludeBooks', 'value'],
    'stage-affinity-source': ['extract', 'affinitySource', 'value'],
    // 提示词
    'stage-inject-header': ['prompts', 'injectHeader', 'value'],
    'stage-prompt-world': ['prompts', 'promptWorld', 'value'],
    'stage-prompt-chars': ['prompts', 'promptChars', 'value'],
    'stage-jailbreak': ['prompts', 'jailbreak', 'value'],
};

/** 把一处改动收进草稿（通用入口；⛔ 不落设置） */
/**
 * ⭐ 修复单 #35：当前**生效**的外观——草稿优先、没草稿才用已存的。
 *   为什么要这么一个口径：外观是"整块存"的，而她**连改几槽**时
 *   每一槽都得以**前面那几槽的草稿值**为基底 ⇒ ⏔ 就会互冲。
 */
function effectiveAppearance() {
    const box = stagingOf(stagingMode).appearance;
    const draft = box && box.appearance;
    if (draft && typeof draft === 'object') {
        return draft;
    }
    return getSettings().appearance || {};
}

/** 把页面上已经在的预览盒重新上色（⏔ 重画整页：那会把她正在拖的滑杆弄没） */
function refreshAppearancePreview() {
    try {
        const nodes = document.querySelectorAll('[data-role="app-preview"]');
        for (const node of Array.from(nodes)) {
            applyAppearance(node, effectiveAppearance());
        }
    } catch (e) {
        console.warn('[万象阁] 预览盒没刷新：', e);
    }
}

function stageOne(action, target) {
    // 外观那块是整块存的（色板＋四个颜色槽）
    if (action === 'stage-appearance') {
        const key = target.id;                        // wxg-app-xxx → 槽位名
        const slot = key.replace('wxg-app-', '');
        /*
         * ⭐ 修复单 #35①：**基底用"草稿里那份"**，⏔ 已存的那份。
         *   原来一律 `getSettings().appearance`：她**连改两槽**（先改色板、再改强调色）时，
         *   第二槽以**不含第一槽暂存**的旧值为基底算 ⇒ **第一槽的改动被冲掉**。
         */
        const cur = effectiveAppearance();
        if (slot === 'palette') {
            stage('appearance', 'appearance', Object.assign({}, cur, palettePatch(trimText(target.value))));
        } else {
            stage('appearance', 'appearance', Object.assign({}, cur, { [slot]: trimText(target.value), palette: 'custom' }));
        }
        /*
         * ⭐ 修复单 #35②：**预览盒要跟着变**。
         *   原来改完只存草稿、预览盒还是旧颜色 ⇒ 她以为"没生效"。
         */
        refreshAppearancePreview();
        return 'appearance';
    }
    const row = STAGE_MAP[action];
    if (!row) {
        return null;
    }
    const [secId, key, how] = row;
    stage(secId, key, how === 'checked' ? target.checked === true : target.value);
    return secId;
}

/** 保存之后说一声（说清"到底存了几处"，⛔ 不静默） */
function refreshToastSection(secId, n) {
    if (!n) {
        toast.info('这一段没有未保存的改动');
        return;
    }
    toast.ok('存好了：这一段改了 ' + String(n) + ' 处');
}

/**
 * 只把"保存这条"就地重画一下（⛔ 不整页重画 ⇒ 她还能接着点）。
 * ⚠️ 要整条重画：改动数一变，「撤销」这颗按钮也得跟着出现／消失。
 */
function refreshSaveBar(host, secId) {
    const bar = host && host.querySelector ? host.querySelector('.wxg-savebar[data-id="' + secId + '"]') : null;
    if (!bar || !bar.parentNode) {
        return;
    }
    // ⚠️ 用"插新的、删旧的"（不依赖 replaceChild：假 DOM 上不稳）
    const parent = bar.parentNode;
    const fresh = saveBar(secId);
    parent.insertBefore(fresh, bar);
    parent.removeChild(bar);
}

/** ⭐ 读取控制：正在看哪本书的条目（重画后要能自动摆回来，否则点一条之后就没得点了） */
export let pickBook = '';
export let pickEntries = [];
/** 读到的世界书名单（画小块用，⛔ 不反复读世界书） */
let listBooksCache = [];

/** 角色状态：搜索与排序的"记忆"（重画之后还在，不会因为改一个字就被清空） */
export const charSearch = { query: '', sort: 'recent' };

/** 把好感写成能排序的数字（"62"／"62(+0.5)"／"未知" 都能认） */
function affinityNum(v) {
    const m = asText(v).match(/-?\d+(\.\d+)?/);
    return m ? Number(m[0]) : -Infinity;
}

/**
 * 按搜索词筛行：只切 css 类，⛔ 不重画页面
 * （重画会把她正在打的字、正在看的滚动位置全弄没）。
 */
export function applyCharSearch(root, query) {
    if (!root || typeof root.querySelectorAll !== 'function') {
        return;
    }
    const q = asText(query).trim().toLowerCase();
    const rows = asArray(root.querySelectorAll('.wxg-ctable tbody tr[data-search]'));
    let shown = 0;
    for (const tr of rows) {
        const hit = !q || asText(tr.getAttribute('data-search')).includes(q);
        if (tr.classList) {
            tr.classList.toggle('wxg-rowfiltered', !hit);
        }
        if (hit) {
            shown += 1;
        }
        // 明细行跟着主人一起藏
        const id = tr.getAttribute('data-id');
        const detail = root.querySelector('.wxg-cdetail-row[data-detail-of="' + id + '"]');
        if (detail && detail.classList && !hit) {
            detail.classList.add('wxg-rowfiltered');
        }
    }
    const chip = root.querySelector('[data-role="char-count"]');
    if (chip) {
        chip.textContent = q ? ('筛出 ' + String(shown) + ' 人') : (String(rows.length) + ' 人');
    }
}

/**
 * 编年的筛选（那一排小胶囊）。放在模块级：点一下只重画，不落设置。
 * （"筛选带计数"是跟参照学的**做法**；文案是我们自己的——⛔ 别照抄别家的字。）
 */
let chronFilter = 'all';
/**
 * ⭐「清空这个世界」的确认盒开着没有。
 * 她拍的：不可逆操作要**写明条数** ＋ **手打「确认清空」**才让点（防误点）。
 */
let clearWorldOpen = false;
/** 要她手打的那四个字（打错就点不动） */
const CLEAR_WORD = '确认清空';
/** 哪一条局势正展开着编辑（-1＝都没展开；行化之后默认收起，⛔ 不再一条占两行） */
let openSituation = -1;

/** 过程报告的筛选（那一排小胶囊）：全部／已注入／未注入／失败 */
let reportFilter = 'all';

/** 现在的进度的筛选：全部／已做／还没做 */
let stepFilter = 'all';
let stepPage = 1;

/** 名册的筛选：全部／玩家棋子／新认的／我改过的 */
let rosterFilter = 'all';

    /** 名册的搜索词（搜“名字或别名”；⏔ 落设置，只是看的姿势） */
    let rosterSearch = '';

/** 名册里哪一个人正展开着编辑（''＝都没展开） */
let openChar = '';

/** 名册/编年的翻页（第几页从 1 数；⛔ 不落设置，只是看的姿势） */
let rosterPage = 1;
let chronPage = 1;

/** 每页几条（名册 20＝差不多一屏；编年 30＝够看一段） */
const PER_PAGE = { roster: 15, chron: 20, steps: 20 };

/**
 * ⭐ 翻页条（对照观棋那张：`‹ 上一页 ｜ 第 1-20 条 · 共 54 条 ｜ 下一页 ›`）。
 *
 * 为什么需要：名册灌到 54 个人之后，一长条滚到底**根本找不着人**——
 * 分页＋筛选＋搜索才是台账该有的用法。编年同理（越攒越多）。
 */
function pager(action, page, per, total) {
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

    // 页数不多时直接给页码（点着比一页页翻快）
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
function clampPage(target, total, per) {
    const pages = Math.max(1, Math.ceil((Number(total) || 0) / per));
    const n = Number(target);
    return Math.min(Math.max(1, Number.isFinite(n) ? Math.round(n) : 1), pages);
}

/**
 * 种类 → 胶囊样式（⛔ 不按颜色名，按语义）：
 *   推演＝中性分类章 ｜ 暗线＝要注意 ｜ 警戒／越界＝警告 ｜ 其它＝中性
 */
function kindTone(kind) {
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
function shortTime(at) {
    const s = formatStamp(at);
    const m = s.match(/(\d{1,2}:\d{2})/);
    return m ? m[1] : s;
}

function secChronicle(host) {
    const list = getChronicle();
    /*
     * ⚠️ 这里原来是 `{ open: true } + '⭐ …'` —— **对象拼字符串**，两个后果：
     *    · 拼出来的是 "[object Object]⭐ …" ⇒ hint 从来没显示过；
     *    · `open` 也没传进去 ⇒ "默认展开"从来没生效（编年一直是收起的）。
     *    ⇒ 改成独立传参（复核方指出）。
     */
    const box = section('编年',
        '每回合推演出来的东西**全部按时间攒在这里**（过去经历／正在经历是滚动更新的，旧的只有这儿能回看）。'
        + '编年**只给你看**：不注入、不喂模型。',
        { open: true });
    if (!list.length) {
        box.appendChild(heroEmpty('还没有记录（更新几轮就有了）', '立刻更新', 'update-now'));
        host.appendChild(box);
        return;
    }
    // ⭐ 装盒：编年列表一块（体检第一条）
    /*
     * ⭐ 行化一切（有数据排版术第七条）：
     *    `时间（骨架列）｜ 谁 ＋ 正文 ｜ 种类胶囊`，一行一件事；
     *    按**楼层分组**（数字当骨架），顶部一排**筛选带计数**。
     * ⚠️ 原来每条摊成 5 行（时间／楼层／胶囊／人／正文），9 条就一屏多——
     *    真机截图里一排胶囊还被 flex 列拉成了通栏长条（见 CSS 里的说明）。
     */
    const KINDS = ['推演', '暗线', '警戒', '越界'];
    const countOf = (k) => list.filter((c) => String(c.kind || '推演').includes(k)).length;
    const all = list.slice(-120).reverse();
    const matched = chronFilter === 'all' ? all : all.filter((c) => String(c.kind || '推演').includes(chronFilter));
    // ⭐ 翻页：只画当前页（编年是越攒越多的，一长条滚不到头）
    chronPage = clampPage(chronPage, matched.length, PER_PAGE.chron);
    const shown = matched.slice((chronPage - 1) * PER_PAGE.chron, chronPage * PER_PAGE.chron);

    // ① 筛选胶囊（带计数）——做法学参照，字用我们自己的
    const bar = el('div', 'wxg-filters');
    const mkFilter = (key, label, n) => {
        const b = el('button', 'wxg-filter' + (chronFilter === key ? ' is-on' : ''), label);
        b.type = 'button';
        b.setAttribute('data-action', 'chron-filter');
        b.setAttribute('data-id', key);
        b.appendChild(el('span', 'wxg-filter-n', String(n)));
        return b;
    };
    bar.appendChild(mkFilter('all', '全部', all.length));
    for (const k of KINDS) {
        const n = countOf(k);
        if (n) {
            bar.appendChild(mkFilter(k, k, n));
        }
    }
    if (chronFilter !== 'all' && !countOf(chronFilter)) {
        // 筛到空的时候也得有路回去（⛔ 不留一个空屏）
        chronFilter = 'all';
    }
    box.appendChild(bar);

    // ② 一行小结：有几条、什么顺序
    const hit = el('div', 'wxg-hitbar');
    hit.appendChild(el('span', null, '这一筛 ' + String(matched.length) + ' 条'
        + (matched.length === list.length ? '' : '（全账本 ' + String(list.length) + ' 条）')));
    hit.appendChild(el('span', null, '新的在上面 · 按楼层分组'));
    /*
     * ⭐ 「清空编年」放在这一条小结行上（不单开一段，照"一屏一个焦点"）。
     *    ⛔ 不做成显眼的大按钮——清空是**刻意**才点的操作，点之前会先弹条数给她看。
     */
    const clearBtn = el('button', 'wxg-btn-xs wxg-del', '清空编年');
    clearBtn.type = 'button';
    clearBtn.setAttribute('data-action', 'clear-chronicle');
    clearBtn.title = '把编年全部清掉（只清编年，别的都不动）';
    hit.appendChild(clearBtn);
    box.appendChild(hit);
    if (matched.length > PER_PAGE.chron) {
        box.appendChild(pager('chron-page', chronPage, PER_PAGE.chron, matched.length));
    }

    // ③ 按楼层分组，一组一个"行列表"（先按 floor 归桶、组内按时间从新到旧、组间按 floor 从大到小）
    const cChron = card(chronFilter === 'all' ? '按回合攒的' : ('只看「' + chronFilter + '」'));
    const byFloor = new Map();
    for (const c of shown) {
        const f = Number.isFinite(c.floor) && c.floor >= 0 ? Number(c.floor) : -1;
        if (!byFloor.has(f)) {
            byFloor.set(f, []);
        }
        byFloor.get(f).push(c);
    }
    const groups = Array.from(byFloor.entries())
        .map(([floor, items]) => ({
            floor,
            items: items.slice().sort((a, b) => (Number(b && b.at) || 0) - (Number(a && a.at) || 0)),
        }))
        .sort((a, b) => {
            if (a.floor === b.floor) {
                return 0;
            }
            if (a.floor < 0) {
                return 1;
            }
            if (b.floor < 0) {
                return -1;
            }
            return b.floor - a.floor;
        });
    for (const g of groups) {
        const head = el('div', 'wxg-grouphead');
        head.appendChild(el('b', null, g.floor >= 0 ? floorLabel(g.floor) : '未记楼层'));
        head.appendChild(el('span', null, String(g.items.length) + ' 条'));
        cChron.appendChild(head);
        for (const c of g.items) {
            const r = el('div', 'wxg-r');
            // 骨架列：时间（等宽数字，竖着对齐）
            r.appendChild(el('div', 'wxg-r-k wxg-num', shortTime(c.at)));
            // 主列：谁（＋已手改）／正文（最多两行）
            const main = el('div', 'wxg-r-main');
            const title = el('div', 'wxg-r-title');
            if (trimText(c.who)) {
                title.appendChild(el('span', 'wxg-r-who', c.who));
            } else {
                title.appendChild(el('span', 'wxg-none', '（没点名）'));
            }
            if (c.manual) {
                title.appendChild(el('span', 'wxg-badge is-warn', '已手动修改'));
            }
            main.appendChild(title);
            main.appendChild(el('div', 'wxg-r-sub', trimText(c.text) || '暂无'));
            r.appendChild(main);
            // 右列：种类胶囊（⛔ 彩色只上胶囊）
            const act = el('div', 'wxg-r-act');
            act.appendChild(el('span', 'wxg-badge ' + kindTone(c.kind), String(c.kind || '推演')));
            /*
             * ⭐ 删这一条。编年原来是**只增不减**的（`addChronicle`／`getChronicle`，没有任何删的口子）
             *    ⇒ 写错了、或者早期测试数据混进去了，她自己在界面上**删不掉**
             *      （真机上真卡过一批合成文本）。
             * ⚠️ 下标按**账本里的原始位置**算：这里渲染的是"最近 120 条倒序＋筛选＋翻页"之后的行，
             *    ⛔ 不能拿循环下标当账本下标（会删错人）。用对象身份回查最稳。
             */
            const at = list.indexOf(c);
            const del = el('button', 'wxg-btn-xs wxg-del', '删');
            del.type = 'button';
            del.setAttribute('data-action', 'del-chronicle');
            del.setAttribute('data-index', String(at));
            del.title = '删掉这一条（只删编年这一条，别的不动）';
            act.appendChild(del);
            r.appendChild(act);
            cChron.appendChild(r);
        }
    }
    box.appendChild(cChron);
    box.appendChild(el('div', 'wxg-note', '共 ' + String(list.length) + ' 条，这里显示最近 120 条（更早的仍在账本与世界书归档里）'));
    host.appendChild(box);
}

function secRoster(host) {
    const roster = getRoster();
    const box = section('人物名册',
        '名册按聊天各分各的（开新档＝新世界，数据不串）。别名表由你自己维护——正文里叫昵称也能召回上。',
        { open: true });
    const d = describeRoster();
    const state = loadState();
    const fresh = Array.isArray(state.newPeople) ? state.newPeople.filter(Boolean) : [];
    box.appendChild(el('div', 'wxg-note', d.total
        ? '现有 ' + String(d.total) + ' 人' + (d.players ? '（其中玩家棋子 ' + String(d.players) + ' 人）' : '')
        : '还没有人物。'));
    // ⭐「新认的人」接上显示（条 12：这个数组原来只写不读）。
    //    她最需要知道的恰恰是"引擎自己认了谁"——认错了要能一眼看见并处理。
    if (fresh.length) {
        const line = el('div', 'wxg-store', '引擎新认了 ' + String(fresh.length) + ' 个人：' + fresh.join('、')
            + '（名字对不对？不对就点「按这条合并…」并进老记录，或「忽略这条」）');
        line.setAttribute('data-tone', 'bad');
        box.appendChild(line);
        row(box, button('一键收下这些新认的人', 'accept-new-all'));
    }

    /*
     * ⭐ 装盒：录入 一块、名册 一块（体检第一条）
     * ⭐ 一屏一个焦点：**名册里已经有人了 ⇒ 录入默认收起**。
     *    68 个人的时候它还占着半屏上半部分，名单要往下滚才看得见——
     *    她天天要看的是名单，录入一个月用一次。⛔ 不删，点一下就展开。
     */
    const hasPeople = roster.length > 0;
    const cIn = card('录入');
    // 有人的时候：整块录入收进一个折叠条（点一下展开）；空名册时才直接摊开
    let inTarget = cIn;
    if (hasPeople) {
        inTarget = foldable('展开录入（加人／导入／从世界书读人）', false);
        cIn.appendChild(inTarget);
    }
    row(inTarget, textInput('wxg-new-name', '', '新人物名字', 'noop'), button('加入名册', 'add-char', 'wxg-primary'), button('一键盘入预设名册', 'preset-roster'));
    row(inTarget, textInput('wxg-import-roster', '', '批量导入：名字一行一个（也认逗号、顿号）', 'noop'), button('批量导入', 'import-roster'));
    row(inTarget,
        textInput('wxg-book-name', '', '从世界书读人：填世界书名（留空＝角色卡绑定那本）', 'noop', 'wxg-short'),
        button('从世界书读人', 'read-book', 'wxg-primary'),
        button('列出世界书', 'list-books'));
    const bookList = el('div', 'wxg-note', '');
    bookList.id = 'wxg-book-list';
    inTarget.appendChild(bookList);
    row(inTarget, button('查重（找出被拆成两条的）', 'detect-dupes'), button('导出备份（JSON）', 'export-data'));
    box.appendChild(cIn);

    /*
     * ⭐ 世界书**通道**那一行（必须看得见）：
     *    真机踩过"点读人 → 0 人"，根因是 ST 1.18 原版**没有** `ctx.getLorebookEntries` 那一组，
     *    而我们只认它 ⇒ 静默读出 0 条、她完全没法自己判断原因。
     *    现在：走哪条通道、缺什么，直接写在读人按钮旁边。
     */
    const chRep = channelReport();
    const chLine = el('div', 'wxg-store', chRep.text
        + (chRep.ok ? '' : '　⇒ 装「酒馆助手」扩展就能读；或者直接把书名手填进下面那格也行'));
    chLine.setAttribute('data-tone', chRep.ok ? 'ok' : 'bad');
    box.appendChild(chLine);

    const cList = card('名册');
    /*
     * ⭐ 行化（有数据排版术第七条）：**一个人一行**。
     *    `名字 ＋ 胶囊（玩家棋子/新认/已手改）｜ 别名·好感 灰字 ｜ 右侧 改 · 删`
     * ⚠️ 原来一个人一张卡（名字行＋两个输入框行＋开关行 ≈ 135px）：
     *    真机灌了 47 人之后一屏只看得到 3 个人——"有哪些条"根本扫不出来，
     *    正好撞在验收口径上（三秒要能抓住有哪些人）。
     * 改/删都在行上；点「改」才展开三个输入框（⛔ 不用为编辑把每行都撑开）。
     */
    /*
     * ⭐ 筛选行 —— **照目标包**：`全部｜创建时间｜修改时间｜玩家棋子｜名字` ＋ 右侧**搜索框**（搜“名字或别名”）。
     *   原来是“全部／玩家棋子／新认的／我改过的”四个胶囊（那是早期自己想的）。
     *   ⚠️ “我改过的”这个**筛选**去了，但它的信息没丢：行上的「已手改」辨识还在（新认的人也还有那条提示带）。
     */
    const isFresh = (c) => fresh.some((n) => trimText(n) === trimText(c.name));
    const kw = trimText(rosterSearch).toLowerCase();
    const hitKw = (c) => !kw
        || String(c.name || '').toLowerCase().includes(kw)
        || (Array.isArray(c.aliases) ? c.aliases.some((a) => String(a || '').toLowerCase().includes(kw)) : false);
    let shownRoster = roster.filter(hitKw);
    if (rosterFilter === 'player') {
        shownRoster = shownRoster.filter((c) => c.isPlayer);
    }
    // 排序（创建时间／修改时间／名字）：⏔ 改原数组，拷一份再排
    if (rosterFilter === 'created' || rosterFilter === 'changed' || rosterFilter === 'name') {
        const key = rosterFilter === 'created' ? 'createdAt' : (rosterFilter === 'changed' ? 'updatedAt' : '');
        shownRoster = shownRoster.slice();
        if (key) {
            shownRoster.sort((a, b) => Number(b[key] || 0) - Number(a[key] || 0));
        } else {
            shownRoster.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'zh'));
        }
    }
    const rf = el('div', 'wxg-filters');
    const mkR = (key, label, n) => {
        const b = el('button', 'wxg-filter' + (rosterFilter === key ? ' is-on' : ''), label);
        b.type = 'button';
        b.setAttribute('data-action', 'roster-filter');
        b.setAttribute('data-id', key);
        if (n !== null) {
            b.appendChild(el('span', 'wxg-filter-n', String(n)));
        }
        return b;
    };
    rf.appendChild(mkR('all', '全部', roster.length));
    rf.appendChild(mkR('created', '创建时间', null));
    rf.appendChild(mkR('changed', '修改时间', null));
    rf.appendChild(mkR('player', '玩家棋子', roster.filter((c) => c.isPlayer).length));
    rf.appendChild(mkR('name', '名字', null));
    // 右侧搜索框（内嵌放大镜）
    const sw = el('div', 'wxg-searchwrap');
    sw.appendChild(el('span', 'wxg-searchico', '⌕'));
    const si = el('input', 'wxg-searchbox');
    si.type = 'search';
    si.placeholder = '搜：名字 或 别名';
    si.value = rosterSearch;
    si.setAttribute('data-action', 'roster-search');
    sw.appendChild(si);
    rf.appendChild(sw);
    cList.appendChild(rf);

    // ⚠️ 按**筛完的数量**夹页（换筛选后可能只剩几条，别停在一个空页上）
    rosterPage = clampPage(rosterPage, shownRoster.length, PER_PAGE.roster);
    const pageList = shownRoster.slice((rosterPage - 1) * PER_PAGE.roster,
        rosterPage * PER_PAGE.roster);
    /*
     * ⭐ 翻页条：**挪到页底**（照目标包：分页贴页底）。
     *    原来放在**列表上方**——那是早期参照的做法；包里明确要"贴页底"。
     *    ⏔ 改回上面（虽然长列表里"翻页在下头"要滑到底才看得到）——**以包为准**。
     */
    const pagerAtBottom = shownRoster.length > PER_PAGE.roster
        ? () => pager('roster-page', rosterPage, PER_PAGE.roster, shownRoster.length)
        : null;
    // ⭐ 右上「功能 ⋮」（照包：去重合并／删除／清空的入口位）
    const topbar = el('div', 'wxg-roster-topbar');
    const funcBtn = button('功能 ⋮', 'roster-func', 'wxg-func-btn');
    // 同上：它也是 `menu_button`，不内联就会被撑到 36px（真机量到）
    funcBtn.style.height = '28px';
    funcBtn.style.minHeight = '28px';
    funcBtn.style.lineHeight = '26px';
    funcBtn.style.padding = '0 12px';
    funcBtn.style.whiteSpace = 'nowrap';
    funcBtn.title = '去重合并／删除／清空（入口位；包里就是这么标的）';
    topbar.appendChild(funcBtn);
    cList.appendChild(topbar);
    const list = el('div', 'wxg-roster wxg-table-4');
    // ⭐ 表头（照包：浅灰底，四列名：角色名称｜好感｜身份｜势力）
    const rhead = el('div', 'wxg-thead wxg-table-4');
    rhead.appendChild(el('div', 'wxg-th', '角色名称'));
    rhead.appendChild(el('div', 'wxg-th', '好感'));
    rhead.appendChild(el('div', 'wxg-th', '身份'));
    rhead.appendChild(el('div', 'wxg-th', '势力'));
    list.appendChild(rhead);
    for (const c of pageList) {
        const open = String(openChar) === String(c.id);
        /*
         * ⭐ **整行可点展开**（复核方："每个角色下面一个按钮好像是有点奇怪"——对）。
         *    68 个人的名单上糊 136 个按钮，名单就不成名单了；
         *    而且「删」摆在密集列表里太容易误点 ⇒ 收进展开区。
         *    行的右侧留一个 `›` 提示"这行能点"。
         * ⚠️ 行上挂 data-action 是安全的：里面的输入框/开关/删除**各自都有 data-action**，
         *    事件的 closest 会先命中它们（点输入框不会把行收起来）。
         */
        const r = el('div', 'wxg-r is-click' + (open ? ' is-open' : ''));
        // ⭐ 点一行开**浮层**（照目标包：⏔ 行内展开）
        r.setAttribute('data-action', 'open-person-card');
        r.setAttribute('data-id', c.id);
        /*
         * ⭐ 照目标包改成**四列表**：`角色名称｜好感｜身份｜势力`，列间**竖实线**，空值写 `—`。
         *    为什么：原来是"名字 + 一行灰字（别名/好感）"，48 个人扫不动；
         *    包里是列对齐的账本样子（四列等宽、看得见的竖线）。
         *    ⚠️ 别名没丢：它在浮层里（点开就看得到）。
         */
        const main = el('div', 'wxg-td wxg-c-name');
        const title = el('div', 'wxg-r-title');
        title.appendChild(el('span', 'wxg-r-who', c.name));
        if (c.isYou || c.isPlayer) {
            // ⭐ 自动认出来的"你"（跟观棋那个「你 · 玩家棋子」一个意思）
            title.appendChild(el('span', 'wxg-badge is-ok', '你'));
        }
        if (c.isNew || isFresh(c)) {
            title.appendChild(el('span', 'wxg-badge is-warn', '新认的人'));
        }
        if (c.manual) {
            title.appendChild(el('span', 'wxg-badge is-info', '已手改'));
        }
        /*
         * ⭐ 补①的验收④：「名册上看得出来谁关了」。
         *   用**灰胶囊「不推」**（不是红的）：这不是错，是她主动关的。
         */
        if (c.noBench === true) {
            title.appendChild(el('span', 'wxg-badge', '不推'));
        }
        main.appendChild(title);
        r.appendChild(main);
        // ⭐ 后三列（照包）：好感 ｜ 身份 ｜ 势力 —— 空值一律 `—`（⛔ 不写"暂无一堆"）
        r.appendChild(el('div', 'wxg-td wxg-c-aff', trimText(c.affinity) || '—'));
        r.appendChild(el('div', 'wxg-td wxg-c-id', trimText(c.identity) || '—'));
        r.appendChild(el('div', 'wxg-td wxg-c-fac', trimText(c.faction) || '—'));
        // ⭐ 被点开那一行：浅绿选中（包里 trow sel）
        if (open) {
            r.classList.add('is-sel');
        }

        const act = el('div', 'wxg-r-act');
        act.appendChild(el('span', 'wxg-r-caret' + (open ? ' is-open' : ''), open ? '⌄' : '›'));
        /*
         * ⭐ 行上留一个「⋯」＝还开**老的完整编辑器**（删除／收下／忽略／合并那些都在里头）。
         *    为什么留：浮层这一版先做"看＋改七格＋别名＋玩家棋子"，老编辑器里还有几样没搬过去；
         *    ⛔ 不能因为换交互就把她的功能摸不到（audit-3 红了 4 条就是提醒这个）。
         *    等浮层把老编辑器的活全接手了，再撤这个入口（那时才叫"只删入口"）。
         */
        const moreBtn = button('⋯', 'edit-char', 'wxg-btn-xs wxg-r-more', c.id);
        moreBtn.title = '更多（删除／收下／忽略／合并等）';
        /*
         * ⭐ 行高真凶（第 6 轮真机量出来的）：这颗按钮被酒馆全局 `.menu_button`
         *   撑到 **36px**，而同行别的格子才 30～35 ⇒ 行高 = max + 内边距 = 63px。
         *   屝过两回 CSS 都压不过（它是酒馆自己的类）⇒ **直接写内联**（内联必胜，且只影响这一颗）。
         */
        moreBtn.style.height = '22px';
        moreBtn.style.minHeight = '22px';
        moreBtn.style.lineHeight = '20px';
        moreBtn.style.padding = '0 7px';
        moreBtn.style.fontSize = '13px';
        act.appendChild(moreBtn);
        r.appendChild(act);

        // 展开区：别名／好感／玩家棋子／删除（点行才出来）
        if (open) {
            const fields = el('div', 'wxg-char-fields');
            const alias = textInput('wxg-alias-' + c.id, c.aliases.join('、'), '别名／昵称（顿号或逗号分开）', 'set-alias', 'wxg-alias');
            alias.setAttribute('data-id', c.id);
            fields.appendChild(alias);
            const aff = textInput('wxg-aff-' + c.id, c.affinity, '好感（读自"手机"，未接入先空着）', 'set-affinity', 'wxg-affinity');
            aff.setAttribute('data-id', c.id);
            fields.appendChild(aff);
            r.appendChild(fields);
            const actions = el('div', 'wxg-char-actions');
            const playerLabel = el('label', 'checkbox_label wxg-chip-sm');
            const pbox = document.createElement('input');
            pbox.type = 'checkbox';
            pbox.checked = c.isPlayer === true;
            pbox.setAttribute('data-action', 'set-player');
            pbox.setAttribute('data-id', c.id);
            playerLabel.appendChild(pbox);
            // ⭐ 自动认出来的那位：开关旁边说清"为什么它是玩家棋子"，并给她否决的路
            playerLabel.appendChild(el('span', null,
                c.isYou ? '玩家棋子（照酒馆里的人设名自动认的；不想算就取消勾）' : '玩家棋子'));
            actions.appendChild(playerLabel);
            actions.appendChild(button('删', 'del-char', 'wxg-btn-xs', c.id));
            r.appendChild(actions);
        }
        list.appendChild(r);
    }
    cList.appendChild(list);
    if (pagerAtBottom) {
        const pw = el('div', 'wxg-roster-pager');
        pw.appendChild(pagerAtBottom());
        cList.appendChild(pw);
    }
    box.appendChild(cList);
    host.appendChild(box);
}

/**
 * ⭐ 外观：我们自己的配色（工作台是自己的地盘，不必迁就酒馆主题）
 * 预设色板 + 四个槽位可单独改；文字色留空＝按底面亮度自动算。
 */
function secAppearance(host) {
    const SECID = 'appearance';
    const s = getSettings();
    const app = resolveAppearance(s.appearance || {});
    const box = section('外观（工作台配色）',
        '工作台是**我们自己的整页窗口**，配色自己定，不用迁就酒馆主题；'
        + '设置抽屉那边仍跟随酒馆主题。文字色留空＝按底面亮度自动算（浅底深字／深底浅字）。',
        { open: false, summary: PALETTE_NAMES[app.palette] || '', five: true });

    const cTheme = card('色板与颜色槽');
    row(cTheme, field('色板', select('wxg-app-palette',
        PALETTE_KEYS.map((k) => ({ value: k, label: PALETTE_NAMES[k] })),
        app.palette, 'stage-appearance')));

    row(cTheme,
        field('强调色', colorInput('wxg-app-accent', app.accent, 'stage-appearance')),
        field('底面', colorInput('wxg-app-surface', app.surface, 'stage-appearance')),
        field('页面底色', colorInput('wxg-app-bg', app.bg, 'stage-appearance')));
    row(cTheme,
        field('描边', colorInput('wxg-app-border', app.border, 'stage-appearance')),
        field('文字（可留空）', colorInput('wxg-app-text', app.text, 'stage-appearance')));
    row(cTheme,
        button('恢复这个色板', 'reset-appearance'),
        el('span', 'wxg-note', '（只把四个槽位退回所选色板；你手改的颜色会被覆盖）'));
    cTheme.appendChild(checkbox('wxg-app-to-panel', '浮层面板与悬浮小框也用这套配色（不勾＝它们跟随酒馆主题）',
        app.applyToPanel, 'stage-app-to-panel'));

    // 实时预览：四个槽位长什么样，直接给她看
    const pv = el('div', 'wxg-app-preview');
    pv.setAttribute('data-role', 'app-preview');
    // ⭐ #35：用**生效值**（草稿优先）——她改完未保存时重画，预览不能变回去
    applyAppearance(pv, effectiveAppearance());
    pv.appendChild(el('div', 'wxg-app-pv-name', '万象阁 · 预览'));
    const pvRow = el('div', 'wxg-row');
    pvRow.appendChild(el('span', 'wxg-badge', '强调色'));
    pvRow.appendChild(el('span', 'wxg-badge wxg-badge-soft', '淡底'));
    const pvBtn = el('button', 'menu_button', '按钮长这样');
    pvBtn.type = 'button';
    pvRow.appendChild(pvBtn);
    pv.appendChild(pvRow);
    pv.appendChild(el('div', 'wxg-fact', '这一块用的是你选的配色——不用打开工作台就能看出效果。'));
    cTheme.appendChild(pv);
    box.appendChild(cTheme);

    const cMode = card('打开方式');
    row(cMode, field('打开方式', select('wxg-layout-mode', [
        { value: 'workspace', label: '整页工作台（推荐：自己的配色＋左栏导航）' },
        { value: 'panel', label: '浮层面板（老样子，能拖能缩放）' },
    ], s.layoutMode, 'stage-layout-mode')));
    cMode.appendChild(el('div', 'wxg-note', '悬浮小框的开关在「总控」里；它在聊天时常驻，点一下就进工作台。'));
    box.appendChild(cMode);

    box.appendChild(saveBar('appearance'));
    host.appendChild(box);
}

function secRecall(host) {
    const SECID = 'recall';
    const s = getSettings();
    const box = section('召回',
        '她发消息时当场算一次"这轮该带什么"：好感必带；世界与平行事件按她最新发言的相关度筛，相关的进、其余排后台。',
        { open: false, five: true });
    // ⭐ 装盒：数字那几行一块、卡片开关一块（体检第一条）
    // ⭐ 第三层：数字行排成规整两列（左标签右控件，竖着扫一列就行）
    const cPick = card('每一轮怎么挑');
    line(cPick, '线索回溯',
        numberInput('wxg-recent-turns', s.recentTurns, 1, 10, 'stage-recent-turns'),
        el('span', 'wxg-note', '楼'));
    line(cPick, '人物封顶',
        numberInput('wxg-max-chars', s.maxChars, 1, 8, 'stage-max-chars'),
        el('span', 'wxg-note', '个'));
    line(cPick, '事件封顶',
        numberInput('wxg-max-events', s.maxEvents, 0, 20, 'stage-max-events'),
        el('span', 'wxg-note', '条'));
    line(cPick, '排序', select('wxg-sort-mode', [
        { value: 'related', label: '按相关度（先说到的排前面）' },
        { value: 'name', label: '按名册顺序' },
    ], s.sortMode, 'stage-sort-mode'));
    line(cPick, '过去经历只端',
        numberInput('wxg-past-floor-cut', s.pastFloorCut, 0, 50, 'stage-past-floor-cut'),
        el('span', 'wxg-note', '楼之外的（最近这么多楼里的，你上下文里已有，不重复端；0＝全端）'));
    line(cPick, '一轮最多推演',
        numberInput('wxg-max-parallel', s.maxParallelChars, 0, 12, 'stage-max-parallel'),
        el('span', 'wxg-note', '个不在场的角色（省额度：其余下一轮轮转）'));
    box.appendChild(cPick);

    // 卡片那两个开关归这儿（它们是"召回之后怎么显示"的事，⛔ 不是总闸）
    const cCard = card('召回卡片');
    cCard.appendChild(checkbox('wxg-card-enabled', '在你每条发言后面显示召回卡片', s.cardEnabled, 'stage-card'));
    cCard.appendChild(checkbox('wxg-show-empty', '没有召回时也显示空态卡片', s.showEmptyCard, 'stage-show-empty'));
    box.appendChild(cCard);
    box.appendChild(saveBar('recall'));
    host.appendChild(box);
}

function secExtract(host) {
    const SECID = 'extract';
    const s = getSettings();
    const box = section('读取控制（提取／排除四格）',
        '文本名单与点选的世界书／条目改完按段底那颗「保存」一起存（三个规则开关拨动即生效）。'
        + '世界书这一块不用手打书名：点下面的书名就进名单（再点＝排除、再点＝拿掉），'
        + '点「看条目」能一条条挑。标签那一块默认按结构剥掉成对的机器块与 HTML 注释——'
        + '剥完为空会自动退回原文，不会比剥之前更坏。',
        { open: false, five: true });
    // ⭐ 装盒：标签与剥壳 一块、世界书名单 一块、好感来源 一块（体检第一条）
    const cTag = card('标签与剥壳');
    line(cTag, '提取标签', textInput('wxg-extract-tags', stagedValue(SECID, 'extractTags', s.extractTags), '例：正文, content', 'stage-extract-tags', 'wxg-short'));
    line(cTag, '排除标签', textInput('wxg-exclude-tags', stagedValue(SECID, 'excludeTags', s.excludeTags), '例：状态栏, 变量（留空＝只按结构剥）', 'stage-exclude-tags', 'wxg-short'));
    cTag.appendChild(checkbox('wxg-strip-paired', '按结构剥掉成对的机器块（配对的开闭标签，整块剥）', s.stripPairedBlocks, 'set-strip-paired'));
    cTag.appendChild(checkbox('wxg-strip-comments', '剥掉 HTML 注释（<!-- … -->）', s.stripHtmlComments, 'set-strip-comments'));
    box.appendChild(cTag);

    /* ---- 世界书：点选（⛔ 不立刻存，攒到段底一起存） ---- */
    const cBook = card('世界书名单（读哪些／哪些不读）');
    // ⚠️ 原来套了个空标签 field('') ⇒ 输入框被往里推一截、跟上面的标签框对不齐
    line(cBook, '提取（要读的）',
        textInput('wxg-extract-books', stagedValue(SECID, 'extractBooks', s.extractBooks), '留空＝角色卡绑定那本；也可手填，逗号分开', 'stage-extract-books', 'wxg-short'));
    line(cBook, '排除（不读的）',
        textInput('wxg-exclude-books', stagedValue(SECID, 'excludeBooks', s.excludeBooks), '点下面书名也能填进来；也可手填', 'stage-exclude-books', 'wxg-short'));

    const pick = el('div', 'wxg-pickwrap');
    pick.id = 'wxg-bookpick';
    pick.appendChild(el('div', 'wxg-pick-head', '世界书（点一下＝进「提取」；再点＝进「排除」；再点＝拿掉；最后按段底的保存）'));
    cBook.appendChild(pick);
    row(cBook,
        button('读世界书列表', 'list-books', 'wxg-primary'),
        el('span', 'wxg-note', '（没读到就手填；有些酒馆版本没开这个接口）'));
    const bookList = el('div', 'wxg-note', '');
    bookList.id = 'wxg-book-list';
    cBook.appendChild(bookList);

    const entPick = el('div', 'wxg-pickwrap');
    entPick.id = 'wxg-entpick';
    cBook.appendChild(entPick);
    const entNote = el('div', 'wxg-note', '');
    entNote.id = 'wxg-entnote';
    cBook.appendChild(entNote);

    cBook.appendChild(checkbox('wxg-only-enabled', '只读开启着的条目（不选世界书时＝角色卡绑定世界里开启的条目）', s.onlyEnabledEntries, 'set-only-enabled'));
    line(cBook, '好感来源（"手机"）',
        textInput('wxg-affinity-source', stagedValue(SECID, 'affinitySource', s.affinitySource), '例：手机 或 关系表', 'stage-affinity-source', 'wxg-short'),
        el('span', 'wxg-note', '留空＝不接（界面如实写"未接入"）'));
    box.appendChild(cBook);
    box.appendChild(saveBar(SECID));
    host.appendChild(box);
}

function secApi(host) {
    const SECID = 'api';
    const s = getSettings();
    const api = s.api || {};
    const box = section('自定义 API（后台推演走这条通道）',
        '不锁死在酒馆默认连接上。云酒馆建议「经酒馆服务器转发」——密钥留在服务器侧，也绕开跨域。',
        { open: false, five: true });
    // ⭐ 装盒：通道 一块、书签 一块（体检第一条）
    // ⭐ 第三层：这条通道也排成规整两列
    const cCh = card('通道');
    line(cCh, '连接方式', select('wxg-api-mode', [
        { value: 'proxy', label: '经酒馆服务器转发（云酒馆最稳）' },
        { value: 'direct', label: '直连（浏览器直接请求）' },
    ], api.mode, 'stage-api-mode'));
    line(cCh, '接口地址', textInput('wxg-api-url', api.url, 'https://…/v1', 'stage-api-url', 'wxg-short'));
    line(cCh, '密钥', textInput('wxg-api-key', api.key, 'sk-…', 'stage-api-key', 'wxg-short'));
    line(cCh, '推演模型', textInput('wxg-api-model', api.model, '例：gemini-3.8-flash', 'stage-api-model', 'wxg-short'));
    /*
     * ⭐ 目标核对 3①：**拉取模型列表**（她："只能自己输名字太麻烦"）。
     *   点一下拉回来 ⇒ 列成一排可点的小片 ⇒ 点一个就填进「推演模型」（走同一条草稿，照旧要点段底保存）。
     *   ⚠️ 拉不到就**如实说原因**，**⏔ 影响手输**。
     */
    line(cCh, '', button('拉取模型列表', 'fetch-models', 'wxg-btn-sm'),
        el('span', 'wxg-note', '（向地址 + /models 要一份清单；拉不到也可以自己填）'));
    cCh.appendChild(el('div', 'wxg-chipwrap', '')).id = 'wxg-api-modellist';
    line(cCh, '打杂模型', textInput('wxg-api-model-cheap', api.modelCheap, '留空＝同上', 'stage-api-model-cheap', 'wxg-short'));
    line(cCh, '温度',
        numberInput('wxg-api-temp-code', api.temperature, 0, 2, 'stage-api-temp'),
        el('span', 'wxg-note', '单次最多输出'),
        numberInput('wxg-api-maxtok', api.maxTokens, 200, 8000, 'stage-api-maxtok'));
    /*
     * ⭐ 目标核对 3②：**把"已保存的地址/模型"摆出来**。
     *   她报过"模型名字填了、sk也填了"却仍报"没配好" ⇒
     *   光看输入框里的字**分不清是没保存上还是没填**。
     *   这行读的是**已落盘的设置值**（⏔ 输入框）⇒ 一眼就知道存没存上。
     */
    const savedApi = getSettings().api || {};
    cCh.appendChild(el('div', 'wxg-note wxg-api-savedline',
        '已保存的：地址 ' + (trimText(savedApi.url) || '（空）')
        + '｜推演模型 ' + (trimText(savedApi.model) || '（空）')
        + '｜模式 ' + (savedApi.mode === 'direct' ? '直连' : '经酒馆转发')));
    row(cCh, button('测一下连接', 'test-api', 'wxg-primary'), el('span', 'wxg-note', '（只发一句很短的话，验证地址／密钥／模型对不对）'));
    box.appendChild(cCh);

    /* ⭐ 书签（她点名要的："加一个保存 API／另存为，我可以设定好几个 API 转"） */
    const cProf = card('书签（存好几套通道，一键切）');
    const profs = Array.isArray(api.profiles) ? api.profiles : [];
    if (!profs.length) {
        cProf.appendChild(emptyBlock('还没有书签。上面填好一套，起个名字点「另存为书签」，以后一键切回来。'));
    } else {
        const listEl = el('div', 'wxg-prof-list');
        for (const p of profs) {
            const r = el('div', 'wxg-prof');
            const info = el('div', 'wxg-prof-info');
            info.appendChild(el('span', 'wxg-prof-nick', trimText(p.nick)));
            info.appendChild(el('span', 'wxg-note', (trimText(p.model) || '（没填模型）')
                + (trimText(p.url) ? ' · ' + hostOf(p.url) : '')
                + ' · ' + (p.mode === 'direct' ? '直连' : '走酒馆转发')));
            r.appendChild(info);
            const acts = el('div', 'wxg-row');
            const use = button('切到这套', 'apply-profile', 'wxg-btn-sm wxg-primary', trimText(p.nick));
            acts.appendChild(use);
            acts.appendChild(button('删', 'del-profile', 'wxg-btn-sm', trimText(p.nick)));
            r.appendChild(acts);
            listEl.appendChild(r);
        }
        cProf.appendChild(listEl);
    }
    row(cProf,
        textInput('wxg-profile-nick', '', '书签名（例：主站／备用站）', 'noop', 'wxg-short'),
        button('另存为书签', 'save-profile', 'wxg-primary'));
    cProf.appendChild(el('div', 'wxg-note', '书签存的是**整套**：连接方式／地址／密钥／模型／温度／输出上限。'
        + '书签名一样就更新那一条（不会越存越多）；想现在就用它，点上面那颗「切到这套」。'));
    box.appendChild(cProf);
    box.appendChild(saveBar('api'));
    host.appendChild(box);
}

/* ---------------------------------------------------------------------------
   ⭐ 只读默认 ＋ 「编辑」（复核方第四条：不点是只读，改不了，免得弄错）
   --------------------------------------------------------------------------- */

/** 现在开着编辑的数据卡（键是卡名；⛔ 不落设置——「正在编辑」不是一种设置） */
const unlockedCards = new Set();

/**
 * 把一张数据卡做成「只读默认」：锁着的时候看着就是文字，不是一堆空框。
 *
 * @param {Element} cardEl 卡（就是 card() 返回的那个）
 * @param {string} key 卡名（同一页里唯一即可）
 */
function lockable(cardEl, key) {
    if (!cardEl || !cardEl.classList) {
        return cardEl;
    }
    const open = unlockedCards.has(key);
    cardEl.classList.toggle('is-locked', !open);
    // 卡头右侧那颗「编辑／收起」（先把旧的拿掉，免得重画后堆两颗）
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

/**
 * 把「锁着的卡」里的字段真正设成只读（在整页 DOM 建完之后调）。
 * ⏐ 不能只靠 CSS：样式挡不住键盘输入和脚本赋值。
 * ⏐ 也不锁控制项（开关／颜色）——那些本来就是拿来点的。
 */
export function applyLocks(root) {
    if (!root || typeof root.querySelectorAll !== 'function') {
        return;
    }
    for (const cardEl of asArray(root.querySelectorAll('.wxg-card[data-lock-key]'))) {
        const locked = cardEl.classList && cardEl.classList.contains('is-locked');
        for (const f of asArray(cardEl.querySelectorAll('input, textarea, select'))) {
            if (!f || !f.setAttribute) {
                continue;
            }
            if (f.type === 'color' || f.type === 'checkbox') {
                continue;
            }
            // 新增行（data-no-lock）不参与只读锁，随时可填可点
            let noLock = typeof f.closest === 'function' && !!f.closest('[data-no-lock]');
            if (!noLock) {
                for (let p = f.parentNode; p && p !== cardEl; p = p.parentNode) {
                    if (typeof p.getAttribute === 'function' && p.getAttribute('data-no-lock')) {
                        noLock = true;
                        break;
                    }
                }
            }
            if (noLock) {
                f.removeAttribute('readonly');
                f.removeAttribute('tabindex');
                continue;
            }
            if (locked) {
                f.setAttribute('readonly', 'readonly');
                f.setAttribute('tabindex', '-1');
            } else {
                f.removeAttribute('readonly');
                f.removeAttribute('tabindex');
            }
        }
    }
}

/** 从 URL 里取主机名，只用于显示（⛔ 不泄露整条密钥） */
function hostOf(url) {
    const s = asText(url);
    const m = s.match(/^[a-z]+:\/\/([^/]+)/i);
    return m ? m[1] : (s.length > 24 ? s.slice(0, 24) + '…' : s);
}

/**
 * 提示词：**折叠条 ＋ 当前用的那份直接预览**。
 *
 * 体检结论点名这里最重："世界推演／角色状态／破限词三个大空框叠着，像没做完的草稿"。
 * 改法：一套提示词一块卡 —— 先给她看**当前实际会用的那份**（留空就是内置的，直接摊开读），
 * 想改才点「改这套」展开输入框。⛔ 空框不再当主角。
 */
function secPrompts(host) {
    const s = getSettings();
    const box = section('提示词（可看可改）',
        '留空＝用内置默认；填了＝原样用你写的。破限词同理。'
        + '下面每块先显示**当前实际用的那份**（留空就是内置的），想改再点「改这套」。',
        { open: false, five: true });

    /*
     * ⭐ 一屏一个焦点（复核方第一条）：**只把第一块摊开**，其余三块收起。
     *    四块内容差不多、都很长 ⇒ 全摊开就是"一屏四张卡"，正是他说要避免的。
     *    收起不等于藏起来：卡头那行字还在，点一下就展开（⛔ 不丢任何东西）。
     */
    // 第一块（主焦点卡）：直接摊开
    const cHead = card('注入块开头那句');
    cHead.appendChild(el('div', 'wxg-note', '每轮注入的最前面那一行，声明"这是引擎附注"。'));
    cHead.appendChild(el('pre', 'wxg-prompt-cur', effectivePrompt('header')));
    const editHead = foldable('改这套（留空＝用内置）', false);
    editHead.appendChild(textarea('wxg-inject-header', s.injectHeader, '（留空＝用内置那份）', 'stage-inject-header', 3));
    cHead.appendChild(editHead);
    box.appendChild(cHead);

    // 其余三套长提示词 ＋ 恢复默认：收拢进同一张卡，告别 5 张大卡满屏堆叠
    const cMore = card('后台推演与破限提示词（按需展开）');
    const addFoldedPrompt = (title, keyVal, kind, id, rows, hint) => {
        const fold = foldable(title + ' · 展开看这套（' + String(effectivePrompt(kind).length) + ' 字）', false);
        const body = el('div', 'wxg-report-body');
        body.appendChild(el('div', 'wxg-note', hint));
        body.appendChild(el('pre', 'wxg-prompt-cur', effectivePrompt(kind)));
        const edit = foldable('改这套（留空＝用内置）', false);
        edit.appendChild(textarea(id, keyVal, '（留空＝用内置那份）', 'stage-' + id.replace('wxg-', ''), rows));
        body.appendChild(edit);
        fold.appendChild(body);
        cMore.appendChild(fold);
    };
    addFoldedPrompt('世界推演提示词', s.promptWorld, 'world', 'wxg-prompt-world', 8,
        '让模型推"世界现在什么样"时用的那套规矩。');
    addFoldedPrompt('角色状态／平行事件提示词', s.promptChars, 'chars', 'wxg-prompt-chars', 8,
        '让模型写每个角色的平行线时用的那套规矩。');
    addFoldedPrompt('破限词', s.jailbreak, 'jailbreak', 'wxg-jailbreak', 6,
        '模型有时候"不填东西"——这一段是逼它老实填字段用的。');
    const resetRow = el('div', 'wxg-card-actions');
    row(resetRow, button('全部恢复内置默认', 'reset-prompts'),
        el('span', 'wxg-note', '（只清提示词，不动你的开关）'));
    cMore.appendChild(resetRow);
    box.appendChild(cMore);
    box.appendChild(saveBar('prompts'));
    host.appendChild(box);
}

/**
 * 每轮记录（原「过程报告」）。同上：给了容器就摆进去，自己不开页。
 */
function secReport(host, intoBox) {
    const list = recentRecallRecords(20);
    // 摘要只留一句（标题行是 nowrap 的，太长会被裁）；完整口径放正文
    const box = intoBox || section('过程报告 · 每轮到底注入了什么', '每轮注入了什么，可回看',
        { open: false });
    const noteText = '按时间从新到旧：① 怎么挑的 ② 实际送进请求的内容一字不差（可复制）'
        + '③ 回执（成没成、多少字、什么身份、为什么没注入）。（' + FLOOR_NOTE + '）';
    if (!list.length) {
        /*
         * ⚠️ 空的时候**也要有标题**（并页之后更明显）：原来整块都不画 ⇒
         *    她在「状态」页上根本不知道这儿将来会出一条"每轮记录"。
         *    现在就一句「还没有记录」，标题留着。
         */
        const cEmpty = card('每轮记录');
        cEmpty.appendChild(el('div', 'wxg-note', noteText));
        cEmpty.appendChild(el('div', 'wxg-empty', '还没有记录：发一条消息、正文生成之后就会有了。'));
        box.appendChild(cEmpty);
        if (!intoBox) {
            host.appendChild(box);
        }
        return;
    }
    // ⭐ 装盒：报告列表一块（体检第一条）
    /*
     * ⭐ 有数据排版术：顶部一排**筛选胶囊带计数**（这一页天生带状态：成没成／注入没注入），
     *    每条的状态做成**胶囊**（原来埋在文字里，"哪条没成"得逐字读）。
     */
    const statusOf = (r) => (r.injectStatus === 'ok' ? '已注入'
        : (r.injectStatus === 'empty' ? '未注入' : (r.injectStatus === 'error' ? '失败' : '待送')));
    const statusTone = (r) => (r.injectStatus === 'ok' ? 'is-ok'
        : (r.injectStatus === 'error' ? 'is-warn' : 'is-off'));
    const shownList = reportFilter === 'all' ? list : list.filter((r) => statusOf(r) === reportFilter);
    const fbar = el('div', 'wxg-filters');
    const mkF = (key, label, n) => {
        const b = el('button', 'wxg-filter' + (reportFilter === key ? ' is-on' : ''), label);
        b.type = 'button';
        b.setAttribute('data-action', 'report-filter');
        b.setAttribute('data-id', key);
        b.appendChild(el('span', 'wxg-filter-n', String(n)));
        return b;
    };
    fbar.appendChild(mkF('all', '全部', list.length));
    for (const st of ['已注入', '未注入', '失败']) {
        const n = list.filter((r) => statusOf(r) === st).length;
        if (n) {
            fbar.appendChild(mkF(st, st, n));
        }
    }

    const cRep = card('每轮记录（从新到旧）');
    cRep.appendChild(el('div', 'wxg-note', noteText));
    cRep.appendChild(fbar);
    for (let idx = 0; idx < shownList.length; idx += 1) {
        const rec = shownList[idx];
        const shownChars = countChars(rec.injectedText);
        const statusText = statusOf(rec);
        const det = foldable('', false);
        // 折叠条标题行改成"行化"排法（时间骨架｜状态胶囊｜楼层·字数｜人）
        if (det.classList) {
            det.classList.add('is-row');
        }
        const sum = det.querySelector('summary');
        if (sum) {
            sum.textContent = '';
            sum.appendChild(el('span', 'wxg-r-k wxg-num', shortTime(rec.at)));
            sum.appendChild(el('span', 'wxg-badge ' + statusTone(rec), statusText));
            sum.appendChild(el('span', 'wxg-note', floorLabel(rec.floor)
                + (rec.injectStatus === 'ok' ? ' · ' + String(shownChars) + ' 字' : '')));
            sum.appendChild(el('span', 'wxg-r-who', rec.chars && rec.chars.length ? rec.chars.join('、') : '暂无'));
        }
        const body = el('div', 'wxg-report-body');

        body.appendChild(el('div', 'wxg-report-h', '① 怎么挑的'));
        const lead = trimText(rec.lead);
        body.appendChild(el('div', 'wxg-fact', '你这条发言：' + (lead ? (lead.length > 80 ? lead.slice(0, 80) + '…' : lead) : '（没记到）')));
        if (Array.isArray(rec.items) && rec.items.length) {
            for (const item of rec.items) {
                const c = item && item.character ? item.character : {};
                // 空值写「暂无」（复核方第六条：不隐身、不写"—"）
                const bits = [trimText(c.name) || '（未记名）', '理由：' + (trimText(item.reason) || '暂无')];
                const has = [];
                has.push(trimText(c.affinity) ? '好感 ' + trimText(c.affinity) : '好感未接入数据源');
                if (trimText(c.identity)) {
                    has.push('身份 ' + trimText(c.identity));
                }
                if (trimText(c.current)) {
                    has.push('正在经历');
                }
                if (Array.isArray(c.past) && c.past.length) {
                    has.push('过去经历 ' + String(c.past.length) + ' 条');
                }
                bits.push('带了：' + has.join('、'));
                if (item.protected) {
                    bits.push('现场保护（不重复推演）');
                }
                body.appendChild(el('div', 'wxg-fact', '· ' + bits.join(' ｜ ')));
            }
        } else {
            body.appendChild(el('div', 'wxg-empty', '本轮没有召回任何人'));
        }
        if (Array.isArray(rec.events) && rec.events.length) {
            body.appendChild(el('div', 'wxg-report-h', '本轮带上的世界事件'));
            for (const ev of rec.events) {
                body.appendChild(el('div', 'wxg-fact', '· ' + (trimText(ev.title) || '') + (trimText(ev.text) ? '：' + trimText(ev.text) : '')));
            }
        }
        if (Array.isArray(rec.notes) && rec.notes.length) {
            body.appendChild(el('div', 'wxg-notes', '说明：' + rec.notes.join('；')));
        }
        // ⭐ 这一轮更新里"与你的手改冲突"的具体条目（条 16：⛔ 不许只报个数字）
        if (Array.isArray(rec.conflicts) && rec.conflicts.length) {
            body.appendChild(el('div', 'wxg-report-h', '⚠️ 这一轮更新时与你的手改冲突'));
            body.appendChild(el('div', 'wxg-notes', '引擎按**你的版本**保留，没冲掉你改的字：'));
            for (const c of rec.conflicts) {
                body.appendChild(el('div', 'wxg-fact', '· ' + asText(c)));
            }
        }

        body.appendChild(el('div', 'wxg-report-h', '② 实际送进请求的内容'));
        const text = trimText(rec.injectedText);
        if (text) {
            body.appendChild(el('pre', 'wxg-report-text', text));
            const bar = el('div', 'wxg-row');
            const key = 'rec-' + String(rec.floor) + '-' + String(rec.at);
            bar.appendChild(button('复制这段', 'copy-text', 'wxg-btn-sm', key));
            bar.appendChild(el('span', 'wxg-note', '这段只进请求、不落正文。'));
            body.appendChild(bar);
            const holder = el('div', 'wxg-hidden-text', text);
            holder.id = 'wxg-text-' + key;
            holder.style.display = 'none';
            body.appendChild(holder);
        } else {
            body.appendChild(el('div', 'wxg-empty', '本轮没有内容送进去'));
        }

        body.appendChild(el('div', 'wxg-report-h', '③ 回执'));
        body.appendChild(el('div', 'wxg-fact', receiptText(rec)));
        if (trimText(rec.injectType)) {
            body.appendChild(el('div', 'wxg-notes', '触发方式：' + trimText(rec.injectType)));
        }
        /*
         * ⭐ 补②「送达回执」：**发出去了 ≠ 正文接到了**。这一行就是那后半句。
         *   · 已进正文（#N）／候补（第 k/3 轮没进）／已转编年（不再占注入位）
         *   ⛔ 只如实报，不替正文辩解；没标记的老记录就写「还没核过」。
         */
        const arriveLine = trimText(rec.arrivedNote)
            || (rec.injectStatus === 'ok' ? '还没核过（下次更新时会对着正文核一遍）' : '');
        if (arriveLine) {
            const aRow = el('div', 'wxg-notes', '送达：' + arriveLine);
            if (rec.archived === true) {
                aRow.setAttribute('data-tone', 'bad');
            }
            body.appendChild(aRow);
        }
        det.appendChild(body);
        /*
         * ⭐ 点行弹浮层（照目标包：跟名册那件**同一套手法**）。
         *   做法刻意保守：**正文那 ①②③ 一个字没改**——原来拼进 `det`（行内折叠条），
         *   现在**把它整块搬进浮层**（DOM 搬移），所以不存在"浮层里跟行内不一样"。
         *   ⏔ 没开任何一条时，行为跟以前一模一样（照旧挂回列表）。
         */
        if (openRecordAt === idx) {
            renderRecordCard(rec, body, idx, shownList.length, statusText, statusTone(rec), shownChars);
        } else {
            if (sum) {
                sum.setAttribute('data-action', 'open-record');
                sum.setAttribute('data-id', String(idx));
            }
            cRep.appendChild(det);
        }
    }
    box.appendChild(cRep);
    if (!intoBox) {
        host.appendChild(box);
    }
}

/**
 * 进度那一整块。
 * @param {object} host 宿主（只在需要自开一页时用）
 * @param {object} [intoBox] 给了就往这个盒子里摆（（三页并一页就是走这条），⏐ 不再开新页
 */
function secSteps(host, intoBox) {
    /*
     * ⭐ 这一页原来是**插件自己的开发清单**（① 骨架 ② 主线 ③ 世界状态…）。
     *    复核方一眼看穿："这个是插件进度吧？做完了的情况这个是删除还是？"
     *    ——对，那是我造它时的待办，对用户毫无价值；插件做完了它就是一页废纸。
     *    换成她提的**真实楼层进度**：做了多少楼、还剩多少楼（还能看出是哪几楼）。
     */
    const box = intoBox || section('现在的进度',
        '引擎按楼层往后走：已做的楼有记录，没做的楼下次更新会接着走。',
        { open: true });
    const chat = getChat();
    const total = chat.length;
    if (!total) {
        box.appendChild(el('div', 'wxg-empty', '这个聊天还没有正文（发一条消息就有了）'));
        if (!intoBox) {
            host.appendChild(box);
        }
        return;
    }

    const state = loadState();
    const chron = getChronicle();
    const recs = asArray(state.recallRecords);
    const lastFloor = (state.lastUpdate && Number.isFinite(Number(state.lastUpdate.floor)))
        ? Number(state.lastUpdate.floor) : -1;

    /*
     * ⚠️ 楼层口径**必须跟酒馆一致**（复核方点名）：酒馆消息头上的编号从 0 起，
     *    **#0 就是开场白**。所以"共几楼"＝聊天数组长度，楼号 0 … 长度-1。
     *    ⏐ 别自己从 1 数、也别把开场白漏掉（那会跟她在酒馆里看到的号对不上）。
     */
    const perFloor = new Map();
    const touch = (f) => {
        const k = Number(f);
        if (!Number.isFinite(k) || k < 0) {
            return null;
        }
        if (!perFloor.has(k)) {
            perFloor.set(k, { chron: 0, chars: 0, rec: null });
        }
        return perFloor.get(k);
    };
    for (const c of chron) {
        const e = touch(c.floor);
        if (e) {
            e.chron += 1;
        }
    }
    for (const r of recs) {
        const e = touch(r && r.floor);
        if (e) {
            e.rec = r;
            e.chars = countChars(r.injectedText);
        }
    }

    /*
     * 分类计数（照柚月那张"进度"的排法：一行一类，"已 X | 没 X"）。
     * ⏐ 口径写清楚，不美化：没记录就是没记录。
     */
    const rows = [];
    for (let f = 0; f < total; f += 1) {
        const e = perFloor.get(f) || null;
        const done = !!(e && (e.chron || e.rec)) || (lastFloor >= 0 && f <= lastFloor);
        rows.push({
            floor: f,
            done,
            info: e,
            injected: !!(e && e.rec && e.rec.injectStatus === 'ok'),
            chron: !!(e && e.chron),
        });
    }
    const stat = (pred) => rows.filter(pred).length;
    const doneCount = stat((r) => r.done);
    // 走到哪楼了（取已做里最高的那楼；⏐ 不假设它们是连着的）
    const maxDone = rows.filter((r) => r.done).reduce((m, r) => Math.max(m, r.floor), -1);
    const injCount = stat((r) => r.injected);
    const chronCount = stat((r) => r.chron);
    const num = (n) => String(n) + ' 楼';

    /*
     * ⭐ 统计表（自家面板那张真机图的排法）：
     *    第一行先单独一句「总共 N 楼」，下面才是一行一类的「已 X｜没 X」。
     */
    // ⭐ 统计表（一行一类，总共 N 楼与逐楼清单都收在同一张「进度」卡里）
    const cStat = card('进度');
    // ⚠️ `num()` 自带" 楼"（它是 `String(n) + ' 楼'`）——这里⏔ 再加单位
    cStat.appendChild(el('div', 'wxg-total-line', '总共 ' + num(total) + '（含 #0 开场白）'));
    /*
     * ⭐ 目标核对 1（目标：状态页）：**三行胶囊 ⇒ 两列小表**。
     *   她 2026-10-15 00:22 亲手给的目标图里，这一格是一张表：
     *     表头＝**已完成 ｜ 未完成**；行＝正文／注入／编年；格＝「**N 楼**」（居中，淡线）。
     *   原本是"已 X｜没 X"的胶囊 ⇒ 术语也跟着改成**已完成／未完成**。
     *   ⏔ 动其余（总共 N 楼行／进度条／折叠行／存档行）。
     */
    const ptab = el('table', 'wxg-ptab');
    const thead = el('thead', null);
    const htr = el('tr', null);
    htr.appendChild(el('th', null, ''));
    htr.appendChild(el('th', null, '已完成'));
    htr.appendChild(el('th', null, '未完成'));
    thead.appendChild(htr);
    ptab.appendChild(thead);
    const tbody = el('tbody', null);
    const addStat = (label, doneN, totalN) => {
        const tr = el('tr', null);
        tr.appendChild(el('td', null, label));
        const cell = (n) => {
            const td = el('td', null);
            // ⚠️ ⏔ 用 num()：它自带" 楼" ⇒ 会变成"N 楼 楼"
            td.appendChild(el('b', null, String(n)));
            td.appendChild(el('span', null, ' 楼'));
            return td;
        };
        tr.appendChild(cell(doneN));
        tr.appendChild(cell(totalN - doneN));
        tbody.appendChild(tr);
    };
    addStat('正文', doneCount, total);
    addStat('注入', injCount, total);
    addStat('编年', chronCount, total);
    ptab.appendChild(tbody);
    cStat.appendChild(ptab);

    // 表下小注：正文最高到哪、上次停在哪（目标态把它放在**表下**，⏔ 跟在行里）
    cStat.appendChild(el('div', 'wxg-note',
        (maxDone >= 0 ? '正文最高到 ' + floorLabel(maxDone) : '正文还没开始')
        + (lastFloor >= 0 ? '（上次更新停在 ' + floorLabel(lastFloor) + '）' : '（还没更新过）')));
    // 说明行：术语必须自己解释（跟目标态同一口径）
    cStat.appendChild(el('div', 'wxg-note',
        '「已完成」＝引擎走过去并留下记录的楼（有编年或有回执，或者在世界钟走过的范围内）；'
        + '「未完成」＝下次更新会接着走的楼。楼层号跟酒馆消息头上的编号一致：#0 是开场白。'));
    // 原来注入／编年两行各有一句小注 ⇒ 信息⏔ 丢，收成一行
    cStat.appendChild(el('div', 'wxg-note',
        '注入＝把状态送进请求的楼；编年＝留下过记录的楼。'));

    // 进度条
    const pct = total ? Math.round((doneCount / total) * 100) : 0;
    const track = el('div', 'wxg-pbar');
    const fill = el('div', 'wxg-pbar-fill');
    if (fill.style) {
        fill.style.width = String(pct) + '%';
    }
    track.appendChild(fill);
    cStat.appendChild(track);
    cStat.appendChild(el('div', 'wxg-note', '走了 ' + String(pct) + '%（'
        + (total - doneCount ? '再更新 ' + num(total - doneCount) + '就追平正文' : '已经追平正文') + '）'));

    /*
     * ⭐ 逐楼清单**收进折叠条**（照"一屏一个焦点"）：主画面就是上面那张统计表，
     *    想看"到底是哪几楼"再点开。⏐ 不是删掉——她要的是两份都在。
     */
    const detail = foldable('展开看是哪几楼（' + num(total) + '）', false);
    const fbar = el('div', 'wxg-filters');
    const mk = (key, label, n) => {
        const b = el('button', 'wxg-filter' + (stepFilter === key ? ' is-on' : ''), label);
        b.type = 'button';
        b.setAttribute('data-action', 'step-filter');
        b.setAttribute('data-id', key);
        b.appendChild(el('span', 'wxg-filter-n', String(n)));
        return b;
    };
    fbar.appendChild(mk('all', '全部', total));
    fbar.appendChild(mk('done', '已做', doneCount));
    fbar.appendChild(mk('todo', '还没做', total - doneCount));
    detail.appendChild(fbar);

    const shown = stepFilter === 'done' ? rows.filter((r) => r.done)
        : (stepFilter === 'todo' ? rows.filter((r) => !r.done) : rows);
    stepPage = clampPage(stepPage, shown.length, PER_PAGE.steps);
    if (shown.length > PER_PAGE.steps) {
        detail.appendChild(pager('step-page', stepPage, PER_PAGE.steps, shown.length));
    }

    // 一行一楼（新的在上面）
    const newest = shown.slice().reverse();
    const pageRows = newest.slice((stepPage - 1) * PER_PAGE.steps, stepPage * PER_PAGE.steps);
    if (!pageRows.length) {
        detail.appendChild(el('div', 'wxg-empty', '这一筛没有楼层'));
    }
    for (const r of pageRows) {
        const row = el('div', 'wxg-r');
        row.appendChild(el('div', 'wxg-r-k wxg-num', floorLabel(r.floor)
            + (r.floor === 0 ? ' 开场白' : '')));
        const main = el('div', 'wxg-r-main');
        const title = el('div', 'wxg-r-title');
        if (r.done) {
            title.appendChild(el('span', 'wxg-badge is-ok', '已做'));
            if (r.injected) {
                title.appendChild(el('span', 'wxg-badge is-info', '已注入'));
            }
            main.appendChild(title);
            const bits = [];
            if (r.info && r.info.chron) {
                bits.push('编年 ' + String(r.info.chron) + ' 条');
            }
            if (r.info && r.info.chars) {
                bits.push('注入 ' + String(r.info.chars) + ' 字');
            }
            main.appendChild(el('div', 'wxg-r-sub', bits.length ? bits.join(' · ') : '走过了（这楼没单独留记录）'));
        } else {
            title.appendChild(el('span', 'wxg-badge is-off', '还没做'));
            main.appendChild(title);
            main.appendChild(el('div', 'wxg-r-sub', lastFloor >= 0
                ? ('等下次更新（引擎现在停在 ' + floorLabel(lastFloor) + '）')
                : '还没更新过（点「立刻更新」或等新楼）'));
        }
        row.appendChild(main);
        detail.appendChild(row);
    }
    cStat.appendChild(detail);
    box.appendChild(cStat);
    if (!intoBox) {
        host.appendChild(box);
    }
}

/* ------------------------------ 渲染与事件 ------------------------------ */

/** 把整套分节画进宿主 */
/* ------------------------------ ⭐ 浮层人物卡（② 名册点开详情） ------------------------------ */

/**
 * 为什么做成浮层（她 2026-10-14 点名的）：
 *   原来点一行的做法是**行内展开**——一个巨大表单把后面 40 行全推下去，左边还挂个
 *   「改他的状态」标签跟输入框对不齐（真机截图里很难看）。
 *   ⇒ 照目标包 `目标-名册浮层人物卡-20261014/目标-名册浮层人物卡-目标态.html` 改成**可拖浮层**：
 *     覆盖层，表格**原地不动**；大名字做锚；两栏标签值；底部长条换人。
 *
 * ⚠️ 关键决定：**沿用同一套控件与动作名**（`set-char-field` / `merge-into` / `data-id` / `data-key`）
 *   ⇒ 数据层**一行不改**（保存路径、手改锁、快照都还是原来那条），⛔ 不另起一套。
 */
let personCardId = null;
/*
 * ⭐ 浮层要挂在**段容器里**而不是 body：
 *   点击处理器只绑在段容器上（`bindSectionEvents(host)`）⇒
 *   挂 body 上的话，浮层里的「下一位」「×」「保存」「改字」**全都点不动**
 *   （真机门当场抓到：下一位没反应、关不掉）。
 *   用 `position: fixed` 照样浮在最上层，不受宿主滚动影响。
 */
let lastSectionsHost = null;
/**
 * 浮层在**编辑态**吗？默认 false＝**只读**；点右上「⋮」才进编辑。
 * （她的原话：不点是只读改不了免得弄错；目标包：⋮点开＝编辑这一位）
 */
let personCardEditing = false;

/**
 * ⭐ 「每轮记录」点开的是第几条（-1＝都没开）。
 *   照目标包：点行弹浮层，**跟名册那件同一套手法**（⏔ 行内展开）。
 */
let openRecordAt = -1;

export function openPersonCard(id) {
    personCardId = id || null;
    personCardEditing = false;   // 开卡／换人：一律先回到**只读**态
    renderPersonCard();
}

export function closePersonCard() {
    personCardId = null;
    personCardEditing = false;
    const old = document.getElementById('wxg-person-card');
    if (old && typeof old.remove === 'function') {
        old.remove();
    }
}

/** 把浮层画出来（挂在 body 上＝真浮层，⛔ 不塞进段里免得被重画冲掉） */
function renderPersonCard() {
    const host = document.getElementById('wxg-person-card');
    if (host && typeof host.remove === 'function') {
        host.remove();
    }
    if (!personCardId) {
        return;
    }
    const roster = getRoster();
    const at = roster.findIndex((c) => c.id === personCardId);
    if (at < 0) {
        personCardId = null;
        return;
    }
    const c = roster[at];
    const one = findCharacter(personCardId) || c;

    const pop = el('div', 'wxg-pc wanxiangge');
    pop.id = 'wxg-person-card';
    pop.setAttribute('role', 'dialog');

    // ① 标题栏＝拖动把手：⠿ ／ 大名字 ／ 别名 ／ 胶囊 ／ ⋮（她 10-15 01:44 令：⋮＝编辑这一位）
    const head = el('div', 'wxg-pc-head');
    head.appendChild(el('span', 'wxg-pc-grip', '⠿'));
    const who = el('div', 'wxg-pc-who');
    who.appendChild(el('div', 'wxg-pc-name', c.name || '（没名字）'));
    who.appendChild(el('div', 'wxg-pc-alias', '别名 · ' + (one.aliases && one.aliases.length ? one.aliases.join('、') : '暂无')));
    head.appendChild(who);
    const badges = el('div', 'wxg-pc-badges');
    if (one.inScene) {
        badges.appendChild(el('span', 'wxg-badge is-ok', '在场'));
    }
    if (one.manual) {
        badges.appendChild(el('span', 'wxg-badge is-warn', '已手动修改'));
    }
    if (one.isPlayer) {
        badges.appendChild(el('span', 'wxg-badge is-info', '玩家棋子'));
    }
    head.appendChild(badges);
    const kebab = button('⋮', 'card-edit', 'wxg-pc-kebab');
    kebab.title = personCardEditing ? '正在编辑（点一下收起）' : '编辑这一位（点了才可改，不点只读）';
    head.appendChild(kebab);
    const x = button('×', 'card-close', 'wxg-pc-x');
    x.title = '关掉（Esc 也行）';
    head.appendChild(x);
    pop.appendChild(head);

    // ② 基础信息：两栏「标签（暗）｜值（亮）」，值**就是输入框**（沿用 set-char-field）
    const sec1 = el('div', 'wxg-pc-sec');
    sec1.appendChild(el('div', 'wxg-pc-sech', '基础信息'));
    const kv = el('div', 'wxg-pc-kv');
    const row2 = (k1, f1, ph1, k2, f2, ph2) => {
        kv.appendChild(el('div', 'wxg-pc-k', k1));
        kv.appendChild(fieldBox(cid, f1, one[f1], ph1));
        kv.appendChild(el('div', 'wxg-pc-k', k2));
        kv.appendChild(fieldBox(cid, f2, one[f2], ph2));
    };
    /*
     * ⚠️ 一律用 **state 那份**的 id（`one.id`）去挂 data-id：
     *   名册那份（`c.id`）跟 state 那份**类型可能不一样**（数字 vs 字符串），
     *   而外面点这些格子的人（用例、以后的代码）拿的是 state 那份 ⇒ 不一致就"找不到输入框"。
     */
    const cid = one.id !== undefined && one.id !== null ? one.id : c.id;
    row2('年龄', 'age', '未知', '身份', 'identity', '未知');
    row2('所在势力', 'faction', '暂无', '好感', 'affinity', '未接入');
    /*
     * ⭐ 别名／玩家棋子也放进来。
     * ⚠️ 它们原来只在**行内展开**里（`set-alias` / `set-player`）——把行改成开浮层之后
     *    那两个开关就摸不到了（audit-3 当场红了 4 条）⇒ 补进浮层，动作名沿用同一套。
     */
    kv.appendChild(el('div', 'wxg-pc-k', '别名'));
    const aliasWrap = el('div', 'wxg-pc-v');
    aliasWrap.classList.add('wxg-pc-full');
    if (!personCardEditing) {
        const al = (one.aliases || []).join('、');
        aliasWrap.appendChild(el('div', 'wxg-pc-text' + (al ? '' : ' is-empty'), al || '暂无'));
    } else {
        const aliasInput = textInput('wxg-pc-alias-' + cid, (one.aliases || []).join('、'),
            '别名／昵称（顿号或逗号分开）', 'set-alias');
        aliasInput.setAttribute('data-id', cid);
        aliasWrap.appendChild(aliasInput);
    }
    kv.appendChild(aliasWrap);
    const pbox = el('label', 'wxg-pc-player');
    const pchk = el('input', null);
    pchk.type = 'checkbox';
    pchk.checked = one.isPlayer === true;
    pchk.setAttribute('data-action', 'set-player');
    pchk.setAttribute('data-id', cid);
    pbox.appendChild(pchk);
    pbox.appendChild(el('span', null, '这是玩家棋子（⛔ AI 不扮演、不推演）'));
    kv.appendChild(el('div', 'wxg-pc-k', ''));
    const pwrap = el('div', 'wxg-pc-v');
    pwrap.classList.add('wxg-pc-full');
    pwrap.appendChild(pbox);
    kv.appendChild(pwrap);

    /*
     * ⭐ 补①：「参与后台推演」开关（默认开）。
     *   说人话：**关掉＝后台不再推他**（不占轮转名额）；他仍在名册里，
     *   正文写到他的时候**照旧更新**（现场那套不变）。⛔ 关掉不删任何历史。
     *   ⚠️ 这里**用"关"来描述**（`noBench` 存的是"关"），因为默认是开——
     *     勾选框的措辞要是反的，她会勾错（"勾上＝不推"最容易看反）。
     */
    const bbox = el('label', 'wxg-pc-player');
    const bchk = el('input', null);
    bchk.type = 'checkbox';
    bchk.checked = one.noBench !== true;
    bchk.setAttribute('data-action', 'set-bench');
    bchk.setAttribute('data-id', cid);
    bbox.appendChild(bchk);
    bbox.appendChild(el('span', null, '参与后台推演（不勾＝只在正文写到他时才更新，不占轮转名额）'));
    kv.appendChild(el('div', 'wxg-pc-k', ''));
    const bwrap = el('div', 'wxg-pc-v');
    bwrap.classList.add('wxg-pc-full');
    bwrap.appendChild(bbox);
    kv.appendChild(bwrap);
    kv.appendChild(el('div', 'wxg-pc-k', '时间·地点'));
    const tp = fieldBox(cid, 'timePlace', one.timePlace, '未知');
    tp.classList.add('wxg-pc-full');
    kv.appendChild(tp);
    kv.appendChild(el('div', 'wxg-pc-k', '正在经历'));
    const cur = fieldBox(cid, 'current', one.current, '本回合没写他');
    cur.classList.add('wxg-pc-full');
    kv.appendChild(cur);
    sec1.appendChild(kv);
    pop.appendChild(sec1);

    // ③ 过去经历：引文块（绿竖线），旧的自然淡化
    const sec2 = el('div', 'wxg-pc-sec');
    sec2.appendChild(el('div', 'wxg-pc-sech', '过去经历（由近到远，旧的自然淡化）'));
    const past = Array.isArray(one.past) ? one.past.slice(0, 6) : [];
    if (!past.length) {
        sec2.appendChild(el('div', 'wxg-empty', '还没有过去经历（更新几轮就有了）'));
    } else {
        const q = el('div', 'wxg-pc-quote');
        for (const p of past) {
            const line = el('div', null, trimText(p && p.text) || '暂无');
            /*
             * ⭐ 修复单 #36a：**字段名写错了**——
             *   `past[]` 里存的是 `fromFloor`（见 `core/state.js` 的规范），`p.floor` **永远是 undefined**
             *   ⇒ `Number(undefined)` 不是有限数 ⇒ 条件永远不成立 ⇒ **楼号从来没显示过**。
             */
            if (p && Number.isFinite(Number(p.fromFloor)) && Number(p.fromFloor) >= 0) {
                line.insertBefore(el('span', 'wxg-pc-when', floorLabel(p.fromFloor)), line.firstChild);
            }
            q.appendChild(line);
        }
        sec2.appendChild(q);
    }
    pop.appendChild(sec2);

    // ④ 底部条：换人（她拍的：上一位｜第几位/共几位｜下一位）＋ 合并 ＋ 保存
    /*
     * ⭐「不可靠」提醒（原本**只在角色状态页**）——她点名的污染就是这个，得当场说出来。
     *   它本来就是"某个人的某一格不可靠" ⇒ 摆进**这个人的卡片**最合适。
     */
    if (one.currentSuspect) {
        const warnBox = el('div', 'wxg-pc-sec');
        const w = el('div', 'wxg-store', '⚠ 这条「正在经历」引擎判定**不可靠**：'
            + (trimText(one.currentSuspectWhy) || '疑似越界'));
        w.setAttribute('data-tone', 'bad');
        warnBox.appendChild(w);
        pop.appendChild(warnBox);
    }
    /*
     * ⭐ 补③ 认知账（最小形态・第一步）：他**该知道的**清单。
     *   她当初只能靠提示词纪律（"每个角色只知道他自己该知道的"），现在**落成账**。
     *   ⚠️ 本步只做「清单 ＋ 界面可见＋能手加能手删」；
     *     "推演时只喂清单里的"是**第二步**（她允许分两步）。
     */
    const kSec = el('div', 'wxg-pc-sec');
    kSec.appendChild(el('div', 'wxg-pc-sech', '他知道什么（只收发生过的、他碰得到的；⏔ 编）'));
    const kList = Array.isArray(one.knows) ? one.knows : [];
    if (!kList.length) {
        kSec.appendChild(el('div', 'wxg-empty', '还没记他知道什么（下面可以手加一条）'));
    } else {
        kList.forEach((k, ki) => {
            const rowK = el('div', 'wxg-fact');
            rowK.appendChild(el('span', 'wxg-badge wxg-badge-soft', trimText(k.source) || '公开'));
            rowK.appendChild(el('span', null, ' ' + trimText(k.text)));
            if (Number(k.floor) >= 0) {
                rowK.appendChild(el('span', 'wxg-note', ' · ' + floorLabel(Number(k.floor))));
            }
            const delK = button('删', 'del-know', 'wxg-btn-xs', cid);
            delK.setAttribute('data-index', String(ki));
            rowK.appendChild(delK);
            kSec.appendChild(rowK);
        });
    }
    // 手加一条（只增不编；来源必选）
    const kAdd = el('div', 'wxg-row');
    const kTxt = el('input', 'wxg-pc-input');
    kTxt.type = 'text';
    kTxt.id = 'wxg-know-text';
    kTxt.placeholder = '他知道了什么（一句话）';
    kAdd.appendChild(kTxt);
    const kSrc = select('wxg-know-source', [
        { value: '亲眼', label: '亲眼' },
        { value: '被告知', label: '被告知' },
        { value: '公开', label: '公开' },
    ], '亲眼', 'noop');
    kAdd.appendChild(kSrc);
    const kBtn = button('加一条', 'add-know', 'wxg-btn-sm', cid);
    kAdd.appendChild(kBtn);
    kSec.appendChild(kAdd);
    pop.appendChild(kSec);

    /*
     * ⭐「任务」块（原本**只在角色状态页**）。
     *   任务是**挂在人身上**的（`c.quests`）⇒ 跟着人走才对。
     *   ⛔ 丢下它：她要能看到"他在追什么"、能改状态、能删。
     */
    if (Array.isArray(one.quests) && one.quests.length) {
        const qSec = el('div', 'wxg-pc-sec');
        const qOpen = one.quests.filter((q) => !['完成', '搁置'].includes(trimText(q.status)));
        const qOver = one.quests.filter((q) => ['完成', '搁置'].includes(trimText(q.status)));
        const qStat = questStats(one.quests);
        qSec.appendChild(el('div', 'wxg-pc-sech', '任务（在追的目标）　主线 '
            + String(qStat.main) + ' · 支线 ' + String(qStat.side)
            + (qOver.length ? '（已结束 ' + String(qOver.length) + '）' : '')));
        const mkQ = (q) => {
            const qr = el('div', 'wxg-rowitem');
            const qh = el('div', 'wxg-rowname');
            qh.appendChild(el('span', 'wxg-badge wxg-badge-soft', trimText(q.kind) === 'main' ? '主线' : '支线'));
            qh.appendChild(el('span', 'wxg-name', trimText(q.title)));
            const st = select('wxg-pcq-' + one.id + '-' + trimText(q.title), [
                { value: '活跃', label: '活跃' },
                { value: '完成', label: '完成' },
                { value: '搁置', label: '搁置' },
            ], trimText(q.status), 'set-quest-status', one.id);
            st.setAttribute('data-title', trimText(q.title));
            st.className = 'text_pole wxg-btn-sm';
            qh.appendChild(st);
            const qd = button('删', 'del-quest', 'wxg-btn-sm', one.id);
            qd.setAttribute('data-title', trimText(q.title));
            qh.appendChild(qd);
            qr.appendChild(qh);
            if (trimText(q.note)) {
                qr.appendChild(el('div', 'wxg-fact', trimText(q.note)));
            }
            if (Array.isArray(q.items) && q.items.length) {
                qr.appendChild(el('div', 'wxg-fact', q.items.map((i) => (i.done ? '☑ ' : '▶ ') + trimText(i.text)).join('　')));
            }
            return qr;
        };
        if (!qOpen.length) {
            qSec.appendChild(el('div', 'wxg-empty', '没有在追的任务了（已结束的收在下面）'));
        }
        for (const q of qOpen) {
            qSec.appendChild(mkQ(q));
        }
        if (qOver.length) {
            const fold = foldable('已结束 ' + String(qOver.length) + ' 条（完成／搁置，点开看）', false);
            const inner = el('div', 'wxg-list');
            for (const q of qOver) {
                inner.appendChild(mkQ(q));
            }
            fold.appendChild(inner);
            qSec.appendChild(fold);
        }
        pop.appendChild(qSec);
    }
    const foot = el('div', 'wxg-pc-foot');
    const prev = button('← 上一位', 'card-prev', 'wxg-pc-nav');
    prev.disabled = at <= 0;
    const next = button('下一位 →', 'card-next', 'wxg-pc-nav');
    next.disabled = at >= roster.length - 1;
    foot.appendChild(prev);
    foot.appendChild(el('span', 'wxg-pc-counter', '第 ' + String(at + 1) + ' / ' + String(roster.length) + ' 位'));
    foot.appendChild(next);
    foot.appendChild(button('按这条合并…', 'merge-into', 'wxg-btn-sm', c.id));
    /*
     * 底部那颗：只读态下叫「编辑这一位」；编辑态下叫「收起编辑」。
     * ⚠️ 不叫「保存」是诚实：改字是**改哪格存哪格**（立即落账），⏔ 做假的"取消"骗人。
     */
    const save = button(personCardEditing ? '收起编辑' : '编辑这一位',
        personCardEditing ? 'card-view' : 'card-edit', personCardEditing ? 'wxg-primary' : '');
    foot.appendChild(save);
    pop.appendChild(foot);

    (lastSectionsHost || document.body).appendChild(pop);
    bindPersonCardDrag(pop);
}

/**
 * 一个格：**默认只读文本**，点 ⋮ 进了编辑态才变输入框。
 *
 * 为什么（她自己说过两回，目标包里也写着）：
 *   · 她：「为什么现在每个页面的内容比如这个都是直接就能按的，而不是旁边有一个编辑按钮，
 *     点了才能按，不点是只读改不了免得弄错」
 *   · 目标包说明：「浮层右上 ⋮（三个点，**点开＝编辑这一位**）」
 *   ⇒ 默认**只读**；⋮ 就是那个“编辑按钮”。
 *
 * ⚠️ 编辑态里改字是**改哪格存哪格**（沿用 `set-char-field` ⇒ 保存路径与手改锁都不变），
 *   ⏔ 做假“取消”骗人（改了就已经落账了）。底部那颗叫「收起编辑」。
 */
function fieldBox(charId, field, value, placeholder) {
    const wrap = el('div', 'wxg-pc-v');
    const long = field === 'current' || field === 'timePlace';
    if (!personCardEditing) {
        const txt = trimText(value);
        wrap.appendChild(el('div', 'wxg-pc-text' + (txt ? '' : ' is-empty'), txt || (placeholder || '未知')));
        return wrap;
    }
    const input = long ? el('textarea', 'wxg-pc-input') : el('input', 'wxg-pc-input');
    if (!long) {
        input.type = 'text';
    }
    input.value = trimText(value);
    input.placeholder = placeholder || '未知';
    input.setAttribute('data-action', 'set-char-field');
    input.setAttribute('data-id', charId);
    input.setAttribute('data-key', field);
    if (long) {
        input.rows = 2;
    }
    wrap.appendChild(input);
    return wrap;
}

/** 拖标题栏移浮层（做法跟 mini.js 那套一致：⛔ 不引库） */
function bindPersonCardDrag(pop) {
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
        pop.style.left = String(ox + (t.clientX - sx)) + 'px';
        pop.style.top = String(oy + (t.clientY - sy)) + 'px';
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
 *   ⏔ 重写一份正文构造（那样两边会分叉）。
 */
function renderRecordCard(rec, body, idx, total, statusText, tone, shownChars) {
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

/*
 * ⭐ 世界状态页的「点条目弹浮层」（照目标包 目标-世界状态页-20261015）。
 *
 * 包里要的：
 *   · 点**局势行／暗线行** ⇒ 弹白卡浮层（跟名册"点行开卡片"**同一套手法**）
 *   · 头部：大标题＋「世界账 · 局势／暗线」＋当前胶囊＋**⋮＝编辑**＋✕
 *   · 信息区（键值两栏）：局势＝`哪几方／火候`；暗线＝`到点／走到／火候`
 *   · **「因果」区**：**来路＝上承（向更早）**（这条从哪来）／**牵动＝下沿（向未来）**（它的走向）
 *     节点小徽章 `源`（淡青）／`进·走向`（灰）；小标题注明「**照世界账的记录摆·不另编**」
 *   · 底部：`关闭 ｜ 来自世界账 · 改动走右上 ⋮ → 编辑`
 *   · ⛔ 行内不再有展开编辑（编辑一律从浮层右上 ⋮ 进）
 */
let openWorldEntry = null;      // { kind: 'situation' | 'hidden', idx }
/** 这个浮层在编辑态吗（默认 false＝只读） */
let openWorldEntryEditing = false;

export function closeWorldEntryCard() {
    openWorldEntry = null;
    const old = document.getElementById('wxg-world-entry');
    if (old && typeof old.remove === 'function') {
        old.remove();
    }
}

export function openWorldEntryCard(kind, idx) {
    openWorldEntry = { kind: kind === 'hidden' ? 'hidden' : 'situation', idx: Math.max(0, Math.round(Number(idx) || 0)) };
    renderWorldEntryCard();
}

/** 世界账里跟这一条有关的记录（⛔ 一个字都不另编：只在账里找） */
function entryCausalRows(label) {
    const want = trimText(label);
    if (!want) {
        return [];
    }
    const chron = typeof getChronicle === 'function' ? getChronicle() : [];
    const list = Array.isArray(chron) ? chron : [];
    return list
        .filter((c) => {
            const t = String((c && c.text) || '') + ' ' + String((c && c.who) || '');
            return t.includes(want);
        })
        .sort((a, b) => Number(a.at || 0) - Number(b.at || 0));
}

function renderWorldEntryCard() {
    const old = document.getElementById('wxg-world-entry');
    if (old && typeof old.remove === 'function') {
        old.remove();
    }
    if (!openWorldEntry) {
        return;
    }
    const w = describeWorld();
    const isHidden = openWorldEntry.kind === 'hidden';
    /*
     * ⚠️ 字段在 **`state.world.*`**，⏔ `state.*`（我写错过：取不到 ⇒
     *   被下面那句防御性 `return` **静静吃掉**：不报错、也不弹。）
     */
    const raw = isHidden
        ? ((loadState().world || {}).hidden || [])
        : ((loadState().world || {}).situations || []);
    const item = Array.isArray(raw) ? raw[openWorldEntry.idx] : null;
    if (!item) {
        openWorldEntry = null;
        return;
    }
    const title = isHidden ? trimText(item.name) : trimText(item.title);
    const pillText = isHidden ? (trimText(item.stage) || '萌芽') : (trimText(item.tier) || '几天内');
    const pillCls = isHidden ? stageTone(item.stage) : (pillText === TIERS[0] ? 'is-warn' : 'is-info');

    const pop = el('div', 'wxg-pc wanxiangge');
    pop.id = 'wxg-world-entry';
    pop.setAttribute('role', 'dialog');

    // ① 头部
    const head = el('div', 'wxg-pc-head');
    head.appendChild(el('span', 'wxg-pc-grip', '⠿'));
    const who = el('div', 'wxg-pc-who');
    who.appendChild(el('div', 'wxg-pc-name', title || '（没名字）'));
    who.appendChild(el('div', 'wxg-pc-alias', '世界账 · ' + (isHidden ? '暗线' : '局势')));
    head.appendChild(who);
    const badges = el('div', 'wxg-pc-badges');
    badges.appendChild(el('span', 'wxg-badge ' + (pillCls || ''), pillText));
    head.appendChild(badges);
    const kebab = button('⋮', 'we-edit', 'wxg-pc-kebab');
    kebab.title = openWorldEntryEditing ? '正在编辑（点一下收起）' : '编辑这一条（点了才可改，不点只读）';
    head.appendChild(kebab);
    head.appendChild(button('✕', 'we-close', 'wxg-pc-x'));
    pop.appendChild(head);

    // ② 信息区（键值两栏）
    const sec1 = el('div', 'wxg-pc-sec');
    sec1.appendChild(el('div', 'wxg-pc-sech', '这一条'));
    const kv = el('div', 'wxg-pc-kv');
    const put = (k, v, empty) => {
        kv.appendChild(el('div', 'wxg-pc-k', k));
        const box2 = el('div', 'wxg-pc-v');
        /*
         * ⚠️ 暗线**没有"改名字/改到点/改走到"的已有动作**（现有的只有 `set-hidden-stage` 与 `del-hidden`）
         *   ⇒ ⏔ 给它造一个不存在的 action（那样点了没反应）：暗线的可改项就是底部那个**阶段下拉**（已接）。
         *   ❌ 不能只图"看着像可改"而摆一个点不动的框。
         */
        /*
         * ⭐ 修复单 #37：
         *   ① 原来条件是 `openWorldEntryEditing && !isHidden` ⇒
         *     **暗线（isHidden）永远进不了编辑态**（她点 ⋮ 没反应）⇒ 把 `!isHidden` 去掉；
         *   ② 「火候」原来是**裸文本框** ⇒ 她只能自己打字、打错就不在枚举里（#27 同族）
         *     ⇒ 局势里给 **TIERS 下拉**；暗线那边是 `stage`（另一套枚举），保持文本框但**写对字段**。
         *   ⚠️ 暗线跟局势存在**两个不同的表**（`world.hidden` / `world.situations`）
         *     ⇒ 用 `data-hidden="1"` 告诉动作写回哪一张表。
         */
        if (openWorldEntryEditing) {
            if (k === '火候' && !isHidden) {
                const sel = select(null, TIERS.map((x) => ({ value: x, label: x })), trimText(v) || TIERS[1], 'set-situation');
                sel.setAttribute('data-index', String(openWorldEntry.idx));
                sel.setAttribute('data-key', 'tier');
                box2.appendChild(sel);
            } else {
                const inp = el('input', 'wxg-pc-input');
                inp.type = 'text';
                inp.value = trimText(v);
                inp.setAttribute('data-action', 'set-situation');
                inp.setAttribute('data-index', String(openWorldEntry.idx));
                if (isHidden) {
                    inp.setAttribute('data-hidden', '1');
                }
                inp.setAttribute('data-key', isHidden
                    ? (k === '到点' ? 'trigger' : (k === '走到' ? 'note' : 'stage'))
                    : (k === '哪几方' ? 'sides' : (k === '火候' ? 'tier' : (k === '到点' ? 'condition' : (k === '走到' ? 'detail' : 'title')))));
                box2.appendChild(inp);
            }
        } else {
            const txt = trimText(v);
            box2.appendChild(el('div', 'wxg-pc-text' + (txt ? '' : ' is-empty'), txt || (empty || '未知')));
        }
        kv.appendChild(box2);
    };
    if (isHidden) {
        put('到点', item.trigger, '未定时间');
        put('走到', item.note, '还没走到');
        put('火候', item.stage, '萌芽');
    } else {
        put('哪几方', item.sides, '未写');
        put('火候', item.tier, '几天内');
    }
    sec1.appendChild(kv);
    pop.appendChild(sec1);

    // ③ 因果区（照世界账摆，⛔ 不另编）
    const sec2 = el('div', 'wxg-pc-sec');
    sec2.appendChild(el('div', 'wxg-pc-sech', '因果（照世界账的记录摆 · 不另编）'));
    const rows = entryCausalRows(title);
    if (!rows.length) {
        sec2.appendChild(el('div', 'wxg-empty', '世界账里还没记到这一条（更新几轮就有了）'));
    } else {
        const first = rows[0];
        const rest = rows.slice(1);
        const up = el('div', 'wxg-pc-quote');
        const t1 = el('div', null, trimText(first.text) || '（没写字）');
        t1.insertBefore(el('span', 'wxg-pc-when', '▲ 来路 · ' + shortTime(first.at)), t1.firstChild);
        up.appendChild(t1);
        sec2.appendChild(el('div', 'wxg-pc-k', '上承（向更早）'));
        sec2.appendChild(up);
        if (rest.length) {
            const down = el('div', 'wxg-pc-quote');
            for (const r of rest.slice(-3)) {
                const line2 = el('div', null, trimText(r.text) || '（没写字）');
                line2.insertBefore(el('span', 'wxg-pc-when', '▼ ' + shortTime(r.at) + ' · ' + (trimText(r.kind) || '记录')), line2.firstChild);
                down.appendChild(line2);
            }
            sec2.appendChild(el('div', 'wxg-pc-k', '下沿（向未来）'));
            sec2.appendChild(down);
        }
    }
    pop.appendChild(sec2);

    // ④ 底部
    const foot = el('div', 'wxg-pc-foot');
    foot.appendChild(button('关闭', 'we-close', 'wxg-pc-nav'));
    foot.appendChild(el('span', 'wxg-pc-counter', '来自世界账 · 改动走右上 ⋮ → 编辑'));
    if (isHidden) {
        const sel = select('wxg-we-stage-' + String(openWorldEntry.idx),
            (item.kind === 'progress' ? STAGES_PROGRESS : STAGES_CONFLICT).map((x) => ({ value: x, label: x })),
            item.stage, 'set-hidden-stage', item.id);
        sel.className = 'text_pole wxg-btn-sm';
        foot.appendChild(sel);
    }
    pop.appendChild(foot);

    (lastSectionsHost || document.body).appendChild(pop);
    bindPersonCardDrag(pop);
}

/*
 * ⭐ 补⑤ 体检报告：面板上一个入口，点一下出一份自检。
 *
 * 放**状态页**顶栏（那颗「功能 ⋮」旁边）——状态页本来就是"看账"的地方，
 * ⛔ 不动「总控」那三张卡（那是目标包里定死的版式）。
 *
 * ⛔ 报告里不含正文、不含钥匙与地址的"值"（见 core/health.js 的铁律）。
 */
let healthOpen = false;

export function closeHealthCard() {
    healthOpen = false;
    const old = document.getElementById('wxg-health-card');
    if (old && typeof old.remove === 'function') {
        old.remove();
    }
}

function renderHealthCard() {
    const old = document.getElementById('wxg-health-card');
    if (old && typeof old.remove === 'function') {
        old.remove();
    }
    if (!healthOpen) {
        return;
    }
    let report = { text: '（体检报告没生成出来）', fails: [] };
    try {
        // ⭐ 把 chat 传进去：体检里的「验收自检·在场（上一楼）」要靠它（⛔ 不传的话那行永远不出现）
        report = buildHealthReport({ version: APP_VERSION, chat: getChat() });
    } catch (e) {
        report = { text: '体检报告生成失败：' + ((e && e.message) || '未知原因'), fails: [] };
    }

    const pop = el('div', 'wxg-pc wanxiangge');
    pop.id = 'wxg-health-card';
    pop.setAttribute('role', 'dialog');

    const head = el('div', 'wxg-pc-head');
    head.appendChild(el('span', 'wxg-pc-grip', '⠿'));
    const who = el('div', 'wxg-pc-who');
    who.appendChild(el('div', 'wxg-pc-name', '体检报告'));
    who.appendChild(el('div', 'wxg-pc-alias', '版本／开关／条数／最近失败（⛔ 不含正文与钥匙）'));
    head.appendChild(who);
    head.appendChild(button('✕', 'health-close', 'wxg-pc-x'));
    pop.appendChild(head);

    const sec = el('div', 'wxg-pc-sec');
    const pre = el('pre', 'wxg-health-pre', report.text);
    sec.appendChild(pre);
    pop.appendChild(sec);

    const foot = el('div', 'wxg-pc-foot');
    foot.appendChild(button('关闭', 'health-close', 'wxg-pc-nav'));
    foot.appendChild(button('复制这份', 'health-copy', 'wxg-pc-nav'));
    pop.appendChild(foot);

    (lastSectionsHost || document.body).appendChild(pop);
    bindPersonCardDrag(pop);
}

export function renderSections(host, opts) {
    /*
     * ⭐ 复审追加 B2：**台前有窗口时，后台那次画不该抢挂载点**。
     *   原来无条件赋值：她开着工作台、点开人物卡，
     *   后台一次 `renderPanel()`（注入完成／后台更新完／她发消息…都会调）
     *   就把挂载点改指到**隐藏抽屉** ⇒ 人物卡被"偷"进去（从工作台消失）。
     *   ⚠️ `handler` 里"点击拨正 lastSectionsHost"那半是好的，⏔ 动它。
     */
    const hasFgWindow = typeof document !== 'undefined'
        && !!(document.getElementById('wanxiangge-workspace') || document.getElementById('wanxiangge-panel'));
    const isSettingsDraw = ((opts && opts.mode) || 'settings') === 'settings';
    if (!isSettingsDraw || !hasFgWindow || !lastSectionsHost) {
        lastSectionsHost = host || lastSectionsHost;   // 浮层要挂在它里才收得到点击
    }
    if (!host) {
        return;
    }
    const mode = (opts && opts.mode) || 'settings';
    host.replaceChildren();
    host.classList.add('wanxiangge');
    host.setAttribute('data-wxg-mode', mode);

    /*
     * ⭐ 挂载口径：各节函数返回的是**正文层**（内容都在它里面），
     *    这里把"壳 ＋ 正文"合起来，**整壳**挂进宿主。
     *    ⛔ 只挂正文 = 标题全丢；只挂壳 = 内容全丢（这两种错我都犯过，别再来一次）。
     *
     * ⭐ 顺序也照"怎么用"排（原来是历史顺序，看板被埋在配置后面）：
     *    ① 现在怎么样（账本／进度）→ ② 世界与人（世界／角色／编年／名册／过程报告）
     *    → ③ 设一次就不动（总控／召回／读取控制／API／提示词）
     *
     * ⚠️ 加固（真机崩过一次）：**挂载这一步也在 try 里**——它要是抛，兜底才真的兜得住。
     *    并且 `children` 是 **HTMLCollection**（真 DOM），⛔ 没有 .slice()/.includes()，
     *    一律 `Array.from(...)` 转成数组再用（假环境把它做成数组，所以自审没抓住，已修 shim）。
     */
    // ⭐ 草稿按宿主分开（见 stagingOf）：渲染期间切到当前宿主 mode，画完恢复原值，防后台重画篡改当前打开的工作台 mode
    const prevStagingMode = stagingMode;
    stagingMode = mode;
    const stageEl = el('div', 'wxg-stage');
    try {
        /*
         * ① 状态：账本／进度／每轮记录 —— **三页已并成一页**
         *    （复核方："这三个是不是应该坐到一个地方？"）
         *    ⏐ secSteps／secReport 不再各自开页，改成往状态页里摆（见 secStatus）。
         */
        secStatus(stageEl);
        // ② 世界与人
        secWorld(stageEl);
        /*
         * ⚠️⚠️ 「角色状态」这一页**暂时留着**（2026-10-15 第 11 轮退回）。
         *
         * 她确实说过「跟名册重复了删掉吧？一模一样」，但她同时两度亲定边界：
         *   **只删目录入口，页面内容与引用 0 动**。
         * 而我试着只从目录里撕掉它之后，**真机上这些东西就真摸不到了**（页面不渲染＝内容没了），
         * 实测有 **16 条用例变红**，它们点名的是：
         *   · `run-tests-chartable`：七列表格／搜索框／点开改字（整套）
         *   · `run-tests-inject`：任务（主线／支线）显示、改状态、删任务
         *   · `run-tests-future`：「不可靠」提醒
         *   · `run-tests-dualpanel`：面板里改角色字段
         * ⇒ 这些**名册与浮层里都还没有**。先把它们搬过去，才能撕这一页；
         *   ⏔ 为了"看着像做完了"而提前撕（她的话：别真的不行还打钩）。
         */
        /*
         * ⭐⭐ 「角色状态」**撕了**（她 2026-10-15：「角色名册/人物名册不就是角色状态」
         *   「这两个有啥区别？」「我刚刚就说两个都是一模一样来着」）。
         *   → 它的职分（呈现人物状态、可改）**全归名册**：名册即角色状态。
         *
         * ⏔ 先撕后接——撕之前已逐样搬完（这一步是硬前提）：
         *   · **七格**（年龄/身份/势力/时间地点/正在经历/好感/别名）⇒ 名册的**浮层人物卡**（默认只读，点 ⋮ 可改）
         *   · **任务（主线／支线）**（可改状态、可删）⇒ 浮层里的「任务」块（v0.2.80）
         *   · **「不可靠」提醒** ⇒ 浮层里的警告行（v0.2.80）
         *   · **一键合并（merge-into）** ⇒ 浮层底栏（早已在）
         *
         * ⚠️ 边界（她 02:01／02:05 两度亲定）：**只撕目录入口**；
         *   ⏔ 凡别处“引用人物”的显示（如世界状态里出现的人名）＝引用名册，**不动**。
         * （`secCharacters` 函数体先留着：删代码要单独过门；这里只是不摆进目录。）
         */
        secChronicle(stageEl);
        secRoster(stageEl);
        // ③ 配置：设一次就不动
        secGeneral(stageEl);
        secAppearance(stageEl);
        secRecall(stageEl);
        secExtract(stageEl);
        secApi(stageEl);
        secPrompts(stageEl);

        /*
         * ⭐ 重画之后把世界条目的浮层**画回来**（浮层挂在段容器里，重画会冲掉它）。
         *   ⏔ 写在每个动作里（那样漏一个就没了）。
         * ⭐ 复审追加 B2（乙）：**同一前提**（后台那一次画 + 台前有窗口）下⛔ 重挂——
         *   否则后台刷一下就把她工作台里开着的卡**拆下来重挂到隐藏抽屉**里（"被偷走"）。
         */
        const canRemount = !(isSettingsDraw && hasFgWindow);
        if (openWorldEntry && canRemount) {
            renderWorldEntryCard();
        }
        if (healthOpen && canRemount) {
            renderHealthCard();
        }
        /*
         * ⭐ 修复单 #33（后半）：**人物卡也要画回来**。
         *   她点开人物卡之后，任何一次重画（比如后台刷了一下设置区）都会把浮层冲掉；
         *   上面两处都补了、就这处漏了 ⇒ 表现是"人物卡自己没了"。
         *   ⛔ 别再写在每个动作里（漏一个就没一个）——统一听这里。
         */
        if (personCardId && canRemount) {
            try {
                renderPersonCard();
            } catch (e) {
                console.warn('[万象阁] 摆回人物卡出错：', e);
            }
        }

        // 自检：一段都没画出来 ⇒ 也要说出来，⛔ 不留白板
        const before = asArray(host.children || []).length;
        hangUp(host, stageEl);
        const added = asArray(host.children || []).length - before;
        if (!added) {
            drawFailure(host, new Error('12 段一段都没画出来（可能是这一版和设置里存的老数据对不上）'));
        }
        buildJumpNav(host);
        /*
         * ⭐ 只读卡的"真锁"在这儿上（整页 DOM 已建完）：
         *    `lockable()` 是在 `card()` 刚 new 出来、**里面还空着**的时候调的，
         *    那一刻扫不到任何字段——真踩过（readonly 一个都没上）。
         */
        try {
            applyLocks(host);
        } catch (e) {
            console.warn('[万象阁] 上只读锁出错：', e);
        }
        // ⭐ 读取控制：刚才在挑某本书的条目 ⇒ 重画之后把它摆回来
        //    （⛔ 不然点一条之后列表就没了，没法接着点第二条）
        try {
            renderEntryPick(host);
        } catch (e) {
            console.warn('[万象阁] 摆回条目列表出错：', e);
        }
    } catch (e) {
        /*
         * ⚠️ 兜底要**出声**（光 console.warn 不够：真机／自审里都可能没人看控制台，
         *    表现就变成"界面莫名其妙空了一半"，查都没法查）。
         *    这里同时打控制台；界面上的那句话由 drawFailure 写。
         */
        console.warn('[万象阁] 画面板出错：', e);
        console.error('[万象阁] 画面板出错（照抄这句反馈即可）：' + String((e && e.message) || e));
        drawFailure(host, e);
    } finally {
        stagingMode = prevStagingMode;
    }
}

/**
 * 画世界书小块（只改这几颗按钮，⛔ 不重画面板 —— 点一下面板就跳会很难连着点）。
 * @param {object} host 面板正文层
 * @param {Array<string>} ex 待保存的"提取"名单
 * @param {Array<string>} no 待保存的"排除"名单
 */
export function paintBookPicks(host, ex, no) {
    const wrap = host && host.querySelector ? host.querySelector('#wxg-bookpick') : null;
    if (!wrap) {
        return;
    }
    for (const child of asArray(wrap.childNodes)) {
        if (!String(child.className || '').includes('wxg-pick-head')) {
            wrap.removeChild(child);
        }
    }
    for (const n of listBooksCache) {
        const k = asText(n);
        const inEx = (ex || []).some((x) => asText(x) === k);
        const inNo = (no || []).some((x) => asText(x) === k);
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'wxg-pick' + (inEx ? ' is-on' : '') + (inNo ? ' is-off' : '');
        b.textContent = n + (inEx ? '（提取）' : (inNo ? '（排除）' : ''));
        b.title = inEx ? '在「提取」名单里（还没保存；再点＝改排除）'
            : (inNo ? '在「排除」名单里（还没保存；再点＝拿掉）' : '点一下＝要读它');
        b.setAttribute('data-action', 'pick-book');
        b.setAttribute('data-book', n);
        wrap.appendChild(b);
    }
}

/**
 * 把"正在看的那本书"的条目小块摆回面板（点一条之后重画，接着还能点）。
 * 数据来自 list-entries 抓到的 `pickEntries`，⛔ 不再重复读世界书。
 */
/** ⭐ 3③：条目列表的筛选词（她输什么就只显示带它的） */
let entFilter = '';

export function renderEntryPick(host, offList) {
    if (!pickBook || !pickEntries.length) {
        return;
    }
    const wrap = host.querySelector('#wxg-entpick');
    const note = host.querySelector('#wxg-entnote');
    if (!wrap) {
        return;
    }
    const off = Array.isArray(offList) ? offList : toList(stagedValue('extract', 'excludeEntries', getSettings().excludeEntries));
    while (wrap.firstChild) {
        wrap.removeChild(wrap.firstChild);
    }
    if (note) {
        note.textContent = '「' + pickBook + '」共 ' + String(pickEntries.length)
            + ' 条：点一下＝不读这一条（⛔ 不立刻保存，按段底那颗「保存」才生效）；⛔ 不改你的世界书。';
    }
    /*
     * ⭐ 目标核对 3③：**批量键 + 筛选**（照她点的参照物：
     *   TavernHelper 世界书面板的「整本＋全选／全不选＋逐条勾＋筛选」）。
     *   逐条点"不读"原来已经有（`toggle-entry`），差的就是**一次处理一整本**的那几颗。
     */
    const bar = el('div', 'wxg-chiprow wxg-entbar');
    const mkBtn = (label, act) => {
        const b2 = document.createElement('button');
        b2.type = 'button';
        b2.className = 'wxg-btn-sm';
        b2.textContent = label;
        b2.setAttribute('data-action', act);
        return b2;
    };
    bar.appendChild(mkBtn('全读', 'entry-all-on'));
    bar.appendChild(mkBtn('全不读', 'entry-all-off'));
    bar.appendChild(mkBtn('反选', 'entry-invert'));
    const fInp = el('input', 'wxg-pick-filter');
    fInp.type = 'text';
    fInp.id = 'wxg-entfilter';
    fInp.placeholder = '筛选名字…';
    fInp.value = entFilter;
    fInp.setAttribute('data-action', 'filter-entries');
    bar.appendChild(fInp);
    wrap.appendChild(bar);

    const shown = pickEntries.filter((e) => {
        if (!entFilter) {
            return true;
        }
        const title = trimText(e && (e.comment || e.key || e.name || e.title));
        return title.toLowerCase().indexOf(entFilter.toLowerCase()) >= 0;
    });
    if (!shown.length) {
        wrap.appendChild(el('div', 'wxg-empty', '没有名字里带「' + entFilter + '」的条目'));
    }
    for (const e of shown.slice(0, 200)) {
        const title = trimText(e && (e.comment || e.key || e.name || e.title));
        if (!title) {
            continue;
        }
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'wxg-pick' + (off.some((x) => asText(x) === asText(title)) ? ' is-on' : '');
        b.textContent = title;
        b.title = off.some((x) => asText(x) === asText(title))
            ? '已设为"不读"（再点＝恢复读它）'
            : '点一下＝不读这一条';
        b.setAttribute('data-action', 'toggle-entry');
        b.setAttribute('data-entry', title);
        wrap.appendChild(b);
    }
}

/**
 * 顶部"快速跳转"（只在**独立面板**里画）。
 *
 * 为什么这么做（而不是分页／页签）：
 *   · 分页会把东西**藏起来**——"没完成的事""失败原因"这类她要能一眼看见；
 *   · 面板本来就能拖大，宽栏里一行放得下 ⇒ 一行"跳转条"比页签更省事、也不丢内容；
 *   · 窄栏（酒馆设置区那个抽屉）里放不下就不画，那边靠折叠＋顺序解决。
 * ⛔ 不用 anchor 链接（怕动了地址栏），走委托点击 + scrollIntoView。
 */
function buildJumpNav(host) {
    if (!host) {
        return;
    }
    const old = host.querySelector('.wxg-nav');
    if (old) {
        old.remove();
    }
    if (host.getAttribute('data-wxg-mode') !== 'panel') {
        return;   // 窄栏不画
    }
    const nav = el('div', 'wxg-nav');
    nav.appendChild(el('span', 'wxg-nav-title', '跳到'));
    const secs = asArray(host.querySelectorAll('.wxg-sec'));
    secs.forEach((sec, i) => {
        const titleEl = sec.querySelector('.wxg-sec-title');
        const name = trimText(titleEl && titleEl.textContent) || ('第 ' + String(i + 1) + ' 段');
        const btn = el('button', 'wxg-nav-btn', name);
        btn.type = 'button';
        btn.setAttribute('data-jump', String(i));
        nav.appendChild(btn);
    });
    // ⚠️ 要插在**最前面**：用 firstChild 当参照（appendChild 那样会跑到末尾去）
    const first = (host.children && host.children.length) ? host.children[0] : null;
    if (first) {
        host.insertBefore(nav, first);
    } else {
        host.appendChild(nav);
    }

    // 滚动时高亮"你现在在哪一段"（scroll-spy）
    bindNavScrollSpy(host, nav);
    markActiveNav(host, nav);
}

/**
 * 滚动时把"当前所在那一段"高亮出来。
 * ⚠️ 监听挂在**宿主**（面板正文层）上，每次重画前先解绑，⛔ 免得叠一堆监听器。
 */
function bindNavScrollSpy(host, nav) {
    if (typeof host.removeEventListener === 'function' && host.__wxgSpy) {
        host.removeEventListener('scroll', host.__wxgSpy);
        host.__wxgSpy = null;
        // 顺手把滚动动效的监听也撤掉
        if (host.__wxgEndTimer) {
            clearTimeout(host.__wxgEndTimer);
            host.__wxgEndTimer = null;
        }
    }
    if (typeof host.addEventListener !== 'function' || typeof requestAnimationFrame !== 'function') {
        return;
    }
    const spy = () => {
        if (host.__wxgSpyBusy) {
            return;
        }
        host.__wxgSpyBusy = true;
        requestAnimationFrame(() => {
            host.__wxgSpyBusy = false;
            markActiveNav(host, nav);
        });
    };
    host.__wxgSpy = spy;
    host.addEventListener('scroll', spy);
}

/** 哪一段离顶端最近，就把哪一颗点亮 */
function markActiveNav(host, nav) {
    if (!host || !nav) {
        return;
    }
    const secs = asArray(host.querySelectorAll('.wxg-sec'));
    const btns = asArray(nav.querySelectorAll('.wxg-nav-btn'));
    if (!secs.length || !btns.length) {
        return;
    }
    // 视口顶端往下一点点的位置当作"当前行"
    const hostTop = Number(host.getBoundingClientRect ? host.getBoundingClientRect().top : 0);
    const line = hostTop + 24;
    let active = 0;
    secs.forEach((sec, i) => {
        const top = sec.getBoundingClientRect ? sec.getBoundingClientRect().top : 0;
        if (top <= line) {
            active = i;
        }
    });
    btns.forEach((b, i) => {
        const on = i === active;
        if (b.classList) {
            b.classList.toggle('is-on', on);
        } else {
            b.setAttribute('class', on ? 'wxg-nav-btn is-on' : 'wxg-nav-btn');
        }
    });
}

/** 跳转条上的点击：滚到那一段，并顺手把它展开（不然滚到了还是收着的） */
export function jumpToSection(host, index) {
    if (!host) {
        return;
    }
    const secs = asArray(host.querySelectorAll('.wxg-sec'));
    const sec = secs[Number(index)];
    if (!sec) {
        return;
    }
    // 展开它（酒馆的折叠是内联样式管的，这里直接设）
    const body = sec.querySelector('.wxg-sec-body');
    if (body && body.style) {
        body.style.display = 'block';
    }
    const icon = sec.querySelector('.inline-drawer-icon');
    if (icon && icon.classList) {
        icon.classList.remove('down');
        icon.classList.add('up');
    }
    if (typeof sec.scrollIntoView === 'function') {
        try {
            sec.scrollIntoView({ block: 'start', behavior: 'smooth' });
        } catch (e) {
            sec.scrollIntoView();
        }
    }
}

/**
 * 把中转站里的正文层合回抽屉壳，整壳挂进宿主；非原生层的东西原样搬 */
function hangUp(host, staging) {
    // ⚠️ children 是 HTMLCollection：先转数组再遍历／查找（真机就栽在这里）
    for (const node of asArray(staging.children || [])) {
        const drawer = node && node.__wxgDrawer;
        if (drawer) {
            // 正文层放回壳里（它本来就在壳里，这里是幂等的），再整壳挂上去
            if (!asArray(drawer.children || []).includes(node)) {
                drawer.appendChild(node);
            }
            host.appendChild(drawer);
        } else {
            host.appendChild(node);
        }
    }
}

/**
 * 兜底：万一哪一段画不出来，⛔ 绝不让面板变成一块白板——把原因写在面板上。
 * （实图里出现过"面板全空"，没有这句话就只能靠猜。）
 */
function drawFailure(host, err) {
    try {
        const box = el('div', 'wxg-store');
        box.setAttribute('data-tone', 'bad');
        box.appendChild(el('b', null, '界面有一段没画出来（原因照抄反馈即可）：'));
        box.appendChild(el('div', 'wxg-fact', String((err && err.message) || err)));
        if (err && err.stack) {
            box.appendChild(el('div', 'wxg-fact', String(err.stack).split('\n').slice(0, 4).join(' ← ')));
        }
        host.appendChild(box);
    } catch (e) {
        // 连兜底都画不出来就只能认了
    }
}

/**
 * 在"这个宿主里"查一个 id（⛔ 不用 document.getElementById）。
 *
 * ⚠️ 为什么要这样（条 4·最重）：同一套分节会**同时**渲染在**两个地方**——
 *    扩展设置区那一块 ＋ 魔法棒打开的独立面板。两处的 id 一模一样，
 *    `document.getElementById` 永远只返回**文档里第一个**（＝设置区那份）
 *    ⇒ 面板里的"加人／加暗线／读世界书"会读到设置区的空输入框（症状："疯狂提示先写个名字"），
 *      而"写回"（世界书列表、破镜词预览、复制用的隐藏块）也会写到设置区去。
 *    ⇒ 一切读／写都改成**相对当前宿主**查。
 */
function byId(host, id) {
    if (!host || !id) {
        return null;
    }
    return host.querySelector('#' + id) || null;
}

/** 读一个输入框的值（⛔ 只读**当前这个面板**里的那个，别串到另一个面板去） */
function textOf(host, id) {
    const node = byId(host, id);
    return node ? asText(node.value) : '';
}

function patchApi(patch) {
    const s = getSettings();
    patchSettings({ api: Object.assign({}, s.api || {}, patch) });
}

/**
 * ⭐「从世界书读人」v2：**全读进来 → 模型自己分 → 各归各位**
 *
 * 她的口径（2026-10-14 19:3x）：读取世界书**全出来**，写提示词让模型自己分，
 * ⛔ 别按名单拦着读；人物→名册、势力／局势→世界状态建档。
 *
 * ⚠️ 老口径（纯规则剥 `[角色]` 前缀）会把 `[势力][地点]` 当人收、其余前缀全丢，
 *    所以只在**模型不可用时**当兜底，而且必须明说"这次是规则版、没分类"。
 */
async function readFromBook(book) {
    try {
        const res = await importBookWiki(book, { allowRuleFallback: true });
        if (!res.ok) {
            toast.fail('读世界书没成：' + (res.reason || '未知原因'));
            return { added: 0, skipped: 0 };
        }
        if (res.fellBack) {
            toast.warn('模型这条线没通（' + (res.reason || '') + '）⇒ 只按规则收了名字**没分类**：'
                + String(res.added) + ' 人。配好 API 再点一次就能分类建档。');
            return { added: res.added, skipped: 0 };
        }
        return res;
    } catch (e) {
        toast.fail('读世界书出错：' + (e && e.message ? e.message : String(e)));
        return null;
    }
}

async function testApi() {
    try {
        const { callModel } = await import('../core/apiclient.js');
        const res = await callModel({
            prompt: '只回四个字：连接正常',
            system: '你是一个测试用的助手。',
            cheap: true,
        });
        if (res && res.ok) {
            return { ok: true, note: trimText(res.text).slice(0, 40) || '（模型回了空内容，但通道是通的）' };
        }
        return { ok: false, note: (res && res.reason) || '未知原因' };
    } catch (e) {
        return { ok: false, note: e && e.message ? e.message : String(e) };
    }
}

function copyToClipboard(text, btn) {
    const done = () => {
        if (btn) {
            const old = btn.textContent;
            btn.textContent = '已复制';
            setTimeout(() => { btn.textContent = old; }, 1500);
        }
    };
    try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
            return;
        }
    } catch (e) {
        // 落到兜底
    }
    fallbackCopy(text, done);
}

function fallbackCopy(text, done) {
    try {
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
        done();
    } catch (e) {
        toast.fail('复制失败，可以手动选中复制');
    }
}

function downloadText(filename, text) {
    try {
        const blob = new Blob([text], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch (e) {
        toast.fail('导出失败：' + (e && e.message ? e.message : String(e)));
    }
}

/** 把事件委托绑到宿主上（只绑一次） */
export function bindSectionEvents(host, refresh) {
    if (!host || host.__wxgBound) {
        return;
    }
    host.__wxgBound = true;

    const rerender = () => {
        const mode = host.getAttribute('data-wxg-mode') || 'settings';
        /*
         * ⚠️ 工作台模式下 `refresh()` 就是 `refreshWorkspace()`，它**自己会重画**一遍
         *    ⇒ 这里再来一次 `renderSections` 就是**整页连画两次**：
         *    白干一倍活儿，而且实测"连点同一颗按钮第 6 次"时界面会塌掉一半
         *    （自审里量到控件从 80 掉到 20）。所以工作台那条路只走 refresh。
         */
        if (mode === 'workspace' && typeof refresh === 'function') {
            refresh();
            return;
        }
        renderSections(host, { mode });
        if (typeof refresh === 'function') {
            refresh();
        }
    };

    const handler = async (e) => {
        /*
         * ⭐ 修复单 #33（前半）：**handler 入口把挂载点对齐到"这次点击所在的 host"**。
         *   为什么：`renderSections(host)` 既被**看得见的工作台**调、也被**藏在抽屉里的设置区**
         *   （后台 renderPanel）调，而 `lastSectionsHost` 记的是"最后一次调用者"——
         *   后台一刷就把指针改指到**隐藏抽屉** ⇒ 浮层被塞进看不见的地方＝"点了没反应"（浮层隐身）。
         *   点击一定发生在某个 host 上 ⇒ 以它为准，指针就不会再被后台带偏。
         */
        if (host) {
            lastSectionsHost = host;
        }
        // ⭐ 顶部"快速跳转"：它没有 data-action（那是给会改数据的东西用的）
        const jump = e.target.closest && e.target.closest('[data-jump]');
        if (jump) {
            jumpToSection(host, jump.getAttribute('data-jump'));
            return;
        }
        const target = e.target.closest('[data-action]');
        if (!target) {
            return;
        }
        const action = target.getAttribute('data-action');
        if (!action || action === 'noop') {
            return;
        }
        const id = target.getAttribute('data-id') || '';
        const key = target.getAttribute('data-key') || '';
        const isChange = e.type === 'change';
        // 事件触发时一律以当前宿主容器自己的 data-wxg-mode 为准，隔离不同面板的草稿池
        stagingMode = (host && typeof host.getAttribute === 'function' && host.getAttribute('data-wxg-mode')) || 'settings';

        try {
            // ⭐ 通用草稿入口：凡是 `stage-*` 的控件，一律只进草稿（段底一起保存）
            if (action.indexOf('stage-') === 0) {
                const which = stageOne(action, target);
                if (which) {
                    refreshSaveBar(host, which);
                    const bar = host.querySelector('.wxg-savebar[data-id="' + which + '"]');
                }
                return;
            }
            switch (action) {
                /* ---- 总控 ---- */
                case 'set-enabled': patchSettings({ enabled: target.checked }); rerender(); break;
                case 'set-card': patchSettings({ cardEnabled: target.checked }); rerender(); break;
                case 'set-show-empty': patchSettings({ showEmptyCard: target.checked }); rerender(); break;
                case 'set-panel-on-start': patchSettings({ showPanelOnStart: target.checked }); break;
                case 'set-protected': patchSettings({ protectedBypass: target.checked }); break;
                case 'set-strict': patchSettings({ strictMention: target.checked }); break;
                case 'set-auto-update': patchSettings({ autoUpdate: target.checked }); break;
                case 'set-update-every': if (isChange) { patchSettings({ updateEvery: target.value }); } break;
                /* ---- 角色状态：明细开关 / 排序 ---- */
                case 'toggle-cdetail': {
                    // 点「明细」展开那一行（只切显示，⛔ 不重画，免得丢她正在改的字）
                    const drow = host.querySelector('.wxg-cdetail-row[data-detail-of="' + id + '"]');
                    if (drow) {
                        const openNow = drow.getAttribute('data-hide') !== '1';
                        drow.setAttribute('data-hide', openNow ? '1' : '0');
                        const inner = drow.querySelector('.wxg-cdetail');
                        if (inner && inner.style) {
                            inner.style.display = openNow ? 'none' : 'block';
                        }
                        if (target.textContent === '明细' || target.textContent === '收起') {
                            target.textContent = openNow ? '明细' : '收起';
                        }
                    }
                    break;
                }
                case 'chron-filter': {
                    // 编年的筛选胶囊：只换筛选条件再重画（⛔ 不落设置、不动数据）
                    chronFilter = trimText(id) || 'all';
                    chronPage = 1; // ⚠️ 换了筛选要回第一页（不然可能停在一个空页上）
                    rerender();
                    break;
                }
                case 'report-filter': {
                    // 过程报告的筛选胶囊（同上，只看不改数据）
                    reportFilter = trimText(id) || 'all';
                    rerender();
                    break;
                }
                case 'step-filter': {
                    // 现在的进度：筛选胶囊（看看哪几楼还没做）
                    stepFilter = trimText(id) || 'all';
                    stepPage = 1;
                    rerender();
                    break;
                }
                case 'step-page': {
                    stepPage = Math.max(1, Math.round(Number(id) || 1));
                    rerender();
                    break;
                }
                case 'roster-filter': {
                    // 名册的筛选胶囊（同上）
                    rosterFilter = trimText(id) || 'all';
                    rosterPage = 1; // 同上
                    rerender();
                    break;
                }
                case 'open-record':
                    openRecordAt = Math.max(0, Math.round(Number(id) || 0));
                    rerender();
                    break;
                case 'record-close':
                    openRecordAt = -1;
                    rerender();
                    break;
                case 'record-prev':
                case 'record-next':
                    if (openRecordAt >= 0) {
                        openRecordAt = action === 'record-next' ? openRecordAt + 1 : openRecordAt - 1;
                        if (openRecordAt < 0) { openRecordAt = 0; }
                    }
                    rerender();
                    break;
                case 'open-world-entry':
                    openWorldEntryCard(
                        target.getAttribute('data-kind') || 'situation',
                        target.getAttribute('data-index') || '0');
                    break;
                case 'we-close':
                    openWorldEntryEditing = false;
                    closeWorldEntryCard();
                    break;
                case 'we-edit':
                    openWorldEntryEditing = !openWorldEntryEditing;
                    renderWorldEntryCard();
                    break;
                case 'world-func':
                    toast.info('世界账的记录在各条的悬浮框「因果」区里看；编辑点那儿右上的 ⋮（点了才能改，不点只读）');
                    break;
                case 'health-open':
                    healthOpen = true;
                    renderHealthCard();
                    break;
                case 'health-close':
                    closeHealthCard();
                    break;
                case 'health-copy': {
                    const pre = document.querySelector('#wxg-health-card pre');
                    const txt = pre ? String(pre.textContent || '') : '';
                    try {
                        if (navigator.clipboard && navigator.clipboard.writeText) {
                            navigator.clipboard.writeText(txt);
                            toast.ok('体检报告已复制（直接粘给我就行）');
                        } else {
                            toast.info('浏览器不让自动复制，你手选一下吧');
                        }
                    } catch (e) {
                        toast.info('复制没成（浏览器限制），你手选一下吧');
                    }
                    break;
                }
                case 'status-func':
                    /* ⭐ 复审追加 A5①：口径跟现状对齐——「操作」卡早撕了，
                     导出备份实际在「人物名册 → 录入」卡里；可撤回数在「世界四值」框。 */
                    toast.info('导出与统计在「人物名册 → 录入」卡里；可撤回的版本数看本页「世界四值」框里那行「可撤回 N 版」');
                    break;
                case 'roster-func':
                    /* ⭐ #39a：口径跟现状对齐——那个筛选早就换成「全部｜创建时间｜修改时间｜玩家棋子｜名字」了，
     ——⏔ 再指一个不存在的筛选（她会去找、找不到就以为坏了） */
toast.info('这里是去重合并／删除／清空的入口位；当前用法：行上的「⋯」里有合并与删除，名册上方可按「修改时间」排、筛选里选「玩家棋子」或搜名字');
                    break;
                case 'roster-search':
                    // 边打边筛（change 才重画，⏔ 每敲一个字都重画整页）
                    if (isChange) {
                        rosterSearch = trimText(target.value);
                        rosterPage = 1;
                        rerender();
                    }
                    break;
                case 'roster-page': {
                    // 翻页：这里只存目标页；**夹取在渲染时按筛完的数量做**（见 secRoster）
                    rosterPage = Math.max(1, Math.round(Number(id) || 1));
                    rerender();
                    break;
                }
                case 'chron-page': {
                    chronPage = Math.max(1, Math.round(Number(id) || 1));
                    rerender();
                    break;
                }
                /*
                 * ⭐ 名册点一行 ⇒ **开浮层**（她 2026-10-14 点名：⏔ 行内展开把表格推下去）。
                 *    旧的行内编辑器（case 'edit-char' 那段）**先留着**：
                 *    等浮层距离验收了再说，⏔ 一步到位地把能用的东西换掉。
                 */
                case 'open-person-card':
                    openPersonCard(id);
                    break;
                case 'card-close':
                    closePersonCard();
                    break;
                case 'card-prev':
                case 'card-next': {
                    /*
                     * 上／下一位：按**当前浮层里那位**在名册里的下标推一格。
                     * ⛔ 别自己造一个 personCardNowId()——`personCardId` 就是模块级那个变量，直接用。
                     */
                    const list = getRoster();
                    const at = list.findIndex((x) => x.id === personCardId);
                    if (at >= 0) {
                        const to = action === 'card-next' ? at + 1 : at - 1;
                        if (to >= 0 && to < list.length) {
                            openPersonCard(list[to].id);
                        }
                    }
                    break;
                }
                /*
                 * ⭐ `card-edit` 是**幂等**的：点多少下都是"进编辑态"，⏔ 翻转。
                 *   为什么：翻转式开关**不可重入**——前面一条用例把它留在开着，
                 *   后面一条再点一下反而**关上了**（真踩：「找不到字段输入框：age」，
                 *   但按钮明明点到了）。退出编辑独立成 `card-view`。
                 */
                case 'card-edit':
                    personCardEditing = true;
                    renderPersonCard();
                    break;
                case 'card-view':
                    personCardEditing = false;
                    renderPersonCard();
                    break;
                case 'card-save':
                    /*
                     * ⏔ 关掉浮层！她要的是"改完收起来"，不是"把卡片也关了"。
                     * （原来这里叫 closePersonCard－点一下连卡都没了，下一位都点不到。）
                     */
                    personCardEditing = false;
                    /*
                     * ⚠️ 顺序很要紧：浮层是**挂在段容器里**的（为了收得到点击），
                     *   而 `rerender()` 会重画段 ⇒ **顺手把浮层也冲掉**（真机门当场抓到：
                     *   点「收起编辑」连卡片一起没了）。
                     *   ⇒ **先重画段，再把卡片画回来**。
                     */
                    rerender();
                    renderPersonCard();
                    toast.ok('已收起编辑（改哪格存哪格，引擎不会冲掉）');
                    break;
                case 'edit-char': {
                    // 名册行上的「改」：展开/收起那个人的三个输入框
                    openChar = String(openChar) === String(id) ? '' : String(id);
                    rerender();
                    break;
                }
                case 'edit-situation': {
                    // 局势行上的「改」：展开/收起那一行的编辑框（⛔ 不重画别的东西）
                    const idx = Number(target.getAttribute('data-index'));
                    openSituation = String(openSituation) === String(idx) ? -1 : idx;
                    rerender();
                    break;
                }
                case 'char-sort':
                    if (isChange) {
                        charSearch.sort = trimText(target.value) || 'recent';
                        rerender();
                    }
                    break;

                /* ---- 世界状态 ---- */
                case 'set-situation': {
                    if (!isChange) {
                        break;
                    }
                    const idx = Number(target.getAttribute('data-index'));
                    const wkey = target.getAttribute('data-key') || '';
                    const state = loadState();
                    /*
                     * ⭐ 修复单 #37：**暗线也走这条**。
                     *   原来只写 `world.situations` ⇒ 暗线那边即使能编辑也**写不进去**（静默失败）。
                     */
                    if (target.getAttribute('data-hidden') === '1') {
                        const hlist = (state.world.hidden || []).slice();
                        if (Number.isFinite(idx) && hlist[idx]) {
                            hlist[idx] = Object.assign({}, hlist[idx], {
                                [wkey]: trimText(target.value), manual: true, updatedAt: Date.now(),
                            });
                            updateWorld({ hidden: hlist }, { manual: true });
                            saveState();
                            toast.ok('暗线改好了');
                            rerender();
                            if (openWorldEntry) {
                                renderWorldEntryCard();
                            }
                        }
                        break;
                    }
                    const list = (state.world.situations || []).slice();
                    if (Number.isFinite(idx) && list[idx]) {
                        list[idx] = Object.assign({}, list[idx], { [wkey]: trimText(target.value), manual: true });
                        updateWorld({ situations: list }, { manual: true });
                        toast.ok('局势改好了');
                        rerender();
                    }
                    break;
                }
                case 'del-situation': {
                    const idx = Number(target.getAttribute('data-index'));
                    const list = (loadState().world.situations || []).slice();
                    if (Number.isFinite(idx) && list[idx]) {
                        const gone = list.splice(idx, 1)[0];
                        updateWorld({ situations: list }, { manual: true });
                        addChronicle({ floor: -1, kind: '局势·手动删除', who: '', text: trimText(gone.title) || '（未记名）' });
                        toast.ok('删掉了（已在编年里留痕）');
                        rerender();
                    }
                    break;
                }
                case 'add-situation': {
                    const title = trimText(textOf(host, 'wxg-new-situation'));
                    if (!title) {
                        toast.warn('先写一句这条局势是什么');
                        break;
                    }
                    const list = (loadState().world.situations || []).slice();
                    list.push({ title, sides: '', tier: '几天内', at: Date.now(), floor: -1, manual: true });
                    updateWorld({ situations: list }, { manual: true });
                    toast.ok('加上了');
                    rerender();
                    break;
                }
                case 'set-world-clock': {
                    if (isChange) {
                        const before = loadState().world.clock;
                        const typed = trimText(target.value);
                        updateWorld({ clock: typed }, { manual: true });
                        // 她手填的钟咱照用（她的字最大），但**要出声**：万一填倒退了呢
                        if (typed && clockWentBackwards(before, typed)) {
                            toast.warn('这个钟比原来的早（' + (before || '未知') + ' → ' + typed + '）——已按你填的存下；如果不想让它倒退，改回来就行');
                        } else {
                            toast.ok('保存了');
                        }
                    }
                    break;
                }
                case 'set-world-place': if (isChange) { updateWorld({ place: target.value }, { manual: true }); toast.ok('保存了'); } break;
                case 'set-world-big': if (isChange) { updateWorld({ bigPicture: target.value }, { manual: true }); toast.ok('保存了'); } break;
                case 'set-hidden-stage': {
                    if (isChange) {
                        const state = loadState();
                        const h = state.world.hidden.find((x) => x.id === id);
                        if (h) {
                            h.stage = target.value;
                            h.manual = true;
                            h.updatedAt = Date.now();
                            state.world.hidden = state.world.hidden.slice();
                            /*
                             * ⭐ 修复单 #32：**补 saveState()**。
                             *   原来只 `slice()` 就直接 rerender——`slice()` 只是"改后待存"的写法，
                             *   真正的落盘得靠 saveState ⇒ 暗线阶段改完**永不落盘**，刷新就回原样。
                             *   （同文件其它同类 case 都带 saveState，就这处漏了。）
                             */
                            saveState();
                            toast.ok('暗线阶段已改成「' + String(target.value) + '」');
                            rerender();
                        }
                    }
                    break;
                }
                case 'del-hidden': removeHidden(id); rerender(); break;
                case 'add-hidden': {
                    const name = textOf(host, 'wxg-new-hidden');
                    if (!trimText(name)) {
                        toast.warn('先写个暗线名字');
                        break;
                    }
                    const tierSel = byId(host, 'wxg-new-hidden-tier');
                    const kindSel = byId(host, 'wxg-new-hidden-kind');
                    const tier = trimText(tierSel && tierSel.value) || '几天内';
                    const kind = trimText(kindSel && kindSel.value) || 'conflict';
                    const line = addHiddenManually({
                        name: trimText(name),
                        trigger: textOf(host, 'wxg-new-hidden-trigger'),
                        stage: kind === 'progress' ? '筹备' : '萌芽',
                        kind,
                        tier,
                    });
                    if (line) {
                        toast.ok('暗线加上了（' + tier + ' · ' + (kind === 'progress' ? '推进型' : '冲突型') + '）');
                    }
                    rerender();
                    break;
                }

                /* ---- 角色 ---- */
                case 'set-char-field':
                    if (isChange) {
                        updateCharacter(id, { [key]: target.value, manual: true });
                        /*
                         * ⭐ 改完一格 ⇒ 重画段，但 `rerender()` 会**顺手把浮层也冲掉**
                         *   （浮层挂在段容器里）⇒ 真机上就是"改一格、整张卡没了"。
                         *   ⇒ **重画完再把卡片画回来**（跟 `card-save` 同一个道理）。
                         */
                        rerender();
                        if (personCardId) {
                            renderPersonCard();
                        }
                    }
                    break;
                case 'set-alias':
                    if (isChange) {
                        updateCharacter(id, { aliases: toList(target.value), manual: true });
                        toast.ok('别名保存了');
                        rerender();
                        if (personCardId) {
                            renderPersonCard();   // 同上：别把卡片带走
                        }
                    }
                    break;
                case 'set-affinity':
                    if (isChange) {
                        updateCharacter(id, { affinity: trimText(target.value), manual: true });
                        rerender();
                    }
                    break;
                case 'add-know': {
                    /*
                     * ⭐ 补③：手加一条"他该知道的"。
                     *   来源必选（亲眼／被告知／公开）；来源楼层用**当前停在的楼**（她手加时就是在看那一楼）。
                     *   ⏔ 自己造来源类型；⏔ 改已有的（只增）。
                     */
                    const box = document.getElementById('wxg-know-text');
                    const txt = box && typeof box.value === 'string' ? box.value.trim() : '';
                    const srcEl = document.getElementById('wxg-know-source');
                    const src = srcEl && typeof srcEl.value === 'string' ? srcEl.value : '亲眼';
                    if (!txt) {
                        toast.fail('先写一句"他知道了什么"');
                        break;
                    }
                    // 来源楼层＝**她现在看着的最后一楼**（手加时就在看那一楼）
                    const chatNow = getChat();
                    const floorNow = (Array.isArray(chatNow) ? chatNow.length : 1) - 1;
                    const got = addKnow(id, { text: txt, source: src, floor: floorNow, manual: true });
                    if (!got) {
                        toast.info('这条没收（要么已经有了，要么没填来源）');
                        break;
                    }
                    toast.ok('记下了（' + got.source + '）');
                    rerender();
                    if (personCardId) {
                        renderPersonCard();
                    }
                    break;
                }
                case 'del-know': {
                    const ki = Math.round(Number(target.getAttribute('data-index')));
                    if (removeKnow(id, ki)) {
                        toast.ok('删了一条');
                    }
                    rerender();
                    if (personCardId) {
                        renderPersonCard();
                    }
                    break;
                }
                case 'set-bench':
                    /*
                     * ⭐ 补①：勾上＝**参与**后台推演；不勾＝不进轮转名单。
                     *   存的是**反的**（`noBench`）：老数据缺字段 ⇒ 默认"参与"，跟升级前一模一样。
                     */
                    if (isChange) {
                        updateCharacter(id, { noBench: target.checked !== true });
                        toast.ok(target.checked === true
                            ? '他会跟其他人一起轮转'
                            : '已关掉后台推演（不占名额；正文写到他时照常更新）');
                        rerender();
                        if (personCardId) {
                            renderPersonCard();
                        }
                    }
                    break;
                case 'set-player':
                    /*
                     * ⚠️ 她**取消勾**的时候要记一笔 `playerOff`：
                     *    名字跟人设名一样就会被自动认成"你"，不记的话下次重画又被自动勾上，
                     *    跟她抢方向盘（⛔ 自动可以，但不能盖过她明确说过的话）。
                     */
                    updateCharacter(id, {
                        isPlayer: target.checked === true,
                        playerOff: target.checked !== true,
                        manual: true,
                    });
                    rerender();
                        if (personCardId) {
                            renderPersonCard();
                        }
                    break;
                case 'del-char': removeCharacter(id); rerender(); break;
    /*
     * ⭐「清空这个世界」三步：铺开条数 → 她手打「确认清空」→ 才真清。
     *    ⛔ 打错字点不动；⛔ 只清账本，不碰世界书；⛔ 不静默（清完给回执）。
     */
    case 'clear-world-open':
        clearWorldOpen = true;
        rerender();
        break;
    case 'clear-world-cancel':
        clearWorldOpen = false;
        toast.info('没清，原样都在');
        rerender();
        break;
    case 'clear-world-do': {
        /*
         * ⭐ 从**点击按钮所在的那个确认盒**里读输入框。
         *   为什么：「清空这个世界」现在**总控与状态页各有一份**（她要的"双重保险"），
         *   而原来是按**写死的 id** 取 ⇒ 两份在一起时会读到**错的那个输入框**
         *   （`getElementById` 只给文档里第一个）⇒ 她打了字却被判"打错字了"。
         */
        const near = target && typeof target.closest === 'function'
            ? target.closest('.wxg-danger-box') : null;
        const box = (near && typeof near.querySelector === 'function'
            ? near.querySelector('input') : null) || document.getElementById('wxg-clear-typing-general');
        const typed = box && typeof box.value === 'string' ? box.value.trim() : '';
        if (typed !== CLEAR_WORD) {
            toast.fail('打错字了：要一字不差地打「' + CLEAR_WORD + '」才让清');
            break;
        }
        const counts = await clearWorldLedger();
        clearWorldOpen = false;
        const parts = Object.keys(counts).map((k) => k + ' ' + String(counts[k]) + ' 条');
        toast.ok('这个聊天的世界已清空：' + parts.join('、') + '（世界书没动）');
        rerender();
        break;
    }
    /*
     * ⭐ 删编年一条。⛔ 只删这一条，别的一律不碰；删完给回执（她要知道删掉了什么）。
     */
    case 'del-chronicle': {
        // ⚠️ 分发的元素变量叫 `target`（照旁边几条的写法，⛔ 不是我随手起的名）
        const idx = Number(target.getAttribute('data-index'));
        if (await removeChronicleAt(idx)) {
            toast.ok('删掉一条编年');
        } else {
            toast.fail('没删掉（下标对不上，可能列表刚刷新过）');
        }
        rerender();
        break;
    }
    /*
     * ⭐ 清空编年：按她的规矩来——**写明条数**再动手，⛔ 不静默。
     */
    case 'clear-chronicle': {
        const n = getChronicle().length;
        if (!n) {
            toast.info('编年本来就是空的');
            break;
        }
        if (!window.confirm('要把编年**全部清掉**吗？\n\n将清掉：编年 ' + String(n) + ' 条\n'
            + '（只清编年；名册、世界状态、暗线、世界书都不动）\n\n清掉就回不来了。')) {
            break;
        }
        const done = await clearChronicle();
        toast.ok('编年已清空（' + String(done) + ' 条）');
        rerender();
        break;
    }
                case 'accept-new': updateCharacter(id, { isNew: false }); toast.ok('收下了'); rerender(); break;
                case 'accept-new-all': {
                    const st = loadState();
                    const names = Array.isArray(st.newPeople) ? st.newPeople.slice() : [];
                    let n = 0;
                    for (const nm of names) {
                        const c = findCharacterByName(nm);
                        if (c && c.isNew) {
                            updateCharacter(c.id, { isNew: false });
                            n += 1;
                        }
                    }
                    st.newPeople = [];
                    saveState();
                    toast.ok(n ? ('收下了 ' + String(n) + ' 个新认的人') : '没有待处理的新认的人');
                    rerender();
                    break;
                }
                case 'ignore-char': updateCharacter(id, { ignored: true }); rerender(); break;
                case 'merge-into': {
                    const name = window.prompt('把哪一条合并进这一条？（写要并掉的那个名字）');
                    if (!trimText(name)) {
                        break;
                    }
                    const result = mergeCharacters(id, trimText(name));
                    if (result && result.ok) {
                        toast.ok('合并完成：别名、数据、历史都归到一条上了');
                    } else {
                        toast.warn('没找到叫「' + trimText(name) + '」的另一条记录');
                    }
                    rerender();
                    break;
                }

                /* ---- 名册 ---- */
                case 'add-char': {
                    const name = trimText(textOf(host, 'wxg-new-name'));
                    if (!name) {
                        toast.warn('先写个名字');
                        break;
                    }
                    addCharacter(name, { manual: true });
                    rerender();
                    break;
                }
                case 'preset-roster': {
                    const added = applyRosterPreset(ROSTER_PRESET);
                    toast.ok(added ? '加了 ' + String(added) + ' 个占位角色（名字随时改）' : '预设名册已经在里面了');
                    rerender();
                    break;
                }
                case 'import-roster': {
                    const added = addCharacters(textOf(host, 'wxg-import-roster'), { manual: true });
                    toast.ok(added ? '导入 ' + String(added) + ' 人' : '这些名字名册里已经有了');
                    rerender();
                    break;
                }
                case 'read-book': {
                    const res = await readFromBook(trimText(textOf(host, 'wxg-book-name')));
                    if (res) {
                        if (res.fellBack) {
                            break;   // 兜底那条已经在 readFromBook 里说过了
                        }
                        toast.ok('读进来 ' + String(res.read) + ' 条'
                            + (res.disabled ? '（另有 ' + String(res.disabled) + ' 条禁用，跳过）' : '')
                            + ' ⇒ 认出：人 ' + String(res.added)
                            + ' · 势力 ' + String(res.factions)
                            + ' · 局势 ' + String(res.situations)
                            + ' · 地点 ' + String(res.places)
                            + '（世界状态里现在共 ' + String(res.situationsTotal) + ' 条）');
                    }
                    rerender();
                    break;
                }
                case 'list-books': {
                    const names = await listWorldbookNames();
                    const wrap = byId(host, 'wxg-bookpick');
                    const info = byId(host, 'wxg-book-list');
                    if (!wrap) {
                        break;
                    }
                    if (!names.length) {
                        if (info) {
                            info.textContent = '没读到世界书列表（有些酒馆版本没开这个接口）⇒ 直接手填书名也行。';
                        }
                        break;
                    }
                    if (info) {
                        info.textContent = '读到 ' + String(names.length) + ' 本：点书名选它。';
                    }
                    // 表头留着，小块交给 paintBookPicks 统一画
                    for (const child of asArray(wrap.childNodes)) {
                        if (!String(child.className || '').includes('wxg-pick-head')) {
                            wrap.removeChild(child);
                        }
                    }
                    listBooksCache = names;
                    // ⚠️ 从"草稿优先、否则已存"里取（⛔ 重画时别把还没保存的点选冲掉）
                    paintBookPicks(host,
                        toList(stagedValue('extract', 'extractBooks', getSettings().extractBooks)),
                        toList(stagedValue('extract', 'excludeBooks', getSettings().excludeBooks)));
                    // 顺手把每本书的"看条目"也摆出来
                    const ent = byId(host, 'wxg-entpick');
                    if (ent && !ent.querySelector('[data-action="list-entries"]')) {
                        for (const n of names) {
                            ent.appendChild(button('看条目：' + n, 'list-entries', 'wxg-btn-sm', n));
                        }
                    }
                    break;
                }
                case 'pick-book': {
                    const name = trimText(target.getAttribute('data-book'));
                    if (!name) {
                        break;
                    }
                    // ⭐ 只改这一段草稿：画面不动、⛔ 不存盘、⛔ 不重画
                    const ex = toList(stagedValue('extract', 'extractBooks', getSettings().extractBooks));
                    const no = toList(stagedValue('extract', 'excludeBooks', getSettings().excludeBooks));
                    const key = (x) => asText(x);
                    const iEx = ex.findIndex((x) => key(x) === key(name));
                    const iNo = no.findIndex((x) => key(x) === key(name));
                    if (iEx >= 0) {
                        ex.splice(iEx, 1);
                        no.push(name);
                        toast.info('「' + name + '」改成"排除"（还没保存）');
                    } else if (iNo >= 0) {
                        no.splice(iNo, 1);
                        toast.info('「' + name + '」从"排除"里拿掉（还没保存）');
                    } else {
                        ex.push(name);
                        toast.ok('「' + name + '」要"提取"（还没保存）');
                    }
                    stage('extract', 'extractBooks', ex.join('、'));
                    stage('extract', 'excludeBooks', no.join('、'));
                    paintBookPicks(host, ex, no);
                    refreshSaveBar(host, 'extract');
                    break;
                }
                /* ---- 段级保存／撤销（她拍的："每个大标题加一个保存"） ---- */
                case 'toggle-sec': {
                    /*
                     * ⭐ 目标核对 2②：**我们自己的开合**。
                     *   切 `data-wxg-open`（CSS 靠它决定显隐）～同时把行内 display 也跟上，
                     *   免得旧的行内样式（以前 ST 写进去的）把它压住。
                     */
                    const sec = target.closest ? target.closest('.wxg-sec') : null;
                    if (sec) {
                        const openNow = sec.getAttribute('data-wxg-open') === '1';
                        const bodyEl = sec.querySelector('.wxg-sec-body');
                        if (openNow) {
                            sec.removeAttribute('data-wxg-open');
                            if (bodyEl && bodyEl.style) { bodyEl.style.display = 'none'; }
                        } else {
                            sec.setAttribute('data-wxg-open', '1');
                            if (bodyEl && bodyEl.style) { bodyEl.style.display = ''; }
                        }
                    }
                    break;
                }
                case 'save-section': {
                    const n = commitSection(id);
                    refreshToastSection(id, n);
                    rerender();
                    break;
                }
                case 'discard-section': {
                    delete stagingOf(stagingMode)[id];
                    toast.info('这一段没保存的改动丢掉了（回到已存的）');
                    rerender();
                    break;
                }
                case 'list-entries': {
                    const name = id;
                    // ⭐ 记住"正在看哪本书"，重画之后自动摆回来
                    //    （⛔ 不然她点一条之后列表就没了，没法接着点第二条）
                    pickBook = trimText(name);
                    const entries = await getEntries(name);
                    pickEntries = entries;
                    const note = byId(host, 'wxg-entnote');
                    const wrap = byId(host, 'wxg-entpick');
                    if (!note) {
                        break;
                    }
                    if (!entries.length) {
                        note.textContent = '「' + name + '」里没读到条目（或这本没开）。';
                        break;
                    }
                    const off = toList(getSettings().excludeEntries);
                    note.textContent = '「' + name + '」共 ' + String(entries.length)
                        + ' 条：点一下＝不读这一条（点过的不参与推演）；⛔ 不改你的世界书。';
                    if (wrap) {
                        const head = wrap.querySelector('.wxg-pick-head');
                        while (wrap.firstChild) {
                            wrap.removeChild(wrap.firstChild);
                        }
                        if (head) {
                            wrap.appendChild(head);
                        }
                        for (const e of entries.slice(0, 200)) {
                            const title = trimText(e && (e.comment || e.key || e.title));
                            if (!title) {
                                continue;
                            }
                            const b = document.createElement('button');
                            b.type = 'button';
                            b.className = 'wxg-pick'
                                + (off.some((x) => asText(x) === asText(title)) ? ' is-on' : '');
                            b.textContent = title;
                            b.title = off.some((x) => asText(x) === asText(title))
                                ? '已设为"不读"（再点＝恢复读它）'
                                : '点一下＝不读这一条';
                            b.setAttribute('data-action', 'toggle-entry');
                            b.setAttribute('data-entry', title);
                            wrap.appendChild(b);
                        }
                    }
                    break;
                }
                case 'entry-all-on':
                case 'entry-all-off':
                case 'entry-invert': {
                    /*
                     * ⭐ 3③：批量改（同样**只动草稿**，等段底保存）。
                     *   ⚠️ "全不读"只管**当前这本书的条目**，⏔把别的书的排除也涂了。
                     */
                    const act = action;
                    const all = pickEntries.map((e) => trimText(e && (e.comment || e.key || e.name || e.title)))
                        .filter(Boolean);
                    let offNow = toList(stagedValue('extract', 'excludeEntries', getSettings().excludeEntries));
                    const inOff = (x) => offNow.some((y) => asText(y) === asText(x));
                    if (act === 'entry-all-on') {
                        offNow = offNow.filter((x) => !all.some((y) => asText(y) === asText(x)));
                        toast.ok('这本书 ' + String(all.length) + ' 条全读（还没保存）');
                    } else if (act === 'entry-all-off') {
                        for (const x of all) {
                            if (!inOff(x)) {
                                offNow.push(x);
                            }
                        }
                        toast.info('这本书 ' + String(all.length) + ' 条全不读（还没保存）');
                    } else {
                        for (const x of all) {
                            if (inOff(x)) {
                                offNow = offNow.filter((y) => asText(y) !== asText(x));
                            } else {
                                offNow.push(x);
                            }
                        }
                        toast.info('反选了（还没保存）');
                    }
                    stage('extract', 'excludeEntries', offNow.join('、'));
                    renderEntryPick(host, offNow);
                    refreshSaveBar(host, 'extract');
                    break;
                }
                case 'filter-entries': {
                    entFilter = trimText(target.value);
                    renderEntryPick(host);
                    const back = host.querySelector('#wxg-entfilter');
                    if (back && typeof back.focus === 'function') {
                        back.focus();
                    }
                    break;
                }
                case 'toggle-entry': {
                    const title = trimText(target.getAttribute('data-entry'));
                    if (!title) {
                        break;
                    }
                    // ⭐ 同样只改"待保存"缓冲（她拍的：别点一下就生效、面板别跳）
                    const off = toList(stagedValue('extract', 'excludeEntries', getSettings().excludeEntries));
                    const i = off.findIndex((x) => asText(x) === asText(title));
                    if (i >= 0) {
                        off.splice(i, 1);
                        toast.ok('「' + title + '」恢复参与（还没保存）');
                    } else {
                        off.push(title);
                        toast.info('「' + title + '」标成"不读"（还没保存）');
                    }
                    // ⭐ 进这一段的草稿（等段底那颗保存一起存）
                    stage('extract', 'excludeEntries', off.join('、'));
                    renderEntryPick(host, off);
                    refreshSaveBar(host, 'extract');
                    break;
                }
                case 'detect-dupes': {
                    const dupes = autoDetectDuplicates();
                    const box = byId(host, 'wxg-book-list');
                    if (!dupes.length) {
                        toast.ok('没发现疑似重复的记录');
                        if (box) {
                            box.textContent = '';
                        }
                    } else {
                        toast.info('发现 ' + String(dupes.length) + ' 组疑似重复');
                        if (box) {
                            box.textContent = '疑似重复：' + dupes.map((d) => d.map((x) => x.name).join(' ⇄ ')).join(' ｜ ')
                                + '（用「按这条合并…」处理）';
                        }
                    }
                    break;
                }
                case 'export-data':
                    downloadText('万象阁备份-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify(exportState(), null, 2));
                    toast.ok('备份已导出');
                    break;

                /* ---- 召回 ---- */
                case 'stage-recent-turns': if (isChange) { patchSettings({ recentTurns: target.value }); rerender(); } break;
                case 'stage-max-chars': if (isChange) { patchSettings({ maxChars: target.value }); rerender(); } break;
                case 'stage-max-events': if (isChange) { patchSettings({ maxEvents: target.value }); rerender(); } break;
                case 'stage-past-floor-cut': if (isChange) { patchSettings({ pastFloorCut: target.value }); rerender(); } break;
                /* ---- 外观（我们自己的配色） ---- */
                case 'set-appearance': {
                    if (!isChange) {
                        break;
                    }
                    const key = target.id;   // wxg-app-xxx → 槽位名
                    const slot = key.replace('wxg-app-', '');
                    const patch = {};
                    if (slot === 'palette') {
                        Object.assign(patch, palettePatch(trimText(target.value)));
                    } else {
                        patch[slot] = trimText(target.value);
                        // 手改了槽位 ⇒ 色板显示为"自定义"（⛔ 不假装还是预设）
                        patch.palette = 'custom';
                    }
                    patchSettings({ appearance: Object.assign({}, getSettings().appearance || {}, patch) });
                    toast.ok('配色已更新' + (slot === 'palette' ? '' : '（已标为「自定义」）'));
                    rerender();
                    break;
                }
                case 'reset-appearance': {
                    /*
                     * ⭐ 复审追加 A4：两个子：
                     *   ① **先清草稿**：显示与预览走的是 `effectiveAppearance()`（**草稿优先**）
                     *     ⇒ 她改过任一槽再点“恢复”，草稿还在 ⇒ **预览盒与颜色框纹丝不动**；
                     *   ② 色板键按**当前生效值**取：已存色板是 `custom` 时 `palettePatch('custom')` 只返回 `{palette:'custom'}`（四槽一个都不恢复）
                     *     ⇒ custom 时退回 `'ink'`。
                     */
                    const curEff = effectiveAppearance();
                    const palKey = (curEff.palette && curEff.palette !== 'custom') ? curEff.palette : 'ink';
                    delete stagingOf(stagingMode).appearance;
                    patchSettings({
                        appearance: Object.assign({}, getSettings().appearance || {}, palettePatch(palKey), { text: '' }),
                    });
                    toast.ok('已退回所选色板');
                    rerender();
                    break;
                }
                case 'set-app-to-panel':
                    patchSettings({ appearance: Object.assign({}, getSettings().appearance || {}, { applyToPanel: target.checked }) });
                    toast.ok(target.checked ? '浮层与小框也跟着这套配色' : '浮层与小框改为跟随酒馆主题');
                    rerender();
                    break;
                case 'set-layout-mode':
                    patchSettings({ layoutMode: trimText(target.value) === 'panel' ? 'panel' : 'workspace' });
                    toast.ok(trimText(target.value) === 'panel' ? '以后点入口＝开浮层面板' : '以后点入口＝开整页工作台');
                    rerender();
                    break;
                /* ---- 任务（主线／支线）：她也能改 ---- */
                case 'set-quest-status': {
                    if (!isChange) {
                        break;
                    }
                    const title = target.getAttribute('data-title') || '';
                    updateQuest(id, title, { status: trimText(target.value) });
                    toast.ok('任务状态改成「' + trimText(target.value) + '」了');
                    rerender();
                    break;
                }
                case 'del-quest': {
                    const title = target.getAttribute('data-title') || '';
                    if (removeQuest(id, title)) {
                        addChronicle({ floor: -1, kind: '任务·手动删除', who: '', text: title });
                        toast.ok('任务删掉了（已在编年里留痕）');
                    }
                    rerender();
                    break;
                }
                case 'set-sort-mode': if (isChange) { patchSettings({ sortMode: target.value }); rerender(); } break;
                case 'stage-max-parallel': if (isChange) { patchSettings({ maxParallelChars: target.value }); rerender(); } break;

                /* ---- 四格 ---- */
                /* ⭐ 先进草稿（等段底那颗「保存」一起存），⛔ 不再改一处存一处 */




                case 'set-extract-tags': if (isChange) { patchSettings({ extractTags: target.value }); toast.ok('提取标签已保存'); } break;
                case 'set-exclude-tags': if (isChange) { patchSettings({ excludeTags: target.value }); toast.ok('排除标签已保存'); } break;
                case 'set-extract-books': if (isChange) { patchSettings({ extractBooks: target.value }); toast.ok('提取世界书已保存'); } break;
                case 'set-exclude-books': if (isChange) { patchSettings({ excludeBooks: target.value }); toast.ok('排除世界书已保存'); } break;
                case 'set-affinity-source': if (isChange) { patchSettings({ affinitySource: target.value }); toast.ok('好感数据源已保存'); } break;
                case 'set-strip-paired':
                    patchSettings({ stripPairedBlocks: target.checked });
                    toast.ok(target.checked ? '会按结构剥掉成对的机器块' : '不再按结构剥（只用你点名的排除标签）');
                    break;
                case 'set-strip-comments':
                    patchSettings({ stripHtmlComments: target.checked });
                    toast.ok(target.checked ? '会剥掉 HTML 注释' : '不再剥 HTML 注释');
                    break;
                case 'set-only-enabled':
                    patchSettings({ onlyEnabledEntries: target.checked });
                    toast.ok(target.checked ? '只读开启着的条目' : '连关掉的条目也一起读');
                    break;

                /* ---- API ---- */
                case 'set-api-mode': if (isChange) { patchApi({ mode: target.value }); rerender(); } break;
                case 'set-api-url': if (isChange) { patchApi({ url: target.value }); toast.ok('接口地址已保存'); } break;
                case 'set-api-key': if (isChange) { patchApi({ key: target.value }); toast.ok('密钥已保存'); } break;
                case 'set-api-model': if (isChange) { patchApi({ model: target.value }); toast.ok('模型名已保存'); } break;
                case 'set-api-model-cheap': if (isChange) { patchApi({ modelCheap: target.value }); } break;
                case 'set-api-temp': if (isChange) { patchApi({ temperature: target.value }); } break;
                case 'set-api-maxtok': if (isChange) { patchApi({ maxTokens: target.value }); } break;
                case 'fetch-models': {
                    toast.info('正在拉模型列表…');
                    const apiMod = await import('../core/apiclient.js');
                    const boxEl = host.querySelector('#wxg-api-modellist');
                    if (boxEl) {
                        while (boxEl.firstChild) {
                            boxEl.removeChild(boxEl.firstChild);
                        }
                    }
                    const res = await apiMod.fetchModels({});
                    if (!res.ok) {
                        toast.fail('没拉到：' + res.reason + '（你仍可以自己填模型名）');
                        break;
                    }
                    const chipRow = el('div', 'wxg-chiprow');
                    for (const nm of res.list.slice(0, 80)) {
                        const chip = el('button', 'wxg-chip', nm);
                        chip.type = 'button';
                        chip.setAttribute('data-action', 'pick-model');
                        chip.setAttribute('data-name', nm);
                        chipRow.appendChild(chip);
                    }
                    if (boxEl) {
                        boxEl.appendChild(chipRow);
                    }
                    toast.ok('拉到 ' + String(res.list.length) + ' 个模型，点一个就填上');
                    break;
                }
                case 'pick-model': {
                    const name = trimText(target.getAttribute('data-name'));
                    const inp = host.querySelector('#wxg-api-model');
                    if (inp && name) {
                        inp.value = name;
                        // 走同一条草稿（⏔ 直接 patch：她还要点段底保存）
                        const which = stageOne('stage-api-model', inp);
                        if (which) {
                            refreshSaveBar(host, which);
                        }
                        toast.ok('已填上：' + name + '（记得点下面的保存）');
                    }
                    break;
                }
                case 'test-api': {
                    toast.info('正在测连接…');
                    const res = await testApi();
                    if (res.ok) {
                        toast.ok('连接通了：' + res.note);
                    } else {
                        /*
                         * ⭐ 失败时把**实际打的地址**一起说出来。
                         *    云酒馆最常见的两种坑就在这儿：挂在子路径下（路径推错）、
                         *    或服务器把"自定义 URL"关了 ⇒ 光说"失败了"她没法判断。
                         */
                        let where = '';
                        try {
                            const mod = await import('../core/apiclient.js');
                            where = mod.tavernApiPath();
                        } catch (e) {
                            where = '';
                        }
                        const mode = (getSettings().api || {}).mode === 'direct' ? '直连' : '经酒馆转发';
                        toast.fail('没通（走的' + mode + (where ? '，打的是 ' + where : '') + '）：' + res.note);
                    }
                    break;
                }

                /* ---- ⭐ API 书签（她点名要的：设好几套通道随时切） ---- */
                case 'save-profile':
                case 'overwrite-profile': {
                    const nick = trimText(textOf(host, 'wxg-profile-nick'));
                    if (!nick) {
                        toast.fail('先给书签起个名字（例：主站／备用站）');
                        break;
                    }
                    // ⭐ 存书签时把**这一段草稿里的改动也算上**（地址刚改、还没按保存也能存进书签）
                    // ⚠️ 顺序要紧：**先**把 one 和 list 算好、**再** commitSection ——
                    //    commitSection 会把草稿删掉，反过来写就只能拿到空的（这个坑真踩过）。
                    const live = getSettings().api || {};
                    const draft = stagingOf(stagingMode).api || {};
                    // ⚠️ 草稿里的 profiles 是**打开面板那一刻的旧值**（甚至空的）
                    //    ⇒ 合并时不许认它，否则会把刚存的书签冲掉。书签只认设置里那一份。
                    const cur = Object.assign({}, live, draft);
                    delete cur.profiles;
                    const one = {
                        nick,
                        mode: cur.mode,
                        url: trimText(cur.url),
                        key: trimText(cur.key),
                        model: trimText(cur.model),
                        modelCheap: trimText(cur.modelCheap),
                        temperature: Number(cur.temperature),
                        maxTokens: Number(cur.maxTokens),
                        at: Date.now(),
                    };
                    const list = (Array.isArray(live.profiles) ? live.profiles : []).slice();
                    const idx = list.findIndex((p) => trimText(p && p.nick) === nick);
                    /*
                     * ⭐ 同名＝更新那一条（她改完地址再存同名，本来就想把这条更新掉）。
                     *    以前这里拦下来让她去点另一颗「覆盖同名书签」——太绕，去掉那颗按钮了。
                     *    ⛔ 仍然不会"悄悄多出一条"。
                     */
                    if (idx >= 0) {
                        list[idx] = one;
                    } else {
                        list.push(one);
                    }
                    /*
                     * ⚠️ 存书签**只存书签**：⛔ 不顺手把草稿落盘。
                     *    否则"当前用的通道"会被悄悄改掉（她只是想把这一套存起来，未必想现在就用）。
                     *    想让它当当前通道 ⇒ 明确点「切到这套」。
                     */
                    // ⚠️ 落盘要用**当下**的 api（`live` 是重画前取的快照，profiles 可能还旧）
                    patchSettings({ api: Object.assign({}, getSettings().api || {}, { profiles: list }) });
                    const pendingN = stagedCount('api');
                    toast.ok((idx >= 0 ? '已覆盖书签「' : '已存成书签「') + nick + '」（存的这一套'
                        + (pendingN ? '；上方还有 ' + String(pendingN) + ' 处没保存的改动' : '')
                        + '，想现在就用它请点「切到这套」）');
                    rerender();
                    break;
                }
                case 'apply-profile': {
                    const nick = id;
                    const cur = getSettings().api || {};
                    const one = (Array.isArray(cur.profiles) ? cur.profiles : []).find((p) => trimText(p && p.nick) === nick);
                    if (!one) {
                        toast.fail('找不到书签「' + nick + '」');
                        break;
                    }
                    patchSettings({
                        api: Object.assign({}, cur, {
                            mode: one.mode,
                            url: one.url,
                            key: one.key,
                            model: one.model,
                            modelCheap: one.modelCheap,
                            temperature: one.temperature,
                            maxTokens: one.maxTokens,
                        }),
                    });
                    toast.ok('已切到书签「' + nick + '」');
                    rerender();
                    break;
                }
                case 'del-profile': {
                    const nick = id;
                    const cur = getSettings().api || {};
                    const list = (Array.isArray(cur.profiles) ? cur.profiles : [])
                        .filter((p) => trimText(p && p.nick) !== nick);
                    patchSettings({ api: Object.assign({}, cur, { profiles: list }) });
                    toast.ok('删掉书签「' + nick + '」了');
                    rerender();
                    break;
                }

                /* ---- 提示词 ---- */
                case 'set-inject-header': if (isChange) { patchSettings({ injectHeader: target.value }); toast.ok('保存了'); } break;
                case 'set-prompt-world': if (isChange) { patchSettings({ promptWorld: target.value }); toast.ok('保存了'); } break;
                case 'set-prompt-chars': if (isChange) { patchSettings({ promptChars: target.value }); toast.ok('保存了'); } break;
                case 'set-jailbreak':
                    if (isChange) {
                        patchSettings({ jailbreak: target.value });
                        toast.ok(trimText(target.value) ? '破限词保存了' : '破限词清空了，会用内置那份');
                    }
                    break;
                case 'show-jailbreak': {
                    const box = byId(host, 'wxg-jailbreak-view');
                    if (box) {
                        box.style.display = box.style.display === 'none' ? 'block' : 'none';
                    }
                    break;
                }
                case 'reset-prompts':
                    setAllPromptsDefault();
                    toast.ok('三套提示词都恢复成内置默认了');
                    rerender();
                    break;

                /* ---- 动作 ---- */
                                case 'use-hold-one': {
                    // 「改成 2（推荐）」：只改频率这一个值，⛔ 不碰别的设置
                    patchSettings({ updateEvery: 2 });
                    toast.ok('已改成「停在上一轮」：只算落定的楼，省额度');
                    rerender();
                    break;
                }
                case 'toggle-lock': {
                    // 数据卡的「编辑／收起」：只切「正在编辑」这个状态，⏐ 不动数据
                    const k = trimText(id);
                    if (unlockedCards.has(k)) {
                        unlockedCards.delete(k);
                    } else {
                        unlockedCards.add(k);
                    }
                    rerender();
                    break;
                }
                case 'toggle-mini-show': {
                    /*
                     * ⭐ 悬浮小框的显隐：**勾了立刻挂载、取消立刻收起**（⛔ 不等"保存"）——
                     *    她是看着球在不在来判断勾没勾上的，要等保存才生效会以为没反应。
                     */
                    const on = target.checked === true;
                    patchSettings({ mini: Object.assign({}, getSettings().mini || {}, { show: on }) });
                    if (on) {
                        mountMini();
                    } else {
                        closeMini();
                    }
                    toast.ok(on ? '悬浮小框已叫出来' : '悬浮小框已收起（随时能在这儿再叫出来）');
                    rerender();
                    break;
                }
                case 'update-now':
                    runUpdate({ manual: true });
                    toast.info('开始更新世界与角色状态（后台跑，不挡你聊天）');
                    rerender();
                    break;
                case 'cancel-update':
                    cancelUpdate();
                    toast.warn('已请求取消：跑完当前这一小步就停');
                    rerender();
                    break;
                case 'rollback': {
                    const snap = rollbackLast();
                    toast.ok(snap ? '已撤回上一次更新（撤回前那一版也留着，能再撤回来）' : '没有可撤回的版本');
                    rerender();
                    break;
                }
                case 'replan':
                    replanCurrentFloor();
                    toast.info('本楼重新算好了');
                    break;
                case 'reconcile': {
                    const res = runReconcile();
                    toast.ok('对账完成：清了 ' + String(res.removed) + ' 条对不上的账' + (res.note ? '（' + res.note + '）' : ''));
                    rerender();
                    break;
                }
                case 'publish-book': {
                    const res = await publishToBook({ force: true });
                    if (res && res.ok) {
                        toast.ok('已写进世界书《' + res.book + '》：' + String(res.entries) + ' 条');
                    } else {
                        toast.fail('世界书没写成：' + ((res && res.reason) || '未知原因'));
                    }
                    break;
                }
                case 'backfill': {
                    const { runBackfill } = await import('../core/pipeline.js');
                    /*
                     * ⭐ 第 3 条：把"补最近几楼"读出来传进去；留空＝全部（老行为）。
                     *   ⭐ 第 4 条：toast 里**直接说清这次补的范围**（不用她再翻到状态页）。
                     */
                    const rawN = trimText((byId(host, 'wxg-backfill-n') || {}).value || '');
                    const lim = Number.parseInt(rawN, 10);
                    const useLim = Number.isFinite(lim) && lim > 0 ? lim : 0;
                    runBackfill(useLim ? { limit: useLim } : {});
                    toast.info(useLim
                        ? ('开始补推历史：只补**最近 ' + String(useLim) + ' 楼**（分批跑，可随时取消）')
                        : '开始补推历史：**全部楼层**（分批跑，可随时取消）');
                    rerender();
                    break;
                }
                case 'copy-text': {
                    const holderId = target.getAttribute('data-id');
                    const holder = holderId ? byId(host, 'wxg-text-' + holderId) : null;
                    if (holder) {
                        copyToClipboard(holder.textContent, target);
                    }
                    break;
                }
                default:
                    break;
            }
        } catch (err) {
            console.warn('[万象阁] 面板操作出错：', err);
            toast.fail('操作出错：' + (err && err.message ? err.message : String(err)));
        }
    };

    host.addEventListener('click', handler);
    host.addEventListener('change', handler);
    // ⭐ 角色搜索要"边打边筛"：只切显示、⛔ 不重画
    //    （重画会把她正在打的字和滚动位置全弄没）
    host.addEventListener('input', (e) => {
        const t = e && e.target;
        if (!t || typeof t.getAttribute !== 'function') {
            return;
        }
        if (t.getAttribute('data-live-action') === 'char-search') {
            charSearch.query = asText(t.value);
            applyCharSearch(host, charSearch.query);
        }
    });
}
