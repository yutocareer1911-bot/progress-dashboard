#!/usr/bin/env node

import 'dotenv/config';
import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { STATUS_LABELS, PIPELINE_ORDER } from '../config/settings.js';

import { generateFallbackSuggestions } from './ai-suggestion-helpers.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function generateAISuggestions() {
  console.log('🤖 Gemini APIでAI提案を生成中...');

  // API Key確認
  const apiKey = process.env.MAGAZINE_GEMINI_API_KEY;

  let healthData;
  try {
    const healthDataPath = path.join(__dirname, '..', 'data', 'health-data.json');
    healthData = JSON.parse(await fs.readFile(healthDataPath, 'utf-8'));
  } catch (error) {
    console.error('❌ 健康度データの読み込みに失敗しました:', error.message);
    console.log('💡 先に npm run calculate-health を実行してください');
    process.exit(1);
  }

    console.log('📊 健康度データ読み込み完了:', {
      全体: healthData.overallHealth?.label,
      要対応: healthData.summary?.staleCount ?? 0,
      総候補者数: healthData.summary?.total ?? 0,
    });

  let suggestions;
  let source = 'gemini';
  let modelName = null;
  let fallbackReason = null;

  if (!apiKey) {
    console.warn('⚠️  MAGAZINE_GEMINI_API_KEY が設定されていません。フォールバック提案を生成します。');
    suggestions = generateFallbackSuggestions(healthData);
    source = 'fallback';
    fallbackReason = 'APIキー未設定';
  } else {
    try {
      const promptPath = path.join(__dirname, '..', 'config', 'ai-prompts', 'unified.md');
      const promptTemplate = await fs.readFile(promptPath, 'utf-8');

      const context = buildContext(healthData);
      const prompt = promptTemplate.replace('{{CONTEXT}}', context);

      console.log('📝 プロンプト生成完了（文字数:', prompt.length, '）');

      const genAI = new GoogleGenerativeAI(apiKey);
      const preferredModel = process.env.MAGAZINE_GEMINI_MODEL;
      const modelCandidates = [];
      if (preferredModel) {
        modelCandidates.push(preferredModel);
      }

      const defaultModels = [
        'models/gemini-3-flash-preview',
        'models/gemini-2.5-flash',
      ];

      defaultModels.forEach(model => {
        if (!modelCandidates.includes(model)) {
          modelCandidates.push(model);
        }
      });

      let model;
      let lastError;

      for (const candidate of modelCandidates) {
        try {
          modelName = candidate;
          console.log(`📦 モデル候補を初期化: ${modelName}`);
          model = genAI.getGenerativeModel({ model: modelName });
          console.log('🚀 Gemini API にリクエスト送信中...');
          const result = await model.generateContent(prompt);
          const response = await result.response;
          const text = response.text();
          console.log('✅ Geminiからレスポンスを受信（文字数:', text.length, '）');

          const parsedSuggestions = parseAISuggestions(text);
          if (!Array.isArray(parsedSuggestions) || parsedSuggestions.length !== 3) {
            throw new Error(`AI提案の形式が不正です。3つの提案が必要ですが、${parsedSuggestions?.length ?? 0}個でした。`);
          }

          suggestions = parsedSuggestions;
          lastError = null;
          break;
        } catch (error) {
          console.warn(`⚠️  モデル ${modelName} の呼び出しに失敗しました: ${error.message}`);
          lastError = error;
          model = null;
        }
      }

      if (!suggestions) {
        throw lastError || new Error('利用可能なGeminiモデルでの生成に失敗しました');
      }
    } catch (error) {
      console.error('⚠️  Gemini APIの呼び出しに失敗しました:', error.message);
      if (error.stack) {
        console.error('スタックトレース:', error.stack);
      }
      suggestions = generateFallbackSuggestions(healthData);
      source = 'fallback';
      fallbackReason = error.message;
    }
  }

  if (!Array.isArray(suggestions) || suggestions.length !== 3) {
    console.warn('⚠️  フォールバック生成の結果が不足していたため、デフォルト提案を再生成します。');
    suggestions = generateFallbackSuggestions(healthData);
    source = 'fallback';
    fallbackReason = fallbackReason || 'フォールバック再生成';
  }

  const outputDir = path.join(__dirname, '..', 'data');
  await fs.mkdir(outputDir, { recursive: true });

  const outputData = {
    generatedAt: new Date().toISOString(),
    source,
    model: source === 'gemini' ? modelName : null,
    note: fallbackReason || undefined,
    suggestions
  };

  const outputPath = path.join(outputDir, 'ai-suggestions.json');
  await fs.writeFile(outputPath, JSON.stringify(outputData, null, 2), 'utf-8');

  if (source === 'fallback') {
    console.log('✅ フォールバック提案を保存しました:', outputPath);
    if (fallbackReason) {
      console.log('ℹ️  フォールバック理由:', fallbackReason);
    }
  } else {
    console.log('✅ Gemini生成のAI提案を保存しました:', outputPath);
  }

  console.log('\n🎯 生成されたAI提案:');
  suggestions.forEach((suggestion, index) => {
    console.log(`\n${index + 1}. ${suggestion.priorityLabel}`);
    console.log(`   問題: ${suggestion.problem}`);
    console.log(`   アクション:\n${suggestion.action.split('\n').map(line => `   ${line}`).join('\n')}`);
  });
  console.log('');

  return outputPath;
}

