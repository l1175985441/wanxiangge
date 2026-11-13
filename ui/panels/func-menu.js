/* 公-4 片段：⋮ 功能菜单。从 sections.js 抽出（206 后） */
import { el, button, lastSectionsHost } from './shared.js';


let funcMenuEl = null;
export function closeFuncMenu() {
    if (funcMenuEl && funcMenuEl.parentNode) {
        funcMenuEl.parentNode.removeChild(funcMenuEl);
    }
    funcMenuEl = null;
}
export function openFuncMenu(anchorEl, items) {
    const wasOpen = !!(funcMenuEl && funcMenuEl.__owner === anchorEl);
    closeFuncMenu();
    if (wasOpen) {
        return;   // 再点一下收起 ✓
    }
    /*
     * ⭐⭐ 定位：**挂成按钮的兄弟，用 CSS 贴住它** ✓
     *   为什么不用矩形算：真机探针里这些按钮报回的矩形是 **0×0** ✗
     *   （而它们明明画在屏上）⇒ 用矩形算出来的坐标必然是乱的 ✗
     *   现在：放到按钮的父节点里（层级变一级），`top:100%; right:0` ⇒ 永远贴在它下面 ✓
     *   ⛔ 改回 body：那样就吃不到宿主的事件委托（菜单项点不了 ✗）
     */
    const anchorParent = (anchorEl && anchorEl.parentNode) ? anchorEl.parentNode : null;
    /*
     * ⭐ 真机第 4 次抳回：**父节点是 static ⇒ 绝对定位会跑去更远的祖先** ✗
     *   真机量到：按钮在 (1350,153)，菜单却落在 **y=956** ✗
     *   现在：父节点没有定位就给它补一个 `relative` ✓（不改任何偏移量 ✓）
     */
    if (anchorParent && anchorParent.style) {
        const posNow = (typeof window !== 'undefined' && window.getComputedStyle)
            ? window.getComputedStyle(anchorParent).position
            : 'relative';
        if (posNow === 'static' || !posNow) {
            anchorParent.style.position = 'relative';
        }
    }
    const host = anchorParent || lastSectionsHost || document.body;
    const menu = el('div', 'wxg-funcmenu' + (anchorParent ? ' wxg-funcmenu-anchored' : ''));
    menu.__owner = anchorEl;
    for (const it of items) {
        const b = button(it.label, it.action, 'wxg-funcmenu-item', it.id);
        if (it.title) {
            b.title = it.title;
        }
        menu.appendChild(b);
    }
    host.appendChild(menu);
    /*
     * ⭐ 只有“没有父节点”时才用矩形兜底 ✓
     *   有父节点时靠 `wxg-funcmenu-anchored`（absolute + top:100% + right:0）贴住按钮 ✓
     *   ⛔ 两套同时跑：内联 left/top 会把 CSS 那式盖掉 ✗（v0.3.259 真犯过 ✗）
     */
    if (!anchorParent) {
        try {
            const r = anchorEl.getBoundingClientRect();
            menu.style.left = String(Math.max(8, Math.round(r.right - 200))) + 'px';
            menu.style.top = String(Math.round(r.bottom + 6)) + 'px';
        } catch (ePos) { /* 实在拿不到就用 CSS 默认位置 ✓ */ }
    }
    funcMenuEl = menu;
    /* 点别处收起（捕获阶段先跑，但不拦菜单里的点击 ✓） */
    setTimeout(() => {
        const off = (ev) => {
            if (menu && ev && ev.target && menu.contains && menu.contains(ev.target)) {
                return;
            }
            document.removeEventListener('click', off, true);
            closeFuncMenu();
        };
        document.addEventListener('click', off, true);
    }, 0);
}
/**
 * 浮层在**编辑态**吗？默认 false＝**只读**；点右上「⋮」才进编辑。
 * （她的原话：不点是只读改不了免得弄错；目标包：⋮点开＝编辑这一位）
 */

/** 拖标题栏移浮层（做法跟 mini.js 那套一致：⛔ 不引库） */


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
