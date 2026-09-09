import { pathToFileURL } from "node:url";

export function assessDshVersion(input) {
  const raw = String(input ?? "").trim();
  const match = raw.match(/(\d+)\.(\d+)\.(\d+)(?:-([a-z]+)\.(\d+))?/i);
  if (!match) return { status: "unknown", raw };

  const version = {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    channel: String(match[4] ?? "").toLowerCase(),
    channelNumber: Number(match[5] ?? Number.MAX_SAFE_INTEGER),
  };

  const minimumCore = version.major === 0 && version.minor === 1 && version.patch === 0;
  const belowMinimum = version.major === 0 && (
    version.minor < 1
    || (minimumCore && version.channel && (version.channel !== "rc" || version.channelNumber < 6))
  );
  if (belowMinimum) return { status: "too-old", raw, version };
  if (version.major > 0 || version.minor >= 2) return { status: "future", raw, version };
  return { status: "supported", raw, version };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const assessment = assessDshVersion(process.argv[2]);
  if (assessment.status === "unknown") {
    console.warn(`未能识别 DSH 版本“${assessment.raw || "空"}”；将继续使用运行时能力检测。`);
  } else if (assessment.status === "too-old") {
    console.error(`DSH ${assessment.raw} 早于最低兼容版本 0.1.0-rc.6。`);
    process.exitCode = 2;
  } else if (assessment.status === "future") {
    console.warn(`DSH ${assessment.raw} 超出当前 0.1.x 验证线；将继续使用运行时能力检测，请完成 QQ 端验收。`);
  } else {
    console.log(`DSH ${assessment.raw} 位于兼容范围（0.1.0-rc.6 至 0.1.x）。`);
  }
}
