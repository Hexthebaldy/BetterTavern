/** 账户头像：昵称（没有就用邮箱）的第一个字，浅蓝底蓝字 */

import type { User } from "@bettertavern/core/api/types";

import styles from "./shell.module.css";

export function initialOf(user: Pick<User, "display_name" | "email">): string {
  const source = user.display_name.trim() || user.email;
  return Array.from(source)[0]?.toUpperCase() ?? "?";
}

export function Avatar({ user, size = 32 }: { user: User; size?: number }) {
  return (
    <span
      className={styles.avatar}
      style={{ width: size, height: size, fontSize: size * 0.44 }}
      aria-hidden="true"
    >
      {initialOf(user)}
    </span>
  );
}
