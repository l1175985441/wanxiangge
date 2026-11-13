/* API-1/2/3：通道、书签、请求参数事件。从 sections.js 抽出（206 后） */
import { getSettings, patchSettings } from '../../core/settings.js';
import { apiKeyShown, setApiKeyShown, setLastModelList, stagingOf, stagingMode, stagedCount } from './shared.js';
import { syncApiFromDom } from './api-sync.js';
import { patchApi, textOf } from './render.js';
import { takeSnapshot } from '../../core/state.js';
import { trimText } from '../../core/utils.js';
import { toast } from '../toast.js';


export const API_ACTION_SET = new Set(['set-api-mode', 'set-api-url', 'set-api-key', 'set-api-model', 'set-api-model-cheap', 'set-api-temp', 'set-api-maxtok', 'toggle-api-key', 'fetch-models', 'pick-model', 'test-api', 'save-profile', 'overwrite-profile', 'apply-profile', 'del-profile']);


export async function handleApiAction(action, target, id, host, isChange, rerender) {
    switch (action) {
                case 'set-api-mode': if (isChange) { patchApi({ mode: target.value }); rerender(); } break;
                case 'set-api-url': if (isChange) { patchApi({ url: target.value }); toast.ok('接口地址已保存'); } break;
                case 'set-api-key': if (isChange) { patchApi({ key: target.value }); toast.ok('密钥已保存'); } break;
                case 'set-api-model': if (isChange) { patchApi({ model: target.value }); toast.ok('模型名已保存'); } break;
                case 'set-api-model-cheap': if (isChange) { patchApi({ modelCheap: target.value }); } break;
                case 'set-api-temp': if (isChange) { patchApi({ temperature: target.value }); } break;
                case 'set-api-maxtok': if (isChange) { patchApi({ maxTokens: target.value }); } break;
                case 'toggle-api-key': {
                    /*
                     * ⭐ 她 13:xx：「密钥那里不能自动隐藏」⇒ 默认遮住，点一下才显形（⛔ 不改她的值）
                     */
                    setApiKeyShown(!apiKeyShown);
                    const kEl = document.getElementById('wxg-api-key');
                    if (kEl) {
                        kEl.type = apiKeyShown ? 'text' : 'password';
                    }
                    const eyeBtn = document.querySelector('[data-action="toggle-api-key"]');
                    if (eyeBtn) {
                        eyeBtn.textContent = apiKeyShown ? '隐藏' : '显示';
                    }
                    toast.info(apiKeyShown ? '钥匙已显形（看完记得点回「隐藏」）' : '钥匙已遮住');
                    /* ⛐ 这里不 rerender：重绘会把输入框重建（当时的 type 被冲掉 ✗）——标志已记住，下次重绘会自带正确 type ✓ */
                    break;
                }
                case 'fetch-models': {
                    syncApiFromDom(host);
                    /*
                     * ⭐ 她 13:xx 原话：「填完了API得保存一下，然后拉取模型得保存一下……反正啥都要保存一下。这就是别扭问题了。」
                     *   ⇒ 这几个动作**直接用你面板里现在填的值**（先把 api 那节草稿提交，等同自动按一次保存）✓
                     *   ⛔ 两段式架构不动：只是替她多点一次"保存"，值仍走同一套校验与落盘 ✓
                     */
                    commitSection('api');
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
                    /* ⭐ RD1-3：先存下来 ✓（重绘时 paintModelChips 靠它 ✓） */
                    setLastModelList(res.list.slice(0, 80));
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
                        const which = stageOne('stage-api-model', inp);
                    /*
                     * ⭐ 她 13:xx：「按了模型得保存一下」⇒ 选完模型**当场落盘**（不用她再按保存）✓
                     */
                    commitSection('api');
                        if (which) {
                            refreshSaveBar(host, which);
                        }
                        toast.ok('已填上：' + name + '（改动已随手存好 ✓）');
                    }
                    break;
                }
                case 'test-api': {
                    syncApiFromDom(host);
                    /* ⭐ 同上：测连接**不用先保存**，直接用你现在填的地址／密钥／模型 ✓ */
                    commitSection('api');
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
                    syncApiFromDom(host);
                    const nick = trimText(textOf(host, 'wxg-profile-nick'));
                    if (!nick) {
                        toast.fail('先给书签起个名字（例：主站／备用站）');
                        break;
                    }
                    const live = getSettings().api || {};
                    const draft = stagingOf(stagingMode).api || {};
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
                        /* ⭐ ST5（材料 11）：**书签也要存这两个通道参数** ✓
                         *   （materialCap＝每轮喂多少字／autoRetryMax＝自己再试几次）
                         *   它们本来就是“针对不同中转站体质调优”的 ✓ ⇒ 切书签时必须跟着切 ✓ */
                        materialCap: Number(cur.materialCap),
                        autoRetryMax: Number(cur.autoRetryMax),
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
                    patchSettings({ api: Object.assign({}, getSettings().api || {}, { profiles: list }) });
                    const pendingN = stagedCount('api');
                    toast.ok((idx >= 0 ? '已覆盖书签「' : '已存成书签「') + nick + '」（存的这一套'
                        + (pendingN ? '；上方还有 ' + String(pendingN) + ' 处没保存的改动' : '')
                        + /* ⚠️ 材料 01 说“另存后应该自动切过去” ✗，但下面那段注释是**当初为她定的**：
                     *   存书签只存书签、⛔ 不惄惄改掉“当前用的通道”（她可能只是想存起来）✓
                     *   ⇒ 不擅改行为 ✓，只把提示说成实话 ✓ */
                        + '，想现在就用它请点上面那颗「切到这套」）');
                    rerender();
                    /*
                     * ⭐⭐ 她 13:xx 原话：「存完书签以后，API 那个经酒馆那个地方**没有出来这个书签**」
                     *   真机查证：书签**确实存了、也确实显示**（proxy 模式下也显示 ✓），
                     *   但书签那一栏**贴在页面最底边**（真机读数 y≈894／视口 950），而面板滚动还在顶部
                     *   ⇒ **她根本看不见** ✗ ⇒ 不是"没出来"，是"没让她看见" ✓
                     *   修：存完把**书签那一栏滚进视野**（居中最稳），并把名字写在提示里 ✓
                     */
                    setTimeout(() => {
                        try {
                            const listBox = document.querySelector('.wxg-prof-list') || document.querySelector('.wanxiangge .wxg-prof');
                            if (listBox && typeof listBox.scrollIntoView === 'function') {
                                listBox.scrollIntoView({ block: 'center', behavior: 'smooth' });
                            }
                        } catch (e) { /* ⛔ 滚不动也不能让保存这一步崩掉 */ }
                    }, 150);
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
                    /* ⭐ ST5：旧书签里没这两个字段 ⇒ **沿用当前值** ✓（⛔ 写成 undefined ✗） */
                    materialCap: Number.isFinite(Number(one.materialCap)) ? Number(one.materialCap) : cur.materialCap,
                    autoRetryMax: Number.isFinite(Number(one.autoRetryMax)) ? Number(one.autoRetryMax) : cur.autoRetryMax,
                            /* ⭐修复 15（材料 02）：**切到这套时同步写入 currentProfile** ✓
                             *   （旧：只切了字段、currentProfile 没跟上 ✗ ⇒ 面板显示的“当前在用”不对 ✗） */
                            currentProfile: nick,
                        }),
                    });
                    toast.ok('已切到书签「' + nick + '」');
                    rerender();
                    break;
                }
                case 'del-profile': {
                    /* ⭐材料 06第一波：**二次确认 ＋ 快照** ✓
                     *   旧：点一下当场物理删除 ✗ 不弹确认 ✗ 不留快照 ✗
                     *        （点「撤回上一次」都撤不回来 ✗ —— 她的账不能这么掉 ✗）
                     *   新：先问一句 ✓ 再留一份快照 ✓ （沿用代码里既有的 window.confirm 写法 ✓ ⛔ 不引入新弹窗 ✗） */
                    if (typeof window !== 'undefined' && typeof window.confirm === 'function' && !window.confirm('要把这个 API 书签删掉吗？\n\n（会先留一份快照，点「撤回上一次」能撤回来）')) { break; }
                    takeSnapshot('删除前（这个 API 书签）');
                    const nick = id;
                    const cur = getSettings().api || {};
                    const list = (Array.isArray(cur.profiles) ? cur.profiles : [])
                        .filter((p) => trimText(p && p.nick) !== nick);
                    /* ⭐材料 06：删掉的若**正是当前在用的那套** ⇒ 顺手清掉 currentProfile ✓
                     *   （旧：不清 ✗ ⇒ 面板还以为在用它 ✗） */
                    const nowCur = trimText(cur.currentProfile) === nick ? '' : cur.currentProfile;
                    patchSettings({ api: Object.assign({}, cur, { profiles: list, currentProfile: nowCur }) });
                    toast.ok('删掉书签「' + nick + '」了');
                    rerender();
                    break;
                }
    }
}

