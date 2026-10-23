/** 剧本、角色两页什么都没有时：一大格白底墨点，标题、说明和一个按钮 */

import { Panel } from "../../components/comic.tsx";
import { ComicGrid } from "../../components/ComicGrid.tsx";
import { Button } from "../../components/controls.tsx";
import type { IconName } from "../../components/Icon.tsx";
import styles from "./library.module.css";

export function LibraryEmpty({
  title,
  note,
  actionLabel,
  actionIcon,
  onAction,
}: {
  title: string;
  note: string;
  actionLabel: string;
  actionIcon: IconName;
  onAction: () => void;
}) {
  return (
    <ComicGrid paged={false}>
      <Panel tone="dots" hot className={styles.empty} style={{ gridColumn: "1 / span 6", gridRow: "1 / span 3" }}>
        <h2 className={styles.emptyTitle}>{title}</h2>
        <p className={styles.emptyText}>{note}</p>
        <Button label={actionLabel} icon={actionIcon} onClick={onAction} />
      </Panel>
    </ComicGrid>
  );
}
