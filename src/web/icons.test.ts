import { describe, expect, it } from 'vitest';
import { coinHue, eventKind, newsTopic } from './icons.ts';

// Headlines taken from the news collected by Kryptoniq on 12 Oct 2026.
describe('newsTopic', () => {
  const t = (title: string, category = 'macro', coins: string[] = [], summary = '') => newsTopic(title, summary, category, coins);

  it('recognises the main macro topics', () => {
    expect(t("Higher rates could be needed to avoid 'inflationary mindset' taking hold, says Fed's Hammack")).toBe('central-bank');
    expect(t('India Inflation Hits Two-Year High, Backs RBI Tightening')).toBe('central-bank');
    expect(t('Core CPI comes in hotter than expected')).toBe('inflation');
    expect(t('Iran war costing average U.S. household $2K, economist estimates', 'geopolitics')).toBe('war');
    expect(t("Oil prices rise on Saudi Arabia attacks, overshadowing Trump's diesel deal")).toBe('energy');
    expect(t('Copper stalls at $6.80 resistance after Fibonacci bounce: Live')).toBe('gold');
    expect(t('AZZ declares $0.24 dividend')).toBe('earnings');
    expect(t('StoneX raises Securitize price target 50% as tokenized stock platform opens new revenue stream')).toBe('earnings');
    expect(t('Meta releases Muse Wonder AI models to challenge Anthropic and OpenAI')).toBe('ai');
    expect(t('US Should Not Do Diesel Deal With Russia, Says Republican Mike Lawler')).toBe('energy');
    expect(t('Justice Department investigates TV networks as White House press-access fight escalates', 'geopolitics')).toBe('regulation');
    expect(t('Dollar holds 18-month high as Gulf tension, US inflation keep investors cautious')).toBe('inflation');
  });

  it('crypto: specific topics beat the coin, the coin beats broad topics', () => {
    expect(t('Standard Chartered brings Ripple’s RLUSD into banking custody', 'crypto', ['XRP'])).toBe('stablecoin');
    expect(t('Bitcoin ETF inflows hit a monthly high', 'crypto', ['BTC'])).toBe('etf');
    expect(t('Exchange drained of $40M in hot wallet exploit', 'crypto', ['ETH'])).toBe('hack');
    expect(t('SEC delays decision on Solana fund', 'crypto', ['SOL'])).toBe('regulation');
    expect(t('Bitcoin Faces Aggressive Shorting as Dollar Index Surges', 'crypto', ['BTC'])).toBe('coin');
    expect(t('Solana Treasury Firm DeFi Development Keeps Buying SOL', 'crypto', ['SOL'])).toBe('coin');
    expect(t('Strategy Scoops Up $21.5M in Bitcoin, Buys Back $192M in STRC', 'crypto', ['BTC'])).toBe('coin');
  });

  it('falls back to the category, and does not mistake a crime for a war', () => {
    expect(t('Pupil arrested after two teachers shot at French school', 'geopolitics')).toBe('geopolitics');
    expect(t('Bumble jumps on report it’s in talks to go private', 'macro')).toBe('macro');
    expect(t('New memecoin season starts', 'crypto')).toBe('crypto');
    expect(t('Something else', 'unknown')).toBe('macro');
  });

  it('reads the summary too', () => {
    expect(t('Markets wait for Wednesday', 'macro', [], 'Traders focus on the consumer price index release.')).toBe('inflation');
  });
});

describe('eventKind', () => {
  const k = (title: string, impact = 'High', source = 'ff') => eventKind(title, impact, source);
  it('maps ForexFactory titles to a kind', () => {
    expect(k('Core CPI m/m')).toBe('inflation');
    expect(k('PPI m/m')).toBe('inflation');
    expect(k('Unemployment Claims')).toBe('jobs');
    expect(k('Average Hourly Earnings m/m')).toBe('jobs');
    expect(k('Non-Farm Employment Change')).toBe('jobs');
    expect(k('GDP m/m')).toBe('growth');
    expect(k('Core Retail Sales m/m')).toBe('retail');
    expect(k('Philly Fed Manufacturing Index')).toBe('manufacturing');
    expect(k('ISM Services PMI')).toBe('manufacturing');
    expect(k('BOE Gov Bailey Speaks')).toBe('central-bank');
    expect(k('Fed Chairman Warsh Speaks')).toBe('central-bank');
    expect(k('FOMC Statement')).toBe('central-bank');
    expect(k('Building Permits')).toBe('housing');
    expect(k('CB Consumer Confidence')).toBe('sentiment');
    expect(k('Trade Balance')).toBe('trade');
    expect(k('Crude Oil Inventories')).toBe('energy');
    expect(k('Something new')).toBe('other');
  });
  it('holidays and personal events win over the title', () => {
    expect(k('Bank Holiday', 'Holiday')).toBe('holiday');
    expect(k('Columbus Day', 'Holiday')).toBe('holiday');
    expect(k('CPI watch party', 'Medium', 'custom')).toBe('custom');
  });
});

describe('coinHue', () => {
  it('is stable, case-insensitive and in range', () => {
    expect(coinHue('INJ')).toBe(coinHue('inj'));
    expect(coinHue('INJ')).not.toBe(coinHue('2Z'));
    for (const s of ['BTC', 'INJ', '2Z', 'A']) {
      expect(coinHue(s)).toBeGreaterThanOrEqual(0);
      expect(coinHue(s)).toBeLessThan(360);
    }
  });
});
