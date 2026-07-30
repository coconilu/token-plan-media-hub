import {
  Activity,
  BookOpenText,
  Bot,
  Boxes,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Clock3,
  Copy,
  Eye,
  EyeOff,
  ExternalLink,
  FileAudio,
  FileText,
  Film,
  Gauge,
  Image,
  KeyRound,
  LayoutDashboard,
  Menu,
  Mic2,
  Minus,
  Play,
  RefreshCw,
  Settings,
  ShieldCheck,
  Sparkles,
  Square,
  Trash2,
  Volume2,
  WandSparkles,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";

import { api } from "./api";
import { AgentGuideView } from "./AgentGuideView";
import { AgentsView } from "./AgentsView";
import {
  isDesktopRuntime,
  openQianwenPlatformPage,
  runDesktopWindowAction,
  type DesktopWindowAction,
  type QianwenPlatformPage,
} from "./desktop";
import type {
  Artifact,
  Capability,
  CredentialMode,
  MediaJob,
  ModelsResponse,
  VoiceAlias,
} from "./types";

type View =
  | "overview"
  | "generate"
  | "artifacts"
  | "agents"
  | "agent-guide"
  | "settings";

type NavigateOptions = {
  capability?: Capability;
  showAllJobs?: boolean;
};

type Navigate = (view: View, options?: NavigateOptions) => void;

const VOICE_CLONE_READING_TEXT =
  "今天的天气很好，微风穿过窗边的树叶。我正在用自然、清晰的声音录制一段样本，希望这段声音能准确保留我的语气、节奏和表达习惯。";

const VOICE_PREVIEW_TEXT =
  "你好，这是一段克隆音色试听。请确认声音、语气和节奏是否符合预期。";

const SYSTEM_VOICE_PREVIEW_TEXT = "欢迎使用 Token Plan Media Hub。";
const EMPTY_ENUM_VALUES: string[] = [];

const capabilityMeta: Record<
  Capability,
  { label: string; short: string; icon: typeof Image }
> = {
  "text.generate": { label: "文本生成", short: "文本", icon: FileText },
  "image.generate": { label: "图片生成", short: "图片", icon: Image },
  "video.text_to_video": { label: "文生视频", short: "视频", icon: Film },
  "speech.synthesize": { label: "语音合成", short: "语音", icon: Volume2 },
  "voice.clone": { label: "声音复刻", short: "复刻", icon: Mic2 },
  "speech.synthesize_with_clone": {
    label: "复刻音色合成",
    short: "音色合成",
    icon: FileAudio,
  },
};

const navItems: Array<{
  id: View;
  label: string;
  icon: typeof LayoutDashboard;
}> = [
  { id: "overview", label: "概览", icon: LayoutDashboard },
  { id: "generate", label: "生成工作台", icon: WandSparkles },
  { id: "artifacts", label: "历史产物", icon: Clock3 },
  { id: "agents", label: "Agent 接入", icon: Bot },
  { id: "agent-guide", label: "Agent 使用指南", icon: BookOpenText },
  { id: "settings", label: "设置", icon: Settings },
];

export function App() {
  const [view, setView] = useState<View>("overview");
  const [generateCapability, setGenerateCapability] =
    useState<Capability>("image.generate");
  const [showAllJobs, setShowAllJobs] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [models, setModels] = useState<ModelsResponse>();
  const [jobs, setJobs] = useState<MediaJob[]>([]);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [voices, setVoices] = useState<VoiceAlias[]>([]);
  const [credentials, setCredentials] = useState<
    Awaited<ReturnType<typeof api.credentials>>["credentials"]
  >([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string>();

  const reload = useCallback(async (quiet = false): Promise<boolean> => {
    if (!quiet) setLoading(true);
    try {
      const [modelData, jobData, artifactData, voiceData, credentialData] =
        await Promise.all([
          api.models(),
          api.jobs(),
          api.artifacts(),
          api.voices(),
          api.credentials(),
        ]);
      setModels(modelData);
      setJobs(jobData.jobs);
      setArtifacts(artifactData.artifacts);
      setVoices(voiceData.voices);
      setCredentials(credentialData.credentials);
      return true;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!jobs.some((job) => ["queued", "running"].includes(job.status))) {
      return;
    }
    const timer = window.setInterval(() => void reload(true), 1800);
    return () => window.clearInterval(timer);
  }, [jobs, reload]);

  useEffect(() => {
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") {
        void reload(true);
      }
    };
    const timer = window.setInterval(refreshWhenVisible, 15_000);
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [reload]);

  function navigate(next: View, options?: NavigateOptions) {
    if (next === "generate") {
      if (options?.capability !== undefined) {
        setGenerateCapability(options.capability);
      }
      setShowAllJobs(options?.showAllJobs ?? false);
    }
    setView(next);
    setMenuOpen(false);
  }

  const page = (() => {
    if (loading && models === undefined) return <LoadingScreen />;
    if (models === undefined) {
      return (
        <EmptyState
          title="无法连接本地服务"
          body="请确认 pnpm start 已运行，然后重试。"
          action={<button onClick={() => void reload()}>重新连接</button>}
        />
      );
    }
    switch (view) {
      case "overview":
        return (
          <Overview
            models={models}
            jobs={jobs}
            artifacts={artifacts}
            onNavigate={navigate}
          />
        );
      case "generate":
        return (
          <GenerateView
            models={models}
            jobs={jobs}
            artifacts={artifacts}
            voices={voices}
            capability={generateCapability}
            showAllJobs={showAllJobs}
            onCapabilityChange={(nextCapability) => {
              setGenerateCapability(nextCapability);
              setShowAllJobs(false);
            }}
            onDone={async () => {
              await reload(true);
            }}
            onNotice={setNotice}
          />
        );
      case "artifacts":
        return (
          <ArtifactsView
            artifacts={artifacts}
            voices={voices}
            onCreateVoice={() =>
              navigate("generate", { capability: "voice.clone" })
            }
            onDone={async () => {
              await reload(true);
            }}
            onNotice={setNotice}
          />
        );
      case "agents":
        return <AgentsView onNotice={setNotice} />;
      case "agent-guide":
        return (
          <AgentGuideView
            models={models}
            onOpenAgents={() => navigate("agents")}
            onOpenArtifacts={() => navigate("artifacts")}
            onNotice={setNotice}
          />
        );
      case "settings":
        return (
          <SettingsView
            credentials={credentials}
            models={models}
            onReload={async () => {
              await reload(true);
            }}
            onNotice={setNotice}
          />
        );
    }
  })();

  const desktopRuntime = isDesktopRuntime();

  async function openPlatformPage(page: QianwenPlatformPage, label: string) {
    try {
      await openQianwenPlatformPage(page);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setNotice(`无法打开${label}：${detail}`);
    }
  }

  return (
    <div className={`desktop-frame ${desktopRuntime ? "is-desktop" : ""}`}>
      {desktopRuntime && <DesktopTitlebar onNotice={setNotice} />}
      <div className="app-shell">
        <aside className={`sidebar ${menuOpen ? "open" : ""}`}>
          <div className="brand">
            <div className="brand-mark">
              <Sparkles size={21} />
            </div>
            <div>
              <strong>Token Plan</strong>
              <span>Media Hub</span>
            </div>
            <button
              className="icon-button close-menu"
              aria-label="关闭导航"
              onClick={() => setMenuOpen(false)}
            >
              <X size={19} />
            </button>
          </div>
          <nav aria-label="主导航">
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  className={view === item.id ? "active" : ""}
                  onClick={() => navigate(item.id)}
                >
                  <Icon size={19} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
        </aside>

        {menuOpen && (
          <button
            className="sidebar-scrim"
            aria-label="关闭导航"
            onClick={() => setMenuOpen(false)}
          />
        )}

        <main>
          <header className="topbar">
            <div className="topbar-title">
              <button
                className="icon-button menu-button"
                aria-label="打开导航"
                onClick={() => setMenuOpen(true)}
              >
                <Menu size={20} />
              </button>
              <strong>
                {navItems.find((item) => item.id === view)?.label}
              </strong>
            </div>
            {view === "settings" && (
              <div className="topbar-actions">
                <button
                  type="button"
                  onClick={() =>
                    void openPlatformPage("tokenPlanUsage", "Token Plan 用量页面")
                  }
                >
                  Token Plan 用量 <ExternalLink size={15} />
                </button>
                <button
                  type="button"
                  onClick={() =>
                    void openPlatformPage("payAsYouGoUsage", "按量付费用量页面")
                  }
                >
                  按量付费用量 <ExternalLink size={15} />
                </button>
              </div>
            )}
          </header>
          <section className="page">{page}</section>
        </main>
      </div>

      {notice && (
        <div className="toast" role="status">
          <CircleAlert size={18} />
          <span>{notice}</span>
          <button aria-label="关闭提示" onClick={() => setNotice(undefined)}>
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}

function DesktopTitlebar({
  onNotice,
}: {
  onNotice: (message: string) => void;
}) {
  async function run(action: DesktopWindowAction) {
    try {
      await runDesktopWindowAction(action);
    } catch (error) {
      onNotice(
        `窗口操作失败：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return (
    <header className="desktop-titlebar">
      <div
        className="desktop-titlebar-drag"
        data-tauri-drag-region
        onDoubleClick={() => void run("toggleMaximize")}
      >
        <span className="desktop-titlebar-mark" data-tauri-drag-region>
          <Sparkles size={14} strokeWidth={2.2} />
        </span>
        <span data-tauri-drag-region>Token Plan Media Hub</span>
      </div>
      <div className="desktop-window-controls">
        <button
          type="button"
          aria-label="最小化窗口"
          title="最小化"
          onClick={() => void run("minimize")}
        >
          <Minus size={15} strokeWidth={1.5} />
        </button>
        <button
          type="button"
          aria-label="最大化或还原窗口"
          title="最大化或还原"
          onClick={() => void run("toggleMaximize")}
        >
          <Square size={12} strokeWidth={1.5} />
        </button>
        <button
          type="button"
          className="close"
          aria-label="关闭窗口"
          title="关闭"
          onClick={() => void run("close")}
        >
          <X size={16} strokeWidth={1.5} />
        </button>
      </div>
    </header>
  );
}

function Overview({
  models,
  jobs,
  artifacts,
  onNavigate,
}: {
  models: ModelsResponse;
  jobs: MediaJob[];
  artifacts: Artifact[];
  onNavigate: Navigate;
}) {
  const succeeded = jobs.filter((job) => job.status === "succeeded").length;
  const capabilityCount = new Set(
    models.registry.models.flatMap((model) => model.capabilities),
  ).size;
  return (
    <>
      <div className="hero">
        <div>
          <span className="eyebrow">LOCAL MULTIMODAL WORKSPACE</span>
          <h1>一个入口，生成并管理你的媒体产物。</h1>
          <p>
            文本、图片、视频、语音和声音复刻共享模型注册表、任务历史与本地产物清单。
          </p>
          <div className="hero-actions">
            <button className="primary" onClick={() => onNavigate("generate")}>
              <WandSparkles size={18} />
              开始生成
            </button>
            <button onClick={() => onNavigate("settings")}>
              <Settings size={17} />
              配置凭据
            </button>
          </div>
        </div>
        <div className="hero-orbit" aria-hidden="true">
          <div className="orbit-center"><Sparkles /></div>
          <span className="orbit-icon one"><Image /></span>
          <span className="orbit-icon two"><Film /></span>
          <span className="orbit-icon three"><Volume2 /></span>
        </div>
      </div>

      <div className="metric-grid">
        <Metric icon={Boxes} label="已注册模型" value={models.registry.models.length} />
        <Metric icon={Activity} label="成功任务" value={succeeded} />
        <Metric icon={Image} label="本地产物" value={artifacts.length} />
        <Metric
          icon={Gauge}
          label="能力类型"
          value={capabilityCount}
          accent="cyan"
        />
      </div>

      <div className="split-grid">
        <section className="panel">
          <PanelTitle
            title="能力入口"
            subtitle="从模型注册表动态读取"
            action={
              <button className="text-button" onClick={() => onNavigate("generate")}>
                进入工作台 <ChevronRight size={15} />
              </button>
            }
          />
          <div className="capability-list">
            {Object.entries(capabilityMeta).map(([key, meta]) => {
              const Icon = meta.icon;
              const count = models.registry.models.filter((model) =>
                model.capabilities.includes(key as Capability),
              ).length;
              return (
                <button
                  key={key}
                  onClick={() =>
                    onNavigate("generate", { capability: key as Capability })
                  }
                >
                  <span className="capability-icon"><Icon size={19} /></span>
                  <span><strong>{meta.label}</strong><small>{count} 个模型</small></span>
                  <ChevronRight size={16} />
                </button>
              );
            })}
          </div>
        </section>
        <section className="panel">
          <PanelTitle
            title="最近任务"
            subtitle="统一任务历史"
            action={
              <button
                className="text-button"
                onClick={() => onNavigate("generate", { showAllJobs: true })}
              >
                全部任务 <ChevronRight size={15} />
              </button>
            }
          />
          <JobList jobs={jobs.slice(0, 5)} compact />
        </section>
      </div>
    </>
  );
}

function GenerateView({
  models,
  jobs,
  artifacts,
  voices,
  capability,
  showAllJobs,
  onCapabilityChange,
  onDone,
  onNotice,
}: {
  models: ModelsResponse;
  jobs: MediaJob[];
  artifacts: Artifact[];
  voices: VoiceAlias[];
  capability: Capability;
  showAllJobs: boolean;
  onCapabilityChange: (capability: Capability) => void;
  onDone: () => Promise<void> | void;
  onNotice: (message: string) => void;
}) {
  const matching = models.registry.models.filter((model) =>
    model.capabilities.includes(capability),
  );
  const initialModel = recommendedModel(models.registry.models, capability);
  const [model, setModel] = useState(
    initialModel?.id ?? "",
  );
  const [credentialMode, setCredentialMode] =
    useState<CredentialMode>("token_plan");
  const [prompt, setPrompt] = useState(
    "暮色中的高山湖泊，薄雾掠过松林，电影级光影",
  );
  const [textPrompt, setTextPrompt] = useState(
    "用三句话说明为什么清晰的模型路由很重要。",
  );
  const [temperature, setTemperature] = useState(0.7);
  const [maxTokens, setMaxTokens] = useState(2048);
  const [text, setText] = useState("欢迎使用 Token Plan Media Hub。");
  const initialVoice =
    initialModel?.parameters["speech.synthesize"]?.properties.voice?.default;
  const [voice, setVoice] = useState(
    typeof initialVoice === "string" ? initialVoice : "",
  );
  const [size, setSize] = useState("1024*1024");
  const [resolution, setResolution] = useState("720P");
  const [ratio, setRatio] = useState("16:9");
  const [duration, setDuration] = useState(5);
  const [language, setLanguage] = useState("Auto");
  const [voiceAlias, setVoiceAlias] = useState("");
  const [cloneName, setCloneName] = useState(() => {
    const value =
      initialModel?.parameters["voice.clone"]?.properties.name?.default;
    return typeof value === "string" ? value : "";
  });
  const [referenceAudio, setReferenceAudio] = useState("");
  const [referenceAudioLabel, setReferenceAudioLabel] = useState("");
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [probing, setProbing] = useState(false);
  const [previewingSystemVoice, setPreviewingSystemVoice] = useState(false);
  const [systemVoicePreview, setSystemVoicePreview] = useState<Artifact>();
  const [selectedJobId, setSelectedJobId] = useState<string>();

  useEffect(() => {
    const candidates = models.registry.models.filter((entry) =>
      entry.capabilities.includes(capability),
    );
    const selected =
      candidates.find((entry) => entry.id === model) ??
      recommendedModel(candidates, capability);
    setModel(selected?.id ?? "");
    setCredentialMode(selected?.credentialModes[0] ?? "token_plan");
  }, [capability, model, models.registry.models]);

  useEffect(() => {
    if (capability !== "voice.clone") return;
    const defaultName = models.registry.models.find(
      (entry) => entry.id === model,
    )?.parameters["voice.clone"]?.properties.name?.default;
    if (typeof defaultName === "string") {
      setCloneName((current) => current || defaultName);
    }
  }, [capability, model, models.registry.models]);

  const visibleJobs = showAllJobs
    ? jobs
    : jobs.filter((job) => job.capability === capability);
  const selectedJob = visibleJobs.find((job) => job.id === selectedJobId);
  const selectedArtifacts = selectedJob
    ? artifacts.filter((artifact) => selectedJob.artifactIds.includes(artifact.artifactId))
    : [];
  const cloneNameSchema = models.registry.models.find(
    (entry) => entry.id === model,
  )?.parameters["voice.clone"]?.properties.name;
  const selectedModel = matching.find((entry) => entry.id === model);
  const systemVoiceSchema =
    selectedModel?.parameters["speech.synthesize"]?.properties.voice;
  const systemVoiceValues = systemVoiceSchema?.enum ?? EMPTY_ENUM_VALUES;
  const systemVoiceOptions = systemVoiceValues.map((value) => ({
    value,
    label: systemVoiceSchema?.enumLabels?.[value] ?? value,
  }));
  const selectedProbe = models.probes.find(
    (entry) =>
      entry.modelId === model &&
      entry.capability === capability &&
      entry.credentialMode === credentialMode,
  );
  const selectedAvailability =
    selectedProbe?.result.status ?? selectedModel?.availability ?? "unavailable";

  useEffect(() => {
    if (capability !== "speech.synthesize") return;
    const fallback =
      typeof systemVoiceSchema?.default === "string"
        ? systemVoiceSchema.default
        : systemVoiceValues[0] ?? "";
    setVoice((current) =>
      systemVoiceValues.includes(current) ? current : fallback,
    );
  }, [
    capability,
    model,
    systemVoiceSchema?.default,
    systemVoiceValues,
  ]);

  function selectCapability(nextCapability: Capability) {
    if (nextCapability === capability && !showAllJobs) return;
    onCapabilityChange(nextCapability);
    setSelectedJobId(undefined);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (capability === "voice.clone" && referenceAudio.length === 0) {
      onNotice("请先录制或上传一段参考音频。");
      return;
    }
    if (
      capability === "speech.synthesize_with_clone" &&
      voiceAlias.length === 0
    ) {
      onNotice("请选择一个已授权音色。");
      return;
    }
    const parameters: Record<string, unknown> =
      capability === "text.generate"
        ? { prompt: textPrompt, temperature, max_tokens: maxTokens }
        : capability === "image.generate"
          ? { prompt, size }
        : capability === "video.text_to_video"
          ? { prompt, resolution, ratio, duration }
          : capability === "speech.synthesize"
            ? { text, voice, language }
            : capability === "voice.clone"
              ? {
                  reference_audio: referenceAudio,
                  consent,
                  name: cloneName,
                  language,
                }
              : { text, voice_alias: voiceAlias, language };
    setSubmitting(true);
    try {
      const job = await api.submit({
        capability,
        model,
        credentialMode,
        parameters,
      });
      setSelectedJobId(job.id);
      await onDone();
      onNotice(
        job.status === "failed"
          ? job.error?.message ?? "任务失败"
          : job.status === "succeeded"
            ? "生成完成，产物已保存到本地。"
            : "任务已提交，正在后台处理。",
      );
    } catch (error) {
      onNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setSubmitting(false);
    }
  }

  async function probeSelectedRoute() {
    if (capability === "voice.clone") {
      onNotice("声音复刻必须使用已授权音频完成真实复刻，不能自动探测。");
      return;
    }
    setProbing(true);
    try {
      const result = await api.probe(capability, model, credentialMode);
      await onDone();
      if (result.status === "verified") {
        onNotice("实测通过：当前模型与当前 Key 已完成真实请求验证。");
      } else {
        onNotice(
          result.error?.message ??
            "本次实测未能确认可用性，请稍后重试。",
        );
      }
    } catch (error) {
      onNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setProbing(false);
    }
  }

  async function previewSystemVoice() {
    setPreviewingSystemVoice(true);
    setSystemVoicePreview(undefined);
    try {
      const job = await api.submit({
        capability: "speech.synthesize",
        model,
        credentialMode,
        parameters: {
          text: SYSTEM_VOICE_PREVIEW_TEXT,
          voice,
          language,
        },
      });
      setSelectedJobId(job.id);
      await onDone();
      if (job.status !== "succeeded" || job.artifactIds.length === 0) {
        throw new Error(job.error?.message ?? "试听生成未返回音频产物。");
      }
      const artifact = await api.artifact(job.artifactIds[0]!);
      setSystemVoicePreview(artifact);
      onNotice("系统音色试听已生成并保存到本地产物库。");
    } catch (error) {
      onNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setPreviewingSystemVoice(false);
    }
  }

  async function pickAudio(file?: File) {
    if (file === undefined) return;
    const allowedType = [
      "audio/wav",
      "audio/x-wav",
      "audio/mpeg",
      "audio/mp4",
      "audio/x-m4a",
    ].includes(file.type);
    const allowedExtension = /\.(wav|mp3|m4a)$/i.test(file.name);
    if (!allowedType && !allowedExtension) {
      onNotice("参考音频仅支持 WAV、MP3 或 M4A。");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      onNotice("参考音频不能超过 10 MB。");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setReferenceAudio(String(reader.result));
      setReferenceAudioLabel(`已上传 · ${file.name}`);
    };
    reader.onerror = () => onNotice("无法读取参考音频。");
    reader.readAsDataURL(file);
  }

  return (
    <>
      <PageHeading
        eyebrow="GENERATION STUDIO"
        title="生成工作台"
        description="统一提交、轮询、预览和清单归档"
      />
      <div className="studio-tabs">
        {(Object.keys(capabilityMeta) as Capability[]).map((item) => {
          const meta = capabilityMeta[item];
          const Icon = meta.icon;
          return (
            <button
              key={item}
              className={capability === item ? "active" : ""}
              onClick={() => selectCapability(item)}
            >
              <Icon size={17} /> {meta.short}
            </button>
          );
        })}
      </div>
      <div className="studio-grid">
        <form className="panel generator-form" onSubmit={submit}>
          <PanelTitle
            title={capabilityMeta[capability].label}
            subtitle="统一任务入口"
          />
          <Field label="模型">
            <SelectControl
              ariaLabel="模型"
              value={model}
              onChange={setModel}
              options={matching.map((entry) => ({
                value: entry.id,
                label: `${entry.id}${
                  entry.recommendedFor.includes(capability) ? "（推荐）" : ""
                }`,
              }))}
            />
          </Field>
          <Field label="凭据路由">
            <SelectControl
              ariaLabel="凭据路由"
              value={credentialMode}
              onChange={(value) => setCredentialMode(value as CredentialMode)}
              options={(
                matching.find((entry) => entry.id === model)?.credentialModes ?? []
              ).map((item) => ({ value: item, label: item }))}
            />
          </Field>
          <div className="model-route-status" aria-live="polite">
            <div>
              <StatusBadge status={selectedAvailability} />
              <span>{modelAvailabilityDescription(
                selectedAvailability,
                selectedProbe?.result.checkedAt,
                capability,
              )}</span>
            </div>
            {capability !== "voice.clone" && (
              <>
                <p id="route-probe-usage" className="route-probe-usage">
                  <CircleAlert size={14} />
                  {selectedModel?.execution === "async"
                    ? "将创建真实异步任务并等待产物完成，可能产生少量用量。"
                    : "将向模型服务发起真实最小请求，可能产生少量用量。"}
                </p>
                <button
                  type="button"
                  disabled={probing || model.length === 0}
                  aria-describedby="route-probe-usage"
                  title="验证当前模型与当前 Key；会发起真实请求并可能产生少量用量"
                  onClick={() => void probeSelectedRoute()}
                >
                  {probing ? (
                    <RefreshCw className="spin" size={15} />
                  ) : (
                    <Activity size={15} />
                  )}
                  {probing ? "等待实测完成" : "实测模型与当前 Key"}
                </button>
              </>
            )}
          </div>

          {(capability === "image.generate" ||
            capability === "video.text_to_video") && (
            <Field label="提示词">
              <textarea
                rows={6}
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="描述你希望生成的画面…"
                required
              />
            </Field>
          )}
          {capability === "text.generate" && (
            <>
              <Field label="文本提示词">
                <textarea
                  rows={7}
                  value={textPrompt}
                  onChange={(event) => setTextPrompt(event.target.value)}
                  placeholder="描述需要生成的文本…"
                  required
                />
              </Field>
              <div className="field-grid">
                <Field label="随机性">
                  <input
                    type="number"
                    min={0}
                    max={2}
                    step={0.1}
                    value={temperature}
                    onChange={(event) =>
                      setTemperature(Number(event.target.value))
                    }
                  />
                </Field>
                <Field label="最大输出 Token">
                  <input
                    type="number"
                    min={1}
                    max={8192}
                    value={maxTokens}
                    onChange={(event) =>
                      setMaxTokens(Number(event.target.value))
                    }
                  />
                </Field>
              </div>
            </>
          )}
          {capability === "image.generate" && (
            <Field label="图片尺寸">
              <input
                value={size}
                onChange={(event) => setSize(event.target.value)}
                placeholder="1024*1024"
              />
            </Field>
          )}
          {capability === "video.text_to_video" && (
            <div className="field-grid three-up">
              <Field label="分辨率">
                <SelectControl
                  ariaLabel="分辨率"
                  value={resolution}
                  onChange={setResolution}
                  options={[
                    { value: "720P", label: "720P" },
                    { value: "1080P", label: "1080P" },
                  ]}
                />
              </Field>
              <Field label="画面比例">
                <input
                  value={ratio}
                  onChange={(event) => setRatio(event.target.value)}
                  placeholder="16:9"
                />
              </Field>
              <Field label="时长（秒）">
                <input
                  type="number"
                  min={3}
                  max={15}
                  value={duration}
                  onChange={(event) => setDuration(Number(event.target.value))}
                />
              </Field>
            </div>
          )}
          {(capability === "speech.synthesize" ||
            capability === "speech.synthesize_with_clone") && (
            <Field label="合成文本">
              <textarea
                rows={5}
                value={text}
                onChange={(event) => setText(event.target.value)}
                required
              />
            </Field>
          )}
          {capability === "speech.synthesize" && (
            <Field label="系统音色">
              <div className="system-voice-controls">
                <SelectControl
                  ariaLabel="系统音色"
                  value={voice}
                  onChange={(value) => {
                    setVoice(value);
                    setSystemVoicePreview(undefined);
                  }}
                  options={systemVoiceOptions}
                />
                <button
                  type="button"
                  className="system-voice-preview-button"
                  disabled={
                    previewingSystemVoice ||
                    voice.length === 0 ||
                    model.length === 0
                  }
                  onClick={() => void previewSystemVoice()}
                >
                  {previewingSystemVoice ? (
                    <RefreshCw className="spin" size={16} />
                  ) : (
                    <Volume2 size={16} />
                  )}
                  {previewingSystemVoice ? "生成中…" : "试听"}
                </button>
              </div>
              <small className="field-hint">
                共 {systemVoiceOptions.length} 个官方系统音色；试听固定使用“
                {SYSTEM_VOICE_PREVIEW_TEXT}”，便于比较并减少额度消耗。
              </small>
              {systemVoicePreview && (
                <div className="system-voice-preview" aria-live="polite">
                  <div>
                    <strong>
                      {systemVoiceSchema?.enumLabels?.[voice] ?? voice}
                    </strong>
                    <span>试听已保存到本地产物库</span>
                  </div>
                  <audio
                    src={systemVoicePreview.contentUrl}
                    controls
                    preload="metadata"
                    aria-label={`${voice} 系统音色试听`}
                  />
                </div>
              )}
            </Field>
          )}
          {(capability === "speech.synthesize" ||
            capability === "speech.synthesize_with_clone") && (
            <Field label="语言">
              <input
                value={language}
                onChange={(event) => setLanguage(event.target.value)}
                placeholder="Auto"
              />
            </Field>
          )}
          {capability === "speech.synthesize_with_clone" && (
            <Field label="本地音色别名">
              <SelectControl
                ariaLabel="本地音色别名"
                value={voiceAlias}
                onChange={setVoiceAlias}
                options={[
                  { value: "", label: "选择已授权音色" },
                  ...voices.map((item) => ({
                    value: item.alias,
                    label: item.alias,
                  })),
                ]}
              />
            </Field>
          )}
          {capability === "voice.clone" && (
            <>
              <div className="form-group">
                <span className="form-group-title">参数</span>
                <Field label="本地音色别名">
                  <input
                    value={cloneName}
                    onChange={(event) => setCloneName(event.target.value)}
                    minLength={cloneNameSchema?.minLength}
                    maxLength={cloneNameSchema?.maxLength}
                    pattern={cloneNameSchema?.pattern}
                    title={cloneNameSchema?.description}
                    aria-describedby="voice-clone-name-hint"
                    required
                  />
                  {cloneNameSchema?.description && (
                    <small id="voice-clone-name-hint" className="field-hint">
                      {cloneNameSchema.description}
                    </small>
                  )}
                </Field>
                <Field label="语言">
                  <input
                    value={language}
                    onChange={(event) => setLanguage(event.target.value)}
                    placeholder="Auto"
                  />
                </Field>
              </div>
              <div className="form-group">
                <span className="form-group-title">参考音频</span>
                <VoiceRecorder
                  value={referenceAudio}
                  sourceLabel={referenceAudioLabel}
                  onRecorded={(dataUrl, durationSeconds) => {
                    setReferenceAudio(dataUrl);
                    setReferenceAudioLabel(
                      `页面录音 · ${durationSeconds.toFixed(1)} 秒`,
                    );
                  }}
                  onNotice={onNotice}
                />
                <div className="audio-source-divider">
                  <span>或上传已有音频</span>
                </div>
                <Field label="参考音频文件">
                  <label className="file-drop">
                    <FileAudio size={22} />
                    <span>
                      {referenceAudio
                        ? referenceAudioLabel || "参考音频已在内存中读取"
                        : "选择 WAV、MP3 或 M4A，最大 10 MB"}
                    </span>
                    <input
                      type="file"
                      accept=".wav,.mp3,.m4a,audio/wav,audio/mpeg,audio/mp4"
                      onChange={(event) => void pickAudio(event.target.files?.[0])}
                    />
                  </label>
                </Field>
              </div>
              <div className="form-group">
                <span className="form-group-title">授权确认</span>
                <label className="consent-row">
                  <input
                    type="checkbox"
                    checked={consent}
                    onChange={(event) => setConsent(event.target.checked)}
                    required
                  />
                  <span>我确认拥有该声音，或已获得明确的声音复刻授权。</span>
                </label>
              </div>
            </>
          )}

          <button
            className="primary submit-button"
            type="submit"
            disabled={
              submitting ||
              !model ||
              (capability === "voice.clone" && referenceAudio.length === 0)
            }
          >
            {submitting ? <RefreshCw className="spin" size={18} /> : <Play size={18} />}
            {submitting ? "正在提交…" : "开始生成"}
          </button>
          <p className="form-footnote">
            生成可能消耗相应套餐或账户额度。
          </p>
        </form>

        <section className="panel preview-panel">
          <PanelTitle title="预览" subtitle={selectedJob ? shortId(selectedJob.id) : "等待生成"} />
          <Preview artifacts={selectedArtifacts} job={selectedJob} />
        </section>
      </div>

      <section className="panel job-panel">
        <PanelTitle
          title={showAllJobs ? "全部任务" : "任务历史"}
          subtitle={
            showAllJobs
              ? `${visibleJobs.length} 个任务`
              : `${visibleJobs.length} 个${capabilityMeta[capability].short}任务`
          }
        />
        <JobList
          jobs={visibleJobs}
          onSelect={setSelectedJobId}
          selected={selectedJob?.id}
        />
      </section>
    </>
  );
}

function VoiceRecorder({
  value,
  sourceLabel,
  onRecorded,
  onNotice,
}: {
  value: string;
  sourceLabel: string;
  onRecorded: (dataUrl: string, durationSeconds: number) => void;
  onNotice: (message: string) => void;
}) {
  const [state, setState] = useState<
    "idle" | "requesting" | "recording" | "processing" | "ready"
  >("idle");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const mountedRef = useRef(true);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const silentGainRef = useRef<GainNode | null>(null);
  const pcmChunksRef = useRef<Float32Array[]>([]);
  const sampleCountRef = useRef(0);
  const timerRef = useRef<number | null>(null);

  const releaseAudioResources = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (processorRef.current !== null) {
      processorRef.current.onaudioprocess = null;
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    sourceRef.current?.disconnect();
    sourceRef.current = null;
    silentGainRef.current?.disconnect();
    silentGainRef.current = null;
    for (const track of streamRef.current?.getTracks() ?? []) {
      track.stop();
    }
    streamRef.current = null;
    const audioContext = audioContextRef.current;
    audioContextRef.current = null;
    if (audioContext !== null && audioContext.state !== "closed") {
      void audioContext.close();
    }
  }, []);

  useEffect(
    () => () => {
      mountedRef.current = false;
      releaseAudioResources();
    },
    [releaseAudioResources],
  );

  async function startRecording() {
    if (!isDesktopRuntime()) {
      onNotice("请在 Tauri 桌面应用中使用麦克风录音；浏览器版本不再作为兼容目标。");
      return;
    }
    if (
      navigator.mediaDevices?.getUserMedia === undefined ||
      window.AudioContext === undefined
    ) {
      onNotice("当前桌面 WebView2 无法访问麦克风，请检查 Windows 麦克风隐私权限。");
      return;
    }

    releaseAudioResources();
    setState("requesting");
    setElapsedSeconds(0);
    pcmChunksRef.current = [];
    sampleCountRef.current = 0;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          autoGainControl: true,
          echoCancellation: true,
          noiseSuppression: true,
          channelCount: 1,
        },
      });
      if (!mountedRef.current) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }

      streamRef.current = stream;
      const audioContext = new AudioContext();
      audioContextRef.current = audioContext;
      if (audioContext.state === "suspended") {
        await audioContext.resume();
      }
      if (audioContext.sampleRate < 24_000) {
        throw new Error(
          `当前麦克风采样率为 ${audioContext.sampleRate} Hz，低于声音复刻要求的 24000 Hz。`,
        );
      }
      const source = audioContext.createMediaStreamSource(stream);
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      const silentGain = audioContext.createGain();
      silentGain.gain.value = 0;
      processor.onaudioprocess = (event) => {
        const samples = event.inputBuffer.getChannelData(0);
        pcmChunksRef.current.push(new Float32Array(samples));
        sampleCountRef.current += samples.length;
        event.outputBuffer.getChannelData(0).fill(0);
      };
      source.connect(processor);
      processor.connect(silentGain);
      silentGain.connect(audioContext.destination);

      sourceRef.current = source;
      processorRef.current = processor;
      silentGainRef.current = silentGain;
      setState("recording");
      timerRef.current = window.setInterval(() => {
        const seconds =
          sampleCountRef.current / (audioContextRef.current?.sampleRate ?? 1);
        setElapsedSeconds(seconds);
        if (seconds >= 60) {
          void stopRecording();
        }
      }, 200);
    } catch (error) {
      releaseAudioResources();
      if (!mountedRef.current) return;
      setState("idle");
      const denied =
        error instanceof DOMException &&
        ["NotAllowedError", "PermissionDeniedError"].includes(error.name);
      onNotice(
        denied
          ? "麦克风权限未开启，请在 Windows“隐私和安全性 → 麦克风”中允许桌面应用访问后重试。"
          : `无法开始录音：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async function stopRecording() {
    const audioContext = audioContextRef.current;
    if (audioContext === null) return;

    setState("processing");
    const sampleRate = audioContext.sampleRate;
    const durationSeconds = sampleCountRef.current / sampleRate;
    const chunks = pcmChunksRef.current;
    releaseAudioResources();

    if (durationSeconds < 3) {
      pcmChunksRef.current = [];
      sampleCountRef.current = 0;
      setElapsedSeconds(0);
      setState("idle");
      onNotice("录音至少需要 3 秒连续清晰的人声，请重新录制。");
      return;
    }

    try {
      const wav = encodeMonoWav(chunks, sampleRate);
      const dataUrl = await blobToDataUrl(wav);
      if (!mountedRef.current) return;
      onRecorded(dataUrl, durationSeconds);
      setElapsedSeconds(durationSeconds);
      setState("ready");
      onNotice(
        durationSeconds < 10
          ? "录音已保存；官方建议录制 10–20 秒，以获得更好的复刻效果。"
          : "录音已保存，可先试听，再确认授权并创建音色。",
      );
    } catch (error) {
      if (!mountedRef.current) return;
      setState("idle");
      onNotice(
        `无法处理录音：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const isBusy = state === "requesting" || state === "processing";
  const isRecording = state === "recording";
  return (
    <section className={`voice-recorder ${isRecording ? "recording" : ""}`}>
      <div className="voice-recorder-head">
        <span className="voice-recorder-icon">
          <Mic2 size={19} />
        </span>
        <div>
          <strong>桌面麦克风录制</strong>
          <small>由 Tauri 桌面应用采集单声道 16-bit WAV，仅用于当前复刻任务</small>
        </div>
      </div>
      <div className="reading-script">
        <span>请用自然语速朗读以下文案</span>
        <p>{VOICE_CLONE_READING_TEXT}</p>
      </div>
      <div className="recording-guidance">
        <span>建议 10–20 秒</span>
        <span>保持安静、连续朗读</span>
        <span>最长 60 秒</span>
      </div>
      <div className="recording-actions">
        <button
          type="button"
          className={`record-button ${isRecording ? "stop" : ""}`}
          disabled={isBusy}
          onClick={() =>
            isRecording ? void stopRecording() : void startRecording()
          }
        >
          {isRecording ? <Square size={15} /> : <Mic2 size={17} />}
          {state === "requesting"
            ? "正在请求麦克风…"
            : state === "processing"
              ? "正在生成 WAV…"
              : isRecording
                ? "停止录音"
                : value
                  ? "重新录音"
                  : "开始录音"}
        </button>
        <span className="recording-timer">
          {formatRecordingTime(elapsedSeconds)}
        </span>
      </div>
      {value && (
        <div className="reference-audio-preview">
          <div>
            <Check size={15} />
            <span>{sourceLabel || "参考音频已准备"}</span>
          </div>
          <audio src={value} controls preload="metadata" />
        </div>
      )}
    </section>
  );
}

function VoiceHistorySection({
  voices,
  artifacts,
  onCreate,
  onDone,
  onNotice,
}: {
  voices: VoiceAlias[];
  artifacts: Artifact[];
  onCreate: () => void;
  onDone: () => Promise<void> | void;
  onNotice: (message: string) => void;
}) {
  const [generating, setGenerating] = useState<string>();
  const [generatedPreviews, setGeneratedPreviews] = useState<
    Record<string, Artifact>
  >({});

  async function generatePreview(voice: VoiceAlias) {
    if (voice.credentialMode === undefined) {
      onNotice("该音色缺少创建时的凭据路由信息，请重新创建后再试听。");
      return;
    }
    setGenerating(voice.alias);
    try {
      const job = await api.submit({
        capability: "speech.synthesize_with_clone",
        model: voice.targetModel,
        credentialMode: voice.credentialMode,
        parameters: {
          text: VOICE_PREVIEW_TEXT,
          voice_alias: voice.alias,
          language: "Chinese",
        },
      });
      if (job.status !== "succeeded" || job.artifactIds.length === 0) {
        throw new Error(job.error?.message ?? "试听生成未返回音频产物。");
      }
      const artifact = await api.artifact(job.artifactIds[0]!);
      setGeneratedPreviews((current) => ({
        ...current,
        [voice.alias]: artifact,
      }));
      await onDone();
      onNotice("试听已生成并保存到本地产物库，可直接播放。");
    } catch (error) {
      onNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setGenerating(undefined);
    }
  }

  return (
    <section className="history-section voice-history-section">
      <div className="history-section-heading">
        <div>
          <span className="eyebrow">VOICE VAULT</span>
          <h2>音色</h2>
          <p>管理可复用的克隆音色；仅展示本地别名，Provider 音色 ID 加密存储</p>
        </div>
        <button className="primary" onClick={onCreate}>
          <Mic2 size={17} />创建音色
        </button>
      </div>
      <div className="info-banner warning">
        <ShieldCheck size={19} />
        <span>声音复刻必须取得明确授权。参考音频、Provider 音色 ID 和私人媒体不会进入 Git。</span>
      </div>
      {voices.length === 0 ? (
        <EmptyState
          title="还没有本地音色"
          body="请先配置对应凭据，再完成授权、声音复刻和加密引用归档流程。"
          action={<button onClick={onCreate}>前往声音复刻</button>}
        />
      ) : (
        <div className="voice-grid">
          {voices.map((voice) => {
            const savedPreview = artifacts.find(
              (artifact) =>
                artifact.manifest.capability ===
                  "speech.synthesize_with_clone" &&
                artifact.manifest.mimeType.startsWith("audio/") &&
                artifact.manifest.parameters.voice_alias === voice.alias,
            );
            const preview = generatedPreviews[voice.alias] ?? savedPreview;
            const isGenerating = generating === voice.alias;
            return (
              <article className="panel voice-card" key={voice.alias}>
                <div className="voice-wave" aria-hidden="true">
                  {[18, 35, 48, 27, 52, 39, 20].map((height, index) => (
                    <span key={index} style={{ height }} />
                  ))}
                </div>
                <h3>{voice.alias}</h3>
                <p>{voice.targetModel}</p>
                <span className="status-badge verified">
                  <ShieldCheck size={13} /> 已授权存储
                </span>
                {preview ? (
                  <div className="voice-preview">
                    <audio
                      src={preview.contentUrl}
                      controls
                      preload="metadata"
                      aria-label={`${voice.alias} 试听音频`}
                    />
                  </div>
                ) : (
                  <p className="voice-preview-empty">尚未生成试听音频</p>
                )}
                <button
                  className="voice-preview-button"
                  disabled={
                    isGenerating || voice.credentialMode === undefined
                  }
                  onClick={() => void generatePreview(voice)}
                >
                  {isGenerating ? (
                    <RefreshCw className="spin" size={16} />
                  ) : (
                    <Play size={16} />
                  )}
                  {isGenerating
                    ? "正在生成"
                    : preview
                      ? "重新生成试听"
                      : "生成试听"}
                </button>
                <small className="voice-preview-note">
                  {voice.credentialMode === undefined
                    ? "旧音色缺少路由信息，需重新创建"
                    : "生成试听可能消耗少量额度"}
                </small>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function ArtifactsView({
  artifacts,
  voices,
  onCreateVoice,
  onDone,
  onNotice,
}: {
  artifacts: Artifact[];
  voices: VoiceAlias[];
  onCreateVoice: () => void;
  onDone: () => Promise<void> | void;
  onNotice: (message: string) => void;
}) {
  const [filter, setFilter] = useState<Capability>("image.generate");
  const [preview, setPreview] = useState<Artifact>();
  const closePreview = useCallback(() => setPreview(undefined), []);
  const mediaArtifacts = artifacts.filter(
    (artifact) =>
      artifact.manifest.mimeType !==
      "application/vnd.token-plan-media-hub.voice+json",
  );
  const filtered = mediaArtifacts.filter(
    (artifact) => artifact.manifest.capability === filter,
  );
  const showVoices = filter === "voice.clone";
  const showMediaEmptyState = !showVoices && filtered.length === 0;

  return (
    <>
      <PageHeading
        eyebrow="HISTORY ARTIFACTS"
        title="历史产物"
        description="集中回看媒体结果与可复用音色，追溯模型、参数和来源任务"
      />
      <div className="studio-tabs history-tabs" aria-label="历史产物分类">
        {(Object.keys(capabilityMeta) as Capability[]).map((item) => {
          const meta = capabilityMeta[item];
          const Icon = meta.icon;
          return (
            <button
              key={item}
              className={filter === item ? "active" : ""}
              onClick={() => setFilter(item)}
              aria-pressed={filter === item}
            >
              <Icon size={17} /> {meta.short}
            </button>
          );
        })}
      </div>
      {showMediaEmptyState ? (
        <EmptyState title="暂无匹配产物" body="从生成工作台创建一次演示任务即可看到结果。" />
      ) : filtered.length > 0 ? (
        <div className="artifact-grid">
          {filtered.map((artifact) => (
            <article className="artifact-card" key={artifact.artifactId}>
              <Media contentUrl={artifact.contentUrl} mimeType={artifact.manifest.mimeType} />
              <div>
                <span>{capabilityMeta[artifact.manifest.capability].label}</span>
                <h3>{artifactName(artifact)}</h3>
                <p className="artifact-model">{artifact.manifest.model}</p>
                <ArtifactVoiceMeta artifact={artifact} />
                <button
                  className="artifact-preview-link"
                  onClick={() => setPreview(artifact)}
                >
                  打开原始文件
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : null}
      {showVoices && (
        <VoiceHistorySection
          voices={voices}
          artifacts={artifacts}
          onCreate={onCreateVoice}
          onDone={onDone}
          onNotice={onNotice}
        />
      )}
      {preview !== undefined && (
        <ArtifactPreviewModal artifact={preview} onClose={closePreview} />
      )}
    </>
  );
}

function ArtifactPreviewModal({
  artifact,
  onClose,
}: {
  artifact: Artifact;
  onClose: () => void;
}) {
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    closeButton.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [onClose]);

  return (
    <div
      className="artifact-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="artifact-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="artifact-preview-title"
      >
        <header>
          <div>
            <span>{capabilityMeta[artifact.manifest.capability].label}</span>
            <h2 id="artifact-preview-title">{artifactName(artifact)}</h2>
            <p className="artifact-model">{artifact.manifest.model}</p>
            <ArtifactVoiceMeta artifact={artifact} />
          </div>
          <button
            ref={closeButton}
            className="artifact-modal-close"
            aria-label="关闭原始文件预览"
            title="关闭"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </header>
        <div className="artifact-modal-media">
          <Media
            contentUrl={artifact.contentUrl}
            mimeType={artifact.manifest.mimeType}
          />
        </div>
      </section>
    </div>
  );
}

function SettingsView({
  credentials,
  models,
  onReload,
  onNotice,
}: {
  credentials: Array<{
    kind: "token_plan" | "dashscope";
    configured: boolean;
    validationStatus: string;
    verifiedAt?: string;
  }>;
  models: ModelsResponse;
  onReload: () => Promise<void> | void;
  onNotice: (message: string) => void;
}) {
  const [tokenPlan, setTokenPlan] = useState("");
  const [dashscope, setDashscope] = useState("");
  const [saving, setSaving] = useState<string>();
  const [validating, setValidating] = useState<string>();
  const [copying, setCopying] = useState<string>();

  async function save(kind: "token_plan" | "dashscope", value: string) {
    setSaving(kind);
    try {
      await api.setCredential(kind, value);
      if (kind === "token_plan") setTokenPlan("");
      else setDashscope("");
      await onReload();
      onNotice("Key 已保存。");
    } catch (error) {
      onNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(undefined);
    }
  }

  async function remove(kind: "token_plan" | "dashscope") {
    setSaving(kind);
    try {
      await api.deleteCredential(kind);
      await onReload();
      onNotice("Key 已删除。");
    } catch (error) {
      onNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(undefined);
    }
  }

  async function validate(kind: "token_plan" | "dashscope") {
    const target = credentialProbeTarget(models, kind);
    if (target === undefined) {
      onNotice("当前没有可用于验证这份 Key 的模型。");
      return;
    }
    setValidating(kind);
    try {
      const result = await api.probe(
        target.capability,
        target.model,
        target.credentialMode,
      );
      await onReload();
      if (result.status === "verified") {
        onNotice("验证通过，这份 Key 可以使用。");
      } else {
        onNotice(
          result.error?.message ??
            "暂时无法确认这份 Key 是否可用，请稍后重试。",
        );
      }
    } catch (error) {
      onNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setValidating(undefined);
    }
  }

  async function copySaved(kind: "token_plan" | "dashscope") {
    setCopying(kind);
    try {
      await api.copyCredential(kind);
      onNotice(
        "已复制已保存的 Key。剪贴板内容可能被其他应用读取，请使用后及时覆盖。",
      );
    } catch (error) {
      onNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setCopying(undefined);
    }
  }

  async function openPlatformPage(
    page: QianwenPlatformPage,
    label: string,
  ) {
    try {
      await openQianwenPlatformPage(page);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      onNotice(`无法打开${label}：${detail}`);
    }
  }

  return (
    <>
      <PageHeading
        eyebrow="LOCAL SETTINGS"
        title="API Key"
        description="配置模型调用凭据，Key 仅加密保存在本机。"
      />
      <div className="credential-grid">
        <CredentialCard
          title="Token Plan"
          description="套餐内文本、图片和视频"
          kind="token_plan"
          placeholder="sk-sp-***"
          inputLabel="Token Plan API Key"
          hint="以 sk-sp- 开头"
          value={tokenPlan}
          onValue={setTokenPlan}
          status={credentials.find((item) => item.kind === "token_plan")}
          saving={saving === "token_plan"}
          validating={validating === "token_plan"}
          copying={copying === "token_plan"}
          canCopySaved={isDesktopRuntime()}
          onSave={() => void save("token_plan", tokenPlan)}
          onValidate={() => void validate("token_plan")}
          onDelete={() => void remove("token_plan")}
          onCopySaved={() => void copySaved("token_plan")}
          keyHelpLabel="管理或获取 API Key"
          onOpenKeyHelp={() =>
            void openPlatformPage("apiKeys", "API Key 管理页面")
          }
        />
        <CredentialCard
          title="按量付费（可选）"
          description="语音合成和声音复刻 · 按量付费"
          kind="dashscope"
          placeholder="sk-ws-*** / sk-***"
          inputLabel="Model Studio API Key"
          hint="支持 sk-ws- 和 sk- 格式"
          value={dashscope}
          onValue={setDashscope}
          status={credentials.find((item) => item.kind === "dashscope")}
          saving={saving === "dashscope"}
          validating={validating === "dashscope"}
          copying={copying === "dashscope"}
          canCopySaved={isDesktopRuntime()}
          onSave={() => void save("dashscope", dashscope)}
          onValidate={() => void validate("dashscope")}
          onDelete={() => void remove("dashscope")}
          onCopySaved={() => void copySaved("dashscope")}
          keyHelpLabel="管理或获取 API Key"
          onOpenKeyHelp={() =>
            void openPlatformPage("apiKeys", "API Key 管理页面")
          }
        />
      </div>
    </>
  );
}

function CredentialCard({
  title,
  description,
  kind,
  placeholder,
  inputLabel,
  hint,
  value,
  onValue,
  status,
  saving,
  validating,
  copying,
  canCopySaved,
  onSave,
  onValidate,
  onDelete,
  onCopySaved,
  keyHelpLabel,
  onOpenKeyHelp,
}: {
  title: string;
  description: string;
  kind: "token_plan" | "dashscope";
  placeholder: string;
  inputLabel: string;
  hint: string;
  value: string;
  onValue: (value: string) => void;
  status?: { configured: boolean; validationStatus: string; verifiedAt?: string };
  saving: boolean;
  validating: boolean;
  copying: boolean;
  canCopySaved: boolean;
  onSave: () => void;
  onValidate: () => void;
  onDelete: () => void;
  onCopySaved: () => void;
  keyHelpLabel: string;
  onOpenKeyHelp: () => void;
}) {
  const [revealed, setRevealed] = useState(false);
  const busy = saving || validating || copying;

  return (
    <article className="panel credential-card">
      <div className="credential-head">
        <span className="credential-icon"><KeyRound /></span>
        <div><h3>{title}</h3><p>{description}</p></div>
        <StatusBadge status={status?.validationStatus ?? "missing"} />
      </div>
      <div className="credential-field">
        <label htmlFor={`${kind}-credential`}>{inputLabel}</label>
        <span className="credential-input-wrap">
          <input
            id={`${kind}-credential`}
            name={`${kind}-credential`}
            type={revealed ? "text" : "password"}
            value={value}
            onChange={(event) => onValue(event.target.value)}
            placeholder={placeholder}
            autoComplete="off"
            spellCheck={false}
            aria-describedby={`${kind}-credential-hint${
              status?.configured ? ` ${kind}-credential-security-note` : ""
            }`}
          />
          <span className="credential-input-actions">
            <button
              type="button"
              className="credential-input-button"
              disabled={value.length === 0}
              aria-label={revealed ? "隐藏当前输入的 Key" : "显示当前输入的 Key"}
              title={revealed ? "隐藏 Key" : "显示 Key"}
              onClick={() => setRevealed((current) => !current)}
            >
              {revealed ? <EyeOff size={17} /> : <Eye size={17} />}
            </button>
          </span>
        </span>
        <small id={`${kind}-credential-hint`} className="credential-hint">
          {hint}
        </small>
        <button
          className="credential-key-help"
          type="button"
          onClick={onOpenKeyHelp}
        >
          {keyHelpLabel} <ExternalLink size={13} />
        </button>
        {status?.configured && (
          <small
            id={`${kind}-credential-security-note`}
            className="credential-security-note"
          >
            已保存的 Key 默认不回显；输入新 Key 后点击更新，或使用下方复制按钮。
          </small>
        )}
      </div>
      <div className="credential-actions">
        <button className="primary" disabled={!value || busy} onClick={onSave}>
          {saving ? <RefreshCw className="spin" size={16} /> : <ShieldCheck size={16} />}
          {saving
            ? status?.configured
              ? "更新中"
              : "保存中"
            : status?.configured
              ? "更新"
              : "保存"}
        </button>
        {status?.configured && (
          <button
            disabled={busy}
            title="发起一次最小真实请求，可能产生少量用量"
            onClick={onValidate}
          >
            {validating ? (
              <RefreshCw className="spin" size={16} />
            ) : (
              <Activity size={16} />
            )}
            {validating
              ? "验证中"
              : status.validationStatus === "verified"
                ? "重新验证"
                : "验证"}
          </button>
        )}
        {status?.configured && (
          <button
            disabled={busy || !canCopySaved}
            title={
              canCopySaved
                ? "复制已保存的 Key"
                : "复制已保存的 Key 仅支持桌面应用"
            }
            onClick={onCopySaved}
          >
            {copying ? (
              <RefreshCw className="spin" size={16} />
            ) : (
              <Copy size={16} />
            )}
            {copying ? "复制中" : "复制"}
          </button>
        )}
        {status?.configured && (
          <button className="danger" disabled={busy} onClick={onDelete}>
            <Trash2 size={16} /> 删除
          </button>
        )}
      </div>
      {status?.configured && (
        <small className="credential-validation-note">
          验证会调用一次对应模型，可能产生少量用量。
        </small>
      )}
    </article>
  );
}

function Preview({
  artifacts,
  job,
}: {
  artifacts: Artifact[];
  job?: MediaJob;
}) {
  const [preview, setPreview] = useState<Artifact>();
  const closePreview = useCallback(() => setPreview(undefined), []);

  if (job?.status === "failed") {
    return (
      <div className="preview-empty failed">
        <CircleAlert />
        <strong>{job.error?.code ?? "任务失败"}</strong>
        <p>{job.error?.message}</p>
      </div>
    );
  }
  if (job && ["queued", "running"].includes(job.status)) {
    return (
      <div className="preview-empty">
        <RefreshCw className="spin" />
        <strong>正在生成</strong>
        <p>任务会在后台轮询，离开页面也不会丢失。</p>
      </div>
    );
  }
  const artifact = artifacts[0];
  if (artifact === undefined) {
    return (
      <div className="preview-empty">
        <WandSparkles />
        <strong>准备好创造了吗？</strong>
        <p>填写左侧参数并提交，结果会安全地保存到本地。</p>
      </div>
    );
  }
  return (
    <>
      <div className="preview-media">
        <Media contentUrl={artifact.contentUrl} mimeType={artifact.manifest.mimeType} />
        <div className="preview-caption">
          <div>
            <strong>{artifactName(artifact)}</strong>
            <span>{artifact.manifest.model}</span>
            <ArtifactVoiceMeta artifact={artifact} compact />
          </div>
          <button
            className="artifact-preview-link"
            onClick={() => setPreview(artifact)}
          >
            打开原始文件
          </button>
        </div>
      </div>
      {preview !== undefined && (
        <ArtifactPreviewModal artifact={preview} onClose={closePreview} />
      )}
    </>
  );
}

function Media({ contentUrl, mimeType }: { contentUrl: string; mimeType: string }) {
  if (mimeType.startsWith("text/")) {
    return <TextPreview contentUrl={contentUrl} />;
  }
  if (mimeType.startsWith("image/")) return <img src={contentUrl} alt="生成产物预览" />;
  if (mimeType.startsWith("video/")) return <video src={contentUrl} controls preload="metadata" />;
  if (mimeType.startsWith("audio/")) return <div className="audio-preview"><Volume2 /><audio src={contentUrl} controls /></div>;
  return <div className="file-preview"><FileAudio /><span>安全引用产物</span></div>;
}

function TextPreview({ contentUrl }: { contentUrl: string }) {
  const [content, setContent] = useState("正在读取文本产物…");

  useEffect(() => {
    let cancelled = false;
    void fetch(contentUrl)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`读取文本产物失败：HTTP ${response.status}`);
        }
        return response.text();
      })
      .then((value) => {
        if (!cancelled) setContent(value);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setContent(error instanceof Error ? error.message : String(error));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [contentUrl]);

  return <pre className="text-preview">{content}</pre>;
}

function JobList({
  jobs,
  compact = false,
  selected,
  onSelect,
}: {
  jobs: MediaJob[];
  compact?: boolean;
  selected?: string;
  onSelect?: (id: string) => void;
}) {
  if (jobs.length === 0) {
    return <div className="empty-inline">还没有任务，去生成工作台试一次。</div>;
  }
  return (
    <div className={`job-list ${compact ? "compact" : ""}`}>
      {jobs.map((job) => {
        const meta = capabilityMeta[job.capability];
        const Icon = meta.icon;
        return (
          <button
            key={job.id}
            className={selected === job.id ? "selected" : ""}
            onClick={() => onSelect?.(job.id)}
          >
            <span className="job-icon"><Icon size={17} /></span>
            <span className="job-main">
              <strong>{meta.label}</strong>
              <small>{job.model} · {relativeTime(job.createdAt)}</small>
            </span>
            <StatusBadge status={job.status} />
          </button>
        );
      })}
    </div>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
  accent = "cyan",
}: {
  icon: typeof Boxes;
  label: string;
  value: string | number;
  accent?: string;
}) {
  return (
    <article className="metric-card">
      <span className={`metric-icon ${accent}`}><Icon /></span>
      <div><span>{label}</span><strong>{value}</strong></div>
    </article>
  );
}

function PanelTitle({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="panel-title">
      <div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>
      {action}
    </div>
  );
}

function PageHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div className="page-heading">
      <div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="field"><span>{label}</span>{children}</label>;
}

function SelectControl({
  ariaLabel,
  value,
  options,
  onChange,
}: {
  ariaLabel: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const selected = options.find((option) => option.value === value);

  useEffect(() => {
    if (!open) return;
    const closeOnOutside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutside);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutside);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  function moveSelection(offset: number) {
    if (options.length === 0) return;
    const currentIndex = Math.max(
      0,
      options.findIndex((option) => option.value === value),
    );
    const nextIndex = (currentIndex + offset + options.length) % options.length;
    onChange(options[nextIndex]!.value);
  }

  return (
    <div className={`select-control ${open ? "open" : ""}`} ref={root}>
      <button
        type="button"
        className="select-trigger"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            moveSelection(event.key === "ArrowDown" ? 1 : -1);
            setOpen(true);
          }
          if (event.key === "Escape") setOpen(false);
        }}
      >
        <span>{selected?.label ?? "请选择"}</span>
        <ChevronDown size={17} />
      </button>
      {open && (
        <div className="select-options" role="listbox" aria-label={ariaLabel}>
          {options.map((option) => (
            <button
              type="button"
              role="option"
              aria-selected={option.value === value}
              className={option.value === value ? "selected" : ""}
              key={option.value}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
            >
              <span>{option.label}</span>
              {option.value === value && <Check size={15} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const normalized =
    status === "succeeded" || status === "verified"
      ? "verified"
      : status === "failed" || status === "invalid" || status === "unavailable"
        ? "failed"
        : status === "queued" || status === "running"
          ? "running"
          : "neutral";
  const labels: Record<string, string> = {
    succeeded: "成功",
    verified: "已验证",
    failed: "失败",
    invalid: "无效",
    unavailable: "不可用",
    queued: "排队中",
    running: "运行中",
    documented: "文档确认",
    probe_required: "需要实测",
    unverified: "待验证",
    missing: "未配置",
    timeout_unknown: "状态未知",
  };
  return (
    <span className={`status-badge ${normalized}`}>
      {normalized === "running" ? <Clock3 size={12} /> : <span className="status-dot" />}
      {labels[status] ?? status}
    </span>
  );
}

function modelAvailabilityDescription(
  status: string,
  checkedAt: string | undefined,
  capability: Capability,
): string {
  if (capability === "voice.clone" && status !== "verified") {
    return "需使用已授权音频完成一次真实复刻后确认。";
  }
  if (status === "verified") {
    return checkedAt === undefined
      ? "当前模型与当前 Key 已完成实测。"
      : `当前模型与当前 Key 已完成实测 · ${relativeTime(checkedAt)}`;
  }
  if (status === "unavailable") {
    return "当前模型与 Key 的组合不可用，请检查 Key、区域或套餐权限。";
  }
  if (status === "unknown" || status === "timeout_unknown") {
    return "上次实测未能确认结果，可以稍后重试。";
  }
  if (status === "probe_required") {
    return "需要使用当前 Key 发起一次真实最小请求。";
  }
  if (status === "stale") {
    return "官方来源核对已过期，建议重新核对或实测。";
  }
  return "官方文档已列出；尚未用当前 Key 发起真实请求。";
}

function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="panel empty-state">
      <WandSparkles />
      <h2>{title}</h2>
      <p>{body}</p>
      {action}
    </div>
  );
}

function LoadingScreen() {
  return <div className="loading-screen"><RefreshCw className="spin" /><span>正在连接本地服务…</span></div>;
}

function shortId(id: string) {
  return `${id.slice(0, 8)}…${id.slice(-4)}`;
}

function artifactName(artifact: Artifact) {
  return (
    artifact.manifest.outputFilename ??
    artifact.localPath.split(/[\\/]/).pop() ??
    artifact.artifactId
  );
}

function ArtifactVoiceMeta({
  artifact,
  compact = false,
}: {
  artifact: Artifact;
  compact?: boolean;
}) {
  const voice = artifactVoiceInfo(artifact);
  if (voice === undefined) return null;
  if (compact) {
    return (
      <span className="artifact-voice-meta">
        {voice.label} · <strong>{voice.value}</strong>
      </span>
    );
  }
  return (
    <p className="artifact-voice-meta">
      <Volume2 size={12} aria-hidden="true" />
      <span>{voice.label}</span>
      <strong>{voice.value}</strong>
    </p>
  );
}

function artifactVoiceInfo(
  artifact: Artifact,
): { label: string; value: string } | undefined {
  const { capability, parameters } = artifact.manifest;
  const parameterName =
    capability === "speech.synthesize"
      ? "voice"
      : capability === "speech.synthesize_with_clone"
        ? "voice_alias"
        : undefined;
  if (parameterName === undefined) return undefined;
  const value = parameters[parameterName];
  if (typeof value !== "string" || value.trim().length === 0) return undefined;
  return {
    label: capability === "speech.synthesize" ? "系统音色" : "复刻音色",
    value,
  };
}

function encodeMonoWav(chunks: Float32Array[], sampleRate: number): Blob {
  const sampleCount = chunks.reduce(
    (total, chunk) => total + chunk.length,
    0,
  );
  const buffer = new ArrayBuffer(44 + sampleCount * 2);
  const view = new DataView(buffer);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + sampleCount * 2, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, sampleCount * 2, true);

  let offset = 44;
  for (const chunk of chunks) {
    for (const sample of chunk) {
      const clamped = Math.max(-1, Math.min(1, sample));
      view.setInt16(
        offset,
        clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff,
        true,
      );
      offset += 2;
    }
  }
  return new Blob([buffer], { type: "audio/wav" });
}

function writeAscii(view: DataView, offset: number, value: string) {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("读取录音失败。"));
    reader.readAsDataURL(blob);
  });
}

function formatRecordingTime(seconds: number) {
  const rounded = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(rounded / 60);
  return `${String(minutes).padStart(2, "0")}:${String(rounded % 60).padStart(2, "0")}`;
}

function relativeTime(value: string) {
  const difference = Date.now() - new Date(value).getTime();
  if (difference < 60_000) return "刚刚";
  if (difference < 3_600_000) return `${Math.floor(difference / 60_000)} 分钟前`;
  if (difference < 86_400_000) return `${Math.floor(difference / 3_600_000)} 小时前`;
  return new Date(value).toLocaleDateString("zh-CN");
}

function credentialProbeTarget(
  models: ModelsResponse,
  kind: "token_plan" | "dashscope",
):
  | {
      capability: Capability;
      model: string;
      credentialMode: CredentialMode;
    }
  | undefined {
  const credentialModes: CredentialMode[] =
    kind === "token_plan" ? ["token_plan"] : ["dashscope"];
  const capabilityPriority: Capability[] =
    kind === "token_plan"
      ? [
          "text.generate",
          "image.generate",
          "video.text_to_video",
        ]
      : ["speech.synthesize", "text.generate", "image.generate"];

  for (const credentialMode of credentialModes) {
    for (const capability of capabilityPriority) {
      const model = models.registry.models.find(
        (entry) =>
          entry.credentialModes.includes(credentialMode) &&
          entry.capabilities.includes(capability),
      );
      if (model !== undefined) {
        return { capability, model: model.id, credentialMode };
      }
    }
  }
  return undefined;
}

function recommendedModel(
  models: ModelsResponse["registry"]["models"],
  capability: Capability,
) {
  return (
    models.find(
      (model) =>
        model.capabilities.includes(capability) &&
        model.recommendedFor.includes(capability),
    ) ?? models.find((model) => model.capabilities.includes(capability))
  );
}
