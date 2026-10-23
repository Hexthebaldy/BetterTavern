/** 撑满格子的封面：量出格子里留给封面的宽高，再按这个尺寸画（几何封面的线宽跟着尺寸走，见 Cover.tsx） */

import { useRef } from "react";

import { useElementSize } from "../hooks/useElementSize.ts";
import { Cover } from "./Cover.tsx";

export function FluidCover({
  seed,
  blobId,
  className,
}: {
  seed: string;
  blobId: string | null | undefined;
  className?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const size = useElementSize(box);
  return (
    <div ref={box} className={className} style={{ lineHeight: 0, overflow: "hidden" }}>
      {size.width > 0 && size.height > 0 ? (
        <Cover seed={seed} blobId={blobId} width={size.width} height={size.height} rounded={0} />
      ) : null}
    </div>
  );
}
