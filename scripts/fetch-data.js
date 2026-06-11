#!/usr/bin/env node

/**
 * Fetch Linear data filtered by title prefix
 *
 * Fetches all issues from the Linear team and categorizes them
 * by the prefix at the start of the title.
 *
 * Prefix rules (defined in config/settings.js TITLE_PREFIX_MAP):
 *   [メール]   → 候補者対応(メール)
 *   [電話]     → 候補者対応(電話)
 *   [推薦文]   → 推薦文記入
 *   [スカウト] → スカウト送信
 *   [求人]     → 求人選定
 *   [精査]     → 内容の精査、準備
 */

import 'dotenv/config';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { LINEAR_API_URL, LINEAR_TEAM_KEY, STATUS_LABELS, LINEAR_LABEL_MAP } from '../config/settings.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LINEAR_API_KEY = process.env.MAGAZINE_LINEAR_API_KEY;

/**
 * Linearのラベル一覧からパイプラインフェーズを返す
 * 一致するラベルがない場合は null
 */
function detectLabel(labels) {
  if (!labels || labels.length === 0) return null;
  for (const { labelName, pipelineLabel } of LINEAR_LABEL_MAP) {
    if (labels.some(l => l.name === labelName)) return pipelineLabel;
  }
  return null;
}

async function fetchLinearData() {
    console.log('📊 Linearから候補者データを取得中...');

  if (!LINEAR_API_KEY) {
    console.error('❌ MAGAZINE_LINEAR_API_KEY が設定されていません');
    process.exit(1);
  }

  const oneMonthAgo = new Date();
  oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);

  const issueFields = `
    id
    identifier
    title
    url
    state { id name type }
    assignee { id name displayName }
    labels { nodes { id name } }
    priority
    dueDate
    createdAt
    updatedAt
    children {
      nodes {
        id identifier title url
        state { id name type }
        dueDate completedAt createdAt updatedAt
      }
    }
  `;

  const activeQuery = `
    query GetActiveIssues {
      issues(
        first: 200,
        filter: {
          team: { key: { eq: "${LINEAR_TEAM_KEY}" } },
          state: { type: { in: ["backlog", "unstarted", "started"] } },
          parent: { null: true }
        }
      ) {
        nodes { ${issueFields} }
      }
    }
  `;

  const completedQuery = `
    query GetCompletedIssues {
      issues(
        first: 200,
        filter: {
          team: { key: { eq: "${LINEAR_TEAM_KEY}" } },
          state: { type: { eq: "completed" } },
          parent: { null: true },
          completedAt: { gte: "${oneMonthAgo.toISOString()}" }
        }
      ) {
        nodes { ${issueFields} }
      }
    }
  `;

  try {
    const fetchIssues = async (query) => {
      const res = await fetch(LINEAR_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': LINEAR_API_KEY },
        body: JSON.stringify({ query })
      });
      if (!res.ok) throw new Error(`Linear API エラー: ${res.status} ${res.statusText}`);
      const data = await res.json();
      if (data.errors) throw new Error(`GraphQL エラー: ${JSON.stringify(data.errors)}`);
      return data.data.issues.nodes;
    };

    const activeIssues = await fetchIssues(activeQuery);
    console.log(`✅ ${activeIssues.length}件の未完了イシューを取得しました`);

    const completedIssues = await fetchIssues(completedQuery);
    console.log(`✅ ${completedIssues.length}件の1ヶ月以内に完了したイシューを取得しました`);

    const allIssues = [...activeIssues, ...completedIssues];
    console.log(`✅ 合計 ${allIssues.length}件のイシューを取得しました`);

    // Linearラベルで絞り込み・分類
    const filteredIssues = allIssues
      .map(issue => ({
        issue,
        label: detectLabel(issue.labels?.nodes || [])
      }))
      .filter(({ label }) => label !== null);

    console.log(`✅ ${filteredIssues.length}件の候補者イシューをラベルでフィルタしました`);

    const transformedTasks = filteredIssues.map(({ issue, label }) => ({
      id: issue.id,
      identifier: issue.identifier,
      title: issue.title,
      originalTitle: issue.title,
      url: issue.url,
      assignee: issue.assignee ? {
        id: issue.assignee.id,
        name: issue.assignee.displayName || issue.assignee.name
      } : null,
      dueDate: issue.dueDate,
      priority: issue.priority ?? 0,
      label,
      state: { id: issue.state.id, name: issue.state.name, type: issue.state.type },
      subIssues: (issue.children?.nodes || []).map(sub => ({
        id: sub.id,
        identifier: sub.identifier,
        title: sub.title,
        url: sub.url,
        dueDate: sub.dueDate,
        completedAt: sub.completedAt || null,
        state: { id: sub.state.id, name: sub.state.name, type: sub.state.type },
        labels: [],
        createdAt: sub.createdAt,
        updatedAt: sub.updatedAt
      })),
      createdAt: issue.createdAt,
      updatedAt: issue.updatedAt
    }));

    const summary = {};
    for (const label of Object.values(STATUS_LABELS)) {
      summary[label] = transformedTasks.filter(t => t.label === label).length;
    }

    const result = {
      fetchedAt: new Date().toISOString(),
      totalCount: transformedTasks.length,
      magazines: transformedTasks,
      summary
    };

    const outputPath = path.join(__dirname, '..', 'data', 'linear-data.json');
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, JSON.stringify(result, null, 2));

    console.log('💾 データを data/linear-data.json に保存しました');
    console.log('\n📈 フェーズ別候補者数:');
    for (const [label, count] of Object.entries(summary)) {
      console.log(`  ${label}: ${count}件`);
    }
    console.log(`  合計: ${result.totalCount}件\n`);

    return result;
  } catch (error) {
    console.error('❌ エラーが発生しました:', error.message);
    if (error.stack) console.error(error.stack);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  fetchLinearData();
}

export default fetchLinearData;
