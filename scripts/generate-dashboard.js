#!/usr/bin/env node

/**
 * Generate HTML dashboard from health data
 *
 * Takes health-data.json and generates an HTML dashboard with:
 * - Health indicator section (overall + 3 categories)
 * - Task status section (3 columns)
 * - Calendar section (2 weeks before/after)
 */

import 'dotenv/config';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { convertAssigneeName, convertTitleEmoji } from '../config/mappings.js';
import { STATUS_LABELS, PIPELINE_ORDER } from '../config/settings.js';

const STAGE_ICONS = {
  [STATUS_LABELS.sourcing]:    '🔍',
  [STATUS_LABELS.contact]:     '📩',
  [STATUS_LABELS.caInterview]: '🤝',
  [STATUS_LABELS.resume]:      '📄',
  [STATUS_LABELS.offer]:       '🎉',
};
import { generateFallbackSuggestions } from './ai-suggestion-helpers.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function formatDate(dateStr) {
  const date = new Date(dateStr);
  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  return `${year}/${month}/${day}`;
}

function formatDateShort(date) {
  const month = date.getMonth() + 1;
  const day = date.getDate();
  return `${month}/${day}`;
}

/**
 * Generate health section HTML
 */
function generateHealthSection(healthData) {
  const { overallHealth, stageHealth, summary, thresholds } = healthData;

  const getHealthLabelClass = (label) => {
    if (label === '順調') return 'good';
    if (label === '注意') return 'warning';
    if (label === '危険') return 'danger';
    return '';
  };

  const overallDetailsHtml = (overallHealth.details || '').replace(/\n/g, '<br>');
  const warningDays = thresholds?.stale_business_days?.healthy ?? 1;
  const dangerDays  = thresholds?.stale_business_days?.warning ?? 3;

  const stageCardsHtml = PIPELINE_ORDER.map(label => {
    const h    = stageHealth?.[label] || { status: '🟢', label: '順調', count: 0, staleCount: 0 };
    const icon = STAGE_ICONS[label] || '📌';
    const shortLabel = label.replace('・候補者発掘', '').replace('初回コンタクト', 'コンタクト');
    return `
                <div class="health-card">
                    <h3>${icon} ${escapeHtml(shortLabel)}</h3>
                    <div class="health-indicator">${h.status}</div>
                    <div class="health-label ${getHealthLabelClass(h.label)}">${h.label}</div>
                    <div class="health-detail">${h.count}名<br><span style="font-size:0.85em;color:#e55;">滞留${h.staleCount}名</span></div>
                </div>`;
  }).join('');

  return `
        <!-- 1. パイプライン健康度（最上部） -->
        <div class="health-status">
            <h2>💊 候補者パイプライン健康度</h2>

            <!-- 全体の健康状態 -->
            <div class="health-overall">
                <h3>全体</h3>
                <div class="health-indicator">${overallHealth.status}</div>
                <div class="health-label ${getHealthLabelClass(overallHealth.label)}">${overallHealth.label}</div>
                <div class="health-detail">${overallDetailsHtml}</div>
            </div>

            <!-- パイプラインフェーズ別カード -->
            <div style="margin-top: 16px; margin-bottom: 6px; font-size: 0.85em; color: #888; font-weight: 600; letter-spacing: 0.05em;">📊 フェーズ別状況（総${summary?.total ?? 0}名 / 要対応${summary?.staleCount ?? 0}名）</div>
            <div class="health-grid" style="grid-template-columns: repeat(6, 1fr);">
                ${stageCardsHtml}
            </div>

            <!-- 判断基準 -->
            <div class="health-criteria">
                <div style="text-align: center;">
                    <div style="display: flex; gap: 15px; justify-content: center; font-size: 0.9em;">
                        <span><span style="font-size: 1.2em;">🟢</span> ${warningDays}営業日未満</span>
                        <span><span style="font-size: 1.2em;">🟡</span> ${warningDays}〜${dangerDays - 1}営業日</span>
                        <span><span style="font-size: 1.2em;">🔴</span> ${dangerDays}営業日以上（最終更新から）</span>
                    </div>
                </div>
            </div>
        </div>
  `;
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatActions(actionText) {
  if (!actionText) return '';

  const items = actionText
    .split('\n')
    .map(line => line.replace(/^•\s*/, '').trim())
    .filter(Boolean);

  if (items.length === 0) return '';

  const listItems = items.map(item => `<li>${escapeHtml(item)}</li>`).join('');

  return `
                <div class="suggestion-action">
                    <strong>推奨アクション</strong>
                    <ul>${listItems}</ul>
                </div>
  `;
}

function generateAISuggestionsSection(aiInfo) {
  const suggestions = Array.isArray(aiInfo?.suggestions) ? aiInfo.suggestions : [];

  if (suggestions.length === 0) {
    return `
        <div class="ai-suggestions">
            <h2>AIからの提案</h2>
            <div class="ai-suggestions-note">AI提案データが見つからなかったため、健康度データから推奨事項を生成できませんでした。</div>
        </div>
    `;
  }

  const priorityIcons = { high: '🔥', medium: '🧭', low: '🌱' };

  const generatedAt = aiInfo?.generatedAt
    ? new Date(aiInfo.generatedAt).toLocaleString('ja-JP', {
        timeZone: 'Asia/Tokyo', month: 'long', day: 'numeric',
        hour: '2-digit', minute: '2-digit'
      })
    : '取得日時不明';

  const sourceLabel = aiInfo?.source === 'gemini'
    ? `Gemini${aiInfo?.model ? ` (${aiInfo.model})` : ''} で生成`
    : '健康度データから自動生成';

  const note = aiInfo?.note
    ? escapeHtml(String(aiInfo.note).slice(0, 160) + (String(aiInfo.note).length > 160 ? '…' : ''))
    : '';

  const itemsHTML = suggestions.map(suggestion => {
    const priority = suggestion.priority || 'info';
    const icon = priorityIcons[priority] || '💡';
    const priorityClass = `priority-${priority}`;
    const problem = escapeHtml(suggestion.problem || '状況説明なし');
    const actions = formatActions(suggestion.action);
    const label = escapeHtml(suggestion.priorityLabel || '優先度：情報');

    return `
            <div class="suggestion-item">
                <div class="suggestion-icon">${icon}</div>
                <div class="suggestion-content">
                    <span class="suggestion-priority ${priorityClass}">${label}</span>
                    <h3>${problem}</h3>
                    ${actions}
                </div>
            </div>
    `;
  }).join('');

  return `
        <!-- 2. AIサジェスト -->
        <div class="ai-suggestions">
            <h2>AIからの提案</h2>
            <div class="ai-suggestions-meta">
                <span>${escapeHtml(sourceLabel)}</span>
            </div>
            ${note ? `<div class="ai-suggestions-note">${note}</div>` : ''}
${itemsHTML}
        </div>
  `;
}

/**
 * Generate task status section (today's actions + pipeline list)
 */
function generateTaskStatusSection(healthData) {
  const { magazines, todayActions, thresholds } = healthData;
  const warningDays = thresholds?.stale_business_days?.healthy ?? 1;

  const getBadgeClass = (status) => {
    if (status === '🔴') return 'overdue';
    if (status === '🟡') return 'warning';
    return 'good';
  };

  // 今日の対応リスト
  const actions = todayActions || [];
  const todayActionItems = actions.length === 0
    ? '<div style="color:#888; padding:12px 0;">対応が必要な候補者はいません ✅</div>'
    : actions.map(task => {
        const { title, label, stalenessStatus, dueDate } = task;
        const badgeClass = getBadgeClass(stalenessStatus?.status);
        const dueDateStr = dueDate ? `　面接/期限: ${formatDate(dueDate)}` : '';
        return `
                    <div class="task-item" style="display:flex; align-items:center; gap:10px; padding:8px 0; border-bottom:1px solid #f0f0f0;">
                        <span class="task-due ${badgeClass}" style="white-space:nowrap;">${escapeHtml(stalenessStatus?.message || '')}</span>
                        <span style="font-size:0.78em; color:#888; white-space:nowrap;">${escapeHtml(label || '')}</span>
                        <span class="task-title" style="flex:1;">${escapeHtml(convertTitleEmoji(title))}</span>
                        ${dueDateStr ? `<span style="font-size:0.8em;color:#aaa;">${escapeHtml(dueDateStr)}</span>` : ''}
                    </div>`;
      }).join('');

  // フェーズ別候補者リスト
  const sortByStaleness = (a, b) => (b.staleDays ?? -1) - (a.staleDays ?? -1);
  const filterAndSort = (label) =>
    magazines.filter(m => m.label === label && m.state?.type !== 'completed').sort(sortByStaleness);

  const generateCandidateItems = (taskList) => {
    if (taskList.length === 0) {
      return '<li class="task-item"><div class="task-title" style="color:#bbb;">候補者なし</div></li>';
    }
    return taskList.map(task => {
      const { title, assignee, dueDate, stalenessStatus } = task;
      const staleInfo = stalenessStatus?.message
        ? `<div class="task-detail">${escapeHtml(stalenessStatus.message)}</div>` : '';
      const dueDateStr = dueDate ? formatDateShort(new Date(dueDate)) : '未設定';
      const badgeClass = getBadgeClass(stalenessStatus?.status);
      return `
                            <li class="task-item">
                                <div class="task-title">${escapeHtml(convertTitleEmoji(title))}</div>
                                <div class="task-meta">
                                    <span class="task-assignee">${escapeHtml(convertAssigneeName(assignee?.name))}</span>
                                    <span class="task-due ${badgeClass}"><span class="due-label">期限:</span>${dueDateStr}</span>
                                </div>
                                ${staleInfo}
                            </li>`;
    }).join('');
  };

  const makeColumn = (label, tasks) => {
    const icon = STAGE_ICONS[label] || '📌';
    return `
                <div class="process-section">
                    <h3>${icon} ${escapeHtml(label)} <span style="font-size: 0.6em; color: #666; font-weight: normal;">(${tasks.length}名)</span></h3>
                    <div class="status-group">
                        <ul class="task-list">${generateCandidateItems(tasks)}</ul>
                    </div>
                </div>`;
  };

  const stageColumns = PIPELINE_ORDER.map(label => makeColumn(label, filterAndSort(label))).join('');

  return `
        <!-- 3. 今日の対応リスト -->
        <div class="details-section">
            <h2>🚨 今日の対応リスト（${warningDays}営業日以上更新なし）</h2>
            <div style="padding: 4px 0;">
                ${todayActionItems}
            </div>
        </div>

        <!-- 4. フェーズ別候補者一覧 -->
        <div class="details-section">
            <h2>📋 フェーズ別候補者一覧</h2>

            <!-- 凡例 -->
            <div class="status-legend">
                <div class="legend-item"><div class="legend-dot good"></div><span class="legend-label">${warningDays}営業日未満</span></div>
                <div class="legend-item"><div class="legend-dot warning"></div><span class="legend-label">${warningDays}〜${(thresholds?.stale_business_days?.warning ?? 3) - 1}営業日</span></div>
                <div class="legend-item"><div class="legend-dot overdue"></div><span class="legend-label">${thresholds?.stale_business_days?.warning ?? 3}営業日以上</span></div>
            </div>

            <div class="process-grid" style="grid-template-columns: repeat(6, 1fr); margin-top: 12px;">
                ${stageColumns}
            </div>
        </div>
  `;
}

/**
 * Generate calendar section
 */
function generateCalendarSection(healthData) {
  const { magazines } = healthData;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const startDate = new Date(today);
  startDate.setDate(today.getDate() - 14 - today.getDay());

  const endDate = new Date(startDate);
  endDate.setDate(startDate.getDate() + 35);

  const calendarDays = [];
  const currentDate = new Date(startDate);
  while (currentDate < endDate) {
    calendarDays.push(new Date(currentDate));
    currentDate.setDate(currentDate.getDate() + 1);
  }

  const tasksByDate = {};
  magazines.forEach(task => {
    if (task.dueDate) {
      const dueDate = new Date(task.dueDate);
      dueDate.setHours(0, 0, 0, 0);
      const dateKey = dueDate.toISOString().split('T')[0];
      if (!tasksByDate[dateKey]) tasksByDate[dateKey] = [];

      let phase = 'sourcing';
      if (task.label === STATUS_LABELS.contact)         phase = 'contact';
      else if (task.label === STATUS_LABELS.caInterview)     phase = 'ca';
      else if (task.label === STATUS_LABELS.resume)          phase = 'resume';
      else if (task.label === STATUS_LABELS.clientInterview) phase = 'client';
      else if (task.label === STATUS_LABELS.offer)           phase = 'offer';

      if (task.state?.type === 'completed') phase = 'completed';

      tasksByDate[dateKey].push({ title: convertTitleEmoji(task.title), phase, task });
    }
  });

  const calendarDaysHTML = calendarDays.map(date => {
    const dateKey = date.toISOString().split('T')[0];
    const isToday = date.getTime() === today.getTime();
    const tasksOnThisDay = tasksByDate[dateKey] || [];

    const tasksHTML = tasksOnThisDay.map(t =>
      `<div class="calendar-task phase-${t.phase}">${escapeHtml(t.title)}</div>`
    ).join('');

    const todayLabel = isToday ? '<div style="font-weight: bold; color: #D60C52; font-size: 0.75em;">今日</div>' : '';

    return `
                <div class="calendar-day${isToday ? ' today' : ''}">
                    <div class="calendar-day-number">${formatDateShort(date)}</div>
                    ${todayLabel}
                    ${tasksHTML}
                </div>
    `;
  }).join('');

  return `
        <!-- 4. カレンダー -->
        <div class="calendar-section">
            <h2>📅 期限カレンダー（前後2週間）</h2>

            <!-- カレンダー凡例 -->
            <div class="calendar-legend">
                <div class="calendar-legend-item">
                    <div class="calendar-legend-box manuscript"></div>
                    <span class="calendar-legend-label">スカウト/コンタクト</span>
                </div>
                <div class="calendar-legend-item">
                    <div class="calendar-legend-box video"></div>
                    <span class="calendar-legend-label">CA面談/書類</span>
                </div>
                <div class="calendar-legend-item">
                    <div class="calendar-legend-box" style="background: #6366f1;"></div>
                    <span class="calendar-legend-label">企業面接/内定</span>
                </div>
                <div class="calendar-legend-item">
                    <div class="calendar-legend-box published"></div>
                    <span class="calendar-legend-label">完了済み</span>
                </div>
            </div>

            <div class="calendar-grid">
                <!-- 曜日ヘッダー -->
                <div class="calendar-header">日</div>
                <div class="calendar-header">月</div>
                <div class="calendar-header">火</div>
                <div class="calendar-header">水</div>
                <div class="calendar-header">木</div>
                <div class="calendar-header">金</div>
                <div class="calendar-header">土</div>

                ${calendarDaysHTML}
            </div>
        </div>
  `;
}

async function loadAISuggestions(healthData) {
  const aiDataPath = path.join(__dirname, '..', 'data', 'ai-suggestions.json');

  try {
    const content = await fs.readFile(aiDataPath, 'utf-8');
    const parsed = JSON.parse(content);

    if (!Array.isArray(parsed.suggestions) || parsed.suggestions.length !== 3) {
      throw new Error('AI提案が3件揃っていません');
    }

    return parsed;
  } catch (error) {
    console.warn('⚠️  ai-suggestions.json の読み込みに失敗しました。フォールバック提案を使用します。', error.message);
    return {
      generatedAt: new Date().toISOString(),
      source: 'fallback',
      model: null,
      note: 'ai-suggestions.json が見つからないため、健康度データから再生成しました',
      suggestions: generateFallbackSuggestions(healthData)
    };
  }
}

/**
 * Generate complete HTML dashboard
 */
async function generateDashboard() {
  console.log('📊 ダッシュボードHTMLを生成中...');

  const dataPath = path.join(__dirname, '..', 'data', 'health-data.json');
  let healthData;
  try {
    const dataContent = await fs.readFile(dataPath, 'utf-8');
    healthData = JSON.parse(dataContent);
  } catch (error) {
    console.error('❌ health-data.json の読み込みに失敗しました:', error.message);
    console.log('💡 先に npm run calculate-health を実行してください');
    process.exit(1);
  }

  const updateTime = new Date(healthData.calculatedAt).toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });

  const stylesPath = path.join(__dirname, '..', 'config', 'dashboard-styles.css');
  let styles = await fs.readFile(stylesPath, 'utf-8');

  const healthSection = generateHealthSection(healthData);
  const aiSuggestionsInfo = await loadAISuggestions(healthData);
  const aiSuggestionsSection = generateAISuggestionsSection(aiSuggestionsInfo);
  const taskStatusSection = generateTaskStatusSection(healthData);
  const calendarSection = generateCalendarSection(healthData);

  const html = `<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>候補者対応ダッシュボード</title>
    <style>
${styles}
        .health-grid { grid-template-columns: repeat(3, 1fr); }
        .process-grid { grid-template-columns: repeat(3, 1fr); }
        .phase-phone { background: #f97316; color: white; }
        .phase-internal { background: #6366f1; color: white; }
        .phase-completed { background: #6b7280; color: white; }
    </style>
</head>
<body>
    <div class="container">
        <h1>📊 候補者対応ダッシュボード</h1>
        <div class="subtitle">${updateTime} 更新</div>

${healthSection}

${aiSuggestionsSection}

${taskStatusSection}

${calendarSection}
    </div>
</body>
</html>
`;

  const outputDir = path.join(__dirname, '..', 'output');
  await fs.mkdir(outputDir, { recursive: true });

  const outputPath = path.join(outputDir, 'dashboard.html');
  await fs.writeFile(outputPath, html);

  console.log('✅ ダッシュボードを生成しました: output/dashboard.html');
  console.log(`📊 データ更新日時: ${updateTime}`);

  return { outputPath, healthData };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  generateDashboard().catch(error => {
    console.error('❌ エラーが発生しました:', error.message);
    if (error.stack) console.error(error.stack);
    process.exit(1);
  });
}

export default generateDashboard;
