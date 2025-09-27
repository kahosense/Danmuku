#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

const targetDir = process.argv[2] ?? 'docs/review/sessions';

async function loadSessionFiles(directory) {
  const resolvedDir = path.resolve(directory);
  let entries;
  try {
    entries = await fs.readdir(resolvedDir, { withFileTypes: true });
  } catch (error) {
    console.error(`无法读取目录: ${resolvedDir}`);
    throw error;
  }

  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => path.join(resolvedDir, entry.name));

  if (files.length === 0) {
    console.warn(`目录 ${resolvedDir} 中没有找到 JSON 回放文件。`);
  }

  return files;
}

function tokenize(text) {
  if (!text) return [];
  const matches = text
    .toLowerCase()
    .match(/[\p{Letter}\p{Number}]+/gu);
  return matches ?? [];
}

function collectTrigrams(transcript) {
  const trigramCounts = new Map();
  const personaCounts = new Map();
  let totalComments = 0;

  for (const batch of transcript ?? []) {
    for (const comment of batch.comments ?? []) {
      totalComments += 1;
      const tokens = tokenize(comment.text);
      for (let index = 0; index <= tokens.length - 3; index += 1) {
        const key = `${tokens[index]} ${tokens[index + 1]} ${tokens[index + 2]}`;
        trigramCounts.set(key, (trigramCounts.get(key) ?? 0) + 1);

        const personaKey = `${comment.personaId}::${key}`;
        personaCounts.set(personaKey, (personaCounts.get(personaKey) ?? 0) + 1);
      }
    }
  }

  return { trigramCounts, personaCounts, totalComments };
}

function summarizeCounts(trigramCounts, personaCounts) {
  const repeated = Array.from(trigramCounts.entries()).filter(([, count]) => count > 1);
  const repeatedByPersona = new Map();

  for (const [personaKey, count] of personaCounts.entries()) {
    if (count <= 1) continue;
    const [personaId, trigram] = personaKey.split('::');
    if (!repeatedByPersona.has(personaId)) {
      repeatedByPersona.set(personaId, []);
    }
    repeatedByPersona.get(personaId).push({ trigram, count });
  }

  for (const entries of repeatedByPersona.values()) {
    entries.sort((a, b) => b.count - a.count);
  }

  return {
    repeated,
    repeatedByPersona
  };
}

async function main() {
  const files = await loadSessionFiles(targetDir);
  if (files.length === 0) {
    console.log('没有数据可供分析。请先生成 Phase 3 回放 JSON。');
    return;
  }

  const globalTrigramCounts = new Map();
  const globalPersonaCounts = new Map();
  let globalCommentCount = 0;

  for (const file of files) {
    let data;
    try {
      const raw = await fs.readFile(file, 'utf-8');
      data = JSON.parse(raw);
    } catch (error) {
      console.warn(`读取文件失败: ${file}`, error);
      continue;
    }

    const { trigramCounts, personaCounts, totalComments } = collectTrigrams(data.transcript);
    globalCommentCount += totalComments;

    for (const [key, count] of trigramCounts.entries()) {
      globalTrigramCounts.set(key, (globalTrigramCounts.get(key) ?? 0) + count);
    }
    for (const [key, count] of personaCounts.entries()) {
      globalPersonaCounts.set(key, (globalPersonaCounts.get(key) ?? 0) + count);
    }
  }

  const totalTrigrams = Array.from(globalTrigramCounts.values()).reduce((sum, count) => sum + count, 0);
  const { repeated, repeatedByPersona } = summarizeCounts(globalTrigramCounts, globalPersonaCounts);
  const repeatedOccurrences = repeated.reduce((sum, [, count]) => sum + count, 0);
  const repeatedRate = totalTrigrams > 0 ? repeatedOccurrences / totalTrigrams : 0;

  console.log('=== Phase 3 重复度统计 ===');
  console.log(`分析文件数: ${files.length}`);
  console.log(`总评论条数: ${globalCommentCount}`);
  console.log(`总 trigram 数: ${totalTrigrams}`);
  console.log(`重复 trigram 数: ${repeated.length}`);
  console.log(`重复 trigram 出现次数占比: ${(repeatedRate * 100).toFixed(2)}%`);

  const topRepeated = repeated
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20);

  if (topRepeated.length === 0) {
    console.log('\n未发现重复 trigram。');
  } else {
    console.log('\nTop 重复 trigram:');
    topRepeated.forEach(([trigram, count], index) => {
      console.log(`${String(index + 1).padStart(2, '0')}. ${trigram} — ${count}`);
    });
  }

  if (repeatedByPersona.size > 0) {
    console.log('\nPersona 维度重复情况:');
    for (const [personaId, entries] of repeatedByPersona.entries()) {
      const top = entries.slice(0, 5);
      const totalPersonaRepeats = entries.reduce((sum, { count }) => sum + count, 0);
      console.log(`- ${personaId}: ${entries.length} 个重复 trigram，共 ${totalPersonaRepeats} 次`);
      top.forEach(({ trigram, count }) => {
        console.log(`    · ${trigram} — ${count}`);
      });
    }
  }

  console.log('\n如需写入 Markdown 报告，可将上述输出复制到 `docs/review/reports/` 对应文件中。');
}

main().catch((error) => {
  console.error('分析过程中出现错误:', error);
  process.exitCode = 1;
});
