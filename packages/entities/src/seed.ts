/**
 * @file packages/entities/src/seed.ts
 * Curated bilingual (Bangla + English) canonical entity registry with temporal role windows
 * for Bangladesh public figures, political parties, institutions, locations, and major topics.
 */

import type { Entity, EntityAlias } from '@jachaikori/schema';
import { normalizeText, normalizeToken } from './normalize';

export interface SeedAliasSpec {
  raw: string;
  validFrom?: string | null;
  validTo?: string | null;
  requireUppercase?: boolean;
}

export interface SeedEntityDefinition {
  entity: Entity;
  aliases: SeedAliasSpec[];
}

export interface ExpandedEntityAlias extends EntityAlias {
  requireUppercase?: boolean;
}

const RAW_SEED: SeedEntityDefinition[] = [
  // ==========================================
  // Public Figures & Political Leaders (+ Temporal Role Bindings)
  // ==========================================
  {
    entity: {
      id: 'ent_tareque_rahman',
      canonicalBn: 'তারেক রহমান',
      canonicalEn: 'Tarique Rahman',
      entityType: 'person',
      metadataJson: JSON.stringify({ party: 'BNP', role: 'Prime Minister (2026–)' }),
    },
    aliases: [
      { raw: 'তারেক রহমান' },
      { raw: 'Tarique Rahman' },
      { raw: 'Tareque Rahman' },
      { raw: 'প্রধানমন্ত্রী তারেক রহমান', validFrom: '2026-02-17' },
      { raw: 'প্রধানমন্ত্রী', validFrom: '2026-02-17', validTo: null },
      { raw: 'Prime Minister', validFrom: '2026-02-17', validTo: null },
      { raw: 'PM', validFrom: '2026-02-17', validTo: null, requireUppercase: true },
    ],
  },
  {
    entity: {
      id: 'ent_muhammad_yunus',
      canonicalBn: 'মুহাম্মদ ইউনূস',
      canonicalEn: 'Muhammad Yunus',
      entityType: 'person',
      metadataJson: JSON.stringify({ role: 'Chief Adviser (2024–2026)' }),
    },
    aliases: [
      { raw: 'মুহাম্মদ ইউনূস' },
      { raw: 'ড. মুহাম্মদ ইউনূস' },
      { raw: 'ড. ইউনূস' },
      { raw: 'Muhammad Yunus' },
      { raw: 'Dr Yunus' },
      { raw: 'Dr. Yunus' },
      { raw: 'Prof Yunus' },
      { raw: 'প্রধান উপদেষ্টা', validFrom: '2024-08-08', validTo: '2026-02-16' },
      { raw: 'Chief Adviser', validFrom: '2024-08-08', validTo: '2026-02-16' },
    ],
  },
  {
    entity: {
      id: 'ent_sheikh_hasina',
      canonicalBn: 'শেখ হাসিনা',
      canonicalEn: 'Sheikh Hasina',
      entityType: 'person',
      metadataJson: JSON.stringify({ party: 'Awami League', role: 'Former Prime Minister (2009–2024)' }),
    },
    aliases: [
      { raw: 'শেখ হাসিনা' },
      { raw: 'হাসিনা' },
      { raw: 'Sheikh Hasina' },
      { raw: 'Hasina' },
      { raw: 'প্রধানমন্ত্রী', validFrom: '2009-01-06', validTo: '2024-08-05' },
      { raw: 'Prime Minister', validFrom: '2009-01-06', validTo: '2024-08-05' },
      { raw: 'PM', validFrom: '2009-01-06', validTo: '2024-08-05', requireUppercase: true },
    ],
  },
  {
    entity: {
      id: 'ent_khaleda_zia',
      canonicalBn: 'খালেদা জিয়া',
      canonicalEn: 'Khaleda Zia',
      entityType: 'person',
      metadataJson: JSON.stringify({ party: 'BNP' }),
    },
    aliases: [
      { raw: 'খালেদা জিয়া' },
      { raw: 'বেগম খালেদা জিয়া' },
      { raw: 'Khaleda Zia' },
      { raw: 'Begum Khaleda Zia' },
    ],
  },
  {
    entity: {
      id: 'ent_mirza_fakhrul',
      canonicalBn: 'মির্জা ফখরুল ইসলাম আলমগীর',
      canonicalEn: 'Mirza Fakhrul Islam Alamgir',
      entityType: 'person',
      metadataJson: JSON.stringify({ party: 'BNP' }),
    },
    aliases: [
      { raw: 'মির্জা ফখরুল ইসলাম আলমগীর' },
      { raw: 'মির্জা ফখরুল' },
      { raw: 'Mirza Fakhrul Islam Alamgir' },
      { raw: 'Mirza Fakhrul' },
      { raw: 'Fakhrul' },
    ],
  },
  {
    entity: {
      id: 'ent_ruhul_kabir_rizvi',
      canonicalBn: 'রুহুল কবির রিজভী',
      canonicalEn: 'Ruhul Kabir Rizvi',
      entityType: 'person',
      metadataJson: JSON.stringify({ party: 'BNP' }),
    },
    aliases: [
      { raw: 'রুহুল কবির রিজভী' },
      { raw: 'রিজভী' },
      { raw: 'Ruhul Kabir Rizvi' },
      { raw: 'Rizvi' },
    ],
  },
  {
    entity: {
      id: 'ent_shafiqur_rahman',
      canonicalBn: 'শফিকুর রহমান',
      canonicalEn: 'Dr. Shafiqur Rahman',
      entityType: 'person',
      metadataJson: JSON.stringify({ party: 'Jamaat-e-Islami', role: 'Ameer' }),
    },
    aliases: [
      { raw: 'শফিকুর রহমান' },
      { raw: 'ডা. শফিকুর রহমান' },
      { raw: 'জামায়াত আমির' },
      { raw: 'জামায়াতের আমির' },
      { raw: 'Shafiqur Rahman' },
      { raw: 'Shafiqur' },
      { raw: 'Jamaat Ameer' },
      { raw: 'Jamaat ameer' },
    ],
  },
  {
    entity: {
      id: 'ent_nahid_islam',
      canonicalBn: 'নাহিদ ইসলাম',
      canonicalEn: 'Nahid Islam',
      entityType: 'person',
      metadataJson: JSON.stringify({ party: 'NCP' }),
    },
    aliases: [
      { raw: 'নাহিদ ইসলাম' },
      { raw: 'Nahid Islam' },
    ],
  },
  {
    entity: {
      id: 'ent_sarjis_alam',
      canonicalBn: 'সারজিস আলম',
      canonicalEn: 'Sarjis Alam',
      entityType: 'person',
      metadataJson: JSON.stringify({ party: 'NCP' }),
    },
    aliases: [{ raw: 'সারজিস আলম' }, { raw: 'Sarjis Alam' }],
  },
  {
    entity: {
      id: 'ent_hasnat_abdullah',
      canonicalBn: 'হাসনাত আবদুল্লাহ',
      canonicalEn: 'Hasnat Abdullah',
      entityType: 'person',
      metadataJson: JSON.stringify({ party: 'NCP' }),
    },
    aliases: [
      { raw: 'হাসনাত আবদুল্লাহ' },
      { raw: 'হাসনাত আব্দুল্লাহ' },
      { raw: 'Hasnat Abdullah' },
    ],
  },
  {
    entity: {
      id: 'ent_samantha_sharmin',
      canonicalBn: 'সামান্তা শারমিন',
      canonicalEn: 'Samanta Shermeen',
      entityType: 'person',
      metadataJson: JSON.stringify({ party: 'NCP' }),
    },
    aliases: [
      { raw: 'সামান্তা শারমিন' },
      { raw: 'Samanta Shermeen' },
      { raw: 'Samantha Sharmin' },
    ],
  },
  {
    entity: {
      id: 'ent_shama_obaed',
      canonicalBn: 'শামা ওবায়েদ',
      canonicalEn: 'Shama Obaed',
      entityType: 'person',
      metadataJson: JSON.stringify({ party: 'BNP' }),
    },
    aliases: [{ raw: 'শামা ওবায়েদ' }, { raw: 'Shama Obaed' }],
  },
  {
    entity: {
      id: 'ent_mahdi_amin',
      canonicalBn: 'মাহদী আমিন',
      canonicalEn: 'Mahdi Amin',
      entityType: 'person',
      metadataJson: JSON.stringify({}),
    },
    aliases: [{ raw: 'মাহদী আমিন' }, { raw: 'মাহ্দী আমিন' }, { raw: 'Mahdi Amin' }],
  },
  {
    entity: {
      id: 'ent_rashed_khan',
      canonicalBn: 'রাশেদ খাঁন',
      canonicalEn: 'Rashed Khan',
      entityType: 'person',
      metadataJson: JSON.stringify({}),
    },
    aliases: [
      { raw: 'রাশেদ খাঁন' },
      { raw: 'রাশেদ খান' },
      { raw: 'Rashed Khan' },
    ],
  },
  {
    entity: {
      id: 'ent_bobby_hajjaj',
      canonicalBn: 'ববি হাজ্জাজ',
      canonicalEn: 'Bobby Hajjaj',
      entityType: 'person',
      metadataJson: JSON.stringify({}),
    },
    aliases: [{ raw: 'ববি হাজ্জাজ' }, { raw: 'Bobby Hajjaj' }],
  },
  {
    entity: {
      id: 'ent_gm_quader',
      canonicalBn: 'জি এম কাদের',
      canonicalEn: 'GM Quader',
      entityType: 'person',
      metadataJson: JSON.stringify({ party: 'Jatiya Party' }),
    },
    aliases: [{ raw: 'জি এম কাদের' }, { raw: 'জিএম কাদের' }, { raw: 'GM Quader' }],
  },
  {
    entity: {
      id: 'ent_salahuddin_ahmed',
      canonicalBn: 'সালাহউদ্দিন আহমেদ',
      canonicalEn: 'Salahuddin Ahmed',
      entityType: 'person',
      metadataJson: JSON.stringify({ party: 'BNP' }),
    },
    aliases: [
      { raw: 'সালাহউদ্দিন আহমেদ' },
      { raw: 'সালাহউদ্দিন আহমদ' },
      { raw: 'Salahuddin Ahmed' },
      { raw: 'Salahuddin' },
    ],
  },
  {
    entity: {
      id: 'ent_amir_khasru',
      canonicalBn: 'আমীর খসরু মাহমুদ চৌধুরী',
      canonicalEn: 'Amir Khasru Mahmud Chowdhury',
      entityType: 'person',
      metadataJson: JSON.stringify({ party: 'BNP' }),
    },
    aliases: [
      { raw: 'আমীর খসরু মাহমুদ চৌধুরী' },
      { raw: 'আমীর খসরু' },
      { raw: 'Amir Khasru' },
      { raw: 'Amir Khasru Mahmud Chowdhury' },
      { raw: 'Khosru' },
    ],
  },
  {
    entity: {
      id: 'ent_ziaul_ahsan',
      canonicalBn: 'জিয়াউল আহসান',
      canonicalEn: 'Ziaul Ahsan',
      entityType: 'person',
      metadataJson: JSON.stringify({}),
    },
    aliases: [{ raw: 'জিয়াউল আহসান' }, { raw: 'Ziaul Ahsan' }],
  },
  {
    entity: {
      id: 'ent_shahe_alam',
      canonicalBn: 'মীর শাহে আলম',
      canonicalEn: 'Mir Shahe Alam',
      entityType: 'person',
    },
    aliases: [{ raw: 'মীর শাহে আলম' }, { raw: 'Mir Shahe Alam' }, { raw: 'Shahe Alam' }],
  },
  {
    entity: {
      id: 'ent_golam_parwar',
      canonicalBn: 'মিয়া গোলাম পরওয়ার',
      canonicalEn: 'Mia Golam Parwar',
      entityType: 'person',
      metadataJson: JSON.stringify({ party: 'Jamaat-e-Islami' }),
    },
    aliases: [{ raw: 'মিয়া গোলাম পরওয়ার' }, { raw: 'গোলাম পরওয়ার' }, { raw: 'Golam Parwar' }],
  },
  {
    entity: {
      id: 'ent_moyeen_khan',
      canonicalBn: 'আব্দুল মঈন খান',
      canonicalEn: 'Abdul Moyeen Khan',
      entityType: 'person',
      metadataJson: JSON.stringify({ party: 'BNP' }),
    },
    aliases: [{ raw: 'আব্দুল মঈন খান' }, { raw: 'মঈন খান' }, { raw: 'Moyeen Khan' }],
  },
  {
    entity: {
      id: 'ent_zahir_swapan',
      canonicalBn: 'জহির উদ্দিন স্বপন',
      canonicalEn: 'Zahir Uddin Swapan',
      entityType: 'person',
      metadataJson: JSON.stringify({ party: 'BNP' }),
    },
    aliases: [{ raw: 'জহির উদ্দিন স্বপন' }, { raw: 'Zahir Uddin Swapan' }],
  },

  // ==========================================
  // Constitutional & Cabinet Roles (Portfolio-Level)
  // ==========================================
  {
    entity: {
      id: 'ent_role_president',
      canonicalBn: 'রাষ্ট্রপতি',
      canonicalEn: 'President',
      entityType: 'role',
    },
    aliases: [{ raw: 'রাষ্ট্রপতি' }, { raw: 'President', requireUppercase: true }],
  },
  {
    entity: {
      id: 'ent_role_home_minister',
      canonicalBn: 'স্বরাষ্ট্রমন্ত্রী',
      canonicalEn: 'Home Minister',
      entityType: 'role',
    },
    aliases: [
      { raw: 'স্বরাষ্ট্রমন্ত্রী' },
      { raw: 'Home Minister' },
      { raw: 'স্বরাষ্ট্র উপদেষ্টা' },
      { raw: 'Home Adviser' },
    ],
  },
  {
    entity: {
      id: 'ent_role_finance_minister',
      canonicalBn: 'অর্থমন্ত্রী',
      canonicalEn: 'Finance Minister',
      entityType: 'role',
    },
    aliases: [
      { raw: 'অর্থমন্ত্রী' },
      { raw: 'Finance Minister' },
      { raw: 'অর্থ উপদেষ্টা' },
      { raw: 'Finance Adviser' },
    ],
  },
  {
    entity: {
      id: 'ent_role_law_minister',
      canonicalBn: 'আইনমন্ত্রী',
      canonicalEn: 'Law Minister',
      entityType: 'role',
    },
    aliases: [
      { raw: 'আইনমন্ত্রী' },
      { raw: 'Law Minister' },
      { raw: 'আইন উপদেষ্টা' },
      { raw: 'Law Adviser' },
    ],
  },
  {
    entity: {
      id: 'ent_role_foreign_minister',
      canonicalBn: 'পররাষ্ট্রমন্ত্রী',
      canonicalEn: 'Foreign Minister',
      entityType: 'role',
    },
    aliases: [
      { raw: 'পররাষ্ট্রমন্ত্রী' },
      { raw: 'পররাষ্ট্র প্রতিমন্ত্রী' },
      { raw: 'Foreign Minister' },
      { raw: 'Foreign Adviser' },
    ],
  },
  {
    entity: {
      id: 'ent_role_commerce_minister',
      canonicalBn: 'বাণিজ্যমন্ত্রী',
      canonicalEn: 'Commerce Minister',
      entityType: 'role',
    },
    aliases: [{ raw: 'বাণিজ্যমন্ত্রী' }, { raw: 'Commerce Minister' }],
  },
  {
    entity: {
      id: 'ent_role_health_minister',
      canonicalBn: 'স্বাস্থ্যমন্ত্রী',
      canonicalEn: 'Health Minister',
      entityType: 'role',
    },
    aliases: [
      { raw: 'স্বাস্থ্যমন্ত্রী' },
      { raw: 'স্বাস্থ্য প্রতিমন্ত্রী' },
      { raw: 'Health Minister' },
    ],
  },
  {
    entity: {
      id: 'ent_role_education_minister',
      canonicalBn: 'শিক্ষামন্ত্রী',
      canonicalEn: 'Education Minister',
      entityType: 'role',
    },
    aliases: [{ raw: 'শিক্ষামন্ত্রী' }, { raw: 'Education Minister' }],
  },
  {
    entity: {
      id: 'ent_role_information_minister',
      canonicalBn: 'তথ্যমন্ত্রী',
      canonicalEn: 'Information Minister',
      entityType: 'role',
    },
    aliases: [
      { raw: 'তথ্যমন্ত্রী' },
      { raw: 'তথ্য প্রতিমন্ত্রী' },
      { raw: 'তথ্য উপদেষ্টা' },
      { raw: 'Information Minister' },
    ],
  },

  // ==========================================
  // Political Parties & Organizations
  // ==========================================
  {
    entity: {
      id: 'ent_bnp',
      canonicalBn: 'বিএনপি',
      canonicalEn: 'BNP',
      entityType: 'org',
      metadataJson: JSON.stringify({ category: 'political_party' }),
    },
    aliases: [
      { raw: 'বিএনপি' },
      { raw: 'বাংলাদেশ জাতীয়তাবাদী দল' },
      { raw: 'BNP', requireUppercase: true },
      { raw: 'Bangladesh Nationalist Party' },
    ],
  },
  {
    entity: {
      id: 'ent_ncp',
      canonicalBn: 'এনসিপি',
      canonicalEn: 'NCP',
      entityType: 'org',
      metadataJson: JSON.stringify({ category: 'political_party' }),
    },
    aliases: [
      { raw: 'এনসিপি' },
      { raw: 'জাতীয় নাগরিক পার্টি' },
      { raw: 'NCP', requireUppercase: true },
      { raw: 'National Citizen Party' },
    ],
  },
  {
    entity: {
      id: 'ent_awami_league',
      canonicalBn: 'আওয়ামী লীগ',
      canonicalEn: 'Awami League',
      entityType: 'org',
      metadataJson: JSON.stringify({ category: 'political_party' }),
    },
    aliases: [
      { raw: 'আওয়ামী লীগ' },
      { raw: 'আ.লীগ' },
      { raw: 'আ. লীগ' },
      { raw: 'Awami League' },
      { raw: 'AL', requireUppercase: true },
    ],
  },
  {
    entity: {
      id: 'ent_jamaat',
      canonicalBn: 'জামায়াতে ইসলামী',
      canonicalEn: 'Jamaat-e-Islami',
      entityType: 'org',
      metadataJson: JSON.stringify({ category: 'political_party' }),
    },
    aliases: [
      { raw: 'জামায়াতে ইসলামী' },
      { raw: 'জামায়াত' },
      { raw: 'Jamaat-e-Islami' },
      { raw: 'Jamaat' },
    ],
  },
  {
    entity: {
      id: 'ent_jatiya_party',
      canonicalBn: 'জাতীয় পার্টি',
      canonicalEn: 'Jatiya Party',
      entityType: 'org',
      metadataJson: JSON.stringify({ category: 'political_party' }),
    },
    aliases: [
      { raw: 'জাতীয় পার্টি' },
      { raw: 'জাপা' },
      { raw: 'Jatiya Party' },
    ],
  },
  {
    entity: {
      id: 'ent_bangladesh_bank',
      canonicalBn: 'বাংলাদেশ ব্যাংক',
      canonicalEn: 'Bangladesh Bank',
      entityType: 'org',
      metadataJson: JSON.stringify({ sector: 'central_bank' }),
    },
    aliases: [
      { raw: 'বাংলাদেশ ব্যাংক' },
      { raw: 'কেন্দ্রীয় ব্যাংক' },
      { raw: 'Bangladesh Bank' },
      { raw: 'BB', requireUppercase: true },
    ],
  },
  {
    entity: {
      id: 'ent_parliament',
      canonicalBn: 'জাতীয় সংসদ',
      canonicalEn: 'Parliament (JS)',
      entityType: 'org',
      metadataJson: JSON.stringify({ sector: 'legislature' }),
    },
    aliases: [
      { raw: 'জাতীয় সংসদ' },
      { raw: 'সংসদ' },
      { raw: 'সংসদ ভবন' },
      { raw: 'Parliament' },
      { raw: 'Jatiya Sangsad' },
      { raw: 'JS', requireUppercase: true },
    ],
  },
  {
    entity: {
      id: 'ent_high_court',
      canonicalBn: 'হাইকোর্ট',
      canonicalEn: 'High Court',
      entityType: 'org',
      metadataJson: JSON.stringify({ sector: 'judiciary' }),
    },
    aliases: [
      { raw: 'হাইকোর্ট' },
      { raw: 'High Court' },
      { raw: 'HC', requireUppercase: true },
    ],
  },
  {
    entity: {
      id: 'ent_supreme_court',
      canonicalBn: 'সুপ্রিম কোর্ট',
      canonicalEn: 'Supreme Court',
      entityType: 'org',
      metadataJson: JSON.stringify({ sector: 'judiciary' }),
    },
    aliases: [{ raw: 'সুপ্রিম কোর্ট' }, { raw: 'Supreme Court' }, { raw: 'SC', requireUppercase: true }],
  },
  {
    entity: {
      id: 'ent_ict',
      canonicalBn: 'আন্তর্জাতিক অপরাধ ট্রাইব্যুনাল',
      canonicalEn: 'International Crimes Tribunal (ICT)',
      entityType: 'org',
      metadataJson: JSON.stringify({ sector: 'judiciary' }),
    },
    aliases: [
      { raw: 'আন্তর্জাতিক অপরাধ ট্রাইব্যুনাল' },
      { raw: 'ট্রাইব্যুনাল' },
      { raw: 'International Crimes Tribunal' },
      { raw: 'ICT', requireUppercase: true },
    ],
  },
  {
    entity: {
      id: 'ent_acc',
      canonicalBn: 'দুর্নীতি দমন কমিশন (দুদক)',
      canonicalEn: 'Anti-Corruption Commission (ACC)',
      entityType: 'org',
    },
    aliases: [
      { raw: 'দুর্নীতি দমন কমিশন' },
      { raw: 'দুদক' },
      { raw: 'Anti-Corruption Commission' },
      { raw: 'ACC', requireUppercase: true },
    ],
  },
  {
    entity: {
      id: 'ent_ec',
      canonicalBn: 'নির্বাচন কমিশন',
      canonicalEn: 'Election Commission',
      entityType: 'org',
    },
    aliases: [
      { raw: 'নির্বাচন কমিশন' },
      { raw: 'ইসি' },
      { raw: 'Election Commission' },
      { raw: 'EC', requireUppercase: true },
    ],
  },
  {
    entity: {
      id: 'ent_police',
      canonicalBn: 'পুলিশ',
      canonicalEn: 'Bangladesh Police',
      entityType: 'org',
    },
    aliases: [
      { raw: 'পুলিশ' },
      { raw: 'ডিএমপি' },
      { raw: 'Police' },
      { raw: 'DMP', requireUppercase: true },
      { raw: 'DB', requireUppercase: true },
      { raw: 'ডিবি' },
    ],
  },
  {
    entity: {
      id: 'ent_rab',
      canonicalBn: 'র‍্যাব',
      canonicalEn: 'RAB',
      entityType: 'org',
    },
    aliases: [{ raw: 'র‍্যাব' }, { raw: 'র‌্যাব' }, { raw: 'RAB', requireUppercase: true }],
  },
  {
    entity: {
      id: 'ent_army',
      canonicalBn: 'সেনাবাহিনী',
      canonicalEn: 'Bangladesh Army',
      entityType: 'org',
    },
    aliases: [{ raw: 'সেনাবাহিনী' }, { raw: 'Bangladesh Army' }, { raw: 'Army', requireUppercase: true }],
  },
  {
    entity: {
      id: 'ent_bgb',
      canonicalBn: 'বিজিবি',
      canonicalEn: 'BGB',
      entityType: 'org',
    },
    aliases: [{ raw: 'বিজিবি' }, { raw: 'BGB', requireUppercase: true }],
  },
  {
    entity: {
      id: 'ent_nbr',
      canonicalBn: 'জাতীয় রাজস্ব বোর্ড (এনবিআর)',
      canonicalEn: 'National Board of Revenue (NBR)',
      entityType: 'org',
    },
    aliases: [
      { raw: 'জাতীয় রাজস্ব বোর্ড' },
      { raw: 'এনবিআর' },
      { raw: 'National Board of Revenue' },
      { raw: 'NBR', requireUppercase: true },
    ],
  },
  {
    entity: {
      id: 'ent_bgmea',
      canonicalBn: 'বিজিএমইএ',
      canonicalEn: 'BGMEA',
      entityType: 'org',
    },
    aliases: [{ raw: 'বিজিএমইএ' }, { raw: 'BGMEA', requireUppercase: true }],
  },
  {
    entity: {
      id: 'ent_biman',
      canonicalBn: 'বিমান বাংলাদেশ এয়ারলাইন্স',
      canonicalEn: 'Biman Bangladesh Airlines',
      entityType: 'org',
    },
    aliases: [
      { raw: 'বিমান বাংলাদেশ এয়ারলাইন্স' },
      { raw: 'বিমান' },
      { raw: 'Biman' },
      { raw: 'Biman Bangladesh Airlines' },
    ],
  },
  {
    entity: {
      id: 'ent_imf',
      canonicalBn: 'আইএমএফ',
      canonicalEn: 'IMF',
      entityType: 'org',
    },
    aliases: [{ raw: 'আইএমএফ' }, { raw: 'IMF', requireUppercase: true }],
  },
  {
    entity: {
      id: 'ent_world_bank',
      canonicalBn: 'বিশ্বব্যাংক',
      canonicalEn: 'World Bank',
      entityType: 'org',
    },
    aliases: [{ raw: 'বিশ্বব্যাংক' }, { raw: 'World Bank' }],
  },
  {
    entity: {
      id: 'ent_un',
      canonicalBn: 'জাতিসংঘ',
      canonicalEn: 'United Nations',
      entityType: 'org',
    },
    aliases: [
      { raw: 'জাতিসংঘ' },
      { raw: 'United Nations' },
      { raw: 'UN', requireUppercase: true },
    ],
  },
  {
    entity: {
      id: 'ent_s_alam',
      canonicalBn: 'এস আলম গ্রুপ',
      canonicalEn: 'S Alam Group',
      entityType: 'org',
    },
    aliases: [{ raw: 'এস আলম' }, { raw: 'এস আলম গ্রুপ' }, { raw: 'S Alam' }, { raw: 'S Alam Group' }],
  },

  // ==========================================
  // Locations (Bangladesh Districts & Key Countries/Cities)
  // ==========================================
  {
    entity: { id: 'ent_bangladesh', canonicalBn: 'বাংলাদেশ', canonicalEn: 'Bangladesh', entityType: 'location' },
    aliases: [{ raw: 'বাংলাদেশ' }, { raw: 'Bangladesh' }],
  },
  {
    entity: { id: 'ent_dhaka', canonicalBn: 'ঢাকা', canonicalEn: 'Dhaka', entityType: 'location' },
    aliases: [{ raw: 'ঢাকা' }, { raw: 'রাজধানী' }, { raw: 'Dhaka' }],
  },
  {
    entity: { id: 'ent_chattogram', canonicalBn: 'চট্টগ্রাম', canonicalEn: 'Chattogram', entityType: 'location' },
    aliases: [
      { raw: 'চট্টগ্রাম' },
      { raw: 'Chattogram' },
      { raw: 'Chittagong' },
      { raw: 'Ctg', requireUppercase: true },
    ],
  },
  {
    entity: { id: 'ent_coxs_bazar', canonicalBn: 'কক্সবাজার', canonicalEn: "Cox's Bazar", entityType: 'location' },
    aliases: [{ raw: 'কক্সবাজার' }, { raw: "Cox's Bazar" }, { raw: 'Coxs Bazar' }],
  },
  {
    entity: { id: 'ent_sylhet', canonicalBn: 'সিলেট', canonicalEn: 'Sylhet', entityType: 'location' },
    aliases: [{ raw: 'সিলেট' }, { raw: 'Sylhet' }],
  },
  {
    entity: { id: 'ent_gazipur', canonicalBn: 'গাজীপুর', canonicalEn: 'Gazipur', entityType: 'location' },
    aliases: [{ raw: 'গাজীপুর' }, { raw: 'Gazipur' }],
  },
  {
    entity: { id: 'ent_cumilla', canonicalBn: 'কুমিল্লা', canonicalEn: 'Cumilla', entityType: 'location' },
    aliases: [{ raw: 'কুমিল্লা' }, { raw: 'Cumilla' }, { raw: 'Comilla' }],
  },
  {
    entity: { id: 'ent_rajshahi', canonicalBn: 'রাজশাহী', canonicalEn: 'Rajshahi', entityType: 'location' },
    aliases: [{ raw: 'রাজশাহী' }, { raw: 'Rajshahi' }],
  },
  {
    entity: { id: 'ent_khulna', canonicalBn: 'খুলনা', canonicalEn: 'Khulna', entityType: 'location' },
    aliases: [{ raw: 'খুলনা' }, { raw: 'Khulna' }],
  },
  {
    entity: { id: 'ent_rangpur', canonicalBn: 'রংপুর', canonicalEn: 'Rangpur', entityType: 'location' },
    aliases: [{ raw: 'রংপুর' }, { raw: 'Rangpur' }],
  },
  {
    entity: { id: 'ent_barishal', canonicalBn: 'বরিশাল', canonicalEn: 'Barishal', entityType: 'location' },
    aliases: [{ raw: 'বরিশাল' }, { raw: 'Barishal' }, { raw: 'Barisal' }],
  },
  {
    entity: { id: 'ent_mymensingh', canonicalBn: 'ময়মনসিংহ', canonicalEn: 'Mymensingh', entityType: 'location' },
    aliases: [{ raw: 'ময়মনসিংহ' }, { raw: 'Mymensingh' }],
  },
  {
    entity: { id: 'ent_savar', canonicalBn: 'সাভার', canonicalEn: 'Savar', entityType: 'location' },
    aliases: [{ raw: 'সাভার' }, { raw: 'Savar' }],
  },
  {
    entity: { id: 'ent_satkhira', canonicalBn: 'সাতক্ষীরা', canonicalEn: 'Satkhira', entityType: 'location' },
    aliases: [{ raw: 'সাতক্ষীরা' }, { raw: 'Satkhira' }],
  },
  {
    entity: { id: 'ent_rangamati', canonicalBn: 'রাঙামাটি', canonicalEn: 'Rangamati', entityType: 'location' },
    aliases: [{ raw: 'রাঙামাটি' }, { raw: 'রাঙ্গামাটি' }, { raw: 'Rangamati' }],
  },
  {
    entity: { id: 'ent_kushtia', canonicalBn: 'কুষ্টিয়া', canonicalEn: 'Kushtia', entityType: 'location' },
    aliases: [{ raw: 'কুষ্টিয়া' }, { raw: 'Kushtia' }],
  },
  {
    entity: { id: 'ent_india', canonicalBn: 'ভারত', canonicalEn: 'India', entityType: 'location' },
    aliases: [{ raw: 'ভারত' }, { raw: 'নয়াদিল্লি' }, { raw: 'India' }, { raw: 'New Delhi' }],
  },
  {
    entity: { id: 'ent_usa', canonicalBn: 'যুক্তরাষ্ট্র', canonicalEn: 'United States', entityType: 'location' },
    aliases: [
      { raw: 'যুক্তরাষ্ট্র' },
      { raw: 'আমেরিকা' },
      { raw: 'ওয়াশিংটন' },
      { raw: 'United States' },
      { raw: 'USA', requireUppercase: true },
      { raw: 'US', requireUppercase: true },
    ],
  },
  {
    entity: { id: 'ent_uk', canonicalBn: 'যুক্তরাজ্য', canonicalEn: 'United Kingdom', entityType: 'location' },
    aliases: [
      { raw: 'যুক্তরাজ্য' },
      { raw: 'লন্ডন' },
      { raw: 'United Kingdom' },
      { raw: 'UK', requireUppercase: true },
      { raw: 'London' },
    ],
  },
  {
    entity: { id: 'ent_china', canonicalBn: 'চীন', canonicalEn: 'China', entityType: 'location' },
    aliases: [{ raw: 'চীন' }, { raw: 'China' }, { raw: 'Beijing' }],
  },
  {
    entity: { id: 'ent_pakistan', canonicalBn: 'পাকিস্তান', canonicalEn: 'Pakistan', entityType: 'location' },
    aliases: [{ raw: 'পাকিস্তান' }, { raw: 'Pakistan' }],
  },
  {
    entity: { id: 'ent_saudi', canonicalBn: 'সৌদি আরব', canonicalEn: 'Saudi Arabia', entityType: 'location' },
    aliases: [{ raw: 'সৌদি আরব' }, { raw: 'সৌদি' }, { raw: 'রিয়াদ' }, { raw: 'Saudi Arabia' }, { raw: 'Riyadh' }],
  },
  {
    entity: { id: 'ent_malaysia', canonicalBn: 'মালয়েশিয়া', canonicalEn: 'Malaysia', entityType: 'location' },
    aliases: [{ raw: 'মালয়েশিয়া' }, { raw: 'Malaysia' }],
  },
  {
    entity: { id: 'ent_turkey', canonicalBn: 'তুরস্ক', canonicalEn: 'Turkey', entityType: 'location' },
    aliases: [{ raw: 'তুরস্ক' }, { raw: 'Turkey' }, { raw: 'Türkiye' }],
  },

  // ==========================================
  // Major Recurring Event Topics & Sector Entities
  // ==========================================
  {
    entity: { id: 'ent_topic_rmg', canonicalBn: 'পোশাক খাত / শ্রমিক', canonicalEn: 'RMG & Garment Workers', entityType: 'event_topic' },
    aliases: [
      { raw: 'পোশাক শ্রমিক' },
      { raw: 'গার্মেন্টস' },
      { raw: 'RMG', requireUppercase: true },
      { raw: 'garment workers' },
    ],
  },
  {
    entity: { id: 'ent_topic_july_uprising', canonicalBn: 'জুলাই অভ্যুত্থান', canonicalEn: 'July Uprising', entityType: 'event_topic' },
    aliases: [
      { raw: 'জুলাই অভ্যুত্থান' },
      { raw: 'জুলাই গণঅভ্যুত্থান' },
      { raw: 'জুলাই গণ-অভ্যুত্থান' },
      { raw: 'July Uprising' },
    ],
  },
  {
    entity: { id: 'ent_topic_rohingya', canonicalBn: 'রোহিঙ্গা সংকট', canonicalEn: 'Rohingya Crisis', entityType: 'event_topic' },
    aliases: [{ raw: 'রোহিঙ্গা' }, { raw: 'Rohingya' }],
  },
  {
    entity: { id: 'ent_topic_third_terminal', canonicalBn: 'তৃতীয় টার্মিনাল', canonicalEn: 'HSIA Third Terminal', entityType: 'event_topic' },
    aliases: [{ raw: 'তৃতীয় টার্মিনাল' }, { raw: 'Third Terminal' }],
  },
  {
    entity: { id: 'ent_topic_cop31', canonicalBn: 'বিশ্ব জলবায়ু সম্মেলন (COP31)', canonicalEn: 'COP31 Climate Summit', entityType: 'event_topic' },
    aliases: [{ raw: 'জলবায়ু সম্মেলন' }, { raw: 'COP31', requireUppercase: true }],
  },
  {
    entity: { id: 'ent_topic_pay_scale', canonicalBn: 'নবম পে-স্কেল', canonicalEn: '9th Pay Scale', entityType: 'event_topic' },
    aliases: [{ raw: 'পে-স্কেল' }, { raw: 'নবম পে-স্কেল' }, { raw: 'pay scale' }],
  },
  {
    entity: { id: 'ent_topic_dengue', canonicalBn: 'ডেঙ্গু পরিস্থিতি', canonicalEn: 'Dengue Outbreak', entityType: 'event_topic' },
    aliases: [{ raw: 'ডেঙ্গু' }, { raw: 'Dengue' }],
  },
  {
    entity: { id: 'ent_topic_gold', canonicalBn: 'সোনার বাজার', canonicalEn: 'Gold Price', entityType: 'event_topic' },
    aliases: [{ raw: 'সোনার দাম' }, { raw: 'সোনার ভরি' }, { raw: 'বাজুস' }, { raw: 'BAJUS', requireUppercase: true }],
  },
];

export function buildSeedRegistry(): {
  entities: Entity[];
  aliases: ExpandedEntityAlias[];
} {
  const entities: Entity[] = [];
  const aliases: ExpandedEntityAlias[] = [];

  for (const item of RAW_SEED) {
    entities.push(item.entity);
    for (const a of item.aliases) {
      const rawClean = normalizeText(a.raw);
      const norm = rawClean
        .split(/\s+/)
        .map(normalizeToken)
        .filter(Boolean)
        .join(' ');
      if (!norm) continue;
      aliases.push({
        aliasNorm: norm,
        aliasRaw: rawClean,
        entityId: item.entity.id,
        validFrom: a.validFrom ?? null,
        validTo: a.validTo ?? null,
        requireUppercase: a.requireUppercase,
      });
    }
  }

  return { entities, aliases };
}
