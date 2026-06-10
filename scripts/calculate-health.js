#!/usr/bin/env node

/**
 * 候補者対応パイプラインの健康度を計算
 *
 * 健康度は「最終更新からの経過日数（滞留日数）」で判定:
 *   🟢 順調: 3日未満
 *   🟡 注意: 3〜6日
 *   🔴 危険: 7日以上
 */

import 'dotenv/config';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';
import { STATUS_LABELS, PIPELINE_ORDER } from '../config/settings.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function loadThresholds() {
  const configPath = path.join(__dirname, '..', 'config', 'health-thresholds.yaml');
  const configContent = await fs.readFile(configPath, 'utf-8');
  return yaml.load(configContent);
}

function calculateStaleDays(updatedAt, today) {
  if (!updatedAt) return null;
  const updated = new Date(updatedAt);
  updated.setHours(0, 0, 0, 0);
  return Math.floor((today - updated) / (1000 * 60 * 60 * 24));
}

function determineStalenessStatus(staleDays, thresholds) {
  if (staleDays === null) {
    return { status: '🟡', label: '注意', message: '更新日不明' };
  }
  const warningDays = thresholds.stale_days?.healthy ?? 3;
  const dangerDays = thresholds.stale_days?.warning ?? 7;
  if (staleDays < warningDays) {
    return {
      status: '🟢', label: '順調',
      message: staleDays === 0 ? '本日更新' : `${staleDays}日前に更新`
    };
  }
  if (staleDays < dangerDays) {
    return { status: '🟡', label: '注意', message: `${staleDays}日間更新なし` };
  }
  return { status: '🔴', label: '危険', message: `${staleDays}日間更新なし` };
}

function getStageHealth(tasks) {
  if (tasks.length === 0) {
    return { status: '🟢', label: '順調', count: 0, staleCount: 0, shortReason: '' };
  }
  const redCount   = tasks.filter(t => t.stalenessStatus?.status === '🔴').length;
  const yellowCount = tasks.filter(t => t.stalenessStatus?.status === '🟡').length;
  const staleCount  = redCount + yellowCount;

  if (redCount > 0) {
    return {
      status: '🔴', label: '危険', count: tasks.length, staleCount,
      shortReason: `${redCount}名が長期間未対応`
    };
  }
  if (yellowCount > 0) {
    return {
      status: '🟡', label: '注意', count: tasks.length, staleCount,
      shortReason: `${yellowCount}名に対応が必要`
    };
  }
  return { status: '🟢', label: '順調', count: tasks.length, staleCount: 0, shortReason: '' };
}

function getOverallHealth(stageHealth) {
  const healths = Object.values(stageHealth);
  const hasRed    = healths.some(h => h.status === '🔴');
  const hasYellow = healths.some(h => h.status === '🟡');
  const reasons   = healths.filter(h => h.shortReason).map(h => h.shortReason);

  if (hasRed) {
    return { status: '🔴', label: '危険', details: reasons.join('\n') || '対応が必要な候補者がいます' };
  }
  if (hasYellow) {
    return { status: '🟡', label: '注意', details: reasons.join('\n') || '注意が必要な候補者がいます' };
  }
  return { status: '🟢', label: '順調', details: '全ての候補者が順調に進んでいます' };
}

async function calculateHealth() {
  console.log('🧮 健康度を計算中...');

  const dataPath = path.join(__dirname, '..', 'data', 'linear-data.json');
  let linearData;
  try {
    const dataContent = await fs.readFile(dataPath, 'utf-8');
    linearData = JSON.parse(dataContent);
  } catch (error) {
    console.error('❌ linear-data.json の読み込みに失敗しました:', error.message);
    console.log('💡 先に npm run fetch-data を実行してください');
    process.exit(1);
  }

  const thresholds = await loadThresholds();
  console.log('✅ 閾値設定を読み込みました');

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // 各候補者に滞留日数と健康状態を付与
  const enrichedTasks = linearData.magazines.map(task => {
    const staleDays = calculateStaleDays(task.updatedAt, today);
    const stalenessStatus = determineStalenessStatus(staleDays, thresholds);
    return {
      ...task,
      staleDays,
      stalenessStatus,
      displayHealthStatus: stalenessStatus,
    };
  });

  // アクティブな候補者のみを対象（完了除く）
  const activeTasks = enrichedTasks.filter(t => t.state?.type !== 'completed');

  // フェーズ別グループ化
  const stageMap = {};
  for (const label of PIPELINE_ORDER) {
    stageMap[label] = activeTasks.filter(t => t.label === label);
  }

  // フェーズ別健康度
  const stageHealth = {};
  for (const [label, tasks] of Object.entries(stageMap)) {
    stageHealth[label] = getStageHealth(tasks);
  }

  // 全体健康度
  const overallHealth = getOverallHealth(stageHealth);

  // 今日の対応リスト（滞留日数3日以上の候補者、滞留日数降順）
  const warningDays = thresholds.stale_days?.healthy ?? 3;
  const todayActions = activeTasks
    .filter(t => t.staleDays !== null && t.staleDays >= warningDays)
    .sort((a, b) => (b.staleDays ?? 0) - (a.staleDays ?? 0));

  // サマリー
  const summary = {
    total: activeTasks.length,
    staleCount: todayActions.length,
    byStage: {}
  };
  for (const label of PIPELINE_ORDER) {
    summary.byStage[label] = stageMap[label].length;
  }

  const result = {
    calculatedAt: new Date().toISOString(),
    magazines: enrichedTasks,
    overallHealth,
    stageHealth,
    todayActions,
    summary,
    thresholds,
  };

  const outputPath = path.join(__dirname, '..', 'data', 'health-data.json');
  await fs.writeFile(outputPath, JSON.stringify(result, null, 2));

  console.log('💾 健康度データを data/health-data.json に保存しました');
  console.log('\n📊 健康度サマリー:');
  console.log(`  全体: ${overallHealth.status} ${overallHealth.label}`);
  for (const label of PIPELINE_ORDER) {
    const h = stageHealth[label];
    console.log(`  ${label}: ${h.status} ${h.label} (${h.count}名, 滞留${h.staleCount}名)`);
  }
  console.log(`  要対応: ${todayActions.length}件\n`);

  return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  calculateHealth().catch(error => {
    console.error('❌ エラーが発生しました:', error.message);
    if (error.stack) console.error(error.stack);
    process.exit(1);
  });
}

export default calculateHealth;
