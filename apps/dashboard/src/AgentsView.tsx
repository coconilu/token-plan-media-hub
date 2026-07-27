import {
  Bot,
  Check,
  ChevronRight,
  CircleAlert,
  Clock3,
  Download,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Trash2,
  Wifi,
  WifiOff,
  Wrench,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { api } from "./api";
import type {
  AgentAccessResponse,
  AgentIntegrationAction,
  AgentIntegrationTask,
  GatewayHealth,
} from "./types";

type GatewayProbe =
  | { status: "checking" }
  | {
      status: "connected";
      health: GatewayHealth;
      latencyMs: number;
      checkedAt: string;
    }
  | { status: "disconnected"; error: string; checkedAt: string };

const idleSteps = [
  {
    id: "environment",
    title: "环境检测",
    description: "检查 Codex、Gateway 与 MCP 启动器",
  },
  {
    id: "backup",
    title: "配置备份",
    description: "备份当前 config.toml",
  },
  {
    id: "write",
    title: "安装集成",
    description: "原子写入 Media Hub MCP 配置",
  },
  {
    id: "readback",
    title: "读回校验",
    description: "确认命令与参数完全一致",
  },
  {
    id: "smoke",
    title: "MCP 烟测",
    description: "验证 10 个工具和 list_models",
  },
] as const;

export function AgentsView({
  onNotice,
}: {
  onNotice: (message: string) => void;
}) {
  const [access, setAccess] = useState<AgentAccessResponse>();
  const [task, setTask] = useState<AgentIntegrationTask>();
  const [gateway, setGateway] = useState<GatewayProbe>({
    status: "checking",
  });
  const [loading, setLoading] = useState(false);

  const refreshAccess = useCallback(async () => {
    const response = await api.agents();
    setAccess(response);
    if (response.task !== undefined) setTask(response.task);
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
      if (task?.state !== "running") {
        void refreshAccess().catch(() => undefined);
      }
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [onNotice, probeGateway, refreshAccess, task?.state]);

  useEffect(() => {
    if (task?.state !== "running") return;
    let stopped = false;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const next = await api.agentTask(task.id);
        if (stopped) return;
        setTask(next);
        if (next.state === "running") {
          timer = window.setTimeout(() => void poll(), 250);
        } else {
          await refreshAccess();
          onNotice(taskOutcomeMessage(next));
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
  }, [onNotice, refreshAccess, task?.id, task?.state]);

  const agent = access?.agents[0];
  const gatewayConnected = gateway.status === "connected";
  const integrationStatus = agent?.integration.status ?? "not_installed";
  const installed = integrationStatus === "installed";
  const needsUpdate = integrationStatus === "needs_update";
  const running = task?.state === "running";
  const mutationReady =
    agent?.detected === true &&
    agent.launcher.ready &&
    gatewayConnected &&
    !running &&
    !loading;
  const primaryAction: AgentIntegrationAction = needsUpdate
    ? "update"
    : installed
      ? "repair"
      : "install";

  const displayedSteps = useMemo(
    () =>
      task?.steps ??
      idleSteps.map((step) => ({
        ...step,
        state: "pending" as const,
      })),
    [task],
  );

  async function runAction(action: AgentIntegrationAction) {
    if (running || loading) return;
    setLoading(true);
    try {
      const next = await api.runAgentAction(action);
      setTask(next);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }

  function confirmUninstall() {
    if (
      !window.confirm(
        "确认卸载 Codex 的 Token Plan Media Hub 接入？操作会先备份 config.toml，仅移除本应用管理的 MCP 配置段。",
      )
    ) {
      return;
    }
    void runAction("uninstall");
  }

  return (
    <>
      <div className="page-heading">
        <span>AGENT ACCESS</span>
        <h1>Codex 接入</h1>
        <p>真实备份、写入、读回与 MCP 烟测，不再使用模拟安装状态</p>
      </div>

      <div className="agent-preview-note real" role="note">
        <ShieldCheck size={15} />
        <span>
          真实操作：接入、更新和卸载会修改 {agent?.configPath ?? "Codex config.toml"}；
          每次修改前都会创建备份，失败时自动回滚。
        </span>
      </div>

      <div className="agent-lifecycle-layout">
        <div className="agent-lifecycle-main">
          <section className="agent-connect-hero">
            <div className="agent-connect-hero-copy">
              <div className="agent-connect-mark">
                <Bot size={33} />
                <span>
                  {agent?.integration.verified ? (
                    <Check size={13} />
                  ) : (
                    <CircleAlert size={13} />
                  )}
                </span>
              </div>
              <div>
                <h2>让 Codex 使用 Media Hub</h2>
                <p>自动备份配置，并验证 10 个 MCP 工具真实可用</p>
              </div>
            </div>

            <div className="agent-connect-actions">
              <button
                className="primary"
                disabled={!mutationReady}
                onClick={() => void runAction(primaryAction)}
              >
                {running || loading ? (
                  <RefreshCw className="spin" size={17} />
                ) : installed ? (
                  <Wrench size={17} />
                ) : (
                  <Download size={17} />
                )}
                {running
                  ? "正在执行真实接入…"
                  : needsUpdate
                    ? "更新 Codex 接入"
                    : installed
                      ? "修复并重新验证"
                      : "一键接入 Codex"}
              </button>
              <button
                disabled={!agent?.backup.canRollback || running || loading}
                onClick={() => void runAction("rollback")}
              >
                <RotateCcw size={15} />
                回滚最近操作
              </button>
            </div>

            <div className="agent-connect-benefits">
              <div>
                <ShieldCheck size={18} />
                <span>
                  <strong>真实配置备份</strong>保留原文件内容
                </span>
              </div>
              <div>
                <Wrench size={18} />
                <span>
                  <strong>原子写入配置</strong>不覆盖其他设置
                </span>
              </div>
              <div>
                <Check size={18} />
                <span>
                  <strong>真实 MCP 烟测</strong>校验工具与模型
                </span>
              </div>
              <div>
                <RotateCcw size={18} />
                <span>
                  <strong>冲突保护回滚</strong>拒绝覆盖新修改
                </span>
              </div>
            </div>
          </section>

          <section className="agent-management">
            <div className="agent-management-heading">
              <div>
                <h2>Codex 接入状态</h2>
                <p>{agentStatusDescription(agent)}</p>
              </div>
              <span
                className={`status-badge ${
                  gatewayConnected ? "verified" : "failed"
                }`}
              >
                {gatewayConnected ? <Wifi size={12} /> : <WifiOff size={12} />}
                {gatewayConnected ? "Gateway 已连接" : "Gateway 未连接"}
              </span>
            </div>

            <div className="agent-management-table">
              <div className="agent-management-table-head" aria-hidden="true">
                <span>Agent</span>
                <span>检测状态</span>
                <span>接入版本</span>
                <span>状态与操作</span>
              </div>
              <article className="agent-management-row">
                <span
                  className={`agent-selection-toggle ${
                    agent?.integration.verified ? "selected" : ""
                  }`}
                >
                  {agent?.integration.verified && <Check size={13} />}
                </span>
                <div className="agent-management-identity">
                  <span className="agent-management-icon">
                    <Bot size={17} />
                  </span>
                  <div>
                    <strong>Codex</strong>
                    <small>{agent?.configPath ?? "正在检测 config.toml"}</small>
                  </div>
                </div>
                <span
                  className={agent?.detected ? "agent-ready" : "agent-missing"}
                >
                  {agent?.detected ? (
                    <Check size={13} />
                  ) : (
                    <CircleAlert size={13} />
                  )}
                  {agent?.detected ? "本机已检测" : "未检测到 Codex"}
                </span>
                <span className="agent-integration-version">
                  {agent?.integration.version ?? "—"}
                </span>
                <div className="agent-row-actions">
                  <span
                    className={`status-badge ${
                      installed
                        ? agent?.integration.verified
                          ? "verified"
                          : "running"
                        : needsUpdate
                          ? "running"
                          : ""
                    }`}
                  >
                    {installed
                      ? agent?.integration.verified
                        ? "已验证"
                        : "待验证"
                      : needsUpdate
                        ? "需要更新"
                        : "未接入"}
                  </span>
                  {installed ? (
                    <>
                      <button
                        disabled={!mutationReady}
                        onClick={() => void runAction("update")}
                      >
                        <RefreshCw size={13} /> 更新
                      </button>
                      <button
                        disabled={!mutationReady}
                        onClick={() => void runAction("repair")}
                      >
                        <Wrench size={13} /> 修复
                      </button>
                      <button
                        className="danger"
                        disabled={!mutationReady}
                        onClick={confirmUninstall}
                      >
                        <Trash2 size={13} /> 卸载
                      </button>
                    </>
                  ) : (
                    <button
                      className="agent-row-install"
                      disabled={!mutationReady}
                      onClick={() =>
                        void runAction(needsUpdate ? "update" : "install")
                      }
                    >
                      {needsUpdate ? "更新接入" : "一键接入"}
                    </button>
                  )}
                </div>
              </article>
            </div>
          </section>

          <section className="agent-restart-note">
            <Clock3 size={20} />
            <div>
              <strong>接入完成后，需要新建 Codex 任务</strong>
              <p>
                Codex 在任务启动时加载 MCP。当前任务不会自动获得刚写入的工具。
              </p>
            </div>
          </section>

          <section className="agent-data-note">
            <ShieldCheck size={17} />
            <span>卸载只移除 Media Hub 配置，不删除 Key、任务或媒体产物</span>
            <button
              onClick={() =>
                onNotice(
                  agent?.backup.canRollback
                    ? "最近备份可安全回滚；若配置被其他程序修改，系统会拒绝覆盖。"
                    : "当前没有可安全回滚的最近备份。",
                )
              }
            >
              备份说明 <ChevronRight size={14} />
            </button>
          </section>
        </div>

        <aside className="agent-task-center" aria-live="polite">
          <div className="agent-task-center-head">
            <div>
              <span>INSTALLATION</span>
              <h2>真实任务中心</h2>
            </div>
            <span
              className={`status-badge ${
                task?.state === "succeeded"
                  ? "verified"
                  : task?.state === "running"
                    ? "running"
                    : task?.state === "failed"
                      ? "failed"
                      : ""
              }`}
            >
              {task?.state === "running" && (
                <RefreshCw className="spin" size={12} />
              )}
              {task?.state === "succeeded" && <Check size={12} />}
              {task?.state === "failed" && <CircleAlert size={12} />}
              {task === undefined
                ? "等待操作"
                : task.state === "running"
                  ? "进行中"
                  : task.state === "succeeded"
                    ? "已完成"
                    : "执行失败"}
            </span>
          </div>

          <div className="agent-task-progress">
            <div>
              <strong>{taskTitle(task)}</strong>
              <b>{task?.progress ?? 0}%</b>
            </div>
            <div className="agent-task-progress-track">
              <span style={{ width: `${task?.progress ?? 0}%` }} />
            </div>
            <p>{taskSubtitle(task)}</p>
          </div>

          <ol className="agent-task-steps">
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
            <section className="agent-task-success failed">
              <span>
                <CircleAlert size={22} />
              </span>
              <div>
                <strong>真实接入失败</strong>
                <p>{task.error?.message ?? "请查看任务步骤中的错误信息。"}</p>
                {task.rolledBack && <p>配置已经自动回滚。</p>}
              </div>
            </section>
          )}

          {task?.state === "succeeded" && (
            <section className="agent-task-success">
              <span>
                <Check size={22} />
              </span>
              <div>
                <strong>{successTitle(task)}</strong>
                <p>{successDescription(task)}</p>
              </div>
              {task.action !== "uninstall" && task.action !== "rollback" && (
                <button
                  className="primary"
                  onClick={() =>
                    onNotice(
                      "请新建 Codex 任务，然后要求它调用 list_models；当前任务不会热加载新 MCP。",
                    )
                  }
                >
                  查看使用说明
                </button>
              )}
            </section>
          )}

          <footer className="agent-task-footer">
            <span>
              {task?.completedAt
                ? `完成时间：${new Date(task.completedAt).toLocaleTimeString("zh-CN")}`
                : "尚无已完成任务"}
            </span>
            <button
              onClick={() =>
                onNotice(
                  task === undefined
                    ? "尚无真实接入任务。"
                    : `${task.action} · ${task.state} · ${task.progress}%${
                        task.error === undefined
                          ? ""
                          : ` · ${task.error.code}: ${task.error.message}`
                      }`,
                )
              }
            >
              查看诊断
            </button>
          </footer>
        </aside>
      </div>
    </>
  );
}

function agentStatusDescription(
  agent: AgentAccessResponse["agents"][number] | undefined,
): string {
  if (agent === undefined) return "正在读取真实 Codex 配置";
  if (!agent.detected) return "未检测到 Codex 用户配置目录";
  if (!agent.launcher.ready) return "MCP 启动器尚未构建";
  if (agent.integration.status === "needs_update") {
    return "检测到旧配置或命令路径漂移，需要更新";
  }
  if (agent.integration.status === "installed") {
    return agent.integration.verified
      ? `已验证 ${agent.integration.toolCount ?? 0} 个 MCP 工具`
      : "配置已写入，但尚未完成当前版本烟测";
  }
  return "Codex 已检测，尚未接入 Media Hub";
}

function taskTitle(task: AgentIntegrationTask | undefined): string {
  if (task === undefined) return "选择真实操作开始接入";
  const names: Record<AgentIntegrationAction, string> = {
    install: "正在安装 Codex 接入",
    update: "正在更新 Codex 接入",
    repair: "正在修复 Codex 接入",
    uninstall: "正在卸载 Codex 接入",
    rollback: "正在回滚 Codex 配置",
  };
  return task.state === "running"
    ? names[task.action]
    : task.state === "succeeded"
      ? `${names[task.action].replace("正在", "")}已完成`
      : `${names[task.action].replace("正在", "")}失败`;
}

function taskSubtitle(task: AgentIntegrationTask | undefined): string {
  if (task === undefined) {
    return "所有写操作均由桌面端授权，并在修改前创建备份";
  }
  const active = task.steps.find((step) => step.state === "running");
  if (active !== undefined) return `当前步骤：${active.title}`;
  if (task.state === "failed") {
    return task.rolledBack ? "执行失败，配置已自动回滚" : "执行失败";
  }
  if (task.state === "succeeded") return "真实配置读回结果已确认";
  return "正在等待后端任务状态";
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
  if (task.state === "succeeded") return successTitle(task);
  return task.rolledBack
    ? `${task.error?.message ?? "Codex 接入失败"} 配置已自动回滚。`
    : task.error?.message ?? "Codex 接入失败。";
}

function successTitle(task: AgentIntegrationTask): string {
  if (task.action === "uninstall") return "Codex 接入已卸载";
  if (task.action === "rollback") return "Codex 配置已回滚";
  return `真实接入成功 · ${task.result?.toolCount ?? 0} 个工具可用`;
}

function successDescription(task: AgentIntegrationTask): string {
  if (task.action === "uninstall") {
    return "Media Hub MCP 配置段已移除，其他 Codex 设置保持不变。";
  }
  if (task.action === "rollback") {
    return "config.toml 已恢复到最近一次操作前状态。";
  }
  return "配置已写入、读回一致，并通过 list_models MCP 烟测。";
}
