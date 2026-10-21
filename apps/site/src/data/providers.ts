/**
 * 服务商：和 App 里“添加模型”能选的一样，顺序和 id 也一样（服务端 providers/profiles/__init__.py 的 BUILTIN_PROFILES），
 * 标志按 id 从 @bettertavern/design 的 providerLogos.ts 取。Key 的格式提示和获取地址照设计稿。
 * 自定义兼容端点的名字和提示要翻译，在文案里（copy.models.customName、customPlaceholder）。
 */

export type Provider = {
  id: string;
  /** 品牌名；自定义兼容端点没有，用文案里的 */
  name?: string;
  /** Key 输入框里的格式提示；自定义兼容端点用文案里的 */
  placeholder?: string;
  /** “去 … 获取 Key”的地址；自定义兼容端点没有 */
  keyUrl: string | null;
};

export const PROVIDERS: readonly Provider[] = [
  { id: "deepseek", name: "DeepSeek", placeholder: "sk-…", keyUrl: "https://platform.deepseek.com/api_keys" },
  { id: "openai", name: "OpenAI", placeholder: "sk-…", keyUrl: "https://platform.openai.com/api-keys" },
  { id: "xai", name: "Grok", placeholder: "xai-…", keyUrl: "https://console.x.ai" },
  { id: "gemini", name: "Gemini", placeholder: "AIza…", keyUrl: "https://aistudio.google.com/apikey" },
  { id: "huggingface", name: "Hugging Face", placeholder: "hf_…", keyUrl: "https://huggingface.co/settings/tokens" },
  { id: "custom_openai", keyUrl: null },
];
