/**
 * 人设（/settings/personas，设置的子页面；docs/personas.md）：左边一列人设，右边编辑选中的那个（或新建）。
 * 一个人设是名字、描述（导演每回合都看）、头像（服务端裁成正方形）；可以设一个默认人设。
 * 顶上能导入 SillyTavern 的人设备份（只有名字和描述）。窄于 900 时一栏：编辑格排在列表上面。
 * 地址里的 ?id= 是选中的人设，?id=new 是新建；设置页那一格点人设也是跳到这里。
 */

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router";

import { ApiError, describeError } from "@bettertavern/core/api/client";
import type { Persona } from "@bettertavern/core/api/types";
import { initialOfName, PERSONA_DESCRIPTION_MAX, PERSONA_NAME_MAX } from "@bettertavern/core/scenario/persona";

import { Panel, Portrait } from "../../components/comic.tsx";
import { Button, cx, Field, Notice, Pill, TextArea, Toggle } from "../../components/controls.tsx";
import { Icon } from "../../components/Icon.tsx";
import { PageHeader } from "../../components/PageHeader.tsx";
import { personasKey, usePersonas } from "../../data/personas.ts";
import { scenariosKey } from "../../data/scenarios.ts";
import { useDocumentTitle } from "../../hooks/useDocumentTitle.ts";
import { useOverlay } from "../../overlay/OverlayProvider.tsx";
import { useApp } from "../../state/AppProvider.tsx";
import pages from "../pages.module.css";
import styles from "./personas.module.css";

const IMAGE_TYPES = "image/png,image/jpeg,image/webp";

export function PersonasPage() {
  const { t } = useTranslation();
  useDocumentTitle(t("personas.title"));
  const personas = usePersonas();
  const [params, setParams] = useSearchParams();
  const selected = params.get("id");
  const list = personas.data ?? [];
  const current = list.find((p) => p.id === selected);
  const editing = selected === "new" || current !== undefined;
  const select = (id: string | null): void => setParams(id ? { id } : {}, { replace: true });

  return (
    <div className={cx(pages.page, styles.page)}>
      <PageHeader title={t("personas.title")} sub={t("personas.sub")} />
      <Link to="/settings" className={styles.back}>
        <Icon name="arrowLeft" size={16} strokeWidth={2.2} />
        {t("nav.settings")}
      </Link>
      <div className={styles.actions}>
        <Button label={t("personas.add")} icon="plus" size="sm" onClick={() => select("new")} />
        <ImportButton onImported={() => select(null)} />
      </div>
      {personas.error ? (
        <Notice
          icon="offline"
          message={describeError(personas.error)}
          actionLabel={t("common.retry")}
          onAction={() => void personas.refetch()}
          className={styles.notice}
        />
      ) : null}
      <div className={cx(styles.layout, editing && styles.withEditor)}>
        <div className={styles.list}>
          {list.length === 0 && !personas.isPending ? (
            <div className={styles.none}>
              <b>{t("personas.none")}</b>
              <span>{t("personas.noneHint")}</span>
            </div>
          ) : null}
          {list.map((persona) => (
            <PersonaRow
              key={persona.id}
              persona={persona}
              selected={persona.id === selected}
              onClick={() => select(persona.id)}
            />
          ))}
        </div>
        {editing ? (
          <PersonaEditor
            key={current?.id ?? "new"}
            persona={current ?? null}
            onSaved={(saved) => select(saved.id)}
            onClose={() => select(null)}
          />
        ) : null}
      </div>
    </div>
  );
}

