import {
  Bot,
  Check,
  CircleAlert,
  Clock3,
  Copy,
  Download,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  Trash2,
  Wifi,
  WifiOff,
  Wrench,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { api } from "./api";
import type {
  AgentAccessResponse,
  AgentIntegrationAction,
  AgentIntegrationSnapshot,
  AgentIntegrationTask,
  GatewayHealth,
} from "./types";

type AgentFilter = "all" | "detected" | "connected";
type GatewayProbe =
  | { status: "checking" }
  | {
      status: "connected";
      health: GatewayHealth;
      latencyMs: number;
      checkedAt: string;
    }
  | { status: "disconnected"; error: string; checkedAt: string };

export function AgentsView({
  onNotice,
}: {
  onNotice: (message: string) => void;
}) {
  const [access, setAccess] = useState<AgentAccessResponse>();
  const [tasks, setTasks] = useState<Record<string, AgentIntegrationTask>>({});
  const [selectedId, setSelectedId] = useState<string>();
  const [filter, setFilter] = useState<AgentFilter>("all");
  const [search, setSearch] = useState("");
  const [gateway, setGateway] = useState<GatewayProbe>({ status: "checking" });
  const [loadingAgentId, setLoadingAgentId] = useState<string>();

  const refreshAccess = useCallback(async () => {
    const response = await api.agents();
    setAccess(response);
    setTasks((current) => {
      const next = { ...current };
      for (const task of response.tasks) next[task.agentId] = task;
      return next;
    });
    setSelectedId((current) => {
      if (response.agents.some((agent) => agent.id === current)) return current;
      return (
        response.agents.find((agent) => agent.detected)?.id ??
        response.agents[0]?.id
      );
    });
    return response;
  }, []);

  const probeGateway = useCallback(async (showChecking = true) => {
    if (showChecking) setGateway({ status: "checking" });
    try {
      const result = await api.gatewayHealth();
      setGateway({
        status: "connected",
        health: result.health,
        latencyMs: result.latencyMs,
        checkedAt: new Date().toISOString(),
      });
    } catch (error) {
      setGateway({
        status: "disconnected",
        error: error instanceof Error ? error.message : String(error),
        checkedAt: new Date().toISOString(),
      });
    }
  }, []);

  useEffect(() => {
    void refreshAccess().catch((error: unknown) => {
      onNotice(error instanceof Error ? error.message : String(error));
    });
    void probeGateway();
    const timer = window.setInterval(() => {
      void probeGateway(false);
      void refreshAccess().catch(() => undefined);
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [onNotice, probeGateway, refreshAccess]);

  const runningTaskIds = useMemo(
    () =>
      Object.values(tasks)
        .filter((task) => task.state === "running")
        .map((task) => task.id)
        .sort()
        .join(","),
    [tasks],
  );

  useEffect(() => {
    if (runningTaskIds.length === 0) return;
    let stopped = false;
    let timer: number | undefined;
    const poll = async () => {
      const ids = runningTaskIds.split(",");
      try {
        const nextTasks = await Promise.all(ids.map((id) => api.agentTask(id)));
        if (stopped) return;
        setTasks((current) => {
          const next = { ...current };
          for (const task of nextTasks) next[task.agentId] = task;
          return next;
        });
        const completed = nextTasks.filter((task) => task.state !== "running");
        if (completed.length > 0) {
          await refreshAccess();
          for (const task of completed) onNotice(taskOutcomeMessage(task));
        } else {
          timer = window.setTimeout(() => void poll(), 300);
        }
      } catch (error) {
        if (!stopped) {
          onNotice(error instanceof Error ? error.message : String(error));
        }
      }
    };
    timer = window.setTimeout(() => void poll(), 120);
    return () => {
      stopped = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [onNotice, refreshAccess, runningTaskIds]);

  const agents = access?.agents ?? [];
  const selected =
    agents.find((agent) => agent.id === selectedId) ?? agents[0];
  const selectedTask = selected === undefined ? undefined : tasks[selected.id];
  const gatewayConnected = gateway.status === "connected";
  const stats = useMemo(
    () => ({
      total: agents.length,
      detected: agents.filter((agent) => agent.detected).length,
      connected: agents.filter((agent) => agent.integration.verified).length,
      pending: agents.filter(
        (agent) =>
          agent.support.status === "supported" &&
          agent.integration.status === "installed" &&
          !agent.integration.verified,
      ).length,
    }),
    [agents],
  );
  const filteredAgents = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase();
    return agents.filter((agent) => {
      const matchesFilter =
        filter === "all" ||
        (filter === "detected" && agent.detected) ||
        (filter === "connected" && agent.integration.verified);
      const matchesSearch =
        keyword.length === 0 ||
        `${agent.name} ${agent.vendor}`.toLocaleLowerCase().includes(keyword);
      return matchesFilter && matchesSearch;
    });
  }, [agents, filter, search]);

  async function runAction(
    agent: AgentIntegrationSnapshot,
    action: AgentIntegrationAction,
  ) {
    if (tasks[agent.id]?.state === "running" || loadingAgentId !== undefined) {
      return;
    }
    setLoadingAgentId(agent.id);
    setSelectedId(agent.id);
    try {
      const next = await api.runAgentAction(agent.id, action);
      setTasks((current) => ({ ...current, [agent.id]: next }));
    } catch (error) {
      onNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setLoadingAgentId(undefined);
    }
  }

  function confirmUninstall(agent: AgentIntegrationSnapshot) {
    if (
      !window.confirm(
        `确认卸载 ${agent.name} 的 Media Hub 接入？操作会先备份配置，仅移除本应用管理的 MCP 配置。`,
      )
    ) {
      return;
    }
    void runAction(agent, "uninstall");
  }

  return (
    <>
      <div className="page-heading agent-center-heading">
        <div>
          <span className="eyebrow">AGENT ACCESS</span>
          <h1>Agent 管理中心</h1>
          <p>检测并管理本机 AI 编程 Agent 的 Media Hub 接入</p>
        </div>
        <span
          className={`status-badge ${gatewayConnected ? "verified" : "failed"}`}
        >
          {gatewayConnected ? <Wifi size={12} /> : <WifiOff size={12} />}
          {gatewayConnected
            ? `Gateway 已连接${gateway.latencyMs >= 0 ? ` · ${gateway.latencyMs} ms` : ""}`
            : "Gateway 未连接"}
        </span>
      </div>

      <section className="agent-summary-grid" aria-label="Agent 接入统计">
        <SummaryCard label="Agent 总数" value={stats.total} icon={<Bot />} />
        <SummaryCard label="本机已检测" value={stats.detected} icon={<Search />} />
        <SummaryCard label="已接入可用" value={stats.connected} icon={<Check />} />
        <SummaryCard label="等待验证" value={stats.pending} icon={<Clock3 />} />
      </section>

      <div className="agent-center-layout">
        <section className="agent-directory">
          <div className="agent-directory-toolbar">
            <div className="agent-filter-tabs" role="tablist">
              {(
                [
                  ["all", "全部"],
                  ["detected", "已检测"],
                  ["connected", "已接入"],
                ] as const
              ).map(([value, label]) => (
                <button
                  aria-selected={filter === value}
                  className={filter === value ? "active" : ""}
                  key={value}
                  onClick={() => setFilter(value)}
                  role="tab"
                >
                  {label}
                </button>
              ))}
            </div>
            <label className="agent-search">
              <Search size={14} />
              <input
                aria-label="搜索 Agent"
                onChange={(event) => setSearch(event.target.value)}
                placeholder="搜索 Agent"
                value={search}
              />
            </label>
          </div>

          <div className="agent-directory-head" aria-hidden="true">
            <span>Agent</span>
            <span>检测状态</span>
            <span>配置路径 / 接入方式</span>
            <span>接入状态</span>
            <span>版本</span>
            <span>操作</span>
          </div>
          <div className="agent-directory-list">
            {filteredAgents.map((agent) => (
              <AgentRow
                agent={agent}
                gatewayConnected={gatewayConnected}
                key={agent.id}
                loading={loadingAgentId === agent.id}
                onAction={(action) => void runAction(agent, action)}
                onSelect={() => setSelectedId(agent.id)}
                onUninstall={() => confirmUninstall(agent)}
                selected={selected?.id === agent.id}
                task={tasks[agent.id]}
              />
            ))}
            {filteredAgents.length === 0 && (
              <div className="agent-directory-empty">
                没有符合当前筛选条件的 Agent
              </div>
            )}
          </div>
          <footer className="agent-directory-footer">
            共 {filteredAgents.length} / {agents.length} 项
          </footer>
        </section>

        <aside className="agent-inspector" aria-live="polite">
          {selected === undefined ? (
            <div className="agent-directory-empty">正在检测本机 Agent…</div>
          ) : (
            <>
              <AgentDetails
                agent={selected}
                onCopy={(value) => {
                  void navigator.clipboard
                    .writeText(value)
                    .then(() => onNotice("配置路径已复制。"))
                    .catch(() => onNotice("复制失败，请手动选择路径。"));
                }}
                onRollback={() => void runAction(selected, "rollback")}
                running={selectedTask?.state === "running"}
              />
              <TaskCenter
                agent={selected}
                onNotice={onNotice}
                task={selectedTask}
              />
            </>
          )}
        </aside>
      </div>
    </>
  );
}

function SummaryCard({
  label,
  value,
  icon,
}: {
  label: string;
  value: number;
  icon: ReactNode;
}) {
  return (
    <article>
      <span>{icon}</span>
      <div>
        <small>{label}</small>
        <strong>{value}</strong>
      </div>
    </article>
  );
}

function AgentRow({
  agent,
  selected,
  gatewayConnected,
  loading,
  task,
  onSelect,
  onAction,
  onUninstall,
}: {
  agent: AgentIntegrationSnapshot;
  selected: boolean;
  gatewayConnected: boolean;
  loading: boolean;
  task?: AgentIntegrationTask;
  onSelect: () => void;
  onAction: (action: AgentIntegrationAction) => void;
  onUninstall: () => void;
}) {
  const running = task?.state === "running";
  const actionable =
    agent.support.status === "supported" &&
    agent.detected &&
    agent.launcher.ready &&
    gatewayConnected &&
    !running &&
    !loading;
  const primary = primaryAgentAction(agent);

  return (
    <article className={`agent-directory-row ${selected ? "selected" : ""}`}>
      <button className="agent-identity-button" onClick={onSelect}>
        <span className="agent-management-icon">
          <Bot size={17} />
        </span>
        <span>
          <strong>{agent.name}</strong>
          <small>{agent.vendor}</small>
        </span>
      </button>
      <span className={agent.detected ? "agent-ready" : "agent-neutral"}>
        {agent.detected ? <Check size={13} /> : <CircleAlert size={13} />}
        {agent.detected ? "已检测" : "未检测"}
      </span>
      <span className="agent-config-cell">
        <strong>{agent.configPath ?? agent.transport}</strong>
        <small>{agent.configPath === undefined ? agent.detectionNote : "本机配置文件"}</small>
      </span>
      <span className={`status-badge ${agentStatusTone(agent)}`}>
        {agentStatusLabel(agent)}
      </span>
      <span className="agent-integration-version">
        {agent.integration.version ?? "—"}
      </span>
      <div className="agent-directory-actions">
        {primary === undefined ? (
          <button disabled>
            {agent.support.status === "planned"
              ? "尚未适配"
              : agent.detected
                ? "不可操作"
                : "安装后接入"}
          </button>
        ) : (
          <button
            className="primary"
            disabled={!actionable}
            onClick={() => onAction(primary.action)}
          >
            {running || loading ? (
              <RefreshCw className="spin" size={13} />
            ) : primary.icon === "repair" ? (
              <Wrench size={13} />
            ) : (
              <Download size={13} />
            )}
            {running ? "执行中" : primary.label}
          </button>
        )}
        {agent.integration.status !== "not_installed" &&
          agent.support.status === "supported" && (
            <button
              aria-label={`卸载 ${agent.name} 接入`}
              className="agent-icon-action danger"
              disabled={!actionable}
              onClick={onUninstall}
              title="卸载接入"
            >
              <Trash2 size={13} />
            </button>
          )}
      </div>
    </article>
  );
}

function AgentDetails({
  agent,
  running,
  onCopy,
  onRollback,
}: {
  agent: AgentIntegrationSnapshot;
  running: boolean;
  onCopy: (value: string) => void;
  onRollback: () => void;
}) {
  return (
    <section className="agent-detail-card">
      <span className="agent-detail-kicker">当前选择</span>
      <header>
        <span className="agent-management-icon">
          <Bot size={18} />
        </span>
        <div>
          <h2>{agent.name}</h2>
          <p>{agent.vendor}</p>
        </div>
        <span className={`status-badge ${agentStatusTone(agent)}`}>
          {agentStatusLabel(agent)}
        </span>
      </header>
      <dl>
        <div>
          <dt>配置路径</dt>
          <dd>
            <span>{agent.configPath ?? "尚未确定安全配置路径"}</span>
            {agent.configPath !== undefined && (
              <button onClick={() => onCopy(agent.configPath ?? "")}>
                <Copy size={13} />
              </button>
            )}
          </dd>
        </div>
        <div>
          <dt>接入方式</dt>
          <dd>{agent.transport}</dd>
        </div>
        <div>
          <dt>状态说明</dt>
          <dd>{agentStatusDescription(agent)}</dd>
        </div>
        <div>
          <dt>备份与回滚</dt>
          <dd>
            {agent.backup.available
              ? "最近一次修改前的配置已备份"
              : "执行写操作前会自动创建备份"}
          </dd>
        </div>
      </dl>
      {agent.support.note !== undefined && (
        <div className="agent-adapter-note">
          <CircleAlert size={14} />
          {agent.support.note}
        </div>
      )}
      <button
        disabled={!agent.backup.canRollback || running}
        onClick={onRollback}
      >
        <RotateCcw size={14} />
        回滚最近操作
      </button>
    </section>
  );
}

function TaskCenter({
  agent,
  task,
  onNotice,
}: {
  agent: AgentIntegrationSnapshot;
  task?: AgentIntegrationTask;
  onNotice: (message: string) => void;
}) {
  const displayedSteps = task?.steps ?? idleSteps(agent);
  return (
    <section className="agent-task-panel">
      <header>
        <div>
          <span>任务中心</span>
          <h2>{agent.name} 接入流程</h2>
        </div>
        <span className={`status-badge ${taskTone(task)}`}>
          {task === undefined
            ? "等待操作"
            : task.state === "running"
              ? "进行中"
              : task.state === "succeeded"
                ? "已完成"
                : "执行失败"}
        </span>
      </header>
      <div className="agent-task-progress compact">
        <div>
          <strong>{taskTitle(task, agent.name)}</strong>
          <b>{task?.progress ?? 0}%</b>
        </div>
        <div className="agent-task-progress-track">
          <span style={{ width: `${task?.progress ?? 0}%` }} />
        </div>
        <p>{taskSubtitle(task)}</p>
      </div>
      <ol className="agent-task-steps compact">
        {displayedSteps.map((step, index) => (
          <li
            className={
              step.state === "succeeded"
                ? "complete"
                : step.state === "running"
                  ? "active"
                  : step.state
            }
            key={step.id}
          >
            <span>
              {step.state === "succeeded" ? (
                <Check size={14} />
              ) : step.state === "running" ? (
                <RefreshCw className="spin" size={14} />
              ) : step.state === "failed" ? (
                <CircleAlert size={14} />
              ) : (
                index + 1
              )}
            </span>
            <div>
              <strong>{step.title}</strong>
              <p>
                {"error" in step && step.error
                  ? step.error
                  : step.description}
              </p>
            </div>
            <small>{stepStateLabel(step.state)}</small>
          </li>
        ))}
      </ol>
      {task?.state === "failed" && (
        <div className="agent-task-message failed">
          <CircleAlert size={16} />
          <span>
            {task.error?.message ?? "任务执行失败。"}
            {task.rolledBack ? " 配置已自动回滚。" : ""}
          </span>
        </div>
      )}
      {task?.state === "succeeded" && (
        <div className="agent-task-message">
          <Check size={16} />
          <span>{successDescription(task, agent)}</span>
        </div>
      )}
      <footer>
        <span>
          {task?.completedAt
            ? `完成于 ${new Date(task.completedAt).toLocaleTimeString("zh-CN")}`
            : "尚未开始任务"}
        </span>
        <button
          onClick={() =>
            onNotice(
              task === undefined
                ? "尚无接入任务。"
                : `${task.action} · ${task.state} · ${task.progress}%`,
            )
          }
        >
          查看诊断
        </button>
      </footer>
    </section>
  );
}

function idleSteps(agent: AgentIntegrationSnapshot) {
  return [
    ["environment", "环境检测", `检查 ${agent.name}、Gateway 与 MCP 启动器`],
    ["backup", "配置备份", "备份当前 Agent 配置"],
    ["write", "安装集成", "原子写入 Media Hub MCP 配置"],
    ["readback", "读回校验", "确认命令与参数完全一致"],
    ["smoke", "可用性检查", "验证工具列表和模型列表"],
  ].map(([id, title, description]) => ({
    id: id ?? "",
    title: title ?? "",
    description: description ?? "",
    state: "pending" as const,
  }));
}

function primaryAgentAction(
  agent: AgentIntegrationSnapshot,
): { action: AgentIntegrationAction; label: string; icon: "install" | "repair" } | undefined {
  if (agent.support.status !== "supported" || !agent.detected) return undefined;
  if (agent.integration.status === "not_installed") {
    return { action: "install", label: "一键接入", icon: "install" };
  }
  if (agent.integration.status === "needs_update") {
    return { action: "update", label: "更新接入", icon: "install" };
  }
  if (!agent.integration.verified) {
    return { action: "repair", label: "继续验证", icon: "repair" };
  }
  return { action: "repair", label: "重新验证", icon: "repair" };
}

function agentStatusLabel(agent: AgentIntegrationSnapshot): string {
  if (agent.support.status === "planned") return "尚未适配";
  if (!agent.detected) return "未检测";
  if (agent.integration.status === "needs_update") return "需要更新";
  if (agent.integration.status === "not_installed") return "可接入";
  return agent.integration.verified ? "已接入" : "待验证";
}

function agentStatusTone(agent: AgentIntegrationSnapshot): string {
  if (agent.integration.verified) return "verified";
  if (
    agent.integration.status === "needs_update" ||
    (agent.integration.status === "installed" && !agent.integration.verified)
  ) {
    return "running";
  }
  if (!agent.detected || agent.support.status === "planned") return "";
  return "ready";
}

function agentStatusDescription(agent: AgentIntegrationSnapshot): string {
  if (agent.support.status === "planned") {
    return agent.support.note ?? "该 Agent 尚未开放自动配置。";
  }
  if (!agent.detected) return `${agent.detectionNote}，当前未找到。`;
  if (!agent.launcher.ready) return "Media Hub MCP 启动器尚未构建。";
  if (agent.integration.issue !== undefined) return agent.integration.issue;
  if (agent.integration.status === "needs_update") {
    return "检测到旧配置、无效配置或命令路径漂移，需要更新。";
  }
  if (agent.integration.status === "installed") {
    return agent.integration.verified
      ? `已验证 ${agent.integration.toolCount ?? 0} 个 MCP 工具。`
      : "配置已经存在，但尚未完成可用性验证。";
  }
  return "已检测到本机 Agent，可以一键接入。";
}

function taskTitle(
  task: AgentIntegrationTask | undefined,
  agentName: string,
): string {
  if (task === undefined) return "选择操作开始接入";
  const actions: Record<AgentIntegrationAction, string> = {
    install: "安装",
    update: "更新",
    repair: "验证",
    uninstall: "卸载",
    rollback: "回滚",
  };
  return task.state === "running"
    ? `正在${actions[task.action]} ${agentName}`
    : `${agentName} ${actions[task.action]}${
        task.state === "succeeded" ? "完成" : "失败"
      }`;
}

function taskSubtitle(task: AgentIntegrationTask | undefined): string {
  if (task === undefined) return "所有写操作都会在修改前创建配置备份";
  const active = task.steps.find((step) => step.state === "running");
  if (active !== undefined) return `当前步骤：${active.title}`;
  if (task.state === "failed") {
    return task.rolledBack ? "执行失败，配置已自动回滚" : "执行失败";
  }
  return task.state === "succeeded" ? "配置读回结果已确认" : "等待任务状态";
}

function taskTone(task: AgentIntegrationTask | undefined): string {
  if (task?.state === "succeeded") return "verified";
  if (task?.state === "running") return "running";
  if (task?.state === "failed") return "failed";
  return "";
}

function stepStateLabel(
  state: AgentIntegrationTask["steps"][number]["state"],
): string {
  if (state === "succeeded") return "已完成";
  if (state === "running") return "进行中";
  if (state === "failed") return "失败";
  return "待开始";
}

function taskOutcomeMessage(task: AgentIntegrationTask): string {
  if (task.state === "succeeded") {
    if (task.action === "uninstall") return "Agent 接入已卸载。";
    if (task.action === "rollback") return "Agent 配置已回滚。";
    return `接入完成，${task.result?.toolCount ?? 0} 个工具可用。`;
  }
  return task.rolledBack
    ? `${task.error?.message ?? "接入失败"} 配置已自动回滚。`
    : task.error?.message ?? "Agent 接入失败。";
}

function successDescription(
  task: AgentIntegrationTask,
  agent: AgentIntegrationSnapshot,
): string {
  if (task.action === "uninstall") {
    return `已移除 ${agent.name} 中的 Media Hub 配置，其他设置保持不变。`;
  }
  if (task.action === "rollback") return "配置已恢复到最近一次操作前状态。";
  return `已完成配置与 MCP 校验。${agent.restartHint}`;
}
