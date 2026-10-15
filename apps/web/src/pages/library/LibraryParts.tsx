/**
 * 剧本库（W04）的部件：页头的视图切换和导入按钮、网格卡片、列表行、导入中的那一格、空状态。
 * 卡片和行都是指向剧本详情的链接；悬停出现“…”，右键打开同一个菜单。数值和文案同 App 的 LibraryParts.tsx。
 */

import { useRef, type ReactNode } from "react";
import { Link } from "react-router";

import type { Scenario } from "@bettertavern/core/api/types";
import { formatBytes } from "@bettertavern/core/utils/format";

import { Cover } from "../../components/Cover.tsx";
import { Button, cx, IconButton } from "../../components/controls.tsx";
import { Icon, type IconName } from "../../components/Icon.tsx";
import { scenarioPath } from "../../data/scenarioActions.ts";
import type { ImportProgress } from "../../import/ImportProvider.tsx";
import type { MenuPlace } from "../../overlay/Menu.tsx";
import { useContextMenu } from "../../overlay/useContextMenu.ts";
import type { LibraryView } from "../../state/prefs.ts";
import styles from "./library.module.css";

export function summary(s: Scenario): string {
  return s.description_preview || s.first_mes_preview || (s.creator ? `作者：${s.creator}` : "");
}

/** 封面的宽高比：96 × 76 */
export function coverHeight(width: number): number {
  return (width * 76) / 96;
}

export function HeaderControls({
  view,
  onView,
  importing,
  onImport,
  labelled,
}: {
  view: LibraryView;
  onView: (view: LibraryView) => void;
  importing: boolean;
  onImport: () => void;
  /** 宽屏：导入按钮是带文字的胶囊 */
  labelled: boolean;
}) {
  const option = (value: LibraryView, icon: IconName, label: string) => (
    <button
      type="button"
      role="radio"
      aria-checked={view === value}
      aria-label={label}
      className={cx(styles.segButton, view === value && styles.segOn)}
      onClick={() => onView(value)}
    >
      <Icon name={icon} size={18} />
    </button>
  );
  return (
    <>
      <div role="radiogroup" aria-label="视图" className={styles.seg}>
        {option("grid", "grid", "网格")}
        {option("list", "list", "列表")}
      </div>
      {labelled ? (
        <Button
          label="导入角色卡"
          icon="plus"
          busy={importing}
          onClick={onImport}
          className={styles.addPill}
        />
      ) : (
        <IconButton
          icon="plus"
          label={importing ? "正在导入" : "导入角色卡"}
          disabled={importing}
          className={styles.add}
          onClick={onImport}
        />
      )}
    </>
  );
}

/** 卡片外壳：链接本身，加上悬停才出现的“…” */
function Frame({
  scenario,
  className,
  moreClass,
  onMenu,
  children,
}: {
  scenario: Scenario;
  className: string | undefined;
  moreClass: string | undefined;
  onMenu: (scenario: Scenario, place: MenuPlace) => void;
  children: ReactNode;
}) {
  const more = useRef<HTMLButtonElement>(null);
  const context = useContextMenu((place) => onMenu(scenario, place));
  return (
    <div className={styles.cell}>
      <Link to={scenarioPath(scenario)} className={className} {...context}>
        {children}
      </Link>
      <IconButton
        ref={more}
        icon="more"
        label={`“${scenario.name}”的更多操作`}
        tone="card"
        diameter={36}
        iconSize={20}
        className={moreClass}
        onClick={() => more.current && onMenu(scenario, { anchor: more.current })}
      />
    </div>
  );
}

export function Tile({
  scenario,
  width,
  onMenu,
}: {
  scenario: Scenario;
  width: number;
  onMenu: (scenario: Scenario, place: MenuPlace) => void;
}) {
  const coverWidth = Math.max(0, width - 16);
  return (
    <Frame scenario={scenario} className={styles.tile} moreClass={styles.tileMore} onMenu={onMenu}>
      <Cover
        seed={scenario.id}
        blobId={scenario.avatar_blob_id}
        width={coverWidth}
        height={coverHeight(coverWidth)}
        surface="onFill"
        rounded={18}
      />
      <span className={styles.tileMeta}>
        <span className={styles.name}>{scenario.name}</span>
        <span className={styles.summary}>{summary(scenario)}</span>
      </span>
    </Frame>
  );
}

export function Row({
  scenario,
  onMenu,
}: {
  scenario: Scenario;
  onMenu: (scenario: Scenario, place: MenuPlace) => void;
}) {
  return (
    <Frame scenario={scenario} className={styles.row} moreClass={styles.rowMore} onMenu={onMenu}>
      <Cover seed={scenario.id} blobId={scenario.avatar_blob_id} width={56} height={56} surface="onFill" />
      <span className={styles.rowBody}>
        <span className={styles.rowTitle}>{scenario.name}</span>
        <span className={styles.rowSummary}>{summary(scenario)}</span>
      </span>
    </Frame>
  );
}

