/**
 * 添加模型时的选模型（同 App 的 ModelPicker）：服务商返回的模型单选列表（最多显示 40 个），搜索框兼做手动输入，
 * 右边重新获取。每个模型右边是它的上下文长度。
 */

import { useMemo } from "react";

import type { ModelInfo } from "@bettertavern/core/api/types";
import { formatTokens } from "@bettertavern/core/utils/format";

import { cx, Dots, Notice } from "../../components/controls.tsx";
import { Icon } from "../../components/Icon.tsx";
import { SectionHeader } from "./parts.tsx";
import styles from "./settings.module.css";

const MAX_LISTED = 40;

function ModelOption({
  label,
  window,
  selected,
  onPick,
}: {
  label: string;
  window: number | null;
  selected: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      className={cx(styles.modelOption, selected && styles.modelOptionOn)}
      onClick={onPick}
    >
      <span className={cx(styles.radio, selected && styles.radioOn)} />
      <span className={cx(styles.optionName, selected && styles.optionNameOn)}>{label}</span>
      {window ? (
        <span className={cx(styles.ctx, selected && styles.ctxOn)}>{formatTokens(window)}</span>
      ) : null}
    </button>
  );
}

export function ModelPicker({
  models,
  listing,
  listError,
  query,
  onQuery,
  chosen,
  onPick,
  onRefresh,
}: {
  models: ModelInfo[] | null;
  listing: boolean;
  listError: string | null;
  query: string;
  onQuery: (text: string) => void;
  chosen: string;
  onPick: (id: string) => void;
  onRefresh: () => void;
}) {
  const filtered = useMemo(() => {
    if (!models) return [];
    const q = query.trim().toLowerCase();
    return q ? models.filter((m) => m.id.toLowerCase().includes(q)) : models;
  }, [models, query]);
  const shown = filtered.slice(0, MAX_LISTED);
  const typed = query.trim();
  const manual = typed !== "" && !models?.some((m) => m.id === typed);
  return (
    <div>
      <SectionHeader title="选择模型" meta={models ? `${models.length} 个可用` : undefined} />
      <div className={styles.pickerCard}>
        <div className={styles.search}>
          <Icon name="search" size={18} className={styles.searchIcon} />
          <input
            className={styles.searchInput}
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder="搜索或输入模型名"
            aria-label="搜索或输入模型名"
            autoCapitalize="none"
            spellCheck={false}
          />
          <button
            type="button"
            className={styles.refresh}
            aria-label="重新获取模型列表"
            disabled={listing}
            onClick={onRefresh}
          >
            {listing ? <Dots /> : <Icon name="retry" size={18} />}
          </button>
        </div>
        {listError ? <Notice message={`${listError}。可以直接在上面输入模型名。`} /> : null}
        <div role="radiogroup" aria-label="模型" className={styles.options}>
          {manual ? (
            <ModelOption
              label={`使用“${typed}”`}
              window={null}
              selected={chosen === typed}
              onPick={() => onPick(typed)}
            />
          ) : null}
          {shown.map((m) => (
            <ModelOption
              key={m.id}
              label={m.id}
              window={m.context_window}
              selected={chosen === m.id}
              onPick={() => onPick(m.id)}
            />
          ))}
        </div>
        <p className={styles.footnote}>
          {models
            ? `显示 ${shown.length} / ${models.length}，最多 ${MAX_LISTED} 个`
            : listing
              ? "正在获取模型列表…"
              : listError
                ? ""
                : "填好 Key 后会自动获取模型列表，也可以直接在上面输入模型名。"}
        </p>
      </div>
    </div>
  );
}
