import {
  ArrowRight,
  Bot,
  CircleAlert,
  Clipboard,
  Clock3,
  FileAudio,
  FileText,
  Film,
  FolderOpen,
  Image,
  ListChecks,
  Mic2,
  ShieldCheck,
  Sparkles,
  Volume2,
  Wifi,
  WifiOff,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { api } from "./api";
import type {
  AgentAccessResponse,
  Capability,
  ModelsResponse,
} from "./types";

type GuideTemplate = {
  capability: Capability;
  title: string;
  summary: string;
  prompt: string;
  note: string;
  icon: LucideIcon;
  recommended?: boolean;
};

const guideTemplates: GuideTemplate[] = [
  {
    capability: "image.generate",
    title: "生成图片",
    summary: "海报、插画、概念图和视觉草稿",
    prompt:
      "请通过 Token Plan Media Hub 生成一张赛博朋克风格的上海夜景海报，竖版构图。完成后告诉我本地图片路径、使用的模型和 Manifest 路径。",
    note: "推荐作为第一次体验，通常可以最快看到完整产物流程。",
    icon: Image,
    recommended: true,
  },
  {
    capability: "video.text_to_video",
    title: "生成视频",
    summary: "将一段画面描述变成可追踪的视频任务",
    prompt:
      "请通过 Token Plan Media Hub 生成一段海边日出的短视频。提交后告诉我任务 ID，并持续跟进任务；完成后返回本地 MP4、使用的模型和 Manifest 路径。",
    note: "视频是异步任务；等待或超时不代表已经成功。",
    icon: Film,
  },
  {
    capability: "speech.synthesize",
    title: "合成语音",
    summary: "旁白、试听、无障碍音频和短句播报",
    prompt:
      "请通过 Token Plan Media Hub 选择当前可用的中文系统音色，朗读下面这段文字，并返回本地音频、音色名称、时长和 Manifest 路径：欢迎使用 Token Plan Media Hub。",
    note: "系统音色与可用参数从当前模型注册表读取。",
    icon: Volume2,
  },
  {
    capability: "text.generate",
    title: "生成文本",
    summary: "文案、脚本、提纲和创意草稿",
    prompt:
      "请通过 Token Plan Media Hub 为一款本地多媒体创作工具生成三版中文宣传文案，并将结果保存为本地产物。返回使用的模型、本地文件和 Manifest 路径。",
    note: "适合需要把文本也纳入统一任务与产物记录的场景。",
    icon: FileText,
  },
  {
    capability: "voice.clone",
    title: "复刻授权声音",
    summary: "把已获授权的声音保存为本地音色别名",
    prompt:
      "我拥有或已获得这段声音的明确使用授权。请先向我确认授权信息，再通过 Token Plan Media Hub 创建本地音色别名。不要在回复中输出音频编码或 Provider 音色 ID。",
    note: "必须显式确认授权；不支持未经同意的第三方声音。",
    icon: Mic2,
  },
  {
    capability: "speech.synthesize_with_clone",
    title: "使用复刻音色",
    summary: "用已经授权的本地音色别名生成旁白",
    prompt:
      "请通过 Token Plan Media Hub 使用我已经授权的本地音色别名生成下面这段旁白。不要暴露 Provider 音色 ID，完成后返回本地音频、音色别名、时长和 Manifest 路径。",
    note: "复刻音色必须继续使用创建它时绑定的模型与凭据路由。",
    icon: FileAudio,
  },
];

const creationSteps = [
  {
    title: "理解创作目标",
    body: "Agent 会从你的自然语言中识别图片、视频、语音或文本任务。",
  },
  {
    title: "选择真实可用模型",
    body: "先读取统一模型注册表，并区分已验证、需实测和不可用状态。",
  },
  {
    title: "提交并跟进任务",
    body: "同步任务直接返回结果；异步视频会返回任务 ID 并继续查询。",
  },
  {
    title: "保存本地产物",
    body: "最终结果、校验信息和 Manifest 会进入同一个本地产物库。",
  },
];

export function AgentGuideView({
  models,
  onOpenAgents,
  onOpenArtifacts,
  onNotice,
}: {
  models: ModelsResponse;
  onOpenAgents: () => void;
  onOpenArtifacts: () => void;
  onNotice: (message: string) => void;
}) {
  const [access, setAccess] = useState<AgentAccessResponse>();
  const [gatewayConnected, setGatewayConnected] = useState<boolean>();
  const [statusError, setStatusError] = useState<string>();
  const [refreshing, setRefreshing] = useState(true);

  useEffect(() => {
    let disposed = false;

    async function refreshStatus(showRefreshing = false) {
      if (showRefreshing && !disposed) setRefreshing(true);
      const [accessResult, gatewayResult] = await Promise.allSettled([
        api.agents(),
        api.gatewayHealth(),
      ]);
      if (disposed) return;

      if (accessResult.status === "fulfilled") {
        setAccess(accessResult.value);
      }
      setGatewayConnected(gatewayResult.status === "fulfilled");

      if (
        accessResult.status === "rejected" &&
        gatewayResult.status === "rejected"
      ) {
        setStatusError("暂时无法读取 Agent 与 Gateway 状态。");
      } else if (accessResult.status === "rejected") {
        setStatusError("Gateway 已连接，但暂时无法读取 Agent 接入状态。");
      } else {
        setStatusError(undefined);
      }
      setRefreshing(false);
    }

    void refreshStatus();
    const timer = window.setInterval(() => void refreshStatus(), 15_000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, []);

  const verifiedAgents = useMemo(
    () => access?.agents.filter((agent) => agent.integration.verified) ?? [],
    [access],
  );
  const installedAgents = useMemo(
    () =>
      access?.agents.filter(
        (agent) => agent.integration.status === "installed",
      ) ?? [],
    [access],
  );
  const supportedCapabilities = useMemo(
    () =>
      new Set(
        models.registry.models.flatMap((model) => model.capabilities),
      ),
    [models],
  );
  const availableTemplates = useMemo(
    () =>
      guideTemplates.filter((template) =>
        supportedCapabilities.has(template.capability),
      ),
    [supportedCapabilities],
  );
  const firstPrompt =
    availableTemplates.find((template) => template.recommended)?.prompt ??
    availableTemplates[0]?.prompt;
  const agentReady =
    verifiedAgents.length > 0 && gatewayConnected === true && !statusError;

  async function copyPrompt(prompt: string, title: string) {
    try {
      await navigator.clipboard.writeText(prompt);
      onNotice(
        `${title}指令已复制。请粘贴到目标 Agent 对话中；如果提示找不到工具，再检查 Agent 接入状态。`,
      );
    } catch {
      onNotice("复制失败，请手动选择指令文本。");
    }
  }

  return (
    <div className="agent-guide-page">
      <div className="page-heading agent-guide-heading">
        <div>
          <span className="eyebrow">AGENT CREATION GUIDE</span>
          <h1>Agent 使用指南</h1>
          <p>接入完成后，直接在 Agent 对话中描述创作目标。</p>
        </div>
        <span
          className={`status-badge ${
            gatewayConnected === true ? "verified" : "failed"
          }`}
          aria-live="polite"
        >
          {gatewayConnected === true ? (
            <Wifi size={12} />
          ) : (
            <WifiOff size={12} />
          )}
          {refreshing
            ? "正在读取状态"
            : gatewayConnected === true
              ? "Gateway 已连接"
              : "Gateway 未连接"}
        </span>
      </div>

      <section
        className={`agent-guide-hero ${agentReady ? "ready" : "needs-access"}`}
      >
        <div className="agent-guide-hero-copy">
          <div className="agent-guide-hero-icon">
            <Sparkles size={28} />
          </div>
          <div>
            <h2>从一句话开始第一次创作</h2>
            <p>
              {agentReady
                ? "复制下面的自然语言指令，粘贴到任意已接入 Agent。模型选择、任务跟进和本地产物保存都由 Media Hub 统一完成。"
                : "创作指令可以直接复制，不受安装或验证状态限制。粘贴到目标 Agent 后，如果提示找不到 Media Hub 工具，再回到接入页检查配置。"}
            </p>
            <div className="agent-guide-hero-actions">
              {firstPrompt !== undefined && (
                <button
                  className="primary"
                  onClick={() => void copyPrompt(firstPrompt, "第一次创作")}
                >
                  <Clipboard size={16} />
                  复制第一次创作指令
                </button>
              )}
              {!agentReady && (
                <button onClick={onOpenAgents}>
                  <Bot size={16} />
                  检查 Agent 接入
                </button>
              )}
              <button onClick={onOpenArtifacts}>
                <FolderOpen size={16} />
                查看历史产物
              </button>
            </div>
          </div>
        </div>

        <div className="agent-guide-status-panel">
          <div>
            <span>已安装配置</span>
            <strong>{installedAgents.length}</strong>
            <small>
              {installedAgents.length > 0
                ? installedAgents.map((agent) => agent.name).join("、")
                : "当前未读取到托管安装项"}
            </small>
          </div>
          <div>
            <span>最近验证可用</span>
            <strong>{verifiedAgents.length}</strong>
            <small>验证状态只作提示，不影响复制</small>
          </div>
          <div>
            <span>已注册能力</span>
            <strong>{availableTemplates.length}</strong>
            <small>从模型注册表动态读取</small>
          </div>
        </div>
      </section>

      {statusError !== undefined && (
        <div className="agent-guide-inline-warning" role="status">
          <CircleAlert size={16} />
          <span>{statusError}</span>
          <button onClick={onOpenAgents}>查看 Agent 接入</button>
        </div>
      )}

      <section className="agent-guide-section">
        <header className="agent-guide-section-heading">
          <div>
            <h2>快速创作模板</h2>
            <p>模板只描述创作目标，不要求用户手动选择 MCP 工具。</p>
          </div>
          <span>{availableTemplates.length} 项当前注册能力</span>
        </header>

        <div className="agent-guide-template-grid">
          {availableTemplates.map((template) => {
            const Icon = template.icon;
            const availability = capabilityAvailability(
              models,
              template.capability,
            );
            return (
              <article
                className={`agent-guide-template ${
                  template.recommended ? "recommended" : ""
                }`}
                key={template.capability}
              >
                <header>
                  <span className="agent-guide-template-icon">
                    <Icon size={19} />
                  </span>
                  <div>
                    <h3>{template.title}</h3>
                    <p>{template.summary}</p>
                  </div>
                  <span className={`status-badge ${availability.tone}`}>
                    {availability.label}
                  </span>
                </header>
                <blockquote>{template.prompt}</blockquote>
                <footer>
                  <small>{template.note}</small>
                  <button
                    onClick={() =>
                      void copyPrompt(template.prompt, template.title)
                    }
                  >
                    <Clipboard size={14} />
                    复制指令
                  </button>
                </footer>
              </article>
            );
          })}
        </div>
      </section>

      <div className="agent-guide-detail-grid">
        <section className="agent-guide-section agent-guide-flow">
          <header className="agent-guide-section-heading">
            <div>
              <h2>Agent 会如何执行</h2>
              <p>自然语言背后的标准创作流程</p>
            </div>
            <ListChecks size={20} />
          </header>
          <ol>
            {creationSteps.map((step, index) => (
              <li key={step.title}>
                <span>{index + 1}</span>
                <div>
                  <strong>{step.title}</strong>
                  <p>{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className="agent-guide-section agent-guide-results">
          <header className="agent-guide-section-heading">
            <div>
              <h2>创作完成后去哪里找</h2>
              <p>聊天回复不是产物的唯一存储</p>
            </div>
            <FolderOpen size={20} />
          </header>
          <div className="agent-guide-result-list">
            <div>
              <FileText size={18} />
              <span>
                <strong>Agent 回复</strong>
                <small>任务 ID、模型、Artifact ID 与本地路径</small>
              </span>
            </div>
            <div>
              <Clock3 size={18} />
              <span>
                <strong>历史产物</strong>
                <small>统一查看、播放和打开已经完成的媒体</small>
              </span>
            </div>
            <div>
              <ShieldCheck size={18} />
              <span>
                <strong>Manifest</strong>
                <small>保留能力、参数、校验信息和生成来源</small>
              </span>
            </div>
          </div>
          <button onClick={onOpenArtifacts}>
            打开历史产物
            <ArrowRight size={15} />
          </button>
        </section>
      </div>

      <section className="agent-guide-section agent-guide-help">
        <header className="agent-guide-section-heading">
          <div>
            <h2>常见情况</h2>
            <p>先判断真实状态，再决定下一步。</p>
          </div>
        </header>
        <div>
          <details>
            <summary>Agent 提示找不到 Media Hub 工具</summary>
            <p>
              回到「Agent 接入」确认状态是“已接入可用”，并根据页面提示重启对应
              Agent。仅检测到应用或写入配置，并不代表 MCP 已验证成功。
            </p>
          </details>
          <details>
            <summary>模型显示“需实测”或生成前要求验证</summary>
            <p>
              这表示官方资料已收录，但当前凭据尚未完成真实请求验证。实测可能消耗少量额度，Agent
              应在调用前明确提示。
            </p>
          </details>
          <details>
            <summary>视频任务等待较久或暂时超时</summary>
            <p>
              视频是异步任务。超时只能视为状态未知，不能当作成功或失败；保留任务
              ID，稍后继续刷新即可。
            </p>
          </details>
          <details>
            <summary>为什么声音复刻不能直接开始</summary>
            <p>
              声音复刻必须使用拥有者本人或已获明确许可的声音，并在执行前显式确认授权。声音样本、Provider
              音色 ID 和私人生成媒体不会进入公共仓库。
            </p>
          </details>
        </div>
      </section>
    </div>
  );
}

function capabilityAvailability(
  models: ModelsResponse,
  capability: Capability,
): { label: string; tone: string } {
  const capabilityModels = models.registry.models.filter((model) =>
    model.capabilities.includes(capability),
  );
  const modelIds = new Set(capabilityModels.map((model) => model.id));
  const verified = models.probes.some(
    (probe) =>
      probe.capability === capability &&
      modelIds.has(probe.modelId) &&
      probe.result.status === "verified",
  );
  if (verified) return { label: "已验证", tone: "verified" };
  if (
    capabilityModels.length > 0 &&
    capabilityModels.every((model) => model.availability === "unavailable")
  ) {
    return { label: "不可用", tone: "failed" };
  }
  if (
    capabilityModels.some((model) => model.availability === "probe_required")
  ) {
    return { label: "需实测", tone: "running" };
  }
  return { label: "官方文档", tone: "ready" };
}