/**
 * 健康度データから AI用のコンテキストを生成
 */
function buildContext(healthData) {
  const lines = [];
  const { overallHealth, stageHealth, todayActions, summary } = healthData;

  lines.push('### 全体状況');
  lines.push(`- **全体健康度**: ${overallHealth?.status} ${overallHealth?.label}`);
  lines.push(`- **総候補者数**: ${summary?.total ?? 0}名（アクティブ）`);
  lines.push(`- **要対応候補者数**: ${summary?.staleCount ?? 0}名（3日以上更新なし）`);
  lines.push('');

  lines.push('### フェーズ別候補者数と健康度');
  for (const label of PIPELINE_ORDER) {
    const h = stageHealth?.[label] || {};
    lines.push(`- **${label}**: ${h.count ?? 0}名 ${h.status ?? ''} ${h.label ?? ''} (滞留${h.staleCount ?? 0}名)`);
  }
  lines.push('');

  if (todayActions && todayActions.length > 0) {
    lines.push('### 今日の対応が必要な候補者（滞留3日以上）');
    todayActions.slice(0, 10).forEach(t => {
      lines.push(`- 【${t.title}】${t.label} ${t.stalenessStatus?.status ?? ''} ${t.stalenessStatus?.message ?? ''}`);
    });
    lines.push('');
  }

  lines.push('### その他の統計');
  lines.push(`- **生成日時**: ${new Date(healthData.calculatedAt).toLocaleString('ja-JP')}`);

  return lines.join('\n');
}

/**
 * Geminiのレスポンスから JSON を抽出してパース
 */
function parseAISuggestions(text) {
  // コードブロックを除去
  let jsonText = text.trim();

  // ```json ... ``` または ``` ... ``` を除去
  jsonText = jsonText.replace(/^```json?\s*\n?/gm, '');
  jsonText = jsonText.replace(/\n?```\s*$/gm, '');

  // 余計な前後のテキストを除去（JSON配列の開始/終了を見つける）
  const jsonStart = jsonText.indexOf('[');
  const jsonEnd = jsonText.lastIndexOf(']');

  if (jsonStart === -1 || jsonEnd === -1) {
    throw new Error('JSONが見つかりませんでした。レスポンス: ' + text.substring(0, 500));
  }

  jsonText = jsonText.substring(jsonStart, jsonEnd + 1);

  try {
    const parsed = JSON.parse(jsonText);
    return parsed;
  } catch (error) {
    console.error('JSON パースエラー:', error.message);
    console.error('パース対象のテキスト:', jsonText.substring(0, 1000));
    throw new Error('JSONのパースに失敗しました: ' + error.message);
  }
}

// 実行
if (import.meta.url === `file://${process.argv[1]}`) {
  generateAISuggestions();
}

export default generateAISuggestions;
