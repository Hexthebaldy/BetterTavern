/**
 * 阅读页的“更多”（W09，同平板）：贴着操作栏的“更多”按钮弹出，宽 340，右边缘和按钮对齐，底边在按钮上方 8，不加遮罩。
 * 内容：阅读设置（宋体 / 黑体、字号），重命名故事、世界状态、写结局、键盘快捷键（网页才有）、删除故事。
 * “写结局”只在能行动时可点（开场写完、没在生成、没有失败等着重试），故事写完结局后不再显示。
 * 点外面、按 Esc 关闭，焦点回到“更多”按钮。阅读设置存在浏览器里，所有故事共用。
 */

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";

import {
  lineHeightFor,
  READING_SIZES,
  readingSize,
  sizeIndex,
  stepSize,
  type ReadingFont,
} from "@bettertavern/core/play/reading";
import { popoverFrame } from "@bettertavern/design/layout";

import { cx } from "../../components/controls.tsx";
import { Icon, type IconName } from "../../components/Icon.tsx";
import { usePrefs } from "../../state/PrefsProvider.tsx";
import styles from "./play.module.css";

function FontChoice() {
  const { reading, setReading } = usePrefs();
  const option = (value: ReadingFont, glyph: string, label: string) => {
    const on = reading.font === value;
    return (
      <button
        type="button"
        role="radio"
        aria-checked={on}
        className={cx(styles.fontOption, on && styles.fontOn)}
        onClick={() => setReading({ ...reading, font: value })}
      >
        <span className={value === "serif" ? styles.glyphSerif : styles.glyphSans}>{glyph}</span>
        {label}
      </button>
    );
  };
  return (
    <div className={styles.fonts} role="radiogroup" aria-label="正文字体">
      {option("serif", "宋", "宋体")}
      {option("sans", "黑", "黑体")}
    </div>
  );
}

/** 字号：两头是减小、增大的圆按钮，中间是可以点、拖、用方向键调的滑杆 */
function SizeControl() {
  const { reading, setReading } = usePrefs();
  const size = readingSize(reading);
  const index = sizeIndex(size);
  const ratio = index / (READING_SIZES.length - 1);
  const step = (label: string, glyph: number, delta: 1 | -1) => (
    <button
      type="button"
      aria-label={label}
      className={styles.sizeButton}
      onClick={() => setReading({ ...reading, size: stepSize(reading, delta) })}
    >
      <span style={{ fontSize: glyph }}>A</span>
    </button>
  );
  return (
    <div className={styles.sizeBlock}>
      <div className={styles.size}>
        {step("字号减小", 14, -1)}
        <input
          type="range"
          className={styles.range}
          aria-label="正文字号"
          aria-valuetext={`${size}`}
          min={0}
          max={READING_SIZES.length - 1}
          step={1}
          value={index}
          style={{ "--fill": `${ratio * 100}%` } as CSSProperties}
          onChange={(e) => setReading({ ...reading, size: READING_SIZES[Number(e.target.value)] ?? size })}
        />
        {step("字号增大", 22, 1)}
      </div>
      <div className={styles.sizeNote}>
        <span className={styles.mono}>
          {size} / {lineHeightFor(size)} · {reading.size === null ? "跟随浏览器字号" : "固定字号"}
        </span>
        {reading.size !== null ? (
          <button
            type="button"
            className={styles.follow}
            onClick={() => setReading({ ...reading, size: null })}
          >
            跟随浏览器字号
          </button>
        ) : null}
      </div>
    </div>
  );
}

export type MoreAction = "rename" | "world" | "end" | "shortcuts" | "delete";

export function MorePopover({
  anchor,
  ending,
  onClose,
  onAction,
}: {
  anchor: HTMLElement;
  /** 写结局：ready 可以写；busy 暂时不能（生成中、开场没写好、失败等着重试）；ended 已经写完了，不显示 */
  ending: "ready" | "busy" | "ended";
  onClose: () => void;
  onAction: (action: MoreAction) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState<{ left: number; top: number; width: number } | null>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useLayoutEffect(() => {
    const place = (): void => {
      const rect = anchor.getBoundingClientRect();
      const height = box.current?.offsetHeight ?? 420;
      setFrame(
        popoverFrame(
          { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
          { width: window.innerWidth, height: window.innerHeight },
          rect.top,
          height,
          12,
        ),
      );
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [anchor]);

  useEffect(() => {
    box.current?.querySelector<HTMLElement>("button")?.focus();
    const onDown = (event: MouseEvent): void => {
      const target = event.target as Node;
      if (!box.current?.contains(target) && !anchor.contains(target)) close.current();
    };
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("mousedown", onDown);
      anchor.focus({ preventScroll: true });
    };
  }, [anchor]);

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close.current();
    }
  };

  const item = (
    action: MoreAction,
    icon: IconName,
    label: string,
    kbd?: string,
    danger?: boolean,
    disabled?: boolean,
  ) => (
    <button
      type="button"
      className={cx(styles.menuItem, danger && styles.menuDanger)}
      disabled={disabled}
      onClick={() => onAction(action)}
    >
      <Icon name={icon} size={20} />
      <span className={styles.flex}>{label}</span>
      {kbd ? <kbd className={styles.kbd}>{kbd}</kbd> : null}
    </button>
  );

  return createPortal(
    <div
      ref={box}
      role="dialog"
      aria-label="更多"
      className={cx(styles.popover, "surface-sheet")}
      style={frame ? { left: frame.left, top: frame.top, width: frame.width } : { visibility: "hidden" }}
      onKeyDown={onKeyDown}
    >
      <div className={styles.popLabel}>阅读设置</div>
      <FontChoice />
      <SizeControl />
      <div className={styles.menuGroup}>
        {item("rename", "write", "重命名故事")}
        {item("world", "world", "世界状态", "W")}
        {ending !== "ended" ? item("end", "flag", "写结局", undefined, false, ending === "busy") : null}
        {item("shortcuts", "grid", "键盘快捷键", "?")}
        {item("delete", "trash", "删除故事", undefined, true)}
      </div>
    </div>,
    document.body,
  );
}
