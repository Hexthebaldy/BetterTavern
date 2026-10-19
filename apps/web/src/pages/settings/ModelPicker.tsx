/**
 * 添加模型时的选模型（同 App 的 ModelPicker）：服务商返回的模型单选列表（最多显示 40 个），搜索框兼做手动输入，
 * 右边重新获取。每个模型右边是它的上下文长度。
 * 获取失败的说明由表单拼好传进来（listError）；Key 或端点有错（fieldError）时错误显示在那两个输入框上，这里不再提示手填模型名。
 */

import { useMemo } from "react";
import { useTranslation } from "react-i18next";

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
  fieldError,
  query,
  onQuery,
  chosen,
  onPick,
  onRefresh,
}: {
  models: ModelInfo[] | null;
  listing: boolean;
  /** 选模型卡里显示的获取失败说明（已经拼好，可能带“可以直接输入模型名”） */
  listError: string | null;
  /** Key 或端点有错：错误显示在输入框上，这里不提示手填模型名 */
  fieldError: boolean;
  query: string;
  onQuery: (text: string) => void;
  chosen: string;
  onPick: (id: string) => void;
  onRefresh: () => void;
}) {
  const { t } = useTranslation();
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
      <SectionHeader
        title={t("models.pick")}
        meta={models ? t("models.available", { count: models.length }) : undefined}
      />
      <div className={styles.pickerCard}>
        <div className={styles.search}>
          <Icon name="search" size={18} className={styles.searchIcon} />
          <input
            className={styles.searchInput}
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder={t("models.search")}
            aria-label={t("models.search")}
            autoCapitalize="none"
            spellCheck={false}
          />
          <button
            type="button"
            className={styles.refresh}
            aria-label={t("models.refetchList")}
            disabled={listing}
            onClick={onRefresh}
          >
            {listing ? <Dots /> : <Icon name="retry" size={18} />}
          </button>
        </div>
        {listError ? <Notice message={listError} /> : null}
        <div role="radiogroup" aria-label={t("models.listLabel")} className={styles.options}>
          {manual ? (
            <ModelOption
              label={t("models.useTyped", { name: typed })}
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
            ? t("models.shown", { shown: shown.length, total: models.length, max: MAX_LISTED })
            : listing
              ? t("models.fetching")
              : listError || fieldError
                ? ""
                : t("models.fetchHint")}
        </p>
      </div>
    </div>
  );
}
