/**
 * @file tools/crawler/src/engine/prune.ts
 * Conservative rule-based pruner that identifies low-signal headlines/URLs
 * (weather bulletins, commodity/gold tickers, routine accidents, obituaries,
 * exam notices, corporate PR/AGMs, and corporate/stock-ticker sections)
 * so they can be marked `status = 'skipped'` before full-article scraping.
 */

import type { OutletId } from '@jachaikori/schema';

export type PruneReason =
  | 'print_edition'
  | 'corporate_or_stock_section'
  | 'price_ticker'
  | 'weather_bulletin'
  | 'routine_accident'
  | 'obituary'
  | 'exam_admission'
  | 'corporate_pr'
  | 'lifestyle_sports_entertainment'
  | 'prayer_daily'
  | 'routine_suicide'
  | 'lottery_prizebond'
  | 'animal_bite'
  | 'campus_club_event'
  | 'job_circular';

export interface PruneDecision {
  skip: boolean;
  reason?: PruneReason;
}

/**
 * High-salience political, legal, policy, or protest terms that override
 * headline pruning so major national stories are never skipped accidentally.
 */
const HIGH_SALIENCE_GUARD =
  /(সরকার|প্রধানমন্ত্রী|রাষ্ট্রপতি|উপদেষ্টা|মন্ত্রী|এমপি|সংসদ|নির্বাচন|ইসি|আদালত|হাইকোর্ট|সুপ্রিম কোর্ট|বিচারপতি|দুদক|বাংলাদেশ ব্যাংক|রিজার্ভ|বাজেট|আইন|মামলা|গ্রেপ্তার|বিক্ষোভ|অবরোধ|হরতাল|ধর্মঘট|আন্দোলন|সংঘর্ষ|দুর্নীতি|প্রশ্নফাঁস|সচিবালয়|সচিবালয়|অর্থনীতি|মুদ্রাস্ফীতি|রপ্তানি|আমদানি|government|parliament|election|high court|supreme court|minister|adviser|protest|blockade|strike|clash|corruption|central bank|bangladesh bank|budget|imf|world bank|adb|adb loan)/i;

const PRICE_TICKER_RE =
  /(স্বর্ণের দাম|সোনার দাম|ভরি কত|ভরিতে|রৌপ্যের দাম|রুপার দাম|আজকের বাজারদর|কাঁচাবাজার|সবজির বাজার|মাছের বাজার|ডলারের দাম|টাকার রেট|মুদ্রা বিনিময়|মুদ্রা বিনিময়|খোলাবাজারে ডলার|gold price|silver price|exchange rate today|taka against dollar|bazar rate)/i;

const WEATHER_RE =
  /(আবহাওয়া|আবহাওয়া|তাপমাত্রা|শৈত্যপ্রবাহ|তাপপ্রবাহ|কুয়াশা|কুয়াশা|মেঘলা|বজ্রসহ বৃষ্টি|বৃষ্টিপাত|সতর্ক সংকেত|weather forecast|met office|heatwave|cold wave|heavy rainfall|fog disrupts)/i;

const WEATHER_DISASTER_GUARD = /(ঘূর্ণিঝড়|ঘূর্ণিঝড়|বন্যা|জলোচ্ছ্বাস|ভূমিকম্প|cyclone|flood|earthquake|landslide)/i;

const ACCIDENT_RE =
  /(সড়ক দুর্ঘটনা|সড়ক দুর্ঘটনা|বাসচাপায়|বাসচাপায়|ট্রাকচাপায়|ট্রাকচাপায়|মোটরসাইকেল দুর্ঘটনা|পানিতে ডুবে|বজ্রপাতে|বিদ্যুৎস্পৃষ্টে|ট্রেনে কাটা|road accident|killed in road|killed in crash|drowns in|lightning kills|electrocuted)/i;

const OBITUARY_RE =
  /(ইন্তেকাল|নামাজে জানাজা|জানাজা সম্পন্ন|গভীর শোক|শোক প্রকাশ|চিরনিদ্রায়|চিরনিদ্রায়|passes away|passed away|condolence|obituary|laid to rest)/i;

const EXAM_ADMISSION_RE =
  /(ভর্তি পরীক্ষা|ভর্তি বিজ্ঞপ্তি|ভর্তির আবেদন|পরীক্ষার সময়সূচি|পরীক্ষার সময়সূচি|পরীক্ষার রুটিন|ফলাফল প্রকাশ|বৃত্তির ফল|এসএসসি পরীক্ষা|এইচএসসি পরীক্ষা|বিসিএস পরীক্ষা|অনার্স ভর্তি|admission test|exam routine|exam schedule|ssc result|hsc result|bcs preliminary)/i;

const CORPORATE_PR_RE =
  /(শাখা উদ্বোধন|উপশাখা উদ্বোধন|বার্ষিক সাধারণ সভা|এজিএম|সমঝোতা স্মারক|শীতবস্ত্র বিতরণ|কম্বল বিতরণ|বৃক্ষরোপণ|বৃত্তি প্রদান|নতুন পণ্য|ক্যাম্পেইন|signing ceremony|signs mou|inaugurates branch|sub-branch|annual general meeting|agm held|blankets distributed|launches new|csr initiative)/i;

