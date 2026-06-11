#!/usr/bin/env node

/**
 * 候補者登録CLIスクリプト
 *
 * 実行: npm run new-candidate
 *
 * 対話形式で候補者情報を入力すると、Linearに以下を自動作成する:
 *   1. 候補者の親イシュー（ラベル・優先度・期限日付き）
 *   2. フェーズに応じたサブタスク（子イシュー）
 */

import 'dotenv/config';
import { select, input, confirm } from '@inquirer/prompts';
import { LINEAR_API_URL, LINEAR_TEAM_KEY, LINEAR_LABEL_MAP, PRIORITY_MAP } from '../config/settings.js';
import { TASK_TEMPLATES } from '../config/task-templates.js';

const LINEAR_API_KEY = process.env.MAGAZINE_LINEAR_API_KEY;

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

async function fetchTeamAndLabels() {
  const data = await callLinearAPI(`
    query {
      teams(filter: { key: { eq: "${LINEAR_TEAM_KEY}" } }) {
        nodes { id key name }
      }
    }
  `);

  const team = data.teams.nodes[0];
  if (!team) throw new Error(`チーム "${LINEAR_TEAM_KEY}" が見つかりません`);

  const labelData = await callLinearAPI(`
    query {
      issueLabels(first: 100) {
        nodes { id name }
      }
    }
  `);

  return { team, labels: labelData.issueLabels.nodes };
}

async function createIssue({ teamId, title, labelId, priority, dueDate }) {
  const input = { teamId, title, priority };
  if (labelId) input.labelIds = [labelId];
  if (dueDate) input.dueDate = dueDate;

  const data = await callLinearAPI(`
    mutation IssueCreate($input: IssueCreateInput!) {
      issueCreate(input: $input) {
        success
        issue { id identifier title url }
      }
    }
  `, { input });

  if (!data.issueCreate.success) throw new Error('イシューの作成に失敗しました');
  return data.issueCreate.issue;
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

async function main() {
  if (!LINEAR_API_KEY) {
    console.error('❌ MAGAZINE_LINEAR_API_KEY が設定されていません');
    process.exit(1);
  }

  console.log('\n👤 候補者登録\n');

  // ① 候補者情報の入力
  const candidateName = await input({ message: '候補者名:' });

  const phaseChoice = await select({
    message: 'フェーズ:',
    choices: LINEAR_LABEL_MAP.map(({ labelName }) => ({
      name: labelName,
      value: labelName,
    })),
  });

  const priorityChoice = await select({
    message: '優先度:',
    choices: [
      { name: 'Urgent', value: 1 },
      { name: 'High',   value: 2 },
      { name: 'Medium', value: 3 },
      { name: 'Low',    value: 4 },
    ],
  });

  let dueDate = null;
  const hasDueDate = await confirm({ message: '次回連絡予定日 (Due Date) を設定しますか？', default: true });
  if (hasDueDate) {
    dueDate = await input({
      message: '日付 (YYYY-MM-DD):',
      validate: (v) => /^\d{4}-\d{2}-\d{2}$/.test(v) ? true : 'YYYY-MM-DD の形式で入力してください',
    });
  }

  const title = candidateName;

  console.log(`\n→ Linearにイシューを作成中...`);

  // ② Linearからチーム・ラベル情報を取得
  const { team, labels } = await fetchTeamAndLabels();
  const matchedLabel = labels.find(l => l.name === phaseChoice);

  if (!matchedLabel) {
    console.warn(`⚠️  ラベル "${phaseChoice}" がLinearに見つかりません。ラベルなしで作成します。`);
    console.warn('   Linearの Settings → Issues → Labels でラベルを作成してください。');
  }

  // ③ 親イシュー作成
  const issue = await createIssue({
    teamId: team.id,
    title,
    labelId: matchedLabel?.id || null,
    priority: priorityChoice,
    dueDate,
  });

  console.log(`✅ ${issue.identifier} "${issue.title}" を作成しました`);
  console.log(`   ${issue.url}`);

  // ④ フェーズに対応するサブタスクを作成
  if (phaseChoice === '面接') {
    // 面接フェーズは企業ごとにサブタスクを作成
    console.log('\n面接フェーズ：企業名を入力してください（空欄でEnterを押すと終了）');
    const companies = [];
    let idx = 1;
    while (true) {
      const co = await input({ message: `企業名 ${idx}:` });
      if (!co.trim()) break;
      companies.push(co.trim());
      idx++;
    }

    if (companies.length === 0) {
      console.log('\n✅ 完了！（企業なしで作成しました）');
    } else {
      const templateTasks = TASK_TEMPLATES['面接'] || [];
      let total = 0;
      console.log(`\n→ ${companies.length} 社 × ${templateTasks.length} 件のサブタスクを作成中...`);
      for (const company of companies) {
        for (const taskTitle of templateTasks) {
          const subTitle = `【${company}】${taskTitle}`;
          await createSubIssue({ teamId: team.id, parentId: issue.id, title: subTitle });
          console.log(`   ✅ ${subTitle}`);
          total++;
        }
      }
      console.log(`\n✅ 完了！合計 ${total} 件のサブタスクを作成しました。`);
    }
  } else {
    const subTaskTitles = TASK_TEMPLATES[phaseChoice] || [];
    if (subTaskTitles.length > 0) {
      console.log(`\n→ サブタスク ${subTaskTitles.length} 件を作成中...`);
      for (const taskTitle of subTaskTitles) {
        await createSubIssue({ teamId: team.id, parentId: issue.id, title: taskTitle });
        console.log(`   ✅ ${taskTitle}`);
      }
      console.log(`\n✅ 完了！合計 ${subTaskTitles.length} 件のサブタスクを作成しました。`);
    } else {
      console.log('\n✅ 完了！（このフェーズにはサブタスクテンプレートがありません）');
    }
  }

  console.log('\nLinearで確認してください:', issue.url);
}

main().catch(err => {
  console.error('❌ エラーが発生しました:', err.message);
  process.exit(1);
});
