/** 打开页面、凭 Cookie 恢复登录时的过渡画面（同 App 的 app/index.tsx） */

import { Logo } from "../components/Logo.tsx";
import styles from "./pages.module.css";

export function Splash() {
  return (
    <div className={styles.splash} aria-busy="true">
      <Logo size={56} />
    </div>
  );
}