const LIFESTYLE_SPORTS_RE =
  /(আজকের রাশিফল|রাশিফল|রেসিপি|ত্বকের যত্ন|রূপচর্চা|বিয়ের সাজ|বিয়ের সাজ|ভ্রমণ গাইড|বলিউড|হলিউড|ক্রিকেট|আইপিএল|বিপিএল|ফিফা|চ্যাম্পিয়নস লিগ|চ্যাম্পিয়ন্স লিগ|প্রিমিয়ার লিগ|প্রিমিয়ার লিগ|বিশ্বকাপ|টুর্নামেন্ট|ম্যাচ|গোল|horoscope|skincare|beauty tips|travel guide|bollywood|hollywood|cricket|ipl|bpl|fifa|world cup|premier league|champions league|la liga|t20|test match)/i;

const PRAYER_DAILY_RE =
  /(নামাজের সময়সূচি|নামাজের সময়সূচি|নামাজের সময়|নামাজের সময়|সেহরি|ইফতারের সময়|ইফতারের সময়|জুমার খুতবা|prayer time|sehri|iftar time)/i;

const ROUTINE_SUICIDE_RE =
  /(আত্মহত্যা|ঝুলন্ত মরদেহ|গলায় ফাঁস|গলায় ফাঁস|committing suicide|hangs self|found hanging)/i;

const LOTTERY_PRIZEBOND_RE = /(প্রাইজবন্ড|লটারি|prize bond|lottery draw)/i;

const ANIMAL_BITE_RE = /(সাপের কামড়|সাপের কামড়|কুকুরের কামড়|কুকুরের কামড়|snakebite|dog bite)/i;

const CAMPUS_CLUB_EVENT_RE =
  /(নবীনবরণ|বার্ষিক ক্রীড়া|বার্ষিক ক্রীড়া|পিঠা উৎসব|ইফতার মাহফিল|আলোচনা সভা|দোয়া মাহফিল|দোয়া মাহফিল)/i;

const JOB_CIRCULAR_RE = /(নিয়োগ বিজ্ঞপ্তি|নিয়োগ বিজ্ঞপ্তি|চাকরির খবর|job circular)/i;

function isPrintEditionUrl(url: string): boolean {
  return (
    url.includes('/print-edition/') ||
    url.includes('/first-page/') ||
    url.includes('/last-page/') ||
    url.includes('/chayer-desh/') ||
    /\/tp-[a-z0-9-]+\//.test(url)
  );
}

/**
 * Evaluates whether a discovered article should be skipped before scraping
 * based on its URL section and headline.
 */
export function evaluateHeadlineForPrune(input: {
  outlet: OutletId | string;
  canonicalUrl: string;
  title: string;
}): PruneDecision {
  const url = input.canonicalUrl.toLowerCase();
  const title = input.title.trim();

  // 1. Print editions & dedicated corporate-PR / stock-ticker URL sections
  if (isPrintEditionUrl(url)) {
    return { skip: true, reason: 'print_edition' };
  }

  if (
    (input.outlet === 'kaler-kantho' && url.includes('/online/corporatecorner/')) ||
    (input.outlet === 'business-standard' &&
      (url.includes('/economy/corporates/') || url.includes('/economy/stocks/')))
  ) {
    return { skip: true, reason: 'corporate_or_stock_section' };
  }

  if (!title) {
    return { skip: false };
  }

  // Keep high-salience national, political, legal, or protest headlines
  if (HIGH_SALIENCE_GUARD.test(title)) {
    return { skip: false };
  }

  if (PRICE_TICKER_RE.test(title)) {
    return { skip: true, reason: 'price_ticker' };
  }

  if (WEATHER_RE.test(title) && !WEATHER_DISASTER_GUARD.test(title)) {
    return { skip: true, reason: 'weather_bulletin' };
  }

  if (ACCIDENT_RE.test(title)) {
    return { skip: true, reason: 'routine_accident' };
  }

  if (OBITUARY_RE.test(title)) {
    return { skip: true, reason: 'obituary' };
  }

  if (EXAM_ADMISSION_RE.test(title)) {
    return { skip: true, reason: 'exam_admission' };
  }

  if (CORPORATE_PR_RE.test(title)) {
    return { skip: true, reason: 'corporate_pr' };
  }

  if (LIFESTYLE_SPORTS_RE.test(title)) {
    return { skip: true, reason: 'lifestyle_sports_entertainment' };
  }

  if (PRAYER_DAILY_RE.test(title)) {
    return { skip: true, reason: 'prayer_daily' };
  }

  if (ROUTINE_SUICIDE_RE.test(title)) {
    return { skip: true, reason: 'routine_suicide' };
  }

  if (LOTTERY_PRIZEBOND_RE.test(title)) {
    return { skip: true, reason: 'lottery_prizebond' };
  }

  if (ANIMAL_BITE_RE.test(title)) {
    return { skip: true, reason: 'animal_bite' };
  }

  if (CAMPUS_CLUB_EVENT_RE.test(title)) {
    return { skip: true, reason: 'campus_club_event' };
  }

  if (JOB_CIRCULAR_RE.test(title)) {
    return { skip: true, reason: 'job_circular' };
  }

  return { skip: false };
}
