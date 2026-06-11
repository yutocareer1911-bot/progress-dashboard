#!/usr/bin/env node

/**
 * サブタスク自動作成スクリプト
 *
 * GitHub Actionsから10分おきに実行される。
 * 「フェーズラベルあり・サブタスクなし」のイシューに対して
 * config/task-templates.js のテンプレートに基づきサブタスクを自動作成する。
 *
 * ※ 面接フェーズは企業情報が必要なためスキップ（npm run new-candidate を使用）
 */

import 'dotenv/config';
import { LINEAR_API_URL, LINEAR_TEAM_KEY, LINEAR_LABEL_MAP } from '../config/settings.js';
import { TASK_TEMPLATES } from '../config/task-templates.js';

const LINEAR_API_KEY = process.env.MAGAZINE_LINEAR_API_KEY;
const SKIP_PHASES = ['面接'];

async function callLinearAPI(query, variables = {}) {
  const res = await fetch(LINEAR_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': LINEAR_API_KEY,
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`Linear API エラー: ${res.status} ${res.statusText}`);
  const data = await res.json();
  if (data.errors) throw new Error(`GraphQL エラー: ${JSON.stringify(data.errors)}`);
  return data.data;
}

async function fetchTargetIssues() {
  const data = await callLinearAPI(`
    query {
      issues(
        first: 100,
        filter: {
          team: { key: { eq: "${LINEAR_TEAM_KEY}" } },
          state: { type: { in: ["backlog", "unstarted", "started"] } },
          parent: { null: true }
        }
      ) {
        nodes {
          id identifier title
          labels { nodes { id name } }
          children { nodes { id } }
        }
      }
    }
  `);
  return data.issues.nodes;
}

function detectPhase(labels) {
  for (const { labelName, pipelineLabel } of LINEAR_LABEL_MAP) {
    if (labels.some(l => l.name === labelName)) return pipelineLabel;
  }
  return null;
}

async function createSubIssue({ teamId, parentId, title }) {
  const data = await callLinearAPI(`
    mutation IssueCreate($input: IssueCreateInput!) {
      issueCreate(input: $input) {
        success
        issue { id identifier title }
      }
    }
  `, { input: { teamId, parentId, title } });

  if (!data.issueCreate.success) throw new Error(`サブタスクの作成に失敗: ${title}`);
  return data.issueCreate.issue;
}

async function fetchTeamId() {
  const data = await callLinearAPI(`
    query {
      teams(filter: { key: { eq: "${LINEAR_TEAM_KEY}" } }) {
        nodes { id }
      }
    }
  `);
  const team = data.teams.nodes[0];
  if (!team) throw new Error(`チーム "${LINEAR_TEAM_KEY}" が見つかりません`);
  return team.id;
}

async function main() {
  if (!LINEAR_API_KEY) {
    console.error('❌ MAGAZINE_LINEAR_API_KEY が設定されていません');
    process.exit(1);
  }

  console.log('🔍 サブタスク未作成のイシューを確認中...');

  const [teamId, issues] = await Promise.all([fetchTeamId(), fetchTargetIssues()]);

  // フェーズラベルあり・サブタスクなし・スキップフェーズ以外のイシューを抽出
  const targets = issues.filter(issue => {
    const phase = detectPhase(issue.labels?.nodes || []);
    if (!phase) return false;
    if (SKIP_PHASES.includes(phase)) return false;
    if ((issue.children?.nodes?.length ?? 0) > 0) return false;
    return true;
  });

  if (targets.length === 0) {
    console.log('✅ サブタスクを作成すべきイシューはありません。');
    return;
  }

  console.log(`📋 対象イシュー: ${targets.length} 件\n`);

  let totalCreated = 0;

  for (const issue of targets) {
    const phase = detectPhase(issue.labels.nodes);
    const templates = TASK_TEMPLATES[phase] || [];

    if (templates.length === 0) continue;

    console.log(`→ ${issue.identifier} "${issue.title}" [${phase}] にサブタスクを作成中...`);

    for (const title of templates) {
      await createSubIssue({ teamId, parentId: issue.id, title });
      console.log(`   ✅ ${title}`);
      totalCreated++;
    }
    console.log('');
  }

  console.log(`✅ 完了！合計 ${totalCreated} 件のサブタスクを作成しました。`);
}

main().catch(err => {
  console.error('❌ エラーが発生しました:', err.message);
  process.exit(1);
});
