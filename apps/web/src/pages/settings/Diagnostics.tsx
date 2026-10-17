/**
 * 诊断日志（W17）：这个浏览器里保留最近 500 条记录，“导出”直接下载一个文件，“清空”先确认。
 * 导出的内容和 App 一样（开头几行说明，后面每行一条 JSON，可以直接拖进 vis），所以扩展名是 .jsonl。
 */

import { useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";

import { diagnostics, exportText, localIso } from "@bettertavern/core/observability/log";

import { Button } from "../../components/controls.tsx";
import { CLIENT_VERSION } from "../../config.ts";
import { platformLabel } from "../../observability/setup.ts";
import { useOverlay } from "../../overlay/OverlayProvider.tsx";
import { SectionHeader } from "./parts.tsx";
import styles from "./settings.module.css";

export function exportFileName(now: Date = new Date()): string {
  return `bettertavern-diagnostics-${localIso(now).slice(0, 10)}.jsonl`;
}

export function Diagnostics() {
  const { t } = useTranslation();
  const overlay = useOverlay();
  const count = useSyncExternalStore(
    (listener) => diagnostics.subscribe(listener),
    () => diagnostics.all().length,
  );

  const download = (): void => {
    const text = exportText(diagnostics.all(), {
      clientVersion: CLIENT_VERSION,
      platform: platformLabel(),
      server: window.location.origin,
    });
    const url = URL.createObjectURL(new Blob([text], { type: "application/x-ndjson" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = exportFileName();
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const clear = async (): Promise<void> => {
    const ok = await overlay.confirm({
      title: t("diagnostics.clearTitle"),
      message: t("diagnostics.clearMessageWeb"),
      confirmLabel: t("diagnostics.clear"),
      tone: "danger",
    });
    if (ok) diagnostics.clear();
  };

  return (
    <div>
      <SectionHeader title={t("diagnostics.title")} meta={t("diagnostics.count", { count })} />
      <div className={styles.formCard}>
        <p className={styles.lead}>{t("diagnostics.aboutWeb")}</p>
        <div className={styles.probeButtons}>
          <Button label={t("diagnostics.export")} icon="import" disabled={count === 0} onClick={download} />
          <Button
            label={t("diagnostics.clear")}
            icon="trash"
            variant="secondary"
            disabled={count === 0}
            onClick={() => void clear()}
          />
        </div>
      </div>
    </div>
  );
}
