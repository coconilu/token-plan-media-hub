import {
  Activity,
  Bot,
  Boxes,
  Check,
  ChevronRight,
  CircleAlert,
  Clock3,
  FileAudio,
  FileText,
  Film,
  Gauge,
  Image,
  KeyRound,
  LayoutDashboard,
  Menu,
  Mic2,
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
  | "models"
  | "generate"
  | "voices"
  | "artifacts"
  | "agents"
  | "settings";

const VOICE_CLONE_READING_TEXT =
  "今天的天气很好，微风穿过窗边的树叶。我正在用自然、清晰的声音录制一段样本，希望这段声音能准确保留我的语气、节奏和表达习惯。";

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
  { id: "models", label: "模型", icon: Boxes },
  { id: "generate", label: "生成工作台", icon: WandSparkles },
  { id: "voices", label: "声音", icon: Mic2 },
  { id: "artifacts", label: "产物", icon: Image },
  { id: "agents", label: "Agent 接入", icon: Bot },
  { id: "settings", label: "设置", icon: Settings },
];

export function App() {
  const [view, setView] = useState<View>("overview");
  const [menuOpen, setMenuOpen] = useState(false);
  const [mode, setMode] = useState<"demo" | "real">("demo");
  const [models, setModels] = useState<ModelsResponse>();
  const [jobs, setJobs] = useState<MediaJob[]>([]);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [voices, setVoices] = useState<VoiceAlias[]>([]);
  const [credentials, setCredentials] = useState<
    Awaited<ReturnType<typeof api.credentials>>["credentials"]
  >([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string>();

  const reload = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const [runtime, modelData, jobData, artifactData, voiceData, credentialData] =
        await Promise.all([
          api.runtime(),
          api.models(),
          api.jobs(),
          api.artifacts(),
          api.voices(),
          api.credentials(),
        ]);
      setMode(runtime.mode);
      setModels(modelData);
      setJobs(jobData.jobs);
      setArtifacts(artifactData.artifacts);
      setVoices(voiceData.voices);
      setCredentials(credentialData.credentials);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
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

  async function changeMode(next: "demo" | "real") {
    try {
      await api.setRuntime(next);
      setMode(next);
      await reload(true);
      setNotice(
        next === "demo"
          ? "已切换到演示模式，不会调用外部模型。"
          : "已切换到真实模式；缺少凭据时请求会明确失败，不会回退。",
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  }

  function navigate(next: View) {
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
            mode={mode}
            onNavigate={navigate}
          />
        );
      case "models":
        return <ModelsView data={models} mode={mode} />;
      case "generate":
        return (
          <GenerateView
            models={models}
            jobs={jobs}
            artifacts={artifacts}
            voices={voices}
            mode={mode}
            onDone={() => reload(true)}
            onNotice={setNotice}
          />
        );
      case "voices":
        return (
          <VoicesView
            voices={voices}
            onCreate={() => navigate("generate")}
          />
        );
      case "artifacts":
        return <ArtifactsView artifacts={artifacts} />;
      case "agents":
        return <AgentsView />;
      case "settings":
        return (
          <SettingsView
            mode={mode}
            credentials={credentials}
            onMode={changeMode}
            onReload={() => reload(true)}
            onNotice={setNotice}
          />
        );
    }
  })();

  return (
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
        <div className="sidebar-bottom">
          <div className={`mode-chip ${mode}`}>
            <span className="status-dot" />
            {mode === "demo" ? "演示模式" : "真实模式"}
          </div>
          <p>本地优先 · 回环监听</p>
        </div>
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
            <div>
              <span>控制台</span>
              <strong>{navItems.find((item) => item.id === view)?.label}</strong>
            </div>
          </div>
          <div className="topbar-actions">
            <div className={`mode-chip ${mode}`}>
              <span className="status-dot" />
              {mode === "demo" ? "演示" : "真实"}
            </div>
            <button
              className="icon-button"
              aria-label="刷新数据"
              title="刷新数据"
              onClick={() => void reload()}
            >
              <RefreshCw size={18} className={loading ? "spin" : ""} />
            </button>
          </div>
        </header>
        <section className="page">{page}</section>
      </main>

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

function Overview({
  models,
  jobs,
  artifacts,
  mode,
  onNavigate,
}: {
  models: ModelsResponse;
  jobs: MediaJob[];
  artifacts: Artifact[];
  mode: "demo" | "real";
  onNavigate: (view: View) => void;
}) {
  const succeeded = jobs.filter((job) => job.status === "succeeded").length;
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
          label="当前运行"
          value={mode === "demo" ? "演示" : "真实"}
          accent={mode === "demo" ? "amber" : "cyan"}
        />
      </div>

      <div className="split-grid">
        <section className="panel">
          <PanelTitle
            title="能力入口"
            subtitle="从模型注册表动态读取"
            action={
              <button className="text-button" onClick={() => onNavigate("models")}>
                查看模型 <ChevronRight size={15} />
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
                <button key={key} onClick={() => onNavigate("generate")}>
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
              <button className="text-button" onClick={() => onNavigate("generate")}>
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

function ModelsView({
  data,
  mode,
}: {
  data: ModelsResponse;
  mode: "demo" | "real";
}) {
  return (
    <>
      <PageHeading
        eyebrow="MODEL REGISTRY"
        title="模型与能力"
        description={`唯一事实入口 · ${data.registry.provider} · ${data.registry.region}`}
      />
      <div className="info-banner">
        <ShieldCheck size={19} />
        <span>
          {mode === "demo"
            ? "演示模式模拟完整任务链路，不代表模型云端可用性。"
            : "真实模式严格按凭据路由调用，不会在 Token Plan 与普通百炼之间自动回退。"}
        </span>
      </div>
      <div className="model-grid">
        {data.registry.models.map((model) => (
          <article className="model-card" key={model.id}>
            <div className="model-card-head">
              <div className="model-logo">{model.id.slice(0, 2).toUpperCase()}</div>
              <div className="model-statuses">
                {model.recommendedFor.length > 0 && (
                  <span className="recommend-badge">
                    <Sparkles size={12} /> 推荐
                  </span>
                )}
                <StatusBadge status={model.availability} />
              </div>
            </div>
            <h3>{model.id}</h3>
            <p>{model.execution === "async" ? "异步任务" : "同步返回"}</p>
            <div className="tag-row">
              {model.capabilities.map((capability) => (
                <span key={capability}>{capabilityMeta[capability].short}</span>
              ))}
            </div>
            <dl>
              <div><dt>凭据</dt><dd>{model.credentialModes.join(" / ")}</dd></div>
              <div><dt>来源核对</dt><dd>{model.source.verifiedAt}</dd></div>
            </dl>
            <a href={model.source.url} target="_blank" rel="noreferrer">
              查看官方来源 <ChevronRight size={15} />
            </a>
          </article>
        ))}
      </div>
    </>
  );
}

function GenerateView({
  models,
  jobs,
  artifacts,
  voices,
  mode,
  onDone,
  onNotice,
}: {
  models: ModelsResponse;
  jobs: MediaJob[];
  artifacts: Artifact[];
  voices: VoiceAlias[];
  mode: "demo" | "real";
  onDone: () => Promise<void> | void;
  onNotice: (message: string) => void;
}) {
  const [capability, setCapability] = useState<Capability>("image.generate");
  const matching = models.registry.models.filter((model) =>
    model.capabilities.includes(capability),
  );
  const [model, setModel] = useState(
    recommendedModel(models.registry.models, capability)?.id ?? "",
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
  const [voice, setVoice] = useState("Cherry");
  const [size, setSize] = useState("1024*1024");
  const [resolution, setResolution] = useState("720P");
  const [ratio, setRatio] = useState("16:9");
  const [duration, setDuration] = useState(5);
  const [language, setLanguage] = useState("Auto");
  const [voiceAlias, setVoiceAlias] = useState("");
  const [cloneName, setCloneName] = useState("my-voice");
  const [referenceAudio, setReferenceAudio] = useState("");
  const [referenceAudioLabel, setReferenceAudioLabel] = useState("");
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [selectedJobId, setSelectedJobId] = useState(jobs[0]?.id);

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

  const selectedJob = jobs.find((job) => job.id === selectedJobId) ?? jobs[0];
  const selectedArtifacts = selectedJob
    ? artifacts.filter((artifact) => selectedJob.artifactIds.includes(artifact.artifactId))
    : [];

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (capability === "voice.clone" && referenceAudio.length === 0) {
      onNotice("请先录制或上传一段参考音频。");
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
        description="统一提交、轮询、下载和清单归档"
      />
      <div className="studio-tabs">
        {(Object.keys(capabilityMeta) as Capability[]).map((item) => {
          const meta = capabilityMeta[item];
          const Icon = meta.icon;
          return (
            <button
              key={item}
              className={capability === item ? "active" : ""}
              onClick={() => setCapability(item)}
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
            subtitle={mode === "demo" ? "演示 Provider" : "真实 Provider"}
          />
          <Field label="模型">
            <select value={model} onChange={(event) => setModel(event.target.value)}>
              {matching.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.id}
                  {entry.recommendedFor.includes(capability) ? "（推荐）" : ""}
                </option>
              ))}
            </select>
          </Field>
          <Field label="凭据路由">
            <select
              value={credentialMode}
              onChange={(event) =>
                setCredentialMode(event.target.value as CredentialMode)
              }
            >
              {(matching.find((entry) => entry.id === model)?.credentialModes ?? []).map(
                (item) => <option key={item} value={item}>{item}</option>,
              )}
            </select>
          </Field>

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
            <div className="field-grid">
              <Field label="分辨率">
                <select
                  value={resolution}
                  onChange={(event) => setResolution(event.target.value)}
                >
                  <option value="720P">720P</option>
                  <option value="1080P">1080P</option>
                </select>
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
              <input value={voice} onChange={(event) => setVoice(event.target.value)} required />
            </Field>
          )}
          {(capability === "speech.synthesize" ||
            capability === "speech.synthesize_with_clone" ||
            capability === "voice.clone") && (
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
              <select
                value={voiceAlias}
                onChange={(event) => setVoiceAlias(event.target.value)}
                required
              >
                <option value="">选择已授权音色</option>
                {voices.map((item) => (
                  <option key={item.alias} value={item.alias}>{item.alias}</option>
                ))}
              </select>
            </Field>
          )}
          {capability === "voice.clone" && (
            <>
              <Field label="本地音色别名">
                <input
                  value={cloneName}
                  onChange={(event) => setCloneName(event.target.value)}
                  required
                />
              </Field>
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
              <label className="consent-row">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(event) => setConsent(event.target.checked)}
                  required
                />
                <span>我确认拥有该声音，或已获得明确的声音复刻授权。</span>
              </label>
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
            {mode === "demo"
              ? "演示模式不访问外部网络，产物仍会写入本地 manifest。"
              : "真实模式将消耗相应套餐或账户额度。"}
          </p>
        </form>

        <section className="panel preview-panel">
          <PanelTitle title="预览" subtitle={selectedJob ? shortId(selectedJob.id) : "等待生成"} />
          <Preview artifacts={selectedArtifacts} job={selectedJob} />
        </section>
      </div>

      <section className="panel job-panel">
        <PanelTitle title="任务历史" subtitle={`${jobs.length} 个本地任务`} />
        <JobList jobs={jobs} onSelect={setSelectedJobId} selected={selectedJob?.id} />
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
    if (
      navigator.mediaDevices?.getUserMedia === undefined ||
      window.AudioContext === undefined
    ) {
      onNotice("当前浏览器不支持页面录音，请改用 WAV、MP3 或 M4A 文件上传。");
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
          ? "麦克风权限未开启，请允许访问后重试，或改用文件上传。"
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
          <strong>直接录制参考声音</strong>
          <small>生成单声道 16-bit WAV，不会上传到公共仓库</small>
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

function VoicesView({
  voices,
  onCreate,
}: {
  voices: VoiceAlias[];
  onCreate: () => void;
}) {
  return (
    <>
      <PageHeading
        eyebrow="VOICE VAULT"
        title="声音"
        description="仅展示本地别名；Provider 音色 ID 加密存储"
        action={<button className="primary" onClick={onCreate}><Mic2 size={17} />创建音色</button>}
      />
      <div className="info-banner warning">
        <ShieldCheck size={19} />
        <span>声音复刻必须取得明确授权。参考音频、真实音色 ID 和私人媒体不会进入 Git。</span>
      </div>
      {voices.length === 0 ? (
        <EmptyState
          title="还没有本地音色"
          body="可先在演示模式体验完整授权、加密引用和清单归档流程。"
          action={<button onClick={onCreate}>前往声音复刻</button>}
        />
      ) : (
        <div className="voice-grid">
          {voices.map((voice) => (
            <article className="panel voice-card" key={voice.alias}>
              <div className="voice-wave" aria-hidden="true">
                {[18, 35, 48, 27, 52, 39, 20].map((height, index) => (
                  <span key={index} style={{ height }} />
                ))}
              </div>
              <h3>{voice.alias}</h3>
              <p>{voice.targetModel}</p>
              <span className="status-badge verified"><ShieldCheck size={13} /> 已授权存储</span>
            </article>
          ))}
        </div>
      )}
    </>
  );
}

function ArtifactsView({ artifacts }: { artifacts: Artifact[] }) {
  const [filter, setFilter] =
    useState<"all" | "text" | "image" | "video" | "audio">("all");
  const filtered = artifacts.filter((artifact) =>
    filter === "all" ? true : artifact.manifest.mimeType.startsWith(`${filter}/`),
  );
  return (
    <>
      <PageHeading
        eyebrow="LOCAL ARTIFACTS"
        title="产物"
        description="媒体文件与 manifest 成对保存，可追溯模型、参数和来源任务"
      />
      <div className="filter-row">
        {(["all", "text", "image", "video", "audio"] as const).map((item) => (
          <button
            key={item}
            className={filter === item ? "active" : ""}
            onClick={() => setFilter(item)}
          >
            {item === "all"
              ? "全部"
              : item === "text"
                ? "文本"
                : item === "image"
                  ? "图片"
                  : item === "video"
                    ? "视频"
                    : "音频"}
          </button>
        ))}
      </div>
      {filtered.length === 0 ? (
        <EmptyState title="暂无匹配产物" body="从生成工作台创建一次演示任务即可看到结果。" />
      ) : (
        <div className="artifact-grid">
          {filtered.map((artifact) => (
            <article className="artifact-card" key={artifact.artifactId}>
              <Media contentUrl={artifact.contentUrl} mimeType={artifact.manifest.mimeType} />
              <div>
                <span>{capabilityMeta[artifact.manifest.capability].label}</span>
                <h3>{artifactName(artifact)}</h3>
                <p>{artifact.manifest.model}</p>
                <a href={artifact.contentUrl} download>打开原始文件</a>
              </div>
            </article>
          ))}
        </div>
      )}
    </>
  );
}

function AgentsView() {
  const agents = [
    ["Codex", "stdio MCP", "skills + MCP"],
    ["Claude Code", "stdio MCP", "薄适配器"],
    ["Kimi Code CLI", "stdio / HTTP", "薄适配器"],
  ];
  return (
    <>
      <PageHeading
        eyebrow="AGENT ACCESS"
        title="Agent 接入"
        description="所有 Agent 通过统一 core 与 MCP 服务访问，不各自实现 Provider"
      />
      <div className="agent-grid">
        {agents.map(([name, transport, detail]) => (
          <article className="panel agent-card" key={name}>
            <div className="agent-icon"><Bot /></div>
            <div><h3>{name}</h3><p>{transport}</p></div>
            <span className="status-badge verified"><Check size={13} /> 本地可接入</span>
            <small>{detail}</small>
          </article>
        ))}
      </div>
      <section className="panel architecture-note">
        <PanelTitle title="统一调用边界" subtitle="Provider 逻辑只存在一份" />
        <div className="flow-row">
          <span>Dashboard</span><ChevronRight /><span>HTTP / MCP / CLI</span>
          <ChevronRight /><span>packages/core</span><ChevronRight /><span>Provider</span>
        </div>
      </section>
    </>
  );
}

function SettingsView({
  mode,
  credentials,
  onMode,
  onReload,
  onNotice,
}: {
  mode: "demo" | "real";
  credentials: Array<{
    kind: "token_plan" | "dashscope";
    configured: boolean;
    validationStatus: string;
    verifiedAt?: string;
  }>;
  onMode: (mode: "demo" | "real") => Promise<void>;
  onReload: () => Promise<void> | void;
  onNotice: (message: string) => void;
}) {
  const [tokenPlan, setTokenPlan] = useState("");
  const [dashscope, setDashscope] = useState("");
  const [saving, setSaving] = useState<string>();

  async function save(kind: "token_plan" | "dashscope", value: string) {
    setSaving(kind);
    try {
      await api.setCredential(kind, value);
      if (kind === "token_plan") setTokenPlan("");
      else setDashscope("");
      await onReload();
      onNotice("凭据已加密保存；需探测后才能标记为 verified。");
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
      onNotice("凭据引用与本地密文已删除。");
    } catch (error) {
      onNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(undefined);
    }
  }

  return (
    <>
      <PageHeading
        eyebrow="LOCAL SETTINGS"
        title="设置与凭据"
        description="凭据只保存在本机 DPAPI 加密仓库，不会出现在页面回显和日志中"
      />
      <section className="panel mode-panel">
        <PanelTitle title="运行模式" subtitle="切换立即生效并持久化到本地 runtime" />
        <div className="mode-options">
          <button className={mode === "demo" ? "active" : ""} onClick={() => void onMode("demo")}>
            <Sparkles /><span><strong>演示模式</strong><small>无需 Key，完整体验任务与产物链路</small></span>
          </button>
          <button className={mode === "real" ? "active" : ""} onClick={() => void onMode("real")}>
            <Activity /><span><strong>真实模式</strong><small>调用阿里云接口并产生实际用量</small></span>
          </button>
        </div>
      </section>

      <div className="credential-grid">
        <CredentialCard
          title="Token Plan Key"
          kind="token_plan"
          placeholder="sk-sp-***"
          inputLabel="输入 Token Plan Key"
          hint="仅用于 Token Plan 套餐路由；不会自动切换到普通百炼。"
          value={tokenPlan}
          onValue={setTokenPlan}
          status={credentials.find((item) => item.kind === "token_plan")}
          saving={saving === "token_plan"}
          onSave={() => void save("token_plan", tokenPlan)}
          onDelete={() => void remove("token_plan")}
        />
        <CredentialCard
          title="Model Studio API Key（可选）"
          kind="dashscope"
          placeholder="sk-ws-*** / sk-***"
          inputLabel="输入普通百炼 Key（可选）"
          hint="兼容新版 sk-ws- 与旧版 sk- Key；按量付费，与 Token Plan Key 不可混用。"
          value={dashscope}
          onValue={setDashscope}
          status={credentials.find((item) => item.kind === "dashscope")}
          saving={saving === "dashscope"}
          onSave={() => void save("dashscope", dashscope)}
          onDelete={() => void remove("dashscope")}
        />
      </div>

      <div className="info-banner warning">
        <CircleAlert size={19} />
        <span>
          无隐式回退：token_plan、token_plan_probe 与 dashscope 是显式路由。任一路由缺少 Key
          都会失败，不会偷偷改用另一账户。
        </span>
      </div>
      <section className="panel route-table">
        <PanelTitle title="凭据路由" subtitle="由 model-registry 约束" />
        <div className="table-row table-head"><span>路由</span><span>凭据来源</span><span>用途</span></div>
        <div className="table-row"><code>token_plan</code><span>Token Plan Key</span><span>套餐内图片 / 视频</span></div>
        <div className="table-row"><code>token_plan_probe</code><span>Token Plan Key</span><span>需实测的语音能力</span></div>
        <div className="table-row"><code>dashscope</code><span>Model Studio Key（sk-ws- / sk-）</span><span>普通百炼语音能力</span></div>
      </section>
    </>
  );
}

function CredentialCard({
  title,
  kind,
  placeholder,
  inputLabel,
  hint,
  value,
  onValue,
  status,
  saving,
  onSave,
  onDelete,
}: {
  title: string;
  kind: "token_plan" | "dashscope";
  placeholder: string;
  inputLabel: string;
  hint: string;
  value: string;
  onValue: (value: string) => void;
  status?: { configured: boolean; validationStatus: string; verifiedAt?: string };
  saving: boolean;
  onSave: () => void;
  onDelete: () => void;
}) {
  return (
    <article className="panel credential-card">
      <div className="credential-head">
        <span className="credential-icon"><KeyRound /></span>
        <div><h3>{title}</h3><p>{status?.configured ? "已配置，不可回显" : "尚未配置"}</p></div>
        <StatusBadge status={status?.validationStatus ?? "missing"} />
      </div>
      <label>
        <span>{inputLabel}</span>
        <input
          id={`${kind}-credential`}
          name={`${kind}-credential`}
          type="password"
          value={value}
          onChange={(event) => onValue(event.target.value)}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
        />
        <small className="credential-hint">{hint}</small>
      </label>
      <div className="credential-actions">
        <button className="primary" disabled={!value || saving} onClick={onSave}>
          {saving ? <RefreshCw className="spin" size={16} /> : <ShieldCheck size={16} />}
          加密保存
        </button>
        {status?.configured && (
          <button className="danger" disabled={saving} onClick={onDelete}>
            <Trash2 size={16} /> 删除
          </button>
        )}
      </div>
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
    <div className="preview-media">
      <Media contentUrl={artifact.contentUrl} mimeType={artifact.manifest.mimeType} />
      <div className="preview-caption">
        <div><strong>{artifactName(artifact)}</strong><span>{artifact.manifest.model}</span></div>
        <a href={artifact.contentUrl} download>下载</a>
      </div>
    </div>
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
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="page-heading">
      <div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>
      {action}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="field"><span>{label}</span>{children}</label>;
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
    unverified: "未验证",
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