function PersonaRow({ persona, selected, onClick }: { persona: Persona; selected: boolean; onClick: () => void }) {
  const { t } = useTranslation();
  return (
    <button type="button" className={cx(styles.row, selected && styles.rowSelected)} onClick={onClick} aria-pressed={selected}>
      <Portrait
        name={persona.name}
        seed={persona.id}
        glyph={initialOfName(persona.name)}
        blobId={persona.avatar_blob_id}
        size={52}
        radius={26}
      />
      <span className={styles.rowText}>
        <span className={styles.rowName}>
          {persona.name}
          {persona.is_default ? <Pill tone="acc" label={t("personas.defaultBadge")} /> : null}
        </span>
        <span className={cx(styles.rowDescription, !persona.description && styles.muted)}>
          {persona.description || t("personas.noDescription")}
        </span>
        {persona.scenario_count > 0 ? (
          <span className={styles.rowMeta}>{t("personas.usedBy", { count: persona.scenario_count })}</span>
        ) : null}
      </span>
    </button>
  );
}

function ImportButton({ onImported }: { onImported: () => void }) {
  const { t } = useTranslation();
  const { api } = useApp();
  const overlay = useOverlay();
  const queries = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const pick = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    setBusy(true);
    try {
      const result = await api.personas.importBackup(file);
      queries.setQueryData(personasKey, result.personas);
      overlay.toast(t("personas.imported", { created: result.created, skipped: result.skipped }), { icon: "check" });
      onImported();
    } catch (e) {
      overlay.toast(describeError(e), { icon: "alert" });
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };
  return (
    <>
      <Button
        label={t("personas.importBackup")}
        icon="import"
        size="sm"
        variant="secondary"
        disabled={busy}
        onClick={() => input.current?.click()}
      />
      <span className={styles.importHint}>{t("personas.importHint")}</span>
      <input
        ref={input}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(e) => void pick(e.target.files?.[0])}
      />
    </>
  );
}

