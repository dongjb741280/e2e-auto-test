import fs from 'fs';
import path from 'path';
import type { ChangeReport, ImpactAnalysis, DiffStats, ExecutionResult } from '../types';

export function generateMarkdownReport(report: ChangeReport): string {
  const { meta, diff, analysis, tests, conclusion } = report;

  const lines: string[] = [
    `# 变更影响测试报告`,
    ``,
    `> 生成时间: ${meta.generatedAt}`,
    `> 项目: ${meta.projects.join(', ')}`,
    `> 基线版本: \`${meta.baseRef}\` → 目标版本: \`${meta.targetRef}\``,
    `> 测试地址: ${meta.baseUrl}`,
    ``,
    `---`,
    ``,
    `## 1. 变更概要`,
    ``,
    `| 指标 | 数值 |`,
    `|------|------|`,
    `| 变更文件数 | ${diff.filesChanged} |`,
    `| 新增行数 | +${diff.additions} |`,
    `| 删除行数 | -${diff.deletions} |`,
    ``,
  ];

  // ---- Section 2: Impact Analysis ----
  lines.push(
    `---`,
    ``,
    `## 2. 影响分析`,
    ``,
    `**风险等级**: ${renderRiskBadge(analysis.riskLevel)}`,
    ``,
    `**摘要**: ${analysis.summary}`,
    ``,
  );

  if (analysis.affectedPages.length > 0) {
    lines.push(`### 受影响页面`, ``);

    for (const page of analysis.affectedPages) {
      const changeIcon = page.changeType === 'new' ? '+' : page.changeType === 'removed' ? '-' : '~';
      lines.push(
        `#### ${changeIcon} ${page.name} (\`${page.route}\`)`,
        ``,
        `- **变更类型**: ${renderChangeType(page.changeType)}`,
        `- **变更描述**: ${page.changeDescription}`,
        `- **关联文件**: ${page.impactedFiles.map(f => `\`${f}\``).join(', ')}`,
        ``,
        `**建议测试场景**:`,
        ``,
      );

      for (const scenario of page.testScenarios) {
        lines.push(
          `- **[${scenario.priority}]** ${scenario.name}`,
          `  - 步骤: ${scenario.steps.join(' → ')}`,
          `  - 预期: ${scenario.expectedResult}`,
          ``,
        );
      }
    }
  }

  lines.push(`**建议**: ${analysis.recommendation}`, ``);

  // ---- Section 3: Test Results ----
  lines.push(
    `---`,
    ``,
    `## 3. 测试执行结果`,
    ``,
    `| 指标 | 数值 |`,
    `|------|------|`,
    `| 生成用例数 | ${tests.generated} |`,
    `| 通过 | ${tests.passed} |`,
    `| 失败 | ${tests.failed} |`,
    ``,
  );

  if (tests.details.length > 0) {
    lines.push(`### 用例详情`, ``);

    for (const detail of tests.details) {
      const icon = detail.status === 'passed' ? '✅' : detail.status === 'failed' ? '❌' : '⏭️';
      lines.push(`- ${icon} **${detail.testFile}** (${detail.duration}ms)`);

      for (const scenario of detail.scenarios) {
        const sIcon = scenario.status === 'passed' ? '  ✅' : '  ❌';
        lines.push(`${sIcon} ${scenario.name}`);
        if (scenario.error) {
          lines.push(`     \`\`\``, `     ${scenario.error.slice(0, 300)}`, `     \`\`\``);
        }
      }
      lines.push('');
    }
  }

  // ---- Section 4: Conclusion ----
  lines.push(
    `---`,
    ``,
    `## 4. 结论`,
    ``,
    conclusion,
    ``,
    `---`,
    ``,
    `*报告由 e2e-auto-test 自动生成*`,
    ``,
  );

  return lines.join('\n');
}

function renderRiskBadge(level: string): string {
  switch (level) {
    case 'high': return '🔴 高风险';
    case 'medium': return '🟡 中风险';
    case 'low': return '🟢 低风险';
    default: return level;
  }
}

function renderChangeType(type: string): string {
  switch (type) {
    case 'new': return '新增';
    case 'modified': return '修改';
    case 'removed': return '删除';
    default: return type;
  }
}

function timestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

export function writeReport(report: ChangeReport, outputDir: string): string {
  const ts = timestamp();
  const markdown = generateMarkdownReport(report);
  fs.mkdirSync(outputDir, { recursive: true });

  // Timestamped filenames for history
  const mdPath = path.join(outputDir, `change-report-${ts}.md`);
  fs.writeFileSync(mdPath, markdown);

  // Also save structured JSON
  const jsonPath = path.join(outputDir, `change-report-${ts}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));

  return mdPath;
}
