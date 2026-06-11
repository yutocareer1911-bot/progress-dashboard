import 'dotenv/config';

export const LINEAR_API_URL = 'https://api.linear.app/graphql';
export const LINEAR_TEAM_KEY = process.env.MAGAZINE_LINEAR_TEAM_KEY || 'YOUR_TEAM';

export const STATUS_LABELS = {
  horiokoshi: '掘り起こし',
  firstMeeting: '初回面談',
  secondMeeting: '再面談',
  documentSubmit: '書類提出',
  interview: '面接',
};

// パイプラインの順序（ファネル表示用）
export const PIPELINE_ORDER = [
  STATUS_LABELS.horiokoshi,
  STATUS_LABELS.firstMeeting,
  STATUS_LABELS.secondMeeting,
  STATUS_LABELS.documentSubmit,
  STATUS_LABELS.interview,
];

// Linearのラベル名 → フェーズの対応
// Linearでこの名前のラベルを作成してイシューに付けるだけで自動分類される
export const LINEAR_LABEL_MAP = [
  { labelName: '掘り起こし', pipelineLabel: STATUS_LABELS.horiokoshi },
  { labelName: '初回面談',   pipelineLabel: STATUS_LABELS.firstMeeting },
  { labelName: '再面談',     pipelineLabel: STATUS_LABELS.secondMeeting },
  { labelName: '書類提出',   pipelineLabel: STATUS_LABELS.documentSubmit },
  { labelName: '面接',       pipelineLabel: STATUS_LABELS.interview },
];

// Linear の優先度マッピング（APIが返す数値 → 表示名）
export const PRIORITY_MAP = {
  0: { label: '-',      class: 'priority-none' },
  1: { label: 'Urgent', class: 'priority-urgent' },
  2: { label: 'High',   class: 'priority-high' },
  3: { label: 'Medium', class: 'priority-medium' },
  4: { label: 'Low',    class: 'priority-low' },
};
