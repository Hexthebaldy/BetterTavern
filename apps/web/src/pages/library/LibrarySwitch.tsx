/** “角色”一级页里的两段切换：角色卡（/characters）和世界书（/lorebooks），轮盘上都算“角色”这一块 */

import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";

import { Segmented } from "../../components/controls.tsx";

export function LibrarySwitch({ value }: { value: "cards" | "lorebooks" }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <Segmented
      label={t("lorebook.tabs.label")}
      value={value}
      options={[
        { value: "cards", label: t("lorebook.tabs.cards") },
        { value: "lorebooks", label: t("lorebook.tabs.lorebooks") },
      ]}
      onChange={(next) => navigate(next === "cards" ? "/characters" : "/lorebooks")}
    />
  );
}
