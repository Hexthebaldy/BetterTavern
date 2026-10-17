/**
 * 资源的形状：英文（以及以后的其他语言）由中文的资源推出来，少 key、多 key 在类型检查时都会报错。
 * 复数：中文只写 key_other，别的语言对每个 key_other 还要写 key_one。
 */

type PluralOne<K> = K extends `${infer Base}_other` ? `${Base}_one` : never;

export type Messages<T> = {
  [K in keyof T]: T[K] extends string ? string : Messages<T[K]>;
} & {
  [K in keyof T as PluralOne<K>]: string;
};
