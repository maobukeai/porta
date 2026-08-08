export interface PromptPreset {
  cmd: string;
  label: string;
  desc: string;
  prompt: string;
}

export const DEFAULT_PROMPT_PRESETS: PromptPreset[] = [
  {
    cmd: "/explain",
    label: "代码深度解释",
    desc: "逐行解释分析选中或贴出的代码逻辑与数据流",
    prompt: "请帮我深度解释分析以下代码的架构原理、数据流向以及核心关键逻辑：\n\n",
  },
  {
    cmd: "/refactor",
    label: "代码优雅重构",
    desc: "优化可读性、提取模块并提升运行效率",
    prompt: "请帮我重构以下代码，提高可读性与运行效率，遵循 DRY 原则，并补充必要的 TypeScript 类型定义：\n\n",
  },
  {
    cmd: "/test",
    label: "编写单元测试",
    desc: "为功能自动补全 Vitest / Jest 单元测试用例",
    prompt: "请为以下功能编写完整的单元测试（覆盖边界情况与异常流程）：\n\n",
  },
  {
    cmd: "/doc",
    label: "生成 JSDoc / Markdown 文档",
    desc: "为组件与 API 自动书写结构化技术规范文档",
    prompt: "请为以下代码/组件编写结构清晰的 Markdown 规范文档与 JSDoc 注释：\n\n",
  },
];
