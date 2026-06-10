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

// Linearのラベル名 → フェーズの対応
// Linearでこの名前のラベルを作成してイシューに付けるだけで自動分類される
export const LINEAR_LABEL_MAP = [
  { labelName: 'スカウト',   pipelineLabel: STATUS_LABELS.sourcing },
  { labelName: 'コンタクト', pipelineLabel: STATUS_LABELS.contact },
  { labelName: 'CA面談',     pipelineLabel: STATUS_LABELS.caInterview },
  { labelName: '書類',       pipelineLabel: STATUS_LABELS.resume },
  { labelName: '企業面接',   pipelineLabel: STATUS_LABELS.clientInterview },
  { labelName: '内定',       pipelineLabel: STATUS_LABELS.offer },
];
