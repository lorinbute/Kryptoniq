import { describe, expect, it } from 'vitest';
import { macroVerdict } from './macro.ts';

// `companies`: how many companies the title names (the detector's job; given here).
const is = (title: string, companies = 0, summary = '') => macroVerdict(title, summary, companies).macro;

describe('macro news by the user\'s rules (FD-MACRORULES)', () => {
  it('takes economy-wide data, policy and structural trends', () => {
    for (const t of [
      'Fed holds rates steady, signals two cuts this year',
      'Powell says the labor market is cooling',
      'ECB cuts interest rates for the third time',
      'Bank of Japan ends negative rates',
      'Treasury yields climb after strong jobs data',
      '10-year yield hits 4.8% as the yield curve steepens',
      'US CPI rises 0.4% in September, hotter than expected',
      'PCE inflation cools to 2.6%',
      'Producer prices fall unexpectedly',
      'Oil jumps as OPEC+ cuts output',
      'Natural gas prices surge on cold snap',
      'Wheat and corn rally on drought fears',
      'China\'s economy grows 4.8% in the third quarter',
      'Eurozone PMI slips into contraction',
      'US retail sales beat forecasts',
      'Consumer confidence falls to a two-year low',
      'Nonfarm payrolls rise by 254,000; unemployment rate at 4.1%',
      'Jobless claims jump to the highest since August',
      'Wage growth slows as the labour market loosens',
      'Congress passes stopgap spending bill to avert government shutdown',
      'Moody\'s cuts US sovereign credit rating',
      'Weak demand at the 10-year treasury auction',
      'US trade deficit narrows as imports fall',
      'Trump announces 25% tariffs on EU cars',
      'Dollar slides as traders bet on a Fed cut',
      'Yen weakens past 150 per dollar',
      'Gold hits a record as investors seek safe havens',
      'Red Sea attacks push shipping rates higher',
      'AI data center boom drives record corporate bond issuance',
      'China property slump deepens',
      'Mortgage rates fall to the lowest in a year',
      // From the real news of the macro sources (FD-MACRORULES dry run, 21 Oct 2026).
      'USDCAD Technicals: The USDCAD pair pushes higher off of 100 day MA support',
      'FX option expiries for 21 October 10am New York cut',
      'Merz Says EU Isn\'t Looking for a Trade \'Conflict\' With China',
      'South Africa Set to Tighten Budget Rules as Pressures From Iran War Mount',
      'Highlights of South Africa Finance Minister\'s 2026 Budget Update',
      'South Africa to Cut Fuel Levy for Two Months From November',
      'Middle East oil exports climb back to prewar levels',
      'France\'s Macron Secures Qatar LNG Supplies for Winter Period',
      'French 10-year bond yield hits 5% for first time since 2002 amid unrest',
      'Who\'s paying for the AI build-out? Probably you',
    ]) {
      expect(is(t), t).toBe(true);
    }
  });

  it('leaves out single companies, even when their story touches a theme', () => {
    expect(is('Apple says tariffs will cost $1.1 billion', 1)).toBe(false);
    expect(is('Exxon profit falls as oil prices slide', 1)).toBe(false);
    expect(is('Nvidia hits $5 trillion as AI spending booms', 1)).toBe(false);
    expect(is('Tesla recalls 100,000 vehicles', 1)).toBe(false);
    expect(is('Nvidia earnings beat estimates', 1)).toBe(false);
    expect(is('Oracle sells $18 billion of bonds', 1)).toBe(false);
    expect(is('Meta announces layoffs', 1)).toBe(false);
    // Two companies and one theme (Brent and crude are one): a companies' story.
    expect(is('Chevron, ExxonMobil Stocks Hit 52-Week Highs as Brent Crude Hits 5-Month Highs', 2)).toBe(false);
    // A company the detector does not know still has its story's words.
    expect(is('$100 Invested In Royal Gold 5 Years Ago Would Be Worth This Much Today')).toBe(false);
    // Wages garnished are not wage growth.
    expect(is('Trump Admin Could Garnish Wages, Seize Tax Refunds From Student Loan Borrowers')).toBe(false);
  });

  it('a company named next to the market as a whole, or an institution commenting, does not make it a company story', () => {
    expect(is('European shares slip as ECB holds rates')).toBe(true);
    expect(is('Stocks fall after hot CPI; Nvidia drags', 1)).toBe(true);
    // The institution is left out of the companies by the caller (INSTITUTIONS): its view of the economy is macro.
    expect(is('Goldman sees Fed cutting rates in December', 0)).toBe(true);
  });

  it('a market move alone, or no theme, is not macro', () => {
    expect(is('S&P 500 hits a record high')).toBe(false);
    expect(is('Taylor Swift tour boosts local businesses')).toBe(false);
    expect(is('Bitcoin ETF sees record inflows')).toBe(false);
  });

  it('a theme only in the summary counts with two distinct ones and a title that is not a company\'s', () => {
    expect(is('What to watch this week', 0, 'The Fed meeting and the CPI report headline the calendar.')).toBe(true);
    expect(is('What to watch this week', 0, 'Earnings season continues with the CPI report.')).toBe(false);
    expect(is('Apple earnings preview', 1, 'The Fed meeting and the CPI report also land this week.')).toBe(false);
  });

  it('a billion-dollar deal is not about the dollar; its strength grows with the themes', () => {
    expect(is('A billion-dollar deal for a startup')).toBe(false);
    expect(macroVerdict('Fed cuts rates; dollar falls', '', 0).strength).toBeGreaterThan(macroVerdict('Dollar falls', '', 0).strength);
    expect(macroVerdict('Fed cuts rates', '', 0).areas).toEqual(['monetary']);
    expect(macroVerdict('Nvidia earnings beat', '', 1)).toEqual({ macro: false, strength: 0, areas: [] });
  });
});
