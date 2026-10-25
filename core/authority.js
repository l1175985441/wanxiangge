/**
 * 万象阁 · 两份存储的权威口径（阿砚 4-b 最后 10 条 · ⑩）
 *
 * 依据＝4-b 最后 10 条 ⑩（我在留档里判「要做」）：
 *   同一份数据存两处时，**先定谁是权威**，另一份只作镜像；冲突时以权威为准。
 *
 * 我们这边的两处：
 *   · **账本**：`chat_metadata.wanxiangge`（每个人、每件事、每笔编年的真源）；
 *   · **世界书**：`《万象阁 · 世界后台》`（对外投影：她/别的脚本看得到的那一份）。
 * ⇒ 口径写死：**账本是权威，世界书是投影**。
 *   ⛔ 反写：读世界书**只用来认人和补空缺**，不许拿它覆盖账本里已有的值。
 */

export const AUTHORITY = {
    ledger: 'ledger',
    projection: 'projection',
};

/** 哪一类字段归谁：账本权威的 / 只有投影的 */
export function authorityOf(kind) {
    const k = String(kind || '');
    if (k === 'book' || k === 'worldbook' || k === 'entry') {
        return AUTHORITY.projection;
    }
    return AUTHORITY.ledger;
}

/**
 * 冲突时取谁：账本有值就用账本的；账本没有才退回投影，并标明来源。
 * @returns {{value:*, from:'ledger'|'projection'}}
 */
export function preferLedger(ledgerValue, bookValue) {
    const has = !(ledgerValue === undefined || ledgerValue === null || ledgerValue === '');
    if (has) {
        return { value: ledgerValue, from: AUTHORITY.ledger };
    }
    return { value: bookValue, from: AUTHORITY.projection };
}

/** 一行人话（体检/诊断用） */
export function authorityLine() {
    return '权威口径：账本 > 世界书投影（读世界书只用来认人/补空缺，⛔ 覆盖账本已有值）';
}
