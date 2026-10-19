// The indices the stock news and score can be limited to (FD-INDEXNEWS §1): their ids, names and ETFs, and the setting.
import { z } from 'zod';

export const FILTER_INDEX_IDS = ['SPX', 'NDX', 'DJI'] as const;
export type FilterIndexId = (typeof FILTER_INDEX_IDS)[number];

export interface FilterIndex {
  id: FilterIndexId;
  /** The index in the favourites and the news tags (FD-INDICES). */
  indexId: string;
  name: string;
  /** The ETFs that follow it, as people know it ("QQQ"). */
  etfs: string[];
}

export const FILTER_INDICES: readonly FilterIndex[] = [
  { id: 'SPX', indexId: '^SPX', name: 'S&P 500', etfs: ['SPY', 'VOO'] },
  { id: 'NDX', indexId: '^NDX', name: 'Nasdaq-100', etfs: ['QQQ'] },
  { id: 'DJI', indexId: '^DJI', name: 'Dow Jones', etfs: ['DIA'] },
];

/** The tag a news gets for naming a company (any) and for naming a member of each index (TD-INDEXNEWS §4). */
export const COMPANY_TAG = '#CO';
export const memberTag = (id: FilterIndexId) => `#${id}`;

/** All stock news, or only those of the companies of the indices picked (plus general ones and the favourites). */
export const stockNewsSchema = z
  .object({
    mode: z.enum(['all', 'indices']).default('all'),
    indices: z
      .array(z.enum(FILTER_INDEX_IDS))
      .max(FILTER_INDEX_IDS.length)
      .refine((l) => new Set(l).size === l.length, 'fiecare indice o singură dată')
      .default([]),
  })
  .strict()
  .refine((v) => v.mode === 'all' || v.indices.length > 0, { message: 'Alege cel puțin un indice.', path: ['indices'] });
export type StockNews = z.infer<typeof stockNewsSchema>;
