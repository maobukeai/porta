import { useEffect, useState, useRef } from "react";

export type ConnectionState =
  | "connecting"
  | "authenticating"
  | "waiting"
  | "paired";

interface Props {
  initialState?: ConnectionState;
  onComplete?: () => void;
}

const STEP_LABELS = [
  "连接中转服务",
  "设备鉴权",
  "等待桌面端配对",
  "同步工作区",
];

function getStateInfo(state: ConnectionState) {
  switch (state) {
    case "connecting":
      return {
        title: "正在连接中转服务…",
        description: "正在建立手机与远控中转服务的连接。",
        activeStepIndex: 0,
      };
    case "authenticating":
      return {
        title: "正在认证设备…",
        description: "已连接中转服务，正在完成远控身份校验。",
        activeStepIndex: 1,
      };
    case "waiting":
      return {
        title: "等待桌面端确认配对…",
        description: "手机端已就绪，等待桌面端会话匹配当前连接。",
        activeStepIndex: 2,
      };
    case "paired":
      return {
        title: "已配对，正在加载工作区…",
        description: "连接已建立，正在同步桌面端工作区和任务。",
        activeStepIndex: 3,
      };
  }
}

export function ConnectionLoadingScreen({
  initialState = "connecting",
  onComplete,
}: Props) {
  const [state, setState] = useState<ConnectionState>(initialState);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  // Dynamic live progress animation across steps (runs stably without timer reset)
  useEffect(() => {
    const t1 = setTimeout(() => setState("authenticating"), 200);
    const t2 = setTimeout(() => setState("waiting"), 420);
    const t3 = setTimeout(() => setState("paired"), 650);
    const t4 = setTimeout(() => {
      onCompleteRef.current?.();
    }, 950);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      clearTimeout(t4);
    };
  }, []);

  const { title, description, activeStepIndex } = getStateInfo(state);

  return (
    <div className="zcode-loading-screen">
      <div className="zcode-loading-wrapper">
        <section className="zcode-loading-card">
          <div className="zcode-loading-header">
            <div className="zcode-loading-title-row">
              <span className="zcode-status-dot-amber" />
              <h1 className="zcode-loading-title">{title}</h1>
            </div>
            <p className="zcode-loading-subtitle">{description}</p>
          </div>

          <div className="zcode-loading-steps">
            {STEP_LABELS.map((stepText, index) => {
              const isDone = index < activeStepIndex;
              const isCurrent = index === activeStepIndex;

              return (
                <div
                  key={stepText}
                  className={`zcode-loading-step-item ${isDone ? "is-done" : ""} ${isCurrent ? "is-active" : ""}`}
                >
                  <span className="zcode-step-label">
                    {index + 1}. {stepText}
                  </span>
                  {isDone && <span className="zcode-step-done-icon">✓</span>}
                  {isCurrent && <span className="zcode-step-pulse-dot" />}
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
