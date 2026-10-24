/**
 * 登录、注册页底部的服务器行：写着现在用的是哪台服务器，点“更改”打开对话框。
 * 对话框里列出官方服务和最近打开过的地址，也可以输入新地址；“打开”就跳到那台服务器自己的登录页
 * （网页和接口同源，不能只换接口地址，见 servers.ts）。地址只能自己填，不从链接参数里带进来，免得被人做成钓鱼链接。
 */

import { useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";

import { Field, cx } from "../../components/controls.tsx";
import { Icon } from "../../components/Icon.tsx";
import { Dialog } from "../../overlay/Dialog.tsx";
import { DialogCard } from "../../overlay/OverlayProvider.tsx";
import { localStore } from "../../storage/local.ts";
import styles from "./auth.module.css";
import {
  displaySite,
  OFFICIAL_SITE,
  parseRecentSites,
  rememberSite,
  SERVERS_KEY,
  siteChoices,
  siteOrigin,
} from "./servers.ts";

export function ServerSwitch() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const current = window.location.origin;
  const shown = displaySite(current);
  return (
    <div className={styles.server}>
      <Icon name="server" size={18} />
      <span className={styles.serverText}>
        {t("server.label")} <span className={styles.serverName}>{shown}</span>
      </span>
      <button
        type="button"
        className={styles.serverChange}
        aria-label={t("server.rowLabel", { server: shown })}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        {t("server.change")}
      </button>
      {open ? <ServerDialog current={current} onClose={() => setOpen(false)} /> : null}
    </div>
  );
}

function ServerDialog({ current, onClose }: { current: string; onClose: () => void }) {
  const { t } = useTranslation();
  const [recent] = useState(() => parseRecentSites(localStore.read(SERVERS_KEY)));
  const choices = siteChoices(recent, current);
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const first = useRef<HTMLInputElement>(null);

  const typing = draft.trim() !== "";

  const go = (): void => {
    const target = typing ? siteOrigin(draft) : selected;
    if (!target) {
      if (typing) setError(t("server.siteInvalid"));
      return;
    }
    if (target === current) {
      setError(t("server.siteSame"));
      return;
    }
    // 存不进去（隐私模式）也照样跳过去，只是下次不在列表里
    localStore.write(SERVERS_KEY, rememberSite(recent, target, new Date()));
    window.location.assign(`${target}/login`);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "Enter" && !event.nativeEvent.isComposing) {
      event.preventDefault();
      go();
    }
  };

  return (
    <Dialog label={t("server.siteTitle")} onClose={onClose} initialFocus={choices.length > 0 ? first : input}>
      <DialogCard
        icon="server"
        title={t("server.siteTitle")}
        message={t("server.siteNote")}
        confirmLabel={t("server.open")}
        confirmDisabled={!typing && !selected}
        onCancel={onClose}
        onConfirm={go}
      >
        <div className={styles.siteForm}>
          {choices.length > 0 ? (
            <div role="radiogroup" aria-label={t("server.choose")} className={styles.siteChoices}>
              {choices.map((url, index) => (
                <label key={url} className={cx(styles.siteChoice, !typing && selected === url && styles.siteOn)}>
                  <input
                    ref={index === 0 ? first : undefined}
                    type="radio"
                    name="site"
                    className={styles.siteRadio}
                    checked={!typing && selected === url}
                    onChange={() => {
                      setSelected(url);
                      setDraft("");
                      setError(null);
                    }}
                    onKeyDown={onKeyDown}
                  />
                  <span className={styles.siteMark} aria-hidden="true" />
                  <span className={styles.siteText}>
                    <span className={styles.siteUrl}>{displaySite(url)}</span>
                    {url === OFFICIAL_SITE ? <span className={styles.siteTag}>{t("server.official")}</span> : null}
                  </span>
                </label>
              ))}
            </div>
          ) : null}
          <Field
            ref={input}
            label={choices.length > 0 ? t("server.newLabel") : t("server.siteLabel")}
            type="url"
            inputMode="url"
            autoCapitalize="none"
            autoComplete="off"
            spellCheck={false}
            placeholder={t("server.sitePlaceholder")}
            value={draft}
            error={error}
            onChange={(event) => {
              setDraft(event.target.value);
              setError(null);
            }}
            onKeyDown={onKeyDown}
          />
        </div>
      </DialogCard>
    </Dialog>
  );
}
