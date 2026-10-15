/** 拖着文件进窗口时盖在内容区上的接收区（W04）：浅蓝底、2px 蓝色内描边、圆角 32 */

import { Icon } from "../components/Icon.tsx";
import styles from "./import.module.css";

export function DropZone() {
  return (
    <div className={styles.dropZone} aria-hidden="true">
      <span className={styles.dropIcon}>
        <Icon name="share" size={32} />
      </span>
      <span className={styles.dropTitle}>松开就导入</span>
      <span className={styles.dropText}>
        PNG（卡面图片里带数据）或 JSON（纯文本角色卡），最大 16 MB
        <br />
        支持 SillyTavern V1、V2、V3，可以一次拖多张
      </span>
    </div>
  );
}
