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

const INTERVIEW_STAGES = ['カジュアル', '1次', '2次', '3次', '最終', 'オファー', '追加面談'];

async function askDate(message) {
  const raw = await input({
    message: `${message} (YYYYMMDD):`,
    validate: (v) => /^\d{8}$/.test(v) ? true : '8桁の数字で入力してください（例：20260615）',
  });
  const formatted = `${raw.slice(0,4)}/${raw.slice(4,6)}/${raw.slice(6,8)}`;
  return formatted;
}

async function handleInterviewPhase({ teamId, parentId }) {
  console.log('\n面接フェーズ：企業情報を入力してください（企業名を空欄でEnterすると終了）\n');
  let total = 0;
  let idx = 1;

  while (true) {
    const company = await input({ message: `企業名 ${idx}:` });
    if (!company.trim()) break;

    const stage = await select({
      message: '面接フェーズ:',
      choices: INTERVIEW_STAGES.map(s => ({ name: s, value: s })),
    });

    const prefix = `【${company.trim()} / ${stage}】`;
    const tasks = [];

    // 面接日程
    const hasSchedule = await confirm({ message: '面接日程は決まっていますか？', default: true });
    if (hasSchedule) {
      const date = await askDate('面接日程');
      tasks.push(`${prefix}面接日程: ${date}`);
    } else {
      tasks.push(`${prefix}面接日程の回収`);
    }

    // 意向の回収
    tasks.push(`${prefix}意向の回収`);

    // 参考情報
    const hasRef = await confirm({ message: '参考情報はありますか？', default: true });
    if (hasRef) {
      tasks.push(`${prefix}参考情報の送付`);
    } else {
      tasks.push(`${prefix}参考情報の依頼・送付`);
    }

    // 面接対策
    const hasPrepSchedule = await confirm({ message: '面接対策の日程は決まっていますか？', default: false });
    if (hasPrepSchedule) {
      const date = await askDate('面接対策日程');
      tasks.push(`${prefix}面接対策の実施: ${date}`);
    } else {
      tasks.push(`${prefix}面接対策の日程調整`);
    }

    console.log(`\n→ ${company.trim()} のサブタスク ${tasks.length} 件を作成中...`);
    for (const title of tasks) {
      await createSubIssue({ teamId, parentId, title });
      console.log(`   ✅ ${title}`);
      total++;
    }
    console.log('');
    idx++;
  }

  if (total === 0) {
    console.log('✅ 完了！（企業なしで作成しました）');
  } else {
    console.log(`✅ 完了！合計 ${total} 件のサブタスクを作成しました。`);
  }
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
    const raw = await input({
      message: '日付 (YYYYMMDD):',
      validate: (v) => /^\d{8}$/.test(v) ? true : '8桁の数字で入力してください（例：20260615）',
    });
    dueDate = `${raw.slice(0,4)}-${raw.slice(4,6)}-${raw.slice(6,8)}`;
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
    await handleInterviewPhase({ teamId: team.id, parentId: issue.id });
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
