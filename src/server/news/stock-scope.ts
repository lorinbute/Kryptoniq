// The stock news a user keeps (FD-INDEXNEWS §2): with indices picked, a stock news stays when it names no company, names
// a member of a picked index, names a picked index, or names a stock of the user's favourites. Other categories stay.
import type { Db } from '../db/database.ts';
import { BIN } from '../db/schema.ts';
import type { SettingsService } from '../settings.ts';
import { COMPANY_TAG, FILTER_INDICES, memberTag, type FilterIndexId } from '../../shared/stock-indices.ts';

export interface StockScope {
  indices: FilterIndexId[];
  /** The tags that keep a stock news naming a company: the members' tags, the indices, the favourite stocks. */
  allowed: string[];
}

/** The user's filter, or null for all stock news. */
export async function stockScopeFor(db: Db, settings: SettingsService, userId: number): Promise<StockScope | null> {
  const s = (await settings.forUser(userId)).stockNews;
  if (s.mode !== 'indices' || s.indices.length === 0) return null;
  const favorites = (await db.all<{ coin: string }>("SELECT coin FROM watchlist WHERE user_id = ? AND kind = N'stock'", [userId])).map((r) => r.coin);
  const indexIds = s.indices.map((id) => FILTER_INDICES.find((f) => f.id === id)?.indexId).filter((x): x is string => !!x);
  return { indices: s.indices, allowed: [...new Set([...s.indices.map(memberTag), ...indexIds, ...favorites])] };
}

/** The WHERE condition (on `news n`) and its one parameter. */
export function stockScopeSql(scope: StockScope): { sql: string; param: string } {
  return {
    sql: `(n.category <> N'stocks'
      OR NOT EXISTS (SELECT 1 FROM news_coins c WHERE c.news_id = n.id AND c.coin = N'${COMPANY_TAG}')
      OR EXISTS (SELECT 1 FROM news_coins c WHERE c.news_id = n.id AND c.coin IN (SELECT value COLLATE ${BIN} FROM OPENJSON(?))))`,
    param: JSON.stringify(scope.allowed),
  };
}

/** The users whose news and score are limited to indices (their own score is kept, like an own AI's). */
export async function usersWithStockScope(db: Db): Promise<number[]> {
  const rows = await db.all<{ user_id: number }>("SELECT user_id FROM user_settings WHERE ISJSON(value) = 1 AND JSON_VALUE(value, '$.stockNews.mode') = N'indices'");
  return rows.map((r) => r.user_id);
}
