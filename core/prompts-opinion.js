/**
 * 万象阁 · 舆情层（101 号 · 第 7 份提示词 `OPINION_SYSTEM`）
 *
 * 她 2026-10-27 23:30：「世界局势和那个舆情…我们做世界局势的提示词也把这个加进来了，是吧？」
 *   ⇒ 没有。这是第 7 份，⛔ 不许塞进 SITUATION_SYSTEM。
 *
 * 身份照世界背面 `public-opinion.js:534`：**只读观察器** —— 只生成新闻与论坛快照，
 * 不改世界状态、人物认知、事件、记忆、时间或正文。
 * 单向：世界（事）→ 局势（传出去没）→ 舆情（外面怎么说）；舆情⛔ 绝不回流。
 */
export const OPINION_SYSTEM = [
    '你是「万象阁」的世界舆情观察器。你只生成只读的新闻与论坛快照，不修改世界状态、',
    '人物认知、事件、记忆、时间或正文。你不写故事，不推进剧情，不替任何人做决定。',
    '',
    '【一、你的输入只有一份清单】',
    '你只能依据下方的 public_event_candidates。不得使用任何未提供的幕后事实，',
    '不得把私人行动、角色秘密、幕后原因写成公开消息。',
    '',
    '【二、公开度决定你能说什么】',
    '· publicity=public 的候选 → 才可以生成「新闻」。只能使用 public_headline／public_summary／',
    '  public_hint／place 中已经公开的信息。事件的内部 title／summary／result／cause 可能含幕后细节，⛔ 禁止直接复制。',
    '· publicity=trace 的候选 → 只是外界能察觉的一点表面迹象，只允许生成「非官方论坛讨论」，',
    '  ⛔ 不许生成新闻，⛔ 不许使用该事件的真实标题、正文、结果、隐情。',
    '· ⛔ visibility（进不进正文）⛔ 不是 publicity（社会知不知道）。两者不许混。',
    '',
    '【三、到点检查，不是每次都必须产出】',
    '你是在「到点后检查」，不是每次都要出东西。即使候选非空，如果这段世界时间里没有自然形成',
    '新的报道或讨论变化，可以返回空的 news 与 forums。⛔ 不许为了交差硬凑。',
    '⛔ 不许虚构新的正史事件；⛔ 不许为了迎合 user_world_focus 编一条没有事实支撑的新闻。',
    '',
    '【四、新闻与论坛是两种载体，不是两种可信度】',
    '新闻偏事实传播：只报道有公共传播价值的内容；无法确认的原因不要下结论。',
    '论坛偏人间议论：可以有猜测、可以有情绪，但 claim_status 必须标清是',
    '  fact（基于公开事实）／mixed（事实与猜测混合）／rumor（传闻未证实）。',
    'source_type 才表示消息来源层级：official＝官方/机构/权威渠道；unofficial＝目击、匿名爆料、',
    '民间媒体、论坛、小道消息。官方消息也可能措辞保守、选择性发布。',
    '',
    '【五、时间各算各的】',
    '新闻与论坛有各自独立的经过时间（elapsed_news_world_minutes／elapsed_forum_world_minutes）。',
    '分别按对应经过时间判断扩散、降温、分化、反转或后续报道。',
    '⛔ 不要拿新闻的时间去推论坛的热度，反之亦然。',
    '',
    '【六、延续与新建】',
    '延续 previous_snapshot 中同一主题时，必须保留该帖／该报道的 id，可更新正文并补充回复。',
    '不同话题是新帖，⛔ 不得复用旧 id。⛔ 不要重复输出已有的回复。',
    '',
    '【七、每条都要交代的三样】',
    '· audience_tags：只写「哪些类型的人可能更关注这条」。它只是受众标签，⛔ 不代表任何具体 NPC 已经看到或相信。',
    '· scope：一句话概括传播范围（本地居民圈／行业内部／全城公开／小范围匿名流传）。',
    '· related_event_id：必须来自 public_event_candidates 中已有的 id。⛔ 不得虚构新事件 ID。',
    '',
    '【八、容量】',
    '最多 3 条新闻、4 个论坛主题；每个论坛主题最多 4 条代表回复。两个数组都允许为空。',
    '',
    '【九、输出】只输出 JSON，不要 Markdown，不要代码块，不要解释。',
    '{"news":[{"id":"","category":"","headline":"","summary":"","source":"",',
    '  "source_type":"official|unofficial","audience_tags":[],"scope":"",',
    '  "related_event_id":"","confidence":"high|medium","heat":1}],',
    ' "forums":[{"id":"","board":"","title":"","summary":"","source_type":"official|unofficial",',
    '  "audience_tags":[],"scope":"","related_event_id":"","claim_status":"fact|mixed|rumor",',
    '  "heat":1,"replies":[{"author":"","text":""}]}]}',
].join('\n');

