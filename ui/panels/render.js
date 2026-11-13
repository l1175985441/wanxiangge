/* 公-3 渲染总闸：从 ui/sections.js 整块搬出（含体内 helper），逻辑一字未改（206 后） */
import { secRoster } from './roster.js';
import { secStatus } from './status.js';
import { secWorld } from './world.js';
import { secHidden } from './hidden.js';
import { secBrief } from './brief.js';
import { secChronicle } from './chronicle.js';
import { secSettings } from './settings.js';
import { secApi } from './api.js';
import { secPrompts } from './prompts.js';
import { mountLedgers } from '../ledgers.js';
import { el, section, card, button, lastSectionsHost, setLastSectionsHost, stagingMode, setStagingMode } from './shared.js';
import { buildJumpNav } from './nav.js';
import { pickBook, applyLocks } from './locks.js';
import { markOneCol } from '../onecol.js';
import { tidyHeadings } from '../tidy-heads.js';
import { toast } from '../toast.js';
import { getSettings, patchSettings } from '../../core/settings.js';
import { importBookWiki } from '../../core/book-wiki.js';
import { asText, trimText, asArray } from '../../core/utils.js';


export function renderSections(host, opts) {
    const hooks = (opts && opts.hooks) || {};
    /*
     * ⭐ 复审追加 B2：**台前有窗口时，后台那次画不该抢挂载点**。
     *   原来无条件赋值：她开着工作台、点开人物卡，
     *   后台一次 `renderPanel()`（注入完成／后台更新完／她发消息…都会调）
     *   就把挂载点改指到**隐藏抽屉** ⇒ 人物卡被"偷"进去（从工作台消失）。
     *   ⚠️ `handler` 里"点击拨正 lastSectionsHost"那半是好的，⛔ 动它。
     */
    const hasFgWindow = typeof document !== 'undefined'
        && !!(document.getElementById('wanxiangge-workspace') || document.getElementById('wanxiangge-panel'));
    const isSettingsDraw = ((opts && opts.mode) || 'workspace') === 'settings';   /* ★ 依据＝阿砚 17 号 §一-1：默认＝工作台整套，只有显式 settings 才是抽屉 */
    if (!isSettingsDraw || !hasFgWindow || !lastSectionsHost) {
        setLastSectionsHost(host || lastSectionsHost);   // 浮层要挂在它里才收得到点击
    }
    if (!host) {
        return;
    }
    const mode = (opts && opts.mode) || 'workspace';   /* ★ 同上：不带 mode 的老调用照旧整套 ✓ */
    host.replaceChildren();
    /*
     * ★ 20261023（依据＝阿砚 17 号  §一-1）：**设置抽屉里只画总控＋一个入口**。
     *   旧：抽屉里也画**整套面板**（mode 传了没分支 ✗）
     *   新：`mode === 'settings'` 只画小卡＋「打开工作台」；不带 mode 的老调用**照旧整套** ✓
     */
    if (mode === 'settings') {
        host.classList.add('wanxiangge');
        host.setAttribute('data-wxg-mode', mode);
        const entry = section('万象阁', '设置区只放入口：完整面板在「工作台」里。',
            { open: true, five: false });
        const cEntry = card('打开');
        const rowE = el('div', 'wxg-card-actions');
        rowE.appendChild(button('打开工作台', 'open-workspace-btn', 'wxg-primary'));
        cEntry.appendChild(rowE);
        entry.appendChild(cEntry);
        host.appendChild(entry);
        return;
    }
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
    const prevStagingMode = stagingMode;
    setStagingMode(mode);
    const stageEl = el('div', 'wxg-stage');
    try {
        /*
         * ① 状态：账本／进度／每轮记录 —— **三页已并成一页**
         *    （复核方："这三个是不是应该坐到一个地方？"）
         *    ⏐ secSteps／secReport 不再各自开页，改成往状态页里摆（见 secStatus）。
         */
secRoster(stageEl);
secStatus(stageEl);
secWorld(stageEl);
secHidden(stageEl);
secBrief(stageEl);
secChronicle(stageEl);
mountLedgers(stageEl);
secSettings(stageEl);
secApi(stageEl);
secPrompts(stageEl);
        /*
         * ⭐ 重画之后把世界条目的浮层**画回来**（浮层挂在段容器里，重画会冲掉它）。
         *   ⛔ 写在每个动作里（那样漏一个就没了）。
         * ⭐ 复审追加 B2（乙）：**同一前提**（后台那一次画 + 台前有窗口）下⛔ 重挂——
         *   否则后台刷一下就把她工作台里开着的卡**拆下来重挂到隐藏抽屉**里（"被偷走"）。
         */
        const canRemount = !(isSettingsDraw && hasFgWindow);
        if (hooks.getOpenWorldEntry && hooks.getOpenWorldEntry() && canRemount) {
            hooks.renderWorldEntryCard();
        }
        if (hooks.getHealthOpen && hooks.getHealthOpen() && canRemount) {
            hooks.renderHealthCard();
        }
        /*
         * ⭐ 修复单 #33（后半）：**人物卡也要画回来**。
         *   她点开人物卡之后，任何一次重画（比如后台刷了一下设置区）都会把浮层冲掉；
         *   上面两处都补了、就这处漏了 ⇒ 表现是"人物卡自己没了"。
         *   ⛔ 别再写在每个动作里（漏一个就没一个）——统一听这里。
         */
        if (hooks.getPersonCardId && hooks.getPersonCardId() && canRemount) {
            try {
                hooks.renderPersonCard();
            } catch (e) {
                console.warn('[万象阁] 摆回人物卡出错：', e);
            }
        }
        const before = asArray(host.children || []).length;
        /* 一：整页只有一个主卡 ⇒ 盖 `data-wxg-onecol`（实现在 ui/onecol.js） */
        try { markOneCol({ stageEl: stageEl, asArray: asArray }); } catch (eOnecol) { console.warn('[万象阁] 标单卡页出错：', eOnecol); }
    try { tidyHeadings(stageEl); }   /* 77：必须扫 stageEl（此时内容还在 stageEl 里，⛔ host） */ catch (eTidy) { console.warn('[万象阁] 标题去括号出错：', eTidy); }   /* 75 */
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
        setStagingMode(prevStagingMode);
    }
}
/**
 * 画世界书小块（只改这几颗按钮，⛔ 不重画面板 —— 点一下面板就跳会很难连着点）。
 * @param {object} host 面板正文层
 * @param {Array<string>} ex 待保存的"提取"名单
 * @param {Array<string>} no 待保存的"排除"名单
 */
