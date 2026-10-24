/**
 * 万象阁 · 魔法棒入口（🪄 输入框旁那个菜单里的一项）
 *
 * 公共形态（对齐生态）：
 *   · 容器 `#extensionsMenu`（另兼容 `#sp_wand_container`）；
 *   · 条目＝名字 + 小图标（图标带 `extensionsMenuExtensionButton` 类）；
 *   · 容器可能晚一步才出现 ⇒ 用 MutationObserver 等着，并有超时兜底；
 *   · 点击＝打开万象阁自己的面板。
 */

import { openPanel, closePanel, isPanelOpen } from './shell.js';
import { openWorkspace, closeWorkspace, isWorkspaceOpen } from './workspace.js';
import { getSettings } from '../core/settings.js';
import { toast } from './toast.js';

const ENTRY_ID = 'wxg-wand-entry';
const CONTAINERS = ['extensionsMenu', 'sp_wand_container'];

let observer = null;
let timeoutId = null;

/** 找一个能挂的容器 */
function findContainer() {
    for (const id of CONTAINERS) {
        const el = document.getElementById(id);
        if (el) {
            return el;
        }
    }
    return null;
}

/** 把入口挂进去（已经挂过就不重复挂） */
export function mountWandEntry() {
    if (document.getElementById(ENTRY_ID)) {
        return true;
    }
    const menu = findContainer();
    if (!menu) {
        return false;
    }

    const item = document.createElement('div');
    item.id = ENTRY_ID;
    item.className = 'list-group-item flex-container flexGap5 interactable';
    item.tabIndex = 0;
    item.title = '万象阁 · 世界后台';

    const icon = document.createElement('div');
    icon.className = 'fa-fw fa-solid fa-book-atlas extensionsMenuExtensionButton';
    item.appendChild(icon);

    const label = document.createElement('span');
    label.textContent = '万象阁';
    item.appendChild(label);

    item.addEventListener('click', () => {
        // ⭐ 点入口：按布局模式决定开哪个——
        //    workspace＝自己的整页工作台（默认）；panel＝老的浮层窗口。
        if (getSettings().layoutMode === 'panel') {
            if (isPanelOpen()) {
                closePanel();
            } else {
                openPanel();
            }
            return;
        }
        if (isWorkspaceOpen()) {
            closeWorkspace();
        } else {
            openWorkspace();
        }
    });

    /*
     * 依据＝阿砚 B2-5：魔法棒菜单一堆插件里她找不到万象阁。
     *   旧：appendChild ⇒ 排在所有插件之后（实测第 13 项）✗
     *   新：**插在最前面**（第一眼就能找到）；容器还空就照旧 append。
     */
    if (menu.firstChild) {
        menu.insertBefore(item, menu.firstChild);
    } else {
        menu.appendChild(item);
    }
    return true;
}

/**
 * 挂入口，并处理"容器晚出现"的情况。
 * @param {number} waitMs 最多等多久（毫秒）
 */
export function ensureWandEntry(waitMs) {
    if (mountWandEntry()) {
        return;
    }
    const limit = Number.isFinite(waitMs) ? waitMs : 30000;

    // ① 突变观察：容器一出现就挂
    if (!observer && typeof MutationObserver === 'function') {
        observer = new MutationObserver(() => {
            if (mountWandEntry()) {
                stopWaiting();
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }

    // ② 兜底轮询（有些环境不会触发到我们关心的突变）
    if (!timeoutId) {
        const started = Date.now();
        const tick = () => {
            if (mountWandEntry()) {
                stopWaiting();
                return;
            }
            if (Date.now() - started > limit) {
                stopWaiting();
                console.warn('[万象阁] 没找到魔法棒菜单容器（#extensionsMenu），入口没挂上；面板仍可从扩展设置区打开。');
                return;
            }
            timeoutId = setTimeout(tick, 700);
        };
        timeoutId = setTimeout(tick, 700);
    }
}

function stopWaiting() {
    if (observer) {
        observer.disconnect();
        observer = null;
    }
    if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
    }
}

/** 面板开了就标一下（给入口做高亮用） */
export function syncEntryState() {
    const item = document.getElementById(ENTRY_ID);
    if (!item) {
        return;
    }
    // 工作台开着也算"开着"（入口高亮）
    item.classList.toggle('active', isPanelOpen() || isWorkspaceOpen());
}

/** 顺手一条小提示（装上时告诉她入口在哪） */
export function announceEntry() {
    toast.info('已就位：点输入框旁的魔法棒 🪄，菜单里有「万象阁」', '万象阁');
}