function PersonaEditor({
  persona,
  onSaved,
  onClose,
}: {
  persona: Persona | null;
  onSaved: (persona: Persona) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { api } = useApp();
  const overlay = useOverlay();
  const queries = useQueryClient();
  const [name, setName] = useState(persona?.name ?? "");
  const [description, setDescription] = useState(persona?.description ?? "");
  const [isDefault, setIsDefault] = useState(persona?.is_default ?? false);
  // 新建时先选好的头像，保存以后再传
  const [pendingAvatar, setPendingAvatar] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const avatarInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!pendingAvatar) return;
    const url = URL.createObjectURL(pendingAvatar);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [pendingAvatar]);

  const refresh = (): void => {
    void queries.invalidateQueries({ queryKey: personasKey });
    // 剧本设置里存着人设的副本：改了名字、描述或删掉以后剧本也要重读
    void queries.invalidateQueries({ queryKey: scenariosKey });
  };
  const fieldError = (field: string): string | undefined =>
    error instanceof ApiError && error.field("field") === field ? describeError(error) : undefined;
  const changed =
    persona === null ||
    name.trim() !== persona.name ||
    description.trim() !== persona.description ||
    isDefault !== persona.is_default;

  const save = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      let saved: Persona;
      if (persona === null) {
        saved = await api.personas.create({ name, description, is_default: isDefault });
        if (pendingAvatar) saved = await api.personas.setAvatar(saved.id, pendingAvatar);
      } else {
        saved = await api.personas.update(persona.id, { name, description, is_default: isDefault });
      }
      // 先放进列表再跳过去，不等重新取（否则编辑格会闪一下）
      queries.setQueryData<Persona[]>(personasKey, (old = []) => [
        ...old.filter((p) => p.id !== saved.id),
        saved,
      ]);
      refresh();
      overlay.toast(t("personas.saved"), { icon: "check" });
      onSaved(saved);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const changeAvatar = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    if (persona === null) {
      setPendingAvatar(file);
      return;
    }
    setBusy(true);
    try {
      await api.personas.setAvatar(persona.id, file);
      refresh();
    } catch (e) {
      overlay.toast(describeError(e), { icon: "alert" });
    } finally {
      setBusy(false);
      if (avatarInput.current) avatarInput.current.value = "";
    }
  };

  const removeAvatar = async (): Promise<void> => {
    if (persona === null) {
      setPendingAvatar(null);
      setPreview(null);
      return;
    }
    setBusy(true);
    try {
      await api.personas.removeAvatar(persona.id);
      refresh();
    } catch (e) {
      overlay.toast(describeError(e), { icon: "alert" });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (): Promise<void> => {
    if (persona === null) return;
    const ok = await overlay.confirm({
      title: t("personas.deleteTitle", { name: persona.name }),
      message:
        persona.scenario_count > 0
          ? t("personas.deleteBodyUsed", { count: persona.scenario_count })
          : t("personas.deleteBody"),
      confirmLabel: t("personas.delete"),
      tone: "danger",
      icon: "trash",
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api.personas.remove(persona.id);
      refresh();
      onClose();
    } catch (e) {
      overlay.toast(describeError(e), { icon: "alert" });
      setBusy(false);
    }
  };

  const hasAvatar = persona ? persona.avatar_blob_id !== null : pendingAvatar !== null;
  return (
    <Panel as="section" className={styles.editor} aria-label={persona ? t("personas.editTitle") : t("personas.newTitle")}>
      <div className={styles.editorHead}>
        <h2 className={styles.editorTitle}>{persona ? t("personas.editTitle") : t("personas.newTitle")}</h2>
        <button type="button" className={styles.close} onClick={onClose} aria-label={t("common.close")}>
          <Icon name="close" size={20} />
        </button>
      </div>
      <div className={styles.avatarRow}>
        {preview ? (
          <img src={preview} alt="" className={styles.preview} />
        ) : (
          <Portrait
            name={name || "?"}
            seed={persona?.id ?? "new"}
            glyph={initialOfName(name)}
            blobId={persona?.avatar_blob_id}
            size={88}
            radius={44}
          />
        )}
        <div className={styles.avatarButtons}>
          <span className={styles.avatarLabel}>{t("personas.avatar")}</span>
          <span className={styles.avatarActions}>
            <Button
              label={t("personas.changeAvatar")}
              icon="image"
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => avatarInput.current?.click()}
            />
            {hasAvatar ? (
              <Button label={t("personas.removeAvatar")} size="sm" variant="text" disabled={busy} onClick={() => void removeAvatar()} />
            ) : null}
          </span>
          <span className={styles.hint}>{t("personas.avatarHint")}</span>
        </div>
        <input
          ref={avatarInput}
          type="file"
          accept={IMAGE_TYPES}
          hidden
          onChange={(e) => void changeAvatar(e.target.files?.[0])}
        />
      </div>
      <Field
        label={t("personas.name")}
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={PERSONA_NAME_MAX}
        placeholder={t("personas.namePlaceholder")}
        error={fieldError("name")}
      />
      <TextArea
        label={t("personas.description")}
        optional
        counter
        height={180}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        maxLength={PERSONA_DESCRIPTION_MAX}
        placeholder={t("personas.descriptionPlaceholder")}
        hint={t("personas.descriptionHint")}
        error={fieldError("description")}
      />
      <label className={styles.defaultRow}>
        <span className={styles.defaultText}>
          <b>{t("personas.setDefault")}</b>
          <span>{t("personas.defaultNote")}</span>
        </span>
        <Toggle checked={isDefault} onChange={setIsDefault} aria-label={t("personas.setDefault")} />
      </label>
      {error && !fieldError("name") && !fieldError("description") ? <Notice message={describeError(error)} /> : null}
      <div className={styles.editorFoot}>
        {persona ? (
          <Button label={t("personas.delete")} icon="trash" size="sm" variant="danger" disabled={busy} onClick={() => void remove()} />
        ) : (
          <span />
        )}
        <Button label={t("personas.save")} disabled={busy || !name.trim() || !changed} onClick={() => void save()} />
      </div>
    </Panel>
  );
}
