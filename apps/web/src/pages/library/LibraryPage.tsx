/**
 * 剧本库（W04）：网格或列表显示已导入的剧本，右上角是网格 / 列表切换和“导入角色卡”。
 * 网格按内容宽度 ÷ 240 取整（2–5 列，平板中屏 3 列、手机 2 列），间距 16；列表限宽 640、居中。
 * 导入（按钮和拖放）在 import/ImportProvider.tsx；导入失败的红色提示显示在页面顶上。
 */

import { useRef } from "react";
import { useTranslation } from "react-i18next";

import { describeError } from "@bettertavern/core/api/client";
import { cellWidth, libraryColumns, sizeClass } from "@bettertavern/design/layout";

import { Button, Notice } from "../../components/controls.tsx";
import { PageHeader } from "../../components/PageHeader.tsx";
import { useScenarios } from "../../data/scenarios.ts";
import { useScenarioActions } from "../../data/scenarioActions.ts";
import { useDocumentTitle } from "../../hooks/useDocumentTitle.ts";
import { useElementWidth } from "../../hooks/useElementWidth.ts";
import { useWindowWidth } from "../../hooks/useWindowSize.ts";
import { useImporter } from "../../import/ImportProvider.tsx";
import { usePrefs } from "../../state/PrefsProvider.tsx";
import { desktop } from "../../theme/layout.ts";
import pages from "../pages.module.css";
import { Empty, HeaderControls, ImportingRow, ImportingTile, Row, Tile } from "./LibraryParts.tsx";
import styles from "./library.module.css";

const GAP = 16;

export function LibraryPage() {
  const { t } = useTranslation();
  useDocumentTitle(t("nav.library"));
  const scenarios = useScenarios();
  const actions = useScenarioActions();
  const importer = useImporter();
  const { libraryView, setLibraryView } = usePrefs();
  const windowWidth = useWindowWidth();
  const box = useRef<HTMLDivElement>(null);
  const contentWidth = useElementWidth(box);
  const size = sizeClass(windowWidth);
  const columns = libraryColumns(size, contentWidth);
  const tileWidth = contentWidth > 0 ? cellWidth(contentWidth, columns, GAP) : 0;
  const list = scenarios.data;
  const importing = importer.progress;
  const empty = list !== undefined && list.length === 0 && !importing;
  const grid = libraryView === "grid";

  return (
    <div className={pages.page}>
      <PageHeader title={t("nav.library")} count={list && !empty ? list.length : null}>
        {list && !empty ? (
          <HeaderControls
            view={libraryView}
            onView={setLibraryView}
            importing={importing !== null}
            onImport={importer.pick}
            labelled={windowWidth >= desktop.rail}
          />
        ) : null}
      </PageHeader>
      {importer.problem ? (
        <Notice
          message={
            <>
              <strong className={styles.problemTitle}>{importer.problem.title}</strong>
              {importer.problem.message}
            </>
          }
          onClose={importer.dismissProblem}
          className={styles.banner}
        />
      ) : null}
      {scenarios.error ? (
        <Notice
          icon="offline"
          message={
            list
              ? describeError(scenarios.error)
              : t("library.loadFailedWith", { error: describeError(scenarios.error) })
          }
          actionLabel={list ? t("common.retry") : t("common.reload")}
          onAction={() => void scenarios.refetch()}
          className={styles.banner}
        />
      ) : null}
      <div ref={box}>
        {!list ? (
          scenarios.isPending ? (
            <div className={styles.loading}>
              <Button label={t("common.loading")} variant="text" busy />
            </div>
          ) : null
        ) : empty ? (
          <Empty onImport={importer.pick} importing={false} />
        ) : grid ? (
          <div className={styles.grid} style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
            {importing ? <ImportingTile file={importing} width={tileWidth} /> : null}
            {list.map((scenario) => (
              <Tile key={scenario.id} scenario={scenario} width={tileWidth} onMenu={actions.menu} />
            ))}
          </div>
        ) : (
          <div className={styles.list}>
            {importing ? <ImportingRow file={importing} /> : null}
            {list.map((scenario) => (
              <Row key={scenario.id} scenario={scenario} onMenu={actions.menu} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