/** 一直在转的圆弧：表示在传，不代表进度 */
function Spinner({ size = 56 }: { size?: number }) {
  return (
    <svg className={styles.spinner} width={size} height={size} viewBox="0 0 56 56" aria-hidden="true">
      <circle cx={28} cy={28} r={22} fill="none" stroke="var(--bg3)" strokeWidth={5} />
      <path
        d="M28 6a22 22 0 0119.8 31.6"
        fill="none"
        stroke="var(--acc)"
        strokeWidth={5}
        strokeLinecap="round"
      />
    </svg>
  );
}

function progressText(file: ImportProgress): string {
  const count = file.total > 1 ? ` · ${file.index} / ${file.total}` : "";
  return `${file.name} · ${formatBytes(file.size)}${count}`;
}

/** 网格里“正在导入”的那一格：当前这一张，多张时带“2 / 3” */
export function ImportingTile({ file, width }: { file: ImportProgress; width: number }) {
  const coverWidth = Math.max(0, width - 16);
  return (
    <div role="progressbar" aria-label={`正在导入 ${file.name}`} className={styles.tile}>
      <span className={styles.importCover} style={{ height: coverHeight(coverWidth) }}>
        <Spinner />
      </span>
      <span className={styles.tileMeta}>
        <span className={cx(styles.name, styles.muted)}>正在导入</span>
        <span className={cx(styles.summary, styles.mono)}>{progressText(file)}</span>
      </span>
    </div>
  );
}

/** 列表视图里“正在导入”的那一行 */
export function ImportingRow({ file }: { file: ImportProgress }) {
  return (
    <div role="progressbar" aria-label={`正在导入 ${file.name}`} className={cx(styles.row, styles.importRow)}>
      <Spinner size={32} />
      <span className={styles.muted}>
        正在导入 {file.name}
        {file.total > 1 ? ` · ${file.index} / ${file.total}` : ""}
      </span>
    </div>
  );
}

function Doc({ children }: { children: ReactNode }) {
  return (
    <svg width={44} height={52} viewBox="0 0 44 52" aria-hidden="true">
      <path
        d="M8 2h20l14 14v28a6 6 0 01-6 6H8a6 6 0 01-6-6V8a6 6 0 016-6z"
        fill="var(--card)"
        stroke="var(--ink)"
        strokeWidth={1.8}
        strokeLinejoin="round"
      />
      <path d="M28 2v10a4 4 0 004 4h10" fill="none" stroke="var(--ink)" strokeWidth={1.8} />
      {children}
    </svg>
  );
}

export function Empty({ onImport, importing }: { onImport: () => void; importing: boolean }) {
  return (
    <div className={styles.emptyWrap}>
      <div className={styles.kinds}>
        <div className={styles.kind}>
          <Doc>
            <rect x={10} y={24} width={20} height={16} rx={4} fill="var(--bg2)" />
            <circle cx={24} cy={29} r={3} fill="var(--acc)" />
          </Doc>
          <div>
            <div className={styles.kindName}>PNG</div>
            <div className={styles.kindText}>卡面图片里带数据</div>
          </div>
        </div>
        <div className={styles.kind}>
          <Doc>
            <path
              d="M14 26l-5 6 5 6M30 26l5 6-5 6M20 40l4-16"
              fill="none"
              stroke="var(--ink)"
              strokeWidth={1.8}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Doc>
          <div>
            <div className={styles.kindName}>JSON</div>
            <div className={styles.kindText}>纯文本角色卡</div>
          </div>
        </div>
      </div>
      <div className={styles.emptyBody}>
        <h2 className={styles.emptyTitle}>导入第一张角色卡</h2>
        <div className={styles.specs} aria-label="支持 SillyTavern V1、V2、V3">
          {["SillyTavern", "V1", "V2", "V3"].map((label, i) => (
            <span key={label} className={cx(styles.spec, i === 0 && styles.specFirst)}>
              {label}
            </span>
          ))}
        </div>
        <div className={styles.note}>
          <span className={styles.noteIcon}>
            <Icon name="world" size={18} />
          </span>
          <span>卡里附带的世界书，会转成故事的世界状态。</span>
        </div>
        <Button label="导入角色卡" trailingIcon="import" between busy={importing} onClick={onImport} />
        <div className={styles.limits}>.PNG / .JSON · ≤ 16 MB · 也可以直接把文件拖进窗口</div>
      </div>
    </div>
  );
}
