#!/usr/bin/env node

/**
 * SharePoint / OneDrive Excel からデータ取得するスクリプト
 *
 * Linear版（fetch-data.js）の代替として使用する。
 * 設定が完了したら package.json の fetch-data コマンドをこちらに切り替える。
 *
 * 【事前に必要な設定】
 * Azure AD でアプリ登録し、以下を .env に追加する:
 *
 *   EXCEL_TENANT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
 *   EXCEL_CLIENT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
 *   EXCEL_CLIENT_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
 *   EXCEL_SHAREPOINT_SITE_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
 *   EXCEL_WORKBOOK_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx  （ExcelファイルのID）
 *
 * 【Excelファイルの構成】
 *
 *   シート1: 候補者一覧
 *   列: ID | 候補者名 | フェーズ | 優先度 | 次回連絡日(YYYY/MM/DD) | ステータス | 更新日時
 *
 *   シート2: サブタスク
 *   列: 候補者ID | タスク名 | 完了(TRUE/FALSE)
 *
 * 【Azureアプリ登録手順】
 *   1. https://portal.azure.com にアクセス
 *   2. Azure Active Directory → アプリの登録 → 新規登録
 *   3. API のアクセス許可 → Microsoft Graph → Sites.Read.All, Files.Read.All を追加
 *   4. 証明書とシークレット → クライアントシークレットを作成
 *   5. テナントID・クライアントIDをコピー
 */

import 'dotenv/config';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { STATUS_LABELS } from '../config/settings.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TENANT_ID     = process.env.EXCEL_TENANT_ID;
const CLIENT_ID     = process.env.EXCEL_CLIENT_ID;
const CLIENT_SECRET = process.env.EXCEL_CLIENT_SECRET;
const SITE_ID       = process.env.EXCEL_SHAREPOINT_SITE_ID;
const WORKBOOK_ID   = process.env.EXCEL_WORKBOOK_ID;

const PRIORITY_MAP = { 'Urgent': 1, 'High': 2, 'Medium': 3, 'Low': 4 };

async function getAccessToken() {
  const url = `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id:     CLIENT_ID,
    client_secret: CLIENT_SECRET,
    scope:         'https://graph.microsoft.com/.default',
    grant_type:    'client_credentials',
  });

  const res = await fetch(url, { method: 'POST', body });
  if (!res.ok) throw new Error(`認証エラー: ${res.status} ${res.statusText}`);
  const data = await res.json();
  return data.access_token;
}

async function getSheetValues(token, sheetName) {
  const url = `https://graph.microsoft.com/v1.0/sites/${SITE_ID}/drive/items/${WORKBOOK_ID}/workbook/worksheets/${encodeURIComponent(sheetName)}/usedRange`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) throw new Error(`シート取得エラー [${sheetName}]: ${res.status} ${res.statusText}`);
  const data = await res.json();
  return data.values;
}

function parseDate(val) {
  if (!val) return null;
  const str = String(val).replace(/\//g, '-');
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d.toISOString().split('T')[0];
}

async function fetchExcelData() {
  console.log('📊 SharePoint ExcelからデータをAPIで取得中...');

  const missing = ['EXCEL_TENANT_ID', 'EXCEL_CLIENT_ID', 'EXCEL_CLIENT_SECRET', 'EXCEL_SHAREPOINT_SITE_ID', 'EXCEL_WORKBOOK_ID']
    .filter(k => !process.env[k]);

  if (missing.length > 0) {
    console.error('❌ 以下の環境変数が設定されていません:');
    missing.forEach(k => console.error(`   ${k}`));
    console.error('\n💡 Azure ADでアプリ登録後、.env に追加してください。');
    console.error('   詳細はスクリプト冒頭のコメントを参照してください。');
    process.exit(1);
  }

  const token = await getAccessToken();
  console.log('✅ Microsoft Graph API 認証成功');

  const [candidateRows, subtaskRows] = await Promise.all([
    getSheetValues(token, '候補者一覧'),
    getSheetValues(token, 'サブタスク').catch(() => []),
  ]);

  // ヘッダー行をスキップ
  const [, ...candidates] = candidateRows;
  const [, ...subtasks]   = subtaskRows;

  // サブタスクを候補者IDでグループ化
  const subtaskMap = {};
  for (const [candidateId, taskTitle, done] of subtasks) {
    if (!candidateId) continue;
    if (!subtaskMap[candidateId]) subtaskMap[candidateId] = [];
    subtaskMap[candidateId].push({
      title: String(taskTitle || ''),
      completedAt: done === true || String(done).toUpperCase() === 'TRUE' ? new Date().toISOString() : null,
      state: { type: done === true || String(done).toUpperCase() === 'TRUE' ? 'completed' : 'started' },
    });
  }

  const transformedTasks = candidates
    .filter(row => row[0] && row[1] && row[2])
    .map((row, idx) => {
      const [id, name, phase, priorityStr, nextContactDate, status, updatedAt] = row;
      const validPhases = Object.values(STATUS_LABELS);
      const label = validPhases.includes(phase) ? phase : null;
      if (!label) return null;

      return {
        id:         String(id || `excel-${idx}`),
        identifier: String(id || `EX-${idx + 1}`),
        title:      String(name || ''),
        url:        '',
        assignee:   null,
        dueDate:    parseDate(nextContactDate),
        priority:   PRIORITY_MAP[priorityStr] ?? 0,
        label,
        state: {
          type: status === '完了' ? 'completed' : 'started',
          name: String(status || '対応中'),
        },
        subIssues:  subtaskMap[String(id)] || [],
        createdAt:  new Date().toISOString(),
        updatedAt:  updatedAt ? new Date(String(updatedAt).replace(/\//g, '-')).toISOString() : new Date().toISOString(),
      };
    })
    .filter(Boolean);

  console.log(`✅ ${transformedTasks.length}件の候補者データを取得しました`);

  const summary = {};
  for (const label of Object.values(STATUS_LABELS)) {
    summary[label] = transformedTasks.filter(t => t.label === label).length;
  }

  const result = {
    fetchedAt:  new Date().toISOString(),
    totalCount: transformedTasks.length,
    magazines:  transformedTasks,
    summary,
  };

  const outputPath = path.join(__dirname, '..', 'data', 'linear-data.json');
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, JSON.stringify(result, null, 2));

  console.log('💾 データを data/linear-data.json に保存しました');
  console.log('\n📈 フェーズ別候補者数:');
  for (const [label, count] of Object.entries(summary)) {
    console.log(`  ${label}: ${count}件`);
  }

  return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  fetchExcelData().catch(err => {
    console.error('❌ エラー:', err.message);
    process.exit(1);
  });
}

export default fetchExcelData;
