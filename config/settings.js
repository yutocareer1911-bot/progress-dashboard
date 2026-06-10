import 'dotenv/config';

export const LINEAR_API_URL = 'https://api.linear.app/graphql';
export const LINEAR_TEAM_KEY = process.env.MAGAZINE_LINEAR_TEAM_KEY || 'YOUR_TEAM';

export const STATUS_LABELS = {
  sourcing:        'スカウト・候補者発掘',
  contact:         '初回コンタクト',
  caInterview:     'CA面談',
  resume:          '書類選考',
  clientInterview: '企業面接',
  offer:           '内定・オファー',
};

// パイプラインの順序（ファネル表示用）
export const PIPELINE_ORDER = [
  STATUS_LABELS.sourcing,
  STATUS_LABELS.contact,
  STATUS_LABELS.caInterview,
  STATUS_LABELS.resume,
  STATUS_LABELS.clientInterview,
  STATUS_LABELS.offer,
];

// タイトルの先頭プレフィックスとフェーズの対応
// 例: "[スカウト] 山田太郎 / ABC株式会社" → スカウト・候補者発掘
export const TITLE_PREFIX_MAP = [
  { prefix: '[スカウト]',   label: STATUS_LABELS.sourcing },
  { prefix: '[コンタクト]', label: STATUS_LABELS.contact },
  { prefix: '[CA面談]',     label: STATUS_LABELS.caInterview },
  { prefix: '[書類]',       label: STATUS_LABELS.resume },
  { prefix: '[企業面接]',   label: STATUS_LABELS.clientInterview },
  { prefix: '[内定]',       label: STATUS_LABELS.offer },
];