/**
 * ⭐ RD1-3（材料 11）：把 `lastModelList` 画成芯片 ✓
 *   （重建与拉取两边共用同一份标记 ✓，⛔ 两套写法 ✗）
 */
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
    const off = Array.isArray(offList) ? offList : toList(stagedValue('extract', 'excludeEntries', excludeTextFor(pickBook)));
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
/**
 * 把中转站里的正文层合回抽屉壳，整壳挂进宿主；非原生层的东西原样搬 */
export function hangUp(host, staging) {
    for (const node of asArray(staging.children || [])) {
        const drawer = node && node.__wxgDrawer;
        if (drawer) {
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
export function drawFailure(host, err) {
    try {
        const box = el('div', 'wxg-store');
        box.setAttribute('data-tone', 'bad');
        box.appendChild(el('b', null, '界面有一段没画出来（原因照抄反馈即可）：'));
        box.appendChild(el('div', 'wxg-fact', String((err && err.message) || err)));
        /* 20261022 ⑤：⛔ 把 err.stack（函数名／路径／行号）画到屏上；只进控制台 */
            try { console.error('[wxg] 界面段渲染失败', err); } catch (eC) { }
            box.appendChild(el('div', 'wxg-fact', '这一段没画出来：把这句反馈给我们就行'));
        host.appendChild(box);
    } catch (e) {
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
export function byId(host, id) {
    if (!host || !id) {
        return null;
    }
    return host.querySelector('#' + id) || null;
}
/** 读一个输入框的值（⛔ 只读**当前这个面板**里的那个，别串到另一个面板去） */
export function textOf(host, id) {
    const node = byId(host, id);
    return node ? asText(node.value) : '';
}
export function patchApi(patch) {
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
export async function readFromBook(book) {
    try {
        const res = await importBookWiki(book, { allowRuleFallback: true });
        if (!res.ok) {
            toast.fail('读世界书没成：' + (res.reason || '未知原因'));
            return { added: 0, skipped: 0 };
        }
        if (res.fellBack) {
            /*
             * 87#4：不能只说“配好 API 再点”（她被这句害白试两次：API 已配好，是输入太长）。
             *   必须说清“这次没分类，势力／局势都没读”，并给出兜底到了几条。
             */
            const num0 = (v) => (Number.isFinite(Number(v)) ? String(Number(v)) : '0');
            toast.warn('模型这条线没通（' + (res.reason || '未知') + '）⇒ **这次没分类，势力／局势都没读**。'
                + '人物按名字收了 ' + num0(res.added) + ' 人；势力／局势／地点按条目前缀兜底：'
                + '势力 ' + num0(res.factions) + ' · 局势 ' + num0(res.situations) + ' · 地点 ' + num0(res.places) + '。'
                + '下次点一次会从断点接着读。');
            return { added: res.added, skipped: 0 };
        }
        return res;
    } catch (e) {
        toast.fail('读世界书出错：' + (e && e.message ? e.message : String(e)));
        return null;
    }
}
export async function testApi() {
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
export function copyToClipboard(text, btn) {
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
    }
    fallbackCopy(text, done);
}
export function fallbackCopy(text, done) {
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
export function downloadText(filename, text) {
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
/**
 * ⭐⭐ R5（材料 05）：**改完一格别当场重画** ✓
 *   旧：change（鼠标按下失焦就触发）里**当场** rerender() ✗
 *     ⇒ 把她正按着的那颗按钮连同整个浮层 DOM 销毁重建 ✗
 *     ⇒ mouseup 时 click 凭空蒸发 ✗ ⇒ **第一次点击必然失效** ✗
 *   现在：**状态照旧同步写** ✓，只把**重画推迟 ~260ms** ✓，并**记住浮层位置**、重画完还回去 ✓
 *   ⚠️ 只用在**改字段**这类地方 ✓（⛔ 往别的流程里套 ✗：
 *     “名字跟人设名一样⇒自动认玩家棋子”那条审计就靠**同步重画** ✗）
 */
export function scheduleCardRerender() {
    let keep = null;
    try {
        const old = document.querySelector('.wxg-pc');
        if (old && old.style) {
            keep = { left: old.style.left, top: old.style.top };
        }
    } catch (e0) { keep = null; }
    try {
        setTimeout(() => {
            try {
                rerender();
            if (hooks.getPersonCardId && hooks.getPersonCardId()) { hooks.renderPersonCard(); }
            if (hooks.getOpenWorldEntry && hooks.getOpenWorldEntry()) { hooks.renderWorldEntryCard(); }
            } catch (e1) { /* 重画出错也不能把这一页搞挂 ✓ */ }
            try {
                const now = document.querySelector('.wxg-pc');
                if (now && now.style && keep) {
                    if (keep.left) { now.style.left = keep.left; }
                    if (keep.top) { now.style.top = keep.top; }
                }
            } catch (e2) { /* 位置回不去也不要紧 ✓ */ }
        }, 260);
    } catch (e3) { /* 定时器都起不来就只剩状态写入 ✓ */ }
}