const TRACE_TITLE = '未证实的公开迹象';

function t(v) {
    return String(v == null ? '' : v).trim();
}

/**
 * 入口闸（闸 1／2）：只挑 publicity ∈ {trace, public}，最多 24 条，按 updatedAt 倒序；
 * trace 的 title 覆写成「未证实的公开迹象」、summary／result 清空，只留 publicHint(≤360)＋place。
 */
export function publicCandidates(situations, cap) {
    const limit = Math.max(0, Math.floor(Number(cap) || 24));
    const rows = (Array.isArray(situations) ? situations : [])
        .filter((s) => s && ['trace', 'public'].includes(t(s.publicity)))
        .sort((a, b) => (Number(b.updatedAt || b.at) || 0) - (Number(a.updatedAt || a.at) || 0))
        .slice(0, limit)
        .map((s) => {
            const pub = t(s.publicity);
            if (pub === 'trace') {
                return {
                    id: t(s.id),
                    publicity: 'trace',
                    title: TRACE_TITLE,
                    summary: '',
                    result: '',
                    publicHint: t(s.publicTrace || s.publicHint || s.public_trace).slice(0, 360),
                    place: t(s.place),
                };
            }
            return {
                id: t(s.id),
                publicity: 'public',
                title: t(s.publicHeadline || s.public_headline || s.title),
                summary: t(s.publicSummary || s.public_summary || s.summary),
                result: '',
                publicHint: t(s.publicTrace || s.publicHint).slice(0, 360),
                place: t(s.place),
            };
        });
    return rows;
}

/**
 * 输出闸（闸 3–6）：trace 出新闻 ⇒ 整批 news 丢；related_event_id 不在候选 ⇒ 逐条丢；
 * 容量 3／4／4；新话题复用旧 id ⇒ 丢。
 * @param {object} snapshot 模型输出 {news, forums}
 * @param {Array} candidates publicCandidates 的结果
 * @param {{previous?: Array}} opts previous 里的 id 才允许续帖
 */
export function gateOpinion(snapshot, candidates, opts) {
    const v = snapshot && typeof snapshot === 'object' ? snapshot : {};
    const cand = Array.isArray(candidates) ? candidates : [];
    const byId = new Map(cand.map((c) => [c.id, c]));
    const prevIds = new Set((Array.isArray(opts && opts.previous) ? opts.previous : []).map((p) => t(p && p.id)));
    const dropped = [];
    const newsIn = Array.isArray(v.news) ? v.news : [];
    const forumIn = Array.isArray(v.forums) ? v.forums : [];
    /* 闸 3：任一条 news 指向 trace ⇒ 整批 news 丢 */
    const traceIds = new Set(cand.filter((c) => c.publicity === 'trace').map((c) => c.id));
    const badNews = newsIn.some((n) => traceIds.has(t(n && n.related_event_id)));
    let news = [];
    if (badNews) {
        dropped.push('有 news 指向 publicity=trace 的事件 ⇒ 整批 news 丢弃');
    } else {
        for (const n of newsIn) {
            const id = t(n && n.related_event_id);
            if (!byId.has(id)) {
                dropped.push('news 的 related_event_id 不在候选：' + id);
                continue;
            }
            news.push(n);
        }
    }
    const forums = [];
    for (const f of forumIn) {
        const id = t(f && f.related_event_id);
        if (!byId.has(id)) {
            dropped.push('forums 的 related_event_id 不在候选：' + id);
            continue;
        }
        const fid = t(f && f.id);
        if (fid && !prevIds.has(fid)) {
            dropped.push('新话题复用了不存在的旧 id：' + fid);
            continue;
        }
        forums.push(f);
    }
    /* 闸 5：容量 */
    const outNews = news.slice(0, 3).map((n) => Object.assign({}, n, {
        related_event_id: t(n.related_event_id),
        heat: Math.max(0, Math.min(5, Number(n.heat) || 1)),
    }));
    const outForums = forums.slice(0, 4).map((f) => Object.assign({}, f, {
        replies: (Array.isArray(f.replies) ? f.replies : []).slice(0, 4),
        heat: Math.max(0, Math.min(5, Number(f.heat) || 1)),
    }));
    return { ok: true, news: outNews, forums: outForums, dropped, empty: !outNews.length && !outForums.length };
}
