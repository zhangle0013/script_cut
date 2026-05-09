import { writeFile } from "node:fs/promises";
import { parseMarkdownFile } from "./parser.js";
import { analyzeDensity, renderDensityReportMarkdown } from "./report.js";

/**
 * 一个极简 CLI（不引入 commander/yargs，减少依赖）。
 *
 * 用法示例：
 * - tsx src/cli.ts parse "/path/to/file.md" --out out.json --report report.md --cps 12
 *
 * 说明：
 * - 你可以把 --cps 设置为 100，来匹配你提到的“1 秒不下 100 字”的极限约束；
 *   也可以设置成 8~12，来做更接近口播现实的报警。
 */

type Command = "parse";

function pickArg(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  if (idx === -1) return undefined;
  return args[idx + 1];
}

function hasFlag(args: string[], name: string): boolean {
  return args.includes(name);
}

function usage(): string {
  return [
    `用法：`,
    `  scriptcut parse "<input.md>" [--out out.json] [--report report.md] [--cps 12]`,
    ``,
    `参数：`,
    `  --out     输出 JSON 文件路径（默认：out.json）`,
    `  --report  输出密度报告 markdown 路径（默认：report.md）`,
    `  --cps     密度阈值 chars-per-second（默认：12）`,
    `  --stdout  JSON 输出到 stdout（不写文件）`,
    ``
  ].join("\n");
}

async function main() {
  const args = process.argv.slice(2);
  const cmd = (args[0] as Command | undefined) ?? "parse";

  if (cmd !== "parse") {
    console.error(`未知命令: ${String(cmd)}\n\n${usage()}`);
    process.exit(1);
  }

  const inputPath = args[1];
  if (!inputPath) {
    console.error(`缺少 input.md\n\n${usage()}`);
    process.exit(1);
  }

  const outPath = pickArg(args, "--out") ?? "out.json";
  const reportPath = pickArg(args, "--report") ?? "report.md";
  const cpsStr = pickArg(args, "--cps") ?? "12";
  const cpsThreshold = Number(cpsStr);
  if (!Number.isFinite(cpsThreshold) || cpsThreshold <= 0) {
    console.error(`--cps 必须是正数，收到: ${cpsStr}`);
    process.exit(1);
  }

  const { project, stats } = await parseMarkdownFile(inputPath);

  // 做密度分析：对白 + 旁白两条轨
  const warnings = analyzeDensity(project, {
    cpsThreshold,
    trackTypes: ["dialogue", "narration"]
  });

  const reportMd = renderDensityReportMarkdown(project, warnings);
  const json = JSON.stringify(
    {
      stats,
      project,
      density: {
        cpsThreshold,
        warnings
      }
    },
    null,
    2
  );

  if (hasFlag(args, "--stdout")) {
    process.stdout.write(json);
  } else {
    await writeFile(outPath, json, "utf8");
    await writeFile(reportPath, reportMd, "utf8");
    console.log(`已生成：${outPath}、${reportPath}`);
    console.log(
      `shots=${stats.shotsFound} clips=${stats.clipsFound} cuts=${stats.cutsFound} actionFromShots=${stats.actionClipsFromShots} warnings=${warnings.length}`
    );
  }
}

main().catch((err) => {
  console.error(err?.stack ?? String(err));
  process.exit(1);
});

